/**
 * P2c：tangtou-ort-v0 在 Offscreen 内的打分 I/O 约定。
 * 有对齐权重时：把「题干+档案提示+各选项」编成定长特征，模型输出每选项分数，取最高且过阈值者。
 * 维度/名字对不上或 run 失败 → 返回 null，上层回退轻量判断。
 */
import type { FieldDescriptor } from '../types/fill';
import type { ProfileData } from '../types/profile';
import type { DecisionBatchResult, DecisionMappingHit } from './types';

/** 清单可选字段：ioProtocol */
export const LAYA_ORT_IO_PROTOCOL_SCORE_V0 = 'tangtou-score-v0';

/** 特征向量长度（与导出权重约定一致） */
export const LAYA_ORT_FEATURE_DIM = 64;

/** 单题最多送进模型的选项数 */
export const LAYA_ORT_MAX_OPTIONS = 16;

/**
 * 简易稳定哈希 → [0,1) 浮点，用于把文案编进定长向量（非加密）。
 */
function hashToUnitFloat(text: string, salt: number): number {
  let hash = (salt * 2654435761) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * 把若干字符串混成 FEATURE_DIM 维特征（bag-of-hash）。
 */
export function encodeTextFeature(
  parts: string[],
  featureDim: number = LAYA_ORT_FEATURE_DIM,
): Float32Array {
  const vector = new Float32Array(featureDim);
  const blob = parts
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('|');
  if (!blob) {
    return vector;
  }
  for (let dim = 0; dim < featureDim; dim += 1) {
    vector[dim] = hashToUnitFloat(blob, dim + 1);
  }
  // L2 归一，避免幅值乱跑
  let norm = 0;
  for (let dim = 0; dim < featureDim; dim += 1) {
    norm += vector[dim] * vector[dim];
  }
  norm = Math.sqrt(norm) || 1;
  for (let dim = 0; dim < featureDim; dim += 1) {
    vector[dim] /= norm;
  }
  return vector;
}

/**
 * 从档案抽短提示，喂给特征编码。
 */
export function collectOrtProfileHints(profileData: ProfileData): string[] {
  const basic = profileData.basic ?? {};
  const jobIntent = profileData.jobIntent ?? {};
  const education = profileData.education?.[0];
  return [
    basic.gender,
    basic.politicalStatus,
    basic.currentCity,
    basic.maritalStatus,
    jobIntent.jobType,
    jobIntent.targetRole,
    education?.degreeLevel || education?.degree,
    education?.school,
  ].filter((value): value is string => Boolean(value?.trim()));
}

/**
 * 为单字段构造 [1, maxOptions, featureDim] 输入，并记录选项下标。
 */
export function buildOrtScoreInputForField(
  field: FieldDescriptor,
  profileHints: string[],
  maxOptions: number = LAYA_ORT_MAX_OPTIONS,
  featureDim: number = LAYA_ORT_FEATURE_DIM,
): { tensorData: Float32Array; options: string[] } | null {
  const options = (field.options ?? [])
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, maxOptions);
  if (options.length === 0) {
    return null;
  }
  const tensorData = new Float32Array(maxOptions * featureDim);
  const questionParts = [field.label, field.placeholder ?? '', ...profileHints];
  for (let optionIndex = 0; optionIndex < maxOptions; optionIndex += 1) {
    const optionText = options[optionIndex] ?? '';
    const feature = encodeTextFeature(
      optionText ? [...questionParts, optionText] : [],
      featureDim,
    );
    tensorData.set(feature, optionIndex * featureDim);
  }
  return { tensorData, options };
}

/**
 * 从模型输出里解析每选项分数（支持常见展平形状）。
 */
export function extractOptionScores(
  outputData: Float32Array | number[],
  optionCount: number,
): number[] | null {
  const values = Array.from(outputData);
  if (values.length === 0 || optionCount <= 0) {
    return null;
  }
  if (values.length === optionCount) {
    return values;
  }
  // [1, maxOptions] 或 [maxOptions] 已处理；若更长则取前 optionCount
  if (values.length >= optionCount) {
    return values.slice(0, optionCount);
  }
  return null;
}

/**
 * 按分数挑出过阈值的最佳选项。
 */
export function pickBestScoredOption(
  options: string[],
  scores: number[],
  minConfidence: number,
): { value: string; confidence: number } | null {
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < options.length; index += 1) {
    const score = scores[index];
    if (!Number.isFinite(score)) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) {
    return null;
  }
  // 将任意实数分映射到 0..1：sigmoid
  const confidence = 1 / (1 + Math.exp(-bestScore));
  if (confidence < minConfidence) {
    return null;
  }
  return { value: options[bestIndex], confidence };
}

/**
 * 把一批字段的 ORT 命中组装成 DecisionBatchResult。
 */
export function buildOrtDecisionResult(
  hits: DecisionMappingHit[],
  allFieldIds: string[],
): DecisionBatchResult {
  const filled = new Set(hits.map((hit) => hit.fieldId));
  return {
    usedEngine: 'local',
    items: hits.map((hit) => ({
      ...hit,
      reason: hit.reason
        ? `本机 ORT · ${hit.reason}`
        : '本机 ORT 打分',
    })),
    skippedFieldIds: allFieldIds.filter((fieldId) => !filled.has(fieldId)),
    usage: null,
  };
}
