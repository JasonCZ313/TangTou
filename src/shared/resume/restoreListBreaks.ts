/** 长文段里这些字段应按要点分行，姓名电话不在此列 */
const LIST_TEXT_KEYS = new Set([
  'description',
  'responsibilities',
  'workContent',
  'achievements',
  'content',
  'value',
  'courses',
  'thesis',
  'selfEvaluation',
]);

/**
 * 模型把要点写进同一段时，在圆点、括号序号前补回换行。
 * 不切「2024.03」这种日期中间的点。
 */
export function restoreListLineBreaks(rawText: string): string {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
  const withMarkers = normalized
    .replace(/([^\n])\s*(?=[•●○▪◦·])/g, '$1\n')
    .replace(/([^\n])\s*(?=[（(]\d{1,2}[）)])/g, '$1\n')
    .replace(/([。；;！？])\s*(?=\d{1,2}[.、．](?!\d))/g, '$1\n')
    .replace(/([。；;！？])\s*(?=[-–—]\s)/g, '$1\n');
  return withMarkers.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 填写阶段专用的换行归一。
 *
 * 与 restoreListLineBreaks 的区别（这是关键）：
 *  - restoreListLineBreaks 会「按符号插换行」并把 3 连换行压成 2 个 —— 那是给「识别出来的整段文本」补结构用的；
 *  - 已经存好的档案里，换行是用户自己敲的，填写时必须**逐字照抄**：
 *    不补行、不压行、不动首尾之外的任何空白。
 * 因此这里只做「统一 \r\n → \n」和首尾裁剪。
 */
export function normalizeLineBreaks(rawText: string): string {
  return String(rawText || '').replace(/\r\n?/g, '\n').trim();
}

/**
 * 只修简历识别结果里的长文段。已经存好的档案不会在每次打开时被改写。
 */
export function restoreResumePatchLineBreaks(rawPatch: unknown): unknown {
  if (!rawPatch || typeof rawPatch !== 'object') {
    return rawPatch;
  }
  if (Array.isArray(rawPatch)) {
    return rawPatch.map((item) => restoreResumePatchLineBreaks(item));
  }
  const record = rawPatch as Record<string, unknown>;
  const restored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && LIST_TEXT_KEYS.has(key)) {
      restored[key] = restoreListLineBreaks(value);
      continue;
    }
    if (value && typeof value === 'object') {
      restored[key] = restoreResumePatchLineBreaks(value);
      continue;
    }
    restored[key] = value;
  }
  return restored;
}
