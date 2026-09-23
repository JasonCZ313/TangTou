/** 填写模式：预览确认后再写入，或直接写入页面 */
export type FillMode = 'preview' | 'direct';

/** 全局设置（与档案分离，含 API 与默认档案指针） */
export interface AppSettings {
  /** OpenAI 兼容 API 根地址 */
  apiBaseUrl: string;
  /** 用户 API Key，仅存本机 storage */
  apiKey: string;
  /** Chat Completions 模型名 */
  model: string;
  /** 默认填写行为 */
  fillMode: FillMode;
  /** 当前默认选用的档案 id，无档案时为 null */
  activeProfileId: string | null;
}

/** 单条教育经历 */
export interface EducationItem {
  school: string;
  degree: string;
  major: string;
  startDate: string;
  endDate: string;
  description?: string;
}

/** 单条工作经历 */
export interface ExperienceItem {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
}

/** 单条项目经历 */
export interface ProjectItem {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  description: string;
  link?: string;
}

/** 结构化档案正文 + 补充说明，供 LLM 映射与填写参考 */
export interface ProfileData {
  basic: {
    fullName: string;
    phone: string;
    email: string;
    city: string;
    birthday?: string;
    gender?: string;
    personalWebsite?: string;
  };
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: string[];
  jobIntent: {
    targetRole: string;
    expectedSalary?: string;
    availableDate?: string;
    workCity?: string;
  };
  /** 证书、自我评价等零散信息，供模型参考 */
  notes: string;
}

/** 一份可命名档案（含元数据与正文） */
export interface Profile {
  id: string;
  name: string;
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** ISO 8601 最后更新时间 */
  updatedAt: string;
  data: ProfileData;
}

/** chrome.storage.local 逻辑根结构（settings / profiles 分 key 存储时的类型约定） */
export interface StorageRoot {
  settings: AppSettings;
  /** 最多 5 份档案 */
  profiles: Profile[];
}
