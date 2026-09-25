import type { FieldDescriptor, FillPlan } from './fill';
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
  | { type: 'SCAN_FIELDS'; requestId: string }
  | { type: 'SCAN_FIELDS_RESULT'; requestId: string; fields: FieldDescriptor[] }
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
    }
  | { type: 'APPLY_FILL_PLAN'; requestId: string; plan: FillPlan; filePayloads?: FileUploadPayload[] }
  | {
      type: 'APPLY_FILL_RESULT';
      requestId: string;
      filled: number;
      skipped: number;
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
  | { type: 'TEST_API'; requestId: string }
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
      type: 'ERROR';
      requestId: string;
      code: string;
      message: string;
    };
