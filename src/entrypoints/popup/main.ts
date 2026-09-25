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
import {
  requestFillPlanWithWait,
  scanActivePage,
} from '../../shared/messaging/pageScan';
import { describeUserFacingError } from '../../shared/messaging/userFacingError';
import { mountAppVersionLabel } from '../../shared/appVersion';
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
  /** 模型超时等仍要在侧栏红框里说明的话 */
  notice?: string;
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
 * 更新扫描读条：百分比、当前动作，以及已经发现多少输入框。
 */
function showScanProgress(percent: number, message: string): void {
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  scanProgressElement.hidden = false;
  scanProgressFill.style.width = `${clampedPercent}%`;
  scanProgressLabel.textContent = `${message} ${clampedPercent}%`;
  scanProgressTrack.setAttribute('aria-valuenow', String(clampedPercent));
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
  const scanResult = await scanActivePage(createRequestId(), (progress) => {
    showScanProgress(progress.percent, progress.message);
  });
  const scannedFields = scanResult.fields;
  if (scannedFields.length === 0) {
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
      notice: planResponse.notice,
    };
    await chrome.storage.session.set({ pendingFillSession });
    // 必须在 Popup 内直接 open：经 Background 会丢失「用户手势」导致失败
    await openSidePanelFromPopup();
    const usageTip = fillPlanResponseUsageText(planResponse.usage);
    if (planResponse.notice) {
      showError(`${planResponse.notice} 侧边助手已打开，可以先核对本机配上的项。`);
      return;
    }
    showStatus(
      `扫完了：发现 ${scannedFields.length} 个输入框，其中 ${fillPlan.items.length} 项可以填。侧边助手已打开，请在那里核对后再写入。${usageTip}`,
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
  if (planResponse.notice) {
    showError(
      `${planResponse.notice} 已经写入 ${applyResponse.filled} 项，跳过 ${applyResponse.skipped} 项。`,
    );
    return;
  }
  showStatus(
    `已经写入 ${applyResponse.filled} 项，跳过 ${applyResponse.skipped} 项。请在页面上检查，需要的话可以撤销本轮。${usageTip}`,
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
  showStatus(
    `已撤销 ${undoResponse.restored} 项，页面恢复到写入前。`,
    'success',
  );
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
 * 在新标签页打开完整档案编辑页（Options），不打开侧边栏。
 */
function openProfileOptionsPage(): void {
  const optionsUrl = chrome.runtime.getURL('/options.html');
  void chrome.tabs.create({ url: optionsUrl });
  showStatus('已在新标签打开档案编辑页', 'success');
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
    showError(describeUserFacingError(error));
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
      showStatus('正在滚动页面，已发现 0 个输入框。', 'info');
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
        showError(describeUserFacingError(error));
      }
    })();
  });

  openOptionsButton.addEventListener('click', () => {
    void (async () => {
      try {
        openProfileOptionsPage();
      } catch (error: unknown) {
        showError(describeUserFacingError(error));
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
  mountAppVersionLabel();
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
    showError(describeUserFacingError(error));
  }
}

void bootstrapPopup();
