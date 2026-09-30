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
import { describeUserFacingError } from '../../shared/messaging/userFacingError';
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
import type { FieldDescriptor, FillMiss, FillPlan } from '../../shared/types/fill';
import type { Profile } from '../../shared/types/profile';
import type { LlmTokenUsage, TokenUsageStats } from '../../shared/types/usage';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/** Popup「打开设置」写入，侧栏启动时展开设置区 */
const FOCUS_SETTINGS_SESSION_KEY = 'sidePanelFocusSettings';

/** 正在接手快捷条丢过来的扫描，避免监听和启动各跑一遍。 */
let popupScanHandoffActive = false;

let cachedProfiles: Profile[] = [];
let cachedActiveProfileId: string | null = null;
let currentSession: FillSession | null = null;
let isBusy = false;

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
const confirmWriteButton = document.getElementById(
  'confirmWriteButton',
) as HTMLButtonElement;
const undoButton = document.getElementById('undoButton') as HTMLButtonElement;
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
  statusMessageElement.classList.remove('is-info', 'is-success', 'is-error');
  statusMessageElement.classList.add(`is-${kind}`);
}

function showError(message: string): void {
  showStatus(message, 'error');
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
 * 将设置表单填入当前 AppSettings。
 */
function fillSettingsForm(settings: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  layaModelUrl: string;
  layaEnabled: boolean;
}): void {
  apiBaseUrlInput.value = settings.apiBaseUrl;
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  layaModelUrlInput.value = settings.layaModelUrl;
  layaEnabledCheckbox.checked = settings.layaEnabled;
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

function renderMappingTable(): void {
  mappingTableBody.replaceChildren();
  const skippedNotes =
    currentSession?.plan.skippedNotes ??
    (currentSession?.plan.skippedFieldIds ?? []).map((fieldId) => ({
      fieldId,
      reason: '没有把握对上档案',
    }));

  if (!currentSession || (currentSession.plan.items.length === 0 && skippedNotes.length === 0)) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
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

    const confidenceCell = document.createElement('td');
    confidenceCell.className = 'confidence-cell';
    confidenceCell.textContent = formatConfidencePercent(
      mappingItem.confidence,
    );

    tableRow.append(labelCell, valueCell, confidenceCell);
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

    const confidenceCell = document.createElement('td');
    confidenceCell.className = 'confidence-cell';
    confidenceCell.textContent = '未填';

    tableRow.append(labelCell, valueCell, confidenceCell);
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
    return {
      ...mappingItem,
      value: valueInput ? valueInput.value : mappingItem.value,
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
} {
  return {
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-4o-mini',
    layaModelUrl: layaModelUrlInput.value.trim(),
    layaEnabled: layaEnabledCheckbox.checked,
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
    });
    if (applyResponse.type !== 'APPLY_FILL_RESULT') {
      throw new Error('写入页面失败');
    }
    const misses = applyResponse.misses ?? [];
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
  showStatus(
    `已撤销 ${undoResponse.restored} 项，页面恢复到写入前。`,
    'success',
  );
}

async function runRescanFlow(profileId: string): Promise<void> {
  stopButton.hidden = false;
  showScanProgress(4, '正在滚动页面，已发现 0 个输入框。');
  try {
    const scanResult = await scanActivePage(createRequestId(), (progress) => {
      showScanProgress(progress.percent, progress.message);
    });
  const scannedFields = scanResult.fields;
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
  const planResponse = await requestFillPlanWithWait(
    createRequestId(),
    profileId,
    scannedFields,
    (elapsedSeconds) => {
      const waitPercent = Math.min(99, 90 + Math.floor(elapsedSeconds / 15));
      showScanProgress(waitPercent, `正在对照档案，已等待 ${elapsedSeconds} 秒。`);
    },
  );
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
  };
  await saveFillSession(pendingFillSession);
  currentSession = pendingFillSession;
  renderMappingTable();
  if (planResponse.notice) {
    showError(planResponse.notice);
  } else {
    showStatus(
      `扫完了：发现 ${scannedFields.length} 个输入框，其中 ${planResponse.plan.items.length} 项可以填。请核对下面的预览，确认后再写入。`,
      'success',
    );
  }
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
    showError(describeUserFacingError(error));
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

  stopButton.addEventListener('click', () => {
    void requestBackground({
      type: 'STOP_PAGE_WORK',
      requestId: createRequestId(),
    }).then(() => {
      showStatus('已要求停止，当前这一格结束后不再继续。', 'info');
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
        if (currentSession.notice) {
          showError(currentSession.notice);
        } else {
          showStatus(
            `扫完了：发现 ${currentSession.fields.length} 个输入框，其中 ${currentSession.plan.items.length} 项可以填。请核对下面的预览，确认后再写入。`,
            'success',
          );
        }
        await refreshUsageLine();
      }
    })();
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
      if (currentSession.notice) {
        showError(currentSession.notice);
      } else {
        showStatus(
          `扫完了：发现 ${currentSession.fields.length} 个输入框，其中 ${currentSession.plan.items.length} 项可以填。请核对下面的预览，确认后再写入。`,
          'success',
        );
      }
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
