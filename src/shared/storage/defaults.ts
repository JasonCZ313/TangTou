import type { AppSettings, ProfileData } from '../types/profile';

/** 档案数量上限 */
export const MAX_PROFILES = 5;

/**
 * 创建空白超全 ProfileData，供新建、深拷贝与导入归一化底稿。
 */
export function createEmptyProfileData(): ProfileData {
  return {
    basic: {
      fullName: '',
      phone: '',
      email: '',
      currentCity: '',
      nationality: '',
      nativePlace: '',
      idType: '',
      idNumber: '',
      politicalStatus: '',
      maritalStatus: '',
    },
    jobIntent: {
      targetRole: '',
    },
    education: [],
    experience: [],
    projects: [],
    campusActivities: [],
    skills: [],
    computerLevel: '',
    officeSkillLevel: '',
    languages: [],
    certificates: [],
    awards: [],
    publications: [],
    trainings: [],
    familyMembers: [],
    emergencyContacts: [],
    specialOrg: {},
    workAuth: {},
    industryExtras: {},
    essays: {},
    attachmentNotes: {},
    notes: '',
  };
}

/** 首次安装默认全局配置 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  fillMode: 'preview',
  activeProfileId: null,
};
