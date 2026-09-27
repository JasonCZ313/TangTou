/**
 * 躺投 chao 填写引擎 —— 30 份网申表单案例离线验证台。
 *
 * 做法：用 esbuild 把引擎打成 ESM，再在 jsdom 里造 30 种表单（含年月下拉、分区、多条经历、
 * 「添加」按钮、导航目录等真实结构），直接跑 runChaoRuleAutofill 并断言结果。
 * 目的：在不依赖真实浏览器的情况下，把历史上出现过的每一个错填/漏填场景都钉死。
 *
 * 运行：npm run verify:chao
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outDir = path.join(repoRoot, '.tmp');
const outFile = path.join(outDir, 'chao-engine.mjs');

/* ------------------------------------------------------------------ */
/* 1. 打包引擎                                                         */
/* ------------------------------------------------------------------ */
fs.mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [path.join(repoRoot, 'src', 'content', 'filler', 'chaoAutofill.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  outfile: outFile,
  logLevel: 'silent',
});
const engine = await import(pathToFileURL(outFile).href);
const { runChaoRuleAutofill, profileToChaoEditable } = engine;
if (typeof runChaoRuleAutofill !== 'function') {
  throw new Error('引擎打包失败：runChaoRuleAutofill 未导出');
}

/* ------------------------------------------------------------------ */
/* 2. 测试环境：把 jsdom 的 window/document 装到全局，并补 jsdom 缺的能力 */
/* ------------------------------------------------------------------ */
function installGlobals(dom) {
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.Event = window.Event;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.CSS = window.CSS;
  globalThis.localStorage = window.localStorage;
  // 测试时关闭 F12 调试输出，保持结果干净（功能本身已由单测覆盖）
  window.__tangtouDebug = false;

  // jsdom 没有布局引擎：给一个非零尺寸，否则「可见性」判定会把所有字段过滤掉
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32 };
  };
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  // jsdom 不实现 execCommand；模拟 insertText 以覆盖 contenteditable 分支
  window.document.execCommand = (command, _ui, value) => {
    if (command === 'insertText') {
      const target = window.document.activeElement;
      if (target && target.isContentEditable) target.textContent = String(value ?? '');
    }
    return true;
  };
  return window;
}

/* ------------------------------------------------------------------ */
/* 3. 页面交互模拟：combobox 点开弹层、点「添加」克隆一行              */
/* ------------------------------------------------------------------ */
function wireInteractions(window) {
  const doc = window.document;
  doc.querySelectorAll('[role="combobox"]').forEach((trigger) => {
    if (trigger.getAttribute('data-wired') === '1') return;
    trigger.setAttribute('data-wired', '1');
    trigger.addEventListener('click', () => {
      const options = String(trigger.getAttribute('data-options') || '').split('|').filter(Boolean);
      doc.querySelectorAll('[data-generated-popup]').forEach((node) => node.remove());
      const list = doc.createElement('div');
      list.setAttribute('role', 'listbox');
      list.setAttribute('data-generated-popup', '1');
      options.forEach((text) => {
        const option = doc.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = text;
        option.addEventListener('click', (event) => {
          event.stopPropagation();
          trigger.textContent = text;
          list.remove();
        });
        list.appendChild(option);
      });
      doc.body.appendChild(list);
    });
  });

  doc.querySelectorAll('[data-add-clone]').forEach((button) => {
    if (button.getAttribute('data-wired') === '1') return;
    button.setAttribute('data-wired', '1');
    button.addEventListener('click', () => {
      const template = doc.querySelector(button.getAttribute('data-add-clone'));
      if (!template) return;
      const clone = template.cloneNode(true);
      clone.querySelectorAll('input').forEach((input) => {
        input.value = '';
        if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
      });
      clone.querySelectorAll('textarea').forEach((area) => { area.textContent = ''; area.value = ''; });
      clone.querySelectorAll('select').forEach((select) => { select.selectedIndex = 0; });
      clone.querySelectorAll('[role="combobox"]').forEach((node) => {
        node.textContent = '';
        node.removeAttribute('data-wired');
      });
      template.parentNode.appendChild(clone);
      wireInteractions(window);
    });
  });
}

/* ------------------------------------------------------------------ */
/* 4. HTML 片段助手                                                    */
/* ------------------------------------------------------------------ */
const YEAR_OPTIONS = Array.from({ length: 21 }, (_, index) => String(2010 + index));
const MONTH_OPTIONS = ['12', '11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'];

/** 一个裸年月下拉：label 只有「年」或「月」，正是截图里那种结构 */
const bareDate = (part, mark = '') => `<div class="field"><label>${part}</label>`
  + `<select${mark ? ` data-k="${mark}"` : ''}><option value="">${part}</option>`
  + (part === '年' ? YEAR_OPTIONS : MONTH_OPTIONS).map((value) => `<option>${value}</option>`).join('')
  + '</select></div>';

/** 四段式起止时间（年 月 - 年 月） */
const dateRange = (markPrefix = '') => `<div class="date-range">`
  + bareDate('年', markPrefix ? `${markPrefix}-sy` : '')
  + bareDate('月', markPrefix ? `${markPrefix}-sm` : '')
  + '<span>-</span>'
  + bareDate('年', markPrefix ? `${markPrefix}-ey` : '')
  + bareDate('月', markPrefix ? `${markPrefix}-em` : '')
  + '</div>';

/** 一对年月（单一时间，如「获奖时间」） */
const dateSingle = (markPrefix = '') => `<div class="date-range">`
  + bareDate('年', markPrefix ? `${markPrefix}-y` : '')
  + bareDate('月', markPrefix ? `${markPrefix}-m` : '')
  + '</div>';

const textField = (label, mark = '') => `<div class="field"><label>${label}</label>`
  + `<input type="text"${mark ? ` data-k="${mark}"` : ''}></div>`;

const areaField = (label, mark = '') => `<div class="field"><label>${label}</label>`
  + `<textarea${mark ? ` data-k="${mark}"` : ''}></textarea></div>`;

const comboField = (label, options, mark = '') => `<div class="field"><label>${label}</label>`
  + `<div class="picker"><div role="combobox" data-options="${options.join('|')}"`
  + `${mark ? ` data-k="${mark}"` : ''}></div></div></div>`;

const selectField = (label, options, mark = '') => `<div class="field"><label>${label}</label>`
  + `<select${mark ? ` data-k="${mark}"` : ''}><option value="">请选择</option>`
  + options.map((value) => `<option>${value}</option>`).join('')
  + '</select></div>';

const section = (title, body, addSelector) => `<div class="section">`
  + `<div class="section-title">${title}</div><div class="rows">${body}</div>`
  + (addSelector ? `<button data-add-clone="${addSelector}">+ 添加</button>` : '')
  + '</div>';

const page = (body) => `<!doctype html><html><body><div class="form">${body}</div></body></html>`;

/** 项目行（严格照截图：起止时间 → 项目名称/职责 → 项目描述） */
const projectRow = (markPrefix, withCurrent = false) => `<div class="row">`
  + dateRange(markPrefix)
  + textField('项目名称', `${markPrefix}-title`)
  + textField('职责', `${markPrefix}-role`)
  + areaField('项目描述', `${markPrefix}-desc`)
  + (withCurrent ? `<input type="checkbox" id="${markPrefix}-cur"><label for="${markPrefix}-cur">至今</label>` : '')
  + '</div>';

/** 校内行（截图里叫「项目名称/担任角色/内容描述」） */
const campusRow = (markPrefix) => `<div class="row">`
  + `<div class="date-range">${bareDate('年', `${markPrefix}-sy`)}${bareDate('月', `${markPrefix}-sm`)}</div>`
  + `<div class="date-range">${bareDate('年', `${markPrefix}-ey`)}${bareDate('月', `${markPrefix}-em`)}</div>`
  + textField('项目名称', `${markPrefix}-title`)
  + textField('担任角色', `${markPrefix}-role`)
  + areaField('内容描述', `${markPrefix}-desc`)
  + '</div>';

/* ------------------------------------------------------------------ */
/* 5. ProfileData / 可编辑结构 助手                                    */
/* ------------------------------------------------------------------ */
function baseProfileData(overrides = {}) {
  return {
    basic: {
      fullName: '', gender: '', birthday: '', currentCity: '', city: '',
      idType: '', idNumber: '', phone: '', email: '', wechatId: '',
      githubUrl: '', personalWebsite: '', portfolioUrl: '', linkedinUrl: '',
      nativePlace: '', politicalStatus: '', currentAddress: '', hukouLocation: '',
      ethnicity: '',
      ...(overrides.basic || {}),
    },
    jobIntent: overrides.jobIntent || {},
    emergencyContacts: overrides.emergencyContacts || [],
    education: overrides.education || [],
    experience: overrides.experience || [],
    projects: overrides.projects || [],
    campusActivities: overrides.campusActivities || [],
    skills: overrides.skills || [],
    certificates: overrides.certificates || [],
    awards: overrides.awards || [],
    publications: overrides.publications || [],
    trainings: overrides.trainings || [],
    languages: overrides.languages || [],
    essays: overrides.essays || {},
  };
}

const makeEditable = ({ profile = {}, rows = {}, customFields = [] } = {}) => ({
  profile,
  rows: {
    education: [], internship: [], work: [], project: [], campus: [],
    certificates: [], awards: [], languages: [], publications: [],
    ...rows,
  },
  customFields,
});

const makeProjects = (count, overrides = {}) => Array.from({ length: count }, (_, index) => ({
  title: `项目${index + 1}号`,
  role: `角色${index + 1}`,
  start: `202${index % 5}-0${(index % 9) + 1}`,
  end: `202${index % 5}-1${index % 2}`,
  desc: `项目${index + 1}的描述第1行\n项目${index + 1}的描述第2行`,
  ...overrides,
}));

/* ------------------------------------------------------------------ */
/* 6. 断言                                                            */
/* ------------------------------------------------------------------ */
function readValue(el) {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return String(el.options[el.selectedIndex]?.text || '').trim();
  return String(el.value || el.textContent || '').replace(/\r/g, '').trim();
}

function runExpectations(window, expectations) {
  const doc = window.document;
  const problems = [];
  expectations.forEach((expect) => {
    // 自定义断言：拿到 window 自己判断（用于统计点击次数这类非 DOM 值）
    if (typeof expect.check === 'function') {
      const message = expect.check(window);
      if (message) problems.push(message);
      return;
    }
    const nodes = [...doc.querySelectorAll(expect.sel)];
    if (typeof expect.count === 'number') {
      if (nodes.length !== expect.count) {
        problems.push(`${expect.sel} 数量应为 ${expect.count}，实际 ${nodes.length}`);
      }
      return;
    }
    const nth = expect.nth ?? 0;
    const node = nodes[nth];
    if (!node) {
      problems.push(`${expect.sel} 第 ${nth + 1} 个不存在（共 ${nodes.length} 个）`);
      return;
    }
    if (expect.checked !== undefined) {
      if (Boolean(node.checked) !== expect.checked) {
        problems.push(`${expect.sel} 勾选态应为 ${expect.checked}，实际 ${node.checked}`);
      }
      return;
    }
    const actual = readValue(node);
    if (expect.contains) {
      if (!actual.includes(expect.contains)) {
        problems.push(`${expect.sel} 应包含「${expect.contains}」，实际「${actual}」`);
      }
      return;
    }
    if (expect.notEquals !== undefined && actual === expect.notEquals) {
      problems.push(`${expect.sel} 不应等于「${expect.notEquals}」`);
      return;
    }
    if (expect.eq !== undefined && actual !== expect.eq) {
      problems.push(`${expect.sel} 应为「${expect.eq}」，实际「${actual}」`);
    }
  });
  return problems;
}

/* ------------------------------------------------------------------ */
/* 7. 30 份案例                                                       */
/* ------------------------------------------------------------------ */
const CASES = [
  {
    name: '01 八个项目 + 只给一行 + 添加按钮 → 补齐 8 行并全部填写',
    html: page('<div class="section" id="projectSection"><div class="section-title">项目经验</div>'
      + `<div class="rows">${projectRow('p')}</div>`
      + '<button data-add-clone="#projectSection .row">+ 添加</button></div>'),
    editable: () => makeEditable({ rows: { project: makeProjects(8) } }),
    expect: [
      { sel: '#projectSection .row', count: 8 },
      { sel: '#projectSection .row:nth-child(1) [data-k="p-title"]', eq: '项目1号' },
      { sel: '#projectSection .row:nth-child(8) input[type="text"]', eq: '项目8号' },
      { sel: '#projectSection .row:nth-child(8) textarea', contains: '项目8的描述第1行' },
    ],
  },
  {
    name: '02 项目 8 条逐行核对：每一行都写上了项目名',
    html: page('<div class="section" id="projectSection"><div class="section-title">项目经验</div>'
      + `<div class="rows">${projectRow('p')}</div>`
      + '<button data-add-clone="#projectSection .row">+ 添加</button></div>'),
    editable: () => makeEditable({ rows: { project: makeProjects(8) } }),
    expect: [
      { sel: '#projectSection .row', count: 8 },
      { sel: '#projectSection .row:nth-child(2) [data-k="p-title"]', eq: '项目2号' },
      { sel: '#projectSection .row:nth-child(5) [data-k="p-title"]', eq: '项目5号' },
      { sel: '#projectSection .row:nth-child(7) [data-k="p-title"]', eq: '项目7号' },
    ],
  },
  {
    name: '03 分区隔离：项目条目绝不写进校内经历',
    html: page(
      `<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">${projectRow('p')}</div></div>`
      + `<div class="section" id="campusSec"><div class="section-title">校内经历</div><div class="rows">${campusRow('c')}</div></div>`,
    ),
    editable: () => makeEditable({
      rows: {
        project: makeProjects(1),
        campus: [{ title: '校内组织A', role: '部长', start: '2021-09', end: '2022-06', desc: '校内描述' }],
      },
    }),
    expect: [
      { sel: '[data-k="p-title"]', eq: '项目1号' },
      { sel: '[data-k="c-title"]', eq: '校内组织A' },
      { sel: '[data-k="c-role"]', eq: '部长' },
    ],
  },
  {
    name: '04 起止时间：年月共 4 个下拉 → 前两个开始、后两个结束',
    html: page(section('项目经验', projectRow('p'))),
    editable: () => makeEditable({
      rows: { project: [{ title: '甲项目', role: '负责人', start: '2023-06', end: '2024-11', desc: '描述' }] },
    }),
    expect: [
      { sel: '[data-k="p-sy"]', eq: '2023' },
      { sel: '[data-k="p-sm"]', eq: '6' },
      { sel: '[data-k="p-ey"]', eq: '2024' },
      { sel: '[data-k="p-em"]', eq: '11' },
    ],
  },
  {
    name: '05 获奖时间只有一对年月 → 也要点选填上（历史漏填点）',
    html: page('<div class="section" id="awardSec"><div class="section-title">获奖经历</div><div class="rows">'
      + `<div class="row">${dateSingle('a')}${textField('奖项名称', 'a-name')}</div></div></div>`),
    editable: () => makeEditable({ rows: { awards: [{ name: '校级一等奖', date: '2022-05' }] } }),
    expect: [
      { sel: '[data-k="a-y"]', eq: '2022' },
      { sel: '[data-k="a-m"]', eq: '5' },
      { sel: '[data-k="a-name"]', eq: '校级一等奖' },
    ],
  },
  {
    name: '06 姓名拆分：姓 / 名 两个框分别写',
    html: page(section('基本信息', textField('姓', 'surname') + textField('名', 'givenName'), null)),
    editable: () => makeEditable({ profile: { surname: '曹', givenName: '哲' } }),
    expect: [
      { sel: '[data-k="surname"]', eq: '曹' },
      { sel: '[data-k="givenName"]', eq: '哲' },
    ],
  },
  {
    name: '07 奖项名称不能被写成姓名（历史错填）',
    html: page('<div class="section" id="awardSec"><div class="section-title">获奖经历</div><div class="rows">'
      + `<div class="row">${textField('奖项名称', 'a-name')}</div></div></div>`),
    editable: () => makeEditable({ profile: { name: '曹哲', surname: '曹', givenName: '哲' }, rows: { awards: [{ name: '国家奖学金' }] } }),
    expect: [
      { sel: '[data-k="a-name"]', eq: '国家奖学金' },
      { sel: '[data-k="a-name"]', notEquals: '哲' },
    ],
  },
  {
    name: '08 论文名称 / 发表期刊 各归各位',
    html: page('<div class="section" id="pubSec"><div class="section-title">论文发表</div><div class="rows">'
      + `<div class="row">${textField('论文名称', 'p-name')}${textField('发表期刊', 'p-venue')}</div></div></div>`),
    editable: () => makeEditable({ rows: { publications: [{ name: '面向网申的自动填表方法', desc: '《计算机学报》' }] } }),
    expect: [
      { sel: '[data-k="p-name"]', eq: '面向网申的自动填表方法' },
      { sel: '[data-k="p-venue"]', contains: '计算机学报' },
    ],
  },
  {
    name: '09 性别用组件下拉（点开比对中文选项）',
    html: page(section('个人信息', comboField('性别', ['男', '女', '其他'], 'gender'), null)),
    editable: () => profileToChaoEditable(baseProfileData({ basic: { gender: 'male' } })),
    expect: [{ sel: '[data-k="gender"]', eq: '男' }],
  },
  {
    name: '10 政治面貌：档案 code → 中文，并且能被下拉选中',
    html: page(section('个人信息', selectField('政治面貌', ['群众', '共青团员', '中共党员'], 'political'), null)),
    editable: () => profileToChaoEditable(baseProfileData({ basic: { politicalStatus: 'league' } })),
    expect: [{ sel: '[data-k="political"]', eq: '共青团员' }],
  },
  {
    name: '11 民族 / 学历 中文枚举',
    html: page(section('个人信息',
      selectField('民族', ['汉族', '回族', '满族'], 'ethnicity')
      + selectField('学历', ['大专', '大学本科', '硕士研究生'], 'degree'), null)),
    editable: () => profileToChaoEditable(baseProfileData({
      basic: { ethnicity: 'han' },
      education: [{ school: '某大学', degreeLevel: 'bachelor', major: '计算机', startDate: '2020-09', endDate: '2024-06' }],
    })),
    expect: [
      { sel: '[data-k="ethnicity"]', eq: '汉族' },
      { sel: '[data-k="degree"]', contains: '本科' },
    ],
  },
  {
    name: '12 证件类型下拉只写类型，不写号码',
    html: page(section('个人信息',
      selectField('证件类型', ['居民身份证', '护照'], 'idType')
      + textField('证件号码', 'idNumber'), null)),
    editable: () => makeEditable({ profile: { idType: '居民身份证', idNumber: '110112200503130310' } }),
    expect: [
      { sel: '[data-k="idType"]', eq: '居民身份证' },
      { sel: '[data-k="idNumber"]', eq: '110112200503130310' },
    ],
  },
  {
    name: '13 证件号码左侧有窄下拉时，也不把号码塞进下拉',
    html: page(section('个人信息',
      '<div class="field"><label>证件号码</label><div class="id-row">'
      + '<select data-k="idType2"><option value="">请选择</option><option>居民身份证</option><option>护照</option></select>'
      + '<input type="text" data-k="idNumber2"></div></div>', null)),
    editable: () => makeEditable({ profile: { idType: '居民身份证', idNumber: '110112200503130310' } }),
    expect: [
      { sel: '[data-k="idType2"]', eq: '居民身份证' },
      { sel: '[data-k="idNumber2"]', eq: '110112200503130310' },
    ],
  },
  {
    name: '14 教育经历 3 条 + 添加按钮',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + `<div class="row">${textField('学校名称', 'e-school')}${textField('所学专业', 'e-major')}`
      + `${dateRange('e')}</div></div>`
      + '<button data-add-clone="#eduSec .row">+ 添加</button></div>'),
    editable: () => makeEditable({
      rows: {
        education: [
          { org: '甲大学', major: '软件工程', start: '2018-09', end: '2022-06' },
          { org: '乙大学', major: '人工智能', start: '2022-09', end: '2025-06' },
          { org: '丙大学', major: '计算机', start: '2025-09', end: '2028-06' },
        ],
      },
    }),
    expect: [
      { sel: '#eduSec .row', count: 3 },
      { sel: '#eduSec .row:nth-child(1) [data-k="e-school"]', eq: '甲大学' },
      { sel: '#eduSec .row:nth-child(3) [data-k="e-school"]', eq: '丙大学' },
    ],
  },
  {
    name: '15 实习经历 2 条：公司名称 / 职位名称 / 职责',
    html: page('<div class="section" id="intSec"><div class="section-title">实习经历</div><div class="rows">'
      + `<div class="row">${textField('公司名称', 'i-company')}${textField('职位名称', 'i-role')}`
      + `${areaField('工作职责', 'i-desc')}</div></div>`
      + '<button data-add-clone="#intSec .row">+ 添加</button></div>'),
    editable: () => makeEditable({
      rows: {
        internship: [
          { org: '外语教学与研究出版社', role: '技术开发岗', desc: '开发绘本AI推荐引擎' },
          { org: '北京海德利森科技有限公司', role: 'PLC/电气工程师', desc: '高压充注控制系统' },
        ],
      },
    }),
    expect: [
      { sel: '#intSec .row', count: 2 },
      { sel: '#intSec .row:nth-child(1) [data-k="i-company"]', eq: '外语教学与研究出版社' },
      { sel: '#intSec .row:nth-child(2) [data-k="i-role"]', eq: 'PLC/电气工程师' },
      { sel: '#intSec .row:nth-child(2) [data-k="i-desc"]', contains: '高压充注控制系统' },
    ],
  },
  {
    name: '16 语言能力 6 条：语言 / 等级 / 分数',
    html: page('<div class="section" id="langSec"><div class="section-title">语言能力</div><div class="rows">'
      + `<div class="row">${textField('语言', 'l-name')}${textField('等级', 'l-level')}${textField('分数', 'l-score')}</div></div>`
      + '<button data-add-clone="#langSec .row">+ 添加</button></div>'),
    editable: () => makeEditable({
      rows: {
        languages: [
          { language: '英语', level: 'CET-6', score: '580' },
          { language: '日语', level: 'N2', score: '120' },
          { language: '法语', level: 'B1', score: '' },
          { language: '德语', level: 'A2', score: '' },
          { language: '粤语', level: '母语', score: '' },
          { language: '普通话', level: '二级甲等', score: '' },
        ],
      },
    }),
    expect: [
      { sel: '#langSec .row', count: 6 },
      { sel: '#langSec .row:nth-child(1) [data-k="l-name"]', eq: '英语' },
      { sel: '#langSec .row:nth-child(6) [data-k="l-level"]', eq: '二级甲等' },
    ],
  },
  {
    name: '17 技能标签 / 自我评价 长文本写入',
    html: page(section('技能与评价',
      '<div class="field"><label>个人技能</label><input type="text" data-k="skills"></div>'
      + areaField('自我描述', 'advantages'), null)),
    editable: () => makeEditable({ profile: { skills: 'Python / TypeScript', advantages: '第一行优势\n第二行优势' } }),
    expect: [
      { sel: '[data-k="skills"]', eq: 'Python / TypeScript' },
      { sel: '[data-k="advantages"]', contains: '第一行优势' },
    ],
  },
  {
    name: '18 「至今」：档案在职时自动勾选复选框',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p', true) + '</div></div>'),
    editable: () => makeEditable({
      rows: { project: [{ title: '进行中的项目', role: '负责人', start: '2025-01', end: '至今', desc: '在做' }] },
    }),
    expect: [
      { sel: '#p-cur', checked: true },
    ],
  },
  {
    name: '19 没有任何标准分区标题：靠就近文本推断分区（不串区）',
    html: page('<div id="wrap"><div class="my-block-title">我的项目</div><div class="rows">'
      + `<div class="row">${textField('项目名称', 'x-title')}${textField('担任角色', 'x-role')}</div></div></div>`),
    editable: () => makeEditable({ rows: { project: [{ title: '无标题区项目', role: '成员' }] } }),
    expect: [
      { sel: '[data-k="x-title"]', eq: '无标题区项目' },
      { sel: '[data-k="x-role"]', eq: '成员' },
    ],
  },
  {
    name: '20 右侧导航目录含「项目经验」，不能被当成表单分区',
    html: page('<aside class="sidebar"><a class="menu-item">项目经验</a><a class="menu-item">校内经历</a></aside>'
      + section('项目经验', projectRow('p'))),
    editable: () => makeEditable({ rows: { project: makeProjects(1) } }),
    expect: [
      { sel: '[data-k="p-title"]', eq: '项目1号' },
    ],
  },
  {
    name: '21 已有值不覆盖',
    html: page(section('个人信息',
      '<div class="field"><label>邮箱</label><input type="text" data-k="email" value="keep@example.com"></div>'
      + '<div class="field"><label>手机号</label><input type="text" data-k="phone"></div>', null)),
    editable: () => makeEditable({ profile: { email: 'new@example.com', phone: '13800000000' } }),
    expect: [
      { sel: '[data-k="email"]', eq: 'keep@example.com' },
      { sel: '[data-k="phone"]', eq: '13800000000' },
    ],
  },
  {
    name: '22 站点预填 1 行时，游标跳过该行，从第 2 条档案继续',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + `<div class="row">${dateRange('p')}${textField('项目名称', '')}${textField('职责', '')}${areaField('项目描述', '')}</div>`
      + `<div class="row">${dateRange('q')}${textField('项目名称', 'q-title')}${textField('职责', '')}${areaField('项目描述', '')}</div>`
      + '</div></div>'),
    setup: (window) => {
      const rows = window.document.querySelectorAll('#projSec .row');
      const firstTitle = rows[0].querySelector('input[type="text"]');
      firstTitle.value = '站点已填的项目';
    },
    editable: () => makeEditable({ rows: { project: makeProjects(2) } }),
    expect: [
      { sel: '#projSec .row:nth-child(2) [data-k="q-title"]', eq: '项目2号' },
    ],
  },
  {
    name: '23 项目 8 条 + 校内 3 条 + 教育 2 条 混合页面',
    html: page(
      `<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">`
      + `<div class="row">${textField('学校名称', 'e-school')}${textField('所学专业', 'e-major')}</div></div>`
      + '<button data-add-clone="#eduSec .row">+ 添加</button></div>'
      + `<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">${projectRow('p')}</div>`
      + '<button data-add-clone="#projSec .row">+ 添加</button></div>'
      + `<div class="section" id="campusSec"><div class="section-title">校内经历</div><div class="rows">${campusRow('c')}</div>`
      + '<button data-add-clone="#campusSec .row">+ 添加</button></div>',
    ),
    editable: () => makeEditable({
      rows: {
        education: [
          { org: '甲大学', major: '软件工程' },
          { org: '乙大学', major: '人工智能' },
        ],
        project: makeProjects(8),
        campus: [
          { title: '校学生会', role: '部长' },
          { title: '辩论社', role: '社长' },
          { title: '志愿者协会', role: '成员' },
        ],
      },
    }),
    expect: [
      { sel: '#eduSec .row', count: 2 },
      { sel: '#projSec .row', count: 8 },
      { sel: '#campusSec .row', count: 3 },
      { sel: '#projSec .row:nth-child(8) [data-k="p-title"]', eq: '项目8号' },
      { sel: '#campusSec .row:nth-child(3) input[type="text"]', eq: '志愿者协会' },
    ],
  },
  {
    name: '24 长描述换行在 textarea 里保留',
    html: page(section('项目经验', projectRow('p'))),
    editable: () => makeEditable({
      rows: { project: [{ title: '换行项目', role: '负责人', start: '2024-01', end: '2024-06', desc: '第一行要点\n第二行要点\n第三行要点' }] },
    }),
    expect: [
      { sel: '[data-k="p-desc"]', contains: '第一行要点\n第二行要点' },
    ],
  },
  {
    name: '25 入学时间用原生 input[type=month]',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + '<div class="row"><div class="field"><label>入学时间</label><input type="month" data-k="e-start"></div>'
      + '<div class="field"><label>毕业时间</label><input type="month" data-k="e-end"></div></div></div></div>'),
    editable: () => makeEditable({ rows: { education: [{ org: '甲大学', start: '2020-09', end: '2024-06' }] } }),
    expect: [
      { sel: '[data-k="e-start"]', eq: '2020-09' },
      { sel: '[data-k="e-end"]', eq: '2024-06' },
    ],
  },
  {
    name: '26 求职意向 / 期望城市 / 期望薪资',
    html: page(section('求职意向',
      textField('期望职位', 'job') + textField('期望城市', 'city') + textField('期望薪资', 'salary'), null)),
    editable: () => makeEditable({ profile: { jobIntent: '前端工程师', expectedCity: '上海', expectedSalary: '25K' } }),
    expect: [
      { sel: '[data-k="job"]', eq: '前端工程师' },
      { sel: '[data-k="city"]', eq: '上海' },
      { sel: '[data-k="salary"]', eq: '25K' },
    ],
  },
  {
    name: '27 证书 4 条：证书名称 / 获得时间 / 发证机关',
    html: page('<div class="section" id="certSec"><div class="section-title">证书</div><div class="rows">'
      + `<div class="row">${textField('证书名称', 'c-name')}${dateSingle('c')}${textField('发证机关', 'c-issuer')}</div></div>`
      + '<button data-add-clone="#certSec .row">+ 添加</button></div>'),
    editable: () => makeEditable({
      rows: {
        certificates: [
          { name: 'CET-6', date: '2021-06', issuer: '教育部' },
          { name: '计算机二级', date: '2022-03', issuer: '教育部考试中心' },
          { name: '雅思', date: '2023-08', issuer: 'British Council' },
          { name: '普通话二甲', date: '2020-12', issuer: '语委' },
        ],
      },
    }),
    expect: [
      { sel: '#certSec .row', count: 4 },
      { sel: '#certSec .row:nth-child(4) input[type="text"]', eq: '普通话二甲' },
      { sel: '#certSec .row:nth-child(1) input[type="text"]', eq: 'CET-6' },
    ],
  },
  {
    name: '28 没有「添加」按钮时：不崩溃，至少把第一行填上',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p') + '</div></div>'),
    editable: () => makeEditable({ rows: { project: makeProjects(8) } }),
    expect: [
      { sel: '[data-k="p-title"]', eq: '项目1号' },
    ],
  },
  {
    name: '29 混合控件大页：下拉 + 组件 + 年月 + 文本 + 文本域',
    html: page(
      section('个人信息',
        textField('姓名', 'name')
        + selectField('性别', ['男', '女'], 'gender')
        + comboField('政治面貌', ['群众', '共青团员', '中共党员'], 'political')
        + textField('手机号', 'phone'), null)
      + '<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p') + '</div><button data-add-clone="#projSec .row">+ 添加</button></div>',
    ),
    editable: () => makeEditable({
      profile: { name: '曹哲', gender: '男', politicalStatus: '共青团员', phone: '15801166399' },
      rows: { project: makeProjects(2) },
    }),
    expect: [
      { sel: '[data-k="name"]', eq: '曹哲' },
      { sel: '[data-k="gender"]', eq: '男' },
      { sel: '[data-k="political"]', eq: '共青团员' },
      { sel: '[data-k="phone"]', eq: '15801166399' },
      { sel: '#projSec .row', count: 2 },
    ],
  },
  {
    name: '30 端到端：完整简历页（八项目 + 校内 + 教育 + 证书 + 奖项 + 论文 + 语言）',
    html: page(
      section('个人信息',
        textField('姓名', 'name') + comboField('性别', ['男', '女'], 'gender')
        + textField('手机号', 'phone') + textField('邮箱', 'email')
        + textField('所在城市', 'city') + textField('现居地址', 'address'), null)
      + `<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">`
      + `<div class="row">${textField('学校名称', 'e-school')}${textField('所学专业', 'e-major')}${dateRange('e')}</div></div>`
      + '<button data-add-clone="#eduSec .row">+ 添加</button></div>'
      + `<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">${projectRow('p')}</div>`
      + '<button data-add-clone="#projSec .row">+ 添加</button></div>'
      + `<div class="section" id="campusSec"><div class="section-title">校内经历</div><div class="rows">${campusRow('c')}</div>`
      + '<button data-add-clone="#campusSec .row">+ 添加</button></div>'
      + `<div class="section" id="certSec"><div class="section-title">证书</div><div class="rows">`
      + `<div class="row">${textField('证书名称', 'c-name')}${dateSingle('c')}</div></div>`
      + '<button data-add-clone="#certSec .row">+ 添加</button></div>'
      + `<div class="section" id="awardSec"><div class="section-title">获奖经历</div><div class="rows">`
      + `<div class="row">${dateSingle('a')}${textField('奖项名称', 'a-name')}</div></div>`
      + '<button data-add-clone="#awardSec .row">+ 添加</button></div>'
      + `<div class="section" id="pubSec"><div class="section-title">论文发表</div><div class="rows">`
      + `<div class="row">${textField('论文名称', 'pb-name')}${textField('发表期刊', 'pb-venue')}</div></div>`
      + '<button data-add-clone="#pubSec .row">+ 添加</button></div>'
      + `<div class="section" id="langSec"><div class="section-title">语言能力</div><div class="rows">`
      + `<div class="row">${textField('语言', 'l-name')}${textField('等级', 'l-level')}</div></div>`
      + '<button data-add-clone="#langSec .row">+ 添加</button></div>',
    ),
    editable: () => makeEditable({
      profile: {
        name: '曹哲', gender: '男', phone: '15801166399', email: 'a@b.com',
        city: '北京', address: '海淀区某路 1 号',
      },
      rows: {
        education: [
          { org: '甲大学', major: '软件工程', start: '2018-09', end: '2022-06' },
          { org: '乙大学', major: '人工智能', start: '2022-09', end: '2025-06' },
        ],
        project: makeProjects(8),
        campus: [
          { title: '校学生会', role: '部长' },
          { title: '辩论社', role: '社长' },
          { title: '志愿者协会', role: '成员' },
        ],
        certificates: [
          { name: 'CET-6', date: '2021-06' },
          { name: '计算机二级', date: '2022-03' },
        ],
        awards: [
          { name: '国家奖学金', date: '2023-10' },
          { name: '校级一等奖', date: '2022-05' },
        ],
        publications: [{ name: '自动填表方法研究', desc: '《计算机学报》' }],
        languages: [
          { language: '英语', level: 'CET-6' },
          { language: '日语', level: 'N2' },
        ],
      },
    }),
    expect: [
      { sel: '[data-k="name"]', eq: '曹哲' },
      { sel: '[data-k="gender"]', eq: '男' },
      { sel: '[data-k="email"]', eq: 'a@b.com' },
      { sel: '#eduSec .row', count: 2 },
      { sel: '#projSec .row', count: 8 },
      { sel: '#campusSec .row', count: 3 },
      { sel: '#certSec .row', count: 2 },
      { sel: '#awardSec .row', count: 2 },
      { sel: '#pubSec .row', count: 1 },
      { sel: '#langSec .row', count: 2 },
      { sel: '#projSec .row:nth-child(8) input[type="text"]', eq: '项目8号' },
      { sel: '#campusSec .row:nth-child(3) input[type="text"]', eq: '志愿者协会' },
      { sel: '#awardSec .row:nth-child(1) input[type="text"]', eq: '国家奖学金' },
    ],
  },
  /* ===== 以下 8 条对应本轮修复（31-38），每条都锁定一个曾经出错的场景 ===== */
  {
    name: '31 前段全失败不阻断：8 个匹配不上的下拉 + 后面项目区仍要填上',
    html: page(
      section('个人信息',
        selectField('户籍所在地省', ['北京', '上海'], 'q1')
        + selectField('户籍所在地市', ['北京市', '上海市'], 'q2')
        + selectField('现居住省', ['北京', '上海'], 'q3')
        + selectField('现居住市', ['北京市', '上海市'], 'q4')
        + selectField('最高学历', ['本科', '硕士'], 'q5')
        + selectField('专业成绩排名', ['前5%', '前20%'], 'q6')
        + selectField('在读异常情况', ['是', '否'], 'q7')
        + selectField('了解渠道', ['校招', '内推'], 'q8'), null)
      + '<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p') + '</div><button data-add-clone="#projSec .row">+ 添加</button></div>',
    ),
    editable: () => makeEditable({
      rows: { project: [{ title: '甲项目', role: '负责人', start: '2024-03', end: '2024-09', desc: '描述' }] },
    }),
    expect: [
      { sel: '[data-k="p-title"]', eq: '甲项目' },
      { sel: '[data-k="p-role"]', eq: '负责人' },
    ],
  },
  {
    name: '32 示例文案「例：XXXX」不算已填，要真正写进去',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + '<div class="row"><div class="field"><label>项目名称</label>'
      + '<div class="picker"><div role="combobox" id="fakeCombo" data-options="甲项目|乙项目">例：XXXX</div></div></div>'
      + '<div class="field"><label>职责</label><input type="text" placeholder="如：前端负责人" data-k="r"></div>'
      + '</div></div></div>'),
    editable: () => makeEditable({ rows: { project: [{ title: '甲项目', role: '前端负责人' }] } }),
    expect: [
      { sel: '#fakeCombo', eq: '甲项目' },
      { sel: '[data-k="r"]', eq: '前端负责人' },
    ],
  },
  {
    name: '33 空输入框包在 class 含 select 的容器里：不能当成已填',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + '<div class="row form-select"><div class="field el-select"><label>项目名称</label>'
      + '<input type="text" data-k="t1"></div></div>'
      + '<div class="row form-select"><div class="field el-select"><label>项目名称</label>'
      + '<input type="text" data-k="t2"></div></div>'
      + '</div></div>'),
    editable: () => makeEditable({ rows: { project: [{ title: '甲项目' }, { title: '乙项目' }] } }),
    expect: [
      { sel: '[data-k="t1"]', eq: '甲项目' },
      { sel: '[data-k="t2"]', eq: '乙项目' },
    ],
  },
  {
    name: '34 可输入的下拉组件（请输入就读学校 ⌄）：点选失败要回落文本输入',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + '<div class="row"><div class="field el-select"><label>学校名称</label>'
      + '<input type="text" data-k="school">'
      + '<i class="el-select__caret"></i></div>'
      + '<div class="field"><label>专业名称</label><input type="text" data-k="major"></div></div></div></div>'),
    editable: () => makeEditable({ rows: { education: [{ org: '甲大学', major: '软件工程' }] } }),
    expect: [
      { sel: '[data-k="school"]', eq: '甲大学' },
      { sel: '[data-k="major"]', eq: '软件工程' },
    ],
  },
  {
    name: '35 户籍/现居 省市四级联：四个下拉都要选中',
    html: page(section('个人信息',
      selectField('户籍所在地省', ['北京市', '广东省'], 'hk-province')
      + selectField('户籍所在地市', ['北京市', '深圳市'], 'hk-city')
      + selectField('现居住省', ['北京市', '广东省'], 'live-province')
      + selectField('现居住市', ['北京市', '深圳市'], 'live-city'), null)),
    editable: () => makeEditable({
      profile: {
        hukouProvince: '广东省', hukouCity: '深圳市',
        liveProvince: '北京市', liveCity: '北京市',
      },
    }),
    expect: [
      { sel: '[data-k="hk-province"]', eq: '广东省' },
      { sel: '[data-k="hk-city"]', eq: '深圳市' },
      { sel: '[data-k="live-province"]', eq: '北京市' },
      { sel: '[data-k="live-city"]', eq: '北京市' },
    ],
  },
  {
    name: '36 节奏：加一条 → 扫一次 → 填一条（点击添加的次数不超过档案条数）',
    html: page('<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p') + '</div>'
      + '<button id="addBtn" data-add-clone="#projSec .row">+ 添加</button></div>'),
    editable: () => makeEditable({
      rows: { project: [
        { title: '项目A' }, { title: '项目B' }, { title: '项目C' }, { title: '项目D' },
      ] },
    }),
    setup: (window) => {
      // 统计「添加」被点了几次，验证是交错节奏而不是先批量补完
      window.__addClicks = 0;
      window.document.getElementById('addBtn').addEventListener('click', () => {
        window.__addClicks += 1;
      });
    },
    expect: [
      { sel: '#projSec .row', count: 4 },
      { sel: '#projSec .row:nth-child(4) input[type="text"]', eq: '项目D' },
      {
        check: (window) => (window.__addClicks <= 4
          ? ''
          : `「添加」被点了 ${window.__addClicks} 次，超过档案条数 4，说明不是交错节奏`),
      },
    ],
  },
  {
    name: '37 跨区安全：项目区的添加键不能被实习区抢走',
    html: page(
      '<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + projectRow('p') + '</div><button data-add-clone="#projSec .row">+ 添加</button></div>'
      + '<div class="section" id="intSec"><div class="section-title">实习经历</div><div class="rows">'
      + `<div class="row">${textField('公司名称', 'i-company')}${textField('职位名称', 'i-role')}</div>`
      + '</div><button data-add-clone="#intSec .row">+ 添加</button></div>',
    ),
    editable: () => makeEditable({
      rows: {
        project: [{ title: '项目A' }, { title: '项目B' }],
        internship: [{ org: '甲公司', role: '开发' }],
      },
    }),
    expect: [
      { sel: '#projSec .row', count: 2 },
      { sel: '#intSec .row', count: 1 },
      { sel: '#projSec .row:nth-child(2) input[type="text"]', eq: '项目B' },
      { sel: '[data-k="i-company"]', eq: '甲公司' },
    ],
  },
  {
    name: '38 分区专属字段：学校所在地 / 部门 / 工作城市 / 技术栈',
    html: page(
      '<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + `<div class="row">${textField('学校名称', 'e-school')}${textField('学校所在地（城市）', 'e-city')}</div></div></div>`
      + '<div class="section" id="intSec"><div class="section-title">实习经历</div><div class="rows">'
      + `<div class="row">${textField('公司名称', 'i-company')}${textField('部门', 'i-dept')}`
      + `${textField('工作城市', 'i-city')}</div></div></div>`
      + '<div class="section" id="projSec"><div class="section-title">项目经验</div><div class="rows">'
      + `<div class="row">${textField('项目名称', 'p-title')}${textField('技术栈', 'p-tech')}</div></div></div>`,
    ),
    editable: () => makeEditable({
      rows: {
        education: [{ org: '甲大学', city: '北京市' }],
        internship: [{ org: '乙公司', department: '基础架构部', city: '上海市' }],
        project: [{ title: '丙项目', techStack: 'TypeScript / React' }],
      },
    }),
    expect: [
      { sel: '[data-k="e-city"]', eq: '北京市' },
      { sel: '[data-k="i-dept"]', eq: '基础架构部' },
      { sel: '[data-k="i-city"]', eq: '上海市' },
      { sel: '[data-k="p-tech"]', eq: 'TypeScript / React' },
    ],
  },
  /* ===== 39-46：本轮（时间/地区/补漏/换行）修复的锁定用例 ===== */
  {
    name: '39 意向工作城市：档案是三级拼串，页面只列「北京」→ 选「北京」而不是灌整串',
    html: page(section('申请信息',
      comboField('意向工作城市', ['北京', '上海'], 'city'), null)),
    editable: () => makeEditable({ profile: { expectedCity: '北京市 / 市辖区 / 朝阳区' } }),
    expect: [
      { sel: '[data-k="city"]', eq: '北京' },
      { sel: '[data-k="city"]', notEquals: '北京市 / 市辖区 / 朝阳区' },
    ],
  },
  {
    name: '40 意向工作城市：页面选项带「市」后缀 → 命中「北京市」',
    html: page(section('申请信息',
      comboField('意向工作城市', ['北京市', '上海市'], 'city'), null)),
    editable: () => makeEditable({ profile: { expectedCity: '北京市 / 市辖区 / 朝阳区' } }),
    expect: [{ sel: '[data-k="city"]', eq: '北京市' }],
  },
  {
    name: '41 基本信息区「毕业时间 年/月」：两个下拉都要检测并填上',
    html: page(section('个人信息',
      '<div class="field"><label>毕业时间</label><div class="date-range">'
      + bareDate('年', 'grad-y') + bareDate('月', 'grad-m')
      + '</div></div>', null)),
    editable: () => makeEditable({ profile: { educationEnd: '2026-08' } }),
    expect: [
      { sel: '[data-k="grad-y"]', eq: '2026' },
      { sel: '[data-k="grad-m"]', eq: '8' },
    ],
  },
  {
    name: '42 教育分区只有一对年月、容器写「毕业时间」→ 落到结束时间，不能写进开始时间',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + '<div class="row"><div class="field"><label>学校名称</label><input type="text" data-k="e-school"></div>'
      + '<div class="field"><label>毕业时间</label><div class="date-range">'
      + bareDate('年', 'grad-y') + bareDate('月', 'grad-m')
      + '</div></div></div></div></div>'),
    editable: () => makeEditable({
      rows: { education: [{ org: '甲大学', start: '2022-09', end: '2026-08' }] },
    }),
    expect: [
      { sel: '[data-k="e-school"]', eq: '甲大学' },
      { sel: '[data-k="grad-y"]', eq: '2026' },
      { sel: '[data-k="grad-m"]', eq: '8' },
    ],
  },
  {
    name: '43 教育行缺学历、基础信息有「大学本科」→ 单条档案时回落补上',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + '<div class="row"><div class="field"><label>学校名称</label><input type="text" data-k="e-school"></div>'
      + '<div class="field"><label>学历</label><select data-k="e-degree"><option value="">请选择</option>'
      + '<option>大专</option><option>大学本科</option><option>硕士研究生</option></select></div></div></div></div>'),
    editable: () => makeEditable({
      profile: { degree: '大学本科' },
      rows: { education: [{ org: '甲大学' }] },
    }),
    expect: [
      { sel: '[data-k="e-school"]', eq: '甲大学' },
      { sel: '[data-k="e-degree"]', eq: '大学本科' },
    ],
  },
  {
    name: '44 教育有 3 行时禁止回落：每行保持各自学校，不能把基础信息灌进每一行',
    html: page('<div class="section" id="eduSec"><div class="section-title">教育背景</div><div class="rows">'
      + `<div class="row">${textField('学校名称', 'e1')}${textField('专业名称', 'm1')}</div>`
      + `<div class="row">${textField('学校名称', 'e2')}${textField('专业名称', 'm2')}</div>`
      + `<div class="row">${textField('学校名称', 'e3')}${textField('专业名称', 'm3')}</div>`
      + '</div></div>'),
    editable: () => makeEditable({
      profile: { major: '软件工程' },
      rows: {
        education: [{ org: '甲大学' }, { org: '乙大学' }, { org: '丙大学' }],
      },
    }),
    expect: [
      { sel: '[data-k="e1"]', eq: '甲大学' },
      { sel: '[data-k="e2"]', eq: '乙大学' },
      { sel: '[data-k="e3"]', eq: '丙大学' },
      { sel: '[data-k="m1"]', eq: '' },
      { sel: '[data-k="m3"]', eq: '' },
    ],
  },
  {
    name: '45 档案里没有换行时，写入必须与档案逐字一致（不按符号补行）',
    html: page(section('个人信息',
      '<div class="field"><label>自我描述</label><textarea data-k="adv"></textarea></div>', null)),
    editable: () => makeEditable({
      profile: { advantages: '软硬结合人才 工控+AI+图纸建模无伤切岗 · 软件+架构 应用从架构选型到开发交付' },
    }),
    expect: [
      { sel: '[data-k="adv"]', eq: '软硬结合人才 工控+AI+图纸建模无伤切岗 · 软件+架构 应用从架构选型到开发交付' },
    ],
  },
  {
    name: '46 档案里连写 3 个换行时必须原样保留（不再被压成 2 个）',
    html: page(section('个人信息',
      '<div class="field"><label>自我描述</label><textarea data-k="adv"></textarea></div>', null)),
    editable: () => makeEditable({ profile: { advantages: '第一段\n\n\n第二段' } }),
    expect: [{ sel: '[data-k="adv"]', eq: '第一段\n\n\n第二段' }],
  },
];

/* ------------------------------------------------------------------ */
/* 8. 跑案例                                                          */
/* ------------------------------------------------------------------ */
const nameFilters = process.argv.slice(2);
const selectedCases = nameFilters.length
  ? CASES.filter((testCase) => nameFilters.some((filter) => testCase.name.startsWith(filter)))
  : CASES;

let passed = 0;
const failures = [];

for (const testCase of selectedCases) {
  const dom = new JSDOM(testCase.html, { url: 'https://example.com/apply' });
  const window = installGlobals(dom);
  try {
    wireInteractions(window);
    if (testCase.setup) testCase.setup(window);
    const editable = testCase.editable();
    // eslint-disable-next-line no-await-in-loop
    const result = await runChaoRuleAutofill(editable);
    const problems = runExpectations(window, testCase.expect);
    if (problems.length === 0) {
      passed += 1;
      console.log(`✅ ${testCase.name}`);
    } else {
      failures.push({ name: testCase.name, problems });
      console.log(`❌ ${testCase.name}`);
      problems.forEach((problem) => console.log(`     · ${problem}`));
      console.log(`     ── 引擎写入 ${result?.filled ?? '?'} 项，日志：`);
      (result?.debugLines || []).forEach((line) => console.log(`        ${line}`));
      if (result?.misses?.length) {
        console.log('     ── 漏填表：');
        result.misses.slice(0, 8).forEach((miss) => console.log(`        ${miss.label} ← ${miss.reason}`));
      }
    }
  } catch (error) {
    failures.push({ name: testCase.name, problems: [`抛异常：${error?.message || error}`] });
    console.log(`❌ ${testCase.name}（抛异常）`);
    console.log(`     · ${error?.stack || error}`);
  } finally {
    dom.window.close();
  }
}

console.log('');
console.log(`========== 结果：${passed}/${selectedCases.length} 通过 ==========`);
if (failures.length) {
  console.log(`未通过 ${failures.length} 个：`);
  failures.forEach((failure) => console.log(` - ${failure.name}`));
  process.exitCode = 1;
} else {
  console.log('全部通过');
}
