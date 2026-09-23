import type { FillPlan } from '../types/fill';

/** Chat Completions 请求体中的单条消息 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
 * 调用 OpenAI 兼容 Chat Completions，解析为 FillPlan。
 * apiKey 仅在此函数参数中出现，调用方必须是 background。
 * 若服务端拒绝 response_format，则去掉该字段自动重试一次。
 */
export async function requestFillPlan(
  options: RequestFillPlanOptions,
): Promise<FillPlan> {
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
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }

    const parsed = JSON.parse(content) as FillPlan;
    if (
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.skippedFieldIds)
    ) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    return parsed;
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
