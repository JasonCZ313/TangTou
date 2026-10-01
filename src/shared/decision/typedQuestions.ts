/**
 * 把扫描字段分成「适合 Laya 三原语」与「自由文本映射」两类。
 * P2a：本机只应接手选项/是否；长文本继续走云端 batch_map。
 */
import type { FieldDescriptor } from '../types/fill';

/** 字段在决策层的题型桶 */
export type DecisionFieldBucket = 'option' | 'yesno' | 'text';

/**
 * 根据控件类型、options、标签文案判定题型桶。
 */
export function classifyFieldBucket(field: FieldDescriptor): DecisionFieldBucket {
  const labelBlob = `${field.label ?? ''} ${field.name ?? ''} ${field.placeholder ?? ''}`;
  const options = field.options ?? [];

  if (options.length > 0) {
    return 'option';
  }

  const controlType = (field.type || '').toLowerCase();
  if (controlType === 'checkbox' || controlType === 'radio') {
    if (/是否|同意|已读|确认|声明|愿意|服从/.test(labelBlob)) {
      return 'yesno';
    }
    // 无 options 的 radio/checkbox 仍可能是是否题
    if (controlType === 'checkbox') {
      return 'yesno';
    }
  }

  return 'text';
}

/**
 * 将剩余字段拆成：typed（供本机 Laya）与 text（供云端 batch）。
 */
export function splitFieldsByDecisionBucket(fields: FieldDescriptor[]): {
  typedFields: FieldDescriptor[];
  textFields: FieldDescriptor[];
} {
  const typedFields: FieldDescriptor[] = [];
  const textFields: FieldDescriptor[] = [];
  for (const field of fields) {
    const bucket = classifyFieldBucket(field);
    if (bucket === 'option' || bucket === 'yesno') {
      typedFields.push(field);
    } else {
      textFields.push(field);
    }
  }
  return { typedFields, textFields };
}

/**
 * 构造给本机 Laya 的短 state（档案摘要），避免塞整份 Profile JSON。
 */
export function buildLayaStateSummary(profileData: {
  basic?: { fullName?: string; phone?: string; email?: string; currentCity?: string };
  jobIntent?: { targetRole?: string };
}): Record<string, string> {
  return {
    fullName: profileData.basic?.fullName?.trim() || '',
    phone: profileData.basic?.phone?.trim() || '',
    email: profileData.basic?.email?.trim() || '',
    currentCity: profileData.basic?.currentCity?.trim() || '',
    targetRole: profileData.jobIntent?.targetRole?.trim() || '',
  };
}
