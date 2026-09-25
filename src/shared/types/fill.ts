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

/** 一轮填写计划：待写入项与明确跳过的字段 */
export interface FillPlan {
  items: FillMappingItem[];
  skippedFieldIds: string[];
  /** 和跳过的字段一一对应。旧计划可能没有，界面会用默认原因 */
  skippedNotes?: SkippedFieldNote[];
}
