/**
 * 逐格收尾：写上之后对字、确认下面没有未选择的列表、点空白后再读一次。
 * 字消失或列表还在，就换一种写法再来。每一格全程最多三遍。
 */
import type { FillMiss } from '../../shared/types/fill';
import { shouldFillStop } from '../fillAbort';
import {
  classifyControl,
  isControlEmpty,
  isInsideTangtouUi,
  isPageFieldVisible,
  isPlaceholderText,
  readControlText,
  setPlainTextWriteMethod,
  writeField,
} from './chao/dom';
import { dateTextMatches, isCalendarDate, optionMatchAliases } from './chao/rules';
import {
  clickMatchingOpenOption,
  collectOpenChoiceTexts,
  ensurePanelsClosed,
  listOpenPanels,
  setWidgetAttemptIndex,
} from './chao/widgetDrivers';
import { recordFillStep } from './fillTrace';

/** 每一格已经用掉的尝试次数，分区重读和第一次写入共用这三遍。 */
const attemptCountByElement = new WeakMap<HTMLElement, number>();

const MAX_ATTEMPTS = 3;

/**
 * 短等待，给页面把选中状态画出来。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 关上之后框上的字是否就是目标。中国不能靠「包含」对上中国香港。
 */
export function closedTextMatches(label: string, intended: string, actual: string): boolean {
  const got = actual.replace(/\s+/g, '');
  const want = intended.replace(/\s+/g, '');
  if (!got || !want || isPlaceholderText(got)) {
    return false;
  }
  if (isCalendarDate(want) || /日期|时间|生日|出生/.test(label)) {
    return dateTextMatches(intended, actual);
  }
  if (want === '中国') {
    return got === '中国';
  }
  const aliases = optionMatchAliases(intended).map((item) => item.replace(/\s+/g, ''));
  return aliases.some((alias) => alias && (got === alias || got.includes(alias) || alias.includes(got)));
}

/**
 * 性别看单选框是否勾上，不看框上有没有字。
 */
function genderStaysSelected(element: HTMLElement, intended: string): boolean {
  const wanted = intended.replace(/\s+/g, '');
  if (!/^(男|女|是|否)$/.test(wanted)) {
    return false;
  }
  const scope = element.closest('[class*="form-item" i], [class*="field" i], tr, li') || element.parentElement;
  if (!(scope instanceof HTMLElement)) {
    return false;
  }
  const checked = [...scope.querySelectorAll('input[type="radio"]')].find((node) => {
    if (!(node instanceof HTMLInputElement) || !node.checked) {
      return false;
    }
    const labelText = (
      node.closest('label')?.textContent
      || ''
    ).replace(/\s+/g, '');
    return labelText.includes(wanted);
  });
  return checked instanceof HTMLInputElement;
}

/**
 * 这一格现在算不算已经填对。
 */
function fieldStays(element: HTMLElement, label: string, intended: string): boolean {
  if (/性别/.test(label) || /^(男|女)$/.test(intended)) {
    if (genderStaysSelected(element, intended)) {
      return true;
    }
  }
  return closedTextMatches(label, intended, readControlText(element));
}

/**
 * 点一块不是按钮、也不是输入框的空白，用来检查值会不会被页面清掉。
 */
function clickBlankArea(current: HTMLElement, nextLabel: HTMLElement | null): void {
  if (document.activeElement === current) {
    current.blur();
  }
  if (listOpenPanels().length > 0) {
    return;
  }
  const probePoints = [
    [8, 8],
    [window.innerWidth - 8, 8],
    [8, 80],
  ];
  for (const [pointX, pointY] of probePoints) {
    const node = document.elementFromPoint(pointX, pointY);
    if (!(node instanceof HTMLElement) || node === current || current.contains(node)) {
      continue;
    }
    if (isInsideTangtouUi(node)) {
      continue;
    }
    if (listOpenPanels().some((panel) => panel instanceof HTMLElement && panel.contains(node))) {
      continue;
    }
    if (node.closest('input, textarea, select, button, a, [role="combobox"], [role="listbox"]')) {
      continue;
    }
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: pointX, clientY: pointY }));
    return;
  }
  if (nextLabel instanceof HTMLElement && !nextLabel.closest('input, textarea, select, button')) {
    nextLabel.click();
  }
}

/**
 * 写一次、对字、把还开着的列表选完、点空白、再读一次。
 * 返回是否这遍已经确认留住。
 */
async function attemptOnce(
  element: HTMLElement,
  label: string,
  intended: string,
  nextLabel: HTMLElement | null,
  attemptIndex: number,
): Promise<boolean> {
  setPlainTextWriteMethod(attemptIndex);
  setWidgetAttemptIndex(attemptIndex);
  const panelsClosed = await ensurePanelsClosed();
  if (!panelsClosed) {
    recordFillStep(label, '写入前关窗', '弹层还在', `第${attemptIndex + 1}遍，不再点开`);
    return false;
  }
  const beforeText = readControlText(element);
  const writeResult = await writeField(
    {
      el: element,
      blob: label,
      control: classifyControl(element),
    },
    intended,
  );
  await wait(160);
  recordFillStep(
    label,
    '写入后',
    fieldStays(element, label, intended) ? '框上已是目标' : '框上还不是目标',
    `第${attemptIndex + 1}遍 之前=${beforeText || '空'} 现在=${readControlText(element) || '空'} ${writeResult.reason || ''}`,
  );
  if (!fieldStays(element, label, intended)) {
    await clickMatchingOpenOption(intended, label, element);
    await wait(180);
  }
  if (!fieldStays(element, label, intended)) {
    await ensurePanelsClosed();
    return false;
  }
  const openTexts = await collectOpenChoiceTexts(element);
  if (openTexts.length > 0) {
    await clickMatchingOpenOption(intended, label, element);
    await wait(180);
    if (!fieldStays(element, label, intended)) {
      await ensurePanelsClosed();
      return false;
    }
  }
  const closedAfterSelect = await ensurePanelsClosed();
  if (!closedAfterSelect || !fieldStays(element, label, intended)) {
    recordFillStep(
      label,
      '选完关窗',
      closedAfterSelect ? '窗关了但字不对' : '窗还开着',
      `弹层数=${listOpenPanels().length} 框上=${readControlText(element) || '空'}`,
    );
    return false;
  }
  clickBlankArea(element, nextLabel);
  await wait(220);
  if (!fieldStays(element, label, intended)) {
    recordFillStep(label, '点空白后再读', '内容消失', readControlText(element) || '空');
    return false;
  }
  const leftover = await collectOpenChoiceTexts(element);
  if (leftover.length > 0) {
    await ensurePanelsClosed();
    return false;
  }
  return writeResult.ok || fieldStays(element, label, intended);
}

/**
 * 把一个空填到确认留住为止。三遍用完仍不对就失败。
 */
export async function commitFieldValue(
  element: HTMLElement,
  label: string,
  intended: string,
  nextLabel: HTMLElement | null = null,
): Promise<{ ok: boolean; reason: string }> {
  const text = intended.trim();
  if (!text) {
    return { ok: false, reason: '档案为空' };
  }
  if (fieldStays(element, label, text)) {
    const closed = await ensurePanelsClosed();
    if (closed && fieldStays(element, label, text)) {
      recordFillStep(label, '开始', '已是目标值', readControlText(element));
      return { ok: true, reason: '已是目标值' };
    }
  }
  if (!(await ensurePanelsClosed())) {
    recordFillStep(label, '开始前关窗', '弹层关不掉', '这一格没有再点开');
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  let lastReason = '未确认填入';
  while ((attemptCountByElement.get(element) ?? 0) < MAX_ATTEMPTS) {
    if (shouldFillStop()) {
      return { ok: false, reason: '已停止' };
    }
    const attemptIndex = attemptCountByElement.get(element) ?? 0;
    attemptCountByElement.set(element, attemptIndex + 1);
    try {
      const stayed = await attemptOnce(element, label, text, nextLabel, attemptIndex);
      if (stayed) {
        return { ok: true, reason: '' };
      }
      lastReason = attemptIndex >= 2 ? '三遍后仍未留住或未选中选项' : '点空白后内容消失或未选中选项';
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : '写入异常';
      lastReason = /Illegal invocation/i.test(detail) ? '控件类型不匹配，已跳过本格' : detail.slice(0, 60);
    }
  }
  return { ok: false, reason: lastReason };
}

/**
 * 档案没给值的下拉：点开记下原文，思考模式只能从这些原文里选一条，再走同一套收尾。
 * 证件、手机、学校、姓名没有档案值时不编造。
 */
export async function commitUnmappedChoice(
  element: HTMLElement,
  label: string,
): Promise<{ ok: boolean; reason: string }> {
  if (/证件|身份证|手机|电话|邮箱|学校|姓名/.test(label)) {
    return { ok: false, reason: '档案没有这项，不编造' };
  }
  if (!isControlEmpty(element)) {
    return { ok: false, reason: '框里已有内容' };
  }
  if (!isPageFieldVisible(element)) {
    return { ok: false, reason: '控件不可见' };
  }
  if (!(await ensurePanelsClosed())) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  element.scrollIntoView({ block: 'center' });
  element.click();
  await wait(280);
  const optionTexts = await collectOpenChoiceTexts(element);
  if (optionTexts.length === 0) {
    await ensurePanelsClosed();
    return { ok: false, reason: '点开后没有看见选项' };
  }
  let picked = '';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PICK_VISIBLE_OPTION',
      requestId: `unmap-${Date.now()}`,
      target: label,
      options: optionTexts.slice(0, 40),
    });
    if (response?.type === 'PICK_VISIBLE_OPTION_RESULT' && typeof response.option === 'string') {
      picked = response.option.trim();
    }
  } catch {
    picked = '';
  }
  if (!optionTexts.includes(picked)) {
    await ensurePanelsClosed();
    return { ok: false, reason: '思考模式没有从列表里选出一项' };
  }
  await ensurePanelsClosed();
  return commitFieldValue(element, label, picked);
}

/**
 * 同一分区写完后重读。框被后面的操作清掉、且这格还有剩余次数时，再补一遍。
 */
export async function rescanCommittedFields(
  items: Array<{ element: HTMLElement; label: string; value: string }>,
  misses: FillMiss[],
): Promise<number> {
  let stayedCount = 0;
  for (const item of items) {
    if (shouldFillStop()) {
      break;
    }
    if (fieldStays(item.element, item.label, item.value)) {
      stayedCount += 1;
      item.element.classList.remove('raf-autofill-missed');
      continue;
    }
    const again = await commitFieldValue(item.element, item.label, item.value);
    if (again.ok) {
      stayedCount += 1;
      item.element.classList.remove('raf-autofill-missed');
      continue;
    }
    misses.push({ label: item.label, reason: again.reason || '分区重读后内容不对' });
    item.element.classList.add('raf-autofill-missed');
  }
  return stayedCount;
}
