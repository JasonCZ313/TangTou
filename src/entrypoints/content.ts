import { scanFieldsSettled } from '../content/scanner/scanFields';
import { applyFillPlan, undoLastFill } from '../content/filler/fillFields';
import { clearFillStop, requestFillStop } from '../content/fillAbort';
import { describeUserFacingError } from '../shared/messaging/userFacingError';
import type { ExtensionMessage } from '../shared/types/messages';

/**
 * 把扫描进度和最终字段直接发给扩展页面。
 * 不写 chrome.storage.session：内容脚本默认没有那块存储的写入权。
 */
function reportToExtension(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/**
 * 内容脚本入口：在任意 http/https 页监听扫描、安全写入与撤销。
 * 扫描立刻回执，进度和字段列表用单独的消息送回侧栏和弹窗。
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === 'STOP_PAGE_WORK') {
          requestFillStop();
          sendResponse({
            type: 'STOP_PAGE_WORK_ACK',
            requestId: message.requestId,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'SCAN_FIELDS') {
          const requestId = message.requestId;
          clearFillStop();
          reportToExtension({
            type: 'SCAN_PROGRESS',
            requestId,
            percent: 4,
            foundCount: 0,
            message: '正在滚动页面，已发现 0 个输入框。',
          });
          void scanFieldsSettled(document, (update) => {
            reportToExtension({
              type: 'SCAN_PROGRESS',
              requestId,
              percent: update.percent,
              foundCount: update.foundCount,
              message: update.message,
            });
          })
            .then((result) => {
              reportToExtension({
                type: 'SCAN_PROGRESS',
                requestId,
                percent: 88,
                foundCount: result.fields.length,
                message: result.notice
                  ? result.notice
                  : `页面扫完了，发现 ${result.fields.length} 个输入框。`,
              });
              reportToExtension({
                type: 'SCAN_FIELDS_RESULT',
                requestId,
                fields: result.fields,
                notice: result.notice,
              });
            })
            .catch((error: unknown) => {
              reportToExtension({
                type: 'ERROR',
                requestId,
                code: 'SCAN_FAILED',
                message: describeUserFacingError(error),
              });
            });
          sendResponse({
            type: 'SCAN_FIELDS_STARTED',
            requestId,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'APPLY_FILL_PLAN') {
          clearFillStop();
          void applyFillPlan(
            message.plan,
            message.filePayloads ?? [],
            message.profileId,
            message.sectionAdds ?? [],
            message.profileData,
          )
            .then((result) => {
              sendResponse({
                type: 'APPLY_FILL_RESULT',
                requestId: message.requestId,
                ...result,
              } satisfies ExtensionMessage);
            })
            .catch((error: unknown) => {
              sendResponse({
                type: 'ERROR',
                requestId: message.requestId,
                code: 'FILL_FAILED',
                message: describeUserFacingError(error),
              } satisfies ExtensionMessage);
            });
          return true;
        }

        if (message.type === 'UNDO_LAST_FILL') {
          const result = undoLastFill();
          sendResponse({
            type: 'UNDO_FILL_RESULT',
            requestId: message.requestId,
            ...result,
          } satisfies ExtensionMessage);
          return true;
        }

        return false;
      },
    );
  },
});
