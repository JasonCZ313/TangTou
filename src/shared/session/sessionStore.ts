/**
 * 填写会话的 session 存储读写。
 * 侧栏预览与确认写入共用，避免「预览一套、写入另一套」。
 */
import {
  FILL_SESSION_STORAGE_KEY,
  parseFillSession,
  type FillSession,
} from './types';

/**
 * 读取当前填写会话；没有或损坏时返回 null。
 */
export async function loadFillSession(): Promise<FillSession | null> {
  const snapshot = await chrome.storage.session.get(FILL_SESSION_STORAGE_KEY);
  return parseFillSession(snapshot[FILL_SESSION_STORAGE_KEY]);
}

/**
 * 写入或覆盖当前填写会话。
 */
export async function saveFillSession(session: FillSession): Promise<void> {
  await chrome.storage.session.set({ [FILL_SESSION_STORAGE_KEY]: session });
}

/**
 * 清除当前填写会话（扫描失败、写完或用户放弃时）。
 */
export async function clearFillSession(): Promise<void> {
  await chrome.storage.session.remove(FILL_SESSION_STORAGE_KEY);
}
