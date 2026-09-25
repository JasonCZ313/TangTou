/** 接收意见的邮箱 */
export const FEEDBACK_MAILBOX = 'jasonc13@163.com';

/** 邮件主题，复制内容和网页写信页都用这一句 */
export const FEEDBACK_SUBJECT = '【躺投】问题反馈';

/** 四个网页邮箱入口 */
export type FeedbackWebmailKind = 'netease163' | 'qq' | 'gmail' | 'outlook';

/**
 * 拼出用户要粘贴的整封信：收件人、主题和刚写的正文。
 */
export function buildFeedbackLetter(bodyText: string): string {
  const trimmedBody = bodyText.trim();
  return `收件人：${FEEDBACK_MAILBOX}\n主题：${FEEDBACK_SUBJECT}\n\n${trimmedBody}`;
}

/**
 * 打开对应网页邮箱。
 * Gmail 和 Outlook 网页版会带上收件人与主题；163 和 QQ 只打开邮箱首页，正文靠剪贴板粘贴。
 */
export function buildFeedbackWebmailUrl(webmailKind: FeedbackWebmailKind): string {
  const encodedMailbox = encodeURIComponent(FEEDBACK_MAILBOX);
  const encodedSubject = encodeURIComponent(FEEDBACK_SUBJECT);
  if (webmailKind === 'gmail') {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedMailbox}&su=${encodedSubject}`;
  }
  if (webmailKind === 'outlook') {
    return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodedMailbox}&subject=${encodedSubject}`;
  }
  if (webmailKind === 'qq') {
    return 'https://mail.qq.com/';
  }
  return 'https://mail.163.com/';
}

/**
 * 把反馈信写入剪贴板。扩展页是安全上下文，使用 Clipboard API。
 */
export async function copyFeedbackLetter(bodyText: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(buildFeedbackLetter(bodyText));
    return true;
  } catch {
    return false;
  }
}

/**
 * 在新标签打开选中的网页邮箱，侧栏本身留在原地。
 */
export function openFeedbackWebmail(webmailKind: FeedbackWebmailKind): void {
  void chrome.tabs.create({ url: buildFeedbackWebmailUrl(webmailKind) });
}

/**
 * 挂上侧栏和档案页底部的意见反馈：展开输入框、复制整封信、再选网页邮箱。
 * 不使用 mailto，因此不会弹出 Windows 的「选择应用」窗口。
 */
export function mountFeedbackPanel(): void {
  const toggleButton = document.getElementById('feedbackToggleButton');
  const composerElement = document.getElementById('feedbackComposer');
  const bodyInput = document.getElementById('feedbackBodyInput');
  const copyButton = document.getElementById('feedbackCopyButton');
  const mailboxRow = document.getElementById('feedbackMailboxRow');
  const resultElement = document.getElementById('feedbackResult');
  const fallbackLetter = document.getElementById('feedbackFallbackLetter');
  if (
    !(toggleButton instanceof HTMLButtonElement) ||
    !(composerElement instanceof HTMLElement) ||
    !(bodyInput instanceof HTMLTextAreaElement) ||
    !(copyButton instanceof HTMLButtonElement) ||
    !(mailboxRow instanceof HTMLElement) ||
    !(resultElement instanceof HTMLElement) ||
    !(fallbackLetter instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  /**
   * 在反馈区显示绿框或红框说明。
   */
  const showFeedbackResult = (message: string, succeeded: boolean): void => {
    resultElement.hidden = false;
    resultElement.textContent = message;
    resultElement.classList.toggle('is-ok', succeeded);
    resultElement.classList.toggle('is-bad', !succeeded);
  };

  toggleButton.addEventListener('click', () => {
    const opening = composerElement.hidden;
    composerElement.hidden = !opening;
    toggleButton.textContent = opening ? '收起反馈' : '意见反馈';
    if (opening) {
      bodyInput.focus();
    }
  });

  copyButton.addEventListener('click', () => {
    void (async () => {
      const bodyText = bodyInput.value.trim();
      if (!bodyText) {
        fallbackLetter.hidden = true;
        showFeedbackResult('请先写下问题和所在页面，再复制。', false);
        return;
      }
      const copied = await copyFeedbackLetter(bodyText);
      mailboxRow.hidden = false;
      if (!copied) {
        fallbackLetter.hidden = false;
        fallbackLetter.value = buildFeedbackLetter(bodyText);
        showFeedbackResult(
          '自动复制没有成功。请手动复制下面这段，再选择网页邮箱粘贴发送。',
          false,
        );
        return;
      }
      fallbackLetter.hidden = true;
      showFeedbackResult(
        `已复制。收件人 ${FEEDBACK_MAILBOX}，主题「${FEEDBACK_SUBJECT}」。请选择下面的网页邮箱：Gmail 和 Outlook 会带上收件人与主题，打开后粘贴正文再发送；163 和 QQ 请在写信页粘贴整段已复制内容。`,
        true,
      );
    })();
  });

  mailboxRow.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const webmailKind = target.dataset.webmail;
    if (
      webmailKind !== 'netease163' &&
      webmailKind !== 'qq' &&
      webmailKind !== 'gmail' &&
      webmailKind !== 'outlook'
    ) {
      return;
    }
    const bodyText = bodyInput.value.trim();
    if (!bodyText) {
      showFeedbackResult('请先写下问题和所在页面。', false);
      return;
    }
    void copyFeedbackLetter(bodyText).then((copied) => {
      if (copied) {
        fallbackLetter.hidden = true;
      } else {
        fallbackLetter.hidden = false;
        fallbackLetter.value = buildFeedbackLetter(bodyText);
      }
      openFeedbackWebmail(webmailKind);
    });
  });
}
