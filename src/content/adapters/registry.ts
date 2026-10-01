/**
 * 站点适配器注册表：按当前页 hostname 解析适配器。
 * 首批：北森、Moka、智易、牛客、Boss 直聘。
 */
import type { SiteAdapter } from './types';

/** 已注册的站点适配器列表（顺序无关，按 urlPattern 匹配） */
const SITE_ADAPTERS: SiteAdapter[] = [
  {
    id: 'beisen',
    name: '北森/iTalentX',
    urlPattern:
      /(?:^|\.)beisen\.com$|(?:^|\.)italent\.cn$|(?:^|\.)italentx\.cn$|(?:^|\.)italentx\.com$/i,
    sectionSelector:
      '.el-card__header,[class*="block-title"],[class*="section-title"],[class*="module-title"],h2,h3,h4',
    addLabels: ['添加', '新增', '增加', '添加一段', '新增一段'],
    saveLabels: ['保存', '确定', '下一步', '完成', '提交'],
    editLabels: ['编辑', '修改', '完善', '填写'],
  },
  {
    id: 'moka',
    name: 'Moka 招聘',
    urlPattern: /(?:^|\.)(?:mokahr|moka)\.com$/i,
    sectionSelector:
      '.ant-card-head-title,[class*="module-title"],[class*="questionnaire-title"],[class*="block-title"],h2,h3,h4',
    addLabels: ['添加', '新增', '增加'],
    saveLabels: ['保存', '确定', '下一步', '完成', '提交'],
    editLabels: ['编辑', '修改', '完善'],
  },
  {
    id: 'zhiye',
    name: '智易/智业 ATS',
    urlPattern: /(?:^|\.)zhiye\.com$/i,
    sectionSelector:
      '.ant-card-head-title,.ant-collapse-header,.form-section-title,[class*="sectionTitle"],[class*="module-title"],h2,h3,h4',
    addLabels: ['添加', '新增', '增加'],
    saveLabels: ['保存', '确定', '完成', '提交'],
    editLabels: ['编辑', '修改', '完善'],
  },
  {
    id: 'nowcoder',
    name: '牛客网申',
    urlPattern: /(?:^|\.)nowcoder\.com$/i,
    sectionSelector:
      '.ant-card-head-title,[class*="module-title"],[class*="questionnaire-title"],[class*="resume-title"],h2,h3,h4',
    addLabels: ['添加', '新增', '增加'],
    saveLabels: ['保存', '确定', '下一步', '完成', '提交'],
    editLabels: ['编辑', '修改', '完善'],
  },
  {
    id: 'boss',
    name: 'BOSS 直聘',
    urlPattern: /(?:^|\.)zhipin\.com$|(?:^|\.)bosszhipin\.com$/i,
    sectionSelector:
      '[class*="resume"],[class*="module"],[class*="section"],[class*="title"],h2,h3,h4',
    addLabels: ['添加', '新增', '增加', '添加一段'],
    saveLabels: ['保存', '确定', '提交', '完成'],
    editLabels: ['编辑', '修改', '完善'],
  },
];

/**
 * 根据 hostname 查找适配器；无匹配返回 null（走通用逻辑）。
 */
export function resolveSiteAdapter(
  hostname: string = typeof location !== 'undefined' ? location.hostname : '',
): SiteAdapter | null {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }
  for (const adapter of SITE_ADAPTERS) {
    if (adapter.urlPattern.test(host)) {
      return adapter;
    }
  }
  return null;
}

/**
 * 当前页适配器（内容脚本内缓存一次即可）。
 */
export function getActiveSiteAdapter(): SiteAdapter | null {
  return resolveSiteAdapter();
}

/**
 * 导出列表供调试/文档（只读）。
 */
export function listSiteAdapters(): readonly SiteAdapter[] {
  return SITE_ADAPTERS;
}
