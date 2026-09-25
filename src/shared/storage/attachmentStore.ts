/**
 * 档案附件的本机 IndexedDB：元数据与二进制分开存。
 * 仅扩展页面 / Background 可读写（与网页不同源）。
 */
import {
  ATTACHMENT_COUNT_LIMITS,
  AVATAR_MIME_TYPES,
  formatAttachmentSizeLimit,
  getAttachmentSizeLimit,
  type AttachmentKind,
  type AttachmentMeta,
} from '../types/attachment';

const DATABASE_NAME = 'tangtou-attachments';
const DATABASE_VERSION = 1;
const META_STORE = 'attachmentMeta';
const BLOB_STORE = 'attachmentBlobs';

interface AttachmentBlobRecord {
  id: string;
  buffer: ArrayBuffer;
}

/**
 * 打开（或创建）附件数据库。
 */
function openAttachmentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        const metaStore = database.createObjectStore(META_STORE, {
          keyPath: 'id',
        });
        metaStore.createIndex('byProfile', 'profileId', { unique: false });
      }
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开附件库'));
  });
}

/**
 * 列出某档案的全部附件元数据。
 */
export async function listAttachments(
  profileId: string,
): Promise<AttachmentMeta[]> {
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(META_STORE, 'readonly');
    const index = transaction.objectStore(META_STORE).index('byProfile');
    const request = index.getAll(profileId);
    request.onsuccess = () => {
      const rows = (request.result ?? []) as AttachmentMeta[];
      rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 列出某档案下绑定到指定条目的附件（可再按种类过滤）。
 */
export async function listAttachmentsForItem(
  profileId: string,
  itemId: string,
  kind?: AttachmentKind,
): Promise<AttachmentMeta[]> {
  const rows = await listAttachments(profileId);
  return rows.filter((row) => {
    if (row.itemId !== itemId) {
      return false;
    }
    if (kind && row.kind !== kind) {
      return false;
    }
    return true;
  });
}

/**
 * 档案是否已有头像附件。
 */
export async function profileHasAvatar(profileId: string): Promise<boolean> {
  const rows = await listAttachments(profileId);
  return rows.some((item) => item.kind === 'avatar');
}

/**
 * 读取附件二进制与元数据；不存在时返回 null。
 */
export async function readAttachmentFile(attachmentId: string): Promise<{
  meta: AttachmentMeta;
  buffer: ArrayBuffer;
} | null> {
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [META_STORE, BLOB_STORE],
      'readonly',
    );
    const metaRequest = transaction.objectStore(META_STORE).get(attachmentId);
    metaRequest.onsuccess = () => {
      const meta = metaRequest.result as AttachmentMeta | undefined;
      if (!meta) {
        resolve(null);
        return;
      }
      const blobRequest = transaction.objectStore(BLOB_STORE).get(attachmentId);
      blobRequest.onsuccess = () => {
        const blobRow = blobRequest.result as AttachmentBlobRecord | undefined;
        if (!blobRow) {
          resolve(null);
          return;
        }
        resolve({ meta, buffer: blobRow.buffer });
      };
      blobRequest.onerror = () => reject(blobRequest.error);
    };
    metaRequest.onerror = () => reject(metaRequest.error);
  });
}

/**
 * 写入一条附件；头像/简历同档案只保留一份；条目附件受份数上限约束。
 */
export async function saveAttachment(options: {
  profileId: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
  itemId?: string;
}): Promise<AttachmentMeta> {
  const sizeLimit = getAttachmentSizeLimit(options.kind);
  if (options.buffer.byteLength > sizeLimit) {
    throw new Error(
      `${options.kind === 'avatar' ? '头像' : '该附件'}不能超过 ${formatAttachmentSizeLimit(options.kind)}`,
    );
  }
  if (options.buffer.byteLength === 0) {
    throw new Error('文件是空的');
  }
  if (
    options.kind === 'avatar' &&
    !AVATAR_MIME_TYPES.includes(options.mimeType)
  ) {
    throw new Error('头像仅支持 JPG、PNG、WEBP');
  }

  const existing = await listAttachments(options.profileId);

  // 头像、简历：整档案唯一，新上传前清掉旧的
  if (options.kind === 'avatar' || options.kind === 'resume') {
    for (const item of existing) {
      if (item.kind === options.kind) {
        await deleteAttachment(item.id);
      }
    }
  } else {
    // 条目附件：必须带 itemId，并按种类+条目计份数
    if (!options.itemId) {
      throw new Error('条目附件缺少 itemId');
    }
    const sameScope = existing.filter(
      (item) =>
        item.kind === options.kind && item.itemId === options.itemId,
    );
    const countLimit = ATTACHMENT_COUNT_LIMITS[options.kind];
    if (sameScope.length >= countLimit) {
      throw new Error(
        `本条最多上传 ${countLimit} 个${options.kind === 'project' ? '项目' : ''}附件，请先删除再传`,
      );
    }
  }

  const meta: AttachmentMeta = {
    id: crypto.randomUUID(),
    profileId: options.profileId,
    kind: options.kind,
    fileName: options.fileName,
    mimeType: options.mimeType || 'application/octet-stream',
    sizeBytes: options.buffer.byteLength,
    updatedAt: new Date().toISOString(),
    itemId: options.itemId,
  };
  const blobRow: AttachmentBlobRecord = {
    id: meta.id,
    buffer: options.buffer,
  };

  const database = await openAttachmentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [META_STORE, BLOB_STORE],
      'readwrite',
    );
    transaction.objectStore(META_STORE).put(meta);
    transaction.objectStore(BLOB_STORE).put(blobRow);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  return meta;
}

/**
 * 删除一条附件（元数据与二进制）。
 */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  const database = await openAttachmentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      [META_STORE, BLOB_STORE],
      'readwrite',
    );
    transaction.objectStore(META_STORE).delete(attachmentId);
    transaction.objectStore(BLOB_STORE).delete(attachmentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * 删除某条目绑定的全部附件（删列表项时清理）。
 */
export async function deleteAttachmentsForItem(
  profileId: string,
  itemId: string,
): Promise<void> {
  const rows = await listAttachmentsForItem(profileId, itemId);
  for (const row of rows) {
    await deleteAttachment(row.id);
  }
}

/**
 * 删除某档案下全部附件（删档案时调用）。
 */
export async function deleteAttachmentsForProfile(
  profileId: string,
): Promise<void> {
  const rows = await listAttachments(profileId);
  for (const row of rows) {
    await deleteAttachment(row.id);
  }
}
