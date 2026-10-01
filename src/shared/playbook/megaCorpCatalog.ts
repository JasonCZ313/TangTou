/**
 * P7c：大厂 / 特殊 ATS 样例目录（hostname 启发式）。
 * 用于提示「建议探活」或「已有 P3 适配器走快路径」；不是可执行脚本。
 */

/** 目录中的一条样例提示 */
export interface MegaCorpSampleHint {
  id: string;
  /** 展示用名称 */
  name: string;
  /** 匹配 hostname */
  hostnamePattern: RegExp;
  /** 给用户/Playbook 的短说明 */
  notes: string;
  /**
   * true：页面常变态，建议智能探活；
   * false：仅登记，默认仍先扫描。
   */
  preferProbe: boolean;
}

/**
 * 内置大厂样例（可随验收扩展；不替代 P3 适配器）。
 */
export const MEGA_CORP_SAMPLES: readonly MegaCorpSampleHint[] = [
  {
    id: 'jd',
    name: '京东校园/社招',
    hostnamePattern: /(?:^|\.)(?:jd|jacrecruit|campus\.jd)\.com$/i,
    notes: '常见自定义年份/多步弹层；探测只开选择器，禁止点投递。',
    preferProbe: true,
  },
  {
    id: 'bytedance',
    name: '字节跳动招聘',
    hostnamePattern: /(?:^|\.)(?:bytedance|jobs\.bytedance)\.com$/i,
    notes: '分区添加与仿 Ant 下拉较多；有适配器时仍可先扫描。',
    preferProbe: true,
  },
  {
    id: 'alibaba',
    name: '阿里系招聘',
    hostnamePattern:
      /(?:^|\.)(?:alibaba|alibabagroup|taotian|cainiao)\.com$|(?:^|\.)aliyun\.com$/i,
    notes: '多步表单与城市点选常见；探活预算内点开下拉即可。',
    preferProbe: true,
  },
  {
    id: 'lenovo',
    name: '联想招聘',
    hostnamePattern: /(?:^|\.)(?:lenovo|lenovocareers)\.com$/i,
    notes: '外企/自建 ATS 混用；优先 OCR+探测读选项。',
    preferProbe: true,
  },
  {
    id: 'tencent',
    name: '腾讯招聘',
    hostnamePattern: /(?:^|\.)(?:tencent|join\.qq)\.com$/i,
    notes: '复杂分区；确认执行前必须预览。',
    preferProbe: true,
  },
  {
    id: 'meituan',
    name: '美团招聘',
    hostnamePattern: /(?:^|\.)(?:meituan|zhaopin\.meituan)\.com$/i,
    notes: '自定义控件多；探测不点提交。',
    preferProbe: true,
  },
  {
    id: 'huawei',
    name: '华为招聘',
    hostnamePattern: /(?:^|\.)(?:huawei|career\.huawei)\.com$/i,
    notes: '步骤长；建议探活方案合并进预览后再写。',
    preferProbe: true,
  },
  {
    id: 'foreign-workday',
    name: '外企 Workday 类',
    hostnamePattern: /(?:^|\.)myworkdayjobs\.com$/i,
    notes: '外企常见；探测展开折叠区读字段。',
    preferProbe: true,
  },
];

/**
 * 按 hostname 匹配大厂样例；无匹配返回 null。
 */
export function matchMegaCorpSample(
  hostname: string,
): MegaCorpSampleHint | null {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }
  for (const sample of MEGA_CORP_SAMPLES) {
    if (sample.hostnamePattern.test(host)) {
      return sample;
    }
  }
  return null;
}

/**
 * 生成探活/扫描路径提示文案（有 P3 适配器时强调快路径）。
 */
export function buildProbePathNotice(options: {
  hostname: string;
  siteAdapterName?: string;
}): string[] {
  const notices: string[] = [];
  const sample = matchMegaCorpSample(options.hostname);
  if (options.siteAdapterName) {
    notices.push(
      `已命中 P3 适配器「${options.siteAdapterName}」：优先「扫描本页」走快路径；智能探活为可选增强。`,
    );
  }
  if (sample) {
    notices.push(
      `大厂样例「${sample.name}」：${sample.notes}${
        sample.preferProbe && !options.siteAdapterName
          ? ' 建议使用智能探活。'
          : ''
      }`,
    );
  }
  return notices;
}
