import type { FieldDescriptor } from '../types/fill';
import type {
  EducationItem,
  ExperienceItem,
  ProfileData,
  ProjectItem,
} from '../types/profile';
import {
  DEGREE_LEVEL_OPTIONS,
  STUDY_MODE_OPTIONS,
  labelOfCatalog,
} from '../catalogs/enums';

/** description 等长文本在注入模型前的最大字符数 */
const MAX_DESCRIPTION_LENGTH = 500;

function truncateText(rawText: string, maxLength: number): string {
  if (rawText.length <= maxLength) {
    return rawText;
  }
  return `${rawText.slice(0, maxLength)}…`;
}

/**
 * 教育条目展示给模型时，拼出「全日制 · 本科」便于匹配站点文案；含第二学位。
 */
function formatEducationForModel(item: EducationItem): Record<string, unknown> {
  const degreeLabel = labelOfCatalog(
    DEGREE_LEVEL_OPTIONS,
    item.degreeLevel || item.degree || '',
  );
  const modeLabel = labelOfCatalog(STUDY_MODE_OPTIONS, item.studyMode || '');
  const composedDegree = [modeLabel, degreeLabel].filter(Boolean).join(' · ');

  const secondDegree = item.secondDegree
    ? {
        ...item.secondDegree,
        degreeLabel: labelOfCatalog(
          DEGREE_LEVEL_OPTIONS,
          item.secondDegree.degreeLevel || '',
        ),
        description: item.secondDegree.description
          ? truncateText(item.secondDegree.description, MAX_DESCRIPTION_LENGTH)
          : undefined,
      }
    : undefined;

  return {
    ...item,
    degreeLabel,
    studyModeLabel: modeLabel,
    composedDegree,
    secondDegree,
    description:
      item.description !== undefined
        ? truncateText(item.description, MAX_DESCRIPTION_LENGTH)
        : undefined,
  };
}

/**
 * 精简 ProfileData 供 LLM：截断长文本，拆分职责/内容/业绩与项目内容/价值。
 */
function compactProfileData(profileData: ProfileData): Record<string, unknown> {
  const compactEducation = profileData.education.map(formatEducationForModel);

  const compactExperience = profileData.experience.map(
    (item: ExperienceItem) => ({
      ...item,
      description: truncateText(item.description || '', MAX_DESCRIPTION_LENGTH),
      responsibilities: item.responsibilities
        ? truncateText(item.responsibilities, MAX_DESCRIPTION_LENGTH)
        : undefined,
      workContent: item.workContent
        ? truncateText(item.workContent, MAX_DESCRIPTION_LENGTH)
        : undefined,
      achievements: item.achievements
        ? truncateText(item.achievements, MAX_DESCRIPTION_LENGTH)
        : undefined,
    }),
  );

  const compactProjects = profileData.projects.map((item: ProjectItem) => ({
    ...item,
    description: truncateText(item.description || '', MAX_DESCRIPTION_LENGTH),
    content: item.content
      ? truncateText(item.content, MAX_DESCRIPTION_LENGTH)
      : undefined,
    value: item.value
      ? truncateText(item.value, MAX_DESCRIPTION_LENGTH)
      : undefined,
  }));

  return {
    ...profileData,
    education: compactEducation,
    experience: compactExperience,
    projects: compactProjects,
    skills: profileData.skills,
    emergencyContacts: profileData.emergencyContacts,
    industryExtras: profileData.industryExtras,
    notes: truncateText(profileData.notes, MAX_DESCRIPTION_LENGTH),
    essays: profileData.essays
      ? {
          selfEvaluation: profileData.essays.selfEvaluation
            ? truncateText(
                profileData.essays.selfEvaluation,
                MAX_DESCRIPTION_LENGTH,
              )
            : undefined,
          careerPlan: profileData.essays.careerPlan
            ? truncateText(profileData.essays.careerPlan, MAX_DESCRIPTION_LENGTH)
            : undefined,
          strengthsWeaknesses: profileData.essays.strengthsWeaknesses
            ? truncateText(
                profileData.essays.strengthsWeaknesses,
                MAX_DESCRIPTION_LENGTH,
              )
            : undefined,
          whyJoin: profileData.essays.whyJoin
            ? truncateText(profileData.essays.whyJoin, MAX_DESCRIPTION_LENGTH)
            : undefined,
          projectDeepDive: profileData.essays.projectDeepDive
            ? truncateText(
                profileData.essays.projectDeepDive,
                MAX_DESCRIPTION_LENGTH,
              )
            : undefined,
          other: profileData.essays.other
            ? truncateText(profileData.essays.other, MAX_DESCRIPTION_LENGTH)
            : undefined,
        }
      : {},
  };
}

/**
 * 构造填写提示词：要求严格 JSON；日期档案为到日，站点只要月时可截断为 YYYY-MM。
 */
export function buildFillPrompt(
  profileData: ProfileData,
  fields: FieldDescriptor[],
): { system: string; user: string } {
  const system =
    '你是简历表单填写助手；只输出 JSON 对象，键为 items 与 skippedFieldIds；' +
    'items 每项含 fieldId,value,confidence,reason；不要编造档案中没有的事实；' +
    '不确定则放入 skippedFieldIds。' +
    '档案日期精确到日（YYYY-MM-DD）；若页面只要年月，可截断为 YYYY-MM。' +
    '学历请优先使用 composedDegree 或 degreeLabel 等中文标签去匹配下拉选项文案。' +
    '实习/工作请区分 responsibilities（职责）、workContent（内容）、achievements（业绩）。' +
    '项目请优先使用 content（内容）与 value（价值/成果）。' +
    '双学位时使用 secondDegree 字段；技能为 skills 数组（含 name/level）；' +
    '紧急联系人为 emergencyContacts 数组；行业专项见 industryExtras。';

  const user = JSON.stringify({
    profile: compactProfileData(profileData),
    fields,
  });

  return { system, user };
}
