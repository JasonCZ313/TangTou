import type { ProfileData } from '../../shared/types/profile';
import {
  labelOfCatalog,
  DEGREE_LEVEL_OPTIONS,
  GENDER_OPTIONS,
  POLITICAL_STATUS_OPTIONS,
  ID_TYPE_OPTIONS,
  ETHNICITY_OPTIONS,
} from '../../shared/catalogs/enums';
import { restoreListLineBreaks } from '../../shared/resume/restoreListBreaks';

/**
 * 行式条目：canonical 键（org/title/role/start/end/desc/name/date/level/score…）。
 * 所有分区共用同一套键，填写引擎因此只需要一个取值函数。
 */
export type ChaoRowItem = Record<string, string>;

/** 行分区类型（与引擎的 ROW_SECTION_TYPES 保持一致） */
export interface ChaoRows {
  education: ChaoRowItem[];
  internship: ChaoRowItem[];
  work: ChaoRowItem[];
  project: ChaoRowItem[];
  campus: ChaoRowItem[];
  certificates: ChaoRowItem[];
  awards: ChaoRowItem[];
  languages: ChaoRowItem[];
  publications: ChaoRowItem[];
}

/** 填写引擎需要的可编辑结构：基础字段 + 行式条目 + 自定义扩展字段 */
export interface ChaoEditable {
  profile: Record<string, string>;
  rows: ChaoRows;
  customFields: Array<{ title: string; content: string }>;
}

/**
 * 中文姓名拆成姓、名：复姓优先，否则首字为姓、其余为名；英文名按空格拆。
 */
function splitChineseName(fullName: string): { surname: string; givenName: string } {
  const nameText = fullName.trim();
  if (!nameText) return { surname: '', givenName: '' };
  if (/[a-zA-Z]/.test(nameText) && /\s/.test(nameText)) {
    const parts = nameText.split(/\s+/).filter(Boolean);
    return { surname: parts[0] || '', givenName: parts.slice(1).join(' ') };
  }
  const compoundSurnames = [
    '欧阳', '司马', '上官', '诸葛', '东方', '独孤', '南宫', '万俟', '闻人', '夏侯',
    '皇甫', '尉迟', '公孙', '慕容', '长孙', '司徒', '司空', '申屠',
  ];
  const compoundHit = compoundSurnames.find((item) => nameText.startsWith(item));
  if (compoundHit) {
    return { surname: compoundHit, givenName: nameText.slice(compoundHit.length) };
  }
  return { surname: nameText.slice(0, 1), givenName: nameText.slice(1) };
}

/** 政治面貌优先出短文案，方便和网申下拉「共青团员」等选项对齐 */
function politicalStatusForFill(rawValue: string): string {
  const chineseLabel = labelOfCatalog(POLITICAL_STATUS_OPTIONS, rawValue.trim());
  if (/团员/.test(chineseLabel) && !/预备/.test(chineseLabel)) return '共青团员';
  if (/预备党员/.test(chineseLabel)) return '中共预备党员';
  if (/党员/.test(chineseLabel)) return '中共党员';
  return chineseLabel;
}

/** 结束时间：在职/在读时统一写「至今」，由引擎去勾复选框 */
const endOf = (endDate: string | undefined, isCurrent: boolean | undefined) =>
  (isCurrent ? '至今' : (endDate || '').trim());

/**
 * 把躺投档案转成填写引擎用的结构。
 * 只做映射，不改档案本身；枚举一律出中文标签，行式条目标成 canonical 键。
 */
export function profileToChaoEditable(profile: ProfileData): ChaoEditable {
  const basic = profile.basic;
  const { surname, givenName } = splitChineseName(basic.fullName || '');
  const topEducation = profile.education[0];

  const profileFields: Record<string, string> = {
    name: (basic.fullName || '').trim(),
    surname,
    givenName,
    gender: labelOfCatalog(GENDER_OPTIONS, (basic.gender || '').trim()),
    birthday: (basic.birthday || '').trim(),
    ethnicity: labelOfCatalog(ETHNICITY_OPTIONS, (basic.ethnicity || '').trim()),
    city: (basic.currentCity || basic.city || '').trim(),
    idType: labelOfCatalog(ID_TYPE_OPTIONS, (basic.idType || '').trim()) || '身份证',
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
    // 教育散字段用最高学历兜底；教育分区里会按行逐条填
    school: (topEducation?.school || '').trim(),
    college: (topEducation?.college || '').trim(),
    major: (topEducation?.major || '').trim(),
    degree: labelOfCatalog(DEGREE_LEVEL_OPTIONS, (topEducation?.degreeLevel || topEducation?.degree || '').trim()),
    educationStart: (topEducation?.startDate || '').trim(),
    educationEnd: endOf(topEducation?.endDate, topEducation?.isCurrent),
    mainCourses: (topEducation?.courses || '').trim(),
    nativePlace: (basic.nativePlace || '').trim(),
    hukouLocation: (basic.hukouLocation || '').trim(),
    // 省市结构化：网申的「户籍/现居」多是省、市两级级联下拉，必须分别给值
    hukouProvince: (basic.hukouLocationRegion?.provinceName || '').trim(),
    hukouCity: (basic.hukouLocationRegion?.cityName || '').trim(),
    liveProvince: (basic.currentCityRegion?.provinceName || '').trim(),
    liveCity: (basic.currentCityRegion?.cityName || '').trim(),
    expectedProvince: (profile.jobIntent?.expectedCitiesRegions?.[0]?.provinceName || '').trim(),
    politicalStatus: politicalStatusForFill(basic.politicalStatus || ''),
    address: (basic.currentAddress || '').trim(),
    jobIntent: (profile.jobIntent?.targetRole || profile.jobIntent?.jobType || '').trim(),
    expectedCity: (profile.jobIntent?.expectedCities || '').trim(),
    expectedSalary: (profile.jobIntent?.expectedSalary || '').trim(),
    availableDate: (profile.jobIntent?.availableDate || '').trim(),
    skills: profile.skills.map((item) => item.name.trim()).filter(Boolean).join(' / '),
    advantages: restoreListLineBreaks(profile.essays?.selfEvaluation?.trim() || ''),
  };

  const rows: ChaoRows = {
    education: profile.education.map((item) => ({
      org: (item.school || '').trim(),
      college: (item.college || '').trim(),
      major: (item.major || '').trim(),
      degree: labelOfCatalog(DEGREE_LEVEL_OPTIONS, (item.degreeLevel || item.degree || '').trim()),
      start: (item.startDate || '').trim(),
      end: endOf(item.endDate, item.isCurrent),
      gpa: (item.gpa || '').trim(),
      courses: restoreListLineBreaks((item.courses || '').trim()),
      city: (item.city || '').trim(),
      schoolType: (item.educationType || '').trim(),
      desc: restoreListLineBreaks((item.description || '').trim()),
    })),
    internship: profile.experience.map((item) => ({
      org: (item.company || '').trim(),
      role: (item.title || '').trim(),
      start: (item.startDate || '').trim(),
      end: endOf(item.endDate, item.isCurrent),
      department: (item.department || '').trim(),
      city: (item.city || '').trim(),
      desc: restoreListLineBreaks(
        (item.responsibilities || item.workContent || item.description || '').trim(),
      ),
    })),
    work: [],
    project: profile.projects.map((item) => ({
      title: (item.name || '').trim(),
      role: (item.role || item.duty || '').trim(),
      start: (item.startDate || '').trim(),
      end: endOf(item.endDate, item.isCurrent),
      link: (item.link || '').trim(),
      techStack: (item.techStack || '').trim(),
      desc: restoreListLineBreaks(
        [item.description, item.content, item.value].filter(Boolean).join('\n').trim(),
      ),
    })),
    campus: profile.campusActivities.map((item) => ({
      title: (item.organization || '').trim(),
      role: (item.role || '').trim(),
      start: (item.startDate || '').trim(),
      end: (item.endDate || '').trim(),
      desc: restoreListLineBreaks((item.description || '').trim()),
    })),
    certificates: profile.certificates
      .filter((item) => (item.name || '').trim())
      .map((item) => ({
        name: (item.name || '').trim(),
        date: (item.date || '').trim(),
        issuer: (item.issuer || '').trim(),
        number: (item.number || '').trim(),
        desc: restoreListLineBreaks((item.description || '').trim()),
      })),
    awards: profile.awards
      .filter((item) => (item.name || '').trim())
      .map((item) => ({
        name: (item.name || '').trim(),
        date: (item.date || '').trim(),
        level: (item.level || '').trim(),
        issuer: (item.issuer || '').trim(),
        desc: restoreListLineBreaks((item.description || '').trim()),
      })),
    languages: profile.languages
      .filter((item) => (item.language || '').trim())
      .map((item) => ({
        language: (item.language || '').trim(),
        level: (item.proficiency || '').trim(),
        score: (item.score || '').trim(),
      })),
    publications: profile.publications
      .filter((item) => (item.title || '').trim())
      .map((item) => ({
        name: (item.title || '').trim(),
        date: (item.date || '').trim(),
        desc: restoreListLineBreaks((item.venueOrNumber || '').trim()),
      })),
  };

  // 培训这类没有独立分区的条目走「自定义扩展字段」：按标题语义匹配页面上的散文本域
  const customFields = profile.trainings
    .filter((item) => (item.course || item.organization || '').trim())
    .map((item) => ({
      title: '培训经历',
      content: [item.organization, item.course, item.startDate, item.endDate, item.certificate]
        .filter(Boolean)
        .join(' '),
    }));

  return { profile: profileFields, rows, customFields };
}
