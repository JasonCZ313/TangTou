/**
 * 本机轻量选项/是否判断：不跑神经网络，用档案字段与选项文案做高置信匹配。
 * 用于 tangtou-choice-v0，以及 ORT 包尚未对齐 I/O 时的静默回退。
 */
import type { FieldDescriptor } from '../types/fill';
import type { ProfileData } from '../types/profile';
import { classifyFieldBucket } from './typedQuestions';
import type { DecisionMappingHit } from './types';

/** 从档案抽出「候选答案」：标签关键词 → 取值 */
interface ProfileAnswerCandidate {
  /** 用于和字段 label 对齐的关键词（小写） */
  labelHints: string[];
  value: string;
}

/**
 * 去掉空白与常见标点，便于选项比对。
 */
function normalizeComparableText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·•\-_/\\，,。.（）()【】\[\]]+/g, '');
}

/**
 * 收集档案里适合填到选项题的短答案。
 */
function collectProfileAnswerCandidates(
  profileData: ProfileData,
): ProfileAnswerCandidate[] {
  const basic = profileData.basic ?? {};
  const jobIntent = profileData.jobIntent ?? {};
  const educationList = profileData.education ?? [];
  const firstEducation = educationList[0];

  const candidates: ProfileAnswerCandidate[] = [];
  const push = (value: string | undefined, hints: string[]) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return;
    }
    candidates.push({ value: trimmed, labelHints: hints });
  };

  push(basic.gender, ['性别', 'gender']);
  push(basic.ethnicity, ['民族']);
  push(basic.politicalStatus, ['政治面貌', '政治']);
  push(basic.maritalStatus, ['婚姻', '婚否']);
  push(basic.nationality, ['国籍']);
  push(basic.idType, ['证件类型', '证件种类']);
  push(basic.hukouType, ['户口性质', '户籍性质']);
  push(basic.currentCity, ['现居', '所在城市', '工作城市', '城市']);
  push(basic.nativePlace, ['籍贯']);
  push(basic.fertilityStatus, ['生育']);
  push(basic.healthStatus, ['健康']);
  push(jobIntent.targetRole, ['意向岗位', '应聘岗位', '职位']);
  push(jobIntent.expectedCities, ['期望城市', '意向城市']);
  push(jobIntent.workCity, ['工作城市']);
  push(jobIntent.jobType, ['工作性质', '全职', '兼职', '实习']);
  push(jobIntent.availableDate, ['到岗', '入职时间', '到岗时间']);
  push(firstEducation?.degreeLevel || firstEducation?.degree, ['学历', '学位']);
  push(firstEducation?.school, ['学校', '院校']);
  push(firstEducation?.major, ['专业']);

  return candidates;
}

/**
 * 在选项列表里找与目标文案最接近的一项；找不到返回 null。
 */
function pickBestMatchingOption(
  targetValue: string,
  options: string[],
): { option: string; confidence: number } | null {
  const targetNorm = normalizeComparableText(targetValue);
  if (!targetNorm || options.length === 0) {
    return null;
  }

  let bestOption = '';
  let bestScore = 0;
  for (const option of options) {
    const optionNorm = normalizeComparableText(option);
    if (!optionNorm) {
      continue;
    }
    let score = 0;
    if (optionNorm === targetNorm) {
      score = 1;
    } else if (
      optionNorm.includes(targetNorm) ||
      targetNorm.includes(optionNorm)
    ) {
      score = 0.88;
    } else {
      // 短公共前缀启发
      const shorter =
        optionNorm.length < targetNorm.length ? optionNorm : targetNorm;
      const longer =
        optionNorm.length < targetNorm.length ? targetNorm : optionNorm;
      let commonPrefixLength = 0;
      while (
        commonPrefixLength < shorter.length &&
        shorter[commonPrefixLength] === longer[commonPrefixLength]
      ) {
        commonPrefixLength += 1;
      }
      if (commonPrefixLength >= 2) {
        score = Math.min(0.8, commonPrefixLength / shorter.length);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  if (!bestOption || bestScore < 0.55) {
    return null;
  }
  return { option: bestOption, confidence: bestScore };
}

/**
 * 是否题：根据标签与档案推断「是/否」类选项值。
 */
function decideYesNoValue(
  field: FieldDescriptor,
  profileData: ProfileData,
): { value: string; confidence: number; reason: string } | null {
  const labelBlob = `${field.label ?? ''} ${field.name ?? ''} ${field.placeholder ?? ''}`;
  const options = field.options ?? [];
  const basic = profileData.basic ?? {};

  // 常见「是否愿意」类：有明确档案字段时用，否则不强答
  if (/政审|背景调查|背调/.test(labelBlob)) {
    const willing = profileData.industryExtras?.politicalReviewWilling?.trim();
    if (willing) {
      const matched = options.length
        ? pickBestMatchingOption(willing, options)
        : { option: willing, confidence: 0.75 };
      if (matched) {
        return {
          value: matched.option,
          confidence: matched.confidence,
          reason: '轻量匹配：政审意愿',
        };
      }
    }
  }

  if (/婚|婚姻/.test(labelBlob) && basic.maritalStatus) {
    const matched = options.length
      ? pickBestMatchingOption(basic.maritalStatus, options)
      : null;
    if (matched) {
      return {
        value: matched.option,
        confidence: matched.confidence,
        reason: '轻量匹配：婚姻状况',
      };
    }
  }

  // 无 options 的 checkbox：仅在标签明确且档案有对应「是」语义时勾选
  if ((field.type || '').toLowerCase() === 'checkbox' && options.length === 0) {
    if (/已读|同意|确认.*声明|服从调剂/.test(labelBlob)) {
      // 不替用户擅自同意法律声明——交云端或跳过
      return null;
    }
  }

  return null;
}

/**
 * 对一批 typed 字段做本机轻量判断；未命中的不进 items（交给云端）。
 */
export function decideTypedFieldsOffline(
  profileData: ProfileData,
  fields: FieldDescriptor[],
  minConfidence: number,
): { items: DecisionMappingHit[]; skippedFieldIds: string[] } {
  const candidates = collectProfileAnswerCandidates(profileData);
  const items: DecisionMappingHit[] = [];
  const skippedFieldIds: string[] = [];

  for (const field of fields) {
    const bucket = classifyFieldBucket(field);
    if (bucket === 'yesno') {
      const yesNoHit = decideYesNoValue(field, profileData);
      if (yesNoHit && yesNoHit.confidence >= minConfidence) {
        items.push({
          fieldId: field.fieldId,
          value: yesNoHit.value,
          confidence: yesNoHit.confidence,
          reason: yesNoHit.reason,
        });
      } else {
        skippedFieldIds.push(field.fieldId);
      }
      continue;
    }

    if (bucket !== 'option') {
      skippedFieldIds.push(field.fieldId);
      continue;
    }

    const options = field.options ?? [];
    if (options.length === 0) {
      skippedFieldIds.push(field.fieldId);
      continue;
    }

    const labelNorm = normalizeComparableText(
      `${field.label ?? ''} ${field.name ?? ''}`,
    );
    let bestHit: DecisionMappingHit | null = null;

    for (const candidate of candidates) {
      const hintMatched = candidate.labelHints.some((hint) =>
        labelNorm.includes(normalizeComparableText(hint)),
      );
      if (!hintMatched) {
        continue;
      }
      const matched = pickBestMatchingOption(candidate.value, options);
      if (!matched) {
        continue;
      }
      if (!bestHit || matched.confidence > bestHit.confidence) {
        bestHit = {
          fieldId: field.fieldId,
          value: matched.option,
          confidence: matched.confidence,
          reason: `轻量匹配：${candidate.labelHints[0] ?? '档案'}`,
        };
      }
    }

    if (bestHit && bestHit.confidence >= minConfidence) {
      items.push(bestHit);
    } else {
      skippedFieldIds.push(field.fieldId);
    }
  }

  return { items, skippedFieldIds };
}
