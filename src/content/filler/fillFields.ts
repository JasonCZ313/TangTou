import type { FieldDescriptor, FillMappingItem, FillPlan, SectionAddRequest } from '../../shared/types/fill';
import type { ExtensionMessage, FileUploadPayload } from '../../shared/types/messages';
import {
  absorbNewFieldsReady,
  labelNextEmptyCard,
  locateRepeatSection,
  prepareFieldForWrite,
  pressAddButton,
  resolveFieldElement,
} from '../scanner/scanFields';
import { restoreListLineBreaks } from '../../shared/resume/restoreListBreaks';
import { shouldFillStop } from '../fillAbort';
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
 * 两个显示文字是不是同一个选项。年份、月份、+86 和「居民身份证」这类都能对上。
 */
function looseTextMatch(shown: string, target: string): boolean {
  const shownTrim = shown.trim().toLowerCase();
  const targetTrim = target.trim().toLowerCase();
  if (!shownTrim || !targetTrim || shownTrim === '请选择') {
    return false;
  }
  if (shownTrim === targetTrim) {
    return true;
  }
  const shownDigits = shownTrim.replace(/\D/g, '').replace(/^0+/, '');
  const targetDigits = targetTrim.replace(/\D/g, '').replace(/^0+/, '');
  if (shownDigits && targetDigits && shownDigits === targetDigits) {
    return true;
  }
  if (targetDigits === '86' || targetTrim === '+86') {
    return /86|中国/.test(shownTrim);
  }
  if (shownTrim.includes(targetTrim) && targetTrim.length >= 2) {
    const extraText = shownTrim.replace(targetTrim, '');
    return !/\d/.test(extraText);
  }
  return false;
}

/**
 * 年月下拉只取该框该写的那一段。结束年、结束月取区间里后面的数字。
 */
function valueForSelect(selectElement: HTMLSelectElement, rawValue: string, label: string): string {
  const optionText = Array.from(selectElement.options)
    .map((optionElement) => (optionElement.textContent ?? '').trim())
    .join(' ');
  const looksLikeYear = (optionText.match(/(19|20)\d{2}/g) ?? []).length >= 8;
  const looksLikeMonth = (optionText.match(/(^|\s)(0?[1-9]|1[0-2])月?(\s|$)/g) ?? []).length >= 6;
  const rangeMatch = rawValue.match(
    /(19|20)\d{2}\D+(0?[1-9]|1[0-2])\D+(19|20)\d{2}\D+(0?[1-9]|1[0-2])/,
  );
  const singleMatch = rawValue.match(/(19|20)\d{2}\D+(0?[1-9]|1[0-2])/);
  const isEnd = /结束/.test(label);
  if (looksLikeYear) {
    if (rangeMatch) {
      return isEnd ? (rangeMatch[3] ?? rawValue) : (rangeMatch[1] ?? rawValue);
    }
    return rawValue.match(/(19|20)\d{2}/)?.[0] ?? rawValue;
  }
  if (looksLikeMonth) {
    const monthText = rangeMatch
      ? isEnd
        ? rangeMatch[4]
        : rangeMatch[2]
      : singleMatch?.[2];
    if (monthText) {
      return String(Number(monthText));
    }
  }
  return rawValue;
}

/**
 * 在原生下拉里选一项。完全相同优先；年份和月份按数字对齐。
 */
function chooseSelectOption(
  selectElement: HTMLSelectElement,
  nextValue: string,
): HTMLOptionElement | null {
  const targetText = nextValue.trim();
  if (!targetText) {
    return null;
  }
  const options = Array.from(selectElement.options).filter((optionElement) => {
    const optionLabel = (optionElement.textContent ?? '').trim();
    return optionLabel.length > 0 && !/^请选择/.test(optionLabel);
  });
  return (
    options.find((optionElement) => {
      const optionLabel = (optionElement.textContent ?? '').trim();
      return looseTextMatch(optionLabel, targetText) || looseTextMatch(optionElement.value, targetText);
    }) ?? null
  );
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
 * 把长文里该断开的地方变成真换行。
 * 间隔号「 · 」和转义的 \\n 都按一行处理，避免整段粘成一团。
 */
function normalizeParagraphLines(rawText: string): string[] {
  const unescaped = rawText.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  const withSeparators = unescaped.replace(/[ \t]*[·•●▪][ \t]*/g, '\n');
  const restored = restoreListLineBreaks(withSeparators);
  const lines = restored.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.filter((line, index) => line.length > 0 || (index > 0 && lines[index - 1]?.length > 0));
}

/**
 * 等一帧，让页面把上一行画出来再写下一段。
 */
function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 24);
  });
}

/**
 * 把光标放到可编辑区域末尾，下一行接着写。
 */
function placeCaretAtEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) {
    return;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 往文本框里逐字写入。换行单独插入，避免整段赋值被页面吃掉行距。
 */
async function typeIntoPlainControl(
  element: HTMLInputElement | HTMLTextAreaElement,
  nextText: string,
): Promise<boolean> {
  element.focus();
  setNativeValue(element, '');
  let builtText = '';
  for (const character of nextText) {
    if (shouldFillStop()) {
      return false;
    }
    builtText += character;
    setNativeValue(element, builtText);
    element.setSelectionRange(builtText.length, builtText.length);
    await pause(character === '\n' ? 28 : 8);
  }
  return element.value.replace(/\s+/g, '').length > 0;
}

/**
 * 一行一行、一个字一个字写入。文本框用输入命令，富文本用换行事件。
 */
async function streamParagraphIntoElement(element: HTMLElement, rawText: string): Promise<boolean> {
  const lines = normalizeParagraphLines(rawText);
  if (lines.length === 0) {
    return false;
  }
  const linedText = lines.join('\n');
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return typeIntoPlainControl(element, linedText);
  }
  element.focus();
  element.replaceChildren();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex] ?? '';
    for (const character of lineText) {
      if (shouldFillStop()) {
        return false;
      }
      placeCaretAtEnd(element);
      const textEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: character,
      });
      const editorAcceptedText = !element.dispatchEvent(textEvent);
      if (!editorAcceptedText && !(element.innerText ?? '').includes(character)) {
        element.append(character);
      }
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: character,
        }),
      );
      await pause(8);
    }
    if (lineIndex < lines.length - 1) {
      placeCaretAtEnd(element);
      const breakEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertLineBreak',
      });
      element.dispatchEvent(breakEvent);
      if (!(element.innerText ?? '').endsWith('\n')) {
        element.append(document.createElement('br'));
      }
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertLineBreak',
        }),
      );
      await pause(28);
    }
  }
  return (element.innerText ?? '').replace(/\s+/g, '').length > 0;
}

/**
 * 这段文字要不要逐行写入。短字段一次写完，长文和本身带换行的才流式写。
 */
function shouldStreamParagraph(element: Element, rawText: string): boolean {
  if (/[\n·•]/.test(rawText) && (element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable))) {
    return true;
  }
  const lines = normalizeParagraphLines(rawText);
  if (lines.length <= 1 && rawText.trim().length < 40) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  return element instanceof HTMLInputElement && lines.length > 1;
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
    const matchedOption = chooseSelectOption(
      element,
      valueForSelect(element, nextValue, element.getAttribute('data-raf-label') ?? ''),
    );
    if (!matchedOption) {
      return false;
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;
    if (valueSetter) {
      valueSetter.call(element, matchedOption.value);
    } else {
      element.value = matchedOption.value;
    }
    matchedOption.selected = true;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    const shownText = (element.selectedOptions[0]?.textContent ?? '').trim();
    return looseTextMatch(shownText, matchedOption.textContent ?? '') || element.value === matchedOption.value;
  }

  if (element instanceof HTMLTextAreaElement) {
    const linedText = normalizeParagraphLines(nextValue).join('\n');
    setNativeValue(element, linedText.length > 0 ? linedText : nextValue);
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
 * 按页面上的位置排序，保证同一行先写年份再写月份。
 */
function sortMappingsByDocumentOrder(items: FillMappingItem[]): FillMappingItem[] {
  return [...items].sort((leftItem, rightItem) => {
    const leftElement = resolveFieldElement(leftItem.fieldId);
    const rightElement = resolveFieldElement(rightItem.fieldId);
    if (!leftElement || !rightElement || leftElement === rightElement) {
      return 0;
    }
    const position = leftElement.compareDocumentPosition(rightElement);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      return -1;
    }
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      return 1;
    }
    return 0;
  });
}

/**
 * 选完证件类型、区号这类选项后，向后台要新框的对照。没有档案时不再请求。
 */
async function planFreshFields(
  profileId: string | undefined,
  freshFields: FieldDescriptor[],
): Promise<FillMappingItem[]> {
  if (!profileId || freshFields.length === 0) {
    return [];
  }
  const response = (await chrome.runtime.sendMessage({
    type: 'BUILD_FILL_PLAN',
    requestId: crypto.randomUUID(),
    profileId,
    fields: freshFields,
  } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
  if (!response || response.type !== 'FILL_PLAN_RESULT') {
    return [];
  }
  return response.plan.items;
}

/**
 * 读扫描时记在控件上的真实选项。
 */
function readStoredOptions(element: Element): string[] {
  const rawOptions = element.getAttribute('data-raf-options');
  if (rawOptions) {
    try {
      const parsed: unknown = JSON.parse(rawOptions);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      return [];
    }
  }
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .map((optionElement) => (optionElement.textContent ?? '').trim())
      .filter((optionLabel) => optionLabel.length > 0);
  }
  return [];
}

/**
 * 在真实选项里挑要点的那一条。月份点「8」不点「08」；列表里没有就不硬填。
 */
function optionTextToClick(options: string[], rawValue: string, label: string): string | null {
  const usable = options.filter((optionText) => optionText.trim() !== '暂无选项');
  const monthOptions = usable.filter((optionText) => /^(0?[1-9]|1[0-2])月?$/.test(optionText.trim()));
  if (monthOptions.length >= 6 || (/月/.test(label) && monthOptions.length > 0)) {
    const monthMatch = rawValue.match(/(?:19|20)\d{2}\D+(1[0-2]|0?[1-9])/);
    const monthNumber = monthMatch?.[1]
      ? String(Number(monthMatch[1]))
      : /^\d{1,2}$/.test(rawValue.trim())
        ? String(Number(rawValue.trim()))
        : '';
    if (!monthNumber) {
      return null;
    }
    return monthOptions.find((optionText) => String(Number(optionText.replace(/\D/g, ''))) === monthNumber) ?? null;
  }
  const yearOptions = usable.filter((optionText) => /^(19|20)\d{2}/.test(optionText.trim()));
  if (yearOptions.length >= 8 || (/年/.test(label) && yearOptions.length > 0)) {
    const rangeMatch = rawValue.match(/((?:19|20)\d{2})\D+(?:1[0-2]|0?[1-9])\D+((?:19|20)\d{2})/);
    const yearText = /结束/.test(label) && rangeMatch?.[2]
      ? rangeMatch[2]
      : rangeMatch?.[1] ?? rawValue.match(/(19|20)\d{2}/)?.[0];
    if (!yearText) {
      return null;
    }
    return yearOptions.find((optionText) => optionText.includes(yearText))?.trim() ?? null;
  }
  if (/^\d{6,}$/.test(rawValue.trim()) && usable.some((optionText) => /身份证|护照/.test(optionText))) {
    return null;
  }
  if (/排名/.test(label) && /本科|硕士|博士|大专|学历/.test(rawValue)) {
    return null;
  }
  const exact = usable.find((optionText) => optionText.trim() === rawValue.trim());
  if (exact) {
    return exact.trim();
  }
  const degreeGroups = [
    ['大学本科', '本科', '学士'],
    ['硕士研究生', '硕士', '研究生'],
    ['博士研究生', '博士'],
    ['大专（高职）', '大专', '高职'],
    ['高中', '普通高中'],
  ];
  const degreeGroup = degreeGroups.find((group) => group.some((label) => rawValue.trim().includes(label) || label.includes(rawValue.trim())));
  if (degreeGroup) {
    const degreeHit = usable.find((optionText) => degreeGroup.includes(optionText.trim()));
    if (degreeHit) {
      return degreeHit.trim();
    }
  }
  const contained = usable.filter((optionText) => {
    const optionLabel = optionText.trim();
    return optionLabel.includes(rawValue.trim()) || rawValue.trim().includes(optionLabel);
  });
  return contained.length === 1 ? contained[0]?.trim() ?? null : null;
}

/**
 * 点开下拉并点中目标选项，让站点自己的组件认这笔值。
 */
/**
 * 年月选项允许「2026」对上「2026年」、「8」对上「08」。长文里偶然出现的数字不算选项。
 */
function optionTextMatches(visibleText: string, optionText: string): boolean {
  const compactVisible = visibleText.replace(/\s+/g, '').trim();
  const compactTarget = optionText.replace(/\s+/g, '').trim();
  if (!compactVisible || compactVisible.length > 32 || compactVisible === '暂无选项') {
    return false;
  }
  if (compactVisible === compactTarget) {
    return true;
  }
  const visibleDigits = compactVisible.replace(/\D/g, '');
  const targetDigits = compactTarget.replace(/\D/g, '');
  return Boolean(targetDigits) && visibleDigits === targetDigits && targetDigits.length <= 4;
}

/**
 * 当前打开、并且真的看得见的下拉层。隐藏的无障碍列表不算。
 */
function visibleSelectDropdown(): HTMLElement | null {
  const dropdowns = Array.from(
    document.querySelectorAll('.ant-select-dropdown, .el-select-dropdown, [role="listbox"]'),
  );
  for (const node of dropdowns) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node.classList.contains('ant-select-dropdown-hidden')) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width > 8 && rect.height > 8) {
      return node;
    }
  }
  return null;
}

/**
 * 点开下拉并点中目标选项，让站点自己的组件认这笔值。
 * 年月下拉多等一会儿，避免列表还没画出来就判定失败。
 */
function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * 下拉不一定带 ant 的类名。在已经打开的浮层里，按可见文字点中档案里的那一项。
 */
function clickAnyVisibleChoice(optionText: string): boolean {
  const compactTarget = optionText.replace(/\s+/g, '').trim();
  if (!compactTarget) {
    return false;
  }
  const candidates = Array.from(document.querySelectorAll('div, li, span'));
  const target = candidates.find((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.height > 72) {
      return false;
    }
    const visibleText = (node.innerText || '').replace(/\s+/g, '').trim();
    if (!optionTextMatches(visibleText, compactTarget)) {
      return false;
    }
    let parentNode: HTMLElement | null = node.parentElement;
    for (let depth = 0; depth < 6 && parentNode; depth += 1) {
      const position = getComputedStyle(parentNode).position;
      if (position === 'fixed' || position === 'absolute') {
        return true;
      }
      parentNode = parentNode.parentElement;
    }
    return false;
  });
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  target.click();
  return true;
}
function clickVisibleOption(dropdown: HTMLElement, optionText: string): boolean {
  const optionNodes = Array.from(
    dropdown.querySelectorAll('.ant-select-item-option, .el-select-dropdown__item'),
  );
  const target = optionNodes.find((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return false;
    }
    const titleText = node.getAttribute('title') ?? '';
    const contentText =
      node.querySelector('.ant-select-item-option-content')?.textContent ?? node.textContent ?? '';
    return optionTextMatches(titleText, optionText) || optionTextMatches(contentText, optionText);
  });
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  target.click();
  return true;
}

/**
 * 年月下拉靠按下鼠标打开，只发 click 时列表不会出来。
 */
function pressPicker(host: HTMLElement): void {
  const pickerRoot = host.matches('.ant-select, .el-select')
    ? host
    : host.closest('.ant-select, .el-select');
  const clickTarget =
    pickerRoot?.querySelector('.ant-select-selector, .el-select__wrapper') ?? host;
  if (!(clickTarget instanceof HTMLElement)) {
    return;
  }
  clickTarget.scrollIntoView({ block: 'center', inline: 'nearest' });
  const mouseInit: MouseEventInit = { bubbles: true, cancelable: true, view: window, button: 0 };
  clickTarget.dispatchEvent(new MouseEvent('mousedown', mouseInit));
  clickTarget.dispatchEvent(new MouseEvent('mouseup', mouseInit));
  clickTarget.click();
}

/**
 * 点开下拉，等列表出现，再点中和档案一致的选项。点不中就不把字留在搜索框里。
 * 年份列表很长时往下滚，直到目标年出现再点。
 */
async function clickListedOption(host: HTMLElement, optionText: string): Promise<boolean> {
  const pickerRoot = host.matches('.ant-select, .el-select')
    ? host
    : host.closest('.ant-select, .el-select');
  pressPicker(host);
  await pause(450);
  const digitRun = optionText.replace(/\D/g, '');
  if (optionText.length <= 24 && digitRun.length > 0 && digitRun.length < 6) {
    const searchInput = pickerRoot?.querySelector('input');
    if (searchInput instanceof HTMLInputElement && document.activeElement === searchInput) {
      setNativeValue(searchInput, digitRun);
      await pause(280);
    }
  }
  for (let scrollStep = 0; scrollStep < 28; scrollStep += 1) {
    const dropdown = visibleSelectDropdown();
    if (dropdown && clickVisibleOption(dropdown, optionText)) {
      break;
    }
    if (clickAnyVisibleChoice(optionText)) {
      break;
    }
    const holder = dropdown?.querySelector('.rc-virtual-list-holder');
    if (holder instanceof HTMLElement) {
      if (scrollStep === 0) {
        holder.scrollTop = 0;
      } else {
        holder.scrollTop += 180;
      }
      holder.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await pause(50);
  }
  await pause(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const shownText = shownControlText(host);
  return shownDateMatches(shownText, optionText) || looseTextMatch(shownText, optionText);
}

/**
 * 控件上现在显示的文字。
 */
function shownControlText(element: Element): string {
  const pickerRoot = element.closest('.ant-select, .el-select');
  if (pickerRoot instanceof HTMLElement) {
    const selectedItem = pickerRoot.querySelector(
      '.ant-select-selection-item, .el-select__selected-item',
    );
    const selectedText = (selectedItem?.textContent ?? '').replace(/\s+/g, '').trim();
    if (selectedText && !/^(请选择|年|月)$/.test(selectedText)) {
      return selectedText;
    }
    const placeholderText = (
      pickerRoot.querySelector('.ant-select-selection-placeholder, .el-select__placeholder')?.textContent ?? ''
    ).replace(/\s+/g, '').trim();
    if (placeholderText) {
      return placeholderText;
    }
    if (selectedText) {
      return selectedText;
    }
  }
  if (element instanceof HTMLSelectElement) {
    return (element.selectedOptions[0]?.textContent ?? '').trim();
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value.trim();
  }
  return (element.textContent ?? '').trim();
}

/**
 * 页面上显示的年月是否就是要点的那一项。占位符「年」「月」不算写上。
 */
function shownDateMatches(shownText: string, optionText: string): boolean {
  if (!shownText || /暂无选项|^年$|^月$|^请选择/.test(shownText)) {
    return false;
  }
  if (shownText === optionText || looseTextMatch(shownText, optionText)) {
    return true;
  }
  const shownDigits = shownText.replace(/\D/g, '');
  const targetDigits = optionText.replace(/\D/g, '');
  return Boolean(targetDigits) && shownDigits === targetDigits && targetDigits.length <= 4;
}

/**
 * 开始年晚于结束年时，把这一行的年、月对调后再点一次。
 */
async function correctReversedDateRows(): Promise<void> {
  const groups = new Map<string, { start?: HTMLElement; end?: HTMLElement }>();
  for (const node of document.querySelectorAll('[data-raf-label]')) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const label = node.getAttribute('data-raf-label') ?? '';
    const roleMatch = label.match(/(.+)(开始|结束)(年|月)$/);
    if (!roleMatch?.[1] || !roleMatch[2] || !roleMatch[3]) {
      continue;
    }
    const groupKey = `${roleMatch[1]}|${roleMatch[3]}`;
    const group = groups.get(groupKey) ?? {};
    if (roleMatch[2] === '开始') {
      group.start = node;
    } else {
      group.end = node;
    }
    groups.set(groupKey, group);
  }
  for (const group of groups.values()) {
    if (!group.start || !group.end) {
      continue;
    }
    const startText = shownControlText(group.start);
    const endText = shownControlText(group.end);
    const startNumber = Number(startText.replace(/\D/g, ''));
    const endNumber = Number(endText.replace(/\D/g, ''));
    if (!startNumber || !endNumber || startNumber <= endNumber) {
      continue;
    }
    await clickListedOption(group.start, endText);
    await clickListedOption(group.end, startText);
  }
}

/**
 * 这个控件只能点选，不能把身份证号或手机号打进搜索框。
 */
function isClosedPicker(element: Element): boolean {
  if (
    element.getAttribute('data-raf-must-pick') === '1' ||
    element.getAttribute('role') === 'combobox' ||
    /年$|月$/.test(element.getAttribute('data-raf-label') ?? '')
  ) {
    return true;
  }
  if (element.getAttribute('aria-haspopup')) {
    return true;
  }
  if (element.closest('.ant-select, .el-select, .ant-picker, .el-date-editor')) {
    return true;
  }
  return (
    element instanceof HTMLInputElement &&
    (element.readOnly || /请选择/.test(element.placeholder))
  );
}

/**
 * 格子里已经有正式内容时不再改，避免把第一条重复写进后面每一行。
 */
function controlAlreadyFilled(element: Element): boolean {
  const shownText = shownControlText(element);
  if (!shownText || /^(请选择|年|月|暂无选项)/.test(shownText)) {
    return false;
  }
  if (element instanceof HTMLInputElement && shownText === (element.placeholder || '').trim()) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement && shownText === (element.placeholder || '').trim()) {
    return false;
  }
  return true;
}
function clearPickerText(element: Element): void {
  if (element instanceof HTMLInputElement && element.value) {
    setNativeValue(element, '');
  }
}
async function writeMappingItem(
  mappingItem: FillMappingItem,
  filePayloads: FileUploadPayload[],
): Promise<'filled' | 'skipped' | 'ignored'> {
  const targetElement = await prepareFieldForWrite(mappingItem.fieldId);
  if (!targetElement) {
    return 'skipped';
  }
  if (shouldFillStop()) {
    return 'skipped';
  }
  if (controlAlreadyFilled(targetElement)) {
    if (visibleSelectDropdown()) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    return 'ignored';
  }
  if (
    (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLSelectElement) &&
    targetElement.disabled
  ) {
    return 'ignored';
  }
  if (targetElement instanceof HTMLInputElement && targetElement.type === 'file') {
    const payload = filePayloads.find((item) => item.fieldId === mappingItem.fieldId);
    if (!payload || !assignFilePayload(targetElement, payload)) {
      return 'skipped';
    }
    lastUndoSnapshots.push({ fieldId: mappingItem.fieldId, previousValue: '' });
    targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
    return 'filled';
  }

  const storedOptions = readStoredOptions(targetElement);
  const fieldLabel = targetElement.getAttribute('data-raf-label') ?? '';
  const pickerHost = isClosedPicker(targetElement);
  const previousValue = readElementValue(targetElement);
  if (pickerHost && targetElement instanceof HTMLElement) {
    const digitRun = mappingItem.value.replace(/\D/g, '');
    const idOption = [...storedOptions].find((optionText) => optionText.trim() === '身份证');
    if (digitRun.length >= 6 && !idOption) {
      return 'skipped';
    }
    if (/电话区号|区号/.test(fieldLabel) && digitRun.length >= 8) {
      return 'skipped';
    }
    let optionText = idOption && digitRun.length >= 6
      ? idOption
      : storedOptions.length > 0
        ? optionTextToClick(storedOptions, mappingItem.value, fieldLabel)
        : mappingItem.value.trim().length > 0 && mappingItem.value.trim().length <= 24 && digitRun.length < 6
          ? mappingItem.value.trim()
          : null;
    if (!optionText && /年$/.test(fieldLabel)) {
      optionText = mappingItem.value.match(/(?:19|20)\d{2}/)?.[0] ?? null;
    }
    if (!optionText && /月$/.test(fieldLabel)) {
      const monthNumber = Number(mappingItem.value.replace(/\D/g, ''));
      optionText = monthNumber >= 1 && monthNumber <= 12 ? String(monthNumber) : null;
    }
    if (!optionText) {
      return 'skipped';
    }
    if (targetElement instanceof HTMLSelectElement) {
      writeValueToElement(targetElement, optionText);
    }
    const clicked = await clickListedOption(targetElement, optionText);
    if (!clicked) {
      clearPickerText(targetElement);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'skipped';
    }
    lastUndoSnapshots.push({ fieldId: mappingItem.fieldId, previousValue });
    targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
    return 'filled';
  }
  if (
    targetElement instanceof HTMLElement &&
    mappingItem.value.replace(/\D/g, '').length >= 6
  ) {
    const pickedIdType = await clickListedOption(targetElement, '身份证');
    if (pickedIdType) {
      lastUndoSnapshots.push({ fieldId: mappingItem.fieldId, previousValue });
      targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
      return 'filled';
    }
    if (visibleSelectDropdown()) {
      clearPickerText(targetElement);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'skipped';
    }
  }
  if (shouldStreamParagraph(targetElement, mappingItem.value)) {
    const streamed = await streamParagraphIntoElement(targetElement, mappingItem.value);
    if (!streamed) {
      return 'skipped';
    }
    lastUndoSnapshots.push({ fieldId: mappingItem.fieldId, previousValue });
    targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
    return 'filled';
  }
  let writeSucceeded = writeValueToElement(targetElement, mappingItem.value);
  if (targetElement instanceof HTMLInputElement) {
    await pause(350);
    clickAnyVisibleChoice(mappingItem.value);
    await chooseCustomOption(targetElement, mappingItem.value);
    const shownValue = targetElement.value.trim();
    if (shownValue && looseTextMatch(shownValue, mappingItem.value)) {
      writeSucceeded = true;
    }
  }
  if (!writeSucceeded) {
    return 'skipped';
  }
  lastUndoSnapshots.push({ fieldId: mappingItem.fieldId, previousValue });
  targetElement.classList.add(FILLED_HIGHLIGHT_CLASS);
  return 'filled';
}

/**
 * 按 FillPlan 一步一步写入。每写完一个下拉就再认旁边新出现的框。
 * 档案条数比页面行数多时，点一次添加、认新行、填完，再点下一次。不提交表单。
 */
export async function applyFillPlan(
  plan: FillPlan,
  filePayloads: FileUploadPayload[] = [],
  profileId?: string,
  sectionAdds: SectionAddRequest[] = [],
): Promise<{
  filled: number;
  skipped: number;
}> {
  ensureHighlightStyles();
  lastUndoSnapshots = [];

  let filled = 0;
  let skipped = plan.skippedFieldIds.length;
  const handledFieldIds = new Set<string>();
  const attemptedItems: FillMappingItem[] = [];
  const queue = sortMappingsByDocumentOrder(plan.items);
  let safetySteps = 0;
  /** 慢填上限：8 段经历逐格点选也够用，避免填到一半被 240 步掐断 */
  const safetyLimit = 800;

  /**
   * 把队列里的项按页面顺序写完。新框插到队首，先填完再离开这一块。
   */
  const drainQueue = async (): Promise<void> => {
    while (queue.length > 0 && safetySteps < safetyLimit && !shouldFillStop()) {
      safetySteps += 1;
      await pause(180);
      const mappingItem = queue.shift();
      if (!mappingItem || handledFieldIds.has(mappingItem.fieldId)) {
        continue;
      }
      handledFieldIds.add(mappingItem.fieldId);
      attemptedItems.push(mappingItem);
      const outcome = await writeMappingItem(mappingItem, filePayloads);
      if (outcome === 'filled') {
        filled += 1;
      } else if (outcome === 'skipped') {
        skipped += 1;
      }
      const writtenElement = resolveFieldElement(mappingItem.fieldId);
      if (!writtenElement || outcome !== 'filled' || !(writtenElement instanceof HTMLElement)) {
        continue;
      }
      const shouldRescan = /证件类型|学历|学位|民族|政治面貌/.test(
        writtenElement.getAttribute('data-raf-label') ?? '',
      );
      if (!shouldRescan) {
        continue;
      }
      const scope = writtenElement.closest('form, section, .ant-form, .el-form') ?? document;
      const freshFields = await absorbNewFieldsReady(scope);
      const extraItems = await planFreshFields(profileId, freshFields);
      if (extraItems.length > 0) {
        queue.unshift(...sortMappingsByDocumentOrder(extraItems));
      }
    }
  };

  await drainQueue();
  await correctReversedDateRows();

  let correctionPasses = 0;
  while (correctionPasses < 2) {
    correctionPasses += 1;
    const stillEmpty = plan.items.filter((mappingItem) => {
      const element = resolveFieldElement(mappingItem.fieldId);
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const shownText = shownControlText(element);
      return !shownText || /^(请选择|年|月)$/.test(shownText) || shownText === '暂无选项';
    });
    if (stillEmpty.length === 0) {
      break;
    }
    for (const mappingItem of stillEmpty) {
      handledFieldIds.delete(mappingItem.fieldId);
    }
    queue.push(...stillEmpty);
    await drainQueue();
  }

  await correctReversedDateRows();

  for (const sectionAdd of sectionAdds) {
    if (shouldFillStop()) {
      break;
    }
    let addCount = 0;
    let missedPlans = 0;
    while (missedPlans < 2 && addCount <= sectionAdd.neededRows && safetySteps < safetyLimit && !shouldFillStop()) {
      const emptyCard = labelNextEmptyCard(sectionAdd.sectionPattern, sectionAdd.neededRows);
      if (emptyCard.length > 0) {
        const extraItems = await planFreshFields(profileId, emptyCard);
        if (extraItems.length > 0) {
          queue.push(...sortMappingsByDocumentOrder(extraItems));
          await drainQueue();
          missedPlans = 0;
          continue;
        }
        missedPlans += 1;
      }
      const snapshot = locateRepeatSection(sectionAdd.sectionPattern);
      if (!snapshot?.addButton || snapshot.rows >= sectionAdd.neededRows) {
        break;
      }
      const rowsBeforeAdd = snapshot.rows;
      addCount += 1;
      safetySteps += 1;
      pressAddButton(snapshot.addButton);
      let cardAppeared = false;
      for (let waitIndex = 0; waitIndex < 6 && !shouldFillStop(); waitIndex += 1) {
        await pause(400);
        const snapshotAfterAdd = locateRepeatSection(sectionAdd.sectionPattern);
        if (snapshotAfterAdd && snapshotAfterAdd.rows > rowsBeforeAdd) {
          cardAppeared = true;
          break;
        }
        const pendingCard = labelNextEmptyCard(sectionAdd.sectionPattern, sectionAdd.neededRows);
        if (pendingCard.length > 0) {
          cardAppeared = true;
          break;
        }
      }
      if (!cardAppeared) {
        break;
      }
    }
  }

  await correctReversedDateRows();
  const unfinishedDates = attemptedItems.filter((mappingItem) => {
    const element = resolveFieldElement(mappingItem.fieldId);
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const shownText = shownControlText(element);
    return !shownText || /^(请选择|年|月)$/.test(shownText);
  });
  for (const mappingItem of unfinishedDates) {
    if (shouldFillStop()) {
      break;
    }
    handledFieldIds.delete(mappingItem.fieldId);
  }
  if (unfinishedDates.length > 0) {
    queue.push(...unfinishedDates);
    await drainQueue();
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
