import type { FillPlan } from '../../shared/types/fill';
import { resolveFieldElement } from '../scanner/scanFields';
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
 * 写入 checkbox / radio：按布尔语义或 value 匹配更新 checked，不触发提交。
 */
function fillCheckableInput(
  inputElement: HTMLInputElement,
  nextValue: string,
): boolean {
  const normalized = nextValue.trim().toLowerCase();
  if (inputElement.type === 'checkbox') {
    const shouldCheck =
      normalized === 'true' ||
      normalized === '1' ||
      normalized === 'yes' ||
      normalized === 'on' ||
      normalized === inputElement.value.toLowerCase();
    inputElement.checked = shouldCheck;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (inputElement.type === 'radio') {
    const shouldCheck =
      normalized === inputElement.value.toLowerCase() ||
      normalized === 'true' ||
      normalized === 'yes';
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
 * 按 FillPlan 将映射值安全写入页面控件：
 * 写入前记录旧值快照，成功后加高亮；无法定位或写入失败计入 skipped。
 * 明确不提交表单、不点击提交按钮。
 */
export function applyFillPlan(plan: FillPlan): {
  filled: number;
  skipped: number;
} {
  ensureHighlightStyles();
  lastUndoSnapshots = [];

  let filled = 0;
  let skipped = plan.skippedFieldIds.length;

  for (const mappingItem of plan.items) {
    const targetElement = resolveFieldElement(mappingItem.fieldId);
    if (!targetElement) {
      skipped += 1;
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
 * 撤销上一轮 applyFillPlan：按快照恢复旧值并移除高亮，返回成功恢复数量。
 */
export function undoLastFill(): { restored: number } {
  let restored = 0;

  for (const snapshot of lastUndoSnapshots) {
    const targetElement = resolveFieldElement(snapshot.fieldId);
    if (!targetElement) {
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
