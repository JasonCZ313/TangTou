/**
 * 逐格收尾：写上之后对字、确认下面没有未选择的列表、点空白后再读一次。
 * 字消失或列表还在，就换一种写法再来。每一格全程最多三遍。
 */
import type { FillMiss } from '../../shared/types/fill';
import { shouldFillStop } from '../fillAbort';
import {
  CONTROL,
  classifyControl,
  isControlEmpty,
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
  clickOutsideOpenPanels,
  ensurePanelsClosed,
  listOpenPanels,
  setWidgetAttemptIndex,
} from './chao/widgetDrivers';
import { recordFillStep } from './fillTrace';

/** 每一格已经用掉的尝试次数，分区重读和第一次写入共用这三遍。 */
let attemptCountByElement = new WeakMap<HTMLElement, number>();

const MAX_ATTEMPTS = 3;

/**
 * 新一轮 applyFillPlan 开始时清空尝试计数。
 * WeakMap 无 clear：换成新表，避免同页二次写入因累计满 3 次直接秒失败。
 */
export function resetFieldAttemptCounts(): void {
  attemptCountByElement = new WeakMap<HTMLElement, number>();
}

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
  // 性别只看单选有没有勾上。选项上的「男」字和 radio 的 value 都不是已选状态
  if (/性别/.test(label) || /^(男|女)$/.test(intended.replace(/\s+/g, ''))) {
    return genderStaysSelected(element, intended);
  }
  return closedTextMatches(label, intended, readControlText(element));
}

/**
 * 点填写区外的空白，用来关掉选项卡并确认刚写上的字。
 * 不点下一个字段的标题，那个标题在填写区里，旁边常有删除。
 */
function clickBlankArea(current: HTMLElement): void {
  if (document.activeElement === current) {
    current.blur();
  }
  clickOutsideOpenPanels(current);
}

/**
 * 快路径声明的 widget 映射到控件分类；无声明则返回 null，交给 classifyControl。
 */
function controlKindFromWidgetHint(
  widgetHint: 'text' | 'select' | 'date' | 'rangeDate' | undefined,
): string | null {
  if (widgetHint === 'text') {
    return CONTROL.text;
  }
  if (widgetHint === 'select') {
    return CONTROL.optionWidget;
  }
  if (widgetHint === 'date' || widgetHint === 'rangeDate') {
    return CONTROL.dateInput;
  }
  return null;
}

/**
 * P4：下拉/日期走完整等待；纯文本缩短格内等待，不砍正确性换秒数。
 * A+B：快路径 widgetHint=text 时强制短等待；select/date 强制完整等待。
 */
function settleMsForControl(
  element: HTMLElement,
  label: string,
  widgetHint?: 'text' | 'select' | 'date' | 'rangeDate',
): {
  afterWrite: number;
  afterOption: number;
  afterBlank: number;
} {
  if (widgetHint === 'text') {
    return { afterWrite: 50, afterOption: 70, afterBlank: 80 };
  }
  if (widgetHint === 'select' || widgetHint === 'date' || widgetHint === 'rangeDate') {
    return { afterWrite: 160, afterOption: 180, afterBlank: 220 };
  }
  const controlKind = classifyControl(element);
  const heavyByType =
    controlKind === CONTROL.optionWidget
    || controlKind === CONTROL.nativeSelect
    || controlKind === CONTROL.dateInput;
  const heavyByLabel = /日期|时间|起止|学历|下拉|选择/.test(label);
  if (heavyByType || heavyByLabel) {
    return { afterWrite: 160, afterOption: 180, afterBlank: 220 };
  }
  return { afterWrite: 50, afterOption: 70, afterBlank: 80 };
}

/**
 * 写一次、对字、把还开着的列表选完、点空白、再读一次。
 * 返回是否这遍已经确认留住。
 */
async function attemptOnce(
  element: HTMLElement,
  label: string,
  intended: string,
  _nextLabel: HTMLElement | null,
  attemptIndex: number,
  widgetHint?: 'text' | 'select' | 'date' | 'rangeDate',
): Promise<boolean> {
  setPlainTextWriteMethod(attemptIndex);
  setWidgetAttemptIndex(attemptIndex);
  const panelsClosed = await ensurePanelsClosed(element);
  if (!panelsClosed) {
    recordFillStep(label, '写入前关窗', '弹层还在', `第${attemptIndex + 1}遍，不再点开`);
    return false;
  }
  const settleMs = settleMsForControl(element, label, widgetHint);
  const beforeText = readControlText(element);
  const controlKind =
    controlKindFromWidgetHint(widgetHint) || classifyControl(element);
  const writeResult = await writeField(
    {
      el: element,
      blob: label,
      control: controlKind,
    },
    intended,
  );
  await wait(settleMs.afterWrite);
  recordFillStep(
    label,
    '写入后',
    fieldStays(element, label, intended) ? '框上已是目标' : '框上还不是目标',
    `第${attemptIndex + 1}遍 之前=${beforeText || '空'} 现在=${readControlText(element) || '空'} ${writeResult.reason || ''}`,
  );
  if (!fieldStays(element, label, intended)) {
    await clickMatchingOpenOption(intended, label, element);
    await wait(settleMs.afterOption);
  }
  if (!fieldStays(element, label, intended)) {
    await ensurePanelsClosed(element);
    return false;
  }
  const openTexts = await collectOpenChoiceTexts(element);
  if (openTexts.length > 0) {
    await clickMatchingOpenOption(intended, label, element);
    await wait(settleMs.afterOption);
    if (!fieldStays(element, label, intended)) {
      await ensurePanelsClosed(element);
      return false;
    }
  }
  const closedAfterSelect = await ensurePanelsClosed(element);
  if (!closedAfterSelect || !fieldStays(element, label, intended)) {
    recordFillStep(
      label,
      '选完关窗',
      closedAfterSelect ? '窗关了但字不对' : '窗还开着',
      `弹层数=${listOpenPanels().length} 框上=${readControlText(element) || '空'}`,
    );
    return false;
  }
  clickBlankArea(element);
  await wait(settleMs.afterBlank);
  if (!fieldStays(element, label, intended)) {
    recordFillStep(label, '点空白后再读', '内容消失', readControlText(element) || '空');
    return false;
  }
  const leftover = await collectOpenChoiceTexts(element);
  if (leftover.length > 0) {
    await ensurePanelsClosed(element);
    return false;
  }
  return writeResult.ok || fieldStays(element, label, intended);
}

/**
 * 快路径写入选项：缩短尝试次数；可带 widget 声明驱动收尾策略。
 */
export interface CommitFieldOptions {
  /** 本格最多尝试次数；缺省用 MAX_ATTEMPTS */
  maxAttempts?: number;
  /** 快路径声明的控件策略；影响等待与 writeField 的 control 分类 */
  widgetHint?: 'text' | 'select' | 'date' | 'rangeDate';
}

/**
 * 把一个空填到确认留住为止。默认三遍；快路径可传入更少次数与 widgetHint。
 */
export async function commitFieldValue(
  element: HTMLElement,
  label: string,
  intended: string,
  nextLabel: HTMLElement | null = null,
  options?: CommitFieldOptions,
): Promise<{ ok: boolean; reason: string }> {
  const text = intended.trim();
  if (!text) {
    return { ok: false, reason: '档案为空' };
  }
  if (fieldStays(element, label, text)) {
    const closed = await ensurePanelsClosed(element);
    if (closed && fieldStays(element, label, text)) {
      recordFillStep(label, '开始', '已是目标值', readControlText(element));
      return { ok: true, reason: '已是目标值' };
    }
  }
  if (!(await ensurePanelsClosed(element))) {
    recordFillStep(label, '开始前关窗', '弹层关不掉', '这一格没有再点开');
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  const attemptLimit = Math.max(1, options?.maxAttempts ?? MAX_ATTEMPTS);
  let lastReason = '未确认填入';
  while ((attemptCountByElement.get(element) ?? 0) < attemptLimit) {
    if (shouldFillStop()) {
      return { ok: false, reason: '已停止' };
    }
    const attemptIndex = attemptCountByElement.get(element) ?? 0;
    attemptCountByElement.set(element, attemptIndex + 1);
    try {
      const stayed = await attemptOnce(
        element,
        label,
        text,
        nextLabel,
        attemptIndex,
        options?.widgetHint,
      );
      if (stayed) {
        return { ok: true, reason: '' };
      }
      lastReason =
        attemptIndex >= attemptLimit - 1
          ? `${attemptLimit}遍后仍未留住或未选中选项`
          : '点空白后内容消失或未选中选项';
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
  if (!(await ensurePanelsClosed(element))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  element.scrollIntoView({ block: 'center' });
  element.click();
  await wait(280);
  const optionTexts = await collectOpenChoiceTexts(element);
  if (optionTexts.length === 0) {
    await ensurePanelsClosed(element);
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
    await ensurePanelsClosed(element);
    return { ok: false, reason: '思考模式没有从列表里选出一项' };
  }
  await ensurePanelsClosed(element);
  return commitFieldValue(element, label, picked);
}

/** 与 dom.AUTOFILL_MISS_CLASS 同值，避免分区重读硬编码分叉 */
const AUTOFILL_MISS_CLASS_NAME = 'raf-autofill-missed';

/**
 * miss 表按标签去重，避免「写入失败」与「分区重读」各记一条。
 */
function pushMissUnique(misses: FillMiss[], label: string, reason: string): void {
  if (misses.some((item) => item.label === label)) {
    return;
  }
  misses.push({ label, reason });
}

/**
 * 分区重读时的单格快照：带上是否走了快路径，便于按格决定是否跳过补写。
 */
export interface RescanCommittedItem {
  element: HTMLElement;
  label: string;
  value: string;
  /** 本格定位是否走了快路径；仅当站点 skipRescan 且本格为真时才跳过补写 */
  usedFastPath?: boolean;
}

/**
 * 分区重读选项：站点可开 skipRescan，但只对 usedFastPath 的格跳过补写。
 */
export interface RescanCommittedOptions {
  /**
   * true=对「本格 usedFastPath」只核对不重写；慢路径格仍补写。
   * 禁止用全局 fastHitCount 一刀切，避免混合路径误伤。
   */
  skipRewriteForFastCells?: boolean;
}

/**
 * 同一分区写完后重读。框被后面的操作清掉时，慢路径格再补一遍。
 * 仅「站点 skipRescan 且本格快路径」跳过补写。
 */
export async function rescanCommittedFields(
  items: RescanCommittedItem[],
  misses: FillMiss[],
  options?: RescanCommittedOptions,
): Promise<number> {
  let stayedCount = 0;
  for (const item of items) {
    if (shouldFillStop()) {
      break;
    }
    if (fieldStays(item.element, item.label, item.value)) {
      stayedCount += 1;
      item.element.classList.remove(AUTOFILL_MISS_CLASS_NAME);
      continue;
    }
    const skipThisCell =
      Boolean(options?.skipRewriteForFastCells) && Boolean(item.usedFastPath);
    if (skipThisCell) {
      pushMissUnique(misses, item.label, '快路径核对未留住');
      item.element.classList.add(AUTOFILL_MISS_CLASS_NAME);
      continue;
    }
    const again = await commitFieldValue(item.element, item.label, item.value);
    if (again.ok) {
      stayedCount += 1;
      item.element.classList.remove(AUTOFILL_MISS_CLASS_NAME);
      continue;
    }
    pushMissUnique(misses, item.label, again.reason || '分区重读后内容不对');
    item.element.classList.add(AUTOFILL_MISS_CLASS_NAME);
  }
  return stayedCount;
}
