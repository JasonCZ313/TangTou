import { scanFieldsSettled } from '../content/scanner/scanFields';
import { applyFillPlan, undoLastFill } from '../content/filler/fillFields';
import { ensureSectionRows } from '../content/filler/ensureSectionRows';
import {
  alignFillWorkGeneration,
  beginFillWork,
  requestFillStop,
  shouldFillStop,
} from '../content/fillAbort';
import {
  hidePageOverlay,
  updatePageOverlay,
} from '../content/ui/pageOverlay';
import { collectPageEvidence } from '../content/probe/collectEvidence';
import { executeApprovedPlaybookSteps } from '../content/probe/executePlaybook';
import { describeUserFacingError } from '../shared/messaging/userFacingError';
import {
  clearRegionFieldScanUi,
  runRegionFieldScan,
  scheduleRegionFieldScan,
} from '../content/region/regionFieldScan';
import {
  cancelRegionSelectFromHost,
  queryRegionSelect,
  setRegionSelectLifecycleHandlers,
  startRegionSelect,
} from '../content/region/regionSelect';
import type { ExtensionMessage } from '../shared/types/messages';

/**
 * 把扫描进度和最终字段直接发给扩展页面。
 * 不写 chrome.storage.session：内容脚本默认没有那块存储的写入权。
 */
function reportToExtension(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/**
 * 内容脚本入口：在任意 http/https 页监听扫描、补行、安全写入、浮层与探活。
 * 截图 OCR（P4b）已迁至 Offscreen，此处不再 createWorker。
 * 扫描立刻回执，进度和字段列表用单独的消息送回侧栏和弹窗。
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    setRegionSelectLifecycleHandlers({
      onBoxed: () => {
        scheduleRegionFieldScan();
      },
      onEnd: () => {
        clearRegionFieldScanUi();
      },
    });

    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === 'START_REGION_SELECT') {
          const started = startRegionSelect();
          sendResponse({
            type: 'START_REGION_SELECT_RESULT',
            requestId: message.requestId,
            alreadyActive: started.alreadyActive,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'QUERY_REGION_SELECT') {
          sendResponse({
            type: 'REGION_SELECT_STATE',
            requestId: message.requestId,
            active: queryRegionSelect().active,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'END_REGION_SELECT') {
          const hadSession = queryRegionSelect().active;
          cancelRegionSelectFromHost();
          sendResponse({
            type: 'END_REGION_SELECT_RESULT',
            requestId: message.requestId,
            ended: hadSession,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'CANCEL_REGION_SELECT_HOST') {
          cancelRegionSelectFromHost();
          return false;
        }

        if (message.type === 'SCAN_REGION_FIELDS') {
          void runRegionFieldScan(message.requestId).then((outcome) => {
            if (!outcome) {
              sendResponse({ type: 'REGION_SCAN_CLEARED' } satisfies ExtensionMessage);
              return;
            }
            sendResponse({
              type: 'REGION_SCAN_RESULT',
              requestId: message.requestId,
              fields: outcome.fields,
              durationMs: outcome.durationMs,
              notice: outcome.notice,
            } satisfies ExtensionMessage);
          });
          return true;
        }

        if (message.type === 'STOP_PAGE_WORK') {
          requestFillStop(message.workGeneration);
          hidePageOverlay();
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

        // P4b 截图 OCR 已迁至 Offscreen（OFFSCREEN_OCR），内容脚本不再 createWorker

        if (message.type === 'COLLECT_PAGE_EVIDENCE') {
          const enableProbeClicks = message.enableProbeClicks === true;
          updatePageOverlay({
            percent: 15,
            message: enableProbeClicks
              ? '正在收集证据（含受控探测，不提交）…'
              : '正在收集页内证据（只读，不点击）…',
            showCancel: enableProbeClicks,
          });
          void collectPageEvidence({
            enableProbeClicks,
            onProgress: (progressMessage) => {
              updatePageOverlay({
                percent: 35,
                message: progressMessage,
                showCancel: enableProbeClicks,
              });
            },
          })
            .then((evidence) => {
              hidePageOverlay();
              sendResponse({
                type: 'COLLECT_PAGE_EVIDENCE_RESULT',
                requestId: message.requestId,
                evidence,
              } satisfies ExtensionMessage);
            })
            .catch((error: unknown) => {
              hidePageOverlay();
              sendResponse({
                type: 'ERROR',
                requestId: message.requestId,
                code: 'EVIDENCE_FAILED',
                message: describeUserFacingError(error),
              } satisfies ExtensionMessage);
            });
          return true;
        }

        if (message.type === 'SCAN_FIELDS') {
          const requestId = message.requestId;
          // 同代续扫只对齐代次；新开一轮才 begin。禁止清停止。
          if (message.continueWork) {
            if (typeof message.workGeneration === 'number') {
              alignFillWorkGeneration(message.workGeneration);
            }
          } else {
            beginFillWork(message.workGeneration);
          }
          if (shouldFillStop()) {
            hidePageOverlay();
            reportToExtension({
              type: 'SCAN_FIELDS_RESULT',
              requestId,
              fields: [],
              notice: '已停止。',
            });
            sendResponse({
              type: 'SCAN_FIELDS_STARTED',
              requestId,
            } satisfies ExtensionMessage);
            return true;
          }
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
            if (shouldFillStop()) {
              return;
            }
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
              if (shouldFillStop()) {
                hidePageOverlay();
                reportToExtension({
                  type: 'SCAN_FIELDS_RESULT',
                  requestId,
                  fields: result.fields,
                  notice: '已停止。',
                });
                return;
              }
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
          beginFillWork(message.workGeneration);
          const fillScope = message.fillScope === 'region' ? 'region' : 'page';
          void applyFillPlan(
            message.plan,
            message.filePayloads ?? [],
            message.profileId,
            message.sectionAdds ?? [],
            message.profileData,
            fillScope,
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

        // P7b：用户确认后的探活逐步执行（含回读；永不点提交）
        if (message.type === 'EXECUTE_PLAYBOOK') {
          beginFillWork();
          updatePageOverlay({
            percent: 5,
            message: '正在按确认过的探活方案逐步执行…',
            showCancel: true,
          });
          void executeApprovedPlaybookSteps(message.steps)
            .then((result) => {
              sendResponse({
                type: 'EXECUTE_PLAYBOOK_RESULT',
                requestId: message.requestId,
                completed: result.completed,
                stopped: result.stopped,
                misses: result.misses,
                results: result.results,
              } satisfies ExtensionMessage);
            })
            .catch((error: unknown) => {
              hidePageOverlay();
              sendResponse({
                type: 'ERROR',
                requestId: message.requestId,
                code: 'PLAYBOOK_EXEC_FAILED',
                message: describeUserFacingError(error),
              } satisfies ExtensionMessage);
            });
          return true;
        }

        if (message.type === 'UNDO_LAST_FILL') {
          const undoScope = message.fillScope === 'region' ? 'region' : 'page';
          const result = undoLastFill(undoScope);
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
