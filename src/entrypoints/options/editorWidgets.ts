import type { CatalogOption } from '../../shared/catalogs/enums';
import { createSearchableSelect } from './searchableSelect';

/**
 * 创建带标签的文本输入，变更时回调。
 */
export function createBoundInput(
  labelText: string,
  initialValue: string,
  onChange: (value: string) => void,
  inputType: string = 'text',
  required: boolean = false,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';

  const span = document.createElement('span');
  span.className = 'field-label';
  span.append(document.createTextNode(labelText));
  // 必填星号用珊瑚强调色，与静态表单一致
  if (required) {
    span.append(document.createTextNode(' '));
    const reqMark = document.createElement('span');
    reqMark.className = 'req';
    reqMark.setAttribute('aria-label', '必填');
    reqMark.textContent = '*';
    span.appendChild(reqMark);
  }

  const input = document.createElement('input');
  input.type = inputType;
  input.value = initialValue;
  if (required) {
    input.required = true;
  }
  input.addEventListener('input', () => {
    onChange(input.value);
  });

  label.append(span, input);
  return label;
}

/**
 * 创建多行文本。
 */
export function createBoundTextarea(
  labelText: string,
  initialValue: string,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field field-span-2';

  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = labelText;

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.value = initialValue;
  textarea.addEventListener('input', () => {
    onChange(textarea.value);
  });

  label.append(span, textarea);
  return label;
}

/**
 * 创建可搜索下拉（统一动态列表与静态表单体验）。
 */
export function createBoundSelect(
  labelText: string,
  initialValue: string,
  options: CatalogOption[],
  onChange: (value: string) => void,
  required: boolean = false,
): HTMLLabelElement {
  return createSearchableSelect({
    labelText,
    initialValue,
    options,
    onChange,
    required,
  });
}

/**
 * 创建复选框行。
 */
export function createBoundCheckbox(
  labelText: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'checkbox-row field';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
  });

  const span = document.createElement('span');
  span.textContent = labelText;

  label.append(input, span);
  return label;
}

/**
 * 列表项卡片容器（标题 + 删除）。
 */
export function createListItemCard(
  titleText: string,
  onRemove: () => void,
): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'item-card';

  const header = document.createElement('div');
  header.className = 'item-card-header';

  const title = document.createElement('p');
  title.className = 'item-card-title';
  title.textContent = titleText;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn-danger btn-sm';
  removeButton.textContent = '删除本条';
  removeButton.addEventListener('click', onRemove);

  header.append(title, removeButton);
  card.appendChild(header);
  return card;
}

/**
 * 可锁定条目卡片：编辑态含「保存本条/删除」；只读态含「编辑/删除」。
 */
export function createLockableListItemCard(options: {
  titleText: string;
  locked: boolean;
  onSaveItem: () => void;
  onEditItem: () => void;
  onRemove: () => void;
}): HTMLDivElement {
  const card = document.createElement('div');
  card.className = options.locked
    ? 'item-card item-card-locked'
    : 'item-card item-card-editing';

  const header = document.createElement('div');
  header.className = 'item-card-header';

  const title = document.createElement('p');
  title.className = 'item-card-title';
  title.textContent = options.locked
    ? `${options.titleText}（已保存）`
    : options.titleText;

  const actions = document.createElement('div');
  actions.className = 'item-card-actions';

  if (options.locked) {
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-secondary btn-sm';
    editButton.textContent = '编辑';
    editButton.addEventListener('click', options.onEditItem);
    actions.appendChild(editButton);
  } else {
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-primary btn-sm';
    saveButton.textContent = '保存本条';
    saveButton.addEventListener('click', options.onSaveItem);
    actions.appendChild(saveButton);
  }

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn-danger btn-sm';
  removeButton.textContent = '删除本条';
  removeButton.addEventListener('click', options.onRemove);
  actions.appendChild(removeButton);

  header.append(title, actions);
  card.appendChild(header);
  return card;
}

/**
 * 向单个 select 写入枚举选项（含「请选择」空项），并尽量保留当前值。
 */
export function populateSelectOptions(
  selectElement: HTMLSelectElement,
  options: CatalogOption[],
  selectedValue: string = '',
): void {
  const previousValue = selectedValue || selectElement.value;
  selectElement.replaceChildren();
  const blankOption = document.createElement('option');
  blankOption.value = '';
  blankOption.textContent = '请选择';
  selectElement.appendChild(blankOption);
  for (const optionItem of options) {
    const optionElement = document.createElement('option');
    optionElement.value = optionItem.code;
    optionElement.textContent = optionItem.labelZh;
    selectElement.appendChild(optionElement);
  }
  const matched = options.find(
    (item) =>
      item.code === previousValue || item.labelZh === previousValue,
  );
  selectElement.value = matched?.code ?? '';
}

/**
 * 为静态表单里带 data-catalog 的 select 填充枚举选项。
 */
export function fillStaticSelectsByCatalog(
  rootElement: ParentNode,
  catalogMap: Record<string, CatalogOption[]>,
): void {
  const selectElements =
    rootElement.querySelectorAll<HTMLSelectElement>('select[data-catalog]');
  for (const selectElement of selectElements) {
    const catalogKey = selectElement.dataset.catalog ?? '';
    const options = catalogMap[catalogKey];
    if (!options) {
      continue;
    }
    populateSelectOptions(selectElement, options, selectElement.value);
  }
}
