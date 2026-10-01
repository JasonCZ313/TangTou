/**
 * 云端 Decision 引擎：用户 OpenAI 兼容 API + 严格 JSON FillPlan。
 * Key 仅经本模块参数传入，不得写入 content 消息。
 */
import { requestFillPlan } from '../llm/openaiCompatible';
import { buildBatchMapPrompt } from './prompts';
import type {
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionEngine,
} from './types';

/** 对照档案默认超时：长表单字段多时给足时间 */
const CLOUD_BATCH_TIMEOUT_MS = 120_000;

/**
 * 创建绑定了当前 API 凭证的云端引擎实例。
 */
export function createCloudEngine(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}): DecisionEngine {
  const hasCredentials =
    options.apiBaseUrl.trim().length > 0 && options.apiKey.trim().length > 0;

  return {
    kind: 'cloud',
    async ready(): Promise<boolean> {
      return hasCredentials;
    },
    async decideBatch(
      request: DecisionBatchRequest,
    ): Promise<DecisionBatchResult> {
      if (!hasCredentials) {
        return {
          usedEngine: 'cloud',
          items: [],
          skippedFieldIds: request.fields.map((field) => field.fieldId),
          usage: null,
          notice: '未配置 API，无法走云端判断。',
        };
      }
      if (request.fields.length === 0) {
        return {
          usedEngine: 'cloud',
          items: [],
          skippedFieldIds: [],
          usage: null,
        };
      }

      const { system, user } = buildBatchMapPrompt(
        request.profileData,
        request.fields,
      );

      try {
        const { plan, usage } = await requestFillPlan({
          apiBaseUrl: options.apiBaseUrl,
          apiKey: options.apiKey,
          model: options.model,
          system,
          user,
          timeoutMs: CLOUD_BATCH_TIMEOUT_MS,
        });
        const acceptedItems = plan.items.filter(
          (item) => item.confidence >= request.minConfidence,
        );
        const lowConfidenceIds = plan.items
          .filter((item) => item.confidence < request.minConfidence)
          .map((item) => item.fieldId);
        return {
          usedEngine: 'cloud',
          items: acceptedItems.map((item) => ({
            fieldId: item.fieldId,
            value: item.value,
            confidence: item.confidence,
            reason: item.reason,
            attachmentId: item.attachmentId,
          })),
          skippedFieldIds: [
            ...new Set([...plan.skippedFieldIds, ...lowConfidenceIds]),
          ],
          usage,
        };
      } catch (error: unknown) {
        const timedOut = error instanceof Error && error.name === 'AbortError';
        if (timedOut) {
          return {
            usedEngine: 'cloud',
            items: [],
            skippedFieldIds: request.fields.map((field) => field.fieldId),
            usage: null,
            notice:
              '模型超过 120 秒还没答完。已保留规则配上的项；其余可再扫一次或检查网络。',
          };
        }
        throw error;
      }
    },
  };
}
