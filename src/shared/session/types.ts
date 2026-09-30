/**
 * 填写会话：预览与写入共用的唯一真相。
 * P0 先以 FillPlan + 字段列表承载；后续阶段扩展 Decision / WriteIntent。
 */
import type { FieldDescriptor, FillPlan } from '../types/fill';

/** chrome.storage.session 中的会话键（与历史 pendingFillSession 兼容读取） */
export const FILL_SESSION_STORAGE_KEY = 'pendingFillSession';

/**
 * 一轮「扫描 → 对照 → 预览 → 确认写入」的会话载荷。
 * plan 经用户在侧栏改值后，APPLY 必须按该 plan 执行。
 */
export interface FillSession {
  /** 待写入与跳过项（用户可改值） */
  plan: FillPlan;
  /** 扫描时的字段快照，供侧栏展示标签 */
  fields: FieldDescriptor[];
  /** 扫描或对照时的提示（如超时） */
  notice?: string;
  /** 选用的档案 id（写入时带上） */
  profileId?: string;
}

/**
 * 从 storage 原始对象解析会话；结构不对则返回 null。
 */
export function parseFillSession(rawValue: unknown): FillSession | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const candidate = rawValue as Record<string, unknown>;
  const plan = candidate.plan;
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  const planRecord = plan as Record<string, unknown>;
  if (!Array.isArray(planRecord.items) || !Array.isArray(planRecord.skippedFieldIds)) {
    return null;
  }
  return {
    plan: plan as FillPlan,
    fields: Array.isArray(candidate.fields)
      ? (candidate.fields as FieldDescriptor[])
      : [],
    notice: typeof candidate.notice === 'string' ? candidate.notice : undefined,
    profileId:
      typeof candidate.profileId === 'string' ? candidate.profileId : undefined,
  };
}
