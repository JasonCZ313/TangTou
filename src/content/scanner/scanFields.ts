import type { FieldDescriptor } from '../../shared/types/fill';

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
    const observer = new MutationObserver(() => {
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
  const selector = 'input, textarea, select, [contenteditable="true"]';
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
const SCAN_BUDGET_MS = 50_000;
/** 每一档滚动后留给懒加载的时间 */
const SCROLL_PAUSE_MS = 160;
/** 点开编辑类按钮的上限。Boss 直聘一类页面每个模块都要点一次编辑 */
const MAX_EDIT_CLICKS = 24;
/** 点开添加类按钮的上限；每个空区块只点一次 */
const MAX_ADD_CLICKS = 8;
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
 * 「添加」旁边或上一块已经有输入框时，不再点，避免扫出一堆空行。
 */
function nearbyAlreadyHasFields(button: HTMLElement): boolean {
  const scopes: Element[] = [];
  if (button.parentElement) {
    scopes.push(button.parentElement);
  }
  if (button.previousElementSibling) {
    scopes.push(button.previousElementSibling);
  }
  const parentPrevious = button.parentElement?.previousElementSibling;
  if (parentPrevious) {
    scopes.push(parentPrevious);
  }

  for (const scope of scopes) {
    const controls = scope.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]',
    );
    for (const control of controls) {
      if (control instanceof HTMLInputElement) {
        const inputType = control.type.toLowerCase();
        if (
          inputType === 'hidden' ||
          inputType === 'submit' ||
          inputType === 'button'
        ) {
          continue;
        }
      }
      if (isElementVisible(control)) {
        return true;
      }
    }
  }

  return false;
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

/** 节点自己的文字就是添加 */
const ADD_OWN_TEXT = /^(添加|新增|增加|加一条|加一行)$/;

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
  if (ADD_OWN_TEXT.test(own) || ADD_OWN_TEXT.test(ariaLabel) || ADD_OWN_TEXT.test(title)) {
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
  let addClicks = 0;

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
      if (target.kind === 'add') {
        if (addClicks >= MAX_ADD_CLICKS || nearbyAlreadyHasFields(target.element)) {
          continue;
        }
      } else if (editClicks >= MAX_EDIT_CLICKS) {
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
      if (target.kind === 'add') {
        addClicks += 1;
      } else {
        editClicks += 1;
      }
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
  const shouldStop = (): boolean => Date.now() - startedAt > SCAN_BUDGET_MS;
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
      // 编辑层关掉后框会消失，但打开它的按钮还在，写入时会再点开
      if (stillOnScreen || track.opener?.isConnected) {
        return true;
      }
      fieldTracks.delete(field.fieldId);
      fieldElementById.delete(field.fieldId);
      return false;
    });

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
