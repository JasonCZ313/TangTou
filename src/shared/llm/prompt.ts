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
 * 教育条目展示给模型时，拼出「全日制 · 本科」便于匹配站点文案。
 */
function formatEducationForModel(item: EducationItem): Record<string, unknown> {
  const degreeLabel = labelOfCatalog(
    DEGREE_LEVEL_OPTIONS,
    item.degreeLevel || item.degree || '',
  );
  const modeLabel = labelOfCatalog(STUDY_MODE_OPTIONS, item.studyMode || '');
  const composedDegree = [modeLabel, degreeLabel].filter(Boolean).join(' · ');
  return {
    ...item,
    degreeLabel,
    studyModeLabel: modeLabel,
    composedDegree,
    description:
      item.description !== undefined
        ? truncateText(item.description, MAX_DESCRIPTION_LENGTH)
        : undefined,
  };
}

/**
 * 精简 ProfileData 供 LLM：截断长文本，并为学历补充中文拼装字段。
 */
function compactProfileData(profileData: ProfileData): Record<string, unknown> {
  const compactEducation = profileData.education.map(formatEducationForModel);

  const compactExperience: ExperienceItem[] = profileData.experience.map(
    (item) => ({
      ...item,
      description: truncateText(item.description, MAX_DESCRIPTION_LENGTH),
    }),
  );

  const compactProjects: ProjectItem[] = profileData.projects.map((item) => ({
    ...item,
    description: truncateText(item.description, MAX_DESCRIPTION_LENGTH),
  }));

  return {
    ...profileData,
    education: compactEducation,
    experience: compactExperience,
    projects: compactProjects,
    notes: truncateText(profileData.notes, MAX_DESCRIPTION_LENGTH),
    essays: profileData.essays
      ? {
          selfEvaluation: profileData.essays.selfEvaluation
            ? truncateText(profileData.essays.selfEvaluation, MAX_DESCRIPTION_LENGTH)
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
    '学历请优先使用 composedDegree 或 degreeLabel 等中文标签去匹配下拉选项文案。';

  const user = JSON.stringify({
    profile: compactProfileData(profileData),
    fields,
  });

  return { system, user };
}
