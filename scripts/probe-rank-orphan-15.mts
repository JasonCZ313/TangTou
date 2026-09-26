/**
 * 专项：无「教育第N行」前缀的成绩排名交给 LLM 的风险；有行号时空 rank 应 skip。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import { bindLabeledField } from '../src/shared/fill/sectionBinder.ts';
import type { FieldDescriptor } from '../src/shared/types/fill.ts';

function fieldOf(label: string, options?: string[]): FieldDescriptor {
  return {
    fieldId: label,
    tag: 'input',
    type: 'text',
    label,
    selectorHint: 'input',
    options: options ?? ['前5%', '前10%', '前20%', '前30%'],
  };
}

const profile = createEmptyProfileData();
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

const riskLabels = [
  '成绩排名',
  '专业成绩排名',
  '最高学历-专业成绩排名',
  '最高学历成绩排名',
  '本科成绩排名',
  'GPA排名',
  '成绩名次',
  '专业排名',
  '基本信息成绩排名',
  '教育成绩排名',
  '最高学历专业排名',
  '请选择成绩排名',
  '成绩排名*',
  '在校成绩排名',
  '综合成绩排名',
];

let failCount = 0;
console.log('—— 期望：无行号排名应 skip（不进 LLM），现状多为 null ——');
for (const [index, label] of riskLabels.entries()) {
  const bound = bindLabeledField(fieldOf(label), profile);
  const ok = bound?.kind === 'skip';
  if (!ok) {
    failCount += 1;
    console.log(`FAIL #${index + 1} 「${label}」:: ${JSON.stringify(bound)}`);
  } else {
    console.log(`PASS #${index + 1} 「${label}」`);
  }
}

{
  const bound = bindLabeledField(fieldOf('教育背景第1行成绩排名'), profile);
  if (bound?.kind === 'skip') {
    console.log('PASS #16 教育第1行空 rank → skip');
  } else {
    failCount += 1;
    console.log(`FAIL #16 教育第1行空 rank :: ${JSON.stringify(bound)}`);
  }
}

profile.education[0]!.rank = '前10%';
{
  const bound = bindLabeledField(fieldOf('教育背景第1行成绩排名'), profile);
  if (bound?.kind === 'value' && bound.value === '前10%') {
    console.log('PASS #17 教育第1行有 rank → 前10%');
  } else {
    failCount += 1;
    console.log(`FAIL #17 :: ${JSON.stringify(bound)}`);
  }
}

console.log(`成绩排名专项 ${riskLabels.length + 2}，失败 ${failCount}`);
process.exit(failCount > 0 ? 1 : 0);
