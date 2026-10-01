/**
 * 批次①（P1）合并择优冒烟：不依赖打包，直接复刻判定逻辑做断言。
 */
function getFillSourcePriority(source) {
  switch (source) {
    case 'user':
      return 40;
    case 'probe':
    case 'laya':
    case 'llm':
      return 30;
    case 'rule':
      return 10;
    default:
      return 10;
  }
}

function shouldProbeItemOverwriteExisting(existing, probeItem) {
  if (!existing) {
    return true;
  }
  const existingPriority = getFillSourcePriority(existing.source);
  const probePriority = getFillSourcePriority(probeItem.source ?? 'probe');
  if (existingPriority > probePriority) {
    return false;
  }
  if (existingPriority < probePriority) {
    return true;
  }
  return probeItem.confidence > existing.confidence;
}

const cases = [
  {
    name: 'user 永不覆盖',
    existing: { source: 'user', confidence: 0.5 },
    probe: { source: 'probe', confidence: 0.99 },
    expect: false,
  },
  {
    name: '低置信探活不盖高置信云端',
    existing: { source: 'llm', confidence: 0.95 },
    probe: { source: 'probe', confidence: 0.6 },
    expect: false,
  },
  {
    name: '同级相等置信不盖',
    existing: { source: 'llm', confidence: 0.8 },
    probe: { source: 'probe', confidence: 0.8 },
    expect: false,
  },
  {
    name: '同级更高置信可盖',
    existing: { source: 'llm', confidence: 0.7 },
    probe: { source: 'probe', confidence: 0.85 },
    expect: true,
  },
  {
    name: '探活可盖规则',
    existing: { source: 'rule', confidence: 0.99 },
    probe: { source: 'probe', confidence: 0.6 },
    expect: true,
  },
  {
    name: '无已有项可新增',
    existing: undefined,
    probe: { source: 'probe', confidence: 0.6 },
    expect: true,
  },
];

let failed = 0;
for (const testCase of cases) {
  const actual = shouldProbeItemOverwriteExisting(
    testCase.existing,
    testCase.probe,
  );
  if (actual !== testCase.expect) {
    failed += 1;
    console.error(`FAIL ${testCase.name}: got ${actual}`);
  } else {
    console.log(`OK   ${testCase.name}`);
  }
}

function extractYear(rawDate) {
  return rawDate?.match(/(19|20)\d{2}/)?.[0];
}
function extractMonth(rawDate) {
  const afterYear = rawDate?.match(
    /(?:19|20)\d{2}\s*[./\-年]?\s*(0?[1-9]|1[0-2])(?:\s*[月日]|\/|$|\D)/,
  );
  if (afterYear?.[1]) {
    return `${Number.parseInt(afterYear[1], 10)}月`;
  }
  return undefined;
}

const dateCases = [
  ['2020-09', '2020', '9月'],
  ['2018/7/1', '2018', '7月'],
  ['2021.12', '2021', '12月'],
  ['2019年03月', '2019', '3月'],
];
for (const [raw, year, month] of dateCases) {
  const gotYear = extractYear(raw);
  const gotMonth = extractMonth(raw);
  if (gotYear !== year || gotMonth !== month) {
    failed += 1;
    console.error(`FAIL date ${raw}: year=${gotYear} month=${gotMonth}`);
  } else {
    console.log(`OK   date ${raw}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
console.log(`全部通过`);
