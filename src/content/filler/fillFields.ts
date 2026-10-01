/**
 * 页面写入入口：确认填写后，严格按预览计划（FillPlan）逐格写入。
 * 预览里改过的值就是最终写入值；不再忽略 plan 去跑 Chao 边扫边写。
 * 附件仍按 plan 中的 attachmentId 或档案附件库落到 file 控件。
 */
import type { FillMiss, FillPlan, SectionAddRequest } from '../../shared/types/fill';
import type { ProfileData } from '../../shared/types/profile';
import type { FileUploadPayload } from '../../shared/types/messages';
import { prepareFieldForWrite } from '../scanner/scanFields';
import { ensureSectionRows } from './ensureSectionRows';
import {
  AUTOFILL_FILL_CLASS,
  AUTOFILL_MISS_CLASS,
  classifyControl,
  ensureHighlightStyles,
  fieldLabelBlob,
  writeField,
} from './chao/dom';

/** 撤销快照：写入前控件原值，方便 undoLastFill 还原 */
let lastUndoSnapshots: Array<{ element: Element; previousValue: string; isFile: boolean }> =
  [];

/**
 * 给用户看的字段名：优先 DOM 上的 data-raf-label，其次短 fieldId，绝不拿 mapping reason 当标签。
 */
function resolveMissLabel(fieldId: string, fallbackElement?: Element | null): string {
  if (fallbackElement instanceof HTMLElement) {
    const fromElement =
      fallbackElement.getAttribute('data-raf-label') || fieldLabelBlob(fallbackElement);
    if (fromElement.trim()) {
      return fromElement.trim();
    }
  }
  try {
    const registered = document.querySelector(
      `[data-raf-id="${CSS.escape(fieldId)}"]`,
    );
    if (registered instanceof HTMLElement) {
      const fromDom =
        registered.getAttribute('data-raf-label') || fieldLabelBlob(registered);
      if (fromDom.trim()) {
        return fromDom.trim();
      }
    }
  } catch {
    /* 非法 fieldId 时忽略选择器错误 */
  }
  // UUID 太长吓人：只露前 8 位作兜底
  if (fieldId.length > 16) {
    return `字段 ${fieldId.slice(0, 8)}…`;
  }
  return fieldId;
}

/**
 * 读控件当前值，供写入前记快照。
 */
function readElementValue(element: Element): string {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'true' : 'false';
    }
    if (element.type === 'file') {
      return element.files?.[0]?.name ?? '';
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return element.textContent ?? '';
  }
  return '';
}

/**
 * 把值写回普通控件（撤销用）；file 控件只能清空并派发 change（浏览器无法恢复原文件）。
 */
function restoreElementValue(element: Element, previousValue: string): boolean {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.checked = previousValue === 'true';
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    element.textContent = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * 在写入前，给即将动到的控件打撤销快照（可追加到已有快照，附件写入前会再调一次）。
 */
function captureUndoSnapshotsForElements(
  elements: Element[],
  append = false,
): void {
  if (!append) {
    lastUndoSnapshots = [];
  }
  const seen = new WeakSet<Element>();
  for (const snapshot of lastUndoSnapshots) {
    seen.add(snapshot.element);
  }
  for (const node of elements) {
    if (!(node instanceof HTMLElement) || seen.has(node)) {
      continue;
    }
    seen.add(node);
    const isFile = node instanceof HTMLInputElement && node.type === 'file';
    lastUndoSnapshots.push({
      element: node,
      previousValue: readElementValue(node),
      isFile,
    });
  }
}

/**
 * 把 Base64 文件写入原生 file 控件。
 */
function assignFilePayload(
  inputElement: HTMLInputElement,
  payload: FileUploadPayload,
): boolean {
  try {
    const binaryText = atob(payload.dataBase64);
    const bytes = new Uint8Array(binaryText.length);
    for (let index = 0; index < binaryText.length; index += 1) {
      bytes[index] = binaryText.charCodeAt(index);
    }
    const file = new File([bytes], payload.fileName, {
      type: payload.mimeType || 'application/octet-stream',
    });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputElement.files = dataTransfer.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return inputElement.files.length > 0;
  } catch {
    return false;
  }
}

/**
 * 收集 file 控件附近文案，用来判断是简历还是头像。
 */
function fileInputHint(inputElement: HTMLInputElement): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length <= 80) {
      parts.push(text);
    }
  };
  push(inputElement.getAttribute('aria-label'));
  push(inputElement.getAttribute('name'));
  push(inputElement.id);
  push(inputElement.closest('label')?.textContent);
  if (inputElement.id) {
    try {
      push(document.querySelector(`label[for="${CSS.escape(inputElement.id)}"]`)?.textContent);
    } catch {
      /* 忽略非法 id */
    }
  }
  let host: HTMLElement | null = inputElement.parentElement;
  for (let depth = 0; host && depth < 3; depth += 1, host = host.parentElement) {
    push(host.querySelector(':scope > label')?.textContent);
  }
  return parts.join(' ').toLowerCase();
}

/**
 * 按文案把档案附件落到页面 file 控件。
 * 写入前把目标 file 框追加进撤销快照，撤销时只能清空（清除本轮上传）。
 */
function applyFilePayloads(filePayloads: FileUploadPayload[]): {
  filled: number;
  misses: FillMiss[];
} {
  if (!filePayloads.length) {
    return { filled: 0, misses: [] };
  }
  let filled = 0;
  const misses: FillMiss[] = [];
  const fileInputs = [
    ...document.querySelectorAll('input[type="file"]'),
  ].filter((node): node is HTMLInputElement => {
    if (!(node instanceof HTMLInputElement)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  for (const payload of filePayloads) {
    const byField = document.querySelector(
      `[data-raf-id="${CSS.escape(payload.fieldId)}"]`,
    );
    let matched: HTMLInputElement | undefined =
      byField instanceof HTMLInputElement && byField.type === 'file'
        ? byField
        : undefined;

    if (!matched) {
      const hintPreferred =
        /头像|照片|证件照|avatar|photo|portrait|image/.test(
          `${payload.fileName} ${payload.mimeType}`.toLowerCase(),
        );
      matched =
        fileInputs.find((inputElement) => {
          const hint = fileInputHint(inputElement);
          if (hintPreferred) {
            return /头像|照片|证件照|avatar|photo|portrait|image/.test(hint);
          }
          return (
            /简历|附件|上传|文件|resume|cv|pdf|portfolio|作品/.test(hint) ||
            hint.length > 0
          );
        }) || fileInputs[0];
    }

    if (!matched) {
      misses.push({
        label: payload.fileName || '附件',
        reason: '页面上没有找到可写入的文件上传框',
      });
      continue;
    }
    // 写入前入快照，撤销=清空本轮上传
    captureUndoSnapshotsForElements([matched], true);
    if (assignFilePayload(matched, payload)) {
      filled += 1;
      matched.classList.add(AUTOFILL_FILL_CLASS);
    } else {
      misses.push({
        label: payload.fileName || '附件',
        reason: '文件写入失败',
      });
    }
  }
  return { filled, misses };
}

/**
 * 确认写入：严格按用户确认后的 FillPlan 逐格写入并回读。
 * 写入前可按 sectionAdds 兜底补行（不偷偷填值）；正文只来自 plan。
 * 写入过程更新页内浮层进度，并响应停止请求。
 */
export async function applyFillPlan(
  plan: FillPlan,
  filePayloads: FileUploadPayload[] = [],
  _profileId?: string,
  sectionAdds: SectionAddRequest[] = [],
  _profileData?: ProfileData,
): Promise<{
  filled: number;
  skipped: number;
  misses: FillMiss[];
}> {
  ensureHighlightStyles();
  const { updatePageOverlay, hidePageOverlay } = await import('../ui/pageOverlay');
  const { shouldFillStop } = await import('../fillAbort');

  // 兜底：预览期间若用户删了行，再补一次；新框无 plan 项则不会被填
  if (sectionAdds.length > 0) {
    updatePageOverlay({
      percent: 4,
      message: '正在按档案补齐分区行数…',
      showCancel: true,
    });
    await ensureSectionRows(sectionAdds);
  }

  const writableItems = plan.items.filter(
    (item) => item.value.trim().length > 0 || item.attachmentId,
  );
  if (writableItems.length === 0 && filePayloads.length === 0) {
    hidePageOverlay();
    return {
      filled: 0,
      skipped: plan.skippedFieldIds.length,
      misses: [
        {
          label: '预览计划',
          reason: '没有可写入的项。请先扫描本页并核对映射表后再点确认写入。',
        },
      ],
    };
  }

  const preparedElements: Element[] = [];
  for (const item of writableItems) {
    if (item.attachmentId) {
      continue;
    }
    const element = await prepareFieldForWrite(item.fieldId);
    if (element) {
      preparedElements.push(element);
    }
  }
  captureUndoSnapshotsForElements(preparedElements);

  let filled = 0;
  const misses: FillMiss[] = [];
  const totalWriteSteps = Math.max(
    writableItems.filter((item) => !item.attachmentId).length,
    1,
  );
  let writeStepIndex = 0;

  for (const item of writableItems) {
    if (shouldFillStop()) {
      misses.push({
        label: '用户停止',
        reason: '已按停止请求中断写入',
      });
      break;
    }
    if (item.attachmentId) {
      continue;
    }
    writeStepIndex += 1;
    const element = await prepareFieldForWrite(item.fieldId);
    const labelText = resolveMissLabel(item.fieldId, element);
    updatePageOverlay({
      percent: Math.min(92, Math.round((writeStepIndex / totalWriteSteps) * 90) + 5),
      message: `正在写入：${labelText}`,
      highlightFieldIds: [item.fieldId],
      showCancel: true,
    });
    if (!(element instanceof HTMLElement)) {
      misses.push({
        label: resolveMissLabel(item.fieldId),
        reason: '页面上找不到这个输入框（可能已收起或刷新）',
      });
      continue;
    }
    const writeResult = await writeField(
      {
        el: element,
        blob: labelText,
        control: classifyControl(element),
      },
      item.value,
    );
    if (writeResult.ok) {
      filled += 1;
      element.classList.add(AUTOFILL_FILL_CLASS);
      element.classList.remove(AUTOFILL_MISS_CLASS);
    } else {
      misses.push({
        label: labelText,
        reason: writeResult.reason || '写入失败',
      });
      element.classList.add(AUTOFILL_MISS_CLASS);
    }
  }

  if (!shouldFillStop()) {
    updatePageOverlay({
      percent: 96,
      message: '正在处理附件上传…',
      showCancel: true,
    });
  }
  const fileResult = applyFilePayloads(filePayloads);
  updatePageOverlay({
    percent: 100,
    message: shouldFillStop()
      ? '已停止写入'
      : `写入完成：成功 ${filled + fileResult.filled} 项`,
    showCancel: false,
  });
  // 稍留可见结果后收起，避免挡页面
  window.setTimeout(() => {
    hidePageOverlay();
  }, 1600);

  return {
    filled: filled + fileResult.filled,
    skipped: plan.skippedFieldIds.length,
    misses: [...misses, ...fileResult.misses],
  };
}

/**
 * 撤销上一轮：普通控件还原快照；file 只能清空（清除本轮上传）。
 */
export function undoLastFill(): { restored: number; clearedFiles: number } {
  let restored = 0;
  let clearedFiles = 0;
  for (const snapshot of lastUndoSnapshots) {
    if (!document.contains(snapshot.element)) {
      continue;
    }
    if (restoreElementValue(snapshot.element, snapshot.previousValue)) {
      snapshot.element.classList.remove(AUTOFILL_FILL_CLASS, AUTOFILL_MISS_CLASS);
      if (snapshot.isFile) {
        clearedFiles += 1;
      } else {
        restored += 1;
      }
    }
  }
  lastUndoSnapshots = [];
  return { restored, clearedFiles };
}
