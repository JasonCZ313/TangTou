import { scanFields } from '../content/scanner/scanFields';
import { applyFillPlan, undoLastFill } from '../content/filler/fillFields';
import type { ExtensionMessage } from '../shared/types/messages';

/**
 * 内容脚本入口：在任意 http/https 页监听扫描、安全写入与撤销消息。
 * 同步 sendResponse；返回 true 以保持消息通道在 Chrome MV3 下可靠关闭。
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === 'SCAN_FIELDS') {
          const fields = scanFields(document);
          sendResponse({
            type: 'SCAN_FIELDS_RESULT',
            requestId: message.requestId,
            fields,
          } satisfies ExtensionMessage);
          return true;
        }

        if (message.type === 'APPLY_FILL_PLAN') {
          const result = applyFillPlan(message.plan);
          sendResponse({
            type: 'APPLY_FILL_RESULT',
            requestId: message.requestId,
            ...result,
          } satisfies ExtensionMessage);
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
