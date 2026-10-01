/**
 * 页内截图 OCR（P4b）：把 Background 传来的可见区 dataURL 识成文字。
 * 复用简历 OCR 工人（tesseract 资源已在扩展包内）。
 */
import { recognizeCanvasText } from '../../shared/resume/resumeOcr';

/**
 * 将 image/png|jpeg dataURL 画到临时 canvas 后做中英识字。
 */
export async function recognizePageImageDataUrl(
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

  const text = await recognizeCanvasText(canvas);
  return text.trim();
}
