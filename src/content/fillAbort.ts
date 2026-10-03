/**
 * 页面侧停止协议：用「工作代次」作废，禁止扫描/写入消息自己清掉停止。
 * 只有用户新点「扫描 / 确认写入」才会换代；点停止后，该代次及更早一律视为已停。
 */

/** 当前正在跑的工作代次（侧栏传入或本页自增） */
let activeWorkGeneration = 0;

/** 已作废到哪一代（含）：active ≤ stopped 即应立刻停 */
let stoppedThroughGeneration = -1;

/**
 * 用户新点开始时调用：换一代（或对齐侧栏代次），这一代尚未停止。
 * @returns 新代次号
 */
export function beginFillWork(preferredGeneration?: number): number {
  if (
    typeof preferredGeneration === 'number'
    && Number.isFinite(preferredGeneration)
    && preferredGeneration > 0
  ) {
    activeWorkGeneration = Math.floor(preferredGeneration);
  } else {
    activeWorkGeneration += 1;
  }
  // 新代次默认未停止；stoppedThrough 只保留更早的作废记录
  return activeWorkGeneration;
}

/**
 * 同代续扫：只对齐代次，绝不解除停止。
 */
export function alignFillWorkGeneration(workGeneration: number): void {
  if (Number.isFinite(workGeneration) && workGeneration > 0) {
    activeWorkGeneration = Math.floor(workGeneration);
  }
}

/**
 * 侧栏或弹窗要求立刻停：作废指定代次或当前代次。
 */
export function requestFillStop(workGeneration?: number): void {
  const target =
    typeof workGeneration === 'number' && Number.isFinite(workGeneration) && workGeneration > 0
      ? Math.floor(workGeneration)
      : activeWorkGeneration;
  stoppedThroughGeneration = Math.max(stoppedThroughGeneration, target, activeWorkGeneration);
}

/**
 * 循环里每处理一格 / 每段 await 后查一次。
 */
export function shouldFillStop(): boolean {
  return activeWorkGeneration <= stoppedThroughGeneration;
}

/**
 * 当前代次（调试与进度丢弃用）。
 */
export function getFillWorkGeneration(): number {
  return activeWorkGeneration;
}

/**
 * 旧名兼容：禁止再「清掉停止」。扫描消息不得调用此函数清标记。
 * 若误调用，行为改为 no-op，避免第二遍扫描把停止救活。
 */
export function clearFillStop(): void {
  // 有意留空：停止只能靠 beginFillWork 换代解除
}
