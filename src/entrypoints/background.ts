import { applyLocalHeuristics } from '../shared/llm/localHeuristics';
import { buildFillPrompt } from '../shared/llm/prompt';
import {
  ensureHostPermission,
  requestFillPlan,
  requestResumeProfilePatch,
  testApiConnection,
} from '../shared/llm/openaiCompatible';
import { listProfiles, getProfile } from '../shared/storage/profileStore';
import { getSettings } from '../shared/storage/settingsStore';
import { listAttachments, readAttachmentFile } from '../shared/storage/attachmentStore';
import { normalizeProfileData } from '../shared/storage/normalize';
import {
  getTokenUsageStats,
  recordTokenUsage,
  resetTokenUsageStats,
} from '../shared/storage/usageStore';
import type { FillPlan } from '../shared/types/fill';
import type { ExtensionMessage } from '../shared/types/messages';
import { sendToActiveTab } from '../shared/messaging/send';

/** 无 API Key 仅用启发式填写时的用户提示文案 */
const HEURISTICS_ONLY_TIP = '未配置 API，仅填写高置信基础字段';

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
 * 判断消息是否来自本扩展的 UI 页（options / popup / sidepanel 等）。
 * 扩展页以标签打开时也会带 sender.tab，不能单靠 tab 判定；
 * 真正危险的是 content script（url 为 http(s) 页面）。
 */
function isTrustedExtensionUiSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  // 其它扩展发来的消息一律不信任
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
  // 本扩展页面：即使挂了 tab 也允许读取 settings（含 apiKey）
  if (typeof sender.url === 'string' && sender.url.startsWith(extensionOrigin)) {
    return true;
  }
  // 无 tab、且为本扩展或未标明 id：兼容部分扩展上下文
  if (!sender.tab && (!sender.id || sender.id === chrome.runtime.id)) {
    return true;
  }
  return false;
}

/**
 * 处理 GET_STATE：返回 settings（可含 apiKey，仅扩展源 UI）与全部 profiles。
 * 仅拦截 content script / 外站上下文，避免 apiKey 泄露到页面。
 * 禁止在日志中打印 apiKey。
 */
async function handleGetState(
  requestId: string,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionMessage> {
  if (!isTrustedExtensionUiSender(sender)) {
    return {
      type: 'ERROR',
      requestId,
      code: 'FORBIDDEN',
      message: '不允许从网页上下文读取密钥',
    };
  }
  const [settings, profiles, tokenUsage] = await Promise.all([
    getSettings(),
    listProfiles(),
    getTokenUsageStats(),
  ]);
  return {
    type: 'GET_STATE_RESULT',
    requestId,
    settings,
    profiles,
    tokenUsage,
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
 * 合并本地启发式 items 与 LLM 计划：同一 fieldId 以启发式为准，LLM 重复项丢弃。
 */
function mergeHeuristicAndLlmPlan(
  heuristicPlan: FillPlan,
  llmPlan: FillPlan,
): FillPlan {
  const heuristicFieldIds = new Set(
    heuristicPlan.items.map((item) => item.fieldId),
  );
  const llmItemsWithoutHeuristicOverlap = llmPlan.items.filter(
    (item) => !heuristicFieldIds.has(item.fieldId),
  );
  return {
    items: [...heuristicPlan.items, ...llmItemsWithoutHeuristicOverlap],
    skippedFieldIds: [
      ...new Set([
        ...heuristicPlan.skippedFieldIds,
        ...llmPlan.skippedFieldIds,
      ]),
    ],
  };
}

/**
 * 处理 BUILD_FILL_PLAN：先跑本地启发式，仅将剩余字段送 LLM；无 Key 时软降级返回部分计划。
 * 失败返回 ERROR；成功返回 FILL_PLAN_RESULT。绝不向 content 转发 apiKey。
 */
async function handleBuildFillPlan(
  message: Extract<ExtensionMessage, { type: 'BUILD_FILL_PLAN' }>,
): Promise<ExtensionMessage> {
  const profile = await getProfile(message.profileId);
  if (!profile) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'PROFILE_NOT_FOUND',
      message: '未找到所选档案',
    };
  }

  // 先本地高置信映射，降低 Token；未命中字段再考虑调模型
  const attachments = await listAttachments(message.profileId);
  const { partialPlan, remainingFields } = applyLocalHeuristics(
    profile.data,
    message.fields,
    attachments,
  );

  const settings = await getSettings();
  const hasApiConfigured =
    settings.apiBaseUrl.trim().length > 0 && settings.apiKey.trim().length > 0;

  // 无 Key：有启发式命中则返回部分计划（剩余字段进 skipped）；零命中才报错
  if (!hasApiConfigured) {
    if (partialPlan.items.length === 0) {
      return {
        type: 'ERROR',
        requestId: message.requestId,
        code: 'API_NOT_CONFIGURED',
        message: '请先在设置中配置 API Base URL 与 API Key',
      };
    }
    const tippedItems = partialPlan.items.map((item) => ({
      ...item,
      reason: item.reason
        ? `${item.reason}；${HEURISTICS_ONLY_TIP}`
        : HEURISTICS_ONLY_TIP,
    }));
    return {
      type: 'FILL_PLAN_RESULT',
      requestId: message.requestId,
      plan: {
        items: tippedItems,
        skippedFieldIds: remainingFields.map((field) => field.fieldId),
      },
    };
  }

  // 启发式已覆盖全部字段，无需调 LLM
  if (remainingFields.length === 0) {
    return {
      type: 'FILL_PLAN_RESULT',
      requestId: message.requestId,
      plan: partialPlan,
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

  const { system, user } = buildFillPrompt(profile.data, remainingFields);
  const { plan: llmPlan, usage } = await requestFillPlan({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    system,
    user,
  });

  // 有 usage 则累加到本机统计（部分兼容接口不返回 usage）
  if (usage) {
    await recordTokenUsage(usage);
  }

  return {
    type: 'FILL_PLAN_RESULT',
    requestId: message.requestId,
    plan: mergeHeuristicAndLlmPlan(partialPlan, llmPlan),
    usage: usage ?? null,
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
 * 清空本机累计 Token 用量。
 */
async function handleResetTokenUsage(
  requestId: string,
): Promise<ExtensionMessage> {
  const tokenUsage = await resetTokenUsageStats();
  return {
    type: 'RESET_TOKEN_USAGE_RESULT',
    requestId,
    tokenUsage,
  };
}

/**
 * 把 ArrayBuffer 转成 Base64，分块避免展开大数组撑爆调用栈。
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binaryText = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    binaryText += String.fromCharCode(...slice);
  }
  return btoa(binaryText);
}

/**
 * 给填写计划附上附件字节后再转发到页面。
 */
async function forwardApplyWithFiles(
  message: Extract<ExtensionMessage, { type: 'APPLY_FILL_PLAN' }>,
): Promise<ExtensionMessage> {
  const filePayloads: NonNullable<
    Extract<ExtensionMessage, { type: 'APPLY_FILL_PLAN' }>['filePayloads']
  > = [];
  for (const mappingItem of message.plan.items) {
    if (!mappingItem.attachmentId) {
      continue;
    }
    const stored = await readAttachmentFile(mappingItem.attachmentId);
    if (!stored) {
      continue;
    }
    filePayloads.push({
      fieldId: mappingItem.fieldId,
      fileName: stored.meta.fileName,
      mimeType: stored.meta.mimeType,
      dataBase64: arrayBufferToBase64(stored.buffer),
    });
  }
  return sendToActiveTab({
    ...message,
    filePayloads,
  });
}

/**
 * 用简历纯文本识别档案补丁（只返回结构，由选项页合并空白项）。
 */
async function handleParseResume(
  message: Extract<ExtensionMessage, { type: 'PARSE_RESUME' }>,
): Promise<ExtensionMessage> {
  const settings = await getSettings();
  if (!settings.apiBaseUrl.trim() || !settings.apiKey.trim()) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'API_NOT_CONFIGURED',
      message: '请先配置 API 后再识别简历',
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
  const { profilePatch, usage } = await requestResumeProfilePatch({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    resumeText: message.resumeText,
  });
  if (usage) {
    await recordTokenUsage(usage);
  }
  return {
    type: 'PARSE_RESUME_RESULT',
    requestId: message.requestId,
    profilePatch: normalizeProfileData(profilePatch),
    usage,
  };
}

/**
 * 将 SCAN_FIELDS / UNDO_LAST_FILL 转发到活动标签页 content script。
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
    case 'RESET_TOKEN_USAGE':
      return handleResetTokenUsage(message.requestId);
    case 'APPLY_FILL_PLAN':
      return forwardApplyWithFiles(message);
    case 'PARSE_RESUME':
      return handleParseResume(message);
    case 'SCAN_FIELDS':
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
