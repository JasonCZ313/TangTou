/**
 * 合并写入意图：用户改值最高优先，其次模型/Laya，再次规则。
 * P0 侧栏已在 collect 时直接改 plan.items；本模块供后续多引擎提案合并。
 */
import type { FillMappingItem, FillPlan } from '../types/fill';

/** 提案来源，写入预览「来源」列时用 */
export type IntentSource = 'user' | 'laya' | 'llm' | 'rule';

/** 带来源的填写项（P1+ 决策层使用；P0 可只标 user/llm/rule） */
export interface SourcedMappingItem extends FillMappingItem {
  source: IntentSource;
}

/**
 * 按 fieldId 合并多路提案。后写入的同级不覆盖更高级来源。
 * 优先级：user > laya = llm > rule
 */
export function mergeMappingItems(
  proposalLists: SourcedMappingItem[][],
): SourcedMappingItem[] {
  const priority: Record<IntentSource, number> = {
    user: 40,
    laya: 30,
    llm: 30,
    rule: 10,
  };
  const byFieldId = new Map<string, SourcedMappingItem>();
  for (const proposalList of proposalLists) {
    for (const item of proposalList) {
      if (!item.fieldId) {
        continue;
      }
      const existing = byFieldId.get(item.fieldId);
      if (!existing || priority[item.source] >= priority[existing.source]) {
        byFieldId.set(item.fieldId, item);
      }
    }
  }
  return [...byFieldId.values()];
}

/**
 * 把带来源的项收成普通 FillPlan（消息协议仍用 FillPlan）。
 */
export function sourcedItemsToFillPlan(
  items: SourcedMappingItem[],
  skippedFieldIds: string[] = [],
): FillPlan {
  return {
    items: items.map(({ fieldId, value, confidence, reason, attachmentId }) => {
      const mappingItem: FillMappingItem = {
        fieldId,
        value,
        confidence,
      };
      if (reason) {
        mappingItem.reason = reason;
      }
      if (attachmentId) {
        mappingItem.attachmentId = attachmentId;
      }
      return mappingItem;
    }),
    skippedFieldIds,
  };
}
