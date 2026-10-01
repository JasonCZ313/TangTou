/**
 * P7b：把 Playbook 中可映射的填写步合并进 FillPlan（来源 probe）。
 * 不点击、不写页；只改预览计划。
 */
import type { FillMappingItem, FillPlan } from '../types/fill';
import type { PlaybookStep, SitePlaybook } from './types';

/**
 * 判断一步是否可合并为预览填写项。
 */
export function isPlaybookStepMergeable(
  step: PlaybookStep,
  minConfidence: number,
): boolean {
  if (!step.isWrite) {
    return false;
  }
  if (step.kind !== 'fill_field' && step.kind !== 'select_option') {
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
 * 合并进已有计划：已有同 fieldId 时，仅当原来源优先级不高于 probe 才覆盖。
 * 用户改过的项（source=user）永不覆盖。
 */
export function mergePlaybookIntoFillPlan(
  existingPlan: FillPlan,
  playbook: SitePlaybook,
  minConfidence: number,
): { plan: FillPlan; mergedCount: number; skippedStepCount: number } {
  const probeItems = playbookStepsToProbeItems(playbook, minConfidence);
  const byFieldId = new Map<string, FillMappingItem>();
  for (const item of existingPlan.items) {
    byFieldId.set(item.fieldId, item);
  }

  let mergedCount = 0;
  for (const probeItem of probeItems) {
    const existing = byFieldId.get(probeItem.fieldId);
    if (existing?.source === 'user') {
      continue;
    }
    // 已有非用户项：探活可覆盖（同级），便于用户看到探活建议
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
    skippedStepCount: Math.max(0, mergeableStepCount - mergedCount),
  };
}

/**
 * 筛出用户确认后允许逐步执行的写入步（排除警告/观察/等待）。
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
    return (
      step.kind === 'fill_field' ||
      step.kind === 'select_option' ||
      step.kind === 'click_add' ||
      step.kind === 'open_picker'
    );
  });
}
