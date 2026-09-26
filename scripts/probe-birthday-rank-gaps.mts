/**
 * 专项：出生日期 / 成绩排名 / 无三角下拉 / 硬填 vs 点选 —— 只测绑定层与可复现规则，不修代码。
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
profile.basic.phone = '15801166399';
profile.basic.idNumber = '110112200503130310';
profile.basic.idType = '身份证';
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
];

const results: Array<{ name: string; passed: boolean; detail: string }> = [];

function add(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// 出生日期：当前 sectionBinder / heuristics 都不绑 birthday
{
  const bound = bindLabeledField(fieldOf('出生日期'), profile);
  add(
    '出生日期标签应被绑定到 2005-03-13（期望有值）',
    Boolean(bound && bound.kind === 'value' && bound.value === '2005-03-13'),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('出生日期 (年龄)'), profile);
  add(
    '出生日期(年龄)标签应绑定',
    Boolean(bound && bound.kind === 'value'),
    JSON.stringify(bound),
  );
}
{
  const { partialPlan, remainingFields } = applyLocalHeuristics(profile, [
    fieldOf('出生日期'),
  ]);
  add(
    '启发式应能填出生日期',
    partialPlan.items.some((item) => item.value === '2005-03-13'),
    JSON.stringify(partialPlan.items),
  );
}

// 成绩排名：学历误入
{
  const bound = bindLabeledField(
    fieldOf('最高学历-专业成绩排名', ['前5%', '前10%']),
    profile,
  );
  add(
    '成绩排名空时必须 skip',
    Boolean(bound && bound.kind === 'skip'),
    JSON.stringify(bound),
  );
}
{
  const { partialPlan } = applyLocalHeuristics(profile, [
    fieldOf('最高学历-专业成绩排名'),
  ]);
  add(
    '启发式不得把大学本科写进成绩排名',
    !partialPlan.items.some((item) => /本科/.test(item.value)),
    JSON.stringify(partialPlan.items),
  );
}

// 无行号字段容易被 LLM 接手 —— 绑定层应 null 留给模型，这是风险点
{
  const bound = bindLabeledField(fieldOf('就读时间'), profile);
  add(
    '无行号「就读时间」绑定层不猜（期望 null，暴露模型可乱填风险）',
    bound === null,
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('获奖时间'), profile);
  add(
    '无行号「获奖时间」绑定层不猜',
    bound === null,
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('项目名称'), profile);
  add(
    '无行号「项目名称」绑定层不猜',
    bound === null,
    JSON.stringify(bound),
  );
}

// 民族政治面貌
profile.basic.ethnicity = '汉族';
profile.basic.politicalStatus = '共青团员';
{
  const bound = bindLabeledField(fieldOf('民族', ['汉族', '满族']), profile);
  add(
    '民族应绑定汉族',
    Boolean(bound && bound.kind === 'value' && bound.value === '汉族'),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('政治面貌', ['群众', '共青团员']), profile);
  add(
    '政治面貌应绑定共青团员',
    Boolean(bound && bound.kind === 'value' && bound.value === '共青团员'),
    JSON.stringify(bound),
  );
}
{
  const { partialPlan } = applyLocalHeuristics(profile, [fieldOf('民族'), fieldOf('政治面貌')]);
  add(
    '启发式应覆盖民族或政治面貌其一',
    partialPlan.items.length > 0,
    JSON.stringify(partialPlan.items),
  );
}

// 邮箱
profile.basic.email = 'a@b.com';
{
  const { partialPlan } = applyLocalHeuristics(profile, [fieldOf('邮箱')]);
  add(
    '启发式邮箱',
    partialPlan.items[0]?.value === 'a@b.com',
    JSON.stringify(partialPlan.items),
  );
}

console.log(
  `专项案例 ${results.length}，失败 ${results.filter((item) => !item.passed).length}`,
);
for (const item of results.filter((item) => !item.passed)) {
  console.log(`FAIL ${item.name} :: ${item.detail}`);
}
for (const item of results.filter((item) => item.passed)) {
  console.log(`PASS ${item.name}`);
}
process.exit(results.some((item) => !item.passed) ? 1 : 0);
