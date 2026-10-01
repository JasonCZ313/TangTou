/**
 * 站点适配器类型：按 host 提供选择器与添加/保存文案，增强扫描与补行。
 * 写入仍只按 FillPlan，适配器不直接填值。
 */
export interface SiteAdapter {
  /** 稳定 id，如 beisen */
  id: string;
  /** 展示名 */
  name: string;
  /** 匹配 location.hostname */
  urlPattern: RegExp;
  /** 分区标题选择器（逗号分隔） */
  sectionSelector: string;
  /** 「添加」类按钮允许的文案关键词 */
  addLabels: string[];
  /** 禁止点击的危险文案（保存/提交等） */
  saveLabels: string[];
  /** 编辑类按钮文案 */
  editLabels: string[];
}

/**
 * 强提交/投递短语（探测与执行共用）：命中即危险，不受短文案长度门禁限制。
 * 覆盖自然语言长按钮如「…再点击提交」。
 */
export const STRONG_SUBMIT_PHRASE_RE =
  /投递|提交申请|立即申请|最终提交|确认投递|保存并提交|立即投递|立即提交|确认提交|点击提交|再点击提交|一键投递|一键提交/;

/**
 * 强动作词：长文案若以此结尾，仍视为提交类按钮（避免 length>24 整段放行）。
 */
const STRONG_ACTION_SUFFIXES = ['提交', '保存', '投递', '确定', '下一步', '完成'] as const;

/**
 * 是否命中强提交短语或不限长度的强后缀动作。
 */
export function matchesStrongSubmitIntent(rawText: string): boolean {
  const compact = rawText.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }
  if (STRONG_SUBMIT_PHRASE_RE.test(compact)) {
    return true;
  }
  // 长说明中间夹「确定」不拦；仅「以强动作词结尾」才拦（如 …再点击提交）
  return STRONG_ACTION_SUFFIXES.some((suffix) => compact.endsWith(suffix));
}

/**
 * P5/N1：判断压缩后的按钮文案是否命中某一危险标签。
 * - 先允许强后缀（含长文案以「提交」结尾）
 * - 短文案：全等 / 开头 / 结尾 / 近邻 includes
 * - 长文案且非强后缀：不当按钮（避免「我已确定上述…」类误杀；该类不以提交结尾）
 */
export function textMatchesDangerSaveLabel(
  compactText: string,
  dangerLabel: string,
): boolean {
  const compact = compactText.replace(/\s+/g, '');
  const label = dangerLabel.replace(/\s+/g, '');
  if (!compact || !label) {
    return false;
  }
  if (compact === label) {
    return true;
  }
  // 不限长度：以本标签结尾（「…点击提交」「请确定」）
  if (compact.endsWith(label)) {
    return true;
  }
  // 长文案：除 endsWith 外不再做 startsWith/includes，减少说明文误杀
  if (compact.length > 24) {
    return false;
  }
  if (compact.startsWith(label)) {
    return true;
  }
  // 短复合按钮：如「立即保存」(4)、「确认提交」(4)
  if (compact.includes(label) && compact.length <= label.length + 4) {
    return true;
  }
  return false;
}

/**
 * 判断按钮文案是否命中适配器的添加白名单。
 */
export function adapterAllowsAddLabel(
  adapter: SiteAdapter | null,
  rawText: string,
): boolean {
  const compact = rawText.replace(/\s+/g, '');
  if (!compact || compact.length > 20) {
    return false;
  }
  if (adapter) {
    for (const saveLabel of adapter.saveLabels) {
      if (textMatchesDangerSaveLabel(compact, saveLabel)) {
        return false;
      }
    }
    for (const addLabel of adapter.addLabels) {
      if (compact.includes(addLabel)) {
        return true;
      }
    }
  }
  return /^[+＋]?(添加|新增|增加)/.test(compact);
}

/**
 * 判断是否为危险「保存/提交」类文案（有适配器用其黑名单，否则用通用词）。
 * N1：叠加强短语；长文案仅 endsWith 标签或强意图才拦。
 */
export function adapterIsDangerSaveLabel(
  adapter: SiteAdapter | null,
  rawText: string,
): boolean {
  const compact = rawText.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }
  if (matchesStrongSubmitIntent(compact)) {
    return true;
  }
  const labels = adapter?.saveLabels ?? ['保存', '提交', '确定', '下一步', '完成'];
  return labels.some((label) => textMatchesDangerSaveLabel(compact, label));
}
