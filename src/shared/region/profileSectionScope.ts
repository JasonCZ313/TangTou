/**
 * 选区填入 P3：把完整档案收成「一段」再给对照引擎用。
 * 侧栏下拉选段；后台 BUILD_FILL_PLAN 带 profileSectionKey 时只喂这一段数据。
 */

import { buildSectionAdds } from '../fill/sectionAdds';
import {
  isInternshipExperience,
  namedInternshipExperiences,
  namedWorkExperiences,
} from '../fill/sectionAdds';
import { createEmptyProfileData } from '../storage/defaults';
import type { FieldDescriptor, SectionAddRequest } from '../types/fill';
import type { ExperienceItem, Profile, ProfileData } from '../types/profile';

/** 档案段在 UI 与消息里用的稳定键，例如 basic、education:0 */
export type ProfileSectionKey =
  | 'basic'
  | 'jobIntent'
  | 'essays'
  | 'skills'
  | `education:${number}`
  | `experience:${number}`
  | `projects:${number}`
  | `campusActivities:${number}`;

/** 下拉一项：键 + 给人看的标签 */
export interface ProfileSectionOption {
  key: ProfileSectionKey;
  label: string;
}

/**
 * 根据档案内容列出可选段（至少含基本信息）。
 * 有数据的列表段按条展开；空段不强行占位。
 */
export function listProfileSectionOptions(profile: Profile): ProfileSectionOption[] {
  const options: ProfileSectionOption[] = [
    { key: 'basic', label: '基本信息' },
    { key: 'jobIntent', label: '求职意向' },
  ];
  const data = profile.data;
  data.education.forEach((item, index) => {
    const schoolHint = item.school?.trim() || `第 ${index + 1} 条`;
    options.push({
      key: `education:${index}`,
      label: `教育经历 · ${schoolHint}`,
    });
  });
  data.experience.forEach((item, index) => {
    const companyHint = item.company?.trim() || `第 ${index + 1} 条`;
    options.push({
      key: `experience:${index}`,
      label: `工作/实习 · ${companyHint}`,
    });
  });
  data.projects.forEach((item, index) => {
    const nameHint = item.name?.trim() || `第 ${index + 1} 条`;
    options.push({
      key: `projects:${index}`,
      label: `项目经历 · ${nameHint}`,
    });
  });
  data.campusActivities.forEach((item, index) => {
    const orgHint = item.organization?.trim() || `第 ${index + 1} 条`;
    options.push({
      key: `campusActivities:${index}`,
      label: `在校实践 · ${orgHint}`,
    });
  });
  if (data.skills.length > 0) {
    options.push({ key: 'skills', label: '技能特长' });
  }
  options.push({ key: 'essays', label: '自述与问答' });
  return options;
}

/**
 * 把完整档案收成只含所选段的数据副本，其它段清空，避免对照时串段。
 */
export function narrowProfileDataForSection(
  source: ProfileData,
  sectionKey: ProfileSectionKey,
): ProfileData {
  const empty = createEmptyProfileData();
  if (sectionKey === 'basic') {
    return { ...empty, basic: { ...source.basic } };
  }
  if (sectionKey === 'jobIntent') {
    return { ...empty, jobIntent: { ...source.jobIntent } };
  }
  if (sectionKey === 'essays') {
    return { ...empty, essays: { ...source.essays } };
  }
  if (sectionKey === 'skills') {
    return {
      ...empty,
      skills: source.skills.map((skillItem) => ({ ...skillItem })),
      computerLevel: source.computerLevel,
      officeSkillLevel: source.officeSkillLevel,
    };
  }
  const colonIndex = sectionKey.indexOf(':');
  if (colonIndex < 0) {
    return empty;
  }
  const sectionName = sectionKey.slice(0, colonIndex);
  const rowIndex = Number.parseInt(sectionKey.slice(colonIndex + 1), 10);
  if (!Number.isFinite(rowIndex) || rowIndex < 0) {
    return empty;
  }
  if (sectionName === 'education') {
    const row = source.education[rowIndex];
    return row ? { ...empty, education: [{ ...row }] } : empty;
  }
  if (sectionName === 'experience') {
    const row = source.experience[rowIndex];
    return row ? { ...empty, experience: [{ ...row }] } : empty;
  }
  if (sectionName === 'projects') {
    const row = source.projects[rowIndex];
    return row ? { ...empty, projects: [{ ...row }] } : empty;
  }
  if (sectionName === 'campusActivities') {
    const row = source.campusActivities[rowIndex];
    return row ? { ...empty, campusActivities: [{ ...row }] } : empty;
  }
  return empty;
}

/**
 * 列表段收窄为单条后，按行绑定只用「第1行」（对应收窄数组下标 0）。
 * experience 按该条雇佣类型决定「实习经历」或「工作经历」，避免写死实习导致工作池取空。
 * 调用方：侧栏 runRegionMapFlow 对照前。
 * 输入：框内字段、档案段键、完整档案正文。输出：打好前缀的字段副本。不改档案。
 */
export function augmentFieldsForProfileSection(
  fields: FieldDescriptor[],
  sectionKey: ProfileSectionKey,
  profileData: ProfileData,
): FieldDescriptor[] {
  const colonIndex = sectionKey.indexOf(':');
  if (colonIndex < 0) {
    return fields;
  }
  const sectionName = sectionKey.slice(0, colonIndex);
  const sourceRowIndex = Number.parseInt(sectionKey.slice(colonIndex + 1), 10);
  if (!Number.isFinite(sourceRowIndex) || sourceRowIndex < 0) {
    return fields;
  }
  const sectionTitle = resolveSectionTitleForAugment(
    sectionName,
    sourceRowIndex,
    profileData,
  );
  if (!sectionTitle) {
    return fields;
  }
  // 收窄后该条在对应数组里只有下标 0，前缀必须是第1行，不能再用原始 N
  const prefix = `${sectionTitle}第1行`;
  return fields.map((field) => {
    const labelText = field.label ?? '';
    if (labelText.includes(prefix)) {
      return field;
    }
    // 若曾被旧逻辑打过「第N行」前缀，先去掉再打第1行，避免叠两层
    const withoutOldRowPrefix = labelText.replace(
      /^(教育经历|实习经历|工作经历|项目经历|在校实践)第\d+行/,
      '',
    );
    return {
      ...field,
      label: `${prefix}${withoutOldRowPrefix}`,
    };
  });
}

/**
 * 列表段对照用的分区标题。
 * 调用方：augmentFieldsForProfileSection。输入：段名、原始下标、完整档案。
 * 输出：教育/项目/在校实践固定名；experience 按该条是否实习决定。
 */
function resolveSectionTitleForAugment(
  sectionName: string,
  sourceRowIndex: number,
  profileData: ProfileData,
): string | null {
  if (sectionName === 'education') {
    return '教育经历';
  }
  if (sectionName === 'projects') {
    return '项目经历';
  }
  if (sectionName === 'campusActivities') {
    return '在校实践';
  }
  if (sectionName === 'experience') {
    const experienceRow = profileData.experience[sourceRowIndex];
    if (!experienceRow) {
      return null;
    }
    return isInternshipExperience(experienceRow) ? '实习经历' : '工作经历';
  }
  return null;
}

/**
 * 选中经历在「实习池」或「工作池」里的 0 基下标；找不到则 0。
 * 调用方：buildSectionAddsForProfileSection。输入：完整档案与 experience 原始下标。
 */
function poolIndexOfExperienceRow(
  profileData: ProfileData,
  sourceRowIndex: number,
): { pattern: string; poolIndex: number } | null {
  const selectedRow = profileData.experience[sourceRowIndex];
  if (!selectedRow) {
    return null;
  }
  const asInternship = isInternshipExperience(selectedRow);
  const pattern = asInternship ? '实习经历' : '工作经历';
  const pool: ExperienceItem[] = asInternship
    ? namedInternshipExperiences(profileData)
    : namedWorkExperiences(profileData);
  const poolIndex = pool.findIndex(
    (poolItem) =>
      (poolItem.company || '') === (selectedRow.company || '') &&
      (poolItem.title || '') === (selectedRow.title || '') &&
      (poolItem.startDate || '') === (selectedRow.startDate || '') &&
      (poolItem.endDate || '') === (selectedRow.endDate || ''),
  );
  return {
    pattern,
    poolIndex: poolIndex >= 0 ? poolIndex : 0,
  };
}

/**
 * P4 框内写入前：只补当前档案段相关分区行（3A），不整页加满。
 * experience 按该条雇佣类型选实习/工作分区，neededRows 用该条在对应池中的位置。
 */
export function buildSectionAddsForProfileSection(
  profileData: ProfileData,
  sectionKey: ProfileSectionKey,
): SectionAddRequest[] {
  const colonIndex = sectionKey.indexOf(':');
  if (colonIndex < 0) {
    return [];
  }
  const sectionName = sectionKey.slice(0, colonIndex);
  const rowIndex = Number.parseInt(sectionKey.slice(colonIndex + 1), 10);
  if (!Number.isFinite(rowIndex) || rowIndex < 0) {
    return [];
  }
  if (sectionName === 'education') {
    const neededRows = rowIndex + 1;
    return buildSectionAdds(profileData).filter((request) =>
      /教育/.test(request.sectionPattern),
    ).map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  if (sectionName === 'experience') {
    const poolPlace = poolIndexOfExperienceRow(profileData, rowIndex);
    if (!poolPlace) {
      return [];
    }
    return [{
      sectionPattern: poolPlace.pattern,
      neededRows: poolPlace.poolIndex + 1,
    }];
  }
  if (sectionName === 'projects') {
    const neededRows = rowIndex + 1;
    return buildSectionAdds(profileData)
      .filter((request) => /项目/.test(request.sectionPattern))
      .map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  if (sectionName === 'campusActivities') {
    const neededRows = rowIndex + 1;
    return buildSectionAdds(profileData)
      .filter((request) => /在校|校内|校园/.test(request.sectionPattern))
      .map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  return [];
}
