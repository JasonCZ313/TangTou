/**
 * N2 年月绑段 + N3 合并白名单冒烟。
 */
function pickProfileDateForTemporalLabel(label, profileData) {
  if (!profileData) return undefined;
  const blob = label.replace(/\s+/g, '');
  const education = profileData.education?.[0];
  const experience = profileData.experience?.[0];
  const project = profileData.projects?.[0];

  if (/毕业|结束|截至|至今前/.test(blob)) {
    if (/教育|学历|入学|就读|毕业/.test(blob)) {
      return education?.endDate?.trim() || undefined;
    }
    if (/工作|实习|入职|离职|任职/.test(blob)) {
      return experience?.endDate?.trim() || undefined;
    }
    if (/项目/.test(blob)) {
      return project?.endDate?.trim() || undefined;
    }
    return (
      education?.endDate?.trim() ||
      experience?.endDate?.trim() ||
      project?.endDate?.trim() ||
      undefined
    );
  }
  if (
    /入职|到岗|任职|工作开始|实习开始/.test(blob) ||
    (/工作|实习/.test(blob) && /开始|年月|日期/.test(blob))
  ) {
    return experience?.startDate?.trim() || project?.startDate?.trim() || undefined;
  }
  if (/离职|工作结束|实习结束/.test(blob)) {
    return experience?.endDate?.trim() || undefined;
  }
  if (/项目开始/.test(blob) || (/项目/.test(blob) && /开始|年月|日期/.test(blob))) {
    return project?.startDate?.trim() || undefined;
  }
  if (/项目结束/.test(blob)) {
    return project?.endDate?.trim() || undefined;
  }
  if (/入学|就读|教育|学历/.test(blob)) {
    if (/结束|毕业|截至/.test(blob)) {
      return education?.endDate?.trim() || undefined;
    }
    return education?.startDate?.trim() || undefined;
  }
  if (/^(开始|年月|日期|时间)$/.test(blob) || /^(开始)?(年|月|年月|日期)$/.test(blob)) {
    return undefined;
  }
  if (/开始/.test(blob) && !/教育|学历|入学|就读|工作|实习|项目|入职/.test(blob)) {
    return undefined;
  }
  return undefined;
}

function isPlaybookStepMergeable(step, minConfidence) {
  if (!step.isWrite) return false;
  const kindAllowed =
    step.kind === 'fill_field' ||
    step.kind === 'select_option' ||
    step.kind === 'open_picker';
  if (!kindAllowed) return false;
  if (!step.targetFieldId?.trim()) return false;
  if (!step.suggestedValue?.trim()) return false;
  if (step.confidence < minConfidence) return false;
  return true;
}

const profile = {
  education: [{ startDate: '2018-09', endDate: '2022-06' }],
  experience: [{ startDate: '2022-07', endDate: '2024-01' }],
  projects: [{ startDate: '2023-03', endDate: '2023-12' }],
};

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${name}`);
  } else {
    console.log(`OK   ${name}`);
  }
}

assert(
  '入学年→教育',
  pickProfileDateForTemporalLabel('入学年', profile) === '2018-09',
);
assert(
  '实习开始→经历',
  pickProfileDateForTemporalLabel('实习开始年月', profile) === '2022-07',
);
assert(
  '开始年月不猜段',
  pickProfileDateForTemporalLabel('开始年月', profile) === undefined,
);
assert(
  '项目开始→项目',
  pickProfileDateForTemporalLabel('项目开始', profile) === '2023-03',
);
assert(
  'open_picker 有值可合并',
  isPlaybookStepMergeable(
    {
      kind: 'open_picker',
      isWrite: true,
      targetFieldId: 'f1',
      suggestedValue: '北京',
      confidence: 0.7,
    },
    0.55,
  ),
);
assert(
  'open_picker 无值不可合并',
  !isPlaybookStepMergeable(
    {
      kind: 'open_picker',
      isWrite: true,
      targetFieldId: 'f1',
      suggestedValue: '',
      confidence: 0.7,
    },
    0.55,
  ),
);

if (failed > 0) {
  process.exit(1);
}
console.log('N2/N3 冒烟全部通过');
