import type { SkippedFieldNote } from '../types/fill';

/** 文件框对不上本机附件 */
export const SKIP_REASON_NO_FILE = '没有对应的附件';

/** 模型没把这个字段放进填写项 */
export const SKIP_REASON_UNSURE = '没有把握对上档案';

/** 没配 API，剩余字段无法对照 */
export const SKIP_REASON_NO_MODEL = '没有配置模型，这次没对照档案';

/** 模型超时，剩余字段这次不猜 */
export const SKIP_REASON_TIMEOUT = '模型超时，这次没对照';

/**
 * 给一批字段套上同一种原因，供映射表逐行显示。
 */
export function notesForFieldIds(
  fieldIds: string[],
  reason: string,
): SkippedFieldNote[] {
  return fieldIds.map((fieldId) => ({ fieldId, reason }));
}
