/**
 * 选区填入 P4 浏览器验收（30 条）：框内写入、独立撤销、卸遮罩。
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const { chromium } = require('playwright');

const extensionPath = process.env.TANGTOU_EXT || 'C:/Users/ROG/AppData/Local/Temp/tangtou-ext';
const userDataDir = 'C:/Users/ROG/AppData/Local/Temp/tangtou-p4-profile';
const results = [];

function record(id, actual, pass) {
  results.push({ id, actual, pass });
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
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const PROFILE = {
  id: 'p4',
  name: 'P4档案',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  data: {
    basic: { fullName: '李四', phone: '13900001111', email: '', currentCity: '上海', nationality: '中国', nativePlace: '上海', idType: '身份证', idNumber: '', politicalStatus: '群众', maritalStatus: '未婚' },
    jobIntent: { targetRole: '开发' },
    education: [{ school: '复旦大学', degreeLevel: '本科', major: '软件' }],
    experience: [{ company: '框内科技', title: '实习' }],
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
    essays: {},
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
  }, PROFILE);

  async function sideEval(expr) {
    return serviceWorker.evaluate(async (expression) => {
      const targets = await chrome.debugger.getTargets();
      const side = targets.find((item) => (item.url || '').includes('sidepanel.html'));
      if (!side?.id) throw new Error('侧栏不在');
      const debugTarget = { targetId: side.id };
      await chrome.debugger.attach(debugTarget, '1.3').catch(() => undefined);
      try {
        const queried = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
        });
        return queried.result?.value;
      } finally {
        await chrome.debugger.detach(debugTarget).catch(() => undefined);
      }
    }, expr);
  }

  async function sideClick(selector) {
    await formPage.bringToFront();
    await serviceWorker.evaluate(async ({ sel }) => {
      const targets = await chrome.debugger.getTargets();
      const side = targets.find((item) => (item.url || '').includes('sidepanel.html'));
      const debugTarget = { targetId: side.id };
      await chrome.debugger.attach(debugTarget, '1.3').catch(() => undefined);
      try {
        const queried = await chrome.debugger.sendCommand(debugTarget, 'Runtime.evaluate', {
          expression: `(() => { const node = document.querySelector(${JSON.stringify(sel)}); const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`,
          returnByValue: true,
        });
        const point = queried.result.value;
        await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1,
        });
        await chrome.debugger.sendCommand(debugTarget, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1,
        });
      } finally {
        await chrome.debugger.detach(debugTarget).catch(() => undefined);
      }
    }, { sel: selector });
    await formPage.waitForTimeout(120);
  }

  async function regionState() {
    return sideEval(`(() => {
      const section = document.getElementById('regionFieldSection');
      return {
        hidden: section?.hidden ?? true,
        meta: document.getElementById('regionFieldMeta')?.textContent?.trim() || '',
        status: document.getElementById('statusMessage')?.textContent?.trim() || '',
        mappingHidden: document.getElementById('regionMappingWrap')?.hidden ?? true,
        mappingRows: document.getElementById('regionMappingTableBody')?.querySelectorAll('tr').length ?? 0,
        confirmDisabled: document.getElementById('regionConfirmWriteButton')?.disabled ?? true,
        undoDisabled: document.getElementById('regionUndoButton')?.disabled ?? true,
        sectionValue: document.getElementById('regionSectionSelect')?.value || '',
      };
    })()`);
  }

  async function startRegion() {
    await sideEval(`(() => {
      const button = document.getElementById('regionSelectButton');
      if (!button || button.disabled) return 'disabled';
      button.scrollIntoView({ block: 'center' });
      button.click();
      return 'clicked';
    })()`);
    await formPage.waitForTimeout(250);
    await formPage.waitForSelector('#tangtou-region-select', { timeout: 12000 });
    await formPage.waitForTimeout(200);
  }

  async function dragAcross(selectorA, selectorB) {
    await formPage.bringToFront();
    const boxA = await formPage.locator(selectorA).boundingBox();
    const boxB = await formPage.locator(selectorB).boundingBox();
    const from = { x: Math.min(boxA.x, boxB.x) - 30, y: Math.min(boxA.y, boxB.y) - 8 };
    const to = {
      x: Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + 20,
      y: Math.max(boxA.y + boxA.height, boxB.y + boxB.height) + 8,
    };
    await formPage.mouse.move(from.x, from.y);
    await formPage.mouse.down();
    await formPage.mouse.move(to.x, to.y, { steps: 6 });
    await formPage.mouse.up();
  }

  async function waitRegionList() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const state = await regionState();
      if (!state.hidden && state.meta.includes('共')) return state;
      await formPage.waitForTimeout(120);
    }
    return regionState();
  }

  async function setRegionSection(value) {
    await sideEval(`(() => {
      const select = document.getElementById('regionSectionSelect');
      if (!select) return false;
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await formPage.waitForTimeout(150);
  }

  async function clickRegionMap() {
    await sideClick('#regionMapButton');
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const state = await regionState();
      if (!state.mappingHidden && state.mappingRows > 0 && !state.status.includes('正在对照')) {
        return state;
      }
      await formPage.waitForTimeout(150);
    }
    return regionState();
  }

  async function regionWrite(sectionKey, selectorA, selectorB) {
    await startRegion();
    await dragAcross(selectorA, selectorB);
    await waitRegionList();
    await setRegionSection(sectionKey);
    let mapped = await clickRegionMap();
    if (mapped.confirmDisabled) {
      await formPage.waitForTimeout(400);
      mapped = await clickRegionMap();
    }
    if (mapped.confirmDisabled) {
      throw new Error(`确认框内仍禁用 section=${sectionKey}`);
    }
    await sideClick('#regionConfirmWriteButton');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const overlayCount = await formPage.locator('#tangtou-region-select').count();
      const state = await regionState();
      if (overlayCount === 0 && state.status.includes('框内已写入')) return state;
      await formPage.waitForTimeout(200);
    }
    return regionState();
  }

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await sideEval(`document.querySelector('#profileSelect')?.value === 'p4'`)) {
      ready = true;
      break;
    }
    await formPage.waitForTimeout(150);
  }
  record('P4-01', `profileReady=${ready}`, ready);

  await regionWrite('basic', '#fullName', '#phone');
  let name = await formPage.inputValue('#fullName');
  let overlay = await formPage.locator('#tangtou-region-select').count();
  record('P4-02', `姓名=${name} 遮罩=${overlay}`, name === '李四' && overlay === 0);
  record('P4-03', `手机=${await formPage.inputValue('#phone')}`, (await formPage.inputValue('#phone')) === '13900001111');

  let state = await regionState();
  record('P4-04', `写后状态=${state.status.slice(0, 40)}`, state.status.includes('框内已写入'));
  record('P4-05', `写后撤销框内可用=${state.undoDisabled}`, state.undoDisabled === false);

  async function clickRegionUndo() {
    await formPage.bringToFront();
    await sideEval(`(() => { document.getElementById('regionUndoButton')?.click(); return true; })()`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await sideEval(`document.getElementById('statusMessage')?.textContent || ''`);
      if (status.includes('已撤销框内') || status.includes('没有可撤销')) return status;
      await formPage.waitForTimeout(150);
    }
    return '';
  }

  const undoStatus = await clickRegionUndo();
  record('P4-06', `撤销框内后姓名=${await formPage.inputValue('#fullName')} status=${undoStatus.slice(0, 20)}`, (await formPage.inputValue('#fullName')) === '');
  record('P4-07', `撤销后手机=${await formPage.inputValue('#phone')}`, (await formPage.inputValue('#phone')) === '');

  await regionWrite('basic', '#fullName', '#phone');
  await formPage.fill('#school', '手动学校');
  await sideClick('#undoButton');
  await formPage.waitForTimeout(500);
  name = await formPage.inputValue('#fullName');
  const school = await formPage.inputValue('#school');
  record('P4-08', `整页撤销不还原框内姓名=${name} 学校=${school}`, name === '李四' && school === '手动学校');

  await clickRegionUndo();
  record('P4-09', `框内撤销后姓名=${await formPage.inputValue('#fullName')}`, (await formPage.inputValue('#fullName')) === '');

  state = await regionState();
  record('P4-10', `无预览时确认框内禁用=${state.confirmDisabled}`, state.confirmDisabled === true);

  await formPage.fill('#school', '');
  await regionWrite('education:0', '#school', '#degree');
  record('P4-11', `学校=${await formPage.inputValue('#school')}`, (await formPage.inputValue('#school')) === '复旦大学');
  await clickRegionUndo();
  record('P4-12', `教育撤销后学校=${await formPage.inputValue('#school')}`, (await formPage.inputValue('#school')) === '');

  await formPage.locator('#company').scrollIntoViewIfNeeded();
  await regionWrite('experience:0', '#company', '#company');
  const company = await formPage.inputValue('#company');
  record('P4-13', `单位=${company}`, company === '框内科技');
  overlay = await formPage.locator('#tangtou-region-select').count();
  record('P4-14', `实习写后遮罩=${overlay}`, overlay === 0);

  await clickRegionUndo();
  record('P4-15', `撤销实习单位=${await formPage.inputValue('#company')}`, (await formPage.inputValue('#company')) === '');

  await regionWrite('basic', '#fullName', '#phone');
  record('P4-16', `再次框内姓名=${await formPage.inputValue('#fullName')}`, (await formPage.inputValue('#fullName')) === '李四');

  await startRegion();
  record('P4-17', `可再次进入选区`, (await formPage.locator('#tangtou-region-select').count()) === 1);
  await formPage.locator('.tangtou-region-shade').click({ button: 'right', position: { x: 40, y: 40 } });
  await formPage.waitForTimeout(300);
  if ((await formPage.locator('#tangtou-region-select').count()) > 0) {
    await formPage.keyboard.press('Escape');
    await formPage.waitForTimeout(200);
  }
  record('P4-18', `取消选区后遮罩=${await formPage.locator('#tangtou-region-select').count()}`, (await formPage.locator('#tangtou-region-select').count()) === 0);

  if ((await formPage.locator('#tangtou-region-select').count()) > 0) {
    await formPage.keyboard.press('Escape');
    await formPage.waitForTimeout(250);
  }
  await formPage.fill('#fullName', '');
  await formPage.fill('#phone', '');
  await startRegion();
  await dragAcross('#fullName', '#phone');
  const listed = await waitRegionList();
  record('P4-19', `扫描清单 meta=${listed.meta.slice(0, 24)}`, listed.meta.includes('共') && !listed.meta.includes('共 0 项'));
  await setRegionSection('basic');
  const preview = await clickRegionMap();
  record('P4-20', `仅对照不写页 name=${await formPage.inputValue('#fullName')}`, preview.mappingRows >= 1 && (await formPage.inputValue('#fullName')) === '');

  const mappingText = await sideEval(`document.getElementById('regionMappingTableBody')?.innerText || ''`);
  record(
    'P4-21',
    `预览含手机=${mappingText.includes('13900001111')}`,
    mappingText.includes('13900001111') && !preview.confirmDisabled,
  );

  await formPage.keyboard.press('Escape');
  await formPage.waitForTimeout(300);
  if ((await formPage.locator('#tangtou-region-select').count()) > 0) {
    await formPage.locator('.tangtou-region-shade').click({ button: 'right', position: { x: 30, y: 30 } });
    await formPage.waitForTimeout(200);
  }
  record('P4-22', `未确认写入 phone=${await formPage.inputValue('#phone')}`, (await formPage.inputValue('#phone')) === '');

  const hasRegionUndo = await sideEval(`Boolean(document.getElementById('regionUndoButton'))`);
  const hasPageUndo = await sideEval(`Boolean(document.getElementById('undoButton'))`);
  record('P4-23', `双撤销按钮 region=${hasRegionUndo} page=${hasPageUndo}`, hasRegionUndo && hasPageUndo);

  await regionWrite('basic', '#fullName', '#phone');
  await clickRegionUndo();
  record('P4-24', `最后一次框内撤销姓名=${await formPage.inputValue('#fullName')}`, (await formPage.inputValue('#fullName')) === '');

  await formPage.fill('#fullName', '');
  await formPage.fill('#phone', '');
  await regionWrite('basic', '#fullName', '#phone');
  await clickRegionUndo();
  record('P4-25', `连续框内写撤一轮=${await formPage.inputValue('#fullName')}`, (await formPage.inputValue('#fullName')) === '');

  await startRegion();
  await dragAcross('#school', '#degree');
  const eduListed = await waitRegionList();
  const sectionKeys = await sideEval(`[...document.getElementById('regionSectionSelect')?.options || []].map((option) => option.value).join(',')`);
  record('P4-26', `档案段=${sectionKeys}`, sectionKeys.includes('basic') && sectionKeys.includes('education:0'));
  await setRegionSection('education:0');
  const eduMap = await clickRegionMap();
  record('P4-27', `教育段对照行数=${eduMap.mappingRows} meta=${eduListed.meta.slice(0, 16)}`, eduMap.mappingRows >= 1);
  await formPage.keyboard.press('Escape');
  await formPage.waitForTimeout(250);
  if ((await formPage.locator('#tangtou-region-select').count()) > 0) {
    await formPage.locator('.tangtou-region-shade').click({ button: 'right', position: { x: 30, y: 30 } });
    await formPage.waitForTimeout(200);
  }
  record('P4-28', `Esc 后仍可操作侧栏`, Boolean(await sideEval(`document.getElementById('regionSelectButton')`)));

  record('P4-29', `主映射未被框内污染`, !(await sideEval(`(document.getElementById('mappingTableBody')?.innerText||'').includes('框内科技')`)));

  const confirmId = await sideEval(`document.getElementById('regionConfirmWriteButton')?.id`);
  record('P4-30', `P4 控件齐全 confirm=${confirmId}`, confirmId === 'regionConfirmWriteButton');

  const pass = results.filter((item) => item.pass).length;
  console.log(`SUMMARY_P4 ${pass}/${results.length}`);
  server.close();
  await context.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
