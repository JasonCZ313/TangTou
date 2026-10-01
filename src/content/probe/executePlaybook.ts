/**
 * P7b：按用户确认过的 Playbook 步骤逐步执行，每步回读；失败即停。
 * 永不点击提交/投递类按钮。
 */
import type { FillMiss } from '../../shared/types/fill';
import type { PlaybookStep } from '../../shared/playbook/types';
import { shouldFillStop } from '../fillAbort';
import { getActiveSiteAdapter } from '../adapters/registry';
import { adapterIsDangerSaveLabel } from '../adapters/types';
import { prepareFieldForWrite } from '../scanner/scanFields';
import {
  AUTOFILL_FILL_CLASS,
  AUTOFILL_MISS_CLASS,
  classifyControl,
  ensureHighlightStyles,
  fieldLabelBlob,
  isPageFieldVisible,
  writeField,
} from '../filler/chao/dom';
import { updatePageOverlay, hidePageOverlay } from '../ui/pageOverlay';

/** 单步执行结果 */
export interface PlaybookStepResult {
  stepId: string;
  ok: boolean;
  message: string;
}

/**
 * 短等待，给站点脚本反应时间。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 判断文案是否像危险提交。
 */
function isDangerLabel(rawText: string): boolean {
  const adapter = getActiveSiteAdapter();
  const compact = rawText.replace(/\s+/g, '');
  if (adapterIsDangerSaveLabel(adapter, compact)) {
    return true;
  }
  return /投递|提交申请|立即申请|最终提交|确认投递/.test(compact);
}

/**
 * 在可见按钮中找文案匹配且非危险的「添加」类按钮。
 */
function findSafeAddButton(hintText: string): HTMLElement | null {
  const needle = hintText.replace(/\s+/g, '');
  const candidates = [
    ...document.querySelectorAll('button, a, [role="button"]'),
  ].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) {
      return false;
    }
    if (node.closest('#tangtou-page-overlay, [data-tangtou-ui]')) {
      return false;
    }
    const text = (node.textContent ?? '').replace(/\s+/g, '');
    if (!text || isDangerLabel(text)) {
      return false;
    }
    if (needle && (text.includes(needle) || needle.includes(text))) {
      return /添加|新增|增加|\+/.test(text);
    }
    return /添加|新增|增加|\+/.test(text) && text.length <= 12;
  });
  return candidates[0] ?? null;
}

/**
 * 按 fieldId 或标签找可点的选择器宿主。
 */
function findPickerHost(step: PlaybookStep): HTMLElement | null {
  if (step.targetFieldId) {
    try {
      const byId = document.querySelector(
        `[data-raf-id="${CSS.escape(step.targetFieldId)}"]`,
      );
      if (byId instanceof HTMLElement && isPageFieldVisible(byId)) {
        return byId;
      }
    } catch {
      /* 非法 id */
    }
  }
  const labelHint = step.title.replace(/^[^：:]*[：:]/, '').trim() || step.title;
  const nodes = [
    ...document.querySelectorAll(
      '[role="combobox"], .ant-select, .el-select, select, .ant-like, [class*="year" i], [class*="month" i]',
    ),
  ];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !isPageFieldVisible(node)) {
      continue;
    }
    const blob = `${fieldLabelBlob(node)} ${node.textContent ?? ''}`;
    if (labelHint && blob.includes(labelHint.slice(0, 6))) {
      return node;
    }
  }
  return null;
}

/**
 * 执行单步：填写 / 点添加 / 打开选择器。
 */
async function executeOnePlaybookStep(
  step: PlaybookStep,
): Promise<PlaybookStepResult> {
  if (step.kind === 'fill_field' || step.kind === 'select_option') {
    const value = step.suggestedValue?.trim() ?? '';
    if (!step.targetFieldId || !value) {
      return {
        stepId: step.stepId,
        ok: false,
        message: '缺少 fieldId 或建议值，已跳过',
      };
    }
    const element = await prepareFieldForWrite(step.targetFieldId);
    if (!(element instanceof HTMLElement)) {
      return {
        stepId: step.stepId,
        ok: false,
        message: '页面上找不到目标控件',
      };
    }
    const writeResult = await writeField(
      {
        el: element,
        blob: fieldLabelBlob(element),
        control: classifyControl(element),
      },
      value,
    );
    if (writeResult.ok) {
      element.classList.add(AUTOFILL_FILL_CLASS);
      element.classList.remove(AUTOFILL_MISS_CLASS);
      return { stepId: step.stepId, ok: true, message: '写入并回读通过' };
    }
    element.classList.add(AUTOFILL_MISS_CLASS);
    return {
      stepId: step.stepId,
      ok: false,
      message: writeResult.reason || '写入失败',
    };
  }

  if (step.kind === 'click_add') {
    const hintMatch = step.detail.match(/「([^」]+)」/) ?? step.title.match(/「([^」]+)」/);
    const hintText = hintMatch?.[1] ?? '添加';
    if (isDangerLabel(hintText)) {
      return {
        stepId: step.stepId,
        ok: false,
        message: '目标文案命中提交黑名单，已拒绝点击',
      };
    }
    const button = findSafeAddButton(hintText);
    if (!button) {
      return {
        stepId: step.stepId,
        ok: false,
        message: `未找到安全的添加按钮（${hintText}）`,
      };
    }
    if (isDangerLabel(button.textContent ?? '')) {
      return {
        stepId: step.stepId,
        ok: false,
        message: '候选按钮为提交类，已拒绝',
      };
    }
    button.click();
    await wait(500);
    return { stepId: step.stepId, ok: true, message: `已点击「${(button.textContent ?? '').trim()}」` };
  }

  if (step.kind === 'open_picker') {
    const host = findPickerHost(step);
    if (!host) {
      return {
        stepId: step.stepId,
        ok: false,
        message: '未找到可打开的选择器',
      };
    }
    host.click();
    await wait(350);
    // 若有建议值，尝试点选项（仍禁止危险文案）
    const suggested = step.suggestedValue?.trim();
    if (suggested && !isDangerLabel(suggested)) {
      const options = [
        ...document.querySelectorAll(
          '[role="option"], .ant-select-item, .el-select-dropdown__item, .dropdown [data-value], .dropdown div',
        ),
      ];
      for (const option of options) {
        if (!(option instanceof HTMLElement) || !isPageFieldVisible(option)) {
          continue;
        }
        const text = (option.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text === suggested || text.includes(suggested)) {
          option.click();
          await wait(200);
          return {
            stepId: step.stepId,
            ok: true,
            message: `已打开并选择「${text}」`,
          };
        }
      }
    }
    return {
      stepId: step.stepId,
      ok: true,
      message: '已打开选择器（未匹配到建议选项，请人工点选）',
    };
  }

  return {
    stepId: step.stepId,
    ok: true,
    message: '本步无需执行',
  };
}

/**
 * 逐步执行已确认的探活写入步；任一步失败则停止后续。
 */
export async function executeApprovedPlaybookSteps(
  steps: PlaybookStep[],
): Promise<{
  completed: number;
  stopped: boolean;
  results: PlaybookStepResult[];
  misses: FillMiss[];
}> {
  ensureHighlightStyles();
  const results: PlaybookStepResult[] = [];
  const misses: FillMiss[] = [];
  let completed = 0;
  let stopped = false;

  const total = Math.max(steps.length, 1);
  for (let index = 0; index < steps.length; index += 1) {
    if (shouldFillStop()) {
      stopped = true;
      misses.push({ label: '用户停止', reason: '已按停止请求中断探活执行' });
      break;
    }
    const step = steps[index];
    updatePageOverlay({
      percent: Math.min(95, Math.round(((index + 1) / total) * 90) + 5),
      message: `探活执行：${step.title}`,
      highlightFieldIds: step.targetFieldId ? [step.targetFieldId] : undefined,
      showCancel: true,
    });
    const result = await executeOnePlaybookStep(step);
    results.push(result);
    if (!result.ok) {
      stopped = true;
      misses.push({
        label: step.title,
        reason: result.message,
      });
      break;
    }
    completed += 1;
  }

  updatePageOverlay({
    percent: 100,
    message: stopped
      ? `探活执行已停止（完成 ${completed}/${steps.length}）`
      : `探活执行完成（${completed} 步）`,
    showCancel: false,
  });
  window.setTimeout(() => {
    hidePageOverlay();
  }, 1400);

  return { completed, stopped, results, misses };
}
