/**
 * 按卡片填写：第 i 张卡只对档案第 i 条。
 * 用「删除」或重复标题切卡，用左边标题认格，不再依赖「第N行」这串字还在不在。
 */
import type { FillMiss } from '../../shared/types/fill';
import type {
  AwardItem,
  CertificateItem,
  EducationItem,
  ExperienceItem,
  ProfileData,
} from '../../shared/types/profile';
import {
  AWARD_LEVEL_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  GENDER_OPTIONS,
  STUDY_MODE_OPTIONS,
  labelOfCatalog,
} from '../../shared/catalogs/enums';
import { shouldFillStop } from '../fillAbort';
import {
  classifyControl,
  readControlText,
  writeField,
} from './chao/dom';
import { dateTextMatches, isCalendarDate } from './chao/rules';
import { cityNameOnly } from '../../shared/fill/sectionBinder';

/** 点「添加」后等新卡挂上 */
const ADD_WAIT_MS = 700;

/** 同一分区最多再点几次添加 */
const MAX_ADD_CLICKS = 6;

/**
 * 短等待。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 节点自身短文案，用来认标题和「删除 / 添加」。
 */
function ownShortText(element: HTMLElement): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    }
  }
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned) {
    return cleaned;
  }
  return (element.textContent || '').replace(/\s+/g, '').slice(0, 20);
}

/**
 * 是否像分区标题（教育经历、获奖情况）。
 */
function isSectionHeading(element: HTMLElement, pattern: RegExp): boolean {
  const text = ownShortText(element).replace(/[（(].*$/, '');
  if (text.length < 2 || text.length > 8 || /^添加|删除/.test(text)) {
    return false;
  }
  return pattern.test(text);
}

/**
 * 从标题走到下一个分区标题之前。
 */
function isInsideSection(heading: HTMLElement, nextHeading: HTMLElement | null, node: Node): boolean {
  const afterHeading = (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const beforeNext = nextHeading
    ? (nextHeading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    : true;
  return afterHeading && beforeNext;
}

/**
 * 找到分区标题和下一个分区标题。
 */
function findSectionBounds(pattern: RegExp): { heading: HTMLElement; nextHeading: HTMLElement | null } | null {
  const nodes = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, legend')];
  let heading: HTMLElement | null = null;
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const box = node.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) {
      continue;
    }
    if (isSectionHeading(node, pattern)) {
      heading = node;
      break;
    }
  }
  if (!heading) {
    return null;
  }
  let nextHeading: HTMLElement | null = null;
  let passed = false;
  const laterPattern = /教育|实习|工作|项目|校内|获奖|荣誉|证书|培训|技能|语言|自我|论文/;
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node === heading) {
      passed = true;
      continue;
    }
    if (!passed) {
      continue;
    }
    const text = ownShortText(node).replace(/[（(].*$/, '');
    if (text.length >= 2 && text.length <= 8 && laterPattern.test(text) && !pattern.test(text)) {
      nextHeading = node;
      break;
    }
  }
  return { heading, nextHeading };
}

/**
 * 左边标题。不用「请输入 / 请选择」。
 */
function captionBeside(control: HTMLElement): string {
  const root = control.closest('.ant-select, .ant-picker, .ant-radio-group, .el-select') || control;
  let current: HTMLElement | null = root;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const formItem = current.closest('.ant-form-item, .el-form-item');
    const formLabel = formItem?.querySelector('.ant-form-item-label, .el-form-item__label, label');
    const formLabelText = (formLabel?.textContent || '').replace(/[*＊\s：:]/g, '');
    if (formLabelText && formLabelText.length <= 12 && !/请输入|请选择|删除|添加/.test(formLabelText)) {
      return formLabelText;
    }
    let previous = current.previousElementSibling;
    while (previous instanceof HTMLElement) {
      const previousText = ownShortText(previous).replace(/[*＊：:]/g, '');
      if (
        previousText
        && previousText.length <= 12
        && !/请输入|请选择|删除|添加|必填/.test(previousText)
      ) {
        return previousText;
      }
      previous = previous.previousElementSibling;
    }
    current = current.parentElement;
  }
  return '';
}

/**
 * 分区里的可写控件：下拉外壳、日历、文本框、单选组。不要把下拉内部的搜索框再算一次。
 */
function collectControls(heading: HTMLElement, nextHeading: HTMLElement | null): HTMLElement[] {
  const selector = 'input, textarea, select, .ant-select, .el-select, .ant-picker, .ant-radio-group';
  return [...document.querySelectorAll(selector)].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || !isInsideSection(heading, nextHeading, node)) {
      return false;
    }
    const box = node.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) {
      return false;
    }
    if (node instanceof HTMLInputElement && node.closest('.ant-select, .el-select, .ant-picker')) {
      return false;
    }
    if (node.matches('.ant-select, .el-select') && node.parentElement?.closest('.ant-select, .el-select')) {
      return false;
    }
    return true;
  });
}

/**
 * 每张卡底部的「删除」。
 */
function collectDeleteButtons(heading: HTMLElement, nextHeading: HTMLElement | null): HTMLElement[] {
  return [...document.querySelectorAll('button, a, span')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || !isInsideSection(heading, nextHeading, node)) {
      return false;
    }
    const text = ownShortText(node);
    return text === '删除' || text === '删除本条';
  });
}

/**
 * 按删除按钮把控件切成第 1、2、3 张卡。没有删除时整段算一张。
 */
function splitCards(controls: HTMLElement[], deleteButtons: HTMLElement[]): HTMLElement[][] {
  if (deleteButtons.length === 0) {
    return controls.length ? [controls] : [];
  }
  const markers = [
    ...controls.map((element) => ({ kind: 'control' as const, element })),
    ...deleteButtons.map((element) => ({ kind: 'delete' as const, element })),
  ].sort((left, right) => {
    const leftBox = left.element.getBoundingClientRect();
    const rightBox = right.element.getBoundingClientRect();
    return leftBox.top - rightBox.top || leftBox.left - rightBox.left;
  });
  const cards: HTMLElement[][] = [];
  let currentCard: HTMLElement[] = [];
  for (const marker of markers) {
    if (marker.kind === 'delete') {
      if (currentCard.length > 0) {
        cards.push(currentCard);
        currentCard = [];
      }
      continue;
    }
    currentCard.push(marker.element);
  }
  if (currentCard.length > 0) {
    cards.push(currentCard);
  }
  return cards;
}

/**
 * 分区里的「添加」按钮。
 */
function findAddButton(heading: HTMLElement, nextHeading: HTMLElement | null): HTMLElement | null {
  const candidates = [...document.querySelectorAll('button, a, span, div')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || !isInsideSection(heading, nextHeading, node)) {
      return false;
    }
    const text = ownShortText(node);
    return /^添加/.test(text) && text.length <= 12;
  });
  return candidates[0] ?? null;
}

/**
 * 教育这一张卡上，标题对应档案里的哪一项。
 */
function educationValue(item: EducationItem, caption: string): string {
  if (/学历类型|办学类型|学习形式/.test(caption)) {
    return labelOfCatalog(STUDY_MODE_OPTIONS, item.educationType || item.studyMode || '');
  }
  if (/是否/.test(caption) && /最高/.test(caption)) {
    return item.isHighest ? '是' : '否';
  }
  if (/学历|学位/.test(caption) && !/学校|时间|排名/.test(caption)) {
    return labelOfCatalog(DEGREE_LEVEL_OPTIONS, item.degreeLevel || item.degree || '');
  }
  if (/学校|院校/.test(caption)) {
    return item.school || '';
  }
  if (/学院/.test(caption)) {
    return item.college || '';
  }
  if (/排名/.test(caption)) {
    return item.rank || '';
  }
  if (/专业/.test(caption)) {
    return item.major || '';
  }
  if (/开始/.test(caption)) {
    return item.startDate || '';
  }
  if (/结束/.test(caption)) {
    return item.endDate || '';
  }
  return '';
}

/**
 * 实习/工作这一张卡。
 */
function experienceValue(item: ExperienceItem, caption: string): string {
  if (/单位|公司/.test(caption)) {
    return item.company || '';
  }
  if (/职位|岗位/.test(caption)) {
    return item.title || '';
  }
  if (/开始/.test(caption)) {
    return item.startDate || '';
  }
  if (/结束/.test(caption)) {
    return item.endDate || '';
  }
  if (/内容|描述|职责/.test(caption)) {
    return item.workContent || item.description || '';
  }
  return '';
}

/**
 * 获奖这一张卡。描述只写真实描述，不写 province 这种级别代码。
 */
function awardValue(item: AwardItem, caption: string): string {
  if (/描述/.test(caption)) {
    return item.description || '';
  }
  if (/级别|等级/.test(caption)) {
    return labelOfCatalog(AWARD_LEVEL_OPTIONS, item.level || '');
  }
  if (/时间|日期/.test(caption)) {
    return item.date || '';
  }
  if (/获奖|奖项|名称|荣誉/.test(caption)) {
    return item.name || '';
  }
  return '';
}

/**
 * 证书这一张卡。
 */
function certificateValue(item: CertificateItem, caption: string): string {
  if (/描述/.test(caption)) {
    return item.description || '';
  }
  if (/时间|日期/.test(caption)) {
    return item.date || '';
  }
  if (/名称|证书/.test(caption)) {
    return item.name || '';
  }
  return '';
}

/**
 * 回读是否已经是目标值。
 */
function alreadyWritten(control: HTMLElement, value: string): boolean {
  const actual = readControlText(control).replace(/\s+/g, '');
  const wanted = value.replace(/\s+/g, '');
  if (!actual || !wanted) {
    return false;
  }
  if (isCalendarDate(wanted)) {
    return dateTextMatches(value, actual);
  }
  return actual.includes(wanted) || wanted.includes(actual);
}

/**
 * 写一格。点选走现有写入；失败只记漏填。
 */
async function writeOne(
  control: HTMLElement,
  caption: string,
  value: string,
  misses: FillMiss[],
): Promise<boolean> {
  if (alreadyWritten(control, value)) {
    return false;
  }
  try {
    const result = await writeField(
      {
        el: control,
        blob: caption,
        control: classifyControl(control),
      },
      value,
    );
    if (!result.ok) {
      misses.push({ label: caption, reason: result.reason || '没写上' });
      return false;
    }
    return true;
  } catch {
    misses.push({ label: caption, reason: '写入异常，已跳过本格' });
    return false;
  }
}

/**
 * 把一个分区按卡片填完。卡不够就点一次添加，只填新卡。
 */
async function fillSectionCards<CardItem>(
  headingPattern: RegExp,
  items: CardItem[],
  valueOf: (item: CardItem, caption: string) => string,
  misses: FillMiss[],
  onProgress: (message: string) => void,
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }
  const bounds = findSectionBounds(headingPattern);
  if (!bounds) {
    return 0;
  }
  let previousCardCount = -1;
  for (let addCount = 0; addCount <= MAX_ADD_CLICKS; addCount += 1) {
    if (shouldFillStop()) {
      break;
    }
    const controls = collectControls(bounds.heading, bounds.nextHeading);
    const deleteButtons = collectDeleteButtons(bounds.heading, bounds.nextHeading);
    const cards = splitCards(controls, deleteButtons);
    if (cards.length >= items.length) {
      break;
    }
    if (cards.length === previousCardCount) {
      misses.push({
        label: headingPattern.source,
        reason: '点了添加但卡片数量没有增加',
      });
      break;
    }
    previousCardCount = cards.length;
    const addButton = findAddButton(bounds.heading, bounds.nextHeading);
    if (!addButton) {
      misses.push({
        label: headingPattern.source,
        reason: `页面上只有 ${cards.length} 张卡，档案有 ${items.length} 条，且没有添加按钮`,
      });
      break;
    }
    onProgress(`正在添加第 ${cards.length + 1} 张卡…`);
    addButton.click();
    await wait(ADD_WAIT_MS);
  }
  const controls = collectControls(bounds.heading, bounds.nextHeading);
  const deleteButtons = collectDeleteButtons(bounds.heading, bounds.nextHeading);
  const cards = splitCards(controls, deleteButtons);
  let filled = 0;
  const cardCount = Math.min(cards.length, items.length);
  for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
    if (shouldFillStop()) {
      return filled;
    }
    const card = cards[cardIndex];
    if (!card) {
      continue;
    }
    onProgress(`正在按第 ${cardIndex + 1} 张卡填写…`);
    const item = items[cardIndex];
    if (!item) {
      continue;
    }
    for (const control of card) {
      if (shouldFillStop()) {
        return filled;
      }
      const caption = captionBeside(control);
      if (!caption) {
        continue;
      }
      const value = valueOf(item, caption).trim();
      if (!value) {
        continue;
      }
      const wrote = await writeOne(control, caption, value, misses);
      if (wrote) {
        filled += 1;
        await wait(60);
      }
    }
  }
  return filled;
}

/**
 * 个人信息里的点选：证件号、性别、国籍、籍贯、现居、出生日期。
 * 这些不在「删除」卡片里，按左边标题找同一行的控件。
 */
async function fillBasicChoices(profile: ProfileData, misses: FillMiss[]): Promise<number> {
  const basic = profile.basic;
  const jobs: Array<{ pattern: RegExp; value: string; idNumber?: boolean }> = [
    { pattern: /证件号码|证件号/, value: (basic.idNumber || '').trim(), idNumber: true },
    { pattern: /^性别$/, value: labelOfCatalog(GENDER_OPTIONS, basic.gender || '') },
    { pattern: /国籍/, value: (basic.nationality || '').trim() || '中国' },
    { pattern: /籍贯|户籍/, value: (basic.hukouLocation || '').trim() },
    { pattern: /现居/, value: cityNameOnly(basic.currentCity || '') },
    { pattern: /意向工作地点|工作地点/, value: cityNameOnly(profile.jobIntent.expectedCities || profile.jobIntent.workCity || basic.currentCity || '') },
    { pattern: /出生日期|出生年月|生日/, value: (basic.birthday || '').trim() },
  ];
  let filled = 0;
  const captionNodes = [...document.querySelectorAll('label, span, div')];
  for (const job of jobs) {
    if (shouldFillStop() || !job.value) {
      continue;
    }
    const captionNode = captionNodes.find((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = ownShortText(node).replace(/[*＊：:]/g, '');
      return job.pattern.test(text) && text.length <= 12;
    });
    if (!(captionNode instanceof HTMLElement)) {
      continue;
    }
    let row: HTMLElement | null = captionNode.parentElement;
    for (let depth = 0; depth < 6 && row; depth += 1) {
      const hasChoice = Boolean(row.querySelector('input[type="radio"], .ant-select, .el-select, .ant-picker, select'))
        || [...row.querySelectorAll('div, span')].some((node) => (node.textContent || '').replace(/\s+/g, '') === '请选择');
      if (hasChoice && row.contains(captionNode)) {
        break;
      }
      row = row.parentElement;
    }
    if (!row) {
      continue;
    }
    if ([...row.querySelectorAll('input, textarea, .ant-select, .ant-picker')].some((node) =>
      node instanceof HTMLElement && alreadyWritten(node, job.value))) {
      continue;
    }
    if (job.idNumber) {
      const numberInput = [...row.querySelectorAll('input')].find((input) =>
        input instanceof HTMLInputElement
        && !input.closest('.ant-select, .el-select, .ant-picker')
        && input.type !== 'hidden'
        && input.type !== 'radio',
      );
      if (numberInput instanceof HTMLElement) {
        const wrote = await writeOne(numberInput, '证件号码', job.value, misses);
        if (wrote) {
          filled += 1;
        }
      } else {
        misses.push({ label: '证件号码', reason: '同一行没找到号码输入框' });
      }
      continue;
    }
    const choice = row.querySelector(
      '.ant-radio-group, input[type="radio"], .ant-select, .el-select, .ant-picker, select',
    );
    const visibleTrigger = [...row.querySelectorAll('div, span, button')].find((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = (node.textContent || '').replace(/\s+/g, '');
      const box = node.getBoundingClientRect();
      return text === '请选择' && box.width > 48 && box.height >= 16 && box.height <= 56;
    });
    const target = choice instanceof HTMLElement ? choice : visibleTrigger;
    if (!(target instanceof HTMLElement)) {
      const already = [...row.querySelectorAll('input, textarea')].some((node) =>
        node instanceof HTMLElement && alreadyWritten(node, job.value));
      if (!already) {
        misses.push({ label: ownShortText(captionNode), reason: '同一行没找到可点的控件' });
      }
      continue;
    }
    if (alreadyWritten(target, job.value)) {
      continue;
    }
    const wrote = await writeOne(target, ownShortText(captionNode).replace(/[*＊：:]/g, ''), job.value, misses);
    if (wrote) {
      filled += 1;
    }
  }
  return filled;
}

/**
 * 确认写入后的主路径：先按卡片把教育、实习、获奖、证书和基础点选填上。
 */
export async function fillProfileByCards(
  profile: ProfileData,
  misses: FillMiss[],
  onProgress: (message: string) => void,
): Promise<number> {
  let filled = 0;
  onProgress('正在按卡片填写个人信息…');
  filled += await fillBasicChoices(profile, misses);
  filled += await fillSectionCards(
    /^教育经历$|^教育背景$/,
    profile.education || [],
    (item, caption) => educationValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^实习经历$|^工作经历$|^实习经验$/,
    profile.experience || [],
    (item, caption) => experienceValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^获奖情况$|^获奖经历$|^荣誉奖项$/,
    profile.awards || [],
    (item, caption) => awardValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^证书$/,
    profile.certificates || [],
    (item, caption) => certificateValue(item, caption),
    misses,
    onProgress,
  );
  return filled;
}
