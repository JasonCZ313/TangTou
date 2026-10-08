/**
 * 页面写入入口：确认填写后按 FillPlan 写入，但执行时「逐格再绑 → 写 → 回读/Laya」。
 * 有行号的分区字段以档案重绑值为准（用户改过的 plan 值仅作无行号字段的来源），
 * 禁止一口气按脏计划把第1条实习糊进每一块。
 */
import type { FieldDescriptor, FillMiss, FillPlan, SectionAddRequest } from '../../shared/types/fill';
import type { ProfileData } from '../../shared/types/profile';
import type { FileUploadPayload } from '../../shared/types/messages';
import { bindLabeledField } from '../../shared/fill/sectionBinder';
import {
  guessRoleByControlHint,
  isJunkRoleText,
  pickUsableRoleText,
} from '../../shared/fill/fieldRole';
import {
  prepareFieldForWrite,
} from '../scanner/scanFields';
import { fillProfileByCards } from './cardFill';
import { runCommitClicks } from './commitClick';
import { shouldFillStop as isFillStopRequested } from '../fillAbort';
import { dateTextMatches, isCalendarDate, optionMatchAliases } from './chao/rules';
import {
  AUTOFILL_FILL_CLASS,
  AUTOFILL_MISS_CLASS,
  CONTROL,
  classifyControl,
  ensureHighlightStyles,
  fieldLabelBlob,
  isControlEmpty,
  isPageFieldVisible,
  readControlText,
} from './chao/dom';
import { commitFieldValue, commitUnmappedChoice, rescanCommittedFields } from './fieldCommit';
import { rangeSideOfControl } from './chao/widgetDrivers';
import { beginFillTrace, fillTraceText, recordFillStep } from './fillTrace';
import { ensurePanelsClosed } from './chao/widgetDrivers';

/** 单条撤销快照：控件节点与写入前的值 */
interface FillUndoSnapshot {
  element: Element;
  previousValue: string;
  isFile: boolean;
}

/** 整页确认写入的撤销栈（P4a：与框内写入分开） */
let lastPageUndoSnapshots: FillUndoSnapshot[] = [];

/** 框内确认写入的撤销栈（P4a：只还原框内那一轮） */
let lastRegionUndoSnapshots: FillUndoSnapshot[] = [];

/** 写入撤销作用域：整页映射 vs 选区框内 */
export type FillUndoScope = 'page' | 'region';

/** 格间短等待，给站点联动渲染时间 */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 规范化比较：写后回读核对用。
 */
function normalizeCompareText(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '');
}

/**
 * 回读是否与期望一致（允许互相包含，兼容日期短写）。
 */
function readbackMatches(intended: string, actual: string): boolean {
  const want = normalizeCompareText(intended);
  const got = normalizeCompareText(actual);
  if (!want) return false;
  if (isCalendarDate(intended)) {
    return dateTextMatches(intended, actual);
  }
  if (got === want || (got.length >= 2 && want.includes(got)) || (want.length >= 2 && got.includes(want))) {
    return true;
  }
  const aliases = optionMatchAliases(intended).map((item) => normalizeCompareText(item));
  if (aliases.some((alias) => alias && (got.includes(alias) || alias.includes(got)))) {
    return true;
  }
  const stripCity = (text: string) => text.replace(/市/g, '');
  if (stripCity(got) && stripCity(want) && (
    stripCity(got).includes(stripCity(want)) || stripCity(want).includes(stripCity(got))
  )) {
    return true;
  }
  return false;
}

/**
 * 写后可选 Laya 确认：仅高置信否定才打回；未就绪失败开放。
 */
async function confirmCellWithLaya(
  label: string,
  intended: string,
  actual: string,
): Promise<boolean> {
  if (isFillStopRequested()) {
    return false;
  }
  if (!readbackMatches(intended, actual)) {
    return false;
  }
  try {
    const requestId = `apply-laya-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const response = await chrome.runtime.sendMessage({
      type: 'LAYA_CONFIRM_CELL',
      requestId,
      label: label.slice(0, 80),
      intended: intended.slice(0, 200),
      actual: actual.slice(0, 200),
    });
    if (
      response?.type === 'LAYA_CONFIRM_CELL_RESULT'
      && response.ok === false
      && typeof response.confidence === 'number'
      && response.confidence >= 0.85
    ) {
      return false;
    }
  } catch {
    /* 消息失败不挡已回读通过的写入 */
  }
  return true;
}

/**
 * 从 DOM 标签构造最小 FieldDescriptor，供 bindLabeledField 再绑。
 */
function descriptorFromElement(fieldId: string, element: HTMLElement, labelText: string): FieldDescriptor {
  const optionsAttr = element.getAttribute('data-raf-options');
  let options: string[] | undefined;
  if (optionsAttr) {
    try {
      const parsed = JSON.parse(optionsAttr) as unknown;
      if (Array.isArray(parsed)) {
        options = parsed.map((item) => String(item));
      }
    } catch {
      options = undefined;
    }
  }
  return {
    fieldId,
    tag: element.tagName.toLowerCase(),
    type: element instanceof HTMLInputElement ? element.type || 'text' : element.tagName.toLowerCase(),
    label: labelText,
    options,
    selectorHint: 'input',
  };
}

/**
 * 写入前现场刷新角色名：禁止带着「第N行请输入」去再绑（会误判档案空并吞掉计划值）。
 */
function refreshLabelBeforeRebind(element: HTMLElement): string {
  const storedLabel = element.getAttribute('data-raf-label') || '';
  const rowPrefixMatch = storedLabel.match(/^(.*?第\d+行)/);
  const rowPrefix = rowPrefixMatch?.[1] ?? '';
  const previousRole = storedLabel.replace(/^.*?第\d+行/, '');
  const blob = fieldLabelBlob(element);
  const blobParts = String(blob || '')
    .split(/\s+/)
    .map((part) => part.replace(/\s+/g, ''))
    .filter((part) => part.length >= 2 && part.length <= 16 && !isJunkRoleText(part));
  const ariaLabel = element.getAttribute('aria-label') || '';
  let roleLabel = pickUsableRoleText(previousRole, ariaLabel, ...blobParts, blob);
  if (!roleLabel) {
    const isTextArea =
      element instanceof HTMLTextAreaElement
      || (element.getAttribute('role') === 'textbox'
        && element.getAttribute('aria-multiline') === 'true');
    const dateCue = `${ariaLabel}${blob}${element.getAttribute('placeholder') || ''}`;
    const isDateLike =
      /时间|日期|年月|生日|日历/.test(dateCue)
      || Boolean(element.closest('[class*="picker" i], [class*="date" i], [class*="calendar" i]'));
    const isDateEnd =
      /结束|截止|离职|毕业|获得/.test(dateCue) && !/开始|起始|入学|入职/.test(dateCue);
    roleLabel = guessRoleByControlHint({ isTextArea, isDateLike, isDateEnd }) || '字段';
  }
  const nextLabel = rowPrefix ? `${rowPrefix}${roleLabel}` : roleLabel;
  if (nextLabel && nextLabel !== storedLabel) {
    element.setAttribute('data-raf-label', nextLabel);
  }
  return nextLabel || storedLabel || blob || '';
}

/**
 * 决定本格最终写入值：有行号则强制按档案重绑；再绑因垃圾标签失败时回落 plan，禁止吞掉已有计划值。
 */
function resolveWriteValue(
  fieldId: string,
  planValue: string,
  element: HTMLElement,
  profileData: ProfileData | undefined,
): { value: string; reason: string; skip?: string } {
  const labelText = refreshLabelBeforeRebind(element);
  const roleOnly = labelText.replace(/^.*?第\d+行/, '');
  if (!profileData || !labelText) {
    return { value: planValue, reason: '计划值' };
  }
  const rangeSide = rangeSideOfControl(element);
  const bound = bindLabeledField(
    descriptorFromElement(fieldId, element, labelText),
    profileData,
    rangeSide === 'end' || rangeSide === 'start' ? rangeSide : undefined,
  );
  if (bound?.kind === 'skip') {
    // 标签仍垃圾/角色未知时：计划里已有值就接着写，不能因「请输入」把学校单位清掉
    if (planValue.trim() && (isJunkRoleText(roleOnly) || /请输入|请选择|请填写|字段/.test(roleOnly))) {
      return { value: planValue, reason: '再绑标签不可靠，回落计划值' };
    }
    return { value: '', reason: bound.reason, skip: bound.reason };
  }
  if (bound?.kind === 'value' && bound.value.trim()) {
    // 有行号重绑成功：以档案为准（防止计划把第1条糊到第2行）
    if (/第\d+行/.test(labelText)) {
      return { value: bound.value, reason: bound.reason };
    }
  }
  return { value: planValue, reason: '计划值' };
}

/**
 * 按标签行号排序：先第1行再第2行，同行内保持 plan 原序。
 */
function sortItemsByRowLabel(
  items: FillPlan['items'],
  resolveLabel: (fieldId: string) => string,
): FillPlan['items'] {
  return [...items].sort((left, right) => {
    const leftLabel = resolveLabel(left.fieldId);
    const rightLabel = resolveLabel(right.fieldId);
    const leftRow = Number(leftLabel.match(/第(\d+)行/)?.[1] ?? 0);
    const rightRow = Number(rightLabel.match(/第(\d+)行/)?.[1] ?? 0);
    if (leftRow !== rightRow) {
      return leftRow - rightRow;
    }
    return 0;
  });
}

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
  fillScope: FillUndoScope,
  append = false,
): void {
  const targetStack =
    fillScope === 'region' ? lastRegionUndoSnapshots : lastPageUndoSnapshots;
  if (!append) {
    if (fillScope === 'region') {
      lastRegionUndoSnapshots = [];
    } else {
      lastPageUndoSnapshots = [];
    }
  }
  const seen = new WeakSet<Element>();
  for (const snapshot of targetStack) {
    seen.add(snapshot.element);
  }
  for (const node of elements) {
    if (!(node instanceof HTMLElement) || seen.has(node)) {
      continue;
    }
    seen.add(node);
    const isFile = node instanceof HTMLInputElement && node.type === 'file';
    const snapshot: FillUndoSnapshot = {
      element: node,
      previousValue: readElementValue(node),
      isFile,
    };
    if (fillScope === 'region') {
      lastRegionUndoSnapshots.push(snapshot);
    } else {
      lastPageUndoSnapshots.push(snapshot);
    }
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
function applyFilePayloads(
  filePayloads: FileUploadPayload[],
  fillScope: FillUndoScope,
): {
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
    captureUndoSnapshotsForElements([matched], fillScope, true);
    if (assignFilePayload(matched, payload)) {
      filled += 1;
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
 * 确认写入：补行 → 全量重标行号 → 按行序逐格再绑 → 写 → 回读/Laya → 再写下一项。
 */
export async function applyFillPlan(
  plan: FillPlan,
  filePayloads: FileUploadPayload[] = [],
  _profileId?: string,
  _sectionAdds: SectionAddRequest[] = [],
  profileData?: ProfileData,
  fillScope: FillUndoScope = 'page',
): Promise<{
  filled: number;
  skipped: number;
  misses: FillMiss[];
  trace?: string;
}> {
  ensureHighlightStyles();
  beginFillTrace();
  const { updatePageOverlay, hidePageOverlay } = await import('../ui/pageOverlay');
  const { shouldFillStop } = await import('../fillAbort');

  // 不在写入前一次性加满空行；按「填完一行再添加一行」增长。

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

  const labelOf = (fieldId: string) => resolveMissLabel(fieldId);
  const orderedItems = sortItemsByRowLabel(
    writableItems.filter((item) => !item.attachmentId),
    labelOf,
  );

  if (fillScope === 'region') {
    lastRegionUndoSnapshots = [];
  } else {
    lastPageUndoSnapshots = [];
  }

  let filled = 0;
  const misses: FillMiss[] = [];
  const totalWriteSteps = Math.max(orderedItems.length, 1);
  let writeStepIndex = 0;
  let currentGroupKey = '';
  let currentGroup: Array<{ element: HTMLElement; label: string; value: string }> = [];

  const flushGroup = async () => {
    if (currentGroup.length === 0) {
      return;
    }
    const stayed = await rescanCommittedFields(currentGroup, misses);
    filled += stayed;
    currentGroup = [];
  };

  for (const item of orderedItems) {
    if (shouldFillStop()) {
      misses.push({
        label: '用户停止',
        reason: '已按停止请求中断写入',
      });
      break;
    }
    writeStepIndex += 1;
    const element = await prepareFieldForWrite(item.fieldId);
    const labelText = resolveMissLabel(item.fieldId, element);
    updatePageOverlay({
      percent: Math.min(88, Math.round((writeStepIndex / totalWriteSteps) * 80) + 5),
      message: `正在写入并核对：${labelText}`,
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

    captureUndoSnapshotsForElements([element], fillScope, true);

    const resolved = resolveWriteValue(
      item.fieldId,
      item.value,
      element,
      profileData,
    );
    const liveLabel =
      element.getAttribute('data-raf-label') || labelText;
    const groupKey = liveLabel.match(/第\d+行/)?.[0] ?? '未分行';
    if (currentGroupKey && groupKey !== currentGroupKey) {
      await flushGroup();
    }
    currentGroupKey = groupKey;
    if (resolved.skip || !resolved.value.trim()) {
      misses.push({
        label: liveLabel,
        reason: resolved.skip || '再绑后无值，已跳过',
      });
      element.classList.add(AUTOFILL_MISS_CLASS);
      await settle(40);
      continue;
    }

    const nextItem = orderedItems[writeStepIndex];
    const nextElement = nextItem ? await prepareFieldForWrite(nextItem.fieldId) : null;
    const nextLabelNode = nextElement instanceof HTMLElement
      ? nextElement.closest('label') as HTMLElement | null
      : null;
    const writeResult = await commitFieldValue(element, liveLabel, resolved.value, nextLabelNode);
    recordFillStep(
      liveLabel,
      '收尾',
      writeResult.ok ? '留下了' : '没留下',
      writeResult.reason || readControlText(element),
    );
    currentGroup.push({ element, label: liveLabel, value: resolved.value });
    if (!writeResult.ok) {
      element.classList.add(AUTOFILL_MISS_CLASS);
    } else {
      element.classList.remove(AUTOFILL_MISS_CLASS);
    }
    await settle(80);
  }
  await flushGroup();

  const panelsClosedForFollowUp = !shouldFillStop() && await ensurePanelsClosed();
  if (panelsClosedForFollowUp) {
    updatePageOverlay({
      percent: 90,
      message: '正在核对没有档案值的下拉…',
      showCancel: true,
    });
    const plannedIds = new Set(orderedItems.map((item) => item.fieldId));
    const unmapped = [...document.querySelectorAll('[data-raf-id]')].filter((node) => {
      if (!(node instanceof HTMLElement) || !isPageFieldVisible(node) || !isControlEmpty(node)) {
        return false;
      }
      const fieldId = node.getAttribute('data-raf-id') || '';
      return fieldId && !plannedIds.has(fieldId);
    });
    for (const node of unmapped) {
      if (shouldFillStop() || !(node instanceof HTMLElement)) {
        break;
      }
      const controlKind = classifyControl(node);
      if (controlKind !== CONTROL.optionWidget && controlKind !== CONTROL.nativeSelect) {
        continue;
      }
      const unmappedLabel = node.getAttribute('data-raf-label') || fieldLabelBlob(node);
      const unmappedResult = await commitUnmappedChoice(node, unmappedLabel);
      if (unmappedResult.ok) {
        filled += 1;
      }
    }
  }

  // 计划没覆盖到的格子（例如性别）仍按卡片补。框内写入只跟预览计划，不做卡片补写（避免撤销栈错位）。
  if (profileData && panelsClosedForFollowUp && fillScope !== 'region') {
    const cardFilled = await fillProfileByCards(profileData, misses, (message) => {
      updatePageOverlay({
        percent: 93,
        message,
        showCancel: true,
      });
    });
    filled += cardFilled;
  } else if (profileData) {
    recordFillStep('卡片补写', '开始前关窗', '弹层关不掉', '这一遍没有再点');
  }

  if (!shouldFillStop() && fillScope !== 'region') {
    updatePageOverlay({
      percent: 95,
      message: '正在点击确定和保存…',
      showCancel: true,
    });
    await runCommitClicks();
  }

  if (!shouldFillStop()) {
    updatePageOverlay({
      percent: 96,
      message: '正在处理附件上传…',
      showCancel: true,
    });
  }
  const fileResult = applyFilePayloads(filePayloads, fillScope);
  updatePageOverlay({
    percent: 100,
    message: shouldFillStop()
      ? '已停止写入'
      : `写入完成：成功 ${filled + fileResult.filled} 项`,
    showCancel: false,
  });
  window.setTimeout(() => {
    hidePageOverlay();
  }, 1600);

  return {
    filled: filled + fileResult.filled,
    skipped: plan.skippedFieldIds.length,
    misses: [...misses, ...fileResult.misses],
    trace: fillTraceText(),
  };
}

/**
 * 撤销上一轮：普通控件还原快照；file 只能清空（清除本轮上传）。
 */
/**
 * 按作用域撤销上一轮写入：整页与框内互不影响（P4a）。
 */
export function undoLastFill(
  fillScope: FillUndoScope = 'page',
): { restored: number; clearedFiles: number } {
  const snapshots =
    fillScope === 'region' ? lastRegionUndoSnapshots : lastPageUndoSnapshots;
  let restored = 0;
  let clearedFiles = 0;
  for (const snapshot of snapshots) {
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
  if (fillScope === 'region') {
    lastRegionUndoSnapshots = [];
  } else {
    lastPageUndoSnapshots = [];
  }
  return { restored, clearedFiles };
}
