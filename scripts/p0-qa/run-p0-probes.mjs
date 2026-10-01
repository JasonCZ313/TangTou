/**
 * P0 QA：静态代码探针 + Playwright 浏览器外真实点击。
 * 只报告，不修改产品源码。
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const reportPath = join(__dirname, 'p0-qa-run-report.json');

/** @type {Array<{id:string,caseId:string,ok:boolean,detail:string,severity?:string}>} */
const findings = [];

function note(id, caseId, ok, detail, severity = 'info') {
  findings.push({ id, caseId, ok, detail, severity });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} (${caseId}) ${detail}`);
}

function readSrc(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

/** 代码级案例 */
function runStaticProbes() {
  const popupMain = readSrc('src/entrypoints/popup/main.ts');
  const fillFields = readSrc('src/content/filler/fillFields.ts');
  const sidepanelMain = readSrc('src/entrypoints/sidepanel/main.ts');
  const profileTypes = readSrc('src/shared/types/profile.ts');
  const defaults = readSrc('src/shared/storage/defaults.ts');
  const sessionTypes = readSrc('src/shared/session/types.ts');

  // Case 24 / 23：用户手势
  const hasAwaitBeforeOpen =
    /fillButton\.addEventListener\(\s*'click'[\s\S]*?await maybePersistDefaultProfile[\s\S]*?runFillFlow/.test(
      popupMain,
    ) && /async function runFillFlow[\s\S]*?await chrome\.storage\.session\.set[\s\S]*?openSidePanelForCurrentTab/.test(
      popupMain,
    );
  note(
    'STATIC-GESTURE',
    '23,24',
    !hasAwaitBeforeOpen,
    hasAwaitBeforeOpen
      ? 'Popup「扫描并预览」在 await 默认档案与 await storage.set 之后才 sidePanel.open，极易丢失用户手势导致侧栏打不开'
      : '未发现 await 后再 open 的模式',
    hasAwaitBeforeOpen ? 'critical' : 'info',
  );

  // Case 34：sectionAdds 忽略
  const ignoresSectionAdds =
    /_sectionAdds/.test(fillFields) &&
    /_profileData/.test(fillFields) &&
    !/runChaoRuleAutofill/.test(fillFields);
  note(
    'STATIC-SECTION-ADDS',
    '34',
    !ignoresSectionAdds,
    ignoresSectionAdds
      ? 'applyFillPlan 将 sectionAdds/profileData 标为未使用且不再调用 Chao，多段「添加」行能力在 P0 被旁路'
      : '仍消费 sectionAdds 或 Chao',
    ignoresSectionAdds ? 'high' : 'info',
  );

  // Case 13-15：fillMode 删除
  const fillModeGone =
    !/FillMode|fillMode/.test(profileTypes) && /layaModelUrl/.test(defaults);
  note(
    'STATIC-FILLMODE-REMOVED',
    '13,14,15',
    fillModeGone,
    fillModeGone
      ? 'AppSettings 已无 fillMode，含 layaModelUrl'
      : '仍残留 fillMode 类型或缺少 laya 默认',
    fillModeGone ? 'info' : 'high',
  );

  // Case 1：确认写入是否带 plan
  const confirmUsesEditedPlan =
    /collectEditedFillPlan/.test(sidepanelMain) &&
    /plan:\s*editedPlan/.test(sidepanelMain);
  note(
    'STATIC-CONFIRM-PLAN',
    '1,2',
    confirmUsesEditedPlan,
    confirmUsesEditedPlan
      ? 'runConfirmWrite 使用 collectEditedFillPlan()'
      : '确认写入可能仍传空 plan',
    confirmUsesEditedPlan ? 'info' : 'critical',
  );

  // Case 32：session 键监听
  const sessionKeyOk =
    /FILL_SESSION_STORAGE_KEY/.test(sidepanelMain) &&
    /changes\[FILL_SESSION_STORAGE_KEY\]/.test(sidepanelMain);
  note(
    'STATIC-SESSION-LISTENER',
    '32',
    sessionKeyOk,
    sessionKeyOk
      ? '侧栏监听 FILL_SESSION_STORAGE_KEY'
      : '侧栏可能仍监听旧 pendingFillSession 字符串',
    sessionKeyOk ? 'info' : 'medium',
  );

  // Miss 标签用 reason
  const missUsesReason =
    /label:\s*item\.reason\s*\|\|\s*item\.fieldId/.test(fillFields);
  note(
    'STATIC-MISS-LABEL',
    '7',
    !missUsesReason,
    missUsesReason
      ? '找不到控件时 Miss.label 优先用 item.reason，用户看到的是「映射理由」而非字段名'
      : 'Miss 标签未发现该问题',
    missUsesReason ? 'low' : 'info',
  );

  // 撤销未覆盖 file
  const undoFiles =
    /captureUndoSnapshotsForElements/.test(fillFields) &&
    /applyFilePayloads/.test(fillFields);
  note(
    'STATIC-UNDO-FILES',
    '22,39',
    false,
    '写入快照在文本控件循环前采集；file 写入在 applyFilePayloads，撤销很可能无法还原文件框',
    'medium',
  );

  // Popup 文案不一致
  const statusSaysFill =
    /扫描并填写/.test(popupMain) && /扫描并预览/.test(readSrc('src/entrypoints/popup/index.html'));
  note(
    'STATIC-COPY-MISMATCH',
    '17',
    !statusSaysFill,
    statusSaysFill
      ? '按钮为「扫描并预览」但就绪文案仍写「扫描并填写」'
      : '文案一致',
    statusSaysFill ? 'low' : 'info',
  );

  // session 类型存在
  note(
    'STATIC-SESSION-MODULE',
    '29,30',
    /FillSession/.test(sessionTypes),
    'FillSession 类型模块存在',
    'info',
  );

  void undoFiles;
}

/**
 * 在页面内模拟扩展写入策略（setter + 事件 / select / 组件点选），用真实鼠标点击。
 */
async function runPlaywrightProbes() {
  const html = readFileSync(join(__dirname, 'fixture-form.html'));
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl);

  // Case 10：原生 select — 真实点击展开并点选项
  await page.locator('#degree').selectOption({ label: '硕士' });
  const degreeValue = await page.locator('#degree').inputValue();
  note(
    'PW-NATIVE-SELECT',
    '10',
    degreeValue === 'master',
    `原生 select 选「硕士」后 value=${degreeValue}`,
    degreeValue === 'master' ? 'info' : 'high',
  );

  // Case 1 模拟：改预览值写入手机（真实 keyboard）
  await page.locator('#phone').click();
  await page.locator('#phone').fill('');
  await page.keyboard.type('13800138000');
  const phoneVal = await page.locator('#phone').inputValue();
  const phoneStore = await page.evaluate(() => window.__readPhoneStore());
  note(
    'PW-PHONE-TYPE',
    '1,12',
    phoneVal === '13800138000' && phoneStore === '13800138000',
    `键盘输入手机=${phoneVal} store=${phoneStore}`,
    phoneVal === '13800138000' ? 'info' : 'high',
  );

  // Case 9 仿：组件下拉真实点击
  await page.locator('#cityTrigger').click();
  await page.locator('#cityDropdown [data-value="深圳"]').click();
  const cityText = await page.locator('#cityTrigger').innerText();
  note(
    'PW-WIDGET-CLICK',
    '9',
    cityText.trim() === '深圳',
    `组件下拉点击后显示=${cityText.trim()}`,
    cityText.trim() === '深圳' ? 'info' : 'high',
  );

  // Case 11 contenteditable 真实输入
  await page.locator('#bio').click();
  await page.keyboard.type('认真负责，逻辑清晰。');
  const bioText = await page.locator('#bio').innerText();
  note(
    'PW-CONTENT-EDITABLE',
    '11',
    bioText.includes('认真负责'),
    `contenteditable=${bioText.slice(0, 40)}`,
    bioText.includes('认真负责') ? 'info' : 'high',
  );

  // Case：模拟扩展 setter 写入姓名（非 fill API，模拟 setNativeValue）
  await page.evaluate(() => {
    const el = document.getElementById('fullName');
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc.set.call(el, '测躺投');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const nameVal = await page.locator('#fullName').inputValue();
  note(
    'PW-SETTER-NAME',
    '12',
    nameVal === '测躺投',
    `原生 setter 写入姓名=${nameVal}`,
    nameVal === '测躺投' ? 'info' : 'high',
  );

  // Case 38：长数字不应被当成下拉成功写进证件类型 select 的「像样匹配」——这里验证误把长数字塞进 select 的行为
  await page.evaluate(() => {
    const select = document.getElementById('idAsSelect');
    select.value = '110101199001011234';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const badSelect = await page.locator('#idAsSelect').inputValue();
  note(
    'PW-LONG-DIGIT-SELECT',
    '38',
    badSelect !== '110101199001011234',
    `若直接赋长数字给 select，当前 value=${badSelect}（扩展 writeField 应拒绝此类写入）`,
    'info',
  );

  // 提交按钮存在：扩展不应点击（静态提醒）
  const submitVisible = await page.locator('#submitBtn').isVisible();
  note(
    'PW-SUBMIT-PRESENT',
    'G',
    submitVisible,
    'Fixture 含提交按钮，人工测时确认扩展未点提交',
    'info',
  );

  await browser.close();
  server.close();
}

async function main() {
  mkdirSync(__dirname, { recursive: true });
  runStaticProbes();
  try {
    await runPlaywrightProbes();
  } catch (error) {
    note(
      'PW-RUNTIME',
      '外点',
      false,
      `Playwright 运行失败: ${error instanceof Error ? error.message : String(error)}`,
      'high',
    );
  }
  writeFileSync(reportPath, JSON.stringify({ findings }, null, 2), 'utf8');
  const failed = findings.filter((item) => !item.ok);
  console.log(`\n合计 ${findings.length} 条探针，失败/问题 ${failed.length} 条。报告: ${reportPath}`);
}

void main();
