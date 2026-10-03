/**
 * P2c：自建 Laya Server 客户端。
 * 当 layaModelUrl 指向 HTTP 服务（/health 返回 tangtou-laya）时，
 * 把选项/是否题发到该服务判断；失败由 localEngine 回退包内轻量/ORT/云端。
 * P6：健康检查结果短 TTL 缓存，减少误配 URL 反复打 /health、弹权限。
 */
import { ensureHostPermission } from '../llm/openaiCompatible';
import { getPageWorkAbortSignal } from '../workAbort';
import type { FieldDescriptor } from '../types/fill';
import type { ProfileData } from '../types/profile';
import type {
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionMappingHit,
} from './types';

/** 探测与推理超时 */
const LAYA_SERVER_TIMEOUT_MS = 8_000;

/** 健康检查缓存有效期（毫秒） */
const LAYA_SERVER_HEALTH_TTL_MS = 120_000;

/** 健康检查成功时的服务标识 */
export const LAYA_SERVER_SERVICE_ID = 'tangtou-laya';

/** 单次健康检查结果 */
export type LayaServerHealthResult =
  | { ok: true; version?: string }
  | { ok: false; message: string };

/** 内存中的健康缓存条目（按规范化 baseUrl） */
interface LayaServerHealthCacheEntry {
  baseUrl: string;
  result: LayaServerHealthResult;
  checkedAtMs: number;
}

/** 进程内健康缓存（Background Service Worker 生命周期内有效） */
let layaServerHealthCache: LayaServerHealthCacheEntry | null = null;

/**
 * 去掉末尾斜杠，便于拼 /health、/v1/decide。
 */
export function normalizeLayaServerBaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

/**
 * 粗判 URL 是否「像」可请求的 HTTP(S) 服务根（不是空、不是纯相对路径）。
 */
export function looksLikeHttpEndpoint(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 读取未过期的健康缓存；URL 不同或过期则返回 null。
 */
export function peekLayaServerHealthCache(
  rawBaseUrl: string,
): LayaServerHealthResult | null {
  if (!layaServerHealthCache) {
    return null;
  }
  const baseUrl = normalizeLayaServerBaseUrl(rawBaseUrl);
  if (layaServerHealthCache.baseUrl !== baseUrl) {
    return null;
  }
  const ageMs = Date.now() - layaServerHealthCache.checkedAtMs;
  if (ageMs < 0 || ageMs > LAYA_SERVER_HEALTH_TTL_MS) {
    return null;
  }
  return layaServerHealthCache.result;
}

/**
 * 写入/覆盖健康缓存（测 Server 或探测失败后调用）。
 */
export function rememberLayaServerHealth(
  rawBaseUrl: string,
  result: LayaServerHealthResult,
): void {
  const baseUrl = normalizeLayaServerBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    return;
  }
  layaServerHealthCache = {
    baseUrl,
    result,
    checkedAtMs: Date.now(),
  };
}

/**
 * 清空健康缓存（URL 变更后希望立刻重探时可调）。
 */
export function clearLayaServerHealthCache(): void {
  layaServerHealthCache = null;
}

/**
 * localEngine.ready 用：不打网络。
 * - 无缓存或已过期 → true（允许首次/到期后再试）
 * - 近期成功 → true
 * - 近期失败 → false（避免误配 URL 反复探活）
 */
export function isLayaServerReadyFromCache(rawBaseUrl: string): boolean {
  if (!looksLikeHttpEndpoint(rawBaseUrl)) {
    return false;
  }
  const cached = peekLayaServerHealthCache(rawBaseUrl);
  if (!cached) {
    return true;
  }
  return cached.ok;
}

/**
 * 请求 Laya Server 健康检查。
 * 约定：GET {base}/health → { ok: true, service: "tangtou-laya", version?: string }
 * 默认使用短 TTL 缓存；force=true 时强制重探（侧栏/选项「测试」用）。
 */
export async function probeLayaServerHealth(
  rawBaseUrl: string,
  options?: { force?: boolean },
): Promise<LayaServerHealthResult> {
  const baseUrl = normalizeLayaServerBaseUrl(rawBaseUrl);
  if (!looksLikeHttpEndpoint(baseUrl)) {
    return { ok: false, message: '不是有效的 http(s) 地址' };
  }

  if (!options?.force) {
    const cached = peekLayaServerHealthCache(baseUrl);
    if (cached) {
      return cached;
    }
  }

  const granted = await ensureHostPermission(baseUrl);
  if (!granted) {
    const denied: LayaServerHealthResult = {
      ok: false,
      message: '未获得访问该主机的权限',
    };
    rememberLayaServerHealth(baseUrl, denied);
    return denied;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAYA_SERVER_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      const httpFail: LayaServerHealthResult = {
        ok: false,
        message: `健康检查 HTTP ${response.status}`,
      };
      rememberLayaServerHealth(baseUrl, httpFail);
      return httpFail;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload.ok !== true || payload.service !== LAYA_SERVER_SERVICE_ID) {
      const badService: LayaServerHealthResult = {
        ok: false,
        message: '响应不是躺投 Laya Server（缺少 ok/service）',
      };
      rememberLayaServerHealth(baseUrl, badService);
      return badService;
    }
    const success: LayaServerHealthResult = {
      ok: true,
      version:
        typeof payload.version === 'string' ? payload.version : undefined,
    };
    rememberLayaServerHealth(baseUrl, success);
    return success;
  } catch (error: unknown) {
    const networkFail: LayaServerHealthResult = {
      ok: false,
      message:
        error instanceof Error ? error.message : '健康检查失败（网络或超时）',
    };
    rememberLayaServerHealth(baseUrl, networkFail);
    return networkFail;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 判断配置的 URL 当前是否可作为 Laya Server 使用。
 */
export async function isLayaServerEndpoint(
  rawBaseUrl: string,
): Promise<boolean> {
  const result = await probeLayaServerHealth(rawBaseUrl);
  return result.ok;
}

/**
 * 压缩发给 Server 的档案：截断列表，降低载荷。
 */
function buildProfileBriefForServer(profileData: ProfileData): ProfileData {
  return {
    ...profileData,
    education: (profileData.education ?? []).slice(0, 6),
    experience: (profileData.experience ?? []).slice(0, 6),
    projects: (profileData.projects ?? []).slice(0, 4),
  };
}

/**
 * 规范化 Server 返回的 items。
 */
function normalizeServerHits(
  rawItems: unknown,
  minConfidence: number,
): DecisionMappingHit[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  const hits: DecisionMappingHit[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const fieldId =
      typeof record.fieldId === 'string' ? record.fieldId.trim() : '';
    const value = typeof record.value === 'string' ? record.value.trim() : '';
    if (!fieldId || !value) {
      continue;
    }
    const confidence =
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0;
    if (confidence < minConfidence) {
      continue;
    }
    hits.push({
      fieldId,
      value,
      confidence,
      reason:
        typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim()
          : 'Laya Server',
    });
  }
  return hits;
}

/**
 * POST {base}/v1/decide：对 typed 字段批量判断。
 * 失败返回 null，由上层降级。
 */
export async function requestLayaServerDecide(
  rawBaseUrl: string,
  request: DecisionBatchRequest,
): Promise<DecisionBatchResult | null> {
  const baseUrl = normalizeLayaServerBaseUrl(rawBaseUrl);
  const granted = await ensureHostPermission(baseUrl);
  if (!granted) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LAYA_SERVER_TIMEOUT_MS);
  const userAbortSignal = getPageWorkAbortSignal();
  const onUserAbort = (): void => {
    controller.abort();
  };
  userAbortSignal?.addEventListener('abort', onUserAbort);
  if (userAbortSignal?.aborted) {
    controller.abort();
  }

  const fieldsPayload: Array<Pick<
    FieldDescriptor,
    'fieldId' | 'label' | 'type' | 'tag' | 'options' | 'placeholder' | 'required'
  >> = request.fields.map((field) => ({
    fieldId: field.fieldId,
    label: field.label,
    type: field.type,
    tag: field.tag,
    options: field.options,
    placeholder: field.placeholder,
    required: field.required,
  }));

  try {
    const response = await fetch(`${baseUrl}/v1/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        kind: 'batch_map',
        minConfidence: request.minConfidence,
        fields: fieldsPayload,
        profileData: buildProfileBriefForServer(request.profileData),
      }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const items = normalizeServerHits(payload.items, request.minConfidence);
    const skippedFieldIds = Array.isArray(payload.skippedFieldIds)
      ? payload.skippedFieldIds.filter(
          (fieldId): fieldId is string =>
            typeof fieldId === 'string' && fieldId.trim().length > 0,
        )
      : request.fields
          .map((field) => field.fieldId)
          .filter((fieldId) => !items.some((item) => item.fieldId === fieldId));

    return {
      usedEngine: 'local',
      items: items.map((item) => ({
        ...item,
        reason: item.reason?.startsWith('Laya Server')
          ? item.reason
          : `Laya Server · ${item.reason ?? '判断'}`,
      })),
      skippedFieldIds,
      usage: null,
      notice:
        typeof payload.notice === 'string' ? payload.notice : undefined,
    };
  } catch {
    if (userAbortSignal?.aborted) {
      throw new Error('USER_STOPPED');
    }
    return null;
  } finally {
    userAbortSignal?.removeEventListener('abort', onUserAbort);
    clearTimeout(timer);
  }
}
