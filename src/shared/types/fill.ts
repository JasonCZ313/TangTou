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

/**
 * 填写提案正式来源（预览「来源」列 / P7 探活共用）。
 * - user：用户在侧栏改过或手填
 * - rule：本地启发式规则
 * - laya：本机判断（含轻量包 / 未来 ORT）
 * - llm：用户云端 API
 * - probe：智能探活 Playbook（P7，预留）
 */
export type FillIntentSource = 'user' | 'rule' | 'laya' | 'llm' | 'probe';

/** 模型或用户确认后的单字段填写项 */
export interface FillMappingItem {
  fieldId: string;
  value: string;
  /** 置信度 0..1 */
  confidence: number;
  reason?: string;
  /** 若为本机附件，填写时按此 id 取文件写入 file 控件 */
  attachmentId?: string;
  /**
   * 正式来源字段（P5+）。
   * 旧会话可能缺失，UI 可回退解析 reason 前缀或显示「未知」。
   */
  source?: FillIntentSource;
}

/** 一轮决策实际动用的主引擎（侧栏徽章用） */
export type FillPrimaryEngine = 'rule' | 'local' | 'cloud';

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
 * 档案里某一段有几条。扫描出预览前（及写入兜底）页面行数少于此数时，才点这一段的「添加」。
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

/** 来源 → 侧栏展示文案 */
export const FILL_INTENT_SOURCE_LABEL: Record<FillIntentSource, string> = {
  user: '用户',
  rule: '规则',
  laya: '本机',
  llm: '云端',
  probe: '探活',
};

/** 主引擎 → 侧栏徽章文案 */
export const FILL_PRIMARY_ENGINE_LABEL: Record<FillPrimaryEngine, string> = {
  rule: '规则',
  local: '本机',
  cloud: '云端',
};

/**
 * 把可能缺失的 source 归一成可展示标签（兼容旧会话）。
 */
export function resolveFillSourceLabel(
  source: FillIntentSource | undefined,
  reason?: string,
): string {
  if (source && FILL_INTENT_SOURCE_LABEL[source]) {
    return FILL_INTENT_SOURCE_LABEL[source];
  }
  const reasonText = reason?.trim() ?? '';
  if (reasonText.startsWith('[规则]')) {
    return FILL_INTENT_SOURCE_LABEL.rule;
  }
  if (reasonText.startsWith('[本机]')) {
    return FILL_INTENT_SOURCE_LABEL.laya;
  }
  if (reasonText.startsWith('[云端]')) {
    return FILL_INTENT_SOURCE_LABEL.llm;
  }
  if (reasonText.startsWith('[探活]')) {
    return FILL_INTENT_SOURCE_LABEL.probe;
  }
  if (reasonText.includes('手动')) {
    return FILL_INTENT_SOURCE_LABEL.user;
  }
  return '未知';
}
