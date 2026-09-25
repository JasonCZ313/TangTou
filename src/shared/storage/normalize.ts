import { createEmptyProfileData } from './defaults';
import type {
  AwardItem,
  CertificateItem,
  EducationItem,
  EmergencyContact,
  ExperienceItem,
  ProfileData,
  ProfileValidationResult,
  ProjectItem,
  RegionSelection,
  SkillItem,
} from '../types/profile';

/**
 * 判断对象是否为可用的 RegionSelection（至少有展示文案）。
 */
function isUsableRegionSelection(value: unknown): value is RegionSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const region = value as RegionSelection;
  return typeof region.text === 'string' && region.text.trim().length > 0;
}

/**
 * 有结构化地区时用 text 回填字符串字段；否则保留原字符串。
 */
function syncRegionTextField(
  textValue: string | undefined,
  regionValue: RegionSelection | undefined,
): string {
  if (isUsableRegionSelection(regionValue)) {
    return regionValue.text.trim();
  }
  return typeof textValue === 'string' ? textValue : '';
}

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
 * 将旧 skills: string[] 或混合数组归一化为 SkillItem[]。
 */
function normalizeSkills(rawSkills: unknown): SkillItem[] {
  if (!Array.isArray(rawSkills)) {
    return [];
  }
  const result: SkillItem[] = [];
  for (const entry of rawSkills) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (name) {
        result.push({ name });
      }
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const name =
        typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) {
        continue;
      }
      result.push({
        name,
        level: typeof record.level === 'string' ? record.level : '',
        years: typeof record.years === 'string' ? record.years : '',
        category: typeof record.category === 'string' ? record.category : '',
      });
    }
  }
  return result;
}

/**
 * 将旧 emergencyContact 单对象迁入 emergencyContacts 数组。
 */
function normalizeEmergencyContacts(
  rawData: Record<string, unknown>,
  mergedContacts: unknown,
): EmergencyContact[] {
  if (Array.isArray(mergedContacts) && mergedContacts.length > 0) {
    return mergedContacts
      .filter(
        (item): item is EmergencyContact =>
          Boolean(item) && typeof item === 'object',
      )
      .map((item) => ({
        name: item.name ?? '',
        relationship: item.relationship ?? '',
        phone: item.phone ?? '',
      }));
  }
  const legacy = rawData.emergencyContact;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const contact = legacy as EmergencyContact;
    if (contact.name || contact.phone || contact.relationship) {
      return [
        {
          name: contact.name ?? '',
          relationship: contact.relationship ?? '',
          phone: contact.phone ?? '',
        },
      ];
    }
  }
  return [];
}

/**
 * 将任意残缺 data 归一化为完整 ProfileData，并迁移旧字段。
 */
export function normalizeProfileData(rawData: unknown): ProfileData {
  const emptyProfileData = createEmptyProfileData();
  if (!rawData || typeof rawData !== 'object') {
    return emptyProfileData;
  }

  const sourceRecord = rawData as Record<string, unknown>;
  const merged = deepMergeRecord(
    emptyProfileData as unknown as Record<string, unknown>,
    sourceRecord,
  ) as unknown as ProfileData;

  // 旧版 basic.city → currentCity
  if (!merged.basic.currentCity && merged.basic.city) {
    merged.basic.currentCity = merged.basic.city;
  }

  // 地区结构化 → 字符串主字段（喂 LLM / 校验）
  merged.basic.currentCity = syncRegionTextField(
    merged.basic.currentCity,
    merged.basic.currentCityRegion,
  );
  merged.basic.nativePlace = syncRegionTextField(
    merged.basic.nativePlace,
    merged.basic.nativePlaceRegion,
  );
  merged.basic.birthPlace = syncRegionTextField(
    merged.basic.birthPlace,
    merged.basic.birthPlaceRegion,
  );
  merged.basic.hukouLocation = syncRegionTextField(
    merged.basic.hukouLocation,
    merged.basic.hukouLocationRegion,
  );

  merged.jobIntent = merged.jobIntent ?? { targetRole: '' };
  merged.jobIntent.workCity = syncRegionTextField(
    merged.jobIntent.workCity,
    merged.jobIntent.workCityRegion,
  );
  // 期望城市：有结构化列表时用顿号拼接回填
  if (
    Array.isArray(merged.jobIntent.expectedCitiesRegions) &&
    merged.jobIntent.expectedCitiesRegions.length > 0
  ) {
    const texts = merged.jobIntent.expectedCitiesRegions
      .filter(isUsableRegionSelection)
      .map((region) => region.text.trim());
    if (texts.length > 0) {
      merged.jobIntent.expectedCities = texts.join('、');
    }
  }

  // 旧版 education.degree → degreeLevel；补全第二学位骨架
  merged.education = (merged.education ?? []).map((item: EducationItem) => {
    const degreeLevel = item.degreeLevel || item.degree || '';
    const secondDegree =
      item.secondDegree && typeof item.secondDegree === 'object'
        ? {
            school: item.secondDegree.school ?? '',
            major: item.secondDegree.major ?? '',
            degreeLevel: item.secondDegree.degreeLevel ?? '',
            academicDegree: item.secondDegree.academicDegree ?? '',
            college: item.secondDegree.college ?? '',
            startDate: item.secondDegree.startDate ?? '',
            endDate: item.secondDegree.endDate ?? '',
            description: item.secondDegree.description ?? '',
          }
        : undefined;
    return {
      ...item,
      degreeLevel,
      school: item.school ?? '',
      major: item.major ?? '',
      startDate: item.startDate ?? '',
      endDate: item.endDate ?? '',
      city: syncRegionTextField(item.city, item.cityRegion),
      secondDegree,
    };
  });

  // 经历：补齐 id / 锁定态 / 职责字段
  merged.experience = (Array.isArray(merged.experience) ? merged.experience : []).map(
    (item: ExperienceItem) => ({
      ...item,
      id: item.id?.trim() || crypto.randomUUID(),
      editingLocked: Boolean(item.editingLocked),
      attachmentNote: item.attachmentNote ?? '',
      cloudLink: item.cloudLink ?? '',
      company: item.company ?? '',
      title: item.title ?? '',
      startDate: item.startDate ?? '',
      endDate: item.endDate ?? '',
      description: item.description ?? '',
      responsibilities: item.responsibilities ?? '',
      workContent: item.workContent ?? '',
      achievements: item.achievements ?? '',
      industry: item.industry ?? '',
      city: syncRegionTextField(item.city, item.cityRegion),
    }),
  );

  // 项目：旧 description 可回填 content，并补齐条目 id
  merged.projects = (Array.isArray(merged.projects) ? merged.projects : []).map(
    (item: ProjectItem) => {
      const content =
        item.content?.trim() ||
        (item.description?.trim() ? item.description : '') ||
        '';
      return {
        ...item,
        id: item.id?.trim() || crypto.randomUUID(),
        editingLocked: Boolean(item.editingLocked),
        attachmentNote: item.attachmentNote ?? '',
        cloudLink: item.cloudLink ?? '',
        name: item.name ?? '',
        description: item.description ?? '',
        content,
        value: item.value ?? '',
      };
    },
  );

  merged.campusActivities = Array.isArray(merged.campusActivities)
    ? merged.campusActivities
    : [];
  merged.skills = normalizeSkills(
    sourceRecord.skills !== undefined ? sourceRecord.skills : merged.skills,
  );
  merged.languages = Array.isArray(merged.languages) ? merged.languages : [];
  merged.certificates = (Array.isArray(merged.certificates) ? merged.certificates : []).map(
    (item: CertificateItem) => ({
      ...item,
      id: item.id?.trim() || crypto.randomUUID(),
      editingLocked: Boolean(item.editingLocked),
      attachmentNote: item.attachmentNote ?? '',
      cloudLink: item.cloudLink ?? '',
      name: item.name ?? '',
    }),
  );
  merged.awards = (Array.isArray(merged.awards) ? merged.awards : []).map(
    (item: AwardItem) => ({
      ...item,
      id: item.id?.trim() || crypto.randomUUID(),
      editingLocked: Boolean(item.editingLocked),
      attachmentNote: item.attachmentNote ?? '',
      cloudLink: item.cloudLink ?? '',
      name: item.name ?? '',
    }),
  );
  merged.publications = Array.isArray(merged.publications)
    ? merged.publications
    : [];
  merged.trainings = Array.isArray(merged.trainings) ? merged.trainings : [];
  merged.familyMembers = Array.isArray(merged.familyMembers)
    ? merged.familyMembers
    : [];
  merged.notes = typeof merged.notes === 'string' ? merged.notes : '';
  merged.emergencyContacts = normalizeEmergencyContacts(
    sourceRecord,
    merged.emergencyContacts,
  );
  merged.specialOrg = merged.specialOrg ?? {};
  merged.workAuth = merged.workAuth ?? {};
  merged.industryExtras = merged.industryExtras ?? {};
  merged.essays = merged.essays ?? {};
  merged.attachmentNotes = merged.attachmentNotes ?? {};
  merged.jobIntent = merged.jobIntent ?? { targetRole: '' };
  merged.basic = merged.basic ?? emptyProfileData.basic;

  return merged;
}

/**
 * 判断学位是否为双学位（兼容 code 与中文标签）。
 */
export function isDualAcademicDegree(academicDegree: string | undefined): boolean {
  const value = (academicDegree || '').trim();
  return value === 'dual' || value === '双学位';
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
  if (!profileData.basic.nationality?.trim()) {
    missingRequired.push('国籍');
  }
  if (!profileData.basic.nativePlace?.trim()) {
    missingRequired.push('籍贯');
  }
  if (!profileData.basic.idType?.trim()) {
    missingRequired.push('证件类型');
  }
  if (!profileData.basic.idNumber?.trim()) {
    missingRequired.push('证件号码');
  }
  if (!profileData.basic.politicalStatus?.trim()) {
    missingRequired.push('政治面貌');
  }
  if (!profileData.basic.maritalStatus?.trim()) {
    missingRequired.push('婚姻状况');
  }
  if (!profileData.jobIntent.targetRole.trim()) {
    missingRequired.push('目标职位');
  }

  const hasCompleteEducation = profileData.education.some((item) => {
    const hasDegree = Boolean((item.degreeLevel || item.degree || '').trim());
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

  // 双学位：第二学位学校+专业必填
  profileData.education.forEach((item, index) => {
    if (!isDualAcademicDegree(item.academicDegree)) {
      return;
    }
    const second = item.secondDegree;
    if (!second?.school?.trim() || !second?.major?.trim()) {
      missingRequired.push(
        `教育经历 ${index + 1}：双学位须填写第二学位的学校与专业`,
      );
    }
  });

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
  if (profileData.experience.length === 0) {
    softWarnings.push('建议至少添加一条实习或工作经历');
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    softWarnings,
  };
}
