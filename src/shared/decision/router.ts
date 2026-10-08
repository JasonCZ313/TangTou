/**
 * DecisionRouter（P2a）：规则短路 → 本机只接选项/是否题 → 其余与未命中走云端 batch_map。
 * 本机未就绪时静默跳过，不挡填写；用户零额外操作即可完成预览。
 */
import {
  notesForFieldIds,
  SKIP_REASON_NO_MODEL,
  SKIP_REASON_TIMEOUT,
  SKIP_REASON_UNSURE,
} from '../fill/skipReasons';
import { auditFillPlanRowCollisions } from '../fill/sectionBinder';
import {
  mergeMappingItems,
  sourcedItemsToFillPlan,
  type SourcedMappingItem,
} from '../session/mergeIntents';
import type { FieldDescriptor, FillPlan } from '../types/fill';
import type { ProfileData } from '../types/profile';
import { createCloudEngine } from './cloudEngine';
import { localEngine, LOCAL_ENGINE_NOT_READY } from './localEngine';
import { runRuleShortCircuit } from './ruleShortCircuit';
import { hitsToSourcedItems } from './toFillPlan';
import { splitFieldsByDecisionBucket } from './typedQuestions';
import type {
  BuildFillPlanViaDecisionInput,
  BuildFillPlanViaDecisionOutput,
  EngineKind,
} from './types';

/** 无 API 时挂在规则项 reason 后的提示 */
const HEURISTICS_ONLY_TIP = '未配置 API，仅填写高置信基础字段';

/**
 * 计划出炉后做串行同文清洗：多行同值但档案不同则剔除，防止预览就已写死「两块一样」。
 */
function sealPlanAgainstRowCollision(
  plan: FillPlan,
  profileData: ProfileData,
  fields: FieldDescriptor[],
): FillPlan {
  const audited = auditFillPlanRowCollisions(profileData, fields, plan.items);
  if (audited.rejected.length === 0) {
    return plan;
  }
  return {
    ...plan,
    items: audited.items,
    skippedFieldIds: [
      ...new Set([
        ...plan.skippedFieldIds,
        ...audited.rejected.map((item) => item.fieldId),
      ]),
    ],
    skippedNotes: [
      ...(plan.skippedNotes ?? []),
      ...audited.rejected.map((item) => ({
        fieldId: item.fieldId,
        reason: item.reason,
      })),
    ],
  };
}

/**
 * 给规则计划里的 items 打上来源，并可选追加「仅启发式」提示。
 */
function rulePlanToSourced(
  partialPlan: FillPlan,
  appendHeuristicsTip: boolean,
): SourcedMappingItem[] {
  return partialPlan.items.map((item) => {
    const baseReason = item.reason?.trim() || '本地高置信规则';
    const reason = appendHeuristicsTip
      ? `[规则] ${baseReason}；${HEURISTICS_ONLY_TIP}`
      : `[规则] ${baseReason}`;
    const sourced: SourcedMappingItem = {
      fieldId: item.fieldId,
      value: item.value,
      confidence: item.confidence,
      reason,
      source: 'rule',
    };
    if (item.attachmentId) {
      sourced.attachmentId = item.attachmentId;
    }
    return sourced;
  });
}

/**
 * 合并规则跳过说明与引擎跳过 id。
 */
function buildSkippedNotes(
  rulePlan: FillPlan,
  skippedFieldIds: string[],
  skipReason: string,
): NonNullable<FillPlan['skippedNotes']> {
  const notedIds = new Set(
    (rulePlan.skippedNotes ?? []).map((note) => note.fieldId),
  );
  return [
    ...(rulePlan.skippedNotes ?? []),
    ...notesForFieldIds(
      skippedFieldIds.filter((fieldId) => !notedIds.has(fieldId)),
      skipReason,
    ),
  ];
}

/**
 * 从提案列表汇总已填 fieldId。
 */
function collectFilledIds(proposalLists: SourcedMappingItem[][]): Set<string> {
  const filledIds = new Set<string>();
  for (const list of proposalLists) {
    for (const item of list) {
      filledIds.add(item.fieldId);
    }
  }
  return filledIds;
}

/**
 * 主入口：按设置分题路由，产出预览用 FillPlan；出炉前做串行同文清洗。
 */
export async function buildFillPlanViaDecision(
  input: BuildFillPlanViaDecisionInput,
): Promise<BuildFillPlanViaDecisionOutput> {
  const output = await buildFillPlanViaDecisionCore(input);
  return {
    ...output,
    plan: sealPlanAgainstRowCollision(
      output.plan,
      input.profileData,
      input.fields,
    ),
  };
}

/**
 * 路由核心（未做串行清洗）。
 */
async function buildFillPlanViaDecisionCore(
  input: BuildFillPlanViaDecisionInput,
): Promise<BuildFillPlanViaDecisionOutput> {
  const minConfidence = input.decisionMinConfidence;
  const hasApiConfigured =
    input.apiBaseUrl.trim().length > 0 && input.apiKey.trim().length > 0;

  // ① 规则短路（不耗 Token）
  const { partialPlan, remainingFields } = runRuleShortCircuit(
    input.profileData,
    input.fields,
    input.attachments,
  );

  if (!hasApiConfigured) {
    const sourcedRule = rulePlanToSourced(partialPlan, true);
    const skippedFieldIds = [
      ...partialPlan.skippedFieldIds,
      ...remainingFields.map((field) => field.fieldId),
    ];
    const plan = sourcedItemsToFillPlan(sourcedRule, skippedFieldIds);
    plan.skippedNotes = buildSkippedNotes(
      partialPlan,
      remainingFields.map((field) => field.fieldId),
      SKIP_REASON_NO_MODEL,
    );
    return { plan, usage: null, primaryEngine: 'rule' };
  }

  if (remainingFields.length === 0) {
    const sourcedRule = rulePlanToSourced(partialPlan, false);
    const plan = sourcedItemsToFillPlan(
      sourcedRule,
      partialPlan.skippedFieldIds,
    );
    plan.skippedNotes = partialPlan.skippedNotes;
    return { plan, usage: null, primaryEngine: 'rule' };
  }

  // ② 分题：选项/是否 → 本机；自由文本 → 云端。框内对照跳过本机，规则剩余全部进云端。
  const { typedFields, textFields } = splitFieldsByDecisionBucket(remainingFields);
  const proposalLists: SourcedMappingItem[][] = [
    rulePlanToSourced(partialPlan, false),
  ];
  let usage: BuildFillPlanViaDecisionOutput['usage'] = null;
  let notice: string | undefined;
  let primaryEngine: EngineKind = 'rule';
  const skipLocalForCloudRemaining = Boolean(input.preferCloudForRemaining);

  // ②a 本机只吃 typed（P2a 起；未就绪则跳过）。框内对照不走这一步。
  if (
    typedFields.length > 0 &&
    input.layaEnabled &&
    input.decisionPreferLocal &&
    !skipLocalForCloudRemaining
  ) {
    const localReady = await localEngine.ready();
    if (localReady) {
      try {
        const localResult = await localEngine.decideBatch({
          kind: 'batch_map',
          profileData: input.profileData,
          fields: typedFields,
          minConfidence,
        });
        proposalLists.push(hitsToSourcedItems(localResult.items, 'local'));
        primaryEngine = 'local';
        if (localResult.notice) {
          notice = localResult.notice;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error ?? '');
        if (message !== LOCAL_ENGINE_NOT_READY) {
          notice = '本机判断失败，选项题已改用云端。';
        }
      }
    } else if (!input.layaModelUrl?.trim()) {
      // 空 URL：不打扰；有 preferLocal 时可选轻提示（仅当有 typed 题）
      notice = notice ?? undefined;
    }
  }

  // ②b 云端：自由文本 + 本机未填上的 typed
  const filledAfterLocal = collectFilledIds(proposalLists);
  const cloudFields: FieldDescriptor[] = [
    ...textFields,
    ...typedFields.filter((field) => !filledAfterLocal.has(field.fieldId)),
  ];

  if (cloudFields.length === 0) {
    const merged = mergeMappingItems(proposalLists);
    const filledIds = new Set(merged.map((item) => item.fieldId));
    const skippedFieldIds = partialPlan.skippedFieldIds.filter(
      (fieldId) => !filledIds.has(fieldId),
    );
    const plan = sourcedItemsToFillPlan(merged, skippedFieldIds);
    plan.skippedNotes = buildSkippedNotes(
      partialPlan,
      skippedFieldIds,
      SKIP_REASON_UNSURE,
    );
    return { plan, usage, notice, primaryEngine };
  }

  const cloudEngine = createCloudEngine({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    model: input.model,
  });
  if (!(await cloudEngine.ready())) {
    const sourcedRule = rulePlanToSourced(partialPlan, true);
    const skippedFieldIds = [
      ...partialPlan.skippedFieldIds,
      ...remainingFields.map((field) => field.fieldId),
    ];
    const plan = sourcedItemsToFillPlan(sourcedRule, skippedFieldIds);
    plan.skippedNotes = buildSkippedNotes(
      partialPlan,
      remainingFields.map((field) => field.fieldId),
      SKIP_REASON_NO_MODEL,
    );
    return { plan, usage: null, primaryEngine: 'rule', notice };
  }

  const cloudResult = await cloudEngine.decideBatch({
    kind: 'batch_map',
    profileData: input.profileData,
    fields: cloudFields,
    minConfidence,
  });
  proposalLists.push(hitsToSourcedItems(cloudResult.items, 'cloud'));
  usage = cloudResult.usage ?? null;
  if (primaryEngine === 'rule') {
    primaryEngine = 'cloud';
  }

  const merged = mergeMappingItems(proposalLists);
  const filledIds = new Set(merged.map((item) => item.fieldId));
  const skippedFieldIds = [
    ...new Set([
      ...partialPlan.skippedFieldIds,
      ...(cloudResult.skippedFieldIds ?? []),
    ]),
  ].filter((fieldId) => !filledIds.has(fieldId));
  for (const field of remainingFields) {
    if (!filledIds.has(field.fieldId) && !skippedFieldIds.includes(field.fieldId)) {
      skippedFieldIds.push(field.fieldId);
    }
  }

  if (cloudResult.notice) {
    notice = cloudResult.notice;
    const plan = sourcedItemsToFillPlan(merged, skippedFieldIds);
    plan.skippedNotes = buildSkippedNotes(
      partialPlan,
      remainingFields.map((field) => field.fieldId),
      SKIP_REASON_TIMEOUT,
    );
    return { plan, usage, notice, primaryEngine };
  }

  const plan = sourcedItemsToFillPlan(merged, skippedFieldIds);
  plan.skippedNotes = buildSkippedNotes(
    partialPlan,
    skippedFieldIds,
    SKIP_REASON_UNSURE,
  );
  return { plan, usage, notice, primaryEngine };
}
