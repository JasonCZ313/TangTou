/**
 * 合并写入意图：用户改值最高优先，其次模型/Laya/探活，再次规则。
 * P0 侧栏已在 collect 时直接改 plan.items；本模块供多引擎提案合并。
 */
import type {
  FillIntentSource,
  FillMappingItem,
  FillPlan,
} from '../types/fill';

/** @deprecated 请用 FillIntentSource；保留别名以免旧 import 断裂 */
export type IntentSource = FillIntentSource;

/** 带来源的填写项（Decision 层合并用） */
export interface SourcedMappingItem extends FillMappingItem {
  source: FillIntentSource;
}

/**
 * 按 fieldId 合并多路提案。后写入的同级不覆盖更高级来源。
 * 优先级：user > probe = laya = llm > rule
 */
export function mergeMappingItems(
  proposalLists: SourcedMappingItem[][],
): SourcedMappingItem[] {
  const priority: Record<FillIntentSource, number> = {
    user: 40,
    probe: 30,
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
 * 把带来源的项收成 FillPlan，并保留正式 source 字段。
 */
export function sourcedItemsToFillPlan(
  items: SourcedMappingItem[],
  skippedFieldIds: string[] = [],
): FillPlan {
  return {
    items: items.map(
      ({ fieldId, value, confidence, reason, attachmentId, source }) => {
        const mappingItem: FillMappingItem = {
          fieldId,
          value,
          confidence,
          source,
        };
        if (reason) {
          mappingItem.reason = reason;
        }
        if (attachmentId) {
          mappingItem.attachmentId = attachmentId;
        }
        return mappingItem;
      },
    ),
    skippedFieldIds,
  };
}
