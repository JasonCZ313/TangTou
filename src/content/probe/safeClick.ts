/**
 * P7c：受控探测点击（打开选择器/展开面板以读选项）。
 * 有次数与超时预算；永不点提交/投递/保存类危险按钮；不点「添加行」。
 */
import { getActiveSiteAdapter } from '../adapters/registry';
import { adapterIsDangerSaveLabel } from '../adapters/types';
import type { ProbeClickRecord } from '../../shared/playbook/types';

/** 探测点击预算：防止死循环与长时间打扰页面 */
export const PROBE_CLICK_BUDGET = {
  /** 单次探活最多点击次数 */
  maxClicks: 5,
  /** 整段探测最长毫秒 */
  maxMs: 8_000,
  /** 点击后等待面板打开的毫秒 */
  settleMs: 320,
} as const;

/**
 * 短等待。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 元素是否大致可见。
 */
function isRoughlyVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number(style.opacity) === 0
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 压缩文案。
 */
function compactText(raw: string, maxLength: number): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength)}…`;
}

/**
 * 判断文案是否属于禁止探测点击的危险/提交类。
 */
export function isDangerProbeLabel(rawText: string): boolean {
  const adapter = getActiveSiteAdapter();
  const compact = rawText.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }
  if (adapterIsDangerSaveLabel(adapter, compact)) {
    return true;
  }
  return /投递|提交申请|立即申请|最终提交|确认投递|保存并提交|立即投递/.test(
    compact,
  );
}

/**
 * 「添加行」类按钮：探测阶段不点，避免改动表单结构。
 */
function isAddRowLabel(rawText: string): boolean {
  const compact = rawText.replace(/\s+/g, '');
  return /添加|新增|增加|\+/.test(compact) && compact.length <= 12;
}

/**
 * 读取节点展示文案。
 */
function nodeLabel(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) {
    return compactText(aria, 40);
  }
  if (element instanceof HTMLInputElement) {
    return compactText(element.value || element.placeholder || '', 40);
  }
  return compactText(element.textContent ?? '', 40) || '未命名';
}

/**
 * 当前是否已有打开的下拉/列表，避免重复点开。
 */
function hasOpenListNear(host: HTMLElement): boolean {
  const root = host.parentElement ?? host;
  const openList = root.querySelector(
    '[role="listbox"], .dropdown.open, .ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown',
  );
  return Boolean(openList && isRoughlyVisible(openList));
}

/**
 * 从页面收集当前可见的选项文案。
 */
function collectVisibleOptionTexts(): string[] {
  const options: string[] = [];
  const seen = new Set<string>();
  const nodes = document.querySelectorAll(
    '[role="option"], [role="listbox"] [role="option"], .dropdown.open > div, .ant-select-item-option-content, .el-select-dropdown__item',
  );
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !isRoughlyVisible(node)) {
      continue;
    }
    const text = compactText(node.textContent ?? '', 40);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    options.push(text);
    if (options.length >= 24) {
      break;
    }
  }
  return options;
}

/**
 * 尝试关闭刚打开的面板（Escape + 点空白），不点选项、不提交。
 */
async function tryCloseOpenPanels(): Promise<void> {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  await wait(80);
  for (const open of document.querySelectorAll('.dropdown.open')) {
    open.classList.remove('open');
  }
}

/**
 * 枚举可安全探测的点击目标：年份/月份/combobox/展开类，排除危险与添加。
 */
function listSafeProbeTargets(): Array<{
  element: HTMLElement;
  label: string;
  reason: string;
}> {
  const targets: Array<{ element: HTMLElement; label: string; reason: string }> =
    [];
  const seen = new WeakSet<HTMLElement>();

  const pickerNodes = [
    ...document.querySelectorAll(
      '[role="combobox"], .ant-select-selector, .el-select, .ant-like, .year-trigger, .month-trigger, [class*="picker" i]',
    ),
  ];
  for (const node of pickerNodes) {
    if (!(node instanceof HTMLElement) || !isRoughlyVisible(node)) {
      continue;
    }
    if (node.closest('#tangtou-page-overlay, [data-tangtou-ui]')) {
      continue;
    }
    if (seen.has(node)) {
      continue;
    }
    const label = nodeLabel(node);
    if (isDangerProbeLabel(label) || isAddRowLabel(label)) {
      continue;
    }
    if (hasOpenListNear(node)) {
      continue;
    }
    seen.add(node);
    const reason = /年/.test(label)
      ? '打开年份选择器读选项'
      : /月/.test(label)
        ? '打开月份选择器读选项'
        : '打开自定义下拉读选项';
    targets.push({ element: node, label, reason });
  }

  // 折叠/展开类：仅文案明确为展开，且非提交
  const expandNodes = [
    ...document.querySelectorAll('button, a, [role="button"], [aria-expanded="false"]'),
  ];
  for (const node of expandNodes) {
    if (!(node instanceof HTMLElement) || !isRoughlyVisible(node)) {
      continue;
    }
    if (node.closest('#tangtou-page-overlay, [data-tangtou-ui]')) {
      continue;
    }
    if (seen.has(node)) {
      continue;
    }
    const label = nodeLabel(node);
    if (!/展开|更多信息|完善资料/.test(label)) {
      continue;
    }
    if (isDangerProbeLabel(label) || isAddRowLabel(label)) {
      continue;
    }
    seen.add(node);
    targets.push({
      element: node,
      label,
      reason: '展开折叠区以暴露更多控件',
    });
  }

  return targets;
}

/**
 * 在预算内执行受控探测点击，收集新出现的选项；失败/危险一律跳过。
 */
export async function runSafeProbeClicks(options?: {
  maxClicks?: number;
  maxMs?: number;
  onProgress?: (message: string) => void;
}): Promise<{
  records: ProbeClickRecord[];
  clickCount: number;
  timedOut: boolean;
}> {
  const maxClicks = Math.max(
    0,
    Math.min(PROBE_CLICK_BUDGET.maxClicks, options?.maxClicks ?? PROBE_CLICK_BUDGET.maxClicks),
  );
  const maxMs = options?.maxMs ?? PROBE_CLICK_BUDGET.maxMs;
  const startedAt = Date.now();
  const records: ProbeClickRecord[] = [];
  let clickCount = 0;
  let timedOut = false;

  if (maxClicks === 0) {
    return { records, clickCount, timedOut };
  }

  const targets = listSafeProbeTargets().slice(0, maxClicks);
  for (const target of targets) {
    if (Date.now() - startedAt > maxMs) {
      timedOut = true;
      records.push({
        label: target.label,
        reason: target.reason,
        ok: false,
        skippedReason: '探测超时，后续目标已跳过',
      });
      break;
    }
    if (isDangerProbeLabel(target.label)) {
      records.push({
        label: target.label,
        reason: target.reason,
        ok: false,
        skippedReason: '命中提交/保存黑名单，未点击',
      });
      continue;
    }

    options?.onProgress?.(`探测点击：${target.label}`);
    try {
      target.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      target.element.focus({ preventScroll: true });
      target.element.click();
      clickCount += 1;
      await wait(PROBE_CLICK_BUDGET.settleMs);
      const discoveredOptions = collectVisibleOptionTexts();
      await tryCloseOpenPanels();
      records.push({
        label: target.label,
        reason: target.reason,
        ok: true,
        discoveredOptions:
          discoveredOptions.length > 0 ? discoveredOptions : undefined,
      });
    } catch (error: unknown) {
      records.push({
        label: target.label,
        reason: target.reason,
        ok: false,
        skippedReason:
          error instanceof Error ? error.message : '点击失败，已跳过',
      });
    }
  }

  if (Date.now() - startedAt > maxMs) {
    timedOut = true;
  }

  return { records, clickCount, timedOut };
}
