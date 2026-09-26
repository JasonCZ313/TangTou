/** 页面上扫描到的单个表单字段描述，供模型映射与回填定位 */
export interface FieldDescriptor {
  /** 扩展生成的稳定会话内 id */
  fieldId: string;
  tag: string;
  type: string;
  name?: string;
  /** 归一化后的人类可读标签 */
  label: string;
  placeholder?: string;
  /** select / radio 等选项文案 */
  options?: string[];
  currentValue?: string;
  required?: boolean;
  /** 用于回填的定位提示（非唯一依赖的 xpath） */
  selectorHint: string;
}

/** 模型或用户确认后的单字段填写项 */
export interface FillMappingItem {
  fieldId: string;
  value: string;
  /** 置信度 0..1 */
  confidence: number;
  reason?: string;
  /** 若为本机附件，填写时按此 id 取文件写入 file 控件 */
  attachmentId?: string;
}

/** 这一轮明确不写的字段，以及给用户看的原因 */
export interface SkippedFieldNote {
  fieldId: string;
  reason: string;
}

/** 逐格填写时没写进去的一格，给侧栏另一张表用 */
export interface FillMiss {
  label: string;
  reason: string;
}

/**
 * 档案里某一段有几条。写入时页面上的行数少于此数，才点这一段的「添加」。
 */
export interface SectionAddRequest {
  /** 用来对上页面标题的正则源，例如「项目」或「工作|实习」 */
  sectionPattern: string;
  /** 档案里这一段的条数 */
  neededRows: number;
}

/** 一轮填写计划：待写入项与明确跳过的字段 */
export interface FillPlan {
  items: FillMappingItem[];
  skippedFieldIds: string[];
  /** 和跳过的字段一一对应。旧计划可能没有，界面会用默认原因 */
  skippedNotes?: SkippedFieldNote[];
}
