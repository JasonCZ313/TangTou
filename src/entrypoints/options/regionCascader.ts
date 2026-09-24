/**
 * 省→市→区三级 Drill-down 选择器。
 * 首次打开时懒加载 /data/china-pca.json 并内存缓存；支持搜索与返回上一级。
 */
import {
  createEmptyRegionSelection,
  type RegionSelection,
} from '../../shared/types/profile';

/** 区划树节点 */
export interface RegionNode {
  code: string;
  name: string;
  children?: RegionNode[];
}

/** china-pca.json 根结构 */
interface ChinaPcaPayload {
  version: number;
  updatedAt: string;
  regions: RegionNode[];
}

/** 创建 Cascader 的配置 */
export interface RegionCascaderOptions {
  /** 字段标签 */
  labelText: string;
  /** 当前展示文案（旧字符串或 RegionSelection.text） */
  initialText: string;
  /** 已选结构化结果（用于回显；可空） */
  initialRegion?: RegionSelection | null;
  /** 选中或清空后回调 */
  onChange: (selection: RegionSelection | null, displayText: string) => void;
  /** 必填外观 */
  required?: boolean;
  /** 占位提示 */
  placeholder?: string;
  /**
   * 多选追加模式：每次确认后把新区划用顿号拼到已有文案后。
   * 用于「期望城市」等可多点选择的字段。
   */
  multiAppend?: boolean;
}

/** 静态表单升级时字符串字段 → 结构化字段路径映射 */
export interface RegionFieldBinding {
  /** 字符串主字段 data-path，如 basic.currentCity */
  textPath: string;
  /** 结构化字段路径，如 basic.currentCityRegion；多选时为数组路径 */
  regionPath: string;
  /** 是否多选追加 */
  multiAppend?: boolean;
  required?: boolean;
}

/** 内存缓存的省市区树 */
let cachedRegions: RegionNode[] | null = null;
/** 进行中的加载 Promise，避免并发重复请求 */
let loadingPromise: Promise<RegionNode[]> | null = null;

/**
 * 解析扩展内 china-pca.json 的绝对 URL。
 */
function resolveChinaPcaUrl(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('/data/china-pca.json');
    }
  } catch {
    // 非扩展环境走相对路径
  }
  return '/data/china-pca.json';
}

/**
 * 懒加载并缓存省市区树；失败时抛出可读错误。
 */
export async function loadChinaRegions(): Promise<RegionNode[]> {
  if (cachedRegions) {
    return cachedRegions;
  }
  if (loadingPromise) {
    return loadingPromise;
  }
  loadingPromise = (async () => {
    const response = await fetch(resolveChinaPcaUrl());
    if (!response.ok) {
      throw new Error(`无法加载区划数据（HTTP ${response.status}）`);
    }
    const payload = (await response.json()) as ChinaPcaPayload;
    if (!Array.isArray(payload.regions) || payload.regions.length === 0) {
      throw new Error('区划数据为空或格式错误');
    }
    cachedRegions = payload.regions;
    return cachedRegions;
  })();
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

/**
 * 将省/市/区名称拼成展示文案。
 */
export function formatRegionText(
  provinceName: string,
  cityName: string,
  districtName: string,
): string {
  return [provinceName, cityName, districtName]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' / ');
}

/**
 * 由路径节点组装 RegionSelection。
 */
function buildRegionSelection(
  province: RegionNode,
  city: RegionNode | null,
  district: RegionNode | null,
): RegionSelection {
  const provinceName = province.name;
  const cityName = city?.name ?? '';
  const districtName = district?.name ?? '';
  return {
    provinceCode: province.code,
    provinceName,
    cityCode: city?.code ?? '',
    cityName,
    districtCode: district?.code ?? '',
    districtName,
    text: formatRegionText(provinceName, cityName, districtName),
  };
}

/**
 * 创建省市区三级选择器（div.field 根节点，避免 label 吞点击导致选完又自动打开）。
 */
export function createRegionCascader(
  config: RegionCascaderOptions,
): HTMLDivElement {
  const {
    labelText,
    initialText,
    initialRegion = null,
    onChange,
    required = false,
    placeholder = '点击选择省 / 市 / 区…',
    multiAppend = false,
  } = config;

  // 用 div 而非 label：面板内点选项时，label 会连带激活只读输入并再次 openPanel
  const root = document.createElement('div');
  root.className = 'field region-field';

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
  wrap.className = 'region-cascader';
  wrap.dataset.open = 'false';

  const displayInput = document.createElement('input');
  displayInput.type = 'text';
  displayInput.className = 'region-cascader-display';
  displayInput.readOnly = true;
  displayInput.placeholder = placeholder;
  displayInput.autocomplete = 'off';
  // 有结构化则展示 text；否则展示旧字符串
  displayInput.value =
    initialRegion?.text?.trim() || initialText.trim() || '';

  const triggerRow = document.createElement('div');
  triggerRow.className = 'region-cascader-trigger';

  const pickButton = document.createElement('button');
  pickButton.type = 'button';
  pickButton.className = 'btn btn-secondary region-cascader-pick';
  pickButton.textContent = multiAppend ? '添加' : '选择';

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'btn btn-ghost region-cascader-clear';
  clearButton.textContent = '清空';
  clearButton.hidden = !displayInput.value;

  triggerRow.append(displayInput, pickButton, clearButton);

  const panel = document.createElement('div');
  panel.className = 'region-cascader-panel';
  panel.hidden = true;

  const panelHeader = document.createElement('div');
  panelHeader.className = 'region-cascader-header';

  const breadcrumb = document.createElement('p');
  breadcrumb.className = 'region-cascader-breadcrumb';
  breadcrumb.textContent = '请选择省份';

  const headerActions = document.createElement('div');
  headerActions.className = 'region-cascader-header-actions';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn-ghost region-cascader-back';
  backButton.textContent = '返回上一级';
  backButton.disabled = true;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn btn-ghost region-cascader-close';
  closeButton.textContent = '关闭';
  closeButton.setAttribute('aria-label', '关闭地区选择');

  headerActions.append(backButton, closeButton);
  panelHeader.append(breadcrumb, headerActions);

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'region-cascader-search';
  searchInput.placeholder = '搜索当前级…';
  searchInput.autocomplete = 'off';

  const list = document.createElement('ul');
  list.className = 'region-cascader-list';
  list.setAttribute('role', 'listbox');

  const statusLine = document.createElement('p');
  statusLine.className = 'region-cascader-status';
  statusLine.hidden = true;

  panel.append(panelHeader, searchInput, list, statusLine);
  wrap.append(triggerRow, panel);
  root.append(titleSpan, wrap);

  /** 当前选中的结构化结果（单选模式） */
  let currentSelection: RegionSelection | null =
    initialRegion && initialRegion.text.trim()
      ? { ...initialRegion }
      : null;

  /** Drill-down 路径：0=省 1=市 2=区 */
  let pathProvince: RegionNode | null = null;
  let pathCity: RegionNode | null = null;
  /** 当前级展示的节点列表 */
  let levelNodes: RegionNode[] = [];
  let allProvinces: RegionNode[] = [];
  /** 选完关闭后短暂忽略再次打开，防止同一次点击穿透 */
  let ignoreOpenUntilMs = 0;

  /**
   * 更新清空按钮可见性。
   */
  function syncClearVisibility(): void {
    clearButton.hidden = !displayInput.value.trim();
  }

  /**
   * 关闭面板并复位搜索与下钻路径。
   */
  function closePanel(): void {
    wrap.dataset.open = 'false';
    panel.hidden = true;
    searchInput.value = '';
    pathProvince = null;
    pathCity = null;
    levelNodes = [];
    // 约一帧多一点，挡住选完后穿透到「选择」/展示框的二次打开
    ignoreOpenUntilMs = Date.now() + 400;
  }

  /**
   * 是否允许打开面板（选完后的短时锁）。
   */
  function canOpenPanel(): boolean {
    return Date.now() >= ignoreOpenUntilMs;
  }

  /**
   * 提交最终选择：写入展示、回调，并关闭面板。
   */
  function commitSelection(selection: RegionSelection): void {
    if (multiAppend) {
      const existing = displayInput.value.trim();
      const nextText = existing
        ? `${existing}、${selection.text}`
        : selection.text;
      displayInput.value = nextText;
      currentSelection = selection;
      onChange(selection, nextText);
    } else {
      displayInput.value = selection.text;
      currentSelection = selection;
      onChange(selection, selection.text);
    }
    syncClearVisibility();
    closePanel();
  }

  /**
   * 根据路径深度渲染当前级列表。
   */
  function renderLevelList(filterText: string): void {
    const keyword = filterText.trim().toLowerCase();
    const filtered = levelNodes.filter((node) => {
      if (!keyword) {
        return true;
      }
      return (
        node.name.toLowerCase().includes(keyword) ||
        node.code.toLowerCase().includes(keyword)
      );
    });
    list.replaceChildren();
    if (filtered.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'region-cascader-empty';
      emptyItem.textContent = '无匹配区划';
      list.appendChild(emptyItem);
      return;
    }
    for (const node of filtered) {
      const listItem = document.createElement('li');
      listItem.className = 'region-cascader-option';
      listItem.setAttribute('role', 'option');
      listItem.textContent = node.name;
      listItem.tabIndex = 0;
      // mousedown 阻止默认，避免焦点跑到别处；click 再提交
      listItem.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      listItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleNodePick(node);
      });
      listItem.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          void handleNodePick(node);
        }
      });
      list.appendChild(listItem);
    }
  }

  /**
   * 刷新面包屑与返回按钮状态。
   */
  function syncHeaderChrome(): void {
    if (!pathProvince) {
      breadcrumb.textContent = '请选择省份';
      backButton.disabled = true;
      return;
    }
    if (!pathCity) {
      breadcrumb.textContent = pathProvince.name;
      backButton.disabled = false;
      return;
    }
    breadcrumb.textContent = `${pathProvince.name} / ${pathCity.name}`;
    backButton.disabled = false;
  }

  /**
   * 进入某一级并渲染。
   */
  function enterLevel(
    nodes: RegionNode[],
    province: RegionNode | null,
    city: RegionNode | null,
  ): void {
    pathProvince = province;
    pathCity = city;
    levelNodes = nodes;
    searchInput.value = '';
    syncHeaderChrome();
    renderLevelList('');
    searchInput.focus();
  }

  /**
   * 处理节点点击：有下级则下钻，无下级则确认并关闭。
   */
  async function handleNodePick(node: RegionNode): Promise<void> {
    const children = node.children ?? [];
    if (!pathProvince) {
      if (children.length === 0) {
        commitSelection(buildRegionSelection(node, null, null));
        return;
      }
      enterLevel(children, node, null);
      return;
    }
    if (!pathCity) {
      if (children.length === 0) {
        commitSelection(buildRegionSelection(pathProvince, node, null));
        return;
      }
      enterLevel(children, pathProvince, node);
      return;
    }
    // 选到区：写入并关闭
    commitSelection(buildRegionSelection(pathProvince, pathCity, node));
  }

  /**
   * 返回上一级。
   */
  function goBack(): void {
    if (pathCity && pathProvince) {
      enterLevel(pathProvince.children ?? [], pathProvince, null);
      return;
    }
    if (pathProvince) {
      enterLevel(allProvinces, null, null);
    }
  }

  /**
   * 打开面板并确保数据已加载。
   */
  async function openPanel(): Promise<void> {
    if (!canOpenPanel()) {
      return;
    }
    wrap.dataset.open = 'true';
    panel.hidden = false;
    statusLine.hidden = false;
    statusLine.textContent = '正在加载区划…';
    list.replaceChildren();
    try {
      allProvinces = await loadChinaRegions();
      statusLine.hidden = true;
      statusLine.textContent = '';
      enterLevel(allProvinces, null, null);
    } catch (error) {
      statusLine.hidden = false;
      statusLine.textContent =
        error instanceof Error ? error.message : '加载区划失败';
    }
  }

  pickButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (wrap.dataset.open === 'true') {
      closePanel();
      return;
    }
    void openPanel();
  });

  displayInput.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (wrap.dataset.open === 'true') {
      return;
    }
    void openPanel();
  });

  clearButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    displayInput.value = '';
    currentSelection = null;
    onChange(null, '');
    syncClearVisibility();
    closePanel();
  });

  backButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    goBack();
  });

  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  });

  searchInput.addEventListener('input', () => {
    renderLevelList(searchInput.value);
  });

  // 点击面板外关闭
  document.addEventListener('mousedown', (event) => {
    if (wrap.dataset.open !== 'true') {
      return;
    }
    const target = event.target as Node | null;
    if (target && !wrap.contains(target)) {
      closePanel();
    }
  });

  displayInput.addEventListener('change', () => {
    root.dataset.regionDisplay = displayInput.value;
  });

  /**
   * 程序化设置展示文案（切换档案时用）。
   */
  (root as HTMLDivElement & {
    setRegionDisplay?: (text: string, region?: RegionSelection | null) => void;
  }).setRegionDisplay = (text: string, region?: RegionSelection | null) => {
    displayInput.value = region?.text?.trim() || text.trim() || '';
    currentSelection =
      region && region.text.trim() ? { ...region } : null;
    syncClearVisibility();
    root.dataset.regionDisplay = displayInput.value;
  };

  root.dataset.regionDisplay = displayInput.value;
  return root;
}

/**
 * 读取地区控件上的展示文案。
 */
export function readRegionDisplay(fieldRoot: HTMLElement): string {
  const input = fieldRoot.querySelector<HTMLInputElement>(
    '.region-cascader-display',
  );
  return input?.value.trim() ?? '';
}

/**
 * 将静态表单中带 data-region 的 input 升级为 Cascader。
 * data-region 取值对应 RegionFieldBinding 的键，由调用方传入映射表。
 */
export function upgradeStaticRegionFields(
  rootElement: ParentNode,
  bindings: Record<string, RegionFieldBinding>,
  onCommit: (
    binding: RegionFieldBinding,
    selection: RegionSelection | null,
    displayText: string,
  ) => void,
  readInitial: (
    binding: RegionFieldBinding,
  ) => { text: string; region: RegionSelection | null },
): void {
  const inputs = [
    ...rootElement.querySelectorAll<HTMLInputElement>('input[data-region]'),
  ];
  for (const inputElement of inputs) {
    const regionKey = inputElement.dataset.region ?? '';
    const binding = bindings[regionKey];
    if (!binding) {
      continue;
    }
    const parentLabel = inputElement.closest('label.field');
    if (!parentLabel || !parentLabel.parentElement) {
      continue;
    }
    const labelText =
      parentLabel
        .querySelector('.field-label')
        ?.textContent?.replace(/\s*\*\s*$/, '')
        .trim() || binding.textPath;
    const required =
      binding.required ||
      inputElement.required ||
      Boolean(parentLabel.querySelector('.req'));
    const initial = readInitial(binding);
    const cascader = createRegionCascader({
      labelText,
      initialText: initial.text,
      initialRegion: initial.region,
      required,
      multiAppend: binding.multiAppend,
      onChange: (selection, displayText) => {
        onCommit(binding, selection, displayText);
      },
    });
    cascader.dataset.regionBound = regionKey;
    cascader.dataset.pathBound = binding.textPath;
    parentLabel.replaceWith(cascader);
  }
}

/**
 * 同步已升级地区控件的展示值（切换档案时调用）。
 */
export function syncRegionBoundDisplays(
  rootElement: ParentNode,
  bindings: Record<string, RegionFieldBinding>,
  readCurrent: (
    binding: RegionFieldBinding,
  ) => { text: string; region: RegionSelection | null },
): void {
  const fieldRoots = [
    ...rootElement.querySelectorAll<HTMLElement>('[data-region-bound]'),
  ];
  for (const fieldRoot of fieldRoots) {
    const regionKey = fieldRoot.dataset.regionBound ?? '';
    const binding = bindings[regionKey];
    if (!binding) {
      continue;
    }
    const current = readCurrent(binding);
    const setter = (
      fieldRoot as HTMLElement & {
        setRegionDisplay?: (
          text: string,
          region?: RegionSelection | null,
        ) => void;
      }
    ).setRegionDisplay;
    if (typeof setter === 'function') {
      setter(current.text, current.region);
    }
  }
}

/**
 * 供动态列表使用的地区绑定控件。
 */
export function createBoundRegionField(
  labelText: string,
  initialText: string,
  initialRegion: RegionSelection | null | undefined,
  onChange: (selection: RegionSelection | null, displayText: string) => void,
  required: boolean = false,
): HTMLDivElement {
  return createRegionCascader({
    labelText,
    initialText,
    initialRegion: initialRegion ?? null,
    onChange,
    required,
  });
}

export { createEmptyRegionSelection };
