/**
 * 本机 Laya 引擎（P2b + P2c）：
 * 1) 若 layaModelUrl 是可达的 Laya Server → HTTP 判断
 * 2) 若缓存包为 tangtou-ort-v0 → Offscreen ORT（I/O 对齐时出分）
 * 3) 否则 / 失败 → 轻量 choice 启发式
 * 失败不抛给用户主路径（除完全未就绪）。
 */
import { getSettings } from '../storage/settingsStore';
import {
  enableBuiltinLayaChoicePackage,
  getLayaModelStatus,
  isLayaModelReady,
  readCachedLayaPackageMeta,
} from './layaModelStore';
import { decideTypedFieldsOffline } from './layaOfflineChoice';
import { tryOffscreenOrtDecide } from './layaOffscreenBridge';
import {
  isLayaServerEndpoint,
  isLayaServerReadyFromCache,
  looksLikeHttpEndpoint,
  requestLayaServerDecide,
} from './layaServerClient';
import type {
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionEngine,
} from './types';

/** 本机未就绪时抛出的错误码，Router 捕获后降级 */
export const LOCAL_ENGINE_NOT_READY = 'LOCAL_ENGINE_NOT_READY';

/**
 * 本机引擎：包缓存就绪，或 Laya Server 在健康缓存语义下可尝试，即可 ready。
 * P6：误配/死链在近期健康失败后不再宣称 ready，避免反复 /health 与权限弹窗。
 */
export const localEngine: DecisionEngine = {
  kind: 'local',
  async ready(): Promise<boolean> {
    if (await isLayaModelReady()) {
      return true;
    }
    const settings = await getSettings();
    if (!settings.layaEnabled) {
      return false;
    }
    const modelUrl = settings.layaModelUrl?.trim() ?? '';
    // 没填地址、又还没有包：直接启用扩展里带着的轻量包，不要求用户点按钮
    if (!modelUrl && settings.decisionPreferLocal) {
      try {
        await enableBuiltinLayaChoicePackage();
      } catch {
        return false;
      }
      return isLayaModelReady();
    }
    // 不打网络：无缓存/过期允许试；近期失败则 false
    return isLayaServerReadyFromCache(modelUrl);
  },
  async decideBatch(
    request: DecisionBatchRequest,
  ): Promise<DecisionBatchResult> {
    const settings = await getSettings();
    const modelUrl = settings.layaModelUrl?.trim() ?? '';

    // P2c：优先 Laya Server（同一 URL 字段）；健康检查走短 TTL 缓存
    if (settings.layaEnabled && looksLikeHttpEndpoint(modelUrl)) {
      const isServer = await isLayaServerEndpoint(modelUrl);
      if (isServer) {
        const serverResult = await requestLayaServerDecide(modelUrl, request);
        if (serverResult && serverResult.items.length > 0) {
          return serverResult;
        }
        if (serverResult) {
          // 服务通但无命中：仍返回，让 Router 把剩余丢云端
          return serverResult;
        }
      }
    }

    const packageReady = await isLayaModelReady();
    if (!packageReady) {
      throw new Error(LOCAL_ENGINE_NOT_READY);
    }

    const meta = await readCachedLayaPackageMeta();
    const status = await getLayaModelStatus();
    if (!meta) {
      throw new Error(LOCAL_ENGINE_NOT_READY);
    }

    // ORT 包：Offscreen 真推理（协议对齐时）；失败回退轻量
    if (meta.manifest.format === 'tangtou-ort-v0') {
      try {
        const ortResult = await tryOffscreenOrtDecide(request);
        if (ortResult) {
          return ortResult;
        }
      } catch {
        // 静默回退
      }
    }

    const offline = decideTypedFieldsOffline(
      request.profileData,
      request.fields,
      request.minConfidence,
    );

    const packageHint =
      status.builtin || meta.manifest.format === 'tangtou-choice-v0'
        ? '轻量本机判断'
        : '本机（ORT 未出分，已用轻量判断）';

    return {
      usedEngine: 'local',
      items: offline.items.map((item) => ({
        ...item,
        reason: item.reason
          ? `${packageHint} · ${item.reason}`
          : packageHint,
      })),
      skippedFieldIds: offline.skippedFieldIds,
      usage: null,
    };
  },
};
