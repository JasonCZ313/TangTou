/**
 * 从 txt / docx / PDF 抽出纯文本，供简历识别。
 * PDF 按行、按栏还原；几乎没有文字的页改由本机识字。
 */
import JSZip from 'jszip';
import { recognizeCanvasText } from './resumeOcr';

const MAX_RESUME_TEXT_CHARS = 24000;
/** 少于此字数视为扫描页，改走本机识字 */
const SPARSE_PAGE_CHAR_LIMIT = 30;
/** 最多识字页数，避免超长扫描件把页面卡死 */
const MAX_OCR_PAGES = 8;

/** 抽取过程回调：percent 为 0–100，label 给进度条 */
export type ResumeExtractProgress = (update: {
  percent: number;
  label: string;
}) => void;

interface PositionedGlyph {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * 按文件名与 MIME 抽取简历文字。
 * onProgress 用于界面进度；没有文字层时会本机识字。
 */
export async function extractResumeText(
  fileName: string,
  mimeType: string,
  buffer: ArrayBuffer,
  onProgress?: ResumeExtractProgress,
): Promise<string> {
  const lowerName = fileName.toLowerCase();
  let rawText = '';
  if (lowerName.endsWith('.txt') || mimeType.startsWith('text/')) {
    onProgress?.({ percent: 40, label: '读取文本…' });
    rawText = new TextDecoder('utf-8').decode(buffer);
  } else if (
    lowerName.endsWith('.docx') ||
    mimeType.includes('wordprocessingml')
  ) {
    onProgress?.({ percent: 30, label: '读取 DOCX 正文…' });
    rawText = await extractDocxText(buffer);
  } else if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') {
    rawText = await extractPdfText(buffer, onProgress);
  } else {
    throw new Error('简历请上传 PDF、DOCX 或 TXT。');
  }
  const compact = rawText.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!compact) {
    throw new Error(
      '没有抽出文字。这份更像扫描件或图片，本机识字也没读出来。请换成带文字的 PDF 或 DOCX。',
    );
  }
  onProgress?.({ percent: 100, label: '文字已抽出' });
  return compact.slice(0, MAX_RESUME_TEXT_CHARS);
}

/**
 * 从 docx 的 word/document.xml 取出段落文字。
 */
async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('DOCX 里没有正文。请确认文件没有损坏。');
  }
  const xml = await documentFile.async('string');
  const withBreaks = xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:tab\/>/g, '\t');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return decodeXmlEntities(stripped);
}

/**
 * 把 PDF.js 打开失败收成能对上原因的一句中文。
 * 扩展里读不了，不等于这份文件在别的网页也打不开。
 */
function describePdfOpenError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/password/i.test(message)) {
    return '这份 PDF 有打开密码。去掉密码后再上传。';
  }
  if (/Invalid PDF|InvalidPDF|xref|structure/i.test(message)) {
    return '文件内容不像一份完整 PDF。请重新导出后再上传。';
  }
  if (/worker|fake worker|dynamically imported|Failed to fetch|import/i.test(message)) {
    return '阅读组件没载入。重新加载扩展后再试。';
  }
  return '这份 PDF 暂时读不开。重新加载扩展后再试；若仍失败，请重新导出一份。';
}

/**
 * 用 PDF.js 按坐标还原每页文字；过稀的页渲染后本机识字。
 */
async function extractPdfText(
  buffer: ArrayBuffer,
  onProgress?: ResumeExtractProgress,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    '/pdfjs/pdf.worker.min.js',
  );
  let documentProxy;
  try {
    const pdfBytes = new Uint8Array(buffer.slice(0));
    const loadingTask = pdfjs.getDocument({
      data: pdfBytes,
      cMapUrl: chrome.runtime.getURL('/pdfjs/cmaps/'),
      cMapPacked: true,
    });
    documentProxy = await loadingTask.promise;
  } catch (error: unknown) {
    throw new Error(describePdfOpenError(error));
  }

  const pageTexts: string[] = [];
  let ocrPageCount = 0;
  const pageTotal = documentProxy.numPages;
  for (let pageNumber = 1; pageNumber <= pageTotal; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const glyphs = collectGlyphs(textContent.items);
    const laidOut = layoutGlyphs(glyphs);
    const visibleLength = laidOut.replace(/\s/g, '').length;
    const pagePercent = Math.round((pageNumber / pageTotal) * 90);

    if (visibleLength >= SPARSE_PAGE_CHAR_LIMIT) {
      onProgress?.({
        percent: pagePercent,
        label: `正在读取第 ${pageNumber}/${pageTotal} 页文字…`,
      });
      pageTexts.push(laidOut);
      continue;
    }

    if (ocrPageCount >= MAX_OCR_PAGES) {
      onProgress?.({
        percent: pagePercent,
        label: `第 ${pageNumber} 页字太少，已超过识字页数上限，先用已读到的内容。`,
      });
      if (laidOut) {
        pageTexts.push(laidOut);
      }
      continue;
    }

    ocrPageCount += 1;
    onProgress?.({
      percent: pagePercent,
      label: `第 ${pageNumber}/${pageTotal} 页几乎没有文字，正在本机识字…`,
    });
    try {
      const pageCanvas = await renderPageCanvas(page);
      const ocrText = await recognizeCanvasText(pageCanvas);
      pageTexts.push(ocrText || laidOut);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : '';
      if (/fetch|network|worker|tesseract|Failed to load/i.test(reason)) {
        throw new Error(
          '本机识字没准备好（词库需要联网下载一次）。请联网后重试；或改用 DOCX。',
        );
      }
      if (laidOut) {
        pageTexts.push(laidOut);
      }
    }
  }
  return pageTexts.join('\n\n');
}

/**
 * 把 PDF.js 文字项收成带坐标的字形，忽略没有字符串的标记。
 */
function collectGlyphs(items: unknown[]): PositionedGlyph[] {
  const glyphs: PositionedGlyph[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as {
      str?: unknown;
      transform?: unknown;
      width?: unknown;
    };
    if (typeof record.str !== 'string' || !Array.isArray(record.transform)) {
      continue;
    }
    const transform = record.transform;
    if (typeof transform[4] !== 'number' || typeof transform[5] !== 'number') {
      continue;
    }
    glyphs.push({
      text: record.str,
      x: transform[4],
      y: transform[5],
      width: typeof record.width === 'number' ? record.width : record.str.length * 6,
    });
  }
  return glyphs;
}

/**
 * 按纵坐标分行、横坐标排序，大空隙视为分栏。
 */
function layoutGlyphs(glyphs: PositionedGlyph[]): string {
  if (glyphs.length === 0) {
    return '';
  }
  const sorted = [...glyphs].sort(
    (left, right) => right.y - left.y || left.x - right.x,
  );
  const lines: PositionedGlyph[][] = [];
  for (const glyph of sorted) {
    const currentLine = lines[lines.length - 1];
    if (!currentLine || Math.abs(glyph.y - currentLine[0].y) > 4) {
      lines.push([glyph]);
      continue;
    }
    currentLine.push(glyph);
  }
  return lines
    .map((line) => joinLine(line))
    .filter((lineText) => lineText.length > 0)
    .join('\n');
}

/**
 * 同一行从左到右拼接；间距大时插入空格或制表，避免两栏粘在一起。
 */
function joinLine(line: PositionedGlyph[]): string {
  const ordered = [...line].sort((left, right) => left.x - right.x);
  let lineText = '';
  let previousEnd = ordered[0].x;
  for (const glyph of ordered) {
    const gap = glyph.x - previousEnd;
    if (lineText && gap > 14) {
      lineText += gap > 36 ? '\t' : ' ';
    }
    lineText += glyph.text;
    previousEnd = Math.max(previousEnd, glyph.x + glyph.width);
  }
  return lineText.trim();
}

/**
 * 把一页 PDF 画到画布上，供识字。宽度限制在 1800 像素内。
 */
async function renderPageCanvas(
  page: {
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<void> };
  },
): Promise<HTMLCanvasElement> {
  const unitViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1800 / Math.max(unitViewport.width, 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('无法准备识字画布');
  }
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

/**
 * 还原 docx XML 里的常见实体。
 */
function decodeXmlEntities(xmlText: string): string {
  return xmlText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
