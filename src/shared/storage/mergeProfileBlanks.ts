/**
 * 把简历识别结果合并进现有档案：只填空白，不覆盖用户已写内容。
 */
import { normalizeProfileData } from './normalize';
import type { ProfileData } from '../types/profile';

/**
 * 用识别结果填补 current 中的空字符串与空数组。
 */
export function mergeProfileFillBlanks(
  currentProfile: ProfileData,
  incomingRaw: unknown,
): ProfileData {
  const incomingProfile = normalizeProfileData(incomingRaw);
  const mergedRecord = structuredClone(currentProfile) as unknown as Record<
    string,
    unknown
  >;
  fillBlanks(
    mergedRecord,
    incomingProfile as unknown as Record<string, unknown>,
  );
  return normalizeProfileData(mergedRecord);
}

/**
 * 递归：目标为空则采用来源。
 */
function fillBlanks(
  targetRecord: Record<string, unknown>,
  sourceRecord: Record<string, unknown>,
): void {
  for (const [keyName, sourceValue] of Object.entries(sourceRecord)) {
    if (sourceValue === undefined || sourceValue === null) {
      continue;
    }
    const targetValue = targetRecord[keyName];
    if (typeof sourceValue === 'string') {
      const targetText = typeof targetValue === 'string' ? targetValue.trim() : '';
      if (!targetText && sourceValue.trim()) {
        targetRecord[keyName] = sourceValue;
      }
      continue;
    }
    if (Array.isArray(sourceValue)) {
      const targetEmpty = !Array.isArray(targetValue) || targetValue.length === 0;
      if (targetEmpty && sourceValue.length > 0) {
        targetRecord[keyName] = sourceValue;
      }
      continue;
    }
    if (typeof sourceValue === 'object') {
      if (
        targetValue === null ||
        typeof targetValue !== 'object' ||
        Array.isArray(targetValue)
      ) {
        targetRecord[keyName] = sourceValue;
        continue;
      }
      fillBlanks(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    }
  }
}
