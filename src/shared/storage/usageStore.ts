/**
 * 本机 Token 用量读写：仅存 chrome.storage.local，不上传。
 */
import {
  createEmptyTokenUsageStats,
  type LlmTokenUsage,
  type TokenUsageStats,
} from '../types/usage';

const USAGE_STORAGE_KEY = 'tokenUsageStats';

/**
 * 读取累计用量；无数据时返回空统计。
 */
export async function getTokenUsageStats(): Promise<TokenUsageStats> {
  const stored = await chrome.storage.local.get(USAGE_STORAGE_KEY);
  const raw = stored[USAGE_STORAGE_KEY];
  if (!raw || typeof raw !== 'object') {
    return createEmptyTokenUsageStats();
  }
  const record = raw as Partial<TokenUsageStats>;
  return {
    ...createEmptyTokenUsageStats(),
    ...record,
    lastCall: record.lastCall ?? null,
    lastCallAt: record.lastCallAt ?? null,
  };
}

/**
 * 累加一次 LLM 调用用量并写回。
 */
export async function recordTokenUsage(
  usage: LlmTokenUsage,
): Promise<TokenUsageStats> {
  const current = await getTokenUsageStats();
  const nextStats: TokenUsageStats = {
    totalPromptTokens: current.totalPromptTokens + usage.promptTokens,
    totalCompletionTokens:
      current.totalCompletionTokens + usage.completionTokens,
    totalTokens: current.totalTokens + usage.totalTokens,
    callCount: current.callCount + 1,
    lastCall: { ...usage },
    lastCallAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: nextStats });
  return nextStats;
}

/**
 * 清空累计用量（用户主动重置）。
 */
export async function resetTokenUsageStats(): Promise<TokenUsageStats> {
  const empty = createEmptyTokenUsageStats();
  await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: empty });
  return empty;
}

/**
 * 从 API JSON 中解析 usage；缺字段时按 0 处理。
 */
export function parseUsageFromPayload(payload: unknown): LlmTokenUsage | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const usageRaw = (payload as { usage?: unknown }).usage;
  if (!usageRaw || typeof usageRaw !== 'object') {
    return null;
  }
  const usageRecord = usageRaw as Record<string, unknown>;
  const promptTokens =
    typeof usageRecord.prompt_tokens === 'number'
      ? Math.max(0, Math.floor(usageRecord.prompt_tokens))
      : 0;
  const completionTokens =
    typeof usageRecord.completion_tokens === 'number'
      ? Math.max(0, Math.floor(usageRecord.completion_tokens))
      : 0;
  const totalFromApi =
    typeof usageRecord.total_tokens === 'number'
      ? Math.max(0, Math.floor(usageRecord.total_tokens))
      : promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalFromApi === 0) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalFromApi || promptTokens + completionTokens,
  };
}

/**
 * 格式化为简短中文展示。
 */
export function formatTokenUsageBrief(usage: LlmTokenUsage): string {
  return `提示 ${usage.promptTokens} · 补全 ${usage.completionTokens} · 合计 ${usage.totalTokens}`;
}
