/**
 * 本机 Laya 模型包的下载、IndexedDB 缓存与状态读写。
 * Background / Options / 侧栏均可调用；包内不预置大权重。
 */
import {
  createBuiltinChoiceManifest,
  createIdleLayaStatus,
  LAYA_ACTIVE_PACKAGE_ID,
  LAYA_MANIFEST_FILE_NAME,
  LAYA_MODEL_BLOB_STORE,
  LAYA_MODEL_DB_NAME,
  LAYA_MODEL_DB_VERSION,
  LAYA_MODEL_META_STORE,
  LAYA_MODEL_STATUS_STORAGE_KEY,
  type LayaCachedPackageMeta,
  type LayaModelStatusSnapshot,
  type LayaPackageManifest,
} from './layaModelTypes';

/** 打开（或升级）本机模型库 */
function openLayaModelDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LAYA_MODEL_DB_NAME, LAYA_MODEL_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LAYA_MODEL_META_STORE)) {
        database.createObjectStore(LAYA_MODEL_META_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(LAYA_MODEL_BLOB_STORE)) {
        database.createObjectStore(LAYA_MODEL_BLOB_STORE, { keyPath: 'path' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('无法打开本机 Laya 模型库'));
  });
}

/** 把状态快照写入 chrome.storage.local，供 UI 轮询 */
async function persistStatusSnapshot(
  snapshot: LayaModelStatusSnapshot,
): Promise<void> {
  await chrome.storage.local.set({
    [LAYA_MODEL_STATUS_STORAGE_KEY]: snapshot,
  });
}

/**
 * 读取当前本机模型状态；无记录时返回空闲快照。
 */
export async function getLayaModelStatus(): Promise<LayaModelStatusSnapshot> {
  const stored = await chrome.storage.local.get(LAYA_MODEL_STATUS_STORAGE_KEY);
  const raw = stored[LAYA_MODEL_STATUS_STORAGE_KEY] as
    | LayaModelStatusSnapshot
    | undefined;
  if (!raw || typeof raw !== 'object') {
    return createIdleLayaStatus();
  }
  return {
    ...createIdleLayaStatus(),
    ...raw,
  };
}

/**
 * 读取已缓存的包元数据；没有则 null。
 */
export async function readCachedLayaPackageMeta(): Promise<LayaCachedPackageMeta | null> {
  const database = await openLayaModelDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LAYA_MODEL_META_STORE, 'readonly');
    const request = transaction
      .objectStore(LAYA_MODEL_META_STORE)
      .get(LAYA_ACTIVE_PACKAGE_ID);
    request.onsuccess = () => {
      resolve((request.result as LayaCachedPackageMeta | undefined) ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 按相对路径读取已缓存的二进制；不存在返回 null。
 */
export async function readCachedLayaBlob(
  relativePath: string,
): Promise<ArrayBuffer | null> {
  const database = await openLayaModelDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LAYA_MODEL_BLOB_STORE, 'readonly');
    const request = transaction.objectStore(LAYA_MODEL_BLOB_STORE).get(relativePath);
    request.onsuccess = () => {
      const row = request.result as { path: string; buffer: ArrayBuffer } | undefined;
      resolve(row?.buffer ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

/** 清空 IDB 中的包元数据与全部二进制 */
async function clearCachedPackageBlobs(): Promise<void> {
  const database = await openLayaModelDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [LAYA_MODEL_META_STORE, LAYA_MODEL_BLOB_STORE],
      'readwrite',
    );
    transaction.objectStore(LAYA_MODEL_META_STORE).clear();
    transaction.objectStore(LAYA_MODEL_BLOB_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('清除本机模型缓存失败'));
  });
}

/**
 * 写入包元数据与若干文件二进制（同事务）。
 */
async function writeCachedPackage(
  meta: LayaCachedPackageMeta,
  blobs: Array<{ path: string; buffer: ArrayBuffer }>,
): Promise<void> {
  const database = await openLayaModelDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [LAYA_MODEL_META_STORE, LAYA_MODEL_BLOB_STORE],
      'readwrite',
    );
    const metaStore = transaction.objectStore(LAYA_MODEL_META_STORE);
    const blobStore = transaction.objectStore(LAYA_MODEL_BLOB_STORE);
    metaStore.clear();
    blobStore.clear();
    metaStore.put(meta);
    for (const blob of blobs) {
      blobStore.put({ path: blob.path, buffer: blob.buffer });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('写入本机模型缓存失败'));
  });
}

/**
 * 规范化模型根 URL：去尾斜杠；空串表示未配置外链。
 */
export function normalizeModelRootUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

/**
 * 拼接清单或文件的绝对 URL。
 */
function joinModelUrl(rootUrl: string, relativePath: string): string {
  const cleanedRelative = relativePath.replace(/^\/+/, '');
  return `${rootUrl}/${cleanedRelative}`;
}

/**
 * 校验并解析远端清单 JSON。
 */
function parseRemoteManifest(payload: unknown): LayaPackageManifest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('模型清单不是合法 JSON 对象');
  }
  const record = payload as Record<string, unknown>;
  const format = record.format;
  if (format !== 'tangtou-choice-v0' && format !== 'tangtou-ort-v0') {
    throw new Error(
      '不支持的清单 format，仅接受 tangtou-choice-v0 或 tangtou-ort-v0',
    );
  }
  const version =
    typeof record.version === 'string' && record.version.trim()
      ? record.version.trim()
      : '0';
  const label =
    typeof record.label === 'string' ? record.label.trim() : undefined;
  const filesRaw = Array.isArray(record.files) ? record.files : [];
  const files = filesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const fileRecord = entry as Record<string, unknown>;
      const path =
        typeof fileRecord.path === 'string' ? fileRecord.path.trim() : '';
      if (!path) {
        return null;
      }
      return {
        path,
        sha256:
          typeof fileRecord.sha256 === 'string'
            ? fileRecord.sha256.trim()
            : undefined,
        optional: fileRecord.optional === true,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const ioProtocol =
    typeof record.ioProtocol === 'string' && record.ioProtocol.trim()
      ? record.ioProtocol.trim()
      : undefined;
  const featureDim =
    typeof record.featureDim === 'number' &&
    Number.isFinite(record.featureDim) &&
    record.featureDim > 0
      ? Math.floor(record.featureDim)
      : undefined;
  const maxOptions =
    typeof record.maxOptions === 'number' &&
    Number.isFinite(record.maxOptions) &&
    record.maxOptions > 0
      ? Math.floor(record.maxOptions)
      : undefined;

  return {
    format,
    version,
    label,
    files,
    ioProtocol,
    featureDim,
    maxOptions,
  };
}

/**
 * 下载单个文件为 ArrayBuffer；失败时按 optional 决定是否抛错。
 */
async function fetchModelFileBuffer(
  absoluteUrl: string,
  optional: boolean,
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(absoluteUrl, { method: 'GET' });
    if (!response.ok) {
      if (optional) {
        return null;
      }
      throw new Error(`下载失败 HTTP ${response.status}：${absoluteUrl}`);
    }
    return await response.arrayBuffer();
  } catch (error: unknown) {
    if (optional) {
      return null;
    }
    throw error instanceof Error
      ? error
      : new Error(`下载失败：${absoluteUrl}`);
  }
}

/**
 * 启用内置轻量判断包（无外网、无 ONNX），立即可供 localEngine 使用。
 */
export async function enableBuiltinLayaChoicePackage(): Promise<LayaModelStatusSnapshot> {
  const manifest = createBuiltinChoiceManifest();
  const nowIso = new Date().toISOString();
  await writeCachedPackage(
    {
      id: LAYA_ACTIVE_PACKAGE_ID,
      manifest,
      sourceUrl: '',
      builtin: true,
      fileSizes: {},
      cachedAt: nowIso,
    },
    [],
  );
  const snapshot: LayaModelStatusSnapshot = {
    lifecycle: 'ready',
    progressPercent: 100,
    message: `已启用内置轻量包（${manifest.label ?? manifest.format}）`,
    format: manifest.format,
    version: manifest.version,
    sourceUrl: '',
    builtin: true,
    updatedAt: nowIso,
  };
  await persistStatusSnapshot(snapshot);
  return snapshot;
}

/**
 * 从模型根 URL 下载清单与文件并缓存；过程中持续更新进度状态。
 */
export async function downloadLayaModelFromUrl(
  rawRootUrl: string,
): Promise<LayaModelStatusSnapshot> {
  const rootUrl = normalizeModelRootUrl(rawRootUrl);
  if (!rootUrl) {
    throw new Error('请先填写 Laya 模型 URL，或改用「启用内置轻量包」');
  }

  const startedAt = new Date().toISOString();
  await persistStatusSnapshot({
    lifecycle: 'downloading',
    progressPercent: 2,
    message: '正在拉取模型清单…',
    sourceUrl: rootUrl,
    builtin: false,
    updatedAt: startedAt,
  });

  try {
    const manifestUrl = joinModelUrl(rootUrl, LAYA_MANIFEST_FILE_NAME);
    const manifestResponse = await fetch(manifestUrl, { method: 'GET' });
    if (!manifestResponse.ok) {
      throw new Error(
        `无法下载清单（HTTP ${manifestResponse.status}）。请确认根地址下存在 ${LAYA_MANIFEST_FILE_NAME}`,
      );
    }
    const manifestJson: unknown = await manifestResponse.json();
    const manifest = parseRemoteManifest(manifestJson);

    const requiredFiles = manifest.files.filter((entry) => !entry.optional);
    const totalSteps = Math.max(requiredFiles.length + manifest.files.length, 1);
    let completedSteps = 0;
    const blobs: Array<{ path: string; buffer: ArrayBuffer }> = [];
    const fileSizes: Record<string, number> = {};

    for (const fileEntry of manifest.files) {
      const absoluteUrl = joinModelUrl(rootUrl, fileEntry.path);
      await persistStatusSnapshot({
        lifecycle: 'downloading',
        progressPercent: Math.min(
          95,
          Math.round(((completedSteps + 0.2) / totalSteps) * 100),
        ),
        message: `正在下载 ${fileEntry.path}…`,
        sourceUrl: rootUrl,
        builtin: false,
        format: manifest.format,
        version: manifest.version,
        updatedAt: new Date().toISOString(),
      });
      const buffer = await fetchModelFileBuffer(
        absoluteUrl,
        fileEntry.optional === true,
      );
      completedSteps += 1;
      if (buffer) {
        blobs.push({ path: fileEntry.path, buffer });
        fileSizes[fileEntry.path] = buffer.byteLength;
      }
    }

    const nowIso = new Date().toISOString();
    await writeCachedPackage(
      {
        id: LAYA_ACTIVE_PACKAGE_ID,
        manifest,
        sourceUrl: rootUrl,
        builtin: false,
        fileSizes,
        cachedAt: nowIso,
      },
      blobs,
    );

    const snapshot: LayaModelStatusSnapshot = {
      lifecycle: 'ready',
      progressPercent: 100,
      message:
        manifest.format === 'tangtou-ort-v0'
          ? `已缓存 ONNX 包 v${manifest.version}（推理走 Offscreen；接口未对齐时自动回退轻量判断）`
          : `已缓存轻量判断包 v${manifest.version}`,
      format: manifest.format,
      version: manifest.version,
      sourceUrl: rootUrl,
      builtin: false,
      updatedAt: nowIso,
    };
    await persistStatusSnapshot(snapshot);
    return snapshot;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : '下载本机模型失败';
    const snapshot: LayaModelStatusSnapshot = {
      lifecycle: 'error',
      progressPercent: 0,
      message,
      sourceUrl: rootUrl,
      builtin: false,
      updatedAt: new Date().toISOString(),
    };
    await persistStatusSnapshot(snapshot);
    throw new Error(message);
  }
}

/**
 * 清除本机模型缓存并恢复空闲状态。
 */
export async function clearLayaModelCache(): Promise<LayaModelStatusSnapshot> {
  await clearCachedPackageBlobs();
  const snapshot = createIdleLayaStatus();
  snapshot.message = '已清除本机判断包缓存';
  snapshot.updatedAt = new Date().toISOString();
  await persistStatusSnapshot(snapshot);
  return snapshot;
}

/**
 * 本机判断是否已就绪（供 localEngine.ready）。
 */
export async function isLayaModelReady(): Promise<boolean> {
  const status = await getLayaModelStatus();
  if (status.lifecycle !== 'ready') {
    return false;
  }
  const meta = await readCachedLayaPackageMeta();
  return Boolean(meta?.manifest);
}
