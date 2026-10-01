/**
 * 把页面 OCR 文本并入字段上下文，并产出少量高置信「可见选项」提案（P4b）。
 * 不直接写页面：只丰富 Decision 输入 / 追加预览项。
 */
import type { FieldDescriptor } from '../types/fill';
import type { ProfileData } from '../types/profile';
import { decideTypedFieldsOffline } from './layaOfflineChoice';
import type { DecisionMappingHit } from './types';

/**
 * 若字段标签过短/过弱，把 OCR 里靠近选项的线索拼进 label（仅内存副本）。
 */
export function enrichFieldsWithPageOcr(
  fields: FieldDescriptor[],
  ocrText: string,
): FieldDescriptor[] {
  const compactOcr = ocrText.replace(/\s+/g, ' ').trim();
  if (!compactOcr) {
    return fields;
  }
  // 只取前若干字，避免撑爆 prompt
  const ocrSnippet = compactOcr.slice(0, 800);

  return fields.map((field) => {
    const label = (field.label ?? '').trim();
    if (label.length >= 4) {
      return field;
    }
    return {
      ...field,
      label: label
        ? `${label}（页内识字：${ocrSnippet.slice(0, 40)}）`
        : `页内识字辅助：${ocrSnippet.slice(0, 48)}`,
    };
  });
}

/**
 * 用 OCR 文本增强后的字段再跑一遍轻量选项匹配，给预览多几条线索。
 * 仅对原本 label 很弱的字段有帮助；结果仍受 minConfidence 约束。
 */
export function proposeFromPageOcr(
  profileData: ProfileData,
  fields: FieldDescriptor[],
  ocrText: string,
  minConfidence: number,
): DecisionMappingHit[] {
  if (!ocrText.trim()) {
    return [];
  }
  const enriched = enrichFieldsWithPageOcr(fields, ocrText);
  const { items } = decideTypedFieldsOffline(
    profileData,
    enriched,
    minConfidence,
  );
  return items.map((item) => ({
    ...item,
    reason: item.reason
      ? `截图识字辅助 · ${item.reason}`
      : '截图识字辅助',
    confidence: Math.min(item.confidence, 0.82),
  }));
}
