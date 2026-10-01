/**
 * 全局设置（与档案分离，含 API、默认档案、本机 Laya 模型地址）。
 * 已取消「直接填写」：一律预览确认后再写入。
 */
export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  activeProfileId: string | null;
  /**
   * 本机 Laya ONNX / Server 资源根 URL。
   * 空字符串表示未配置（推荐默认）；P2b 下载或 P2c Server 使用。
   */
  layaModelUrl: string;
  /** 是否启用本机 Laya（未下载或失败时自动回退用户 API 判断） */
  layaEnabled: boolean;
  /**
   * 本机就绪时是否优先走 Laya（关闭则直接云端/规则）。
   * P1 本机为桩时该开关不改变实际路径，仅预留行为。
   */
  decisionPreferLocal: boolean;
  /**
   * Decision 写入预览的最低置信度（0..1）。
   * 低于此值的云端/本机提案进跳过列表，不进可写项。
   */
  decisionMinConfidence: number;
}

/**
 * 省市区三级选择结果。
 * text 供展示与 LLM；code/name 用于回显与回跳。
 */
export interface RegionSelection {
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  /** 展示文案，如「广东省 / 深圳市 / 南山区」 */
  text: string;
}

/** 创建空白地区选择 */
export function createEmptyRegionSelection(): RegionSelection {
  return {
    provinceCode: '',
    provinceName: '',
    cityCode: '',
    cityName: '',
    districtCode: '',
    districtName: '',
    text: '',
  };
}

/** 基本信息（联系与身份） */
export interface BasicInfo {
  fullName: string;
  phone: string;
  email: string;
  /** 现居城市展示文案（硬必填） */
  currentCity: string;
  /** 现居城市结构化 */
  currentCityRegion?: RegionSelection;
  /** @deprecated 兼容旧字段，归一化时并入 currentCity */
  city?: string;
  englishName?: string;
  formerName?: string;
  alternatePhone?: string;
  alternateEmail?: string;
  gender?: string;
  birthday?: string;
  age?: string;
  /** 国籍（硬必填） */
  nationality?: string;
  ethnicity?: string;
  /** 籍贯展示文案（硬必填） */
  nativePlace?: string;
  nativePlaceRegion?: RegionSelection;
  birthPlace?: string;
  birthPlaceRegion?: RegionSelection;
  hukouLocation?: string;
  hukouLocationRegion?: RegionSelection;
  hukouType?: string;
  currentAddress?: string;
  postalCode?: string;
  /** 证件类型（硬必填） */
  idType?: string;
  /** 证件号码（硬必填） */
  idNumber?: string;
  /** 政治面貌（硬必填） */
  politicalStatus?: string;
  partyJoinDate?: string;
  /** 婚姻状况（硬必填） */
  maritalStatus?: string;
  fertilityStatus?: string;
  healthStatus?: string;
  heightCm?: string;
  weightKg?: string;
  militaryStatus?: string;
  disabilityStatus?: string;
  personalWebsite?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  wechatId?: string;
}

/** 求职意向 */
export interface JobIntent {
  targetRole: string;
  /** 期望城市展示文案（多个用顿号分隔） */
  expectedCities?: string;
  /** 期望城市结构化列表（与文案对应） */
  expectedCitiesRegions?: RegionSelection[];
  expectedIndustry?: string;
  jobType?: string;
  jobStatus?: string;
  salaryMin?: string;
  salaryMax?: string;
  salaryNegotiable?: string;
  /** 兼容旧字段 */
  expectedSalary?: string;
  availableDate?: string;
  /** 工作城市展示文案 */
  workCity?: string;
  /** 工作城市结构化 */
  workCityRegion?: RegionSelection;
  acceptTravel?: string;
  acceptRelocation?: string;
  acceptOvertime?: string;
  yearsOfExperience?: string;
  selfIntroShort?: string;
}

/** 双学位时的第二学位信息 */
export interface SecondDegreeInfo {
  school: string;
  major: string;
  degreeLevel: string;
  academicDegree?: string;
  college?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

/** 单条教育经历 */
export interface EducationItem {
  school: string;
  /** 学历层次 code 或中文（存 code 优先） */
  degreeLevel: string;
  /** 兼容旧字段 degree */
  degree?: string;
  major: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  college?: string;
  academicDegree?: string;
  studyMode?: string;
  educationType?: string;
  isHighest?: boolean;
  isFirstDegree?: boolean;
  durationYears?: string;
  /** 就读城市展示文案 */
  city?: string;
  /** 就读城市结构化 */
  cityRegion?: RegionSelection;
  gpa?: string;
  rank?: string;
  courses?: string;
  campusRole?: string;
  thesis?: string;
  description?: string;
  /** 这一段教育里用到或具备的技能，多项用顿号分隔 */
  skillsInvolved?: string;
  /** 学位为双学位时填写 */
  secondDegree?: SecondDegreeInfo;
}

/**
 * 可锁定编辑的列表条目公共字段：稳定 id、只读态、附件备注与网盘。
 */
export interface LockableListItemFields {
  /** 稳定主键，绑定附件与「保存本条」状态 */
  id: string;
  /** true 时卡片只读展示全貌，点「编辑」再开 */
  editingLocked?: boolean;
  /** 本条附件说明（如发证机关、有效期提示） */
  attachmentNote?: string;
  /** 本条相关网盘/外链 */
  cloudLink?: string;
}

/** 单条实习/工作经历 */
export interface ExperienceItem extends LockableListItemFields {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  department?: string;
  /** 工作城市展示文案 */
  city?: string;
  /** 工作城市结构化 */
  cityRegion?: RegionSelection;
  employmentType?: string;
  companyType?: string;
  industry?: string;
  subordinateCount?: string;
  refereeName?: string;
  refereePhone?: string;
  leaveReason?: string;
  /** 总述（兼容旧字段） */
  description: string;
  /** 工作职责（条目/要点） */
  responsibilities?: string;
  /** 工作内容（日常做了什么） */
  workContent?: string;
  /** 业绩/成果（量化优先） */
  achievements?: string;
  /** 这一段工作或实习里用到或具备的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 单条项目经历 */
export interface ProjectItem extends LockableListItemFields {
  name: string;
  role?: string;
  /** 本项目职责，最多 12 个字 */
  duty?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  link?: string;
  techStack?: string;
  teamSize?: string;
  /** 总述 */
  description: string;
  /** 项目内容 */
  content?: string;
  /** 项目价值/成果 */
  value?: string;
}

/** 校园/社团/志愿 */
export interface CampusActivityItem {
  organization: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  /** 这一段校园经历里用到或具备的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 单条技能（结构化，禁止逗号拼接） */
export interface SkillItem {
  name: string;
  level?: string;
  years?: string;
  category?: string;
}

/** 语言能力 */
export interface LanguageItem {
  language: string;
  proficiency: string;
  certificate?: string;
  score?: string;
  obtainedDate?: string;
}

/** 证书/资格 */
export interface CertificateItem extends LockableListItemFields {
  name: string;
  level?: string;
  issuer?: string;
  date?: string;
  expireDate?: string;
  number?: string;
  major?: string;
  description?: string;
  /** 这本证书对应或涉及的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 奖项 */
export interface AwardItem extends LockableListItemFields {
  name: string;
  /** 级别：校级、省级、国家级 */
  level?: string;
  /** 奖次：一等奖、二等奖、金奖等 */
  prizeRank?: string;
  date?: string;
  issuer?: string;
  description?: string;
  /** 这一项奖项对应或涉及的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 论文/专利/著作 */
export interface PublicationItem {
  kind: string;
  title: string;
  venueOrNumber?: string;
  date?: string;
  authorOrder?: string;
  link?: string;
  /** 这项成果用到或涉及的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 培训 */
export interface TrainingItem {
  organization: string;
  course: string;
  startDate?: string;
  endDate?: string;
  certificate?: string;
  /** 这次培训学到或涉及的技能，多项用顿号分隔 */
  skillsInvolved?: string;
}

/** 家庭成员 */
export interface FamilyMemberItem {
  relationship: string;
  name: string;
  age?: string;
  politicalStatus?: string;
  employer?: string;
  title?: string;
  phone?: string;
}

/** 紧急联系人 */
export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

/** 体制/银行等特殊项 */
export interface SpecialOrgInfo {
  hasRelativeInOrg?: string;
  relativeDetail?: string;
  isFreshGraduate?: string;
  graduationDestination?: string;
  archiveLocation?: string;
  reportLetterTitle?: string;
  studentOrigin?: string;
  directedTraining?: string;
  grassrootsService?: string;
  civilServiceExamHistory?: string;
}

/** 外企/工作许可 */
export interface WorkAuthInfo {
  needsVisa?: string;
  currentWorkAuth?: string;
  willingToRelocate?: string;
  linkedinUrl?: string;
  englishResumeUrl?: string;
  passportNationality?: string;
}

/**
 * 多行业网申补充字段（全部可选，按目标行业填写）。
 * 值均为字符串，便于映射到任意站点表单。
 */
export interface IndustryExtras {
  // —— 银行/金融 ——
  acceptCounterWork?: string;
  acceptSuburbTransfer?: string;
  riskComplianceAck?: string;
  relativeInFinance?: string;
  securitiesFundCert?: string;
  amlTraining?: string;
  // —— 医疗/医护 ——
  medicalLicense?: string;
  residencyTraining?: string;
  departmentIntent?: string;
  acceptNightShift?: string;
  infectiousDiseaseNote?: string;
  // —— 教师/教育 ——
  teacherCertStage?: string;
  teacherCertSubject?: string;
  mandarinLevel?: string;
  teacherExamStatus?: string;
  // —— 法律 ——
  judicialExam?: string;
  lawPracticeArea?: string;
  lawFirmCourtIntern?: string;
  // —— 互联网/产品技术 ——
  openSourceContrib?: string;
  techBlogUrl?: string;
  // —— 制造/物流/蓝领 ——
  driverLicenseType?: string;
  specialOperationCert?: string;
  acceptShiftWork?: string;
  acceptOnsiteTravel?: string;
  // —— 军工/保密 ——
  politicalReviewWilling?: string;
  classifiedWorkNote?: string;
  // —— 实习专项 ——
  weeklyOnsiteDays?: string;
  internToFullTime?: string;
  internDurationMonths?: string;
}

/** 自定义问答素材 */
export interface EssayBank {
  selfEvaluation?: string;
  careerPlan?: string;
  strengthsWeaknesses?: string;
  whyJoin?: string;
  projectDeepDive?: string;
  other?: string;
}

/** 附件备注（不存二进制） */
export interface AttachmentNotes {
  resumeFileNote?: string;
  photoReady?: string;
  portfolioCloudLink?: string;
}

/** 结构化档案正文：超全主数据，一次填写长期复用 */
export interface ProfileData {
  basic: BasicInfo;
  jobIntent: JobIntent;
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  campusActivities: CampusActivityItem[];
  skills: SkillItem[];
  computerLevel?: string;
  officeSkillLevel?: string;
  languages: LanguageItem[];
  certificates: CertificateItem[];
  awards: AwardItem[];
  publications: PublicationItem[];
  trainings: TrainingItem[];
  familyMembers: FamilyMemberItem[];
  /** @deprecated 兼容旧单对象，归一化迁入 emergencyContacts */
  emergencyContact?: EmergencyContact;
  emergencyContacts: EmergencyContact[];
  specialOrg: SpecialOrgInfo;
  workAuth: WorkAuthInfo;
  industryExtras: IndustryExtras;
  essays: EssayBank;
  attachmentNotes: AttachmentNotes;
  /** 自由补充说明 */
  notes: string;
}

/** 一份可命名档案 */
export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  data: ProfileData;
}

/** storage 逻辑根结构约定 */
export interface StorageRoot {
  settings: AppSettings;
  profiles: Profile[];
}

/** 必填校验结果 */
export interface ProfileValidationResult {
  ok: boolean;
  missingRequired: string[];
  softWarnings: string[];
}
