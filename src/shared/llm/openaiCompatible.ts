import type { FillMappingItem, FillPlan } from '../types/fill';
import { parseUsageFromPayload } from '../storage/usageStore';
import type { LlmTokenUsage } from '../types/usage';

/** Chat Completions 请求体中的单条消息 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 将任意数值夹紧到 [0, 1]，供 FillPlan.confidence 规范化。
 * 非有限数字视为 0，避免 NaN/Infinity 进入填写路径。
 */
function clampConfidence(rawConfidence: unknown): number {
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    return 0;
  }
  if (rawConfidence < 0) {
    return 0;
  }
  if (rawConfidence > 1) {
    return 1;
  }
  return rawConfidence;
}

/**
 * 规范化并校验 LLM 返回的 FillPlan：
 * - 每项须有 string 类型的 fieldId / value，否则丢弃；
 * - confidence 夹紧到 0..1；
 * - skippedFieldIds 仅保留非空字符串。
 * 非法 item 不进入后续 UI / 写入路径，避免静默异常。
 */
export function normalizeFillPlan(rawPlan: {
  items: unknown[];
  skippedFieldIds: unknown[];
}): FillPlan {
  const normalizedItems: FillMappingItem[] = [];

  for (const rawItem of rawPlan.items) {
    if (rawItem === null || typeof rawItem !== 'object') {
      continue;
    }
    const candidate = rawItem as Record<string, unknown>;
    if (typeof candidate.fieldId !== 'string' || candidate.fieldId.length === 0) {
      continue;
    }
    if (typeof candidate.value !== 'string') {
      continue;
    }
    const mappingItem: FillMappingItem = {
      fieldId: candidate.fieldId,
      value: candidate.value,
      confidence: clampConfidence(candidate.confidence),
    };
    if (typeof candidate.reason === 'string') {
      mappingItem.reason = candidate.reason;
    }
    normalizedItems.push(mappingItem);
  }

  const normalizedSkipped: string[] = [];
  for (const rawSkippedId of rawPlan.skippedFieldIds) {
    if (typeof rawSkippedId === 'string' && rawSkippedId.length > 0) {
      normalizedSkipped.push(rawSkippedId);
    }
  }

  return {
    items: normalizedItems,
    skippedFieldIds: normalizedSkipped,
  };
}

/** requestFillPlan 的入参：仅允许 background 传入 apiKey */
export interface RequestFillPlanOptions {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

/**
 * 根据用户配置的 API 根地址，请求对应主机的 optional host permission。
 * 测连与 BUILD_FILL_PLAN 前必须调用；已授权则直接返回 true。
 */
export async function ensureHostPermission(
  apiBaseUrl: string,
): Promise<boolean> {
  const parsedUrl = new URL(apiBaseUrl);
  const originPattern = `${parsedUrl.protocol}//${parsedUrl.host}/*`;
  const alreadyGranted = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (alreadyGranted) {
    return true;
  }
  return chrome.permissions.request({ origins: [originPattern] });
}

/**
 * 判断 HTTP 错误文案是否像「不支持 response_format」类拒绝，便于去掉该字段重试。
 */
function isResponseFormatRejection(
  statusCode: number,
  errorBodyText: string,
): boolean {
  if (statusCode !== 400 && statusCode !== 422) {
    return false;
  }
  return /response_format|json_object|unknown.?parameter|unsupported/i.test(
    errorBodyText,
  );
}

/**
 * 向 OpenAI 兼容端点发起一次 Chat Completions 请求。
 * useJsonObjectFormat 为 true 时附带 response_format；部分本地/兼容服务不支持该字段。
 */
async function postChatCompletions(args: {
  endpointUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  useJsonObjectFormat: boolean;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<Response> {
  const requestBody: Record<string, unknown> = {
    model: args.model,
    temperature: args.temperature,
    messages: args.messages,
  };
  if (args.useJsonObjectFormat) {
    requestBody.response_format = { type: 'json_object' };
  }
  if (args.maxTokens !== undefined) {
    requestBody.max_tokens = args.maxTokens;
  }

  return fetch(args.endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: args.signal,
  });
}

/**
 * 调用 OpenAI 兼容 Chat Completions，解析为 FillPlan，并尽量带回 usage。
 * apiKey 仅在此函数参数中出现，调用方必须是 background。
 * 若服务端拒绝 response_format，则去掉该字段自动重试一次。
 */
export async function requestFillPlan(
  options: RequestFillPlanOptions,
): Promise<{ plan: FillPlan; usage: LlmTokenUsage | null }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];

  try {
    let response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      temperature: 0.1,
      useJsonObjectFormat: true,
      signal: controller.signal,
    });

    if (!response.ok) {
      const firstErrorText = await response.text();
      if (isResponseFormatRejection(response.status, firstErrorText)) {
        response = await postChatCompletions({
          endpointUrl,
          apiKey: options.apiKey,
          model: options.model,
          messages,
          temperature: 0.1,
          useJsonObjectFormat: false,
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryErrorText = await response.text();
          throw new Error(
            `LLM_HTTP_${response.status}: ${retryErrorText.slice(0, 200)}`,
          );
        }
      } else {
        throw new Error(
          `LLM_HTTP_${response.status}: ${firstErrorText.slice(0, 200)}`,
        );
      }
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }

    const parsed = JSON.parse(content) as {
      items?: unknown;
      skippedFieldIds?: unknown;
    };
    if (
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.skippedFieldIds)
    ) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    const plan = normalizeFillPlan({
      items: parsed.items,
      skippedFieldIds: parsed.skippedFieldIds,
    });
    const usage = parseUsageFromPayload(payload);
    return { plan, usage };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用极小 messages 探测 API 是否可用（测连），不解析 FillPlan。
 * 成功返回 ok:true；失败返回 ok:false 与截断后的 detail（绝不回显 apiKey）。
 */
export async function testApiConnection(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );

  try {
    const response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0,
      useJsonObjectFormat: false,
      maxTokens: 5,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        detail: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    return { ok: true, detail: '连接成功' };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 200) : '未知错误';
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

const RESUME_PARSE_SYSTEM = `你是简历结构化助手。根据用户给出的简历纯文本，输出一个 JSON 对象，结构尽量接近：
{"basic":{"fullName":"","phone":"","email":"","currentCity":"","nationality":"","nativePlace":"","gender":"","birthday":""},"jobIntent":{"targetRole":""},"education":[{"school":"","degreeLevel":"","major":"","startDate":"","endDate":""}],"experience":[{"company":"","title":"","startDate":"","endDate":"","description":""}],"projects":[{"name":"","description":""}],"skills":[{"name":""}]}
规则：只填写简历里明确出现的信息；没有的字段省略或留空字符串；日期尽量 YYYY-MM-DD；不要编造；不要 markdown。`;

/**
 * 把简历纯文本交给模型，解析成可合并的档案 JSON，并带回 usage。
 */
export async function requestResumeProfilePatch(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  resumeText: string;
  timeoutMs?: number;
}): Promise<{ profilePatch: Record<string, unknown>; usage: LlmTokenUsage | null }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: RESUME_PARSE_SYSTEM },
    { role: 'user', content: options.resumeText },
  ];
  try {
    let response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      temperature: 0.1,
      useJsonObjectFormat: true,
      signal: controller.signal,
    });
    if (!response.ok) {
      const firstErrorText = await response.text();
      if (isResponseFormatRejection(response.status, firstErrorText)) {
        response = await postChatCompletions({
          endpointUrl,
          apiKey: options.apiKey,
          model: options.model,
          messages,
          temperature: 0.1,
          useJsonObjectFormat: false,
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryErrorText = await response.text();
          throw new Error(
            `LLM_HTTP_${response.status}: ${retryErrorText.slice(0, 200)}`,
          );
        }
      } else {
        throw new Error(
          `LLM_HTTP_${response.status}: ${firstErrorText.slice(0, 200)}`,
        );
      }
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }
    const jsonText = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    return {
      profilePatch: parsed as Record<string, unknown>,
      usage: parseUsageFromPayload(payload),
    };
  } finally {
    clearTimeout(timer);
  }
}
