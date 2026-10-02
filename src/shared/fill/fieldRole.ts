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
