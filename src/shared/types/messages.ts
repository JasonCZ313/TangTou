import type { FieldDescriptor, FillMiss, FillPlan, SectionAddRequest } from './fill';
import type { Profile, AppSettings, ProfileData } from './profile';
import type { LlmTokenUsage, TokenUsageStats } from './usage';
import type {
  EvidencePack,
  PlaybookStep,
  SitePlaybook,
} from '../playbook/types';

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
      /** 本轮 Decision 主引擎（驾驶舱徽章） */
      primaryEngine?: 'rule' | 'local' | 'cloud';
      /** 当前活动页命中的站点适配器名；无匹配则为空 */
      siteAdapterName?: string;
    }
  | {
      type: 'APPLY_FILL_PLAN';
      requestId: string;
      plan: FillPlan;
      filePayloads?: FileUploadPayload[];
      /** 有档案时，写入过程才能为新冒出来的框再要一份对照 */
      profileId?: string;
      /** 各段档案条数。写入前可作行数兜底（扫描阶段已主路径补行） */
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
  | {
      type: 'UNDO_FILL_RESULT';
      requestId: string;
      /** 已还原的普通填写框数量 */
      restored: number;
      /** 本轮撤销时清空的文件上传框数量（浏览器无法恢复原文件） */
      clearedFiles?: number;
    }
  | {
      /** 扫描出预览前：按档案条数只点「添加」补行，不写正文 */
      type: 'ENSURE_SECTION_ROWS';
      requestId: string;
      /** 侧栏/弹窗带档案 id；后台算好 sectionAdds 再转给页面 */
      profileId?: string;
      /** 后台转发给内容脚本时带上的补行请求 */
      sectionAdds?: SectionAddRequest[];
    }
  | {
      type: 'ENSURE_SECTION_ROWS_RESULT';
      requestId: string;
      /** 实际点了几次「添加」 */
      clicks: number;
      /** 补行过程中的说明（找不到分区、行数未增等） */
      notices: string[];
    }
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
      /** 查询本机 Laya 模型包下载/就绪状态 */
      type: 'LAYA_MODEL_STATUS';
      requestId: string;
    }
  | {
      type: 'LAYA_MODEL_STATUS_RESULT';
      requestId: string;
      lifecycle: 'idle' | 'downloading' | 'ready' | 'error';
      progressPercent: number;
      message: string;
      format?: string;
      version?: string;
      sourceUrl: string;
      builtin: boolean;
      updatedAt: string;
    }
  | {
      /** 从设置里的模型 URL 下载并缓存本机包 */
      type: 'LAYA_MODEL_DOWNLOAD';
      requestId: string;
      /** 可覆盖当前设置中的 URL；空则用已保存的 layaModelUrl */
      modelUrl?: string;
    }
  | {
      /** 一键启用内置轻量判断包（无需外网 URL） */
      type: 'LAYA_MODEL_ENABLE_BUILTIN';
      requestId: string;
    }
  | {
      /** 清除本机模型缓存 */
      type: 'LAYA_MODEL_CLEAR';
      requestId: string;
    }
  | {
      /** P2c：探测 layaModelUrl 是否为可达的 Laya Server */
      type: 'TEST_LAYA_SERVER';
      requestId: string;
      /** 可覆盖输入框；空则用已保存设置 */
      serverUrl?: string;
    }
  | {
      type: 'TEST_LAYA_SERVER_RESULT';
      requestId: string;
      ok: boolean;
      message: string;
      version?: string;
    }
  | {
      /** Chao 逐格写后：请本机 Laya/规则确认「标签+期望值+回读」是否一致 */
      type: 'LAYA_CONFIRM_CELL';
      requestId: string;
      label: string;
      intended: string;
      actual: string;
    }
  | {
      type: 'LAYA_CONFIRM_CELL_RESULT';
      requestId: string;
      /** true=确认通过或跳过；false=高置信否定 */
      ok: boolean;
      /** 0~1，仅当明确否定且置信度高时 content 才打回 */
      confidence: number;
      message: string;
      /** 未就绪/未开启时为 true，content 应信任回读 */
      skipped?: boolean;
    }
  | {
      /** 页内浮层：更新进度文案与百分比（P4a） */
      type: 'PAGE_OVERLAY_UPDATE';
      requestId: string;
      percent: number;
      message: string;
      /** 可选：要描边高亮的字段 id 列表 */
      highlightFieldIds?: string[];
      /** 是否显示「停止」按钮 */
      showCancel?: boolean;
    }
  | {
      /** 页内浮层：关闭 */
      type: 'PAGE_OVERLAY_HIDE';
      requestId: string;
    }
  | {
      /** 对当前活动标签可见区截图并 OCR，把识字结果并入后续预览辅助（P4b） */
      type: 'CAPTURE_PAGE_OCR';
      requestId: string;
    }
  | {
      type: 'CAPTURE_PAGE_OCR_RESULT';
      requestId: string;
      /** OCR 得到的页面可见区文字；失败时为空串 */
      ocrText: string;
      notice?: string;
    }
  | {
      /** P7：收集页内证据；P7c 可开启预算内探测点击（永不提交） */
      type: 'COLLECT_PAGE_EVIDENCE';
      requestId: string;
      /** 默认 false；智能探活流程会传 true */
      enableProbeClicks?: boolean;
    }
  | {
      type: 'COLLECT_PAGE_EVIDENCE_RESULT';
      requestId: string;
      evidence: EvidencePack;
    }
  | {
      /** P7：根据证据生成 SitePlaybook（分析；执行另走 EXECUTE） */
      type: 'BUILD_SITE_PLAYBOOK';
      requestId: string;
      profileId: string;
      /** 可空：由后台自行收集；侧栏也可先收集再传入 */
      evidence?: EvidencePack;
      /** P7c：收集时做受控探测点击；默认 true */
      enableProbeClicks?: boolean;
      /** P7c：把可见区截图送进云端（不支持则自动回退纯文本）；默认 true */
      enableMultimodal?: boolean;
    }
  | {
      type: 'BUILD_SITE_PLAYBOOK_RESULT';
      requestId: string;
      playbook: SitePlaybook;
      usage?: LlmTokenUsage | null;
      notice?: string;
    }
  | {
      /**
       * P7b：执行用户确认过的探活写入步（逐步 + 回读）。
       * userConfirmed 必须为 true，否则 Background 拒绝。
       */
      type: 'EXECUTE_PLAYBOOK';
      requestId: string;
      steps: PlaybookStep[];
      userConfirmed: true;
    }
  | {
      type: 'EXECUTE_PLAYBOOK_RESULT';
      requestId: string;
      completed: number;
      stopped: boolean;
      misses?: FillMiss[];
      results?: Array<{ stepId: string; ok: boolean; message: string }>;
    }
  | {
      type: 'ERROR';
      requestId: string;
      code: string;
      message: string;
    };
