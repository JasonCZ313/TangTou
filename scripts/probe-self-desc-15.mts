/**
 * 专项 15 案：自我描述/自我评价应写 essays，不应写成技能列表。
 * 「个人能力*」类标签仍走技能绑定。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import { bindLabeledField } from '../src/shared/fill/sectionBinder.ts';
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
profile.skills = [{ name: 'Python' }, { name: '沟通' }];
profile.essays.selfEvaluation = '第一点·热爱学习\n第二点·善于协作\n第三点·责任心强';

const essayLabels = [
  '自我描述',
  '自我评价',
  '个人自我描述',
  '自我介绍',
  '个人简介',
  '自我描述第1行',
  '未分区自我描述',
  '基本信息自我评价',
  '求职自我评价',
  '综合自我描述',
  '自我描述*',
  '自我评价（选填）',
  '请填写自我描述',
];

const skillLabels = ['个人能力自我评价', '个人能力描述'];

let failCount = 0;
for (const [index, label] of essayLabels.entries()) {
  const bound = bindLabeledField(fieldOf(label), profile);
  const correctEssay =
    bound?.kind === 'value' && /热爱学习/.test(bound.value) && !/Python/.test(bound.value);
  if (!correctEssay) {
    failCount += 1;
    console.log(`FAIL #${index + 1} 「${label}」应写自我评价 :: ${JSON.stringify(bound)}`);
  } else {
    console.log(`PASS #${index + 1} 「${label}」`);
  }
}

for (const [index, label] of skillLabels.entries()) {
  const bound = bindLabeledField(fieldOf(label), profile);
  const okSkill =
    bound?.kind === 'value'
      ? /Python/.test(bound.value) && !/热爱学习/.test(bound.value)
      : bound?.kind === 'skip';
  // 个人能力自我评价：含个人能力 → 走 skill；个人能力描述 → skill
  const caseId = essayLabels.length + index + 1;
  if (!okSkill && label === '个人能力描述') {
    failCount += 1;
    console.log(`FAIL #${caseId} 「${label}」应写技能 :: ${JSON.stringify(bound)}`);
  } else if (label === '个人能力自我评价') {
    // 排除 essay 后走 skill，应含 Python
    if (!(bound?.kind === 'value' && /Python/.test(bound.value))) {
      failCount += 1;
      console.log(`FAIL #${caseId} 「${label}」应走技能绑定 :: ${JSON.stringify(bound)}`);
    } else {
      console.log(`PASS #${caseId} 「${label}」走技能`);
    }
  } else if (okSkill) {
    console.log(`PASS #${caseId} 「${label}」`);
  }
}

console.log(`自我描述专项 ${essayLabels.length + skillLabels.length}，失败 ${failCount}`);
process.exit(failCount > 0 ? 1 : 0);
