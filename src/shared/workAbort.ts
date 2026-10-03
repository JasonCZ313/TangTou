/**
 * 后台这一轮扫描/对照/写入的中止信号（代次 + AbortController）。
 * 侧栏点「停止」立刻 abort；新一轮用户操作才换代，禁止对照中途换锁把停止作废。
 */

/** 当前这一轮工作的控制器 */
let pageWorkController: AbortController | null = null;

/** 当前工作代次（与侧栏 / 内容脚本对齐） */
let pageWorkGeneration = 0;

/** 已作废到哪一代（含） */
let stoppedThroughGeneration = -1;

/**
 * 用户新点「扫描 / 确认写入」时调用：换代并换一把新的中止锁。
 * 若该代次已被停止过，新锁立刻 abort，防止「后到的 begin」救活停止。
 */
export function beginPageWorkAbort(preferredGeneration?: number): AbortSignal {
  if (
    typeof preferredGeneration === 'number'
    && Number.isFinite(preferredGeneration)
    && preferredGeneration > 0
  ) {
    pageWorkGeneration = Math.floor(preferredGeneration);
  } else {
    pageWorkGeneration += 1;
  }
  pageWorkController = new AbortController();
  if (pageWorkGeneration <= stoppedThroughGeneration) {
    pageWorkController.abort();
  }
  return pageWorkController.signal;
}

/**
 * 侧栏/弹窗点了停止：立刻打断后台 fetch，并作废指定/当前代次。
 */
export function abortPageWork(workGeneration?: number): void {
  const target =
    typeof workGeneration === 'number' && Number.isFinite(workGeneration) && workGeneration > 0
      ? Math.floor(workGeneration)
      : pageWorkGeneration;
  stoppedThroughGeneration = Math.max(stoppedThroughGeneration, target, pageWorkGeneration);
  pageWorkController?.abort();
}

/**
 * 正在飞的模型请求应挂上这个 signal。
 */
export function getPageWorkAbortSignal(): AbortSignal | undefined {
  return pageWorkController?.signal;
}

/**
 * 用户是否已经点过停止（当前代次已作废）。
 */
export function isPageWorkAborted(): boolean {
  return pageWorkGeneration <= stoppedThroughGeneration
    || pageWorkController?.signal.aborted === true;
}

/**
 * 当前后台工作代次。
 */
export function getPageWorkGeneration(): number {
  return pageWorkGeneration;
}
