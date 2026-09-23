import type { FieldDescriptor, FillPlan } from '../types/fill';
import type { ProfileData } from '../types/profile';

/** 启发式匹配结果：档案取值路径对应的填写值与原因文案 */
interface HeuristicMatch {
  /** 写入表单的值 */
  value: string;
  /** 映射依据说明（供预览展示） */
  reason: string;
}

/**
 * 将 label / name 拼成便于匹配的小写文本（去空白）。
 * 仅用于本地规则，不改变原始字段描述。
 */
function buildMatchCorpus(field: FieldDescriptor): string {
  const labelText = field.label ?? '';
  const nameText = field.name ?? '';
  return `${labelText} ${nameText}`.toLowerCase().replace(/\s+/g, '');
}

/**
 * 判断语料是否命中任一关键词（中英子串）。
 */
function corpusIncludesAny(
  corpus: string,
  keywords: readonly string[],
): boolean {
  return keywords.some((keyword) => corpus.includes(keyword.toLowerCase()));
}

/**
 * 按高置信规则把单个字段映射到档案 basic 字段。
 * 匹配顺序：邮箱 → 手机/电话 → 姓名 → 城市，避免泛化词抢先。
 * 档案对应值为空时返回 null，留给后续 LLM 或跳过。
 */
function matchFieldToProfile(
  field: FieldDescriptor,
  profile: ProfileData,
): HeuristicMatch | null {
  const corpus = buildMatchCorpus(field);
  const { basic } = profile;

  if (
    corpusIncludesAny(corpus, [
      '邮箱',
      '电子邮箱',
      '邮件',
      'email',
      'e-mail',
      'mail',
    ])
  ) {
    const emailValue = basic.email.trim();
    if (emailValue) {
      return { value: emailValue, reason: '本地启发式：邮箱' };
    }
    return null;
  }

  if (
    corpusIncludesAny(corpus, [
      '手机',
      '电话',
      '手机号',
      '联系电话',
      'phone',
      'mobile',
      'tel',
    ])
  ) {
    const phoneValue = basic.phone.trim();
    if (phoneValue) {
      return { value: phoneValue, reason: '本地启发式：手机/电话' };
    }
    return null;
  }

  if (
    corpusIncludesAny(corpus, [
      '姓名',
      '名字',
      '全名',
      'fullname',
      'full_name',
      'yourname',
      'name',
    ])
  ) {
    // 排除已被邮箱/电话规则覆盖的字段；此处再排除明显非姓名的 name 变体
    if (
      corpusIncludesAny(corpus, [
        'username',
        'company',
        'school',
        'file',
        'user',
      ])
    ) {
      return null;
    }
    const fullNameValue = basic.fullName.trim();
    if (fullNameValue) {
      return { value: fullNameValue, reason: '本地启发式：姓名' };
    }
    return null;
  }

  if (corpusIncludesAny(corpus, ['城市', '所在城市', 'city'])) {
    const cityValue = basic.city.trim();
    if (cityValue) {
      return { value: cityValue, reason: '本地启发式：城市' };
    }
    return null;
  }

  return null;
}

/**
 * 对扫描字段做本地高置信预填：邮箱/电话/姓名/城市直接映射档案，
 * 未命中或档案值为空的字段放入 remainingFields 交给 LLM。
 * partialPlan.skippedFieldIds 恒为空，跳过列表仅由 LLM 产出后再合并。
 */
export function applyLocalHeuristics(
  profile: ProfileData,
  fields: FieldDescriptor[],
): { partialPlan: FillPlan; remainingFields: FieldDescriptor[] } {
  const matchedItems: FillPlan['items'] = [];
  const remainingFields: FieldDescriptor[] = [];

  for (const field of fields) {
    const matched = matchFieldToProfile(field, profile);
    if (matched) {
      matchedItems.push({
        fieldId: field.fieldId,
        value: matched.value,
        confidence: 0.95,
        reason: matched.reason,
      });
    } else {
      remainingFields.push(field);
    }
  }

  return {
    partialPlan: {
      items: matchedItems,
      skippedFieldIds: [],
    },
    remainingFields,
  };
}
