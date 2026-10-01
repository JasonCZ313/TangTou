/**
 * 危险文案边角矩阵（修复后回归）。
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

function executeIsDanger(raw) {
  const compact = raw.replace(/\s+/g, '');
  if (adapterIsDanger(compact)) return true;
  return /投递|提交申请|立即申请|最终提交|确认投递/.test(compact);
}

function probeIsDanger(raw) {
  const compact = raw.replace(/\s+/g, '');
  if (adapterIsDanger(compact)) return true;
  return /投递|提交申请|立即申请|最终提交|确认投递|保存并提交|立即投递/.test(
    compact,
  );
}

const cases = [
  '请您仔细核对下列个人信息与简历内容真实无误之后再点击提交',
  '同意协议并提交申请材料到用人单位系统',
  '保存当前草稿并继续编辑下一页内容',
  '最终提交',
  '保存并提交',
  '立即投递',
  '下一步填写教育经历',
  '我已阅读并同意隐私政策后提交',
];

let holes = 0;
for (const text of cases) {
  const compact = text.replace(/\s+/g, '');
  const row = {
    text,
    len: compact.length,
    adapter: adapterIsDanger(text),
    execute: executeIsDanger(text),
    probe: probeIsDanger(text),
  };
  console.log(JSON.stringify(row));
  // 长文案含提交/保存意图但 adapter 因 >24 放行
  if (
    compact.length > 24 &&
    /提交|保存/.test(compact) &&
    row.adapter === false &&
    row.execute === false
  ) {
    holes += 1;
    console.log(`  >> HOLE: 长文案执行路径未拦`);
  }
  if (row.probe !== row.execute) {
    console.log(`  >> DIVERGE: probe=${row.probe} execute=${row.execute}`);
  }
}

console.log(`长文案执行漏拦洞数: ${holes}`);
