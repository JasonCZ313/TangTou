/**
 * 字段「角色名」清洗：禁止把占位文案（请输入/请选择）当成学校/单位等语义标签。
 * 扫描打标与写入再绑共用，避免出现「教育经历第1行请输入」导致档案被误判为空。
 */

/** 绝不能当作角色名的占位/提示词 */
const JUNK_ROLE_PATTERN =
  /^(请选择|请填写|请输入|请勾选|请选|选择|暂无|暂无选项|未选择|未填写|尚未填写|输入|填写|内容)$/;

/**
 * 是否为垃圾角色文案（占位、空、过短）。
 */
export function isJunkRoleText(rawText: string): boolean {
  const text = String(rawText || '')
    .replace(/\s+/g, '')
    .replace(/^[*＊]+/, '')
    .replace(/[:：]+$/g, '');
  if (!text || text.length < 2) {
    return true;
  }
  if (JUNK_ROLE_PATTERN.test(text)) {
    return true;
  }
  if (/^(请选择|请填写|请输入)/.test(text) && text.length <= 6) {
    return true;
  }
  return false;
}

/**
 * 从候选文案里挑第一个可用角色名；都不可用则返回空串。
 */
export function pickUsableRoleText(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const cleaned = String(candidate || '')
      .replace(/\s+/g, '')
      .replace(/^[*＊]+/, '')
      .replace(/[:：]+$/g, '')
      // 去掉行前缀，只留角色段
      .replace(/^.*?第\d+行/, '');
    if (!isJunkRoleText(cleaned)) {
      return cleaned;
    }
  }
  return '';
}

/**
 * 页面标题与档案字段名可以不同：用角色归并后再绑（姓名=名字）。
 * 不含公司/学校/证书等「名称」，避免把单位名称当成姓名。
 */
export function canonicalFieldRole(rawLabel: string): string {
  const text = String(rawLabel || '')
    .replace(/\s+/g, '')
    .replace(/^.*?第\d+行/, '');
  if (/姓名|名字/.test(text) && !/学校|单位|公司|证书|项目|奖|组织|证件/.test(text)) {
    return '姓名';
  }
  if (/证件号码|证件号|身份证号/.test(text) && !/类型/.test(text)) {
    return '证件号码';
  }
  if (/证件类型/.test(text)) {
    return '证件类型';
  }
  if (/国籍|国家/.test(text) && !/现居|籍贯|户籍/.test(text)) {
    return '国籍';
  }
  if (/籍贯/.test(text)) {
    return '籍贯';
  }
  if (/现居住地|现居地|居住地|现居/.test(text) && !/省$|市$/.test(text)) {
    return '现居住地';
  }
  if (/专业排名|成绩排名|排名/.test(text)) {
    return '专业排名';
  }
  if (/学历类型|办学类型|学习形式/.test(text)) {
    return '学历类型';
  }
  if (/实习内容|实践描述|证书描述|获奖描述|工作内容/.test(text) || (/描述|内容/.test(text) && !/名称/.test(text))) {
    return '描述';
  }
  return text;
}

/**
 * 标签是否表示给定角色（含同义词）。
 */
export function labelHasRole(rawLabel: string, roleName: string): boolean {
  return canonicalFieldRole(rawLabel) === roleName
    || String(rawLabel || '').includes(roleName);
}

/**
 * 按控件形态猜一个兜底角色（仍可能被上层覆盖）。
 */
export function guessRoleByControlHint(options: {
  isTextArea?: boolean;
  isDateLike?: boolean;
  isDateEnd?: boolean;
}): string {
  if (options.isTextArea) {
    return '描述';
  }
  if (options.isDateEnd) {
    return '结束时间';
  }
  if (options.isDateLike) {
    return '开始时间';
  }
  return '';
}
