/**
 * Decision 用提示词：P1 批量映射沿用现有 buildFillPrompt（档案对照 JSON）。
 * 单选题型文案留给 P2/P4；此处集中出口，避免 background 直接依赖 prompt 路径散落。
 */
import type { FieldDescriptor } from '../types/fill';
import type { ProfileData } from '../types/profile';
import { buildFillPrompt } from '../llm/prompt';

/**
 * 构造「档案 → 剩余字段」批量映射的 system/user。
 */
export function buildBatchMapPrompt(
  profileData: ProfileData,
  fields: FieldDescriptor[],
): { system: string; user: string } {
  return buildFillPrompt(profileData, fields);
}
