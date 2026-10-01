import { ensureHostPermission,
  requestResumeProfilePatch,
  requestTextPolish,
  testApiConnection,
} from '../shared/llm/openaiCompatible';
import { listProfiles, getProfile } from '../shared/storage/profileStore';
import { getSettings } from '../shared/storage/settingsStore';
import { listAttachments, readAttachmentFile } from '../shared/storage/attachmentStore';
import { normalizeProfileData } from '../shared/storage/normalize';
import { restoreResumePatchLineBreaks } from '../shared/resume/restoreListBreaks';
import { overlayResumeSections } from '../shared/resume/resumeSections';
import {
  getTokenUsageStats,
  recordTokenUsage,
  resetTokenUsageStats,
} from '../shared/storage/usageStore';
import type { ExtensionMessage } from '../shared/types/messages';
import { buildSectionAdds } from '../shared/fill/sectionAdds';
import { buildFillPlanViaDecision } from '../shared/decision/router';
import {
  clearLayaModelCache,
  downloadLayaModelFromUrl,
  enableBuiltinLayaChoicePackage,
  getLayaModelStatus,
} from '../shared/decision/layaModelStore';
import {
  enrichFieldsWithPageOcr,
  proposeFromPageOcr,
} from '../shared/decision/visionAssist';
import { hitsToSourcedItems } from '../shared/decision/toFillPlan';
import { sendToActiveTab } from '../shared/messaging/send';
import { describeUserFacingError } from '../shared/messaging/userFacingError';
import type { FieldDescriptor } from '../shared/types/fill';
import type { ProfileData } from '../shared/types/profile';
import { resolveSiteAdapter } from '../content/adapters/registry';

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
      const statusCode = errorMessage.slice('LLM_HTTP_'.length);
      return {
        code: 'LLM_HTTP',
        message: `模型接口返回了 ${statusCode}。请核对钥匙、模型名，以及地址是否以 https:// 开头。`,
      };
    }
    if (
      errorMessage === 'LLM_EMPTY_CONTENT' ||
      errorMessage === 'LLM_INVALID_SHAPE'
    ) {
      return {
        code: errorMessage,
        message: '模型没有返回能用的填写计划。请换一个模型，或稍后再试。',
      };
    }
    if (error.name === 'AbortError') {
      return {
        code: 'LLM_TIMEOUT',
        message: '模型超过等待时间还没返回。请检查网络和接口地址后再试。',
      };
    }
    return { code: 'UNKNOWN', message: describeUserFacingError(error) };
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
 * 消息里带了三项就用表单草稿测；没有才读本机已保存的设置。
 */
async function handleTestApi(
  message: Extract<ExtensionMessage, { type: 'TEST_API' }>,
): Promise<ExtensionMessage> {
  const requestId = message.requestId;
  const savedSettings = await getSettings();
  const apiBaseUrl = (message.apiBaseUrl ?? savedSettings.apiBaseUrl).trim();
  const apiKey = (message.apiKey ?? savedSettings.apiKey).trim();
  const model = (message.model ?? savedSettings.model).trim();
  if (!apiBaseUrl) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '请先填写 API Base URL',
    };
  }
  if (!apiKey) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '请先填写 API Key',
    };
  }

  const permissionGranted = await ensureHostPermission(apiBaseUrl);
  if (!permissionGranted) {
    return {
      type: 'TEST_API_RESULT',
      requestId,
      ok: false,
      detail: '未获得 API 主机访问权限',
    };
  }

  const testResult = await testApiConnection({
    apiBaseUrl,
    apiKey,
    model,
  });

  return {
    type: 'TEST_API_RESULT',
    requestId,
    ok: testResult.ok,
    detail: testResult.detail,
  };
}

/**
 * 读取当前活动标签的 hostname，解析站点适配器展示名。
 */
async function resolveActiveTabSiteAdapterName(): Promise<string | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tabs[0]?.url;
    if (!pageUrl) {
      return undefined;
    }
    const hostname = new URL(pageUrl).hostname;
    return resolveSiteAdapter(hostname)?.name;
  } catch {
    return undefined;
  }
}

/**
 * 对当前活动标签截图，并交给内容脚本做 OCR（P4b）。
 * 失败时返回空字符串与 notice，不抛错，以免挡住主填写链路。
 */
async function captureActiveTabOcrText(
  requestId: string,
): Promise<{ ocrText: string; notice?: string }> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    if (activeTab?.id === undefined || activeTab.windowId === undefined) {
      return { ocrText: '', notice: '没有活动标签，跳过截图识字' };
    }
    const imageDataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
      format: 'png',
    });
    const ocrResponse = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'RUN_PAGE_OCR',
      requestId,
      imageDataUrl,
    } satisfies ExtensionMessage);
    if (
      ocrResponse &&
      typeof ocrResponse === 'object' &&
      (ocrResponse as ExtensionMessage).type === 'RUN_PAGE_OCR_RESULT'
    ) {
      const typed = ocrResponse as Extract<
        ExtensionMessage,
        { type: 'RUN_PAGE_OCR_RESULT' }
      >;
      return { ocrText: typed.ocrText ?? '' };
    }
    if (
      ocrResponse &&
      typeof ocrResponse === 'object' &&
      (ocrResponse as ExtensionMessage).type === 'ERROR'
    ) {
      const typed = ocrResponse as Extract<ExtensionMessage, { type: 'ERROR' }>;
      return { ocrText: '', notice: typed.message };
    }
    return { ocrText: '', notice: '页内识字未返回结果' };
  } catch (error: unknown) {
    return {
      ocrText: '',
      notice: `截图识字跳过：${describeUserFacingError(error)}`,
    };
  }
}

/**
 * 把本机模型状态快照转成消息回执。
 */
async function handleLayaModelStatus(
  requestId: string,
): Promise<ExtensionMessage> {
  const status = await getLayaModelStatus();
  return {
    type: 'LAYA_MODEL_STATUS_RESULT',
    requestId,
    lifecycle: status.lifecycle,
    progressPercent: status.progressPercent,
    message: status.message,
    format: status.format,
    version: status.version,
    sourceUrl: status.sourceUrl,
    builtin: status.builtin,
    updatedAt: status.updatedAt,
  };
}

/**
 * 下载远端模型包（用消息里的 URL 或已保存设置）。
 */
async function handleLayaModelDownload(
  message: Extract<ExtensionMessage, { type: 'LAYA_MODEL_DOWNLOAD' }>,
): Promise<ExtensionMessage> {
  const settings = await getSettings();
  const modelUrl = (message.modelUrl ?? settings.layaModelUrl).trim();
  try {
    const status = await downloadLayaModelFromUrl(modelUrl);
    return {
      type: 'LAYA_MODEL_STATUS_RESULT',
      requestId: message.requestId,
      lifecycle: status.lifecycle,
      progressPercent: status.progressPercent,
      message: status.message,
      format: status.format,
      version: status.version,
      sourceUrl: status.sourceUrl,
      builtin: status.builtin,
      updatedAt: status.updatedAt,
    };
  } catch (error: unknown) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'LAYA_DOWNLOAD_FAILED',
      message:
        error instanceof Error ? error.message : describeUserFacingError(error),
    };
  }
}

/**
 * 启用内置轻量判断包。
 */
async function handleLayaModelEnableBuiltin(
  requestId: string,
): Promise<ExtensionMessage> {
  const status = await enableBuiltinLayaChoicePackage();
  return {
    type: 'LAYA_MODEL_STATUS_RESULT',
    requestId,
    lifecycle: status.lifecycle,
    progressPercent: status.progressPercent,
    message: status.message,
    format: status.format,
    version: status.version,
    sourceUrl: status.sourceUrl,
    builtin: status.builtin,
    updatedAt: status.updatedAt,
  };
}

/**
 * 清除本机模型缓存。
 */
async function handleLayaModelClear(
  requestId: string,
): Promise<ExtensionMessage> {
  const status = await clearLayaModelCache();
  return {
    type: 'LAYA_MODEL_STATUS_RESULT',
    requestId,
    lifecycle: status.lifecycle,
    progressPercent: status.progressPercent,
    message: status.message,
    format: status.format,
    version: status.version,
    sourceUrl: status.sourceUrl,
    builtin: status.builtin,
    updatedAt: status.updatedAt,
  };
}

/**
 * 单独触发截图 OCR（侧栏按钮 / 调试用）。
 */
async function handleCapturePageOcr(
  requestId: string,
): Promise<ExtensionMessage> {
  const result = await captureActiveTabOcrText(requestId);
  return {
    type: 'CAPTURE_PAGE_OCR_RESULT',
    requestId,
    ocrText: result.ocrText,
    notice: result.notice,
  };
}

/**
 * 处理 BUILD_FILL_PLAN：规则 → 本机 Laya → 云端；并尽力用截图 OCR 补强（P4b）。
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

  const settings = await getSettings();
  const hasApiConfigured =
    settings.apiBaseUrl.trim().length > 0 && settings.apiKey.trim().length > 0;

  if (hasApiConfigured) {
    const permissionGranted = await ensureHostPermission(settings.apiBaseUrl);
    if (!permissionGranted) {
      return {
        type: 'ERROR',
        requestId: message.requestId,
        code: 'HOST_PERMISSION_DENIED',
        message: '未获得 API 主机访问权限',
      };
    }
  }

  // P4b：截图识字（失败不挡主路径）
  const ocrCapture = await captureActiveTabOcrText(message.requestId);
  const fieldsForDecision: FieldDescriptor[] = enrichFieldsWithPageOcr(
    message.fields,
    ocrCapture.ocrText,
  );

  const attachments = await listAttachments(message.profileId);
  const decisionResult = await buildFillPlanViaDecision({
    profileData: profile.data,
    fields: fieldsForDecision,
    attachments,
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    layaEnabled: settings.layaEnabled,
    decisionPreferLocal: settings.decisionPreferLocal,
    decisionMinConfidence: settings.decisionMinConfidence,
    layaModelUrl: settings.layaModelUrl,
  });

  // 把 OCR 轻量提案并入计划：只补尚未有提案的字段，不覆盖主路径结果
  let plan = decisionResult.plan;
  let notice = decisionResult.notice;
  if (ocrCapture.ocrText.trim()) {
    const visionHits = proposeFromPageOcr(
      profile.data as ProfileData,
      message.fields,
      ocrCapture.ocrText,
      settings.decisionMinConfidence,
    );
    const filledIds = new Set(plan.items.map((item) => item.fieldId));
    const extraHits = visionHits.filter(
      (hit) => !filledIds.has(hit.fieldId),
    );
    if (extraHits.length > 0) {
      const visionSourced = hitsToSourcedItems(extraHits, 'local');
      plan = {
        ...plan,
        items: [
          ...plan.items,
          ...visionSourced.map(
            ({
              fieldId,
              value,
              confidence,
              reason,
              attachmentId,
              source,
            }) => ({
              fieldId,
              value,
              confidence,
              reason,
              attachmentId,
              source,
            }),
          ),
        ],
        skippedFieldIds: plan.skippedFieldIds.filter(
          (fieldId) =>
            !extraHits.some((hit) => hit.fieldId === fieldId),
        ),
      };
    }
  } else if (ocrCapture.notice) {
    notice = notice ?? ocrCapture.notice;
  }

  // 无 Key 且规则零命中：与旧行为一致，要求先配置 API
  if (!hasApiConfigured && plan.items.length === 0) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'API_NOT_CONFIGURED',
      message: '请先在设置中配置 API Base URL 与 API Key',
    };
  }

  if (decisionResult.usage) {
    await recordTokenUsage(decisionResult.usage);
  }

  const siteAdapterName = await resolveActiveTabSiteAdapterName();

  return {
    type: 'FILL_PLAN_RESULT',
    requestId: message.requestId,
    plan,
    usage: decisionResult.usage ?? null,
    notice,
    primaryEngine: decisionResult.primaryEngine,
    siteAdapterName,
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
 * 直填（空 plan）时从档案附件库取简历/头像，供页面规则写完后落 file 控件。
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
  // 无 plan 附件映射时：把档案里最新的简历/头像带上，交给内容脚本按文案匹配上传框
  if (filePayloads.length === 0 && message.profileId) {
    const attachmentRows = await listAttachments(message.profileId);
    const preferredKinds = ['resume', 'avatar', 'other'] as const;
    for (const kind of preferredKinds) {
      const row = attachmentRows.find((item) => item.kind === kind);
      if (!row) {
        continue;
      }
      const stored = await readAttachmentFile(row.id);
      if (!stored) {
        continue;
      }
      filePayloads.push({
        fieldId: `profile-attachment:${row.id}`,
        fileName: stored.meta.fileName,
        mimeType: stored.meta.mimeType,
        dataBase64: arrayBufferToBase64(stored.buffer),
      });
    }
  }
  const profile = message.profileId ? await getProfile(message.profileId) : null;
  return sendToActiveTab({
    ...message,
    filePayloads,
    sectionAdds: profile ? buildSectionAdds(profile.data) : message.sectionAdds,
    profileData: profile?.data,
  });
}

/**
 * 扫描出预览前：按档案条数只转发「补行」请求到页面（不写正文）。
 */
async function forwardEnsureSectionRows(
  message: Extract<ExtensionMessage, { type: 'ENSURE_SECTION_ROWS' }>,
): Promise<ExtensionMessage> {
  let sectionAdds = message.sectionAdds ?? [];
  if (message.profileId) {
    const profile = await getProfile(message.profileId);
    if (!profile) {
      return {
        type: 'ERROR',
        requestId: message.requestId,
        code: 'PROFILE_NOT_FOUND',
        message: '找不到选中的档案，请重新选择后再扫描。',
      };
    }
    sectionAdds = buildSectionAdds(profile.data);
  }
  if (sectionAdds.length === 0) {
    return {
      type: 'ENSURE_SECTION_ROWS_RESULT',
      requestId: message.requestId,
      clicks: 0,
      notices: [],
    };
  }
  return forwardToActiveTab({
    type: 'ENSURE_SECTION_ROWS',
    requestId: message.requestId,
    sectionAdds,
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
    profilePatch: normalizeProfileData(
      restoreResumePatchLineBreaks(
        overlayResumeSections(profilePatch, message.resumeText),
      ),
    ),
    usage,
  };
}

/**
 * 润色档案里的一段长文。用量记入现有 Token 累计。
 */
async function handlePolishText(
  message: Extract<ExtensionMessage, { type: 'POLISH_TEXT' }>,
): Promise<ExtensionMessage> {
  const sourceText = message.sourceText.trim();
  if (!sourceText) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'POLISH_EMPTY',
      message: '请先写下这段内容，再润色。',
    };
  }
  const customRequirement = message.customRequirement.trim();
  if ([...customRequirement].length > 30) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'POLISH_REQUIREMENT_TOO_LONG',
      message: '附加要求请控制在 30 个字以内。',
    };
  }
  const settings = await getSettings();
  if (!settings.apiBaseUrl.trim() || !settings.apiKey.trim()) {
    return {
      type: 'ERROR',
      requestId: message.requestId,
      code: 'API_NOT_CONFIGURED',
      message: '请先配置 API 后再润色。',
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
  const { passage, usage } = await requestTextPolish({
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    fieldName: message.fieldName,
    sourceText,
    customRequirement,
    onProgress: (percent) => {
      void chrome.runtime
        .sendMessage({
          type: 'POLISH_PROGRESS',
          requestId: message.requestId,
          percent,
        } satisfies ExtensionMessage)
        .then(
          () => undefined,
          () => undefined,
        );
    },
  });
  if (usage) {
    await recordTokenUsage(usage);
  }
  return {
    type: 'POLISH_TEXT_RESULT',
    requestId: message.requestId,
    headline: passage.headline,
    body: passage.body,
    usage,
  };
}

/**
 * 当前标签没有内容脚本时，Chrome 会用这句英文拒绝连接。
 */
function isMissingContentScript(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return /receiving end does not exist|could not establish connection/i.test(detail);
}

/**
 * 往当前普通网页注入扫描脚本。浏览器自己的页面会换成中文说明。
 */
async function injectContentScriptIntoActiveTab(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (activeTab?.id === undefined) {
    throw new Error('找不到当前标签页。请先点一下网申页面，再试。');
  }
  const pageUrl = activeTab.url ?? '';
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error(
      '这一页不是普通网申网页，躺投只能扫描以 http 或 https 开头的页面。请切到网申页再试。',
    );
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content-scripts/content.js'],
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : '';
    if (/cannot be scripted|cannot access|restricted|gallery/i.test(detail)) {
      throw new Error('这一页不允许扩展注入脚本。请换到普通的网申网页再试。');
    }
    throw new Error('扫描脚本没能装进这个页面。请刷新网申页后再试。');
  }
}

/**
 * 把扫描、写入、撤销发到当前页。页面还没有脚本时先注入一次再发。
 */
async function forwardToActiveTab(
  message: ExtensionMessage,
): Promise<ExtensionMessage> {
  try {
    return await sendToActiveTab(message);
  } catch (error: unknown) {
    if (!isMissingContentScript(error)) {
      throw error;
    }
    await injectContentScriptIntoActiveTab();
    return await sendToActiveTab(message);
  }
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
      return handleTestApi(message);
    case 'BUILD_FILL_PLAN':
      return handleBuildFillPlan(message);
    case 'LAYA_MODEL_STATUS':
      return handleLayaModelStatus(message.requestId);
    case 'LAYA_MODEL_DOWNLOAD':
      return handleLayaModelDownload(message);
    case 'LAYA_MODEL_ENABLE_BUILTIN':
      return handleLayaModelEnableBuiltin(message.requestId);
    case 'LAYA_MODEL_CLEAR':
      return handleLayaModelClear(message.requestId);
    case 'CAPTURE_PAGE_OCR':
      return handleCapturePageOcr(message.requestId);
    case 'OPEN_SIDE_PANEL':
      return handleOpenSidePanel(message.requestId, sender.tab?.id);
    case 'RESET_TOKEN_USAGE':
      return handleResetTokenUsage(message.requestId);
    case 'APPLY_FILL_PLAN':
      return forwardApplyWithFiles(message);
    case 'ENSURE_SECTION_ROWS':
      return forwardEnsureSectionRows(message);
    case 'PARSE_RESUME':
      return handleParseResume(message);
    case 'POLISH_TEXT':
      return handlePolishText(message);
    case 'POLISH_PROGRESS':
      return message;
    case 'SCAN_PROGRESS':
    case 'SCAN_FIELDS_RESULT':
      return message;
    case 'PAGE_OVERLAY_UPDATE':
    case 'PAGE_OVERLAY_HIDE':
    case 'SCAN_FIELDS':
    case 'STOP_PAGE_WORK':
    case 'UNDO_LAST_FILL':
      return forwardToActiveTab(message);
    default:
      return {
        type: 'ERROR',
        requestId: 'requestId' in message ? message.requestId : '',
        code: 'UNKNOWN_MESSAGE',
        message: '扩展还在用旧版本。请在扩展管理页对躺投点一次重新加载后再试。',
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
