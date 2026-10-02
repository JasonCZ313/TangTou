/**
 * 把浏览器或接口抛出的原文换成用户能看懂的中文，并写上下一步该怎么做。
 * 已经是中文的句子原样返回。
 */
export function describeUserFacingError(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return translateRawError(rawMessage);
}

/**
 * 判断对照/探活结果里的 notice 是否为「软提示」（如截图 OCR 跳过），
 * 软提示应显示为警告而非整页失败红字。
 */
export function isSoftPlanNotice(notice: string): boolean {
  const trimmed = notice.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^截图识字跳过[：:]/.test(trimmed) ||
    /^截图跳过[：:]/.test(trimmed) ||
    /离屏识字环境/.test(trimmed)
  );
}

/**
 * 按常见失败原因给出中文说明。匹配不到时仍用中文收尾，不把整段英文直接甩给用户。
 */
function translateRawError(rawMessage: string): string {
  const detail = rawMessage.trim();
  if (!detail) {
    return '这次没有完成。请刷新网申页后再试一次。';
  }
  if (
    /Failed to construct ['"]Worker['"]|cannot be accessed from origin/i.test(
      detail,
    )
  ) {
    return '本机识字组件未能在当前环境启动。请重新加载扩展后再试；对照结果若已生成仍可核对写入。';
  }
  if (/receiving end does not exist|could not establish connection/i.test(detail)) {
    return '这个页面还没有躺投的扫描脚本。请先刷新这个网申页，再点扫描。扩展刚重新加载时，旧页面必须刷新一次。';
  }
  if (/message port closed|the message port closed/i.test(detail)) {
    return '页面连接在扫描完成前断了。请刷新网申页后再扫一次。';
  }
  if (
    /cannot access|cannot be scripted|extensions gallery|chrome-error|restricted/i.test(
      detail,
    )
  ) {
    return '这一页不是普通网申网页，躺投只能扫描以 http 或 https 开头的页面。请切到网申页再试。';
  }
  if (detail === 'NO_ACTIVE_TAB' || detail.includes('无法确定当前标签页')) {
    return '找不到当前标签页。请先点一下网申页面，再扫描。';
  }
  if (/未处理的消息类型/.test(detail)) {
    return '扩展还在用旧版本。请在扩展管理页对躺投点一次重新加载，再润色。';
  }
  if (detail === 'EMPTY_RUNTIME_RESPONSE' || detail === 'EMPTY_TAB_RESPONSE') {
    return '扩展后台没有回音。请在扩展管理页对躺投点一次重新加载，再刷新网申页。';
  }
  if (detail === '请求超时' || detail === 'LLM_TIMEOUT' || detail === 'AbortError') {
    return '模型超过等待时间还没返回。请检查网络和接口地址后再试。本机已经配上的项会留下来。';
  }
  if (/sidePanel\.open\(\)|user gesture/i.test(detail)) {
    return '侧边助手只能在你点击按钮的当下打开。请再点一次「打开侧边助手」。对照结果如果已经生成，打开后就能看到。';
  }
  if (/[\u4e00-\u9fff]/.test(detail)) {
    return detail;
  }
  const briefDetail = detail.replace(/\s+/g, ' ').slice(0, 80);
  return `这次没有完成（${briefDetail}）。请刷新网申页后再试。`;
}
