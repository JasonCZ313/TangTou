import { composePolishedPassage, POLISH_METHOD_TEXT } from '../../shared/llm/polishPrompt';
import { createRequestId, sendRuntimeMessage } from '../../shared/messaging/send';
import { describeUserFacingError } from '../../shared/messaging/userFacingError';

/** 这些长文段才出现润色。短字段（姓名、电话、日期）不加 */
const POLISH_FIELD_NAME_BY_LABEL: Record<string, string> = {
  工作职责: '工作职责',
  工作内容: '工作内容',
  '业绩/成果': '业绩',
  项目内容: '项目内容',
  '项目价值/成果': '项目价值',
  总述: '总述',
};

/** 档案页静态问答区的字段名，要和提示词里的侧重名称一致 */
const ESSAY_FIELD_NAME_BY_PATH: Record<string, string> = {
  'essays.selfEvaluation': '自我评价',
  'essays.careerPlan': '职业规划',
  'essays.strengthsWeaknesses': '优缺点',
  'essays.whyJoin': '为何加入',
  'essays.projectDeepDive': '项目深挖',
  'essays.other': '其他问答',
};

/** 用户临时要求的字数上限 */
const CUSTOM_REQUIREMENT_MAX_LENGTH = 30;

/** 对照层当前正在改的输入框和字段名 */
interface PolishSession {
  textarea: HTMLTextAreaElement;
  fieldName: string;
  sourceText: string;
}

let polishDialog: HTMLDivElement | null = null;
let polishSession: PolishSession | null = null;
let polishRequestRunning = false;
let activePolishRequestId = '';
let displayedPolishPercent = 0;
let polishPercentTimer = 0;

/**
 * 统计附加要求的字数。中文一个字算一个。
 */
function requirementLength(requirementText: string): number {
  return [...requirementText.trim()].length;
}

/**
 * 向后台要一次润色。失败时抛出已经转成中文的错误。
 */
async function requestPolish(
  fieldName: string,
  sourceText: string,
  customRequirement: string,
): Promise<{ headline: string; body: string }> {
  const requestId = createRequestId();
  activePolishRequestId = requestId;
  const response = await sendRuntimeMessage({
    type: 'POLISH_TEXT',
    requestId,
    fieldName,
    sourceText,
    customRequirement,
  });
  if (response.type === 'ERROR') {
    throw new Error(response.message);
  }
  if (response.type !== 'POLISH_TEXT_RESULT') {
    throw new Error('润色没有完成。请再试一次。');
  }
  return { headline: response.headline, body: response.body };
}

/**
 * 把润色结果填进对照表的右列。概括单独成行。
 */
function renderComparison(headline: string, body: string): void {
  if (!polishDialog || !polishSession) {
    return;
  }
  const sourceColumn = polishDialog.querySelector('[data-polish-source]');
  const resultColumn = polishDialog.querySelector('[data-polish-result]');
  const errorLine = polishDialog.querySelector('[data-polish-error]');
  if (sourceColumn) {
    sourceColumn.textContent = polishSession.sourceText;
  }
  if (resultColumn) {
    resultColumn.textContent = composePolishedPassage({ headline, body });
  }
  if (errorLine) {
    errorLine.textContent = '';
    errorLine.setAttribute('hidden', '');
  }
  polishDialog.dataset.headline = headline;
  polishDialog.dataset.body = body;
}

/**
 * 在对照层里显示红字，不改左边的原文。
 */
function showDialogError(message: string): void {
  const errorLine = polishDialog?.querySelector('[data-polish-error]');
  if (!(errorLine instanceof HTMLElement)) {
    return;
  }
  errorLine.hidden = false;
  errorLine.textContent = message;
}

/**
 * 把百分比画到进度条和右侧数字上。
 */
function paintPolishPercent(percent: number): void {
  displayedPolishPercent = percent;
  const fill = polishDialog?.querySelector('[data-polish-progress-fill]');
  const percentLabel = polishDialog?.querySelector('[data-polish-progress-percent]');
  if (fill instanceof HTMLElement) {
    fill.style.width = `${percent}%`;
  }
  if (percentLabel) {
    percentLabel.textContent = `${percent}%`;
  }
}

/**
 * 请求还没吐字时，百分比自己往 90% 靠近，避免进度条停在 0。
 */
function startPolishPercent(): void {
  window.clearInterval(polishPercentTimer);
  paintPolishPercent(0);
  polishPercentTimer = window.setInterval(() => {
    if (displayedPolishPercent >= 90) {
      return;
    }
    const step = Math.max(1, Math.round((90 - displayedPolishPercent) * 0.12));
    paintPolishPercent(Math.min(90, displayedPolishPercent + step));
  }, 250);
}

/**
 * 流式返回的百分比只往上走，并且在结果到达前不超过 92。
 */
function applyStreamPercent(percent: number): void {
  const cappedPercent = Math.max(0, Math.min(92, Math.round(percent)));
  if (cappedPercent > displayedPolishPercent) {
    paintPolishPercent(cappedPercent);
  }
}

/**
 * 润色完成时把进度停在 100%。
 */
function finishPolishPercent(): void {
  window.clearInterval(polishPercentTimer);
  paintPolishPercent(100);
}

/**
 * 润色进行时锁住对照层上的按钮，避免连点打出两段结果。
 */
function setDialogBusy(busy: boolean): void {
  polishRequestRunning = busy;
  if (!polishDialog) {
    return;
  }
  for (const button of polishDialog.querySelectorAll('button')) {
    if (button.hasAttribute('data-polish-cancel')) {
      continue;
    }
    button.disabled = busy;
  }
  const statusLine = polishDialog.querySelector('[data-polish-status]');
  if (statusLine) {
    statusLine.textContent = busy ? '正在润色…' : '';
  }
  const progress = polishDialog.querySelector('[data-polish-progress]');
  if (progress instanceof HTMLElement) {
    progress.hidden = !busy;
  }
  if (busy) {
    startPolishPercent();
  } else {
    window.clearInterval(polishPercentTimer);
  }
  const requirementInput = polishDialog.querySelector('[data-polish-requirement]');
  if (requirementInput instanceof HTMLInputElement) {
    requirementInput.disabled = busy;
  }
}

/**
 * 按当前附加要求再请求一次，成功后只替换右列。
 */
async function regenerateComparison(customRequirement: string): Promise<void> {
  if (!polishSession || polishRequestRunning) {
    return;
  }
  setDialogBusy(true);
  const errorLine = polishDialog?.querySelector('[data-polish-error]');
  if (errorLine instanceof HTMLElement) {
    errorLine.hidden = true;
    errorLine.textContent = '';
  }
  try {
    const passage = await requestPolish(
      polishSession.fieldName,
      polishSession.sourceText,
      customRequirement,
    );
    finishPolishPercent();
    renderComparison(passage.headline, passage.body);
    await new Promise((resolve) => {
      window.setTimeout(resolve, 280);
    });
  } catch (error: unknown) {
    showDialogError(describeUserFacingError(error));
  } finally {
    setDialogBusy(false);
  }
}

/**
 * 创建全页只有一份的对照层：左原文，右润色，确定才写回。
 */
function ensurePolishDialog(): HTMLDivElement {
  if (polishDialog) {
    return polishDialog;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'polish-dialog-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="polish-dialog" role="dialog" aria-modal="true" aria-labelledby="polishDialogTitle">
      <h3 id="polishDialogTitle" class="polish-dialog-title">润色对照</h3>
      <p class="polish-dialog-hint">建议使用 AI 自动修改。有特殊要求再点「我来提供要求」。</p>
      <div class="polish-progress" data-polish-progress hidden>
        <div class="polish-progress-track">
          <div class="polish-progress-fill" data-polish-progress-fill></div>
        </div>
        <span class="polish-progress-percent" data-polish-progress-percent>0%</span>
      </div>
      <p class="polish-dialog-field" data-polish-field></p>
      <div class="polish-compare">
        <section>
          <h4>原文</h4>
          <pre data-polish-source></pre>
        </section>
        <section>
          <h4>润色后</h4>
          <pre data-polish-result></pre>
        </section>
      </div>
      <p class="polish-dialog-status" data-polish-status></p>
      <p class="polish-dialog-error" data-polish-error hidden></p>
      <div class="polish-custom" data-polish-custom hidden>
        <label class="polish-custom-label">
          你的要求（30 字以内）
          <input type="text" maxlength="30" data-polish-requirement placeholder="例如：更短、突出管理" />
        </label>
        <span class="polish-custom-count" data-polish-count>0/30</span>
        <button type="button" class="btn btn-secondary" data-polish-regenerate>按此要求重新生成</button>
      </div>
      <div class="polish-dialog-actions">
        <button type="button" class="btn btn-primary" data-polish-auto>AI 自动修改</button>
        <button type="button" class="btn btn-primary" data-polish-confirm>确定更改</button>
        <button type="button" class="btn btn-secondary" data-polish-cancel>取消更改</button>
        <button type="button" class="btn btn-secondary" data-polish-ask>我来提供要求</button>
      </div>
    </div>
  `;

  const requirementInput = backdrop.querySelector('[data-polish-requirement]');
  const countLabel = backdrop.querySelector('[data-polish-count]');
  if (requirementInput instanceof HTMLInputElement && countLabel) {
    requirementInput.addEventListener('input', () => {
      const length = requirementLength(requirementInput.value);
      countLabel.textContent = `${length}/${CUSTOM_REQUIREMENT_MAX_LENGTH}`;
    });
  }

  backdrop.querySelector('[data-polish-confirm]')?.addEventListener('click', () => {
    if (!polishSession || !polishDialog || polishRequestRunning) {
      return;
    }
    const headline = polishDialog.dataset.headline ?? '';
    const body = polishDialog.dataset.body ?? '';
    const nextText = composePolishedPassage({ headline, body });
    if (!nextText) {
      showDialogError('还没有可写回的润色结果。');
      return;
    }
    polishSession.textarea.value = nextText;
    polishSession.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    closePolishDialog();
  });

  backdrop.querySelector('[data-polish-cancel]')?.addEventListener('click', () => {
    closePolishDialog();
  });

  backdrop.querySelector('[data-polish-auto]')?.addEventListener('click', () => {
    void regenerateComparison('');
  });

  backdrop.querySelector('[data-polish-ask]')?.addEventListener('click', () => {
    const customPanel = backdrop.querySelector('[data-polish-custom]');
    if (customPanel instanceof HTMLElement) {
      customPanel.hidden = false;
    }
    if (requirementInput instanceof HTMLInputElement) {
      requirementInput.focus();
    }
  });

  backdrop.querySelector('[data-polish-regenerate]')?.addEventListener('click', () => {
    if (!(requirementInput instanceof HTMLInputElement)) {
      return;
    }
    const customRequirement = requirementInput.value.trim();
    if (!customRequirement) {
      showDialogError('请先写上 30 字以内的要求。');
      return;
    }
    if (requirementLength(customRequirement) > CUSTOM_REQUIREMENT_MAX_LENGTH) {
      showDialogError('附加要求请控制在 30 个字以内。');
      return;
    }
    void regenerateComparison(customRequirement);
  });

  document.body.appendChild(backdrop);
  polishDialog = backdrop;
  return backdrop;
}

/**
 * 关掉对照层，不改输入框。
 */
function closePolishDialog(): void {
  if (!polishDialog) {
    return;
  }
  polishDialog.hidden = true;
  polishSession = null;
  const customPanel = polishDialog.querySelector('[data-polish-custom]');
  if (customPanel instanceof HTMLElement) {
    customPanel.hidden = true;
  }
  const requirementInput = polishDialog.querySelector('[data-polish-requirement]');
  if (requirementInput instanceof HTMLInputElement) {
    requirementInput.value = '';
  }
  const countLabel = polishDialog.querySelector('[data-polish-count]');
  if (countLabel) {
    countLabel.textContent = `0/${CUSTOM_REQUIREMENT_MAX_LENGTH}`;
  }
}

/**
 * 打开对照层，左边是原文，右边先空着。点「AI 自动修改」才请求模型。
 */
async function openPolishComparison(
  textarea: HTMLTextAreaElement,
  fieldName: string,
  inlineStatus: HTMLElement,
): Promise<void> {
  const sourceText = textarea.value.trim();
  if (!sourceText) {
    inlineStatus.hidden = false;
    inlineStatus.textContent = '请先写下这段内容，再润色。';
    return;
  }
  if (polishRequestRunning) {
    inlineStatus.hidden = false;
    inlineStatus.textContent = '上一段还在润色，请稍等。';
    return;
  }
  inlineStatus.hidden = true;
  inlineStatus.textContent = '';
  polishSession = { textarea, fieldName, sourceText };
  const dialog = ensurePolishDialog();
  const fieldLine = dialog.querySelector('[data-polish-field]');
  if (fieldLine) {
    fieldLine.textContent = fieldName;
  }
  const sourceColumn = dialog.querySelector('[data-polish-source]');
  const resultColumn = dialog.querySelector('[data-polish-result]');
  if (sourceColumn) {
    sourceColumn.textContent = sourceText;
  }
  if (resultColumn) {
    resultColumn.textContent = '';
  }
  const progress = dialog.querySelector('[data-polish-progress]');
  if (progress instanceof HTMLElement) {
    progress.hidden = true;
  }
  const statusLine = dialog.querySelector('[data-polish-status]');
  if (statusLine) {
    statusLine.textContent = '';
  }
  dialog.dataset.headline = '';
  dialog.dataset.body = '';
  dialog.hidden = false;
}

/**
 * 在一个长文段标签旁放上润色按钮和问号。问号展开小字说明。
 */
export function attachPolishControls(
  fieldLabel: HTMLLabelElement,
  textarea: HTMLTextAreaElement,
  fieldName: string,
): void {
  if (fieldLabel.querySelector('.btn-polish')) {
    return;
  }
  const labelText = fieldLabel.querySelector('.field-label');
  if (!(labelText instanceof HTMLElement)) {
    return;
  }

  const labelRow = document.createElement('span');
  labelRow.className = 'field-label-row';
  labelText.replaceWith(labelRow);
  labelRow.appendChild(labelText);

  const actionRow = document.createElement('span');
  actionRow.className = 'polish-actions';

  const polishButton = document.createElement('button');
  polishButton.type = 'button';
  polishButton.className = 'btn-polish';
  polishButton.textContent = '润色';

  const helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.className = 'polish-help-button';
  helpButton.setAttribute('aria-label', '查看润色方法');
  helpButton.textContent = '?';

  const methodText = document.createElement('p');
  methodText.className = 'polish-method';
  methodText.hidden = true;
  methodText.textContent = POLISH_METHOD_TEXT;

  const inlineStatus = document.createElement('p');
  inlineStatus.className = 'polish-inline-status';
  inlineStatus.hidden = true;

  helpButton.addEventListener('click', (event) => {
    event.preventDefault();
    methodText.hidden = !methodText.hidden;
  });
  polishButton.addEventListener('click', (event) => {
    event.preventDefault();
    void openPolishComparison(textarea, fieldName, inlineStatus);
  });

  actionRow.append(polishButton, helpButton);
  labelRow.appendChild(actionRow);
  labelRow.insertAdjacentElement('afterend', methodText);
  methodText.insertAdjacentElement('afterend', inlineStatus);
}

/**
 * 动态列表里的长文段：只有约定的标签才挂润色。
 */
export function attachPolishControlsIfLongText(
  fieldLabel: HTMLLabelElement,
  textarea: HTMLTextAreaElement,
  labelText: string,
): void {
  const fieldName = POLISH_FIELD_NAME_BY_LABEL[labelText];
  if (!fieldName) {
    return;
  }
  attachPolishControls(fieldLabel, textarea, fieldName);
}

/**
 * 给档案页静态问答区的六个长文段挂上润色。页面加载时调用一次。
 */
export function mountEssayPolishControls(root: ParentNode): void {
  for (const textarea of root.querySelectorAll<HTMLTextAreaElement>('textarea[data-path]')) {
    const pathText = textarea.dataset.path ?? '';
    const fieldName = ESSAY_FIELD_NAME_BY_PATH[pathText];
    if (!fieldName) {
      continue;
    }
    const fieldLabel = textarea.closest('label');
    if (!(fieldLabel instanceof HTMLLabelElement)) {
      continue;
    }
    attachPolishControls(fieldLabel, textarea, fieldName);
  }
}

/**
 * 接收后台按已生成字数算出的百分比，和本页的时间进度取较高的那个。
 */
chrome.runtime.onMessage.addListener((message: { type?: string; requestId?: string; percent?: number }) => {
  if (message.type !== 'POLISH_PROGRESS' || message.requestId !== activePolishRequestId) {
    return;
  }
  if (typeof message.percent === 'number') {
    applyStreamPercent(message.percent);
  }
});
