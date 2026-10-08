/**
 * 选区填入 P3：把完整档案收成「一段」再给对照引擎用。
 * 侧栏下拉选段；后台 BUILD_FILL_PLAN 带 profileSectionKey 时只喂这一段数据。
 */

import { buildSectionAdds } from '../fill/sectionAdds';
import { namedInternshipExperiences } from '../fill/sectionAdds';
import { createEmptyProfileData } from '../storage/defaults';
import type { FieldDescriptor, SectionAddRequest } from '../types/fill';
import type { Profile, ProfileData } from '../types/profile';

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
 * 列表段对照时，给字段标签补上「教育经历第1行」等前缀，让按行绑定能对上档案条。
 * basic / jobIntent / essays 等单段不加前缀。
 */
export function augmentFieldsForProfileSection(
  fields: FieldDescriptor[],
  sectionKey: ProfileSectionKey,
): FieldDescriptor[] {
  const colonIndex = sectionKey.indexOf(':');
  if (colonIndex < 0) {
    return fields;
  }
  const sectionName = sectionKey.slice(0, colonIndex);
  const rowIndex = Number.parseInt(sectionKey.slice(colonIndex + 1), 10);
  if (!Number.isFinite(rowIndex) || rowIndex < 0) {
    return fields;
  }
  const rowLabel = rowIndex + 1;
  const sectionTitleByName: Record<string, string> = {
    education: '教育经历',
    experience: '实习经历',
    projects: '项目经历',
    campusActivities: '在校实践',
  };
  const sectionTitle = sectionTitleByName[sectionName];
  if (!sectionTitle) {
    return fields;
  }
  const prefix = `${sectionTitle}第${rowLabel}行`;
  return fields.map((field) => {
    const labelText = field.label ?? '';
    if (labelText.includes(prefix)) {
      return field;
    }
    return {
      ...field,
      label: `${prefix}${labelText}`,
    };
  });
}

/**
 * P4 框内写入前：只补当前档案段相关分区行（3A），不整页加满。
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
  const neededRows = rowIndex + 1;
  if (sectionName === 'education') {
    return buildSectionAdds(profileData).filter((request) =>
      /教育/.test(request.sectionPattern),
    ).map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  if (sectionName === 'experience') {
    const internships = namedInternshipExperiences(profileData);
    const isInternshipRow = rowIndex < internships.length;
    const pattern = isInternshipRow ? '实习经历' : '工作经历';
    return [{ sectionPattern: pattern, neededRows }];
  }
  if (sectionName === 'projects') {
    return buildSectionAdds(profileData)
      .filter((request) => /项目/.test(request.sectionPattern))
      .map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  if (sectionName === 'campusActivities') {
    return buildSectionAdds(profileData)
      .filter((request) => /在校|校内|校园/.test(request.sectionPattern))
      .map((request) => ({ ...request, neededRows: Math.min(request.neededRows, neededRows) }));
  }
  return [];
}
