import type {
  CampusActivityItem,
  ExperienceItem,
  ProfileData,
  ProjectItem,
} from '../../shared/types/profile';
import { labelOfCatalog, DEGREE_LEVEL_OPTIONS } from '../../shared/catalogs/enums';
import { restoreListLineBreaks } from '../../shared/resume/restoreListBreaks';

/** 超你 offer 面板里的可编辑简历结构（只取填写引擎需要的字段） */
export interface ChaoEditable {
  profile: Record<string, string>;
  experiences: {
    internship: ChaoExpItem[];
    work: ChaoExpItem[];
    project: ChaoExpItem[];
  };
  customFields: Array<{ title: string; content: string }>;
}

/** 一条实习/工作/项目，字段名与超你 offer 一致 */
export interface ChaoExpItem {
  company?: string;
  title?: string;
  role?: string;
  start?: string;
  end?: string;
  description?: string;
}

/**
 * 把躺投档案转成超你 offer 填写引擎用的结构。
 * 不改档案本身，只在写入时做一次映射。
 */
export function profileToChaoEditable(profile: ProfileData): ChaoEditable {
  const basic = profile.basic;
  const topEducation = profile.education[0];
  const editable: ChaoEditable = {
    profile: {
      name: (basic.fullName || '').trim(),
      gender: (basic.gender || '').trim(),
      birthday: (basic.birthday || '').trim(),
      city: (basic.currentCity || basic.city || '').trim(),
      idType: (basic.idType || '').trim(),
      idNumber: (basic.idNumber || '').trim(),
      phone: (basic.phone || '').trim(),
      email: (basic.email || '').trim(),
      wechat: (basic.wechatId || '').trim(),
      github: (basic.githubUrl || '').trim(),
      homepage: (basic.personalWebsite || '').trim(),
      portfolio: (basic.portfolioUrl || '').trim(),
      website: (basic.personalWebsite || '').trim(),
      linkedin: (basic.linkedinUrl || '').trim(),
      emergencyContact: (profile.emergencyContacts?.[0]?.name || '').trim(),
      emergencyPhone: (profile.emergencyContacts?.[0]?.phone || '').trim(),
      school: (topEducation?.school || '').trim(),
      college: (topEducation?.college || '').trim(),
      major: (topEducation?.major || '').trim(),
      degree: labelOfCatalog(
        DEGREE_LEVEL_OPTIONS,
        (topEducation?.degreeLevel || topEducation?.degree || '').trim(),
      ),
      educationStart: (topEducation?.startDate || '').trim(),
      educationEnd: (topEducation?.endDate || '').trim(),
      mainCourses: (topEducation?.courses || '').trim(),
      nativePlace: (basic.nativePlace || '').trim(),
      politicalStatus: (basic.politicalStatus || '').trim(),
      address: (basic.currentAddress || '').trim(),
      jobIntent: (profile.jobIntent?.targetRole || profile.jobIntent?.jobType || '').trim(),
      expectedCity: (profile.jobIntent?.expectedCities || '').trim(),
      expectedSalary: (profile.jobIntent?.expectedSalary || '').trim(),
      availableDate: (profile.jobIntent?.availableDate || '').trim(),
      skills: profile.skills
        .map((item) => item.name.trim())
        .filter(Boolean)
        .join(' / '),
      advantages: restoreListLineBreaks(profile.essays?.selfEvaluation?.trim() || ''),
    },
    experiences: {
      internship: profile.experience.map(mapExperience),
      work: [],
      project: [
        ...profile.projects.map(mapProject),
        ...profile.campusActivities.map(mapCampusAsProject),
      ],
    },
    customFields: [
      ...profile.certificates
        .filter((item) => item.name.trim())
        .map((item) => ({
          title: '证书',
          content: [item.name, item.date, item.description].filter(Boolean).join(' '),
        })),
      ...profile.awards
        .filter((item) => item.name.trim())
        .map((item) => ({
          title: '奖项',
          content: [item.name, item.date, item.prizeRank, item.description]
            .filter(Boolean)
            .join(' '),
        })),
    ],
  };
  return editable;
}

/** 实习/工作 → 超你 offer 的 company/role/描述 */
function mapExperience(item: ExperienceItem): ChaoExpItem {
  return {
    company: (item.company || '').trim(),
    role: (item.title || '').trim(),
    start: (item.startDate || '').trim(),
    end: item.isCurrent ? '至今' : (item.endDate || '').trim(),
    description: restoreListLineBreaks(
      (item.responsibilities || item.workContent || item.description || '').trim(),
    ),
  };
}

/** 项目 → title/role/描述 */
function mapProject(item: ProjectItem): ChaoExpItem {
  return {
    title: (item.name || '').trim(),
    role: (item.role || '').trim(),
    start: (item.startDate || '').trim(),
    end: item.isCurrent ? '至今' : (item.endDate || '').trim(),
    description: restoreListLineBreaks((item.description || '').trim()),
  };
}

/**
 * 校内经历按项目块填：超你 offer 规则路径没有单独的校园块，
 * 但页面上「校内经历」常和项目同结构，放进 project 列表按顺序吃。
 */
function mapCampusAsProject(item: CampusActivityItem): ChaoExpItem {
  return {
    title: (item.organization || '').trim(),
    role: (item.role || '').trim(),
    start: (item.startDate || '').trim(),
    end: (item.endDate || '').trim(),
    description: restoreListLineBreaks((item.description || '').trim()),
  };
}
