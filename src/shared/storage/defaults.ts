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

/**
 * 本机 Laya 模型下载根地址：默认空，由用户按引导填写（ModelScope / 自建 / 镜像）。
 * 旧版曾默认 HuggingFace，读取设置时会迁为空以免国内下载失败误导。
 */
export const DEFAULT_LAYA_MODEL_URL = '';

/** 历史默认 HF 地址；仅用于把已写入的旧默认迁成空占位 */
export const LEGACY_DEFAULT_LAYA_MODEL_URL =
  'https://huggingface.co/convaiinnovations/laya-multilingual/resolve/main';

/** 首次安装默认全局配置 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  activeProfileId: null,
  layaModelUrl: DEFAULT_LAYA_MODEL_URL,
  layaEnabled: true,
  decisionPreferLocal: true,
  decisionMinConfidence: 0.55,
  enableProbeClicks: true,
};
