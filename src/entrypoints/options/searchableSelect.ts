import type { CatalogOption } from '../../shared/catalogs/enums';
import { labelOfCatalog } from '../../shared/catalogs/enums';

export interface SearchableSelectOptions {
  /** 字段标签文案 */
  labelText: string;
  /** 当前值（code 或中文均可） */
  initialValue: string;
  /** 枚举选项 */
  options: CatalogOption[];
  /** 选中回调，写入 code（若手输未命中则写原文） */
  onChange: (value: string) => void;
  /** 是否必填外观 */
  required?: boolean;
  /** 占位提示 */
  placeholder?: string;
}

/**
 * 创建可搜索下拉：输入过滤选项，支持键盘上下选择与 Enter 确认。
 * 用于国籍/民族/学历等长列表，避免原生 select 难以检索。
 */
export function createSearchableSelect(
  config: SearchableSelectOptions,
): HTMLLabelElement {
  const {
    labelText,
    initialValue,
    options,
    onChange,
    required = false,
    placeholder = '输入搜索或选择…',
  } = config;

  const label = document.createElement('label');
  label.className = 'field searchable-field';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'field-label';
  titleSpan.append(document.createTextNode(labelText));
  if (required) {
    titleSpan.append(document.createTextNode(' '));
    const reqMark = document.createElement('span');
    reqMark.className = 'req';
    reqMark.setAttribute('aria-label', '必填');
    reqMark.textContent = '*';
    titleSpan.appendChild(reqMark);
  }

  const wrap = document.createElement('div');
  wrap.className = 'searchable-select';
  wrap.dataset.open = 'false';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-select-input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;

  // 展示中文标签；内部用 data-code 存 code
  const matchedInitial = options.find(
    (item) =>
      item.code === initialValue || item.labelZh === initialValue,
  );
  input.value = matchedInitial
    ? matchedInitial.labelZh
    : initialValue || '';
  input.dataset.code = matchedInitial?.code ?? initialValue ?? '';

  const list = document.createElement('ul');
  list.className = 'searchable-select-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  let highlightIndex = -1;
  let filteredOptions: CatalogOption[] = [...options];

  /**
   * 渲染过滤后的选项列表。
   */
  function renderList(filterText: string): void {
    const keyword = filterText.trim().toLowerCase();
    filteredOptions = options.filter((item) => {
      if (!keyword) {
        return true;
      }
      return (
        item.labelZh.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword)
      );
    });
    list.replaceChildren();
    if (filteredOptions.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'searchable-select-empty';
      emptyItem.textContent = '无匹配选项，可直接保留输入';
      list.appendChild(emptyItem);
      highlightIndex = -1;
      return;
    }
    filteredOptions.forEach((optionItem, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'searchable-select-option';
      listItem.setAttribute('role', 'option');
      listItem.textContent = optionItem.labelZh;
      listItem.dataset.code = optionItem.code;
      if (index === highlightIndex) {
        listItem.classList.add('is-active');
      }
      listItem.addEventListener('mousedown', (event) => {
        event.preventDefault();
        selectOption(optionItem);
      });
      list.appendChild(listItem);
    });
  }

  /**
   * 选中某一枚举项并关闭列表。
   */
  function selectOption(optionItem: CatalogOption): void {
    input.value = optionItem.labelZh;
    input.dataset.code = optionItem.code;
    onChange(optionItem.code);
    closeList();
  }

  /**
   * 打开下拉并渲染。
   */
  function openList(): void {
    wrap.dataset.open = 'true';
    list.hidden = false;
    renderList(input.value);
  }

  /**
   * 关闭下拉。
   */
  function closeList(): void {
    wrap.dataset.open = 'false';
    list.hidden = true;
    highlightIndex = -1;
  }

  /**
   * 提交当前输入：优先匹配枚举，否则保留原文（支持「其他」自定义）。
   */
  function commitInputValue(): void {
    const typed = input.value.trim();
    if (!typed) {
      input.dataset.code = '';
      onChange('');
      return;
    }
    const hit = options.find(
      (item) =>
        item.labelZh === typed ||
        item.code === typed ||
        item.labelZh.toLowerCase() === typed.toLowerCase(),
    );
    if (hit) {
      input.value = hit.labelZh;
      input.dataset.code = hit.code;
      onChange(hit.code);
      return;
    }
    input.dataset.code = typed;
    onChange(typed);
  }

  input.addEventListener('focus', () => {
    openList();
  });
  input.addEventListener('input', () => {
    openList();
    renderList(input.value);
  });
  input.addEventListener('blur', () => {
    // 延迟关闭，以便 mousedown 选项先触发
    window.setTimeout(() => {
      commitInputValue();
      closeList();
    }, 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (list.hidden) {
        openList();
      }
      highlightIndex = Math.min(
        highlightIndex + 1,
        filteredOptions.length - 1,
      );
      renderList(input.value);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      renderList(input.value);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightIndex >= 0 && filteredOptions[highlightIndex]) {
        selectOption(filteredOptions[highlightIndex]);
      } else {
        commitInputValue();
        closeList();
      }
      return;
    }
    if (event.key === 'Escape') {
      closeList();
    }
  });

  wrap.append(input, list);
  label.append(titleSpan, wrap);
  return label;
}

/**
 * 读取可搜索控件当前应展示的中文标签。
 */
export function displayLabelForCatalog(
  options: CatalogOption[],
  codeOrLabel: string,
): string {
  return labelOfCatalog(options, codeOrLabel);
}

/**
 * 将页面上带 data-catalog 的原生 select 替换为可搜索下拉。
 * 用于 Options 静态表单区；替换后仍通过 data-path 写回草稿。
 */
export function upgradeStaticCatalogSelects(
  rootElement: ParentNode,
  catalogMap: Record<string, CatalogOption[]>,
  onPathChange: (pathText: string, value: string) => void,
): void {
  const selectElements = [
    ...rootElement.querySelectorAll<HTMLSelectElement>('select[data-catalog]'),
  ];
  for (const selectElement of selectElements) {
    const catalogKey = selectElement.dataset.catalog ?? '';
    const pathText = selectElement.dataset.path ?? '';
    const options = catalogMap[catalogKey];
    if (!options || !pathText) {
      continue;
    }
    const parentLabel = selectElement.closest('label.field');
    if (!parentLabel || !parentLabel.parentElement) {
      continue;
    }
    const labelText =
      parentLabel.querySelector('.field-label')?.textContent?.replace(/\s*\*\s*$/, '').trim() ||
      pathText;
    const required = selectElement.required || Boolean(
      parentLabel.querySelector('.req'),
    );
    const currentValue = selectElement.value;
    const searchable = createSearchableSelect({
      labelText,
      initialValue: currentValue,
      options,
      required,
      onChange: (value) => {
        onPathChange(pathText, value);
      },
    });
    // 保留 path，便于收集时识别（实际值已由 onChange 写入草稿）
    searchable.dataset.pathBound = pathText;
    searchable.dataset.catalogBound = catalogKey;
    parentLabel.replaceWith(searchable);
  }
}
