/**
 * 把旧版设置里的 fillMode 等废弃字段丢掉，并补上 Laya / Decision 默认值。
 */
import type { AppSettings } from '../types/profile';
import {
  DEFAULT_SETTINGS,
  LEGACY_DEFAULT_LAYA_MODEL_URL,
} from './defaults';

const SETTINGS_STORAGE_KEY = 'settings';

/**
 * 把置信度夹到 0..1；非法值回退默认。
 */
function normalizeMinConfidence(rawValue: unknown): number {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return DEFAULT_SETTINGS.decisionMinConfidence;
  }
  if (rawValue < 0) {
    return 0;
  }
  if (rawValue > 1) {
    return 1;
  }
  return rawValue;
}

/**
 * 归一化 Laya URL：允许空字符串；旧版 HF 默认迁为空占位。
 */
function normalizeLayaModelUrl(rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    return DEFAULT_SETTINGS.layaModelUrl;
  }
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === LEGACY_DEFAULT_LAYA_MODEL_URL) {
    return '';
  }
  return trimmed;
}

/**
 * 归一化存储中的设置对象，兼容缺字段的旧数据。
 */
function normalizeStoredSettings(
  rawSettings: Partial<AppSettings> & { fillMode?: string },
): AppSettings {
  const { fillMode: _removedFillMode, ...rest } = rawSettings;
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    layaModelUrl: normalizeLayaModelUrl(rest.layaModelUrl),
    layaEnabled:
      typeof rest.layaEnabled === 'boolean'
        ? rest.layaEnabled
        : DEFAULT_SETTINGS.layaEnabled,
    decisionPreferLocal:
      typeof rest.decisionPreferLocal === 'boolean'
        ? rest.decisionPreferLocal
        : DEFAULT_SETTINGS.decisionPreferLocal,
    decisionMinConfidence: normalizeMinConfidence(rest.decisionMinConfidence),
    enableProbeClicks:
      typeof rest.enableProbeClicks === 'boolean'
        ? rest.enableProbeClicks
        : DEFAULT_SETTINGS.enableProbeClicks,
  };
}

/**
 * 从 chrome.storage.local 读取全局设置。
 * 若尚未持久化或数据无效，则写回 DEFAULT_SETTINGS 并返回默认值。
 */
export async function getSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const rawSettings = stored[SETTINGS_STORAGE_KEY];

  if (rawSettings && typeof rawSettings === 'object') {
    return normalizeStoredSettings(
      rawSettings as Partial<AppSettings> & { fillMode?: string },
    );
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
  const mergedSettings = normalizeStoredSettings({
    ...currentSettings,
    ...partial,
  });
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: mergedSettings });
  return mergedSettings;
}
