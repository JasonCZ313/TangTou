import {
  AWARD_PRIZE_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  ETHNICITY_OPTIONS,
  GENDER_OPTIONS,
  POLITICAL_STATUS_OPTIONS,
  labelOfCatalog,
} from '../catalogs/enums';
import { restoreListLineBreaks } from '../resume/restoreListBreaks';
import type { FieldDescriptor, FillPlan } from '../types/fill';
import type {
  AwardItem,
  CampusActivityItem,
  EducationItem,
  ExperienceItem,
  ProfileData,
  ProjectItem,
} from '../types/profile';

/** 绑定时的结论：写入、明确跳过，或交给后面的规则 */
export type SectionBindResult =
  | { kind: 'value'; value: string; reason: string }
  | { kind: 'skip'; reason: string }
  | null;

/**
 * 从「北京市 / 直辖市 / 通州区」里只取出城市名。
 * 意向城市这一类单框不接受整段区划。
 */
export function cityNameOnly(regionText: string): string {
  const parts = regionText
    .split(/[/／|、,，\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '直辖市');
  const cityPart = parts.find((part) => /市$/.test(part));
  return cityPart ?? parts[0] ?? '';
}

/** 档案里的一条，绑到页面上的同一行 */
interface BoundRow {
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  name: string;
  school: string;
  college: string;
  company: string;
  title: string;
  role: string;
  duty: string;
  description: string;
  degree: string;
  educationType: string;
  major: string;
  rank: string;
  city: string;
  prize: string;
}

/**
 * 标签属于哪一块。校内、获奖要先于「项目」，避免项目名称抢校内经历。
 */
/**
 * 判断标签是否属于自我评价长文（与个人能力技能列表分开）。
 * 同时含「个人能力/专业技能/技能特长」时不算 essay，避免抢技能框。
 */
function isEssayLabel(label: string): boolean {
  if (/个人能力|专业技能|技能特长/.test(label)) {
    return false;
  }
  return /自我评价|自我描述|个人优势|我的价值|个人介绍|个人简介|个人评价|自我介绍/.test(label);
}

function sectionKind(label: string): string {
  const head = label.split('第')[0] ?? label;
  // 自我评价/自我描述不再归入 skill，避免把技能名写进长文框
  if (/个人能力|专业技能|技能特长/.test(head)) {
    return 'skill';
  }
  if (/论文|专利|著作/.test(head)) {
    return 'publication';
  }
  if (/校内任职|校内经历|校内|校园|社团/.test(head)) {
    return 'campus';
  }
  if (/获奖|荣誉/.test(head)) {
    return 'award';
  }
  if (/教育/.test(head)) {
    return 'education';
  }
  if (/实习|工作/.test(head)) {
    return 'experience';
  }
  if (/项目经历|项目经验|项目/.test(head)) {
    return 'project';
  }
  if (/证书/.test(head)) {
    return 'certificate';
  }
  if (/培训/.test(head)) {
    return 'training';
  }
  return '';
}

/** 标签上的行号。没有行号时不猜，避免把第 1 条写进后面的行。 */
function rowIndex(label: string): number | null {
  const matched = label.match(/第(\d+)行/);
  if (!matched?.[1]) {
    return null;
  }
  const index = Number(matched[1]) - 1;
  return index >= 0 ? index : null;
}

/** 从 YYYY-MM 或 YYYY-MM-DD 取出年、月。月份不补零。 */
function dateParts(rawDate: string): { year: string; month: string } | null {
  const matched = rawDate.trim().match(/((?:19|20)\d{2})\D+(1[0-2]|0?[1-9])/);
  if (!matched?.[1] || !matched[2]) {
    return null;
  }
  return { year: matched[1], month: String(Number(matched[2])) };
}

function emptyRow(): BoundRow {
  return {
    startDate: '',
    endDate: '',
    isCurrent: false,
    name: '',
    school: '',
    college: '',
    company: '',
    title: '',
    role: '',
    duty: '',
    description: '',
    degree: '',
    educationType: '',
    major: '',
    rank: '',
    city: '',
    prize: '',
  };
}

function rowFromEducation(item: EducationItem): BoundRow {
  const row = emptyRow();
  row.startDate = item.startDate ?? '';
  row.endDate = item.endDate ?? '';
  row.isCurrent = Boolean(item.isCurrent);
  row.school = item.school ?? '';
  row.college = item.college ?? '';
  row.major = item.major ?? '';
  row.degree = labelOfCatalog(DEGREE_LEVEL_OPTIONS, item.degreeLevel || item.degree || '');
  row.educationType = (item.educationType ?? '').trim();
  row.rank = item.rank ?? '';
  row.city = cityNameOnly(item.city ?? '');
  row.description = item.description ?? '';
  row.name = item.school ?? '';
  return row;
}

function rowFromExperience(item: ExperienceItem): BoundRow {
  const row = emptyRow();
  row.startDate = item.startDate ?? '';
  row.endDate = item.endDate ?? '';
  row.isCurrent = Boolean(item.isCurrent);
  row.company = item.company ?? '';
  row.title = item.title ?? '';
  row.duty = item.responsibilities ?? '';
  row.description = item.workContent || item.description || '';
  row.city = cityNameOnly(item.city ?? '');
  row.name = item.company ?? '';
  return row;
}

function rowFromProject(item: ProjectItem): BoundRow {
  const row = emptyRow();
  row.startDate = item.startDate ?? '';
  row.endDate = item.endDate ?? '';
  row.isCurrent = Boolean(item.isCurrent);
  row.name = item.name ?? '';
  row.role = item.role ?? '';
  row.duty = item.duty ?? '';
  row.description = item.content || item.description || '';
  return row;
}

function rowFromCampus(item: CampusActivityItem): BoundRow {
  const row = emptyRow();
  row.startDate = item.startDate ?? '';
  row.endDate = item.endDate ?? '';
  row.name = item.organization ?? '';
  row.role = item.role ?? '';
  row.description = item.description ?? '';
  return row;
}

function rowFromAward(item: AwardItem): BoundRow {
  const row = emptyRow();
  row.startDate = item.date ?? '';
  row.name = item.name ?? '';
  row.prize = labelOfCatalog(AWARD_PRIZE_OPTIONS, item.prizeRank ?? '');
  row.description = item.level ?? '';
  return row;
}

/** 证书按行：名称、发证时间，不把多本证书拼进同一格。 */
function rowFromCertificate(item: { name?: string; date?: string; description?: string; issuer?: string }): BoundRow {
  const row = emptyRow();
  row.startDate = item.date ?? '';
  row.name = item.name ?? '';
  row.company = item.issuer ?? '';
  row.description = item.description ?? '';
  return row;
}

/** 培训按行：机构、课程、起止时间。 */
function rowFromTraining(item: { organization?: string; course?: string; startDate?: string; endDate?: string }): BoundRow {
  const row = emptyRow();
  row.startDate = item.startDate ?? '';
  row.endDate = item.endDate ?? '';
  row.name = item.course || item.organization || '';
  row.company = item.organization ?? '';
  return row;
}

/**
 * 学历在不同网申里的叫法。用来在下拉里点到「本科」而不是硬填「大学本科」。
 */
function degreeMatchCandidates(rawValue: string): string[] {
  const text = rawValue.trim();
  if (/本科|学士/.test(text)) {
    return ['大学本科', '本科', '学士', text];
  }
  if (/硕士/.test(text)) {
    return ['硕士研究生', '硕士', '研究生', text];
  }
  if (/博士后/.test(text)) {
    return ['博士后', text];
  }
  if (/博士/.test(text)) {
    return ['博士研究生', '博士', text];
  }
  if (/大专|高职/.test(text)) {
    return ['大专（高职）', '大专', '高职', text];
  }
  if (/高中/.test(text)) {
    return ['高中', '普通高中', text];
  }
  return [text];
}

/**
 * 按卡片和行号取出档案里的那一条。对不上就返回 null，不拿别的卡片来凑。
 */
function boundRow(profile: ProfileData, label: string): BoundRow | null | 'missing' {
  const kind = sectionKind(label);
  const index = rowIndex(label);
  if (!kind || index === null) {
    return null;
  }
  if (kind === 'education') {
    const item = profile.education[index];
    return item ? rowFromEducation(item) : 'missing';
  }
  if (kind === 'experience') {
    const item = profile.experience[index];
    return item ? rowFromExperience(item) : 'missing';
  }
  if (kind === 'project') {
    const item = profile.projects[index];
    return item ? rowFromProject(item) : 'missing';
  }
  if (kind === 'campus') {
    const item = profile.campusActivities[index];
    return item ? rowFromCampus(item) : 'missing';
  }
  if (kind === 'award') {
    const item = profile.awards[index];
    return item ? rowFromAward(item) : 'missing';
  }
  if (kind === 'certificate') {
    const item = profile.certificates[index];
    return item ? rowFromCertificate(item) : 'missing';
  }
  if (kind === 'training') {
    const item = profile.trainings[index];
    return item ? rowFromTraining(item) : 'missing';
  }
  return null;
}

/**
 * 下拉只接受列表里有的原文。月份用 8 而不是 08；对不上就跳过，不把字打进去。
 */
function valueAllowedByOptions(rawValue: string, options: string[] | undefined): string | null {
  if (!options || options.length === 0) {
    return rawValue;
  }
  const usable = options.filter((optionText) => optionText.trim() && optionText.trim() !== '暂无选项');
  if (usable.length === 0) {
    return rawValue;
  }
  const monthOptions = usable.filter((optionText) => /^(0?[1-9]|1[0-2])月?$/.test(optionText.trim()));
  if (monthOptions.length >= 6) {
    const monthNumber = String(Number(rawValue.replace(/\D/g, '')));
    return (
      monthOptions.find((optionText) => String(Number(optionText.replace(/\D/g, ''))) === monthNumber) ??
      null
    );
  }
  const exact = usable.find((optionText) => optionText.trim() === rawValue.trim());
  if (exact) {
    return exact.trim();
  }
  if (/市$/.test(rawValue.trim()) || /北京|上海|天津|重庆/.test(rawValue)) {
    const shortName = rawValue.trim().replace(/市$/, '');
    const cityHit = usable.find((optionText) => {
      const optionLabel = optionText.trim();
      return optionLabel === rawValue.trim() || optionLabel === shortName || optionLabel === `${shortName}市`;
    });
    if (cityHit) {
      return cityHit.trim();
    }
  }
  if (/团员/.test(rawValue) && !/党员/.test(rawValue)) {
    const leagueHit = usable.find((optionText) => /共青团|青年团团员/.test(optionText));
    if (leagueHit) {
      return leagueHit.trim();
    }
  }
  for (const candidate of degreeMatchCandidates(rawValue)) {
    const degreeHit = usable.find((optionText) => optionText.trim() === candidate);
    if (degreeHit) {
      return degreeHit.trim();
    }
  }
  const contained = usable.filter((optionText) => {
    const optionLabel = optionText.trim();
    return optionLabel.includes(rawValue.trim()) || rawValue.trim().includes(optionLabel);
  });
  if (contained.length === 1) {
    return contained[0]?.trim() ?? null;
  }
  return null;
}

/**
 * 把一个已经标好「卡片第几行」的字段绑到对应档案条目。
 * 排名框没有对应选项时跳过，避免把「大学本科」打进成绩排名。
 */
export function bindLabeledField(
  field: FieldDescriptor,
  profile: ProfileData,
): SectionBindResult {
  const label = field.label ?? '';
  if (/意向|期望城市|工作城市/.test(label) && /城市/.test(label) && !/区|县|街道/.test(label)) {
    const cityText = cityNameOnly(
      profile.jobIntent.expectedCities || profile.jobIntent.workCity || profile.basic.currentCity || '',
    );
    const allowed = valueAllowedByOptions(cityText, field.options);
    if (!cityText || !allowed) {
      return { kind: 'skip', reason: '城市选项里没有单独的城市名' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：意向城市只写城市名' };
  }
  if (/省/.test(label) && /户籍|居住|所在|现居/.test(label)) {
    const regionSource = /户籍/.test(label)
      ? profile.basic.hukouLocation || profile.basic.currentCity || ''
      : profile.basic.currentCity || profile.basic.hukouLocation || '';
    const provinceText = cityNameOnly(regionSource);
    const allowed = valueAllowedByOptions(provinceText, field.options);
    if (!provinceText || !allowed) {
      return { kind: 'skip', reason: '省的选项里没有对应的直辖市或省份' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：省用城市名去对直辖市' };
  }
  if (/最高学历/.test(label) && !/学校|专业|排名|时间|成绩/.test(label)) {
    const highest = profile.education[0];
    const degreeText = highest
      ? labelOfCatalog(DEGREE_LEVEL_OPTIONS, highest.degreeLevel || highest.degree || '')
      : '';
    if (!degreeText) {
      return null;
    }
    const allowed = valueAllowedByOptions(degreeText, field.options);
    if (!allowed) {
      return { kind: 'skip', reason: '最高学历的选项里没有当前学历' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：最高学历用当前学历' };
  }
  if (/姓/.test(label) && !/姓名/.test(label)) {
    const surname = profile.basic.fullName.trim().slice(0, 1);
    if (!surname) {
      return null;
    }
    return { kind: 'value', value: surname, reason: '按行绑定：姓' };
  }
  if (/名/.test(label) && !/姓名|名称|排名/.test(label)) {
    const givenName = profile.basic.fullName.trim().slice(1);
    if (!givenName) {
      return null;
    }
    return { kind: 'value', value: givenName, reason: '按行绑定：名' };
  }
  if (/证件类型/.test(label) || (field.options?.some((optionText) => /身份证|护照/.test(optionText)) && !/号码|手机/.test(label))) {
    const idType = (profile.basic.idType ?? '').trim() || ((profile.basic.idNumber ?? '').trim() ? '身份证' : '');
    const allowed = valueAllowedByOptions(idType, field.options);
    if (!idType || !allowed) {
      return { kind: 'skip', reason: '证件类型要在下拉里点选' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：证件类型' };
  }
  if (/证件号码|证件号|身份证号/.test(label) && !/类型/.test(label)) {
    const idNumber = (profile.basic.idNumber ?? '').trim();
    if (!idNumber) {
      return null;
    }
    if (field.options?.some((optionText) => /身份证|护照/.test(optionText))) {
      return { kind: 'skip', reason: '这是证件类型下拉，号码不能打进去' };
    }
    return { kind: 'value', value: idNumber, reason: '按行绑定：证件号码' };
  }
  if (/手机号码|手机号/.test(label) && !/区号/.test(label)) {
    const phoneNumber = profile.basic.phone.trim();
    if (!phoneNumber) {
      return null;
    }
    const optionList = field.options ?? [];
    const usableOptions = optionList.filter((optionText) => optionText.trim() && optionText.trim() !== '暂无选项');
    if (usableOptions.length > 0 && !usableOptions.some((optionText) => optionText.replace(/\D/g, '') === phoneNumber.replace(/\D/g, ''))) {
      return { kind: 'skip', reason: '手机号旁边的下拉不能写入整串号码' };
    }
    return { kind: 'value', value: phoneNumber, reason: '按行绑定：手机号码' };
  }
  // 出生日期：日期组件通常没有 options，有档案就直接交写入层（不再因无选项 skip）
  if (/(出生日期|出生年月|生日)/.test(label) && !/出生地/.test(label)) {
    const birthdayText = (profile.basic.birthday ?? '').trim();
    if (!birthdayText) {
      return null;
    }
    const optionList = field.options ?? [];
    if (optionList.length > 0) {
      const allowed = valueAllowedByOptions(birthdayText, optionList);
      if (allowed) {
        return { kind: 'value', value: allowed, reason: '按行绑定：出生日期' };
      }
    }
    return { kind: 'value', value: birthdayText, reason: '按行绑定：出生日期（交日期组件）' };
  }
  // 性别：有下拉选项则校验；无选项（纯 radio）直接交单选态机
  if (/性别/.test(label) && !/别名/.test(label)) {
    const genderText = labelOfCatalog(GENDER_OPTIONS, (profile.basic.gender ?? '').trim());
    if (!genderText) {
      return null;
    }
    const optionList = field.options ?? [];
    if (optionList.length > 0) {
      const allowed = valueAllowedByOptions(genderText, optionList);
      if (!allowed) {
        return { kind: 'skip', reason: '性别选项里没有档案中的取值' };
      }
      return { kind: 'value', value: allowed, reason: '按行绑定：性别' };
    }
    return { kind: 'value', value: genderText, reason: '按行绑定：性别（单选）' };
  }
  // 民族：避开「民族大学/民族学院」校名
  if (/民族/.test(label) && !/民族大学|民族学院/.test(label)) {
    const ethnicityText = labelOfCatalog(ETHNICITY_OPTIONS, (profile.basic.ethnicity ?? '').trim());
    if (!ethnicityText) {
      return null;
    }
    const allowed = valueAllowedByOptions(ethnicityText, field.options);
    if (!allowed) {
      return { kind: 'skip', reason: '民族选项里没有档案中的取值' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：民族' };
  }
  // 政治面貌
  if (/政治面貌/.test(label)) {
    const politicalText = labelOfCatalog(
      POLITICAL_STATUS_OPTIONS,
      (profile.basic.politicalStatus ?? '').trim(),
    );
    if (!politicalText) {
      return null;
    }
    const allowed = valueAllowedByOptions(politicalText, field.options);
    if (!allowed) {
      return { kind: 'skip', reason: '政治面貌选项里没有档案中的取值' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：政治面貌' };
  }
  // 多本证书没有行号时不拼进同一格，避免三证只写进一个框
  if (
    sectionKind(label) === 'certificate' &&
    rowIndex(label) === null &&
    !/附件|上传/.test(label) &&
    profile.certificates.filter((item) => (item.name ?? '').trim()).length > 1
  ) {
    return { kind: 'skip', reason: '多本证书按行填写，不合并进一格' };
  }
  // 多段实习/工作/项目/教育/获奖没有行号时同样禁止兜底到第 1 条（否则每块都写成一样）
  if (rowIndex(label) === null && !/附件|上传/.test(label)) {
    const kind = sectionKind(label);
    const multiPools: Record<string, number> = {
      experience: profile.experience.filter((item) => (item.company || item.title || '').trim()).length,
      project: profile.projects.filter((item) => (item.name || '').trim()).length,
      education: profile.education.filter((item) => (item.school || '').trim()).length,
      award: profile.awards.filter((item) => (item.name || '').trim()).length,
      campus: profile.campusActivities.filter((item) => (item.organization || '').trim()).length,
    };
    if (kind && (multiPools[kind] ?? 0) > 1) {
      return {
        kind: 'skip',
        reason: `「${kind}」有 ${multiPools[kind]} 条档案但本格没有行号，宁缺勿串，不填第1条`,
      };
    }
  }
  if (isEssayLabel(label)) {
    const evaluationText = restoreListLineBreaks(profile.essays?.selfEvaluation?.trim() ?? '');
    if (!evaluationText) {
      return { kind: 'skip', reason: '档案里没有自我评价文案' };
    }
    return { kind: 'value', value: evaluationText, reason: '按行绑定：自我评价' };
  }
  if (sectionKind(label) === 'skill') {
    const skillNames = profile.skills
      .map((item) => item.name.trim())
      .filter((name) => name.length > 0);
    const skillRow = rowIndex(label);
    if (skillRow !== null && /名称|技能名/.test(label) && !/描述/.test(label)) {
      const skillName = skillNames[skillRow];
      if (!skillName) {
        return { kind: 'skip', reason: '这一行没有对应的技能' };
      }
      return { kind: 'value', value: skillName, reason: '按行绑定：一项技能' };
    }
    const skillText = skillNames.join('\n');
    if (!skillText || !/描述|能力|技能|特长|评价/.test(label) || /项目|学校|获奖|论文|实习/.test(label)) {
      return { kind: 'skip', reason: '个人能力不写项目或经历' };
    }
    return { kind: 'value', value: skillText, reason: '按行绑定：个人能力' };
  }
  if (sectionKind(label) === 'publication') {
    if (profile.publications.length === 0) {
      return { kind: 'skip', reason: '档案里没有论文' };
    }
    const publication = profile.publications[rowIndex(label) ?? 0];
    if (!publication) {
      return { kind: 'skip', reason: '这一行没有对应的论文' };
    }
    if (/名称|题目|标题/.test(label)) {
      return { kind: 'value', value: publication.title, reason: '按行绑定：论文' };
    }
    return { kind: 'skip', reason: '论文这一格不对应该写的内容' };
  }

  // 成绩排名独立处理：无行号时只用最高学历（education[0]），空则 skip，不进 LLM
  if (/排名|名次|成绩排名/.test(label)) {
    const rankRow = boundRow(profile, label);
    if (rankRow === 'missing') {
      return { kind: 'skip', reason: '这一行没有对应的档案条目' };
    }
    const rankText = rankRow
      ? rankRow.rank
      : (profile.education[0]?.rank ?? '').trim();
    if (!rankText) {
      return { kind: 'skip', reason: '成绩排名不能拿学历来填' };
    }
    const allowed = valueAllowedByOptions(rankText, field.options);
    if (!allowed) {
      return { kind: 'skip', reason: '成绩排名的选项里没有档案中的名次' };
    }
    return { kind: 'value', value: allowed, reason: '按行绑定：成绩排名' };
  }

  const row = boundRow(profile, label);
  if (row === 'missing') {
    return { kind: 'skip', reason: '这一行没有对应的档案条目' };
  }
  if (!row) {
    return null;
  }
  if (/至今/.test(label)) {
    const checked = row.isCurrent || !row.endDate.trim();
    return { kind: 'value', value: checked ? 'true' : 'false', reason: '按行绑定：至今' };
  }
  if (/结束年|结束月/.test(label) && (row.isCurrent || !row.endDate.trim())) {
    return { kind: 'skip', reason: '这一条到至今，不写结束时间' };
  }

  const start = dateParts(row.startDate);
  const end = dateParts(row.endDate);
  let rawValue = '';
  if (/开始年/.test(label)) {
    rawValue = start?.year ?? '';
  } else if (/开始月/.test(label)) {
    rawValue = start?.month ?? '';
  } else if (/结束年/.test(label)) {
    rawValue = end?.year ?? '';
  } else if (/结束月/.test(label)) {
    rawValue = end?.month ?? '';
  } else if (/(开始时间|起始时间|开始日期|入学时间|入职时间)/.test(label)) {
    rawValue = row.startDate;
  } else if (/(结束时间|结束日期|截止时间|离职时间|毕业时间|获得时间)/.test(label)) {
    rawValue = row.endDate || row.startDate;
  } else if ((/城市|所在地/.test(label)) && !/区|县|街道/.test(label)) {
    rawValue = row.city;
  } else if (/学院/.test(label) && !/学校|院校/.test(label)) {
    rawValue = row.college;
  } else if (/学校|院校/.test(label) && !/所在地/.test(label)) {
    rawValue = row.school;
  } else if (/专业/.test(label) && !/排名/.test(label)) {
    rawValue = row.major;
  } else if (/学历类型|办学类型|学习形式/.test(label)) {
    rawValue = row.educationType;
  } else if (/学历|学位/.test(label)) {
    rawValue = row.degree;
  } else if (/公司|单位/.test(label)) {
    rawValue = row.company;
  } else if (/职位|岗位/.test(label)) {
    rawValue = row.title;
  } else if (/角色|担任|职务/.test(label)) {
    rawValue = row.role;
  } else if (/职责/.test(label)) {
    rawValue = row.duty;
  } else if (/奖次|等第/.test(label)) {
    rawValue = row.prize;
  } else if (/名称|姓名/.test(label) && !/证件/.test(label)) {
    rawValue = row.name;
  } else if (/描述|内容|职责|实习内容|实践描述|获奖描述|证书描述/.test(label)) {
    rawValue = row.description;
  }
  if (!rawValue.trim()) {
    if (sectionKind(label)) {
      // 标签若是「请输入」等垃圾角色，不当「档案空」——交回上层用计划值兜底
      const roleOnly = label.replace(/^.*?第\d+行/, '');
      if (/^(请输入|请选择|请填写|字段|内容)$/.test(roleOnly)) {
        return null;
      }
      return { kind: 'skip', reason: '这一格档案里是空的，不借用别的内容' };
    }
    return null;
  }
  // 整段日期：日历组件通常无精确选项，选项对不上也把值交给写入层多策略处理
  if (
    /(开始时间|起始时间|开始日期|结束时间|结束日期|截止时间|入学时间|入职时间|离职时间|毕业时间|获得时间)/.test(label)
    && /^\d{4}/.test(rawValue)
  ) {
    const dateAllowed = valueAllowedByOptions(rawValue, field.options);
    if (dateAllowed) {
      return { kind: 'value', value: dateAllowed, reason: '按行绑定：同一块的同一行（日期）' };
    }
    return { kind: 'value', value: rawValue, reason: '按行绑定：同一块的同一行（日期交组件）' };
  }
  const allowed = valueAllowedByOptions(rawValue, field.options);
  if (!allowed) {
    return { kind: 'skip', reason: '下拉选项里没有要写的那一项' };
  }
  return { kind: 'value', value: allowed, reason: '按行绑定：同一块的同一行' };
}

/**
 * 先把能按卡片行号对上的字段做成填写项，其余留给原来的规则和模型。
 */
export function bindSectionFields(
  profile: ProfileData,
  fields: FieldDescriptor[],
): { items: FillPlan['items']; skippedFieldIds: string[]; remainingFields: FieldDescriptor[] } {
  const items: FillPlan['items'] = [];
  const skippedFieldIds: string[] = [];
  const remainingFields: FieldDescriptor[] = [];
  for (const field of fields) {
    const bound = bindLabeledField(field, profile);
    if (!bound) {
      remainingFields.push(field);
      continue;
    }
    if (bound.kind === 'skip') {
      skippedFieldIds.push(field.fieldId);
      continue;
    }
    items.push({
      fieldId: field.fieldId,
      value: bound.value,
      confidence: 0.98,
      reason: bound.reason,
    });
  }
  return { items, skippedFieldIds, remainingFields };
}

/**
 * 计划自检：同分区多行锚点字段值相同，但档案对应条主键不同 → 视为串行，剔除多余项。
 * 返回清洗后的 items 与被剔除原因（写入 miss / 预览提示用）。
 */
export function auditFillPlanRowCollisions(
  profile: ProfileData,
  fields: FieldDescriptor[],
  items: FillPlan['items'],
): { items: FillPlan['items']; rejected: Array<{ fieldId: string; reason: string }> } {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));
  const rejected: Array<{ fieldId: string; reason: string }> = [];
  /** 分区 → 行号 → 主键字段 id 与值 */
  const anchorBySectionRow = new Map<string, Map<number, { fieldId: string; value: string }>>();

  const isAnchorLabel = (label: string) =>
    /单位名称|公司名称|企业名称|项目名称|学校名称|证书名称|奖项名称|组织名称|名称/.test(label)
    && !/职位|岗位|角色|描述|内容/.test(label);

  for (const item of items) {
    const field = fieldById.get(item.fieldId);
    if (!field) continue;
    const label = field.label || '';
    const kind = sectionKind(label);
    const index = rowIndex(label);
    if (!kind || index === null || !isAnchorLabel(label)) continue;
    const key = kind;
    const rowMap = anchorBySectionRow.get(key) ?? new Map();
    rowMap.set(index, { fieldId: item.fieldId, value: item.value.trim() });
    anchorBySectionRow.set(key, rowMap);
  }

  const rejectIds = new Set<string>();
  for (const [kind, rowMap] of anchorBySectionRow) {
    const entries = [...rowMap.entries()].sort((left, right) => left[0] - right[0]);
    if (entries.length < 2) continue;
    const values = entries.map(([, data]) => data.value).filter(Boolean);
    const uniqueValues = new Set(values);
    if (uniqueValues.size !== 1) continue;

    // 页面上多行同文：对照档案主键是否本就相同
    const profileKeys: string[] = [];
    if (kind === 'experience') {
      profile.experience.forEach((item) => {
        const keyText = (item.company || item.title || '').trim();
        if (keyText) profileKeys.push(keyText);
      });
    } else if (kind === 'certificate') {
      profile.certificates.forEach((item) => {
        const keyText = (item.name || '').trim();
        if (keyText) profileKeys.push(keyText);
      });
    } else if (kind === 'project') {
      profile.projects.forEach((item) => {
        const keyText = (item.name || '').trim();
        if (keyText) profileKeys.push(keyText);
      });
    } else if (kind === 'education') {
      profile.education.forEach((item) => {
        const keyText = (item.school || '').trim();
        if (keyText) profileKeys.push(keyText);
      });
    }
    if (new Set(profileKeys).size < 2) continue;

    // 保留第 1 行，剔除后续同文行的全部同分区字段（按行号）
    for (const [rowNumber] of entries) {
      if (rowNumber === 0) continue;
      for (const item of items) {
        const field = fieldById.get(item.fieldId);
        if (!field) continue;
        if (sectionKind(field.label || '') !== kind) continue;
        if (rowIndex(field.label || '') !== rowNumber) continue;
        if (rejectIds.has(item.fieldId)) continue;
        rejectIds.add(item.fieldId);
        rejected.push({
          fieldId: item.fieldId,
          reason: `「${kind}」第${rowNumber + 1}行与第1行计划值相同但档案不同，已剔除防串写`,
        });
      }
    }
  }

  return {
    items: items.filter((item) => !rejectIds.has(item.fieldId)),
    rejected,
  };
}
