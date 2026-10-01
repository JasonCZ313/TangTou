/**
 * P7 智能探活：证据包与站点填写方案（Playbook）类型。
 * P7a 展示；P7b 合并/确认执行；P7c 可含受控探测点击与多模态证据。
 */

/** 证据里识别到的控件粗分类 */
export type EvidenceControlKind =
  | 'text'
  | 'select'
  | 'combobox'
  | 'checkbox'
  | 'file'
  | 'button'
  | 'year'
  | 'month'
  | 'unknown';

/**
 * 页面上一个控件/可交互节点的摘要（不含 DOM 引用，可跨进程传递）。
 */
export interface EvidenceControlHint {
  kind: EvidenceControlKind;
  /** 人类可读标签 */
  label: string;
  /** 若扫描已打 data-raf-id 则带上，便于后续对齐 FillPlan */
  fieldId?: string;
  /** 选项抽样（最多若干项） */
  optionsSample?: string[];
  required?: boolean;
}

/**
 * 分区摘要：标题 + 是否有「添加」类按钮。
 */
export interface EvidenceSectionHint {
  title: string;
  addButtonText?: string;
  /** 粗估已有行数（可见重复块） */
  rowCountEstimate?: number;
}

/**
 * P7c：一次受控探测点击的记录（可序列化，不含 DOM）。
 */
export interface ProbeClickRecord {
  /** 被点控件的展示文案 */
  label: string;
  /** 为何探测（如打开年份选择器） */
  reason: string;
  /** 是否实际点了且未抛错 */
  ok: boolean;
  /** 点击后新看见的选项抽样 */
  discoveredOptions?: string[];
  /** 未点或失败原因 */
  skippedReason?: string;
}

/**
 * 一轮探活收集到的证据。
 * 不得包含可执行脚本或敏感密钥；截图 dataURL 不进本结构（由 Background 另传多模态）。
 */
export interface EvidencePack {
  collectedAt: string;
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  siteAdapterId?: string;
  siteAdapterName?: string;
  /** 可见区 OCR 文本（可空） */
  ocrText?: string;
  /** 页面可见文本抽样（截断） */
  visibleTextSample: string;
  sections: EvidenceSectionHint[];
  controls: EvidenceControlHint[];
  /** 发现的危险按钮文案（提交/投递等） */
  dangerButtons: string[];
  notices: string[];
  /** P7c：是否启用了受控探测点击 */
  probeClickEnabled?: boolean;
  /** P7c：探测点击流水 */
  probeClicks?: ProbeClickRecord[];
  /**
   * P7c：命中大厂样例目录时的提示 id（如 bytedance）。
   * 有 P3 适配器时仍应优先提示「扫描快路径」。
   */
  megaCorpSampleId?: string;
}

/** Playbook 单步动作类型（P7b 才会真正执行写入类） */
export type PlaybookStepKind =
  | 'observe'
  | 'click_add'
  | 'open_picker'
  | 'fill_field'
  | 'select_option'
  | 'wait'
  | 'warn';

/** 步骤风险：越高越需要用户盯着看 */
export type PlaybookRiskLevel = 'low' | 'medium' | 'high';

/**
 * Playbook 中的一步说明（P7a 仅展示）。
 */
export interface PlaybookStep {
  stepId: string;
  kind: PlaybookStepKind;
  title: string;
  detail: string;
  risk: PlaybookRiskLevel;
  targetFieldId?: string;
  suggestedValue?: string;
  confidence: number;
  /** 是否属于会改页面的步骤；P7a 即使为 true 也不执行 */
  isWrite: boolean;
}

/**
 * 站点填写方案：步骤图，不是直接写 DOM 的脚本。
 */
export interface SitePlaybook {
  createdAt: string;
  pageUrl: string;
  summary: string;
  /** 方案由谁生成 */
  engine: 'heuristic' | 'cloud';
  steps: PlaybookStep[];
  warnings: string[];
  /**
   * 引擎产出恒为 false。
   * 仅当用户在侧栏确认「执行探活方案」后，执行消息另带 userConfirmed，不依赖此字段放行。
   */
  executable: boolean;
}

/** 步骤 kind → 中文标签（侧栏展示） */
export const PLAYBOOK_STEP_KIND_LABEL: Record<PlaybookStepKind, string> = {
  observe: '观察',
  click_add: '点添加',
  open_picker: '打开选择器',
  fill_field: '填写',
  select_option: '选选项',
  wait: '等待',
  warn: '警告',
};

/** 风险 → 中文 */
export const PLAYBOOK_RISK_LABEL: Record<PlaybookRiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
};
