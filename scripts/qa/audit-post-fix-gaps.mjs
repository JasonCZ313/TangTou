/**
 * 回归审计：P1–P8 修复后仍可能存在的缺口（只报问题，不改产品代码）。
 */
function textMatchesDangerSaveLabel(compactText, dangerLabel) {
  const compact = compactText.replace(/\s+/g, '');
  const label = dangerLabel.replace(/\s+/g, '');
  if (!compact || !label) return false;
  if (compact.length > 24) return false;
  if (compact === label) return true;
  if (compact.startsWith(label) || compact.endsWith(label)) return true;
  if (compact.includes(label) && compact.length <= label.length + 4) return true;
  return false;
}

function adapterIsDanger(raw) {
  const labels = ['保存', '提交', '确定', '下一步', '完成'];
  const compact = raw.replace(/\s+/g, '');
  return labels.some((label) => textMatchesDangerSaveLabel(compact, label));
}

/** 复刻 executePlaybook.isDangerLabel（无适配器） */
function executeIsDanger(raw) {
  const compact = raw.replace(/\s+/g, '');
  if (adapterIsDanger(compact)) return true;
  return /投递|提交申请|立即申请|最终提交|确认投递/.test(compact);
}

/** 复刻 safeClick.isDangerProbeLabel（无适配器） */
function probeIsDanger(raw) {
  const compact = raw.replace(/\s+/g, '');
  if (adapterIsDanger(compact)) return true;
  return /投递|提交申请|立即申请|最终提交|确认投递|保存并提交|立即投递/.test(
    compact,
  );
}

const findings = [];

function check(id, title, condition, detail) {
  if (condition) {
    findings.push({ id, title, detail, severity: 'issue' });
    console.log(`[ISSUE] ${id} ${title}`);
    console.log(`        ${detail}`);
  } else {
    console.log(`[OK]    ${id} ${title}`);
  }
}

// —— P5 / 执行路径一致性 ——
check(
  'N1',
  '执行路径未拦截「立即投递」而探测路径会拦截',
  executeIsDanger('立即投递') === false && probeIsDanger('立即投递') === true,
  'executePlaybook.isDangerLabel 正则缺少立即投递/保存并提交；safeClick 有。确认执行若点到同名按钮会漏拦。',
);

check(
  'N2',
  '超长文案以「提交」结尾时 adapter 直接放行（>24 短路）',
  adapterIsDanger('请确认以上信息真实有效后点击提交') === false &&
    '请确认以上信息真实有效后点击提交'.replace(/\s+/g, '').length > 24,
  'textMatchesDangerSaveLabel 先判 length>24 即 false，未再检查 endsWith(提交)。长按钮可能漏拦。',
);

check(
  'N3',
  '「保存并立即提交」中长复合可能漏拦 adapter',
  adapterIsDanger('保存并立即提交') === false,
  '长度7 > 保存+4=6，不以保存开头（保存并…实际以保存开头！）。复核 startsWith。',
);

// 保存并立即提交 starts with 保存 → should be true
const saveImmediate = adapterIsDanger('保存并立即提交');
check(
  'N3b',
  '「保存并立即提交」startsWith 保存应命中',
  saveImmediate !== true,
  `实际 adapter=${saveImmediate}；若为 true 则 N3 不成立。`,
);

check(
  'N4',
  '探测与执行对「立即投递」结果不一致',
  probeIsDanger('立即投递') !== executeIsDanger('立即投递'),
  '两套黑名单分叉，维护成本高，易漏。',
);

// —— 合并 open_picker 不可进预览 ——
check(
  'N5',
  '城市 open_picker 有 suggestedValue 但不可 merge（设计缺口/体验）',
  true, // 代码层：isPlaybookStepMergeable 仅 fill/select
  'isPlaybookStepMergeable 排除 open_picker：城市建议只能「确认执行」写入，合并进预览看不到。与 P7b「合并」文案预期可能不符。',
);

// —— 年月语义过宽 ——
const label开始年月 = '开始年月'.replace(/\s+/g, '');
const hit开始 = /入学|就读|教育|学历|开始/.test(label开始年月);
check(
  'N6',
  '标签含「开始」会优先绑教育日期',
  hit开始 === true,
  'pickProfileDateForTemporalLabel 中 /开始/ 过宽：实习「开始年月」也可能拿到 education.startDate。',
);

// —— soft-skip 后 completed 语义 ——
check(
  'N7',
  '确认对话框步数与成功写入数可能不一致（体验）',
  true,
  '侧栏 confirm 显示 selectExecutable 步数；执行后 completed 只计 wrote。soft-skip 多时用户觉得「说好 N 步只写了 M」。',
);

console.log('\n--- 汇总 ---');
console.log(`发现问题条目: ${findings.length}`);
for (const item of findings) {
  console.log(`- ${item.id}: ${item.title}`);
}
