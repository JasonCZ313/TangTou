import type { ExtensionMessage } from '../types/messages';

/**
 * 生成消息配对用的 requestId（UUID）。
 * Popup / Options / Side Panel 发起请求时使用。
 */
export function createRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 向扩展 Background（或其他扩展页）发送 runtime 消息并等待响应。
 * 用于 GET_STATE、BUILD_FILL_PLAN、TEST_API、OPEN_SIDE_PANEL 等。
 */
export async function sendRuntimeMessage(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as ExtensionMessage | undefined;
  if (!response) {
    throw new Error('EMPTY_RUNTIME_RESPONSE');
  }
  return response;
}

/**
 * 向当前窗口活动标签页转发消息（SCAN_FIELDS / APPLY_FILL_PLAN / UNDO_LAST_FILL）。
 * 仅用于 content 脚本通道；调用方不得在 message 中放入 apiKey。
 */
export async function sendToActiveTab(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (activeTab?.id === undefined) {
    throw new Error('NO_ACTIVE_TAB');
  }

  const response = (await chrome.tabs.sendMessage(
    activeTab.id,
    message,
  )) as ExtensionMessage | undefined;

  if (!response) {
    throw new Error('EMPTY_TAB_RESPONSE');
  }
  return response;
}
