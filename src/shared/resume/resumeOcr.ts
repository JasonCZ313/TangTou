/**
 * 本机识字：给几乎没有文字层的简历页用。
 * 引擎和核心放在扩展内；中英词库首次使用时下载并缓存。
 */
import { createWorker, type Worker as OcrWorker } from 'tesseract.js';

/** 复用同一个识字工人，避免每一页都重新加载词库 */
let ocrWorkerPromise: Promise<OcrWorker> | null = null;

/**
 * 启动（或复用）中文 + 英文识字工人。
 * 失败时清掉缓存，下次可以再试。
 */
function obtainOcrWorker(): Promise<OcrWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('chi_sim+eng', 1, {
      workerPath: chrome.runtime.getURL('/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('/tesseract/core/'),
      workerBlobURL: false,
    }).catch((error: unknown) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

/**
 * 识别一张简历页画布上的文字。画布由调用方按页渲染。
 */
export async function recognizeCanvasText(
  pageCanvas: HTMLCanvasElement,
): Promise<string> {
  const ocrWorker = await obtainOcrWorker();
  const recognized = await ocrWorker.recognize(pageCanvas);
  return (recognized.data.text ?? '').trim();
}
