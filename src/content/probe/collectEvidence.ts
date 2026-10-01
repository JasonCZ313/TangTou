/**
 * P7：收集页内证据（DOM 摘要）。
 * P7a 只读；P7c 可选预算内探测点击以暴露下拉选项（永不提交）。
 */
import { resolveSiteAdapter } from '../adapters/registry';
import { adapterIsDangerSaveLabel } from '../adapters/types';
import {
  buildProbePathNotice,
  matchMegaCorpSample,
} from '../../shared/playbook/megaCorpCatalog';
import type {
  EvidenceControlHint,
  EvidenceControlKind,
  EvidencePack,
  EvidenceSectionHint,
  ProbeClickRecord,
} from '../../shared/playbook/types';
import { runSafeProbeClicks } from './safeClick';

/** 可见文本抽样上限，避免消息过大 */
const VISIBLE_TEXT_SAMPLE_LIMIT = 2_400;
/** 控件摘要条数上限 */
const CONTROL_HINT_LIMIT = 80;
/** 分区摘要条数上限 */
const SECTION_HINT_LIMIT = 24;

/**
 * 判断元素是否大致可见。
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
 * 压缩空白并截断。
 */
function compactText(raw: string, maxLength: number): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength)}…`;
}

/**
 * 从控件邻近文案推断标签。
 */
function inferControlLabel(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) {
    return compactText(aria, 40);
  }
  if (element.id) {
    try {
      const forLabel = document.querySelector(
        `label[for="${CSS.escape(element.id)}"]`,
      );
      const forText = forLabel?.textContent?.trim();
      if (forText) {
        return compactText(forText, 40);
      }
    } catch {
      /* 非法 id */
    }
  }
  const rafLabel = element.getAttribute('data-raf-label')?.trim();
  if (rafLabel) {
    return compactText(rafLabel, 40);
  }
  const placeholder =
    element.getAttribute('placeholder')?.trim() ||
    (element instanceof HTMLInputElement ? element.placeholder : '');
  if (placeholder) {
    return compactText(placeholder, 40);
  }
  const nameAttr = element.getAttribute('name')?.trim();
  if (nameAttr) {
    return compactText(nameAttr, 40);
  }
  return compactText(element.textContent ?? '', 40) || '未命名控件';
}

/**
 * 粗分控件类型；年份/月份靠标签启发式。
 */
function classifyControlKind(element: HTMLElement): EvidenceControlKind {
  const labelBlob = `${inferControlLabel(element)} ${element.getAttribute('name') ?? ''}`;
  if (/年/.test(labelBlob) && !/年级|年限|年龄/.test(labelBlob)) {
    return 'year';
  }
  if (/月/.test(labelBlob) && !/月亮/.test(labelBlob)) {
    return 'month';
  }
  if (element instanceof HTMLSelectElement) {
    return 'select';
  }
  if (element instanceof HTMLTextAreaElement) {
    return 'text';
  }
  if (element instanceof HTMLInputElement) {
    const inputType = (element.type || 'text').toLowerCase();
    if (inputType === 'checkbox' || inputType === 'radio') {
      return 'checkbox';
    }
    if (inputType === 'file') {
      return 'file';
    }
    if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') {
      return 'button';
    }
    return 'text';
  }
  if (element.getAttribute('role') === 'combobox' || element.matches('.ant-select, .el-select')) {
    return 'combobox';
  }
  if (element.isContentEditable) {
    return 'text';
  }
  if (
    element instanceof HTMLButtonElement ||
    element.getAttribute('role') === 'button'
  ) {
    return 'button';
  }
  return 'unknown';
}

/**
 * 采集分区标题与附近「添加」按钮。
 */
function collectSectionHints(): EvidenceSectionHint[] {
  const headings = [
    ...document.querySelectorAll('h1,h2,h3,h4,[class*="title" i],[class*="section" i]'),
  ].filter((node): node is HTMLElement => isRoughlyVisible(node));

  const sections: EvidenceSectionHint[] = [];
  for (const heading of headings) {
    if (sections.length >= SECTION_HINT_LIMIT) {
      break;
    }
    const title = compactText(heading.textContent ?? '', 48);
    if (!title || title.length < 2) {
      continue;
    }
    let addButtonText: string | undefined;
    let host: HTMLElement | null = heading.parentElement;
    for (let depth = 0; host && depth < 4; depth += 1, host = host.parentElement) {
      const buttons = [
        ...host.querySelectorAll('button, a, [role="button"]'),
      ];
      for (const button of buttons) {
        if (!(button instanceof HTMLElement) || !isRoughlyVisible(button)) {
          continue;
        }
        const buttonText = compactText(button.textContent ?? '', 20);
        if (/添加|新增|增加|\+/.test(buttonText) && buttonText.length <= 12) {
          addButtonText = buttonText;
          break;
        }
      }
      if (addButtonText) {
        break;
      }
    }
    sections.push({
      title,
      addButtonText,
    });
  }
  return sections;
}

/**
 * 采集可交互控件摘要。
 */
function collectControlHints(): EvidenceControlHint[] {
  const nodes = [
    ...document.querySelectorAll(
      'input, textarea, select, [contenteditable="true"], [role="combobox"], .ant-select, .el-select, button, [role="button"]',
    ),
  ].filter((node): node is HTMLElement => {
    if (!isRoughlyVisible(node)) {
      return false;
    }
    if (node.closest('#tangtou-page-overlay, [data-tangtou-ui]')) {
      return false;
    }
    return true;
  });

  const hints: EvidenceControlHint[] = [];
  for (const element of nodes) {
    if (hints.length >= CONTROL_HINT_LIMIT) {
      break;
    }
    const kind = classifyControlKind(element);
    const label = inferControlLabel(element);
    const fieldId = element.getAttribute('data-raf-id')?.trim() || undefined;
    const required =
      element.hasAttribute('required') ||
      element.getAttribute('aria-required') === 'true';

    let optionsSample: string[] | undefined;
    if (element instanceof HTMLSelectElement) {
      optionsSample = [...element.options]
        .map((option) => option.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 12);
    }

    hints.push({
      kind,
      label,
      fieldId,
      optionsSample,
      required: required || undefined,
    });
  }
  return hints;
}

/**
 * 把探测点击发现的选项合并进同标签控件摘要。
 */
function mergeProbeOptionsIntoControls(
  controls: EvidenceControlHint[],
  probeClicks: ProbeClickRecord[],
): EvidenceControlHint[] {
  if (probeClicks.length === 0) {
    return controls;
  }
  return controls.map((control) => {
    const matched = probeClicks.find(
      (record) =>
        record.ok &&
        record.discoveredOptions &&
        record.discoveredOptions.length > 0 &&
        (control.label.includes(record.label.slice(0, 6)) ||
          record.label.includes(control.label.slice(0, 6))),
    );
    if (!matched?.discoveredOptions) {
      return control;
    }
    const merged = [
      ...(control.optionsSample ?? []),
      ...matched.discoveredOptions,
    ];
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const option of merged) {
      if (seen.has(option)) {
        continue;
      }
      seen.add(option);
      unique.push(option);
      if (unique.length >= 24) {
        break;
      }
    }
    return {
      ...control,
      optionsSample: unique,
    };
  });
}

/**
 * 收集危险「提交/投递」类按钮文案。
 */
function collectDangerButtonLabels(): string[] {
  const adapter = resolveSiteAdapter(location.hostname);
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const node of document.querySelectorAll('button, a, [role="button"], input[type="submit"]')) {
    if (!(node instanceof HTMLElement) || !isRoughlyVisible(node)) {
      continue;
    }
    const text =
      node instanceof HTMLInputElement
        ? (node.value || node.getAttribute('aria-label') || '').trim()
        : compactText(node.textContent ?? '', 24);
    if (!text) {
      continue;
    }
    if (adapterIsDangerSaveLabel(adapter, text) || /投递|提交申请|立即申请/.test(text)) {
      if (!seen.has(text)) {
        seen.add(text);
        labels.push(text);
      }
    }
  }
  return labels.slice(0, 20);
}

/**
 * 页面可见文本抽样（去掉 script/style）。
 */
function collectVisibleTextSample(): string {
  const clone = document.body?.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return '';
  }
  clone
    .querySelectorAll('script, style, noscript, #tangtou-page-overlay, [data-tangtou-ui]')
    .forEach((node) => node.remove());
  return compactText(clone.innerText || clone.textContent || '', VISIBLE_TEXT_SAMPLE_LIMIT);
}

/**
 * 组装 EvidencePack（不含 OCR；探测可选）。
 */
async function buildEvidencePack(options?: {
  enableProbeClicks?: boolean;
  onProgress?: (message: string) => void;
}): Promise<EvidencePack> {
  const adapter = resolveSiteAdapter(location.hostname);
  const notices: string[] = [];
  const enableProbeClicks = options?.enableProbeClicks === true;

  let probeClicks: ProbeClickRecord[] | undefined;
  if (enableProbeClicks) {
    options?.onProgress?.('受控探测点击（预算内，不提交）…');
    const probeResult = await runSafeProbeClicks({
      onProgress: options?.onProgress,
    });
    probeClicks = probeResult.records;
    notices.push(
      `受控探测：点击 ${probeResult.clickCount} 次` +
        (probeResult.timedOut ? '（已触达时间预算）' : '') +
        '；未点提交/添加行。',
    );
  }

  let controls = collectControlHints();
  if (probeClicks && probeClicks.length > 0) {
    controls = mergeProbeOptionsIntoControls(controls, probeClicks);
  }
  const sections = collectSectionHints();
  const dangerButtons = collectDangerButtonLabels();
  const megaSample = matchMegaCorpSample(location.hostname);

  if (controls.length === 0) {
    notices.push('未发现可见输入控件，页面可能尚未加载完或在 iframe 内。');
  }
  if (dangerButtons.length > 0) {
    notices.push(
      `发现疑似提交类按钮 ${dangerButtons.length} 个：探活与填写均不会点击它们。`,
    );
  }
  notices.push(
    ...buildProbePathNotice({
      hostname: location.hostname,
      siteAdapterName: adapter?.name,
    }),
  );

  return {
    collectedAt: new Date().toISOString(),
    pageUrl: location.href,
    pageTitle: document.title || '',
    hostname: location.hostname,
    siteAdapterId: adapter?.id,
    siteAdapterName: adapter?.name,
    visibleTextSample: collectVisibleTextSample(),
    sections,
    controls,
    dangerButtons,
    notices,
    probeClickEnabled: enableProbeClicks,
    probeClicks,
    megaCorpSampleId: megaSample?.id,
  };
}

/**
 * 主入口：生成当前页 EvidencePack（P7c 支持探测点击）。
 */
export async function collectPageEvidence(options?: {
  enableProbeClicks?: boolean;
  onProgress?: (message: string) => void;
}): Promise<EvidencePack> {
  return buildEvidencePack(options);
}
