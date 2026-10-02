/**
 * P4b：Background ↔ Offscreen 截图 OCR 通信桥。
 *
 * 重要约束（可搜索：OFFSCREEN_OCR / 页内不得 createWorker）：
 * - 禁止在内容脚本 / 网申页源上 new Worker(chrome-extension://…/tesseract/…)，
 *   否则会报 Failed to construct 'Worker' … cannot be accessed from origin。
 * - 识字必须在扩展同源的 Offscreen 文档内跑（与 Laya ORT 共用同一离屏页）。
 */
import { ensureLayaOffscreenDocument } from '../decision/layaOffscreenBridge';

/** 发给 Offscreen 的截图识字请求类型 */
export const OFFSCREEN_OCR = 'OFFSCREEN_OCR' as const;

/** Offscreen 识字回执类型 */
export const OFFSCREEN_OCR_RESULT = 'OFFSCREEN_OCR_RESULT' as const;

/** 单次 OCR 最长等待（含首次加载词库）；超时视为软失败 */
const OFFSCREEN_OCR_TIMEOUT_MS = 45_000;

/**
 * Offscreen OCR 成功或软失败结果。
 * ok=false 时 text 为空，notice 供侧栏软提示（不挡对照主路径）。
 */
export type OffscreenOcrOutcome = {
  ok: boolean;
  text: string;
  notice?: string;
};

/**
 * 在 Offscreen 内对可见区截图 dataURL 做本机识字。
 * Offscreen 不可用 / 超时 / 抛错 → 返回软失败，不抛给调用方。
 */
export async function tryOffscreenOcr(
  imageDataUrl: string,
): Promise<OffscreenOcrOutcome> {
  const trimmed = imageDataUrl.trim();
  if (!trimmed.startsWith('data:image/')) {
    return {
      ok: false,
      text: '',
      notice: '截图识字跳过：截图数据无效',
    };
  }

  const ready = await ensureLayaOffscreenDocument();
  if (!ready) {
    return {
      ok: false,
      text: '',
      notice: '截图识字跳过：离屏识字环境不可用',
    };
  }

  const requestId = `offscreen-ocr-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve({
        ok: false,
        text: '',
        notice: '截图识字跳过：识字超时',
      });
    }, OFFSCREEN_OCR_TIMEOUT_MS);

    function onMessage(message: unknown): void {
      if (!message || typeof message !== 'object') {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record.type !== OFFSCREEN_OCR_RESULT) {
        return;
      }
      if (record.requestId !== requestId) {
        return;
      }
      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(onMessage);

      if (record.ok === true && typeof record.text === 'string') {
        resolve({
          ok: true,
          text: record.text,
        });
        return;
      }

      const reason =
        typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim()
          : '识字失败';
      resolve({
        ok: false,
        text: '',
        notice: `截图识字跳过：${reason}`,
      });
    }

    chrome.runtime.onMessage.addListener(onMessage);
    void chrome.runtime
      .sendMessage({
        type: OFFSCREEN_OCR,
        requestId,
        imageDataUrl: trimmed,
      })
      .catch(() => {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve({
          ok: false,
          text: '',
          notice: '截图识字跳过：无法联系离屏识字环境',
        });
      });
  });
}
