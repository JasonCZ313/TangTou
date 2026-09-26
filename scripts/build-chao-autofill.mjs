/**
 * 从超你 offer 案例 content.js 抽出一键填写引擎，生成 chaoAutofill.ts。
 * 规则路径原样保留；对外只暴露 runChaoRuleAutofill（不走案例 AI 分支）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const srcPath = path.join(
  repoRoot,
  'docs',
  '_case-extract',
  'chaunyoffer',
  'extension',
  'src',
  'content.js',
);
const outPath = path.join(repoRoot, 'src', 'content', 'filler', 'chaoAutofill.ts');

const lines = fs.readFileSync(srcPath, 'utf8').split(/\n/);

/** 按 1-based 行号截取，并去掉 IIFE 两空格缩进 */
function sliceLines(start1, end1Inclusive) {
  return lines
    .slice(start1 - 1, end1Inclusive)
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n');
}

const basicFields = sliceLines(33, 38);
const expGroups = sliceLines(39, 61);
const modules = sliceLines(62, 71);
const truncateLine = sliceLines(78, 78);
const normalizeDateBlock = sliceLines(86, 95);
// AUTOFILL_FILL_CLASS … ruleFillFields 结束（不含 runAutofill，我们自己写入口）
const autofillCore = sliceLines(1040, 1804);

const header = `/**
 * 超你 offer（chaunyoffer）一键填写引擎——从案例 content.js 原样移植。
 * 规则路径：扫描字段 → 关键词匹配 → 边识别边写入 → 不够经历就点「添加」再填。
 * 不依赖 DeepSeek / 前置 FillPlan；档案由 profileToChao 转成 editable 后传入。
 */
// @ts-nocheck
import type { ChaoEditable } from './profileToChao';
import type { FillMiss } from '../../shared/types/fill';

/** 面板 id：案例里用来排除扩展自身 DOM；躺投无浮层面板，保留常量以免改匹配逻辑 */
const PANEL_ID = 'resume-autofill-panel';

${basicFields}
${expGroups}
${modules}

${truncateLine};
${normalizeDateBlock};

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
  style.textContent = \`
    .raf-autofill-filled { outline: 2px solid #22c55e !important; outline-offset: 1px; }
    .raf-autofill-missed { outline: 2px solid #f59e0b !important; outline-offset: 1px; }
  \`;
  document.documentElement.appendChild(style);
}

`;

const footer = `

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
      key: \`custom_\${i}\`,
      words: [String(cf?.title || '').trim().toLowerCase()],
    }))
    .filter((r) => r.words[0]);

  const dbg = [\`🔎 扫描到 \${fields.length} 个待填字段（简历经历条目 \${expEntries.length} 条）\`];
  let filledCount = 0;
  const missed = [];
  const consumed = new Set();

  const progress = toastProgress('⏳ 正在按规则识别填写…', { global: true });
  progress.update(\`⏳ 正在按规则识别填写 \${fields.length} 个字段…\`);
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
    dbg.push(\`🔄 二次扫描发现 \${fresh.length} 个新字段\`);
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
    dbg.push(\`—— 跳过的 \${skipped.length} 个字段（未参与填写） ——\`);
    skipped.slice(0, 15).forEach((item) =>
      dbg.push(dbgLine('◌', item.blob, \`（跳过：\${item.reason}）\`)),
    );
  }
  missed.forEach((field) => field.el.classList.add(AUTOFILL_MISS_CLASS));
  progress.done(
    missed.length
      ? \`✅ 填写结束：填入 \${filledCount} 项，\${missed.length} 项标黄待手动\`
      : \`✅ 全部 \${filledCount} 项已填入，请检查后提交\`,
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
`;

// 去掉 AI 相关函数体（仍可能被引用则保留空壳）；直接删掉 aiRecognizeBlocks～growExpBlocksAi
let core = autofillCore;
const aiStart = core.indexOf('async function aiRecognizeBlocks');
const ruleStart = core.indexOf('// ===== 规则路径（冻结兜底）');
if (aiStart >= 0 && ruleStart > aiStart) {
  core = core.slice(0, aiStart) + core.slice(ruleStart);
}

const full = `${header}\n${core}\n${footer}`;
fs.writeFileSync(outPath, full, 'utf8');
console.log('wrote', outPath, 'bytes', Buffer.byteLength(full, 'utf8'));
