/**
 * Popup 主逻辑：选档案、一键「扫描并填写」、撤销与入口跳转。
 * 流程与侧边助手完全一致：点一次就扫完并写完，不再按 fillMode 分流。
 * SCAN/APPLY/UNDO 经 Background 转发到活动标签 content。
 */
import { setActiveProfileId } from '../../shared/storage/profileStore';
import {
  createRequestId,
  sendRuntimeMessage,
} from '../../shared/messaging/send';
import { scanActivePage } from '../../shared/messaging/pageScan';
import { describeUserFacingError } from '../../shared/messaging/userFacingError';
import { mountAppVersionLabel } from '../../shared/appVersion';
import type { ExtensionMessage } from '../../shared/types/messages';
import type { AppSettings, Profile } from '../../shared/types/profile';

/** 状态区视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/** 内存中的档案列表，供下拉渲染 */
let cachedProfiles: Profile[] = [];

/** 当前 settings.activeProfileId 缓存，用于同步「设为默认」勾选 */
let cachedActiveProfileId: string | null = null;

/**
 * 打开弹窗时记下的当前标签。
 * 点击里再去查标签会先 await，浏览器就不再承认这是一次用户点击。
 */
let popupTabId: number | undefined;

/** 弹窗一出现就记下当前网申标签，供后面打开侧栏时同步使用。 */
const popupTabReady = chrome.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs) => {
    popupTabId = tabs[0]?.id;
  });

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
 * 主填写流程：扫描本页 → 直接写入。
 * 与侧边助手的「扫描并填写」是同一条路：点一次就扫完并写完，中途不再二次确认。
 *
 * 为什么不再按 fillMode 分流：预览模式原来只把扫描甩给侧栏，
 * 弹窗自己一次也不写，于是出现「弹窗点了只扫描、侧栏点了才填写」的差异。
 * 为什么不再先要一份 LLM 计划：真正写入用的是 content 里的规则引擎
 * （applyFillPlan 不消费 plan），先要计划只是白等一次网络往返。
 */
async function runFillFlow(profileId: string): Promise<void> {
  stopButton.hidden = false;
  try {
    showScanProgress(4, '正在扫描页面，准备一面扫一面写。');
    const scanResult = await scanActivePage(createRequestId(), (progress) => {
      showScanProgress(Math.min(40, progress.percent), progress.message);
    });
    const scannedFields = scanResult.fields;
    if (scannedFields.length === 0) {
      showScanProgress(100, scanResult.notice ?? '没有扫到输入框。');
      showError(
        scanResult.notice ??
          '这一页没有扫到可以填写的输入框。请确认打开的是网申表单，展开折叠区域后再试一次。',
      );
      return;
    }

    showScanProgress(50, `发现 ${scannedFields.length} 个输入框，开始写入…`);
    const applyResponse = await requestBackground({
      type: 'APPLY_FILL_PLAN',
      requestId: createRequestId(),
      plan: { items: [], skippedFieldIds: [] },
      profileId,
    });
    if (applyResponse.type !== 'APPLY_FILL_RESULT') {
      throw new Error('写入页面失败');
    }
    const missCount = applyResponse.misses?.length ?? 0;
    showScanProgress(100, `写入结束，成功 ${applyResponse.filled} 项。`);
    showStatus(
      missCount > 0
        ? `已经写入 ${applyResponse.filled} 项。还有 ${missCount} 项没写上，可打开侧边助手看「没写上的」表。`
        : `已经写入 ${applyResponse.filled} 项。请在页面上检查，需要的话可以撤销本轮。`,
      missCount > 0 ? 'error' : 'success',
    );
  } finally {
    stopButton.hidden = true;
  }
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
 * 在这次点击里立刻打开侧栏。
 * 前面不能再 await：浏览器只承认点击处理函数同步发出的 sidePanel.open。
 */
function openSidePanelForCurrentTab(): Promise<void> {
  if (popupTabId === undefined) {
    return Promise.reject(new Error('无法确定当前标签页'));
  }
  return chrome.sidePanel.open({ tabId: popupTabId });
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
    const selectedProfileId = profileSelect.value;
    if (!selectedProfileId) {
      showError('请先选择档案');
      return;
    }
    // 与侧边助手的「扫描并填写」完全一致：点一次就扫描并写入，不再按填写模式分流。
    void withBusy(async () => {
      showStatus('正在扫描并写入本页…', 'info');
      await maybePersistDefaultProfile(selectedProfileId);
      await runFillFlow(selectedProfileId);
    });
  });

  openSidePanelButton.addEventListener('click', () => {
    // 同步发出 open，中间不再查标签、不再进 withBusy。
    void openSidePanelForCurrentTab()
      .then(() => {
        showStatus('已打开侧边助手', 'success');
      })
      .catch((error: unknown) => {
        showError(describeUserFacingError(error));
      });
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

  stopButton.addEventListener('click', () => {
    void requestBackground({
      type: 'STOP_PAGE_WORK',
      requestId: createRequestId(),
    }).then(() => {
      showStatus('已要求停止，当前这一格结束后不再继续。', 'info');
    });
  });
}

/**
 * Popup 入口：绑定事件后拉取 GET_STATE 渲染档案下拉。
 */
async function bootstrapPopup(): Promise<void> {
  mountAppVersionLabel();
  await popupTabReady;
  bindEvents();
  syncBusyUi();
  try {
    const { profiles } = await loadState();
    if (profiles.length === 0) {
      showStatus('暂无档案，请点击「打开设置」创建', 'info');
    } else {
      showStatus('就绪：点「扫描并填写」即可自动填写本页', 'info');
    }
  } catch (error: unknown) {
    showError(describeUserFacingError(error));
  }
}

void bootstrapPopup();
