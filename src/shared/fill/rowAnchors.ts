/**
 * 多行分区「切行 / 打行号」共用的锚点词表。
 * 只用「一块卡片一个」的主键字段；不要把「职位名称」放进来，
 * 否则同一块里「单位名称 + 职位名称」会被误切成两行。
 */

/** 用于 RegExp.test 的行锚点源串（无首尾斜杠） */
export const ROW_NAME_ANCHOR_SOURCE =
  '单位名称|公司名称|企业名称|实习单位|工作单位|'
  + '项目名称|学校名称|院校名称|'
  + '证书名称|资格证书|'
  + '奖项名称|荣誉名称|获奖项|获奖名称|'
  + '组织名称|社团名称|活动名称|'
  + '论文名称|专著名称|论文标题|技能描述';

/** 预编译：判断标签/占位是否为「新行主键」 */
export const ROW_NAME_ANCHOR_PATTERN = new RegExp(ROW_NAME_ANCHOR_SOURCE);

/**
 * 文案里是否含行锚点（切行、找空卡共用）。
 */
export function textHasRowNameAnchor(rawText: string): boolean {
  return ROW_NAME_ANCHOR_PATTERN.test(String(rawText || ''));
}
