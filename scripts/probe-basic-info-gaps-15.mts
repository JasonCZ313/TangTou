/**
 * 专项：出生日期 / 民族 / 政治面貌 / 性别 — 基本信息漏绑。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import { bindLabeledField } from '../src/shared/fill/sectionBinder.ts';
import { applyLocalHeuristics } from '../src/shared/llm/localHeuristics.ts';
import type { FieldDescriptor } from '../src/shared/types/fill.ts';

function fieldOf(label: string, options?: string[]): FieldDescriptor {
  return {
    fieldId: label,
    tag: 'input',
    type: 'text',
    label,
    selectorHint: 'input',
    options,
  };
}

const profile = createEmptyProfileData();
profile.basic.birthday = '2005-03-13';
profile.basic.ethnicity = '汉族';
profile.basic.politicalStatus = '共青团员';
profile.basic.gender = '男';

const cases: Array<{ label: string; options?: string[]; expect: string }> = [
  { label: '出生日期', expect: '2005-03-13' },
  { label: '出生日期 (年龄)', expect: '2005' },
  { label: '出生年月', expect: '2005' },
  { label: '生日', expect: '2005' },
  { label: '出生日期*', expect: '2005' },
  { label: '请选择出生日期', expect: '2005' },
  { label: '民族', options: ['汉族', '满族'], expect: '汉族' },
  { label: '民族*', options: ['汉族'], expect: '汉族' },
  { label: '请选择民族', options: ['汉族'], expect: '汉族' },
  { label: '政治面貌', options: ['群众', '共青团员'], expect: '共青团员' },
  { label: '政治面貌*', options: ['共青团员'], expect: '共青团员' },
  { label: '请选择政治面貌', options: ['共青团员'], expect: '共青团员' },
  { label: '性别', options: ['男', '女'], expect: '男' },
  { label: '性别*', options: ['男', '女'], expect: '男' },
  { label: '请选择性别', options: ['男', '女'], expect: '男' },
];

let failCount = 0;
for (const [index, item] of cases.entries()) {
  const bound = bindLabeledField(fieldOf(item.label, item.options), profile);
  const ok =
    bound?.kind === 'value' && String(bound.value).includes(item.expect.replace(/\*$/, ''));
  if (!ok) {
    failCount += 1;
    console.log(`FAIL #${index + 1} 绑定「${item.label}」期望含 ${item.expect} :: ${JSON.stringify(bound)}`);
  } else {
    console.log(`PASS #${index + 1} 「${item.label}」`);
  }
}

const { partialPlan } = applyLocalHeuristics(
  profile,
  cases.map((item) => fieldOf(item.label, item.options)),
);
const heuristicHit = partialPlan.items.length;
console.log(`启发式命中 ${heuristicHit}/${cases.length}（期望应接近全部）`);
if (heuristicHit < 4) {
  failCount += 1;
  console.log(`FAIL #16 启发式几乎不覆盖基本信息字段 :: ${JSON.stringify(partialPlan.items)}`);
} else {
  console.log(`PASS #16 启发式覆盖若干基本信息`);
}

console.log(`基本信息漏绑专项 ${cases.length + 1}，失败 ${failCount}`);
process.exit(failCount > 0 ? 1 : 0);
