/**
 * N1/P5 危险文案冒烟（与 adapters/types.ts 对齐）。
 */
const STRONG_SUBMIT_PHRASE_RE =
  /投递|提交申请|立即申请|最终提交|确认投递|保存并提交|立即投递|立即提交|确认提交|点击提交|再点击提交|一键投递|一键提交/;
const STRONG_ACTION_SUFFIXES = ['提交', '保存', '投递', '确定', '下一步', '完成'];

function matchesStrongSubmitIntent(rawText) {
  const compact = rawText.replace(/\s+/g, '');
  if (!compact) return false;
  if (STRONG_SUBMIT_PHRASE_RE.test(compact)) return true;
  return STRONG_ACTION_SUFFIXES.some((suffix) => compact.endsWith(suffix));
}

function textMatchesDangerSaveLabel(compactText, dangerLabel) {
  const compact = compactText.replace(/\s+/g, '');
  const label = dangerLabel.replace(/\s+/g, '');
  if (!compact || !label) return false;
  if (compact === label) return true;
  if (compact.endsWith(label)) return true;
  if (compact.length > 24) return false;
  if (compact.startsWith(label)) return true;
  if (compact.includes(label) && compact.length <= label.length + 4) return true;
  return false;
}

function adapterIsDangerSaveLabel(rawText) {
  const compact = rawText.replace(/\s+/g, '');
  if (!compact) return false;
  if (matchesStrongSubmitIntent(compact)) return true;
  const labels = ['保存', '提交', '确定', '下一步', '完成'];
  return labels.some((label) => textMatchesDangerSaveLabel(compact, label));
}

const expectDanger = [
  '保存',
  '保存草稿',
  '提交投递',
  '确定',
  '下一步',
  '完成',
  '立即保存',
  '确认提交',
  '请确定',
  '填写完成',
  '请您仔细核对下列个人信息与简历内容真实无误之后再点击提交',
  '立即投递',
  '保存并提交',
];
const expectSafe = [
  '我已确定上述信息属实',
  '已确定的工作城市',
  '展开更多信息',
  '添加教育',
  '请选择年',
  '城市',
];

let failed = 0;
for (const text of expectDanger) {
  if (!adapterIsDangerSaveLabel(text)) {
    failed += 1;
    console.error(`FAIL 应危险: ${text}`);
  } else {
    console.log(`OK   危险: ${text}`);
  }
}
for (const text of expectSafe) {
  if (adapterIsDangerSaveLabel(text)) {
    failed += 1;
    console.error(`FAIL 应安全: ${text}`);
  } else {
    console.log(`OK   安全: ${text}`);
  }
}

if (failed > 0) {
  console.error(`失败 ${failed} 项`);
  process.exit(1);
}
console.log('N1/P5 危险文案冒烟全部通过');
