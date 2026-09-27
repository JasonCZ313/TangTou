// @ts-nocheck
/**
 * 规则层（纯数据 + 纯函数，不碰 DOM）。
 * 职责：字段词典、关键词匹配、下拉别名、档案 → 行条目映射。
 * 之所以独立成文件：匹配规则是最容易出错的策略中心，必须能单独读、单独改。
 */

/** 摘要文本：把任意字符串压成单行并截断，用于日志与下拉选项比较 */
export const truncate = (text, maxLength = 50) => {
  const singleLine = String(text || '').replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? singleLine.slice(0, maxLength) + '...' : singleLine;
};

/**
 * 归一化日期为 YYYY-MM-DD（或原样返回「至今」）。
 * 这是全引擎唯一的日期口径：档案值、控件值、比较值都走这里，避免各处格式打架。
 */
export const normalizeDate = (value) => {
  if (!value) return '';
  if (/^(至今|present)$/i.test(String(value).trim())) return '至今';
  const compact = String(value).replace(/[年./]/g, '-').replace(/月/g, '').replace(/日/g, '');
  const matched = compact.match(/(\d{2,4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!matched) return String(value).trim();
  const yearRaw = matched[1];
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${matched[2].padStart(2, '0')}-${(matched[3] || '01').padStart(2, '0')}`;
};

/** 完整日期按控件角色截取：年控件拿 2023，月控件拿 6（不补零，兼容「6月」「06」两种文案） */
export const datePartValue = (value, part) => {
  const normalized = normalizeDate(value);
  if (!/^\d{4}-\d{2}/.test(normalized)) return '';
  if (part === 'year') return normalized.slice(0, 4);
  if (part === 'month') return String(Number(normalized.slice(5, 7)));
  if (part === 'day') return normalized.length >= 10 ? String(Number(normalized.slice(8, 10))) : '';
  return normalized;
};

/** 基础信息字段词典：key → 中文标签（给日志与扩展字段用） */
export const BASIC_FIELDS = [
  ['name', '姓名', 'text'], ['surname', '姓', 'text'], ['givenName', '名', 'text'],
  ['gender', '性别', 'text'], ['birthday', '出生日期', 'date'], ['ethnicity', '民族', 'text'],
  ['city', '所在城市', 'text'], ['idType', '证件类型', 'text'], ['idNumber', '证件号码', 'text'],
  ['phone', '手机号', 'text'], ['email', '邮箱', 'text'], ['wechat', '微信号', 'text'],
  ['github', 'GitHub', 'text'], ['homepage', '个人主页/博客', 'text'], ['portfolio', '个人作品集网站', 'text'],
  ['website', '个人网址', 'text'], ['linkedin', 'LinkedIn', 'text'],
  ['emergencyContact', '紧急联系人', 'text'], ['emergencyPhone', '紧急联系方式', 'text'],
  ['school', '学校', 'text'], ['college', '学院', 'text'], ['major', '专业', 'text'], ['degree', '学历', 'text'],
  ['educationStart', '入学时间', 'date'], ['educationEnd', '毕业时间', 'date'], ['mainCourses', '主修课程', 'textarea'],
  ['nativePlace', '籍贯', 'text'], ['hukouLocation', '户籍所在地', 'text'], ['politicalStatus', '政治面貌', 'text'],
  ['hukouProvince', '户籍所在地省', 'text'], ['hukouCity', '户籍所在地市', 'text'],
  ['liveProvince', '现居住省', 'text'], ['liveCity', '现居住市', 'text'],
  ['expectedProvince', '期望工作省', 'text'],
  ['address', '现居地址', 'text'], ['jobIntent', '求职意向', 'text'], ['expectedCity', '期望城市', 'text'],
  ['expectedSalary', '期望薪资', 'text'], ['availableDate', '到岗时间', 'text'],
].map(([key, label, type]) => ({ key, label, type }));

/** 模块字段词典：用于日志标签（技能/证书等聚合展示） */
export const MODULES = [
  { key: 'skills', label: '技能标签' },
  { key: 'advantages', label: '个人优势' },
  { key: 'certificates', label: '证书' },
  { key: 'awards', label: '奖项/获奖信息' },
  { key: 'academicWorks', label: '学术成果' },
  { key: 'languages', label: '语言能力' },
  { key: 'campusExperience', label: '校园经历' },
  { key: 'otherInfo', label: '其他扩展字段' },
];

/**
 * 「XX名称」复合标签黑名单。
 * 这些框要写的是名称类内容（奖项名/论文名/项目名…），绝不能把「姓名」写进去。
 * 用一个常量收敛，避免以后再往每条规则里散着加 block。
 */
export const COMPOUND_NAME_BLOCKS = [
  '用户名', '昵称', 'nickname', 'username',
  '公司名称', '企业名称', '单位名称', '项目名称', '奖项名称', '论文名称', '学校名称',
  '组织名称', '社团名称', '活动名称', '证书名称', '成果名称', '课程名称', '职位名称',
  '岗位名称', '文件名称', '附件名称', '期刊名称', '名称',
  '紧急', '证明', '联系人', '导师', '公司', '企业', '学校', '项目', 'project', 'school', 'company',
];

/**
 * 基础信息匹配规则（只用于「非行分区」的散字段）。
 * 命中策略：取最长命中的关键词；exact 命中优先级最高；同分时列表靠前者优先。
 * block：出现这些词就整条规则作废（例如「紧急联系人」不能吃「手机号」规则）。
 */
export const AUTOFILL_RULES = [
  { key: 'emergencyPhone', words: ['紧急联系电话', '紧急联系方式'] },
  { key: 'emergencyContact', words: ['紧急联系人'] },
  // 证件类型必须优先于证件号码；号码规则禁止落在「类型」下拉上
  { key: 'idType', words: ['证件类型', '证件种类', '证件类别'] },
  { key: 'idNumber', words: ['证件号码', '证件号', '身份证号', 'idnumber', 'id number'], block: ['类型', '种类', '类别'] },
  { key: 'phone', words: ['手机号码', '手机号', '联系电话', '联系方式', '电话', '手机', 'mobile', 'phone', 'tel'], block: ['紧急', '证明'] },
  { key: 'email', words: ['电子邮箱', '电子邮件', '邮箱', 'email', 'e-mail', 'mail'] },
  // 姓/名拆分：只在标签「就是姓/名本身」时命中（exact），否则「奖项名称/论文名称」会被误吃
  { key: 'surname', exact: ['姓', '姓氏', 'surname', 'familyname', 'lastname'] },
  { key: 'givenName', exact: ['名', '名字', 'givenname', 'firstname'] },
  // 姓名：必须用 block 排除所有「XX名称」复合标签（否则会把姓名写进奖项名称框）
  { key: 'name', words: ['真实姓名', '姓名', '名字', 'fullname', 'full name', 'realname'], block: COMPOUND_NAME_BLOCKS },
  { key: 'gender', words: ['性别', 'gender', 'sex'] },
  { key: 'birthday', words: ['出生日期', '出生年月', '生日', '出生', 'birthday', 'birth', 'date of birth'] },
  { key: 'ethnicity', words: ['民族', 'ethnicity'] },
  { key: 'nativePlace', words: ['籍贯'] },
  // 户籍 / 现居 / 期望 的省市：用 block 互斥，防止「户籍省」被「现居住省」规则抢走
  { key: 'hukouProvince', words: ['户籍所在地省', '户籍所在省', '户籍省', '户口所在地省', '户口所在省'], block: ['现居', '现居住', '期望', '市'] },
  { key: 'hukouCity', words: ['户籍所在地市', '户籍所在市', '户籍市', '户口所在地市', '户口所在市'], block: ['现居', '现居住', '期望', '省'] },
  { key: 'liveProvince', words: ['现居住省', '现居省', '居住省', '现居住地省', '现居住地'], block: ['户籍', '户口', '期望', '市'] },
  { key: 'liveCity', words: ['现居住市', '现居市', '居住市', '现居住地市'], block: ['户籍', '户口', '期望', '省'] },
  { key: 'expectedProvince', words: ['期望工作省', '期望省', '意向省'], block: ['户籍', '户口', '现居', '市'] },
  { key: 'hukouLocation', words: ['户籍所在地', '户籍地址', '户口所在地', '户籍'], block: ['省', '市'] },
  { key: 'politicalStatus', words: ['政治面貌'] },
  { key: 'expectedCity', words: ['期望城市', '意向城市', '工作城市'] },
  { key: 'city', words: ['所在城市', '现居城市', '居住城市', '现居住', '城市', 'city', 'location'], block: ['期望', '意向', '户籍'] },
  { key: 'address', words: ['现居地址', '居住地址', '详细地址', '通讯地址', '联系地址', '地址', 'address'], block: ['户籍'] },
  { key: 'expectedSalary', words: ['期望薪资', '薪资要求', '期望月薪', '期望年薪', '薪资', '月薪', '年薪', 'salary'] },
  { key: 'availableDate', words: ['最早可入职', '可入职时间', '可到岗时间', '期望入职时间', '到岗时间', '最快到岗', '可到岗'] },
  { key: 'jobIntent', words: ['求职意向', '意向岗位', '意向职位', '期望职位', '应聘职位', '应聘岗位', '申请职位'] },
  // 学校名称长词优先，避免「最高学历学校名称」被「最高学历」抢走
  { key: 'school', words: ['最高学历学校名称', '最高学历学校', '学校名称', '毕业院校', '毕业学校', '就读学校', '学校', '院校', 'university', 'school'], block: ['绩点', '满绩', '排名'] },
  { key: 'degree', words: ['最高学历', '学历层次', '学历', '学位'], block: ['学校'] },
  { key: 'college', words: ['院系', '学院', 'college'] },
  { key: 'major', words: ['所学专业', '专业', 'major'] },
  { key: 'educationStart', words: ['入学时间', '入学日期'] },
  { key: 'educationEnd', words: ['毕业时间', '毕业日期'] },
  { key: 'mainCourses', words: ['主修课程', '主修', 'courses'] },
  { key: 'wechat', words: ['微信号', '微信', 'wechat', 'weixin'] },
  { key: 'github', words: ['github'] },
  { key: 'linkedin', words: ['linkedin', '领英'] },
  { key: 'portfolio', words: ['作品集', 'portfolio'] },
  { key: 'homepage', words: ['个人主页', '个人博客', '博客', '主页', 'homepage', 'blog'] },
  { key: 'website', words: ['个人网站', '个人网址', '网址', 'website'] },
  { key: 'skills', words: ['技能标签', '专业技能', '技能', 'skills', 'skill'] },
  { key: 'advantages', words: ['自我评价', '个人优势', '自我介绍', '个人简介', '自我描述', '个人评价', 'about me', 'summary'] },
];

/** 行分区的标准字段名（各分区共用同一套 canonical sub，避免各写各的） */
export const EXP_SUB_BY_KEY = {
  expCompany: 'org',
  expTitle: 'title',
  expRole: 'role',
  expStart: 'start',
  expEnd: 'end',
  expDesc: 'desc',
};
export const EXP_RULE_KEYS = Object.keys(EXP_SUB_BY_KEY);

/**
 * 行分区字段词典：key 是分区类型，value 是该分区的字段匹配规则。
 * 行分区一律「先定分区，再在分区内配字段」，禁止跨区匹配。
 */
export const ROW_RULES = {
  education: [
    { sub: 'org', words: ['学校名称', '毕业院校', '毕业学校', '就读学校', '学校', '院校', 'university', 'school'], block: ['专业', '所在地'] },
    { sub: 'college', words: ['院系', '学院', '所在学院'] },
    { sub: 'major', words: ['所学专业', '专业名称', '专业'], block: ['院系', '学院'] },
    { sub: 'degree', words: ['学历层次', '学历', '学位', '培养层次'] },
    { sub: 'start', words: ['入学时间', '入学日期', '开始时间', '起始时间', '就读时间', '在校时间'] },
    { sub: 'end', words: ['毕业时间', '毕业日期', '结束时间', '结束日期', '离校时间'] },
    { sub: 'gpa', words: ['gpa', '绩点', '平均分', '平均成绩', '成绩排名', '排名'] },
    { sub: 'courses', words: ['主修课程', '主修', '课程'] },
    { sub: 'city', words: ['学校所在地', '院校所在地', '学校城市', '学校所在城市', '所在地'], block: ['专业'] },
    { sub: 'schoolType', words: ['学校类型', '办学类型', '院校类型', '学校性质'] },
    { sub: 'desc', words: ['在校表现', '教育描述', '描述', '说明'] },
  ],
  internship: [
    { sub: 'org', words: ['公司名称', '单位名称', '企业名称', '实习单位', '所在公司', '公司', '单位', 'company'], block: ['紧急', '联系'] },
    { sub: 'role', words: ['职位名称', '岗位名称', '担任职位', '职位', '岗位', '角色', '职务'], block: ['工作职责', '岗位职责', '职责描述', '工作内容', '职责'] },
    { sub: 'start', words: ['开始时间', '起始时间', '开始日期', '入职时间', '实习时间', '任职时间', '起止时间'], block: ['最早可入职', '可入职', '可到岗', '到岗', '最早'] },
    { sub: 'end', words: ['结束时间', '结束日期', '离职时间', '截止时间', '离岗时间'] },
    { sub: 'department', words: ['所在部门', '部门名称', '部门'] },
    { sub: 'city', words: ['实习地点', '工作地点', '工作城市'] },
    { sub: 'desc', words: ['工作描述', '工作内容', '岗位职责', '职责描述', '工作职责', '实习内容', '实习描述', '职责', '描述'] },
  ],
  work: [
    { sub: 'org', words: ['公司名称', '单位名称', '企业名称', '工作单位', '所在公司', '公司', '单位', 'company'], block: ['紧急', '联系'] },
    { sub: 'role', words: ['职位名称', '岗位名称', '担任职位', '职位', '岗位', '角色', '职务'], block: ['工作职责', '岗位职责', '职责描述', '工作内容', '职责'] },
    { sub: 'start', words: ['开始时间', '起始时间', '开始日期', '入职时间', '工作时间', '任职时间', '起止时间'], block: ['最早可入职', '可入职', '可到岗', '到岗', '最早'] },
    { sub: 'end', words: ['结束时间', '结束日期', '离职时间', '截止时间', '离岗时间'] },
    { sub: 'department', words: ['所在部门', '部门名称', '部门'] },
    { sub: 'city', words: ['工作地点', '工作城市'] },
    { sub: 'desc', words: ['工作描述', '工作内容', '岗位职责', '职责描述', '工作职责', '职责', '描述'] },
  ],
  project: [
    { sub: 'title', words: ['项目名称', '项目名', 'project name'] },
    { sub: 'role', words: ['担任角色', '项目角色', '担任职位', '项目职务', '角色', '职位', '职责'], block: ['项目描述', '项目内容', '项目简介'] },
    { sub: 'start', words: ['开始时间', '起始时间', '开始日期', '项目时间', '起止时间'], block: ['最早可入职', '可入职', '可到岗', '到岗', '最早'] },
    { sub: 'end', words: ['结束时间', '结束日期', '截止时间'] },
    { sub: 'link', words: ['项目链接', '项目地址', '仓库地址', '项目网址', 'pr链接'] },
    { sub: 'techStack', words: ['技术栈', '技术关键词', '使用技术', '涉及技术'] },
    { sub: 'desc', words: ['项目描述', '项目内容', '项目简介', '项目职责', '项目介绍', '描述'] },
  ],
  campus: [
    { sub: 'title', words: ['组织名称', '社团名称', '活动名称', '校内组织', '组织', '社团', '活动', '项目名称'], block: ['描述'] },
    { sub: 'role', words: ['担任角色', '担任职务', '角色', '职务', '职位'], block: ['描述'] },
    { sub: 'start', words: ['开始时间', '起始时间', '开始日期', '起止时间'] },
    { sub: 'end', words: ['结束时间', '结束日期', '截止时间'] },
    { sub: 'desc', words: ['内容描述', '经历描述', '活动描述', '职责', '描述'] },
  ],
  certificates: [
    { sub: 'name', words: ['证书名称', '资格证书', '证书', '资格名称', '名称'] },
    { sub: 'date', words: ['获得时间', '发证时间', '颁发时间', '取得时间', '时间', '日期'] },
    { sub: 'issuer', words: ['发证机关', '颁发机构', '发证单位', '颁发单位', '发证机构'] },
    { sub: 'number', words: ['证书编号', '证书号码', '编号'] },
    { sub: 'desc', words: ['描述', '说明'] },
  ],
  awards: [
    { sub: 'name', words: ['奖项名称', '荣誉名称', '奖项', '荣誉', '名称'] },
    { sub: 'date', words: ['获奖时间', '获得时间', '时间', '日期'] },
    { sub: 'level', words: ['奖项级别', '级别', '等级'] },
    { sub: 'issuer', words: ['颁发机构', '颁奖单位', '授予单位'] },
    { sub: 'desc', words: ['描述', '说明'] },
  ],
  languages: [
    { sub: 'language', words: ['语言名称', '语种', '语言'] },
    { sub: 'level', words: ['等级', '水平', '熟练程度', '掌握程度'] },
    { sub: 'score', words: ['分数', '成绩'] },
  ],
  publications: [
    { sub: 'name', words: ['成果名称', '论文名称', '专利名称', '论文题目', '名称', '题目', '标题'] },
    { sub: 'date', words: ['发布时间', '发表时间', '时间', '日期'] },
    { sub: 'desc', words: ['描述', '说明'] },
  ],
};

/** 行分区类型：有「多行 + 添加」语义的分区，按此顺序依次填写 */
export const ROW_SECTION_TYPES = [
  'education',
  'internship',
  'work',
  'project',
  'campus',
  'certificates',
  'awards',
  'languages',
  'publications',
];

/** 各分区在页面上的添加按钮文案线索（用于找不到分区根容器时的兜底定位） */
export const SECTION_ADD_WORDS = {
  education: ['教育'],
  internship: ['实习'],
  work: ['工作'],
  project: ['项目'],
  campus: ['校内', '校园', '社团'],
  certificates: ['证书'],
  awards: ['奖项', '荣誉'],
  languages: ['语言'],
  publications: ['论文', '专利', '成果'],
};

/**
 * 分区标题识别：整格文本必须「等于」标题词（anchored），避免行内标签「项目名称」误判成标题。
 */
export const SECTION_HEADING_PATTERNS = [
  { type: 'basic', pattern: /^(基本信息|个人信息|基础信息|个人资料|基本资料|申请人信息)$/ },
  { type: 'education', pattern: /^(教育经历|教育背景|教育信息|学历信息|学习经历|教育情况|教育)$/ },
  { type: 'internship', pattern: /^(实习经历|实习经验|实习)$/ },
  { type: 'work', pattern: /^(工作经历|工作经验|职业经历|工作)$/ },
  { type: 'project', pattern: /^(项目经历|项目经验|项目信息|项目)$/ },
  { type: 'campus', pattern: /^(校内经历|校园经历|在校经历|学生工作|社团经历|校园实践|校内)$/ },
  { type: 'certificates', pattern: /^(证书|证书信息|资格证书|职业证书|资质证书|证书经历)$/ },
  { type: 'awards', pattern: /^(奖项|获奖信息|荣誉奖项|荣誉|获奖情况|获奖经历|奖项经历)$/ },
  { type: 'languages', pattern: /^(语言能力|语言|外语能力|语种能力|语言水平)$/ },
  { type: 'publications', pattern: /^(论文|专利|学术成果|科研成果|论文专利|论文发表|发表论文|论文情况)$/ },
  { type: 'skills', pattern: /^(技能|专业技能|技能特长|技能标签|技术栈|个人技能|技能专长)$/ },
  { type: 'advantages', pattern: /^(自我评价|个人优势|个人简介|自我介绍|个人评价|自我描述|个人自述)$/ },
];

/** 分区兜底关键词：没有任何标题锚点时，用祖先文本猜分区（校内优先于项目，防串区） */
export const SECTION_TEXT_KEYWORDS = {
  campus: ['校内经历', '校园经历', '在校经历', '学生工作', '社团经历', '校内'],
  internship: ['实习经历', '实习'],
  work: ['工作经历', '全职', '工作经验'],
  project: ['项目经验', '项目经历', '项目'],
  education: ['教育背景', '教育经历'],
  awards: ['获奖经历', '获奖情况', '奖项'],
  publications: ['论文发表', '论文', '专利'],
  languages: ['语言能力'],
  certificates: ['证书'],
};

/** 标题文本 → 分区类型：整格文本必须等于标题词（anchored），避免行内标签误判 */
export function matchSectionHeading(rawText) {
  const text = String(rawText || '').replace(/\s+/g, '').replace(/[：:]/g, '');
  if (!text || text.length > 24) return null;
  const hit = SECTION_HEADING_PATTERNS.find((item) => item.pattern.test(text));
  return hit ? hit.type : null;
}

/**
 * 分区标题优先级（越靠前越具体）。
 * 用于「同一层里同时出现多个分区词」时取更具体的那一个（校内/获奖 优先于泛「项目/经历」）。
 */
export const SECTION_SPECIFICITY = [
  'campus', 'awards', 'publications', 'languages', 'certificates',
  'education', 'internship', 'work', 'project',
];

/** 兜底推断的优先级：越具体的分区越优先（校内/获奖/论文 先于泛「项目/经历」） */
export const SECTION_TEXT_ORDER = [
  'campus', 'awards', 'publications', 'languages', 'certificates',
  'education', 'internship', 'work', 'project',
];

/**
 * 基础字段匹配：exact 命中优先 → 取最长命中词；extraRules（自定义字段标题）同分优先。
 * @returns 命中的 key，未命中返回 null
 */
export function matchAutofillKey(blob, availableKeys, extraRules = []) {
  const text = String(blob || '').toLowerCase();
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');
  const available = availableKeys instanceof Set ? availableKeys : new Set(availableKeys);
  let bestKey = null;
  let bestScore = 0;
  [...extraRules, ...AUTOFILL_RULES].forEach((rule) => {
    if (!available.has(rule.key)) return;
    if (rule.block?.some((word) => text.includes(word))) return;
    // exact：标签「就是这个词本身」才命中，专治「姓/名」被 XX名称 误吃
    rule.exact?.forEach((token) => {
      if (compact === token.replace(/\s+/g, '')) {
        const score = 999 + token.length;
        if (score > bestScore) {
          bestKey = rule.key;
          bestScore = score;
        }
      }
    });
    rule.words?.forEach((word) => {
      if (word.length > bestScore && text.includes(word)) {
        bestKey = rule.key;
        bestScore = word.length;
      }
    });
  });
  return bestKey;
}

/**
 * 第二轮「换个叫法」匹配：第一轮没命中的字段，去掉客套词后按同义表再认一次。
 * 目的：站点写「毕业年月」「就读院校」这类变体时，不至于整片漏填。
 */
const RELAXED_FILLER_WORDS = /(请填写|请输入|请选择|必填|选填|（.*?）|\(.*?\)|\*|＊|\s|：|:)/g;
export const RELAXED_ALIASES = [
  { key: 'name', words: ['申请人姓名', '姓名', '名字'] },
  { key: 'school', words: ['毕业院校', '就读院校', '院校', '学校'] },
  { key: 'major', words: ['所学专业', '专业'] },
  { key: 'degree', words: ['最高学历', '学历', '学位'] },
  { key: 'college', words: ['院系', '学院', '所在学院'] },
  { key: 'educationStart', words: ['入学年月', '入学时间', '入学日期'] },
  { key: 'educationEnd', words: ['毕业年月', '毕业时间', '毕业日期', '离校时间'] },
  { key: 'birthday', words: ['出生年月', '出生日期', '生日'] },
  { key: 'phone', words: ['手机号码', '手机号', '联系电话', '电话'] },
  { key: 'email', words: ['电子邮箱', '邮箱', '邮件'] },
  { key: 'idNumber', words: ['身份证号码', '证件号码', '身份证号'] },
  { key: 'idType', words: ['证件类型', '证件种类'] },
  { key: 'gender', words: ['性别'] },
  { key: 'ethnicity', words: ['民族'] },
  { key: 'politicalStatus', words: ['政治面貌'] },
  { key: 'nativePlace', words: ['籍贯', '籍贯所在地'] },
  { key: 'hukouLocation', words: ['户籍所在地', '户口所在地', '户籍'] },
  { key: 'address', words: ['现居住地', '现居地址', '居住地址', '联系地址'] },
  { key: 'city', words: ['现居住省', '现居住市', '所在城市'] },
  { key: 'expectedCity', words: ['期望工作城市', '期望城市', '意向城市'] },
  { key: 'expectedSalary', words: ['期望薪资', '薪资要求', '期望月薪'] },
  { key: 'availableDate', words: ['最快到岗', '到岗时间', '可入职时间'] },
  { key: 'jobIntent', words: ['求职意向', '意向岗位', '期望职位'] },
  { key: 'wechat', words: ['微信号', '微信'] },
  { key: 'homepage', words: ['个人主页', '博客', '主页'] },
  { key: 'skills', words: ['个人技能', '专业技能', '技能'] },
  { key: 'advantages', words: ['自我描述', '自我评价', '个人优势'] },
];

export function relaxedMatchAutofillKey(blob, availableKeys) {
  const cleaned = String(blob || '').toLowerCase().replace(RELAXED_FILLER_WORDS, '');
  if (!cleaned) return null;
  const available = availableKeys instanceof Set ? availableKeys : new Set(availableKeys);
  let bestKey = null;
  let bestScore = 0;
  RELAXED_ALIASES.forEach((rule) => {
    if (!available.has(rule.key)) return;
    rule.words.forEach((word) => {
      if (word.length > bestScore && cleaned.includes(word)) {
        bestKey = rule.key;
        bestScore = word.length;
      }
    });
  });
  return bestKey;
}

/**
 * 行分区字段匹配：返回 canonical sub（org/role/start/end/desc…），未命中返回 null。
 */
export function matchRowRule(blob, rules, availableSubs) {
  const text = String(blob || '').toLowerCase();
  if (!text) return null;
  const available = availableSubs instanceof Set ? availableSubs : new Set(availableSubs);
  let bestSub = null;
  let bestScore = 0;
  rules.forEach((rule) => {
    if (!available.has(rule.sub)) return;
    if (rule.block?.some((word) => text.includes(word))) return;
    rule.words.forEach((word) => {
      if (word.length > bestScore && text.includes(word)) {
        bestSub = rule.sub;
        bestScore = word.length;
      }
    });
  });
  return bestSub;
}

/**
 * 下拉选项别名：档案里的中文/短文案 ↔ 页面常见选项文案。
 * 这是「点选控件」能不能选中的关键——比对的是别名集合，而不是原字符串。
 */
export function optionMatchAliases(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const aliases = new Set([raw, raw.toLowerCase()]);
  if (raw === '男' || /^male$/i.test(raw)) ['男', 'male'].forEach((item) => aliases.add(item));
  if (raw === '女' || /^female$/i.test(raw)) ['女', 'female'].forEach((item) => aliases.add(item));
  if (/团员/.test(raw)) ['共青团员', '团员', '中国共产主义青年团团员', '中国共青团团员'].forEach((item) => aliases.add(item));
  if (/预备党员/.test(raw)) ['中共预备党员', '预备党员', '中国共产党预备党员'].forEach((item) => aliases.add(item));
  else if (/党员/.test(raw)) ['中共党员', '党员', '中国共产党党员'].forEach((item) => aliases.add(item));
  if (/身份证|居民身份证/.test(raw)) ['身份证', '居民身份证', '中国居民身份证'].forEach((item) => aliases.add(item));
  if (/本科/.test(raw)) ['大学本科', '本科', '本科生'].forEach((item) => aliases.add(item));
  if (/专科|大专/.test(raw)) ['大专', '专科', '大学专科'].forEach((item) => aliases.add(item));
  if (/硕士|研究生/.test(raw)) ['硕士', '硕士研究生', '研究生'].forEach((item) => aliases.add(item));
  if (/博士/.test(raw)) ['博士', '博士研究生'].forEach((item) => aliases.add(item));
  if (/群众/.test(raw)) ['群众', '普通群众'].forEach((item) => aliases.add(item));
  return [...aliases];
}

/**
 * 档案 → 可填值列表（含自定义扩展字段）。
 * 只有非空字段才会进入 values，避免拿空值覆盖页面。
 */
export function buildAutofillValues(editable) {
  const profile = editable?.profile || {};
  const labelOf = {};
  BASIC_FIELDS.forEach((field) => { labelOf[field.key] = field.label; });
  MODULES.forEach((module) => { labelOf[module.key] = module.label; });
  const values = Object.keys(profile)
    .map((key) => ({ key, label: labelOf[key] || key, value: String(profile[key] || '').trim() }))
    .filter((item) => item.value);
  (editable?.customFields || []).forEach((customField, index) => {
    const content = String(customField?.content || '').trim();
    if (!content) return;
    const title = String(customField?.title || '').trim();
    values.push({ key: `custom_${index}`, label: title || truncate(content, 10), value: content });
  });
  return values;
}

/**
 * 行条目容错取数：既接受 { type, index, data } 包裹结构，也接受裸数据对象。
 * 为什么需要：取值函数被调用时，有的地方传包裹对象、有的地方传 data；
 * 一旦不统一，行签名会全部变成空串（历史上导致档案只填第一条）。
 */
const unwrapRowData = (entry) => (
  entry && typeof entry === 'object' && entry.data && typeof entry.data === 'object'
    ? entry.data
    : entry
);

/**
 * 行条目取值：统一从 canonical sub 取字符串。
 * 所有分区共用这一个映射，新增字段只需在这里加一行。
 */
export function rowValue(entry, sub) {
  const data = unwrapRowData(entry) || {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = String(data[key] || '').trim();
      if (value) return value;
    }
    return '';
  };
  switch (sub) {
    case 'org': return pick('org', 'company', 'organization', 'school', 'title', 'name');
    case 'title': return pick('title', 'name', 'org', 'organization');
    case 'name': return pick('name', 'title', 'language');
    case 'role': return pick('role', 'title');
    case 'start': return pick('start', 'startDate');
    case 'end': return pick('end', 'endDate');
    case 'date': return pick('date', 'start');
    case 'desc': return pick('desc', 'description', 'content');
    case 'level': return pick('level', 'proficiency');
    case 'score': return pick('score');
    case 'language': return pick('language', 'name');
    case 'major': return pick('major');
    case 'degree': return pick('degree', 'degreeLevel');
    case 'gpa': return pick('gpa');
    case 'courses': return pick('courses');
    case 'college': return pick('college');
    case 'issuer': return pick('issuer', 'organization');
    case 'number': return pick('number', 'certificate');
    // 分区专属补充字段（学校所在地 / 部门 / 工作城市 / 项目链接 / 技术栈 / 学校类型）
    case 'city': return pick('city');
    case 'department': return pick('department');
    case 'schoolType': return pick('schoolType', 'educationType');
    case 'link': return pick('link');
    case 'techStack': return pick('techStack');
    default: return pick(sub);
  }
}

/** 裸日期控件识别：标签可能就是「年」「月」，或标签末尾带「年/月/日」 */
export function bareDatePartOf(blob) {
  const compact = String(blob || '').replace(/\s+/g, '').replace(/[*＊:：]/g, '');
  if (!compact) return null;
  const tail = compact.match(/([年月日])$/);
  if (!tail) return null;
  const prefix = compact.slice(0, compact.length - 1);
  // 前缀过长说明是「年收入」这类实词，不是日期控件
  if (prefix.length > 6) return null;
  if (prefix && !/^[\u4e00-\u9fa5a-zA-Z]+$/.test(prefix)) return null;
  return tail[1];
}

/**
 * 行字段的第二轮兜底：标签里带「开始/结束/描述/名称」这类关键词时，直接落到对应 sub。
 * 目的：站点写「毕业年月」「实习起始日期」这类变体时也能认出来。
 */
export function inferSubByKeyword(blob, sectionType) {
  const text = String(blob || '').toLowerCase().replace(/(请填写|请输入|请选择|必填|选填|\*|＊|\s|：|:)/g, '');
  if (!text) return null;
  const rules = ROW_RULES[sectionType] || [];
  const subs = new Set(rules.map((rule) => rule.sub));
  const anchorSub = subs.has('name') ? 'name' : subs.has('title') ? 'title' : subs.has('org') ? 'org' : null;
  if (/(开始|起始|入职|入学|起止|发布)/.test(text) && subs.has('start')) return 'start';
  if (/(结束|离职|毕业|离校|截止)/.test(text) && subs.has('end')) return 'end';
  // 「发表期刊 / 会议 / 刊物」属于来源信息，优先落到描述类字段，不能被「论文」二字拉去当名称
  if (/(期刊|刊物|会议|出版社|来源|载体|发表)/.test(text) && subs.has('desc')) return 'desc';
  if (/(描述|内容|职责|简介|说明)/.test(text) && subs.has('desc')) return 'desc';
  if (/(名称|主题|标题|奖项|论文|项目|组织|社团|活动|证书|语言)/.test(text) && anchorSub) return anchorSub;
  if (/(时间|日期|年月)/.test(text)) {
    if (subs.has('date')) return 'date';
    if (subs.has('start')) return 'start';
  }
  return null;
}

/** 行条目的展示名（日志用）：优先机构/名称，其次第一条非空值 */
export function rowDisplayName(entry, sectionType) {
  const name = rowValue(entry, 'org') || rowValue(entry, 'title') || rowValue(entry, 'name');
  return name || `${sectionType}#${(entry?.index ?? 0) + 1}`;
}

/**
 * 行条目稳定签名：同一条档案在一次填写里只允许落到一个块。
 * 用「分区 + 主键内容」而不是索引，防止重复添加时同一段被填两遍。
 */
export function rowSignature(sectionType, entry) {
  return [
    sectionType,
    rowValue(entry, 'org'),
    rowValue(entry, 'title'),
    rowValue(entry, 'name'),
    rowValue(entry, 'start'),
  ].join('|');
}

/** 把档案里的行式条目整理成「分区 → 条目数组」，并修掉开始晚于结束的脏数据 */
export function buildRowEntries(editable) {
  const rows = editable?.rows || {};
  const result = {};
  ROW_SECTION_TYPES.forEach((sectionType) => {
    const list = Array.isArray(rows[sectionType]) ? rows[sectionType] : [];
    result[sectionType] = list
      .filter((item) => item && Object.values(item).some((value) => String(value || '').trim()))
      .map((item, index) => {
        const fixed = { ...item };
        const start = normalizeDate(fixed.start);
        const end = normalizeDate(fixed.end);
        // 解析颠倒时自动交换，避免填出「开始 > 结束」
        if (start && end && end !== '至今' && start > end) {
          fixed.start = end;
          fixed.end = start;
        }
        return { type: sectionType, index, data: fixed };
      });
  });
  return result;
}
