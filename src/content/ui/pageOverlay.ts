/**
 * 页内进度浮层（P4a）：扫描/写入时显示进度、停止按钮，并对当前字段描边。
 * 使用固定 id，扫描器会排除本扩展 DOM（见 chao/dom PANEL_ID 族）。
 */
import { requestFillStop } from '../fillAbort';

/** 浮层根节点 id，避免扫到自己 */
export const TANGTOU_PAGE_OVERLAY_ID = 'tangtou-page-overlay';

/** 当前描边高亮用的 class */
const HIGHLIGHT_CLASS = 'tangtou-overlay-focus';

/**
 * 注入浮层与描边样式（幂等）。
 */
function ensureOverlayStyles(): void {
  if (document.getElementById('tangtou-page-overlay-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'tangtou-page-overlay-style';
  style.textContent = `
    #${TANGTOU_PAGE_OVERLAY_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      min-width: 220px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(17, 24, 39, 0.92);
      color: #f9fafb;
      font: 13px/1.45 system-ui, "Segoe UI", sans-serif;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
      pointer-events: auto;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} .tangtou-overlay-title {
      font-weight: 600;
      margin: 0 0 6px;
      font-size: 13px;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} .tangtou-overlay-message {
      margin: 0 0 8px;
      opacity: 0.92;
      word-break: break-word;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} .tangtou-overlay-track {
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
      overflow: hidden;
      margin-bottom: 10px;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} .tangtou-overlay-bar {
      height: 100%;
      width: 0%;
      background: #38bdf8;
      border-radius: inherit;
      transition: width 0.18s ease;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} .tangtou-overlay-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      padding: 6px 10px;
      font: inherit;
      cursor: pointer;
      background: #f87171;
      color: #111827;
      font-weight: 600;
    }
    #${TANGTOU_PAGE_OVERLAY_ID} button.tangtou-overlay-hide {
      background: rgba(255, 255, 255, 0.16);
      color: #f9fafb;
      font-weight: 500;
    }
    .${HIGHLIGHT_CLASS} {
      outline: 2px solid #38bdf8 !important;
      outline-offset: 2px !important;
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * 取得或创建浮层根节点。
 */
function obtainOverlayRoot(): HTMLElement {
  ensureOverlayStyles();
  let root = document.getElementById(TANGTOU_PAGE_OVERLAY_ID);
  if (root instanceof HTMLElement) {
    return root;
  }
  root = document.createElement('div');
  root.id = TANGTOU_PAGE_OVERLAY_ID;
  root.setAttribute('data-tangtou-ui', 'page-overlay');
  root.innerHTML = `
    <p class="tangtou-overlay-title">躺投进行中</p>
    <p class="tangtou-overlay-message"></p>
    <div class="tangtou-overlay-track" aria-hidden="true">
      <div class="tangtou-overlay-bar"></div>
    </div>
    <div class="tangtou-overlay-actions"></div>
  `;
  document.documentElement.appendChild(root);
  return root;
}

/**
 * 清掉上一轮描边高亮。
 */
function clearFocusHighlights(): void {
  document
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((node) => node.classList.remove(HIGHLIGHT_CLASS));
}

/**
 * 按 fieldId（data-raf-id）描边并滚入视野。
 */
function highlightFieldIds(fieldIds: string[]): void {
  clearFocusHighlights();
  for (const fieldId of fieldIds) {
    if (!fieldId) {
      continue;
    }
    try {
      const node = document.querySelector(
        `[data-raf-id="${CSS.escape(fieldId)}"]`,
      );
      if (node instanceof HTMLElement) {
        node.classList.add(HIGHLIGHT_CLASS);
        node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } catch {
      /* 非法 fieldId 忽略 */
    }
  }
}

/**
 * 更新或展示页内浮层。
 */
export function updatePageOverlay(options: {
  percent: number;
  message: string;
  highlightFieldIds?: string[];
  showCancel?: boolean;
}): void {
  const root = obtainOverlayRoot();
  const messageNode = root.querySelector('.tangtou-overlay-message');
  const barNode = root.querySelector('.tangtou-overlay-bar');
  const actionsNode = root.querySelector('.tangtou-overlay-actions');

  const clampedPercent = Math.max(0, Math.min(100, Math.round(options.percent)));
  if (messageNode) {
    messageNode.textContent = options.message || '处理中…';
  }
  if (barNode instanceof HTMLElement) {
    barNode.style.width = `${clampedPercent}%`;
  }

  if (actionsNode instanceof HTMLElement) {
    actionsNode.replaceChildren();
    if (options.showCancel !== false) {
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = '停止';
      cancelButton.addEventListener('click', () => {
        requestFillStop();
        updatePageOverlay({
          percent: clampedPercent,
          message: '正在停止…',
          showCancel: false,
        });
      });
      actionsNode.appendChild(cancelButton);
    }
    const hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.className = 'tangtou-overlay-hide';
    hideButton.textContent = '隐藏';
    hideButton.addEventListener('click', () => {
      hidePageOverlay();
    });
    actionsNode.appendChild(hideButton);
  }

  if (options.highlightFieldIds?.length) {
    highlightFieldIds(options.highlightFieldIds);
  }
}

/**
 * 关闭浮层并清掉描边。
 */
export function hidePageOverlay(): void {
  clearFocusHighlights();
  const root = document.getElementById(TANGTOU_PAGE_OVERLAY_ID);
  root?.remove();
}
