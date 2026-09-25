/** 接收意见的邮箱，只出现在反馈链接里，不参与登录 */
export const FEEDBACK_MAILBOX = 'jasonc13@163.com';

/** 邮件主题。mailto 会带上它；邮件软件若丢掉主题，界面上仍有同样这句话 */
export const FEEDBACK_SUBJECT = '【躺投】问题反馈';

/**
 * 生成意见反馈的 mailto 地址。
 * 用户点开后由本机邮件软件写信，主题自动写成「【躺投】问题反馈」。
 */
export function buildFeedbackMailtoUrl(): string {
  const encodedSubject = encodeURIComponent(FEEDBACK_SUBJECT);
  return `mailto:${FEEDBACK_MAILBOX}?subject=${encodedSubject}`;
}

/**
 * 把页面上的「意见反馈」链接指到上面的邮箱和主题。
 */
export function mountFeedbackMailLink(linkElement: HTMLAnchorElement): void {
  linkElement.href = buildFeedbackMailtoUrl();
  linkElement.rel = 'noreferrer';
}
