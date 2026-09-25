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
 * 从年月日片段拼出控件要的日期字符串。对不上日期的原文原样返回。
 */
function formatDateForControl(element: HTMLInputElement, rawValue: string): string {
  const matched = rawValue.trim().match(/^(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
  if (!matched) {
    return rawValue;
  }
  const yearText = matched[1] ?? '';
  const monthText = (matched[2] ?? '').padStart(2, '0');
  const dayText = matched[3] ? matched[3].padStart(2, '0') : '';
  const monthNumber = Number(monthText);
  const dayNumber = dayText ? Number(dayText) : 0;
  if (monthNumber < 1 || monthNumber > 12 || dayNumber > 31) {
    return rawValue;
  }
  const hintText = [
    element.placeholder,
    element.getAttribute('aria-label') ?? '',
    element.closest('label')?.textContent ?? '',
  ].join(' ');
  const looksLikeDate =
    element.type === 'date' ||
    element.type === 'month' ||
    element.type === 'datetime-local' ||
    /日期|年月|生日|出生|入职|毕业|时间/.test(hintText);
  if (!looksLikeDate) {
    return rawValue;
  }
  if (element.type === 'month') {
    return `${yearText}-${monthText}`;
  }
  const dayOrFirst = dayText || '01';
  if (element.type === 'datetime-local') {
    return `${yearText}-${monthText}-${dayOrFirst}T00:00`;
  }
  if (element.type === 'date') {
    return `${yearText}-${monthText}-${dayOrFirst}`;
  }
  if (hintText.includes('年') && hintText.includes('月')) {
    if (dayText && hintText.includes('日')) {
      return `${yearText}年${monthText}月${dayText}日`;
    }
    return `${yearText}年${monthText}月`;
  }
  if (hintText.includes('/')) {
    return dayText ? `${yearText}/${monthText}/${dayText}` : `${yearText}/${monthText}`;
  }
  if (hintText.includes('.')) {
    return dayText ? `${yearText}.${monthText}.${dayText}` : `${yearText}.${monthText}`;
  }
  return dayText ? `${yearText}-${monthText}-${dayText}` : `${yearText}-${monthText}`;
}

/**
 * 在原生下拉里选一项。完全相同优先；只有一个「多几个字」的选项时用那一项。
 */
function chooseSelectOption(
  selectElement: HTMLSelectElement,
  nextValue: string,
): HTMLOptionElement | null {
  const targetText = nextValue.trim().toLowerCase();
  if (!targetText) {
    return null;
  }
  const options = Array.from(selectElement.options);
  const exactOption = options.find((optionElement) => {
    const optionValue = optionElement.value.trim().toLowerCase();
    const optionLabel = (optionElement.textContent ?? '').trim().toLowerCase();
    return optionValue === targetText || optionLabel === targetText;
  });
  if (exactOption) {
    return exactOption;
  }
  const looseOptions = options.filter((optionElement) => {
    const optionLabel = (optionElement.textContent ?? '').trim().toLowerCase();
    if (!optionLabel) {
      return false;
    }
    return optionLabel.includes(targetText) || targetText.includes(optionLabel);
  });
  return looseOptions.length === 1 ? looseOptions[0] ?? null : null;
}

/**
 * 这个文本框是不是仿下拉：点开后才出现选项。
 */
function looksLikeCustomSelect(inputElement: HTMLInputElement): boolean {
  const popupKind = inputElement.getAttribute('aria-haspopup');
  if (inputElement.getAttribute('role') === 'combobox' || popupKind === 'listbox') {
    return true;
  }
  return inputElement.readOnly && /选择|下拉/.test(
    `${inputElement.placeholder} ${inputElement.getAttribute('aria-label') ?? ''}`,
  );
}

/**
 * 找到这个输入框对应的选项列表。没打开时返回 null。
 */
function findOptionList(inputElement: HTMLInputElement): HTMLElement | null {
  const listId =
    inputElement.getAttribute('aria-controls') ||
    inputElement.getAttribute('aria-owns') ||
    '';
  if (listId) {
    const listed = inputElement.ownerDocument.getElementById(listId);
    if (listed instanceof HTMLElement) {
      return listed;
    }
  }
  const nearbyList = inputElement.parentElement?.querySelector('[role="listbox"]');
  return nearbyList instanceof HTMLElement ? nearbyList : null;
}

/**
 * 选项列表里只有一项对得上时，返回那一项。多项接近则不猜。
 */
function uniqueOptionElement(listElement: HTMLElement, nextValue: string): HTMLElement | null {
  const targetText = nextValue.trim().toLowerCase();
  const optionElements = Array.from(
    listElement.querySelectorAll('[role="option"], li'),
  ).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const exactElements = optionElements.filter((optionElement) => {
    return (optionElement.textContent ?? '').trim().toLowerCase() === targetText;
  });
  if (exactElements.length === 1) {
    return exactElements[0] ?? null;
  }
  const looseElements = optionElements.filter((optionElement) => {
    const optionLabel = (optionElement.textContent ?? '').trim().toLowerCase();
    return optionLabel.length > 0 && (optionLabel.includes(targetText) || targetText.includes(optionLabel));
  });
  return looseElements.length === 1 ? looseElements[0] ?? null : null;
}

/**
 * 仿下拉：列表没开就点一下输入框，再点唯一对上的选项。不点确定或保存。
 */
async function chooseCustomOption(
  inputElement: HTMLInputElement,
  nextValue: string,
): Promise<void> {
  if (!looksLikeCustomSelect(inputElement)) {
    return;
  }
  let listElement = findOptionList(inputElement);
  if (!listElement) {
    inputElement.click();
    await new Promise((resolve) => {
      window.setTimeout(resolve, 180);
    });
    listElement = findOptionList(inputElement);
  }
  if (!listElement) {
    return;
  }
  const optionElement = uniqueOptionElement(listElement, nextValue);
  optionElement?.click();
}

/**
 * 写入 contenteditable。先用输入事件交给编辑器，接不住再写文本。
 */
function fillContentEditable(element: HTMLElement, nextValue: string): boolean {
  element.focus();
  const selection = element.ownerDocument.getSelection();
  if (selection) {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: nextValue,
  });
  element.dispatchEvent(beforeInput);
  if ((element.textContent ?? '').trim() !== nextValue.trim()) {
    element.textContent = nextValue;
  }
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: nextValue,
    }),
  );
  const writtenText = (element.textContent ?? '').trim();
  return nextValue.trim().length === 0 || writtenText.length > 0;
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
    const matchedOption = chooseSelectOption(element, nextValue);
    if (!matchedOption) {
      return false;
    }
    element.value = matchedOption.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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
    const dateAdjusted = formatDateForControl(element, nextValue);
    setNativeValue(element, dateAdjusted);
    return true;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return fillContentEditable(element, nextValue);
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
    if (targetElement instanceof HTMLInputElement) {
      await chooseCustomOption(targetElement, mappingItem.value);
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
