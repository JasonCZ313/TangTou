/**
 * 本机 Laya 引擎（P2b）：模型包就绪后对选项/是否题做本机判断。
 * - tangtou-choice-v0：直接轻量匹配
 * - tangtou-ort-v0：优先尝试 Offscreen + ORT；失败则静默回退轻量匹配（不挡云端）
 */
import {
  getLayaModelStatus,
  isLayaModelReady,
  readCachedLayaPackageMeta,
} from './layaModelStore';
import { decideTypedFieldsOffline } from './layaOfflineChoice';
import { tryOffscreenOrtDecide } from './layaOffscreenBridge';
import type {
  DecisionBatchRequest,
  DecisionBatchResult,
  DecisionEngine,
} from './types';

/** 本机未就绪时抛出的错误码，Router 捕获后降级 */
export const LOCAL_ENGINE_NOT_READY = 'LOCAL_ENGINE_NOT_READY';

/**
 * 本机引擎：ready 取决于模型缓存；decideBatch 只应接到 typed 字段。
 */
export const localEngine: DecisionEngine = {
  kind: 'local',
  async ready(): Promise<boolean> {
    return isLayaModelReady();
  },
  async decideBatch(
    request: DecisionBatchRequest,
  ): Promise<DecisionBatchResult> {
    const ready = await isLayaModelReady();
    if (!ready) {
      throw new Error(LOCAL_ENGINE_NOT_READY);
    }

    const meta = await readCachedLayaPackageMeta();
    const status = await getLayaModelStatus();
    if (!meta) {
      throw new Error(LOCAL_ENGINE_NOT_READY);
    }

    // ORT 包：先尝试 Offscreen 推理；未实现或失败则回退轻量判断
    if (meta.manifest.format === 'tangtou-ort-v0') {
      try {
        const ortResult = await tryOffscreenOrtDecide(request);
        if (ortResult) {
          return ortResult;
        }
      } catch {
        // 静默回退，下面走轻量匹配
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
        : '本机（ORT 未对齐，已用轻量判断）';

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
