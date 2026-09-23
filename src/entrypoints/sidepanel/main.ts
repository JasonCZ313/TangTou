/**
 * Side Panel 主逻辑：读取预览会话、编辑映射表、确认写入 / 撤销 / 重新扫描。
 * 经 Background 编排 BUILD_FILL_PLAN；APPLY/UNDO/SCAN 经 Background 转发到活动标签。
 */
import {
  createRequestId,
  sendRuntimeMessage,
} from '../../shared/messaging/send';
import type { ExtensionMessage } from '../../shared/types/messages';
import type { FieldDescriptor, FillPlan } from '../../shared/types/fill';
import type { Profile } from '../../shared/types/profile';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/**
 * Popup 预览模式写入的会话载荷：plan + 扫描字段（供展示 label）。
 * 存于 chrome.storage.session，键名 pendingFillSession。
 */
interface PendingFillSession {
  plan: FillPlan;
  fields: FieldDescriptor[];
}

/** 内存中的档案列表，供下拉渲染 */
let cachedProfiles: Profile[] = [];

/** 当前待确认会话（含可编辑 plan）；无预览时为 null */
let currentSession: PendingFillSession | null = null;

/** 是否正在执行异步流程，用于禁用按钮防重复点击 */
let isBusy = false;

const profileSelect = document.getElementById(
  'profileSelect',
) as HTMLSelectElement;
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

/**
 * 在状态区展示文案；kind 控制成功/错误/提示配色。
 */
function showStatus(message: string, kind: StatusKind = 'info'): void {
  statusMessageElement.textContent = message;
  statusMessageElement.classList.remove('is-info', 'is-success', 'is-error');
  statusMessageElement.classList.add(`is-${kind}`);
}

/**
 * 展示错误文案（红色状态区）。
 */
function showError(message: string): void {
  showStatus(message, 'error');
}

/**
 * 根据 isBusy、档案与是否有 plan items，同步按钮禁用状态。
 */
function syncBusyUi(): void {
  const hasProfiles = cachedProfiles.length > 0;
  const selectedProfileId = profileSelect.value;
  const hasPlanItems =
    currentSession !== null && currentSession.plan.items.length > 0;

  confirmButton.disabled = isBusy || !hasPlanItems;
  undoButton.disabled = isBusy;
  rescanButton.disabled = isBusy || !hasProfiles || !selectedProfileId;
  profileSelect.disabled = isBusy;
}

/**
 * 将档案列表渲染到下拉；优先选中 preferredProfileId，否则第一项。
 */
function renderProfileOptions(
  profiles: Profile[],
  preferredProfileId: string | null,
): void {
  cachedProfiles = profiles;
  profileSelect.replaceChildren();

  if (profiles.length === 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '暂无档案，请先打开设置创建';
    profileSelect.appendChild(emptyOption);
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
  syncBusyUi();
}

/**
 * 按 fieldId 从 fields 取 label；找不到则回退 fieldId。
 */
function resolveFieldLabel(
  fieldId: string,
  fields: FieldDescriptor[],
): string {
  const matchedField = fields.find(
    (fieldItem) => fieldItem.fieldId === fieldId,
  );
  if (matchedField?.label) {
    return matchedField.label;
  }
  return fieldId;
}

/**
 * 将 0..1 置信度格式化为百分比文案（如 92%）。
 */
function formatConfidencePercent(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * 用当前会话渲染可编辑映射表；无会话时显示空态。
 */
function renderMappingTable(): void {
  mappingTableBody.replaceChildren();

  if (!currentSession || currentSession.plan.items.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
    emptyCell.textContent =
      '暂无预览计划，请先在 Popup 扫描或点击「重新扫描」';
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

    tableRow.appendChild(labelCell);
    tableRow.appendChild(valueCell);
    tableRow.appendChild(confidenceCell);
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

/**
 * 向 Background 发消息；若响应为 ERROR 则抛出带中文 message 的 Error。
 */
async function requestBackground(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  const response = await sendRuntimeMessage(message);
  if (response.type === 'ERROR') {
    throw new Error(response.message || response.code || '请求失败');
  }
  return response;
}

/**
 * 从 chrome.storage.session 读取 pendingFillSession；无效则返回 null。
 */
async function loadPendingSession(): Promise<PendingFillSession | null> {
  const storageSnapshot = await chrome.storage.session.get('pendingFillSession');
  const rawSession = storageSnapshot.pendingFillSession as
    | PendingFillSession
    | undefined;
  if (!rawSession || !rawSession.plan || !Array.isArray(rawSession.plan.items)) {
    return null;
  }
  if (!Array.isArray(rawSession.fields)) {
    return {
      plan: rawSession.plan,
      fields: [],
    };
  }
  return {
    plan: rawSession.plan,
    fields: rawSession.fields,
  };
}

/**
 * 清除 session 中的 pendingFillSession，并清空内存会话。
 */
async function clearPendingSession(): Promise<void> {
  await chrome.storage.session.remove('pendingFillSession');
  currentSession = null;
}

/**
 * 从表格输入框收集用户编辑后的 FillPlan（保留原 confidence / skipped）。
 */
function collectEditedFillPlan(): FillPlan {
  if (!currentSession) {
    return { items: [], skippedFieldIds: [] };
  }

  const editedItems = currentSession.plan.items.map((mappingItem) => {
    const valueInput = mappingTableBody.querySelector(
      `input.value-input[data-field-id="${CSS.escape(mappingItem.fieldId)}"]`,
    ) as HTMLInputElement | null;
    const editedValue = valueInput ? valueInput.value : mappingItem.value;
    return {
      ...mappingItem,
      value: editedValue,
    };
  });

  return {
    items: editedItems,
    skippedFieldIds: [...currentSession.plan.skippedFieldIds],
  };
}

/**
 * 从 Background 拉取 settings + profiles，刷新档案下拉。
 */
async function loadState(): Promise<void> {
  const response = await requestBackground({
    type: 'GET_STATE',
    requestId: createRequestId(),
  });
  if (response.type !== 'GET_STATE_RESULT') {
    throw new Error('无法读取扩展状态');
  }
  renderProfileOptions(
    response.profiles,
    response.settings.activeProfileId,
  );
}

/**
 * 确认写入：收集编辑后的 FillPlan → APPLY_FILL_PLAN → 清除 pending session。
 */
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

/**
 * 撤销当前页上一轮填写（经 Background 转发 UNDO_LAST_FILL）。
 */
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

/**
 * 重新扫描：SCAN_FIELDS → BUILD_FILL_PLAN → 刷新表格并写回 session。
 */
async function runRescanFlow(profileId: string): Promise<void> {
  showStatus('正在重新扫描并生成填写计划…', 'info');

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
    `已刷新预览：${planResponse.plan.items.length} 项可填`,
    'success',
  );
}

/**
 * 包装异步操作：进入 busy、捕获错误并展示中文提示。
 */
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

/**
 * 绑定 UI 事件。
 */
function bindEvents(): void {
  profileSelect.addEventListener('change', () => {
    syncBusyUi();
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

  // 会话被 Popup 等写入时自动刷新表格（同窗口多入口）
  chrome.storage.session.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') {
      return;
    }
    if (!changes.pendingFillSession) {
      return;
    }
    if (isBusy) {
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

/**
 * Side Panel 入口：绑定事件、拉档案、读 pendingFillSession 渲染表格。
 */
async function bootstrapSidePanel(): Promise<void> {
  bindEvents();
  syncBusyUi();
  try {
    await loadState();
    currentSession = await loadPendingSession();
    renderMappingTable();

    if (cachedProfiles.length === 0) {
      showStatus('暂无档案，请先在设置页创建档案', 'info');
    } else if (currentSession && currentSession.plan.items.length > 0) {
      showStatus(
        `已加载预览：${currentSession.plan.items.length} 项可填，可改值后确认写入`,
        'info',
      );
    } else {
      showStatus('暂无预览计划：可点「重新扫描」或从 Popup 进入预览', 'info');
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
