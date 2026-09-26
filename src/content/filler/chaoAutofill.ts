/**
 * 超你 offer（chaunyoffer）一键填写引擎——从案例 content.js 原样移植。
 * 规则路径：扫描字段 → 关键词匹配 → 边识别边写入 → 不够经历就点「添加」再填。
 * 不依赖 DeepSeek / 前置 FillPlan；档案由 profileToChao 转成 editable 后传入。
 */
// @ts-nocheck
import type { ChaoEditable } from './profileToChao';
import type { FillMiss } from '../../shared/types/fill';

/** 面板 id：案例里用来排除扩展自身 DOM；躺投无浮层面板，保留常量以免改匹配逻辑 */
const PANEL_ID = 'resume-autofill-panel';

const BASIC_FIELDS = [
  ['name','姓名','text'],['gender','性别','text'],['birthday','出生日期','date'],['city','所在城市','text'],['idType','证件类型','text'],['idNumber','证件号码','text'],
  ['phone','手机号','text'],['email','邮箱','text'],['wechat','微信号','text'],['github','GitHub','text'],['homepage','个人主页/博客','text'],['portfolio','个人作品集网站','text'],['website','个人网址','text'],['linkedin','LinkedIn','text'],['emergencyContact','紧急联系人','text'],['emergencyPhone','紧急联系方式','text'],['school','学校','text'],
  ['college','学院','text'],['major','专业','text'],['degree','学历','text'],['educationStart','入学时间','date'],['educationEnd','毕业时间','date'],['mainCourses','主修课程','textarea'],
  ['nativePlace','籍贯','text'],['politicalStatus','政治面貌','text'],['address','现居地址','text'],['jobIntent','求职意向','text'],['expectedCity','期望城市','text'],['expectedSalary','期望薪资','text'],['availableDate','到岗时间','text']
].map(([key,label,type]) => ({ key, label, type }));
const EXP_GROUPS = [
  { key:'internship', label:'实习经历', fields:[
    { key:'company', label:'公司名称', type:'text' },
    { key:'role', label:'职位', type:'text' },
    { key:'start', label:'开始时间', type:'date' },
    { key:'end', label:'结束时间', type:'date' },
    { key:'description', label:'描述', type:'textarea' }
  ]},
  { key:'project', label:'项目经历', fields:[
    { key:'title', label:'项目名称', type:'text' },
    { key:'role', label:'角色', type:'text' },
    { key:'start', label:'开始时间', type:'date' },
    { key:'end', label:'结束时间', type:'date' },
    { key:'description', label:'描述', type:'textarea' }
  ]},
  { key:'work', label:'工作经历', fields:[
    { key:'company', label:'公司名称', type:'text' },
    { key:'role', label:'职位', type:'text' },
    { key:'start', label:'开始时间', type:'date' },
    { key:'end', label:'结束时间', type:'date' },
    { key:'description', label:'描述', type:'textarea' }
  ]}
];
const MODULES = [
  { key:'skills', label:'技能标签', kind:'tags' },
  { key:'advantages', label:'个人优势', kind:'bullets' },
  { key:'certificates', label:'证书', kind:'records', fields:[['name','名称','text'],['date','时间','date'],['description','描述','textarea']] },
  { key:'awards', label:'奖项/获奖信息', kind:'records', fields:[['name','名称','text'],['date','时间','date'],['description','描述','textarea']] },
  { key:'academicWorks', label:'学术成果', kind:'records', fields:[['name','成果名称','text'],['date','发布时间','date'],['description','描述','textarea']] },
  { key:'languages', label:'语言能力', kind:'records', fields:[['language','语言','text'],['level','等级','text'],['score','分数','text']] },
  { key:'campusExperience', label:'校园经历', kind:'records', fields:[['name','名称','text'],['role','角色','text'],['start','开始时间','date'],['end','结束时间','date'],['description','描述','textarea']] },
  { key:'otherInfo', label:'其他扩展字段', kind:'bullets' }
].map((m) => m.fields ? ({ ...m, fields: m.fields.map(([key,label,type]) => ({ key, label, type })) }) : m);

const truncate = (t, n = 50) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '...' : s;
};
const normalizeDate = (value) => {
  if (!value) return '';
  if (/^(至今|present)$/i.test(String(value).trim())) return '至今';
  const compact = String(value).replace(/[年./]/g, '-').replace(/月/g, '').replace(/日/g, '');
  const m = compact.match(/(\d{2,4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!m) return String(value).trim();
  const yearRaw = m[1];
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${m[2].padStart(2, '0')}-${(m[3] || '01').padStart(2, '0')}`;
};

const isEditable = (el) =>
  el &&
  (el.isContentEditable ||
    el.tagName?.toLowerCase() === 'textarea' ||
    (el.tagName?.toLowerCase() === 'input' &&
      !['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type)));

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** 轻量进度条：挂页面 body，不依赖案例面板 toast */
function toastProgress(msg, _opts = {}) {
  let tip = document.getElementById('tangtou-chao-progress');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tangtou-chao-progress';
    tip.style.cssText =
      'position:fixed;z-index:2147483646;left:50%;top:16px;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:#111;color:#fff;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:90vw;';
    document.body.appendChild(tip);
  }
  tip.textContent = msg;
  return {
    update(next) {
      if (tip) tip.textContent = next;
    },
    done(finalMsg) {
      if (!tip) return;
      tip.textContent = finalMsg;
      setTimeout(() => tip?.remove(), 2200);
    },
  };
}

function ensureChaoHighlightStyles() {
  if (document.getElementById('tangtou-chao-autofill-style')) return;
  const style = document.createElement('style');
  style.id = 'tangtou-chao-autofill-style';
  style.textContent = `
    .raf-autofill-filled { outline: 2px solid #22c55e !important; outline-offset: 1px; }
    .raf-autofill-missed { outline: 2px solid #f59e0b !important; outline-offset: 1px; }
  `;
  document.documentElement.appendChild(style);
}


const AUTOFILL_FILL_CLASS = 'raf-autofill-filled';
const AUTOFILL_MISS_CLASS = 'raf-autofill-missed';
// 命中时取「最长关键词」得分最高的规则；分数相同排前面的规则优先
const AUTOFILL_RULES = [
  { key: 'emergencyPhone', words: ['紧急联系电话', '紧急联系方式'] },
  { key: 'emergencyContact', words: ['紧急联系人'] },
  { key: 'idType', words: ['证件类型'] },
  { key: 'idNumber', words: ['证件号码', '证件号', '身份证号', '身份证', 'idnumber', 'id number'] },
  { key: 'phone', words: ['手机号码', '手机号', '联系电话', '联系方式', '电话', '手机', 'mobile', 'phone', 'tel'], block: ['紧急', '证明'] },
  { key: 'email', words: ['电子邮箱', '电子邮件', '邮箱', 'email', 'e-mail', 'mail'] },
  { key: 'name', words: ['真实姓名', '姓名', '名字', 'fullname', 'full name', 'realname', 'name'], block: ['用户名', '昵称', 'nickname', 'username', '公司', '企业', '学校', 'company', 'school', '项目', 'project', '紧急', '证明', '联系人', '导师'] },
  { key: 'gender', words: ['性别', 'gender', 'sex'] },
  { key: 'birthday', words: ['出生日期', '出生年月', '生日', '出生', 'birthday', 'birth', 'date of birth'] },
  { key: 'nativePlace', words: ['籍贯'] },
  { key: 'politicalStatus', words: ['政治面貌'] },
  { key: 'expectedCity', words: ['期望城市', '意向城市', '工作城市'] },
  { key: 'city', words: ['所在城市', '现居城市', '居住城市', '城市', 'city', 'location'] },
  { key: 'address', words: ['现居地址', '居住地址', '详细地址', '通讯地址', '联系地址', '地址', 'address'] },
  { key: 'expectedSalary', words: ['期望薪资', '薪资要求', '期望月薪', '期望年薪', '薪资', '月薪', '年薪', 'salary'] },
  { key: 'availableDate', words: ['最早可入职', '可入职时间', '可到岗时间', '期望入职时间', '到岗时间', '最快到岗', '可到岗'] },
  { key: 'jobIntent', words: ['求职意向', '意向岗位', '意向职位', '期望职位', '应聘职位', '应聘岗位', '申请职位'] },
  { key: 'degree', words: ['最高学历', '学历', '学位', 'degree'] },
  { key: 'school', words: ['毕业院校', '毕业学校', '就读学校', '学校', '院校', 'university', 'school'], block: ['绩点', '满绩', '排名'] },
  { key: 'college', words: ['院系', '学院', 'college'] },
  { key: 'major', words: ['所学专业', '专业', 'major'] },
  { key: 'educationStart', words: ['入学时间', '入学日期'] },
  { key: 'educationEnd', words: ['毕业时间', '毕业日期'] },
  { key: 'mainCourses', words: ['主修课程', '主修', 'courses'] },
  { key: 'wechat', words: ['微信号', '微信', 'wechat', 'weixin'] },
  { key: 'github', words: ['github'] },
  { key: 'linkedin', words: ['linkedin', '领英'] },
  { key: 'portfolio', words: ['作品集', 'portfolio'] },
  { key: 'homepage', words: ['个人主页', '个人博客', '博客', '主页', 'homepage', 'blog'] },
  { key: 'website', words: ['个人网站', '个人网址', '网址', 'website'] },
  { key: 'skills', words: ['技能标签', '专业技能', '技能', 'skills', 'skill'] },
  { key: 'advantages', words: ['自我评价', '个人优势', '自我介绍', '个人简介', '自我描述', '个人评价', 'about me', 'summary'] },
  // ===== 经历块字段（实习/工作/项目共用，填哪段由块聚类决定） =====
  { key: 'expCompany', words: ['公司名称', '单位名称', '企业名称', '实习单位', '工作单位', '所在公司', '公司', '单位', 'company'], block: ['紧急', '联系'] },
  { key: 'expTitle', words: ['项目名称', '项目名', 'project name', 'project'] },
  { key: 'expRole', words: ['担任职位', '职位名称', '岗位名称', '担任角色', '职位', '岗位', '角色', 'position', 'role'] },
  { key: 'expStart', words: ['开始时间', '起始时间', '开始日期', '入职时间', '起止时间', '任职时间', '在校时间', '实习时间', '项目时间', '工作时间', '就读时间', 'start'], block: ['最早可入职', '可入职', '可到岗', '到岗', '最早'] },
  { key: 'expEnd', words: ['结束时间', '结束日期', '离职时间', '截止时间', 'end'] },
  { key: 'expDesc', words: ['工作描述', '工作内容', '岗位职责', '职责描述', '工作职责', '职责', '项目描述', '实习描述', '经历描述', '描述', 'description'] }
];
function clearAutofillHighlights() {
  document.querySelectorAll(`.${AUTOFILL_FILL_CLASS}, .${AUTOFILL_MISS_CLASS}`).forEach((el) => el.classList.remove(AUTOFILL_FILL_CLASS, AUTOFILL_MISS_CLASS));
}
function isPageFieldVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function fieldLabelBlob(el) {
  const parts = [];
  const push = (v) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); if (s && s.length <= 60) parts.push(s); };
  push(el.getAttribute('aria-label'));
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) labelledBy.split(/\s+/).forEach((id) => push(document.getElementById(id)?.textContent));
  if (el.id) { try { push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent); } catch {} }
  push(el.closest('label')?.textContent);
  push(el.getAttribute('placeholder'));
  push(el.getAttribute('data-placeholder'));
  // 前序兄弟文本：必须含中文或字母且长度≥2，排除范围选择器中间的「-」分隔符（否则循环会提前 break）
  const pushPrevText = (node) => {
    if (!node || isEditable(node) || node.querySelector('input, textarea, select, [contenteditable]')) return;
    const t = node.textContent.replace(/\s+/g, '');
    if (t.length >= 2 && t.length <= 60 && /[\u4e00-\u9fa5a-zA-Z]/.test(t)) push(node.textContent);
  };
  pushPrevText(el.previousElementSibling);
  // el-form / ant-form 这类组件库：label 与输入框是兄弟分支，向上找就近祖先里的 label 文字
  // 直接子 label 任何层级都可信；[class*=label]/div>label 只在 form-item 类容器里采信，防止爬到 body 串到别的字段
  // 最后兜底：祖先里「不含输入框、文字很短」的兄弟元素大概率就是 label（覆盖无 label 标签、无 label class 的站点）
  let host = el.parentElement;
  for (let d = 0; host && d < 4; d += 1, host = host.parentElement) {
    const before = parts.length; // 只有本层循环真的加了内容才停，placeholder 不算
    let labEl = host.querySelector(':scope > label');
    if (!labEl && /(form|field|item|group|control|content)/i.test(host.getAttribute('class') || '')) {
      labEl = host.querySelector(':scope > [class*="label" i], :scope > div > label');
    }
    if (!labEl) {
      // 必须含中文或字母且长度≥2：排除范围选择器中间的「-」分隔符这类纯符号节点
      labEl = [...host.children].find((c) => !c.contains(el)
        && !c.querySelector('input, textarea, select, [contenteditable]')
        && (() => { const t = c.textContent.replace(/\s+/g, ''); return t.length >= 2 && t.length <= 24 && /[\u4e00-\u9fa5a-zA-Z]/.test(t); })());
    }
    if (labEl && !labEl.contains(el)) push(labEl.textContent);
    pushPrevText(host.previousElementSibling);
    if (parts.length > before) break;
  }
  // name/id 是弱信号，放最后兜底
  push(el.getAttribute('name'));
  push(el.id);
  return parts.join(' ');
}
// 只读字段一般是展示态要跳过，但自定义下拉/日期组件的输入框也是只读的——这些「组件触发器」要纳入扫描
function isWidgetTrigger(el) {
  if (el.getAttribute('aria-haspopup')) return true;
  if (el.closest('[class*="select" i], [class*="picker" i], [class*="dropdown" i], [class*="cascader" i]')) return true;
  return /(日期|时间|生日|date|time)/i.test(fieldLabelBlob(el));
}
// skipped（可选）：收集被排除的字段及原因，写进诊断报告
function scanPageFields(skipped) {
  const fields = [];
  document.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"], [contenteditable=""]').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest(`#${PANEL_ID}`)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'file', 'password', 'image', 'reset', 'range', 'color'].includes(type)) return;
    }
    const skip = (reason) => { skipped?.push({ reason, blob: fieldLabelBlob(el) || el.getAttribute('placeholder') || el.getAttribute('name') || tag }); };
    if (el.disabled) { skip('禁用'); return; }
    let kind = tag === 'select' ? 'select' : 'text';
    if (tag !== 'select') {
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) kind = 'widget';
      else if (el.readOnly) {
        if (!isWidgetTrigger(el)) { skip('只读'); return; }
        kind = 'widget';
      }
    }
    if (!isPageFieldVisible(el)) { skip('不可见'); return; }
    // 已有内容的字段不覆盖
    if (tag === 'select') { if (el.value && el.selectedIndex > 0) { skip('已有值'); return; } }
    else if (el.isContentEditable) { if (el.textContent.trim()) { skip('已有值'); return; } }
    else if (String(el.value || '').trim()) { skip('已有值'); return; }
    const blob = fieldLabelBlob(el);
    if (!blob) { skip('无上下文'); return; } // 没有任何上下文线索的字段匹配不了，也不标橙制造噪音
    fields.push({ el, tag, kind, blob });
  });
  return fields;
}
function buildAutofillValues(editable) {
  const profile = editable?.profile || {};
  const labelOf = {};
  BASIC_FIELDS.forEach((f) => { labelOf[f.key] = f.label; });
  MODULES.forEach((m) => { labelOf[m.key] = m.label; });
  const values = Object.keys(profile)
    .map((key) => ({ key, label: labelOf[key] || key, value: String(profile[key] || '').trim() }))
    .filter((x) => x.value);
  // 扩展字段：有内容才可填；标题给 AI/规则做语义匹配，没标题用内容摘要代替
  (editable?.customFields || []).forEach((cf, i) => {
    const content = String(cf?.content || '').trim();
    if (!content) return;
    const title = String(cf?.title || '').trim();
    values.push({ key: `custom_${i}`, label: title || truncate(content, 10), value: content });
  });
  return values;
}
function matchAutofillKey(blob, values, extraRules = []) {
  const text = String(blob || '').toLowerCase();
  if (!text) return null;
  const available = values instanceof Set ? values : new Set(values.map((v) => v.key));
  let best = null, bestScore = 0;
  // extraRules（扩展字段的标题）排在前面：同分时用户自定义规则优先
  [...extraRules, ...AUTOFILL_RULES].forEach((rule) => {
    if (!available.has(rule.key)) return;
    if (rule.block?.some((w) => text.includes(w))) return;
    rule.words.forEach((word) => {
      if (word.length > bestScore && text.includes(word)) { best = rule.key; bestScore = word.length; }
    });
  });
  return best;
}
function fillSelectOption(el, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  const options = [...el.options].filter((o) => o.text.trim() || o.value.trim());
  const hit = options.find((o) => o.text.trim().toLowerCase() === v || o.value.trim().toLowerCase() === v)
    || options.find((o) => { const t = o.text.trim().toLowerCase(); return t.length >= 2 && (t.includes(v) || v.includes(t)); });
  if (!hit) return false;
  el.value = hit.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function fillPageField(el, value) {
  const v = String(value || '').trim();
  if (!v || v === '至今') return false;
  if (el.tagName.toLowerCase() === 'select') return fillSelectOption(el, v);
  if (el.isContentEditable) {
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, v);
    return true;
  }
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  let out = v;
  if (type === 'date') { const d = normalizeDate(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false; out = d; }
  if (type === 'month') { const d = normalizeDate(v); if (!/^\d{4}-\d{2}/.test(d)) return false; out = d.slice(0, 7); }
  setNativeValue(el, out);
  // 日期值校验：控件把日期改写成了不含年份的碎片（如只留个月份数字）→ 清空按失败处理（宁缺勿错）
  if (/^\d{4}/.test(out) && !String(el.value || '').includes(out.slice(0, 4))) {
    setNativeValue(el, '');
    return false;
  }
  return true;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 组件填充：日期类——先点开组件，摘掉 readonly 再写入（组件会当作用户打字解析），Enter/blur 提交后恢复 readonly
async function fillWidgetDate(el, value) {
  const d = normalizeDate(value);
  el.scrollIntoView({ block: 'center' });
  el.click();
  await sleep(150);
  const wasReadOnly = el.readOnly;
  if (wasReadOnly) el.removeAttribute('readonly');
  el.focus();
  setNativeValue(el, d);
  ['keydown', 'keypress', 'keyup'].forEach((t) => el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
  el.blur();
  await sleep(100);
  if (wasReadOnly) el.setAttribute('readonly', '');
  // 判定成功：值里必须有 4 位年份（防止组件拒绝后残留 '1' 这类碎片被误判成功）
  return /(19|20)\d{2}/.test(String(el.value || ''));
}
// 组件填充：选项类——点开 → 在弹层里按文本匹配选项 → 点击；失败 Esc 关闭
async function fillWidgetByOption(el, value) {
  const v = String(value || '').trim().toLowerCase();
  el.scrollIntoView({ block: 'center' });
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.click();
  await sleep(300);
  const containers = [...document.querySelectorAll('[role="listbox"], [role="menu"], [class*="dropdown" i], [class*="select" i], [class*="picker" i], [class*="popper" i], [class*="cascader" i]')]
    .filter((c) => c instanceof HTMLElement && !c.closest(`#${PANEL_ID}`) && isPageFieldVisible(c));
  let options = [];
  containers.forEach((c) => c.querySelectorAll('[role="option"], li, [class*="option" i], [class*="item" i]').forEach((o) => options.push(o)));
  if (!options.length) options = [...document.querySelectorAll('[role="option"]')];
  const seen = new Set();
  const norm = (o) => o.textContent.replace(/\s+/g, ' ').trim();
  const candidates = options.filter((o) => {
    if (!(o instanceof HTMLElement) || seen.has(o) || o.closest(`#${PANEL_ID}`)) return false;
    seen.add(o);
    if (!isPageFieldVisible(o)) return false;
    const t = norm(o);
    return t && t.length <= 24 && o.children.length <= 3;
  });
  const hit = candidates.find((o) => norm(o).toLowerCase() === v)
    || candidates.find((o) => { const t = norm(o).toLowerCase(); return t.length >= 2 && (t.includes(v) || v.includes(t)); });
  if (hit) {
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    hit.click();
    await sleep(120);
    return true;
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.body.click();
  return false;
}
async function fillWidgetField(el, value) {
  const v = String(value || '').trim();
  if (!v || v === '至今') return false;
  const isDate = /^\d{4}-\d{2}/.test(normalizeDate(v));
  if (isDate && (el.tagName.toLowerCase() === 'input' || el.isContentEditable)) return fillWidgetDate(el, v);
  // 起止时间这类范围选择：单个输入框吃不下两个日期，直接放弃标橙
  if (isDate) return false;
  return fillWidgetByOption(el, v);
}
async function fillFieldAuto(field, value) {
  if (field.kind === 'widget') return fillWidgetField(field.el, value);
  return fillPageField(field.el, value);
}
// ===== 裸日期控件（年/月/日）归类：Moka 这类站点的时间选择是独立的年/月下拉，label 只有光秃秃的「年」「月」=====
// 按「包含 ≥2 个裸日期控件的最小祖先」分组：组内 ≥4 个（偶数）→ 前一半=开始时间、后一半=结束时间；
// 2-3 个 → 看容器文案：含 开始/入学 类词=开始时间，含 结束/毕业 类词=结束时间；两类词都有或都没有则不乱填
const BARE_DATE_RE = /^(年|月|日)$/;
const DATE_START_WORDS = /(开始|起始|入学|入职)/;
const DATE_END_WORDS = /(结束|截止|毕业|离职)/;
function classifyBareDateParts(fields) {
  const bare = fields.filter((f) => BARE_DATE_RE.test(f.blob.replace(/\s+/g, '')));
  const result = new Map();
  if (!bare.length) return result;
  const groups = new Map();
  bare.forEach((f) => {
    let node = f.el.parentElement;
    for (let d = 0; node && d < 5; d += 1, node = node.parentElement) {
      if (bare.filter((b) => node.contains(b.el)).length >= 2) {
        if (!groups.has(node)) groups.set(node, []);
        groups.get(node).push(f);
        return;
      }
    }
  });
  groups.forEach((members, node) => {
    members.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
  });
  // 开始组/结束组各有一层包装时（如 [年 月] - [年 月]），最小容器只能圈到 2 个成员且没有关键词。
  // 相邻小组向上看公共祖先：恰好只含这两组裸日期控件且文本很短（≤30 字，防止跨经历块误并）→ 并为一组
  const groupList = [...groups.entries()];
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < groupList.length && !didMerge; i += 1) {
      for (let j = i + 1; j < groupList.length && !didMerge; j += 1) {
        const [nodeA, memA] = groupList[i];
        const [nodeB, memB] = groupList[j];
        let lca = nodeA.parentElement;
        for (let d = 0; lca && d < 6 && !lca.contains(nodeB); d += 1, lca = lca.parentElement) {}
        if (!lca) continue;
        const union = [...memA, ...memB];
        if (union.length > 6) continue;
        if (bare.filter((b) => lca.contains(b.el)).length !== union.length) continue;
        if (String(lca.textContent || '').replace(/\s+/g, '').length > 30) continue;
        groupList.splice(j, 1);
        groupList[i] = [lca, union];
        didMerge = true;
      }
    }
  }
  new Map(groupList).forEach((members, node) => {
    members.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const ctx = String(node.textContent || '').replace(/\s+/g, '');
    const hasStart = DATE_START_WORDS.test(ctx);
    const hasEnd = DATE_END_WORDS.test(ctx);
    let subs = null;
    if (members.length >= 4 && members.length % 2 === 0) {
      const half = members.length / 2;
      subs = members.map((_, i) => (i < half ? 'expStart' : 'expEnd'));
    } else if (hasStart && !hasEnd) subs = members.map(() => 'expStart');
    else if (hasEnd && !hasStart) subs = members.map(() => 'expEnd');
    if (!subs) return;
    members.forEach((f, i) => {
      const label = f.blob.replace(/\s+/g, '');
      result.set(f.el, { sub: subs[i], part: label === '年' ? 'year' : label === '月' ? 'month' : 'day' });
    });
  });
  return result;
}
// 完整日期按控件角色截取：年控件拿 '2023'；月控件拿 '6'（不补零，兼容 '6月'/'06' 两种选项文案）
function datePartValue(value, part) {
  const d = normalizeDate(value);
  if (!/^\d{4}-\d{2}/.test(d)) return '';
  if (part === 'year') return d.slice(0, 4);
  if (part === 'month') return String(Number(d.slice(5, 7)));
  if (part === 'day') return d.length >= 10 ? String(Number(d.slice(8, 10))) : '';
  return d;
}
// ===== 经历块：聚类 → 判型 → 按条目填充 → 自动点「添加」扩块 =====
const EXP_RULE_KEYS = ['expCompany', 'expTitle', 'expRole', 'expStart', 'expEnd', 'expDesc'];
// 已填入的经历块轨迹（文档顺序）：二次扫描补出的单独日期框（如开始日期填完才出现的结束框）按就近原则归到前面最近的经历块
let anchoredTrail = [];
const EXP_SUB_LABELS = { expCompany: '公司', expTitle: '项目名', expRole: '职位', expStart: '开始时间', expEnd: '结束时间', expDesc: '描述' };
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dbgLine = (icon, blob, note) => `${icon} 「${escHtml(truncate(blob, 24))}」${note}`;
const EXP_TYPE_KEYWORDS = { internship: ['实习'], work: ['工作', '全职'], project: ['项目'] };
function buildExpEntries(editable) {
  const entries = [];
  ['internship', 'work', 'project'].forEach((type) => {
    (editable?.experiences?.[type] || []).forEach((item, index) => {
      if (!Object.values(item || {}).some((v) => String(v || '').trim())) return;
      // 数据护栏：开始时间晚于结束时间（解析颠倒）→ 自动交换，避免填出「开始>结束」
      const it = { ...item };
      const s = normalizeDate(it.start);
      const e = normalizeDate(it.end);
      if (s && e && e !== '至今' && s > e) { it.start = e; it.end = s; }
      entries.push({ type, index, data: it });
    });
  });
  return entries;
}
function expEntryValue(entry, sub) {
  const d = entry?.data || {};
  if (sub === 'expCompany') return String(d.company || d.title || '').trim();
  if (sub === 'expTitle') return String(d.title || d.company || '').trim();
  if (sub === 'expRole') return String(d.role || '').trim();
  if (sub === 'expStart') return String(d.start || '').trim();
  if (sub === 'expEnd') return String(d.end || '').trim();
  if (sub === 'expDesc') return String(d.description || '').trim();
  return '';
}
// 用块的最近公共祖先（再向上 3 层）的文字判断经历类型（实习/工作/项目），容器太大放弃
function detectExpBlockType(block) {
  let node = block[0].field.el.parentElement;
  while (node && !block.every(({ field }) => node.contains(field.el))) node = node.parentElement;
  for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
    const text = node.textContent.replace(/\s+/g, '');
    if (text.length > 1200) continue;
    for (const [type, words] of Object.entries(EXP_TYPE_KEYWORDS)) {
      if (words.some((w) => text.includes(w))) return type;
    }
  }
  return null;
}
// 按文档顺序聚块：遇到 公司/项目名（锚点）或同名字段重复出现就开新块；没有锚点的块不吸收后续字段
// 起止时间是两个输入框（开始/结束）且共用一个标签时，两个框都会匹配 expStart——把同块里第二个转成 expEnd
function clusterExpBlocks(expFieldEntries) {
  const hasAnchor = (block) => block.some((x) => x.sub === 'expCompany' || x.sub === 'expTitle');
  const blocks = [];
  expFieldEntries.forEach((raw) => {
    const item = { ...raw };
    const last = blocks[blocks.length - 1];
    const isAnchor = item.sub === 'expCompany' || item.sub === 'expTitle';
    if (!item.part && last && item.sub === 'expStart' && hasAnchor(last)
      && last.some((x) => x.sub === 'expStart') && !last.some((x) => x.sub === 'expEnd')) {
      item.sub = 'expEnd';
    }
    // 年/月控件同 sub 不算重复（sub 相同但 part 不同）；一个块里常有多个描述类文本域（职责/项目描述/项目中职责），都填同一段描述，不拆块
    const dup = last && (item.part
      ? last.some((x) => x.sub === item.sub && x.part === item.part)
      : item.sub === 'expDesc'
        ? false
        : last.some((x) => x.sub === item.sub));
    // 纯裸日期块：起止时间在块顶部的版式（Moka），年/月组先于公司/项目名出现
    const lastPureDates = !!(last && !hasAnchor(last) && last.every((x) => x.part));
    // 前一个锚定块还没有任何时间字段 → 尾部跟随的日期属于它（起止时间在块底部的版式）
    const lastNeedsDates = !!(last && hasAnchor(last) && !last.some((x) => x.sub === 'expStart' || x.sub === 'expEnd'));
    let startsNew;
    if (!last) startsNew = true;
    else if (item.part) startsNew = !(lastPureDates || lastNeedsDates);
    else if (isAnchor) startsNew = !lastPureDates; // 锚点前面若是同组裸日期 → 并入组成完整块
    else startsNew = dup || !hasAnchor(last);
    if (startsNew) blocks.push([item]);
    else last.push(item);
  });
  return blocks;
}
function takeExpEntry(expEntries, consumed, preferredType) {
  if (preferredType) {
    const typed = expEntries.find((e) => e.type === preferredType && !consumed.has(e));
    if (typed) return typed;
  }
  return expEntries.find((e) => !consumed.has(e)) || null;
}
async function fillExpBlocks(expFieldEntries, expEntries, consumed, missed, basicValueOf, dbg = []) {
  let count = 0;
  const blocks = clusterExpBlocks(expFieldEntries);
  let blockIndex = 0;
  let lastLoneEffSub = null; // 上一个无锚日期字段的有效 sub：连续两个 expStart 时第二个转 expEnd（教育起止对）
  for (const block of blocks) {
    const anchored = block.some((x) => x.sub === 'expCompany' || x.sub === 'expTitle');
    if (!anchored) {
      // 没有公司/项目名的日期块：前面有已填经历块 → 就近归到该块（二次扫描补出的结束框）；
      // 否则多半是教育经历 → 回落到基础字段的入学/毕业时间（blob 必须像日期才回落，防长文本误判）
      for (const x of block) {
        const { field, sub } = x;
        let v = '';
        let note = '';
        // 找文档顺序上排在这个字段前面、最近的一个已填经历块
        const trail = anchoredTrail.filter((t) => t.el.compareDocumentPosition(field.el) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || null;
        let effSub = sub;
        // 该经历块已经填过开始时间 → 这个后出现的日期框是结束时间（part 字段 sub 是确定的，不参与推断）
        if (!x.part && trail && sub === 'expStart' && trail.subs?.includes('expStart')) effSub = 'expEnd';
        else if (!x.part && !trail && sub === 'expStart' && lastLoneEffSub === 'expStart') effSub = 'expEnd';
        if ((effSub === 'expStart' || effSub === 'expEnd') && trail) {
          v = expEntryValue(trail.entry, effSub);
          const entryName = expEntryValue(trail.entry, 'expCompany') || '就近经历';
          note = ` → ${EXP_SUB_LABELS[effSub]}（${escHtml(truncate(entryName, 16))}，就近补全）`;
        }
        if (!v) {
          const basicKey = effSub === 'expStart' ? 'educationStart' : effSub === 'expEnd' ? 'educationEnd' : null;
          const label = basicKey === 'educationStart' ? '入学时间' : basicKey === 'educationEnd' ? '毕业时间' : null;
          const dateish = !!x.part || /(时间|日期|起止|入学|毕业|date|time)/i.test(field.blob);
          v = basicKey && dateish ? basicValueOf(basicKey) : '';
          if (v) note = ` → ${label}（教育回落）`;
        }
        if (!x.part && (effSub === 'expStart' || effSub === 'expEnd')) lastLoneEffSub = effSub;
        if (v && x.part) v = datePartValue(v, x.part);
        if (v && (await fillFieldAuto(field, v))) {
          field.el.classList.add(AUTOFILL_FILL_CLASS); count += 1;
          dbg.push(dbgLine('✓', field.blob, note));
        } else {
          missed.push(field);
          const dateish = !!x.part || /(时间|日期|起止|入学|毕业|date|time)/i.test(field.blob);
          dbg.push(dbgLine('✗', field.blob, v ? `${note}（填入失败）` : (dateish ? '（判为教育时间但简历为空，未填）' : '（经历时间字段但上下文不足，未填）')));
        }
      }
      continue;
    }
    lastLoneEffSub = null;
    blockIndex += 1;
    const type = detectExpBlockType(block);
    const entry = takeExpEntry(expEntries, consumed, type);
    if (!entry) {
      block.forEach((x) => missed.push(x.field));
      dbg.push(`✗ 经历块${blockIndex}：简历里没有更多经历条目可填`);
      continue;
    }
    consumed.add(entry);
    const entryName = expEntryValue(entry, 'expCompany') || `${entry.type}#${entry.index + 1}`;
    for (const x of block) {
      const { field, sub } = x;
      let v = expEntryValue(entry, sub);
      if (v && x.part) v = datePartValue(v, x.part);
      if (v && (await fillFieldAuto(field, v))) {
        field.el.classList.add(AUTOFILL_FILL_CLASS); count += 1;
        dbg.push(dbgLine('✓', field.blob, ` → ${EXP_SUB_LABELS[sub]}（${escHtml(truncate(entryName, 16))}）`));
      } else {
        missed.push(field);
        dbg.push(dbgLine('✗', field.blob, v ? ` → ${EXP_SUB_LABELS[sub]}（填入失败）` : ` → ${EXP_SUB_LABELS[sub]}（简历为空）`));
      }
    }
    anchoredTrail.push({ entry, el: block[block.length - 1].field.el, subs: block.map((x) => x.sub) });
  }
  return count;
}
// 找页面上的「添加经历」按钮：要求上下文带 实习/工作/项目/经历 字样，避免误点「添加附件」之类
function findAddButton(typeWords) {
  const cands = [...document.querySelectorAll('button, a, [role="button"], input[type="button"], [class*="add" i], [class*="plus" i]')]
    .filter((el) => el instanceof HTMLElement && !el.closest(`#${PANEL_ID}`) && isPageFieldVisible(el))
    .map((el) => ({ el, text: String(el.textContent || el.value || '').replace(/\s+/g, '') }))
    .filter((x) => x.text && x.text.length <= 14 && /(添加|新增|增加|＋|\+)/.test(x.text));
  if (!cands.length) return null;
  const ctxOf = (el) => {
    let ctx = '';
    let node = el;
    for (let d = 0; node && d < 3; d += 1, node = node.parentElement) ctx += node.textContent.replace(/\s+/g, '');
    return ctx.slice(0, 400);
  };
  const typed = cands.find((x) => typeWords.some((w) => ctxOf(x.el).includes(w)));
  if (typed) return typed.el;
  const generic = cands.find((x) => /(经历|经验|教育)/.test(ctxOf(x.el)));
  return generic ? generic.el : null;
}
// 简历里还有经历没填完：自动点「添加」扩出新块，再填下一段
async function growExpBlocks(expEntries, consumed, missed, available, dbg = []) {
  let count = 0;
  for (let guard = 0; guard < 6; guard += 1) {
    const remaining = expEntries.filter((e) => !consumed.has(e));
    if (!remaining.length) break;
    const btn = findAddButton(EXP_TYPE_KEYWORDS[remaining[0].type] || []);
    if (!btn) { dbg.push(`✋ 还有 ${remaining.length} 段经历未填：页面上没找到「添加经历」按钮`); break; }
    const before = new Set(scanPageFields().map((f) => f.el));
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    await sleep(500);
    const fresh = scanPageFields().filter((f) => !before.has(f.el));
    const freshExp = [];
    const freshBareParts = classifyBareDateParts(fresh);
    fresh.forEach((field) => {
      const bareHit = freshBareParts.get(field.el);
      if (bareHit) { freshExp.push({ field, sub: bareHit.sub, part: bareHit.part }); return; }
      const key = matchAutofillKey(field.blob, available);
      if (key && EXP_RULE_KEYS.includes(key)) freshExp.push({ field, sub: key });
    });
    if (!freshExp.length) { dbg.push('✋ 点了「添加」但没识别出新块里的字段，停止扩块'); break; }
    const entry = remaining[0];
    consumed.add(entry);
    const entryName = expEntryValue(entry, 'expCompany') || `${entry.type}#${entry.index + 1}`;
    dbg.push(`➕ 点了「添加」，填入经历：${escHtml(truncate(entryName, 16))}`);
    for (const { field, sub, part } of freshExp) {
      let v = expEntryValue(entry, sub);
      if (v && part) v = datePartValue(v, part);
      if (v && (await fillFieldAuto(field, v))) { field.el.classList.add(AUTOFILL_FILL_CLASS); count += 1; }
      else missed.push(field);
    }
    anchoredTrail.push({ entry, el: freshExp[freshExp.length - 1].field.el, subs: freshExp.map((x) => x.sub) });
  }
  return count;
}
// ===== AI 识别（主力）：程序把页面聚成整体块 → AI 按块语义识别 → 程序保守填写 =====
const AI_RECOGNIZE_PROMPT = `你是招聘网页表单的识别助手。用户会给你「页面块」和「简历数据」两组 JSON。
页面块（blocks）：程序按 DOM 结构把相邻字段聚成的整体，每块含 id、hint（块内文本摘要）、fields（字段列表：id/label/input/options）。
简历数据（resume）：basic 是基础字段（只列有内容的；key 以 custom_ 开头的是用户自定义字段，label 是用户自拟的标题，按标题语义匹配网页字段）；experiences 是经历条目（实习/工作/项目，index 从 0 开始）。
任务：判断每个字段应该填简历里的什么内容，只输出 JSON：
{"blocks": {"块id": {"exp": 经历index或null, "fields": {"字段id": {"key": "basic的key"} 或 {"sub": "company|title|role|start|end|desc", "part": "year|month|day"}}}}}
规则：
1. 宁缺毋滥：没有把握的字段不要返回，没有把握的块整个不要返回。填错比留空更严重。
2. 经历块（实习/工作/项目）：exp 填该块对应简历第几段经历的 index，块内字段用 sub。只有当年/月/日是各自独立的控件（label 就是「年」「月」「日」本身）时才用 part 标 year/month/day；一个完整的日期选择框（带日历图标、输入完整日期）绝不用 part。
3. 非经历块（基础信息/教育/技能等）：exp 为 null，字段用 key。教育时间用 educationStart/educationEnd，拆分控件同样带 part。
4. 经历类型必须严格匹配：块标题是「实习」→ 只能分配 type=实习 的条目；「工作」→ type=工作；「项目」→ type=项目。没有同类型条目可分配时，整块不要返回（留空比填错好得多）。
5. 每段经历只能分配给一个块；同一块的字段必须指向同一段经历；多块时不要按顺序硬凑，按块标题和内容对应。
6. experiences 里 fields 列出该条目非空的字段：fields 越少越可能是解析碎片，不要把字段丰富的整块分配给它；字段丰富的块优先分给信息完整的条目。
7. blocks 之外不要输出任何内容。`;
const AI_SUB_TO_EXPKEY = { company: 'expCompany', title: 'expTitle', role: 'expRole', start: 'expStart', end: 'expEnd', desc: 'expDesc' };
const AI_PARTS = new Set(['year', 'month', 'day']);
// 页面块结构标记（纯 DOM，零语义）：每个字段向上找「字段数 2~12 且压缩文本 ≤400 字」的最高祖先，同容器为一块；散点字段各自成块
function groupPageBlocks(targetFields) {
  const containers = new Map();
  targetFields.forEach((f) => {
    let found = null;
    let node = f.el.parentElement;
    for (let d = 0; node && d < 8; d += 1, node = node.parentElement) {
      const members = targetFields.filter((x) => node.contains(x.el));
      if (members.length > 12) break;
      if (members.length >= 2 && String(node.textContent || '').replace(/\s+/g, '').length <= 400) found = node;
    }
    if (!containers.has(found)) containers.set(found, []);
    containers.get(found).push(f);
  });
  const aiBlocks = [];
  const byId = new Map();
  let seq = 0;
  containers.forEach((members, node) => {
    const groupsToMake = node === null ? members.map((m) => [m]) : [members];
    groupsToMake.forEach((groupFields) => {
      seq += 1;
      const id = `b${seq}`;
      const hintSource = node === null ? groupFields[0].blob : String(node.textContent || '').replace(/\s+/g, ' ').trim();
      const blockFields = new Map();
      const aiFields = groupFields.map((f, i) => {
        const fid = `${id}f${i + 1}`;
        blockFields.set(fid, f);
        const spec = { id: fid, label: truncate(f.blob, 60), input: f.tag === 'select' ? 'select' : f.kind === 'widget' ? 'widget' : (f.el.getAttribute('type') === 'date' ? 'date' : f.tag) };
        if (f.tag === 'select') {
          const opts = [...f.el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 8);
          if (opts.length) spec.options = opts;
        }
        return spec;
      });
      aiBlocks.push({ id, hint: truncate(hintSource, 150), fields: aiFields });
      byId.set(id, { fields: blockFields });
    });
  });
  return { aiBlocks, byId };
}
// ===== 规则路径（冻结兜底）：关键词识别 + 块聚类，无 AI 或 AI 失败时整体接管 =====
async function ruleFillFields(targetFields, { values, available, basicValueOf, expEntries, consumed, missed, dbg, customRules = [] }) {
  let count = 0;
  const expFieldEntries = [];
  const bareDateParts = classifyBareDateParts(targetFields);
  const bareUsable = (hit) => available.has(hit.sub)
    || available.has(hit.sub === 'expStart' ? 'educationStart' : 'educationEnd');
  for (const field of targetFields) {
    const bareHit = bareDateParts.get(field.el);
    if (bareHit && bareUsable(bareHit)) { expFieldEntries.push({ field, sub: bareHit.sub, part: bareHit.part }); continue; }
    const key = matchAutofillKey(field.blob, available, customRules);
    if (!key) { missed.push(field); dbg.push(dbgLine('○', field.blob, '（未识别）')); continue; }
    if (EXP_RULE_KEYS.includes(key)) { expFieldEntries.push({ field, sub: key }); continue; }
    const item = values.find((v) => v.key === key);
    if (item && (await fillFieldAuto(field, item.value))) {
      field.el.classList.add(AUTOFILL_FILL_CLASS); count += 1;
      dbg.push(dbgLine('✓', field.blob, ` → ${item.label}${field.kind === 'widget' ? '（组件）' : ''}`));
    } else {
      missed.push(field);
      dbg.push(dbgLine('✗', field.blob, ` → ${item?.label || key}（填入失败${field.kind === 'widget' ? '，组件拒绝' : ''}）`));
    }
  }
  count += await fillExpBlocks(expFieldEntries, expEntries, consumed, missed, basicValueOf, dbg);
  return count;
}


/**
 * 对外入口：用超你 offer 的规则路径边扫边写。
 * 不走 AI 识别（与案例「无 Key 时规则管线」一致），避免 DeepSeek 介入填写判定。
 */
export async function runChaoRuleAutofill(editable: ChaoEditable): Promise<{
  filled: number;
  skipped: number;
  misses: FillMiss[];
  debugLines: string[];
}> {
  ensureChaoHighlightStyles();
  clearAutofillHighlights();
  anchoredTrail = [];
  const skipped = [];
  const fields = scanPageFields(skipped);
  if (!fields.length) {
    return {
      filled: 0,
      skipped: 0,
      misses: [{ label: '页面', reason: '当前页面没有识别到待填写的表单项' }],
      debugLines: ['当前页面没有识别到待填写的表单项'],
    };
  }
  const values = buildAutofillValues(editable);
  if (!values.length) {
    return {
      filled: 0,
      skipped: 0,
      misses: [{ label: '档案', reason: '档案里没有可写入的内容' }],
      debugLines: ['档案里没有可写入的内容'],
    };
  }
  const expEntries = buildExpEntries(editable);
  const available = new Set(values.map((v) => v.key));
  if (expEntries.length) EXP_RULE_KEYS.forEach((k) => available.add(k));
  const basicValueOf = (key) => values.find((v) => v.key === key)?.value || '';
  const customRules = (editable.customFields || [])
    .map((cf, i) => ({
      key: `custom_${i}`,
      words: [String(cf?.title || '').trim().toLowerCase()],
    }))
    .filter((r) => r.words[0]);

  const dbg = [`🔎 扫描到 ${fields.length} 个待填字段（简历经历条目 ${expEntries.length} 条）`];
  let filledCount = 0;
  const missed = [];
  const consumed = new Set();

  const progress = toastProgress('⏳ 正在按规则识别填写…', { global: true });
  progress.update(`⏳ 正在按规则识别填写 ${fields.length} 个字段…`);
  filledCount += await ruleFillFields(fields, {
    values,
    available,
    basicValueOf,
    expEntries,
    consumed,
    missed,
    dbg,
    customRules,
  });

  if (expEntries.some((entry) => !consumed.has(entry))) {
    progress.update('➕ 还有经历未填，正在补块填写…');
    filledCount += await growExpBlocks(expEntries, consumed, missed, available, dbg);
  }

  progress.update('🔄 正在二次扫描检查遗漏…');
  await sleep(400);
  const seenEls = new Set(fields.map((field) => field.el));
  const fresh = scanPageFields().filter((field) => !seenEls.has(field.el));
  if (fresh.length) {
    dbg.push(`🔄 二次扫描发现 ${fresh.length} 个新字段`);
    filledCount += await ruleFillFields(fresh, {
      values,
      available,
      basicValueOf,
      expEntries,
      consumed,
      missed,
      dbg,
      customRules,
    });
  }
  if (skipped.length) {
    dbg.push(`—— 跳过的 ${skipped.length} 个字段（未参与填写） ——`);
    skipped.slice(0, 15).forEach((item) =>
      dbg.push(dbgLine('◌', item.blob, `（跳过：${item.reason}）`)),
    );
  }
  missed.forEach((field) => field.el.classList.add(AUTOFILL_MISS_CLASS));
  progress.done(
    missed.length
      ? `✅ 填写结束：填入 ${filledCount} 项，${missed.length} 项标黄待手动`
      : `✅ 全部 ${filledCount} 项已填入，请检查后提交`,
  );

  const misses = missed.map((field) => ({
    label: String(field.blob || '').trim().slice(0, 40) || '未识别字段',
    reason: '规则未命中或写入失败，请手动核对',
  }));
  skipped.forEach((item) => {
    misses.push({
      label: String(item.blob || '').slice(0, 40) || '跳过字段',
      reason: item.reason,
    });
  });

  return {
    filled: filledCount,
    skipped: skipped.length,
    misses,
    debugLines: dbg,
  };
}
