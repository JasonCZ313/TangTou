/**
 * 兼容出口。
 * 引擎已按职责拆分为 chao/rules（规则）、chao/dom（控件策略）、chao/autofill（编排），
 * 这里只做转发，保持外部（fillFields.ts）的引用路径不变。
 */
export { runChaoRuleAutofill } from './chao/autofill';
export { profileToChaoEditable } from './profileToChao';
export type { ChaoEditable, ChaoRowItem, ChaoRows } from './profileToChao';
