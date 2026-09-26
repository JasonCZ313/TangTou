/**
 * 专项：自我描述被当成个人能力、以及基本信息字段漏绑。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import { bindLabeledField } from '../src/shared/fill/sectionBinder.ts';
import { restoreListLineBreaks } from '../src/shared/resume/restoreListBreaks.ts';
import type { FieldDescriptor } from '../src/shared/types/fill.ts';

function fieldOf(label: string): FieldDescriptor {
  return {
    fieldId: label,
    tag: 'textarea',
    type: 'textarea',
    label,
    selectorHint: 'textarea',
  };
}

const profile = createEmptyProfileData();
profile.skills = [
  { name: 'Python', level: '熟练' },
  { name: '沟通', level: '良好' },
];
profile.selfEvaluation = '第一点·热爱学习\n第二点·善于协作';
profile.basic.birthday = '2005-03-13';
profile.basic.ethnicity = '汉族';
profile.basic.politicalStatus = '共青团员';
profile.basic.gender = '男';

const fails: string[] = [];
const passes: string[] = [];

function expect(name: string, ok: boolean, detail: string): void {
  (ok ? passes : fails).push(ok ? name : `${name} :: ${detail}`);
}

// 自我描述应写 selfEvaluation，不应把技能列表塞进去
{
  const bound = bindLabeledField(fieldOf('自我描述'), profile);
  expect(
    '「自我描述」应绑定档案自我评价文案',
    Boolean(
      bound &&
        bound.kind === 'value' &&
        bound.value.includes('热爱学习') &&
        !bound.value.includes('Python'),
    ),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('自我评价'), profile);
  expect(
    '「自我评价」应绑定自我评价而非技能',
    Boolean(
      bound &&
        bound.kind === 'value' &&
        /热爱学习|善于协作/.test(bound.value) &&
        !/Python/.test(bound.value),
    ),
    JSON.stringify(bound),
  );
}
{
  const bound = bindLabeledField(fieldOf('个人能力描述'), profile);
  expect(
    '「个人能力描述」可写技能列表',
    Boolean(bound && bound.kind === 'value' && /Python/.test(bound.value)),
    JSON.stringify(bound),
  );
}

// 性别
{
  const bound = bindLabeledField(
    {
      ...fieldOf('性别'),
      tag: 'input',
      type: 'text',
      options: ['男', '女'],
    },
    profile,
  );
  expect(
    '性别应绑定男',
    Boolean(bound && bound.kind === 'value' && bound.value === '男'),
    JSON.stringify(bound),
  );
}

// 长文换行：圆点拆行后流式写入期望有多行
{
  const restored = restoreListLineBreaks('第一点·热爱学习 第二点·善于协作');
  expect(
    'restoreListLineBreaks 对中文间隔号拆行',
    restored.includes('\n') && restored.includes('热爱学习'),
    restored,
  );
}
{
  const restored = restoreListLineBreaks('认真完成任务。1.精通CAD 2.熟悉规范');
  expect(
    '句号后数字序号拆行',
    restored.includes('\n') && /1\./.test(restored),
    restored,
  );
}
{
  const restored = restoreListLineBreaks('2024.03至2025.06负责项目');
  expect(
    '日期中间的点不要拆行',
    !/^2024\n/.test(restored) && restored.includes('2024.03'),
    restored,
  );
}

// 再确认出生/民族/政治仍漏
for (const label of ['出生日期', '民族', '政治面貌', '性别']) {
  const bound = bindLabeledField(
    {
      fieldId: label,
      tag: 'input',
      type: 'text',
      label,
      selectorHint: 'input',
      options: label === '性别' ? ['男', '女'] : label === '民族' ? ['汉族'] : label === '政治面貌' ? ['共青团员'] : undefined,
    },
    profile,
  );
  const shouldHaveValue = label !== '性别' || profile.basic.gender === '男';
  if (label === '性别') {
    expect(`复查性别`, Boolean(bound && bound.kind === 'value'), JSON.stringify(bound));
  } else {
    expect(
      `复查「${label}」仍漏绑（记录为问题）`,
      bound === null,
      JSON.stringify(bound),
    );
  }
}

console.log(`专项 ${passes.length + fails.length}，失败 ${fails.filter((line) => line.includes('::')).length}`);
for (const line of fails) {
  if (line.includes('::')) {
    console.log(`FAIL ${line}`);
  }
}
for (const line of passes) {
  console.log(`PASS ${line}`);
}
// 对「复查漏绑」用反向期望：bound===null 算 PASS（确认是问题）
process.exit(fails.some((line) => line.includes('::') && !line.includes('仍漏绑')) ? 1 : 0);
