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
  LanguageItem,
  ProfileData,
  ProjectItem,
} from '../../shared/types/profile';
import {
  AWARD_LEVEL_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  GENDER_OPTIONS,
  LANGUAGE_PROFICIENCY_OPTIONS,
  STUDY_MODE_OPTIONS,
  labelOfCatalog,
} from '../../shared/catalogs/enums';
import { shouldFillStop } from '../fillAbort';
import {
  readControlText,
} from './chao/dom';
import { commitFieldValue, rescanCommittedFields } from './fieldCommit';
import { driveDatePanel, rangeSideOfControl } from './chao/widgetDrivers';
import { dateTextMatches, isCalendarDate } from './chao/rules';
import { cityNameOnly } from '../../shared/fill/sectionBinder';
import { namedInternshipExperiences, namedWorkExperiences } from '../../shared/fill/sectionAdds';
import { isAddControlText } from '../scanner/scanFields';
import { recordFillStep } from './fillTrace';

/** 点「添加」后等新卡挂上 */
const ADD_WAIT_MS = 700;

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
  // 只认分区标题。字段名「证书名称」「实践名称」含有这些字，不能拿来当边界。
  // 「作品」「获奖」必须在边界名单里，否则会被划进上一块，添加和填卡会串区。
  const laterTitle = /^(教育经历|教育背景|在校实践|校内实践|校园实践|在校经历|实习经历|工作经历|实习经验|项目经历|项目经验|作品|获奖情况|获奖经历|荣誉奖项|获奖|奖项|荣誉|证书|培训经历|技能特长|语言能力|自我评价|论文专利|论文\/专著|论文专著)$/;
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
 * 调用方：fillSectionCards 在页面卡数不够、需要再长一张时。
 * 输入：分区标题与下一分区标题；输出：分区内可点的添加控件，找不到则 null。
 * 文案判定与扫描侧 isAddControlText 同一套，认「+ 添加」「＋添加」「新增」等，不单独再写一套以「添加」开头的规则。
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
    // 必须落在本分区内，且文案与扫描/补行路径一致，避免「+添加」被旧规则漏掉
    return isInsideSection(heading, nextHeading, node) && isAddControlText(text);
  });
  const namedButton = namedAddText
    ? candidates.find((node) => ownShortText(node) === namedAddText)
    : null;
  return namedButton ?? candidates[0] ?? null;
}

/**
 * 教育这一张卡上，标题对应档案里的哪一项。
 */
function educationValue(item: EducationItem, caption: string, control?: HTMLElement): string {
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
  if (/起止/.test(caption) && !/开始|结束/.test(caption)) {
    if (control && rangeSideOfControl(control) === 'end') {
      return item.endDate || '';
    }
    return item.startDate || '';
  }
  if (/开始/.test(caption) && !/结束/.test(caption)) {
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
function experienceValue(item: ExperienceItem, caption: string, control?: HTMLElement): string {
  if (/单位|公司/.test(caption)) {
    return item.company || '';
  }
  if (/职位|岗位/.test(caption)) {
    return item.title || '';
  }
  if (/起止/.test(caption) && !/开始|结束/.test(caption)) {
    if (control && rangeSideOfControl(control) === 'end') {
      return item.endDate || '';
    }
    return item.startDate || '';
  }
  if (/开始/.test(caption) && !/结束/.test(caption)) {
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
 * 项目经历这一张卡。名称、角色、职责、内容、起止各写各的。
 * 调用方：fillProfileByCards → fillSectionCards。输入：一条项目、左边标题、可选控件。输出：该格应写的文案；对不上则空串。不改档案。
 */
function projectValue(item: ProjectItem, caption: string, control?: HTMLElement): string {
  if (/角色|职务|职位/.test(caption) && !/职责/.test(caption)) {
    return item.role || '';
  }
  if (/职责/.test(caption)) {
    return item.duty || '';
  }
  if (/内容|描述|价值|成果/.test(caption)) {
    return item.content || item.description || item.value || '';
  }
  if (/链接|地址|主页/.test(caption)) {
    return item.link || '';
  }
  if (/技术|栈/.test(caption)) {
    return item.techStack || '';
  }
  if (/起止/.test(caption) && !/开始|结束/.test(caption)) {
    if (control && rangeSideOfControl(control) === 'end') {
      return item.endDate || '';
    }
    return item.startDate || '';
  }
  if (/开始/.test(caption) && !/结束/.test(caption)) {
    return item.startDate || '';
  }
  if (/结束/.test(caption)) {
    return item.endDate || '';
  }
  if (/名称|项目/.test(caption)) {
    return item.name || '';
  }
  return '';
}

/**
 * 语言能力这一张卡。语种、熟练度、证书、分数各写各的。
 * 调用方：fillProfileByCards → fillSectionCards。输入：一条语言、左边标题。输出：该格应写的文案；对不上则空串。不改档案。
 */
function languageValue(item: LanguageItem, caption: string): string {
  if (/熟练|水平|等级|程度/.test(caption)) {
    return labelOfCatalog(LANGUAGE_PROFICIENCY_OPTIONS, item.proficiency || '') || item.proficiency || '';
  }
  if (/证书/.test(caption)) {
    return item.certificate || '';
  }
  if (/分数|成绩|得分/.test(caption)) {
    return item.score || '';
  }
  if (/时间|日期/.test(caption)) {
    return item.obtainedDate || '';
  }
  if (/语种|语言|外语/.test(caption)) {
    return item.language || '';
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
 * 证书这一张卡：有什么档案字段就填什么，空的不编造。
 * 调用方：fillSectionCards。输入：一条证书、左边标题。输出：该格应写的文案。
 */
function certificateValue(item: CertificateItem, caption: string): string {
  if (/描述/.test(caption)) {
    return item.description || '';
  }
  if (/获得时间|发证时间|颁发时间|取得时间|时间|日期/.test(caption)) {
    return item.date || '';
  }
  if (/证书名称|名称/.test(caption) || (/^证书$/.test(caption.replace(/[*＊：:\s]/g, '')))) {
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
 * 标题旁边的时间框。日期组件往往不是普通 input，收集控件时会漏掉，框上就一直停在「请选择」。
 */
function controlNextToCaption(captionNode: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = captionNode;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const scope = current.parentElement;
    if (!(scope instanceof HTMLElement)) {
      break;
    }
    const scopeBox = scope.getBoundingClientRect();
    if (scopeBox.height > 88) {
      current = scope;
      continue;
    }
    const trigger = [...scope.querySelectorAll('input, textarea, .ant-picker, .ant-select, .el-select')].find((node) => {
      if (!(node instanceof HTMLElement) || node === captionNode || captionNode.contains(node)) {
        return false;
      }
      if (node instanceof HTMLInputElement && (node.type === 'hidden' || node.type === 'radio' || node.type === 'checkbox')) {
        return false;
      }
      const nodeBox = node.getBoundingClientRect();
      return nodeBox.width >= 40 && nodeBox.height >= 16 && nodeBox.height <= 56
        && (captionNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    if (trigger instanceof HTMLElement) {
      return trigger;
    }
    const pleaseChoose = [...scope.querySelectorAll('div, span')].find((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const text = ownShortText(node);
      const nodeBox = node.getBoundingClientRect();
      return text === '请选择'
        && nodeBox.width > 48
        && nodeBox.height >= 16
        && nodeBox.height <= 48;
    });
    if (pleaseChoose instanceof HTMLElement) {
      return pleaseChoose;
    }
    current = scope;
  }
  return null;
}

/**
 * 这一分区里，从左到右、从上到下的「开始时间 / 结束时间」框。第 i 个对档案第 i 条。
 */
function dateTriggersInSection(
  heading: HTMLElement,
  nextHeading: HTMLElement | null,
  captionText: string,
): HTMLElement[] {
  const triggers: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const nodes = [...document.querySelectorAll('label, span, div')];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || isNavigationChrome(node)) {
      continue;
    }
    if (!isInsideSection(heading, nextHeading, node)) {
      continue;
    }
    const text = ownShortText(node).replace(/[*＊：:]/g, '');
    if (text !== captionText) {
      continue;
    }
    const trigger = controlNextToCaption(node);
    if (!(trigger instanceof HTMLElement) || seen.has(trigger)) {
      continue;
    }
    seen.add(trigger);
    triggers.push(trigger);
  }
  return triggers;
}

/**
 * 这个输入框是起止时间自己的日期格，不是学校、专业、公司、职位或描述。
 * 调用方：rangeInputsBeside。输入：页面输入框。输出：是日期格为 true。不改页面。
 */
function isRangeDateInput(input: HTMLInputElement): boolean {
  const caption = captionBeside(input);
  if (/学校|专业|公司|职位|描述/.test(caption) && !/时间|日期|起止/.test(caption)) {
    return false;
  }
  const placeholderText = (input.placeholder || '').replace(/\s+/g, '');
  if (/^Y{2,4}[-/.年]?M{1,2}/i.test(placeholderText)) {
    return true;
  }
  return Boolean(input.closest('.ant-picker-range, .ant-picker, .el-date-editor, .el-range-editor'));
}

/**
 * 这一层里有没有学校、专业、公司、职位、描述的输入框。
 * 调用方：rangeInputsBeside。有的话就不再往更外层拿框。不改页面。
 */
function scopeHasForeignTextInput(scope: HTMLElement): boolean {
  return [...scope.querySelectorAll('input, textarea')].some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const caption = captionBeside(node);
    return /学校|专业|公司|职位|描述/.test(caption) && !/时间|日期|起止/.test(caption);
  });
}

/**
 * 起止标题旁边左右两个日期框。
 * 只认日期控件内部或占位是年月掩码的输入框。整张卡片里的学校、专业、公司、职位不算。
 * 调用方：fillRangeDatePair。输入：起止时间标题。输出：从左到右最多两个日期框。不改页面。
 */
function rangeInputsBeside(captionNode: HTMLElement): HTMLInputElement[] {
  let current: HTMLElement | null = captionNode;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const scope = current.parentElement;
    if (!(scope instanceof HTMLElement)) {
      break;
    }
    const dateInputs = [...scope.querySelectorAll('input')].filter((node): node is HTMLInputElement => {
      if (!(node instanceof HTMLInputElement) || node.type === 'hidden') {
        return false;
      }
      const box = node.getBoundingClientRect();
      return box.width >= 40 && box.height >= 16 && isRangeDateInput(node);
    });
    if (dateInputs.length >= 2) {
      dateInputs.sort((leftInput, rightInput) => leftInput.getBoundingClientRect().left - rightInput.getBoundingClientRect().left);
      return dateInputs.slice(0, 2);
    }
    // 再往上就会把学校、公司所在的整张卡片算进来，停在这里
    if (scopeHasForeignTextInput(scope)) {
      break;
    }
    current = scope;
  }
  return [];
}

/**
 * 包住左右两个起止框的最近祖先，给日期态机当同一块区间的宿主。
 * 调用方：fillRangeDatePair。不改页面。
 */
function hostContainingRangeInputs(leftInput: HTMLInputElement, rightInput: HTMLInputElement): HTMLElement {
  let current: HTMLElement | null = leftInput.parentElement;
  while (current && current !== document.body) {
    if (current.contains(rightInput)) {
      return current;
    }
    current = current.parentElement;
  }
  return leftInput;
}

/**
 * 把这一条的开始、结束写进「起止时间」左右两格。档案哪一侧空就跳过，不编造。
 * 已找到的左右框直接交给 driveDatePanel，不再让它只用组件类名重找。
 * 调用方：fillDateTriggers。会改这两个日期框。
 */
async function fillRangeDatePair<CardItem>(
  heading: HTMLElement,
  nextHeading: HTMLElement | null,
  item: CardItem,
  itemIndex: number,
  valueOf: (item: CardItem, caption: string, control?: HTMLElement) => string,
  misses: FillMiss[],
): Promise<number> {
  const captionNodes = [...document.querySelectorAll('label, span, div')].filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement) || isNavigationChrome(node)) {
      return false;
    }
    if (!isInsideSection(heading, nextHeading, node)) {
      return false;
    }
    return ownShortText(node).replace(/[*＊：:]/g, '') === '起止时间';
  });
  const captionNode = captionNodes[itemIndex];
  if (!(captionNode instanceof HTMLElement)) {
    return 0;
  }
  const inputs = rangeInputsBeside(captionNode);
  const leftInput = inputs[0];
  const rightInput = inputs[1];
  if (!(leftInput instanceof HTMLInputElement) || !(rightInput instanceof HTMLInputElement)) {
    misses.push({ label: '起止时间', reason: '没有找到起止时间自己的两个日期框' });
    recordFillStep('起止时间', '找框', '没有找到起止时间自己的两个日期框', `第${itemIndex + 1}条 双框=否`);
    return 0;
  }
  const knownPair = {
    host: hostContainingRangeInputs(leftInput, rightInput),
    left: leftInput,
    right: rightInput,
  };
  const startValue = valueOf(item, '开始时间', leftInput).trim();
  const endValue = valueOf(item, '结束时间', rightInput).trim();
  if (!startValue && !endValue) {
    return 0;
  }
  let startResult: { ok: boolean; reason?: string } = { ok: true, reason: '' };
  if (startValue) {
    startResult = await driveDatePanel(leftInput, startValue, knownPair);
    if (!endValue) {
      for (let attempt = 0; !startResult.ok && attempt < 2; attempt += 1) {
        startResult = await driveDatePanel(leftInput, startValue, knownPair);
      }
    }
  }
  let endResult: { ok: boolean; reason?: string } = { ok: true, reason: '' };
  if (endValue) {
    endResult = await driveDatePanel(rightInput, endValue, knownPair);
  }
  const leftActual = readControlText(leftInput);
  const rightActual = readControlText(rightInput);
  const leftMatched = !startValue || dateTextMatches(startValue, leftActual);
  const rightMatched = !endValue || dateTextMatches(endValue, rightActual);
  let filled = 0;
  if (startValue && !leftMatched) {
    misses.push({ label: '起止时间', reason: startResult.reason || '开始月没写上' });
    recordFillStep(
      '起止时间',
      '开始月',
      startResult.reason || '没写上',
      `目标=${startValue} 双框=是 回读=${leftActual || '占位'}`,
    );
  } else if (startValue && leftMatched) {
    filled += 1;
  }
  if (endValue && !rightMatched) {
    misses.push({ label: '起止时间', reason: endResult.reason || '结束月没写上' });
    recordFillStep(
      '起止时间',
      '结束月',
      endResult.reason || '没写上',
      `目标=${endValue} 双框=是 回读=${rightActual || '占位'}`,
    );
  } else if (endValue && rightMatched) {
    filled += 1;
  }
  return filled;
}

/**
 * 把这一条档案的开始、结束、获得时间写进同序号的时间框。
 * 文本格收集不到日期组件时，仍按标题去点「请选择」。
 * 调用方：fillSectionCards 填完一张卡正文后。档案该格为空则跳过，不编造。
 */
async function fillDateTriggers<CardItem>(
  heading: HTMLElement,
  nextHeading: HTMLElement | null,
  item: CardItem,
  itemIndex: number,
  valueOf: (item: CardItem, caption: string, control?: HTMLElement) => string,
  misses: FillMiss[],
): Promise<number> {
  let filled = 0;
  const rangeFilled = await fillRangeDatePair(heading, nextHeading, item, itemIndex, valueOf, misses);
  filled += rangeFilled;
  // 开始/结束/获得仍按标题点；起止区间已在 fillRangeDatePair 里成对写
  const captionList = ['开始时间', '结束时间', '获得时间'];
  for (const captionText of captionList) {
    const value = valueOf(item, captionText).trim();
    if (!value) {
      continue;
    }
    const trigger = dateTriggersInSection(heading, nextHeading, captionText)[itemIndex];
    if (!(trigger instanceof HTMLElement)) {
      continue;
    }
    const wrote = await writeOne(trigger, captionText, value, misses);
    if (wrote) {
      filled += 1;
    }
  }
  return filled;
}
async function fillOneCard<CardItem>(
  card: HTMLElement[],
  item: CardItem,
  itemIndex: number,
  valueOf: (item: CardItem, caption: string, control?: HTMLElement) => string,
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
    // 起止两格由 fillDateTriggers 成对点月，这里再逐格写会把开始月误报成没写上
    if (/起止时间|起止日期/.test(caption) && !/开始|结束/.test(caption)) {
      continue;
    }
    const value = valueOf(item, caption, control).trim();
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
  valueOf: (item: CardItem, caption: string, control?: HTMLElement) => string,
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
  // 上限按「档案条数 − 当前已有卡数」动态计算，不写死次数；页上已有若干张时只允许补差额
  const cardsAlreadyOnPage = readCards().length;
  const maxAddClicksAllowed = Math.max(0, items.length - cardsAlreadyOnPage);
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
      filled += await fillDateTriggers(
        bounds.heading,
        bounds.nextHeading,
        item,
        itemIndex,
        valueOf,
        misses,
      );
      itemIndex += 1;
      continue;
    }
    if (addClickCount >= maxAddClicksAllowed) {
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
 * 确认写入后的主路径：按卡片把教育、在校实践、实习、工作、项目、获奖、证书、语言和基础点选填上。
 * 「作品」没有对应档案段，故意不填，避免和项目经历写成一样。
 * 每一区先填已有的第一张，再按档案条数点添加，点完重新数卡。
 */
export async function fillProfileByCards(
  profile: ProfileData,
  misses: FillMiss[],
  onProgress: (message: string) => void,
): Promise<number> {
  let filled = 0;
  onProgress('正在按卡片填写教育、实践、实习、项目、获奖、证书和语言…');
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
    /^实习经历$|^实习经验$/,
    namedInternshipExperiences(profile),
    (item, caption) => experienceValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^工作经历$/,
    namedWorkExperiences(profile),
    (item, caption) => experienceValue(item, caption),
    misses,
    onProgress,
  );
  // 页面标题是「项目经历 / 项目经验」；没有单独「作品」档案，作品区跳过
  filled += await fillSectionCards(
    /^项目经历$|^项目经验$/,
    (profile.projects || []).filter((item) => (item.name || '').trim().length > 0),
    (item, caption, control) => projectValue(item, caption, control),
    misses,
    onProgress,
  );
  // 页面短标题「获奖」与长标题并列，对不上就不进区、不点添加
  filled += await fillSectionCards(
    /^获奖情况$|^获奖经历$|^荣誉奖项$|^获奖$|^奖项$|^所获荣誉$/,
    (profile.awards || []).filter((item) => (item.name || '').trim().length > 0),
    (item, caption) => awardValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^证书$|^资格证书$|^证书信息$|^专业证书$/,
    profile.certificates || [],
    (item, caption) => certificateValue(item, caption),
    misses,
    onProgress,
  );
  filled += await fillSectionCards(
    /^语言能力$|^外语能力$|^语种能力$|^语言水平$/,
    (profile.languages || []).filter((item) => (item.language || '').trim().length > 0),
    (item, caption) => languageValue(item, caption),
    misses,
    onProgress,
  );
  onProgress('正在按卡片填写个人信息…');
  filled += await fillBasicChoices(profile, misses);
  return filled;
}
