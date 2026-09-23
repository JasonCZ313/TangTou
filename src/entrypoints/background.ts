import { buildFillPrompt } from '../shared/llm/prompt';
import {
  ensureHostPermission,
  requestFillPlan,
  testApiConnection,
} from '../shared/llm/openaiCompatible';
import { listProfiles, getProfile } from '../shared/storage/profileStore';
import { getSettings } from '../shared/storage/settingsStore';
import type { ExtensionMessage } from '../shared/types/messages';
import { sendToActiveTab } from '../shared/messaging/send';

/**
 * 将未知错误归一化为可展示的 code + message（绝不包含 apiKey）。
 */
function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const errorMessage = error.message;
    if (errorMessage === 'PROFILE_NOT_FOUND') {
      return { code: 'PROFILE_NOT_FOUND', message: '未找到所选档案' };
    }
    if (errorMessage === 'HOST_PERMISSION_DENIED') {
      return {
        code: 'HOST_PERMISSION_DENIED',
        message: '未获得 API 主机访问权限',
      };
    }
    if (errorMessage.startsWith('LLM_HTTP_')) {
      return { code: 'LLM_HTTP', message: errorMessage };
    }
    if (
      errorMessage === 'LLM_EMPTY_CONTENT' ||
      errorMessage === 'LLM_INVALID_SHAPE'
    ) {
      return { code: errorMessage, message: '模型返回内容无效' };
    }
    if (error.name === 'AbortError') {
      return { code: 'LLM_TIMEOUT', message: '请求超时' };
    }
    return { code: 'UNKNOWN', message: errorMessage.slice(0, 200) };
  }
  return { code: 'UNKNOWN', message: '未知错误' };
}

/**
 * 构造 ERROR 响应消息，供 UI 展示。
 */
function buildErrorResponse(
  requestId: string,
  error: unknown,
): ExtensionMessage {
  const normalized = normalizeError(error);
  return {
    type: 'ERROR',
    requestId,
    code: normalized.code,
    message: normalized.message,
  };
}

/**
 * 处理 GET_STATE：返回 settings（可含 apiKey，仅扩展源 UI）与全部 profiles。
 * 若消息来自网页标签（content script），拒绝，避免 apiKey 泄露到页面上下文。
 * 禁止在日志中打印 apiKey。
 */
async function handleGetState(
  requestId: string,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  // sender.tab 有值表示来自 content script / 网页标签，禁止下发密钥
  if (sender.tab) {
    return {
      type: 'ERROR',
      requestId,
      code: 'FORBIDDEN',
      message: '不允许从网页上下文读取密钥',
    };
  }
  const [settings, profiles] = await Promise.all([
    getSettings(),
    listProfiles(),
  ]);
  return {
    type: 'GET_STATE_RESULT',
    requestId,
    settings,
    profiles,
  };
}

/**
 * 处理 TEST_API：先申请主机权限，再用最小 messages 测连。
 * Options 页「测试连接」依赖本处理。
 */
async function handleTestApi(requestId: string): Promise<ExtensionMessage> {
  const settings = await getSettings();
  if (!settings.apiBaseUrl.trim()) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '请先填写 API Base URL',
    };
  }
  if (!settings.apiKey.trim()) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '请先填写 API Key',
    };
  }

  const permissionGranted = await ensureHostPermission(settings.apiBaseUrl);
  if (!permissionGranted) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '未获得 API 主机访问权限',
    };
  }

  const testResult = await testApiConnection({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
  });

  return {
    type: 'TEST_API_RESULT',
    requestId,
    ok: testResult.ok,
    detail: testResult.detail,
  };
}

/**
 * 处理 BUILD_FILL_PLAN：读取档案、构造 prompt、仅在 background 用 apiKey 调 LLM。
 * 失败返回 ERROR；成功返回 FILL_PLAN_RESULT。绝不向 content 转发 apiKey。
 */
async function handleBuildFillPlan(
  message: Extract<ExtensionMessage, { type: 'BUILD_FILL_PLAN' }>,
): Promise<ExtensionMessage> {
  const settings = await getSettings();
  if (!settings.apiBaseUrl.trim() || !settings.apiKey.trim()) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'API_NOT_CONFIGURED',
      message: '请先在设置中配置 API Base URL 与 API Key',
    };
  }

  const permissionGranted = await ensureHostPermission(settings.apiBaseUrl);
  if (!permissionGranted) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'HOST_PERMISSION_DENIED',
      message: '未获得 API 主机访问权限',
    };
  }

  const profile = await getProfile(message.profileId);
  if (!profile) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'PROFILE_NOT_FOUND',
      message: '未找到所选档案',
    };
  }

  const { system, user } = buildFillPrompt(profile.data, message.fields);
  const plan = await requestFillPlan({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    system,
    user,
  });

  return {
    type: 'FILL_PLAN_RESULT',
    requestId: message.requestId,
    plan,
  };
}

/**
 * 处理 OPEN_SIDE_PANEL：打开与当前标签关联的侧边栏。
 * tabId 优先取 sender.tab，否则取当前窗口活动标签。
 */
async function handleOpenSidePanel(
  requestId: string,
  senderTabId: number | undefined,
): Promise<ExtensionMessage> {
  let tabId = senderTabId;
  if (tabId === undefined) {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tabs[0]?.id;
  }
  if (tabId === undefined) {
    return {
      type: 'ERROR',
      requestId,
      code: 'NO_ACTIVE_TAB',
      message: '无法确定当前标签页',
    };
  }

  await chrome.sidePanel.open({ tabId });
  // 专用成功 ack，不附带 settings/apiKey
  return {
    type: 'OPEN_SIDE_PANEL_RESULT',
    requestId,
    ok: true,
  };
}

/**
 * 将 SCAN_FIELDS / APPLY_FILL_PLAN / UNDO_LAST_FILL 转发到活动标签页 content script。
 * 供 Popup 等无法直接 tabs.sendMessage 时经 background 中转（也可直接用 shared sendToActiveTab）。
 */
async function forwardToActiveTab(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  return sendToActiveTab(message);
}

/**
 * 按消息 type 分发到对应处理器；未识别类型返回 ERROR。
 */
async function dispatchMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  switch (message.type) {
    case 'GET_STATE':
      return handleGetState(message.requestId, sender);
    case 'TEST_API':
      return handleTestApi(message.requestId);
    case 'BUILD_FILL_PLAN':
      return handleBuildFillPlan(message);
    case 'OPEN_SIDE_PANEL':
      return handleOpenSidePanel(message.requestId, sender.tab?.id);
    case 'SCAN_FIELDS':
    case 'APPLY_FILL_PLAN':
    case 'UNDO_LAST_FILL':
      return forwardToActiveTab(message);
    default:
      return {
        type: 'ERROR',
        requestId: 'requestId' in message ? message.requestId : '',
        code: 'UNKNOWN_MESSAGE',
        message: `未处理的消息类型: ${message.type}`,
      };
  }
}

/**
 * Background 服务工作者入口：注册 Side Panel 行为与消息编排中枢。
 * API Key 仅在本上下文中用于 fetch，永不写入发往 content 的载荷。
 */
export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, sender, sendResponse) => {
      dispatchMessage(message, sender)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error: unknown) => {
          const requestId =
            message && typeof message === 'object' && 'requestId' in message
              ? String(message.requestId)
              : '';
          sendResponse(buildErrorResponse(requestId, error));
        });
      // 异步 sendResponse 必须返回 true 以保持消息通道
      return true;
    },
  );

  console.log('[Resume Autofill] background ready');
});
