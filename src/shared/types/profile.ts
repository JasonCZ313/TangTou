/** 填写模式：预览确认后再写入，或直接写入页面 */
export type FillMode = 'preview' | 'direct';

/** 全局设置（与档案分离，含 API 与默认档案指针） */
export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  fillMode: FillMode;
  activeProfileId: string | null;
}

/** 基本信息（联系与身份） */
export interface BasicInfo {
  fullName: string;
  phone: string;
  email: string;
  /** 现居城市（硬必填） */
  currentCity: string;
  /** @deprecated 兼容旧字段，归一化时并入 currentCity */
  city?: string;
  englishName?: string;
  formerName?: string;
  alternatePhone?: string;
  alternateEmail?: string;
  gender?: string;
  birthday?: string;
  age?: string;
  nationality?: string;
  ethnicity?: string;
  nativePlace?: string;
  birthPlace?: string;
  hukouLocation?: string;
  hukouType?: string;
  currentAddress?: string;
  postalCode?: string;
  idType?: string;
  idNumber?: string;
  politicalStatus?: string;
  partyJoinDate?: string;
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
  expectedCities?: string;
  expectedIndustry?: string;
  jobType?: string;
  jobStatus?: string;
  salaryMin?: string;
  salaryMax?: string;
  salaryNegotiable?: string;
  /** 兼容旧字段 */
  expectedSalary?: string;
  availableDate?: string;
  workCity?: string;
  acceptTravel?: string;
  acceptRelocation?: string;
  acceptOvertime?: string;
  yearsOfExperience?: string;
  selfIntroShort?: string;
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
  city?: string;
  gpa?: string;
  rank?: string;
  courses?: string;
  campusRole?: string;
  thesis?: string;
  description?: string;
}

/** 单条实习/工作经历 */
export interface ExperienceItem {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  department?: string;
  city?: string;
  employmentType?: string;
  companyType?: string;
  industry?: string;
  subordinateCount?: string;
  refereeName?: string;
  refereePhone?: string;
  leaveReason?: string;
  description: string;
}

/** 单条项目经历 */
export interface ProjectItem {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  link?: string;
  techStack?: string;
  teamSize?: string;
  description: string;
}

/** 校园/社团/志愿 */
export interface CampusActivityItem {
  organization: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description?: string;
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
export interface CertificateItem {
  name: string;
  level?: string;
  issuer?: string;
  date?: string;
  number?: string;
  major?: string;
}

/** 奖项 */
export interface AwardItem {
  name: string;
  level?: string;
  date?: string;
  description?: string;
}

/** 论文/专利/著作 */
export interface PublicationItem {
  kind: string;
  title: string;
  venueOrNumber?: string;
  date?: string;
  authorOrder?: string;
  link?: string;
}

/** 培训 */
export interface TrainingItem {
  organization: string;
  course: string;
  startDate?: string;
  endDate?: string;
  certificate?: string;
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
}

/** 外企/工作许可 */
export interface WorkAuthInfo {
  needsVisa?: string;
  currentWorkAuth?: string;
  willingToRelocate?: string;
  linkedinUrl?: string;
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
  skills: string[];
  computerLevel?: string;
  officeSkillLevel?: string;
  languages: LanguageItem[];
  certificates: CertificateItem[];
  awards: AwardItem[];
  publications: PublicationItem[];
  trainings: TrainingItem[];
  familyMembers: FamilyMemberItem[];
  emergencyContact: EmergencyContact;
  specialOrg: SpecialOrgInfo;
  workAuth: WorkAuthInfo;
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
