/**
 * 一轮确认写入的操作记录。
 * 控制台用「躺投」前缀过滤；侧边栏把同一段文字复制出来贴回聊天。
 */
const traceLines: string[] = [];
let traceSequence = 0;

/**
 * 新一轮写入开始时清空上一轮记录。
 */
export function beginFillTrace(): void {
  traceLines.length = 0;
  traceSequence = 0;
  recordFillStep('记录', '开始', '确认写入', '');
}

/**
 * 记一步。格式：序号 | 字段 | 动作 | 结果 | 补充。
 */
export function recordFillStep(
  fieldLabel: string,
  action: string,
  result: string,
  detail: string,
): void {
  traceSequence += 1;
  const line = [String(traceSequence), fieldLabel, action, result, detail]
    .map((part) => String(part || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim())
    .join(' | ');
  traceLines.push(line);
  console.info(`[躺投] ${line}`);
}

/**
 * 整段记录，给侧边栏复制。
 */
export function fillTraceText(): string {
  if (traceLines.length === 0) {
    return '';
  }
  return traceLines.join('\n');
}
