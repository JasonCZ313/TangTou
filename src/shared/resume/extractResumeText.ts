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
  /** 字高，用来判断同一行和段间距，不用固定像素 */
  height: number;
  /** PDF 内容流标记这一项已经到行尾 */
  hasEndOfLine: boolean;
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
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:cr[^>]*\/>/g, '\n')
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
      height?: unknown;
      hasEOL?: unknown;
    };
    if (typeof record.str !== 'string' || !Array.isArray(record.transform)) {
      continue;
    }
    const transform = record.transform;
    if (typeof transform[4] !== 'number' || typeof transform[5] !== 'number') {
      continue;
    }
    const verticalScale = typeof transform[3] === 'number' ? Math.abs(transform[3]) : 0;
    const horizontalScale = typeof transform[0] === 'number' ? Math.abs(transform[0]) : 0;
    const reportedHeight = typeof record.height === 'number' ? record.height : 0;
    const height = reportedHeight || verticalScale || horizontalScale || 10;
    glyphs.push({
      text: record.str,
      x: transform[4],
      y: transform[5],
      width: typeof record.width === 'number' ? record.width : record.str.length * height * 0.6,
      height,
      hasEndOfLine: record.hasEOL === true,
    });
  }
  return glyphs;
}

/** 行首像新要点：圆点、短横、序号、中文序号 */
const NEW_POINT_PATTERN =
  /^(?:[•●○▪◦·]\s*|[-–—*]\s+|\d{1,2}[.、．)]\s*|[（(]\d{1,2}[）)]\s*|[一二三四五六七八九十]{1,3}[、.])/;

/**
 * 这一行是不是新的一条，而不是上一句在栏宽处折下来的后半句。
 */
function isNewPoint(lineText: string): boolean {
  return NEW_POINT_PATTERN.test(lineText.trim());
}

/**
 * 上一行已经收束，下一行应另起，而不是接在句中。
 */
function endsSentence(lineText: string): boolean {
  return /[。！？；;.!?]$/.test(lineText.trim());
}

/**
 * 折行接回同一条。中文直接相连，英文单词之间补一个空格。
 */
function joinWrappedLine(previousText: string, nextText: string): string {
  const leftText = previousText.trimEnd();
  const rightText = nextText.trimStart();
  if (/[A-Za-z0-9]$/.test(leftText) && /^[A-Za-z0-9]/.test(rightText)) {
    return `${leftText} ${rightText}`;
  }
  return `${leftText}${rightText}`;
}

/**
 * 页中间有一条竖向空白时，按左栏再右栏阅读。单栏简历不拆。
 */
function splitIntoColumns(glyphs: PositionedGlyph[]): PositionedGlyph[][] {
  if (glyphs.length < 8) {
    return [glyphs];
  }
  const minX = Math.min(...glyphs.map((glyph) => glyph.x));
  const maxX = Math.max(...glyphs.map((glyph) => glyph.x + glyph.width));
  const pageWidth = maxX - minX;
  if (pageWidth < 280) {
    return [glyphs];
  }
  const bandStart = minX + pageWidth * 0.3;
  const bandEnd = minX + pageWidth * 0.7;
  const bucketWidth = 8;
  let bestGapStart = -1;
  let bestGapWidth = 0;
  let runStart = -1;
  for (let cursorX = bandStart; cursorX < bandEnd; cursorX += bucketWidth) {
    const occupied = glyphs.some(
      (glyph) => glyph.x < cursorX + bucketWidth && glyph.x + glyph.width > cursorX,
    );
    if (!occupied) {
      if (runStart < 0) {
        runStart = cursorX;
      }
      continue;
    }
    if (runStart >= 0) {
      const runWidth = cursorX - runStart;
      if (runWidth > bestGapWidth) {
        bestGapWidth = runWidth;
        bestGapStart = runStart;
      }
      runStart = -1;
    }
  }
  if (bestGapWidth < 28 || bestGapStart < 0) {
    return [glyphs];
  }
  const splitX = bestGapStart + bestGapWidth / 2;
  const leftColumn = glyphs.filter((glyph) => glyph.x + glyph.width / 2 < splitX);
  const rightColumn = glyphs.filter((glyph) => glyph.x + glyph.width / 2 >= splitX);
  if (leftColumn.length < 4 || rightColumn.length < 4) {
    return [glyphs];
  }
  return [leftColumn, rightColumn];
}

/**
 * 纵坐标接近的字形合成一行。阈值是字高的一半，避免固定像素把折行和换行混在一起。
 */
function groupGlyphsIntoLines(glyphs: PositionedGlyph[]): PositionedGlyph[][] {
  const sorted = [...glyphs].sort(
    (left, right) => right.y - left.y || left.x - right.x,
  );
  const lines: PositionedGlyph[][] = [];
  for (const glyph of sorted) {
    const currentLine = lines[lines.length - 1];
    const anchor = currentLine?.[0];
    const lineHeight = anchor
      ? Math.max(anchor.height, glyph.height, 8)
      : glyph.height;
    const sameLineThreshold = Math.max(2, lineHeight * 0.5);
    const lineAlreadyEnded = currentLine?.some((item) => item.hasEndOfLine) ?? false;
    const wrappedToNextLine = Boolean(
      anchor && lineAlreadyEnded && glyph.x + glyph.width < anchor.x,
    );
    if (!anchor || Math.abs(glyph.y - anchor.y) > sameLineThreshold || wrappedToNextLine) {
      lines.push([glyph]);
      continue;
    }
    currentLine.push(glyph);
  }
  return lines;
}

/**
 * 把一栏里的视觉行收成要点：折行接上，新要点、大段距、句末另起一行。
 */
function layoutColumn(glyphs: PositionedGlyph[]): string {
  const lines = groupGlyphsIntoLines(glyphs);
  const lineTexts = lines
    .map((line) => ({
      text: joinLine(line),
      y: line[0]?.y ?? 0,
      height: Math.max(...line.map((glyph) => glyph.height), 10),
    }))
    .filter((line) => line.text.length > 0);
  if (lineTexts.length === 0) {
    return '';
  }
  const blocks: string[] = [];
  let currentBlock = lineTexts[0].text;
  for (let lineIndex = 1; lineIndex < lineTexts.length; lineIndex += 1) {
    const previousLine = lineTexts[lineIndex - 1];
    const nextLine = lineTexts[lineIndex];
    const lineGap = previousLine.y - nextLine.y;
    const lineHeight = Math.max(previousLine.height, nextLine.height, 8);
    const startsNewPoint = isNewPoint(nextLine.text);
    const paragraphGap = lineGap > lineHeight * 1.6;
    const previousEnded = endsSentence(currentBlock);
    if (startsNewPoint || paragraphGap || previousEnded) {
      blocks.push(currentBlock);
      currentBlock = nextLine.text;
      continue;
    }
    currentBlock = joinWrappedLine(currentBlock, nextLine.text);
  }
  blocks.push(currentBlock);
  return blocks.join('\n');
}

/**
 * 按栏阅读后还原一页。单栏直接排；双栏先左后右。
 */
function layoutGlyphs(glyphs: PositionedGlyph[]): string {
  if (glyphs.length === 0) {
    return '';
  }
  return splitIntoColumns(glyphs)
    .map((column) => layoutColumn(column))
    .filter((columnText) => columnText.length > 0)
    .join('\n\n');
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
