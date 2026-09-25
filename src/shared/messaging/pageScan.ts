import type { FieldDescriptor } from '../types/fill';
import type { ExtensionMessage } from '../types/messages';
import { sendRuntimeMessage } from './send';
import { describeUserFacingError } from './userFacingError';

/** 读条上要显示的一次进度 */
export interface PageScanProgress {
  percent: number;
  foundCount: number;
  message: string;
}

/** 页面把结果送回来的最长时间，长于页面内部的扫描上限 */
const SCAN_RESULT_WAIT_MS = 70_000;

/**
 * 让当前网申页开始扫描，并用扩展消息接收进度和字段列表。
 * 页面里的脚本会把进度直接发过来，不再依赖内容脚本写不了的会话存储。
 */
export function scanActivePage(
  requestId: string,
  onProgress: (progress: PageScanProgress) => void,
): Promise<{ fields: FieldDescriptor[]; notice?: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;

    /**
     * 结束等待，只生效一次。
     */
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      window.clearTimeout(safetyTimer);
      settle();
    };

    /**
     * 接收页面发来的进度、字段列表或失败说明。
     */
    const onRuntimeMessage = (message: ExtensionMessage): void => {
      if (!message || !('requestId' in message) || message.requestId !== requestId) {
        return;
      }
      if (message.type === 'SCAN_PROGRESS') {
        onProgress({
          percent: message.percent,
          foundCount: message.foundCount,
          message: message.message,
        });
        return;
      }
      if (message.type === 'SCAN_FIELDS_RESULT') {
        finish(() => {
          resolve({ fields: message.fields, notice: message.notice });
        });
        return;
      }
      if (message.type === 'ERROR' && message.code === 'SCAN_FAILED') {
        finish(() => {
          reject(new Error(describeUserFacingError(message.message)));
        });
      }
    };

    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    const safetyTimer = window.setTimeout(() => {
      finish(() => {
        reject(
          new Error('扫描脚本没有把结果送回来。请刷新网申页后再点一次扫描。'),
        );
      });
    }, SCAN_RESULT_WAIT_MS);

    void sendRuntimeMessage({
      type: 'SCAN_FIELDS',
      requestId,
    } satisfies ExtensionMessage)
      .then((response) => {
        if (settled) {
          return;
        }
        if (response.type === 'ERROR') {
          finish(() => {
            reject(new Error(describeUserFacingError(response.message)));
          });
          return;
        }
        if (response.type === 'SCAN_FIELDS_RESULT') {
          finish(() => {
            resolve({ fields: response.fields, notice: response.notice });
          });
        }
      })
      .catch((error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error('扫描没有开始。请刷新网申页后再试。'));
        });
      });
  });
}

/**
 * 问模型对照档案，并每秒回调已等待的秒数。调用方负责把秒数写成进度。
 */
export async function requestFillPlanWithWait(
  requestId: string,
  profileId: string,
  fields: FieldDescriptor[],
  onWaitSeconds: (elapsedSeconds: number) => void,
): Promise<Extract<ExtensionMessage, { type: 'FILL_PLAN_RESULT' }>> {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    onWaitSeconds(elapsedSeconds);
  }, 1000);
  try {
    const response = await sendRuntimeMessage({
      type: 'BUILD_FILL_PLAN',
      requestId,
      profileId,
      fields,
    } satisfies ExtensionMessage);
    if (response.type === 'ERROR') {
      throw new Error(describeUserFacingError(response.message));
    }
    if (response.type !== 'FILL_PLAN_RESULT') {
      throw new Error('填写计划没有生成。请再点一次扫描。');
    }
    return response;
  } finally {
    window.clearInterval(timer);
  }
}
