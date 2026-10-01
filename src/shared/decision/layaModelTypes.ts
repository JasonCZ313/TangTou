/**
 * 本机 Laya 模型包与下载状态的类型定义。
 * 包内不含权重；用户从 URL 下载，或一键启用内置「轻量选项判断」包。
 */

/** 支持的本机包格式 */
export type LayaPackageFormat =
  /** 无需 ONNX：本机用档案启发式做选项/是否题（P2b 可立刻用） */
  | 'tangtou-choice-v0'
  /** 预留：下载 ONNX 后在 Offscreen 用 onnxruntime-web 推理 */
  | 'tangtou-ort-v0';

/** 清单里列出的单个文件 */
export interface LayaManifestFileEntry {
  /** 相对模型根 URL 的路径，例如 model.onnx */
  path: string;
  /** 可选校验用十六进制 sha256；缺省则只校验下载成功 */
  sha256?: string;
  /** 是否允许缺失（默认 false） */
  optional?: boolean;
}

/**
 * 发布在模型根目录的清单文件名约定。
 * 下载时优先拉取该文件，再按 files 列表缓存到 IndexedDB。
 */
export const LAYA_MANIFEST_FILE_NAME = 'tangtou-laya-manifest.json';

/**
 * 远端 / 内置包的清单结构。
 */
export interface LayaPackageManifest {
  format: LayaPackageFormat;
  version: string;
  /** 给人看的说明 */
  label?: string;
  files: LayaManifestFileEntry[];
  /**
   * P2c：ORT 包的 I/O 协议名。
   * 当前实现：`tangtou-score-v0`（定长哈希特征 → 每选项分数）。
   * 缺省时 Offscreen 仍尝试 score-v0；对不上则回退轻量判断。
   */
  ioProtocol?: string;
  /** 特征维；缺省 64 */
  featureDim?: number;
  /** 单题最多选项；缺省 16 */
  maxOptions?: number;
}

/** 本机缓存生命周期状态 */
export type LayaModelLifecycle =
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * 暴露给 Options / 侧栏 / localEngine 的状态快照。
 */
export interface LayaModelStatusSnapshot {
  lifecycle: LayaModelLifecycle;
  /** 0～100；仅 downloading 时有意义 */
  progressPercent: number;
  /** 当前进度说明或错误文案 */
  message: string;
  /** 已就绪时的包格式 */
  format?: LayaPackageFormat;
  /** 已就绪时的包版本 */
  version?: string;
  /** 下载源根 URL；内置包为空串 */
  sourceUrl: string;
  /** 是否为扩展内置轻量包（无需外网） */
  builtin: boolean;
  updatedAt: string;
}

/** chrome.storage.local 里存状态元数据的键 */
export const LAYA_MODEL_STATUS_STORAGE_KEY = 'tangtou.layaModelStatus';

/** IndexedDB 数据库名与对象仓库名 */
export const LAYA_MODEL_DB_NAME = 'tangtou-laya-model';
export const LAYA_MODEL_DB_VERSION = 1;
export const LAYA_MODEL_META_STORE = 'packageMeta';
export const LAYA_MODEL_BLOB_STORE = 'packageBlobs';

/** 写入 IDB 的包元数据主键（同时只缓存一份） */
export const LAYA_ACTIVE_PACKAGE_ID = 'active';

/**
 * IndexedDB 中的包元数据记录。
 */
export interface LayaCachedPackageMeta {
  id: typeof LAYA_ACTIVE_PACKAGE_ID;
  manifest: LayaPackageManifest;
  sourceUrl: string;
  builtin: boolean;
  /** 各文件 path → 字节数 */
  fileSizes: Record<string, number>;
  cachedAt: string;
}

/**
 * 构造「内置轻量选项判断」清单：无文件、立即可用。
 */
export function createBuiltinChoiceManifest(): LayaPackageManifest {
  return {
    format: 'tangtou-choice-v0',
    version: '0.1.0',
    label: '内置轻量选项/是否判断（无 ONNX 权重）',
    files: [],
  };
}

/**
 * 默认空闲状态（尚未下载或已清除）。
 */
export function createIdleLayaStatus(): LayaModelStatusSnapshot {
  return {
    lifecycle: 'idle',
    progressPercent: 0,
    message: '尚未启用本机判断包。可一键启用内置轻量包，或填写模型 URL 后下载。',
    sourceUrl: '',
    builtin: false,
    updatedAt: new Date().toISOString(),
  };
}
