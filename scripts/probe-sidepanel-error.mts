/**
 * 专项：sidePanel 手势错误文案仍带「刷新网申页」——只测不修。
 */
import { describeUserFacingError } from '../src/shared/messaging/userFacingError.ts';

const samples = [
  'sidePanel.open() may only be called in response to a user gesture.',
  'Error: sidePanel.open() may only be called in response to a user gesture',
  'chrome.sidePanel.open() may only be called in response to a user gesture.',
  'SidePanel.open may only be called in response to a user gesture',
  'user gesture required for sidePanel.open',
];

interface CaseResult {
  id: number;
  name: string;
  passed: boolean;
  detail: string;
}

const results: CaseResult[] = [];

function add(name: string, passed: boolean, detail: string): void {
  results.push({ id: results.length + 1, name, passed, detail });
}

for (const sample of samples) {
  const message = describeUserFacingError(new Error(sample));
  add(
    `手势错误不应再出现「刷新网申页」原文：${sample.slice(0, 40)}`,
    !message.includes('刷新网申页'),
    message,
  );
  add(
    `手势错误应提示点侧边助手：${sample.slice(0, 28)}`,
    message.includes('打开侧边助手') || message.includes('侧边助手'),
    message,
  );
}

add(
  '文案若含「刷新网申页没有用」仍会让用户以为要刷新',
  !describeUserFacingError(
    new Error('sidePanel.open() may only be called in response to a user gesture.'),
  ).includes('刷新'),
  describeUserFacingError(
    new Error('sidePanel.open() may only be called in response to a user gesture.'),
  ),
);

add(
  '真正的脚本丢失错误可以提刷新',
  describeUserFacingError(
    new Error('Receiving end does not exist'),
  ).includes('刷新'),
  describeUserFacingError(new Error('Receiving end does not exist')),
);

add(
  '手势错误不要包进「这次没有完成（英文）请刷新」通用尾巴',
  !/这次没有完成（/.test(
    describeUserFacingError(
      new Error('sidePanel.open() may only be called in response to a user gesture.'),
    ),
  ),
  describeUserFacingError(
    new Error('sidePanel.open() may only be called in response to a user gesture.'),
  ),
);

console.log(`专项案例 ${results.length}，失败 ${results.filter((item) => !item.passed).length}`);
for (const item of results.filter((item) => !item.passed)) {
  console.log(`FAIL #${item.id} ${item.name}\n  => ${item.detail}`);
}
for (const item of results.filter((item) => item.passed)) {
  console.log(`PASS #${item.id} ${item.name}`);
}
process.exit(results.some((item) => !item.passed) ? 1 : 0);
