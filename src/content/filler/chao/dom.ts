// @ts-nocheck
/**
 * DOM 与控件策略层。
 * 职责：标签提取、控件类型判定、写入、**写入后回读校验**。
 * 关键原则：
 *  1) 只读/点选控件一律先点开读选项，再比对别名，绝不把长文本/证件号硬塞进去；
 *  2) 每次写入后必须回读页面实际值，读不回目标值就判失败——这样「控件静默拒绝」会进漏填表，而不是假装成功；
 *  3) 全工程「读控件值 / 判断是否为空」只走 readControlText / isControlEmpty 两个函数，
 *     避免出现「扫描看它是空的、行内匹配说它已有值」这类自相矛盾（历史上年/月下拉永远填不进去就是这个原因）。
 */
import { dateTextMatches, isCalendarDate, normalizeDate, optionMatchAliases } from './rules';
import { chaoDebug } from './debug';

/** 面板 id：排除扩展自身 DOM，避免扫到自己画的浮层 */
export const PANEL_ID = 'resume-autofill-panel';
/** P4a 页内进度浮层 id，同样要从扫描/点选里排除 */
export const PAGE_OVERLAY_ID = 'tangtou-page-overlay';
export const AUTOFILL_FILL_CLASS = 'raf-autofill-filled';
export const AUTOFILL_MISS_CLASS = 'raf-autofill-missed';

/**
 * 判断节点是否落在本扩展注入的 UI 内（旧面板或页内浮层）。
 */
export function isInsideTangtouUi(node: Element | null | undefined): boolean {
  if (!(node instanceof Element)) {
    return false;
  }
  return Boolean(
    node.closest(`#${PANEL_ID}, #${PAGE_OVERLAY_ID}, [data-tangtou-ui]`),
  );
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 控件类型：决定用哪套写入策略 */
export const CONTROL = {
  nativeSelect: 'native-select',
  optionWidget: 'option-widget',
  dateInput: 'date-input',
  contentEditable: 'contenteditable',
  text: 'text',
};

/** 字段是否可见可交互：不可见字段一律不扫，防止对着隐藏模板写值 */
export function isPageFieldVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 标签缓存。
 * 为什么必须缓存：fieldLabelBlob 会读「前序兄弟节点的文本」，而兄弟节点里可能正是刚填好的值
 * （例如「政治面貌」填成共青团员后，紧邻的「手机号」输入框会把「政治面貌共青团员」当成自己的标签，
 *  于是手机号被写成共青团员）。缓存「首次扫描时」的标签即可彻底避免这种自我污染。
 */
let labelCacheGeneration = 0;
const labelCache = new Map();

/** 每次新的填写流程开始时调用，让标签重新计算 */
export function resetLabelCache() {
  labelCacheGeneration += 1;
  if (labelCache.size > 4000) labelCache.clear();
}

/**
 * 提取字段上下文文案（label 的主要来源）。
 * 顺序按可信度：aria → label[for] → 包裹 label → placeholder → 前序兄弟文本 → 就近祖先里的 label → name/id 兜底。
 */
export function fieldLabelBlob(el) {
  const cached = labelCache.get(el);
  if (cached && cached.generation === labelCacheGeneration) return cached.blob;
  const blob = computeFieldLabelBlob(el);
  labelCache.set(el, { generation: labelCacheGeneration, blob });
  return blob;
}

/** 真正计算标签（只在缓存未命中时执行） */
function computeFieldLabelBlob(el) {
  const parts = [];
  const push = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 60) parts.push(text);
  };
  push(el.getAttribute('aria-label'));
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) labelledBy.split(/\s+/).forEach((id) => push(document.getElementById(id)?.textContent));
  if (el.id) {
    try {
      push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent);
    } catch {
      /* 非法 id 忽略 */
    }
  }
  push(el.closest('label')?.textContent);
  push(el.getAttribute('placeholder'));
  push(el.getAttribute('data-placeholder'));
  // 前序兄弟文本：必须含中文或字母且长度 ≥2；
  // 并且必须「自己不含任何控件（含 role=combobox 组件）」——否则会把隔壁字段的标签甚至已填值当成本字段标签
  const pushPrevText = (node) => {
    if (!node || isEditable(node) || node.querySelector('input, textarea, select, [contenteditable], [role="combobox"]')) return;
    const text = node.textContent.replace(/\s+/g, '');
    if (text.length >= 2 && text.length <= 60 && /[\u4e00-\u9fa5a-zA-Z]/.test(text)) push(node.textContent);
  };
  pushPrevText(el.previousElementSibling);
  // 组件库常见版式：label 与输入框是兄弟分支，向上找就近祖先里的 label 文字
  let host = el.parentElement;
  for (let depth = 0; host && depth < 4; depth += 1, host = host.parentElement) {
    const before = parts.length;
    let labelEl = host.querySelector(':scope > label');
    if (!labelEl && /(form|field|item|group|control|content)/i.test(host.getAttribute('class') || '')) {
      labelEl = host.querySelector(':scope > [class*="label" i], :scope > div > label');
    }
    if (!labelEl) {
      labelEl = [...host.children].find((child) => !child.contains(el)
        && !child.querySelector('input, textarea, select, [contenteditable], [role="combobox"]')
        && (() => {
          const text = child.textContent.replace(/\s+/g, '');
          return text.length >= 2 && text.length <= 24 && /[\u4e00-\u9fa5a-zA-Z]/.test(text);
        })());
    }
    if (labelEl && !labelEl.contains(el)) push(labelEl.textContent);
    pushPrevText(host.previousElementSibling);
    if (parts.length > before) break;
  }
  push(el.getAttribute('name'));
  push(el.id);
  return parts.join(' ');
}

/** 是否可编辑文本控件 */
export const isEditable = (el) => Boolean(el) && (
  el.isContentEditable
  || el.tagName?.toLowerCase() === 'textarea'
  || (el.tagName?.toLowerCase() === 'input' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type))
);

/** 只读且是日期/时间类 → 视为组件触发器（自定义日期控件也是只读的，要纳入扫描） */
export function isWidgetTrigger(el) {
  if (el.getAttribute('aria-haspopup')) return true;
  if (el.closest('[class*="select" i], [class*="picker" i], [class*="dropdown" i], [class*="cascader" i]')) return true;
  return /(日期|时间|生日|date|time)/i.test(fieldLabelBlob(el));
}

/** 是不是「可选择组件」（可输入文本 + 带下拉触发器） */
function looksLikeSelectWidget(el) {
  const scope = el.closest(
    '[class*="select" i], [class*="picker" i], [class*="dropdown" i],'
    + ' [class*="cascader" i], [class*="autocomplete" i], [class*="combobox" i]',
  );
  if (!scope) return false;
  // 有下拉箭头/后缀图标，或本身就是 combobox，才按点选处理
  return Boolean(scope.querySelector(
    '[aria-haspopup], [class*="arrow" i], [class*="suffix" i], [class*="caret" i], [class*="icon" i], [role="combobox"]',
  ));
}

/**
 * 判定控件类型。顺序很重要：原生 select > 组件触发器 > 日期输入 > 可编辑 > 文本。
 * 注意：「可输入 + 带下拉」的组件（请输入就读学校 ⌄）也按点选处理，
 * 因为直接 setNativeValue 会被组件打回；写入侧还有「点选失败回落文本」的双策略兜底。
 */
export function classifyControl(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return CONTROL.nativeSelect;
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) return CONTROL.optionWidget;
  if (looksLikeSelectWidget(el)) return CONTROL.optionWidget;
  if (el.readOnly) return CONTROL.optionWidget;
  if (el.isContentEditable) return CONTROL.contentEditable;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (['date', 'month', 'datetime-local', 'time'].includes(type)) return CONTROL.dateInput;
  return CONTROL.text;
}

/** 是否点选类控件（禁止塞长数字/长文本） */
export function isOptionControl(field) {
  return field.control === CONTROL.optionWidget || field.control === CONTROL.nativeSelect;
}

/**
 * 占位文案判定。
 * 组件化下拉的触发器里往往渲染着「年」「请选择」「例：XXXX」这类提示文字，它不代表已经填过值。
 * 若不排除，会出现「扫描当它是空、回读说它已有值」的矛盾（年/月下拉填不进、示例文案被跳过都由此而来）。
 *
 * 判据用「开头匹配」而不是 includes，避免把真正填好的内容误判成占位：
 *  1) 裸年/月/日；
 *  2) 纯符号（下划线、横杠等）；
 *  3) 中文提示词（请选择/请输入/…）；
 *  4) 示例词（例/例如/示例/格式/待填/选填…）；
 *  5) 含冒号的示例（例：XXXX、格式：YYYY-MM）；
 *  6) 英文提示词（select/choose/please/search…）。
 */
export function isPlaceholderText(rawText) {
  const text = String(rawText || '')
    .replace(/\s+/g, '')
    .replace(/^[*＊]+/, '');
  if (!text) return true;
  if (/^[年月日]{1,4}$/.test(text)) return true;
  if (/^[-—–－_＿/·.、]+$/.test(text)) return true;
  if (/^(请选择|请填写|请输入|请勾选|请选|选择|暂无|暂无选项|未选择|未填写|尚未填写|无$)/.test(text)) return true;
  if (/^(例|例如|示例|如|比如|待填|待填写|选填|格式|参考|输入|填写)/.test(text)) return true;
  if (/[:：]/.test(text) && /(例|如|格式|参考|x{2,}|X{2,})/.test(text)) return true;
  if (/^(select|choose|please|search|enter|type|pick)/i.test(text)) return true;
  return false;
}

/**
 * 组件「已选值」节点的选择器白名单。
 * 只在这些明确的节点上取文本，绝不读整个容器——
 * 否则空输入框会读到容器里的字段名（class 常含 select），被误判成「已经有值」。
 */
const SELECTED_VALUE_SELECTOR = [
  '.el-select__selected',
  '.el-select__placeholder + span',
  '.ant-select-selection-item',
  '.van-field__control',
  '[class*="selection-item" i]',
  '[class*="selected-value" i]',
  '[class*="select-value" i]',
  '[class*="selectedLabel" i]',
].join(', ');

/**
 * 节点自己的短文字，不含打开的名单整段。
 * 调用方：readSelectedChipText。输入：页面节点。输出：压掉空白后的短文字；过长则返回空，避免把下拉原文当成已选值。
 */
function ownShortText(node) {
  if (!(node instanceof HTMLElement)) return '';
  let directText = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) directText += child.textContent || '';
  }
  const compactDirect = directText.replace(/\s+/g, '');
  if (compactDirect) return compactDirect.length <= 12 ? compactDirect : '';
  const nestedText = String(node.textContent || '').replace(/\s+/g, '');
  return nestedText.length <= 12 ? nestedText : '';
}

/**
 * 这个节点是否落在已经浮起的选项层里。
 * 触发器自己的外框即使是绝对定位，也包着当前格子，不算选项层。
 * 调用方：readSelectedChipText。输入：候选标签、当前格子。输出：在选项层里为 true。
 */
function isInsideFloatingChoiceList(chipNode, fieldElement) {
  let ancestor = chipNode.parentElement;
  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor);
    const box = ancestor.getBoundingClientRect();
    const floated = (style.position === 'fixed' || style.position === 'absolute')
      && box.height > 40
      && box.width > 48;
    if (floated && fieldElement instanceof HTMLElement && !ancestor.contains(fieldElement)) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/**
 * 读触发器同一行上的已选短标签，例如「① 北京」。
 * 打开的「上海、北京」名单在格子下方或浮层里，不读。字段名、占位、关闭叉也不读。
 * 调用方：readControlText 在 ant/element 已选节点和输入框 value 都空时。
 * 输入：当前格子。输出：同一行上各枚标签的短文字连在一起；没有则空。
 */
function readSelectedChipText(fieldElement) {
  if (!(fieldElement instanceof HTMLElement)) return '';
  const fieldBox = fieldElement.getBoundingClientRect();
  if (fieldBox.height < 1 || fieldBox.width < 1) return '';
  let searchRoot = fieldElement.parentElement;
  for (let depth = 0; depth < 6 && searchRoot?.parentElement && searchRoot.parentElement !== document.body; depth += 1) {
    const parentBox = searchRoot.parentElement.getBoundingClientRect();
    if (parentBox.height > 96) break;
    searchRoot = searchRoot.parentElement;
  }
  if (!(searchRoot instanceof HTMLElement)) return '';
  const chipNodes = [...searchRoot.querySelectorAll('span, div, a, li')].filter((node) => {
    if (!(node instanceof HTMLElement) || node === fieldElement || fieldElement.contains(node)) return false;
    if (isInsideTangtouUi(node)) return false;
    if (node.closest('[role="listbox"], [role="option"], [role="menu"]')) return false;
    if (isInsideFloatingChoiceList(node, fieldElement)) return false;
    const chipBox = node.getBoundingClientRect();
    if (chipBox.width < 1 || chipBox.height < 1) return false;
    // 只认落在格子框内的标签。挂在格子下面的选项顶边不在框内，不能当成已经选中
    const sameRow = chipBox.top < fieldBox.bottom - 2 && chipBox.bottom > fieldBox.top + 2;
    if (!sameRow) return false;
    const chipText = ownShortText(node);
    if (!chipText || isPlaceholderText(chipText)) return false;
    if (/^[×xX✕✖]$/.test(chipText)) return false;
    if (/^[①②③④⑤⑥⑦⑧⑨⑩0-9]$/.test(chipText)) return false;
    if (/搜索|取消|确定|请选择|最多可选|清空/.test(chipText)) return false;
    return true;
  });
  const leafChips = chipNodes.filter((node) => !chipNodes.some((other) => other !== node && node.contains(other)));
  const chipTexts = [];
  for (const chipNode of leafChips) {
    const chipText = ownShortText(chipNode);
    if (chipText && !chipTexts.includes(chipText)) chipTexts.push(chipText);
  }
  return chipTexts.join('').slice(0, 24);
}

/**
 * 读控件当前「显示文本」——全工程唯一读值入口。
 * select 取选中项文案；组件只认自身文本或「已选值节点」，其余取 value。
 * 多选城市把已选值画成标签、输入框 value 仍为空时，改读触发器同一行上的短标签。
 */
export function readControlText(el) {
  if (!el) return '';
  // 单选的 value 是选项本身，没勾上时不能当成框里已经写了「男」
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    if (!el.checked) return '';
    const labelText = (
      el.closest('label')?.textContent
      || el.value
      || ''
    ).replace(/\s+/g, '').trim();
    return labelText.slice(0, 24);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    return String(el.options?.[el.selectedIndex]?.text || el.value || '').trim();
  }
  if (el.isContentEditable) return String(el.textContent || '').trim();
  const selectWrap = el.closest?.('.ant-select, .el-select');
  if (selectWrap instanceof HTMLElement) {
    const selectedItem = selectWrap.querySelector('.ant-select-selection-item, .el-select__selected-item');
    const selectedText = String(selectedItem?.textContent || '').replace(/\s+/g, ' ').trim();
    if (selectedText && !isPlaceholderText(selectedText)) return selectedText.slice(0, 60);
    const placeholderNode = selectWrap.querySelector('.ant-select-selection-placeholder, .el-select__placeholder');
    if (placeholderNode) return '';
  }
  const ownValue = String(el.value || '').trim();
  if (ownValue && !isPlaceholderText(ownValue)) return ownValue;
  const ownText = String(el.textContent || '').replace(/\s+/g, ' ').trim();
  const compactText = ownText.replace(/\s+/g, '');
  // 打开的国家列表、省市弹窗整段文字不能当成这个框已经选中的值
  if (compactText.length > 24 && /请选择|中国香港|全部省市|已选地区/.test(compactText)) {
    return '';
  }
  if (ownText && !isPlaceholderText(ownText)) return ownText.slice(0, 60);
  // 组件把选中值渲染在专门的节点里时才回读；读不到再看同一行上的短标签
  const scope = el.closest('[class*="select" i], [class*="picker" i], [class*="dropdown" i]');
  const selectedNode = scope?.querySelector(SELECTED_VALUE_SELECTOR);
  const selectedText = String(selectedNode?.textContent || '').replace(/\s+/g, ' ').trim();
  if (selectedText && !isPlaceholderText(selectedText)) return selectedText.slice(0, 60);
  return readSelectedChipText(el);
}

/**
 * 控件是否为空——全工程唯一判空入口。
 * 关键：组件触发器的 textContent 若只是占位文案，仍然算空。
 */
export function isControlEmpty(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return !(el.value && el.selectedIndex > 0);
  if (el.isContentEditable) return !String(el.textContent || '').trim();
  const ownValue = String(el.value || '').trim();
  if (ownValue) return false;
  const ownText = String(el.textContent || '').replace(/\s+/g, '').trim();
  return isPlaceholderText(ownText);
}

/**
 * 告诉 React：这次 value 和它上次记住的不一样。
 * 不改的话，输入事件会被当成没变化，下一次渲染把证件号恢复成空。
 */
function markControlledValueChanged(element, nextValue) {
  const tracker = element._valueTracker;
  if (!tracker || typeof tracker.setValue !== 'function') {
    return;
  }
  const currentText = String(element.value ?? '');
  const nextText = String(nextValue ?? '');
  tracker.setValue(currentText === nextText ? `${currentText} ` : currentText);
}

/**
 * 这一格自己的 React 属性。只读输入框节点，不往父组件上找。
 */
function hostReactProps(element) {
  const propertyNames = Object.keys(element);
  const propsName = propertyNames.find((name) => name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$'));
  if (propsName && element[propsName]) {
    return element[propsName];
  }
  const fiberName = propertyNames.find((name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
  const fiber = fiberName ? element[fiberName] : null;
  return fiber?.memoizedProps || null;
}

/**
 * 把证件号交给这一格自己的 onChange，让表单先记住号码。
 * 不在这里失焦。表单还没记住时立刻 onBlur，页面会按空值把框刷回「请输入」。
 * 调用方：fillPlainField 在插入 18 位号码之后、离开这一格之前。
 * 输入：号码输入框。输出：无。会改组件记在这一格上的值，不改别的字段。
 */
function commitIdentityToComponent(element) {
  const props = hostReactProps(element);
  if (!props || typeof props.onChange !== 'function') {
    return;
  }
  const eventStub = {
    target: element,
    currentTarget: element,
    type: 'change',
    nativeEvent: { target: element },
    preventDefault() {},
    stopPropagation() {},
    persist() {},
  };
  try {
    props.onChange(eventStub);
  } catch {
    // 组件不要这种事件对象时，离开后的回读会判失败，不把空框写成成功
  }
}

/**
 * 原生方式写值：绕过 React/Vue 受控 value。
 * 必须用「当前节点自己原型上的」setter；禁止把 HTMLInputElement 的 setter 套到 div/.ant-select 上（会 Illegal invocation）。
 * 写入前先改掉控件自己记住的旧值，否则点到别的格子时页面会把刚写的字清掉。
 */
export function setNativeValue(el, value) {
  if (!(el instanceof HTMLElement)) {
    return;
  }
  try {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      markControlledValueChanged(el, value);
    }
    if (el instanceof HTMLInputElement) {
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (inputSetter) {
        inputSetter.call(el, value);
      } else {
        el.value = value;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      const areaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (areaSetter) {
        areaSetter.call(el, value);
      } else {
        el.value = value;
      }
    } else if ('value' in el) {
      el.value = value;
    } else {
      return;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value ?? ''), inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    // Illegal invocation / 只读控件：当作本格写失败，绝不抛到整轮
  }
}

/** 原生 select：按别名匹配 option 文案 */
function fillSelectOption(el, value) {
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  if (!aliases.length) return false;
  const options = [...el.options].filter((option) => option.text.trim() || option.value.trim());
  const lower = (text) => String(text || '').trim().toLowerCase();
  const hit = options.find((option) => aliases.includes(lower(option.text)) || aliases.includes(lower(option.value)))
    || options.find((option) => {
      const text = lower(option.text);
      return text.length >= 1 && aliases.some((alias) => text.includes(alias) || alias.includes(text));
    });
  if (!hit) return false;
  el.value = hit.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/** 0 和 1 只用浏览器插入；2 改用控件自身赋值。由逐格收尾按尝试次数切换。 */
let plainTextWriteMethod = 0;

/**
 * 切换普通输入框的写法。0、1 为插入文字，2 为原生赋值。
 */
export function setPlainTextWriteMethod(methodIndex: number) {
  plainTextWriteMethod = methodIndex >= 2 ? 2 : 0;
}

/**
 * 文本/日期/可编辑控件写入（不含点选控件）；外壳 div / select 直接失败。
 * 先让组件记下新值，再失焦。同一轮里立刻失焦时，组件读到的还是旧空值，点到下一格会把字清掉。
 */
async function fillPlainField(el, value) {
  const text = String(value || '').trim();
  if (!text || text === '至今') return false;
  try {
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      return true;
    }
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      return false;
    }
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    let output = text;
    if (type === 'date') {
      const date = normalizeDate(text);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      output = date;
    }
    if (type === 'month') {
      const date = normalizeDate(text);
      if (!/^\d{4}-\d{2}/.test(date)) return false;
      output = date.slice(0, 7);
    }
    el.focus();
    try {
      el.select();
    } catch {
      /* 部分控件无 select */
    }
    markControlledValueChanged(el, output);
    const isIdentityNumber = /^[0-9]{17}[0-9Xx]$/.test(output);
    let committed = false;
    // 证件号不用原生赋值。第 3 遍改 setter 时，组件会立刻把框清回空
    if (plainTextWriteMethod >= 2 && !isIdentityNumber) {
      setNativeValue(el, output);
      committed = String(el.value || '').includes(output);
    } else {
      try {
        // 先选中再插入：浏览器自己发出输入事件，受控表单才会把字存进状态
        committed = document.execCommand('insertText', false, output) === true
          && String(el.value || '').includes(output);
      } catch {
        committed = false;
      }
    }
    if (!committed) {
      return false;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (isIdentityNumber) {
      commitIdentityToComponent(el);
    }
    // 等组件把 onChange 里的 setState 写完，再失焦。证件号在表单记住之前失焦，会被刷回空
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
    el.blur();
    if (isIdentityNumber && !String(el.value || '').includes(output)) {
      return false;
    }
    // 日期被控件改写成不含年份的碎片 → 清空判失败（宁缺勿错）
    if (/^\d{4}/.test(output) && !String(el.value || '').includes(output.slice(0, 4))) {
      setNativeValue(el, '');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 自定义日期组件：多策略写入（面板点选 → 多格式去 readonly → 可输入回落文本） */
async function fillWidgetDate(el, value) {
  const date = normalizeDate(value);
  const yearMatch = date.match(/(19|20)\d{2}/);
  const yearText = yearMatch?.[0] || '';
  const monthMatch = date.match(/^\d{4}-(\d{2})/);
  const monthNumber = monthMatch ? String(Number(monthMatch[1])) : '';
  const formats = Array.from(new Set([
    date,
    date.slice(0, 7),
    date.replace(/-/g, '/'),
    date.slice(0, 7).replace(/-/g, '/'),
    date.replace(/-/g, ''),
    yearText && monthNumber ? `${yearText}年${monthNumber}月` : '',
    yearText || '',
  ].filter(Boolean)));

  el.scrollIntoView({ block: 'center' });
  el.click();
  await sleep(180);

  // 策略1：面板里点年份/月份（Ant/Element 日历常见）
  if (yearText) {
    const panelNodes = [...document.querySelectorAll(
      '[class*="picker" i], [class*="calendar" i], [class*="datepicker" i], [class*="date-panel" i], [role="dialog"]',
    )].filter((node) => node instanceof HTMLElement && isPageFieldVisible(node) && !isInsideTangtouUi(node));
    for (const panel of panelNodes) {
      const clickables = [...panel.querySelectorAll('button, td, a, span, div')]
        .filter((node) => node instanceof HTMLElement && isPageFieldVisible(node));
      const yearNode = clickables.find((node) => {
        const text = String(node.textContent || '').replace(/\s+/g, '').trim();
        return text === yearText || text === `${yearText}年`;
      });
      if (yearNode) {
        yearNode.click();
        await sleep(80);
      }
      if (monthNumber) {
        const monthNode = clickables.find((node) => {
          const text = String(node.textContent || '').replace(/\s+/g, '').trim();
          const digits = text.replace(/\D/g, '');
          return text === `${monthNumber}月` || text === monthNumber || digits === monthNumber;
        });
        if (monthNode) {
          monthNode.click();
          await sleep(80);
        }
      }
      if (/(19|20)\d{2}/.test(String(el.value || el.textContent || ''))) {
        return true;
      }
    }
  }

  // 策略2：去掉 readonly，按多种日期格式写入并提交
  const wasReadOnly = el.readOnly;
  if (wasReadOnly) el.removeAttribute('readonly');
  el.focus();
  for (const formatText of formats) {
    setNativeValue(el, formatText);
    ['keydown', 'keypress', 'keyup'].forEach((type) => el.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
    ));
    el.blur();
    await sleep(80);
    if (yearText && String(el.value || '').includes(yearText)) {
      if (wasReadOnly) el.setAttribute('readonly', '');
      return true;
    }
  }
  if (wasReadOnly) el.setAttribute('readonly', '');

  // 策略3：可输入控件回落纯文本（仍要求能留下年份）
  if (!el.readOnly && el.tagName.toLowerCase() === 'input') {
    const plainOk = await fillPlainField(el, date.slice(0, 7) || date);
    if (plainOk && yearText && String(el.value || '').includes(yearText)) {
      return true;
    }
  }
  return /(19|20)\d{2}/.test(String(el.value || ''));
}

/**
 * 弹层里收集可见选项（下拉/树选择器通用）。
 * 只收「选项」语义的节点：role=option，或弹层内的 li / option 类节点。
 * 阈值对齐参考实现：文本 ≤32 字（政治面貌最长「中国共产党预备党员」9 字，32 足够）、子元素 ≤3。
 */
function collectPopupOptions(root) {
  const scope = root || document;
  const containers = [...scope.querySelectorAll(
    '[role="listbox"], [role="menu"], [class*="dropdown" i], [class*="select" i], [class*="picker" i], [class*="popper" i], [class*="cascader" i]',
  )].filter((node) => node instanceof HTMLElement && !isInsideTangtouUi(node) && isPageFieldVisible(node));
  const options = [];
  containers.forEach((container) => {
    container.querySelectorAll('[role="option"], li, [class*="option" i], [class*="item" i]')
      .forEach((option) => options.push(option));
  });
  if (!options.length) options.push(...scope.querySelectorAll('[role="option"]'));
  const seen = new Set();
  return options.filter((option) => {
    if (!(option instanceof HTMLElement) || seen.has(option) || isInsideTangtouUi(option)) return false;
    seen.add(option);
    if (!isPageFieldVisible(option)) return false;
    const text = option.textContent.replace(/\s+/g, ' ').trim();
    return Boolean(text) && text.length <= 32 && option.children.length <= 3;
  });
}

/** 用 aria-controls / aria-owns 精确定位本字段的弹层；取不到返回 null */
function findOwnPopup(el) {
  const ids = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+/));
  for (const id of ids) {
    try {
      const node = document.getElementById(id);
      if (node instanceof HTMLElement && isPageFieldVisible(node)) return node;
    } catch {
      /* 非法 id 忽略 */
    }
  }
  return null;
}

/** 点选控件：点开 → 读选项 → 别名比对 → 点击 → 回读确认；多段级联则逐级点 */
async function fillWidgetByOption(el, value) {
  const segments = /[/、,，]/.test(value)
    ? value.split(/\s*[/、,，]\s*/).map((part) => part.trim()).filter(Boolean)
    : [value];
  // 多段时先整串试一次，再逐级点（籍贯「省/市/区」）
  const attempts = segments.length > 1 ? [value, ...segments] : segments;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attemptValue = attempts[attemptIndex];
    const aliases = optionMatchAliases(attemptValue).map((item) => item.toLowerCase());
    if (!aliases.length) continue;
    el.scrollIntoView({ block: 'center' });
    const beforeOptions = new Set(collectPopupOptions());
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    await sleep(350);
    const ownPopup = findOwnPopup(el);
    let allOptions = ownPopup ? collectPopupOptions(ownPopup) : collectPopupOptions();
    if (!allOptions.length) {
      chaoDebug.info('首次未读到选项，250ms 后重读一次', { 目标: attemptValue });
      await sleep(250);
      allOptions = ownPopup ? collectPopupOptions(ownPopup) : collectPopupOptions();
    }
    const freshOptions = allOptions.filter((option) => !beforeOptions.has(option));
    const options = ownPopup || !freshOptions.length ? allOptions : freshOptions;
    const optionTexts = options.map((option) => option.textContent.replace(/\s+/g, ' ').trim());
    chaoDebug.info(`打开下拉，读到 ${optionTexts.length} 个选项`, {
      目标: attemptValue,
      别名: aliases,
      选项: optionTexts.slice(0, 12),
    });
    const textOf = (option) => option.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = options.find((option) => aliases.includes(textOf(option)))
      || options.find((option) => {
        const text = textOf(option);
        return text.length >= 1 && aliases.some((alias) => text === alias || text.includes(alias) || alias.includes(text));
      });
    if (hit) {
      hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      hit.click();
      await sleep(180);
      // 多段级联：点中中间层后继续下一段；整串命中则直接成功
      if (attemptIndex === 0 || attemptIndex === attempts.length - 1 || segments.length === 1) {
        return true;
      }
      continue;
    }
    // 整串未命中时继续试分段；分段也未命中则关掉弹层
    if (attemptIndex === attempts.length - 1) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.body.click();
      await sleep(80);
      return false;
    }
  }
  return false;
}

/** 读控件当前「可读值」：用于写入后的回读校验（统一走 readControlText） */
export function readFieldValue(field) {
  return readControlText(field?.el);
}

/** 回读是否达标：整串包含、别名包含、城市去「市」、级联任一段、或年份一致 */
function valueLooksWritten(field, intended) {
  const actual = readFieldValue(field).toLowerCase();
  if (!actual) return false;
  const want = String(intended || '').trim().toLowerCase();
  if (!want) return false;
  // 日期必须年、月、日分开对，禁止「有 2005 或有 03 就算对」
  if (isCalendarDate(intended)) {
    return dateTextMatches(intended, actual);
  }
  if (actual.includes(want) || want.includes(actual)) return true;
  const aliases = optionMatchAliases(intended).map((alias) => alias.toLowerCase());
  if (aliases.some((alias) => actual.includes(alias) || alias.includes(actual))) return true;
  // 城市：北京 ↔ 北京市
  const stripCity = (text) => text.replace(/市$/g, '');
  if (stripCity(actual) && stripCity(want) && (
    stripCity(actual).includes(stripCity(want)) || stripCity(want).includes(stripCity(actual))
  )) {
    return true;
  }
  // 级联多段：任一段命中即算过（避免「北京市/朝阳区」写后只回显「朝阳区」）
  if (/[/、,，]/.test(want)) {
    const parts = want.split(/\s*[/、,，]\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.some((part) => actual.includes(part) || actual.includes(stripCity(part)))) {
      return true;
    }
  }
  return false;
}

/**
 * 复合框（证件号码：类型下拉 + 号码输入）里找出真正的文本输入。
 * 禁止返回 .ant-select 内部搜索框。
 */
function resolveAddonTextInput(el) {
  const captionNodes = [...document.querySelectorAll('span, label, div')].filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const text = String(node.textContent || '').replace(/[*＊\s：:]/g, '');
    return text.length <= 8 && /证件号码|证件号/.test(text);
  });
  const caption = captionNodes[0];
  if (!(caption instanceof HTMLElement)) {
    return null;
  }
  let row = caption.parentElement;
  for (let depth = 0; depth < 5 && row && row !== document.body; depth += 1) {
    const inputs = [...row.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')]
      .filter((input) => input instanceof HTMLInputElement
        && !input.readOnly
        && !input.disabled
        && !input.closest('.ant-select, .el-select, .ant-picker')
        && input.getBoundingClientRect().width > 40
        && (caption.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    const numberInput = inputs.find((input) => /请输入/.test(input.placeholder || '')) || inputs[0];
    if (numberInput) {
      return numberInput;
    }
    const rowText = String(row.textContent || '').replace(/\s+/g, '');
    if (/姓名/.test(rowText) && /证件/.test(rowText)) {
      break;
    }
    row = row.parentElement;
  }
  return null;
}

/**
 * 统一写入入口：按控件指纹走态机，写完后回读校验。
 * 单格异常只记失败，绝不抛到整轮（防止 Illegal invocation 红字打断）。
 * @returns {{ ok: boolean, reason: string }}
 */
export async function writeField(field, intendedValue) {
  try {
    return await writeFieldInner(field, intendedValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    chaoDebug.skip(`「${field?.blob || ''}」`, `写入异常：${detail.slice(0, 80)}`);
    return {
      ok: false,
      reason: /Illegal invocation/i.test(detail)
        ? '控件类型不匹配，已跳过本格'
        : (detail.slice(0, 60) || '写入异常'),
    };
  }
}

/** writeField 实际逻辑（外层已包 try/catch） */
async function writeFieldInner(field, intendedValue) {
  const value = String(intendedValue || '').trim();
  if (!value) return { ok: false, reason: '档案为空' };
  if (value === '至今') return { ok: false, reason: '「至今」需勾选复选框，跳过文本写入' };
  const labelBlob = String(field.blob || '');
  const isNameField = /姓名|名字/.test(labelBlob) && !/学校|单位|公司|证件|英文/.test(labelBlob);
  const isIdNumberValue = /^[0-9Xx]{15,18}$/.test(value);
  if (isNameField && isIdNumberValue) {
    return { ok: false, reason: '身份证号不能写入姓名' };
  }
  const isIdNumberField = /证件号码|证件号|身份证号/.test(labelBlob) && !/类型/.test(labelBlob);
  const isLongDigit = /^\d{6,}$/.test(value) || /^[0-9Xx]{15,18}$/.test(value);
  if (isLongDigit && isOptionControl(field) && !isIdNumberField) {
    chaoDebug.skip(`「${field.blob}」`, '长数字禁止写进点选控件');
    return { ok: false, reason: '数字不能写进点选控件' };
  }

  const started = Date.now();
  let wrote = false;
  let strategy = '文本输入';
  let failReason = '';
  let writeTarget = field.el;

  const { driveWidgetWrite, fingerprintWidget } = await import('./widgetDrivers');

  if (isIdNumberField && isLongDigit) {
    // 只写右侧号码格；找不到就漏填，禁止对类型下拉 setNativeValue
    const numberInput = resolveAddonTextInput(field.el);
    if (numberInput) {
      strategy = '证件号码纯文本（复合框右侧）';
      writeTarget = numberInput;
      wrote = await fillPlainField(numberInput, value);
    } else {
      strategy = '证件号码：未找到号码输入框';
      wrote = false;
      failReason = '证件号码复合框未找到可输入的号码格';
    }
  } else if (isIdNumberField && /身份证|护照/.test(value)) {
    strategy = '证件类型点选';
    const driven = await driveWidgetWrite(field.el, value, '证件类型');
    wrote = Boolean(driven.ok);
    failReason = driven.ok ? '' : (driven.reason || '');
  } else if (field.control === CONTROL.nativeSelect) {
    strategy = '原生 select 选项比对';
    wrote = fillSelectOption(field.el, value);
  } else {
    const fingerprint = fingerprintWidget(field.el, value, labelBlob);
    const shouldDrive = fingerprint === 'radioGroup'
      || fingerprint === 'datePanel'
      || fingerprint === 'suggestInput'
      || fingerprint === 'regionModal'
      || fingerprint === 'searchSelect'
      || field.control === CONTROL.optionWidget
      || field.control === CONTROL.dateInput
      || fingerprint === 'simpleSelect';

    if (shouldDrive && fingerprint !== 'plainText') {
      const driven = await driveWidgetWrite(field.el, value, labelBlob);
      strategy = `态机:${driven.fingerprint}`;
      wrote = Boolean(driven.ok);
      failReason = driven.ok ? '' : (driven.reason || '');
      const multiSegment = /[/、,，]/.test(value);
      if (!wrote && !multiSegment
        && field.el instanceof HTMLInputElement
        && !field.el.readOnly
        && !field.el.closest('.ant-select, .el-select')
        && fingerprint !== 'datePanel'
        && fingerprint !== 'regionModal'
        && fingerprint !== 'radioGroup') {
        strategy = `${strategy} → 回落文本`;
        wrote = await fillPlainField(field.el, value);
        if (wrote) failReason = '';
      }
    } else if (field.control === CONTROL.dateInput) {
      strategy = '原生日期';
      wrote = await fillPlainField(field.el, value);
    } else {
      wrote = await fillPlainField(field.el, value);
    }
  }

  const actual = readControlText(writeTarget) || readControlText(field.el);
  if (!wrote) {
    chaoDebug.value(field.blob, value, actual, Date.now() - started, {
      策略: strategy,
      结果: '控件拒绝',
      原因: failReason,
    });
    return { ok: false, reason: failReason || '控件拒绝写入' };
  }
  if (/性别/.test(labelBlob) || (field.el instanceof HTMLInputElement && field.el.type === 'radio')) {
    const nearbyChecked = field.el.closest('[class*="form-item" i], [class*="field" i], [class*="item" i], tr, div')
      ?.querySelector('input[type="radio"]:checked, [class*="radio" i][class*="checked" i]');
    if (nearbyChecked) {
      chaoDebug.value(field.blob, value, 'radio:checked', Date.now() - started, {
        策略: strategy,
        结果: '回读一致',
      });
      return { ok: true, reason: '' };
    }
  }
  const verified = valueLooksWritten({ ...field, el: writeTarget }, value)
    || valueLooksWritten(field, value);
  chaoDebug.value(field.blob, value, actual, Date.now() - started, {
    策略: strategy,
    结果: verified ? '回读一致' : '回读不一致',
  });
  if (!verified) return { ok: false, reason: '写入后回读不一致' };
  return { ok: true, reason: '' };
}

/** 在某个块内勾选「至今」之类的复选框（结束时间为空时用） */
export function tryCheckCurrentInBlock(blockEl) {
  if (!blockEl) return false;
  const labels = [...blockEl.querySelectorAll('label, [class*="checkbox" i], [class*="radio" i], span')];
  const target = labels.find((node) => /^(至今|现在|目前)$/.test(String(node.textContent || '').replace(/\s+/g, '')));
  if (!target) return false;
  const input = target.querySelector('input[type="checkbox"], input[type="radio"]')
    || (target.previousElementSibling instanceof HTMLInputElement ? target.previousElementSibling : null);
  if (input instanceof HTMLInputElement && !input.checked) {
    input.click();
    return true;
  }
  if (!input) {
    target.click();
    return true;
  }
  return false;
}

/** 注入高亮样式：绿=已写，橙=漏填 */
export function ensureHighlightStyles() {
  if (document.getElementById('tangtou-chao-autofill-style')) return;
  const style = document.createElement('style');
  style.id = 'tangtou-chao-autofill-style';
  style.textContent = `
    .${AUTOFILL_MISS_CLASS} { outline: 2px solid #f59e0b !important; outline-offset: 1px; }
  `;
  document.documentElement.appendChild(style);
}

/** 清掉上一轮的高亮，避免新旧结果混在一起 */
export function clearAutofillHighlights() {
  document.querySelectorAll(`.${AUTOFILL_FILL_CLASS}, .${AUTOFILL_MISS_CLASS}`)
    .forEach((el) => el.classList.remove(AUTOFILL_FILL_CLASS, AUTOFILL_MISS_CLASS));
}

/**
 * 躺投品牌视觉令牌（与 src/shared/ui/brand.css 同源）。
 * 内容脚本被注入到第三方页面里，读不到扩展的 CSS 变量，
 * 所以这里内联同一套色值，保证页面上的进度提示和 Popup / 侧栏是同一套观感。
 */
const TOAST_BRAND = {
  surface: '#ffffff',
  border: '#99f6e4',
  text: '#134e4a',
  secondary: '#14b8a6',
  primarySoft: '#ccfbf1',
  font: '"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
};

/**
 * 页面常驻进度条：长流程必须让用户看到「还在跑」。
 * 视觉沿用躺投的品牌语言：白底卡片 + 青绿描边 + 圆角 + 左侧状态圆点 + 青绿光晕。
 */
export function toastProgress(initialMessage) {
  let tip = document.getElementById('tangtou-chao-progress');
  let label = tip?.querySelector('[data-tt-label]');
  // 没有节点、或节点是旧结构（没有文字层）时，重建一次
  if (!tip || !label) {
    if (tip) tip.remove();
    tip = document.createElement('div');
    tip.id = 'tangtou-chao-progress';
    tip.style.cssText = 'position:fixed;z-index:2147483646;left:50%;top:16px;transform:translateX(-50%);'
      + 'display:flex;align-items:center;gap:10px;box-sizing:border-box;max-width:min(90vw,560px);'
      + `padding:10px 18px;border:1px solid ${TOAST_BRAND.border};border-radius:14px;`
      + `background:${TOAST_BRAND.surface};color:${TOAST_BRAND.text};`
      + `font:600 13px/1.5 ${TOAST_BRAND.font};letter-spacing:.01em;`
      + 'box-shadow:0 10px 30px rgba(15,118,110,.18),0 2px 6px rgba(19,78,74,.06);';
    // 左侧状态圆点：与侧栏「小节标题」前的圆点同一套样式
    const mark = document.createElement('span');
    mark.setAttribute('data-tt-mark', '1');
    mark.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:50%;`
      + `background:${TOAST_BRAND.secondary};box-shadow:0 0 0 4px ${TOAST_BRAND.primarySoft};`;
    label = document.createElement('span');
    label.setAttribute('data-tt-label', '1');
    label.style.cssText = 'min-width:0;word-break:break-word;';
    tip.append(mark, label);
    document.body.appendChild(tip);
  }
  const setMessage = (message) => {
    label.textContent = String(message || '');
  };
  setMessage(initialMessage);
  return {
    update(nextMessage) {
      setMessage(nextMessage);
    },
    done(finalMessage) {
      setMessage(finalMessage);
      setTimeout(() => tip?.remove(), 2200);
    },
  };
}
