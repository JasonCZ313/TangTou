import { AWARD_PRIZE_OPTIONS, labelOfCatalog } from '../catalogs/enums';
import type { FieldDescriptor, FillPlan } from '../types/fill';
import type { ProfileData } from '../types/profile';
import type { AttachmentKind, AttachmentMeta } from '../types/attachment';
import { attachmentKindLabel } from '../types/attachment';
import {
  notesForFieldIds,
  SKIP_REASON_NO_FILE,
} from '../fill/skipReasons';

/** 启发式匹配结果：档案取值路径对应的填写值与原因文案 */
interface HeuristicMatch {
  /** 写入表单的值 */
  value: string;
  /** 映射依据说明（供预览展示） */
  reason: string;
}

/**
 * 拼接 label / name 为原始匹配文本（保留分隔符，便于英文词界判断）。
 */
function buildMatchText(field: FieldDescriptor): string {
  const labelText = field.label ?? '';
  const nameText = field.name ?? '';
  return `${labelText} ${nameText}`.trim();
}

/**
 * 英文词界匹配：token 前后须为非小写字母，避免 hotel 误命中 tel 等子串。
 */
function matchesEnglishToken(normalizedLowerText: string, token: string): boolean {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundaryPattern = new RegExp(`(^|[^a-z])${escapedToken}([^a-z]|$)`);
  return boundaryPattern.test(normalizedLowerText);
}

/**
 * 正则词界匹配（用于 e-mail、full name 等复合英文标签）。
 */
function matchesEnglishPattern(
  normalizedLowerText: string,
  pattern: RegExp,
): boolean {
  return pattern.test(normalizedLowerText);
}

/**
 * 中文标签子串匹配（中文无字母黏连误报问题）。
 */
function includesAnyChineseKeyword(
  rawText: string,
  keywords: readonly string[],
): boolean {
  return keywords.some((keyword) => rawText.includes(keyword));
}

/** 判断语料是否命中邮箱类字段（中文 + email/e-mail 词界）。 */
function corpusMatchesEmail(rawText: string, normalizedLowerText: string): boolean {
  if (includesAnyChineseKeyword(rawText, ['邮箱'])) {
    return true;
  }
  return (
    matchesEnglishToken(normalizedLowerText, 'email') ||
    matchesEnglishPattern(normalizedLowerText, /(^|[^a-z])e-?mail([^a-z]|$)/)
  );
}

/** 判断语料是否命中手机/电话类字段（中文 + phone/mobile/tel 词界）。 */
function corpusMatchesPhone(rawText: string, normalizedLowerText: string): boolean {
  if (includesAnyChineseKeyword(rawText, ['手机', '电话'])) {
    return true;
  }
  return (
    matchesEnglishToken(normalizedLowerText, 'phone') ||
    matchesEnglishToken(normalizedLowerText, 'mobile') ||
    matchesEnglishToken(normalizedLowerText, 'tel')
  );
}

/** 判断语料是否命中姓名字段（中文 + full name 英文变体，不用裸 name）。 */
function corpusMatchesFullName(rawText: string, normalizedLowerText: string): boolean {
  if (includesAnyChineseKeyword(rawText, ['姓名', '名字'])) {
    return true;
  }
  return matchesEnglishPattern(
    normalizedLowerText,
    /(^|[^a-z])full[_\s.-]?name([^a-z]|$)/,
  );
}

/** 判断语料是否命中城市字段（中文 + city 词界）。 */
function corpusMatchesCity(rawText: string, normalizedLowerText: string): boolean {
  if (includesAnyChineseKeyword(rawText, ['城市'])) {
    return true;
  }
  return matchesEnglishToken(normalizedLowerText, 'city');
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
  const rawText = buildMatchText(field);
  const normalizedLowerText = rawText.toLowerCase();
  const { basic } = profile;

  if (corpusMatchesEmail(rawText, normalizedLowerText)) {
    const emailValue = basic.email.trim();
    if (emailValue) {
      return { value: emailValue, reason: '本地启发式：邮箱' };
    }
    return null;
  }

  if (corpusMatchesPhone(rawText, normalizedLowerText)) {
    const phoneValue = basic.phone.trim();
    if (phoneValue) {
      return { value: phoneValue, reason: '本地启发式：手机/电话' };
    }
    return null;
  }

  if (corpusMatchesFullName(rawText, normalizedLowerText)) {
    const fullNameValue = basic.fullName.trim();
    if (fullNameValue) {
      return { value: fullNameValue, reason: '本地启发式：姓名' };
    }
    return null;
  }

  if (corpusMatchesCity(rawText, normalizedLowerText)) {
    const cityValue = (basic.currentCity || basic.city || '').trim();
    if (cityValue) {
      return { value: cityValue, reason: '本地启发式：城市' };
    }
    return null;
  }

  if (/自我评价|个人优势|我的价值|个人介绍|个人评价/.test(rawText)) {
    const evaluation = profile.essays?.selfEvaluation?.trim() ?? '';
    if (evaluation) {
      return { value: evaluation, reason: '本地启发式：自我评价' };
    }
    return null;
  }

  if (/获奖|奖项|所获荣誉|荣誉奖/.test(rawText) && !/附件|上传|证明/.test(rawText)) {
    const awardLines = profile.awards
      .map((item) =>
        [item.name, labelOfCatalog(AWARD_PRIZE_OPTIONS, item.prizeRank ?? ''), item.level]
          .filter(Boolean)
          .join(' ')
          .trim(),
      )
      .filter((line) => line.length > 0);
    if (awardLines.length === 0) {
      return null;
    }
    const awardValue =
      field.tag === 'textarea' || awardLines.length === 1
        ? awardLines.join('\n')
        : '';
    if (awardValue) {
      return { value: awardValue, reason: '本地启发式：奖项' };
    }
    return null;
  }

  if (/证书|资格证/.test(rawText) && !/附件|上传|证明|编号/.test(rawText)) {
    const certificateNames = profile.certificates
      .map((item) => item.name.trim())
      .filter((name) => name.length > 0);
    if (certificateNames.length === 0) {
      return null;
    }
    const certificateValue =
      field.tag === 'textarea' || certificateNames.length === 1
        ? certificateNames.join('\n')
        : '';
    if (certificateValue) {
      return { value: certificateValue, reason: '本地启发式：证书' };
    }
    return null;
  }

  return null;
}

/**
 * 文件框按标签匹配本机附件种类。
 */
function detectAttachmentKind(matchText: string): AttachmentKind | null {
  if (/头像|证件照|照片|photo|avatar|portrait/.test(matchText)) {
    return 'avatar';
  }
  if (/简历|resume|\bcv\b/.test(matchText)) {
    return 'resume';
  }
  if (/实习证明|在职证明|离职证明/.test(matchText)) {
    return 'internship';
  }
  if (/奖状|获奖|荣誉/.test(matchText)) {
    return 'award';
  }
  if (/证书|资格证|证明/.test(matchText)) {
    return 'certificate';
  }
  if (/项目材料|项目文件|项目附件|作品/.test(matchText)) {
    return 'project';
  }
  return null;
}

/**
 * 为 file 字段挑选一份附件；标签对不上则返回 null。
 */
function matchFileField(
  field: FieldDescriptor,
  attachments: AttachmentMeta[],
): FillPlan['items'][number] | null {
  const kind = detectAttachmentKind(buildMatchText(field).toLowerCase());
  if (!kind) {
    return null;
  }
  const matchedAttachment = attachments.find((item) => item.kind === kind);
  if (!matchedAttachment) {
    return null;
  }
  return {
    fieldId: field.fieldId,
    value: matchedAttachment.fileName,
    attachmentId: matchedAttachment.id,
    confidence: 0.92,
    reason: `本地附件：${attachmentKindLabel(kind)}`,
  };
}

/**
 * 对扫描字段做本地高置信预填：邮箱/电话/姓名/城市，以及文件框附件。
 * 文件框不交给 LLM。未匹配的文件框记入 skippedFieldIds。
 */
export function applyLocalHeuristics(
  profile: ProfileData,
  fields: FieldDescriptor[],
  attachments: AttachmentMeta[] = [],
): { partialPlan: FillPlan; remainingFields: FieldDescriptor[] } {
  const matchedItems: FillPlan['items'] = [];
  const remainingFields: FieldDescriptor[] = [];
  const skippedFieldIds: string[] = [];

  for (const field of fields) {
    if (field.type === 'file') {
      const fileMatch = matchFileField(field, attachments);
      if (fileMatch) {
        matchedItems.push(fileMatch);
      } else {
        skippedFieldIds.push(field.fieldId);
      }
      continue;
    }
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
      skippedFieldIds,
      skippedNotes: notesForFieldIds(skippedFieldIds, SKIP_REASON_NO_FILE),
    },
    remainingFields,
  };
}
