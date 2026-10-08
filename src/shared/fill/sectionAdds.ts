/**
 * 按档案各段有效条数，算出页面需要补到几行。
 * 只点「添加」，不往格子里写任何档案正文。
 */
import type { SectionAddRequest } from '../types/fill';
import type { ExperienceItem, ProfileData } from '../types/profile';

/**
 * 这条经历算不算实习。
 * 调用方：编辑页分组、补行条数、按行填表、卡片补写。
 * 输入：一条经历。输出：雇佣类型为空或为实习时为 true。不改档案。
 */
export function isInternshipExperience(item: ExperienceItem): boolean {
  const employmentType = (item.employmentType ?? '').trim();
  return employmentType.length === 0 || employmentType === 'internship';
}

/**
 * 档案里要写入实习经历分区的条目。只计写了公司或职位的。
 * 调用方：buildSectionAdds、sectionBinder、fillProfileByCards。
 * 输入：整份档案。输出：实习条目，保持原顺序。不改档案。
 */
export function namedInternshipExperiences(profileData: ProfileData): ExperienceItem[] {
  return profileData.experience.filter((item) => {
    const hasName = (item.company || item.title || '').trim().length > 0;
    return hasName && isInternshipExperience(item);
  });
}

/**
 * 档案里要写入工作经历分区的条目。只计写了公司或职位的。
 * 空雇佣类型不算工作，算实习。
 * 调用方：buildSectionAdds、sectionBinder、fillProfileByCards。
 * 输入：整份档案。输出：工作条目，保持原顺序。不改档案。
 */
export function namedWorkExperiences(profileData: ProfileData): ExperienceItem[] {
  return profileData.experience.filter((item) => {
    const hasName = (item.company || item.title || '').trim().length > 0;
    return hasName && !isInternshipExperience(item);
  });
}

/**
 * 只统计档案里真正写了内容的条目，空壳教育/项目不再拿去点「添加」。
 */
function countNamedRows(values: string[]): number {
  return values.filter((value) => value.trim().length > 0).length;
}

/**
 * 档案各段有几条有效记录。扫描出预览前、或写入兜底时用。
 */
export function buildSectionAdds(profileData: ProfileData): SectionAddRequest[] {
  const requests: SectionAddRequest[] = [
    {
      sectionPattern: '教育背景|教育经历',
      neededRows: countNamedRows(
        profileData.education.map((item) => item.school || item.major || ''),
      ),
    },
    {
      sectionPattern: '实习经历',
      neededRows: namedInternshipExperiences(profileData).length,
    },
    {
      sectionPattern: '工作经历',
      neededRows: namedWorkExperiences(profileData).length,
    },
    {
      sectionPattern: '语言能力',
      neededRows: countNamedRows(
        profileData.languages.map((item) => item.language || ''),
      ),
    },
    {
      sectionPattern: '项目经历|项目经验',
      neededRows: countNamedRows(
        profileData.projects.map((item) => item.name || ''),
      ),
    },
    {
      sectionPattern: '在校实践|校内实践|校园实践|校内经历|校内任职|校园',
      neededRows: countNamedRows(
        profileData.campusActivities.map((item) => item.organization || ''),
      ),
    },
    {
      sectionPattern: '证书',
      neededRows: countNamedRows(
        profileData.certificates.map((item) => item.name || ''),
      ),
    },
    {
      sectionPattern: '获奖|奖项|荣誉',
      neededRows: countNamedRows(
        profileData.awards.map((item) => item.name || ''),
      ),
    },
    {
      sectionPattern: '论文|专利|著作',
      neededRows: countNamedRows(
        profileData.publications.map((item) => item.title || ''),
      ),
    },
    {
      sectionPattern: '培训',
      neededRows: countNamedRows(
        profileData.trainings.map(
          (item) => item.course || item.organization || '',
        ),
      ),
    },
    {
      sectionPattern: '个人能力|个人技能|专业技能|技能特长',
      neededRows: countNamedRows(
        profileData.skills.map((item) => item.name || ''),
      ),
    },
  ];
  return requests.filter((request) => {
    if (request.sectionPattern === '工作经历') {
      return true;
    }
    return request.neededRows > 0;
  });
}
