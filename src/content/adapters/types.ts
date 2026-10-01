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
      if (compact.includes(saveLabel)) {
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
 */
export function adapterIsDangerSaveLabel(
  adapter: SiteAdapter | null,
  rawText: string,
): boolean {
  const compact = rawText.replace(/\s+/g, '');
  const labels = adapter?.saveLabels ?? ['保存', '提交', '确定', '下一步', '完成'];
  return labels.some((label) => compact === label || compact.includes(label));
}
