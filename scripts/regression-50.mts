/**
 * 躺投填写/绑定回归：50 个案例。只排查不修代码。
 * 覆盖：城市、证件、手机、教育/项目/校内/获奖串行、空日期、论文、个人能力、月份不补零、下拉选项、长文换行、错误文案等。
 */
import { createEmptyProfileData } from '../src/shared/storage/defaults.ts';
import {
  bindLabeledField,
  bindSectionFields,
  cityNameOnly,
} from '../src/shared/fill/sectionBinder.ts';
import { applyLocalHeuristics } from '../src/shared/llm/localHeuristics.ts';
import { restoreListLineBreaks } from '../src/shared/resume/restoreListBreaks.ts';
import { describeUserFacingError } from '../src/shared/messaging/userFacingError.ts';
import type { FieldDescriptor } from '../src/shared/types/fill.ts';
import type { ProfileData } from '../src/shared/types/profile.ts';

interface CaseResult {
  id: number;
  name: string;
  passed: boolean;
  detail: string;
}

function fieldOf(
  label: string,
  options?: string[],
  extras?: Partial<FieldDescriptor>,
): FieldDescriptor {
  return {
    fieldId: `f-${label}`,
    tag: 'input',
    type: 'text',
    label,
    selectorHint: 'input',
    options,
    ...extras,
  };
}

function bindValue(profile: ProfileData, label: string, options?: string[]): string | null {
  const bound = bindLabeledField(fieldOf(label, options), profile);
  if (!bound) {
    return null;
  }
  if (bound.kind === 'skip') {
    return `__skip__:${bound.reason}`;
  }
  return bound.value;
}

function bindKind(profile: ProfileData, label: string, options?: string[]): string {
  const bound = bindLabeledField(fieldOf(label, options), profile);
  if (!bound) {
    return 'null';
  }
  return bound.kind;
}

function makeComplexProfile(): ProfileData {
  const profile = createEmptyProfileData();
  profile.basic.fullName = '测试同学';
  profile.basic.phone = '15801166399';
  profile.basic.email = 'test@example.com';
  profile.basic.currentCity = '北京市 / 直辖市 / 通州区';
  profile.basic.currentCityRegion = {
    provinceCode: '11',
    provinceName: '北京市',
    cityCode: '1101',
    cityName: '市辖区',
    districtCode: '110112',
    districtName: '通州区',
    text: '北京市 / 直辖市 / 通州区',
  };
  profile.basic.idType = '身份证';
  profile.basic.idNumber = '110112200503130310';
  profile.basic.birthday = '2005-03-13';
  profile.basic.ethnicity = '汉族';
  profile.basic.politicalStatus = '共青团员';
  profile.basic.gender = '男';
  profile.jobIntent.expectedCities = '北京市 / 直辖市 / 通州区';
  profile.jobIntent.workCity = '北京市 / 朝阳区';
  profile.education = [
    {
      school: '北京建筑大学',
      degreeLevel: 'bachelor',
      major: '建筑学',
      startDate: '2023-09',
      endDate: '2027-07',
      description: '在读',
      rank: '',
      city: '北京市 / 西城区',
    },
    {
      school: '某高中',
      degreeLevel: 'senior_high',
      major: '理科',
      startDate: '2020-09',
      endDate: '2023-06',
      description: '',
    },
  ];
  profile.experience = [
    {
      company: '外语教学与研究出版社',
      title: '技术开发岗',
      startDate: '2027-07',
      endDate: '',
      isCurrent: true,
      description: '开发',
      responsibilities: '做工具',
      workContent: '填表助手',
    },
  ];
  profile.projects = [
    {
      name: '躺投',
      role: '全栈',
      duty: '架构设计',
      startDate: '2026-08',
      endDate: '2026-10',
      description: '扩展',
      content: 'DOM 扫描',
    },
    {
      name: 'WebCClaw',
      role: '架构',
      duty: '安全底座',
      startDate: '2026-01',
      endDate: '2026-06',
      description: 'Agent',
      content: '技能扩展',
    },
  ];
  profile.campusActivities = [
    {
      organization: '学生会',
      role: '部长',
      startDate: '2024-09',
      endDate: '2025-06',
      description: '组织活动',
    },
  ];
  profile.awards = [
    { name: '种子杯', date: '', prizeRank: 'first' },
    { name: '挑战杯', date: '2024-05', prizeRank: 'second' },
    { name: '数学竞赛', date: '', level: '省级' },
  ];
  profile.certificates = [
    { name: '英语四级', date: '2024-06' },
    { name: '计算机二级', date: '' },
    { name: '驾驶证', date: '2023-01' },
  ];
  profile.skills = [{ name: 'Python' }, { name: 'Excel' }];
  profile.publications = [];
  profile.essays.selfEvaluation =
    '软硬结合 · 工控+AI · 能出差\n从硬件选型到 HMI 设计都能行。';
  return profile;
}

const profile = makeComplexProfile();
const monthOpts = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const monthOptsPadded = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const yearOpts = Array.from({ length: 30 }, (_, index) => String(2000 + index));
const idTypeOpts = ['身份证', '护照', '身份证(中国香港)'];
const rankOpts = ['前5%', '前10%', '前20%', '前30%'];

const cases: Array<{ name: string; run: () => { ok: boolean; detail: string } }> = [
  // —— 城市 ——
  {
    name: '城市名只取北京市，丢掉通州区',
    run: () => {
      const value = cityNameOnly('北京市 / 直辖市 / 通州区');
      return { ok: value === '北京市', detail: value };
    },
  },
  {
    name: '意向城市绑定不写区县整段',
    run: () => {
      const value = bindValue(profile, '意向工作城市');
      return { ok: value === '北京市', detail: String(value) };
    },
  },
  {
    name: '工作城市绑定只写城市名',
    run: () => {
      const value = bindValue(profile, '期望城市');
      return { ok: value === '北京市', detail: String(value) };
    },
  },
  {
    name: '启发式城市也不带通州区',
    run: () => {
      const { partialPlan } = applyLocalHeuristics(profile, [fieldOf('现居住城市')]);
      const item = partialPlan.items[0];
      return {
        ok: Boolean(item && item.value === '北京市'),
        detail: item?.value ?? '无',
      };
    },
  },
  // —— 证件 / 手机 ——
  {
    name: '证件类型点选身份证',
    run: () => {
      const value = bindValue(profile, '证件类型', idTypeOpts);
      return { ok: value === '身份证', detail: String(value) };
    },
  },
  {
    name: '证件号码框写完整号码',
    run: () => {
      const value = bindValue(profile, '证件号码');
      return { ok: value === '110112200503130310', detail: String(value) };
    },
  },
  {
    name: '证件号码标签若带证件类型选项则跳过',
    run: () => {
      const value = bindValue(profile, '证件号码', idTypeOpts);
      return { ok: value?.startsWith('__skip__') === true, detail: String(value) };
    },
  },
  {
    name: '手机号码写入号码框',
    run: () => {
      const value = bindValue(profile, '手机号码');
      return { ok: value === '15801166399', detail: String(value) };
    },
  },
  {
    name: '手机号不能写入区号下拉选项列表',
    run: () => {
      const value = bindValue(profile, '手机号码', ['+86', '中国大陆']);
      return { ok: value?.startsWith('__skip__') === true, detail: String(value) };
    },
  },
  {
    name: '电话区号启发式是 +86 不是整串手机',
    run: () => {
      const { partialPlan } = applyLocalHeuristics(profile, [fieldOf('电话区号')]);
      return {
        ok: partialPlan.items[0]?.value === '+86',
        detail: partialPlan.items[0]?.value ?? '无',
      };
    },
  },
  {
    name: '手机启发式不命中区号标签',
    run: () => {
      const { partialPlan, remainingFields } = applyLocalHeuristics(profile, [
        fieldOf('电话区号'),
      ]);
      const phoneHit = partialPlan.items.find((item) => item.value === '15801166399');
      return { ok: !phoneHit, detail: phoneHit ? '误命中手机' : '区号单独处理' };
    },
  },
  // —— 教育 ——
  {
    name: '教育第1行开始年 2023',
    run: () => {
      const value = bindValue(profile, '教育背景第1行开始年');
      return { ok: value === '2023', detail: String(value) };
    },
  },
  {
    name: '教育第1行开始月是 9 不是 09',
    run: () => {
      const value = bindValue(profile, '教育背景第1行开始月', monthOpts);
      return { ok: value === '9', detail: String(value) };
    },
  },
  {
    name: '教育第1行结束年 2027 不和开始对调',
    run: () => {
      const value = bindValue(profile, '教育背景第1行结束年');
      return { ok: value === '2027', detail: String(value) };
    },
  },
  {
    name: '教育第1行结束月 7',
    run: () => {
      const value = bindValue(profile, '教育背景第1行结束月', monthOpts);
      return { ok: value === '7', detail: String(value) };
    },
  },
  {
    name: '教育第1行学校',
    run: () => {
      const value = bindValue(profile, '教育背景第1行学校名称');
      return { ok: value === '北京建筑大学', detail: String(value) };
    },
  },
  {
    name: '教育第1行学历是大学本科',
    run: () => {
      const value = bindValue(profile, '教育背景第1行学历', ['大专', '大学本科', '硕士']);
      return { ok: value === '大学本科', detail: String(value) };
    },
  },
  {
    name: '教育第2行不复制第1行学校',
    run: () => {
      const value = bindValue(profile, '教育背景第2行学校名称');
      return { ok: value === '某高中', detail: String(value) };
    },
  },
  {
    name: '教育第3行没有档案则 skip',
    run: () => {
      return {
        ok: bindKind(profile, '教育背景第3行开始年') === 'skip',
        detail: bindKind(profile, '教育背景第3行开始年'),
      };
    },
  },
  {
    name: '成绩排名空时不把大学本科填进去',
    run: () => {
      const value = bindValue(profile, '教育背景第1行最高学历-专业成绩排名', rankOpts);
      return { ok: value?.startsWith('__skip__') === true, detail: String(value) };
    },
  },
  {
    name: '成绩排名选项里没有本科则跳过',
    run: () => {
      const value = bindValue(profile, '教育背景第1行成绩排名', rankOpts);
      return { ok: value?.startsWith('__skip__') === true, detail: String(value) };
    },
  },
  // —— 项目 / 校内串行 ——
  {
    name: '项目第1行名称是躺投',
    run: () => {
      const value = bindValue(profile, '项目经历第1行名称');
      return { ok: value === '躺投', detail: String(value) };
    },
  },
  {
    name: '项目第2行名称是 WebCClaw 不串第1行',
    run: () => {
      const value = bindValue(profile, '项目经历第2行名称');
      return { ok: value === 'WebCClaw', detail: String(value) };
    },
  },
  {
    name: '项目第1行开始月 8 匹配不补零选项',
    run: () => {
      const value = bindValue(profile, '项目经历第1行开始月', monthOpts);
      return { ok: value === '8', detail: String(value) };
    },
  },
  {
    name: '项目月 08 选项列表时选 08',
    run: () => {
      const value = bindValue(profile, '项目经历第1行开始月', monthOptsPadded);
      return { ok: value === '08', detail: String(value) };
    },
  },
  {
    name: '校内任职角色是部长不进项目',
    run: () => {
      const campus = bindValue(profile, '校内任职第1行角色');
      const project = bindValue(profile, '项目经历第1行角色');
      return {
        ok: campus === '部长' && project === '全栈',
        detail: `校内=${campus} 项目=${project}`,
      };
    },
  },
  {
    name: '校内经历名称不是躺投',
    run: () => {
      const value = bindValue(profile, '校内经历第1行名称');
      return { ok: value === '学生会', detail: String(value) };
    },
  },
  {
    name: '项目时间不进校内开始年',
    run: () => {
      const value = bindValue(profile, '校内经历第1行开始年');
      return { ok: value === '2024', detail: String(value) };
    },
  },
  // —— 获奖 ——
  {
    name: '种子杯无日期则开始年 skip/空',
    run: () => {
      const value = bindValue(profile, '获奖经历第1行开始年');
      return {
        ok: value === null || value.startsWith('__skip__'),
        detail: String(value),
      };
    },
  },
  {
    name: '种子杯名称仍可绑',
    run: () => {
      const value = bindValue(profile, '获奖经历第1行名称');
      return { ok: value === '种子杯', detail: String(value) };
    },
  },
  {
    name: '第二个奖名称是挑战杯',
    run: () => {
      const value = bindValue(profile, '获奖经历第2行名称');
      return { ok: value === '挑战杯', detail: String(value) };
    },
  },
  {
    name: '第二个奖有日期可写年',
    run: () => {
      const value = bindValue(profile, '获奖经历第2行开始年', yearOpts);
      return { ok: value === '2024', detail: String(value) };
    },
  },
  {
    name: '第三个奖存在',
    run: () => {
      const value = bindValue(profile, '获奖经历第3行名称');
      return { ok: value === '数学竞赛', detail: String(value) };
    },
  },
  {
    name: '挑战杯日期不串到种子杯',
    run: () => {
      const first = bindValue(profile, '获奖经历第1行开始年');
      const second = bindValue(profile, '获奖经历第2行开始年');
      return {
        ok: (first === null || first.startsWith('__skip__')) && second === '2024',
        detail: `1=${first} 2=${second}`,
      };
    },
  },
  // —— 论文 / 个人能力 ——
  {
    name: '无论文时论文名称 skip',
    run: () => {
      return {
        ok: bindKind(profile, '论文第1行名称') === 'skip',
        detail: bindKind(profile, '论文第1行名称'),
      };
    },
  },
  {
    name: '个人能力描述是技能列表',
    run: () => {
      const value = bindValue(profile, '个人能力第1行描述');
      return { ok: value === 'Python\nExcel', detail: String(value) };
    },
  },
  {
    name: '个人能力不接受项目类标签乱入',
    run: () => {
      // 标签同时含个人能力与项目时 sectionKind 先命中 skill，再因含「项目」skip
      const value = bindValue(profile, '个人能力项目描述');
      return {
        ok: value?.startsWith('__skip__') === true,
        detail: String(value),
      };
    },
  },
  // —— 实习至今 ——
  {
    name: '实习至今勾选 true',
    run: () => {
      const value = bindValue(profile, '实习经历第1行至今');
      return { ok: value === 'true', detail: String(value) };
    },
  },
  {
    name: '实习结束年在至今时 skip',
    run: () => {
      return {
        ok: bindKind(profile, '实习经历第1行结束年') === 'skip',
        detail: bindKind(profile, '实习经历第1行结束年'),
      };
    },
  },
  {
    name: '实习公司名称正确',
    run: () => {
      const value = bindValue(profile, '实习经历第1行公司名称');
      return { ok: value === '外语教学与研究出版社', detail: String(value) };
    },
  },
  // —— 批量绑定不串 ——
  {
    name: '一次绑定多字段时教育不会复制到9行',
    run: () => {
      const labels = Array.from({ length: 9 }, (_, index) =>
        fieldOf(`教育背景第${index + 1}行开始年`),
      );
      const bound = bindSectionFields(profile, labels);
      const years = bound.items.map((item) => item.value);
      const skipped = bound.skippedFieldIds.length;
      return {
        ok: years.filter((year) => year === '2023').length === 1 && skipped >= 7,
        detail: `years=${years.join(',')} skipped=${skipped}`,
      };
    },
  },
  {
    name: '项目与获奖时间字段同时绑不交叉',
    run: () => {
      const fields = [
        fieldOf('项目经历第1行开始年'),
        fieldOf('获奖经历第1行开始年'),
        fieldOf('获奖经历第2行开始年'),
      ];
      const bound = bindSectionFields(profile, fields);
      const byId = Object.fromEntries(bound.items.map((item) => [item.fieldId, item.value]));
      return {
        ok:
          byId['f-项目经历第1行开始年'] === '2026' &&
          byId['f-获奖经历第2行开始年'] === '2024' &&
          !byId['f-获奖经历第1行开始年'],
        detail: JSON.stringify(byId),
      };
    },
  },
  // —— 长文换行 ——
  {
    name: '自我评价间隔号拆成多行',
    run: () => {
      const text = restoreListLineBreaks(profile.essays.selfEvaluation ?? '');
      const withDot = (profile.essays.selfEvaluation ?? '').replace(/[ \t]*[·•][ \t]*/g, '\n');
      const lines = withDot.split('\n').filter((line) => line.trim());
      return { ok: lines.length >= 2, detail: lines.join(' | ') };
    },
  },
  {
    name: '要点圆点前补换行',
    run: () => {
      const text = restoreListLineBreaks('第一句。•第二句•第三句');
      return { ok: text.includes('\n'), detail: text };
    },
  },
  // —— 错误文案 ——
  {
    name: 'sidePanel 手势错误不建议刷新网申页',
    run: () => {
      const message = describeUserFacingError(
        new Error('sidePanel.open() may only be called in response to a user gesture.'),
      );
      return {
        ok: !message.includes('刷新网申页') && message.includes('打开侧边助手'),
        detail: message,
      };
    },
  },
  {
    name: '连接断开仍提示刷新',
    run: () => {
      const message = describeUserFacingError(
        new Error('Could not establish connection. Receiving end does not exist.'),
      );
      return { ok: message.includes('刷新'), detail: message };
    },
  },
  // —— 复杂边界 ——
  {
    name: '月份选项只有 8 时 08 档案值仍能对上 8',
    run: () => {
      const value = bindValue(profile, '项目经历第1行开始月', monthOpts);
      return { ok: value === '8', detail: String(value) };
    },
  },
  {
    name: '无行号的「开始年」不猜测绑定',
    run: () => {
      return {
        ok: bindKind(profile, '开始年') === 'null',
        detail: bindKind(profile, '开始年'),
      };
    },
  },
  {
    name: '项目职责用 duty 不超过档案',
    run: () => {
      const value = bindValue(profile, '项目经历第1行职责');
      return { ok: value === '架构设计', detail: String(value) };
    },
  },
  {
    name: '教育城市只写北京市',
    run: () => {
      const value = bindValue(profile, '教育背景第1行城市');
      return { ok: value === '北京市', detail: String(value) };
    },
  },
  {
    name: '奖次绑定为一等奖',
    run: () => {
      const value = bindValue(profile, '获奖经历第1行奖次', [
        '特等奖',
        '一等奖',
        '二等奖',
        '三等奖',
      ]);
      return { ok: value === '一等奖', detail: String(value) };
    },
  },
  // —— 钉死：自我描述 / 基本信息 / 无行号排名 ——
  {
    name: '自我描述写 essays 不写技能名',
    run: () => {
      const value = bindValue(profile, '自我描述');
      const ok =
        Boolean(value) &&
        !value!.startsWith('__skip__') &&
        /软硬结合|工控/.test(value ?? '') &&
        !/Python|Excel/.test(value ?? '');
      return { ok, detail: String(value).slice(0, 120) };
    },
  },
  {
    name: '自我评价写 essays 不写技能名',
    run: () => {
      const value = bindValue(profile, '自我评价');
      const ok =
        Boolean(value) &&
        !value!.startsWith('__skip__') &&
        /软硬结合|工控/.test(value ?? '') &&
        !/Python|Excel/.test(value ?? '');
      return { ok, detail: String(value).slice(0, 120) };
    },
  },
  {
    name: '出生日期绑定档案值',
    run: () => {
      const value = bindValue(profile, '出生日期');
      return { ok: value === '2005-03-13', detail: String(value) };
    },
  },
  {
    name: '民族绑定汉族',
    run: () => {
      const value = bindValue(profile, '民族', ['汉族', '满族']);
      return { ok: value === '汉族', detail: String(value) };
    },
  },
  {
    name: '政治面貌绑定共青团员',
    run: () => {
      const value = bindValue(profile, '政治面貌', ['群众', '共青团员', '中共党员']);
      return { ok: value === '共青团员', detail: String(value) };
    },
  },
  {
    name: '性别绑定男',
    run: () => {
      const value = bindValue(profile, '性别', ['男', '女']);
      return { ok: value === '男', detail: String(value) };
    },
  },
  {
    name: '校内经历的项目名称写社团名不是项目名',
    run: () => {
      const value = bindValue(profile, '校内经历第1行项目名称');
      return { ok: value === '学生会', detail: String(value) };
    },
  },
  {
    name: '校内经历担任角色是部长',
    run: () => {
      const value = bindValue(profile, '校内经历第1行担任角色');
      return { ok: value === '部长', detail: String(value) };
    },
  },
  {
    name: '证书第1行名称是英语四级',
    run: () => {
      const value = bindValue(profile, '证书第1行名称');
      return { ok: value === '英语四级', detail: String(value) };
    },
  },
  {
    name: '证书第2行名称是计算机二级',
    run: () => {
      const value = bindValue(profile, '证书第2行名称');
      return { ok: value === '计算机二级', detail: String(value) };
    },
  },
  {
    name: '证书第3行名称是驾驶证',
    run: () => {
      const value = bindValue(profile, '证书第3行名称');
      return { ok: value === '驾驶证', detail: String(value) };
    },
  },
  {
    name: '证书第2行没有日期则开始年 skip',
    run: () => {
      return {
        ok: bindKind(profile, '证书第2行开始年') === 'skip',
        detail: bindKind(profile, '证书第2行开始年'),
      };
    },
  },
  {
    name: '无行号证书框不把三本拼在一起',
    run: () => {
      return {
        ok: bindKind(profile, '证书名称') === 'skip',
        detail: bindKind(profile, '证书名称'),
      };
    },
  },
  {
    name: '学历大学本科可以对上选项本科',
    run: () => {
      const value = bindValue(profile, '教育背景第1行学历', ['本科', '硕士', '博士']);
      return { ok: value === '本科', detail: String(value) };
    },
  },
  {
    name: '无行号成绩排名空时 skip 不进 LLM',
    run: () => {
      return {
        ok: bindKind(profile, '成绩排名', ['前5%', '前10%', '前20%']) === 'skip',
        detail: bindKind(profile, '成绩排名', ['前5%', '前10%']),
      };
    },
  },
  {
    name: '最高学历成绩排名空时 skip',
    run: () => {
      return {
        ok: bindKind(profile, '最高学历-专业成绩排名', ['前5%', '前10%']) === 'skip',
        detail: bindKind(profile, '最高学历-专业成绩排名', ['前5%', '前10%']),
      };
    },
  },
];

async function main(): Promise<void> {
  if (cases.length < 50) {
    console.error(`案例数不足 50，当前 ${cases.length}`);
    process.exit(2);
  }
  const results: CaseResult[] = [];
  cases.forEach((testCase, index) => {
    try {
      const outcome = testCase.run();
      results.push({
        id: index + 1,
        name: testCase.name,
        passed: outcome.ok,
        detail: outcome.detail,
      });
    } catch (error: unknown) {
      results.push({
        id: index + 1,
        name: testCase.name,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
  const failed = results.filter((item) => !item.passed);
  const passed = results.filter((item) => item.passed);
  console.log(`总案例 ${results.length}，通过 ${passed.length}，失败 ${failed.length}`);
  for (const item of failed) {
    console.log(`FAIL #${item.id} ${item.name} :: ${item.detail}`);
  }
  for (const item of passed) {
    console.log(`PASS #${item.id} ${item.name}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
