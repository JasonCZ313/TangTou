/**
 * P7b：把 Playbook 中可映射的填写步合并进 FillPlan（来源 probe）。
 * 不点击、不写页；只改预览计划。
 * P1：按来源优先级合并；同级仅当探活置信度严格更高才覆盖，避免低置信冲掉云端/本机。
 */
import type { FillMappingItem, FillPlan } from '../types/fill';
import { getFillSourcePriority } from '../session/mergeIntents';
import type { PlaybookStep, SitePlaybook } from './types';

/**
 * 判断一步是否可合并为预览填写项。
 * N3：open_picker 仅在有建议值时可合并（写入 plan 供确认写入）；无值仍排除。
 */
export function isPlaybookStepMergeable(
  step: PlaybookStep,
  minConfidence: number,
): boolean {
  if (!step.isWrite) {
    return false;
  }
  const kindAllowed =
    step.kind === 'fill_field' ||
    step.kind === 'select_option' ||
    step.kind === 'open_picker';
  if (!kindAllowed) {
    return false;
  }
  if (!step.targetFieldId?.trim()) {
    return false;
  }
  if (!step.suggestedValue?.trim()) {
    return false;
  }
  if (step.confidence < minConfidence) {
    return false;
  }
  return true;
}

/**
 * 从 Playbook 抽出探活来源的 FillMappingItem。
 */
export function playbookStepsToProbeItems(
  playbook: SitePlaybook,
  minConfidence: number,
): FillMappingItem[] {
  const items: FillMappingItem[] = [];
  for (const step of playbook.steps) {
    if (!isPlaybookStepMergeable(step, minConfidence)) {
      continue;
    }
    items.push({
      fieldId: step.targetFieldId!.trim(),
      value: step.suggestedValue!.trim(),
      confidence: step.confidence,
      reason: `[探活] ${step.title}`,
      source: 'probe',
    });
  }
  return items;
}

/**
 * 判断探活项是否应写入已有计划中的同 fieldId 项。
 * - user：永不覆盖
 * - 已有更高来源优先级：不覆盖
 * - 同级：仅探活置信度严格更高才覆盖
 * - 更低来源（如 rule）或无项：覆盖/新增
 */
export function shouldProbeItemOverwriteExisting(
  existing: FillMappingItem | undefined,
  probeItem: FillMappingItem,
): boolean {
  if (!existing) {
    return true;
  }
  const existingPriority = getFillSourcePriority(existing.source);
  const probePriority = getFillSourcePriority(probeItem.source ?? 'probe');
  if (existingPriority > probePriority) {
    return false;
  }
  if (existingPriority < probePriority) {
    return true;
  }
  // 同级：置信度必须严格更高，相等则保留原提案（防无意义抖动）
  return probeItem.confidence > existing.confidence;
}

/**
 * 合并进已有计划：尊重来源优先级；同级仅更高置信探活可覆盖。
 * 用户改过的项（source=user）永不覆盖。
 */
export function mergePlaybookIntoFillPlan(
  existingPlan: FillPlan,
  playbook: SitePlaybook,
  minConfidence: number,
): {
  plan: FillPlan;
  mergedCount: number;
  skippedStepCount: number;
  /** 因用户改过或更高/同等置信原值而保留的条数 */
  keptStrongerCount: number;
} {
  const probeItems = playbookStepsToProbeItems(playbook, minConfidence);
  const byFieldId = new Map<string, FillMappingItem>();
  for (const item of existingPlan.items) {
    byFieldId.set(item.fieldId, item);
  }

  let mergedCount = 0;
  let keptStrongerCount = 0;
  for (const probeItem of probeItems) {
    const existing = byFieldId.get(probeItem.fieldId);
    if (!shouldProbeItemOverwriteExisting(existing, probeItem)) {
      keptStrongerCount += 1;
      continue;
    }
    byFieldId.set(probeItem.fieldId, probeItem);
    mergedCount += 1;
  }

  const mergeableStepCount = playbook.steps.filter((step) =>
    isPlaybookStepMergeable(step, minConfidence),
  ).length;

  const filledIds = new Set(byFieldId.keys());
  return {
    plan: {
      items: [...byFieldId.values()],
      skippedFieldIds: existingPlan.skippedFieldIds.filter(
        (fieldId) => !filledIds.has(fieldId),
      ),
      skippedNotes: existingPlan.skippedNotes?.filter(
        (note) => !filledIds.has(note.fieldId),
      ),
    },
    mergedCount,
    skippedStepCount: Math.max(0, mergeableStepCount - mergedCount - keptStrongerCount),
    keptStrongerCount,
  };
}

/**
 * 筛出用户确认后允许逐步执行的写入步。
 * P2：fill / select / open_picker 必须有建议值，避免无值步失败掐断后续填写；
 * click_add 不要求建议值（仍走执行期黑名单）。
 */
export function selectExecutablePlaybookSteps(
  playbook: SitePlaybook,
  minConfidence: number,
): PlaybookStep[] {
  return playbook.steps.filter((step) => {
    if (!step.isWrite) {
      return false;
    }
    if (step.kind === 'warn' || step.kind === 'observe' || step.kind === 'wait') {
      return false;
    }
    if (step.confidence < minConfidence) {
      return false;
    }
    if (step.kind === 'click_add') {
      return true;
    }
    if (
      step.kind === 'fill_field' ||
      step.kind === 'select_option' ||
      step.kind === 'open_picker'
    ) {
      return Boolean(step.targetFieldId?.trim() && step.suggestedValue?.trim());
    }
    return false;
  });
}
