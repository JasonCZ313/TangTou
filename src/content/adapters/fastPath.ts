/**
 * 本地站点快路径：按适配器声明式字段表定位控件，供 applyFillPlan 入口分支使用。
 * 命中且选择器有效 → 快路径；未命中站 / 无配置 / 选择器落空 → 回落慢路径（不删慢路径）。
 */
import type { SiteAdapter, SiteFastPathFieldRule, SiteFastPathConfig } from './types';
import { getActiveSiteAdapter } from './registry';

/** 本轮写入实际走的路径，写入结果与 trace 可观测 */
export type FillPathMode = 'fast' | 'slow' | 'hybrid';

/**
 * 角色键与页面标签的匹配规则。
 * 只认声明式关键词，不执行任何站点脚本。
 */
const ROLE_LABEL_PATTERNS: Record<string, RegExp> = {
  fullName: /姓名|名字/,
  phone: /手机|电话|联系方式/,
  email: /邮箱|邮件|E-?mail/i,
  school: /学校/,
  degree: /学历/,
  major: /专业/,
  startDate: /开始时间|入学|起止时间|开始/,
  endDate: /结束时间|毕业|结束|至今/,
  company: /公司|单位|企业/,
  title: /职位|岗位|职务/,
};

/**
 * 当前页若带可用快路径配置则返回；否则 null（整轮慢路径）。
 */
export function resolveActiveFastPathConfig(
  adapter: SiteAdapter | null = getActiveSiteAdapter(),
): { adapter: SiteAdapter; fastPath: SiteFastPathConfig } | null {
  if (!adapter?.fastPath?.enabled) {
    return null;
  }
  if (!Array.isArray(adapter.fastPath.fields) || adapter.fastPath.fields.length === 0) {
    return null;
  }
  return { adapter, fastPath: adapter.fastPath };
}

/**
 * 判断标签文案是否对应某个角色键（含起止左右侧）。
 */
export function labelMatchesFastPathRole(
  rawLabel: string,
  roleKey: string,
  rangeSide?: 'start' | 'end' | null,
): boolean {
  const label = String(rawLabel || '').replace(/\s+/g, '');
  if (!label) {
    return false;
  }
  if (roleKey === 'startDate') {
    if (rangeSide === 'end') {
      return false;
    }
    if (rangeSide === 'start') {
      return /时间|日期|起止|开始/.test(label);
    }
    return ROLE_LABEL_PATTERNS.startDate.test(label) && !/^结束/.test(label);
  }
  if (roleKey === 'endDate') {
    if (rangeSide === 'start') {
      return false;
    }
    if (rangeSide === 'end') {
      return /时间|日期|起止|结束/.test(label);
    }
    return ROLE_LABEL_PATTERNS.endDate.test(label);
  }
  const pattern = ROLE_LABEL_PATTERNS[roleKey];
  if (!pattern) {
    return label.includes(roleKey);
  }
  return pattern.test(label);
}

/**
 * 按选择器取第一个仍挂在文档上的元素。
 */
export function queryFastPathElement(selector: string): HTMLElement | null {
  const trimmed = String(selector || '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    const node = document.querySelector(trimmed);
    if (node instanceof HTMLElement && node.isConnected) {
      return node;
    }
  } catch {
    /* 非法选择器：视为未命中，回落慢路径 */
  }
  return null;
}

/**
 * 在快路径字段表里，按标签（及区间侧）找第一条仍能定位到 DOM 的规则。
 * 已用过的选择器传入 usedSelectors，避免同行两个起止抢同一个节点。
 * 兼容旧调用；新写入入口请优先用 matchFastPathForPlanField（可回落扫描 id）。
 */
export function matchFastPathRuleForLabel(
  fields: SiteFastPathFieldRule[],
  rawLabel: string,
  rangeSide: 'start' | 'end' | null | undefined,
  usedSelectors: Set<string>,
): { rule: SiteFastPathFieldRule; element: HTMLElement } | null {
  return matchFastPathForPlanField(fields, rawLabel, rangeSide, usedSelectors, null);
}

/**
 * 按计划项匹配快路径：先 CSS 选择器，落空则回落本格扫描标记 `[data-raf-id]`。
 * 真页通常没有 data-tt-role；扫描信号才是稳定落点，避免「名义快路径、实际全慢」。
 * @param fieldId 扫描期写入的 data-raf-id；无则只靠选择器
 * @returns source=selector|scan 便于 trace；未命中返回 null（该格慢路径）
 */
export function matchFastPathForPlanField(
  fields: SiteFastPathFieldRule[],
  rawLabel: string,
  rangeSide: 'start' | 'end' | null | undefined,
  usedSelectors: Set<string>,
  fieldId: string | null,
): { rule: SiteFastPathFieldRule; element: HTMLElement; source: 'selector' | 'scan' } | null {
  for (const rule of fields) {
    if (usedSelectors.has(rule.selector)) {
      continue;
    }
    if (!labelMatchesFastPathRole(rawLabel, rule.roleKey, rangeSide)) {
      continue;
    }
    const bySelector = queryFastPathElement(rule.selector);
    if (bySelector) {
      stampFastPathRole(bySelector, rule.roleKey);
      return { rule, element: bySelector, source: 'selector' };
    }
    // 选择器对真页落空：用本计划格的扫描 id 绑定，仍算快路径（角色已匹配）
    if (fieldId) {
      const byScan = queryScannedFieldElement(fieldId);
      if (byScan && !usedSelectors.has(`scan:${fieldId}`)) {
        stampFastPathRole(byScan, rule.roleKey);
        return { rule, element: byScan, source: 'scan' };
      }
    }
  }
  return null;
}

/**
 * 按扫描期 data-raf-id 取仍挂在文档上的控件。
 */
function queryScannedFieldElement(fieldId: string): HTMLElement | null {
  const trimmed = String(fieldId || '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    const node = document.querySelector(`[data-raf-id="${CSS.escape(trimmed)}"]`);
    if (node instanceof HTMLElement && node.isConnected) {
      return node;
    }
  } catch {
    /* 非法 id：视为未命中 */
  }
  return null;
}

/**
 * 命中快路径后打上角色标记，便于同轮去重与验收观察（不依赖页面自带 data-tt-role）。
 */
function stampFastPathRole(element: HTMLElement, roleKey: string): void {
  if (!element.getAttribute('data-tt-role') && roleKey) {
    element.setAttribute('data-tt-role', roleKey);
  }
}

/**
 * 汇总本轮路径模式：全快 / 全慢 / 部分快部分慢。
 */
export function summarizeFillPathMode(
  fastHits: number,
  slowHits: number,
): FillPathMode {
  if (fastHits > 0 && slowHits > 0) {
    return 'hybrid';
  }
  if (fastHits > 0) {
    return 'fast';
  }
  return 'slow';
}
