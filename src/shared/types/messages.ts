import type { FieldDescriptor, FillMiss, FillPlan, SectionAddRequest } from './fill';
import type { Profile, AppSettings, ProfileData } from './profile';
import type { LlmTokenUsage, TokenUsageStats } from './usage';

/** 写入页面 file 控件时附带的文件字节（Base64） */
export interface FileUploadPayload {
  fieldId: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

/** 扩展内部消息联合类型（UI / Background / Content） */
export type ExtensionMessage =
  | { type: 'STOP_PAGE_WORK'; requestId: string }
  | { type: 'STOP_PAGE_WORK_ACK'; requestId: string }
  | { type: 'SCAN_FIELDS'; requestId: string }
  | { type: 'SCAN_FIELDS_STARTED'; requestId: string }
  | {
      type: 'SCAN_PROGRESS';
      requestId: string;
      /** 0 到 100，读条用 */
      percent: number;
      foundCount: number;
      message: string;
    }
  | {
      type: 'SCAN_FIELDS_RESULT';
      requestId: string;
      fields: FieldDescriptor[];
      /** 时间到了先交回，或一个框都没有时的说明 */
      notice?: string;
    }
  | {
      type: 'BUILD_FILL_PLAN';
      requestId: string;
      profileId: string;
      fields: FieldDescriptor[];
    }
  | {
      type: 'FILL_PLAN_RESULT';
      requestId: string;
      plan: FillPlan;
      /** 本次 LLM 用量；仅启发式或接口未返回时为 undefined */
      usage?: LlmTokenUsage | null;
      /** 计划可用，但模型超时等需要用红框告诉用户的说明 */
      notice?: string;
    }
  | {
      type: 'APPLY_FILL_PLAN';
      requestId: string;
      plan: FillPlan;
      filePayloads?: FileUploadPayload[];
      /** 有档案时，写入过程才能为新冒出来的框再要一份对照 */
      profileId?: string;
      /** 各段档案条数。页面行数不够时，写入阶段逐条点添加 */
      sectionAdds?: SectionAddRequest[];
      /** 页面上逐格对照用的档案正文，由后台附上，不经过预先扫描 */
      profileData?: ProfileData;
    }
  | {
      type: 'APPLY_FILL_RESULT';
      requestId: string;
      filled: number;
      skipped: number;
      /** 没写进去的格子，侧栏用另一张表显示 */
      misses?: FillMiss[];
    }
  | { type: 'UNDO_LAST_FILL'; requestId: string }
  | { type: 'UNDO_FILL_RESULT'; requestId: string; restored: number }
  | { type: 'GET_STATE'; requestId: string }
  | {
      type: 'GET_STATE_RESULT';
      requestId: string;
      settings: AppSettings;
      profiles: Profile[];
      /** 本机累计 Token 用量 */
      tokenUsage: TokenUsageStats;
    }
  | { type: 'OPEN_SIDE_PANEL'; requestId: string }
  | { type: 'OPEN_SIDE_PANEL_RESULT'; requestId: string; ok: boolean }
  | {
      type: 'TEST_API';
      requestId: string;
      /** 表单里刚填的三项；有则优先用来测连，不必先点保存 */
      apiBaseUrl?: string;
      apiKey?: string;
      model?: string;
    }
  | { type: 'TEST_API_RESULT'; requestId: string; ok: boolean; detail: string }
  | { type: 'RESET_TOKEN_USAGE'; requestId: string }
  | {
      type: 'RESET_TOKEN_USAGE_RESULT';
      requestId: string;
      tokenUsage: TokenUsageStats;
    }
  | {
      type: 'PARSE_RESUME';
      requestId: string;
      resumeText: string;
    }
  | {
      type: 'PARSE_RESUME_RESULT';
      requestId: string;
      profilePatch: ProfileData;
      usage?: LlmTokenUsage | null;
    }
  | {
      type: 'POLISH_TEXT';
      requestId: string;
      /** 字段名，用来选择润色侧重，例如「工作内容」「业绩」 */
      fieldName: string;
      sourceText: string;
      /** 用户临时写的要求，不超过 30 字；没有则为空字符串 */
      customRequirement: string;
    }
  | {
      type: 'POLISH_TEXT_RESULT';
      requestId: string;
      headline: string;
      body: string;
      usage?: LlmTokenUsage | null;
    }
  | {
      type: 'POLISH_PROGRESS';
      requestId: string;
      /** 0 到 100 的整数。结果未返回前最高报到 92 */
      percent: number;
    }
  | {
      type: 'ERROR';
      requestId: string;
      code: string;
      message: string;
    };
