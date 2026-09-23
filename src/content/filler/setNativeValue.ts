/**
 * 以兼容 React/Vue 等框架的方式设置输入类控件的值，
 * 并派发 input/change 事件，避免只改 attribute 不更新受控状态。
 * 通过原型上的 value setter 写入，确保框架的 onChange 能感知到变更。
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  nextValue: string,
): void {
  const prototype = Object.getPrototypeOf(element);
  const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (valueDescriptor?.set) {
    valueDescriptor.set.call(element, nextValue);
  } else {
    element.value = nextValue;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
