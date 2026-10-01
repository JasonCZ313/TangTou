/**
 * Offscreen 入口：托管 onnxruntime-web，响应本机 Laya 推理消息。
 * 当前若尚未缓存可用的 model.onnx 或 I/O 协议未对齐，回执 ok=false，由 Background 回退轻量判断。
 */
import * as ort from 'onnxruntime-web';
import {
  LAYA_OFFSCREEN_DECIDE,
  LAYA_OFFSCREEN_DECIDE_RESULT,
} from '../../shared/decision/layaOffscreenBridge';
import { readCachedLayaBlob, readCachedLayaPackageMeta } from '../../shared/decision/layaModelStore';

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
async function obtainOrtSession(): Promise<ort.InferenceSession | null> {
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
  if (cachedSession && cachedSessionKey === sessionKey) {
    return cachedSession;
  }

  const modelBuffer = await readCachedLayaBlob(modelEntry.path);
  if (!modelBuffer) {
    return null;
  }

  configureOrtWasmPaths();
  const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
  });
  cachedSession = session;
  cachedSessionKey = sessionKey;
  return session;
}

/**
 * 监听 Background 发来的推理请求。
 * 目前 ONNX I/O 协议尚未与开源 Laya 权重对齐：会话能建则仍返回 ok=false，
 * 避免用不正确的张量产物污染预览；上层会回退轻量判断。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (record.type !== LAYA_OFFSCREEN_DECIDE) {
    return false;
  }

  const requestId = typeof record.requestId === 'string' ? record.requestId : '';

  void (async () => {
    try {
      const session = await obtainOrtSession();
      if (!session) {
        await chrome.runtime.sendMessage({
          type: LAYA_OFFSCREEN_DECIDE_RESULT,
          requestId,
          ok: false,
          reason: 'NO_ORT_SESSION',
        });
        sendResponse({ ok: false });
        return;
      }

      // 会话已创建，但输入输出约定待 P2c/权重导出对齐——故意不跑假推理
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: 'ORT_IO_NOT_WIRED',
        inputNames: session.inputNames,
        outputNames: session.outputNames,
      });
      sendResponse({ ok: false, reason: 'ORT_IO_NOT_WIRED' });
    } catch (error: unknown) {
      await chrome.runtime.sendMessage({
        type: LAYA_OFFSCREEN_DECIDE_RESULT,
        requestId,
        ok: false,
        reason: error instanceof Error ? error.message : 'ORT_ERROR',
      });
      sendResponse({ ok: false });
    }
  })();

  return true;
});
