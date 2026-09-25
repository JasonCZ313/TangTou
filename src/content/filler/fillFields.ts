import type { FillPlan } from '../../shared/types/fill';
import type { FileUploadPayload } from '../../shared/types/messages';
import { prepareFieldForWrite, resolveFieldElement } from '../scanner/scanFields';
import { setNativeValue } from './setNativeValue';

/** 已填写字段的视觉高亮 class，撤销时一并移除 */
const FILLED_HIGHLIGHT_CLASS = 'raf-filled-highlight';

/** 注入到页面的高亮样式标记，避免重复插入 style 节点 */
const HIGHLIGHT_STYLE_ATTRIBUTE = 'data-raf-filled-style';

/**
 * 上一轮填写的撤销快照：fieldId 与写入前的旧值。
 * 每次 applyFillPlan 会整体替换，undoLastFill 按此恢复。
 */
let lastUndoSnapshots: Array<{ fieldId: string; previousValue: string }> = [];

/**
 * 确保页面存在高亮样式；仅注入一次，便于用户识别本轮已填控件。
 */
function ensureHighlightStyles(): void {
  if (document.querySelector(`style[${HIGHLIGHT_STYLE_ATTRIBUTE}]`)) {
    return;
  }
  const styleElement = document.createElement('style');
  styleElement.setAttribute(HIGHLIGHT_STYLE_ATTRIBUTE, 'true');
  styleElement.textContent = `
.${FILLED_HIGHLIGHT_CLASS} {
  outline: 2px solid #2f6fed !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.2) !important;
}
`;
  document.documentElement.appendChild(styleElement);
}

/**
 * 读取元素当前值，供写入前记入撤销快照。
 */
function readElementValue(element: Element): string {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'true' : 'false';
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
 * 按文案或 value 匹配 select 选项并选中；匹配失败返回 false。
 */
function fillSelectElement(
  selectElement: HTMLSelectElement,
  nextValue: string,
): boolean {
  const normalizedTarget = nextValue.trim().toLowerCase();
  const matchedOption = Array.from(selectElement.options).find((optionElement) => {
    const optionValue = optionElement.value.trim().toLowerCase();
    const optionText = (optionElement.textContent ?? '').trim().toLowerCase();
    return optionValue === normalizedTarget || optionText === normalizedTarget;
  });
  if (!matchedOption) {
    return false;
  }
  selectElement.value = matchedOption.value;
  selectElement.dispatchEvent(new Event('input', { bubbles: true }));
  selectElement.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * 写入 contenteditable：设置 textContent 并派发 input/change，兼容部分富文本监听。
 */
function fillContentEditable(element: HTMLElement, nextValue: string): void {
  element.textContent = nextValue;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 判断字符串是否为「应勾选」的布尔真值语义（含 yes/on/1）。
 */
function isTruthyCheckToken(normalized: string): boolean {
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

/**
 * 判断字符串是否为「应取消勾选」的布尔假值语义（含 no/off/0）。
 * 撤销快照对 checkbox/radio 存 'true'/'false'，假值必须能可靠恢复为未选中。
 */
function isFalsyCheckToken(normalized: string): boolean {
  return (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'off'
  );
}

/**
 * 写入 checkbox / radio：按布尔语义或 value 匹配更新 checked，不触发提交。
 * radio 对显式 false 会取消选中，保证 undo 能恢复写入前的未选中状态。
 */
function fillCheckableInput(
  inputElement: HTMLInputElement,
  nextValue: string,
): boolean {
  const normalized = nextValue.trim().toLowerCase();
  if (inputElement.type === 'checkbox') {
    const shouldCheck =
      isTruthyCheckToken(normalized) ||
      normalized === inputElement.value.toLowerCase();
    inputElement.checked = shouldCheck;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (inputElement.type === 'radio') {
    // 显式布尔假值：恢复为未选中（撤销场景）；不依赖 value 匹配
    if (isFalsyCheckToken(normalized)) {
      inputElement.checked = false;
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      inputElement.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const shouldCheck =
      normalized === inputElement.value.toLowerCase() ||
      isTruthyCheckToken(normalized);
    if (!shouldCheck) {
      return false;
    }
    inputElement.checked = true;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return false;
}

/**
 * 对单个 DOM 元素执行安全写入；成功返回 true。
 * 禁止调用 form.submit() 或点击 submit 按钮。
 */
function writeValueToElement(element: Element, nextValue: string): boolean {
  if (element instanceof HTMLSelectElement) {
    return fillSelectElement(element, nextValue);
  }

  if (element instanceof HTMLTextAreaElement) {
    setNativeValue(element, nextValue);
    return true;
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'file') {
      return false;
    }
    if (element.type === 'checkbox' || element.type === 'radio') {
      return fillCheckableInput(element, nextValue);
    }
    setNativeValue(element, nextValue);
    return true;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    fillContentEditable(element, nextValue);
    return true;
  }

  return false;
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
 * 按 FillPlan 将映射值安全写入页面控件。
 * 写入前把控件滚进视野；若扫描时是点开才出现的，框被收起会再点一次。
 * file 控件只接受 filePayloads 中对应的本机附件。不提交表单。
 */
export async function applyFillPlan(
  plan: FillPlan,
  filePayloads: FileUploadPayload[] = [],
): Promise<{
  filled: number;
  skipped: number;
}> {
  ensureHighlightStyles();
  lastUndoSnapshots = [];

  let filled = 0;
  let skipped = plan.skippedFieldIds.length;

  for (const mappingItem of plan.items) {
    const targetElement = await prepareFieldForWrite(mappingItem.fieldId);
    if (!targetElement) {
      skipped += 1;
      continue;
    }

    if (
      targetElement instanceof HTMLInputElement &&
      targetElement.type === 'file'
    ) {
      const payload = filePayloads.find(
        (item) => item.fieldId === mappingItem.fieldId,
      );
      if (!payload || !assignFilePayload(targetElement, payload)) {
        skipped += 1;
        continue;
      }
      lastUndoSnapshots.push({
        fieldId: mappingItem.fieldId,
        previousValue: '',
      });
      targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
      filled += 1;
      continue;
    }

    const previousValue = readElementValue(targetElement);
    const writeSucceeded = writeValueToElement(
      targetElement,
      mappingItem.value,
    );
    if (!writeSucceeded) {
      skipped += 1;
      continue;
    }

    lastUndoSnapshots.push({
      fieldId: mappingItem.fieldId,
      previousValue,
    });
    targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
    filled += 1;
  }

  return { filled, skipped };
}

/**
 * 撤销时清空已写入的 file 控件（浏览器不允许恢复用户原先选的文件）。
 */
export function undoLastFill(): { restored: number } {
  let restored = 0;

  for (const snapshot of lastUndoSnapshots) {
    const targetElement = resolveFieldElement(snapshot.fieldId);
    if (!targetElement) {
      continue;
    }
    if (
      targetElement instanceof HTMLInputElement &&
      targetElement.type === 'file'
    ) {
      targetElement.value = '';
      targetElement.classList.remove(FILLED_HIGHLIGHT_CLASS);
      restored += 1;
      continue;
    }

    const writeSucceeded = writeValueToElement(
      targetElement,
      snapshot.previousValue,
    );
    if (!writeSucceeded) {
      continue;
    }

    targetElement.classList.remove(FILLED_HIGHLIGHT_CLASS);
    restored += 1;
  }

  lastUndoSnapshots = [];
  return { restored };
}
