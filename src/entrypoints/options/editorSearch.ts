/** 跳转高亮停留时间 */
const JUMP_HIGHLIGHT_MS = 5000;

/** 每一类结果最多这么条，避免长档案把下拉撑满 */
const SEARCH_RESULT_LIMIT = 8;

/** 相似结果低于这个分数就不列出 */
const SIMILARITY_FLOOR = 0.74;

/** 少于两个字不做相似匹配，避免一个「名」打中很多标题 */
const MIN_SIMILARITY_QUERY_LENGTH = 2;

/** 结果种类：标题是小标题里带字，相似是错字或近义词，内容是已填文字 */
type SearchHitKind = 'title' | 'similar' | 'content';

/** 一条可跳转的字段 */
interface EditorSearchHit {
  labelText: string;
  sectionTitle: string;
  valueSnippet: string;
  target: HTMLElement;
  kind: SearchHitKind;
  /** 同一类里越小越靠前 */
  sortRank: number;
}

/**
 * 小标题近义词。只收简历里会互相叫法的词，用来把「旧名」指到「曾用名」。
 * 一组里的词必须是同一项，不能把「邮箱」和「邮编」放在一起。
 */
const LABEL_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['曾用名', '旧名', '老名字', '原名', '以前的名字'],
  ['姓名', '名字', '全名'],
  ['英文名', '英语名', '英文姓名'],
  ['国籍', '国家', '国际'],
  ['民族', '族别'],
  ['籍贯', '老家', '家乡'],
  ['手机', '电话', '手机号', '电话号', '联系电话', '联系方式'],
  ['邮箱', '电子邮箱', '邮件', 'email'],
  ['现居城市', '所在城市', '居住城市', '现居地', '居住地'],
  ['出生日期', '生日', '出生年月', '出生时间'],
  ['证件号码', '身份证号', '身份证', '证件号'],
  ['证件类型', '身份证类型'],
  ['政治面貌', '政治身份', '党派'],
  ['婚姻状况', '婚否', '结婚情况'],
  ['目标职位', '求职意向', '应聘岗位', '意向岗位', '求职岗位'],
  ['自我评价', '我的价值', '个人优势', '个人介绍', '个人评价'],
  ['奖次', '一等奖', '二等奖', '三等奖', '等第', '名次'],
  ['工作职责', '岗位职责', '职责描述'],
  ['工作内容', '岗位内容'],
  ['项目内容', '项目描述'],
  ['职责', '项目职责'],
  ['项目价值', '项目成果', '项目收获'],
  ['涉及技能', '使用技能', '掌握技能', '拥有技能', '相关技能'],
];

/**
 * 正文里同一事物的另一种写法。只有整词对上才扩展，
 * 「可编程控制器」可以找到 PLC，「编程」或「控制器」单独出现不行。
 */
const CONTENT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['PLC', '可编程控制器', '可编程逻辑控制器'],
  ['CAD', '计算机辅助设计'],
  ['CAM', '计算机辅助制造'],
  ['CNC', '数控机床', '数控加工'],
  ['ERP', '企业资源计划'],
  ['MES', '制造执行系统'],
  ['SCADA', '数据采集与监视控制系统'],
  ['CET-4', 'CET4', '英语四级', '大学英语四级'],
  ['CET-6', 'CET6', '英语六级', '大学英语六级'],
  ['TEM-4', 'TEM4', '英语专业四级', '专四'],
  ['TEM-8', 'TEM8', '英语专业八级', '专八'],
  ['IELTS', '雅思'],
  ['TOEFL', '托福'],
  ['CPA', '注册会计师'],
  ['CFA', '特许金融分析师'],
  ['PMP', '项目管理专业人士资格认证', '项目管理专业人士'],
];

const KIND_LABEL: Record<SearchHitKind, string> = {
  title: '标题',
  similar: '相似',
  content: '内容',
};

let highlightTimer = 0;
let highlightedElement: HTMLElement | null = null;

/**
 * 给字段格或整块分区加 5 秒高亮。新的一次跳转会立刻取消上一处。
 */
export function highlightEditorTarget(target: HTMLElement): void {
  if (highlightedElement) {
    highlightedElement.classList.remove('is-jump-highlight');
  }
  window.clearTimeout(highlightTimer);
  highlightedElement = target;
  target.classList.add('is-jump-highlight');
  highlightTimer = window.setTimeout(() => {
    target.classList.remove('is-jump-highlight');
    if (highlightedElement === target) {
      highlightedElement = null;
    }
  }, JUMP_HIGHLIGHT_MS);
}

/**
 * 展开字段所在的折叠分区，否则滚过去看不见。
 */
function openAncestorDetails(target: HTMLElement): void {
  let current: HTMLElement | null = target;
  while (current) {
    if (current instanceof HTMLDetailsElement) {
      current.open = true;
    }
    current = current.parentElement;
  }
}

/**
 * 滚到目标并高亮。搜索跳字段，目录跳整块分区，都走这里。
 */
export function jumpToEditorTarget(target: HTMLElement): void {
  openAncestorDetails(target);
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightEditorTarget(target);
}

/**
 * 字段所在分区的标题，用详情块的 summary。
 */
function sectionTitleOf(element: HTMLElement): string {
  const block = element.closest('details.editor-block');
  if (!(block instanceof HTMLDetailsElement)) {
    return '档案';
  }
  const summary = block.querySelector('summary');
  const title = summary?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return title || '档案';
}

/**
 * 去掉星号和多余空白，得到用来比较的小标题。
 */
function cleanLabelText(rawText: string): string {
  return rawText.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * 读字段里已经填上的文字。可搜索下拉和省市区用的是输入框里的中文，不是内部代码。
 */
function fieldValueText(field: HTMLElement): string {
  const textParts: string[] = [];
  const controls = field.querySelectorAll('input, textarea, select');
  for (const control of controls) {
    if (control instanceof HTMLInputElement) {
      if (
        control.type === 'hidden' ||
        control.type === 'checkbox' ||
        control.type === 'radio' ||
        control.type === 'file' ||
        control.type === 'button'
      ) {
        continue;
      }
      const inputText = control.value.trim();
      if (inputText) {
        textParts.push(inputText);
      }
      continue;
    }
    if (control instanceof HTMLTextAreaElement) {
      const areaText = control.value.trim();
      if (areaText) {
        textParts.push(areaText);
      }
      continue;
    }
    if (control instanceof HTMLSelectElement) {
      const optionText = control.selectedOptions[0]?.textContent?.trim() ?? '';
      if (optionText) {
        textParts.push(optionText);
      }
    }
  }
  return [...new Set(textParts)].join('\n');
}

/**
 * 两个短字符串的编辑距离，用来判断小标题是不是只错了一两个字。
 */
function editDistance(leftText: string, rightText: string): number {
  const leftChars = [...leftText];
  const rightChars = [...rightText];
  const leftLength = leftChars.length;
  const rightLength = rightChars.length;
  let previousRow = Array.from({ length: rightLength + 1 }, (_, column) => column);
  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    const currentRow = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const replaceCost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
      const insertCost = currentRow[rightIndex - 1] + 1;
      const deleteCost = previousRow[rightIndex] + 1;
      const substituteCost = previousRow[rightIndex - 1] + replaceCost;
      currentRow[rightIndex] = Math.min(insertCost, deleteCost, substituteCost);
    }
    previousRow = currentRow;
  }
  return previousRow[rightLength];
}

/**
 * 查询里命中的最长别名有多长。短词被长词包住时只认长词，避免「老名字」再去撞「名字」。
 */
function longestContainedTermLength(
  queryText: string,
  groups: readonly (readonly string[])[],
): number {
  const foldedQuery = queryText.toLowerCase();
  let longestLength = 0;
  for (const group of groups) {
    for (const term of group) {
      if (term.length > longestLength && foldedQuery.includes(term.toLowerCase())) {
        longestLength = term.length;
      }
    }
  }
  return longestLength;
}

/**
 * 查询是否落到这一组别名上。必须用最长的那个词，不能用被它包住的短词。
 */
function queryHitsAliasGroup(queryText: string, group: readonly string[]): boolean {
  const foldedQuery = queryText.toLowerCase();
  const longestLength = longestContainedTermLength(queryText, LABEL_ALIAS_GROUPS);
  if (longestLength < MIN_SIMILARITY_QUERY_LENGTH) {
    return false;
  }
  return group.some(
    (term) => term.length === longestLength && foldedQuery.includes(term.toLowerCase()),
  );
}

/**
 * 小标题是否属于这一组：整词相同，或标题里含有组里的词。
 */
function labelHitsAliasGroup(labelText: string, group: readonly string[]): boolean {
  const foldedLabel = labelText.toLowerCase();
  return group.some((term) => {
    const foldedTerm = term.toLowerCase();
    return foldedLabel === foldedTerm || foldedLabel.includes(foldedTerm);
  });
}

/**
 * 小标题和输入有多像。近义词给高分，只错一个字次之，再松的返回 0。
 */
function labelSimilarityScore(queryText: string, labelText: string): number {
  if ([...queryText].length < MIN_SIMILARITY_QUERY_LENGTH) {
    return 0;
  }
  for (const group of LABEL_ALIAS_GROUPS) {
    if (queryHitsAliasGroup(queryText, group) && labelHitsAliasGroup(labelText, group)) {
      return 0.95;
    }
  }
  const foldedQuery = queryText.toLowerCase();
  const foldedLabel = labelText.toLowerCase();
  if (foldedLabel.includes(foldedQuery)) {
    return 0;
  }
  const distance = editDistance(foldedQuery, foldedLabel);
  const queryLength = [...foldedQuery].length;
  const labelLength = [...foldedLabel].length;
  const longerLength = Math.max(queryLength, labelLength);
  if (distance === 1 && longerLength <= 12) {
    return 0.86;
  }
  if (distance === 2 && queryLength >= 5 && labelLength >= 5) {
    return 0.74;
  }
  return 0;
}

/**
 * 拉丁字母缩写按整词出现才算，避免 PLC 嵌在别的英文单词里。
 */
function containsAliasTerm(haystack: string, aliasTerm: string): boolean {
  const foldedHaystack = haystack.toLowerCase();
  const foldedTerm = aliasTerm.toLowerCase();
  if (/^[a-z0-9][a-z0-9.+#-]{1,}$/i.test(aliasTerm)) {
    const escapedTerm = foldedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordPattern = new RegExp(`(^|[^a-z0-9])${escapedTerm}([^a-z0-9]|$)`, 'i');
    return wordPattern.test(haystack);
  }
  return foldedHaystack.includes(foldedTerm);
}

/**
 * 点了 AI 搜索时，把和输入是同一事物的另一种写法也拿来对正文。
 * 输入本身已经是要找的字，这里只补充组里的其他叫法。
 */
function contentAliasNeedles(queryText: string): string[] {
  const foldedQuery = queryText.toLowerCase();
  const needles: string[] = [];
  for (const group of CONTENT_ALIAS_GROUPS) {
    const queryMatchesGroup = group.some((term) => containsAliasTerm(queryText, term));
    if (!queryMatchesGroup) {
      continue;
    }
    for (const term of group) {
      if (foldedQuery.includes(term.toLowerCase())) {
        continue;
      }
      needles.push(term);
    }
  }
  return needles;
}

/**
 * 在已填文字里截一小段，让人看得出命中的是哪几个字。
 */
function snippetAround(valueText: string, needles: string[]): string {
  const foldedValue = valueText.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const needle of needles) {
    const foundIndex = foldedValue.indexOf(needle.toLowerCase());
    if (foundIndex >= 0 && (matchIndex < 0 || foundIndex < matchIndex)) {
      matchIndex = foundIndex;
      matchLength = needle.length;
    }
  }
  if (matchIndex < 0) {
    return valueText.slice(0, 24);
  }
  const sliceStart = Math.max(0, matchIndex - 8);
  const sliceEnd = Math.min(valueText.length, matchIndex + matchLength + 8);
  const leadingMark = sliceStart > 0 ? '…' : '';
  const trailingMark = sliceEnd < valueText.length ? '…' : '';
  return `${leadingMark}${valueText.slice(sliceStart, sliceEnd)}${trailingMark}`;
}

/**
 * 在编辑表单里找标题、相似标题和已填内容。相似和换一种说法的正文只在点了 AI 搜索时加入。
 */
function collectSearchHits(
  form: HTMLElement,
  keyword: string,
  includeSimilarity: boolean,
): EditorSearchHit[] {
  const foldedKeyword = keyword.toLowerCase();
  const aliasNeedles = includeSimilarity ? contentAliasNeedles(keyword) : [];
  const titleHits: EditorSearchHit[] = [];
  const similarHits: EditorSearchHit[] = [];
  const contentHits: EditorSearchHit[] = [];
  const fields = form.querySelectorAll<HTMLElement>('.field');
  for (const field of fields) {
    if (field.closest('.editor-search')) {
      continue;
    }
    const labelElement = field.querySelector('.field-label');
    const labelText = cleanLabelText(labelElement?.textContent ?? '');
    if (!labelText) {
      continue;
    }
    const valueText = fieldValueText(field);
    const foldedLabel = labelText.toLowerCase();
    const foldedValue = valueText.toLowerCase();
    const sectionTitle = sectionTitleOf(field);

    if (foldedLabel.includes(foldedKeyword)) {
      titleHits.push({
        labelText,
        sectionTitle,
        valueSnippet: '',
        target: field,
        kind: 'title',
        sortRank: foldedLabel.startsWith(foldedKeyword) ? 0 : 1,
      });
      continue;
    }

    if (includeSimilarity) {
      const similarityScore = labelSimilarityScore(keyword, labelText);
      if (similarityScore >= SIMILARITY_FLOOR) {
        const lengthGap = Math.abs([...labelText].length - [...keyword].length);
        similarHits.push({
          labelText,
          sectionTitle,
          valueSnippet: '',
          target: field,
          kind: 'similar',
          sortRank: (1 - similarityScore) * 100 + lengthGap,
        });
        continue;
      }
    }

    const valueHasKeyword = foldedValue.includes(foldedKeyword);
    const matchedAlias = aliasNeedles.find((needle) =>
      containsAliasTerm(valueText, needle),
    );
    if (!valueHasKeyword && !matchedAlias) {
      continue;
    }
    const snippetNeedles = valueHasKeyword ? [keyword] : matchedAlias ? [matchedAlias] : [keyword];
    contentHits.push({
      labelText,
      sectionTitle,
      valueSnippet: snippetAround(valueText, snippetNeedles),
      target: field,
      kind: 'content',
      sortRank: valueHasKeyword ? 0 : 1,
    });
  }

  const orderedHits = [titleHits, similarHits, contentHits].flatMap((hitGroup) =>
    hitGroup
      .sort((leftHit, rightHit) => leftHit.sortRank - rightHit.sortRank)
      .slice(0, SEARCH_RESULT_LIMIT),
  );
  return orderedHits;
}

/**
 * 在档案编辑表单顶部挂上搜索。输入时出标题和内容；点 AI 搜索再加入相似和换一种说法。
 */
export function mountEditorSearch(form: HTMLElement): void {
  if (form.querySelector('.editor-search')) {
    return;
  }
  const searchBar = document.createElement('div');
  searchBar.className = 'editor-search';

  const searchLabel = document.createElement('label');
  searchLabel.className = 'editor-search-label';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = '搜索档案';

  const searchRow = document.createElement('div');
  searchRow.className = 'editor-search-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '输入字段名或已填内容，例如：姓名';
  searchInput.setAttribute('aria-label', '搜索档案字段');
  const similarityButton = document.createElement('button');
  similarityButton.type = 'button';
  similarityButton.className = 'btn btn-secondary editor-search-ai';
  similarityButton.textContent = 'AI 搜索';
  searchRow.append(searchInput, similarityButton);
  searchLabel.append(caption, searchRow);

  const hintLine = document.createElement('p');
  hintLine.className = 'editor-search-hint';
  hintLine.textContent = '没搜到想要的，可点「AI 搜索」。错字、近义词，以及很对应的另一种说法（如可编程控制器和 PLC）会一起列出来。';

  const resultList = document.createElement('ul');
  resultList.className = 'editor-search-results';
  resultList.hidden = true;

  let similarityArmed = false;

  /**
   * 按当前输入重画结果。空关键词就收起，并取消已经点过的 AI 搜索。
   */
  const renderResults = (): void => {
    const keyword = searchInput.value.trim();
    resultList.replaceChildren();
    if (!keyword) {
      similarityArmed = false;
      resultList.hidden = true;
      return;
    }
    const hits = collectSearchHits(form, keyword, similarityArmed);
    if (hits.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'editor-search-empty';
      emptyItem.textContent = similarityArmed
        ? '没有足够像的标题，正文里也没有这串字或对应的另一种说法。'
        : '没有找到。可点「AI 搜索」，用错字或近义词再试。';
      resultList.appendChild(emptyItem);
      resultList.hidden = false;
      return;
    }
    for (const hit of hits) {
      const resultItem = document.createElement('li');
      const resultButton = document.createElement('button');
      resultButton.type = 'button';
      resultButton.className = 'editor-search-hit';
      const kindMark = document.createElement('span');
      kindMark.className = `editor-search-kind is-${hit.kind}`;
      kindMark.textContent = KIND_LABEL[hit.kind];
      const nameLine = document.createElement('span');
      nameLine.className = 'editor-search-hit-name';
      nameLine.textContent = hit.labelText;
      const sectionLine = document.createElement('span');
      sectionLine.className = 'editor-search-hit-section';
      sectionLine.textContent = hit.valueSnippet
        ? `${hit.sectionTitle} · ${hit.valueSnippet}`
        : hit.sectionTitle;
      resultButton.append(kindMark, nameLine, sectionLine);
      resultButton.addEventListener('click', () => {
        resultList.hidden = true;
        jumpToEditorTarget(hit.target);
      });
      resultItem.appendChild(resultButton);
      resultList.appendChild(resultItem);
    }
    resultList.hidden = false;
  };

  searchInput.addEventListener('input', renderResults);
  searchInput.addEventListener('focus', renderResults);
  similarityButton.addEventListener('click', () => {
    if (!searchInput.value.trim()) {
      searchInput.focus();
      return;
    }
    similarityArmed = true;
    renderResults();
    searchInput.focus();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      resultList.hidden = true;
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const firstHit = resultList.querySelector<HTMLButtonElement>('.editor-search-hit');
    firstHit?.click();
  });
  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && searchBar.contains(event.target)) {
      return;
    }
    resultList.hidden = true;
  });

  searchBar.append(searchLabel, hintLine, resultList);
  form.prepend(searchBar);
}
