/**
 * 按档案各段有效条数，算出页面需要补到几行。
 * 只点「添加」，不往格子里写任何档案正文。
 */
import type { SectionAddRequest } from '../types/fill';
import type { ProfileData } from '../types/profile';

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
      sectionPattern: '实习经历|工作经历',
      neededRows: countNamedRows(
        profileData.experience.map((item) => item.company || ''),
      ),
    },
    {
      sectionPattern: '项目经历|项目经验',
      neededRows: countNamedRows(
        profileData.projects.map((item) => item.name || ''),
      ),
    },
    {
      sectionPattern: '校内经历|校内任职|校园',
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
  return requests.filter((request) => request.neededRows > 0);
}
