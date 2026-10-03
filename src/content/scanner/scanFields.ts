import type { FieldDescriptor } from '../../shared/types/fill';
import { textHasRowNameAnchor } from '../../shared/fill/rowAnchors';
import {
  guessRoleByControlHint,
  isJunkRoleText,
  pickUsableRoleText,
} from '../../shared/fill/fieldRole';
import { getActiveSiteAdapter } from '../adapters/registry';
import { adapterAllowsAddLabel } from '../adapters/types';
import { shouldFillStop } from '../fillAbort';
import { fieldLabelBlob } from '../filler/chao/dom';

/** 扫描时跳过的 input type，避免误填密码或触发按钮类控件 */
const SKIPPED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'image',
  'password',
]);

/**
 * 扫描时记下的字段：元素、把它点出来的按钮，以及用来重找的标签和 name。
 * 页面把编辑框收起后，写入阶段靠 opener 再点开，并按标签对上原来的字段。
 */
interface TrackedField {
  element: Element;
  opener: HTMLElement | null;
  label: string;
  name: string;
  /** 扫到时的内容。编辑层关掉再打开时，用它认出是不是同一个框，避免重复计数 */
  valueSnapshot: string;
}

/**
 * 会话内 fieldId → DOM 元素映射。
 * 扫描时写入，回填时按 fieldId 精确定位，不依赖脆弱的唯一 selector。
 */
const fieldElementById = new Map<string, Element>();

/** fieldId → 打开方式与标签，供写入时字段已被卸载后重找 */
const fieldTracks = new Map<string, TrackedField>();

/**
 * 判断元素在页面上是否可见；无布局矩形则视为不可见并跳过。
 */
function isElementVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * 右侧申请导航里的「实习经历」不是表单标题。
 * 用它当边界会把真正的卡片划到区块外面，添加后就填不到。
 */
function isNavigationChrome(node: HTMLElement): boolean {
  if (node.closest('nav, aside, [role="navigation"]')) {
    return true;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.width < 160 && rect.left > window.innerWidth * 0.75;
}

/**
 * 从 label 元素提取纯文本：去掉内部控件节点，避免 input 当前值污染标签。
 */
function extractCleanLabelText(labelElement: Element): string {
  const clonedLabel = labelElement.cloneNode(true) as HTMLElement;
  clonedLabel
    .querySelectorAll('input, select, textarea, button')
    .forEach((nestedControl) => {
      nestedControl.remove();
    });
  return (clonedLabel.textContent ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * 按优先级解析字段的人类可读标签：
 * htmlFor 关联 label → 清洁后的包裹 label → aria-label → placeholder → name。
 */
function resolveFieldLabel(element: Element): string {
  if (element instanceof HTMLElement && element.id) {
    const rootNode = element.getRootNode();
    const labelForElement =
      rootNode instanceof Document || rootNode instanceof ShadowRoot
        ? rootNode.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        : null;
    if (labelForElement) {
      const labelText = extractCleanLabelText(labelForElement);
      if (labelText) {
        return labelText;
      }
    }
  }

  const wrappingLabel = element.closest('label');
  if (wrappingLabel) {
    const labelText = extractCleanLabelText(wrappingLabel);
    if (labelText) {
      return labelText;
    }
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledById = element.getAttribute('aria-labelledby')?.split(/\s+/)[0];
  if (labelledById) {
    const rootNode = element.getRootNode();
    const labelledByElement =
      rootNode instanceof Document || rootNode instanceof ShadowRoot
        ? rootNode.getElementById(labelledById)
        : null;
    const labelledByText = (labelledByElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (labelledByText && labelledByText.length <= 24) {
      return labelledByText;
    }
  }

  const formItem = element.closest(
    '.ant-form-item, .el-form-item, .van-cell, .form-group, .form-item',
  );
  const formItemLabel = formItem?.querySelector(
    '.ant-form-item-label, .el-form-item__label, .van-field__label, label',
  );
  if (formItemLabel && !formItemLabel.contains(element)) {
    const formItemText = extractCleanLabelText(formItemLabel);
    if (formItemText && formItemText.length <= 24) {
      return formItemText;
    }
  }

  const previousSibling = element.previousElementSibling;
  if (
    previousSibling &&
    !(previousSibling instanceof HTMLInputElement) &&
    !(previousSibling instanceof HTMLSelectElement) &&
    !(previousSibling instanceof HTMLTextAreaElement)
  ) {
    const previousText = (previousSibling.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (previousText.length >= 2 && previousText.length <= 16) {
      return previousText;
    }
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const placeholderText = element.placeholder?.trim();
    if (placeholderText) {
      return placeholderText;
    }
  }

  const nameAttribute =
    element.getAttribute('name')?.trim() ||
    (element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.name?.trim()
      : undefined);
  if (nameAttribute) {
    return nameAttribute;
  }

  return element.tagName.toLowerCase();
}

/**
 * 生成辅助定位提示（非唯一依赖）：优先 id、name，否则退回标签名与 type。
 */
function buildSelectorHint(element: Element): string {
  if (element instanceof HTMLElement && element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const nameAttribute = element.getAttribute('name');
  if (nameAttribute) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(nameAttribute)}"]`;
  }

  const inputType =
    element instanceof HTMLInputElement ? element.type : undefined;
  if (inputType) {
    return `${element.tagName.toLowerCase()}[type="${inputType}"]`;
  }

  return element.tagName.toLowerCase();
}

/**
 * 读取控件当前值；select 取选中项，checkbox/radio 取 checked 状态，其余取 value/textContent。
 */
function readCurrentValue(element: Element): string | undefined {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? element.value || 'true' : '';
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return element.textContent ?? '';
  }
  return undefined;
}

/**
 * 收集 select 下各 option 的展示文案，供模型做选项匹配。
 */
function collectSelectOptions(selectElement: HTMLSelectElement): string[] {
  return Array.from(selectElement.options)
    .map((optionElement) => optionElement.textContent?.trim() || optionElement.value)
    .filter((optionText) => optionText.length > 0);
}

/**
 * 将单个 DOM 元素转为 FieldDescriptor，并登记到会话内 fieldId 映射表。
 * opener 是扫描时把它点出来的「编辑 / 添加」按钮；本来就看得见的字段为 null。
 */
function describeField(
  element: Element,
  opener: HTMLElement | null = null,
): FieldDescriptor {
  const fieldId = crypto.randomUUID();
  fieldElementById.set(fieldId, element);

  const tag = element.tagName.toLowerCase();
  let type = tag;
  if (element instanceof HTMLInputElement) {
    type = element.type || 'text';
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    type = 'contenteditable';
  }

  const nameAttribute =
    element.getAttribute('name') ||
    (element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.name || undefined
      : undefined);

  const placeholder =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder || undefined
      : undefined;

  const required =
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.required
      : undefined;

  const descriptor: FieldDescriptor = {
    fieldId,
    tag,
    type,
    label: resolveFieldLabel(element),
    selectorHint: buildSelectorHint(element),
  };

  if (nameAttribute) {
    descriptor.name = nameAttribute;
  }
  if (placeholder) {
    descriptor.placeholder = placeholder;
  }
  if (element instanceof HTMLSelectElement) {
    descriptor.options = collectSelectOptions(element);
  }
  const currentValue = readCurrentValue(element);
  if (currentValue !== undefined) {
    descriptor.currentValue = currentValue;
  }
  if (required !== undefined) {
    descriptor.required = required;
  }

  if (element instanceof HTMLElement) {
    element.setAttribute('data-raf-id', fieldId);
    element.setAttribute('data-raf-label', descriptor.label);
  }
  fieldTracks.set(fieldId, {
    element,
    opener,
    label: descriptor.label,
    name: descriptor.name ?? '',
    valueSnapshot: readCurrentValue(element) ?? '',
  });

  return descriptor;
}

/**
 * 判断候选节点是否应纳入扫描结果（类型黑名单 + 可见性）。
 */
function shouldIncludeElement(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    if (SKIPPED_INPUT_TYPES.has(element.type.toLowerCase())) {
      return false;
    }
    // 年月下拉里的搜索框本身看不见，改记外面的选择框，避免点不中「年」「月」。
    if (element.closest('.ant-select, .el-select')) {
      return false;
    }
  }
  if (element instanceof HTMLElement && element.matches('.ant-select, .el-select')) {
    if (element.parentElement?.closest('.ant-select, .el-select')) {
      return false;
    }
  }
  return isElementVisible(element);
}

/**
 * 按 fieldId 取回扫描时登记的 DOM 元素；元素已从文档卸载时返回 undefined。
 * 供 filler 模块在回填 / 撤销时精确定位控件。
 */
export function resolveFieldElement(fieldId: string): Element | undefined {
  const element = fieldElementById.get(fieldId);
  if (!element || !element.isConnected) {
    return undefined;
  }
  return element;
}

/** 安静这么久就认为表单加载完了 */
const SCAN_QUIET_MS = 450;
/** 后加载表单最多再等这么久 */
const SCAN_MAX_WAIT_MS = 1500;

/**
 * 等 DOM 安静一小段时间，或到达上限。用来接住稍后插入的网申表单。
 */
export function waitForFormSettle(rootDocument: Document = document): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let quietTimer = window.setTimeout(finish, SCAN_QUIET_MS);
    const maxTimer = window.setTimeout(finish, SCAN_MAX_WAIT_MS);
    /** 停止后尽快结束安静等待，避免点停止还卡在 MutationObserver 里 */
    const stopPollTimer = window.setInterval(() => {
      if (shouldFillStop()) {
        finish();
      }
    }, 120);
    const observer = new MutationObserver(() => {
      if (shouldFillStop()) {
        finish();
        return;
      }
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, SCAN_QUIET_MS);
    });

    /**
     * 结束等待并断开观察，只执行一次。
     */
    function finish(): void {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      window.clearInterval(stopPollTimer);
      resolve();
    }

    observer.observe(rootDocument.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

/** 最近一次从整页收集控件时，读不到的跨域框架数量 */
let lastUnreachableFrameCount = 0;

/**
 * 收集普通文档、开放 Shadow DOM 和同源 iframe 里的表单控件。
 */
function collectFormControls(root: ParentNode): Element[] {
  const controls: Element[] = [];
  const visitedRoots = new Set<ParentNode>();
  const selector = 'input, textarea, select, [contenteditable="true"], .ant-select, .el-select';
  let unreachableFrameCount = 0;

  /**
   * 遍历一个根节点，并继续进入其开放影子树和同源框架。
   */
  const visit = (node: ParentNode): void => {
    if (visitedRoots.has(node)) {
      return;
    }
    visitedRoots.add(node);
    controls.push(...Array.from(node.querySelectorAll(selector)));
    const elements = node.querySelectorAll('*');
    for (const element of elements) {
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            visit(element.contentDocument);
          } else if (element.src) {
            const frameUrl = new URL(element.src, window.location.href);
            if (frameUrl.origin !== window.location.origin) {
              unreachableFrameCount += 1;
            }
          }
        } catch {
          unreachableFrameCount += 1;
        }
      }
    }
  };

  visit(root);
  if (root === document) {
    lastUnreachableFrameCount = unreachableFrameCount;
  }
  return controls;
}

/**
 * 扫描 root（默认 document）下可见的表单控件，返回 FieldDescriptor 列表，
 * 并刷新本会话的 fieldId → Element 映射供后续回填使用。
 */
export function scanFields(root: ParentNode = document): FieldDescriptor[] {
  fieldElementById.clear();
  fieldTracks.clear();
  const candidates = collectFormControls(root);
  const fields: FieldDescriptor[] = [];

  for (const candidate of candidates) {
    if (!shouldIncludeElement(candidate)) {
      continue;
    }
    fields.push(describeField(candidate));
  }

  return fields;
}

/** 同一个滚动区域最多滚这么多档，避免无限加载停不下来 */
const MAX_SCROLL_STEPS = 80;
/** 只滚可滚动距离最长的几块，避免被页面顶部的小区域占满 */
const MAX_SCROLL_TARGETS = 3;
/** 整次扫描的时间上限，到点把已经发现的输入框交回去 */
const SCAN_BUDGET_MS = 90_000;
/** 每一档滚动后留给懒加载的时间 */
const SCROLL_PAUSE_MS = 160;
/** 点开编辑类按钮的上限。Boss 直聘一类页面每个模块都要点一次编辑 */
const MAX_EDIT_CLICKS = 24;
/** 点开后等新控件出现 */
const CLICK_PAUSE_MS = 280;

/** 这些字样是提交、跳转或破坏性操作，扫描时一律不点 */
const BLOCKED_REVEAL_TEXT =
  /提交|保存|完成|确定|下一步|上一步|发送|投递|登录|注册|确认|取消|删除|移除|关闭|submit|save|next|prev|send|apply|delete|remove|cancel/i;
/** 把已有内容展开成可编辑框的按钮，含铅笔图标的 class / aria */
const EDIT_REVEAL_TEXT = /编辑|修改|\bedit\b|pencil|铅笔/i;
/** 折叠面板上像表单分区的文案，才允许点开 */
const SECTION_TOGGLE_TEXT =
  /展开|更多|编辑|填写|基本信息|教育|工作|实习|项目|证书|获奖|经历/;

/**
 * 等待固定毫秒。用于滚动和点开之后让新控件进入 DOM。
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * 读取按钮或链接上能判断用途的文字：无障碍名称、title、可见文字和 class。
 */
function revealText(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label') ?? '';
  const title = element.getAttribute('title') ?? '';
  const visibleText = (element.innerText ?? '').replace(/\s+/g, ' ').trim();
  const className = typeof element.className === 'string' ? element.className : '';
  return `${ariaLabel} ${title} ${visibleText} ${className}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * 点开编辑或添加，但不让表单被提交。
 * 没写 type 的 button 在表单里默认会提交，这里先临时改成 button 再点，点完改回。
 */
function clickWithoutSubmitting(element: HTMLElement): void {
  if (element instanceof HTMLButtonElement) {
    const previousType = element.type;
    element.type = 'button';
    element.click();
    element.type = previousType;
    return;
  }
  element.click();
}

/**
 * 判断这个控件能不能安全点开。
 * 明确的重置按钮不点；会换页面的链接也不点。
 * 提交类文案在调用处另有拦截，编辑按钮即使原来是提交类型也会先改成普通按钮。
 */
function isSafeRevealTarget(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement && element.type === 'reset') {
    return false;
  }

  const anchor = element.closest('a[href]');
  if (anchor instanceof HTMLAnchorElement) {
    const href = anchor.getAttribute('href') ?? '';
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      return false;
    }
  }

  return true;
}

/**
 * 展开 details，并点开文案像表单分区、且当前是收起状态的按钮。
 */
function openCollapsedPanels(): void {
  let openedDetails = 0;
  for (const item of document.querySelectorAll('details:not([open])')) {
    if (!(item instanceof HTMLDetailsElement)) {
      continue;
    }
    item.open = true;
    openedDetails += 1;
    if (openedDetails >= 40) {
      break;
    }
  }

  let openedToggles = 0;
  for (const toggle of document.querySelectorAll('[aria-expanded="false"]')) {
    if (!(toggle instanceof HTMLElement)) {
      continue;
    }
    if (!isElementVisible(toggle) || !isSafeRevealTarget(toggle)) {
      continue;
    }
    const text = revealText(toggle);
    if (!text || BLOCKED_REVEAL_TEXT.test(text)) {
      continue;
    }
    if (!SECTION_TOGGLE_TEXT.test(text) && !EDIT_REVEAL_TEXT.test(text)) {
      continue;
    }
    toggle.click();
    openedToggles += 1;
    if (openedToggles >= 12) {
      break;
    }
  }
}

/**
 * 编辑层关掉后节点会卸掉。再次点开同一块时，按标签、name 和当时的内容接回原字段，不另计一条。
 */
function reuseDisconnectedField(element: Element, opener: HTMLElement | null): boolean {
  const label = resolveFieldLabel(element);
  const name = element.getAttribute('name') ?? '';
  const valueSnapshot = readCurrentValue(element) ?? '';
  for (const [fieldId, track] of fieldTracks) {
    if (track.element.isConnected) {
      continue;
    }
    if (track.label !== label || track.name !== name) {
      continue;
    }
    if (track.valueSnapshot !== valueSnapshot) {
      continue;
    }
    track.element = element;
    track.opener = opener ?? track.opener;
    fieldElementById.set(fieldId, element);
    return true;
  }
  return false;
}

/**
 * 把当前已经露出来的控件登记进结果。同一个元素只登记一次。
 * 编辑层重新打开时接回已卸掉的字段，避免同一块被数两遍。
 */
function absorbVisibleFields(
  opener: HTMLElement | null,
  fields: FieldDescriptor[],
  seenElements: WeakSet<Element>,
): void {
  for (const candidate of collectFormControls(document)) {
    if (seenElements.has(candidate) || !shouldIncludeElement(candidate)) {
      continue;
    }
    seenElements.add(candidate);
    if (reuseDisconnectedField(candidate, opener)) {
      continue;
    }
    fields.push(describeField(candidate, opener));
  }
}

/** 某个滚动目标当前滚到哪、最远能滚多远 */
interface ScrollMetrics {
  top: number;
  maxTop: number;
  height: number;
  client: number;
}

/**
 * 读取窗口或某块区域的滚动位置。maxTop 为 0 表示这块本身滚不动。
 */
function readScrollMetrics(target: HTMLElement | Window): ScrollMetrics {
  if (target === window) {
    const scrollingRoot = document.scrollingElement ?? document.documentElement;
    const client = window.innerHeight || 800;
    return {
      top: window.scrollY,
      maxTop: Math.max(0, scrollingRoot.scrollHeight - client),
      height: scrollingRoot.scrollHeight,
      client,
    };
  }
  return {
    top: target.scrollTop,
    maxTop: Math.max(0, target.scrollHeight - target.clientHeight),
    height: target.scrollHeight,
    client: target.clientHeight,
  };
}

/**
 * 把滚动位置设到指定处。
 */
function writeScrollTop(target: HTMLElement | Window, nextTop: number): void {
  if (target === window) {
    window.scrollTo(0, nextTop);
    return;
  }
  target.scrollTop = nextTop;
}

/**
 * 给滚动区域起一个能写进进度里的短名字。
 */
function scrollerLabel(target: HTMLElement | Window): string {
  if (target === window) {
    return '整页';
  }
  const ariaLabel = target.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel.slice(0, 18);
  }
  if (target.id) {
    return target.id.slice(0, 18);
  }
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'main' || tagName === 'form' || tagName === 'section') {
    return tagName;
  }
  return '页面中的滚动区域';
}

/**
 * 找出可滚动距离最长的几块。按能滚多远排序，不再按文档顺序取前几个小区域。
 */
function listLargestScrollers(): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  const nodes = document.querySelectorAll('main, form, section, article, div, ul');
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node.clientHeight < 160) {
      continue;
    }
    const capacity = node.scrollHeight - node.clientHeight;
    if (capacity < 80) {
      continue;
    }
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
      continue;
    }
    candidates.push(node);
  }
  candidates.sort(
    (left, right) =>
      right.scrollHeight -
      right.clientHeight -
      (left.scrollHeight - left.clientHeight),
  );
  const chosen: HTMLElement[] = [];
  for (const candidate of candidates) {
    const overlapsChosen = chosen.some(
      (item) => item.contains(candidate) || candidate.contains(item),
    );
    if (overlapsChosen) {
      continue;
    }
    chosen.push(candidate);
    if (chosen.length >= MAX_SCROLL_TARGETS) {
      break;
    }
  }
  return chosen;
}

/**
 * 先滚回这块的最顶部。从页面中间开始扫时，上面的空框还没出现，必须先往上多滚几档。
 * 位置不再减小才停，避免有的页面一次设到 0 却没真正上去。
 */
async function scrollTargetToTop(
  target: HTMLElement | Window,
  onStep: (top: number, maxTop: number) => void,
  shouldStop: () => boolean,
  maxSteps = 16,
): Promise<void> {
  let stuckRounds = 0;
  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (shouldStop()) {
      return;
    }
    const before = readScrollMetrics(target);
    onStep(before.top, before.maxTop);
    if (before.top <= 2) {
      writeScrollTop(target, 0);
      await wait(SCROLL_PAUSE_MS);
      return;
    }
    const step = Math.max(280, Math.floor(before.client * 0.85));
    writeScrollTop(target, Math.max(0, before.top - step));
    await wait(SCROLL_PAUSE_MS);
    const after = readScrollMetrics(target);
    if (after.top >= before.top - 2) {
      stuckRounds += 1;
      if (stuckRounds >= 2) {
        writeScrollTop(target, 0);
        await wait(SCROLL_PAUSE_MS);
        return;
      }
    } else {
      stuckRounds = 0;
    }
  }
  writeScrollTop(target, 0);
  await wait(SCROLL_PAUSE_MS);
}

/**
 * 往下滚到真正到底：位置不再增加、高度也不再变长，才停。
 * 懒加载把内容撑高时会继续滚。返回停下时的百分比。
 */
async function scrollTargetToEnd(
  target: HTMLElement | Window,
  onStep: (top: number, maxTop: number) => void,
  shouldStop: () => boolean,
): Promise<number> {
  let stuckRounds = 0;
  for (let stepIndex = 0; stepIndex < MAX_SCROLL_STEPS; stepIndex += 1) {
    if (shouldStop()) {
      break;
    }
    const before = readScrollMetrics(target);
    onStep(before.top, before.maxTop);
    if (before.maxTop <= 8) {
      return 100;
    }
    const step = Math.max(220, Math.floor(before.client * 0.72));
    writeScrollTop(target, Math.min(before.maxTop, before.top + step));
    await wait(SCROLL_PAUSE_MS);
    const after = readScrollMetrics(target);
    onStep(after.top, after.maxTop);
    const reachedEnd = after.top >= after.maxTop - 4;
    const stoppedMoving = after.top <= before.top + 2 && after.height <= before.height + 8;
    if (reachedEnd || stoppedMoving) {
      stuckRounds += 1;
      if (stuckRounds >= 2) {
        const percent = after.maxTop <= 0 ? 100 : Math.round((after.top / after.maxTop) * 100);
        return Math.max(0, Math.min(100, percent));
      }
    } else {
      stuckRounds = 0;
    }
  }
  const finalMetrics = readScrollMetrics(target);
  if (finalMetrics.maxTop <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((finalMetrics.top / finalMetrics.maxTop) * 100)));
}

/** 简历模块标题。悬停这些标题附近，让「编辑」按钮被脚本挂出来 */
const SECTION_HEADING_TEXT =
  /^(个人优势|个人介绍|自我评价|期望职位|求职意向|工作经历|工作\/实习经历|实习经历|教育经历|项目经历|项目经验|资格证书|专业技能|技能特长|培训经历|志愿者经历|荣誉奖项|所获荣誉)$/;

/** 节点自己的文字就是编辑，不含子节点里的「删除」 */
const EDIT_OWN_TEXT = /^(编辑|修改|edit)$/i;

/**
 * 节点自己的文字是添加。允许「+ 添加」「添加经历」，拒绝整段说明文字。
 * 有站点适配器时额外认「新增」等白名单词，并排除保存/提交。
 */
function isAddControlText(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length > 16) {
    return false;
  }
  if (/删除|保存|提交|确定|取消|上传/.test(compact)) {
    return false;
  }
  const siteAdapter = getActiveSiteAdapter();
  if (siteAdapter) {
    return adapterAllowsAddLabel(siteAdapter, compact);
  }
  return /^[+＋]?(添加|新增|增加)/.test(compact);
}

/**
 * 只取元素自己的文本节点，不把子按钮的「删除」「完成」算进来。
 */
function ownText(element: HTMLElement): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 判断按钮是否被禁用。禁用的编辑不点，避免绕过站点自己的步骤限制。
 */
function isRevealDisabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  return element instanceof HTMLButtonElement && element.disabled;
}

/**
 * class 像铅笔或 edit 图标，且不是「editor」这种整块容器。
 */
function classLooksLikeEditIcon(element: HTMLElement): boolean {
  const className = typeof element.className === 'string' ? element.className : '';
  if (!/(?:^|[^a-z])(edit|pencil)(?:[^a-z]|$)/i.test(className)) {
    return false;
  }
  if (element.childElementCount > 2) {
    return false;
  }
  return (element.textContent ?? '').trim().length < 8;
}

/**
 * 这个节点是不是可以点的「编辑」或空区块「添加」。
 * 编辑允许隐藏：Boss 直聘要鼠标放上去才显示，样式上的悬停用脚本拨不出来，所以直接点隐藏节点。
 */
function classifyRevealTarget(element: HTMLElement): 'edit' | 'add' | null {
  if (!isSafeRevealTarget(element) || isRevealDisabled(element)) {
    return null;
  }
  if (element.closest('[contenteditable="true"]')) {
    return null;
  }
  const own = ownText(element);
  const ariaLabel = (element.getAttribute('aria-label') ?? '').trim();
  const title = (element.getAttribute('title') ?? '').trim();
  const identity = `${own} ${ariaLabel} ${title}`.replace(/\s+/g, ' ').trim();
  if (identity && BLOCKED_REVEAL_TEXT.test(identity)) {
    return null;
  }
  if (isElementVisible(element)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 180 || rect.height > 72) {
      return null;
    }
  }
  if (EDIT_OWN_TEXT.test(own) || EDIT_OWN_TEXT.test(ariaLabel) || EDIT_OWN_TEXT.test(title)) {
    return 'edit';
  }
  if (!identity && classLooksLikeEditIcon(element)) {
    return 'edit';
  }
  if (!isElementVisible(element)) {
    return null;
  }
  if (isAddControlText(`${own}${ariaLabel}${title}`)) {
    return 'add';
  }
  return null;
}

/**
 * 收集当前能点的编辑和添加。父节点包着更小的「编辑」时只留子节点。
 */
function listRevealTargets(clicked: WeakSet<HTMLElement>): Array<{ element: HTMLElement; kind: 'edit' | 'add' }> {
  const selector = 'button, a, span, i, div, label, svg, [role="button"]';
  const found: Array<{ element: HTMLElement; kind: 'edit' | 'add' }> = [];
  for (const node of document.querySelectorAll(selector)) {
    if (!(node instanceof HTMLElement) || clicked.has(node)) {
      continue;
    }
    const kind = classifyRevealTarget(node);
    if (!kind) {
      continue;
    }
    found.push({ element: node, kind });
  }
  return found.filter(
    (item) => !found.some((other) => other.element !== item.element && item.element.contains(other.element)),
  );
}

/**
 * 给卡片补上鼠标移入，让靠 mouseenter 才创建的编辑按钮进入 DOM。
 * 只靠样式 :hover 显示的按钮不会因此出现，那些仍靠直接点隐藏节点。
 */
function wakeHoverAround(element: HTMLElement): void {
  let current: HTMLElement | null = element;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    current.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
    current.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    current = current.parentElement;
  }
}

/**
 * 对简历各模块标题发一次移入，方便下一轮能找到刚挂出来的编辑按钮。
 */
function wakeSectionHovers(): void {
  let woken = 0;
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, li')) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (!SECTION_HEADING_TEXT.test(ownText(node))) {
      continue;
    }
    wakeHoverAround(node);
    woken += 1;
    if (woken >= 30) {
      break;
    }
  }
}

/**
 * 从编辑按钮往上找模块名，写进扫描进度。
 */
function sectionNameNear(element: HTMLElement): string {
  let current: HTMLElement | null = element;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const heading = current.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      const headingText = (heading.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);
      if (headingText) {
        return headingText;
      }
    }
    current = current.parentElement;
  }
  return '这一块';
}

/**
 * 在已经看得见的按钮里找文字完全匹配的那个，用来关编辑层。
 */
function findVisibleAction(pattern: RegExp): HTMLElement | null {
  let bestMatch: HTMLElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of document.querySelectorAll('button, [role="button"], a, span, div')) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || !isSafeRevealTarget(node)) {
      continue;
    }
    if (!pattern.test(ownText(node))) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area <= 0 || area > 180 * 72 || area >= bestArea) {
      continue;
    }
    bestMatch = node;
    bestArea = area;
  }
  return bestMatch;
}

/**
 * 关掉刚打开的编辑层：点「取消」或「关闭」，不点「完成」「保存」「确定」。
 * 若接着问要不要放弃修改，只点「不保存」「放弃」「离开」；确认框里的「确定」仅在文案写明放弃时才点。
 */
async function dismissOpenedEditor(): Promise<void> {
  const cancelButton = findVisibleAction(/^(取消|关闭)$/);
  if (cancelButton) {
    clickWithoutSubmitting(cancelButton);
    await wait(220);
  }
  const discardButton = findVisibleAction(/^(不保存|放弃|离开)$/);
  if (discardButton) {
    clickWithoutSubmitting(discardButton);
    await wait(180);
    return;
  }
  for (const dialog of document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], .dialog, .modal, .ant-modal, .el-dialog',
  )) {
    if (!(dialog instanceof HTMLElement) || !isElementVisible(dialog)) {
      continue;
    }
    const dialogText = (dialog.innerText ?? '').slice(0, 300);
    if (!/放弃|不保存|未保存/.test(dialogText)) {
      continue;
    }
    for (const button of dialog.querySelectorAll('button, [role="button"], span, div, a')) {
      if (!(button instanceof HTMLElement) || !isElementVisible(button)) {
        continue;
      }
      if (!/^(不保存|放弃|离开|确定)$/.test(ownText(button))) {
        continue;
      }
      clickWithoutSubmitting(button);
      await wait(180);
      return;
    }
  }
}

/**
 * 点开安全的「编辑 / 铅笔」和空区块的「添加」。
 * 隐藏的编辑也会点。点开后先记下输入框，再关编辑层，方便下一块打开。不点完成、保存、确定。
 */
/**
 * 同一块编辑在关掉后会换成新节点。用模块名和旁边的文字记住已经点过，避免来回开关。
 */
function revealSignature(element: HTMLElement): string {
  const parentText = (element.parentElement?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const ariaLabel = element.getAttribute('aria-label') ?? '';
  return `${ownText(element)}|${ariaLabel}|${sectionNameNear(element)}|${parentText}`;
}

async function clickRevealButtons(
  absorbWithOpener: (opener: HTMLElement | null) => void,
  reportOpening: (message: string) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const clicked = new WeakSet<HTMLElement>();
  const clickedSignatures = new Set<string>();
  let editClicks = 0;

  for (let round = 0; round < 4; round += 1) {
    if (shouldStop()) {
      return;
    }
    wakeSectionHovers();
    await wait(180);
    const targets = listRevealTargets(clicked);
    if (targets.length === 0) {
      break;
    }
    let clickedThisRound = false;
    for (const target of targets) {
      if (shouldStop()) {
        return;
      }
      const signature = revealSignature(target.element);
      if (clickedSignatures.has(signature)) {
        continue;
      }
      // 添加留到写入阶段按档案条数再点。扫描时点开会多出空行，也分不清该加几条。
      if (target.kind === 'add') {
        continue;
      }
      if (editClicks >= MAX_EDIT_CLICKS) {
        continue;
      }

      const sectionName = sectionNameNear(target.element);
      reportOpening(
        target.kind === 'edit' ? `正在点开${sectionName}的编辑。` : `正在点开${sectionName}的添加。`,
      );
      // 已经有一块编辑层时先记下框再关掉，否则下一块编辑点不开
      if (target.kind === 'edit' && findVisibleAction(/^(取消|关闭)$/)) {
        absorbWithOpener(null);
        await dismissOpenedEditor();
        await wait(200);
      }
      if (!target.element.isConnected) {
        continue;
      }
      clicked.add(target.element);
      clickedSignatures.add(signature);
      clickedThisRound = true;
      const anchor = isElementVisible(target.element)
        ? target.element
        : target.element.parentElement ?? target.element;
      anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
      wakeHoverAround(target.element);
      clickWithoutSubmitting(target.element);
      editClicks += 1;
      await wait(CLICK_PAUSE_MS);
      absorbWithOpener(target.element);
      if (target.kind === 'edit' && findVisibleAction(/^(取消|关闭)$/)) {
        await dismissOpenedEditor();
        await wait(160);
      }
    }
    if (!clickedThisRound) {
      break;
    }
  }
}

/**
 * 字段被收起或节点换过时，按扫描时的标签和 name 再找一次，并避开已经分给其他字段的控件。
 */
function findControlBySignature(fieldId: string, track: TrackedField): Element | undefined {
  if (!track.label && !track.name) {
    return undefined;
  }
  for (const candidate of collectFormControls(document)) {
    if (!candidate.isConnected || !shouldIncludeElement(candidate)) {
      continue;
    }
    if (candidate.tagName !== track.element.tagName) {
      continue;
    }
    const candidateName = candidate.getAttribute('name') ?? '';
    if (track.name && candidateName !== track.name) {
      continue;
    }
    if (track.label && resolveFieldLabel(candidate) !== track.label) {
      continue;
    }
    const alreadyTracked = [...fieldTracks.entries()].some(
      ([otherFieldId, otherTrack]) =>
        otherFieldId !== fieldId && otherTrack.element === candidate,
    );
    if (alreadyTracked) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

/**
 * 写入前把字段准备好：先滚进视野；框被收起就再点当时的按钮，找不到节点就按标签重找。
 */
export async function prepareFieldForWrite(
  fieldId: string,
): Promise<Element | undefined> {
  const track = fieldTracks.get(fieldId);
  if (!track) {
    return resolveFieldElement(fieldId);
  }

  let element: Element | undefined = track.element.isConnected
    ? track.element
    : undefined;
  const needsReopen = !element || !isElementVisible(element);
  if (needsReopen && track.opener?.isConnected) {
    const openerAnchor = isElementVisible(track.opener)
      ? track.opener
      : track.opener.parentElement ?? track.opener;
    openerAnchor.scrollIntoView({ block: 'center', inline: 'nearest' });
    wakeHoverAround(track.opener);
    clickWithoutSubmitting(track.opener);
    await wait(CLICK_PAUSE_MS);
  }
  if (!element?.isConnected || (element && !isElementVisible(element))) {
    const found = findControlBySignature(fieldId, track);
    if (found) {
      element = found;
      track.element = found;
      fieldElementById.set(fieldId, found);
    }
  }
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  return element?.isConnected ? element : undefined;
}

/**
 * 下拉的选项更像年份还是月份。对不上的不改标签。
 */
function selectOptionKind(selectElement: HTMLSelectElement): 'year' | 'month' | 'other' {
  let yearOptions = 0;
  let monthOptions = 0;
  for (const optionElement of selectElement.options) {
    const optionText = (optionElement.textContent ?? '').trim();
    if (/^(19|20)\d{2}年?$/.test(optionText)) {
      yearOptions += 1;
    }
    if (/^(0?[1-9]|1[0-2])月?$/.test(optionText)) {
      monthOptions += 1;
    }
  }
  if (yearOptions >= 8) {
    return 'year';
  }
  if (monthOptions >= 6) {
    return 'month';
  }
  return 'other';
}

/**
 * 把标题收成稳定分区名。括号、斜杠、多余后缀不再导致整段变成「未分区」。
 */
function canonicalSectionTitle(rawTitle: string): string {
  const compact = rawTitle.replace(/\s+/g, '').replace(/[（(].*$/, '').trim();
  if (!compact || compact.length > 16) {
    return '';
  }
  if (/^教育背景|^教育经历|^教育$/.test(compact)) {
    return '教育背景';
  }
  if (/实习经历|工作经历|工作\/实习|实习\/工作/.test(compact) || compact === '实习' || compact === '工作') {
    return '实习经历';
  }
  if (/^项目经历|^项目经验|^项目$/.test(compact)) {
    return '项目经历';
  }
  if (/校内经历|校内任职|校园经历|社团经历/.test(compact)) {
    return '校内经历';
  }
  if (/获奖经历|获奖情况|荣誉奖项|所获荣誉/.test(compact)) {
    return '获奖经历';
  }
  if (/^证书|^资格证书/.test(compact)) {
    return '证书';
  }
  if (/培训经历|^培训$/.test(compact)) {
    return '培训经历';
  }
  if (/个人能力|专业技能|技能特长/.test(compact)) {
    return '个人能力';
  }
  if (/自我描述|自我评价/.test(compact)) {
    return compact.startsWith('自我评价') ? '自我评价' : '自我描述';
  }
  return '';
}

/**
 * 控件上方或旁边的短标题，用来区分项目、教育、实习、校内。
 */
function nearestSectionTitle(element: Element): string {
  let current: Node | null = element;
  for (let guard = 0; guard < 500 && current; guard += 1) {
    const previous = current.previousSibling;
    if (!previous) {
      current = current.parentNode;
      continue;
    }
    current = previous;
    if (!(current instanceof HTMLElement)) {
      continue;
    }
    if (current.querySelector('input, select, textarea')) {
      continue;
    }
    const titleText = canonicalSectionTitle(current.textContent ?? '');
    if (titleText) {
      return titleText;
    }
  }
  return '';
}

/**
 * 原生下拉或点开后记下来的选项，判断这是年还是月。
 */
function controlTimeKind(element: Element): 'year' | 'month' | 'other' {
  if (element instanceof HTMLSelectElement) {
    return selectOptionKind(element);
  }
  const pickerHost = element.closest('.ant-select, .el-select');
  if (pickerHost instanceof HTMLElement) {
    const cueText = (
      pickerHost.querySelector('.ant-select-selection-placeholder, .ant-select-selection-item, .el-input__inner')
        ?.textContent ?? ''
    ).replace(/\s+/g, '');
    if (cueText === '年' || /^(19|20)\d{2}$/.test(cueText)) {
      return 'year';
    }
    if (cueText === '月' || /^(0?[1-9]|1[0-2])$/.test(cueText)) {
      return 'month';
    }
  }
  const storedOptions = element.getAttribute('data-raf-options') ?? '';
  const yearCount = (storedOptions.match(/(19|20)\d{2}/g) ?? []).length;
  const monthCount = (storedOptions.match(/"(?:0?[1-9]|1[0-2])月?"/g) ?? []).length;
  if (yearCount >= 8) {
    return 'year';
  }
  if (monthCount >= 6) {
    return 'month';
  }
  return 'other';
}

/**
 * 记下字段标签，并写到控件上，写入时按这个标签对行。
 */
function rememberFieldLabel(field: FieldDescriptor, element: Element, label: string): void {
  field.label = label;
  if (element instanceof HTMLElement) {
    element.setAttribute('data-raf-label', label);
  }
  const track = fieldTracks.get(field.fieldId);
  if (track) {
    track.label = label;
  }
}

/**
 * 毕业时间只用结束年月，入学时间只用开始年月。
 * 起止时间仍按从左到右分成开始和结束。
 */
function dateRoleBesideControl(element: Element): '开始' | '结束' | null {
  let current: Element | null = element;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const previousSibling = current.previousElementSibling;
    const captionText = `${previousSibling?.textContent ?? ''}${current.getAttribute('aria-label') ?? ''}`.replace(
      /\s+/g,
      '',
    );
    if (captionText.length > 0 && captionText.length <= 16) {
      if (/毕业/.test(captionText) && !/入学|起止|就读/.test(captionText)) {
        return '结束';
      }
      if (/入学/.test(captionText) && !/毕业|起止|就读/.test(captionText)) {
        return '开始';
      }
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * 按卡片把字段分成行，标成「教育背景第1行开始年」这样的标签。
 * 校内经历、项目经历、获奖经历各自编号，避免时间写串行。
 */
function assignStructuredLabels(fields: FieldDescriptor[]): void {
  const located = fields.flatMap((field) => {
    const element = fieldElementById.get(field.fieldId);
    if (!element || !element.isConnected) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    return [{ field, element, top: Math.round(rect.top), left: rect.left }];
  });
  const bySection = new Map<string, typeof located>();
  for (const item of located) {
    const sectionTitle = nearestSectionTitle(item.element) || '未分区';
    const sectionItems = bySection.get(sectionTitle) ?? [];
    sectionItems.push(item);
    bySection.set(sectionTitle, sectionItems);
  }

  for (const [sectionTitle, sectionItems] of bySection) {
    sectionItems.sort((leftItem, rightItem) => leftItem.top - rightItem.top || leftItem.left - rightItem.left);
    const rows: Array<typeof sectionItems> = [];
    let currentRow: typeof sectionItems = [];
    for (const item of sectionItems) {
      const optionKind = controlTimeKind(item.element);
      const yearCount = currentRow.filter(
        (rowItem) => controlTimeKind(rowItem.element) === 'year',
      ).length;
      const previousItem = currentRow[currentRow.length - 1];
      const verticalGap = previousItem ? item.top - previousItem.top : 0;
      const fieldHint = `${item.field.label}${item.element.getAttribute('placeholder') ?? ''}`;
      const repeatsName =
        textHasRowNameAnchor(fieldHint) &&
        currentRow.some((rowItem) =>
          textHasRowNameAnchor(
            `${rowItem.field.label}${rowItem.element.getAttribute('placeholder') ?? ''}`,
          ),
        );
      const startsNextRow =
        currentRow.length > 0 &&
        (repeatsName ||
          (optionKind === 'year' && (yearCount >= 2 || (yearCount >= 1 && verticalGap > 36))));
      if (startsNextRow) {
        rows.push(currentRow);
        currentRow = [];
      }
      currentRow.push(item);
    }
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    const labeledFieldIds = new Set(sectionItems.map((item) => item.field.fieldId));
    let existingRowCount = 0;
    if (sectionTitle !== '未分区') {
      for (const node of document.querySelectorAll('[data-raf-label]')) {
        const labeledText = node.getAttribute('data-raf-label') ?? '';
        const rowMatch = labeledText.match(new RegExp(`^${sectionTitle}第(\\d+)行`));
        const belongsToThisPass = sectionItems.some((item) => item.element === node);
        if (rowMatch?.[1] && !belongsToThisPass && !labeledFieldIds.has('')) {
          existingRowCount = Math.max(existingRowCount, Number(rowMatch[1]));
        }
      }
    }
    rows.forEach((rowItems, rowIndex) => {
      rowItems.sort((leftItem, rightItem) => leftItem.left - rightItem.left);
      const rowPrefix = sectionTitle === '未分区' ? '' : `${sectionTitle}第${existingRowCount + rowIndex + 1}行`;
      const yearItems = rowItems.filter(
        (item) => controlTimeKind(item.element) === 'year',
      );
      const monthItems = rowItems.filter(
        (item) => controlTimeKind(item.element) === 'month',
      );
      const roleNames = ['开始', '结束'];
      yearItems.forEach((item, index) => {
      const forcedRole = dateRoleBesideControl(item.element);
      const roleName = forcedRole ?? roleNames[index] ?? `第${index + 1}个`;
      rememberFieldLabel(item.field, item.element, `${rowPrefix}${roleName}年`);
      });
      monthItems.forEach((item, index) => {
      const forcedRole = dateRoleBesideControl(item.element);
      const roleName = forcedRole ?? roleNames[index] ?? `第${index + 1}个`;
      rememberFieldLabel(item.field, item.element, `${rowPrefix}${roleName}月`);
      });
      for (const item of rowItems) {
        if (yearItems.includes(item) || monthItems.includes(item)) {
          continue;
        }
        let roleLabel = resolveFieldRoleLabel(item.element, item.field.label);
        if (item.element instanceof HTMLSelectElement) {
          const optionText = Array.from(item.element.options)
            .map((optionElement) => optionElement.textContent ?? '')
            .join(' ');
          if (/身份证|护照|港澳/.test(optionText)) {
            roleLabel = '证件类型';
          } else if (/\+86|＋86|中国大陆/.test(optionText)) {
            roleLabel = '电话区号';
          }
          const optionList = Array.from(item.element.options)
            .map((optionElement) => (optionElement.textContent ?? '').trim())
            .filter((optionLabel) => optionLabel.length > 0);
          item.field.options = optionList;
          if (item.element instanceof HTMLElement) {
            item.element.setAttribute('data-raf-options', JSON.stringify(optionList.slice(0, 60)));
          }
        }
        if (
          item.element instanceof HTMLInputElement &&
          (item.element.type === 'checkbox' || item.element.type === 'radio') &&
          /至今/.test(`${roleLabel} ${item.element.parentElement?.textContent ?? ''}`)
        ) {
          roleLabel = '至今';
        }
        const storedOptions = item.element.getAttribute('data-raf-options');
        if (storedOptions && /身份证|护照|港澳/.test(storedOptions)) {
          roleLabel = '证件类型';
        } else if (storedOptions && /\+86|＋86|中国大陆/.test(storedOptions)) {
          roleLabel = '电话区号';
        }
        // 最终再挡一次垃圾角色，避免「第N行请输入」落盘
        if (isJunkRoleText(roleLabel)) {
          roleLabel = resolveFieldRoleLabel(item.element, '');
        }
        rememberFieldLabel(item.field, item.element, `${rowPrefix}${roleLabel}`.trim());
      }
    });
  }
}

/**
 * 点开还没读到选项的下拉，把真实选项记下来再关掉。
 * 月份是 8 还是 08、成绩排名里有什么，都以这时看到的列表为准。
 */
async function samplePickerOptions(fields: FieldDescriptor[]): Promise<void> {
  let sampledCount = 0;
  for (const field of fields) {
    if (sampledCount >= 120) {
      break;
    }
    const element = fieldElementById.get(field.fieldId);
    if (!(element instanceof HTMLElement) || !isElementVisible(element)) {
      continue;
    }
    if (element instanceof HTMLSelectElement && element.options.length > 1) {
      const optionList = Array.from(element.options)
        .map((optionElement) => (optionElement.textContent ?? '').trim())
        .filter((optionLabel) => optionLabel.length > 0);
      field.options = optionList;
      element.setAttribute('data-raf-options', JSON.stringify(optionList.slice(0, 60)));
      continue;
    }
    const placeholderText = element instanceof HTMLInputElement ? element.placeholder : '';
    const classText = typeof element.className === 'string' ? element.className : '';
    const looksLikePicker =
      element.getAttribute('role') === 'combobox' ||
      Boolean(element.getAttribute('aria-haspopup')) ||
      Boolean(element.closest('.ant-select, .el-select')) ||
      (element instanceof HTMLInputElement && element.readOnly) ||
      /请选择/.test(placeholderText) ||
      /select|picker|dropdown/i.test(classText);
    if (!looksLikePicker) {
      continue;
    }
    element.setAttribute('data-raf-must-pick', '1');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.click();
    await wait(180);
    const optionList = [
      ...new Set(
        Array.from(document.querySelectorAll('[role="option"], .ant-select-item-option, .el-select-dropdown__item'))
          .filter((node): node is HTMLElement => {
          if (!(node instanceof HTMLElement) || !isElementVisible(node)) {
            return false;
          }
          const dropdown = node.closest('.ant-select-dropdown, .el-select-dropdown');
          if (dropdown instanceof HTMLElement && dropdown.classList.contains('ant-select-dropdown-hidden')) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 2 && rect.height > 2;
        })
          .map((node) => (node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((optionLabel) => optionLabel.length > 0 && optionLabel.length <= 40 && optionLabel !== '暂无选项'),
      ),
    ].slice(0, 60);
    if (optionList.length > 0) {
      field.options = optionList;
      element.setAttribute('data-raf-options', JSON.stringify(optionList));
      sampledCount += 1;
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(60);
  }
}


/**
 * 登记一块范围里还没扫过的可见控件，供写入后补认新冒出来的框。
 */
export function absorbNewFields(scope: ParentNode = document): FieldDescriptor[] {
  const seenElements = new Set<Element>(fieldElementById.values());
  const freshFields: FieldDescriptor[] = [];
  for (const candidate of collectFormControls(scope)) {
    if (seenElements.has(candidate) || !shouldIncludeElement(candidate)) {
      continue;
    }
    freshFields.push(describeField(candidate));
  }
  assignStructuredLabels(freshFields);
  return freshFields;
}

/**
 * 新冒出来的框先采样下拉选项，再按年/月和分区打标签。
 * 添加行之后必须走这条，否则学历、区号没有选项会被跳过或硬填。
 */
export async function absorbNewFieldsReady(scope: ParentNode = document): Promise<FieldDescriptor[]> {
  const freshFields = absorbNewFields(scope);
  await samplePickerOptions(freshFields);
  assignStructuredLabels(freshFields);
  return freshFields;
}

/** 一段可重复经历在页面上的位置、现有行数和添加按钮 */
export interface RepeatSectionSnapshot {
  root: HTMLElement;
  rows: number;
  addButton: HTMLElement | null;
}

/**
 * 按标题找到一段经历，数出现有的年月行，并找出「添加」按钮。
 */
export function locateRepeatSection(patternSource: string): RepeatSectionSnapshot | null {
  let sectionPattern: RegExp;
  try {
    sectionPattern = new RegExp(patternSource);
  } catch {
    return null;
  }
  let headingElement: HTMLElement | null = null;
  const siteAdapter = getActiveSiteAdapter();
  const headingSelector = siteAdapter?.sectionSelector
    ? `${siteAdapter.sectionSelector}, h1, h2, h3, h4, h5, h6, legend, div, span, p`
    : 'h1, h2, h3, h4, h5, h6, legend, div, span, p';
  for (const node of document.querySelectorAll(headingSelector)) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || isNavigationChrome(node)) {
      continue;
    }
    const headingText = ownText(node).replace(/\s+/g, '').replace(/[（(].*$/, '');
    if (!headingText || headingText.length > 12 || !sectionPattern.test(headingText)) {
      continue;
    }
    headingElement = node;
    break;
  }
  if (!headingElement) {
    return null;
  }
  let nextHeading: HTMLElement | null = null;
  let passedHeading = false;
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, div, span, p')) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node === headingElement) {
      passedHeading = true;
      continue;
    }
    if (!passedHeading || !isElementVisible(node) || isNavigationChrome(node)) {
      continue;
    }
    const laterTitle = ownText(node).replace(/\s+/g, '');
    if (
      laterTitle &&
      laterTitle.length <= 12 &&
      /教育|实习|工作|项目|校内|校园|获奖|荣誉|证书|培训|技能|语言|自我|能力/.test(laterTitle) &&
      !sectionPattern.test(laterTitle)
    ) {
      nextHeading = node;
      break;
    }
  }
  const isInsideSection = (node: Node): boolean => {
    const afterHeading = headingElement
      ? (headingElement.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      : false;
    const beforeNext = nextHeading
      ? (nextHeading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
      : true;
    return afterHeading && beforeNext;
  };
  let rootElement: HTMLElement = headingElement.parentElement ?? headingElement;
  let current: HTMLElement | null = headingElement.parentElement;
  for (let depth = 0; depth < 6 && current && current !== document.body; depth += 1) {
    if (nextHeading && current.contains(nextHeading)) {
      break;
    }
    if (current.querySelector('select, textarea, input:not([type="hidden"])')) {
      rootElement = current;
      break;
    }
    current = current.parentElement;
  }
  const deleteButtons = Array.from(document.querySelectorAll('button, a, span')).filter((node) => {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || !isInsideSection(node)) {
      return false;
    }
    const buttonText = ownText(node).replace(/\s+/g, '');
    return buttonText === '删除本条' || buttonText === '删除';
  });
  const startYearLabels = Array.from(document.querySelectorAll('[data-raf-label]')).filter((node) => {
    const label = node.getAttribute('data-raf-label') ?? '';
    return /开始年/.test(label) && sectionPattern.test(label) && isInsideSection(node);
  });
  const nameFieldsInSection = Array.from(document.querySelectorAll('input, textarea')).filter((node) => {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || !isInsideSection(node)) {
      return false;
    }
    const placeholderText = node instanceof HTMLInputElement ? node.placeholder : '';
    const labelText = node.getAttribute('data-raf-label') ?? '';
    return textHasRowNameAnchor(`${placeholderText}${labelText}`);
  });
  let rows = nameFieldsInSection.length;
  if (rows === 0 && deleteButtons.length > 0) {
    rows = deleteButtons.length;
  }
  if (rows === 0) {
    const yearWidgets = Array.from(document.querySelectorAll('select, .ant-select, .el-select')).filter(
      (node) => {
        if (!(node instanceof HTMLElement) || !isElementVisible(node) || !isInsideSection(node)) {
          return false;
        }
        if (node instanceof HTMLSelectElement) {
          return selectOptionKind(node) === 'year';
        }
        const cueText = (
          node.querySelector('.ant-select-selection-placeholder, .ant-select-selection-item')?.textContent ?? ''
        ).replace(/\s+/g, '');
        return cueText === '年' || /^(19|20)\d{2}$/.test(cueText);
      },
    );
    rows = yearWidgets.length >= 2 ? Math.floor(yearWidgets.length / 2) : yearWidgets.length;
  }
  let addButton: HTMLElement | null = null;
  for (const node of document.querySelectorAll('button, a, span, div, [role="button"]')) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || !isSafeRevealTarget(node) || !isInsideSection(node)) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width > 180 || rect.height > 72) {
      continue;
    }
    if (!isAddControlText(`${ownText(node)}${node.getAttribute('aria-label') ?? ''}${node.getAttribute('title') ?? ''}`)) {
      continue;
    }
    addButton = node;
    break;
  }
  return { root: rootElement, rows, addButton };
}

/**
 * 这个格子还是空的：没选年/月，或仍是占位符。
 */
function controlLooksEmpty(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const currentText = element.value.trim();
    const placeholderText = (element.placeholder || '').trim();
    return currentText.length === 0 || currentText === placeholderText;
  }
  const pickerHost = element.closest('.ant-select, .el-select') ?? element;
  const shownText = (
    pickerHost.querySelector('.ant-select-selection-item, .ant-select-selection-placeholder')?.textContent ?? ''
  ).replace(/\s+/g, '');
  return shownText.length === 0 || /^(请选择|年|月)/.test(shownText);
}

/**
 * 把这一块里还空着的格子重新编号，供下一轮按第 2 行、第 3 行去填。
 * 第一次扫描时页面上还没有的行，也会在添加之后从这里进入填写。
 */
export function harvestEmptyLabeledFields(patternSource: string): FieldDescriptor[] {
  let sectionPattern: RegExp;
  try {
    sectionPattern = new RegExp(patternSource);
  } catch {
    return [];
  }
  const sectionFields: FieldDescriptor[] = [];
  const emptyFields: FieldDescriptor[] = [];
  for (const node of document.querySelectorAll('[data-raf-id]')) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node)) {
      continue;
    }
    const labelText = node.getAttribute('data-raf-label') ?? '';
    if (!sectionPattern.test(labelText)) {
      continue;
    }
    const fieldId = node.getAttribute('data-raf-id') ?? '';
    if (!fieldId || !fieldElementById.has(fieldId)) {
      continue;
    }
    const descriptor: FieldDescriptor = {
      fieldId,
      tag: node.tagName.toLowerCase(),
      type: node instanceof HTMLInputElement ? node.type || 'text' : node.tagName.toLowerCase(),
      label: labelText,
      selectorHint: 'input',
    };
    sectionFields.push(descriptor);
    if (controlLooksEmpty(node)) {
      emptyFields.push(descriptor);
    }
  }
  if (sectionFields.length > 0) {
    assignStructuredLabels(sectionFields);
  }
  const snapshot = locateRepeatSection(patternSource);
  if (snapshot) {
    for (const node of snapshot.root.querySelectorAll('input, textarea, select')) {
      if (!(node instanceof HTMLElement) || !isElementVisible(node) || !controlLooksEmpty(node)) {
        continue;
      }
      if (node.getAttribute('data-raf-id')) {
        continue;
      }
      const created = describeField(node);
      sectionFields.push(created);
      emptyFields.push(created);
    }
    if (sectionFields.length > 0) {
      assignStructuredLabels(sectionFields);
    }
  }
  return emptyFields;
}

/**
 * 只给还空着的下一张卡片打上正确行号。已经写过字的卡片不动，避免又全部写成第一条。
 */
export function labelNextEmptyCard(patternSource: string, neededRows: number): FieldDescriptor[] {
  const sectionTitle = sectionHeadingText(patternSource);
  const snapshot = locateRepeatSection(patternSource);
  if (!sectionTitle || !snapshot || neededRows <= 0) {
    return [];
  }
  const controls = collectSectionControls(patternSource);
  const nameFields = controls.filter((element) => {
    const placeholderText = element instanceof HTMLInputElement ? element.placeholder : '';
    const labelText = element.getAttribute('data-raf-label') ?? '';
    return textHasRowNameAnchor(`${placeholderText}${labelText}`);
  });
  const emptyIndex = nameFields.findIndex((element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return false;
    }
    const currentText = element.value.trim();
    return currentText.length === 0 || currentText === (element.placeholder || '').trim();
  });
  if (emptyIndex < 0 || emptyIndex >= neededRows) {
    return [];
  }
  return labelOneCardByNameIndex(sectionTitle, controls, nameFields, emptyIndex);
}

/**
 * 把分区内每一张「主键」卡按文档序全部重打「第N行」。
 * 补行结束后、写入前调用，避免「单位名称」漏认导致两行都当第1条。
 */
export function relabelAllSectionCards(patternSource: string): FieldDescriptor[] {
  const sectionTitle = sectionHeadingText(patternSource);
  if (!sectionTitle) {
    return [];
  }
  const controls = collectSectionControls(patternSource);
  const nameFields = controls.filter((element) => {
    const placeholderText = element instanceof HTMLInputElement ? element.placeholder : '';
    const labelText = element.getAttribute('data-raf-label') ?? '';
    return textHasRowNameAnchor(`${placeholderText}${labelText}`);
  });
  const labeled: FieldDescriptor[] = [];
  nameFields.forEach((_nameField, index) => {
    labeled.push(...labelOneCardByNameIndex(sectionTitle, controls, nameFields, index));
  });
  return labeled;
}

/**
 * 收集分区内可见控件（与补行/打标同一口径）。
 */
function collectSectionControls(patternSource: string): HTMLElement[] {
  return Array.from(document.querySelectorAll('input, textarea, select, .ant-select, .el-select'))
    .filter((node): node is HTMLElement => {
      if (!(node instanceof HTMLElement) || !isElementVisible(node) || !nodeInRepeatSection(patternSource, node)) {
        return false;
      }
      if (node instanceof HTMLInputElement && node.closest('.ant-select, .el-select')) {
        return false;
      }
      if (node.matches('.ant-select, .el-select') && node.parentElement?.closest('.ant-select, .el-select')) {
        return false;
      }
      return true;
    })
    .sort(
      (leftNode, rightNode) =>
        leftNode.getBoundingClientRect().top - rightNode.getBoundingClientRect().top ||
        leftNode.getBoundingClientRect().left - rightNode.getBoundingClientRect().left,
    );
}

/**
 * 解析控件真实角色名：绝不用「请输入/请选择」当学校、单位等语义。
 * 优先可见标题 → 非垃圾旧标签 → fieldLabelBlob → 控件形态兜底。
 */
function resolveFieldRoleLabel(element: HTMLElement, previousRole = ''): string {
  const placeholderText =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder
      : '';
  const ariaLabel = element.getAttribute('aria-label') || '';
  const blob = fieldLabelBlob(element);
  const blobParts = String(blob || '')
    .split(/\s+/)
    .map((part) => part.replace(/\s+/g, ''))
    .filter((part) => part.length >= 2 && part.length <= 16 && !isJunkRoleText(part));

  const picked = pickUsableRoleText(
    previousRole,
    ariaLabel,
    ...blobParts,
    blob,
  );
  if (picked) {
    return picked;
  }

  const isTextArea = element instanceof HTMLTextAreaElement
    || (element.getAttribute('role') === 'textbox'
      && element.getAttribute('aria-multiline') === 'true');
  const timeKind = controlTimeKind(element);
  const dateCue = `${placeholderText}${ariaLabel}${blob}`;
  const isDateLike = timeKind === 'year' || timeKind === 'month' || timeKind === 'day'
    || /时间|日期|年月|生日|日历/.test(dateCue)
    || Boolean(element.closest('[class*="picker" i], [class*="date" i], [class*="calendar" i]'));
  const isDateEnd = /结束|截止|离职|毕业|获得/.test(dateCue) && !/开始|起始|入学|入职/.test(dateCue);

  const guessed = guessRoleByControlHint({
    isTextArea: Boolean(isTextArea),
    isDateLike,
    isDateEnd,
  });
  return guessed || '字段';
}

/**
 * 按主键字段下标，给该卡垂直带内所有控件打上「标题第N行…」。
 */
function labelOneCardByNameIndex(
  sectionTitle: string,
  controls: HTMLElement[],
  nameFields: HTMLElement[],
  nameIndex: number,
): FieldDescriptor[] {
  if (nameIndex < 0 || nameIndex >= nameFields.length) {
    return [];
  }
  const bandTop = nameFields[nameIndex].getBoundingClientRect().top - 180;
  const nextName = nameFields[nameIndex + 1];
  const bandBottom = nextName ? nextName.getBoundingClientRect().top - 4 : bandTop + 520;
  const band = controls.filter((element) => {
    const top = element.getBoundingClientRect().top;
    return top >= bandTop && top < bandBottom;
  });
  const rowPrefix = `${sectionTitle}第${nameIndex + 1}行`;
  const labeled: FieldDescriptor[] = [];
  const yearFields = band.filter((element) => controlTimeKind(element) === 'year');
  const monthFields = band.filter((element) => controlTimeKind(element) === 'month');
  yearFields.forEach((element, index) => {
    const roleName = dateRoleBesideControl(element) ?? (index === 0 ? '开始' : '结束');
    const descriptor = ensureFieldDescriptor(element);
    rememberFieldLabel(descriptor, element, `${rowPrefix}${roleName}年`);
    labeled.push(descriptor);
  });
  monthFields.forEach((element, index) => {
    const roleName = dateRoleBesideControl(element) ?? (index === 0 ? '开始' : '结束');
    const descriptor = ensureFieldDescriptor(element);
    rememberFieldLabel(descriptor, element, `${rowPrefix}${roleName}月`);
    labeled.push(descriptor);
  });
  for (const element of band) {
    if (yearFields.includes(element) || monthFields.includes(element)) {
      continue;
    }
    const previousLabel = (element.getAttribute('data-raf-label') ?? '').replace(/^.*第\d+行/, '');
    const roleLabel = resolveFieldRoleLabel(element, previousLabel);
    const descriptor = ensureFieldDescriptor(element);
    rememberFieldLabel(descriptor, element, `${rowPrefix}${roleLabel}`);
    labeled.push(descriptor);
  }
  return labeled;
}

/** 标题和下一个区块标题之间的控件，不依赖包住标题的那一层盒子。 */
function nodeInRepeatSection(patternSource: string, target: Node): boolean {
  let sectionPattern: RegExp;
  try {
    sectionPattern = new RegExp(patternSource);
  } catch {
    return false;
  }
  let headingElement: HTMLElement | null = null;
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, div, span, p')) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || isNavigationChrome(node)) {
      continue;
    }
    const headingText = ownText(node).replace(/\s+/g, '').replace(/[（(].*$/, '');
    if (headingText && headingText.length <= 12 && sectionPattern.test(headingText)) {
      headingElement = node;
      break;
    }
  }
  if (!headingElement) {
    return false;
  }
  let nextHeading: HTMLElement | null = null;
  let passedHeading = false;
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, div, span, p')) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node === headingElement) {
      passedHeading = true;
      continue;
    }
    if (!passedHeading || !isElementVisible(node) || isNavigationChrome(node)) {
      continue;
    }
    const laterTitle = ownText(node).replace(/\s+/g, '');
    if (
      laterTitle &&
      laterTitle.length <= 12 &&
      /教育|实习|工作|项目|校内|校园|获奖|荣誉|证书|培训|技能|语言|自我|能力/.test(laterTitle) &&
      !sectionPattern.test(laterTitle)
    ) {
      nextHeading = node;
      break;
    }
  }
  const afterHeading = (headingElement.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const beforeNext = nextHeading
    ? (nextHeading.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    : true;
  return afterHeading && beforeNext;
}

/** 区块标题原文，用来拼「项目经历第2行」。 */
function sectionHeadingText(patternSource: string): string {
  let sectionPattern: RegExp;
  try {
    sectionPattern = new RegExp(patternSource);
  } catch {
    return '';
  }
  for (const node of document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p')) {
    if (!(node instanceof HTMLElement) || !isElementVisible(node) || isNavigationChrome(node)) {
      continue;
    }
    const headingText = ownText(node).replace(/\s+/g, '');
    if (headingText && headingText.length <= 12 && sectionPattern.test(headingText)) {
      return headingText;
    }
  }
  return '';
}

/** 已登记的格子沿用原来的编号，新格子才新建。逐格填写时也用这个，避免同一框登记两次。 */
export function ensureFieldDescriptor(element: HTMLElement): FieldDescriptor {
  const existingId = element.getAttribute('data-raf-id') ?? '';
  if (existingId && fieldElementById.has(existingId)) {
    return {
      fieldId: existingId,
      tag: element.tagName.toLowerCase(),
      type: element instanceof HTMLInputElement ? element.type || 'text' : element.tagName.toLowerCase(),
      label: element.getAttribute('data-raf-label') ?? '',
      selectorHint: 'input',
    };
  }
  return describeField(element);
}

/**
 * 点添加按钮，并避免按钮默认把表单提交掉。
 */
export function pressAddButton(button: HTMLElement): void {
  button.scrollIntoView({ block: 'center', inline: 'nearest' });
  clickWithoutSubmitting(button);
}

/** 扫描过程中报给侧栏的进度：百分比、已发现数量和当前在做什么 */
export interface ScanProgressUpdate {
  phase: 'scrolling' | 'opening';
  percent: number;
  foundCount: number;
  message: string;
}

/** 一次深度扫描的结果。notice 在时间到了或一个框都没有时带给界面 */
export interface DeepScanResult {
  fields: FieldDescriptor[];
  notice?: string;
  stopPercent: number;
}

/**
 * 先等表单安静，再把整页和可滚动距离最长的区域滚到真正到底，并点开编辑与空区块的添加。
 * 扫完恢复滚动位置。不会点提交、保存、下一步，也不会点会跳转的链接。
 */
export async function scanFieldsSettled(
  rootDocument: Document = document,
  onProgress?: (update: ScanProgressUpdate) => void,
): Promise<DeepScanResult> {
  const startedAt = Date.now();
  const windowX = window.scrollX;
  const windowY = window.scrollY;
  const shouldStop = (): boolean => shouldFillStop() || Date.now() - startedAt > SCAN_BUDGET_MS;
  await waitForFormSettle(rootDocument);
  openCollapsedPanels();
  await wait(CLICK_PAUSE_MS);

  fieldElementById.clear();
  fieldTracks.clear();
  const fields: FieldDescriptor[] = [];
  const seenElements = new WeakSet<Element>();
  const absorb = (opener: HTMLElement | null = null): void => {
    absorbVisibleFields(opener, fields, seenElements);
  };
  const report = (
    phase: ScanProgressUpdate['phase'],
    percent: number,
    message: string,
  ): void => {
    onProgress?.({
      phase,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      foundCount: fields.length,
      message,
    });
  };

  const scrollTargets: Array<HTMLElement | Window> = [];
  const windowCapacity = readScrollMetrics(window).maxTop;
  if (windowCapacity > 80) {
    scrollTargets.push(window);
  }
  scrollTargets.push(...listLargestScrollers());
  if (scrollTargets.length === 0) {
    scrollTargets.push(window);
  }

  const innerSnapshots: Array<{ element: HTMLElement; top: number; left: number }> = [];
  for (const target of scrollTargets) {
    if (target instanceof HTMLElement) {
      innerSnapshots.push({
        element: target,
        top: target.scrollTop,
        left: target.scrollLeft,
      });
    }
  }

  let stopPercent = 0;
  let mainLabel = scrollerLabel(scrollTargets[0] ?? window);
  let timedOut = false;

  try {
    absorb();
    const targetCount = scrollTargets.length;
    for (let targetIndex = 0; targetIndex < scrollTargets.length; targetIndex += 1) {
      if (shouldStop()) {
        timedOut = true;
        break;
      }
      const topTarget = scrollTargets[targetIndex];
      const topLabel = scrollerLabel(topTarget);
      report('scrolling', 6, `正在滚回${topLabel}顶部，已发现 ${fields.length} 个输入框。`);
      await scrollTargetToTop(
        topTarget,
        () => {
          absorb();
          report('scrolling', 6, `正在滚回${topLabel}顶部，已发现 ${fields.length} 个输入框。`);
        },
        shouldStop,
      );
      absorb();
      openCollapsedPanels();
      await wait(CLICK_PAUSE_MS);
      absorb();
    }
    for (let targetIndex = 0; targetIndex < scrollTargets.length; targetIndex += 1) {
      if (shouldStop()) {
        timedOut = true;
        break;
      }
      const target = scrollTargets[targetIndex];
      const label = scrollerLabel(target);
      if (targetIndex === 0) {
        mainLabel = label;
      }
      stopPercent = await scrollTargetToEnd(
        target,
        (top, maxTop) => {
          absorb();
          const fraction = maxTop <= 0 ? 1 : top / maxTop;
          const overall = (targetIndex + fraction) / targetCount;
          report(
            'scrolling',
            8 + overall * 62,
            `正在滚动${label}，已发现 ${fields.length} 个输入框。`,
          );
        },
        shouldStop,
      );
      if (shouldStop()) {
        timedOut = true;
        break;
      }
    }

    if (!shouldStop()) {
      report('opening', 74, `正在点开编辑和添加，已发现 ${fields.length} 个输入框。`);
      await clickRevealButtons(
        (opener) => {
          absorb(opener);
          report('opening', 86, `正在点开编辑和添加，已发现 ${fields.length} 个输入框。`);
        },
        (message) => {
          report('opening', 78, `${message}已发现 ${fields.length} 个输入框。`);
        },
        shouldStop,
      );
    } else {
      timedOut = true;
    }

    const liveFields = fields.filter((field) => {
      const track = fieldTracks.get(field.fieldId);
      if (!track) {
        return false;
      }
      const stillOnScreen = track.element.isConnected && isElementVisible(track.element);
      // 编辑层关掉后框会消失，但打开它的按钮还在，写入时会再点开。
      // 滚到底时上面的行可能被页面卸掉，扫描时见过的仍然留下。
      if (stillOnScreen || track.opener?.isConnected || track.label.length > 0) {
        return true;
      }
      fieldTracks.delete(field.fieldId);
      fieldElementById.delete(field.fieldId);
      return false;
    });

    await samplePickerOptions(liveFields);
    assignStructuredLabels(liveFields);

    let notice: string | undefined;
    if (timedOut) {
      notice = `时间到了，先交回已发现的 ${liveFields.length} 个输入框。滚动停在${mainLabel}大约 ${stopPercent}%。`;
    } else if (liveFields.length === 0) {
      notice = `没有扫到可以填写的输入框。滚过了${mainLabel}，停在大约 ${stopPercent}%。请确认打开的是网申表单后再扫一次。`;
    }
    if (lastUnreachableFrameCount > 0) {
      const frameNote = `另有 ${lastUnreachableFrameCount} 个隔离框架，里面的输入框写不进去。`;
      notice = notice ? `${notice}${frameNote}` : frameNote;
    }
    return { fields: liveFields, notice, stopPercent };
  } finally {
    for (const snapshot of innerSnapshots) {
      if (snapshot.element.isConnected) {
        snapshot.element.scrollTop = snapshot.top;
        snapshot.element.scrollLeft = snapshot.left;
      }
    }
    window.scrollTo(windowX, windowY);
  }
}
