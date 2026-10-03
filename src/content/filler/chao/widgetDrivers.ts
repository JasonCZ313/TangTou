// @ts-nocheck
/**
 * 点选控件态机引擎：先识别控件指纹，再按固定交互协议点击，禁止「看见文字就乱点」。
 * 覆盖：日期年/月面板、联想输入、可搜索长列表、地区双栏弹窗、单选、普通下拉。
 */
import { normalizeDate, optionMatchAliases } from './rules';
import { chaoDebug } from './debug';
import {
  isInsideTangtouUi,
  isPageFieldVisible,
  readControlText,
  setNativeValue,
  sleep,
} from './dom';

/** 弹层候选选择器：打开后出现的浮层/面板 */
const OVERLAY_SELECTOR = [
  '[class*="picker" i]',
  '[class*="datepicker" i]',
  '[class*="date-panel" i]',
  '[class*="calendar" i]',
  '[class*="dropdown" i]',
  '[class*="select-dropdown" i]',
  '[class*="cascader" i]',
  '[class*="popper" i]',
  '[class*="popover" i]',
  '[class*="modal" i]',
  '[class*="dialog" i]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="menu"]',
].join(', ');

/**
 * 采集当前页面上可见、且不属于躺投 UI 的弹层节点集合。
 */
function snapshotOverlays() {
  return new Set(
    [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(
      (node) => node instanceof HTMLElement
        && isPageFieldVisible(node)
        && !isInsideTangtouUi(node),
    ),
  );
}

/**
 * 相对打开前快照，找出本字段新打开的弹层（优先最大面积的那个）。
 */
function findFreshOverlay(beforeSet) {
  const fresh = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(
    (node) => node instanceof HTMLElement
      && isPageFieldVisible(node)
      && !isInsideTangtouUi(node)
      && !beforeSet.has(node),
  );
  if (!fresh.length) {
    // 有的组件复用已有弹层：退而求其次取当前最大可见弹层
    const visible = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(
      (node) => node instanceof HTMLElement
        && isPageFieldVisible(node)
        && !isInsideTangtouUi(node),
    );
    fresh.push(...visible);
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
 * 关闭本字段弹层，避免挡住后续字段。
 */
async function dismissOverlay(triggerEl) {
  triggerEl?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true,
  }));
  document.body.click();
  await sleep(80);
}

/**
 * 安全点击：派发 mousedown + click，更接近真实用户。
 */
function safeClick(node) {
  if (!(node instanceof HTMLElement)) return false;
  node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  node.click();
  return true;
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
 * 弹层内搜索框：placeholder/aria 含「搜索」或 type=search。
 */
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
  await dismissOverlay(triggerEl);
  return { ok: false, reason };
}

// ——— 控件指纹 ———

/**
 * 根据标签、值、打开后弹层形态，判定交互指纹。
 * @returns {'radioGroup'|'datePanel'|'regionModal'|'searchSelect'|'suggestInput'|'simpleSelect'|'plainText'}
 */
export function fingerprintWidget(el, value, labelBlob = '') {
  const label = String(labelBlob || '');
  const normalized = normalizeDate(value);
  if (/性别/.test(label) && !/别名/.test(label)) return 'radioGroup';
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    return 'radioGroup';
  }
  // 字段旁已有成组 radio
  const nearbyRadios = findNearbyRadios(el);
  if (nearbyRadios.length >= 2 && /男|女|是|否|有|无/.test(nearbyRadios.map((item) => item.label).join(''))) {
    if (/性别|婚否|是否/.test(label) || nearbyRadios.some((item) => /^(男|女)$/.test(item.label))) {
      return 'radioGroup';
    }
  }
  if (
    /^\d{4}-\d{2}/.test(normalized)
    || (/时间|日期|年月|生日|出生/.test(label) && /(19|20)\d{2}/.test(String(value)))
  ) {
    return 'datePanel';
  }
  if (/现居住地|户籍|籍贯|意向城市|工作城市|所在城市|省市|地区/.test(label)) {
    return 'regionModal';
  }
  if (/学校|院校|专业名称|公司名称|单位名称/.test(label) && !/所在地|类型/.test(label)) {
    return 'suggestInput';
  }
  if (/国籍|国家|民族|政治面貌|学历|学位|证件类型/.test(label)) {
    return 'searchSelect';
  }
  if (el instanceof HTMLInputElement && !el.readOnly && el.type !== 'hidden') {
    // 可输入 + 可能联想：学校类已覆盖；其余可输入先当 plain，由上层决定
    if (looksLikeSelectTrigger(el)) return 'simpleSelect';
    return 'plainText';
  }
  if (looksLikeSelectTrigger(el)) return 'simpleSelect';
  return 'simpleSelect';
}

/** 是否像下拉触发器 */
function looksLikeSelectTrigger(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) return true;
  if (el.readOnly) return true;
  return Boolean(el.closest(
    '[class*="select" i], [class*="picker" i], [class*="cascader" i], [class*="dropdown" i]',
  ));
}

/**
 * 在触发器附近收集 radio 及其可读标签。
 */
function findNearbyRadios(el) {
  const scope = el.closest('form, section, [class*="form" i], [class*="item" i], [class*="row" i], li, td, div')
    || el.parentElement
    || document.body;
  // 再收窄一层：同级字段容器
  const fieldBox = el.closest('[class*="form-item" i], [class*="field" i], [class*="item" i]') || scope;
  const radios = [...fieldBox.querySelectorAll('input[type="radio"]')]
    .filter((node) => node instanceof HTMLInputElement && !isInsideTangtouUi(node));
  return radios.map((radio) => {
    const id = radio.id;
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
        || radio.value
        || '';
    }
    labelText = String(labelText).replace(/\s+/g, '').trim();
    // 去掉过长噪音，只留短标签
    if (labelText.length > 12) {
      const shortHit = labelText.match(/男|女|是|否|有|无|未知/);
      labelText = shortHit?.[0] || labelText.slice(0, 8);
    }
    return { radio, label: labelText };
  });
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
    const own = ownVisibleText(node);
    return /^([1-9]|1[0-2])月$/.test(own) || /^(0?[1-9]|1[0-2])$/.test(own);
  });
  if (monthCells.length >= 10) return 'month';
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
  const aliases = [
    String(monthNumber),
    `${monthNumber}月`,
    String(monthNumber).padStart(2, '0'),
    `${String(monthNumber).padStart(2, '0')}月`,
  ].map((item) => item.toLowerCase());
  const hit = findBestOption(panel, aliases, { maxTextLength: 4, excludeNav: true });
  if (!hit) return false;
  const text = ownVisibleText(hit).replace(/\s+/g, '');
  if (!/^([1-9]|1[0-2]|0[1-9])月?$/.test(text)) return false;
  return safeClick(hit);
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
  const yearMatch = date.match(/(19|20)\d{2}/);
  const yearText = yearMatch?.[0] || '';
  const monthMatch = date.match(/^\d{4}-(\d{2})/);
  const monthNumber = monthMatch ? String(Number(monthMatch[1])) : '';
  const dayMatch = date.match(/^\d{4}-\d{2}-(\d{2})/);
  const dayNumber = dayMatch ? String(Number(dayMatch[1])) : '';
  const needDay = Boolean(dayMatch) && dayNumber !== '1'; // 缺省日多为 01，月选择器可不点日
  if (!yearText) return { ok: false, reason: '日期无有效年份' };

  const before = snapshotOverlays();
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(220);
  let panel = findFreshOverlay(before);
  if (!panel) {
    return { ok: false, reason: '未打开日期面板' };
  }

  // 进入年面板
  let mode = detectDatePanelMode(panel);
  chaoDebug.info('日期面板模式', { 模式: mode, 目标: date });
  if (mode !== 'year') {
    clickDateHeaderPart(panel, 'year');
    await sleep(180);
    panel = findFreshOverlay(before) || panel;
    mode = detectDatePanelMode(panel);
  }
  if (mode !== 'year') {
    // 再点一次整段标题
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
        // 导航没生效，换另一种按钮再试一次
        clickDecadeNav(panel, targetYear < (decade?.start || targetYear) ? -1 : 1);
        await sleep(120);
        panel = findFreshOverlay(before) || panel;
        decade = readDecadeRange(panel);
        if (decade && `${decade.start}-${decade.end}` === beforeRange) break;
      }
      guard += 1;
    }
    if (!clickYearCell(panel, yearText)) {
      return failDrive(el, '年面板未点到目标年');
    }
    await sleep(180);
    panel = findFreshOverlay(before) || panel;
  } else {
    return failDrive(el, '无法进入年选择面板');
  }

  // 月面板
  mode = detectDatePanelMode(panel);
  if (mode !== 'month' && monthNumber) {
    clickDateHeaderPart(panel, 'month');
    await sleep(150);
    panel = findFreshOverlay(before) || panel;
    mode = detectDatePanelMode(panel);
  }
  if (monthNumber) {
    if (mode === 'month' || detectDatePanelMode(panel) === 'month') {
      if (!clickMonthCell(panel, monthNumber)) {
        return failDrive(el, '月面板未点到目标月');
      }
      await sleep(180);
      panel = findFreshOverlay(before) || panel;
    } else {
      // 有的实现点完年直接出月；再试一次点月
      if (!clickMonthCell(panel, monthNumber)) {
        return failDrive(el, '未出现月面板');
      }
      await sleep(180);
      panel = findFreshOverlay(before) || panel;
    }
  }

  // 日面板（完整日期时）
  if (needDay && dayNumber) {
    mode = detectDatePanelMode(panel);
    if (mode === 'day' || mode === 'unknown') {
      clickDayCell(panel, dayNumber);
      await sleep(120);
    }
  }

  const actual = readControlText(el);
  const monthOk = !monthNumber || (
    actual.includes(monthNumber.padStart(2, '0'))
    || actual.includes(`${monthNumber}月`)
    || actual.includes(`-${monthNumber.padStart(2, '0')}`)
    || actual.includes(`/${monthNumber.padStart(2, '0')}`)
    || Number(actual.match(/[-/年](\d{1,2})/)?.[1] || 0) === Number(monthNumber)
  );
  const ok = actual.includes(yearText) && monthOk;
  chaoDebug.info('日期态机回读', { 目标: date, 实际: actual, 成功: ok });
  if (!ok) {
    // 最后尝试：可输入则写入规范化值（部分站点接受）
    if (el instanceof HTMLInputElement && !el.readOnly) {
      const wasReadOnly = el.readOnly;
      if (wasReadOnly) el.removeAttribute('readonly');
      setNativeValue(el, monthNumber ? `${yearText}-${monthNumber.padStart(2, '0')}` : yearText);
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
      el.blur();
      await sleep(80);
      if (wasReadOnly) el.setAttribute('readonly', '');
      const again = readControlText(el);
      if (again.includes(yearText)) {
        await dismissOverlay(el);
        return { ok: true, reason: '日期文本回落成功' };
      }
    }
    return failDrive(el, '日期写入后回读不一致');
  }
  await dismissOverlay(el);
  return { ok: true, reason: '日期态机成功' };
}

// ——— 单选 ———

/**
 * 性别等 radio：点 input 或旁侧短标签。
 */
export async function driveRadioGroup(el, value) {
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  // 若 el 本身就是 radio
  if (el instanceof HTMLInputElement && el.type === 'radio') {
    const items = findNearbyRadios(el);
    const hit = items.find((item) => textMatchesAliases(item.label, aliases));
    if (hit) {
      safeClick(hit.radio);
      await sleep(80);
      return hit.radio.checked
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
  safeClick(hit.radio);
  await sleep(60);
  if (!hit.radio.checked) {
    const labelEl = hit.radio.closest('label')
      || (hit.radio.id ? document.querySelector(`label[for="${CSS.escape(hit.radio.id)}"]`) : null);
    if (labelEl) safeClick(labelEl);
    await sleep(60);
  }
  return hit.radio.checked
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
  const aliases = optionMatchAliases(full).map((item) => item.toLowerCase());
  // 输入词：完整名；若较长也可试去掉「大学/学院」后缀的短词
  const typeWords = Array.from(new Set([
    full,
    full.replace(/(大学|学院|学校)$/, ''),
    full.slice(0, Math.min(6, full.length)),
  ].filter((item) => item && item.length >= 2)));

  const before = snapshotOverlays();
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(100);

  for (const word of typeWords) {
    typeIntoInput(el, word);
    await sleep(350);
    const overlay = findFreshOverlay(before);
    const scope = overlay || document.body;
    let hit = findBestOption(scope, aliases, { allowLong: true, maxTextLength: 40 });
    // 建议项常在 body 下的 dropdown
    if (!hit) {
      hit = findBestOption(document.body, aliases, { allowLong: true, maxTextLength: 40 });
    }
    if (hit) {
      safeClick(hit);
      await sleep(200);
      const actual = readControlText(el);
      if (textMatchesAliases(actual, aliases) || actual.includes(full) || full.includes(actual)) {
        // 半截字不算成功：实际值过短且仍等于输入词
        if (actual.length < Math.min(full.length, 4) && typeWords.includes(actual)) {
          continue;
        }
        await dismissOverlay(el);
        return { ok: true, reason: '联想点选成功' };
      }
    }
  }
  await dismissOverlay(el);
  return { ok: false, reason: '联想列表未点到匹配项' };
}

// ——— 可搜索长列表 ———

/**
 * 打开 → 搜索框输入 → 滚动查找 → 点击。
 */
export async function driveSearchSelect(el, value) {
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  const before = snapshotOverlays();
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(280);
  let overlay = findFreshOverlay(before);
  if (!overlay) return { ok: false, reason: '未打开下拉弹层' };

  // 若弹层其实是地区双栏，转给 region 驱动
  if (isRegionModal(overlay)) {
    await dismissOverlay(el);
    return driveRegionModal(el, value);
  }

  const searchInput = findSearchInput(overlay);
  const keyword = String(value).split(/\s*[/、,，]\s*/).filter(Boolean).pop() || String(value);
  if (searchInput) {
    typeIntoInput(searchInput, keyword.replace(/市$/, ''));
    await sleep(280);
    overlay = findFreshOverlay(before) || overlay;
  }

  let hit = await findOptionWithScroll(overlay, aliases);
  if (!hit && searchInput) {
    // 换短词再搜
    typeIntoInput(searchInput, keyword.slice(0, 2));
    await sleep(280);
    hit = await findOptionWithScroll(overlay, aliases);
  }
  if (!hit) {
    return failDrive(el, '搜索下拉未找到选项');
  }
  safeClick(hit);
  await sleep(180);
  const actual = readControlText(el);
  if (!textMatchesAliases(actual, aliases) && !aliases.some((alias) => actual.toLowerCase().includes(alias))) {
    return failDrive(el, '搜索下拉回读不一致');
  }
  await dismissOverlay(el);
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
 * 地区弹窗：左栏下钻 → 右栏确认 → 点确定。
 */
export async function driveRegionModal(el, value) {
  const segments = String(value)
    .split(/\s*[/、,，>]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const aliasesAll = optionMatchAliases(value).map((item) => item.toLowerCase());
  const before = snapshotOverlays();
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(300);
  let overlay = findFreshOverlay(before);
  if (!overlay) return { ok: false, reason: '未打开地区弹窗' };

  // 若不是双栏弹窗，回落搜索下拉
  if (!isRegionModal(overlay)) {
    const searchInput = findSearchInput(overlay);
    if (searchInput || overlay.querySelector('[role="listbox"], [class*="option" i]')) {
      await dismissOverlay(el);
      return driveSearchSelect(el, value);
    }
  }

  const searchInput = findSearchInput(overlay);
  if (searchInput && segments[0]) {
    typeIntoInput(searchInput, segments[0].replace(/(省|市|自治区|特别行政区)$/, ''));
    await sleep(250);
    overlay = findFreshOverlay(before) || overlay;
  }

  const steps = segments.length ? segments : [value];
  for (let index = 0; index < steps.length; index += 1) {
    const part = steps[index];
    const aliases = optionMatchAliases(part).map((item) => item.toLowerCase());
    const leftPane = overlay.querySelector(
      '[class*="left" i], [class*="source" i], [class*="tree" i], [class*="list" i]',
    ) || overlay;
    let hit = await findOptionWithScroll(leftPane, aliases);
    if (!hit) {
      hit = await findOptionWithScroll(overlay, aliases);
    }
    if (!hit) {
      return failDrive(el, `地区未找到：${part}`);
    }
    // 有「>」的项：点整行下钻
    safeClick(hit);
    await sleep(220);
    overlay = findFreshOverlay(before) || overlay;
  }

  // 必须点确定
  const confirmBtn = [...overlay.querySelectorAll('button, a, span, div')].find((node) => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) return false;
    const text = ownVisibleText(node).replace(/\s+/g, '');
    return text === '确定' || text === '确认' || text === 'OK';
  });
  if (confirmBtn) {
    safeClick(confirmBtn);
    await sleep(200);
  } else if (isRegionModal(overlay)) {
    return failDrive(el, '地区弹窗未找到确定按钮');
  }

  const actual = readControlText(el);
  const ok = aliasesAll.some((alias) => actual.toLowerCase().includes(alias))
    || steps.some((part) => actual.includes(part.replace(/市$/, '')));
  if (!ok) return failDrive(el, '地区选择后回读不一致');
  await dismissOverlay(el);
  return { ok: true, reason: '地区弹窗选择成功' };
}

// ——— 普通短下拉 ———

/**
 * 普通下拉：打开 → 点选项（支持短滚动）。
 */
export async function driveSimpleSelect(el, value) {
  const aliases = optionMatchAliases(value).map((item) => item.toLowerCase());
  const before = snapshotOverlays();
  el.scrollIntoView({ block: 'center' });
  safeClick(el);
  await sleep(280);
  let overlay = findFreshOverlay(before);
  if (!overlay) {
    // 原生 select
    if (el instanceof HTMLSelectElement) {
      const options = [...el.options];
      const hit = options.find((option) => textMatchesAliases(option.text, aliases)
        || textMatchesAliases(option.value, aliases));
      if (!hit) return { ok: false, reason: '原生下拉无匹配项' };
      el.value = hit.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: '原生下拉成功' };
    }
    return { ok: false, reason: '未打开下拉' };
  }
  if (isRegionModal(overlay)) {
    await dismissOverlay(el);
    return driveRegionModal(el, value);
  }
  if (findSearchInput(overlay)) {
    await dismissOverlay(el);
    return driveSearchSelect(el, value);
  }
  const hit = await findOptionWithScroll(overlay, aliases);
  if (!hit) return failDrive(el, '下拉未找到选项');
  safeClick(hit);
  await sleep(150);
  const actual = readControlText(el);
  if (!textMatchesAliases(actual, aliases) && !aliases.some((a) => actual.toLowerCase().includes(a))) {
    // 多段值允许任一段命中
    const parts = String(value).split(/\s*[/、,，]\s*/);
    if (!parts.some((part) => actual.includes(part))) {
      return failDrive(el, '下拉回读不一致');
    }
  }
  await dismissOverlay(el);
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
      result = await driveRegionModal(el, value);
      break;
    case 'searchSelect':
      result = await driveSearchSelect(el, value);
      break;
    case 'plainText':
      result = { ok: false, reason: '应交纯文本' };
      break;
    case 'simpleSelect':
    default:
      result = await driveSimpleSelect(el, value);
      break;
  }

  // 安全重试链：地区/搜索/联想互相兜一次（避免指纹误判）
  if (!result.ok && fingerprint === 'regionModal') {
    const retry = await driveSearchSelect(el, value);
    if (retry.ok) return { ...retry, fingerprint: 'searchSelect(retry)' };
  }
  if (!result.ok && fingerprint === 'suggestInput') {
    const retry = await driveSimpleSelect(el, value);
    if (retry.ok) return { ...retry, fingerprint: 'simpleSelect(retry)' };
  }
  if (!result.ok && fingerprint === 'datePanel') {
    // 日期失败不再盲点其它
    return { ...result, fingerprint };
  }
  if (!result.ok && fingerprint === 'simpleSelect') {
    // 可输入控件：尝试联想协议
    if (el instanceof HTMLInputElement && !el.readOnly) {
      const retry = await driveSuggestInput(el, value);
      if (retry.ok) return { ...retry, fingerprint: 'suggestInput(retry)' };
    }
  }

  return { ...result, fingerprint };
}
