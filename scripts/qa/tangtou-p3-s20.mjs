import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('M:/项目/躺投/package.json');
const { chromium } = require('playwright');

const extensionPath = 'C:/Users/ROG/AppData/Local/Temp/tangtou-ext';
const userDataDir = 'C:/Users/ROG/AppData/Local/Temp/tangtou-p3-profile';
const results = [];

function record(id, expected, actual, pass) {
  results.push({ id, expected, actual, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${actual}`);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const fileName = request.url === '/blank' ? 'tangtou-p1-blank.html' : 'tangtou-p1-form.html';
      const filePath = path.join('C:/Users/ROG/AppData/Local/Temp', fileName);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fs.readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function readPage(page) {
  return page.evaluate(() => ({
    name: document.querySelector('#fullName')?.value ?? '',
    phone: document.querySelector('#phone')?.value ?? '',
    school: document.querySelector('#school')?.value ?? '',
    company: document.querySelector('#company')?.value ?? '',
    overlayCount: document.querySelectorAll('#tangtou-region-select').length,
  }));
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function dragAcross(page, selectorA, selectorB) {
  const boxA = await page.locator(selectorA).boundingBox();
  const boxB = await page.locator(selectorB).boundingBox();
  const from = { x: Math.min(boxA.x, boxB.x) - 36, y: Math.min(boxA.y, boxB.y) - 10 };
  const to = {
    x: Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + 24,
    y: Math.max(boxA.y + boxA.height, boxB.y + boxB.height) + 10,
  };
  await drag(page, from, to);
}

const P3_PROFILE = {
  id: 'p3',
  name: 'P3档案',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    basic: {
      fullName: '张三',
      phone: '13800138000',
      email: 'zhangsan@example.com',
      currentCity: '北京',
      nationality: '中国',
      nativePlace: '北京',
      idType: '身份证',
      idNumber: '110101199001011234',
      politicalStatus: '群众',
      maritalStatus: '未婚',
    },
    jobIntent: { targetRole: '产品实习生' },
    education: [{ school: '清华大学', degreeLevel: '本科', major: '计算机科学' }],
    experience: [{ company: '躺投科技', title: '产品实习生' }],
    projects: [],
    campusActivities: [],
    skills: [],
    languages: [],
    certificates: [],
    awards: [],
    publications: [],
    trainings: [],
    familyMembers: [],
    emergencyContacts: [],
    specialOrg: {},
    workAuth: {},
    industryExtras: {},
    essays: { selfEvaluation: '踏实肯干' },
    attachmentNotes: {},
    notes: '',
  },
};

async function main() {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const { server, port } = await startServer();
  const formUrl = `http://127.0.0.1:${port}/form`;
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 820 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  const formPage = context.pages()[0] || await context.newPage();
  await formPage.goto(formUrl);
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  const tabLookup = await serviceWorker.evaluate(async (urlPrefix) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => (tab.url || '').startsWith(urlPrefix))?.id ?? null;
  }, formUrl);
  const gesturePage = await context.newPage();
  await gesturePage.goto(`chrome-extension://${extensionId}/popup.html`);
  await gesturePage.evaluate((tabId) => {
    document.addEventListener('pointerdown', () => {
      void chrome.sidePanel.open({ tabId }).catch(() => undefined);
    }, { capture: true, once: true });
  }, tabLookup);
  await gesturePage.mouse.click(12, 12);
  await formPage.waitForTimeout(600);
  await formPage.bringToFront();

  await serviceWorker.evaluate(async (profile) => {
    await chrome.storage.local.set({
      profiles: [profile],
      settings: {
        apiBaseUrl: '',
        apiKey: '',
        model: 'gpt-4o-mini',
        activeProfileId: profile.id,
        layaModelUrl: '',
        layaEnabled: false,
        decisionPreferLocal: true,
        decisionMinConfidence: 0.55,
        enableProbeClicks: false,
      },
    });
  }, P3_PROFILE);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await serviceWorker.evaluate(async () => {
      const targets = await chrome.debugger.getTargets();
      const sideTarget = targets.find((item) => (item.url || '').includes('sidepanel.html'));
      if (!sideTarget?.id) return false;
      const debugTarget = { targetId: sideTarget.id };
      await chrome.debugger.attach(debugTarget, '1.3').catch(() => undefined);
      try {
        const queried = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
          expression: `(() => { const select = document.querySelector('#profileSelect'); return Boolean(select && select.value === 'p3'); })()`,
          returnByValue: true,
        });
        return Boolean(queried.result?.value);
      } finally {
        await chrome.debugger.detach(debugTarget).catch(() => undefined);
      }
    });
    if (ready) break;
    await formPage.waitForTimeout(150);
  }

  async function sideEvaluate(expression) {
    return serviceWorker.evaluate(async (expr) => {
      const targets = await chrome.debugger.getTargets();
      const sideTarget = targets.find((item) => (item.url || '').includes('sidepanel.html'));
      if (!sideTarget?.id) throw new Error('侧栏不在');
      const debugTarget = { targetId: sideTarget.id };
      await chrome.debugger.attach(debugTarget, '1.3').catch(() => undefined);
      try {
        const queried = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
          expression: expr,
          returnByValue: true,
        });
        return queried.result?.value;
      } finally {
        await chrome.debugger.detach(debugTarget).catch(() => undefined);
      }
    }, expression);
  }

  async function sideClick(selector) {
    await formPage.bringToFront();
    await serviceWorker.evaluate(async ({ sel }) => {
      const targets = await chrome.debugger.getTargets();
      const sideTarget = targets.find((item) => (item.url || '').includes('sidepanel.html'));
      if (!sideTarget?.id) throw new Error('侧栏不在');
      const debugTarget = { targetId: sideTarget.id };
      await chrome.debugger.attach(debugTarget, '1.3').catch(() => undefined);
      try {
        const quoted = JSON.stringify(sel);
        const queried = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
          expression: `(() => { const node = document.querySelector(${quoted}); if (!node) return null; node.scrollIntoView({ block: 'center' }); const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`,
          returnByValue: true,
        });
        const box = queried.result?.value;
        if (!box) throw new Error(`没有 ${sel}`);
        await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      } finally {
        await chrome.debugger.detach(debugTarget).catch(() => undefined);
      }
    }, { sel: selector });
  }

  async function regionState() {
    return sideEvaluate(`(() => {
      const section = document.getElementById('regionFieldSection');
      const labels = [...document.querySelectorAll('#regionFieldList li')].map((node) => (node.textContent || '').trim());
      const mappingWrap = document.getElementById('regionMappingWrap');
      const mappingBody = document.getElementById('regionMappingTableBody');
      const mainBody = document.getElementById('mappingTableBody');
      return {
        hidden: section?.hidden ?? true,
        labels,
        meta: document.getElementById('regionFieldMeta')?.textContent?.trim() || '',
        status: document.getElementById('statusMessage')?.textContent?.trim() || '',
        sectionValue: document.getElementById('regionSectionSelect')?.value || '',
        sectionDisabled: document.getElementById('regionSectionSelect')?.disabled ?? true,
        mapDisabled: document.getElementById('regionMapButton')?.disabled ?? true,
        mappingHidden: mappingWrap?.hidden ?? true,
        mappingText: mappingBody?.innerText?.trim() || '',
        mappingRows: mappingBody?.querySelectorAll('tr').length ?? 0,
        mainMappingText: mainBody?.innerText?.trim() || '',
        confirmDisabled: document.getElementById('confirmWriteButton')?.disabled ?? true,
      };
    })()`);
  }

  async function startRegion() {
    await sideClick('#regionSelectButton');
    await formPage.waitForSelector('#tangtou-region-select', { timeout: 8000 });
    await formPage.waitForTimeout(200);
  }

  async function cancelRegion() {
    if ((await formPage.locator('#tangtou-region-select').count()) === 0) return;
    await formPage.bringToFront();
    await formPage.locator('.tangtou-region-shade').click({ button: 'right', position: { x: 40, y: 40 } });
    await formPage.waitForTimeout(250);
    if ((await formPage.locator('#tangtou-region-select').count()) > 0) {
      await formPage.keyboard.press('Escape');
      await formPage.waitForTimeout(200);
    }
  }

  async function waitRegionList() {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const state = await regionState();
      if (!state.hidden && state.meta.includes('共')) return state;
      await formPage.waitForTimeout(120);
    }
    return regionState();
  }

  async function clickRegionMap() {
    await sideClick('#regionMapButton');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await regionState();
      if (!state.mappingHidden && state.mappingRows > 0 && !state.status.includes('正在对照')) {
        return state;
      }
      await formPage.waitForTimeout(150);
    }
    return regionState();
  }

  async function setRegionSection(value) {
    await sideEvaluate(`(() => { const select = document.getElementById('regionSectionSelect'); if (!select) return false; select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await formPage.waitForTimeout(150);
  }

  // P3-01 框姓名手机 + 基本信息段对照 → 预览含张三
  await startRegion();
  await dragAcross(formPage, '#fullName', '#phone');
  await waitRegionList();
  await setRegionSection('basic');
  let state = await clickRegionMap();
  let page = await readPage(formPage);
  record(
    'P3-01',
    '基本信息段对照后预览含姓名',
    `预览=${state.mappingText.slice(0, 60)} 姓名=${page.name}`,
    state.mappingText.includes('张三') && page.name === '',
  );

  // P3-02 预览含手机号档案值
  record(
    'P3-02',
    '预览含手机号',
    `含手机=${state.mappingText.includes('13800138000')}`,
    state.mappingText.includes('13800138000'),
  );

  // P3-03 框内预览区已展示
  record('P3-03', '框内对照表可见', `hidden=${state.mappingHidden} rows=${state.mappingRows}`, !state.mappingHidden && state.mappingRows >= 1);

  // P3-04 整页映射表仍为未扫描提示
  record(
    'P3-04',
    '整页映射表未被框内对照污染',
    `main=${state.mainMappingText.slice(0, 30)}`,
    state.mainMappingText.includes('扫描本页') && !state.mainMappingText.includes('张三'),
  );

  // P3-05 确认写入仍不可用（无整页会话）
  record('P3-05', '无整页预览时确认写入禁用', `disabled=${state.confirmDisabled}`, state.confirmDisabled);

  await cancelRegion();

  // P3-06 取消选区后框内区隐藏（含对照表）
  state = await regionState();
  record('P3-06', '取消后框内区隐藏', `hidden=${state.hidden}`, state.hidden);

  // P3-07 再框学校 + 教育段 → 清华大学
  await startRegion();
  await dragAcross(formPage, '#school', '#school');
  await waitRegionList();
  await setRegionSection('education:0');
  state = await clickRegionMap();
  record(
    'P3-07',
    '教育段对照学校',
    `预览=${state.mappingText.slice(0, 40)}`,
    state.mappingText.includes('清华大学'),
  );
  page = await readPage(formPage);
  record('P3-08', '对照后学校仍不写页', `school=${page.school}`, page.school === '');

  // P3-09 段下拉含工作实习
  const sectionOptions = await sideEvaluate(`[...document.querySelectorAll('#regionSectionSelect option')].map((o) => o.value)`);
  record(
    'P3-09',
    '档案段含 experience:0',
    `opts=${(sectionOptions || []).join(',')}`,
    Array.isArray(sectionOptions) && sectionOptions.includes('experience:0'),
  );

  // P3-10 换工作段前预览清空（change 事件）
  await setRegionSection('experience:0');
  state = await regionState();
  record(
    'P3-10',
    '换段后对照预览隐藏待重对照',
    `mappingHidden=${state.mappingHidden}`,
    state.mappingHidden,
  );

  await cancelRegion();
  await formPage.locator('#company').scrollIntoViewIfNeeded();
  await startRegion();
  await dragAcross(formPage, '#company', '#company');
  await waitRegionList();
  await setRegionSection('experience:0');
  state = await clickRegionMap();
  record(
    'P3-11',
    '实习段对照单位名称',
    `预览=${state.mappingText.slice(0, 40)}`,
    state.mappingText.includes('躺投科技'),
  );

  // P3-12 选区中可点对照（遮罩仍在）
  const overlayDuring = (await readPage(formPage)).overlayCount;
  record('P3-12', '选区中遮罩仍在', `overlay=${overlayDuring}`, overlayDuring === 1);

  await cancelRegion();

  // P3-13 选区中整页扫描被挡
  await startRegion();
  await dragAcross(formPage, '#email', '#qq');
  await waitRegionList();
  await formPage.bringToFront();
  await sideClick('#scanPageButton');
  await formPage.waitForTimeout(400);
  state = await regionState();
  const overlayBlock = (await readPage(formPage)).overlayCount;
  record(
    'P3-13',
    '选区中扫描提示先结束选区',
    `status=${state.status.slice(0, 20)} overlay=${overlayBlock}`,
    state.status.includes('先结束选区') && overlayBlock === 1,
  );
  await cancelRegion();

  // P3-14 选区中对照按钮仍可用
  await startRegion();
  await dragAcross(formPage, '#fullName', '#fullName');
  await waitRegionList();
  state = await regionState();
  const mapReady = !state.mapDisabled;
  await setRegionSection('basic');
  state = await clickRegionMap();
  record(
    'P3-14',
    '选区中可对照且出预览',
    `mapReady=${mapReady} rows=${state.mappingRows}`,
    mapReady && state.mappingRows >= 1,
  );
  await cancelRegion();

  // P3-15 重框后旧预览清除
  await startRegion();
  await dragAcross(formPage, '#phone', '#phone');
  await waitRegionList();
  state = await regionState();
  record('P3-15', '重框后对照预览清空', `mappingHidden=${state.mappingHidden}`, state.mappingHidden);
  await cancelRegion();

  // P3-16 求职意向段存在且可对照（仅 jobIntent 字段时可能 0 项，至少不报错）
  await startRegion();
  await dragAcross(formPage, '#fullName', '#phone');
  await waitRegionList();
  await setRegionSection('jobIntent');
  await sideClick('#regionMapButton');
  await formPage.waitForTimeout(800);
  state = await regionState();
  record(
    'P3-16',
    '求职意向段对照不弹 API 硬错误',
    `status=${state.status.slice(0, 36)} mappingHidden=${state.mappingHidden}`,
    !state.status.includes('请先在设置中配置 API') &&
      (state.status.includes('扫完') || state.status.includes('发现') || state.status.includes('没有可填')),
  );
  await cancelRegion();

  // P3-17 二次对照更新预览
  await startRegion();
  await dragAcross(formPage, '#fullName', '#phone');
  await waitRegionList();
  await setRegionSection('basic');
  state = await clickRegionMap();
  const firstMap = state.mappingText;
  await sideClick('#regionMapButton');
  await formPage.waitForTimeout(600);
  state = await regionState();
  record(
    'P3-17',
    '再次对照仍保留姓名映射',
    `仍含张三=${state.mappingText.includes('张三')}`,
    state.mappingText.includes('张三') && firstMap.includes('张三'),
  );
  await cancelRegion();

  // P3-18 无 API 规则路径仍可对照
  await startRegion();
  await dragAcross(formPage, '#fullName', '#phone');
  await waitRegionList();
  await setRegionSection('basic');
  state = await clickRegionMap();
  record(
    'P3-18',
    '无 API 时仍生成预览',
    `rows=${state.mappingRows}`,
    state.mappingRows >= 1,
  );
  await cancelRegion();

  page = await readPage(formPage);
  record(
    'P3-19',
    'P3 全程不写姓名手机学校单位',
    `姓名=${page.name} 手机=${page.phone} 学校=${page.school} 单位=${page.company}`,
    page.name === '' && page.phone === '' && page.school === '' && page.company === '',
  );

  // P3-20 段下拉在识别后启用
  await startRegion();
  await dragAcross(formPage, '#degree', '#degree');
  await waitRegionList();
  state = await regionState();
  record(
    'P3-20',
    '识别后档案段可选',
    `sectionDisabled=${state.sectionDisabled} value=${state.sectionValue}`,
    !state.sectionDisabled && state.sectionValue === 'basic',
  );
  await cancelRegion();

  const passCount = results.filter((item) => item.pass).length;
  console.log(`SUMMARY_P3 ${passCount}/${results.length}`);
  server.close();
  await context.close();
  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
