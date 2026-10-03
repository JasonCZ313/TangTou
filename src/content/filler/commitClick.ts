/**
 * 收尾点击：写入之后才做。
 * 只点弹窗上的「确定」和分段「保存」。不点提交、投递、下一步。
 */
import { shouldFillStop } from '../fillAbort';

/**
 * 节点自身短文案。
 */
function ownActionText(element: HTMLElement): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    }
  }
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned) {
    return cleaned;
  }
  return (element.textContent || '').replace(/\s+/g, '').slice(0, 12);
}

/**
 * 短等待，给弹窗关上。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 点一个可见按钮：mousedown + click，贴近真实点击。
 */
function clickAction(element: HTMLElement): void {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  element.click();
}

/**
 * 找到包住「确定」的那一层，而不是只有省市列表的内层。
 */
function findConfirmDialogs(): HTMLElement[] {
  const dialogs: HTMLElement[] = [];
  const buttons = [...document.querySelectorAll('button, [role="button"]')];
  for (const button of buttons) {
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    if (ownActionText(button) !== '确定') {
      continue;
    }
    const box = button.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) {
      continue;
    }
    let node: HTMLElement | null = button.parentElement;
    let dialog: HTMLElement | null = null;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth += 1) {
      const text = (node.textContent || '').replace(/\s+/g, '');
      const nodeBox = node.getBoundingClientRect();
      if (
        /取消/.test(text)
        && /已选地区|全部省市/.test(text)
        && nodeBox.height > 80
        && nodeBox.height < window.innerHeight * 0.96
      ) {
        dialog = node;
      }
      node = node.parentElement;
    }
    if (dialog && !dialogs.includes(dialog)) {
      dialogs.push(dialog);
    }
  }
  return dialogs;
}

/**
 * 已经选过地区、弹窗还开着时，点外层「确定」。
 */
async function confirmOpenDialogs(): Promise<number> {
  let clicked = 0;
  for (let round = 0; round < 4; round += 1) {
    if (shouldFillStop()) {
      return clicked;
    }
    const dialogs = findConfirmDialogs();
    if (dialogs.length === 0) {
      return clicked;
    }
    let clickedThisRound = false;
    for (const dialog of dialogs) {
      const confirmButton = [...dialog.querySelectorAll('button, [role="button"]')].find((node) => {
        return node instanceof HTMLElement && ownActionText(node) === '确定';
      });
      if (!(confirmButton instanceof HTMLElement)) {
        continue;
      }
      clickAction(confirmButton);
      clicked += 1;
      clickedThisRound = true;
      await wait(250);
    }
    if (!clickedThisRound) {
      return clicked;
    }
  }
  return clicked;
}

/**
 * 分段保存。排除提交、投递、下一步，以及「保存并提交」。
 */
async function clickSectionSaveButtons(): Promise<number> {
  const saveButtons = [...document.querySelectorAll('button, a, [role="button"]')].filter((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const text = ownActionText(node);
    if (text !== '保存' && text !== '保存本段' && text !== '保存本条') {
      return false;
    }
    const box = node.getBoundingClientRect();
    return box.width > 8 && box.height > 8;
  });
  let clicked = 0;
  for (const button of saveButtons) {
    if (shouldFillStop()) {
      break;
    }
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    clickAction(button);
    clicked += 1;
    await wait(200);
  }
  return clicked;
}

/**
 * 写入结束后的收尾：先确定，再保存。
 */
export async function runCommitClicks(): Promise<number> {
  const confirmed = await confirmOpenDialogs();
  const saved = await clickSectionSaveButtons();
  return confirmed + saved;
}
