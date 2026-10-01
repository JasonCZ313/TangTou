/**
 * 把 Decision 命中转成带来源的映射项，并打上可读 reason 前缀。
 */
import type { SourcedMappingItem } from '../session/mergeIntents';
import type { DecisionMappingHit, EngineKind } from './types';

/** 引擎 → 预览来源标签 */
const ENGINE_SOURCE_LABEL: Record<EngineKind, string> = {
  rule: '规则',
  cloud: '云端',
  local: '本机',
};

/**
 * 单条命中 → SourcedMappingItem；reason 前加引擎名便于 P1 预览辨认。
 */
export function hitsToSourcedItems(
  hits: DecisionMappingHit[],
  engine: EngineKind,
): SourcedMappingItem[] {
  const source =
    engine === 'rule' ? 'rule' : engine === 'local' ? 'laya' : 'llm';
  const engineLabel = ENGINE_SOURCE_LABEL[engine];
  return hits.map((hit) => {
    const reasonText = hit.reason?.trim()
      ? `[${engineLabel}] ${hit.reason.trim()}`
      : `[${engineLabel}]`;
    const sourced: SourcedMappingItem = {
      fieldId: hit.fieldId,
      value: hit.value,
      confidence: hit.confidence,
      reason: reasonText,
      source,
    };
    if (hit.attachmentId) {
      sourced.attachmentId = hit.attachmentId;
    }
    return sourced;
  });
}
