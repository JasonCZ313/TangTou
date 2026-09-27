// @ts-nocheck
/**
 * 填写引擎（编排层）——「先补齐行数，再一个空一个空写」。
 *
 * 六条硬红线（对应历史上出现过的每一个乱填/漏填问题）：
 *  1) 分区即边界：项目条目绝不写进校内区，实习条目绝不写进项目区；判不出分区就留空；
 *  2) 点选控件只走「点开 → 读选项 → 比对别名 → 点击」，长数字/长文本禁止硬塞；
 *  3) 一个空一个空写：每写一格立刻回读校验，写不进去要报出来，绝不假装成功；
 *  4) 失败不消耗档案：写失败的那一条留在游标处，下一轮优先重试（最多 3 次）；
 *  5) 多行分区先补齐行数：档案有 N 条就先加到 N 行，然后按顺序一条一行填；
 *  6) 行内分组用「锚点边界法」（遇到下一个锚点就开新行），不依赖 DOM 是否真有行包装，
 *     所以「起止时间写在行首/行尾」两种版式都不会把上一行的空框串到下一行。
 *
 * 全程输出到 F12：分区锚点、每个字段归属、每个下拉读到什么选项、每次写入的回读结果。
 */
import type { ChaoEditable } from '../profileToChao';
import type { FillMiss } from '../../../shared/types/fill';
import {
  ROW_RULES,
  ROW_SECTION_TYPES,
  SECTION_ADD_WORDS,
  SECTION_SPECIFICITY,
  SECTION_TEXT_KEYWORDS,
  bareDatePartOf,
  buildAutofillValues,
  buildRowEntries,
  datePartValue,
  inferSubByKeyword,
  matchAutofillKey,
  matchRowRule,
  matchSectionHeading,
  relaxedMatchAutofillKey,
  rowDisplayName,
  rowSignature,
  rowValue,
  truncate,
} from './rules';
import {
  AUTOFILL_FILL_CLASS,
  AUTOFILL_MISS_CLASS,
  CONTROL,
  PANEL_ID,
  classifyControl,
  clearAutofillHighlights,
  ensureHighlightStyles,
  fieldLabelBlob,
  isControlEmpty,
  isOptionControl,
  isPageFieldVisible,
  isPlaceholderText,
  isWidgetTrigger,
  readControlText,
  resetLabelCache,
  sleep,
  toastProgress,
  tryCheckCurrentInBlock,
  writeField,
} from './dom';
import { chaoDebug } from './debug';

/** 提交/文件类 input 不是填写目标 */
const NON_FILLABLE_INPUT_TYPES = [
  'hidden', 'checkbox', 'radio', 'button', 'submit', 'file', 'password', 'image', 'reset', 'range', 'color',
];

/** 行锚点字段：判断「这一行属于哪段档案」的依据 */
const ANCHOR_SUBS = new Set(['org', 'title', 'name']);

/** 导航/侧栏容器：站点目录里也会有「项目经验」这类文字，必须排除，否则分区锚点会建到导航上 */
const NAV_CONTAINER_SELECTOR = 'nav, aside, [role="navigation"], [role="tablist"], [role="menu"],'
  + ' [class*="menu" i], [class*="nav" i], [class*="sidebar" i], [class*="step" i],'
  + ' [class*="anchor" i], [class*="catalog" i], [class*="toc" i], [class*="aside" i]';

/** 单步上限，防止极端页面死循环 */
const MAX_STEPS = 800;
/** 单个分区最多点几次「添加」 */
const MAX_ADD_ROUNDS_PER_SECTION = 25;
/** 点了「添加」但行数没增加，连续几次就放弃该分区 */
const MAX_ADD_STALL = 2;
/** 同一格最多尝试次数（超限才真正放弃） */
const MAX_FIELD_RETRY = 3;
/** 同一行最多尝试次数（超限才跳过该条档案）。点选侧已有「重读」兜底，这里收紧一次往返 */
const MAX_ROW_RETRY = 2;
/** 连续多少轮「连一个字段都没判定」就提前结束 */
const MAX_NO_PROGRESS_ROUNDS = 8;

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const debugLine = (icon, blob, note) => `${icon} 「${escapeHtml(truncate(blob, 24))}」${note}`;

/* ============================ 阶段 A：分区锚点 ============================ */

/** 只取某一层的「直接文本」（不递归整棵子树），避免把整页文本算进来导致串区 */
function directTextOf(host) {
  let text = '';
  host.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.querySelector('input, textarea, select, [role="combobox"]')) return;
    const own = String(node.textContent || '').replace(/\s+/g, '');
    if (own.length <= 24) text += own;
  });
  return text.replace(/\s+/g, '');
}

/**
 * 建分区锚点。
 * 判定要点：
 *  1) 不限定 h1~h6（很多网申站标题是普通 div）；
 *  2) 「项目经验 + 添加」在同一元素里时也能认出（剥离 +/添加 字样后再比对）；
 *  3) 排除导航/侧栏：右侧目录也写着「项目经验」，绝不能被当成表单分区；
 *  4) 排除「字段标签」：<label>语言</label> 只是字段名，不是分区标题，
 *     否则会凭空多出锚点，把后面的字段全部吸到这个假分区里（历史上串区的元凶之一）。
 */
function buildSectionAnchors() {
  const found = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  all.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest(`#${PANEL_ID}`)) return;
    if (el.closest(NAV_CONTAINER_SELECTOR)) return;
    if (el.tagName === 'A' || el.closest('a')) return;
    // 字段标签不是分区标题
    if (el.tagName === 'LABEL' || el.closest('label')) return;
    if (el.querySelector('input, textarea, select, [role="combobox"]')) return;
    // 直接子元素里就有输入控件的，是表单行不是分区标题
    if (el.querySelector(':scope > input, :scope > textarea, :scope > select, :scope > [role="combobox"]')) return;
    if (el.children.length > 6) return;
    // 优先用元素自身的直接文本；退回整段文本时剥掉「+ 添加」这类按钮字样
    const ownText = directTextOf(el);
    const fullText = String(el.textContent || '').replace(/(添加|新增|增加|＋|\+)/g, '');
    const type = matchSectionHeading(ownText) || matchSectionHeading(fullText);
    if (!type) return;
    found.push({ type, el, root: null });
  });

  // 去重：同分区嵌套标题只留外层；同节点只留一个
  const anchors = [];
  found.forEach((candidate) => {
    const duplicated = anchors.some((existing) => existing.el === candidate.el
      || (existing.el.contains(candidate.el) && existing.type === candidate.type));
    if (!duplicated) anchors.push(candidate);
  });

  // 分区根容器：从标题往上找「含输入控件、且不越界」的最高祖先。
  // 边界判据：容器里一旦出现**别的**分区标题，就说明爬到隔壁分区了，必须停在上一层。
  // （只判「下一个标题」会漏掉最后一个分区——它会一路爬到整页，把所有字段吸走。）
  anchors.forEach((anchor) => {
    let node = anchor.el.parentElement;
    let best = anchor.el.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const anchorCount = anchors.filter((other) => node.contains(other.el)).length;
      if (anchorCount > 1) break;
      if (node.querySelector('input, textarea, select, [role="combobox"]')) best = node;
    }
    anchor.root = best;
  });

  anchors.sort((left, right) => (
    left.el.compareDocumentPosition(right.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  ));
  return anchors;
}

/** 元素是否落在某个分区根容器内（取最靠后的那个锚点），返回分区类型 */
function sectionByRoot(el, anchors) {
  let hit = null;
  anchors.forEach((anchor) => {
    if (anchor.root && anchor.root.contains(el)) hit = anchor;
  });
  return hit ? hit.type : null;
}

/** 文档序上最近的一个「前面的锚点」，返回分区类型 */
function sectionByNearestPreceding(el, anchors) {
  let nearest = null;
  anchors.forEach((anchor) => {
    if (anchor.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = anchor;
  });
  return nearest ? nearest.type : null;
}

/**
 * 兜底推断：逐层向上、第一层命中即停。
 * 每层先看「这一层的直接文本是不是一个分区标题」——是就立刻返回（包括「个人信息」这种边界），
 * 所以「项目经验」区里的字段不会被更外层同时出现的「获奖经历」抢走，
 * 个人信息区里的字段也不会因为外层出现「项目」二字就被吸进项目区。
 */
function inferSectionByText(el) {
  let host = el?.parentElement || null;
  for (let depth = 0; host && depth < 8; depth += 1, host = host.parentElement) {
    const own = directTextOf(host);
    if (!own || own.length > 120) continue;
    const headingType = matchSectionHeading(own);
    if (headingType) return headingType;
    for (const type of SECTION_SPECIFICITY) {
      if ((SECTION_TEXT_KEYWORDS[type] || []).some((word) => own.includes(word))) return type;
    }
  }
  return null;
}

/** 综合判定字段分区（带本轮缓存，避免同一元素反复爬祖先 + 正则） */
function resolveSectionType(el, ctx) {
  if (ctx.sectionCache?.has(el)) return ctx.sectionCache.get(el);
  const byRoot = sectionByRoot(el, ctx.anchors);
  const byNearest = sectionByNearestPreceding(el, ctx.anchors);
  const byText = inferSectionByText(el);
  const resolved = (byRoot && byRoot !== 'basic') ? byRoot
    : (byNearest && byNearest !== 'basic') ? byNearest
      : byText || byNearest || byRoot || null;
  ctx.sectionCache?.set(el, resolved);
  return resolved;
}

/* ============================ 阶段 B：扫描单个空 ============================ */

/** 扫描页面上「还是空的、可见的、可填的」控件 */
function scanEmptyFields(ctx) {
  const fields = [];
  document.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"], [contenteditable=""]')
    .forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest(`#${PANEL_ID}`)) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (NON_FILLABLE_INPUT_TYPES.includes(type)) return;
      }
      const skip = (reason) => ctx.skipCounts.set(reason, (ctx.skipCounts.get(reason) || 0) + 1);
      if (el.disabled) { skip('禁用'); return; }
      const control = classifyControl(el);
      if (el.readOnly && !isWidgetTrigger(el) && control !== CONTROL.optionWidget) { skip('只读'); return; }
      if (!isPageFieldVisible(el)) { skip('不可见'); return; }
      // 已有值的一律不覆盖；判空统一走 isControlEmpty（占位文字不算值）
      if (!isControlEmpty(el)) { skip('已有值'); return; }
      if (ctx.done.has(el)) { skip('本轮已写入'); return; }
      if ((ctx.attempts.get(el) || 0) >= MAX_FIELD_RETRY) { skip('重试超限'); return; }
      const blob = fieldLabelBlob(el);
      if (!blob) { skip('无上下文'); return; }
      fields.push({ el, tag, control, blob, sectionType: resolveSectionType(el, ctx) });
    });
  return fields.sort((left, right) => {
    const position = left.el.compareDocumentPosition(right.el);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/* ============================ 阶段 C：裸日期控件（年/月/日） ============================ */

const DATE_START_WORDS = /(开始|起始|入学|入职|发布|起止)/;
const DATE_END_WORDS = /(结束|截止|毕业|离职|离校)/;

/**
 * 取容器文本，但跳过 <select> 里的 option 文案。
 * 为什么必须跳过：一个「年」下拉的 option 里塞着 2020~2030 全部年份，会把容器文本撑到上百字，
 * 导致「年月」分组无法合并、起止判断失效（历史上项目结束时间填成开始时间的根因之一）。
 */
function textWithoutOptions(node) {
  let text = '';
  const walk = (current) => {
    current.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent || '';
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      if (child.tagName.toLowerCase() === 'select') return;
      walk(child);
    });
  };
  if (node) walk(node);
  return text.replace(/\s+/g, '');
}

/**
 * 取日期控件的语义容器文案。
 * 只包住年/月两个下拉的那层容器本身没有文字（`[年][月]`），
 * 必须再往上找一层才能读到「毕业时间」这类标签 —— 否则起止判定一定失效。
 */
function findDateHintText(node) {
  let fallback = '';
  let current = node;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    const text = textWithoutOptions(current);
    if (!text || text.length > 30) continue;
    if (DATE_START_WORDS.test(text) || DATE_END_WORDS.test(text)) return text;
    if (!fallback) fallback = text;
  }
  return fallback || textWithoutOptions(node);
}

/**
 * 裸日期控件（年/月/日 下拉）归类：按「包含 ≥2 个裸日期控件的最小祖先」分组。
 * 组内 ≥4 个（偶数）→ 前一半=开始、后一半=结束；2-3 个看容器文案；
 * 都判断不出来时按「单点日期（date）」处理，交给分区决定落到哪个字段。
 * 关键：绝不把 null 当分组键（历史上会在这里抛异常中断整轮）。
 */
function classifyBareDateParts(fields) {
  const result = new Map();
  try {
    const bare = fields
      .map((field) => ({ field, part: bareDatePartOf(field.blob) }))
      .filter((item) => item.part);
    if (!bare.length) return result;

    const groups = new Map();
    bare.forEach((item) => {
      let node = item.field.el.parentElement;
      let chosen = null;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        if (bare.filter((other) => node.contains(other.field.el)).length >= 2) {
          chosen = node;
          break;
        }
      }
      // 找不到容器时用元素自身当键，确保键永远是非空节点
      const key = chosen || item.field.el;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const groupList = [...groups.entries()];
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < groupList.length && !merged; i += 1) {
        for (let j = i + 1; j < groupList.length && !merged; j += 1) {
          const [nodeA, membersA] = groupList[i];
          const [nodeB, membersB] = groupList[j];
          if (!nodeA || !nodeB) continue;
          let lca = nodeA.parentElement;
          for (let depth = 0; lca && depth < 8 && !lca.contains(nodeB); depth += 1, lca = lca.parentElement) { /* 找公共祖先 */ }
          if (!lca) continue;
          const union = [...membersA, ...membersB];
          if (union.length > 6) continue;
          if (bare.filter((other) => lca.contains(other.field.el)).length !== union.length) continue;
          // 容器文本必须用「去掉 option 文案」的版本，否则永远超长导致合并失败
          if (textWithoutOptions(lca).length > 40) continue;
          groupList.splice(j, 1);
          groupList[i] = [lca, union];
          merged = true;
        }
      }
    }

    new Map(groupList).forEach((members, node) => {
      members.sort((left, right) => (
        left.field.el.compareDocumentPosition(right.field.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      ));
      const containerText = findDateHintText(node);
      const hasStart = DATE_START_WORDS.test(containerText);
      const hasEnd = DATE_END_WORDS.test(containerText);
      let roles = null;
      if (members.length >= 4 && members.length % 2 === 0) {
        const half = members.length / 2;
        roles = members.map((_, index) => (index < half ? 'start' : 'end'));
      } else if (hasStart && !hasEnd) roles = members.map(() => 'start');
      else if (hasEnd && !hasStart) roles = members.map(() => 'end');
      else if (members.length <= 3) roles = members.map(() => 'date');
      if (!roles) return;
      members.forEach((item, index) => {
        result.set(item.field.el, {
          role: roles[index],
          part: item.part === '年' ? 'year' : item.part === '月' ? 'month' : 'day',
          // 带上容器文案与起止语义，供「单点日期」在分区内判定该落到开始还是结束
          hint: containerText,
          hasStartWord: hasStart,
          hasEndWord: hasEnd,
        });
      });
    });
  } catch (error) {
    chaoDebug.error('裸日期控件分组失败（已跳过，不影响其他字段）', error);
  }
  return result;
}

/**
 * 分区里是否支持某个 sub，并把「单点日期（date）」落到正确的开始/结束。
 *
 * 关键修正：不能无条件把 date 当成 start ——
 * 页面上只有一对年月、且容器写着「毕业时间」时，那是**结束时间**；
 * 无条件当 start 会把入学时间写进毕业时间的框里（用户反馈的「时间填错」）。
 */
function resolveSubForSection(sectionType, sub, bareHint) {
  const rules = ROW_RULES[sectionType] || [];
  const subs = new Set(rules.map((rule) => rule.sub));
  if (subs.has(sub)) return sub;
  if (sub === 'date') {
    const hint = String(bareHint?.hint || '');
    const scopeHasEnd = bareHint?.hasEndWord ?? DATE_END_WORDS.test(hint);
    const scopeHasStart = bareHint?.hasStartWord ?? DATE_START_WORDS.test(hint);
    if (scopeHasEnd && !scopeHasStart && subs.has('end')) return 'end';
    if (scopeHasStart && !scopeHasEnd && subs.has('start')) return 'start';
    // 两边都没关键词时，按分区常用语义兜底：教育/实习/工作/项目/校内 的孤立日期多为开始时间
    if (!scopeHasEnd && subs.has('start')) return 'start';
    if (!scopeHasStart && subs.has('end')) return 'end';
    return null;
  }
  return null;
}

/* ============================ 阶段 C2：基本信息区的年月对 ============================ */

/**
 * 基本信息区「年/月」这类格子的语义表。
 * 它们的标签只有「年」「月」，基础规则根本匹配不到，历史上会整对漏填
 * （用户反馈的「毕业时间没有检测」）。
 */
const BASIC_DATE_HINTS = [
  { key: 'educationEnd', pattern: /(毕业|离校|毕业时间|毕业年月)/ },
  { key: 'educationStart', pattern: /(入学|入学时间|就读起始|入学年月)/ },
  { key: 'birthday', pattern: /(出生|生日|出生日期|出生年月)/ },
];

/** 从裸日期控件向上找一个「短且有语义」的容器，据此判断它属于哪个基础字段 */
function nearestBasicDateHint(el) {
  let node = el?.parentElement || null;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const text = textWithoutOptions(node);
    if (!text || text.length > 30) continue;
    const hit = BASIC_DATE_HINTS.find((item) => item.pattern.test(text));
    if (hit) return hit.key;
  }
  return null;
}

/**
 * 填基本信息区的「年」「月」下拉。
 * 只处理不在行分区里的裸日期控件，且容器文案能明确对应到某个基础字段；
 * 认不准就留空（宁缺勿错）。
 */
async function fillBasicDatePairs(fields, ctx) {
  let filled = 0;
  for (const field of fields) {
    if (ROW_SECTION_TYPES.includes(field.sectionType)) continue;
    const part = bareDatePartOf(field.blob);
    if (!part) continue;
    const targetKey = nearestBasicDateHint(field.el);
    if (!targetKey) continue;
    const valueItem = ctx.values.find((item) => item.key === targetKey);
    if (!valueItem) continue;
    const partValue = datePartValue(
      valueItem.value,
      part === '年' ? 'year' : part === '月' ? 'month' : 'day',
    );
    if (!partValue) continue;
    // 先标记，避免主循环把它当普通散字段再处理一次
    ctx.done.add(field.el);
    const result = await writeField(field, partValue);
    if (result.ok) {
      field.el.classList.add(AUTOFILL_FILL_CLASS);
      ctx.progressMark += 1;
      filled += 1;
      ctx.dbg.push(debugLine('✓', field.blob, ` → ${targetKey}（年月对）`));
    } else {
      ctx.attempts.set(field.el, (ctx.attempts.get(field.el) || 0) + 1);
      ctx.missed.push({ label: field.blob, reason: `${targetKey}：${result.reason}` });
    }
    await sleep(45);
  }
  if (filled) chaoDebug.ok(`基本信息区年月对写入 ${filled} 项`);
  return filled;
}

/**
 * 阶段四：补漏。
 * 主循环结束后，把「仍然空着」的散字段再走一遍：
 * 先用常规规则、再用宽松别名、最后按语义关键词兜底，命中就回档案取值补上。
 * 只处理空字段，绝不覆盖已填内容；行分区的空值由行内回落负责，这里不插手。
 */
const SECOND_PASS_KEYWORDS = [
  { key: 'educationEnd', pattern: /(毕业|离校)/ },
  { key: 'educationStart', pattern: /(入学|就读起始)/ },
  { key: 'degree', pattern: /(最高学历|学历层次|学历|学位)/ },
  { key: 'school', pattern: /(毕业院校|就读学校|学校名称|学校)/ },
  { key: 'major', pattern: /(所学专业|专业名称|专业)/ },
  { key: 'college', pattern: /(院系|学院)/ },
  { key: 'birthday', pattern: /(出生|生日)/ },
  { key: 'gender', pattern: /(性别)/ },
  { key: 'ethnicity', pattern: /(民族)/ },
  { key: 'politicalStatus', pattern: /(政治面貌)/ },
  { key: 'nativePlace', pattern: /(籍贯)/ },
  { key: 'phone', pattern: /(手机|联系电话|电话)/ },
  { key: 'email', pattern: /(邮箱|电子邮件)/ },
  { key: 'expectedCity', pattern: /(意向工作城市|期望工作城市|期望城市|意向城市)/ },
  { key: 'availableDate', pattern: /(到岗|入职时间|可入职)/ },
];

async function runSecondPass(ctx) {
  let total = 0;
  for (let round = 0; round < 2; round += 1) {
    const fields = scanEmptyFields(ctx);
    if (!fields.length) break;
    let wroteThisRound = 0;
    for (const field of fields) {
      if (ROW_SECTION_TYPES.includes(field.sectionType)) continue;
      if (!isControlEmpty(field.el)) continue;
      let matchedKey = matchAutofillKey(field.blob, ctx.availableKeys, ctx.customRules)
        || relaxedMatchAutofillKey(field.blob, ctx.availableKeys);
      if (!matchedKey) {
        // 语义兜底：第一轮完全没认出来时，按标签里的概念词映射到基础字段
        matchedKey = SECOND_PASS_KEYWORDS.find((item) => item.pattern.test(field.blob))?.key || null;
      }
      if (!matchedKey) continue;
      if (matchedKey === 'idNumber') {
        matchedKey = resolveIdKey(field, ctx);
        if (!matchedKey) { ctx.done.add(field.el); continue; }
      }
      const valueItem = ctx.values.find((item) => item.key === matchedKey);
      if (!valueItem) continue;
      const result = await writeField(field, valueItem.value);
      if (result.ok) {
        field.el.classList.add(AUTOFILL_FILL_CLASS);
        ctx.done.add(field.el);
        wroteThisRound += 1;
        total += 1;
        ctx.dbg.push(debugLine('✓', field.blob, ` → ${valueItem.label}（补漏）`));
      } else {
        ctx.attempts.set(field.el, (ctx.attempts.get(field.el) || 0) + 1);
        ctx.missed.push({ label: field.blob, reason: `${valueItem.label}：${result.reason}` });
      }
      await sleep(45);
    }
    ctx.progressMark += wroteThisRound;
    if (!wroteThisRound) break;
  }
  if (total) chaoDebug.ok(`补漏阶段又写入 ${total} 项`);
  return total;
}

/* ============================ 阶段 D：行分组（锚点边界法） ============================ */

/**
 * 把一个分区的空字段解析成 { field, sub, part }。
 * 顺序：裸日期 → 行规则 → 「换个叫法」兜底。
 * 返回值同时带上 leftovers：这一分区里「匹配不上的字段」原样交回，
 * 让上层把它们记进漏填表，而不是静默丢弃（否则用户只看到「必填项未填写」却不知道是哪一格）。
 */
function resolveSectionEntries(sectionType, sectionFields) {
  const rules = ROW_RULES[sectionType] || [];
  const availableSubs = new Set(rules.map((rule) => rule.sub));
  const bareParts = classifyBareDateParts(sectionFields);
  const entries = [];
  const leftovers = [];
  sectionFields.forEach((field) => {
    const bare = bareParts.get(field.el);
    if (bare) {
      const sub = resolveSubForSection(sectionType, bare.role, bare);
      if (sub) entries.push({ field, sub, part: bare.part });
      else leftovers.push(field);
      return;
    }
    const sub = matchRowRule(field.blob, rules, availableSubs) || inferSubByKeyword(field.blob, sectionType);
    if (sub && availableSubs.has(sub)) entries.push({ field, sub });
    else leftovers.push(field);
  });
  entries.sort((left, right) => (
    left.field.el.compareDocumentPosition(right.field.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  ));
  return { entries, leftovers };
}

/**
 * 行内聚类：同名字段或同一段年月重复出现时开新行；行内第二个「开始」转成「结束」。
 * 注意：不要用「组内已有起止两个日期」当换行判据——那会在同一行的「结束月」处误开新行。
 */
function clusterWithinUnit(entries) {
  const groups = [];
  entries.forEach((rawItem) => {
    const item = { ...rawItem };
    const current = groups[groups.length - 1];
    if (current) {
      const hasAnchor = current.some((entry) => ANCHOR_SUBS.has(entry.sub));
      const hasStart = current.some((entry) => entry.sub === 'start');
      const hasEnd = current.some((entry) => entry.sub === 'end');
      // 行内第二个「开始时间」→ 结束时间
      if (!item.part && item.sub === 'start' && hasAnchor && hasStart && !hasEnd) {
        item.sub = 'end';
      }
      const duplicate = current.some((entry) => entry.sub === item.sub
        && (item.part ? entry.part === item.part : true))
        && item.sub !== 'desc';
      if (duplicate) {
        groups.push([item]);
        return;
      }
    }
    if (!current) groups.push([item]);
    else current.push(item);
  });
  return groups;
}

/** 分区内行分组：按文档顺序聚类成「一行一组」 */
function buildSectionGroups(sectionType, sectionFields) {
  const { entries } = resolveSectionEntries(sectionType, sectionFields);
  if (!entries.length) return [];
  return clusterWithinUnit(entries);
}

/**
 * 行数统计（补行判据用）：
 * 正常行按「一组一行」计数；匹配不上的字段（leftovers）每个单独算一行，
 * 这样「新加的行字段匹配不上」时也不会被误判成「点了添加但没增加」（否则会提前放弃补行）。
 */
function countSectionRows(sectionType, sectionFields) {
  const { entries, leftovers } = resolveSectionEntries(sectionType, sectionFields);
  const groups = entries.length ? clusterWithinUnit(entries) : [];
  return groups.length + leftovers.length;
}

/** 一组字段的最近公共祖先 */
function commonAncestorOf(group) {
  let node = group[0]?.field?.el?.parentElement || null;
  if (!node) return null;
  while (node && !group.every((item) => node.contains(item.field.el))) node = node.parentElement;
  return node;
}

/* ============================ 阶段 E：写入一行 ============================ */

/** 该组里是否有「已经写进去的锚点」（用于判断这一行是不是已填过） */
function groupAnchorElement(group) {
  return group.find((item) => ANCHOR_SUBS.has(item.sub))?.field?.el || null;
}

/** 记录某一行已用掉哪条档案，供「同一条档案补填这一行剩余空」使用 */
function rememberRow(sectionType, group, entry, ctx) {
  const anchorEl = groupAnchorElement(group);
  const record = {
    sectionType,
    anchorEl,
    container: commonAncestorOf(group),
    entry,
    attempts: 0,
  };
  if (anchorEl) ctx.rowRecordByAnchor.set(anchorEl, record);
  ctx.rowRecords.push(record);
  return record;
}

/** 找出这一组属于哪一行记录（回填用） */
function findRowRecord(group, ctx) {
  const anchorEl = groupAnchorElement(group);
  if (anchorEl && ctx.rowRecordByAnchor.has(anchorEl)) return ctx.rowRecordByAnchor.get(anchorEl);
  // 没有锚点（或锚点未写入）：用「已记录的行容器是否包含本组字段」来判断归属，
  // 这样「上一行填完后才出现的残留空格」（如分数框）能被认回原来那一行，而不是被当成新行。
  const matched = ctx.rowRecords.find((record) => (
    record.container
    && document.contains(record.container)
    && group.every((item) => record.container.contains(item.field.el))
  ));
  if (matched) return matched;
  return null;
}

/**
 * 行字段取值回落到「基础信息」的映射。
 * 只在「该分区的档案只有 1 条」时启用（见 basicFallbackValue），
 * 否则多行场景会把同一个学校/公司写进每一行。
 */
const BASIC_FALLBACK_BY_SUB = {
  education: {
    org: 'school',
    college: 'college',
    major: 'major',
    degree: 'degree',
    start: 'educationStart',
    end: 'educationEnd',
    courses: 'mainCourses',
  },
  internship: { org: 'school' },
  work: { org: 'school' },
};

/**
 * 取「基础信息里的同义值」作为行内空值的兜底。
 * 典型场景：档案只有基本信息里填了「最高学历：大学本科」，
 * 而页面的学历框在教育分区内 —— 该行没有值，但基础信息有，应当补上。
 * 安全前提：该分区只配置了 1 条档案（多行时不允许回落，避免串值）。
 */
function basicFallbackValue(sectionType, sub, ctx) {
  const pool = ctx.entries[sectionType] || [];
  if (pool.length !== 1) return '';
  const mapping = BASIC_FALLBACK_BY_SUB[sectionType];
  const basicKey = mapping?.[sub];
  if (!basicKey) return '';
  return ctx.values.find((item) => item.key === basicKey)?.value || '';
}

/**
 * 填一行：逐字段写 + 回读。
 * 返回 written 供调用方判断成败；失败原因一并带回。
 */
async function fillRowGroup(group, entry, sectionType, ctx) {
  let written = 0;
  let anchorWritten = false;
  let firstFailure = '';
  let needCurrent = false;

  for (const item of group) {
    const { field, sub } = item;
    let value = rowValue(entry.data, sub);
    let fromBasic = false;
    if (!value) {
      // 行内没有值 → 单条档案时回落到基础信息（修「学历本来有但没填」）
      value = basicFallbackValue(sectionType, sub, ctx);
      fromBasic = Boolean(value);
    }
    if (!value) continue;
    if (value === '至今') {
      needCurrent = true;
      continue;
    }
    if (item.part) value = datePartValue(value, item.part);
    if (!value) continue;
    const result = await writeField(field, value);
    if (result.ok) {
      field.el.classList.add(AUTOFILL_FILL_CLASS);
      ctx.done.add(field.el);
      written += 1;
      if (ANCHOR_SUBS.has(sub)) anchorWritten = true;
      if (fromBasic) ctx.dbg.push(debugLine('✓', field.blob, ` → ${sub}（基础信息回落）`));
    } else {
      ctx.attempts.set(field.el, (ctx.attempts.get(field.el) || 0) + 1);
      firstFailure = firstFailure || result.reason;
      ctx.missed.push({ label: field.blob, reason: `${sub}：${result.reason}` });
      ctx.dbg.push(debugLine('✗', field.blob, ` → ${sub}（${result.reason}）`));
    }
    await sleep(45);
  }

  // 档案没有结束时间 / 明确「至今」→ 勾选行内「至今」
  const endValue = rowValue(entry.data, 'end');
  const container = commonAncestorOf(group);
  if ((needCurrent || !endValue) && container && tryCheckCurrentInBlock(container)) {
    written += 1;
    chaoDebug.ok('勾选「至今」', { 分区: sectionType });
  }

  // 同行「写入后才渲染出来」的字段（结束时间、联动下拉）继续用同一段档案补。
  // 扫描范围取「本行容器」，并额外覆盖「该分区根容器」里新增的字段，避免跨行新控件被漏掉。
  for (let pass = 0; pass < 2; pass += 1) {
    await sleep(240);
    const anchor = ctx.anchors.find((item) => item.type === sectionType);
    const scope = commonAncestorOf(group) || anchor?.root || container;
    if (!scope) break;
    const fresh = scanEmptyFields(ctx)
      .filter((field) => scope.contains(field.el))
      .filter((field) => !ctx.done.has(field.el));
    if (!fresh.length) break;
    const { entries: followEntries } = resolveSectionEntries(sectionType, fresh);
    if (!followEntries.length) break;
    let wroteThisPass = 0;
    for (const item of followEntries) {
      let value = rowValue(entry.data, item.sub);
      if (!value || value === '至今') continue;
      if (item.part) value = datePartValue(value, item.part);
      const result = await writeField(item.field, value);
      if (result.ok) {
        item.field.el.classList.add(AUTOFILL_FILL_CLASS);
        ctx.done.add(item.field.el);
        written += 1;
        wroteThisPass += 1;
      } else {
        ctx.attempts.set(item.field.el, (ctx.attempts.get(item.field.el) || 0) + 1);
      }
    }
    chaoDebug.info(`同行补充渲染出 ${followEntries.length} 个字段，本轮写入 ${wroteThisPass} 个`, { 分区: sectionType });
    if (!wroteThisPass) break;
  }

  ctx.progressMark += written;
  return { ok: written >= 1, written, anchorWritten, reason: firstFailure };
}

/* ============================ 阶段 F：行数补齐 ============================ */

/**
 * 找分区内的「+ 添加」按钮。
 * 先按「分区归属」筛（与字段同一套判定），再按分区关键词挑；两者都不满足就不返回。
 * 这样绝不会把「实习经历」的添加键点给「项目经验」用（跨区 root 也不会误点）。
 */
function findAddButton(sectionType, ctx) {
  const cached = ctx.addButtonCache.get(sectionType);
  if (cached && document.contains(cached) && isPageFieldVisible(cached)) return cached;
  const anchor = ctx.anchors.find((item) => item.type === sectionType);
  const candidates = [...document.querySelectorAll(
    'button, a, [role="button"], input[type="button"], [class*="add" i], [class*="plus" i]',
  )].filter((el) => el instanceof HTMLElement && !el.closest(`#${PANEL_ID}`) && isPageFieldVisible(el))
    .map((el) => ({ el, text: String(el.textContent || el.value || '').replace(/\s+/g, '') }))
    .filter((item) => item.text && item.text.length <= 16 && /(添加|新增|增加|＋|\+)/.test(item.text));
  if (!candidates.length) return null;

  const contextOf = (el) => {
    let context = '';
    let node = el;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      context += String(node.textContent || '').replace(/\s+/g, '');
      if (context.length > 500) break;
    }
    return context.slice(0, 500);
  };
  const words = SECTION_ADD_WORDS[sectionType] || [];

  // ① 分区归属必须匹配（同一套 resolveSectionType，字段与按钮口径一致）
  const owned = candidates.filter((item) => resolveSectionType(item.el, ctx) === sectionType);
  const ownedByWord = owned.find((item) => words.some((word) => contextOf(item.el).includes(word)));
  const chosen = ownedByWord || owned[0];
  if (chosen) {
    ctx.addButtonCache.set(sectionType, chosen.el);
    return chosen.el;
  }

  // ② 分区判定不出来时，才退回「分区根容器内 + 分区关键词」；仍不行就返回 null（宁可少加，不加错区）
  if (anchor?.root) {
    const insideRoot = candidates.filter((item) => anchor.root.contains(item.el));
    const insideByWord = insideRoot.find((item) => words.some((word) => contextOf(item.el).includes(word)));
    if (insideByWord) {
      ctx.addButtonCache.set(sectionType, insideByWord.el);
      return insideByWord.el;
    }
  }
  return null;
}

/** 当前分区里「还能填的空行组」数量 */
function countEmptyGroups(sectionType, ctx) {
  const sectionFields = scanEmptyFields(ctx).filter((field) => field.sectionType === sectionType);
  if (!sectionFields.length) return { count: 0, groups: [] };
  const groups = buildSectionGroups(sectionType, sectionFields);
  // 行数判据用 countSectionRows：匹配不上的字段也算一行，避免「新行字段认不出 → 误判没增加」
  return { count: countSectionRows(sectionType, sectionFields), groups };
}

/** 站点自己已经填好的行数（排除我们本轮写的），用于初始游标 */
function countSitePrefilledRows(sectionType, ctx) {
  const anchorRules = (ROW_RULES[sectionType] || []).filter((rule) => ANCHOR_SUBS.has(rule.sub));
  if (!anchorRules.length) return 0;
  const anchorSubs = new Set(anchorRules.map((rule) => rule.sub));
  let count = 0;
  document.querySelectorAll('input, textarea, select, [role="combobox"]').forEach((el) => {
    if (!(el instanceof HTMLElement) || el.closest(`#${PANEL_ID}`)) return;
    if (ctx.done.has(el)) return;
    if (resolveSectionType(el, ctx) !== sectionType) return;
    const blob = fieldLabelBlob(el);
    const value = readControlText(el);
    if (!value) return;
    // 双保险：值等于自己的标签（容器污染）、或仍是占位文案 → 不算已填
    if (value === blob || isPlaceholderText(value)) return;
    if (matchRowRule(blob, anchorRules, anchorSubs)) count += 1;
  });
  return count;
}

/**
 * 在当前分区补出「一行」。
 * 节奏：点一次「添加」→ 等待 → 重新扫描确认行数真的 +1。
 * 这个函数被主循环按需调用，因此整体节奏就是「加一条 → 扫一次 → 填一条」。
 * @returns {boolean} 是否成功新增一行
 */
async function growOneRow(sectionType, ctx) {
  const state = ctx.sectionState.get(sectionType);
  if (!state) return false;
  if (state.addRounds >= MAX_ADD_ROUNDS_PER_SECTION) {
    state.done = true;
    return false;
  }
  const button = findAddButton(sectionType, ctx);
  if (!button) {
    ctx.dbg.push(`✋ [${sectionType}] 还需要新行，但没找到该分区的「添加」按钮`);
    chaoDebug.fail(`[${sectionType}] 找不到「添加」按钮`, {});
    return false;
  }
  const beforeRows = countEmptyGroups(sectionType, ctx).count;
  ctx.progress.update(`➕ [${sectionType}] 正在新增一行…`);
  chaoDebug.op(`点击「添加」新增一行`, { 分区: sectionType, 当前行数: beforeRows });
  button.scrollIntoView({ block: 'center' });
  button.click();
  state.addRounds += 1;
  await sleep(700);
  const afterRows = countEmptyGroups(sectionType, ctx).count;
  if (afterRows <= beforeRows) {
    state.addStall += 1;
    chaoDebug.fail(`[${sectionType}] 点了「添加」但行数没增加`, { 当前: beforeRows, 次数: state.addStall });
    if (state.addStall >= MAX_ADD_STALL) {
      state.done = true;
      ctx.dbg.push(`✋ [${sectionType}] 连续 ${state.addStall} 次点了「添加」但行数不增加，停止扩块`);
    }
    return false;
  }
  state.addStall = 0;
  ctx.progressMark += 1;
  // 新增行会改变 DOM（新的空字段、新的祖先文本），分区缓存必须作废
  ctx.sectionCache?.clear();
  ctx.dbg.push(`➕ [${sectionType}] 已新增一行（${beforeRows} → ${afterRows}）`);
  chaoDebug.ok(`[${sectionType}] 新增一行`, { 行数: afterRows });
  return true;
}

/**
 * 分区「行数体检」：只做诊断与游标初始化，不再批量补行。
 * 批量补行已被主循环里的 growOneRow 取代，节奏改为「加一条 → 扫一次 → 填一条」。
 */
function inspectSectionRows(sectionType, ctx) {
  const pool = ctx.entries[sectionType] || [];
  const state = ctx.sectionState.get(sectionType);
  if (!pool.length || !state || state.done) return;
  const anchorExists = ctx.anchors.some((anchor) => anchor.type === sectionType);
  const hasFields = scanEmptyFields(ctx).some((field) => field.sectionType === sectionType);
  const siteRows = countSitePrefilledRows(sectionType, ctx);
  if (!anchorExists && !hasFields && siteRows === 0) return;
  const { count: emptyRows, groups } = countEmptyGroups(sectionType, ctx);
  ctx.dbg.push(`🧮 [${sectionType}] 档案 ${pool.length} 条 / 页面空行 ${emptyRows} / 站点已填 ${siteRows}`);
  const sampleFields = scanEmptyFields(ctx).filter((field) => field.sectionType === sectionType);
  ctx.dbg.push(`   本区空字段 ${sampleFields.length} 个：${sampleFields
    .slice(0, 8).map((field) => truncate(field.blob, 12)).join(' / ') || '（无）'}`);
  ctx.dbg.push(`   行分组：${groups.map((group) => `[${group
    .map((item) => `${item.sub}${item.part ? `.${item.part}` : ''}`).join(' ')}]`).join(' , ') || '（无）'}`);
}

/* ============================ 阶段 G：任务调度 ============================ */

/** 取该分区下一条还没用过的档案 */
function nextUnconsumedEntry(sectionType, ctx) {
  const pool = ctx.entries[sectionType] || [];
  const state = ctx.sectionState.get(sectionType);
  if (!state) return null;
  for (let index = state.cursor; index < pool.length; index += 1) {
    const entry = pool[index];
    const signature = rowSignature(sectionType, entry);
    if (ctx.consumed.has(signature) || state.skipped.has(signature)) continue;
    return { entry, index, signature };
  }
  return null;
}

/**
 * 取下一个要处理的「空」。
 *
 * 优先级（数字越小越先做，同档按文档序）：
 *   0 → 补填「已动过但仍有空」的行（用同一段档案继续补）
 *   1 → 行任务（带锚点的完整空行 / 无锚点分区的空行）
 *   2 → 散字段（基本信息、教育散字段等）
 *   3 → grow：点一次「添加」补一行
 *
 * 结果：只要有空格就先填；某个分区填不动了才去补行，
 * 因此天然形成「加一条 → 扫一次 → 填一条 → 再核对」的节奏。
 */
function pickNextTask(ctx, fields) {
  const candidates = [];
  const notes = [];

  // 0 / 1 行任务
  ROW_SECTION_TYPES.forEach((sectionType) => {
    const state = ctx.sectionState.get(sectionType);
    if (!state || state.done) return;
    // 每轮先归零：否则「本轮没有空字段」时会保留上一轮的旧值，
    // 让「该加行」被误判成「还有空行」，补行永远不会发生（多行分区只填第一条）。
    state.emptyGroups = 0;
    const sectionFields = fields.filter((field) => field.sectionType === sectionType);
    if (!sectionFields.length) return;
    const groups = buildSectionGroups(sectionType, sectionFields);
    const next = nextUnconsumedEntry(sectionType, ctx);
    state.emptyGroups = groups.length;
    notes.push(`[${sectionType}] 组${groups.length} 游标${state.cursor} 下一条${next ? `#${next.index + 1}` : '无'}`);
    // 只有「字段里有锚点」的分区才需要靠锚点区分行；语言/技能这类没有锚点的分区按文档顺序填
    const requiresAnchor = (ROW_RULES[sectionType] || []).some((rule) => ANCHOR_SUBS.has(rule.sub));
    groups.forEach((group) => {
      const record = findRowRecord(group, ctx);
      if (record) {
        if (record.attempts >= MAX_ROW_RETRY) return;
        candidates.push({
          kind: 'row',
          sectionType,
          group,
          entry: record.entry,
          record,
          priority: 0,
          order: group[0].field.el,
        });
        return;
      }
      // 没有记录：需要靠锚点区分「新空行」与「已填行的残留空」，判不准就留空不乱填
      const hasAnchor = group.some((item) => ANCHOR_SUBS.has(item.sub));
      if (requiresAnchor && !hasAnchor && groups.length > 1) {
        chaoDebug.skip(`[${sectionType}] 匿名空行`, '与已填行无法区分，留空不乱填');
        return;
      }
      if (!next) return;
      candidates.push({
        kind: 'row',
        sectionType,
        group,
        entry: next.entry,
        record: null,
        cursorIndex: next.index,
        signature: next.signature,
        priority: 1,
        order: group[0].field.el,
      });
    });
  });

  // 2 散字段
  fields.filter((field) => !ROW_SECTION_TYPES.includes(field.sectionType)).forEach((field) => {
    candidates.push({ kind: 'basic', field, priority: 2, order: field.el });
  });

  if (candidates.length) {
    candidates.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.order.compareDocumentPosition(right.order) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    ctx.dbg.push(`▶ 调度：候选项 ${candidates.length} 个 → ${candidates[0].kind}/${candidates[0].sectionType || '散字段'}`
      + `（${notes.join('；')}）`);
    return candidates[0];
  }
  if (notes.length) ctx.dbg.push(`▶ 调度：无候选项（${notes.join('；')}）`);

  // 3 grow：该分区还有未消耗档案、但页面上已经没有空行 → 点一次「添加」
  for (const sectionType of ROW_SECTION_TYPES) {
    const state = ctx.sectionState.get(sectionType);
    if (!state || state.done) continue;
    if (!nextUnconsumedEntry(sectionType, ctx)) continue;
    if ((state.emptyGroups || 0) > 0) continue;
    if (state.addRounds >= MAX_ADD_ROUNDS_PER_SECTION) {
      state.done = true;
      continue;
    }
    // 页面上完全没有这个分区时不要硬点添加（避免在别的分区乱加）
    const anchorExists = ctx.anchors.some((anchor) => anchor.type === sectionType);
    const hasFields = fields.some((field) => field.sectionType === sectionType);
    if (!anchorExists && !hasFields) continue;
    return { kind: 'grow', sectionType };
  }
  return null;
}

/** 执行「补一行」任务：点一次添加，确认行数 +1；具体填写留给下一轮扫描 */
async function runGrowTask(task, ctx) {
  await growOneRow(task.sectionType, ctx);
}

/** 执行「填一个散字段」任务 */
async function runBasicTask(task, ctx) {
  const { field } = task;
  let matchedKey = matchAutofillKey(field.blob, ctx.availableKeys, ctx.customRules)
    || relaxedMatchAutofillKey(field.blob, ctx.availableKeys);
  if (!matchedKey) {
    // 判定完了就永久跳过：不重复扫、不影响后续字段；同时计作一次「有效推进」，
    // 否则页面上大量「档案里没有对应项」的字段会把主循环的守卫耗尽而提前结束。
    ctx.done.add(field.el);
    ctx.unmatched.push(field);
    ctx.progressMark += 1;
    chaoDebug.skip(`「${field.blob}」`, '没有任何档案字段与它对应');
    return;
  }
  if (matchedKey === 'idNumber') {
    matchedKey = resolveIdKey(field, ctx);
    if (!matchedKey) {
      ctx.done.add(field.el);
      ctx.dbg.push(debugLine('◌', field.blob, '（证件下拉不写号码，已跳过）'));
      return;
    }
  }
  const valueItem = ctx.values.find((item) => item.key === matchedKey);
  if (!valueItem) {
    ctx.done.add(field.el);
    ctx.unmatched.push(field);
    ctx.progressMark += 1;
    return;
  }
  const result = await writeField(field, valueItem.value);
  if (result.ok) {
    field.el.classList.add(AUTOFILL_FILL_CLASS);
    ctx.done.add(field.el);
    ctx.filledCount += 1;
    ctx.progressMark += 1;
    ctx.dbg.push(debugLine('✓', field.blob, ` → ${valueItem.label}${isOptionControl(field) ? '（点选）' : ''}`));
  } else {
    const tried = (ctx.attempts.get(field.el) || 0) + 1;
    ctx.attempts.set(field.el, tried);
    // 试满上限仍写不进去才彻底跳过，避免同一格反复霸占轮次
    if (tried >= MAX_FIELD_RETRY) ctx.done.add(field.el);
    ctx.missed.push({ label: field.blob, reason: `${valueItem.label}：${result.reason}` });
    ctx.dbg.push(debugLine('✗', field.blob, ` → ${valueItem.label}（${result.reason}）`));
  }
}

/** 证件号码旁的下拉应写「证件类型」；长数字禁止进点选控件 */
function resolveIdKey(field, ctx) {
  const hasIdType = ctx.availableKeys.has('idType');
  if (isOptionControl(field)) return hasIdType ? 'idType' : null;
  try {
    const rect = field.el.getBoundingClientRect();
    const siblings = field.el.parentElement
      ? [...field.el.parentElement.querySelectorAll('input, [role="combobox"]')]
      : [];
    if (rect.width > 0 && rect.width < 140 && siblings.length >= 2) {
      return hasIdType ? 'idType' : null;
    }
  } catch {
    /* 量测失败按原 key */
  }
  return 'idNumber';
}

/** 执行「填一行」任务 */
async function runRowTask(task, ctx) {
  const { sectionType, group, entry } = task;
  const state = ctx.sectionState.get(sectionType);

  // 先看这一行里有没有「档案里确实有值」的字段。
  // 没有的话（例如档案这条没填分数、没填描述）要立刻收尾并标记完成，
  // 否则这些空格会永远留在候选里，导致反复重试、卡住后面的行。
  const writable = group.filter((item) => Boolean(rowValue(entry.data, item.sub)));
  if (!writable.length) {
    group.forEach((item) => ctx.done.add(item.field.el));
    if (typeof task.cursorIndex === 'number') {
      ctx.consumed.add(rowSignature(sectionType, entry));
      state.cursor = Math.max(state.cursor, task.cursorIndex + 1);
    }
    ctx.dbg.push(`○ [${sectionType}] ${escapeHtml(truncate(rowDisplayName(entry, sectionType), 18))}：`
      + '档案里这一行没有可写内容，已跳过');
    return;
  }

  const record = task.record || rememberRow(sectionType, group, entry, ctx);
  ctx.dbg.push(`   → 行字段 [${group.map((item) => `${item.sub}${item.part ? `.${item.part}` : ''}`).join(' ')}]`
    + ` 可写 ${writable.length} 记录容器 ${record.container ? truncate(record.container.className || record.container.tagName, 12) : '无'}`);
  ctx.progress.update(`✍ [${sectionType}] 填写第 ${state.cursor + 1} 段：`
    + `${truncate(rowDisplayName(entry, sectionType), 18)}`);
  const result = await fillRowGroup(group, entry, sectionType, ctx);
  ctx.filledCount += result.written;
  record.attempts += 1;
  // 收尾：档案里这一行本来就没有数据的空格，当场标记完成。
  // 否则它们会在下一轮被重新扫到、并和下一行的字段并成一组，把后面所有条目整体错位。
  group.forEach((item) => {
    if (!rowValue(entry.data, item.sub)) ctx.done.add(item.field.el);
  });

  if (result.ok) {
    ctx.consumed.add(rowSignature(sectionType, entry));
    if (typeof task.cursorIndex === 'number') state.cursor = Math.max(state.cursor, task.cursorIndex + 1);
    ctx.dbg.push(`✓ [${sectionType}] 已填：${escapeHtml(truncate(rowDisplayName(entry, sectionType), 20))}`
      + `（写入 ${result.written} 项）`);
    chaoDebug.ok(`[${sectionType}] 行填写完成`, {
      档案: rowDisplayName(entry, sectionType),
      写入项数: result.written,
      锚点已写: result.anchorWritten,
      尝试次数: record.attempts,
    });
  } else {
    // 失败不消耗档案：下一轮优先用同一条重试；连续失败超限才跳过该条
    ctx.dbg.push(`✗ [${sectionType}] 未填：${escapeHtml(truncate(rowDisplayName(entry, sectionType), 20))}`
      + `（${result.reason || '该行无可写字段'}，第 ${record.attempts} 次尝试）`);
    chaoDebug.fail(`[${sectionType}] 行填写失败`, {
      档案: rowDisplayName(entry, sectionType),
      尝试次数: record.attempts,
      原因: result.reason || '该行无可写字段',
    });
    if (record.attempts >= MAX_ROW_RETRY) {
      const signature = rowSignature(sectionType, entry);
      state.skipped.add(signature);
      if (typeof task.cursorIndex === 'number') state.cursor = Math.max(state.cursor, task.cursorIndex + 1);
      ctx.missed.push({
        label: rowDisplayName(entry, sectionType),
        reason: `「${sectionType}」重试 ${record.attempts} 次仍写不进（${result.reason || '该行无可写字段'}）`,
      });
      chaoDebug.skip(`[${sectionType}] 放弃该条`, `已重试 ${record.attempts} 次`);
    }
  }
  await sleep(200);
}

/* ============================ 阶段 H：核对与入口 ============================ */

/** 最终核对：写入后被页面清空的，降级为漏填 */
function verifyFilled(ctx) {
  let downgraded = 0;
  [...document.querySelectorAll(`.${AUTOFILL_FILL_CLASS}`)].forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (classifyControl(el) === CONTROL.optionWidget) return;
    const value = readControlText(el);
    if (value) return;
    el.classList.remove(AUTOFILL_FILL_CLASS);
    el.classList.add(AUTOFILL_MISS_CLASS);
    ctx.missed.push({ label: fieldLabelBlob(el), reason: '写入后被页面清空' });
    downgraded += 1;
  });
  if (downgraded) {
    ctx.dbg.push(`🧪 核对发现 ${downgraded} 项写入后被清空，已标记为漏填`);
    chaoDebug.fail('核对发现写入后被清空', { 数量: downgraded });
  }
}

/**
 * 对外入口：先补齐行数，再一次一个空按文档序写入，每格回读校验。
 */
export async function runChaoRuleAutofill(editable: ChaoEditable): Promise<{
  filled: number;
  skipped: number;
  misses: FillMiss[];
  debugLines: string[];
}> {
  ensureHighlightStyles();
  clearAutofillHighlights();
  resetLabelCache();

  const values = buildAutofillValues(editable);
  const entries = buildRowEntries(editable);
  const progress = toastProgress('⏳ 正在扫描页面结构…');

  const ctx = {
    values,
    entries,
    availableKeys: new Set(values.map((item) => item.key)),
    customRules: (editable?.customFields || [])
      .map((customField, index) => ({
        key: `custom_${index}`,
        words: [String(customField?.title || '').trim().toLowerCase()],
      }))
      .filter((rule) => rule.words[0]),
    anchors: [],
    sectionState: new Map(),
    addButtonCache: new Map(),
    /** 分区判定缓存：本轮的字段→分区结果，避免同一元素被反复爬祖先（纯等价缓存） */
    sectionCache: new Map(),
    /** 本轮已成功写入的控件 */
    done: new Set(),
    /** 每个控件的失败次数 */
    attempts: new Map(),
    consumed: new Set(),
    rowRecords: [],
    rowRecordByAnchor: new Map(),
    missed: [],
    unmatched: [],
    skipCounts: new Map(),
    filledCount: 0,
    progressMark: 0,
    noProgressRounds: 0,
    dbg: [],
    progress,
  };

  if (!values.length && !ROW_SECTION_TYPES.some((sectionType) => (entries[sectionType] || []).length > 0)) {
    progress.done('档案里没有可写入的内容');
    return {
      filled: 0,
      skipped: 0,
      misses: [{ label: '档案', reason: '档案里没有可写入的内容' }],
      debugLines: ['档案里没有可写入的内容'],
    };
  }

  chaoDebug.stage('扫描页面结构');
  ctx.anchors = buildSectionAnchors();
  ctx.dbg.push(`⚓ 分区锚点：${ctx.anchors
    .map((anchor) => `${anchor.type}(${anchor.root ? truncate(anchor.root.className || anchor.root.tagName, 16) : '无根'})`)
    .join(' | ') || '（无）'}`);
  const allFields = scanEmptyFields(ctx);
  chaoDebug.table('分区锚点', ctx.anchors.map((anchor, index) => ({
    序号: index + 1,
    分区: anchor.type,
    标题: truncate(anchor.el.textContent, 20),
    找到根容器: Boolean(anchor.root),
  })));
  chaoDebug.fieldTable('待填空清单', allFields.map((field, index) => ({
    序号: index + 1,
    标签: truncate(field.blob, 28),
    控件: field.control,
    分区: field.sectionType || '（无法判定）',
  })));
  chaoDebug.stageEnd(`共 ${allFields.length} 个待填空`);

  if (!allFields.length) {
    progress.done('当前页面没有识别到可填写的空');
    return {
      filled: 0,
      skipped: 0,
      misses: [{ label: '页面', reason: '当前页面没有识别到可填写的空' }],
      debugLines: ['当前页面没有识别到可填写的空'],
    };
  }

  ctx.dbg.push(`🔎 扫描到 ${allFields.length} 个待填空；页面分区：${
    ctx.anchors.length ? ctx.anchors.map((anchor) => anchor.type).join(' / ') : '未发现分区标题（走文本推断）'
  }`);
  const entrySummary = ROW_SECTION_TYPES
    .map((sectionType) => ({ sectionType, count: (entries[sectionType] || []).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.sectionType}×${item.count}`)
    .join('，');
  ctx.dbg.push(`📚 档案条目：${entrySummary || '无行式条目（只有基础信息）'}`);
  chaoDebug.info('档案条目数', entrySummary || '无行式条目');

  // 初始化分区状态：游标跳过站点已填好的行
  ROW_SECTION_TYPES.forEach((sectionType) => {
    ctx.sectionState.set(sectionType, {
      cursor: 0,
      skipped: new Set(),
      addRounds: 0,
      addStall: 0,
      emptyGroups: 0,
      done: (entries[sectionType] || []).length === 0,
    });
  });
  ROW_SECTION_TYPES.forEach((sectionType) => {
    const siteRows = countSitePrefilledRows(sectionType, ctx);
    const state = ctx.sectionState.get(sectionType);
    if (siteRows) state.cursor = Math.min(siteRows, (entries[sectionType] || []).length);
  });

  // 阶段一：只做「行数体检 + 诊断」（不再批量补行；补行改由主循环按需一条一条加）
  ROW_SECTION_TYPES.forEach((sectionType) => inspectSectionRows(sectionType, ctx));

  // 阶段一之二：基本信息区的「年/月」对（如「毕业时间 年/月」）。
  // 这些格子标签只有「年」「月」，常规规则匹配不到，必须单独处理。
  progress.update('📅 正在填写基本信息区的时间…');
  const basicDateFilled = await fillBasicDatePairs(scanEmptyFields(ctx), ctx);
  if (basicDateFilled) ctx.filledCount += basicDateFilled;

  // 阶段二：一个空一个空写入。补行是按需的：某个分区填不出空行了，才点一次「添加」，
  // 因此整体节奏就是「加一条 → 扫一次 → 填一条 → 再核对」。
  chaoDebug.stage('逐格写入');
  let lastProgress = -1;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    // DOM 可能已被上一轮改写（新增行、联动控件），分区缓存每轮作废一次
    ctx.sectionCache.clear();
    const fields = scanEmptyFields(ctx);
    const task = pickNextTask(ctx, fields);
    if (!task) {
      chaoDebug.info('没有更多可处理的任务，结束循环', { 轮次: step });
      break;
    }
    chaoDebug.op(`任务 ${step + 1}: ${task.kind}`, {
      分区: task.sectionType || '（散字段）',
      字段数: fields.length,
    });
    if (task.kind === 'row') await runRowTask(task, ctx);
    else if (task.kind === 'grow') await runGrowTask(task, ctx);
    else await runBasicTask(task, ctx);

    if (ctx.progressMark === lastProgress) {
      ctx.noProgressRounds += 1;
      if (ctx.noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
        ctx.dbg.push(`⚠ 连续 ${ctx.noProgressRounds} 轮没有任何写入，提前结束`);
        chaoDebug.fail('连续多轮无进展，提前结束', { 轮次: ctx.noProgressRounds });
        break;
      }
    } else {
      ctx.noProgressRounds = 0;
      lastProgress = ctx.progressMark;
    }
  }
  chaoDebug.stageEnd(`写入 ${ctx.filledCount} 项`);

  // 阶段三：补漏。把「还空着的散字段」再走一遍，回档案取值补上（不覆盖已填内容）
  chaoDebug.stage('补漏复核');
  progress.update('🔁 正在复核没写上的格子…');
  ctx.sectionCache.clear();
  const secondPassFilled = await runSecondPass(ctx);
  ctx.filledCount += secondPassFilled;
  chaoDebug.stageEnd(`补漏写入 ${secondPassFilled} 项`);

  // 阶段四：核对
  chaoDebug.stage('回读核对');
  progress.update('🧪 正在回读核对…');
  await sleep(300);
  ctx.sectionCache.clear();
  verifyFilled(ctx);
  chaoDebug.stageEnd();

  // 汇总：未识别 + 行分区里「匹配不上」的字段 + 没地方填的档案条目
  ctx.unmatched.forEach((field) => {
    ctx.missed.push({ label: field.blob, reason: '没有任何档案字段与它对应（宁缺勿错）' });
  });
  // 行分区里认不出的空（例如「学校所在地」「部门」这类没有对应规则的格子）也要报出来，
  // 否则用户只看到「必填项未填写」，却不知道具体是哪一格漏了。
  ROW_SECTION_TYPES.forEach((sectionType) => {
    const sectionFields = scanEmptyFields(ctx).filter((field) => field.sectionType === sectionType);
    if (!sectionFields.length) return;
    const { leftovers } = resolveSectionEntries(sectionType, sectionFields);
    leftovers.forEach((field) => {
      ctx.missed.push({
        label: field.blob,
        reason: `「${sectionType}」里没有匹配到对应档案字段（宁缺勿错，已留空待手填）`,
      });
    });
  });
  ROW_SECTION_TYPES.forEach((sectionType) => {
    const pool = ctx.entries[sectionType] || [];
    const state = ctx.sectionState.get(sectionType);
    if (!state) return;
    pool.forEach((entry, index) => {
      const signature = rowSignature(sectionType, entry);
      if (ctx.consumed.has(signature)) return;
      if (index < state.cursor) return;
      ctx.missed.push({
        label: rowDisplayName(entry, sectionType),
        reason: `「${sectionType}」这一段没有落到页面（可能缺「添加」按钮或页面已达行数上限）`,
      });
    });
  });
  if (ctx.skipCounts.size) {
    ctx.dbg.push(`—— 未参与填写的控件：${
      [...ctx.skipCounts.entries()].map(([reason, count]) => `${reason}×${count}`).join('，')
    } ——`);
  }
  const deduped = [];
  const seen = new Set();
  ctx.missed.forEach((miss) => {
    const key = `${miss.label}||${miss.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(miss);
  });

  const totalFilled = ctx.filledCount;
  ctx.dbg.push(`✅ 合计写入 ${totalFilled} 项，漏填/未识别 ${deduped.length} 项`);
  chaoDebug.table('最终汇总', ROW_SECTION_TYPES.map((sectionType) => ({
    分区: sectionType,
    档案条数: (ctx.entries[sectionType] || []).length,
    已落地: [...ctx.consumed].filter((signature) => signature.startsWith(`${sectionType}|`)).length,
    添加次数: ctx.sectionState.get(sectionType)?.addRounds ?? 0,
  })));
  progress.done(deduped.length
    ? `✅ 填写结束：写入 ${totalFilled} 项，${deduped.length} 项待手动核对`
    : `✅ 全部 ${totalFilled} 项已写入，请检查后提交`);

  return {
    filled: totalFilled,
    skipped: [...ctx.skipCounts.values()].reduce((sum, count) => sum + count, 0),
    misses: deduped.map((miss) => ({
      label: truncate(String(miss.label || '未识别字段').replace(/\s+/g, ' '), 40),
      reason: miss.reason,
    })),
    debugLines: ctx.dbg,
  };
}
