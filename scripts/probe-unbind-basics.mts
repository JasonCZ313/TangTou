/**
 * 专项：无「第N行」卡片标签时成绩排名 / 出生日期 / 民族政治面貌会漏绑或交给模型。
 * 只排查，不修产品代码。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import { bindLabeledField, bindSectionFields, cityNameOnly } from '../src/shared/fill/sectionBinder.ts';
import { applyLocalHeuristics } from '../src/shared/llm/localHeuristics.ts';
import type { FieldDescriptor } from '../src/shared/types/fill.ts';

function fieldOf(label: string, options?: string[]): FieldDescriptor {
  return {
    fieldId: `id-${label}`,
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
profile.basic.currentCity = '北京市 / 直辖市 / 通州区';
profile.basic.idType = '身份证';
profile.basic.idNumber = '110112200503130310';
profile.basic.phone = '15801166399';
profile.education = [
  {
    school: '北京建筑大学',
    degreeLevel: 'bachelor',
    major: '建筑学',
    startDate: '2023-09',
    endDate: '2027-07',
    description: '',
    rank: '',
  },
  {
    school: '某高中',
    degreeLevel: 'senior_high',
    major: '理科',
    startDate: '2020-09',
    endDate: '2023-06',
    description: '',
    rank: '前10%',
  },
];

const fails: string[] = [];
const passes: string[] = [];

function expect(name: string, ok: boolean, detail: string): void {
  if (ok) {
    passes.push(name);
  } else {
    fails.push(`${name} :: ${detail}`);
  }
}

// —— 成绩排名：无行号时 null，模型可能填学历 ——
[
  '成绩排名',
  '专业成绩排名',
  '最高学历-专业成绩排名',
  '最高学历成绩排名',
].forEach((label, index) => {
  const bound = bindLabeledField(fieldOf(label, ['前5%', '前10%', '前20%']), profile);
  expect(
    `排名无行号#${index + 1}「${label}」应 skip 而非 null（否则进 LLM）`,
    Boolean(bound && bound.kind === 'skip'),
    JSON.stringify(bound),
  );
});

// —— 成绩排名：有教育行号但 rank 空 ——
{
  const bound = bindLabeledField(
    fieldOf('教育背景第1行成绩排名', ['前5%', '前10%']),
    profile,
  );
  expect(
    '教育第1行 rank 空应 skip',
    Boolean(bound && bound.kind === 'skip'),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(
    fieldOf('教育背景第2行成绩排名', ['前5%', '前10%', '前20%']),
    profile,
  );
  expect(
    '教育第2行 rank=前10% 应绑定',
    Boolean(bound && bound.kind === 'value' && bound.value === '前10%'),
    JSON.stringify(bound),
  );
}

// —— 出生日期多种标签 ——
[
  '出生日期',
  '出生日期 (年龄)',
  '出生年月',
  '生日',
  '出生日期*',
].forEach((label, index) => {
  const bound = bindLabeledField(fieldOf(label), profile);
  expect(
    `出生日期#${index + 1}「${label}」应绑定 2005-03-13`,
    Boolean(bound && bound.kind === 'value' && String(bound.value).includes('2005')),
    JSON.stringify(bound),
  );
});

{
  const { partialPlan } = applyLocalHeuristics(profile, [fieldOf('出生日期')]);
  expect(
    '启发式也应能填出生日期',
    partialPlan.items.some((item) => /2005/.test(item.value)),
    JSON.stringify(partialPlan.items),
  );
}

// —— 民族 / 政治面貌 ——
[
  ['民族', '汉族'],
  ['民族*', '汉族'],
  ['政治面貌', '共青团员'],
  ['政治面貌*', '共青团员'],
].forEach(([label, expected], index) => {
  const bound = bindLabeledField(fieldOf(label!, ['汉族', '满族', '群众', '共青团员']), profile);
  expect(
    `民族政治#${index + 1}「${label}」应绑定 ${expected}`,
    Boolean(bound && bound.kind === 'value' && bound.value === expected),
    JSON.stringify(bound),
  );
});

// —— 城市只写城市名 ——
expect(
  'cityNameOnly 北京市/直辖市/通州区 → 北京市',
  cityNameOnly('北京市 / 直辖市 / 通州区') === '北京市',
  cityNameOnly('北京市 / 直辖市 / 通州区'),
);
{
  const bound = bindLabeledField(fieldOf('意向工作城市'), profile);
  expect(
    '意向工作城市只写城市名',
    Boolean(bound && bound.kind === 'value' && bound.value === '北京市'),
    JSON.stringify(bound),
  );
}

// —— 证件号码 vs 类型 ——
{
  const bound = bindLabeledField(fieldOf('证件号码'), profile);
  expect(
    '证件号码绑定身份证号',
    Boolean(bound && bound.kind === 'value' && bound.value === profile.basic.idNumber),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('证件类型', ['身份证', '护照']), profile);
  expect(
    '证件类型绑定身份证',
    Boolean(bound && bound.kind === 'value' && bound.value === '身份证'),
    JSON.stringify(bound),
  );
}

// —— 无行号时间字段：暴露模型乱填风险（期望 null 是现状）——
['就读时间', '获奖时间', '起止时间', '项目名称'].forEach((label, index) => {
  const bound = bindLabeledField(fieldOf(label), profile);
  expect(
    `无行号风险点#${index + 1}「${label}」绑定层为 null（进 LLM）`,
    bound === null,
    JSON.stringify(bound),
  );
});

// —— bindSectionFields 对混标签 ——
{
  const result = bindSectionFields(profile, [
    fieldOf('出生日期'),
    fieldOf('民族', ['汉族']),
    fieldOf('教育背景第1行成绩排名', ['前10%']),
    fieldOf('最高学历-专业成绩排名', ['前10%']),
  ]);
  expect(
    '混标签时出生日期应进 items 或 skipped，不应全进 remaining',
    result.items.some((item) => /出生|2005/.test(item.value)) ||
      result.skippedFieldIds.includes('id-出生日期'),
    JSON.stringify({
      items: result.items,
      skipped: result.skippedFieldIds,
      remaining: result.remainingFields.map((field) => field.label),
    }),
  );
  expect(
    '混标签时无行号成绩排名不应进 remaining（应 skip）',
    !result.remainingFields.some((field) => field.label.includes('最高学历')),
    JSON.stringify(result.remainingFields.map((field) => field.label)),
  );
}

console.log(`专项 ${passes.length + fails.length}，失败 ${fails.length}`);
for (const line of fails) {
  console.log(`FAIL ${line}`);
}
for (const line of passes) {
  console.log(`PASS ${line}`);
}
process.exit(fails.length > 0 ? 1 : 0);
