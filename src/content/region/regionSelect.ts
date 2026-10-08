/**
 * 选区填入的框选会话（P1 框选 + P2 触发识别）。
 * 给侧栏「选区填入」用：在当前页拖出矩形，右键或 Esc 取消。
 * P1 只改遮罩和矩形；P2 在框出合格矩形后由内容脚本识别框内空白字段（不写入）。
 */

/** 遮罩根节点。扫描器靠 data-tangtou-ui 跳过本扩展自己的界面。 */
const REGION_ROOT_ID = 'tangtou-region-select';

/** 宽或高小于这个像素数，不算一块区域，留在框选里让用户再拖。 */
const REGION_MIN_EDGE_PX = 8;

/** 进入框选、以及框出合格矩形之后，遮罩上的说明。 */
const REGION_HINT_STANDARD =
  '右键取消框选。框里最好带上这一段的标题，一次只框一段。';

/** 矩形过小时的说明。合格矩形出现后换回标准说明。 */
const REGION_HINT_TOO_SMALL = '请再框一次。';

/** 矩形在视口里的位置和大小。P2 识别与相交判断共用。 */
export interface RegionRectangleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 框选生命周期钩子：由内容脚本挂上，用于 P2 识别与清空侧栏清单。 */
export interface RegionSelectLifecycleHandlers {
  /** 进入 boxed 且矩形合格时调用 */
  onBoxed?: () => void;
  /** 遮罩卸掉时调用 */
  onEnd?: () => void;
}

let regionLifecycleHandlers: RegionSelectLifecycleHandlers = {};

/**
 * 注册框选结束/框好后的回调。重复调用会覆盖上一组。
 */
export function setRegionSelectLifecycleHandlers(
  handlers: RegionSelectLifecycleHandlers,
): void {
  regionLifecycleHandlers = handlers;
}

/**
 * 一次框选会话。
 * 阶段：arming 等待拖动，dragging 正在拖，boxed 已经留下合格矩形。
 * 根节点卸掉后会话结束，页面上不再拦截点击。
 */
interface RegionSelectSession {
  root: HTMLDivElement;
  shade: HTMLDivElement;
  rectangle: HTMLDivElement;
  hint: HTMLParagraphElement;
  abort: AbortController;
  phase: 'arming' | 'dragging' | 'boxed';
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  /** 这一下拖动已经在 pointerup 里收过尾，避免丢捕获时再取消一次合格矩形。 */
  dragSettled: boolean;
}

/** 当前页最多一层。没有会话时为 null。 */
let regionSession: RegionSelectSession | null = null;

/**
 * 注入框选样式。重复进入只插一次。
 * 遮罩盖住视口，避免拖动时点到页头或「预览并提交」。
 */
function ensureRegionSelectStyles(): void {
  if (document.getElementById('tangtou-region-select-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'tangtou-region-select-style';
  style.textContent = `
    #${REGION_ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    }
    #${REGION_ROOT_ID} .tangtou-region-shade {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      cursor: crosshair;
      pointer-events: auto;
      touch-action: none;
    }
    #${REGION_ROOT_ID} .tangtou-region-box {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #2563eb;
      background: rgba(37, 99, 235, 0.16);
      pointer-events: none;
    }
    #${REGION_ROOT_ID} .tangtou-region-hint {
      position: absolute;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      max-width: min(520px, calc(100vw - 32px));
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: #fff;
      color: #111827;
      font: 13px/1.45 system-ui, "Segoe UI", sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      pointer-events: none;
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * 把拖动的起点和当前点收成不倒着长的矩形。
 */
function rectangleFromPointer(
  originX: number,
  originY: number,
  currentX: number,
  currentY: number,
): RegionRectangleBox {
  return {
    left: Math.min(originX, currentX),
    top: Math.min(originY, currentY),
    width: Math.abs(currentX - originX),
    height: Math.abs(currentY - originY),
  };
}

/**
 * 移动唯一的那块矩形。不创建第二块。
 */
function placeRectangle(
  rectangle: HTMLDivElement,
  box: RegionRectangleBox,
): void {
  rectangle.hidden = false;
  rectangle.style.left = `${box.left}px`;
  rectangle.style.top = `${box.top}px`;
  rectangle.style.width = `${box.width}px`;
  rectangle.style.height = `${box.height}px`;
}

/**
 * 指针是否还在当前视口里。移出浏览器后松开时，用这个判断要不要把遮罩卸掉。
 */
function pointerInsideViewport(clientX: number, clientY: number): boolean {
  return (
    clientX >= 0 &&
    clientY >= 0 &&
    clientX <= window.innerWidth &&
    clientY <= window.innerHeight
  );
}

/**
 * 结束框选：卸掉遮罩和监听。
 * 右键、Esc、切走标签、刷新、拖出视口时调用。页面控件的值不动。
 */
function endRegionSelect(): void {
  const session = regionSession;
  if (!session) {
    return;
  }
  regionSession = null;
  session.abort.abort();
  session.root.remove();
  regionLifecycleHandlers.onEnd?.();
}

/**
 * 松开鼠标：过小则留下遮罩并提示再框；合格则只保留这一块矩形。
 * 指针已经在视口外时整段会话结束，避免遮罩卡住页面。
 */
function finishDrag(clientX: number, clientY: number): void {
  const session = regionSession;
  if (!session || session.phase !== 'dragging') {
    return;
  }
  session.dragSettled = true;
  if (!pointerInsideViewport(clientX, clientY)) {
    endRegionSelect();
    return;
  }
  const box = rectangleFromPointer(
    session.originX,
    session.originY,
    clientX,
    clientY,
  );
  if (box.width < REGION_MIN_EDGE_PX || box.height < REGION_MIN_EDGE_PX) {
    session.phase = 'arming';
    session.root.dataset.tangtouRegionPhase = 'arming';
    session.rectangle.hidden = true;
    session.hint.textContent = REGION_HINT_TOO_SMALL;
    session.hint.dataset.tangtouRegionHint = 'too-small';
    return;
  }
  session.phase = 'boxed';
  session.root.dataset.tangtouRegionPhase = 'boxed';
  placeRectangle(session.rectangle, box);
  session.hint.textContent = REGION_HINT_STANDARD;
  session.hint.dataset.tangtouRegionHint = 'standard';
  regionLifecycleHandlers.onBoxed?.();
}

/**
 * 开始一次框选。已经有遮罩时不叠第二层，也不清掉已经画出的矩形。
 * 调用方：内容脚本收到侧栏的 START_REGION_SELECT。
 * 返回 alreadyActive，侧栏用来区分第一次进入和重复点按钮。
 */
export function startRegionSelect(): { alreadyActive: boolean } {
  if (regionSession) {
    return { alreadyActive: true };
  }

  ensureRegionSelectStyles();
  const abort = new AbortController();
  const { signal } = abort;

  const root = document.createElement('div');
  root.id = REGION_ROOT_ID;
  root.dataset.tangtouUi = 'region-select';
  root.dataset.tangtouRegionPhase = 'arming';

  const shade = document.createElement('div');
  shade.className = 'tangtou-region-shade';

  const rectangle = document.createElement('div');
  rectangle.className = 'tangtou-region-box';
  rectangle.hidden = true;

  const hint = document.createElement('p');
  hint.className = 'tangtou-region-hint';
  hint.textContent = REGION_HINT_STANDARD;
  hint.dataset.tangtouRegionHint = 'standard';

  root.append(shade, rectangle, hint);
  document.documentElement.appendChild(root);

  const session: RegionSelectSession = {
    root,
    shade,
    rectangle,
    hint,
    abort,
    phase: 'arming',
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    dragSettled: false,
  };
  regionSession = session;

  shade.addEventListener(
    'pointerdown',
    (event: PointerEvent) => {
      if (event.button !== 0 || !regionSession) {
        return;
      }
      event.preventDefault();
      regionSession.phase = 'dragging';
      regionSession.root.dataset.tangtouRegionPhase = 'dragging';
      regionSession.dragSettled = false;
      regionSession.originX = event.clientX;
      regionSession.originY = event.clientY;
      regionSession.lastX = event.clientX;
      regionSession.lastY = event.clientY;
      placeRectangle(regionSession.rectangle, {
        left: event.clientX,
        top: event.clientY,
        width: 0,
        height: 0,
      });
      shade.setPointerCapture(event.pointerId);
    },
    { signal },
  );

  shade.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      if (!regionSession || regionSession.phase !== 'dragging') {
        return;
      }
      regionSession.lastX = event.clientX;
      regionSession.lastY = event.clientY;
      placeRectangle(
        regionSession.rectangle,
        rectangleFromPointer(
          regionSession.originX,
          regionSession.originY,
          event.clientX,
          event.clientY,
        ),
      );
    },
    { signal },
  );

  shade.addEventListener(
    'pointerup',
    (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      finishDrag(event.clientX, event.clientY);
    },
    { signal },
  );

  shade.addEventListener(
    'pointercancel',
    () => {
      endRegionSelect();
    },
    { signal },
  );

  shade.addEventListener(
    'lostpointercapture',
    () => {
      if (regionSession?.phase === 'dragging' && !regionSession.dragSettled) {
        finishDrag(regionSession.lastX, regionSession.lastY);
      }
    },
    { signal },
  );

  shade.addEventListener(
    'contextmenu',
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      endRegionSelect();
    },
    { signal },
  );

  document.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      endRegionSelect();
    },
    { capture: true, signal },
  );

  document.documentElement.addEventListener(
    'mouseleave',
    (event: MouseEvent) => {
      if (regionSession?.phase === 'dragging' && event.relatedTarget === null) {
        endRegionSelect();
      }
    },
    { signal },
  );

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        endRegionSelect();
      }
    },
    { signal },
  );

  // 不在 window blur 时结束：用户要看侧栏「框内空白字段」时页面会失焦，遮罩应保留。
  // 切到别的浏览器窗口由 Background 的 onFocusChanged / tabs.onActivated 发 CANCEL。

  // 标签被浏览器冻到后台时卸掉遮罩，避免切回来还盖着页面。
  document.addEventListener('freeze', () => {
    endRegionSelect();
  }, { signal });

  window.addEventListener('pagehide', () => {
    endRegionSelect();
  }, { signal });

  return { alreadyActive: false };
}

/**
 * 侧栏在扫描、确认写入、智能探活之前来问。
 * 有遮罩则为 true。不创建遮罩，也不结束它。
 */
export function queryRegionSelect(): { active: boolean } {
  return { active: regionSession !== null };
}

/**
 * Background 在窗口失焦时调用，卸掉遮罩但不改表单值。
 */
export function cancelRegionSelectFromHost(): void {
  endRegionSelect();
}

/**
 * 当前会话若已框出合格矩形，返回其在视口中的位置；否则 null。
 */
export function getRegionSelectBox(): RegionRectangleBox | null {
  if (!regionSession || regionSession.phase !== 'boxed') {
    return null;
  }
  const clientRect = regionSession.rectangle.getBoundingClientRect();
  if (clientRect.width < REGION_MIN_EDGE_PX || clientRect.height < REGION_MIN_EDGE_PX) {
    return null;
  }
  return {
    left: clientRect.left,
    top: clientRect.top,
    width: clientRect.width,
    height: clientRect.height,
  };
}

/** 当前框选阶段；无会话时为 null。 */
export function getRegionSelectPhase(): RegionSelectSession['phase'] | null {
  return regionSession?.phase ?? null;
}
