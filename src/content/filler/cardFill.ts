/**
 * 按卡片填写：第 i 张卡只对档案第 i 条。
 * 用「删除」或重复标题切卡，用左边标题认格，不再依赖「第N行」这串字还在不在。
 */
import type { FillMiss } from '../../shared/types/fill';
import type {
  AwardItem,
  CampusActivityItem,
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
  readControlText,
} from './chao/dom';
import { commitFieldValue, rescanCommittedFields } from './fieldCommit';
import { dateTextMatches, isCalendarDate } from './chao/rules';
import { cityNameOnly } from '../../shared/fill/sectionBinder';
import { recordFillStep } from './fillTrace';

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
 * 右侧导航里的「实习经历」不是表单标题。
 * 拿它当边界，后面新加的卡会落在分区外面，数不到也填不到。
 */
function isNavigationChrome(node: HTMLElement): boolean {
  if (node.closest('nav, aside, [role="navigation"]')) {
    return true;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.width < 160 && rect.left > window.innerWidth * 0.75;
}

/**
 * 是否像分区标题（教育经历、获奖情况）。导航和「添加」按钮不算。
 */
function isSectionHeading(element: HTMLElement, pattern: RegExp): boolean {
  if (isNavigationChrome(element)) {
    return false;
  }
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
  // 只认分区标题。字段名「证书名称」「实践名称」含有这些字，不能拿来当边界
  const laterTitle = /^(教育经历|教育背景|在校实践|校内实践|校园实践|在校经历|实习经历|工作经历|实习经验|项目经历|获奖情况|获奖经历|荣誉奖项|证书|培训经历|技能特长|语言能力|自我评价|论文专利)$/;
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node === heading) {
      passed = true;
      continue;
    }
    if (!passed || isNavigationChrome(node)) {
      continue;
    }
    const text = ownShortText(node).replace(/[（(].*$/, '');
    if (laterTitle.test(text) && !pattern.test(text)) {
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
  const ariaLabel = (control.getAttribute('aria-label') || '').replace(/[*＊\s：:]/g, '');
  if (ariaLabel && ariaLabel.length <= 12 && !/请输入|请选择|删除|添加|必填/.test(ariaLabel)) {
    return ariaLabel;
  }
  if (control.id) {
    const boundLabel = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    const boundText = (boundLabel?.textContent || '').replace(/[*＊\s：:]/g, '');
    if (boundText && boundText.length <= 12 && !/请输入|请选择|删除|添加|必填/.test(boundText)) {
      return boundText;
    }
  }
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
 * 没有「删除」时，用第一次重复出现的标题把第 1、2、3 张卡切开。
 * 只按删除切的话，第一张卡还没有删除按钮时，新加出来的卡会被当成同一张。
 */
function groupControlsByRepeatedCaption(controls: HTMLElement[]): HTMLElement[][] {
  const captions = controls.map((control) => captionBeside(control));
  const captionCounts = new Map<string, number>();
  for (const caption of captions) {
    if (!caption) {
      continue;
    }
    captionCounts.set(caption, (captionCounts.get(caption) || 0) + 1);
  }
  let splitCaption = '';
  for (const caption of captions) {
    if (caption && (captionCounts.get(caption) || 0) >= 2) {
      splitCaption = caption;
      break;
    }
  }
  if (!splitCaption) {
    return controls.length > 0 ? [controls] : [];
  }
  const cards: HTMLElement[][] = [];
  let currentCard: HTMLElement[] = [];
  let seenSplitCaption = false;
  for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
    const caption = captions[controlIndex] || '';
    if (caption === splitCaption) {
      if (seenSplitCaption && currentCard.length > 0) {
        cards.push(currentCard);
        currentCard = [];
      }
      seenSplitCaption = true;
    }
    const control = controls[controlIndex];
    if (control) {
      currentCard.push(control);
    }
  }
  if (currentCard.length > 0) {
    cards.push(currentCard);
  }
  return cards;
}

/**
 * 重新扫描这一分区现在有几张卡。删除切出来的张数和标题重复切出来的张数，取更多的那份。
 */
function listSectionCards(
  heading: HTMLElement,
  nextHeading: HTMLElement | null,
): HTMLElement[][] {
  const controls = collectControls(heading, nextHeading);
  const deleteButtons = collectDeleteButtons(heading, nextHeading);
  const cardsByCaption = groupControlsByRepeatedCaption(controls);
  const cardsByDelete = deleteButtons.length > 0 ? splitCards(controls, deleteButtons) : [];
  if (cardsByDelete.length > cardsByCaption.length) {
    return cardsByDelete;
  }
  return cardsByCaption;
}

/**
 * 锁定这一分区的添加按钮。优先「添加」加标题原文，避免点到别的分区的添加。
 */
function findAddButton(heading: HTMLElement, nextHeading: HTMLElement | null): HTMLElement | null {
  const headingText = ownShortText(heading).replace(/[（(].*$/, '');
  const namedAddText = headingText ? `添加${headingText}` : '';
  const candidates = [...document.querySelectorAll('button, a, span, div')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const text = ownShortText(node);
    if (namedAddText && text === namedAddText) {
      return true;
    }
    return isInsideSection(heading, nextHeading, node) && /^添加/.test(text) && text.length <= 12;
  });
  const namedButton = namedAddText
    ? candidates.find((node) => ownShortText(node) === namedAddText)
    : null;
  return namedButton ?? candidates[0] ?? null;
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
 * 在校实践这一张卡。名称、角色、描述各写各的，不把描述写进名称。
 */
function campusValue(item: CampusActivityItem, caption: string): string {
  if (/角色|职务|职位/.test(caption)) {
    return item.role || '';
  }
  if (/描述|内容|职责/.test(caption)) {
    return item.description || '';
  }
  if (/开始/.test(caption)) {
    return item.startDate || '';
  }
  if (/结束/.test(caption)) {
    return item.endDate || '';
  }
  if (/名称|组织|实践/.test(caption)) {
    return item.organization || '';
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
  const result = await commitFieldValue(control, caption, value);
  if (!result.ok) {
    misses.push({ label: caption, reason: result.reason || '没写上' });
  }
  return result.ok;
}

/**
 * 写第 itemIndex 张卡，只用档案里同一条。已经是目标值的格子不再写第二遍。
 */
async function fillOneCard<CardItem>(
  card: HTMLElement[],
  item: CardItem,
  itemIndex: number,
  valueOf: (item: CardItem, caption: string) => string,
  misses: FillMiss[],
  onProgress: (message: string) => void,
): Promise<number> {
  onProgress(`正在按第 ${itemIndex + 1} 张卡填写…`);
  const cardWrites: Array<{ element: HTMLElement; label: string; value: string }> = [];
  for (const control of card) {
    if (shouldFillStop()) {
      break;
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
      cardWrites.push({ element: control, label: caption, value });
    }
    await wait(60);
  }
  return rescanCommittedFields(cardWrites, misses);
}

/**
 * 把一个分区按档案条数填完。
 * 先填已有的第 1 张，再点这一分区的添加，重新数卡，确认多了一张才填下一条。不多加、不把第 2 条写进第 1 张。
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
  const sectionName = ownShortText(bounds.heading).replace(/[（(].*$/, '') || headingPattern.source;
  let controlsPerCard = 0;
  /**
   * 这一轮重新数卡。标题能分开就用标题；标题读空时，按第一次扫到的控件个数把新卡切开。
   */
  const readCards = (): HTMLElement[][] => {
    const listed = listSectionCards(bounds.heading, bounds.nextHeading);
    const firstCard = listed[0];
    if (controlsPerCard === 0 && listed.length === 1 && firstCard && firstCard.length > 0) {
      controlsPerCard = firstCard.length;
    }
    if (listed.length > 1 || controlsPerCard === 0) {
      return listed;
    }
    const controls = collectControls(bounds.heading, bounds.nextHeading);
    if (controls.length < controlsPerCard * 2) {
      return listed;
    }
    const chunks: HTMLElement[][] = [];
    for (let start = 0; start + controlsPerCard <= controls.length; start += controlsPerCard) {
      const chunk = controls.slice(start, start + controlsPerCard);
      chunks.push(chunk);
    }
    return chunks.length > listed.length ? chunks : listed;
  };
  let filled = 0;
  let itemIndex = 0;
  let addClickCount = 0;
  while (itemIndex < items.length) {
    if (shouldFillStop()) {
      break;
    }
    const cards = readCards();
    const item = items[itemIndex];
    const currentCard = cards[itemIndex];
    if (!item) {
      break;
    }
    if (currentCard) {
      filled += await fillOneCard(currentCard, item, itemIndex, valueOf, misses, onProgress);
      itemIndex += 1;
      continue;
    }
    if (addClickCount >= MAX_ADD_CLICKS) {
      misses.push({
        label: sectionName,
        reason: `点了添加但卡片数量没有增加到 ${itemIndex + 1} 张`,
      });
      recordFillStep(sectionName, '添加', '没有增加', `档案第${itemIndex + 1}条，页面${cards.length}张`);
      break;
    }
    const addButton = findAddButton(bounds.heading, bounds.nextHeading);
    if (!addButton) {
      misses.push({
        label: sectionName,
        reason: `页面上只有 ${cards.length} 张卡，档案有 ${items.length} 条，且没有添加按钮`,
      });
      recordFillStep(sectionName, '添加', '没有添加按钮', `页面${cards.length}张，档案${items.length}条`);
      break;
    }
    const cardCountBeforeAdd = cards.length;
    onProgress(`正在添加第 ${cardCountBeforeAdd + 1} 张卡…`);
    addButton.click();
    addClickCount += 1;
    await wait(ADD_WAIT_MS);
    const cardsAfterAdd = readCards();
    if (cardsAfterAdd.length <= cardCountBeforeAdd) {
      misses.push({
        label: sectionName,
        reason: '点了添加但卡片数量没有增加',
      });
      recordFillStep(sectionName, '添加', '没有增加', `之前=${cardCountBeforeAdd} 现在=${cardsAfterAdd.length}`);
      break;
    }
    recordFillStep(sectionName, '添加', '卡片已增加', `之前=${cardCountBeforeAdd} 现在=${cardsAfterAdd.length} 下一条=档案第${itemIndex + 1}条`);
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
    const captionText = ownShortText(captionNode).replace(/[*＊：:]/g, '');
    if (!captionText || captionText.length > 12) {
      continue;
    }
    const boundedRow = (() => {
      let current: HTMLElement | null = captionNode.parentElement;
      let best: HTMLElement | null = current;
      for (let depth = 0; depth < 5 && current && current !== document.body; depth += 1) {
        const rowText = (current.textContent || '').replace(/\s+/g, '');
        const fieldNames = ['姓名', '证件', '性别', '籍贯', '现居', '国籍', '学历'].filter((word) => rowText.includes(word));
        if (fieldNames.length > 1) {
          break;
        }
        best = current;
        current = current.parentElement;
      }
      return best;
    })();
    if (!boundedRow) {
      continue;
    }
    if ([...boundedRow.querySelectorAll('input, textarea, .ant-select, .ant-picker')].some((node) =>
      node instanceof HTMLElement && alreadyWritten(node, job.value))) {
      continue;
    }
    if (/^(男|女|是|否)$/.test(job.value)) {
      // 性别只认「男/女」对应的真实单选框；文字点中但框没勾上，不算填成功，也不再去点请选择
      const wordNode = [...boundedRow.querySelectorAll('span, label, div')].find((node) => {
        const text = (node.textContent || '').replace(/\s+/g, '');
        const box = node.getBoundingClientRect();
        return text === job.value && box.height > 0 && box.height <= 40;
      });
      const radioInput = [...boundedRow.querySelectorAll('input[type="radio"]')].find((input) => {
        if (!(input instanceof HTMLInputElement)) {
          return false;
        }
        const labelText = (
          input.closest('label')?.textContent
          || (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : '')
          || input.value
          || ''
        ).replace(/\s+/g, '');
        return labelText === job.value || labelText.includes(job.value);
      });
      const radioTarget = radioInput instanceof HTMLInputElement
        ? radioInput
        : wordNode?.closest('label')?.querySelector('input[type="radio"]')
          || wordNode?.parentElement?.querySelector('input[type="radio"]');
      const genderTarget = radioTarget instanceof HTMLElement
        ? radioTarget
        : wordNode instanceof HTMLElement
          ? wordNode
          : null;
      if (genderTarget) {
        const genderResult = await commitFieldValue(genderTarget, captionText, job.value);
        if (genderResult.ok) {
          filled += 1;
        } else {
          misses.push({ label: captionText, reason: genderResult.reason || '单选框点了但没有勾上' });
        }
        continue;
      }
      misses.push({ label: captionText, reason: '单选框点了但没有勾上' });
      continue;
    }
    if (job.idNumber) {
      const numberInput = [...boundedRow.querySelectorAll('input')].find((input) =>
        input instanceof HTMLInputElement
        && !input.closest('.ant-select, .el-select, .ant-picker')
        && input.type !== 'hidden'
        && input.type !== 'radio'
        && (captionNode.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
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
    const choice = boundedRow.querySelector(
      '.ant-radio-group, input[type="radio"], .ant-select, .el-select, .ant-picker, select',
    );
    const visibleTrigger = [...boundedRow.querySelectorAll('div, span, button')].find((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = (node.textContent || '').replace(/\s+/g, '');
      const box = node.getBoundingClientRect();
      return text === '请选择' && box.width > 48 && box.height >= 16 && box.height <= 56;
    });
    const target = choice instanceof HTMLElement ? choice : visibleTrigger;
    if (!(target instanceof HTMLElement)) {
      const already = [...boundedRow.querySelectorAll('input, textarea')].some((node) =>
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
 * 确认写入后的主路径：按卡片把教育、在校实践、实习、获奖、证书和基础点选填上。
 * 每一区先填已有的第一张，再按档案条数点添加，点完重新数卡。
 */
export async function fillProfileByCards(
  profile: ProfileData,
  misses: FillMiss[],
  onProgress: (message: string) => void,
): Promise<number> {
  let filled = 0;
  onProgress('正在按卡片填写教育、实践、实习、获奖和证书…');
  filled += await fillSectionCards(
    /^教育经历$|^教育背景$/,
    profile.education || [],
    (item, caption) => educationValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^在校实践$|^校内实践$|^校园实践$|^在校经历$/,
    profile.campusActivities || [],
    (item, caption) => campusValue(item, caption),
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
  onProgress('正在按卡片填写个人信息…');
  filled += await fillBasicChoices(profile, misses);
  return filled;
}
