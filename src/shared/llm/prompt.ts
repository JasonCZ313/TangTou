import type { FieldDescriptor } from '../types/fill';
import type {
  EducationItem,
  ExperienceItem,
  ProfileData,
  ProjectItem,
} from '../types/profile';

/** description 等长文本在注入模型前的最大字符数，避免撑爆上下文 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * 将过长字符串截断到上限，超出部分以省略号结尾；未超长则原样返回。
 */
function truncateText(rawText: string, maxLength: number): string {
  if (rawText.length <= maxLength) {
    return rawText;
  }
  return `${rawText.slice(0, maxLength)}…`;
}

/**
 * 深拷贝并截断 ProfileData 中可能过长的 description / notes，
 * 供 LLM user 消息使用，减小 token 占用。
 */
function compactProfileData(profileData: ProfileData): ProfileData {
  const compactEducation: EducationItem[] = profileData.education.map(
    (item) => ({
      ...item,
      description:
        item.description !== undefined
          ? truncateText(item.description, MAX_DESCRIPTION_LENGTH)
          : undefined,
    }),
  );

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
  };
}

/**
 * 根据档案与扫描字段构造 Chat Completions 的 system / user 提示词。
 * system 约束 JSON 输出形状与「不编造事实」；user 为精简后的 profile + fields JSON。
 */
export function buildFillPrompt(
  profileData: ProfileData,
  fields: FieldDescriptor[],
): { system: string; user: string } {
  const system =
    '你是简历表单填写助手；只输出 JSON 对象，键为 items 与 skippedFieldIds；' +
    'items 每项含 fieldId,value,confidence,reason；不要编造档案中没有的事实；' +
    '不确定则放入 skippedFieldIds。';

  const compactProfile = compactProfileData(profileData);
  const user = JSON.stringify({
    profile: compactProfile,
    fields,
  });

  return { system, user };
}
