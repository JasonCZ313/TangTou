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
  createRequestId,
  sendRuntimeMessage,
} from '../../shared/messaging/send';
import type { ExtensionMessage } from '../../shared/types/messages';
import type { FieldDescriptor, FillPlan } from '../../shared/types/fill';
import type { FillMode, Profile } from '../../shared/types/profile';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/**
 * Popup / 本页扫描写入的会话载荷。
 * 存于 chrome.storage.session，键名 pendingFillSession。
 */
interface PendingFillSession {
  plan: FillPlan;
  fields: FieldDescriptor[];
}

/** Popup「打开设置」写入，侧栏启动时展开设置区 */
const FOCUS_SETTINGS_SESSION_KEY = 'sidePanelFocusSettings';

let cachedProfiles: Profile[] = [];
let cachedActiveProfileId: string | null = null;
let currentSession: PendingFillSession | null = null;
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
const fillModePreview = document.getElementById(
  'fillModePreview',
) as HTMLInputElement;
const fillModeDirect = document.getElementById(
  'fillModeDirect',
) as HTMLInputElement;
const testApiButton = document.getElementById(
  'testApiButton',
) as HTMLButtonElement;
const createProfileForm = document.getElementById(
  'createProfileForm',
) as HTMLFormElement;
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
const skippedSummaryElement = document.getElementById(
  'skippedSummary',
) as HTMLParagraphElement;
const confirmButton = document.getElementById(
  'confirmButton',
) as HTMLButtonElement;
const undoButton = document.getElementById('undoButton') as HTMLButtonElement;
const rescanButton = document.getElementById(
  'rescanButton',
) as HTMLButtonElement;
const statusMessageElement = document.getElementById(
  'statusMessage',
) as HTMLParagraphElement;

const EMPTY_MAPPING_HINT =
  '尚未生成预览。日常请用右上角 Popup「扫描并填写」；也可在此「扫描本页」。';

function showStatus(message: string, kind: StatusKind = 'info'): void {
  statusMessageElement.textContent = message;
  statusMessageElement.classList.remove('is-info', 'is-success', 'is-error');
  statusMessageElement.classList.add(`is-${kind}`);
}

function showError(message: string): void {
  showStatus(message, 'error');
}

/**
 * 有预览时「确认写入」为 primary；无预览时「扫描本页」升为 primary。
 */
function syncActionButtonHierarchy(): void {
  const hasPlanItems =
    currentSession !== null && currentSession.plan.items.length > 0;
  if (hasPlanItems) {
    confirmButton.className = 'btn btn-primary action-confirm';
    rescanButton.className = 'btn btn-secondary action-scan';
  } else {
    confirmButton.className = 'btn btn-secondary action-confirm';
    rescanButton.className = 'btn btn-primary action-scan';
  }
}

function syncBusyUi(): void {
  const hasProfiles = cachedProfiles.length > 0;
  const selectedProfileId = profileSelect.value;
  const hasPlanItems =
    currentSession !== null && currentSession.plan.items.length > 0;
  const atLimit = cachedProfiles.length >= MAX_PROFILES;

  confirmButton.disabled = isBusy || !hasPlanItems;
  undoButton.disabled = isBusy;
  rescanButton.disabled = isBusy || !hasProfiles || !selectedProfileId;
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
  fillMode: FillMode;
}): void {
  apiBaseUrlInput.value = settings.apiBaseUrl;
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  fillModePreview.checked = settings.fillMode === 'preview';
  fillModeDirect.checked = settings.fillMode === 'direct';
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

function renderMappingTable(): void {
  mappingTableBody.replaceChildren();

  if (!currentSession || currentSession.plan.items.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
    emptyCell.textContent = EMPTY_MAPPING_HINT;
    emptyRow.appendChild(emptyCell);
    mappingTableBody.appendChild(emptyRow);
    skippedSummaryElement.hidden = true;
    skippedSummaryElement.textContent = '';
    syncBusyUi();
    return;
  }

  const { plan, fields } = currentSession;
  for (const mappingItem of plan.items) {
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
    valueInput.setAttribute(
      'aria-label',
      `${resolveFieldLabel(mappingItem.fieldId, fields)} 填写值`,
    );
    valueCell.appendChild(valueInput);

    const confidenceCell = document.createElement('td');
    confidenceCell.className = 'confidence-cell';
    confidenceCell.textContent = formatConfidencePercent(
      mappingItem.confidence,
    );

    tableRow.append(labelCell, valueCell, confidenceCell);
    mappingTableBody.appendChild(tableRow);
  }

  const skippedCount = plan.skippedFieldIds.length;
  if (skippedCount > 0) {
    skippedSummaryElement.hidden = false;
    skippedSummaryElement.textContent = `另有 ${skippedCount} 个字段已跳过（未映射）`;
  } else {
    skippedSummaryElement.hidden = true;
    skippedSummaryElement.textContent = '';
  }
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

async function loadPendingSession(): Promise<PendingFillSession | null> {
  const storageSnapshot = await chrome.storage.session.get('pendingFillSession');
  const rawSession = storageSnapshot.pendingFillSession as
    | PendingFillSession
    | undefined;
  if (!rawSession || !rawSession.plan || !Array.isArray(rawSession.plan.items)) {
    return null;
  }
  return {
    plan: rawSession.plan,
    fields: Array.isArray(rawSession.fields) ? rawSession.fields : [],
  };
}

async function clearPendingSession(): Promise<void> {
  await chrome.storage.session.remove('pendingFillSession');
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
  return {
    items: editedItems,
    skippedFieldIds: [...currentSession.plan.skippedFieldIds],
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
 * 保存 API / 填写模式到本机。
 */
async function handleSaveSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const fillMode: FillMode = fillModeDirect.checked ? 'direct' : 'preview';
  await saveSettings({
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-4o-mini',
    fillMode,
  });
  showStatus('设置已保存到本机', 'success');
}

/**
 * 经 Background 测试 API 连通性（先保存当前表单值再测）。
 */
async function handleTestApi(): Promise<void> {
  const fillMode: FillMode = fillModeDirect.checked ? 'direct' : 'preview';
  await saveSettings({
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'gpt-4o-mini',
    fillMode,
  });
  showStatus('正在测试连接…', 'info');
  const response = await requestBackground({
    type: 'TEST_API',
    requestId: createRequestId(),
  });
  if (response.type !== 'TEST_API_RESULT') {
    throw new Error('测试连接失败');
  }
  showStatus(
    response.ok ? `连接成功：${response.detail}` : `连接失败：${response.detail}`,
    response.ok ? 'success' : 'error',
  );
}

/**
 * 在侧栏直接新建档案（不打开 Options）。
 */
async function handleCreateProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const name = newProfileNameInput.value.trim();
  if (!name) {
    showError('请填写档案名称');
    return;
  }
  if (cachedProfiles.length >= MAX_PROFILES) {
    showError(`最多 ${MAX_PROFILES} 份档案`);
    return;
  }
  const created = await createProfile({ name });
  newProfileNameInput.value = '';
  const profiles = await listProfiles();
  const settings = await getSettings();
  renderProfileOptions(profiles, settings.activeProfileId ?? created.id);
  profileSelect.value = created.id;
  showStatus(`已创建档案「${created.name}」，可点下方按钮编辑完整简历`, 'success');
}

/**
 * 完整简历编辑器：新标签打开 Options（不盖在扩展管理页上）。
 */
function openFullOptionsEditor(): void {
  const optionsUrl = chrome.runtime.getURL('/options.html');
  void chrome.tabs.create({ url: optionsUrl });
}

async function runConfirmWrite(): Promise<void> {
  if (!currentSession || currentSession.plan.items.length === 0) {
    showError('没有可写入的映射项');
    return;
  }
  const editedPlan = collectEditedFillPlan();
  const applyResponse = await requestBackground({
    type: 'APPLY_FILL_PLAN',
    requestId: createRequestId(),
    plan: editedPlan,
  });
  if (applyResponse.type !== 'APPLY_FILL_RESULT') {
    throw new Error('写入页面失败');
  }
  await clearPendingSession();
  renderMappingTable();
  showStatus(
    `已填写 ${applyResponse.filled} 项，跳过 ${applyResponse.skipped}`,
    'success',
  );
}

async function runUndoFlow(): Promise<void> {
  const undoResponse = await requestBackground({
    type: 'UNDO_LAST_FILL',
    requestId: createRequestId(),
  });
  if (undoResponse.type !== 'UNDO_FILL_RESULT') {
    throw new Error('撤销失败');
  }
  showStatus(`已撤销 ${undoResponse.restored} 项`, 'success');
}

async function runRescanFlow(profileId: string): Promise<void> {
  showStatus('正在扫描本页并生成填写计划…', 'info');
  const scanResponse = await requestBackground({
    type: 'SCAN_FIELDS',
    requestId: createRequestId(),
  });
  if (scanResponse.type !== 'SCAN_FIELDS_RESULT') {
    throw new Error('扫描字段失败');
  }
  const scannedFields = scanResponse.fields;
  if (scannedFields.length === 0) {
    await clearPendingSession();
    renderMappingTable();
    showStatus('当前页未扫描到可填字段', 'info');
    return;
  }
  const planResponse = await requestBackground({
    type: 'BUILD_FILL_PLAN',
    requestId: createRequestId(),
    profileId,
    fields: scannedFields,
  });
  if (planResponse.type !== 'FILL_PLAN_RESULT') {
    throw new Error('生成填写计划失败');
  }
  const pendingFillSession: PendingFillSession = {
    plan: planResponse.plan,
    fields: scannedFields,
  };
  await chrome.storage.session.set({ pendingFillSession });
  currentSession = pendingFillSession;
  renderMappingTable();
  showStatus(
    `已生成预览：${planResponse.plan.items.length} 项可填，可改值后确认写入`,
    'success',
  );
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
    const message =
      error instanceof Error && error.message
        ? error.message
        : '操作失败，请稍后重试';
    showError(message);
  } finally {
    isBusy = false;
    syncBusyUi();
  }
}

function bindEvents(): void {
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
    void withBusy(async () => {
      await handleCreateProfile(event);
    });
  });

  openFullEditorButton.addEventListener('click', () => {
    openFullOptionsEditor();
  });

  confirmButton.addEventListener('click', () => {
    void withBusy(async () => {
      showStatus('正在确认写入…', 'info');
      await runConfirmWrite();
    });
  });

  undoButton.addEventListener('click', () => {
    void withBusy(async () => {
      showStatus('正在撤销本轮填写…', 'info');
      await runUndoFlow();
    });
  });

  rescanButton.addEventListener('click', () => {
    void withBusy(async () => {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        showError('请先选择档案');
        return;
      }
      await runRescanFlow(selectedProfileId);
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
    if (!changes.pendingFillSession || isBusy) {
      return;
    }
    void (async () => {
      currentSession = await loadPendingSession();
      renderMappingTable();
      if (currentSession && currentSession.plan.items.length > 0) {
        showStatus(
          `已加载预览：${currentSession.plan.items.length} 项可填`,
          'info',
        );
      }
    })();
  });
}

async function bootstrapSidePanel(): Promise<void> {
  bindEvents();
  syncBusyUi();
  try {
    await loadState();
    await maybeFocusSettingsFromPopup();
    currentSession = await loadPendingSession();
    renderMappingTable();

    if (cachedProfiles.length === 0) {
      showStatus('请先在上方「设置与新建档案」创建档案并填写 API', 'info');
    } else if (currentSession && currentSession.plan.items.length > 0) {
      showStatus(
        `已加载预览：${currentSession.plan.items.length} 项可填，可改值后确认写入`,
        'info',
      );
    } else {
      showStatus(
        '日常扫描请用右上角 Popup；设置请展开上方区域',
        'info',
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : '初始化失败';
    showError(message);
  }
}

void bootstrapSidePanel();
