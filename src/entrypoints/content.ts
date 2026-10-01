import { scanFieldsSettled } from '../content/scanner/scanFields';
import { applyFillPlan, undoLastFill } from '../content/filler/fillFields';
import { ensureSectionRows } from '../content/filler/ensureSectionRows';
import { clearFillStop, requestFillStop } from '../content/fillAbort';
import {
  hidePageOverlay,
  updatePageOverlay,
} from '../content/ui/pageOverlay';
import { recognizePageImageDataUrl } from '../content/vision/pageOcr';
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
 * 内容脚本入口：在任意 http/https 页监听扫描、补行、安全写入、浮层与页内 OCR。
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
          updatePageOverlay({
            percent: 0,
            message: '已请求停止…',
            showCancel: false,
          });
          sendResponse({
            type: 'STOP_PAGE_WORK_ACK',
            requestId: message.requestId,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'PAGE_OVERLAY_UPDATE') {
          updatePageOverlay({
            percent: message.percent,
            message: message.message,
            highlightFieldIds: message.highlightFieldIds,
            showCancel: message.showCancel,
          });
          sendResponse({
            type: 'PAGE_OVERLAY_UPDATE',
            requestId: message.requestId,
            percent: message.percent,
            message: message.message,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'PAGE_OVERLAY_HIDE') {
          hidePageOverlay();
          sendResponse({
            type: 'PAGE_OVERLAY_HIDE',
            requestId: message.requestId,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'RUN_PAGE_OCR') {
          void recognizePageImageDataUrl(message.imageDataUrl)
            .then((ocrText) => {
              sendResponse({
                type: 'RUN_PAGE_OCR_RESULT',
                requestId: message.requestId,
                ocrText,
              } satisfies ExtensionMessage);
            })
            .catch((error: unknown) => {
              sendResponse({
                type: 'ERROR',
                requestId: message.requestId,
                code: 'PAGE_OCR_FAILED',
                message: describeUserFacingError(error),
              } satisfies ExtensionMessage);
            });
          return true;
        }

        if (message.type === 'SCAN_FIELDS') {
          const requestId = message.requestId;
          clearFillStop();
          updatePageOverlay({
            percent: 4,
            message: '正在滚动扫描页面…',
            showCancel: true,
          });
          reportToExtension({
            type: 'SCAN_PROGRESS',
            requestId,
            percent: 4,
            foundCount: 0,
            message: '正在滚动页面，已发现 0 个输入框。',
          });
          void scanFieldsSettled(document, (update) => {
            updatePageOverlay({
              percent: update.percent,
              message: update.message,
              showCancel: true,
            });
            reportToExtension({
              type: 'SCAN_PROGRESS',
              requestId,
              percent: update.percent,
              foundCount: update.foundCount,
              message: update.message,
            });
          })
            .then((result) => {
              updatePageOverlay({
                percent: 100,
                message: result.notice
                  ? result.notice
                  : `扫描完成，发现 ${result.fields.length} 个输入框`,
                showCancel: false,
              });
              window.setTimeout(() => {
                hidePageOverlay();
              }, 1200);
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
              hidePageOverlay();
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

        if (message.type === 'ENSURE_SECTION_ROWS') {
          clearFillStop();
          updatePageOverlay({
            percent: 10,
            message: '正在按档案补齐分区行…',
            showCancel: true,
          });
          void ensureSectionRows(message.sectionAdds ?? [])
            .then((result) => {
              hidePageOverlay();
              sendResponse({
                type: 'ENSURE_SECTION_ROWS_RESULT',
                requestId: message.requestId,
                clicks: result.clicks,
                notices: result.notices,
              } satisfies ExtensionMessage);
            })
            .catch((error: unknown) => {
              hidePageOverlay();
              sendResponse({
                type: 'ERROR',
                requestId: message.requestId,
                code: 'ENSURE_ROWS_FAILED',
                message: describeUserFacingError(error),
              } satisfies ExtensionMessage);
            });
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
              hidePageOverlay();
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
          hidePageOverlay();
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
