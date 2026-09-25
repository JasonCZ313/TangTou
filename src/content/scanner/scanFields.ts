import type { FieldDescriptor } from '../../shared/types/fill';

/** 扫描时跳过的 input type，避免误填密码或触发按钮类控件 */
const SKIPPED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'image',
  'password',
]);

/**
 * 会话内 fieldId → DOM 元素映射。
 * 扫描时写入，回填时按 fieldId 精确定位，不依赖脆弱的唯一 selector。
 */
const fieldElementById = new Map<string, Element>();

/**
 * 判断元素在页面上是否可见；无布局矩形则视为不可见并跳过。
 */
function isElementVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * 从 label 元素提取纯文本：去掉内部控件节点，避免 input 当前值污染标签。
 */
function extractCleanLabelText(labelElement: Element): string {
  const clonedLabel = labelElement.cloneNode(true) as HTMLElement;
  clonedLabel
    .querySelectorAll('input, select, textarea, button')
    .forEach((nestedControl) => {
      nestedControl.remove();
    });
  return (clonedLabel.textContent ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * 按优先级解析字段的人类可读标签：
 * htmlFor 关联 label → 清洁后的包裹 label → aria-label → placeholder → name。
 */
function resolveFieldLabel(element: Element): string {
  if (element instanceof HTMLElement && element.id) {
    const rootNode = element.getRootNode();
    const labelForElement =
      rootNode instanceof Document || rootNode instanceof ShadowRoot
        ? rootNode.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        : null;
    if (labelForElement) {
      const labelText = extractCleanLabelText(labelForElement);
      if (labelText) {
        return labelText;
      }
    }
  }

  const wrappingLabel = element.closest('label');
  if (wrappingLabel) {
    const labelText = extractCleanLabelText(wrappingLabel);
    if (labelText) {
      return labelText;
    }
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const placeholderText = element.placeholder?.trim();
    if (placeholderText) {
      return placeholderText;
    }
  }

  const nameAttribute =
    element.getAttribute('name')?.trim() ||
    (element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.name?.trim()
      : undefined);
  if (nameAttribute) {
    return nameAttribute;
  }

  return element.tagName.toLowerCase();
}

/**
 * 生成辅助定位提示（非唯一依赖）：优先 id、name，否则退回标签名与 type。
 */
function buildSelectorHint(element: Element): string {
  if (element instanceof HTMLElement && element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const nameAttribute = element.getAttribute('name');
  if (nameAttribute) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(nameAttribute)}"]`;
  }

  const inputType =
    element instanceof HTMLInputElement ? element.type : undefined;
  if (inputType) {
    return `${element.tagName.toLowerCase()}[type="${inputType}"]`;
  }

  return element.tagName.toLowerCase();
}

/**
 * 读取控件当前值；select 取选中项，checkbox/radio 取 checked 状态，其余取 value/textContent。
 */
function readCurrentValue(element: Element): string | undefined {
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? element.value || 'true' : '';
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return element.textContent ?? '';
  }
  return undefined;
}

/**
 * 收集 select 下各 option 的展示文案，供模型做选项匹配。
 */
function collectSelectOptions(selectElement: HTMLSelectElement): string[] {
  return Array.from(selectElement.options)
    .map((optionElement) => optionElement.textContent?.trim() || optionElement.value)
    .filter((optionText) => optionText.length > 0);
}

/**
 * 将单个 DOM 元素转为 FieldDescriptor，并登记到会话内 fieldId 映射表。
 */
function describeField(element: Element): FieldDescriptor {
  const fieldId = crypto.randomUUID();
  fieldElementById.set(fieldId, element);

  const tag = element.tagName.toLowerCase();
  let type = tag;
  if (element instanceof HTMLInputElement) {
    type = element.type || 'text';
  } else if (element instanceof HTMLElement && element.isContentEditable) {
    type = 'contenteditable';
  }

  const nameAttribute =
    element.getAttribute('name') ||
    (element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.name || undefined
      : undefined);

  const placeholder =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.placeholder || undefined
      : undefined;

  const required =
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.required
      : undefined;

  const descriptor: FieldDescriptor = {
    fieldId,
    tag,
    type,
    label: resolveFieldLabel(element),
    selectorHint: buildSelectorHint(element),
  };

  if (nameAttribute) {
    descriptor.name = nameAttribute;
  }
  if (placeholder) {
    descriptor.placeholder = placeholder;
  }
  if (element instanceof HTMLSelectElement) {
    descriptor.options = collectSelectOptions(element);
  }
  const currentValue = readCurrentValue(element);
  if (currentValue !== undefined) {
    descriptor.currentValue = currentValue;
  }
  if (required !== undefined) {
    descriptor.required = required;
  }

  return descriptor;
}

/**
 * 判断候选节点是否应纳入扫描结果（类型黑名单 + 可见性）。
 */
function shouldIncludeElement(element: Element): boolean {
  if (element instanceof HTMLInputElement) {
    if (SKIPPED_INPUT_TYPES.has(element.type.toLowerCase())) {
      return false;
    }
  }
  return isElementVisible(element);
}

/**
 * 按 fieldId 取回扫描时登记的 DOM 元素；元素已从文档卸载时返回 undefined。
 * 供 filler 模块在回填 / 撤销时精确定位控件。
 */
export function resolveFieldElement(fieldId: string): Element | undefined {
  const element = fieldElementById.get(fieldId);
  if (!element || !element.isConnected) {
    return undefined;
  }
  return element;
}

/** 安静这么久就认为表单加载完了 */
const SCAN_QUIET_MS = 450;
/** 后加载表单最多再等这么久 */
const SCAN_MAX_WAIT_MS = 1500;

/**
 * 等 DOM 安静一小段时间，或到达上限。用来接住稍后插入的网申表单。
 */
export function waitForFormSettle(rootDocument: Document = document): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let quietTimer = window.setTimeout(finish, SCAN_QUIET_MS);
    const maxTimer = window.setTimeout(finish, SCAN_MAX_WAIT_MS);
    const observer = new MutationObserver(() => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, SCAN_QUIET_MS);
    });

    /**
     * 结束等待并断开观察，只执行一次。
     */
    function finish(): void {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      resolve();
    }

    observer.observe(rootDocument.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

/**
 * 收集普通文档、开放 Shadow DOM 和同源 iframe 里的表单控件。
 */
function collectFormControls(root: ParentNode): Element[] {
  const controls: Element[] = [];
  const visitedRoots = new Set<ParentNode>();
  const selector = 'input, textarea, select, [contenteditable="true"]';

  /**
   * 遍历一个根节点，并继续进入其开放影子树和同源框架。
   */
  const visit = (node: ParentNode): void => {
    if (visitedRoots.has(node)) {
      return;
    }
    visitedRoots.add(node);
    controls.push(...Array.from(node.querySelectorAll(selector)));
    const elements = node.querySelectorAll('*');
    for (const element of elements) {
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            visit(element.contentDocument);
          }
        } catch {
          // 跨域框架不允许读取
        }
      }
    }
  };

  visit(root);
  return controls;
}

/**
 * 扫描 root（默认 document）下可见的表单控件，返回 FieldDescriptor 列表，
 * 并刷新本会话的 fieldId → Element 映射供后续回填使用。
 */
export function scanFields(root: ParentNode = document): FieldDescriptor[] {
  fieldElementById.clear();
  const candidates = collectFormControls(root);
  const fields: FieldDescriptor[] = [];

  for (const candidate of candidates) {
    if (!shouldIncludeElement(candidate)) {
      continue;
    }
    fields.push(describeField(candidate));
  }

  return fields;
}

/**
 * 先等后加载表单安静下来，再扫描。供内容脚本在收到扫描消息时调用。
 */
export async function scanFieldsSettled(
  rootDocument: Document = document,
): Promise<FieldDescriptor[]> {
  await waitForFormSettle(rootDocument);
  return scanFields(rootDocument);
}
