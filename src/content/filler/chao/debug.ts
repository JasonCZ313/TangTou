// @ts-nocheck
/**
 * 统一调试日志（F12 Console）。
 *
 * 设计目标：每一次操作、每一个判定、每一个结果都可见，出问题时不需要靠猜。
 * 开关优先级：window.__tangtouDebug > localStorage['tangtou:debug'] > 默认开启。
 * 关闭时所有方法退化为空函数，不产生字符串拼接与 console 调用开销。
 */

const PREFIX = '[躺投][chao]';

/** 读取调试开关 */
function resolveEnabled() {
  try {
    if (typeof window !== 'undefined' && typeof window.__tangtouDebug === 'boolean') {
      return window.__tangtouDebug;
    }
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('tangtou:debug');
      if (stored === '0' || stored === 'false') return false;
      if (stored === '1' || stored === 'true') return true;
    }
  } catch {
    /* 隐私模式下 localStorage 可能抛错，忽略 */
  }
  return true;
}

let stepCounter = 0;
let stageStart = 0;

/** 把任意值压成一行适合控制台阅读的短文本 */
function brief(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof HTMLElement) {
    const tag = value.tagName.toLowerCase();
    const id = value.id ? `#${value.id}` : '';
    const cls = value.className && typeof value.className === 'string'
      ? `.${value.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`
      : '';
    return `<${tag}${id}${cls}>`;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  } catch {
    return String(value);
  }
}

export const chaoDebug = {
  get enabled() {
    return resolveEnabled();
  },

  /** 阶段开始：控制台折叠分组 */
  stage(title) {
    if (!this.enabled) return;
    stageStart = Date.now();
    console.groupCollapsed(`${PREFIX} ▶ ${title}`);
  },

  /** 阶段结束：带耗时 */
  stageEnd(summary) {
    if (!this.enabled) return;
    const cost = Date.now() - stageStart;
    console.log(`${PREFIX} ■ 阶段结束（${cost}ms）${summary ? `：${summary}` : ''}`);
    console.groupEnd();
  },

  /** 任一操作开始 */
  op(action, detail) {
    if (!this.enabled) return;
    stepCounter += 1;
    console.log(`${PREFIX} [#${String(stepCounter).padStart(4, '0')}][操作] ${action}`, detail ?? '');
  },

  ok(action, detail) {
    if (!this.enabled) return;
    stepCounter += 1;
    console.log(`${PREFIX} [#${String(stepCounter).padStart(4, '0')}][成功] ✅ ${action}`, detail ?? '');
  },

  fail(action, detail) {
    if (!this.enabled) return;
    stepCounter += 1;
    console.warn(`${PREFIX} [#${String(stepCounter).padStart(4, '0')}][失败] ❌ ${action}`, detail ?? '');
  },

  skip(action, reason, detail) {
    if (!this.enabled) return;
    console.log(`${PREFIX} [  --  ][跳过] ⏭ ${action}（${reason}）`, detail ?? '');
  },

  /** 一次写入的完整结果：标签 / 目标值 / 实际值 / 耗时 */
  value(blob, intended, actual, costMs, extra) {
    if (!this.enabled) return;
    stepCounter += 1;
    const same = String(actual || '').includes(String(intended || '')) || !intended;
    const mark = same ? '✅' : '⚠️';
    console.log(
      `${PREFIX} [#${String(stepCounter).padStart(4, '0')}][写入] ${mark} 「${brief(blob)}」`
      + ` 目标=${brief(intended)} 实际=${brief(actual)} ${costMs}ms`,
      extra ?? '',
    );
  },

  /** 字段清单表格 */
  fieldTable(title, rows) {
    if (!this.enabled) return;
    console.groupCollapsed(`${PREFIX} 📋 ${title}（${rows.length} 条）`);
    if (console.table) console.table(rows);
    else console.log(rows);
    console.groupEnd();
  },

  /** 任意分组内的表格 */
  table(title, rows) {
    if (!this.enabled) return;
    console.groupCollapsed(`${PREFIX} 📊 ${title}`);
    if (console.table) console.table(rows);
    else console.log(rows);
    console.groupEnd();
  },

  /** 普通说明行 */
  info(message, detail) {
    if (!this.enabled) return;
    console.log(`${PREFIX} ℹ️ ${message}`, detail ?? '');
  },

  /** 错误（不吞异常上下文） */
  error(message, error) {
    if (!this.enabled) return;
    console.error(`${PREFIX} ⛔ ${message}`, error ?? '');
  },

  /** 计时包装：把耗时附在结果里 */
  async time(label, fn) {
    const started = Date.now();
    try {
      const result = await fn();
      if (this.enabled) console.log(`${PREFIX} ⏱ ${label} 用时 ${Date.now() - started}ms`);
      return result;
    } catch (error) {
      if (this.enabled) console.error(`${PREFIX} ⏱ ${label} 抛错（${Date.now() - started}ms）`, error);
      throw error;
    }
  },
};

/** 允许外部（侧栏开关）调整 */
export function setChaoDebugEnabled(enabled) {
  try {
    window.__tangtouDebug = Boolean(enabled);
  } catch {
    /* 忽略 */
  }
}
