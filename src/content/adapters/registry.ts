/**
 * 站点适配器注册表：按当前页 hostname 解析适配器。
 * 首批：北森、Moka、智易、牛客、Boss 直聘。
 * P3：北森/Moka 附带本地声明式快路径（字段选择器 + 跳过重扫）；其余站仍只走慢路径。
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
    // 本地快路径：选择器随扩展打包，无网可用；找不到节点时单格回落慢路径
    fastPath: {
      enabled: true,
      skipRescan: true,
      // 下拉/日期仍需多遍收尾；文本靠短等待加速，不把尝试次数砍到 1
      maxAttempts: 3,
      fields: [
        { roleKey: 'fullName', selector: '[data-tt-role="fullName"]', widget: 'text', labelHint: '姓名' },
        { roleKey: 'phone', selector: '[data-tt-role="phone"]', widget: 'text', labelHint: '手机' },
        { roleKey: 'school', selector: '[data-tt-role="school"]', widget: 'text', labelHint: '学校名称' },
        { roleKey: 'degree', selector: '[data-tt-role="degree"]', widget: 'select', labelHint: '学历' },
        { roleKey: 'major', selector: '[data-tt-role="major"]', widget: 'text', labelHint: '专业' },
        { roleKey: 'startDate', selector: '[data-tt-role="startDate"]', widget: 'rangeDate', labelHint: '开始时间' },
        { roleKey: 'endDate', selector: '[data-tt-role="endDate"]', widget: 'rangeDate', labelHint: '结束时间' },
        { roleKey: 'company', selector: '[data-tt-role="company"]', widget: 'text', labelHint: '公司' },
        { roleKey: 'title', selector: '[data-tt-role="title"]', widget: 'text', labelHint: '职位' },
      ],
    },
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
    // Moka 快路径：选择器与北森字段键一致，但挂在 moka 站专属 data 属性上，避免两站串配置
    fastPath: {
      enabled: true,
      skipRescan: true,
      maxAttempts: 3,
      fields: [
        { roleKey: 'fullName', selector: '[data-moka-role="fullName"]', widget: 'text', labelHint: '姓名' },
        { roleKey: 'phone', selector: '[data-moka-role="phone"]', widget: 'text', labelHint: '手机' },
        { roleKey: 'school', selector: '[data-moka-role="school"]', widget: 'text', labelHint: '学校名称' },
        { roleKey: 'degree', selector: '[data-moka-role="degree"]', widget: 'select', labelHint: '学历' },
        { roleKey: 'major', selector: '[data-moka-role="major"]', widget: 'text', labelHint: '专业' },
        { roleKey: 'startDate', selector: '[data-moka-role="startDate"]', widget: 'rangeDate', labelHint: '开始时间' },
        { roleKey: 'endDate', selector: '[data-moka-role="endDate"]', widget: 'rangeDate', labelHint: '结束时间' },
        { roleKey: 'company', selector: '[data-moka-role="company"]', widget: 'text', labelHint: '公司' },
        { roleKey: 'title', selector: '[data-moka-role="title"]', widget: 'text', labelHint: '职位' },
      ],
    },
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
