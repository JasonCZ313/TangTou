/**
 * Popup 主逻辑：选档案、按 fillMode 执行扫描/规划/预览或直接填写、撤销与入口跳转。
 * 经 Background 编排 LLM；SCAN/APPLY/UNDO 经 Background 转发到活动标签 content。
 */
import { setActiveProfileId } from '../../shared/storage/profileStore';
import {
  formatTokenUsageBrief,
} from '../../shared/storage/usageStore';
import {
  createRequestId,
  sendRuntimeMessage,
} from '../../shared/messaging/send';
import type { ExtensionMessage } from '../../shared/types/messages';
import type { FieldDescriptor, FillPlan } from '../../shared/types/fill';
import type { AppSettings, Profile } from '../../shared/types/profile';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/**
 * Side Panel（Task 8）读取的会话待确认载荷：plan + 扫描字段（供展示 label）。
 * 存于 chrome.storage.session，键名 pendingFillSession。
 */
interface PendingFillSession {
  plan: FillPlan;
  fields: FieldDescriptor[];
}

/** 内存中的档案列表，供下拉渲染 */
let cachedProfiles: Profile[] = [];

/** 当前 settings.activeProfileId 缓存，用于同步「设为默认」勾选 */
let cachedActiveProfileId: string | null = null;

/** 是否正在执行填写/撤销等异步流程，用于禁用按钮防重复点击 */
let isBusy = false;

const profileSelect = document.getElementById(
  'profileSelect',
) as HTMLSelectElement;
const setDefaultCheckbox = document.getElementById(
  'setDefaultCheckbox',
) as HTMLInputElement;
const fillButton = document.getElementById('fillButton') as HTMLButtonElement;
const openSidePanelButton = document.getElementById(
  'openSidePanelButton',
) as HTMLButtonElement;
const openOptionsButton = document.getElementById(
  'openOptionsButton',
) as HTMLButtonElement;
const undoButton = document.getElementById('undoButton') as HTMLButtonElement;
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
 * 根据 isBusy 与是否有档案，同步按钮禁用状态。
 */
function syncBusyUi(): void {
  const hasProfiles = cachedProfiles.length > 0;
  const selectedProfileId = profileSelect.value;
  fillButton.disabled = isBusy || !hasProfiles || !selectedProfileId;
  undoButton.disabled = isBusy;
  openSidePanelButton.disabled = isBusy;
  openOptionsButton.disabled = isBusy;
  profileSelect.disabled = isBusy;
  setDefaultCheckbox.disabled = isBusy || !selectedProfileId;
}

/**
 * 将档案列表渲染到下拉；优先选中 activeProfileId，否则第一项。
 */
function renderProfileOptions(profiles: Profile[], activeProfileId: string | null): void {
  cachedProfiles = profiles;
  cachedActiveProfileId = activeProfileId;
  profileSelect.replaceChildren();

  if (profiles.length === 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '暂无档案，请先打开设置创建';
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

  const preferredId =
    activeProfileId && profiles.some((item) => item.id === activeProfileId)
      ? activeProfileId
      : profiles[0].id;
  profileSelect.value = preferredId;
  setDefaultCheckbox.checked = preferredId === activeProfileId;
  syncBusyUi();
}

/**
 * 根据当前下拉选中项，同步「设为默认档案」勾选状态（不写 storage）。
 */
function syncDefaultCheckboxFromSelection(): void {
  const selectedProfileId = profileSelect.value;
  setDefaultCheckbox.checked =
    Boolean(selectedProfileId) && selectedProfileId === cachedActiveProfileId;
}

/**
 * 向 Background 发消息；若响应为 ERROR 则抛出带中文 message 的 Error。
 * SCAN / APPLY / UNDO 亦经此路径，由 Background 转发到活动标签。
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
 * 从 Background 拉取 settings + profiles，刷新下拉与默认勾选。
 */
async function loadState(): Promise<{
  settings: AppSettings;
  profiles: Profile[];
}> {
  const response = await requestBackground({
    type: 'GET_STATE',
    requestId: createRequestId(),
  });
  if (response.type !== 'GET_STATE_RESULT') {
    throw new Error('无法读取扩展状态');
  }
  renderProfileOptions(response.profiles, response.settings.activeProfileId);
  return { settings: response.settings, profiles: response.profiles };
}

/**
 * 若勾选「设为默认档案」且当前选中与缓存默认不一致，则写入 activeProfileId。
 */
async function maybePersistDefaultProfile(profileId: string): Promise<void> {
  if (!setDefaultCheckbox.checked) {
    return;
  }
  if (profileId === cachedActiveProfileId) {
    return;
  }
  await setActiveProfileId(profileId);
  cachedActiveProfileId = profileId;
}

/**
 * 主填写流程：扫描字段 → Background 构建 FillPlan → 按 fillMode 预览或直接写入。
 * preview：写入 session pendingFillSession 并打开 Side Panel；direct：立即 APPLY。
 */
async function runFillFlow(profileId: string): Promise<void> {
  const scanResponse = await requestBackground({
    type: 'SCAN_FIELDS',
    requestId: createRequestId(),
  });
  if (scanResponse.type !== 'SCAN_FIELDS_RESULT') {
    throw new Error('扫描字段失败');
  }
  const scannedFields = scanResponse.fields;
  if (scannedFields.length === 0) {
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
  const fillPlan = planResponse.plan;

  const stateResponse = await requestBackground({
    type: 'GET_STATE',
    requestId: createRequestId(),
  });
  if (stateResponse.type !== 'GET_STATE_RESULT') {
    throw new Error('无法读取填写模式设置');
  }
  const { fillMode } = stateResponse.settings;

  if (fillMode === 'preview') {
    const pendingFillSession: PendingFillSession = {
      plan: fillPlan,
      fields: scannedFields,
    };
    await chrome.storage.session.set({ pendingFillSession });
    // 必须在 Popup 内直接 open：经 Background 会丢失「用户手势」导致失败
    await openSidePanelFromPopup();
    const usageTip =
      fillPlanResponseUsageText(planResponse.usage);
    showStatus(
      `已打开侧边助手，请核对后写入${usageTip}`,
      'success',
    );
    return;
  }

  const applyResponse = await requestBackground({
    type: 'APPLY_FILL_PLAN',
    requestId: createRequestId(),
    plan: fillPlan,
  });
  if (applyResponse.type !== 'APPLY_FILL_RESULT') {
    throw new Error('写入页面失败');
  }
  const usageTip = fillPlanResponseUsageText(planResponse.usage);
  showStatus(
    `已填写 ${applyResponse.filled} 项，跳过 ${applyResponse.skipped}${usageTip}`,
    'success',
  );
}

/**
 * 把 FILL_PLAN 带回的 usage 格式成状态后缀。
 */
function fillPlanResponseUsageText(
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null | undefined,
): string {
  if (!usage) {
    return '';
  }
  return ` · Token ${formatTokenUsageBrief(usage)}`;
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
 * 在 Popup 内直接打开当前标签的 Side Panel。
 * 不可经 Background 转发：chrome.sidePanel.open 要求保留用户点击手势。
 */
async function openSidePanelFromPopup(): Promise<void> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    throw new Error('无法确定当前标签页');
  }
  await chrome.sidePanel.open({ tabId });
}

/**
 * 打开与当前标签关联的 Side Panel（不生成新 plan）。
 */
async function openSidePanel(): Promise<void> {
  await openSidePanelFromPopup();
  showStatus('已打开侧边助手', 'success');
}

/**
 * 打开侧边助手并展开设置区（API / 建档案）。
 * 先标记 session（不 await），再立刻 open，避免丢失用户手势。
 */
async function openSettingsInSidePanel(): Promise<void> {
  void chrome.storage.session.set({ sidePanelFocusSettings: true });
  await openSidePanelFromPopup();
  showStatus('已打开侧边助手设置区', 'success');
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
 * 绑定 UI 事件并加载初始状态。
 */
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
        // 取消勾选：清除全局默认，避免静默不一致
        await setActiveProfileId(null);
        cachedActiveProfileId = null;
        showStatus('已取消默认档案', 'info');
      }
    });
  });

  fillButton.addEventListener('click', () => {
    void withBusy(async () => {
      const selectedProfileId = profileSelect.value;
      if (!selectedProfileId) {
        showError('请先选择档案');
        return;
      }
      showStatus('正在扫描并生成填写计划…', 'info');
      await maybePersistDefaultProfile(selectedProfileId);
      await runFillFlow(selectedProfileId);
    });
  });

  openSidePanelButton.addEventListener('click', () => {
    // 不经 withBusy 前置逻辑拖延：尽快响应点击手势
    void (async () => {
      try {
        await openSidePanel();
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : '无法打开侧边助手';
        showError(message);
      }
    })();
  });

  openOptionsButton.addEventListener('click', () => {
    void (async () => {
      try {
        await openSettingsInSidePanel();
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : '无法打开设置';
        showError(message);
      }
    })();
  });

  undoButton.addEventListener('click', () => {
    void withBusy(async () => {
      showStatus('正在撤销本轮填写…', 'info');
      await runUndoFlow();
    });
  });
}

/**
 * Popup 入口：绑定事件后拉取 GET_STATE 渲染档案下拉。
 */
async function bootstrapPopup(): Promise<void> {
  bindEvents();
  syncBusyUi();
  try {
    const { profiles } = await loadState();
    if (profiles.length === 0) {
      showStatus('暂无档案，请点击「打开设置」创建', 'info');
    } else {
      showStatus('就绪：扫描后请在侧边助手核对预览', 'info');
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : '初始化失败';
    showError(message);
  }
}

void bootstrapPopup();
