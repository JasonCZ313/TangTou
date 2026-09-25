import type { FillMappingItem, FillPlan } from '../types/fill';
import { parseUsageFromPayload } from '../storage/usageStore';
import type { LlmTokenUsage } from '../types/usage';
import {
  POLISH_SYSTEM_PROMPT,
  buildPolishUserMessage,
  parsePolishedPassage,
  type PolishedPassage,
} from './polishPrompt';

/** Chat Completions 请求体中的单条消息 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 将任意数值夹紧到 [0, 1]，供 FillPlan.confidence 规范化。
 * 非有限数字视为 0，避免 NaN/Infinity 进入填写路径。
 */
function clampConfidence(rawConfidence: unknown): number {
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    return 0;
  }
  if (rawConfidence < 0) {
    return 0;
  }
  if (rawConfidence > 1) {
    return 1;
  }
  return rawConfidence;
}

/**
 * 规范化并校验 LLM 返回的 FillPlan：
 * - 每项须有 string 类型的 fieldId / value，否则丢弃；
 * - confidence 夹紧到 0..1；
 * - skippedFieldIds 仅保留非空字符串。
 * 非法 item 不进入后续 UI / 写入路径，避免静默异常。
 */
export function normalizeFillPlan(rawPlan: {
  items: unknown[];
  skippedFieldIds: unknown[];
}): FillPlan {
  const normalizedItems: FillMappingItem[] = [];

  for (const rawItem of rawPlan.items) {
    if (rawItem === null || typeof rawItem !== 'object') {
      continue;
    }
    const candidate = rawItem as Record<string, unknown>;
    if (typeof candidate.fieldId !== 'string' || candidate.fieldId.length === 0) {
      continue;
    }
    if (typeof candidate.value !== 'string') {
      continue;
    }
    const mappingItem: FillMappingItem = {
      fieldId: candidate.fieldId,
      value: candidate.value,
      confidence: clampConfidence(candidate.confidence),
    };
    if (typeof candidate.reason === 'string') {
      mappingItem.reason = candidate.reason;
    }
    normalizedItems.push(mappingItem);
  }

  const normalizedSkipped: string[] = [];
  for (const rawSkippedId of rawPlan.skippedFieldIds) {
    if (typeof rawSkippedId === 'string' && rawSkippedId.length > 0) {
      normalizedSkipped.push(rawSkippedId);
    }
  }

  return {
    items: normalizedItems,
    skippedFieldIds: normalizedSkipped,
  };
}

/** requestFillPlan 的入参：仅允许 background 传入 apiKey */
export interface RequestFillPlanOptions {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

/**
 * 根据用户配置的 API 根地址，请求对应主机的 optional host permission。
 * 测连与 BUILD_FILL_PLAN 前必须调用；已授权则直接返回 true。
 */
export async function ensureHostPermission(
  apiBaseUrl: string,
): Promise<boolean> {
  const parsedUrl = new URL(apiBaseUrl);
  const originPattern = `${parsedUrl.protocol}//${parsedUrl.host}/*`;
  const alreadyGranted = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (alreadyGranted) {
    return true;
  }
  return chrome.permissions.request({ origins: [originPattern] });
}

/**
 * 判断 HTTP 错误文案是否像「不支持 response_format」类拒绝，便于去掉该字段重试。
 */
function isResponseFormatRejection(
  statusCode: number,
  errorBodyText: string,
): boolean {
  if (statusCode !== 400 && statusCode !== 422) {
    return false;
  }
  return /response_format|json_object|unknown.?parameter|unsupported/i.test(
    errorBodyText,
  );
}

/**
 * 判断 HTTP 错误是不是拒绝了 stream 参数。只在这种拒绝时才去掉 stream 再发一次。
 */
function isStreamRejection(statusCode: number, errorBodyText: string): boolean {
  if (statusCode !== 400 && statusCode !== 422) {
    return false;
  }
  return /stream/i.test(errorBodyText) && /unsupported|unknown|not support|invalid|unrecognized/i.test(
    errorBodyText,
  );
}

/**
 * 向 OpenAI 兼容端点发起一次 Chat Completions 请求。
 * useJsonObjectFormat 为 true 时附带 response_format；部分本地/兼容服务不支持该字段。
 */
async function postChatCompletions(args: {
  endpointUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  useJsonObjectFormat: boolean;
  useStream?: boolean;
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<Response> {
  const requestBody: Record<string, unknown> = {
    model: args.model,
    temperature: args.temperature,
    messages: args.messages,
  };
  if (args.useJsonObjectFormat) {
    requestBody.response_format = { type: 'json_object' };
  }
  if (args.useStream) {
    requestBody.stream = true;
  }
  if (args.maxTokens !== undefined) {
    requestBody.max_tokens = args.maxTokens;
  }

  return fetch(args.endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: args.signal,
  });
}

/**
 * 调用 OpenAI 兼容 Chat Completions，解析为 FillPlan，并尽量带回 usage。
 * apiKey 仅在此函数参数中出现，调用方必须是 background。
 * 若服务端拒绝 response_format，则去掉该字段自动重试一次。
 */
export async function requestFillPlan(
  options: RequestFillPlanOptions,
): Promise<{ plan: FillPlan; usage: LlmTokenUsage | null }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];

  try {
    let response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      temperature: 0.1,
      useJsonObjectFormat: true,
      signal: controller.signal,
    });

    if (!response.ok) {
      const firstErrorText = await response.text();
      if (isResponseFormatRejection(response.status, firstErrorText)) {
        response = await postChatCompletions({
          endpointUrl,
          apiKey: options.apiKey,
          model: options.model,
          messages,
          temperature: 0.1,
          useJsonObjectFormat: false,
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryErrorText = await response.text();
          throw new Error(
            `LLM_HTTP_${response.status}: ${retryErrorText.slice(0, 200)}`,
          );
        }
      } else {
        throw new Error(
          `LLM_HTTP_${response.status}: ${firstErrorText.slice(0, 200)}`,
        );
      }
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }

    const parsed = JSON.parse(content) as {
      items?: unknown;
      skippedFieldIds?: unknown;
    };
    if (
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.skippedFieldIds)
    ) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    const plan = normalizeFillPlan({
      items: parsed.items,
      skippedFieldIds: parsed.skippedFieldIds,
    });
    const usage = parseUsageFromPayload(payload);
    return { plan, usage };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 用极小 messages 探测 API 是否可用（测连），不解析 FillPlan。
 * 成功返回 ok:true；失败返回 ok:false 与截断后的 detail（绝不回显 apiKey）。
 */
export async function testApiConnection(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );

  try {
    const response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0,
      useJsonObjectFormat: false,
      maxTokens: 5,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        detail: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    return { ok: true, detail: '连接成功' };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 200) : '未知错误';
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按固定润色标准改写一段长文。apiKey 只在 background 里使用。
 * 只为参数被拒绝再发一次；结果格式不好时在本地修复，不再重叫模型。
 */
export async function requestTextPolish(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  fieldName: string;
  sourceText: string;
  customRequirement: string;
  timeoutMs?: number;
  onProgress?: (percent: number) => void;
}): Promise<{ passage: PolishedPassage; usage: LlmTokenUsage | null }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: POLISH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildPolishUserMessage(
        options.fieldName,
        options.sourceText,
        options.customRequirement,
      ),
    },
  ];
  const expectedCharacters = Math.min(
    Math.ceil([...options.sourceText.trim()].length * 1.7),
    320,
  ) + 16;
  const reportPartial = (fullText: string): void => {
    if (!options.onProgress) {
      return;
    }
    const receivedCharacters = [...fullText].length;
    const percent = Math.max(
      8,
      Math.min(92, Math.round((receivedCharacters / expectedCharacters) * 100)),
    );
    options.onProgress(percent);
  };

  try {
    let useJsonObjectFormat = true;
    let useStream = true;
    let response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      temperature: 0.2,
      useJsonObjectFormat,
      useStream,
      maxTokens: 1600,
      signal: controller.signal,
    });
    if (!response.ok) {
      const firstErrorText = await response.text();
      const rejectFormat = isResponseFormatRejection(response.status, firstErrorText);
      const rejectStream = isStreamRejection(response.status, firstErrorText);
      if (!rejectFormat && !rejectStream) {
        throw new Error(
          `LLM_HTTP_${response.status}: ${firstErrorText.slice(0, 200)}`,
        );
      }
      useJsonObjectFormat = rejectFormat ? false : useJsonObjectFormat;
      useStream = rejectStream ? false : useStream;
      response = await postChatCompletions({
        endpointUrl,
        apiKey: options.apiKey,
        model: options.model,
        messages,
        temperature: 0.2,
        useJsonObjectFormat,
        useStream,
        maxTokens: 1600,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryErrorText = await response.text();
        throw new Error(
          `LLM_HTTP_${response.status}: ${retryErrorText.slice(0, 200)}`,
        );
      }
    }
    const collected = await collectChatCompletionText(response, reportPartial);
    const content = collected.content;
    if (content.trim().length === 0) {
      throw new Error('模型没有返回能用的润色结果。请再试一次。');
    }
    return {
      passage: parsePolishedPassage(content),
      usage: parseUsageFromPayload(collected.usagePayload),
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error('模型没有返回能用的润色结果。请再试一次。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 message.content 收成一段文字。有的接口把正文放在数组里。
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      textParts.push(part);
      continue;
    }
    if (
      part &&
      typeof part === 'object' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      textParts.push((part as { text: string }).text);
    }
  }
  return textParts.join('');
}

/**
 * 从非流式响应里取出正文。正文为空时再看思考字段里有没有结果。
 */
function extractMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const message = (
    payload as {
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
    }
  ).choices?.[0]?.message;
  const directText = messageText(message?.content);
  if (directText.trim()) {
    return directText;
  }
  return typeof message?.reasoning_content === 'string' ? message.reasoning_content : '';
}

/**
 * 读完一次 Chat Completions。流式时按已收到的文字回调。
 */
async function collectChatCompletionText(
  response: Response,
  onPartial: (fullText: string) => void,
): Promise<{ content: string; usagePayload: unknown }> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = (await response.json()) as unknown;
    const content = extractMessageContent(payload);
    onPartial(content);
    return { content, usagePayload: payload };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingText = '';
  let visibleText = '';
  let reasoningText = '';
  let usagePayload: unknown = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pendingText += decoder.decode(value, { stream: true });
    const lines = pendingText.split(/\r?\n/);
    pendingText = lines.pop() ?? '';
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('data:')) {
        continue;
      }
      const dataText = trimmedLine.slice(5).trim();
      if (!dataText || dataText === '[DONE]') {
        continue;
      }
      let eventPayload: {
        choices?: Array<{
          delta?: { content?: unknown; reasoning_content?: unknown };
          message?: { content?: unknown };
        }>;
        usage?: unknown;
      };
      try {
        eventPayload = JSON.parse(dataText) as typeof eventPayload;
      } catch {
        continue;
      }
      const delta = eventPayload.choices?.[0]?.delta;
      const visiblePiece = messageText(
        delta?.content ?? eventPayload.choices?.[0]?.message?.content,
      );
      const reasoningPiece =
        typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
      if (visiblePiece) {
        visibleText += visiblePiece;
      }
      if (reasoningPiece) {
        reasoningText += reasoningPiece;
      }
      if (eventPayload.usage) {
        usagePayload = eventPayload;
      }
      onPartial(visibleText || reasoningText);
    }
  }

  const content = visibleText.trim() ? visibleText : reasoningText;
  return { content, usagePayload };
}

const RESUME_PARSE_SYSTEM = `你是简历结构化助手。根据用户给出的简历纯文本，输出一个 JSON 对象，结构尽量接近：
{"basic":{"fullName":"","phone":"","email":"","currentCity":"","nationality":"","nativePlace":"","gender":"","birthday":""},"jobIntent":{"targetRole":""},"education":[{"school":"","degreeLevel":"","major":"","startDate":"","endDate":"","description":"","skillsInvolved":""}],"experience":[{"company":"","title":"","startDate":"","endDate":"","description":"","responsibilities":"","workContent":"","achievements":"","skillsInvolved":""}],"projects":[{"name":"","role":"","duty":"","description":"","content":"","value":"","techStack":""}],"campusActivities":[{"organization":"","role":"","description":"","skillsInvolved":""}],"skills":[{"name":""}],"certificates":[{"name":"","level":"","skillsInvolved":""}],"awards":[{"name":"","level":"","prizeRank":"","skillsInvolved":""}],"publications":[{"kind":"","title":"","skillsInvolved":""}],"trainings":[{"organization":"","course":"","skillsInvolved":""}],"essays":{"selfEvaluation":""}}
规则：只填写简历里明确出现的信息；没有的字段省略或留空字符串；日期尽量 YYYY-MM-DD；不要编造；不要 markdown。
标题用词不同也要归类，不要因为不是完全相同的四个字就丢掉：
- 「证书」「资格证书」「专业证书」「技能证书」写入 certificates，每个名称一条。
- 「获奖」「获奖情况」「奖项」「荣誉」写入 awards。名称放 name，一等奖、二等奖、金奖等放 prizeRank，校级、省级、国家级放 level，不要混在一起。
- 「我的价值」「个人优势」「自我评价」「个人介绍」整段写入 essays.selfEvaluation，保留原文换行。
- 某一段教育、实习、校园、证书、奖项、论文专利著作或培训里写明用到的技能，写入该条的 skillsInvolved，多项用顿号分隔。项目用到的技术写入该条 techStack，不要再写 skillsInvolved。项目职责写入 duty，最多12个字，不要把项目内容整段放进去。整份简历的技能清单仍写入 skills，不要把总清单复制进每一条。
姓名、电话、邮箱、日期、学校、公司、职位各占一行，字符串里不要加换行。
description、responsibilities、workContent、achievements、content、value 里，简历中每一条要点单独一行，用换行符 \\n 分隔。同一条在栏宽处折行的后半句要接回这一条，不要拆开。禁止把多条要点并成一整段。`;

/**
 * 把简历纯文本交给模型，解析成可合并的档案 JSON，并带回 usage。
 */
export async function requestResumeProfilePatch(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  resumeText: string;
  timeoutMs?: number;
}): Promise<{ profilePatch: Record<string, unknown>; usage: LlmTokenUsage | null }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: RESUME_PARSE_SYSTEM },
    { role: 'user', content: options.resumeText },
  ];
  try {
    let response = await postChatCompletions({
      endpointUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages,
      temperature: 0.1,
      useJsonObjectFormat: true,
      signal: controller.signal,
    });
    if (!response.ok) {
      const firstErrorText = await response.text();
      if (isResponseFormatRejection(response.status, firstErrorText)) {
        response = await postChatCompletions({
          endpointUrl,
          apiKey: options.apiKey,
          model: options.model,
          messages,
          temperature: 0.1,
          useJsonObjectFormat: false,
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryErrorText = await response.text();
          throw new Error(
            `LLM_HTTP_${response.status}: ${retryErrorText.slice(0, 200)}`,
          );
        }
      } else {
        throw new Error(
          `LLM_HTTP_${response.status}: ${firstErrorText.slice(0, 200)}`,
        );
      }
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }
    const jsonText = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    return {
      profilePatch: parsed as Record<string, unknown>,
      usage: parseUsageFromPayload(payload),
    };
  } finally {
    clearTimeout(timer);
  }
}
