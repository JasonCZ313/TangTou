/**
 * 档案下拉枚举：稳定 code + 中文标签。
 * 存档优先存 code；展示与喂给模型时用 labelZh。
 */

export interface CatalogOption {
  code: string;
  labelZh: string;
}

/** 根据 code 取中文标签；未命中则原样返回 */
export function labelOfCatalog(
  options: CatalogOption[],
  codeOrLabel: string,
): string {
  if (!codeOrLabel) {
    return '';
  }
  const hit = options.find(
    (item) => item.code === codeOrLabel || item.labelZh === codeOrLabel,
  );
  return hit?.labelZh ?? codeOrLabel;
}

export const GENDER_OPTIONS: CatalogOption[] = [
  { code: 'male', labelZh: '男' },
  { code: 'female', labelZh: '女' },
  { code: 'other', labelZh: '其他' },
  { code: 'prefer_not', labelZh: '不愿透露' },
];

export const ETHNICITY_OPTIONS: CatalogOption[] = [
  { code: 'han', labelZh: '汉族' },
  { code: 'zhuang', labelZh: '壮族' },
  { code: 'manchu', labelZh: '满族' },
  { code: 'hui', labelZh: '回族' },
  { code: 'miao', labelZh: '苗族' },
  { code: 'uyghur', labelZh: '维吾尔族' },
  { code: 'tujia', labelZh: '土家族' },
  { code: 'yi', labelZh: '彝族' },
  { code: 'mongol', labelZh: '蒙古族' },
  { code: 'tibetan', labelZh: '藏族' },
  { code: 'buyei', labelZh: '布依族' },
  { code: 'dong', labelZh: '侗族' },
  { code: 'yao', labelZh: '瑶族' },
  { code: 'korean', labelZh: '朝鲜族' },
  { code: 'bai', labelZh: '白族' },
  { code: 'hani', labelZh: '哈尼族' },
  { code: 'kazakh', labelZh: '哈萨克族' },
  { code: 'li', labelZh: '黎族' },
  { code: 'dai', labelZh: '傣族' },
  { code: 'she', labelZh: '畲族' },
  { code: 'lisu', labelZh: '傈僳族' },
  { code: 'gelao', labelZh: '仡佬族' },
  { code: 'dongxiang', labelZh: '东乡族' },
  { code: 'gaoshan', labelZh: '高山族' },
  { code: 'lahu', labelZh: '拉祜族' },
  { code: 'shui', labelZh: '水族' },
  { code: 'wa', labelZh: '佤族' },
  { code: 'naxi', labelZh: '纳西族' },
  { code: 'qiang', labelZh: '羌族' },
  { code: 'tu', labelZh: '土族' },
  { code: 'mulao', labelZh: '仫佬族' },
  { code: 'xibe', labelZh: '锡伯族' },
  { code: 'kirgiz', labelZh: '柯尔克孜族' },
  { code: 'daur', labelZh: '达斡尔族' },
  { code: 'jingpo', labelZh: '景颇族' },
  { code: 'maonan', labelZh: '毛南族' },
  { code: 'salar', labelZh: '撒拉族' },
  { code: 'blang', labelZh: '布朗族' },
  { code: 'tajik', labelZh: '塔吉克族' },
  { code: 'achang', labelZh: '阿昌族' },
  { code: 'pumi', labelZh: '普米族' },
  { code: 'ewenki', labelZh: '鄂温克族' },
  { code: 'nu', labelZh: '怒族' },
  { code: 'jing', labelZh: '京族' },
  { code: 'jinuo', labelZh: '基诺族' },
  { code: 'deang', labelZh: '德昂族' },
  { code: 'baoan', labelZh: '保安族' },
  { code: 'russian', labelZh: '俄罗斯族' },
  { code: 'yugur', labelZh: '裕固族' },
  { code: 'uzbek', labelZh: '乌孜别克族' },
  { code: 'menba', labelZh: '门巴族' },
  { code: 'oroqen', labelZh: '鄂伦春族' },
  { code: 'drung', labelZh: '独龙族' },
  { code: 'tatar', labelZh: '塔塔尔族' },
  { code: 'heze', labelZh: '赫哲族' },
  { code: 'lhoba', labelZh: '珞巴族' },
];

export const POLITICAL_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'masses', labelZh: '群众' },
  { code: 'league', labelZh: '中国共产主义青年团团员' },
  { code: 'cpc', labelZh: '中国共产党党员' },
  { code: 'cpc_probation', labelZh: '中国共产党预备党员' },
  { code: 'democratic', labelZh: '民主党派' },
  { code: 'other', labelZh: '其他' },
];

export const MARITAL_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'single', labelZh: '未婚' },
  { code: 'married', labelZh: '已婚' },
  { code: 'divorced', labelZh: '离异' },
  { code: 'widowed', labelZh: '丧偶' },
  { code: 'prefer_not', labelZh: '不愿透露' },
];

export const FERTILITY_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'none', labelZh: '未育' },
  { code: 'has_child', labelZh: '已育' },
  { code: 'prefer_not', labelZh: '不愿透露' },
];

export const HUKOU_TYPE_OPTIONS: CatalogOption[] = [
  { code: 'urban', labelZh: '城镇' },
  { code: 'rural', labelZh: '农村' },
  { code: 'other', labelZh: '其他' },
];

export const ID_TYPE_OPTIONS: CatalogOption[] = [
  { code: 'id_card', labelZh: '居民身份证' },
  { code: 'passport', labelZh: '护照' },
  { code: 'hongkong_macau', labelZh: '港澳居民来往内地通行证' },
  { code: 'taiwan', labelZh: '台湾居民来往大陆通行证' },
  { code: 'other', labelZh: '其他' },
];

export const HEALTH_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'good', labelZh: '良好' },
  { code: 'fair', labelZh: '一般' },
  { code: 'other', labelZh: '其他' },
];

export const MILITARY_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'none', labelZh: '未服役' },
  { code: 'active', labelZh: '现役' },
  { code: 'veteran', labelZh: '退役' },
  { code: 'other', labelZh: '其他' },
];

/** 学历层次（网申常见完整集） */
export const DEGREE_LEVEL_OPTIONS: CatalogOption[] = [
  { code: 'primary', labelZh: '小学' },
  { code: 'junior_high', labelZh: '初中' },
  { code: 'technical_secondary', labelZh: '中专' },
  { code: 'technical_school', labelZh: '中技' },
  { code: 'vocational_high', labelZh: '职高' },
  { code: 'senior_high', labelZh: '高中' },
  { code: 'college', labelZh: '大专（高职）' },
  { code: 'bachelor', labelZh: '大学本科' },
  { code: 'master', labelZh: '硕士研究生' },
  { code: 'doctor', labelZh: '博士研究生' },
  { code: 'postdoc', labelZh: '博士后' },
  { code: 'mba', labelZh: 'MBA' },
  { code: 'emba', labelZh: 'EMBA' },
  { code: 'other', labelZh: '其他' },
  { code: 'prefer_not', labelZh: '不愿透露' },
];

export const STUDY_MODE_OPTIONS: CatalogOption[] = [
  { code: 'full_time', labelZh: '全日制' },
  { code: 'part_time', labelZh: '非全日制' },
  { code: 'adult', labelZh: '成人教育' },
  { code: 'self_taught', labelZh: '自学考试' },
  { code: 'online', labelZh: '网络教育' },
  { code: 'open_univ', labelZh: '开放教育' },
  { code: 'commissioned', labelZh: '委托培养' },
  { code: 'other', labelZh: '其他' },
];

export const ACADEMIC_DEGREE_OPTIONS: CatalogOption[] = [
  { code: 'none', labelZh: '无学位' },
  { code: 'bachelor', labelZh: '学士' },
  { code: 'master', labelZh: '硕士' },
  { code: 'doctor', labelZh: '博士' },
  { code: 'dual', labelZh: '双学位' },
  { code: 'other', labelZh: '其他' },
];

export const EMPLOYMENT_TYPE_OPTIONS: CatalogOption[] = [
  { code: 'full_time', labelZh: '全职' },
  { code: 'internship', labelZh: '实习' },
  { code: 'part_time', labelZh: '兼职' },
  { code: 'volunteer', labelZh: '志愿/公益' },
  { code: 'dispatch', labelZh: '派遣' },
  { code: 'other', labelZh: '其他' },
];

export const JOB_TYPE_OPTIONS: CatalogOption[] = [
  { code: 'full_time', labelZh: '全职' },
  { code: 'internship', labelZh: '实习' },
  { code: 'part_time', labelZh: '兼职' },
  { code: 'dispatch', labelZh: '派遣' },
  { code: 'other', labelZh: '其他' },
];

export const JOB_STATUS_OPTIONS: CatalogOption[] = [
  { code: 'open_to_work', labelZh: '正在找工作' },
  { code: 'employed_open', labelZh: '在职看机会' },
  { code: 'student', labelZh: '在校学生' },
  { code: 'not_looking', labelZh: '暂不求职' },
];

export const YES_NO_OPTIONS: CatalogOption[] = [
  { code: 'yes', labelZh: '是' },
  { code: 'no', labelZh: '否' },
];

export const LANGUAGE_PROFICIENCY_OPTIONS: CatalogOption[] = [
  { code: 'native', labelZh: '母语' },
  { code: 'fluent', labelZh: '精通' },
  { code: 'proficient', labelZh: '熟练' },
  { code: 'intermediate', labelZh: '一般' },
  { code: 'basic', labelZh: '入门' },
];

export const LANGUAGE_CERT_OPTIONS: CatalogOption[] = [
  { code: 'cet4', labelZh: '大学英语四级 CET-4' },
  { code: 'cet6', labelZh: '大学英语六级 CET-6' },
  { code: 'tem4', labelZh: '英语专业四级 TEM-4' },
  { code: 'tem8', labelZh: '英语专业八级 TEM-8' },
  { code: 'ielts', labelZh: '雅思 IELTS' },
  { code: 'toefl', labelZh: '托福 TOEFL' },
  { code: 'toeic', labelZh: '托业 TOEIC' },
  { code: 'duolingo', labelZh: '多邻国' },
  { code: 'other', labelZh: '其他' },
];

export const AWARD_LEVEL_OPTIONS: CatalogOption[] = [
  { code: 'school', labelZh: '校级' },
  { code: 'city', labelZh: '市级' },
  { code: 'province', labelZh: '省级' },
  { code: 'national', labelZh: '国家级' },
  { code: 'international', labelZh: '国际级' },
  { code: 'other', labelZh: '其他' },
];

export const FAMILY_RELATION_OPTIONS: CatalogOption[] = [
  { code: 'father', labelZh: '父亲' },
  { code: 'mother', labelZh: '母亲' },
  { code: 'spouse', labelZh: '配偶' },
  { code: 'child', labelZh: '子女' },
  { code: 'sibling', labelZh: '兄弟姐妹' },
  { code: 'other', labelZh: '其他' },
];

export const PUBLICATION_KIND_OPTIONS: CatalogOption[] = [
  { code: 'paper', labelZh: '论文' },
  { code: 'patent', labelZh: '专利' },
  { code: 'book', labelZh: '著作' },
  { code: 'other', labelZh: '其他' },
];

export const COMPUTER_LEVEL_OPTIONS: CatalogOption[] = [
  { code: 'none', labelZh: '无' },
  { code: 'l1', labelZh: '计算机一级' },
  { code: 'l2', labelZh: '计算机二级' },
  { code: 'l3', labelZh: '计算机三级' },
  { code: 'l4', labelZh: '计算机四级' },
  { code: 'proficient', labelZh: '熟练（无证）' },
  { code: 'other', labelZh: '其他' },
];

export const OFFICE_SKILL_OPTIONS: CatalogOption[] = [
  { code: 'basic', labelZh: '一般' },
  { code: 'proficient', labelZh: '熟练' },
  { code: 'expert', labelZh: '精通' },
];

/** 国籍（可搜索） */
export const NATIONALITY_OPTIONS: CatalogOption[] = [
  { code: 'CN', labelZh: '中国' },
  { code: 'HK', labelZh: '中国香港' },
  { code: 'MO', labelZh: '中国澳门' },
  { code: 'TW', labelZh: '中国台湾' },
  { code: 'US', labelZh: '美国' },
  { code: 'GB', labelZh: '英国' },
  { code: 'CA', labelZh: '加拿大' },
  { code: 'AU', labelZh: '澳大利亚' },
  { code: 'JP', labelZh: '日本' },
  { code: 'KR', labelZh: '韩国' },
  { code: 'SG', labelZh: '新加坡' },
  { code: 'DE', labelZh: '德国' },
  { code: 'FR', labelZh: '法国' },
  { code: 'other', labelZh: '其他' },
];

/** 行业（网申/求职常用简表） */
export const INDUSTRY_OPTIONS: CatalogOption[] = [
  { code: 'internet', labelZh: '互联网/电商' },
  { code: 'software', labelZh: '计算机软件' },
  { code: 'ai', labelZh: '人工智能/大数据' },
  { code: 'finance_bank', labelZh: '银行' },
  { code: 'finance_securities', labelZh: '证券/基金' },
  { code: 'finance_insurance', labelZh: '保险' },
  { code: 'consulting', labelZh: '咨询' },
  { code: 'accounting', labelZh: '会计/审计' },
  { code: 'law', labelZh: '法律' },
  { code: 'education', labelZh: '教育/培训' },
  { code: 'medical', labelZh: '医疗/医药' },
  { code: 'manufacturing', labelZh: '制造业' },
  { code: 'logistics', labelZh: '物流/供应链' },
  { code: 'real_estate', labelZh: '房地产/建筑' },
  { code: 'media', labelZh: '传媒/广告' },
  { code: 'gov', labelZh: '政府/事业单位' },
  { code: 'energy', labelZh: '能源/电力' },
  { code: 'defense', labelZh: '军工/航空航天' },
  { code: 'retail', labelZh: '零售/快消' },
  { code: 'other', labelZh: '其他' },
];

/** 技能熟练度 */
export const SKILL_LEVEL_OPTIONS: CatalogOption[] = [
  { code: 'basic', labelZh: '入门' },
  { code: 'intermediate', labelZh: '一般' },
  { code: 'proficient', labelZh: '熟练' },
  { code: 'expert', labelZh: '精通' },
];

/** 公司性质 */
export const COMPANY_TYPE_OPTIONS: CatalogOption[] = [
  { code: 'soe', labelZh: '国有企业' },
  { code: 'private', labelZh: '民营企业' },
  { code: 'foreign', labelZh: '外资企业' },
  { code: 'joint', labelZh: '中外合资' },
  { code: 'gov', labelZh: '机关单位' },
  { code: 'institution', labelZh: '事业单位' },
  { code: 'startup', labelZh: '创业公司' },
  { code: 'other', labelZh: '其他' },
];

/** 常用证书名称（可搜索，也可手输其他） */
export const COMMON_CERTIFICATE_OPTIONS: CatalogOption[] = [
  { code: 'cet4', labelZh: '大学英语四级 CET-4' },
  { code: 'cet6', labelZh: '大学英语六级 CET-6' },
  { code: 'computer_l2', labelZh: '全国计算机等级二级' },
  { code: 'teacher', labelZh: '教师资格证' },
  { code: 'cpa', labelZh: '注册会计师 CPA' },
  { code: 'acca', labelZh: 'ACCA' },
  { code: 'cfa', labelZh: 'CFA' },
  { code: 'frm', labelZh: 'FRM' },
  { code: 'judicial', labelZh: '法律职业资格证' },
  { code: 'ncre', labelZh: '软考' },
  { code: 'pmp', labelZh: 'PMP' },
  { code: 'driver_c1', labelZh: '机动车驾驶证 C1' },
  { code: 'mandarin_2a', labelZh: '普通话水平测试二级甲等' },
  { code: 'other', labelZh: '其他' },
];

/** 驾照准驾类型 */
export const DRIVER_LICENSE_OPTIONS: CatalogOption[] = [
  { code: 'none', labelZh: '无' },
  { code: 'c1', labelZh: 'C1' },
  { code: 'c2', labelZh: 'C2' },
  { code: 'b2', labelZh: 'B2' },
  { code: 'a1', labelZh: 'A1' },
  { code: 'other', labelZh: '其他' },
];

/** 普通话等级 */
export const MANDARIN_LEVEL_OPTIONS: CatalogOption[] = [
  { code: '1a', labelZh: '一级甲等' },
  { code: '1b', labelZh: '一级乙等' },
  { code: '2a', labelZh: '二级甲等' },
  { code: '2b', labelZh: '二级乙等' },
  { code: '3a', labelZh: '三级甲等' },
  { code: '3b', labelZh: '三级乙等' },
  { code: 'other', labelZh: '其他' },
];
