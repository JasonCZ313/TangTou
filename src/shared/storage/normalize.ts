import { createEmptyProfileData } from './defaults';
import type {
  EducationItem,
  ProfileData,
  ProfileValidationResult,
} from '../types/profile';

/**
 * 深度合并：以 base 为骨架，source 覆盖同名键；数组整段替换（若 source 提供）。
 * 用于旧档案 / 残缺导入对齐超全结构。
 */
export function deepMergeRecord(
  baseRecord: Record<string, unknown>,
  sourceRecord: Record<string, unknown>,
): Record<string, unknown> {
  const resultRecord: Record<string, unknown> = { ...baseRecord };
  for (const [keyName, sourceValue] of Object.entries(sourceRecord)) {
    if (sourceValue === undefined) {
      continue;
    }
    const baseValue = resultRecord[keyName];
    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      resultRecord[keyName] = deepMergeRecord(
        baseValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
      continue;
    }
    resultRecord[keyName] = sourceValue;
  }
  return resultRecord;
}

/**
 * 将任意残缺 data 归一化为完整 ProfileData，并迁移旧字段（city→currentCity、degree→degreeLevel）。
 */
export function normalizeProfileData(rawData: unknown): ProfileData {
  const emptyProfileData = createEmptyProfileData();
  if (!rawData || typeof rawData !== 'object') {
    return emptyProfileData;
  }

  const merged = deepMergeRecord(
    emptyProfileData as unknown as Record<string, unknown>,
    rawData as Record<string, unknown>,
  ) as unknown as ProfileData;

  // 旧版 basic.city → currentCity
  if (!merged.basic.currentCity && merged.basic.city) {
    merged.basic.currentCity = merged.basic.city;
  }

  // 旧版 education.degree → degreeLevel
  merged.education = (merged.education ?? []).map((item: EducationItem) => {
    const degreeLevel = item.degreeLevel || item.degree || '';
    return {
      ...item,
      degreeLevel,
      school: item.school ?? '',
      major: item.major ?? '',
      startDate: item.startDate ?? '',
      endDate: item.endDate ?? '',
    };
  });

  // 保证数组字段存在
  merged.experience = Array.isArray(merged.experience) ? merged.experience : [];
  merged.projects = Array.isArray(merged.projects) ? merged.projects : [];
  merged.campusActivities = Array.isArray(merged.campusActivities)
    ? merged.campusActivities
    : [];
  merged.skills = Array.isArray(merged.skills) ? merged.skills : [];
  merged.languages = Array.isArray(merged.languages) ? merged.languages : [];
  merged.certificates = Array.isArray(merged.certificates)
    ? merged.certificates
    : [];
  merged.awards = Array.isArray(merged.awards) ? merged.awards : [];
  merged.publications = Array.isArray(merged.publications)
    ? merged.publications
    : [];
  merged.trainings = Array.isArray(merged.trainings) ? merged.trainings : [];
  merged.familyMembers = Array.isArray(merged.familyMembers)
    ? merged.familyMembers
    : [];
  merged.notes = typeof merged.notes === 'string' ? merged.notes : '';
  merged.emergencyContact = merged.emergencyContact ?? {
    name: '',
    relationship: '',
    phone: '',
  };
  merged.specialOrg = merged.specialOrg ?? {};
  merged.workAuth = merged.workAuth ?? {};
  merged.essays = merged.essays ?? {};
  merged.attachmentNotes = merged.attachmentNotes ?? {};
  merged.jobIntent = merged.jobIntent ?? { targetRole: '' };
  merged.basic = merged.basic ?? emptyProfileData.basic;

  return merged;
}

/**
 * 校验硬必填与软必填；硬必填不通过则 ok=false。
 */
export function validateProfileData(
  profileData: ProfileData,
): ProfileValidationResult {
  const missingRequired: string[] = [];
  const softWarnings: string[] = [];

  if (!profileData.basic.fullName.trim()) {
    missingRequired.push('姓名');
  }
  if (!profileData.basic.phone.trim()) {
    missingRequired.push('手机');
  }
  if (!profileData.basic.email.trim()) {
    missingRequired.push('邮箱');
  }
  if (!profileData.basic.currentCity.trim()) {
    missingRequired.push('现居城市');
  }
  if (!profileData.jobIntent.targetRole.trim()) {
    missingRequired.push('目标职位');
  }

  const hasCompleteEducation = profileData.education.some((item) => {
    const hasDegree = Boolean(
      (item.degreeLevel || item.degree || '').trim(),
    );
    const hasEndOrCurrent =
      Boolean(item.endDate?.trim()) || Boolean(item.isCurrent);
    return (
      Boolean(item.school?.trim()) &&
      hasDegree &&
      Boolean(item.startDate?.trim()) &&
      hasEndOrCurrent
    );
  });
  if (!hasCompleteEducation) {
    missingRequired.push(
      '至少一条完整教育经历（学校、学历层次、入学日期、毕业日期或在读）',
    );
  }

  if (!profileData.basic.gender?.trim()) {
    softWarnings.push('建议填写性别');
  }
  if (!profileData.basic.birthday?.trim()) {
    softWarnings.push('建议填写出生日期');
  }
  if (!profileData.education.some((item) => item.isHighest)) {
    softWarnings.push('建议勾选一条「最高学历」');
  }
  if (
    !profileData.jobIntent.workCity?.trim() &&
    !profileData.jobIntent.expectedCities?.trim()
  ) {
    softWarnings.push('建议填写期望/工作城市');
  }
  if (!profileData.jobIntent.availableDate?.trim()) {
    softWarnings.push('建议填写到岗日期');
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    softWarnings,
  };
}
