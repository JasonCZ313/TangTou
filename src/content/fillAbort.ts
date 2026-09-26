/** 用户点了「停止」后，扫描和写入在下一格停住。 */
let stopRequested = false;

/** 开始新一轮扫描或写入前清掉上次的停止。 */
export function clearFillStop(): void {
  stopRequested = false;
}

/** 侧栏或弹窗要求立刻停。 */
export function requestFillStop(): void {
  stopRequested = true;
}

/** 循环里每处理一格查一次。 */
export function shouldFillStop(): boolean {
  return stopRequested;
}
