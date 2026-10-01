/**
 * 规则短路引擎：复用现有本地启发式，不耗 Token。
 * 命中项在 Router 里标 source=rule。
 */
import { applyLocalHeuristics } from '../llm/localHeuristics';
import type { AttachmentMeta } from '../types/attachment';
import type { FieldDescriptor, FillPlan } from '../types/fill';
import type { ProfileData } from '../types/profile';
import type {
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionEngine,
} from './types';

/**
 * 对扫描字段跑高置信规则映射，并把未命中字段留给后续引擎。
 */
export function runRuleShortCircuit(
  profileData: ProfileData,
  fields: FieldDescriptor[],
  attachments: AttachmentMeta[],
): { partialPlan: FillPlan; remainingFields: FieldDescriptor[] } {
  return applyLocalHeuristics(profileData, fields, attachments);
}

/**
 * 规则引擎：decideBatch 内部再跑一遍启发式（供 Router 统一接口；主路径更常直接调 runRuleShortCircuit）。
 */
export const ruleEngine: DecisionEngine = {
  kind: 'rule',
  async ready(): Promise<boolean> {
    return true;
  },
  async decideBatch(request: DecisionBatchRequest): Promise<DecisionBatchResult> {
    const { partialPlan, remainingFields } = applyLocalHeuristics(
      request.profileData,
      request.fields,
      [],
    );
    const items = partialPlan.items.filter(
      (item) => item.confidence >= request.minConfidence,
    );
    const lowConfidenceIds = partialPlan.items
      .filter((item) => item.confidence < request.minConfidence)
      .map((item) => item.fieldId);
    return {
      usedEngine: 'rule',
      items: items.map((item) => ({
        fieldId: item.fieldId,
        value: item.value,
        confidence: item.confidence,
        reason: item.reason,
        attachmentId: item.attachmentId,
      })),
      skippedFieldIds: [
        ...partialPlan.skippedFieldIds,
        ...remainingFields.map((field) => field.fieldId),
        ...lowConfidenceIds,
      ],
      usage: null,
    };
  },
};
