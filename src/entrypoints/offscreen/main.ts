/**
 * Offscreen 入口：
 * 1) 托管 onnxruntime-web，响应本机 Laya ORT 推理（P2c score-v0）
 * 2) 托管 Tesseract，响应截图 OCR（P4b OFFSCREEN_OCR）
 *
 * 无权重 / I/O 对不上 / run 失败 → ORT ok=false，Background 回退轻量判断或 Server。
 * OCR 必须在此扩展同源页跑 Worker，禁止内容脚本 createWorker。
 */
import * as ort from 'onnxruntime-web';
import {
  LAYA_OFFSCREEN_DECIDE,
  LAYA_OFFSCREEN_DECIDE_RESULT,
} from '../../shared/decision/layaOffscreenBridge';
import {
  readCachedLayaBlob,
  readCachedLayaPackageMeta,
} from '../../shared/decision/layaModelStore';
import {
  buildOrtDecisionResult,
  buildOrtScoreInputForField,
  collectOrtProfileHints,
  extractOptionScores,
  LAYA_ORT_FEATURE_DIM,
  LAYA_ORT_IO_PROTOCOL_SCORE_V0,
  LAYA_ORT_MAX_OPTIONS,
  pickBestScoredOption,
} from '../../shared/decision/layaOrtIo';
import type { DecisionBatchRequest } from '../../shared/decision/types';
import type { DecisionMappingHit } from '../../shared/decision/types';
import {
  OFFSCREEN_OCR,
  OFFSCREEN_OCR_RESULT,
} from '../../shared/resume/offscreenOcrBridge';
import { recognizeImageDataUrl } from '../../shared/resume/resumeOcr';
import { describeUserFacingError } from '../../shared/messaging/userFacingError';

/** ORT 会话缓存：同一包只创建一次 */
let cachedSession: ort.InferenceSession | null = null;
let cachedSessionKey = '';

/**
 * 配置 wasm 路径到扩展内 public/ort，避免拉取远程脚本（MV3 禁止）。
 */
function configureOrtWasmPaths(): void {
  const wasmDirectory = chrome.runtime.getURL('/ort/');
  ort.env.wasm.wasmPaths = wasmDirectory;
  ort.env.wasm.numThreads = 1;
}

/**
 * 尝试从缓存加载 model.onnx；失败返回 null。
 */
async function obtainOrtSession(): Promise<{
  session: ort.InferenceSession;
  featureDim: number;
  maxOptions: number;
  ioProtocol: string;
} | null> {
  const meta = await readCachedLayaPackageMeta();
  if (!meta || meta.manifest.format !== 'tangtou-ort-v0') {
    return null;
  }

  const modelEntry = meta.manifest.files.find((entry) =>
    /\.onnx$/i.test(entry.path),
  );
  if (!modelEntry) {
    return null;
  }

  const sessionKey = `${meta.cachedAt}:${modelEntry.path}`;
  if (!cachedSession || cachedSessionKey !== sessionKey) {
    const modelBuffer = await readCachedLayaBlob(modelEntry.path);
    if (!modelBuffer) {
      return null;
    }
    configureOrtWasmPaths();
    cachedSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
    });
    cachedSessionKey = sessionKey;
  }

  const featureDim =
    typeof meta.manifest.featureDim === 'number' &&
    meta.manifest.featureDim > 0
      ? Math.floor(meta.manifest.featureDim)
      : LAYA_ORT_FEATURE_DIM;
  const maxOptions =
    typeof meta.manifest.maxOptions === 'number' &&
    meta.manifest.maxOptions > 0
      ? Math.floor(meta.manifest.maxOptions)
      : LAYA_ORT_MAX_OPTIONS;
  const ioProtocol =
    meta.manifest.ioProtocol?.trim() || LAYA_ORT_IO_PROTOCOL_SCORE_V0;

  return {
    session: cachedSession,
    featureDim,
    maxOptions,
    ioProtocol,
  };
}

/**
 * 按 tangtou-score-v0 对一批字段跑分。
 */
async function runScoreProtocol(
  session: ort.InferenceSession,
  batch: DecisionBatchRequest,
  featureDim: number,
  maxOptions: number,
): Promise<DecisionMappingHit[]> {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    return [];
  }

  const profileHints = collectOrtProfileHints(batch.profileData);
  const hits: DecisionMappingHit[] = [];

  for (const field of batch.fields) {
    const built = buildOrtScoreInputForField(
      field,
      profileHints,
      maxOptions,
      featureDim,
    );
    if (!built) {
      continue;
    }

    const inputTensor = new ort.Tensor('float32', built.tensorData, [
      1,
      maxOptions,
      featureDim,
    ]);
    const feeds: Record<string, ort.Tensor> = {
      [inputName]: inputTensor,
    };

    let outputs: ort.InferenceSession.OnnxValueMapType;
    try {
      outputs = await session.run(feeds);
    } catch {
      // 尝试展平为 [1, maxOptions*featureDim]
      const flatTensor = new ort.Tensor('float32', built.tensorData, [
        1,
        maxOptions * featureDim,
      ]);
      try {
        outputs = await session.run({ [inputName]: flatTensor });
      } catch {
        continue;
      }
    }

    const outputValue = outputs[outputName];
    if (!outputValue || !(outputValue.data instanceof Float32Array)) {
      continue;
    }
    const scores = extractOptionScores(outputValue.data, built.options.length);
    if (!scores) {
      continue;
    }
    const picked = pickBestScoredOption(
      built.options,
      scores,
      batch.minConfidence,
    );
    if (!picked) {
      continue;
    }
    hits.push({
      fieldId: field.fieldId,
      value: picked.value,
      confidence: picked.confidence,
      reason: 'score-v0',
    });
  }

  return hits;
}

/**
 * 处理 P4b 截图识字：在扩展同源 Offscreen 内跑 Tesseract Worker。
 */
async function handleOffscreenOcrMessage(
  requestId: string,
  imageDataUrl: unknown,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    if (typeof imageDataUrl !== 'string' || !imageDataUrl.trim()) {
      await chrome.runtime.sendMessage({
        type: OFFSCREEN_OCR_RESULT,
        requestId,
        ok: false,
        reason: '截图数据无效',
      });
      sendResponse({ ok: false });
      return;
    }

    const text = await recognizeImageDataUrl(imageDataUrl);
    await chrome.runtime.sendMessage({
      type: OFFSCREEN_OCR_RESULT,
      requestId,
      ok: true,
      text,
    });
    sendResponse({ ok: true });
  } catch (error: unknown) {
    await chrome.runtime.sendMessage({
      type: OFFSCREEN_OCR_RESULT,
      requestId,
      ok: false,
      reason: describeUserFacingError(error),
    });
    sendResponse({ ok: false });
  }
}

/**
 * 处理 Laya ORT 批量决策。
 */
async function handleOffscreenDecideMessage(
  requestId: string,
  batch: DecisionBatchRequest | undefined,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    if (!batch || !Array.isArray(batch.fields)) {
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: 'BAD_BATCH',
      });
      sendResponse({ ok: false });
      return;
    }

    const obtained = await obtainOrtSession();
    if (!obtained) {
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: 'NO_ORT_SESSION',
      });
      sendResponse({ ok: false });
      return;
    }

    const { session, featureDim, maxOptions, ioProtocol } = obtained;
    if (
      ioProtocol !== LAYA_ORT_IO_PROTOCOL_SCORE_V0 &&
      ioProtocol !== 'tangtou-score-v0'
    ) {
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: 'UNSUPPORTED_IO_PROTOCOL',
        ioProtocol,
      });
      sendResponse({ ok: false });
      return;
    }

    const hits = await runScoreProtocol(
      session,
      batch,
      featureDim,
      maxOptions,
    );
    if (hits.length === 0) {
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: 'ORT_NO_HITS',
        inputNames: session.inputNames,
        outputNames: session.outputNames,
      });
      sendResponse({ ok: false });
      return;
    }

    const result = buildOrtDecisionResult(
      hits,
      batch.fields.map((field) => field.fieldId),
    );
    await chrome.runtime.sendMessage({
      type: LAYA_OFFSCREEN_DECIDE_RESULT,
      requestId,
      ok: true,
      result,
    });
    sendResponse({ ok: true });
  } catch (error: unknown) {
    await chrome.runtime.sendMessage({
      type: LAYA_OFFSCREEN_DECIDE_RESULT,
      requestId,
      ok: false,
      reason: error instanceof Error ? error.message : 'ORT_ERROR',
    });
    sendResponse({ ok: false });
  }
}

/**
 * 监听 Background 发来的 ORT / OCR 请求。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const record = message as Record<string, unknown>;
  const requestId =
    typeof record.requestId === 'string' ? record.requestId : '';

  if (record.type === OFFSCREEN_OCR) {
    void handleOffscreenOcrMessage(requestId, record.imageDataUrl, sendResponse);
    return true;
  }

  if (record.type === LAYA_OFFSCREEN_DECIDE) {
    void handleOffscreenDecideMessage(
      requestId,
      record.batch as DecisionBatchRequest | undefined,
      sendResponse,
    );
    return true;
  }

  return false;
});
