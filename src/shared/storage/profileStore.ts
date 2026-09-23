import { MAX_PROFILES, createEmptyProfileData } from './defaults';
import type { Profile, ProfileData } from '../types/profile';
import { getSettings, saveSettings } from './settingsStore';

/** 生成新档案的唯一 id */
function createId(): string {
  return crypto.randomUUID();
}

/** 当前时间的 ISO 8601 字符串，用于 createdAt / updatedAt */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 读取全部档案列表；storage 缺失或格式不对时返回空数组。
 */
export async function listProfiles(): Promise<Profile[]> {
  const stored = await chrome.storage.local.get('profiles');
  const profiles = stored.profiles;
  return Array.isArray(profiles) ? (profiles as Profile[]) : [];
}

/**
 * 将档案数组写入 storage；超过 MAX_PROFILES 时抛出 PROFILE_LIMIT_REACHED。
 */
async function writeProfiles(profiles: Profile[]): Promise<void> {
  if (profiles.length > MAX_PROFILES) {
    throw new Error('PROFILE_LIMIT_REACHED');
  }
  await chrome.storage.local.set({ profiles });
}

/**
 * 按 id 查找单份档案；不存在时返回 null。
 */
export async function getProfile(profileId: string): Promise<Profile | null> {
  const profiles = await listProfiles();
  return profiles.find((item) => item.id === profileId) ?? null;
}

/**
 * 创建档案：空白 data，或从 cloneFromId 对应档案 structuredClone 深拷贝 data。
 * 已有 MAX_PROFILES 份时抛出 PROFILE_LIMIT_REACHED；源档案不存在时抛出 SOURCE_PROFILE_NOT_FOUND。
 * 若当前无 activeProfileId，则将新档案设为默认选用。
 */
export async function createProfile(options: {
  name: string;
  cloneFromId?: string;
}): Promise<Profile> {
  const profiles = await listProfiles();
  if (profiles.length >= MAX_PROFILES) {
    throw new Error('PROFILE_LIMIT_REACHED');
  }

  let data = createEmptyProfileData();
  if (options.cloneFromId) {
    const sourceProfile = profiles.find(
      (item) => item.id === options.cloneFromId,
    );
    if (!sourceProfile) {
      throw new Error('SOURCE_PROFILE_NOT_FOUND');
    }
    data = structuredClone(sourceProfile.data);
  }

  const timestamp = nowIso();
  const newProfile: Profile = {
    id: createId(),
    name: options.name.trim() || `档案 ${profiles.length + 1}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    data,
  };

  const nextProfiles = [...profiles, newProfile];
  await writeProfiles(nextProfiles);

  const settings = await getSettings();
  if (!settings.activeProfileId) {
    await saveSettings({ activeProfileId: newProfile.id });
  }

  return newProfile;
}

/**
 * 重命名档案（id 不变）；不存在时抛出 PROFILE_NOT_FOUND。
 */
export async function renameProfile(
  profileId: string,
  name: string,
): Promise<Profile> {
  const profiles = await listProfiles();
  const index = profiles.findIndex((item) => item.id === profileId);
  if (index === -1) {
    throw new Error('PROFILE_NOT_FOUND');
  }

  const trimmedName = name.trim();
  const updatedProfile: Profile = {
    ...profiles[index],
    name: trimmedName || profiles[index].name,
    updatedAt: nowIso(),
  };

  const nextProfiles = [...profiles];
  nextProfiles[index] = updatedProfile;
  await writeProfiles(nextProfiles);
  return updatedProfile;
}

/**
 * 替换指定档案的 ProfileData 并刷新 updatedAt；不存在时抛出 PROFILE_NOT_FOUND。
 */
export async function updateProfileData(
  profileId: string,
  data: ProfileData,
): Promise<Profile> {
  const profiles = await listProfiles();
  const index = profiles.findIndex((item) => item.id === profileId);
  if (index === -1) {
    throw new Error('PROFILE_NOT_FOUND');
  }

  // 深拷贝后再写入，避免调用方保留 data 引用并后续 mutate 污染 storage 中的档案
  const clonedData = structuredClone(data);
  const updatedProfile: Profile = {
    ...profiles[index],
    data: clonedData,
    updatedAt: nowIso(),
  };

  const nextProfiles = [...profiles];
  nextProfiles[index] = updatedProfile;
  await writeProfiles(nextProfiles);
  return updatedProfile;
}

/**
 * 删除档案；若删除的是当前 activeProfileId，则切到剩余列表第一份或 null。
 */
export async function deleteProfile(profileId: string): Promise<void> {
  const profiles = await listProfiles();
  const nextProfiles = profiles.filter((item) => item.id !== profileId);
  await writeProfiles(nextProfiles);

  const settings = await getSettings();
  if (settings.activeProfileId === profileId) {
    await saveSettings({
      activeProfileId: nextProfiles[0]?.id ?? null,
    });
  }
}

/**
 * 设置全局默认选用的档案 id；传入 null 表示不指定默认档案。
 * 传入非 null 时若档案不存在则抛出 PROFILE_NOT_FOUND。
 */
export async function setActiveProfileId(
  profileId: string | null,
): Promise<void> {
  if (profileId !== null) {
    const profile = await getProfile(profileId);
    if (!profile) {
      throw new Error('PROFILE_NOT_FOUND');
    }
  }
  await saveSettings({ activeProfileId: profileId });
}
