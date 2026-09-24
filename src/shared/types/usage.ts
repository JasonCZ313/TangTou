/**
 * Token 用量类型：来自 OpenAI 兼容接口的 usage 字段。
 */
export interface LlmTokenUsage {
  /** 提示（输入）token */
  promptTokens: number;
  /** 补全（输出）token */
  completionTokens: number;
  /** 合计；若接口未给 total 则用 prompt+completion */
  totalTokens: number;
}

/**
 * 本机累计的用量统计（与 API Key 一样只存本地）。
 */
export interface TokenUsageStats {
  /** 累计提示 token */
  totalPromptTokens: number;
  /** 累计补全 token */
  totalCompletionTokens: number;
  /** 累计总 token */
  totalTokens: number;
  /** 调用次数（含测连以外的正式填写 LLM 调用） */
  callCount: number;
  /** 最近一次调用用量；尚无则为 null */
  lastCall: LlmTokenUsage | null;
  /** 最近一次调用时间 ISO 字符串 */
  lastCallAt: string | null;
}

/** 空统计骨架 */
export function createEmptyTokenUsageStats(): TokenUsageStats {
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    callCount: 0,
    lastCall: null,
    lastCallAt: null,
  };
}
