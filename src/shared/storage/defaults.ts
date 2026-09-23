import type { AppSettings, ProfileData } from '../types/profile';

/** 档案数量上限（与产品规格一致） */
export const MAX_PROFILES = 5;

/**
 * 创建空白 ProfileData：字符串字段为空、列表为空数组，供新建档案与深拷贝起点使用。
 */
export function createEmptyProfileData(): ProfileData {
  return {
    basic: {
      fullName: '',
      phone: '',
      email: '',
      city: '',
    },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    jobIntent: {
      targetRole: '',
    },
    notes: '',
  };
}

/** 首次安装或未持久化设置时的默认全局配置 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  fillMode: 'preview',
  activeProfileId: null,
};
