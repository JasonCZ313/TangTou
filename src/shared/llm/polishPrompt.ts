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
- 最多 4 条，条与条之间用换行，每条只写一句
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

输出前自行检查，不通过就重写后再输出：
1. headline 是 8 到 12 个汉字，且没有标点
2. body 里每一个数字都能在原文中找到
3. 没有把「负责」「参与」当成唯一动词，也没有把参与升成主导
4. body 不超过原文的 1.7 倍
5. 输出只有这一个 JSON`;

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
 * 从模型原文里抽出 JSON。兼容外面套了一层代码围栏的返回。
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
      : stripped;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型没有返回能用的润色结果。请再试一次。');
  }
  const record = parsed as Record<string, unknown>;
  const headline = typeof record.headline === 'string' ? record.headline.trim() : '';
  const body = typeof record.body === 'string' ? record.body.trim() : '';
  if (!headline && !body) {
    throw new Error('模型没有返回能用的润色结果。请再试一次。');
  }
  return { headline, body };
}
