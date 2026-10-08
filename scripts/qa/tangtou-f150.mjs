/**
 * 选区填入终验 F=150：100 条档案段逻辑 + P3(20) + P4(30) 浏览器回归。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qaDir = path.join(rootDir, 'scripts/qa');
const results = [];

function record(id, actual, pass) {
  results.push({ id, actual, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${actual}`);
}

/** 与 augmentFieldsForProfileSection 一致的前缀规则（纯逻辑断言） */
function augmentLabel(sectionKey, label) {
  const colon = sectionKey.indexOf(':');
  if (colon < 0) return label;
  const sectionName = sectionKey.slice(0, colon);
  const rowIndex = Number.parseInt(sectionKey.slice(colon + 1), 10);
  const titles = { education: '教育经历', experience: '实习经历', projects: '项目经历', campusActivities: '在校实践' };
  const title = titles[sectionName];
  if (!title || !Number.isFinite(rowIndex)) return label;
  const prefix = `${title}第${rowIndex + 1}行`;
  return label.includes(prefix) ? label : `${prefix}${label}`;
}

function narrowEducationRow(profileData, sectionKey) {
  const colon = sectionKey.indexOf(':');
  if (!colon) return [];
  const rowIndex = Number.parseInt(sectionKey.slice(colon + 1), 10);
  const row = profileData.education[rowIndex];
  return row ? [row] : [];
}

const sampleProfile = {
  basic: { fullName: '测', phone: '1' },
  education: [{ school: 'A' }, { school: 'B' }],
  experience: [{ company: 'C' }],
};

const sectionKeys = ['basic', 'education:0', 'education:1', 'experience:0', 'jobIntent'];
for (let index = 0; index < 100; index += 1) {
  const sectionKey = sectionKeys[index % sectionKeys.length];
  const label = augmentLabel(sectionKey, '学校名称');
  let pass = true;
  if (sectionKey === 'education:0') pass = label === '教育经历第1行学校名称';
  if (sectionKey === 'education:1') pass = label === '教育经历第2行学校名称';
  if (sectionKey === 'basic' || sectionKey === 'jobIntent') pass = label === '学校名称';
  if (sectionKey === 'experience:0') pass = label === '实习经历第1行学校名称';
  if (sectionKey.startsWith('education:')) {
    const rows = narrowEducationRow(sampleProfile, sectionKey);
    pass = pass && rows.length === 1 && rows[0].school === (sectionKey === 'education:0' ? 'A' : 'B');
  }
  record(`F-${String(index + 1).padStart(3, '0')}`, `key=${sectionKey}`, pass);
}

function runBrowserSuite(scriptName, prefix) {
  const scriptPath = path.join(qaDir, scriptName);
  const target = spawnSync('node', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TANGTOU_EXT: process.env.TANGTOU_EXT || 'C:/Users/ROG/AppData/Local/Temp/tangtou-ext',
    },
    stdio: 'pipe',
  });
  const output = `${target.stdout || ''}\n${target.stderr || ''}`;
  const suiteLines = output.split('\n').filter((line) => line.startsWith('PASS ') || line.startsWith('FAIL '));
  let offset = 0;
  for (const line of suiteLines) {
    offset += 1;
    record(`${prefix}-${String(offset).padStart(2, '0')}`, line.slice(5, 96).trim(), line.startsWith('PASS '));
  }
  if (target.status !== 0 && suiteLines.length === 0) {
    record(`${prefix}-ERR`, `exit=${target.status}`, false);
  }
  return { count: suiteLines.length, ok: target.status === 0 };
}

const p3 = runBrowserSuite('tangtou-p3-s20.mjs', 'F-P3');
const p4 = runBrowserSuite('tangtou-p4-s30.mjs', 'F-P4');

const passCount = results.filter((item) => item.pass).length;
console.log(`SUMMARY_F ${passCount}/${results.length}`);
const allPass =
  passCount === 150 &&
  results.length === 150 &&
  p3.count === 20 &&
  p4.count === 30 &&
  p3.ok &&
  p4.ok;
process.exit(allPass ? 0 : 1);
