/**
 * 简历识别结果的本机缓存。
 * 只保存模型抽出的字段，不写入档案；用户点「写入空白项」时才合并。
 */
import type { ProfileData } from '../types/profile';

/** 一份已识别、尚未强制写入档案的结果 */
export interface SavedResumeRecognition {
  attachmentId: string;
  fileName: string;
  savedAt: string;
  profilePatch: ProfileData;
  /** 抽出证书、奖项和自我评价的规则版本。旧结果没有这个字段 */
  recognitionRevision?: number;
}

/** 当前识别规则版本。旧缓存低于它时，档案页提示再识别一次 */
export const RESUME_RECOGNITION_REVISION = 2;

/**
 * 按档案隔离的存储键。
 */
function recognitionStorageKey(profileId: string): string {
  return `resumeRecognition:${profileId}`;
}

/**
 * 读取某档案最近一次识别结果；没有或结构不对时返回 null。
 */
export async function readResumeRecognition(
  profileId: string,
): Promise<SavedResumeRecognition | null> {
  const storageKey = recognitionStorageKey(profileId);
  const stored = await chrome.storage.local.get(storageKey);
  const rawValue = stored[storageKey];
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const record = rawValue as Partial<SavedResumeRecognition>;
  if (
    typeof record.attachmentId !== 'string' ||
    typeof record.fileName !== 'string' ||
    !record.profilePatch ||
    typeof record.profilePatch !== 'object'
  ) {
    return null;
  }
  return {
    attachmentId: record.attachmentId,
    fileName: record.fileName,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
    profilePatch: record.profilePatch,
    recognitionRevision:
      typeof record.recognitionRevision === 'number'
        ? record.recognitionRevision
        : undefined,
  };
}

/**
 * 保存识别结果，覆盖该档案上一次的缓存。
 */
export async function writeResumeRecognition(
  profileId: string,
  recognition: SavedResumeRecognition,
): Promise<void> {
  const storageKey = recognitionStorageKey(profileId);
  await chrome.storage.local.set({ [storageKey]: recognition });
}

/**
 * 删除该档案的识别缓存（换简历、删简历或删档案时调用）。
 */
export async function clearResumeRecognition(profileId: string): Promise<void> {
  await chrome.storage.local.remove(recognitionStorageKey(profileId));
}
