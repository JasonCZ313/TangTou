/**
 * Background ↔ Offscreen 的 Laya ORT 通信桥。
 * Offscreen 负责加载 onnxruntime-web；当前若会话/I/O 未就绪则返回 null，由 localEngine 回退。
 */
import type { DecisionBatchRequest, DecisionBatchResult } from './types';

/** Offscreen 文档在扩展内的路径（WXT unlisted page） */
export const LAYA_OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

/** 发给 Offscreen 的推理请求类型 */
export const LAYA_OFFSCREEN_DECIDE = 'LAYA_OFFSCREEN_DECIDE' as const;

/** Offscreen 回执类型 */
export const LAYA_OFFSCREEN_DECIDE_RESULT =
  'LAYA_OFFSCREEN_DECIDE_RESULT' as const;

/** 并发创建 Offscreen 时复用的 Promise，避免重复 createDocument */
let offscreenCreatingPromise: Promise<void> | null = null;

/**
 * 确保 Offscreen 文档已创建（Chrome MV3；仅 Chromium）。
 * 同一离屏页同时服务：Laya ORT 推理 + P4b 截图 OCR（Tesseract Worker）。
 * 页内内容脚本禁止自建 Tesseract Worker（可搜索：页内不得 createWorker / OFFSCREEN_OCR）。
 */
export async function ensureLayaOffscreenDocument(): Promise<boolean> {
  if (!chrome.offscreen) {
    return false;
  }

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) {
    return true;
  }

  if (!offscreenCreatingPromise) {
    offscreenCreatingPromise = chrome.offscreen
      .createDocument({
        url: LAYA_OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          '在离屏页加载 onnxruntime-web 与 Tesseract：本机 Laya 推理，以及对网申页截图做 OCR（避免在内容脚本创建 Worker）',
      })
      .then(() => undefined)
      .finally(() => {
        offscreenCreatingPromise = null;
      });
  }

  try {
    await offscreenCreatingPromise;
    return true;
  } catch {
    return false;
  }
}

/**
 * 尝试让 Offscreen 跑 ORT 批量决策。
 * 返回 null 表示 Offscreen/会话不可用，调用方应回退轻量判断。
 */
export async function tryOffscreenOrtDecide(
  request: DecisionBatchRequest,
): Promise<DecisionBatchResult | null> {
  const ready = await ensureLayaOffscreenDocument();
  if (!ready) {
    return null;
  }

  const requestId = `laya-ort-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve(null);
    }, 12_000);

    function onMessage(message: unknown): void {
      if (!message || typeof message !== 'object') {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record.type !== LAYA_OFFSCREEN_DECIDE_RESULT) {
        return;
      }
      if (record.requestId !== requestId) {
        return;
      }
      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(onMessage);
      if (record.ok === true && record.result && typeof record.result === 'object') {
        resolve(record.result as DecisionBatchResult);
        return;
      }
      resolve(null);
    }

    chrome.runtime.onMessage.addListener(onMessage);
    void chrome.runtime
      .sendMessage({
        type: LAYA_OFFSCREEN_DECIDE,
        requestId,
        batch: request,
      })
      .catch(() => {
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(null);
      });
  });
}
