// @ts-nocheck
/**
 * 点选控件态机引擎：先识别控件指纹，再按固定交互协议点击，禁止「看见文字就乱点」。
 * 覆盖：日期年/月面板、联想输入、可搜索长列表、地区双栏弹窗、单选、普通下拉。
 */
import { optionMatchAliases, normalizeDate, dateTextMatches, sourceHasCalendarDay } from './rules';
import { chaoDebug } from './debug';
import {
  isInsideTangtouUi,
  isPageFieldVisible,
  readControlText,
  setNativeValue,
  sleep,
} from './dom';
import { mapRankToOptions } from '../../../shared/fill/sectionBinder';
import { recordFillStep } from '../fillTrace';
import {
  DEGREE_LEVEL_OPTIONS,
  NATIONALITY_OPTIONS,
  STUDY_MODE_OPTIONS,
} from '../../../shared/catalogs/enums';

/** 弹层候选选择器：打开后出现的浮层/面板（含传送门到 body 的层） */
const OVERLAY_SELECTOR = [
  '.ant-select-dropdown',
  '.ant-picker-dropdown',
  '.ant-cascader-dropdown',
  '.el-select-dropdown',
  '.el-picker-panel',
  '[class*="picker" i]',
  '[class*="datepicker" i]',
  '[class*="date-panel" i]',
  '[class*="calendar" i]',
  '[class*="dropdown" i]',
  '[class*="select-dropdown" i]',
  '[class*="select-popup" i]',
  '[class*="selectList" i]',
  '[class*="select-list" i]',
  '[class*="unmodeled" i]',
  '[class*="option-list" i]',
  '[class*="cascader" i]',
  '[class*="popper" i]',
  '[class*="popover" i]',
  '[class*="popup" i]',
  '[class*="modal" i]',
  '[class*="dialog" i]',
  '[class*="picker-dropdown" i]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="menu"]',
].join(', ');

/**
 * 弹层是否已经铺开（动画中 opacity=0 也算，只要有面积）。
 */
function isOverlayUsable(node) {
  if (!(node instanceof HTMLElement) || isInsideTangtouUi(node)) return false;
  const className = String(node.className || '');
  // 关掉的 Ant 弹层仍留在 body 上，点它等于没选
  if (/dropdown-hidden|picker-dropdown-hidden|ant-select-dropdown-hidden|ant-picker-dropdown-hidden/.test(className)) {
    return false;
  }
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const box = node.getBoundingClientRect();
  return box.width > 16 && box.height > 16;
}

/**
 * 采集当前已铺开的弹层（面积足够即收录，避免动画期漏检）。
 */
function snapshotOverlays() {
  return new Set(
    [...document.querySelectorAll(OVERLAY_SELECTOR)].filter((node) => isOverlayUsable(node)),
  );
}

/**
 * 相对打开前快照，找出本字段新打开的弹层（优先最大面积的那个）。
 */
function findFreshOverlay(beforeSet) {
  const all = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter((node) => isOverlayUsable(node));
  let fresh = all.filter((node) => !beforeSet.has(node));
  if (!fresh.length) {
    fresh = all.filter((node) => {
      const text = String(node.textContent || '');
      return /已选地区|全部省市|请选择|搜索|确定/.test(text) || node.querySelector('[role="option"], li');
    });
  }
  if (!fresh.length) return null;
  fresh.sort((left, right) => {
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    return (rightBox.width * rightBox.height) - (leftBox.width * leftBox.height);
  });
  return fresh[0];
}

/**
 * 点击后轮询等待弹层出现。
 */
async function waitForOverlay(beforeSet, timeoutMs = 1000) {
  const started = Date.now();
  let overlay = findFreshOverlay(beforeSet);
  while (!overlay && Date.now() - started < timeoutMs) {
    await sleep(80);
    overlay = findFreshOverlay(beforeSet);
  }
  return overlay;
}

/**
 * 点真正的下拉触发器。
 * 日期输入框仍点它自己：这一页的日历是点输入框打开的。
 * 学历这类下拉点外层看得见的格子，只点内部 input 打不开列表。
 */
function resolveClickTrigger(el) {
  if (!(el instanceof HTMLElement)) return el;
  const antWrap = el.closest('.ant-select, .el-select, .ant-picker, [role="combobox"]');
  if (antWrap instanceof HTMLElement && antWrap.getBoundingClientRect().height < 160) {
    const inner = antWrap.querySelector('.ant-select-selector, .el-select__wrapper, .ant-picker-input, input');
    if (inner instanceof HTMLElement) return inner;
    return antWrap;
  }
  const dateWrap = el.closest('[class*="picker" i], [class*="calendar" i]');
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && dateWrap instanceof HTMLElement) {
    return el;
  }
  const selectWrap = el.closest('[class*="select" i]');
  if (selectWrap instanceof HTMLElement && selectWrap !== el) {
    const box = selectWrap.getBoundingClientRect();
    if (box.height >= 16 && box.height < 80 && box.width >= 48 && box.width < 520) {
      return selectWrap;
    }
  }
  return el;
}

/**
 * 关掉本字段弹层。成功选中后只 Esc，禁止 body.click 把已选项清掉。
 */
async function dismissOverlay(triggerEl, forceBodyClick = false) {
  triggerEl?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true,
  }));
  if (forceBodyClick) {
    document.body.click();
  }
  await sleep(80);
}

/**
 * 安全点击：派发 mousedown + click，更接近真实用户。
 */
function safeClick(node) {
  if (!(node instanceof HTMLElement)) return false;
  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const eventInit = { bubbles: true, cancelable: true, view: window };
  node.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  node.dispatchEvent(new MouseEvent('mousedown', eventInit));
  node.dispatchEvent(new PointerEvent('pointerup', eventInit));
  node.dispatchEvent(new MouseEvent('mouseup', eventInit));
  node.click();
  return true;
}

/**
 * 先点 selector / picker 输入区，再点外层 wrap，避免只点内部只读 input 打不开层。
 */
function openSelectLike(el) {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'center' });
  const trigger = resolveClickTrigger(el);
  safeClick(trigger);
  const wrap = el.closest('.ant-select, .el-select, .ant-picker');
  if (wrap instanceof HTMLElement && wrap !== trigger) {
    safeClick(wrap);
  }
}

/**
 * 节点自身可见文本（不含深层大段子孙），用于选项比对。
 */
function ownVisibleText(node) {
  if (!(node instanceof HTMLElement)) return '';
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    }
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned;
  return String(node.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * 别名是否与选项文案匹配（精确优先，再包含）。
 */
function textMatchesAliases(text, aliases) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return false;
  if (aliases.includes(lower)) return true;
  return aliases.some((alias) => {
    if (!alias) return false;
    return lower === alias || lower.includes(alias) || alias.includes(lower);
  });
}

/**
 * 在容器内找最佳选项节点；优先叶子、短文案。
 */
function findBestOption(container, aliases, options = {}) {
  const {
    allowLong = false,
    maxTextLength = allowLong ? 48 : 32,
    excludeNav = true,
  } = options;
  if (!container) return null;
  const candidates = [...container.querySelectorAll(
    '[role="option"], li, td, label, button, a, span, div',
  )].filter((node) => {
    if (!(node instanceof HTMLElement) || isInsideTangtouUi(node)) return false;
    if (!isPageFieldVisible(node)) return false;
    if (excludeNav) {
      const className = String(node.className || '');
      if (/prev|next|super|arrow|header|title|search|btn-ok|btn-cancel|today/i.test(className)
        && !/option|item|cell|year|month|day/i.test(className)) {
        return false;
      }
      const aria = node.getAttribute('aria-label') || '';
      if (/上一年|下一年|上一月|下一月|前一年|后一年|今天/.test(aria)) return false;
    }
    const text = ownVisibleText(node);
    if (!text || text.length > maxTextLength) return false;
    // 过深容器（整块面板）不当选项
    if (node.children.length > 6 && node.querySelectorAll('li, td, [role="option"]').length > 3) {
      return false;
    }
    return textMatchesAliases(text, aliases);
  });
  if (!candidates.length) return null;
  // 文本越短、越接近精确匹配越好
  candidates.sort((left, right) => {
    const leftText = ownVisibleText(left).toLowerCase();
    const rightText = ownVisibleText(right).toLowerCase();
    const leftExact = aliases.includes(leftText) ? 0 : 1;
    const rightExact = aliases.includes(rightText) ? 0 : 1;
    if (leftExact !== rightExact) return leftExact - rightExact;
    return leftText.length - rightText.length;
  });
  return candidates[0];
}

/**
 * 在可滚动列表里查找目标：先可见，再多次向下滚动重采。
 */
async function findOptionWithScroll(container, aliases) {
  let hit = findBestOption(container, aliases, { allowLong: true });
  if (hit) return hit;
  const scrollHosts = [
    container,
    ...container.querySelectorAll('[class*="body" i], [class*="list" i], [class*="scroll" i], [class*="content" i]'),
  ].filter((node) => node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 8);
  for (const host of scrollHosts.slice(0, 3)) {
    const maxSteps = 12;
    for (let step = 0; step < maxSteps; step += 1) {
      host.scrollTop = Math.min(host.scrollHeight, host.scrollTop + Math.max(120, host.clientHeight * 0.8));
      await sleep(60);
      hit = findBestOption(container, aliases, { allowLong: true });
      if (hit) return hit;
      if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) break;
    }
    host.scrollTop = 0;
  }
  return null;
}

/**
 * 全页寻找已经打开的国家列表或省市弹窗。
 * 不要求它是刚出现的，也不要求 class 里带 dropdown。旧弹窗开着时也要认出来。
 */
function findVisibleChoicePanel() {
  const searchInputs = [...document.querySelectorAll('input')].filter((input) => {
    if (!(input instanceof HTMLInputElement) || !isPageFieldVisible(input)) return false;
    const tip = `${input.placeholder || ''}${input.getAttribute('aria-label') || ''}`;
    return /搜索|search/i.test(tip);
  });
  const panels = [];
  for (const input of searchInputs) {
    let node = input.parentElement;
    const chain = [];
    for (let depth = 0; depth < 10 && node && node !== document.body; depth += 1) {
      const box = node.getBoundingClientRect();
      const text = String(node.textContent || '').replace(/\s+/g, '');
      const looksLikeChoice = /已选地区|全部省市/.test(text) || (/中国/.test(text) && /香港|澳门|台湾|美国|日本/.test(text));
      if (looksLikeChoice && box.height > 80 && box.height < window.innerHeight * 0.96 && box.width > 160) {
        chain.push(node);
      }
      node = node.parentElement;
    }
    const withConfirm = chain.filter((panel) => panelHasExactAction(panel, '确定'));
    const picked = withConfirm[0] || chain[0];
    if (picked) panels.push(picked);
  }
  panels.sort((left, right) => {
    const leftHasConfirm = panelHasExactAction(left, '确定') ? 0 : 1;
    const rightHasConfirm = panelHasExactAction(right, '确定') ? 0 : 1;
    if (leftHasConfirm !== rightHasConfirm) return leftHasConfirm - rightHasConfirm;
    return left.getBoundingClientRect().height - right.getBoundingClientRect().height;
  });
  return panels[0] || null;
}

/**
 * 面板里是否有文字正好是「确定」或「保存」的按钮。
 */
function panelHasExactAction(panel, actionText) {
  return [...panel.querySelectorAll('button, a, span, div')].some((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) return false;
    return ownVisibleText(node).replace(/\s+/g, '') === actionText;
  });
}

/**
 * 当前页面上还铺开的弹层。输入框本身不算，只算浮起来挡住别的空的那一层。
 */
export function listOpenPanels() {
  const fromSelector = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter((node) => {
    if (!(node instanceof HTMLElement) || !isOverlayUsable(node)) return false;
    const style = window.getComputedStyle(node);
    const box = node.getBoundingClientRect();
    if (style.position === 'fixed' || style.position === 'absolute') {
      return box.height > 40;
    }
    const role = node.getAttribute('role') || '';
    if (role === 'listbox' || role === 'dialog') return true;
    const text = String(node.textContent || '').replace(/\s+/g, '');
    return /已选地区|全部省市/.test(text) && box.height > 80;
  });
  const choicePanel = findVisibleChoicePanel();
  const merged = choicePanel instanceof HTMLElement && !fromSelector.includes(choicePanel)
    ? [...fromSelector, choicePanel]
    : fromSelector;
  const outermost = merged.filter((node) => !merged.some((other) => other !== node && other.contains(node)));
  outermost.sort((left, right) => {
    const leftZ = Number(window.getComputedStyle(left).zIndex) || 0;
    const rightZ = Number(window.getComputedStyle(right).zIndex) || 0;
    return rightZ - leftZ;
  });
  return outermost;
}

/**
 * 弹层里文字正好是「取消」或「确定」的那个小按钮。
 * 这个网站的确定不是 button，只搜 button 会找不到。
 */
function findExactAction(panel, actionText) {
  if (!(panel instanceof HTMLElement)) return null;
  const nodes = [...panel.querySelectorAll('button, a, span, div')].filter((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) return false;
    const text = ownVisibleText(node).replace(/\s+/g, '');
    const box = node.getBoundingClientRect();
    return text === actionText && box.height >= 16 && box.height <= 64 && box.width >= 24 && box.width <= 200;
  });
  nodes.sort((left, right) => {
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    return leftBox.width * leftBox.height - rightBox.width * rightBox.height;
  });
  return nodes[0] || null;
}

/**
 * 点弹层里的取消。点最小的那个「取消」，避免点到整条底栏。
 */
function clickPanelDismiss(panel) {
  const hit = findExactAction(panel, '取消') || findExactAction(panel, '关闭');
  if (!(hit instanceof HTMLElement)) return false;
  hit.click();
  safeClick(hit);
  return true;
}

/**
 * 节点自己的短文字，用来避开「提交 / 下一步」这类按钮。
 * 不用整段 textContent，避免角落上的大空白因为子孙里有「确定」被跳过。
 */
function ownDirectText(node) {
  if (!(node instanceof HTMLElement)) return '';
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent || '';
  }
  return text.replace(/\s+/g, '');
}

/**
 * 当前格子所在的填写区。表单或包着「删除」的那一层都算。
 * 空白点击必须落在这一层外面，避免点到删除。
 */
function fillRegionRoot(aroundElement) {
  if (!(aroundElement instanceof HTMLElement)) return null;
  const form = aroundElement.closest('form');
  if (form instanceof HTMLElement && form !== document.body) return form;
  let current = aroundElement.parentElement;
  let regionWithDelete = null;
  for (let depth = 0; depth < 14 && current && current !== document.body; depth += 1) {
    const hasDelete = [...current.querySelectorAll('button, a, span, div')].some((node) => {
      const text = ownDirectText(node);
      return text === '删除' || text === '删除本条';
    });
    if (hasDelete) regionWithDelete = current;
    current = current.parentElement;
  }
  return regionWithDelete;
}

/**
 * 页面上用来试空白的点。页眉往往在填写区外面，不只试三个角。
 */
function blankProbePoints() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const points = [];
  for (const pointY of [6, 20, 36]) {
    for (let pointX = 16; pointX < width - 16; pointX += 120) {
      points.push([pointX, pointY]);
    }
  }
  points.push([16, Math.round(height / 2)]);
  points.push([Math.max(16, width - 16), Math.round(height / 2)]);
  return points;
}

/**
 * 对空白按下再点击。页面用按下判断「点到外面」，只发 click 名单不会收。
 */
function pressBlankTarget(node, pointX, pointY) {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: pointX,
    clientY: pointY,
  };
  node.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  node.dispatchEvent(new MouseEvent('mousedown', eventInit));
  node.dispatchEvent(new PointerEvent('pointerup', eventInit));
  node.dispatchEvent(new MouseEvent('mouseup', eventInit));
  node.dispatchEvent(new MouseEvent('click', eventInit));
}

/**
 * 点弹层外面、填写区外面的一块空白。
 * 给关窗和每一格写完后的确认用。不点输入框、按钮、删除、提交。
 * 找不到合格空白就返回 false，不改去点填写区。
 * aroundElement 是当前正在写的格子，用来划出填写区。
 */
export function clickOutsideOpenPanels(aroundElement = null) {
  const openPanels = listOpenPanels();
  const choicePanel = findVisibleChoicePanel();
  const blockedPanels = choicePanel instanceof HTMLElement && !openPanels.includes(choicePanel)
    ? [...openPanels, choicePanel]
    : openPanels;
  const fillRoot = fillRegionRoot(aroundElement);
  const blockedOwnText = /^(删除|删除本条|提交|投递|下一步|保存|确定|添加)$/;
  for (const [pointX, pointY] of blankProbePoints()) {
    const node = document.elementFromPoint(pointX, pointY);
    if (!(node instanceof HTMLElement)) continue;
    if (aroundElement instanceof HTMLElement && (node === aroundElement || aroundElement.contains(node))) {
      continue;
    }
    if (isInsideTangtouUi(node)) continue;
    if (blockedPanels.some((panel) => panel instanceof HTMLElement && panel.contains(node))) continue;
    if (fillRoot instanceof HTMLElement && fillRoot.contains(node)) continue;
    if (node.closest('input, textarea, select, button, a, [role="combobox"], [role="listbox"]')) continue;
    const directText = ownDirectText(node);
    if (blockedOwnText.test(directText)) continue;
    pressBlankTarget(node, pointX, pointY);
    recordFillStep('空白', '点空白', '已点', `${node.tagName.toLowerCase()} ${directText || '无字'}`);
    return true;
  }
  recordFillStep('空白', '点空白', '没有合格空白', '不点填写区');
  return false;
}

/**
 * 关掉所有还开着的弹层。先点取消，再收起已展开的触发器，再按 Esc。
 * 城市名单没有「取消」，Esc 也关不掉时，点填写区外的空白。
 * 关不掉就返回 false，调用方不许再点开下一个空。
 * aroundElement 是当前格子，用来避开它所在的填写区。
 */
export async function ensurePanelsClosed(aroundElement = null) {
  for (let round = 0; round < 5; round += 1) {
    const choicePanel = findVisibleChoicePanel();
    const panels = listOpenPanels();
    if (!(choicePanel instanceof HTMLElement) && panels.length === 0) return true;
    const scope = choicePanel instanceof HTMLElement ? choicePanel : panels[0];
    const beforeCount = Math.max(panels.length, choicePanel instanceof HTMLElement ? 1 : 0);
    if (scope instanceof HTMLElement && clickPanelDismiss(scope)) {
      await sleep(180);
      if (listOpenPanels().length < beforeCount && !(findVisibleChoicePanel() instanceof HTMLElement)) {
        continue;
      }
    }
    const expanded = [...document.querySelectorAll('[aria-expanded="true"]')].find((node) =>
      node instanceof HTMLElement && isPageFieldVisible(node) && !(scope instanceof HTMLElement && scope.contains(node)),
    );
    if (expanded instanceof HTMLElement) {
      expanded.click();
      safeClick(expanded);
      await sleep(160);
      continue;
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(140);
    if (listOpenPanels().length === 0 && !(findVisibleChoicePanel() instanceof HTMLElement)) {
      return true;
    }
    // 没有「取消」的名单只认点到外面。这一步之前取消和 Esc 已经试过
    clickOutsideOpenPanels(aroundElement);
    await sleep(160);
  }
  return listOpenPanels().length === 0 && !(findVisibleChoicePanel() instanceof HTMLElement);
}

/**
 * 关掉已经开着的选择层，避免意向工作地点的弹窗挡住现居住地。
 */
async function closeOpenChoicePanels() {
  await ensurePanelsClosed();
}

/**
 * 点开当前字段，并取全页可见的选择层（包括点之前就已经开着的）。
 */
async function openChoicePanel(el) {
  const closed = await ensurePanelsClosed(el);
  if (!closed) return null;
  openSelectLike(el);
  await sleep(280);
  let panel = findVisibleChoicePanel();
  if (!panel) {
    openSelectLike(el);
    await sleep(320);
    panel = findVisibleChoicePanel();
  }
  return panel;
}

/**
 * 地区弹窗里点圆点所在的整行，不点里面的文字节点。
 * 文字节点点下去圆点不变，右侧会一直停在已选地区 0/1。
 */
function compactChoiceLabel(raw) {
  return String(raw || '').replace(/\s+/g, '').replace(/[>›〉→○●◯]/g, '');
}

function findRegionChoiceRow(panel, label) {
  const wanted = compactChoiceLabel(label);
  if (!wanted || !panel) return null;
  const nodes = [...panel.querySelectorAll('div, label, li, span, a')].filter((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node) || isInsideTangtouUi(node)) return false;
    const box = node.getBoundingClientRect();
    if (box.height < 10 || box.height > 72) return false;
    const text = compactChoiceLabel(node.textContent);
    if (!text || text.length > 24) return false;
    if (/搜索|确定|取消|已选地区|全部省市|全国|清空已选|请在左侧/.test(text)) return false;
    if (text === wanted) return true;
    if (wanted === '中国' && text !== '中国') return false;
    return text.includes(wanted);
  });
  const exact = nodes.filter((node) => compactChoiceLabel(node.textContent) === wanted);
  const pool = exact.length ? exact : nodes;
  pool.sort((left, right) => {
    const leftLength = compactChoiceLabel(left.textContent).length;
    const rightLength = compactChoiceLabel(right.textContent).length;
    if (leftLength !== rightLength) return leftLength - rightLength;
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    return leftBox.width * leftBox.height - rightBox.width * rightBox.height;
  });
  const textNode = pool[0];
  if (!(textNode instanceof HTMLElement)) return null;
  let row = textNode;
  for (let depth = 0; depth < 4 && row.parentElement && row.parentElement !== panel; depth += 1) {
    const parent = row.parentElement;
    const parentBox = parent.getBoundingClientRect();
    const parentText = compactChoiceLabel(parent.textContent);
    if (parentBox.height > 72 || parentText.length > wanted.length + 6) break;
    row = parent;
  }
  return row;
}

/**
 * 收集弹窗里看得见的城市/选项短文案，供第二次问模型。
 */
function listVisibleChoiceLabels(panel) {
  const labels = new Set();
  for (const node of panel.querySelectorAll('div, span, label, li, a')) {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) continue;
    const text = compactChoiceLabel(node.textContent);
    if (!text || text.length > 12 || text.length < 2) continue;
    if (/搜索|确定|取消|已选地区|全部省市|全国|清空已选|请在左侧/.test(text)) continue;
    const box = node.getBoundingClientRect();
    if (box.height < 10 || box.height > 48) continue;
    labels.add(text);
  }
  return [...labels];
}

/**
 * 第一次没点中时，把看得见的选项交给模型选一项。
 */
async function askModelForVisibleOption(target, labels) {
  if (!labels.length) return '';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PICK_VISIBLE_OPTION',
      requestId: `pick-${Date.now()}`,
      target,
      options: labels,
    });
    if (response?.type === 'PICK_VISIBLE_OPTION_RESULT' && typeof response.option === 'string') {
      return response.option.trim();
    }
  } catch {
    /* 模型没接上就保持机械结果 */
  }
  return '';
}

/**
 * 把节点 class 收成操作记录里的短名字。
 */
function describeClickedNode(node) {
  if (!(node instanceof HTMLElement)) return '';
  const className = String(node.className || '').replace(/\s+/g, '.').slice(0, 48);
  return `${node.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
}

/**
 * 只点自身文字正好等于这一行城市名的子节点。
 * 调用方：driveRegionModal 点城市、已选仍是 0 时再点一次、已选非 0 后点区县；
 * clickPlainCityList 在非地区窗的城市名单里也调用这里。
 * 输入：行节点、字段名（只写入操作记录）。
 * 输出：无返回值。已选数字仍由 driveRegionModal 用 selectedRegionCount 读取，本函数不把空框记成成功。
 * 不点 area-item-container，也不点 icon-container。点这两处时「已选地区」保持 0，确定不会执行。
 */
function clickRegionRadio(row, labelBlob = '地区') {
  const cityText = compactChoiceLabel(row instanceof HTMLElement ? row.textContent : '');
  const textTargets = [];
  const pushTextTarget = (node) => {
    if (!(node instanceof HTMLElement) || !cityText || textTargets.includes(node)) return;
    const className = String(node.className || '');
    if (/area-item-container|icon-container/i.test(className)) return;
    let directText = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        directText += child.textContent || '';
      }
    }
    if (compactChoiceLabel(directText) !== cityText) return;
    textTargets.push(node);
  };
  if (row instanceof HTMLElement) {
    pushTextTarget(row);
    for (const node of row.querySelectorAll('span, div, label, a, li')) {
      pushTextTarget(node);
    }
  }
  for (const node of textTargets) {
    node.click();
    safeClick(node);
  }
  recordFillStep(
    labelBlob,
    '点中的节点',
    textTargets.slice(0, 3).map((node) => describeClickedNode(node)).join(' ; ') || '没有文字节点',
    cityText,
  );
}

function catalogChinese(list, raw) {
  const hit = list.find((item) => item.code === raw || item.labelZh === raw);
  return hit ? hit.labelZh : '';
}

/**
 * 档案代码换成列表里的中文。CN 不能拿去搜，要搜「中国」。
 */
function choiceSearchLabels(value) {
  const raw = String(value || '').trim();
  const label = catalogChinese(NATIONALITY_OPTIONS, raw)
    || catalogChinese(DEGREE_LEVEL_OPTIONS, raw)
    || catalogChinese(STUDY_MODE_OPTIONS, raw)
    || raw;
  const labels = [label];
  if (label === '大学本科' || label === '本科') labels.push('大学本科', '本科');
  if (label === '硕士研究生' || label === '硕士') labels.push('硕士研究生', '硕士');
  if (label === '博士研究生' || label === '博士') labels.push('博士研究生', '博士');
  if (label === '大专（高职）') labels.push('大专', '高职');
  if (label === '全日制') labels.push('全日制');
  return [...new Set(labels.filter(Boolean))];
}

/**
 * 先精确找，找不到就在列表里往下翻。
 */
async function scrollFindExact(panel, labels) {
  const look = () => {
    for (const label of labels) {
      const hit = findExactChoiceRow(panel, label) || findRegionChoiceRow(panel, label);
      if (hit) return hit;
    }
    return null;
  };
  const first = look();
  if (first) return first;
  const host = [...panel.querySelectorAll('div')].find((node) => node.scrollHeight > node.clientHeight + 20) || panel;
  for (let step = 0; step < 10; step += 1) {
    host.scrollTop += Math.max(120, host.clientHeight * 0.7);
    await sleep(70);
    const hit = look();
    if (hit) return hit;
    if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) break;
  }
  return null;
}

function selectedRegionCount(panel) {
  const text = String(panel?.textContent || '').replace(/\s+/g, '');
  const matched = text.match(/已选地区(\d+)\//);
  return matched ? Number(matched[1]) : null;
}

function regionCityName(value) {
  const parts = String(value || '')
    .split(/[/／|、,，\s>]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '直辖市');
  const cityPart = parts.find((part) => /市$/.test(part));
  return cityPart || parts[0] || '';
}
function findExactChoiceRow(panel, label) {
  const wanted = String(label || '').replace(/\s+/g, '').replace(/[>›]/g, '');
  if (!wanted || !panel) return null;
  const candidates = [...panel.querySelectorAll('label, li, div, span, [role="option"]')].filter((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node) || isInsideTangtouUi(node)) return false;
    const text = ownVisibleText(node).replace(/\s+/g, '').replace(/[>›]/g, '');
    return text === wanted;
  });
  candidates.sort((left, right) => left.getBoundingClientRect().height - right.getBoundingClientRect().height);
  return candidates[0] || null;
}

/**
 * 框上显示的已选文字。打开的列表不算。
 */
function readTriggerDisplay(el) {
  if (!(el instanceof HTMLElement)) return '';
  const wrap = el.closest('.ant-select, .el-select') || el;
  const selectedItem = wrap.querySelector?.('.ant-select-selection-item, .el-select__selected-item');
  const selectedText = String(selectedItem?.textContent || '').replace(/\s+/g, '').trim();
  if (selectedText && !/请选择|请输入/.test(selectedText)) return selectedText;
  const own = ownVisibleText(wrap).replace(/\s+/g, '');
  if (own && own.length <= 20 && !/请选择|请输入|搜索/.test(own)) return own;
  return '';
}

/**
 * 已选文字是否就是目标（允许 北京 对上 北京市）。
 */
function triggerShowsValue(el, value) {
  const display = readTriggerDisplay(el);
  const wanted = String(value || '').replace(/\s+/g, '');
  if (!display || !wanted || /请选择/.test(display)) return false;
  const wantedCore = wanted.split(/[/、,，]/)[0].replace(/(省|市|自治区|特别行政区)$/, '');
  return display === wanted
    || display.replace(/(省|市)$/, '') === wantedCore
    || wantedCore && display.includes(wantedCore) && display.length <= wantedCore.length + 4;
}
function findSearchInput(overlay) {
  if (!overlay) return null;
  const inputs = [...overlay.querySelectorAll('input')].filter(
    (node) => node instanceof HTMLInputElement && isPageFieldVisible(node),
  );
  return inputs.find((input) => {
    const tip = `${input.placeholder || ''}${input.getAttribute('aria-label') || ''}${input.className || ''}`;
    return /搜索|search|筛选|filter/i.test(tip) || input.type === 'search';
  }) || null;
}

/**
 * 向输入框键入文本（清空后写入，触发 input）。
 */
function typeIntoInput(input, text) {
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
    return false;
  }
  input.focus();
  setNativeValue(input, '');
  setNativeValue(input, text);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  return true;
}

/**
 * 关闭并返回失败结果。
 */
async function failDrive(triggerEl, reason) {
  await dismissOverlay(triggerEl, false);
  await ensurePanelsClosed(triggerEl);
  return { ok: false, reason };
}

/** 当前这一格第几次尝试：0 点整行，1 点选项内部，2 仍对不上才问模型。 */
let widgetAttemptIndex = 0;

/**
 * 由逐格收尾设置尝试次数，用来换点击层次。
 */
export function setWidgetAttemptIndex(attemptIndex) {
  widgetAttemptIndex = attemptIndex;
}

// ——— 控件指纹 ———

/**
 * 根据标签、值、打开后弹层形态，判定交互指纹。
 * @returns {'radioGroup'|'datePanel'|'regionModal'|'searchSelect'|'suggestInput'|'simpleSelect'|'plainText'}
 */
export function fingerprintWidget(el, value, labelBlob = '') {
  const label = String(labelBlob || '');
  const normalized = normalizeDate(value);
  if (el instanceof HTMLTextAreaElement || el.getAttribute?.('aria-multiline') === 'true') {
    return 'plainText';
  }
  if (/实习内容|实践描述|证书描述|获奖描述|工作内容/.test(label)) {
    return 'plainText';
  }
  if (/性别/.test(label) && !/别名/.test(label)) return 'radioGroup';
  if (/是否/.test(label)) return 'radioGroup';
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    return 'radioGroup';
  }
  const nearbyRadios = findNearbyRadios(el);
  if (nearbyRadios.length >= 2 && /男|女|是|否|有|无/.test(nearbyRadios.map((item) => item.label).join(''))) {
    if (/性别|婚否|是否/.test(label) || nearbyRadios.some((item) => /^(男|女)$/.test(item.label))) {
      return 'radioGroup';
    }
  }
  if (/专业排名|成绩排名|学历类型|办学类型|学习形式/.test(label)) {
    return 'simpleSelect';
  }
  if (
    /^\d{4}-\d{2}/.test(normalized)
    || (/时间|日期|年月|生日|出生/.test(label) && /(19|20)\d{2}/.test(String(value)))
  ) {
    return 'datePanel';
  }
  // 国籍/地区：先认国籍，禁止被「地区」误判成省市双栏
  if (/国籍|国家/.test(label) && !/现居|籍贯|户籍/.test(label)) {
    return 'searchSelect';
  }
  if (/现居住地|户籍|籍贯|意向城市|其他意向城市|工作城市|工作地点|所在城市/.test(label)) {
    return 'regionModal';
  }
  if (/学校|院校|专业名称|公司名称|单位名称/.test(label) && !/所在地|类型|排名/.test(label)) {
    return 'suggestInput';
  }
  if (/民族|政治面貌|证件类型/.test(label)) {
    return 'searchSelect';
  }
  if (/学历|学位/.test(label) && !/学校|是否/.test(label)) {
    return 'simpleSelect';
  }
  if (/擅长|开发语言|编程语言/.test(label) && !/描述|内容/.test(label)) {
    return 'simpleSelect';
  }
  if (el instanceof HTMLInputElement && !el.readOnly && el.type !== 'hidden') {
    if (looksLikeSelectTrigger(el)) return 'simpleSelect';
    return 'plainText';
  }
  if (looksLikeSelectTrigger(el)) return 'simpleSelect';
  return 'simpleSelect';
}

/** 是否像下拉触发器（文本域绝不因祖先 class 含 select 被误判） */
function looksLikeSelectTrigger(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return false;
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) return true;
  if (el.readOnly) return true;
  const wrap = el.closest(
    '.ant-select, .el-select, [class*="picker" i], [class*="cascader" i]',
  );
  return Boolean(wrap && wrap.getBoundingClientRect().height < 80);
}

/**
 * 在触发器附近收集 radio 及其可读标签。
 */
function findNearbyRadios(el) {
  const fieldBox = el.closest(
    '.ant-form-item, .el-form-item, .ant-radio-group, [class*="form-item" i]',
  ) || el.parentElement;
  if (!fieldBox) return [];
  const radios = [...fieldBox.querySelectorAll('input[type="radio"], [role="radio"], [class*="radio" i]')]
    .filter((node) => node instanceof HTMLElement && !isInsideTangtouUi(node));
  const seen = new Set();
  const items = [];
  for (const node of radios) {
    const radio = node instanceof HTMLInputElement && node.type === 'radio'
      ? node
      : (node.querySelector?.('input[type="radio"]') || node);
    if (seen.has(radio)) continue;
    seen.add(radio);
    const id = radio instanceof HTMLInputElement ? radio.id : '';
    let labelText = '';
    if (id) {
      try {
        labelText = document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '';
      } catch {
        /* ignore */
      }
    }
    if (!labelText) {
      labelText = radio.closest('label')?.textContent
        || radio.parentElement?.textContent
        || (radio instanceof HTMLInputElement ? radio.value : '')
        || ownVisibleText(radio);
    }
    labelText = String(labelText).replace(/\s+/g, '').trim();
    if (labelText.length > 12) {
      const shortHit = labelText.match(/男|女|是|否|有|无|未知/);
      labelText = shortHit?.[0] || labelText.slice(0, 8);
    }
    items.push({ radio, label: labelText });
  }
  return items;
}

// ——— 日期态机 ———

/**
 * 识别日期面板模式：year / month / day / unknown。
 */
function detectDatePanelMode(panel) {
  if (!panel) return 'unknown';
  const text = String(panel.textContent || '').replace(/\s+/g, ' ');
  // 年面板：十年范围标题 + 多个四位数年份
  if (/\d{4}\s*[-–—~～到至]\s*\d{4}/.test(text) || /年面板|decade/i.test(panel.className || '')) {
    const yearCells = [...panel.querySelectorAll('td, a, button, span, div')].filter((node) => {
      const own = ownVisibleText(node);
      return /^(19|20)\d{2}$/.test(own);
    });
    if (yearCells.length >= 6) return 'year';
  }
  const monthCells = [...panel.querySelectorAll('td, a, button, span, div')].filter((node) => {
    const own = ownVisibleText(node).replace(/\s+/g, '');
    // 必须带「月」。日格上的 1–12 不能当成月面板，否则会把「3」点成 1 月 3 日
    return /^([1-9]|1[0-2])月$/.test(own) || /^(0[1-9]|1[0-2])月$/.test(own);
  });
  if (monthCells.length >= 8) return 'month';
  // 日面板：有星期表头
  if (/[一二三四五六日天]/.test(text) && /\b([12]?\d|3[01])\b/.test(text)) {
    return 'day';
  }
  return 'unknown';
}

/**
 * 读取年面板的十年范围；读不到返回 null。
 */
function readDecadeRange(panel) {
  const title = String(panel.textContent || '');
  const match = title.match(/(19|20)\d{2}\s*[-–—~～到至]\s*(19|20)\d{2}/);
  if (!match) return null;
  const parts = match[0].match(/(19|20)\d{2}/g);
  if (!parts || parts.length < 2) return null;
  return { start: Number(parts[0]), end: Number(parts[1]) };
}

/**
 * 点日期面板标题，进入年/月选择（Ant: 点「2004年」或「1月」）。
 */
function clickDateHeaderPart(panel, part) {
  const headers = [...panel.querySelectorAll(
    '[class*="header" i] button, [class*="header" i] a, [class*="header" i] span, [class*="header" i] div, button, a, span',
  )].filter((node) => node instanceof HTMLElement && isPageFieldVisible(node));
  if (part === 'year') {
    const yearBtn = headers.find((node) => {
      const text = ownVisibleText(node).replace(/\s+/g, '');
      return /(19|20)\d{2}年?$/.test(text) && text.length <= 8;
    });
    if (yearBtn) return safeClick(yearBtn);
    // 整段「2004年 1月」
    const combo = headers.find((node) => /(19|20)\d{2}年/.test(ownVisibleText(node)));
    if (combo) return safeClick(combo);
  }
  if (part === 'month') {
    const monthBtn = headers.find((node) => {
      const text = ownVisibleText(node).replace(/\s+/g, '');
      return /^([1-9]|1[0-2])月$/.test(text);
    });
    if (monthBtn) return safeClick(monthBtn);
  }
  return false;
}

/**
 * 点十年导航 << >>；direction = -1 前、+1 后。
 */
function clickDecadeNav(panel, direction) {
  const buttons = [...panel.querySelectorAll('button, a, span, i, svg')].filter(
    (node) => node instanceof HTMLElement && isPageFieldVisible(node),
  );
  const prev = buttons.find((node) => {
    const tip = `${node.getAttribute('aria-label') || ''}${node.className || ''}${ownVisibleText(node)}`;
    return /上一年|前一年|prev|super-prev|<<|«/i.test(tip) || /double.*left|left.*double/i.test(tip);
  });
  const next = buttons.find((node) => {
    const tip = `${node.getAttribute('aria-label') || ''}${node.className || ''}${ownVisibleText(node)}`;
    return /下一年|后一年|next|super-next|>>|»/i.test(tip) || /double.*right|right.*double/i.test(tip);
  });
  // 类名常见：ant-picker-header-super-prev-btn
  const byClassPrev = panel.querySelector(
    '[class*="super-prev" i], [class*="prev-super" i], [class*="btn-prev-year" i]',
  );
  const byClassNext = panel.querySelector(
    '[class*="super-next" i], [class*="next-super" i], [class*="btn-next-year" i]',
  );
  if (direction < 0) {
    return safeClick(byClassPrev || prev);
  }
  return safeClick(byClassNext || next);
}

/**
 * 在当前面板点具体年份单元格。
 */
function clickYearCell(panel, yearText) {
  const aliases = [yearText, `${yearText}年`].map((item) => item.toLowerCase());
  const hit = findBestOption(panel, aliases, { maxTextLength: 6, excludeNav: true });
  if (!hit) return false;
  // 拒绝误点日格：日格通常在 tbody 且数值 1-31 无「年」
  const text = ownVisibleText(hit);
  if (!/^(19|20)\d{2}年?$/.test(text)) return false;
  return safeClick(hit);
}

/**
 * 在月面板点月份。
 */
function clickMonthCell(panel, monthNumber) {
  const wanted = `${Number(monthNumber)}月`;
  const padded = `${String(monthNumber).padStart(2, '0')}月`;
  const cells = [...panel.querySelectorAll('td, [class*="cell" i], button, a, span, div')].filter(
    (node) => node instanceof HTMLElement && isPageFieldVisible(node),
  );
  const hit = cells.find((node) => {
    const text = ownVisibleText(node).replace(/\s+/g, '');
    if (text !== wanted && text !== padded) return false;
    const className = String(node.className || '');
    if (/prev|next|disabled|outside/i.test(className)) return false;
    return true;
  });
  return hit ? safeClick(hit) : false;
}

/**
 * 日期控件里真正的 input。直接写值、失败清空都走它。
 */
function resolveDateInput(el) {
  if (el instanceof HTMLInputElement) return el;
  const inner = el.querySelector?.('input:not([type="hidden"])');
  return inner instanceof HTMLInputElement ? inner : null;
}

/**
 * 标题上当前的年。日格面板标题是「2005年」，用来决定要不要再进年面板。
 */
function readHeaderYear(panel) {
  const header = panel.querySelector('[class*="header" i]') || panel;
  const nodes = [...header.querySelectorAll('button, a, span, div')];
  for (const node of nodes) {
    const text = ownVisibleText(node).replace(/\s+/g, '');
    const year = text.match(/^(19|20)\d{2}年?$/);
    if (year) return year[0].replace('年', '');
  }
  return '';
}

/**
 * 写错的日期清掉，避免 2005-01-03 留在框里还被当成成功。
 */
function clearDateInput(el) {
  const input = resolveDateInput(el);
  if (input) setNativeValue(input, '');
}

/**
 * 在日面板点日期（可选）。
 */
function clickDayCell(panel, dayNumber) {
  const dayText = String(Number(dayNumber));
  const cells = [...panel.querySelectorAll('td, [class*="cell" i]')].filter(
    (node) => node instanceof HTMLElement && isPageFieldVisible(node),
  );
  const hit = cells.find((node) => {
    const text = ownVisibleText(node).replace(/\s+/g, '');
    if (text !== dayText) return false;
    // 排除上月/下月灰格
    const className = String(node.className || '');
    if (/prev|next|disabled|outside|other/i.test(className)) return false;
    return true;
  });
  return hit ? safeClick(hit) : false;
}

/**
 * 日期态机：年面板导航 → 年 → 月 →（可选）日。禁止在日视图里盲找年份。
 */
export async function driveDatePanel(el, value) {
  const date = normalizeDate(value);
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return { ok: false, reason: '日期无有效年份' };
  const yearText = parts[1];
  const monthNumber = String(Number(parts[2]));
  const dayNumber = String(Number(parts[3]));
  const hasDay = sourceHasCalendarDay(value);
  const dateInput = resolveDateInput(el);
  if (!(await ensurePanelsClosed(el))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }

  // 能打字的框先写入完整日期，不打开日格去猜月份
  if (dateInput && !dateInput.readOnly && !dateInput.disabled) {
    const typed = hasDay ? date : date.slice(0, 7);
    setNativeValue(dateInput, typed);
    dateInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: typed, inputType: 'insertText' }));
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(80);
    if (dateTextMatches(value, readControlText(dateInput))) {
      return { ok: true, reason: '日期直接写入' };
    }
    setNativeValue(dateInput, '');
  }

  const before = snapshotOverlays();
  openSelectLike(el);
  await sleep(220);
  let panel = await waitForOverlay(before, 1000);
  if (!panel) {
    return { ok: false, reason: '点击触发器后未见日期面板' };
  }

  let mode = detectDatePanelMode(panel);
  const headerYear = readHeaderYear(panel);
  chaoDebug.info('日期面板模式', { 模式: mode, 目标: date, 标题年: headerYear });

  // 标题已经是目标年时，不要再进年面板，避免从日格里误点数字
  if (headerYear !== yearText) {
    if (mode !== 'year') {
      clickDateHeaderPart(panel, 'year');
      await sleep(180);
      panel = findFreshOverlay(before) || panel;
      mode = detectDatePanelMode(panel);
    }
    if (mode !== 'year') {
      clickDateHeaderPart(panel, 'year');
      await sleep(180);
      panel = findFreshOverlay(before) || panel;
      mode = detectDatePanelMode(panel);
    }
    const targetYear = Number(yearText);
    if (mode === 'year') {
      let decade = readDecadeRange(panel);
      let guard = 0;
      while (decade && (targetYear < decade.start || targetYear > decade.end) && guard < 30) {
        const beforeRange = `${decade.start}-${decade.end}`;
        clickDecadeNav(panel, targetYear < decade.start ? -1 : 1);
        await sleep(120);
        panel = findFreshOverlay(before) || panel;
        decade = readDecadeRange(panel);
        const afterRange = decade ? `${decade.start}-${decade.end}` : '';
        if (afterRange === beforeRange) {
          clickDecadeNav(panel, targetYear < (decade?.start || targetYear) ? -1 : 1);
          await sleep(120);
          panel = findFreshOverlay(before) || panel;
          decade = readDecadeRange(panel);
          if (decade && `${decade.start}-${decade.end}` === beforeRange) break;
        }
        guard += 1;
      }
      if (!clickYearCell(panel, yearText)) {
        clearDateInput(el);
        return failDrive(el, '年面板未点到目标年');
      }
      await sleep(180);
      panel = findFreshOverlay(before) || panel;
    } else {
      clearDateInput(el);
      return failDrive(el, '无法进入年选择面板');
    }
  }

  mode = detectDatePanelMode(panel);
  if (mode !== 'month') {
    clickDateHeaderPart(panel, 'month');
    await sleep(150);
    panel = findFreshOverlay(before) || panel;
    mode = detectDatePanelMode(panel);
  }
  if (mode !== 'month') {
    clearDateInput(el);
    return failDrive(el, '未出现月面板');
  }
  if (!clickMonthCell(panel, monthNumber)) {
    clearDateInput(el);
    return failDrive(el, '月面板未点到目标月');
  }
  await sleep(180);
  panel = findFreshOverlay(before) || panel;

  if (hasDay) {
    mode = detectDatePanelMode(panel);
    if (mode !== 'day') {
      const monthText = readControlText(dateInput || el);
      const monthMatches = dateTextMatches(value, monthText);
      if (listOpenPanels().length > 0) {
        resolveClickTrigger(el).click();
        await sleep(120);
      }
      await ensurePanelsClosed(el);
      if (monthMatches) {
        return { ok: true, reason: '控件只到月份，年月已对上' };
      }
      return { ok: false, reason: '点完月份后没有出现日面板' };
    }
    if (!clickDayCell(panel, dayNumber)) {
      clearDateInput(el);
      return failDrive(el, '日面板未点到目标日');
    }
    await sleep(120);
  }

  const actual = readControlText(dateInput || el);
  const matched = dateTextMatches(value, actual);
  chaoDebug.info('日期态机回读', { 目标: date, 实际: actual, 成功: matched });
  if (!matched) {
    clearDateInput(el);
    return failDrive(el, '日期与目标年月日不一致');
  }
  await dismissOverlay(el);
  return { ok: true, reason: '日期态机成功' };
}

// ——— 单选 ———

/**
 * 性别等 radio：点 input 或旁侧短标签。
 */
function radioLooksSelected(node) {
  if (node instanceof HTMLInputElement) return node.checked;
  const className = String(node.className || '');
  const parentClass = String(node.parentElement?.className || '');
  return node.getAttribute('aria-checked') === 'true'
    || /checked|selected|active/i.test(`${className} ${parentClass}`);
}

export async function driveRadioGroup(el, value) {
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  // 若 el 本身就是 radio
  if (el instanceof HTMLInputElement && el.type === 'radio') {
    const items = findNearbyRadios(el);
    const hit = items.find((item) => textMatchesAliases(item.label, aliases));
    if (hit) {
      if (hit.radio instanceof HTMLInputElement) {
        hit.radio.click();
        hit.radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      safeClick(hit.radio.closest?.('.ant-radio-wrapper, .el-radio, label') || hit.radio);
      await sleep(80);
      return radioLooksSelected(hit.radio)
        ? { ok: true, reason: '单选已勾选' }
        : { ok: false, reason: '单选点击后未勾上' };
    }
  }
  const items = findNearbyRadios(el);
  // 扩大范围：同表单行
  const wider = items.length ? items : (() => {
    const row = el.closest('tr, [class*="row" i], [class*="form-item" i]') || el.parentElement;
    if (!row) return [];
    return [...row.querySelectorAll('input[type="radio"]')].map((radio) => {
      const label = radio.closest('label')?.textContent
        || document.querySelector(`label[for="${radio.id}"]`)?.textContent
        || radio.value
        || '';
      return { radio, label: String(label).replace(/\s+/g, '').trim() };
    });
  })();
  // 也匹配纯 label/span「男」「女」旁的假 radio
  if (!wider.length) {
    const scope = el.closest('[class*="form-item" i], [class*="field" i], [class*="item" i], tr, div') || el.parentElement;
    const textNodes = [...(scope?.querySelectorAll('label, span, div') || [])].filter((node) => {
      const text = ownVisibleText(node).replace(/\s+/g, '');
      return /^(男|女|是|否|有|无)$/.test(text) && textMatchesAliases(text, aliases);
    });
    if (textNodes[0]) {
      safeClick(textNodes[0]);
      await sleep(80);
      return { ok: true, reason: '点击单选文案' };
    }
    return { ok: false, reason: '未找到单选选项' };
  }
  const hit = wider.find((item) => textMatchesAliases(item.label, aliases))
    || wider.find((item) => aliases.some((alias) => item.label.includes(alias)));
  if (!hit) return { ok: false, reason: '单选选项无匹配' };
  const radioWrapper = hit.radio.closest?.('.ant-radio-wrapper, .el-radio, label') || hit.radio;
  if (hit.radio instanceof HTMLInputElement) {
    hit.radio.click();
    hit.radio.dispatchEvent(new Event('input', { bubbles: true }));
    hit.radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
  safeClick(radioWrapper);
  await sleep(60);
  if (!radioLooksSelected(hit.radio)) {
    const labelEl = hit.radio.closest?.('label')
      || (hit.radio.id ? document.querySelector(`label[for="${CSS.escape(hit.radio.id)}"]`) : null);
    if (labelEl && labelEl !== radioWrapper) safeClick(labelEl);
    await sleep(60);
  }
  return radioLooksSelected(hit.radio)
    ? { ok: true, reason: '单选已勾选' }
    : { ok: false, reason: '单选点击后未勾上' };
}

// ——— 联想输入（学校） ———

/**
 * 先输入再点建议；回读须接近完整目标，不能只剩半截关键词。
 */
export async function driveSuggestInput(el, value) {
  const full = String(value || '').trim();
  if (!full) return { ok: false, reason: '联想值为空' };
  if (!(await ensurePanelsClosed(el))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(80);
  typeIntoInput(el, full);
  await sleep(400);
  const suggestion = [...document.querySelectorAll('div, li, span, a')].find((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node) || isInsideTangtouUi(node)) return false;
    if (node === el || node.contains(el) || el.contains(node)) return false;
    const text = ownVisibleText(node).replace(/\s+/g, '');
    const box = node.getBoundingClientRect();
    return text === full.replace(/\s+/g, '') && box.height >= 12 && box.height <= 64;
  });
  if (!suggestion) {
    return { ok: false, reason: '学校建议列表未点到同名项' };
  }
  safeClick(suggestion);
  await sleep(200);
  return { ok: true, reason: '学校建议已点中' };
}

// ——— 可搜索长列表 ———

/**
 * 打开 → 搜索框输入 → 滚动查找 → 点击。
 */
export async function driveSearchSelect(el, value) {
  if (!(await ensurePanelsClosed(el))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  const panel = await openChoicePanel(el);
  if (!panel) return { ok: false, reason: '点击触发器后未见下拉弹层' };

  if (isRegionModal(panel)) {
    return driveRegionModal(el, value);
  }

  const labels = choiceSearchLabels(value);
  const searchInput = findSearchInput(panel);
  if (searchInput) {
    typeIntoInput(searchInput, labels[0].replace(/市$/, ''));
    await sleep(280);
  }
  const hit = await scrollFindExact(panel, labels);
  if (!hit) {
    return failDrive(el, '搜索下拉未找到选项');
  }
  safeClick(hit);
  await sleep(220);
  if (!triggerShowsValue(el, labels[0]) && !labels.some((label) => triggerShowsValue(el, label))) {
    return { ok: false, reason: '搜索下拉回读不一致' };
  }
  return { ok: true, reason: '搜索下拉点选成功' };
}

// ——— 地区双栏弹窗 ———

/**
 * 是否为「全部省市 / 已选地区 / 确定」型地区弹窗。
 */
function isRegionModal(overlay) {
  if (!overlay) return false;
  const text = String(overlay.textContent || '').replace(/\s+/g, '');
  return /已选地区|全部省市|清空已选/.test(text)
    || (/确定/.test(text) && /取消/.test(text) && /省|市|区/.test(text));
}

/**
 * 点开后不是「已选地区」窗，而是一份城市名单时，直接点目标城市。
 */
async function clickPlainCityList(el, overlay, value, labelBlob) {
  const cityName = regionCityName(value);
  const labels = [cityName, cityName.replace(/市$/, '')].filter(Boolean);
  const optionTexts = await collectChoiceTexts(overlay);
  const chosen = pickListedOption(optionTexts, labels);
  const row = chosen
    ? (findExactChoiceRow(overlay, chosen) || findRegionChoiceRow(overlay, chosen))
    : null;
  recordFillStep(
    labelBlob || '地区',
    '点开城市名单',
    row ? chosen : '名单里没有',
    optionTexts.slice(0, 8).join('、'),
  );
  if (!(row instanceof HTMLElement)) {
    await ensurePanelsClosed(el);
    return { ok: false, reason: '城市名单未找到选项' };
  }
  clickRegionRadio(row, labelBlob);
  await sleep(200);
  const shown = triggerShowsValue(el, cityName) || triggerShowsValue(el, chosen);
  recordFillStep(
    labelBlob || '地区',
    '点城市名单',
    shown ? '框上已是城市' : '框上还不是城市',
    readControlText(el) || '空',
  );
  await ensurePanelsClosed(el);
  if (!shown) {
    return { ok: false, reason: '点了城市名单但框上没有城市' };
  }
  return { ok: true, reason: '城市名单点选成功' };
}

/**
 * 地区弹窗：左栏下钻 → 右栏确认 → 点确定。
 * 点开后如果不是已选地区窗，就在刚打开的名单里点城市。
 */
export async function driveRegionModal(el, value, labelBlob = '地区') {
  const cityName = regionCityName(value);
  const districtName = String(value || '')
    .split(/[/／|、,，>]+/)
    .map((part) => part.trim())
    .find((part) => /区$|县$/.test(part) && part !== cityName) || '';
  if (!(await ensurePanelsClosed(el))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  const before = snapshotOverlays();
  openSelectLike(el);
  await sleep(280);
  let overlay = findVisibleChoicePanel() || await waitForOverlay(before, 700);
  if (!overlay) {
    openSelectLike(el);
    await sleep(280);
    overlay = findVisibleChoicePanel() || await waitForOverlay(before, 500);
  }
  if (!overlay) {
    recordFillStep(labelBlob || '地区', '点开', '未见弹层', String(value || ''));
    return { ok: false, reason: '点击触发器后未见弹层' };
  }
  if (!isRegionModal(overlay)) {
    return clickPlainCityList(el, overlay, value, labelBlob);
  }

  const pickRow = async (label) => {
    let row = findRegionChoiceRow(overlay, label)
      || findRegionChoiceRow(overlay, `${label.replace(/(省|市|自治区|特别行政区)$/, '')}市`)
      || findRegionChoiceRow(overlay, `${label.replace(/(省|市|自治区|特别行政区)$/, '')}省`);
    if (!row) {
      const searchInput = findSearchInput(overlay);
      const keyword = label.replace(/(省|市|自治区|特别行政区)$/, '');
      if (searchInput && keyword) {
        typeIntoInput(searchInput, keyword);
        await sleep(280);
        overlay = findVisibleChoicePanel() || overlay;
        row = findRegionChoiceRow(overlay, label)
          || findRegionChoiceRow(overlay, `${keyword}市`);
      }
    }
    return row;
  };

  const cityRow = await pickRow(cityName);
  recordFillStep(
    labelBlob || '地区',
    '点开',
    cityRow ? `找到${cityName}` : '没找到城市',
    `目标=${cityName || value} 已选=${selectedRegionCount(overlay) ?? '无'}`,
  );
  if (!cityRow) {
    await closeOpenChoicePanels();
    return { ok: false, reason: `地区未找到：${cityName || value}` };
  }
  clickRegionRadio(cityRow, labelBlob);
  await sleep(180);
  overlay = findVisibleChoicePanel() || overlay;
  if (selectedRegionCount(overlay) === 0) {
    const cityRowAgain = await pickRow(cityName);
    clickRegionRadio(cityRowAgain || cityRow, labelBlob);
    await sleep(180);
    overlay = findVisibleChoicePanel() || overlay;
  }
  if (selectedRegionCount(overlay) === 0) {
    recordFillStep(labelBlob || '地区', '点城市', '已选仍是0', cityName || value);
    await closeOpenChoicePanels();
    recordFillStep(labelBlob || '地区', '关闭', listOpenPanels().length === 0 ? '已关掉' : '还开着', `弹层数=${listOpenPanels().length}`);
    return { ok: false, reason: '点了城市但已选地区仍是 0' };
  }
  if (districtName) {
    const districtRow = await pickRow(districtName);
    if (districtRow) {
      clickRegionRadio(districtRow, labelBlob);
      await sleep(220);
      overlay = findVisibleChoicePanel() || overlay;
    }
  }

  const confirmBtn = findExactAction(overlay, '确定');
  if (!(confirmBtn instanceof HTMLElement)) {
    recordFillStep(labelBlob || '地区', '点确定', '没找到确定', cityName || value);
    await closeOpenChoicePanels();
    return { ok: false, reason: '地区弹窗未找到确定按钮' };
  }
  confirmBtn.click();
  safeClick(confirmBtn);
  await sleep(240);
  recordFillStep(
    labelBlob || '地区',
    '点确定',
    triggerShowsValue(el, cityName) ? '框上已是城市' : '框上还不是城市',
    `框上=${readControlText(el) || '空'}`,
  );
  if (!triggerShowsValue(el, cityName)) {
    await closeOpenChoicePanels();
    return { ok: false, reason: '地区选择后回读不一致' };
  }
  return { ok: true, reason: '地区弹窗选择成功' };
}

// ——— 普通短下拉 ———

/**
 * 把列表滚一遍，记下看得见的选项原文。
 */
async function collectChoiceTexts(panel) {
  const gathered = new Set();
  const take = () => {
    for (const node of panel.querySelectorAll('[role="option"], li, div, span, label')) {
      if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) continue;
      const box = node.getBoundingClientRect();
      if (box.height < 10 || box.height > 56) continue;
      const text = compactChoiceLabel(ownVisibleText(node) || node.textContent);
      if (!text || text.length > 40) continue;
      if (/搜索|确定|取消|已选地区|全部省市|请选择|请输入/.test(text)) continue;
      gathered.add(text);
    }
  };
  const host = [...panel.querySelectorAll('div')].find((node) => node.scrollHeight > node.clientHeight + 20) || panel;
  host.scrollTop = 0;
  take();
  for (let step = 0; step < 12; step += 1) {
    host.scrollTop += Math.max(120, host.clientHeight * 0.7);
    await sleep(50);
    take();
    if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) break;
  }
  return [...gathered];
}

/**
 * 在已记下的原文里选一条：先完全相同，再取最短的包含项。中国只许完全相同。
 */
function pickListedOption(optionTexts, aliases) {
  const usable = optionTexts.map((text) => compactChoiceLabel(text)).filter((text) => text && text.length <= 40);
  for (const alias of aliases) {
    const wanted = compactChoiceLabel(alias);
    const exact = usable.find((text) => text === wanted);
    if (exact) return exact;
  }
  const contains = [];
  for (const alias of aliases) {
    const wanted = compactChoiceLabel(alias);
    if (!wanted || wanted === '中国') continue;
    for (const text of usable) {
      if (text.includes(wanted) || (wanted.includes(text) && text.length >= 2)) {
        contains.push(text);
      }
    }
  }
  contains.sort((left, right) => left.length - right.length);
  return contains[0] || '';
}

/**
 * 按尝试次数点选项。0 点整行，1 及以后再点行内那一层。
 */
function clickOptionAtDepth(row, depth) {
  if (!(row instanceof HTMLElement)) return;
  if (depth >= 1) {
    const inner = [...row.querySelectorAll('span, div, label, li')].find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const text = compactChoiceLabel(ownVisibleText(node) || node.textContent);
      const box = node.getBoundingClientRect();
      return text.length > 0 && box.height >= 8 && box.height <= 48;
    });
    if (inner instanceof HTMLElement) safeClick(inner);
  }
  safeClick(row);
}

/**
 * 离这个空最近的那一块弹层。同时开着好几块时，不把别的列表里的字算进来。
 */
function panelNearField(anchor) {
  const panels = listOpenPanels();
  if (panels.length === 0) return null;
  if (!(anchor instanceof HTMLElement)) {
    return panels.length === 1 ? panels[0] : null;
  }
  const anchorBox = anchor.getBoundingClientRect();
  const ranked = panels.map((panel) => {
    const panelBox = panel.getBoundingClientRect();
    const overlapsX = panelBox.left < anchorBox.right + 48 && panelBox.right > anchorBox.left - 48;
    const verticalGap = Math.abs(panelBox.top - anchorBox.bottom);
    return { panel, score: (overlapsX ? 0 : 2000) + verticalGap };
  });
  ranked.sort((left, right) => left.score - right.score);
  return ranked[0]?.panel || null;
}

/**
 * 读当前这一格打开的列表原文。好几块叠在一起时不混读。
 */
export async function collectOpenChoiceTexts(anchor) {
  const panel = panelNearField(anchor);
  if (!(panel instanceof HTMLElement)) return [];
  return collectChoiceTexts(panel);
}

/**
 * 用取消、收起和 Esc 关掉还开着的列表，不用点页面空白。
 */
export async function closeOpenListWithEscape() {
  await ensurePanelsClosed();
}

export async function clickMatchingOpenOption(value, labelBlob = '', anchor) {
  const panel = panelNearField(anchor);
  if (!(panel instanceof HTMLElement)) return false;
  const aliases = choiceSearchLabels(value);
  let optionTexts = await collectChoiceTexts(panel);
  if (/排名/.test(String(labelBlob || ''))) {
    const mappedRank = mapRankToOptions(aliases[0] || value, optionTexts);
    if (mappedRank) optionTexts = [mappedRank, ...optionTexts];
  }
  let chosen = pickListedOption(optionTexts, aliases);
  if (!chosen && widgetAttemptIndex >= 2) {
    chosen = await askModelForVisibleOption(value, optionTexts);
    if (chosen && !optionTexts.includes(chosen)) chosen = '';
  }
  if (!chosen) return false;
  const row = findExactChoiceRow(panel, chosen) || findRegionChoiceRow(panel, chosen);
  if (!(row instanceof HTMLElement)) return false;
  clickOptionAtDepth(row, widgetAttemptIndex);
  await sleep(180);
  return true;
}

/**
 * 点开后浮在触发器旁边、里面是多条短选项的那一层。
 * 北森学历这类列表的 class 不带 dropdown，只靠选择器会把它当成没打开。
 */
function findFloatingOptionList(anchor, beforeNodes) {
  if (!(anchor instanceof HTMLElement)) return null;
  const anchorBox = anchor.getBoundingClientRect();
  const candidates = [...document.querySelectorAll('div, ul')].filter((node) => {
    if (!(node instanceof HTMLElement) || beforeNodes.has(node) || isInsideTangtouUi(node)) return false;
    if (node === anchor || node.contains(anchor) || anchor.contains(node)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    const box = node.getBoundingClientRect();
    if (box.width < 72 || box.height < 36 || box.height > 520 || box.width > 480) return false;
    const nearTrigger = box.top < anchorBox.bottom + 360
      && box.bottom > anchorBox.top - 24
      && box.left < anchorBox.right + 120
      && box.right > anchorBox.left - 120;
    if (!nearTrigger) return false;
    const shortRows = [...node.querySelectorAll('li, [role="option"], div, span')].filter((item) => {
      if (!(item instanceof HTMLElement)) return false;
      const text = ownVisibleText(item).replace(/\s+/g, '');
      const itemBox = item.getBoundingClientRect();
      return text.length >= 1 && text.length <= 16 && itemBox.height >= 12 && itemBox.height <= 48;
    });
    return shortRows.length >= 2;
  });
  candidates.sort((left, right) => {
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    return leftBox.height - rightBox.height;
  });
  return candidates[0] || null;
}

/**
 * 普通下拉：先滚动记下原文，再点列表里那一行。不把档案长词打进搜索框。
 */
export async function driveSimpleSelect(el, value, labelBlob = '') {
  if (!(await ensurePanelsClosed(el))) {
    return { ok: false, reason: '已有弹层关不掉，不再点开下一个' };
  }
  const before = snapshotOverlays();
  const beforeFloating = new Set(
    [...document.querySelectorAll('div, ul')].filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.position !== 'fixed' && style.position !== 'absolute') return false;
      const box = node.getBoundingClientRect();
      return box.width > 20 && box.height > 20;
    }),
  );
  openSelectLike(el);
  let overlay = await waitForOverlay(before, 1000);
  if (!overlay) {
    overlay = findFloatingOptionList(resolveClickTrigger(el), beforeFloating);
  }
  if (!overlay) {
    if (el instanceof HTMLSelectElement) {
      const aliasesNative = optionMatchAliases(value).map((item) => item.toLowerCase());
      const options = [...el.options];
      const hit = options.find((option) => textMatchesAliases(option.text, aliasesNative)
        || textMatchesAliases(option.value, aliasesNative));
      if (!hit) return { ok: false, reason: '原生下拉无匹配项' };
      el.value = hit.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: '原生下拉成功' };
    }
    return { ok: false, reason: '点击触发器后未见下拉' };
  }
  if (isRegionModal(overlay)) {
    await dismissOverlay(el, false);
    return driveRegionModal(el, value, labelBlob);
  }
  const aliases = choiceSearchLabels(value);
  let optionTexts = await collectChoiceTexts(overlay);
  if (optionTexts.length === 0) {
    const searchInput = findSearchInput(overlay);
    const shortestAlias = [...aliases].sort((left, right) => left.length - right.length)[0];
    if (searchInput && shortestAlias) {
      typeIntoInput(searchInput, shortestAlias);
      await sleep(250);
      overlay = findFreshOverlay(before) || overlay;
      optionTexts = await collectChoiceTexts(overlay);
    }
  }
  if (/排名/.test(String(labelBlob || ''))) {
    const mappedRank = mapRankToOptions(aliases[0] || value, optionTexts);
    if (mappedRank) {
      aliases.unshift(mappedRank);
    }
  }
  let chosen = pickListedOption(optionTexts, aliases);
  if (!chosen && widgetAttemptIndex >= 2) {
    chosen = await askModelForVisibleOption(value, optionTexts);
    if (chosen && !optionTexts.some((text) => compactChoiceLabel(text) === compactChoiceLabel(chosen))) {
      chosen = '';
    }
  }
  if (!chosen) {
    recordFillStep(labelBlob || '下拉', '点开', '列表里没有目标', optionTexts.slice(0, 8).join('、'));
    return { ok: false, reason: '下拉未找到选项' };
  }
  recordFillStep(labelBlob || '下拉', '点选项', chosen, optionTexts.slice(0, 8).join('、'));
  const row = findExactChoiceRow(overlay, chosen) || findRegionChoiceRow(overlay, chosen);
  if (!(row instanceof HTMLElement)) return { ok: false, reason: '下拉未找到选项' };
  clickOptionAtDepth(row, widgetAttemptIndex);
  await sleep(180);
  const actual = readControlText(el).replace(/\s+/g, '');
  const chosenCompact = compactChoiceLabel(chosen);
  const matched = actual === chosenCompact
    || (chosenCompact !== '中国' && actual.includes(chosenCompact));
  if (!matched) {
    return { ok: false, reason: '下拉回读不一致' };
  }
  return { ok: true, reason: '下拉点选成功' };
}

/**
 * 统一入口：按指纹跑对应态机。
 * @returns {{ ok: boolean, reason: string, fingerprint: string }}
 */
export async function driveWidgetWrite(el, value, labelBlob = '') {
  let fingerprint = fingerprintWidget(el, value, labelBlob);
  // 打开一次做形态纠正（地区 vs 搜索）
  if (fingerprint === 'regionModal' || fingerprint === 'searchSelect' || fingerprint === 'simpleSelect') {
    // 保持指纹；驱动内部会互相回落
  }
  if (fingerprint === 'suggestInput') {
    // 只读触发器其实不能联想输入 → 改简单下拉
    if (el instanceof HTMLInputElement && el.readOnly) {
      fingerprint = 'simpleSelect';
    }
  }

  chaoDebug.info('控件指纹', { 指纹: fingerprint, 标签: labelBlob, 目标: value });

  let result;
  switch (fingerprint) {
    case 'radioGroup':
      result = await driveRadioGroup(el, value);
      break;
    case 'datePanel':
      result = await driveDatePanel(el, value);
      break;
    case 'suggestInput':
      result = await driveSuggestInput(el, value);
      break;
    case 'regionModal':
      result = await driveRegionModal(el, value, labelBlob);
      break;
    case 'searchSelect':
      result = await driveSearchSelect(el, value);
      break;
    case 'plainText':
      result = { ok: false, reason: '应交纯文本' };
      break;
    case 'simpleSelect':
    default:
      result = await driveSimpleSelect(el, value, labelBlob);
      break;
  }

  // 安全重试链：地区/搜索/联想互相兜一次（避免指纹误判）
  if (!result.ok && fingerprint === 'regionModal') {
    const retry = await driveSearchSelect(el, value);
    if (retry.ok) return { ...retry, fingerprint: 'searchSelect(retry)' };
  }
  if (!result.ok && fingerprint === 'suggestInput') {
    const retry = await driveSimpleSelect(el, value, labelBlob);
    if (retry.ok) return { ...retry, fingerprint: 'simpleSelect(retry)' };
  }
  if (!result.ok && fingerprint === 'datePanel') {
    // 日期失败不再盲点其它
    return { ...result, fingerprint };
  }
  if (!result.ok && fingerprint === 'simpleSelect') {
    if (
      el instanceof HTMLInputElement
      && !el.readOnly
      && !/排名|学历|类型|描述|内容/.test(labelBlob)
    ) {
      const retry = await driveSuggestInput(el, value);
      if (retry.ok) return { ...retry, fingerprint: 'suggestInput(retry)' };
    }
  }

  return { ...result, fingerprint };
}
