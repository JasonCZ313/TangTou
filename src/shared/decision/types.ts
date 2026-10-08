/**
 * Decision 层公共类型：本机 Laya / 云端 API / 规则短路共用同一结果形状。
 * P1 只真正接通云端与规则；本机为桩，P2 替换实现。
 */
import type { AttachmentMeta } from '../types/attachment';
import type { FieldDescriptor, FillPlan } from '../types/fill';
import type { ProfileData } from '../types/profile';
import type { LlmTokenUsage } from '../types/usage';

/** 实际给出答案的引擎 */
export type EngineKind = 'local' | 'cloud' | 'rule';

/** 决策题型；P1 主路径用 batch_map，其余供 P2/P4 扩展 */
export type DecisionTaskKind = 'batch_map' | 'choice' | 'yesno' | 'score';

/**
 * 批量「档案字段 → 页面控件」映射请求。
 */
export interface DecisionBatchRequest {
  kind: 'batch_map';
  profileData: ProfileData;
  fields: FieldDescriptor[];
  /** 低于此置信度的提案应进入 skipped，不应写入预览可填项 */
  minConfidence: number;
}

/**
 * 单条映射命中（尚未带来源标签时的引擎原始输出）。
 */
export interface DecisionMappingHit {
  fieldId: string;
  value: string;
  confidence: number;
  reason?: string;
  attachmentId?: string;
}

/**
 * 批量决策结果。
 */
export interface DecisionBatchResult {
  /** 本轮真正作答的引擎 */
  usedEngine: EngineKind;
  items: DecisionMappingHit[];
  skippedFieldIds: string[];
  usage?: LlmTokenUsage | null;
  /** 需要红字提示用户的说明（超时、引擎降级等） */
  notice?: string;
}

/**
 * 引擎统一接口：Router 只依赖 ready + decideBatch。
 */
export interface DecisionEngine {
  kind: EngineKind;
  /** 本机是否已下载并加载完毕；云端看是否有 Key；规则恒 true */
  ready(): Promise<boolean>;
  decideBatch(request: DecisionBatchRequest): Promise<DecisionBatchResult>;
}

/**
 * 组装完整填写计划时的路由入参（background 调用）。
 */
export interface BuildFillPlanViaDecisionInput {
  profileData: ProfileData;
  fields: FieldDescriptor[];
  /** 档案附件元数据，供规则短路匹配文件框 */
  attachments: AttachmentMeta[];
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  layaEnabled: boolean;
  decisionPreferLocal: boolean;
  decisionMinConfidence: number;
  /** 本机模型/Server URL；空表示未配置下载源 */
  layaModelUrl?: string;
  /**
   * 选区对照：规则未吃掉的字段一律走云端，不因「偏好本机」整段停在本地。
   * 整页扫描不传此标志。
   */
  preferCloudForRemaining?: boolean;
}

/**
 * Router 对外返回：可直接塞进 FILL_PLAN_RESULT。
 */
export interface BuildFillPlanViaDecisionOutput {
  plan: FillPlan;
  usage: LlmTokenUsage | null;
  notice?: string;
  /** 本轮除规则外，云端或本机实际用了谁（便于驾驶舱徽章） */
  primaryEngine?: EngineKind;
}
