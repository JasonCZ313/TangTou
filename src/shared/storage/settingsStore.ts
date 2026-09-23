import type { AppSettings } from '../types/profile';
import { DEFAULT_SETTINGS } from './defaults';

const SETTINGS_STORAGE_KEY = 'settings';

/**
 * 从 chrome.storage.local 读取全局设置。
 * 若尚未持久化或数据无效，则写回 DEFAULT_SETTINGS 并返回默认值。
 */
export async function getSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const rawSettings = stored[SETTINGS_STORAGE_KEY];

  if (rawSettings && typeof rawSettings === 'object') {
    return { ...DEFAULT_SETTINGS, ...(rawSettings as Partial<AppSettings>) };
  }

  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

/**
 * 将 partial 浅合并到当前设置并持久化，返回合并后的完整 AppSettings。
 */
export async function saveSettings(
  partial: Partial<AppSettings>,
): Promise<AppSettings> {
  const currentSettings = await getSettings();
  const mergedSettings: AppSettings = { ...currentSettings, ...partial };
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: mergedSettings });
  return mergedSettings;
}
