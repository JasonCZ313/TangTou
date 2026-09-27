/**
 * 页面写入入口：确认填写后走超你 offer 的「边扫边写」规则引擎。
 * 不再使用旧的先扫再建 FillPlan / walkPageAgainstProfile 乱填路径。
 * 附件上传仍用躺投档案里的文件载荷，在规则填完后单独落 file 控件。
 */
import type { FillMiss, FillPlan, SectionAddRequest } from '../../shared/types/fill';
import type { ProfileData } from '../../shared/types/profile';
import type { FileUploadPayload } from '../../shared/types/messages';
import { runChaoRuleAutofill, profileToChaoEditable } from './chaoAutofill';

/** 撤销快照：写入前控件原值，方便 undoLastFill 还原 */
let lastUndoSnapshots: Array<{ element: Element; previousValue: string; isFile: boolean }> =
  [];

/**
 * 读控件当前值，供写入前记快照。
 */
function readElementValue(element: Element): string {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'true' : 'false';
    }
    if (element.type === 'file') {
      return element.files?.[0]?.name ?? '';
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return element.textContent ?? '';
  }
  return '';
}

/**
 * 把值写回普通控件（撤销用）；file 控件只能清空。
 */
function restoreElementValue(element: Element, previousValue: string): boolean {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    element.value = '';
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.checked = previousValue === 'true';
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    element.value = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    element.textContent = previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * 在规则填写前，给页面上可见的可编辑控件打撤销快照。
 */
function captureUndoSnapshots(): void {
  lastUndoSnapshots = [];
  const nodes = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return;
    }
    const isFile =
      node instanceof HTMLInputElement && node.type === 'file';
    lastUndoSnapshots.push({
      element: node,
      previousValue: readElementValue(node),
      isFile,
    });
  });
}

/**
 * 把 Base64 文件写入原生 file 控件。
 */
function assignFilePayload(
  inputElement: HTMLInputElement,
  payload: FileUploadPayload,
): boolean {
  try {
    const binaryText = atob(payload.dataBase64);
    const bytes = new Uint8Array(binaryText.length);
    for (let index = 0; index < binaryText.length; index += 1) {
      bytes[index] = binaryText.charCodeAt(index);
    }
    const file = new File([bytes], payload.fileName, {
      type: payload.mimeType || 'application/octet-stream',
    });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputElement.files = dataTransfer.files;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return inputElement.files.length > 0;
  } catch {
    return false;
  }
}

/**
 * 收集 file 控件附近文案，用来判断是简历还是头像。
 */
function fileInputHint(inputElement: HTMLInputElement): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && text.length <= 80) {
      parts.push(text);
    }
  };
  push(inputElement.getAttribute('aria-label'));
  push(inputElement.getAttribute('name'));
  push(inputElement.id);
  push(inputElement.closest('label')?.textContent);
  if (inputElement.id) {
    try {
      push(document.querySelector(`label[for="${CSS.escape(inputElement.id)}"]`)?.textContent);
    } catch {
      /* 忽略非法 id */
    }
  }
  let host: HTMLElement | null = inputElement.parentElement;
  for (let depth = 0; host && depth < 3; depth += 1, host = host.parentElement) {
    push(host.querySelector(':scope > label')?.textContent);
  }
  return parts.join(' ').toLowerCase();
}

/**
 * 规则填完后，按文案把档案附件落到页面 file 控件（躺投自有能力，案例无此步）。
 */
function applyFilePayloads(filePayloads: FileUploadPayload[]): {
  filled: number;
  misses: FillMiss[];
} {
  if (!filePayloads.length) {
    return { filled: 0, misses: [] };
  }
  let filled = 0;
  const misses: FillMiss[] = [];
  const fileInputs = [
    ...document.querySelectorAll('input[type="file"]'),
  ].filter((node): node is HTMLInputElement => {
    if (!(node instanceof HTMLInputElement)) {
      return false;
    }
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  for (const payload of filePayloads) {
    const hintPreferred =
      /头像|照片|证件照|avatar|photo|portrait|image/.test(
        `${payload.fileName} ${payload.mimeType}`.toLowerCase(),
      );
    const matched =
      fileInputs.find((inputElement) => {
        const hint = fileInputHint(inputElement);
        if (hintPreferred) {
          return /头像|照片|证件照|avatar|photo|portrait|image/.test(hint);
        }
        return /简历|附件|上传|文件|resume|cv|pdf|portfolio|作品/.test(hint) || hint.length > 0;
      }) || fileInputs[0];

    if (!matched) {
      misses.push({
        label: payload.fileName || '附件',
        reason: '页面上没有找到可写入的文件上传框',
      });
      continue;
    }
    if (assignFilePayload(matched, payload)) {
      filled += 1;
      matched.classList.add('raf-autofill-filled');
    } else {
      misses.push({
        label: payload.fileName || '附件',
        reason: '文件写入失败',
      });
    }
  }
  return { filled, misses };
}

/**
 * 确认写入：档案 → 超你 offer 结构 → 规则边扫边写；可选再落附件。
 * _plan / sectionAdds 保留签名兼容消息协议，主路不再使用。
 */
export async function applyFillPlan(
  _plan: FillPlan,
  filePayloads: FileUploadPayload[] = [],
  _profileId?: string,
  _sectionAdds: SectionAddRequest[] = [],
  profileData?: ProfileData,
): Promise<{
  filled: number;
  skipped: number;
  misses: FillMiss[];
}> {
  if (!profileData) {
    return {
      filled: 0,
      skipped: 0,
      misses: [{ label: '档案', reason: '没有读到档案，无法填写' }],
    };
  }

  captureUndoSnapshots();
  const editable = profileToChaoEditable(profileData);
  const ruleResult = await runChaoRuleAutofill(editable);
  const fileResult = applyFilePayloads(filePayloads);

  return {
    filled: ruleResult.filled + fileResult.filled,
    skipped: ruleResult.skipped,
    misses: [...ruleResult.misses, ...fileResult.misses],
  };
}

/**
 * 撤销上一轮：尽量把控件恢复到写入前快照；file 只能清空。
 */
export function undoLastFill(): { restored: number } {
  let restored = 0;
  for (const snapshot of lastUndoSnapshots) {
    if (!document.contains(snapshot.element)) {
      continue;
    }
    if (restoreElementValue(snapshot.element, snapshot.previousValue)) {
      snapshot.element.classList.remove('raf-autofill-filled', 'raf-autofill-missed');
      restored += 1;
    }
  }
  lastUndoSnapshots = [];
  return { restored };
}
