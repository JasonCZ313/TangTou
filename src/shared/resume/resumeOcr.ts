/**
 * 本机识字：给几乎没有文字层的简历页、以及 Offscreen 截图 OCR（P4b）用。
 *
 * 引擎 / 核心 / 中英词库均放在扩展包内（public/tesseract）。
 * Worker 只能在扩展同源上下文创建（Options 页、Offscreen），
 * 禁止在内容脚本里 createWorker（可搜索：页内不得 createWorker）。
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
      // 词库打进扩展包，避免首次 OCR 再拉 CDN（可搜索：tesseract langPath）
      langPath: chrome.runtime.getURL('/tesseract/lang/'),
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

/**
 * 将 image/png|jpeg dataURL 画到临时 canvas 后做中英识字。
 * Offscreen / Options 等扩展同源页可直接调用；内容脚本禁止走此路径起 Worker。
 */
export async function recognizeImageDataUrl(
  imageDataUrl: string,
): Promise<string> {
  const trimmed = imageDataUrl.trim();
  if (!trimmed.startsWith('data:image/')) {
    throw new Error('截图数据无效');
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('截图无法解码'));
    element.src = trimmed;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法创建识字画布');
  }
  context.drawImage(image, 0, 0);

  return recognizeCanvasText(canvas);
}
