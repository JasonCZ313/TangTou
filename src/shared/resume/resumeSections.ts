/** 从简历原文按标题补证书、奖项和自我评价。模型漏掉时才填，不覆盖已有内容。 */

interface HarvestedName {
  name: string;
  level: string;
}

interface HarvestedSections {
  certificates: HarvestedName[];
  awards: HarvestedName[];
  selfEvaluation: string;
}

/** 行首标题。括号里的后半段是同一行写上的条目 */
const INLINE_HEADING =
  /^(证书|资格证书|专业证书|技能证书|获奖情况|获奖|奖项荣誉|奖项|荣誉奖项|荣誉|我的价值|个人优势|自我评价|个人介绍)\s*[:：]\s*(.*)$/;

/** 单独成行的标题，正文在后面几行 */
const SOLO_HEADING =
  /^(证书|资格证书|专业证书|技能证书|获奖情况|获奖|奖项荣誉|奖项|荣誉奖项|荣誉|我的价值|个人优势|自我评价|个人介绍)$/;

/** 遇到这些行就结束上一段，避免把教育、技能吞进自我评价 */
const OTHER_SECTION =
  /^(基本信息|教育背景|教育经历|实习经历|工作经历|项目经历|项目经验|核心技能|专业技能|技能特长|校园经历|培训经历|自我评价|个人优势|我的价值|个人介绍|证书|资格证书|获奖|奖项|荣誉)/;

const AWARD_LEVEL = /(特等奖|一等奖|二等奖|三等奖|金奖|银奖|铜奖|优秀奖)$/;

/**
 * 把同一行里用大空白或竖线分开的条目拆开。
 */
function splitInlineItems(rawLine: string): string[] {
  const byGap = rawLine
    .split(/\s{2,}|\t|[|｜]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (byGap.length > 1) {
    return byGap;
  }
  const byDot = rawLine
    .split(/[·•]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
  return byDot.length > 0 ? byDot : byGap;
}

/**
 * 奖项若以「一等奖」这类结尾，拆成名称和等第。
 */
function toNamedItem(rawItem: string): HarvestedName {
  const matchedLevel = rawItem.match(AWARD_LEVEL);
  if (!matchedLevel) {
    return { name: rawItem, level: '' };
  }
  const name = rawItem.slice(0, matchedLevel.index).trim();
  return {
    name: name || rawItem,
    level: matchedLevel[1],
  };
}

/**
 * 判断这一行标题属于证书、奖项还是自我评价。
 */
function sectionKind(heading: string): 'certificate' | 'award' | 'evaluation' | null {
  if (/证书/.test(heading) && !/获奖|奖项|荣誉/.test(heading)) {
    return 'certificate';
  }
  if (/获奖|奖项|荣誉/.test(heading)) {
    return 'award';
  }
  if (/我的价值|个人优势|自我评价|个人介绍/.test(heading)) {
    return 'evaluation';
  }
  return null;
}

/**
 * 按简历里的标题收集证书、奖项和自我评价原文。
 */
export function harvestResumeSections(resumeText: string): HarvestedSections {
  const lines = resumeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const certificates: HarvestedName[] = [];
  const awards: HarvestedName[] = [];
  const evaluationLines: string[] = [];
  let readingEvaluation = false;

  for (const line of lines) {
    const inlineHeading = line.match(INLINE_HEADING);
    const soloHeading = line.match(SOLO_HEADING);
    const heading = inlineHeading?.[1] ?? soloHeading?.[1] ?? '';
    const kind = heading ? sectionKind(heading) : null;

    if (kind === 'certificate' || kind === 'award') {
      readingEvaluation = false;
      const inlineRest = inlineHeading?.[2]?.trim() ?? '';
      const items = inlineRest ? splitInlineItems(inlineRest) : [];
      const bucket = kind === 'certificate' ? certificates : awards;
      for (const item of items) {
        bucket.push(toNamedItem(item));
      }
      continue;
    }

    if (kind === 'evaluation') {
      readingEvaluation = true;
      const inlineRest = inlineHeading?.[2]?.trim() ?? '';
      if (inlineRest) {
        evaluationLines.push(inlineRest);
      }
      continue;
    }

    if (readingEvaluation && OTHER_SECTION.test(line)) {
      readingEvaluation = false;
    }
    if (readingEvaluation) {
      evaluationLines.push(line);
    }
  }

  return {
    certificates,
    awards,
    selfEvaluation: evaluationLines.join('\n').trim(),
  };
}

/**
 * 列表里至少有一条写了名称，才算模型已经识别到。
 */
function namedListHasContent(list: unknown): boolean {
  if (!Array.isArray(list)) {
    return false;
  }
  return list.some((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const name = (item as { name?: unknown }).name;
    return typeof name === 'string' && name.trim().length > 0;
  });
}

/**
 * 只在识别结果相应位置还空着时，把标题下的原文补进去。
 */
export function overlayResumeSections(rawPatch: unknown, resumeText: string): unknown {
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    return rawPatch;
  }
  const patch = { ...(rawPatch as Record<string, unknown>) };
  const harvested = harvestResumeSections(resumeText);

  if (!namedListHasContent(patch.certificates) && harvested.certificates.length > 0) {
    patch.certificates = harvested.certificates.map((item) => ({
      name: item.name,
      level: item.level,
    }));
  }

  if (!namedListHasContent(patch.awards) && harvested.awards.length > 0) {
    patch.awards = harvested.awards.map((item) => ({
      name: item.name,
      level: item.level,
    }));
  }

  const essays =
    patch.essays && typeof patch.essays === 'object' && !Array.isArray(patch.essays)
      ? { ...(patch.essays as Record<string, unknown>) }
      : {};
  const currentEvaluation =
    typeof essays.selfEvaluation === 'string' ? essays.selfEvaluation.trim() : '';
  if (!currentEvaluation && harvested.selfEvaluation) {
    essays.selfEvaluation = harvested.selfEvaluation;
    patch.essays = essays;
  }

  return patch;
}
