/**
 * Side Panel（侧边助手）：
 * - 设置与新建档案在本侧栏完成（避免跳到扩展管理弹窗）
 * - 完整简历编辑用新标签打开 Options
 * - 日常扫描仍以右上角 Popup 为主；本页可核对预览 / 扫描 / 写入
 */
import { MAX_PROFILES } from '../../shared/storage/defaults';
import {
  createProfile,
  listProfiles,
  setActiveProfileId,
} from '../../shared/storage/profileStore';
import { getSettings, saveSettings } from '../../shared/storage/settingsStore';
import {
  formatTokenUsageBrief,
  getTokenUsageStats,
} from '../../shared/storage/usageStore';
import {
  createRequestId,
  sendRuntimeMessage,
} from '../../shared/messaging/send';
import {
  requestFillPlanWithWait,
  scanActivePage,
} from '../../shared/messaging/pageScan';
import { describeUserFacingError, isSoftPlanNotice } from '../../shared/messaging/userFacingError';
import {
  PENDING_POPUP_SCAN_REQUEST_KEY,
  type PendingPopupScanRequest,
} from '../../shared/messaging/popupScanHandoff';
import { mountFeedbackPanel } from '../../shared/feedback/feedbackMail';
import { mountApiGuide } from '../../shared/ui/apiGuide';
import { mountAppVersionLabel } from '../../shared/appVersion';
import {
  clearFillSession,
  loadFillSession,
  saveFillSession,
} from '../../shared/session/sessionStore';
import {
  FILL_SESSION_STORAGE_KEY,
  type FillSession,
} from '../../shared/session/types';
import type { ExtensionMessage } from '../../shared/types/messages';
import type {
  FieldDescriptor,
  FillMiss,
  FillPlan,
} from '../../shared/types/fill';
import {
  FILL_PRIMARY_ENGINE_LABEL,
  resolveFillSourceLabel,
} from '../../shared/types/fill';
import type { Profile } from '../../shared/types/profile';
import type { LlmTokenUsage, TokenUsageStats } from '../../shared/types/usage';
import type { SitePlaybook } from '../../shared/playbook/types';
import {
  PLAYBOOK_RISK_LABEL,
  PLAYBOOK_STEP_KIND_LABEL,
} from '../../shared/playbook/types';
import {
  mergePlaybookIntoFillPlan,
  selectExecutablePlaybookSteps,
} from '../../shared/playbook/mergeToPlan';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'warning' | 'error';

/** Popup「打开设置」写入，侧栏启动时展开设置区 */
const FOCUS_SETTINGS_SESSION_KEY = 'sidePanelFocusSettings';

/** 正在接手快捷条丢过来的扫描，避免监听和启动各跑一遍。 */
let popupScanHandoffActive = false;

let cachedProfiles: Profile[] = [];
let cachedActiveProfileId: string | null = null;
let currentSession: FillSession | null = null;
/** 最近一次智能探活产出的方案（合并/执行用） */
let latestPlaybook: SitePlaybook | null = null;
let isBusy = false;
/** 侧栏点了停止：立刻改文案，并让对照等待不再刷「已等待 N 秒」 */
let userRequestedStop = false;
/** 本轮用户操作的工作代次；停止作废该代，续扫/对照共用同一代 */
let sidepanelWorkGeneration = 0;

const settingsDetails = document.getElementById(
  'settingsDetails',
) as HTMLDetailsElement;
const apiSettingsForm = document.getElementById(
  'apiSettingsForm',
) as HTMLFormElement;
const apiBaseUrlInput = document.getElementById(
  'apiBaseUrlInput',
) as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKeyInput') as HTMLInputElement;
const modelInput = document.getElementById('modelInput') as HTMLInputElement;
const layaModelUrlInput = document.getElementById(
  'layaModelUrlInput',
) as HTMLInputElement;
const layaEnabledCheckbox = document.getElementById(
  'layaEnabledCheckbox',
) as HTMLInputElement;
const decisionPreferLocalCheckbox = document.getElementById(
  'decisionPreferLocalCheckbox',
) as HTMLInputElement;
const enableProbeClicksCheckbox = document.getElementById(
  'enableProbeClicksCheckbox',
) as HTMLInputElement;
const decisionMinConfidenceInput = document.getElementById(
  'decisionMinConfidenceInput',
) as HTMLInputElement;
const layaEnableBuiltinButton = document.getElementById(
  'layaEnableBuiltinButton',
) as HTMLButtonElement;
const layaDownloadButton = document.getElementById(
  'layaDownloadButton',
) as HTMLButtonElement;
const layaTestServerButton = document.getElementById(
  'layaTestServerButton',
) as HTMLButtonElement;
const layaClearCacheButton = document.getElementById(
  'layaClearCacheButton',
) as HTMLButtonElement;
const layaModelStatusText = document.getElementById(
  'layaModelStatusText',
) as HTMLParagraphElement;
const testApiButton = document.getElementById(
  'testApiButton',
) as HTMLButtonElement;
const apiSettingsFeedback = document.getElementById(
  'apiSettingsFeedback',
) as HTMLParagraphElement;
const createProfileForm = document.getElementById(
  'createProfileForm',
) as HTMLFormElement;
const createProfileFeedback = document.getElementById(
  'createProfileFeedback',
) as HTMLParagraphElement;
const newProfileNameInput = document.getElementById(
  'newProfileNameInput',
) as HTMLInputElement;
const createProfileButton = document.getElementById(
  'createProfileButton',
) as HTMLButtonElement;
const profileLimitTip = document.getElementById(
  'profileLimitTip',
) as HTMLParagraphElement;
const openFullEditorButton = document.getElementById(
  'openFullEditorButton',
) as HTMLButtonElement;

const profileSelect = document.getElementById(
  'profileSelect',
) as HTMLSelectElement;
const setDefaultCheckbox = document.getElementById(
  'setDefaultCheckbox',
) as HTMLInputElement;
const mappingTableBody = document.getElementById(
  'mappingTableBody',
) as HTMLTableSectionElement;
const cockpitBadgeElement = document.getElementById(
  'cockpitBadge',
) as HTMLParagraphElement;
const missTableBody = document.getElementById('missTableBody') as HTMLTableSectionElement;
const fillDoneDialog = document.getElementById('fillDoneDialog') as HTMLDialogElement;
const fillDoneText = document.getElementById('fillDoneText') as HTMLParagraphElement;
const fillDoneClose = document.getElementById('fillDoneClose') as HTMLButtonElement;
const skippedSummaryElement = document.getElementById(
  'skippedSummary',
) as HTMLParagraphElement;
const scanPageButton = document.getElementById(
  'scanPageButton',
) as HTMLButtonElement;
const probePageButton = document.getElementById(
  'probePageButton',
) as HTMLButtonElement;
const playbookSummaryElement = document.getElementById(
  'playbookSummary',
) as HTMLParagraphElement;
const playbookStepList = document.getElementById(
  'playbookStepList',
) as HTMLOListElement;
const playbookEmptyHint = document.getElementById(
  'playbookEmptyHint',
) as HTMLParagraphElement;
const mergePlaybookButton = document.getElementById(
  'mergePlaybookButton',
) as HTMLButtonElement;
const executePlaybookButton = document.getElementById(
  'executePlaybookButton',
) as HTMLButtonElement;
const confirmWriteButton = document.getElementById(
  'confirmWriteButton',
) as HTMLButtonElement;
const undoButton = document.getElementById('undoButton') as HTMLButtonElement;
const copyFillTraceButton = document.getElementById('copyFillTraceButton') as HTMLButtonElement;
/** 最近一轮确认写入的操作记录，复制后贴回排查。 */
let lastFillTrace = '';
const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
const statusMessageElement = document.getElementById(
  'statusMessage',
) as HTMLParagraphElement;
const scanProgressElement = document.getElementById(
  'scanProgress',
) as HTMLElement;
const scanProgressLabel = document.getElementById(
  'scanProgressLabel',
) as HTMLParagraphElement;
const scanProgressFill = document.getElementById(
  'scanProgressFill',
) as HTMLElement;
const scanProgressTrack = scanProgressElement.querySelector(
  '.scan-progress-track',
) as HTMLElement;
const tokenUsageLine = document.getElementById(
  'tokenUsageLine',
) as HTMLParagraphElement;

const EMPTY_MAPPING_HINT =
  '选好档案后，点下方「扫描本页」。扫完核对映射表，再点「确认写入」。';

/** 已经扫过，但没有可以填的项 */
const EMPTY_MAPPING_AFTER_SCAN =
  '这次没有可填的项。把档案写全，或换一页，再扫一次。';

function showStatus(message: string, kind: StatusKind = 'info'): void {
  statusMessageElement.textContent = message;
  statusMessageElement.classList.remove(
    'is-info',
    'is-success',
    'is-warning',
    'is-error',
  );
  statusMessageElement.classList.add(`is-${kind}`);
}

function showError(message: string): void {
  showStatus(message, 'error');
}

/**
 * 对照成功后的状态条：软 notice（如截图识字跳过）用警告色，硬 notice 才红字。
 */
function showPlanCompletionStatus(
  fieldCount: number,
  fillableCount: number,
  notice?: string,
): void {
  const successBase = `扫完了：发现 ${fieldCount} 个输入框，其中 ${fillableCount} 项可以填。请核对下面的预览，确认后再写入。`;
  if (!notice?.trim()) {
    showStatus(successBase, 'success');
    return;
  }
  if (isSoftPlanNotice(notice)) {
    showStatus(`${successBase}（${notice.trim()}）`, 'warning');
    return;
  }
  showError(notice);
}

/**
 * 更新扫描读条：百分比、当前动作，以及已经发现多少输入框。
 */
function showScanProgress(percent: number, message: string): void {
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  scanProgressElement.hidden = false;
  scanProgressFill.style.width = `${clampedPercent}%`;
  scanProgressLabel.textContent = `${message} ${clampedPercent}%`;
  scanProgressTrack.setAttribute('aria-valuenow', String(clampedPercent));
}

/** 表单旁提示的语气：成功、失败、进行中 */
type InlineTone = 'ok' | 'bad' | 'pending';

/** 成功后自动收起设置区的等待毫秒数 */
const SETTINGS_COLLAPSE_DELAY_MS = 2500;

/** 待执行的自动折叠计时器；用户中途操作时取消 */
let settingsCollapseTimer: number | null = null;

/**
 * 取消「成功后自动折叠」。用户改输入、再点按钮或手动收起时调用。
 */
function cancelSettingsAutoCollapse(): void {
  if (settingsCollapseTimer !== null) {
    window.clearTimeout(settingsCollapseTimer);
    settingsCollapseTimer = null;
  }
}

/**
 * 清掉一张表单上的绿/红框，以及字段上的红框。
 */
function clearFormFlash(form: HTMLFormElement): void {
  form.classList.remove('is-flash-ok', 'is-flash-bad');
  const invalidFields = form.querySelectorAll('.field.is-invalid');
  for (const fieldElement of invalidFields) {
    fieldElement.classList.remove('is-invalid');
  }
}

/**
 * 在指定表单旁显示结果。
 * 失败时：传入 invalidInputs 只标红那几项；不传则整张表单红框。
 */
function showInlineFeedback(
  form: HTMLFormElement,
  feedbackElement: HTMLParagraphElement,
  tone: InlineTone,
  message: string,
  invalidInputs: HTMLInputElement[] = [],
): void {
  clearFormFlash(form);
  feedbackElement.hidden = false;
  feedbackElement.textContent = message;
  feedbackElement.classList.remove('is-ok', 'is-bad', 'is-pending');
  if (tone === 'ok') {
    feedbackElement.classList.add('is-ok');
    form.classList.add('is-flash-ok');
    return;
  }
  if (tone === 'pending') {
    feedbackElement.classList.add('is-pending');
    return;
  }
  feedbackElement.classList.add('is-bad');
  if (invalidInputs.length > 0) {
    for (const inputElement of invalidInputs) {
      inputElement.closest('.field')?.classList.add('is-invalid');
    }
    return;
  }
  form.classList.add('is-flash-bad');
}

/**
 * 保存或建档成功后闪绿，几秒后收起「设置与新建档案」。
 * 倒计时内若用户再操作，由 cancelSettingsAutoCollapse 取消。
 */
function scheduleSettingsCollapse(): void {
  cancelSettingsAutoCollapse();
  settingsCollapseTimer = window.setTimeout(() => {
    settingsCollapseTimer = null;
    settingsDetails.open = false;
    clearFormFlash(apiSettingsForm);
    clearFormFlash(createProfileForm);
    apiSettingsFeedback.hidden = true;
    createProfileFeedback.hidden = true;
  }, SETTINGS_COLLAPSE_DELAY_MS);
}

/**
 * 判断 Base URL 是否为 http(s) 地址。
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 把测连失败原文收成短句，并指出该标红地址、钥匙、模型还是整张表单。
 */
function describeConnectionFailure(detail: string): {
  message: string;
  target: 'url' | 'key' | 'model' | 'form';
} {
  if (detail.includes('API Base URL')) {
    return {
      message: '还差接口地址。填上 Base URL，像 https://api.deepseek.com 这样。',
      target: 'url',
    };
  }
  if (detail.includes('API Key')) {
    return {
      message: '还没放钥匙。把 API Key 贴上再测一次。',
      target: 'key',
    };
  }
  if (detail.includes('权限')) {
    return {
      message: '浏览器还没允许访问这个网址。弹出权限时点允许，再测一次。',
      target: 'form',
    };
  }
  if (/401|403|unauthorized|invalid api key|authentication/i.test(detail)) {
    return {
      message: '对方不认这把钥匙。核对 Key 是否完整，去掉首尾空格后再试。',
      target: 'key',
    };
  }
  if (/model/i.test(detail) && /404|not found|does not exist|不存在/.test(detail)) {
    return {
      message: '这个模型名对方没有。换成服务商文档里的名字再测。',
      target: 'model',
    };
  }
  if (/404/.test(detail)) {
    return {
      message: '这个地址对不上接口。Base URL 一般写到 /v1 为止，不要多接路径。',
      target: 'url',
    };
  }
  if (/abort|timeout|超时|failed to fetch|network/i.test(detail)) {
    return {
      message: '暂时没连上。检查网络，以及地址是否以 https:// 开头。',
      target: 'form',
    };
  }
  const briefDetail = detail.replace(/\s+/g, ' ').slice(0, 72);
  return {
    message: `没连上。${briefDetail}。核对地址、钥匙和模型名后再试。`,
    target: 'form',
  };
}

/**
 * 刷新用量行：优先显示本次，否则显示累计摘要。
 */
function renderUsageLine(
  stats: TokenUsageStats,
  lastCallUsage?: LlmTokenUsage | null,
): void {
  if (lastCallUsage) {
    tokenUsageLine.textContent = `本次 Token：${formatTokenUsageBrief(lastCallUsage)} · 累计 ${stats.totalTokens}（${stats.callCount} 次）`;
    return;
  }
  if (stats.callCount === 0) {
    tokenUsageLine.textContent = 'Token：尚无 LLM 调用记录';
    return;
  }
  tokenUsageLine.textContent = `Token 累计 ${stats.totalTokens}（${stats.callCount} 次）· 详情见设置页`;
}

async function refreshUsageLine(
  lastCallUsage?: LlmTokenUsage | null,
): Promise<void> {
  const stats = await getTokenUsageStats();
  renderUsageLine(stats, lastCallUsage);
}

/**
 * 预览里有要填的项，或有可以手写的跳过项。
 */
function sessionHasMappingRows(): boolean {
  if (!currentSession) {
    return false;
  }
  const skippedCount =
    currentSession.plan.skippedNotes?.length ??
    currentSession.plan.skippedFieldIds.length;
  return currentSession.plan.items.length > 0 || skippedCount > 0;
}

/**
 * 有预览时可确认写入为主色；扫描始终为次按钮。
 */
function syncActionButtonHierarchy(): void {
  const canConfirm = sessionHasMappingRows();
  confirmWriteButton.className = canConfirm
    ? 'btn btn-primary action-confirm'
    : 'btn btn-secondary action-confirm';
  scanPageButton.className = canConfirm
    ? 'btn btn-secondary action-scan'
    : 'btn btn-primary action-scan';
}

function syncBusyUi(): void {
  const hasProfiles = cachedProfiles.length > 0;
  const selectedProfileId = profileSelect.value;
  const atLimit = cachedProfiles.length >= MAX_PROFILES;

  scanPageButton.disabled = isBusy || !hasProfiles || !selectedProfileId;
  probePageButton.disabled = isBusy || !hasProfiles || !selectedProfileId;
  const hasPlaybookSteps = (latestPlaybook?.steps.length ?? 0) > 0;
  mergePlaybookButton.disabled = isBusy || !hasPlaybookSteps;
  executePlaybookButton.disabled = isBusy || !hasPlaybookSteps;
  confirmWriteButton.disabled =
    isBusy || !hasProfiles || !selectedProfileId || !sessionHasMappingRows();
  undoButton.disabled = isBusy;
  profileSelect.disabled = isBusy;
  setDefaultCheckbox.disabled = isBusy || !selectedProfileId;
  createProfileButton.disabled = isBusy || atLimit;
  profileLimitTip.hidden = !atLimit;
  testApiButton.disabled = isBusy;
  openFullEditorButton.disabled = isBusy;
  syncActionButtonHierarchy();
}

/**
 * 渲染探活方案列表，并刷新合并/执行按钮状态。
 */
function renderPlaybook(playbook: SitePlaybook | null, notice?: string): void {
  latestPlaybook = playbook;
  playbookStepList.replaceChildren();
  if (!playbook || playbook.steps.length === 0) {
    playbookSummaryElement.hidden = true;
    playbookSummaryElement.textContent = '';
    playbookEmptyHint.hidden = false;
    syncBusyUi();
    return;
  }
  playbookEmptyHint.hidden = true;
  const warningText =
    playbook.warnings.length > 0
      ? `警告：${playbook.warnings.slice(0, 3).join('；')}`
      : '';
  const mergeableCount = playbook.steps.filter(
    (step) =>
      step.isWrite &&
      (step.kind === 'fill_field' || step.kind === 'select_option') &&
      Boolean(step.targetFieldId?.trim()) &&
      Boolean(step.suggestedValue?.trim()),
  ).length;
  playbookSummaryElement.hidden = false;
  playbookSummaryElement.textContent = [
    playbook.summary,
    `引擎：${playbook.engine === 'cloud' ? '云端' : '启发式'}`,
    `可合并预览约 ${mergeableCount} 步`,
    notice ?? '',
    warningText,
  ]
    .filter(Boolean)
    .join(' ｜ ');

  for (const step of playbook.steps) {
    const listItem = document.createElement('li');
    if (step.risk === 'high') {
      listItem.classList.add('is-high-risk');
    }
    const title = document.createElement('span');
    title.className = 'step-title';
    title.textContent = `${PLAYBOOK_STEP_KIND_LABEL[step.kind]} · ${step.title}`;
    const meta = document.createElement('span');
    meta.className = 'step-meta';
    meta.textContent = [
      step.detail,
      `风险 ${PLAYBOOK_RISK_LABEL[step.risk]}`,
      `置信 ${Math.round(step.confidence * 100)}%`,
      step.suggestedValue ? `建议值「${step.suggestedValue}」` : '',
      step.isWrite ? '写入类' : '只读',
    ]
      .filter(Boolean)
      .join(' · ');
    listItem.append(title, meta);
    playbookStepList.appendChild(listItem);
  }
  syncBusyUi();
}

/**
 * 读取侧栏置信度阈值（与 Decision 共用同一输入）。
 */
function readDecisionMinConfidence(): number {
  const parsed = Number(decisionMinConfidenceInput.value);
  if (!Number.isFinite(parsed)) {
    return 0.55;
  }
  return Math.min(0.99, Math.max(0.1, parsed));
}

/**
 * P7b：把可映射探活步合并进 FillSession.plan（source=probe），不写页。
 */
async function mergeLatestPlaybookIntoPreview(): Promise<void> {
  if (!latestPlaybook || latestPlaybook.steps.length === 0) {
    showError('请先完成智能探活');
    return;
  }
  const minConfidence = readDecisionMinConfidence();
  const basePlan: FillPlan = currentSession?.plan ?? {
    items: [],
    skippedFieldIds: [],
  };
  const { plan, mergedCount, skippedStepCount, keptStrongerCount } =
    mergePlaybookIntoFillPlan(basePlan, latestPlaybook, minConfidence);
  if (mergedCount === 0) {
    showError(
      keptStrongerCount > 0
        ? `探活建议未写入：已保留 ${keptStrongerCount} 项更高或同等置信的用户/云端/本机值。`
        : skippedStepCount > 0
          ? '有可写步但缺少 fieldId/建议值或置信不足，未能合并。可先扫描本页再探活。'
          : '当前方案没有可合并进预览的填写步。',
    );
    return;
  }

  // 为新出现的 fieldId 补标签行，便于预览表展示
  const existingFields = currentSession?.fields ?? [];
  const fieldById = new Map(
    existingFields.map((field) => [field.fieldId, field] as const),
  );
  for (const item of plan.items) {
    if (fieldById.has(item.fieldId)) {
      continue;
    }
    const matchedStep = latestPlaybook.steps.find(
      (step) => step.targetFieldId === item.fieldId,
    );
    const syntheticField: FieldDescriptor = {
      fieldId: item.fieldId,
      tag: 'input',
      type: 'text',
      label: matchedStep?.title?.replace(/^常规字段：/, '') || item.fieldId,
      required: false,
      selectorHint: `[data-raf-id="${item.fieldId}"]`,
    };
    fieldById.set(item.fieldId, syntheticField);
  }

  const nextSession: FillSession = {
    plan,
    fields: [...fieldById.values()],
    notice: currentSession?.notice,
      profileId: currentSession?.profileId ?? (profileSelect.value || undefined),
    primaryEngine: currentSession?.primaryEngine,
    siteAdapterName: currentSession?.siteAdapterName,
  };
  await saveFillSession(nextSession);
  currentSession = nextSession;
  renderMappingTable();
  syncBusyUi();
  const keptHint =
    keptStrongerCount > 0
      ? `；另保留 ${keptStrongerCount} 项更高/同等置信原值未覆盖`
      : '';
  showStatus(
    `已合并 ${mergedCount} 项探活建议进预览（来源=探活）${keptHint}。请核对后再点「确认写入」或「确认执行探活方案」。`,
    'success',
  );
}

/**
 * P7b：用户二次确认后，逐步执行可写探活步（含添加/打开选择器/填写）。
 */
async function executeLatestPlaybookConfirmed(): Promise<void> {
  if (!latestPlaybook || latestPlaybook.steps.length === 0) {
    showError('请先完成智能探活');
    return;
  }
  const minConfidence = readDecisionMinConfidence();
  const steps = selectExecutablePlaybookSteps(latestPlaybook, minConfidence);
  if (steps.length === 0) {
    showError('没有达到置信阈值的可执行写入步。');
    return;
  }
  const confirmed = window.confirm(
    `将尝试最多 ${steps.length} 步探活写入（含回读）。\n打不开或未匹配到选项的步骤会跳过并继续，不会点击提交/投递。\n低置信与无建议值的步骤已排除。\n\n确定执行？`,
  );
  if (!confirmed) {
    showStatus('已取消执行探活方案。', 'info');
    return;
  }
  showStatus('正在按探活方案逐步执行…', 'info');
  showScanProgress(10, '探活执行中…');
  const response = await sendRuntimeMessage({
    type: 'EXECUTE_PLAYBOOK',
    requestId: createRequestId(),
    steps,
    userConfirmed: true,
  });
  if (response.type === 'ERROR') {
    scanProgressElement.hidden = true;
    showError(response.message);
    return;
  }
  if (response.type !== 'EXECUTE_PLAYBOOK_RESULT') {
    scanProgressElement.hidden = true;
    showError('探活执行返回异常，请重试');
    return;
  }
  showScanProgress(
    100,
    response.stopped
      ? `已停止：成功写入 ${response.completed}/${steps.length}`
      : `探活执行完成：成功写入 ${response.completed}/${steps.length} 步`,
  );
  if (response.misses && response.misses.length > 0) {
    renderMissTable(response.misses);
  }
  showStatus(
    response.stopped
      ? `探活执行中途停止（成功写入 ${response.completed} 步）。请查看未填原因。`
      : (response.misses?.length ?? 0) > 0
        ? `探活方案已跑完：成功写入 ${response.completed} 步，另有 ${response.misses!.length} 步跳过/未匹配。`
        : `探活方案已执行完，成功写入 ${response.completed} 步。`,
    response.stopped ? 'error' : 'success',
  );
}

/**
 * 智能探活：收集证据（可选 P7c 受控探测）→ 生成 Playbook → 展示，并可合并/确认执行。
 */
async function runProbeAnalyzeFlow(profileId: string): Promise<void> {
  const allowProbeClicks = enableProbeClicksCheckbox.checked;
  showStatus(
    allowProbeClicks
      ? '正在智能探活（含受控探测，不提交）…'
      : '正在智能探活（只读分析，未开启探测点击）…',
    'info',
  );
  showScanProgress(
    8,
    allowProbeClicks ? '收集页内证据与探测点击…' : '收集页内证据（只读）…',
  );
  // 勾选变更会落库；此处再读一次设置作兜底，消息显式传勾选值
  const response = await sendRuntimeMessage({
    type: 'BUILD_SITE_PLAYBOOK',
    requestId: createRequestId(),
    profileId,
    enableProbeClicks: allowProbeClicks,
    enableMultimodal: true,
  });
  if (response.type === 'ERROR') {
    scanProgressElement.hidden = true;
    showError(response.message);
    return;
  }
  if (response.type !== 'BUILD_SITE_PLAYBOOK_RESULT') {
    scanProgressElement.hidden = true;
    showError('探活返回异常，请重试');
    return;
  }
  renderPlaybook(response.playbook, response.notice);
  showScanProgress(100, `探活完成：${response.playbook.steps.length} 步方案`);
  showStatus(
    response.notice ??
      `已生成 ${response.playbook.steps.length} 步探活方案。可合并进预览或确认执行。`,
    'success',
  );
  if (response.usage) {
    await refreshUsageLine(response.usage);
  }
}

/**
 * 将设置表单填入当前 AppSettings。
 */
function fillSettingsForm(settings: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  layaModelUrl: string;
  layaEnabled: boolean;
  decisionPreferLocal: boolean;
  decisionMinConfidence: number;
  enableProbeClicks?: boolean;
}): void {
  apiBaseUrlInput.value = settings.apiBaseUrl;
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  layaModelUrlInput.value = settings.layaModelUrl;
  layaEnabledCheckbox.checked = settings.layaEnabled;
  decisionPreferLocalCheckbox.checked = settings.decisionPreferLocal;
  decisionMinConfidenceInput.value = String(settings.decisionMinConfidence);
  if (typeof settings.enableProbeClicks === 'boolean') {
    enableProbeClicksCheckbox.checked = settings.enableProbeClicks;
  }
  void refreshLayaModelStatus();
}

/**
 * 渲染本机 Laya 状态文案。
 */
function renderLayaModelStatusFromMessage(response: {
  type: string;
  message?: string;
  format?: string;
  version?: string;
  builtin?: boolean;
}): void {
  if (response.type !== 'LAYA_MODEL_STATUS_RESULT') {
    return;
  }
  const formatPart = response.format
    ? ` · ${response.format}${response.version ? `@${response.version}` : ''}`
    : '';
  const builtinPart = response.builtin ? ' · 内置' : '';
  layaModelStatusText.textContent = `本机判断：${response.message ?? ''}${formatPart}${builtinPart}`;
}

/**
 * 查询 Background 中的本机模型状态。
 */
async function refreshLayaModelStatus(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({
      type: 'LAYA_MODEL_STATUS',
      requestId: createRequestId(),
    });
    if (response.type === 'ERROR') {
      layaModelStatusText.textContent = `本机判断：${response.message}`;
      return;
    }
    renderLayaModelStatusFromMessage(response);
  } catch (error: unknown) {
    layaModelStatusText.textContent = `本机判断：${describeUserFacingError(error)}`;
  }
}

/**
 * P7：测试输入框中的 Laya Server 是否可达（写入 Background 健康缓存）。
 */
async function testLayaServerConnection(): Promise<void> {
  try {
    layaTestServerButton.disabled = true;
    layaModelStatusText.textContent = 'Laya Server：正在探测…';
    const response = await sendRuntimeMessage({
      type: 'TEST_LAYA_SERVER',
      requestId: createRequestId(),
      serverUrl: layaModelUrlInput.value.trim(),
    });
    if (response.type === 'ERROR') {
      showStatus(response.message, 'error');
      return;
    }
    if (response.type !== 'TEST_LAYA_SERVER_RESULT') {
      showStatus('测试 Server 返回异常', 'error');
      return;
    }
    layaModelStatusText.textContent = response.ok
      ? `Laya Server：${response.message}`
      : `Laya Server 未连通：${response.message}`;
    showStatus(response.message, response.ok ? 'success' : 'error');
  } catch (error: unknown) {
    showStatus(describeUserFacingError(error), 'error');
  } finally {
    layaTestServerButton.disabled = false;
  }
}

/**
 * 侧栏：启用内置包 / 下载 / 清除。
 */
async function runLayaModelAction(
  action: 'enable' | 'download' | 'clear',
): Promise<void> {
  try {
    layaEnableBuiltinButton.disabled = true;
    layaDownloadButton.disabled = true;
    layaTestServerButton.disabled = true;
    layaClearCacheButton.disabled = true;
    if (action === 'download') {
      layaModelStatusText.textContent = '本机判断：正在下载…';
    }
    const response =
      action === 'enable'
        ? await sendRuntimeMessage({
            type: 'LAYA_MODEL_ENABLE_BUILTIN',
            requestId: createRequestId(),
          })
        : action === 'download'
          ? await sendRuntimeMessage({
              type: 'LAYA_MODEL_DOWNLOAD',
              requestId: createRequestId(),
              modelUrl: layaModelUrlInput.value.trim(),
            })
          : await sendRuntimeMessage({
              type: 'LAYA_MODEL_CLEAR',
              requestId: createRequestId(),
            });
    if (response.type === 'ERROR') {
      showInlineFeedback(
        apiSettingsForm,
        apiSettingsFeedback,
        'bad',
        response.message,
      );
      await refreshLayaModelStatus();
      return;
    }
    renderLayaModelStatusFromMessage(response);
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'ok',
      action === 'enable'
        ? '已启用内置轻量判断包'
        : action === 'download'
          ? '本机包已就绪'
          : '已清除本机判断缓存',
    );
  } catch (error: unknown) {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      describeUserFacingError(error),
    );
  } finally {
    layaEnableBuiltinButton.disabled = false;
    layaDownloadButton.disabled = false;
    layaTestServerButton.disabled = false;
    layaClearCacheButton.disabled = false;
  }
}

function renderProfileOptions(
  profiles: Profile[],
  preferredProfileId: string | null,
): void {
  cachedProfiles = profiles;
  cachedActiveProfileId = preferredProfileId;
  profileSelect.replaceChildren();

  if (profiles.length === 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '暂无档案，请先在上方创建';
    profileSelect.appendChild(emptyOption);
    setDefaultCheckbox.checked = false;
    syncBusyUi();
    return;
  }

  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    profileSelect.appendChild(option);
  }

  const selectedId =
    preferredProfileId &&
    profiles.some((profileItem) => profileItem.id === preferredProfileId)
      ? preferredProfileId
      : profiles[0].id;
  profileSelect.value = selectedId;
  setDefaultCheckbox.checked = selectedId === preferredProfileId;
  syncBusyUi();
}

function syncDefaultCheckboxFromSelection(): void {
  const selectedProfileId = profileSelect.value;
  setDefaultCheckbox.checked =
    Boolean(selectedProfileId) && selectedProfileId === cachedActiveProfileId;
}

function resolveFieldLabel(
  fieldId: string,
  fields: FieldDescriptor[],
): string {
  const matchedField = fields.find(
    (fieldItem) => fieldItem.fieldId === fieldId,
  );
  return matchedField?.label || fieldId;
}

function formatConfidencePercent(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `${Math.round(clamped * 100)}%`;
}

function optionMatchCaution(
  field: FieldDescriptor | undefined,
  valueText: string,
): string {
  const options = field?.options ?? [];
  const targetText = valueText.trim().toLowerCase();
  if (options.length === 0 || !targetText) {
    return '';
  }
  const exactMatch = options.some(
    (optionText) => optionText.trim().toLowerCase() === targetText,
  );
  if (exactMatch) {
    return '';
  }
  const looseMatches = options.filter((optionText) => {
    const optionLabel = optionText.trim().toLowerCase();
    return optionLabel.includes(targetText) || targetText.includes(optionLabel);
  });
  if (looseMatches.length === 1) {
    return '写入时会选最接近的一项';
  }
  if (looseMatches.length === 0) {
    return '下拉里没有完全相同的选项，请改成选项原文';
  }
  return '下拉里有多项接近，请改成选项原文';
}

/**
 * 更新驾驶舱徽章：本轮引擎 + 当前站适配器。
 */
function renderCockpitBadge(session: FillSession | null): void {
  if (!session) {
    cockpitBadgeElement.hidden = true;
    cockpitBadgeElement.textContent = '';
    return;
  }
  const parts: string[] = [];
  if (session.primaryEngine) {
    parts.push(
      `本轮引擎：${FILL_PRIMARY_ENGINE_LABEL[session.primaryEngine]}`,
    );
  }
  if (session.siteAdapterName) {
    parts.push(`当前站：${session.siteAdapterName}`);
  } else {
    parts.push('当前站：通用扫描');
  }
  const sourceCounts = new Map<string, number>();
  for (const item of session.plan.items) {
    const label = resolveFillSourceLabel(item.source, item.reason);
    sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
  }
  if (sourceCounts.size > 0) {
    const breakdown = [...sourceCounts.entries()]
      .map(([label, count]) => `${label}${count}`)
      .join(' · ');
    parts.push(`来源分布：${breakdown}`);
  }
  cockpitBadgeElement.textContent = parts.join(' ｜ ');
  cockpitBadgeElement.hidden = parts.length === 0;
}

function renderMappingTable(): void {
  mappingTableBody.replaceChildren();
  const skippedNotes =
    currentSession?.plan.skippedNotes ??
    (currentSession?.plan.skippedFieldIds ?? []).map((fieldId) => ({
      fieldId,
      reason: '没有把握对上档案',
    }));

  renderCockpitBadge(currentSession);

  if (!currentSession || (currentSession.plan.items.length === 0 && skippedNotes.length === 0)) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 4;
    emptyCell.textContent = currentSession ? EMPTY_MAPPING_AFTER_SCAN : EMPTY_MAPPING_HINT;
    emptyRow.appendChild(emptyCell);
    mappingTableBody.appendChild(emptyRow);
    skippedSummaryElement.hidden = true;
    skippedSummaryElement.textContent = '';
    syncBusyUi();
    return;
  }

  const { plan, fields } = currentSession;
  for (const mappingItem of plan.items) {
    const matchedField = fields.find(
      (fieldItem) => fieldItem.fieldId === mappingItem.fieldId,
    );
    const tableRow = document.createElement('tr');
    tableRow.dataset.fieldId = mappingItem.fieldId;

    const labelCell = document.createElement('td');
    labelCell.className = 'field-label-cell';
    labelCell.textContent = resolveFieldLabel(mappingItem.fieldId, fields);

    const valueCell = document.createElement('td');
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'value-input';
    valueInput.value = mappingItem.value;
    valueInput.dataset.fieldId = mappingItem.fieldId;
    valueInput.dataset.originalValue = mappingItem.value;
    if (mappingItem.attachmentId) {
      valueInput.readOnly = true;
      valueInput.title = '将上传此附件';
    }
    valueInput.setAttribute(
      'aria-label',
      `${resolveFieldLabel(mappingItem.fieldId, fields)} 填写值`,
    );
    valueCell.appendChild(valueInput);
    const cautionText = optionMatchCaution(matchedField, mappingItem.value);
    if (cautionText) {
      const cautionLine = document.createElement('span');
      cautionLine.className = 'mapping-caution';
      cautionLine.textContent = cautionText;
      valueCell.appendChild(cautionLine);
    }

    const sourceCell = document.createElement('td');
    sourceCell.className = 'source-cell';
    sourceCell.textContent = resolveFillSourceLabel(
      mappingItem.source,
      mappingItem.reason,
    );
    if (mappingItem.reason) {
      sourceCell.title = mappingItem.reason;
    }

    const confidenceCell = document.createElement('td');
    confidenceCell.className = 'confidence-cell';
    confidenceCell.textContent = formatConfidencePercent(
      mappingItem.confidence,
    );

    tableRow.append(labelCell, valueCell, sourceCell, confidenceCell);
    mappingTableBody.appendChild(tableRow);
  }

  for (const skippedNote of skippedNotes) {
    const tableRow = document.createElement('tr');
    tableRow.className = 'is-skipped';
    tableRow.dataset.fieldId = skippedNote.fieldId;

    const labelCell = document.createElement('td');
    labelCell.className = 'field-label-cell';
    labelCell.textContent = resolveFieldLabel(skippedNote.fieldId, fields);

    const valueCell = document.createElement('td');
    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'skip-input';
    valueInput.placeholder = skippedNote.reason;
    valueInput.dataset.fieldId = skippedNote.fieldId;
    valueInput.setAttribute(
      'aria-label',
      `${resolveFieldLabel(skippedNote.fieldId, fields)}，${skippedNote.reason}`,
    );
    valueCell.appendChild(valueInput);

    const sourceCell = document.createElement('td');
    sourceCell.className = 'source-cell';
    sourceCell.textContent = '跳过';

    const confidenceCell = document.createElement('td');
    confidenceCell.className = 'confidence-cell';
    confidenceCell.textContent = '未填';

    tableRow.append(labelCell, valueCell, sourceCell, confidenceCell);
    mappingTableBody.appendChild(tableRow);
  }

  skippedSummaryElement.hidden = true;
  skippedSummaryElement.textContent = '';
  syncBusyUi();
}

async function requestBackground(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const response = await sendRuntimeMessage(message);
  if (response.type === 'ERROR') {
    throw new Error(response.message || response.code || '请求失败');
  }
  return response;
}

async function loadPendingSession(): Promise<FillSession | null> {
  return loadFillSession();
}

async function clearPendingSession(): Promise<void> {
  await clearFillSession();
  currentSession = null;
}

function collectEditedFillPlan(): FillPlan {
  if (!currentSession) {
    return { items: [], skippedFieldIds: [] };
  }
  const editedItems = currentSession.plan.items.map((mappingItem) => {
    const valueInput = mappingTableBody.querySelector(
      `input.value-input[data-field-id="${CSS.escape(mappingItem.fieldId)}"]`,
    ) as HTMLInputElement | null;
    const nextValue = valueInput ? valueInput.value : mappingItem.value;
    const originalValue = valueInput?.dataset.originalValue ?? mappingItem.value;
    const valueChanged = nextValue !== originalValue;
    return {
      ...mappingItem,
      value: nextValue,
      // 用户改过值则正式标为用户来源
      source: valueChanged ? ('user' as const) : mappingItem.source,
      reason: valueChanged
        ? '用户在预览中修改'
        : mappingItem.reason,
    };
  });
  const skippedNotes =
    currentSession.plan.skippedNotes ??
    currentSession.plan.skippedFieldIds.map((fieldId) => ({
      fieldId,
      reason: '没有把握对上档案',
    }));
  const stillSkipped: FillPlan['skippedNotes'] = [];
  for (const skippedNote of skippedNotes) {
    const skipInput = mappingTableBody.querySelector(
      `input.skip-input[data-field-id="${CSS.escape(skippedNote.fieldId)}"]`,
    ) as HTMLInputElement | null;
    const typedValue = skipInput?.value.trim() ?? '';
    if (!typedValue) {
      stillSkipped.push(skippedNote);
      continue;
    }
    editedItems.push({
      fieldId: skippedNote.fieldId,
      value: typedValue,
      confidence: 1,
      reason: '手动填写',
      source: 'user',
    });
  }
  return {
    items: editedItems.filter((mappingItem) => mappingItem.value.trim().length > 0 || mappingItem.attachmentId),
    skippedFieldIds: stillSkipped.map((skippedNote) => skippedNote.fieldId),
    skippedNotes: stillSkipped,
  };
}

/**
 * 拉取 settings + profiles，刷新设置表单与档案下拉。
 */
async function loadState(): Promise<void> {
  const response = await requestBackground({
    type: 'GET_STATE',
    requestId: createRequestId(),
  });
  if (response.type !== 'GET_STATE_RESULT') {
    throw new Error('无法读取扩展状态');
  }
  fillSettingsForm(response.settings);
  renderProfileOptions(
    response.profiles,
    response.settings.activeProfileId,
  );
  renderUsageLine(response.tokenUsage);
}

/**
 * 若 Popup 请求聚焦设置，则展开设置区并清除标记。
 */
async function maybeFocusSettingsFromPopup(): Promise<void> {
  const snapshot = await chrome.storage.session.get(FOCUS_SETTINGS_SESSION_KEY);
  if (snapshot[FOCUS_SETTINGS_SESSION_KEY]) {
    settingsDetails.open = true;
    await chrome.storage.session.remove(FOCUS_SETTINGS_SESSION_KEY);
    settingsDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (cachedProfiles.length === 0) {
    // 无档案时默认展开，方便首次创建
    settingsDetails.open = true;
  }
}

/**
 * 读取设置表单当前值。模型留空时沿用默认名，避免存进空字符串。
 */
function readSettingsDraft(): {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  layaModelUrl: string;
  layaEnabled: boolean;
  decisionPreferLocal: boolean;
  decisionMinConfidence: number;
} {
  return {
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-4o-mini',
    layaModelUrl: layaModelUrlInput.value.trim(),
    layaEnabled: layaEnabledCheckbox.checked,
    decisionPreferLocal: decisionPreferLocalCheckbox.checked,
    decisionMinConfidence: Number(decisionMinConfidenceInput.value),
  };
}

/**
 * 保存前只拦明显写错的地址；空地址仍允许保存填写模式。
 * 返回 true 表示可以写入。
 */
function validateSettingsDraftForSave(draft: {
  apiBaseUrl: string;
}): boolean {
  if (draft.apiBaseUrl && !isHttpUrl(draft.apiBaseUrl)) {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '地址看起来不像网址。请以 https:// 开头，例如 https://api.deepseek.com。',
      [apiBaseUrlInput],
    );
    return false;
  }
  return true;
}

/**
 * 测连前检查地址和钥匙是否齐、地址是否合法。
 */
function validateSettingsDraftForTest(draft: {
  apiBaseUrl: string;
  apiKey: string;
}): boolean {
  if (!draft.apiBaseUrl) {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '还差接口地址。填上 Base URL，像 https://api.deepseek.com 这样。',
      [apiBaseUrlInput],
    );
    return false;
  }
  if (!isHttpUrl(draft.apiBaseUrl)) {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '地址看起来不像网址。请以 https:// 开头，不要漏掉协议。',
      [apiBaseUrlInput],
    );
    return false;
  }
  if (!draft.apiKey) {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '还没放钥匙。把 API Key 贴上再测一次。',
      [apiKeyInput],
    );
    return false;
  }
  return true;
}

/**
 * 保存 API / 填写模式到本机。成功后绿框，稍后自动折叠设置区。
 */
async function handleSaveSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  cancelSettingsAutoCollapse();
  const draft = readSettingsDraft();
  if (!validateSettingsDraftForSave(draft)) {
    return;
  }
  showInlineFeedback(
    apiSettingsForm,
    apiSettingsFeedback,
    'pending',
    '正在把设置收进本机…',
  );
  try {
    await saveSettings(draft);
  } catch {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '没能写进本机。稍等几秒再保存一次。',
    );
    return;
  }
  modelInput.value = draft.model;
  showInlineFeedback(
    apiSettingsForm,
    apiSettingsFeedback,
    'ok',
    '设置已收好，下次直接用。',
  );
  scheduleSettingsCollapse();
}

/**
 * 用表单里已经填好的三项测连，不必先点保存。
 * 测通后再决定要不要保存。
 */
async function handleTestApi(): Promise<void> {
  cancelSettingsAutoCollapse();
  const draft = readSettingsDraft();
  if (!validateSettingsDraftForTest(draft)) {
    return;
  }
  showInlineFeedback(
    apiSettingsForm,
    apiSettingsFeedback,
    'pending',
    '正在敲门确认能不能连上…',
  );
  let response: ExtensionMessage;
  try {
    response = await requestBackground({
      type: 'TEST_API',
      requestId: createRequestId(),
      apiBaseUrl: draft.apiBaseUrl,
      apiKey: draft.apiKey,
      model: draft.model,
    });
  } catch {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '测连中断了。确认扩展还在运行，再点一次。',
    );
    return;
  }
  if (response.type !== 'TEST_API_RESULT') {
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      '测连没有返回结果。再点一次；若仍如此，重新打开侧栏。',
    );
    return;
  }
  if (!response.ok) {
    const failure = describeConnectionFailure(response.detail);
    const invalidInputs: HTMLInputElement[] = [];
    if (failure.target === 'url') {
      invalidInputs.push(apiBaseUrlInput);
    } else if (failure.target === 'key') {
      invalidInputs.push(apiKeyInput);
    } else if (failure.target === 'model') {
      invalidInputs.push(modelInput);
    }
    showInlineFeedback(
      apiSettingsForm,
      apiSettingsFeedback,
      'bad',
      failure.message,
      invalidInputs,
    );
    return;
  }
  showInlineFeedback(
    apiSettingsForm,
    apiSettingsFeedback,
    'ok',
    '连上啦。确认无误后再点「保存」。',
  );
}

/**
 * 在侧栏直接新建档案（不打开 Options）。
 * 成功后绿框，稍后自动折叠设置区。
 */
async function handleCreateProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  cancelSettingsAutoCollapse();
  const name = newProfileNameInput.value.trim();
  if (!name) {
    showInlineFeedback(
      createProfileForm,
      createProfileFeedback,
      'bad',
      '还差一个名字。例如「校招主投」，方便以后切换。',
      [newProfileNameInput],
    );
    return;
  }
  if (cachedProfiles.length >= MAX_PROFILES) {
    showInlineFeedback(
      createProfileForm,
      createProfileFeedback,
      'bad',
      `已经有 ${MAX_PROFILES} 份了。先到完整编辑页删一份，再来新建。`,
    );
    return;
  }
  showInlineFeedback(
    createProfileForm,
    createProfileFeedback,
    'pending',
    '正在建立这份档案…',
  );
  let created: Profile;
  try {
    created = await createProfile({ name });
  } catch {
    showInlineFeedback(
      createProfileForm,
      createProfileFeedback,
      'bad',
      '这份档案没建成。确认还没到 5 份上限，再试一次。',
    );
    return;
  }
  newProfileNameInput.value = '';
  const profiles = await listProfiles();
  const settings = await getSettings();
  renderProfileOptions(profiles, settings.activeProfileId ?? created.id);
  profileSelect.value = created.id;
  showInlineFeedback(
    createProfileForm,
    createProfileFeedback,
    'ok',
    `「${created.name}」建好了。需要细填时再打开完整编辑页。`,
  );
  scheduleSettingsCollapse();
}

/**
 * 完整简历编辑器：新标签打开 Options（不盖在扩展管理页上）。
 */
function openFullOptionsEditor(): void {
  const optionsUrl = chrome.runtime.getURL('/options.html');
  void chrome.tabs.create({ url: optionsUrl });
}

/**
 * 把没写进去的格子画到「没写上的」表里。
 */
function renderMissTable(misses: FillMiss[]): void {
  missTableBody.replaceChildren();
  if (misses.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 2;
    emptyCell.textContent = '这一轮没有没写上的格子。';
    emptyRow.appendChild(emptyCell);
    missTableBody.appendChild(emptyRow);
    return;
  }
  for (const miss of misses) {
    const tableRow = document.createElement('tr');
    const labelCell = document.createElement('td');
    labelCell.textContent = miss.label;
    const reasonCell = document.createElement('td');
    reasonCell.textContent = miss.reason;
    tableRow.append(labelCell, reasonCell);
    missTableBody.appendChild(tableRow);
  }
}

/**
 * 写完后弹出结果。没写上的明细在下面那张表里。
 */
function showFillDoneDialog(filled: number, misses: FillMiss[]): void {
  fillDoneText.textContent =
    misses.length > 0
      ? `写完了。成功 ${filled} 项，有 ${misses.length} 项没写上，列在「没写上的」表里。`
      : `写完了。成功 ${filled} 项，这一轮没有没写上的格子。`;
  if (!fillDoneDialog.open) {
    fillDoneDialog.showModal();
  }
}

async function runConfirmWrite(): Promise<void> {
  userRequestedStop = false;
  sidepanelWorkGeneration += 1;
  const selectedProfileId = profileSelect.value;
  if (!selectedProfileId) {
    showError('请先选择档案');
    return;
  }
  if (!currentSession) {
    showError('请先扫描本页，核对映射后再确认写入。');
    return;
  }
  const editedPlan = collectEditedFillPlan();
  if (editedPlan.items.length === 0) {
    showError('映射表里没有可写入的项。请先扫描，或在跳过栏里手填后再试。');
    return;
  }
  stopButton.hidden = false;
  showScanProgress(8, '正在按预览计划写入页面。');
  try {
    const applyResponse = await requestBackground({
      type: 'APPLY_FILL_PLAN',
      requestId: createRequestId(),
      plan: editedPlan,
      profileId: selectedProfileId,
      workGeneration: sidepanelWorkGeneration,
    });
    if (userRequestedStop || applyResponse.type === 'ERROR') {
      if (applyResponse.type === 'ERROR' && applyResponse.code === 'USER_STOPPED') {
        showScanProgress(100, '已停止。');
        showStatus('已停止。', 'info');
        return;
      }
      if (userRequestedStop) {
        showScanProgress(100, '已停止。');
        showStatus('已停止。', 'info');
        return;
      }
    }
    if (applyResponse.type !== 'APPLY_FILL_RESULT') {
      throw new Error(
        applyResponse.type === 'ERROR'
          ? describeUserFacingError(applyResponse.message)
          : '写入页面失败',
      );
    }
    const misses = applyResponse.misses ?? [];
    lastFillTrace = applyResponse.trace ?? '';
    copyFillTraceButton.disabled = lastFillTrace.length === 0;
    renderMissTable(misses);
    showScanProgress(100, `写入结束，成功 ${applyResponse.filled} 项。`);
    showStatus(
      `已经写入 ${applyResponse.filled} 项。没写上 ${misses.length} 项，见下方表格。`,
      misses.length > 0 ? 'error' : 'success',
    );
    showFillDoneDialog(applyResponse.filled, misses);
  } finally {
    stopButton.hidden = true;
  }
}

async function runUndoFlow(): Promise<void> {
  const undoResponse = await requestBackground({
    type: 'UNDO_LAST_FILL',
    requestId: createRequestId(),
  });
  if (undoResponse.type !== 'UNDO_FILL_RESULT') {
    throw new Error('撤销失败');
  }
  const clearedFiles = undoResponse.clearedFiles ?? 0;
  const restored = undoResponse.restored;
  if (restored === 0 && clearedFiles === 0) {
    showStatus('没有可撤销的写入。', 'info');
    return;
  }
  if (clearedFiles > 0 && restored > 0) {
    showStatus(
      `已还原 ${restored} 个填写框，并清除 ${clearedFiles} 个本轮上传的文件。`,
      'success',
    );
    return;
  }
  if (clearedFiles > 0) {
    showStatus(
      `已清除 ${clearedFiles} 个本轮上传的文件（浏览器无法恢复原文件）。`,
      'success',
    );
    return;
  }
  showStatus(`已撤销 ${restored} 项，页面恢复到写入前。`, 'success');
}

/**
 * 扫描出预览前：按档案条数只点「添加」补行，不写任何档案正文。
 */
async function ensureRowsBeforePlan(_profileId: string): Promise<void> {
  // 补行改到写入阶段「填完一行再添加一行」，预览不再一次加满空壳。
}

async function runRescanFlow(profileId: string): Promise<void> {
  userRequestedStop = false;
  sidepanelWorkGeneration += 1;
  const workGeneration = sidepanelWorkGeneration;
  const isStopped = (): boolean =>
    userRequestedStop || workGeneration !== sidepanelWorkGeneration;
  stopButton.hidden = false;
  showScanProgress(4, '正在滚动页面，已发现 0 个输入框。');
  try {
    // ① 先扫一遍（滚动、展开）—— 本轮换代开始
    const firstScan = await scanActivePage(
      createRequestId(),
      (progress) => {
        if (isStopped()) {
          return;
        }
        showScanProgress(progress.percent, progress.message);
      },
      {
        workGeneration,
        continueWork: false,
        shouldAbort: isStopped,
      },
    );
    if (isStopped()) {
      showScanProgress(100, '已停止。');
      showStatus('已停止。', 'info');
      return;
    }
    if (firstScan.fields.length === 0) {
      await clearPendingSession();
      renderMappingTable();
      showScanProgress(100, firstScan.notice ?? '没有扫到输入框。');
      showError(
        firstScan.notice ??
          '这一页没有扫到可以填写的输入框。请确认打开的是网申表单，展开折叠区域后再扫一次。',
      );
      return;
    }

    // ② 按档案条数只点「添加」补行（不写正文）
    await ensureRowsBeforePlan(profileId);
    if (isStopped()) {
      showScanProgress(100, '已停止。');
      showStatus('已停止。', 'info');
      return;
    }

    // ③ 再扫一遍，拿到新行的 fieldId（同代续扫，禁止清停止）
    const scanResult = await scanActivePage(
      createRequestId(),
      (progress) => {
        if (isStopped()) {
          return;
        }
        const remappedPercent = Math.min(
          88,
          78 + Math.floor(progress.percent * 0.1),
        );
        showScanProgress(remappedPercent, progress.message);
      },
      {
        workGeneration,
        continueWork: true,
        shouldAbort: isStopped,
      },
    );
    if (isStopped()) {
      showScanProgress(100, '已停止。');
      showStatus('已停止。', 'info');
      return;
    }
    const scannedFields =
      scanResult.fields.length > 0 ? scanResult.fields : firstScan.fields;
    if (scannedFields.length === 0) {
      await clearPendingSession();
      renderMappingTable();
      showScanProgress(100, scanResult.notice ?? '没有扫到输入框。');
      showError(
        scanResult.notice ??
          '这一页没有扫到可以填写的输入框。请确认打开的是网申表单，展开折叠区域后再扫一次。',
      );
      return;
    }

    // ④ 对照档案生成预览计划（含第 2、第 3 行）
    const planResponse = await requestFillPlanWithWait(
      createRequestId(),
      profileId,
      scannedFields,
      (elapsedSeconds) => {
        if (isStopped()) {
          return;
        }
        const waitPercent = Math.min(99, 90 + Math.floor(elapsedSeconds / 15));
        showScanProgress(waitPercent, `正在对照档案，已等待 ${elapsedSeconds} 秒。`);
      },
      isStopped,
      workGeneration,
    );
    if (isStopped()) {
      showScanProgress(100, '已停止。');
      showStatus('已停止。', 'info');
      return;
    }
    showScanProgress(
      100,
      scanResult.notice
        ? `对照完成，${planResponse.plan.items.length} 项可以填。${scanResult.notice}`
        : `对照完成，${planResponse.plan.items.length} 项可以填。`,
    );
    const pendingFillSession: FillSession = {
      plan: planResponse.plan,
      fields: scannedFields,
      notice: planResponse.notice,
      profileId,
      primaryEngine: planResponse.primaryEngine,
      siteAdapterName: planResponse.siteAdapterName,
    };
    await saveFillSession(pendingFillSession);
    currentSession = pendingFillSession;
    renderMappingTable();
    showPlanCompletionStatus(
      scannedFields.length,
      planResponse.plan.items.length,
      planResponse.notice,
    );
    await refreshUsageLine(planResponse.usage ?? null);
  } finally {
    stopButton.hidden = true;
  }
}

async function withBusy(action: () => Promise<void>): Promise<void> {
  if (isBusy) {
    return;
  }
  isBusy = true;
  syncBusyUi();
  try {
    await action();
  } catch (error: unknown) {
    const facing = describeUserFacingError(error);
    if (facing === '已停止。' || (error instanceof Error && error.message === 'USER_STOPPED')) {
      showScanProgress(100, '已停止。');
      showStatus('已停止。', 'info');
      return;
    }
    showError(facing);
  } finally {
    isBusy = false;
    syncBusyUi();
    // 扫描进行中如果快捷条又丢来一次请求，忙完再接。
    void startRequestedPopupScan();
  }
}

/**
 * 读走快捷条留下的扫描请求，对当前网申页扫描并对照。
 * 侧栏已经打开，这里不再调用 sidePanel.open。
 */
async function startRequestedPopupScan(): Promise<void> {
  if (isBusy || popupScanHandoffActive) {
    return;
  }
  popupScanHandoffActive = true;
  let scanRequestWasStarted = false;
  try {
    const storageSnapshot = await chrome.storage.session.get(
      PENDING_POPUP_SCAN_REQUEST_KEY,
    );
    const scanRequest = storageSnapshot[PENDING_POPUP_SCAN_REQUEST_KEY] as
      | PendingPopupScanRequest
      | undefined;
    if (!scanRequest || typeof scanRequest.profileId !== 'string' || !scanRequest.profileId) {
      return;
    }
    await chrome.storage.session.remove(PENDING_POPUP_SCAN_REQUEST_KEY);
    const profileOptionExists = Array.from(profileSelect.options).some(
      (option) => option.value === scanRequest.profileId,
    );
    if (profileOptionExists) {
      profileSelect.value = scanRequest.profileId;
      syncDefaultCheckboxFromSelection();
    }
    scanRequestWasStarted = true;
    await withBusy(async () => {
      showStatus('正在扫描当前网申页…', 'info');
      await runRescanFlow(scanRequest.profileId);
    });
  } finally {
    popupScanHandoffActive = false;
  }
  // 扫描过程中快捷条可能又写入一次。当时接手标志还在，忙完再读一次。
  if (scanRequestWasStarted) {
    await startRequestedPopupScan();
  }
}

function bindEvents(): void {
  // 倒计时期间改内容、再点或手动收起，都取消自动折叠
  settingsDetails.addEventListener('input', () => {
    cancelSettingsAutoCollapse();
  });
  settingsDetails.addEventListener('click', () => {
    cancelSettingsAutoCollapse();
  });
  settingsDetails.addEventListener('toggle', () => {
    if (!settingsDetails.open) {
      cancelSettingsAutoCollapse();
    }
  });

  profileSelect.addEventListener('change', () => {
    syncDefaultCheckboxFromSelection();
    syncBusyUi();
  });

  setDefaultCheckbox.addEventListener('change', () => {
    void withBusy(async () => {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        setDefaultCheckbox.checked = false;
        return;
      }
      if (setDefaultCheckbox.checked) {
        await setActiveProfileId(selectedProfileId);
        cachedActiveProfileId = selectedProfileId;
        showStatus('已设为默认档案', 'success');
      } else if (cachedActiveProfileId === selectedProfileId) {
        await setActiveProfileId(null);
        cachedActiveProfileId = null;
        showStatus('已取消默认档案', 'info');
      }
    });
  });

  apiSettingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void withBusy(async () => {
      await handleSaveSettings(event);
    });
  });

  testApiButton.addEventListener('click', () => {
    void withBusy(async () => {
      await handleTestApi();
    });
  });

  layaEnableBuiltinButton.addEventListener('click', () => {
    void withBusy(async () => {
      await runLayaModelAction('enable');
    });
  });
  layaDownloadButton.addEventListener('click', () => {
    void withBusy(async () => {
      await runLayaModelAction('download');
    });
  });
  layaTestServerButton.addEventListener('click', () => {
    void withBusy(async () => {
      await testLayaServerConnection();
    });
  });
  layaClearCacheButton.addEventListener('click', () => {
    void withBusy(async () => {
      await runLayaModelAction('clear');
    });
  });

  createProfileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void withBusy(async () => {
      await handleCreateProfile(event);
    });
  });

  openFullEditorButton.addEventListener('click', () => {
    openFullOptionsEditor();
  });

  fillDoneClose.addEventListener('click', () => {
    fillDoneDialog.close();
  });

  // 「扫描本页」：只对照出预览，不写入
  scanPageButton.addEventListener('click', () => {
    void withBusy(async () => {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        showError('请先选择档案');
        return;
      }
      await runRescanFlow(selectedProfileId);
    });
  });

  // 「智能探活」：先生成方案步骤；合并/执行需另点按钮
  probePageButton.addEventListener('click', () => {
    void withBusy(async () => {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        showError('请先选择档案');
        return;
      }
      await runProbeAnalyzeFlow(selectedProfileId);
    });
  });

  // 「合并进预览」：探活步 → FillSession.plan（source=probe），不写页
  mergePlaybookButton.addEventListener('click', () => {
    void withBusy(async () => {
      await mergeLatestPlaybookIntoPreview();
    });
  });

  // 「确认执行探活方案」：二次确认后逐步写页 + 回读
  executePlaybookButton.addEventListener('click', () => {
    void withBusy(async () => {
      await executeLatestPlaybookConfirmed();
    });
  });

  // P4：探测点击开关即时落库，下次探活生效
  enableProbeClicksCheckbox.addEventListener('change', () => {
    void saveSettings({
      enableProbeClicks: enableProbeClicksCheckbox.checked,
    }).then(() => {
      showStatus(
        enableProbeClicksCheckbox.checked
          ? '已开启受控探测点击（永不点提交）。'
          : '已关闭探测点击：下次探活为只读分析。',
        'info',
      );
    });
  });

  // 「确认写入」：按映射表（含用户改值）写入页面
  confirmWriteButton.addEventListener('click', () => {
    void withBusy(async () => {
      showStatus('正在按预览计划写入…', 'info');
      await runConfirmWrite();
    });
  });

  undoButton.addEventListener('click', () => {
    void withBusy(async () => {
      showStatus('正在撤销本轮填写…', 'info');
      await runUndoFlow();
    });
  });

  copyFillTraceButton.addEventListener('click', () => {
    if (!lastFillTrace) {
      showStatus('这一轮还没有操作记录。先点确认写入。', 'info');
      return;
    }
    void navigator.clipboard.writeText(lastFillTrace).then(() => {
      showStatus('操作记录已复制。贴回聊天即可。', 'success');
    });
  });

  stopButton.addEventListener('click', () => {
    userRequestedStop = true;
    showScanProgress(100, '已停止。');
    showStatus('已停止。', 'info');
    void requestBackground({
      type: 'STOP_PAGE_WORK',
      requestId: createRequestId(),
      workGeneration: sidepanelWorkGeneration,
    });
  });

  chrome.storage.session.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') {
      return;
    }
    if (changes[FOCUS_SETTINGS_SESSION_KEY]?.newValue) {
      settingsDetails.open = true;
      void chrome.storage.session.remove(FOCUS_SETTINGS_SESSION_KEY);
      settingsDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (changes[PENDING_POPUP_SCAN_REQUEST_KEY]?.newValue) {
      void startRequestedPopupScan();
    }
    if (!changes[FILL_SESSION_STORAGE_KEY] || isBusy) {
      return;
    }
    void (async () => {
      currentSession = await loadPendingSession();
      renderMappingTable();
      if (currentSession && currentSession.plan.items.length > 0) {
        showPlanCompletionStatus(
          currentSession.fields.length,
          currentSession.plan.items.length,
          currentSession.notice,
        );
        await refreshUsageLine();
      }
    })();
  });

  // N5：选项页/其它入口改探测开关时，侧栏勾选实时同步
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    const settingsChange = changes.settings;
    if (!settingsChange?.newValue || typeof settingsChange.newValue !== 'object') {
      return;
    }
    const nextSettings = settingsChange.newValue as { enableProbeClicks?: boolean };
    if (typeof nextSettings.enableProbeClicks === 'boolean') {
      enableProbeClicksCheckbox.checked = nextSettings.enableProbeClicks;
    }
  });
}

async function bootstrapSidePanel(): Promise<void> {
  mountFeedbackPanel();
  mountApiGuide();
  mountAppVersionLabel();
  bindEvents();
  syncBusyUi();
  try {
    await loadState();
    await maybeFocusSettingsFromPopup();
    await startRequestedPopupScan();
    currentSession = await loadPendingSession();
    renderMappingTable();

    if (cachedProfiles.length === 0) {
      showStatus('请先在上方「设置与新建/编辑档案」创建档案并填写 API', 'info');
    } else if (currentSession && currentSession.plan.items.length > 0) {
      showPlanCompletionStatus(
        currentSession.fields.length,
        currentSession.plan.items.length,
        currentSession.notice,
      );
    } else {
      showStatus(
        '日常扫描请用右上角 Popup；设置请展开上方区域',
        'info',
      );
    }
  } catch (error: unknown) {
    showError(describeUserFacingError(error));
  }
}

void bootstrapSidePanel();
