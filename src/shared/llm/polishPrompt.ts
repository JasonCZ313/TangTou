/** 问号里给用户看的润色方法，和系统提示保持同一套规则 */
export const POLISH_METHOD_TEXT =
  '最前面单独一行，用 8 到 12 个字写出这段最核心的结果。后面最多 4 句，每句是做法加结果。数字只保留原文里有的，不把「参与」改成「主导」，不写空话。篇幅最多到原文的 1.7 倍。点「确定更改」才会写回。';

/** 发给模型的系统提示。篇幅上限是原文的 1.7 倍 */
export const POLISH_SYSTEM_PROMPT = `你是中文网申简历编辑。只改写用户给出的这一段原文。不补充原文没有的事实，不搜索，不评价用户。

只输出一个 JSON 对象，不要 Markdown，不要代码围栏：
{"headline":"8到12个汉字","body":"润色正文"}

headline：
- 8 到 12 个汉字，只概括这段最硬的一个结果
- 不加标点，不加引号
- 不用「负责」「参与」「协助」「完成了」
- 不要把 headline 原句再写进 body 第一行

body：
- 简体中文，省略主语，不写「本人」「我」
- 最多 4 条，条与条之间用 \\n 分隔，每条只写一句。不要在 JSON 字符串里直接按回车
- 每条顺序：强动词 + 对象或做法 + 结果
- 强动词优先用：搭建、重构、落地、对接、拆解、上线、缩减、推动
- 原文如果只是参与或协助，不要改成「主导」或「独立负责」
- 数字、比例、时间、人数、金额必须能在原文里找到原句。原文没有，就写范围或次数，禁止新写百分比和金额
- 删掉这些空话：认真负责、吃苦耐劳、积极主动、熟悉、了解、精通、学习能力强、抗压、沟通能力好、效果显著、大幅提升
- 原文已经具体，就删重复，不要为了变长而注水
- 篇幅不超过原文的 1.7 倍，且不超过 320 个汉字。原文很短时只写清已有事实，可以只写 1 到 2 条

按用户消息里的字段名选择侧重：
- 工作职责、工作内容、项目内容、项目总述、总述：写动作、对象、做法
- 业绩、项目价值：结果放在每条前半句
- 自我评价、职业规划、其他问答：最多 3 条证据，不写性格形容词
- 优缺点：缺点后面只能接原文里已经写了的补救。原文没有补救，就少写缺点，不新编
- 为何加入、项目深挖：只整理原文里的动机和事实，不编造对公司或业务的了解

用户若给了 30 字以内的附加要求，只改变正文侧重点或篇幅。附加要求与「不编造」或 headline 规则冲突时，忽略冲突的那一部分。

body 里的换行必须写成 \\n 两个字符。不要输出检查过程、解释或第二份草稿，只输出这一个 JSON 对象。
格式示例（内容不要照抄）：
{"headline":"独立完成阀门选型","body":"搭建氮气增压控制逻辑，对接 PLC 与安全联锁。\\n按原文保留已有数字，不新增百分比。"}`;

/** 模型返回的一段润色：首行概括和正文分开，方便对照表展示 */
export interface PolishedPassage {
  headline: string;
  body: string;
}

/**
 * 拼成写回输入框的全文：概括单独一行，后面是正文。
 */
export function composePolishedPassage(passage: PolishedPassage): string {
  const headline = passage.headline.trim();
  const body = passage.body.trim();
  if (!headline) {
    return body;
  }
  if (!body) {
    return headline;
  }
  return `${headline}\n${body}`;
}

/**
 * 组装用户消息。没有附加要求时写「无」，避免模型自己发明要求。
 */
export function buildPolishUserMessage(
  fieldName: string,
  sourceText: string,
  customRequirement: string,
): string {
  const requirementText = customRequirement.trim() || '无';
  return `字段名：${fieldName}\n附加要求：${requirementText}\n原文：\n${sourceText.trim()}`;
}

/**
 * 去掉概括里的标点和空白，超过 12 个字就截断。不够 8 个字也保留，避免整段作废。
 */
function normalizeHeadline(rawHeadline: string): string {
  const withoutPunctuation = rawHeadline
    .replace(/[，。！？、；：,.!?;:""''「」【】（）()[\]…—\-]/g, '')
    .replace(/\s+/g, '');
  const characters = [...withoutPunctuation];
  if (characters.length <= 12) {
    return characters.join('');
  }
  return characters.slice(0, 12).join('');
}

/**
 * 把正文里的转义换行变成真换行，并去掉和概括重复的第一行。
 */
function normalizeBody(rawBody: string, headline: string): string {
  const withBreaks = rawBody.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  const lines = withBreaks.split('\n');
  const firstLine = lines[0]?.replace(/\s+/g, '') ?? '';
  if (headline && firstLine === headline) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

/**
 * 在一段可能损坏的 JSON 里，按键名读出字符串。字符串中间的裸换行也收进来。
 */
function readJsonStringField(sourceText: string, fieldName: string): string | null {
  const keyIndex = sourceText.indexOf(`"${fieldName}"`);
  if (keyIndex < 0) {
    return null;
  }
  const colonIndex = sourceText.indexOf(':', keyIndex + fieldName.length + 2);
  if (colonIndex < 0) {
    return null;
  }
  let cursor = colonIndex + 1;
  while (cursor < sourceText.length && /\s/.test(sourceText[cursor] ?? '')) {
    cursor += 1;
  }
  if (sourceText[cursor] !== '"') {
    return null;
  }
  cursor += 1;
  let fieldValue = '';
  let escaped = false;
  for (; cursor < sourceText.length; cursor += 1) {
    const currentChar = sourceText[cursor] ?? '';
    if (escaped) {
      if (currentChar === 'n') {
        fieldValue += '\n';
      } else if (currentChar === 'r') {
        fieldValue += '';
      } else {
        fieldValue += currentChar;
      }
      escaped = false;
      continue;
    }
    if (currentChar === '\\') {
      escaped = true;
      continue;
    }
    if (currentChar === '"') {
      return fieldValue;
    }
    if (currentChar === '\n' || currentChar === '\r') {
      fieldValue += '\n';
      continue;
    }
    fieldValue += currentChar;
  }
  return fieldValue.trim() ? fieldValue : null;
}

/**
 * 把 JSON 字符串内部的裸换行和对象末尾多余逗号修掉，方便 JSON.parse。
 */
function relaxJsonText(jsonText: string): string {
  const withoutTrailingComma = jsonText.replace(/,\s*([}\]])/g, '$1');
  let inString = false;
  let escaped = false;
  let relaxed = '';
  for (const currentChar of withoutTrailingComma) {
    if (inString) {
      if (escaped) {
        relaxed += currentChar;
        escaped = false;
        continue;
      }
      if (currentChar === '\\') {
        relaxed += currentChar;
        escaped = true;
        continue;
      }
      if (currentChar === '"') {
        inString = false;
        relaxed += currentChar;
        continue;
      }
      if (currentChar === '\n') {
        relaxed += '\\n';
        continue;
      }
      if (currentChar === '\r') {
        continue;
      }
      relaxed += currentChar;
      continue;
    }
    if (currentChar === '"') {
      inString = true;
    }
    relaxed += currentChar;
  }
  return relaxed;
}

/**
 * 没有 JSON 时，把第一行当概括，其余当正文。
 */
function passageFromPlainText(rawContent: string): PolishedPassage {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'));
  if (lines.length === 0) {
    return { headline: '', body: '' };
  }
  const firstLine = lines[0] ?? '';
  const firstLength = [...firstLine].length;
  if (firstLength >= 6 && firstLength <= 24 && !firstLine.includes('{')) {
    return {
      headline: firstLine,
      body: lines.slice(1).join('\n'),
    };
  }
  return { headline: '', body: lines.join('\n') };
}

/**
 * 从模型原文里抽出概括和正文。JSON 坏了也尽量修好，不再为此重叫模型。
 */
export function parsePolishedPassage(rawContent: string): PolishedPassage {
  const stripped = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  const jsonText =
    objectStart >= 0 && objectEnd > objectStart
      ? stripped.slice(objectStart, objectEnd + 1)
      : '';

  let headline = '';
  let body = '';
  if (jsonText) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      try {
        parsed = JSON.parse(relaxJsonText(jsonText));
      } catch {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      headline = typeof record.headline === 'string' ? record.headline.trim() : '';
      body = typeof record.body === 'string' ? record.body.trim() : '';
    }
    if (!headline && !body) {
      headline = readJsonStringField(jsonText, 'headline')?.trim() ?? '';
      body = readJsonStringField(jsonText, 'body')?.trim() ?? '';
    }
  }
  if (!headline && !body) {
    const plainPassage = passageFromPlainText(stripped);
    headline = plainPassage.headline;
    body = plainPassage.body;
  }

  const normalizedHeadline = normalizeHeadline(headline);
  const normalizedBody = normalizeBody(body, normalizedHeadline);
  const combinedText = `${normalizedHeadline}${normalizedBody}`;
  const combinedLength = [...combinedText].length;
  const refusalOnly =
    combinedLength < 30 && /抱歉|无法处理|请再试|对不起/.test(combinedText);
  if (combinedLength < 8 || refusalOnly) {
    throw new Error('模型没有返回能用的润色结果。请再试一次。');
  }
  return { headline: normalizedHeadline, body: normalizedBody };
}
