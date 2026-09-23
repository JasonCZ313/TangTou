/**
 * Options 页主逻辑：API / 填写模式 / 档案 CRUD / 导入导出。
 * 在扩展页上下文中直接调用 storage API，不经 Background。
 */
import {
  appendProfilesAtomic,
  createProfile,
  deleteProfile,
  listProfiles,
  renameProfile,
  setActiveProfileId,
  updateProfileData,
} from '../../shared/storage/profileStore';
import { getSettings, saveSettings } from '../../shared/storage/settingsStore';
import {
  createEmptyProfileData,
  MAX_PROFILES,
} from '../../shared/storage/defaults';
import type {
  EducationItem,
  ExperienceItem,
  FillMode,
  Profile,
  ProfileData,
  ProjectItem,
} from '../../shared/types/profile';
import type { ExtensionMessage } from '../../shared/types/messages';

/** 状态提示的视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/** 导出文件的 JSON 结构（version 约定为 1） */
interface ExportPayload {
  version: number;
  profiles: Profile[];
  settings: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    fillMode: FillMode;
    activeProfileId: string | null;
  };
}

/** 当前内存中的档案列表缓存，供列表与下拉渲染 */
let cachedProfiles: Profile[] = [];

/** 当前正在编辑的档案 id；无编辑时为 null */
let editingProfileId: string | null = null;

/** 编辑区内存草稿，保存时再写入 storage */
let draftProfileData: ProfileData | null = null;

/** 当前默认档案 id */
let activeProfileId: string | null = null;

// —— DOM 引用 ——
const statusMessageElement = document.getElementById(
  'statusMessage',
) as HTMLParagraphElement;
const apiForm = document.getElementById('apiForm') as HTMLFormElement;
const apiBaseUrlInput = document.getElementById(
  'apiBaseUrlInput',
) as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKeyInput') as HTMLInputElement;
const modelInput = document.getElementById('modelInput') as HTMLInputElement;
const testApiButton = document.getElementById(
  'testApiButton',
) as HTMLButtonElement;
const fillModePreview = document.getElementById(
  'fillModePreview',
) as HTMLInputElement;
const fillModeDirect = document.getElementById(
  'fillModeDirect',
) as HTMLInputElement;
const profileListElement = document.getElementById(
  'profileList',
) as HTMLUListElement;
const profileCountHint = document.getElementById(
  'profileCountHint',
) as HTMLParagraphElement;
const emptyProfilesHint = document.getElementById(
  'emptyProfilesHint',
) as HTMLParagraphElement;
const createProfileForm = document.getElementById(
  'createProfileForm',
) as HTMLFormElement;
const newProfileNameInput = document.getElementById(
  'newProfileNameInput',
) as HTMLInputElement;
const cloneSourceSelect = document.getElementById(
  'cloneSourceSelect',
) as HTMLSelectElement;
const editorSection = document.getElementById(
  'editorSection',
) as HTMLElement;
const editingProfileName = document.getElementById(
  'editingProfileName',
) as HTMLParagraphElement;
const profileEditorForm = document.getElementById(
  'profileEditorForm',
) as HTMLFormElement;
const educationListElement = document.getElementById(
  'educationList',
) as HTMLDivElement;
const experienceListElement = document.getElementById(
  'experienceList',
) as HTMLDivElement;
const projectsListElement = document.getElementById(
  'projectsList',
) as HTMLDivElement;
const skillsTextarea = document.getElementById(
  'skillsTextarea',
) as HTMLTextAreaElement;
const notesTextarea = document.getElementById(
  'notesTextarea',
) as HTMLTextAreaElement;
const closeEditorButton = document.getElementById(
  'closeEditorButton',
) as HTMLButtonElement;
const exportButton = document.getElementById(
  'exportButton',
) as HTMLButtonElement;
const importFileInput = document.getElementById(
  'importFileInput',
) as HTMLInputElement;

/**
 * 在页面顶部展示中文状态文案，并按类型切换样式。
 */
function showStatus(message: string, kind: StatusKind = 'info'): void {
  statusMessageElement.textContent = message;
  statusMessageElement.classList.remove('is-success', 'is-error', 'is-info');
  statusMessageElement.classList.add(`is-${kind}`);
}

/**
 * 将 storage / API 抛出的错误码映射为中文提示。
 */
function mapErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'PROFILE_LIMIT_REACHED') {
    return '最多保存 5 份档案';
  }
  if (message === 'PROFILE_NOT_FOUND') {
    return '档案不存在';
  }
  if (message === 'SOURCE_PROFILE_NOT_FOUND') {
    return '用于复制的源档案不存在';
  }
  return message || '操作失败';
}

/**
 * 将 ISO 时间格式化为本地可读短字符串。
 */
function formatUpdatedAt(isoText: string): string {
  const dateValue = new Date(isoText);
  if (Number.isNaN(dateValue.getTime())) {
    return isoText;
  }
  return dateValue.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 生成消息 requestId，供 TEST_API 等消息配对使用。
 */
function createRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 页面加载：读取 settings + profiles 并渲染全部区域。
 */
async function bootstrapOptionsPage(): Promise<void> {
  try {
    const [settings, profiles] = await Promise.all([
      getSettings(),
      listProfiles(),
    ]);
    cachedProfiles = profiles;
    activeProfileId = settings.activeProfileId;

    apiBaseUrlInput.value = settings.apiBaseUrl;
    apiKeyInput.value = settings.apiKey;
    modelInput.value = settings.model;
    fillModePreview.checked = settings.fillMode === 'preview';
    fillModeDirect.checked = settings.fillMode === 'direct';

    renderProfileList();
    renderCloneSourceOptions();
    showStatus('已加载设置与档案', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 刷新档案列表卡片（名称、更新时间、操作按钮）。
 */
function renderProfileList(): void {
  profileListElement.replaceChildren();
  profileCountHint.textContent = `已保存 ${cachedProfiles.length} / ${MAX_PROFILES} 份`;
  emptyProfilesHint.classList.toggle('hidden', cachedProfiles.length > 0);

  for (const profile of cachedProfiles) {
    const listItem = document.createElement('li');
    listItem.className = 'profile-card';
    if (profile.id === activeProfileId) {
      listItem.classList.add('is-active');
    }

    const metaBlock = document.createElement('div');
    metaBlock.className = 'profile-meta';

    const nameParagraph = document.createElement('p');
    nameParagraph.className = 'profile-name';
    nameParagraph.textContent = profile.name;
    if (profile.id === activeProfileId) {
      const badge = document.createElement('span');
      badge.className = 'profile-badge';
      badge.textContent = '默认';
      nameParagraph.appendChild(badge);
    }

    const timeParagraph = document.createElement('p');
    timeParagraph.className = 'profile-time';
    timeParagraph.textContent = `更新于 ${formatUpdatedAt(profile.updatedAt)}`;

    metaBlock.append(nameParagraph, timeParagraph);

    const actionsBlock = document.createElement('div');
    actionsBlock.className = 'profile-actions';

    const setDefaultButton = document.createElement('button');
    setDefaultButton.type = 'button';
    setDefaultButton.className = 'btn btn-secondary btn-sm';
    setDefaultButton.textContent = '设为默认';
    setDefaultButton.disabled = profile.id === activeProfileId;
    setDefaultButton.addEventListener('click', () => {
      void handleSetActive(profile.id);
    });

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'btn btn-secondary btn-sm';
    renameButton.textContent = '改名';
    renameButton.addEventListener('click', () => {
      void handleRename(profile);
    });

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-secondary btn-sm';
    editButton.textContent = '编辑';
    editButton.addEventListener('click', () => {
      openEditor(profile);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-danger btn-sm';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      void handleDelete(profile);
    });

    actionsBlock.append(
      setDefaultButton,
      renameButton,
      editButton,
      deleteButton,
    );
    listItem.append(metaBlock, actionsBlock);
    profileListElement.appendChild(listItem);
  }
}

/**
 * 刷新「新建」表单中的复制来源下拉（空白 + 各档案）。
 */
function renderCloneSourceOptions(): void {
  const previousValue = cloneSourceSelect.value;
  cloneSourceSelect.replaceChildren();

  const blankOption = document.createElement('option');
  blankOption.value = '';
  blankOption.textContent = '空白档案';
  cloneSourceSelect.appendChild(blankOption);

  for (const profile of cachedProfiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `从「${profile.name}」复制`;
    cloneSourceSelect.appendChild(option);
  }

  const stillExists = [...cloneSourceSelect.options].some(
    (option) => option.value === previousValue,
  );
  cloneSourceSelect.value = stillExists ? previousValue : '';
}

/**
 * 从 storage 重新拉取档案与 activeProfileId，并刷新列表相关 UI。
 */
async function refreshProfilesFromStorage(): Promise<void> {
  const [profiles, settings] = await Promise.all([
    listProfiles(),
    getSettings(),
  ]);
  cachedProfiles = profiles;
  activeProfileId = settings.activeProfileId;
  renderProfileList();
  renderCloneSourceOptions();
}

/**
 * 保存 API 三项设置（Base URL / Key / 模型）。
 */
async function handleSaveApiSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  try {
    await saveSettings({
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      apiKey: apiKeyInput.value,
      model: modelInput.value.trim(),
    });
    showStatus('API 设置已保存', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 发送 TEST_API 消息；后台未实现或无有效响应时显示「后台未就绪」。
 * LLM 测连逻辑在 Task 6 实现，本任务只接线按钮。
 */
function handleTestApiConnection(): void {
  const requestId = createRequestId();
  const message: ExtensionMessage = { type: 'TEST_API', requestId };

  try {
    chrome.runtime.sendMessage(message, (response: ExtensionMessage | undefined) => {
      if (chrome.runtime.lastError) {
        showStatus('后台未就绪', 'error');
        return;
      }
      if (!response) {
        showStatus('后台未就绪', 'error');
        return;
      }
      if (response.type === 'TEST_API_RESULT') {
        if (response.ok) {
          showStatus(response.detail || '连接成功', 'success');
        } else {
          showStatus(response.detail || '连接失败', 'error');
        }
        return;
      }
      if (response.type === 'ERROR') {
        showStatus(response.message || '后台未就绪', 'error');
        return;
      }
      showStatus('后台未就绪', 'error');
    });
  } catch {
    showStatus('后台未就绪', 'error');
  }
}

/**
 * 切换填写模式并立即持久化。
 */
async function handleFillModeChange(): Promise<void> {
  const fillMode: FillMode = fillModeDirect.checked ? 'direct' : 'preview';
  try {
    await saveSettings({ fillMode });
    showStatus(
      fillMode === 'preview' ? '已切换为预览后写入' : '已切换为直接填写',
      'success',
    );
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 创建空白档案，或从下拉选定的档案深拷贝 data。
 */
async function handleCreateProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const name = newProfileNameInput.value.trim();
  const cloneFromId = cloneSourceSelect.value || undefined;

  try {
    const created = await createProfile({
      name,
      cloneFromId,
    });
    newProfileNameInput.value = '';
    cloneSourceSelect.value = '';
    await refreshProfilesFromStorage();
    showStatus(`已创建档案「${created.name}」`, 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 将指定档案设为全局默认。
 */
async function handleSetActive(profileId: string): Promise<void> {
  try {
    await setActiveProfileId(profileId);
    await refreshProfilesFromStorage();
    showStatus('已设为默认档案', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 弹出改名对话框并调用 renameProfile。
 */
async function handleRename(profile: Profile): Promise<void> {
  const nextName = window.prompt('请输入新名称', profile.name);
  if (nextName === null) {
    return;
  }
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    showStatus('名称不能为空', 'error');
    return;
  }
  try {
    await renameProfile(profile.id, trimmedName);
    await refreshProfilesFromStorage();
    if (editingProfileId === profile.id) {
      editingProfileName.textContent = `正在编辑：${trimmedName}`;
    }
    showStatus('已改名', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 确认后删除档案；若正在编辑该档案则关闭编辑区。
 */
async function handleDelete(profile: Profile): Promise<void> {
  const confirmed = window.confirm(
    `确定删除档案「${profile.name}」？此操作不可恢复。`,
  );
  if (!confirmed) {
    return;
  }
  try {
    await deleteProfile(profile.id);
    if (editingProfileId === profile.id) {
      closeEditor();
    }
    await refreshProfilesFromStorage();
    showStatus(`已删除「${profile.name}」`, 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 打开编辑区：深拷贝档案 data 到草稿并填充表单。
 */
function openEditor(profile: Profile): void {
  editingProfileId = profile.id;
  draftProfileData = structuredClone(profile.data);
  editingProfileName.textContent = `正在编辑：${profile.name}`;
  editorSection.classList.remove('hidden');
  fillEditorForm(draftProfileData);
  editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 关闭编辑区并清空草稿。
 */
function closeEditor(): void {
  editingProfileId = null;
  draftProfileData = null;
  editorSection.classList.add('hidden');
}

/**
 * 将 ProfileData 填入静态字段与动态列表控件。
 */
function fillEditorForm(data: ProfileData): void {
  const pathInputs = profileEditorForm.querySelectorAll<HTMLInputElement>(
    'input[data-path]',
  );
  for (const inputElement of pathInputs) {
    const pathText = inputElement.dataset.path ?? '';
    inputElement.value = readPathValue(data, pathText);
  }

  skillsTextarea.value = data.skills.join('\n');
  notesTextarea.value = data.notes;
  renderEducationRows(data.education);
  renderExperienceRows(data.experience);
  renderProjectRows(data.projects);
}

/**
 * 按点分路径读取嵌套字符串字段（如 basic.fullName）。
 */
function readPathValue(data: ProfileData, pathText: string): string {
  const pathParts = pathText.split('.');
  let current: unknown = data;
  for (const pathPart of pathParts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return '';
    }
    current = (current as Record<string, unknown>)[pathPart];
  }
  return typeof current === 'string' ? current : '';
}

/**
 * 按点分路径写入嵌套字符串字段。
 */
function writePathValue(
  data: ProfileData,
  pathText: string,
  value: string,
): void {
  const pathParts = pathText.split('.');
  if (pathParts.length < 2) {
    return;
  }
  let current: Record<string, unknown> = data as unknown as Record<
    string,
    unknown
  >;
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const pathPart = pathParts[index];
    const nextValue = current[pathPart];
    if (nextValue === null || typeof nextValue !== 'object') {
      return;
    }
    current = nextValue as Record<string, unknown>;
  }
  current[pathParts[pathParts.length - 1]] = value;
}

/**
 * 渲染教育经历动态行。
 */
function renderEducationRows(items: EducationItem[]): void {
  educationListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`教育经历 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.education.splice(itemIndex, 1);
      renderEducationRows(draftProfileData.education);
    });

    card.append(
      createBoundInput('学校', item.school, (value) => {
        item.school = value;
      }),
      createBoundInput('学历', item.degree, (value) => {
        item.degree = value;
      }),
      createBoundInput('专业', item.major, (value) => {
        item.major = value;
      }),
      createBoundInput('开始日期', item.startDate, (value) => {
        item.startDate = value;
      }),
      createBoundInput('结束日期', item.endDate, (value) => {
        item.endDate = value;
      }),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
    );
    educationListElement.appendChild(card);
  });
}

/**
 * 渲染工作经历动态行。
 */
function renderExperienceRows(items: ExperienceItem[]): void {
  experienceListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`工作经历 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.experience.splice(itemIndex, 1);
      renderExperienceRows(draftProfileData.experience);
    });

    card.append(
      createBoundInput('公司', item.company, (value) => {
        item.company = value;
      }),
      createBoundInput('职位', item.title, (value) => {
        item.title = value;
      }),
      createBoundInput('开始日期', item.startDate, (value) => {
        item.startDate = value;
      }),
      createBoundInput('结束日期', item.endDate, (value) => {
        item.endDate = value;
      }),
      createBoundTextarea('职责描述', item.description, (value) => {
        item.description = value;
      }),
    );
    experienceListElement.appendChild(card);
  });
}

/**
 * 渲染项目经历动态行。
 */
function renderProjectRows(items: ProjectItem[]): void {
  projectsListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`项目 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.projects.splice(itemIndex, 1);
      renderProjectRows(draftProfileData.projects);
    });

    card.append(
      createBoundInput('项目名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('角色', item.role ?? '', (value) => {
        item.role = value;
      }),
      createBoundInput('开始日期', item.startDate ?? '', (value) => {
        item.startDate = value;
      }),
      createBoundInput('结束日期', item.endDate ?? '', (value) => {
        item.endDate = value;
      }),
      createBoundInput('链接', item.link ?? '', (value) => {
        item.link = value;
      }),
      createBoundTextarea('项目描述', item.description, (value) => {
        item.description = value;
      }),
    );
    projectsListElement.appendChild(card);
  });
}

/**
 * 创建带标题与「删除」按钮的列表项卡片容器。
 */
function createListItemCard(
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
 * 创建绑定到草稿字段的单行输入。
 */
function createBoundInput(
  labelText: string,
  initialValue: string,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';

  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = initialValue;
  input.addEventListener('input', () => {
    onChange(input.value);
  });

  label.append(span, input);
  return label;
}

/**
 * 创建绑定到草稿字段的多行输入。
 */
function createBoundTextarea(
  labelText: string,
  initialValue: string,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';

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
 * 向草稿追加一条空白教育 / 工作 / 项目经历。
 */
function handleAddListItem(listKind: string): void {
  if (!draftProfileData) {
    return;
  }
  if (listKind === 'education') {
    draftProfileData.education.push({
      school: '',
      degree: '',
      major: '',
      startDate: '',
      endDate: '',
      description: '',
    });
    renderEducationRows(draftProfileData.education);
    return;
  }
  if (listKind === 'experience') {
    draftProfileData.experience.push({
      company: '',
      title: '',
      startDate: '',
      endDate: '',
      description: '',
    });
    renderExperienceRows(draftProfileData.experience);
    return;
  }
  if (listKind === 'projects') {
    draftProfileData.projects.push({
      name: '',
      role: '',
      startDate: '',
      endDate: '',
      description: '',
      link: '',
    });
    renderProjectRows(draftProfileData.projects);
  }
}

/**
 * 从编辑表单收集草稿并调用 updateProfileData 持久化。
 */
async function handleSaveProfileData(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!editingProfileId || !draftProfileData) {
    showStatus('当前没有正在编辑的档案', 'error');
    return;
  }

  const pathInputs = profileEditorForm.querySelectorAll<HTMLInputElement>(
    'input[data-path]',
  );
  for (const inputElement of pathInputs) {
    const pathText = inputElement.dataset.path ?? '';
    writePathValue(draftProfileData, pathText, inputElement.value.trim());
  }

  draftProfileData.skills = skillsTextarea.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  draftProfileData.notes = notesTextarea.value;

  try {
    const updated = await updateProfileData(
      editingProfileId,
      draftProfileData,
    );
    await refreshProfilesFromStorage();
    editingProfileName.textContent = `正在编辑：${updated.name}`;
    draftProfileData = structuredClone(updated.data);
    showStatus('档案内容已保存', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 导出全部档案与设置；强制将 apiKey 置为空字符串。
 */
async function handleExport(): Promise<void> {
  try {
    const [profiles, settings] = await Promise.all([
      listProfiles(),
      getSettings(),
    ]);
    const exportPayload: ExportPayload = {
      version: 1,
      profiles,
      settings: { ...settings, apiKey: '' },
    };
    const jsonText = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = `resume-autofill-export-${formatExportStamp()}.json`;
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
    showStatus('已导出（不含 API Key）', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

/**
 * 生成导出文件名用的时间戳片段。
 */
function formatExportStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * 生成新档案 id（导入批次在内存组装时使用，与 profileStore 一致）。
 */
function createImportedProfileId(): string {
  return crypto.randomUUID();
}

/**
 * 当前时间的 ISO 字符串，用于导入档案的 createdAt / updatedAt。
 */
function createImportedTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 将任意对象深度合并到目标上：对象递归合并，数组与原始值整体覆盖。
 * 用于把残缺导入 data 铺到 createEmptyProfileData() 骨架上，保证 skills 等必有数组。
 */
function deepMergeRecord(
  targetValue: Record<string, unknown>,
  sourceValue: Record<string, unknown>,
): Record<string, unknown> {
  const mergedResult: Record<string, unknown> = { ...targetValue };

  for (const [fieldKey, sourceFieldValue] of Object.entries(sourceValue)) {
    if (sourceFieldValue === undefined) {
      continue;
    }

    const targetFieldValue = mergedResult[fieldKey];
    const sourceIsPlainObject =
      sourceFieldValue !== null &&
      typeof sourceFieldValue === 'object' &&
      !Array.isArray(sourceFieldValue);
    const targetIsPlainObject =
      targetFieldValue !== null &&
      typeof targetFieldValue === 'object' &&
      !Array.isArray(targetFieldValue);

    if (sourceIsPlainObject && targetIsPlainObject) {
      mergedResult[fieldKey] = deepMergeRecord(
        targetFieldValue as Record<string, unknown>,
        sourceFieldValue as Record<string, unknown>,
      );
      continue;
    }

    if (Array.isArray(sourceFieldValue)) {
      mergedResult[fieldKey] = structuredClone(sourceFieldValue);
      continue;
    }

    if (sourceIsPlainObject) {
      mergedResult[fieldKey] = structuredClone(sourceFieldValue);
      continue;
    }

    mergedResult[fieldKey] = sourceFieldValue;
  }

  return mergedResult;
}

/**
 * 将导入的残缺 data 规范化：以空白 ProfileData 为底，深度合并导入字段。
 * 缺省的 education / experience / projects / skills / basic / jobIntent / notes 均保留空骨架，
 * 避免编辑区调用 skills.join 等时因 undefined 崩溃。
 */
function normalizeImportedProfileData(rawData: unknown): ProfileData {
  const emptyProfileData = createEmptyProfileData();
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return emptyProfileData;
  }

  const mergedData = deepMergeRecord(
    emptyProfileData as unknown as Record<string, unknown>,
    rawData as Record<string, unknown>,
  );

  return mergedData as unknown as ProfileData;
}

/**
 * 导入 JSON：先校验并在内存组装全部待写入档案，再一次性原子追加。
 * 跳过无效条目；成功计数不含跳过项。设置合并时保留本机 apiKey（导入文件通常为空）。
 */
async function handleImportFileChange(): Promise<void> {
  const fileList = importFileInput.files;
  const selectedFile = fileList?.[0];
  if (!selectedFile) {
    return;
  }

  try {
    const fileText = await selectedFile.text();
    const parsed = JSON.parse(fileText) as Partial<ExportPayload>;

    if (!parsed || typeof parsed !== 'object') {
      showStatus('导入文件格式无效', 'error');
      return;
    }
    if (!Array.isArray(parsed.profiles)) {
      showStatus('导入文件缺少 profiles 数组', 'error');
      return;
    }

    // 先在内存中规范化全部有效档案；任一项失败则整批不写 storage
    const profilesToAppend: Profile[] = [];
    let skippedCount = 0;

    for (const importedProfile of parsed.profiles) {
      if (!importedProfile || typeof importedProfile !== 'object') {
        skippedCount += 1;
        continue;
      }

      const profileName =
        typeof importedProfile.name === 'string' && importedProfile.name.trim()
          ? importedProfile.name.trim()
          : '导入档案';
      const timestamp = createImportedTimestamp();
      const normalizedData = normalizeImportedProfileData(importedProfile.data);

      profilesToAppend.push({
        id: createImportedProfileId(),
        name: profileName,
        createdAt: timestamp,
        updatedAt: timestamp,
        data: normalizedData,
      });
    }

    const existingProfiles = await listProfiles();
    if (existingProfiles.length + profilesToAppend.length > MAX_PROFILES) {
      showStatus(
        `导入后将超过 ${MAX_PROFILES} 份档案上限，已取消`,
        'error',
      );
      return;
    }

    // 单次 storage 写入；失败时原有档案保持不变
    await appendProfilesAtomic(profilesToAppend);

    if (parsed.settings && typeof parsed.settings === 'object') {
      const currentSettings = await getSettings();
      const importedSettings = parsed.settings;
      await saveSettings({
        apiBaseUrl:
          typeof importedSettings.apiBaseUrl === 'string'
            ? importedSettings.apiBaseUrl
            : currentSettings.apiBaseUrl,
        model:
          typeof importedSettings.model === 'string'
            ? importedSettings.model
            : currentSettings.model,
        fillMode:
          importedSettings.fillMode === 'preview' ||
          importedSettings.fillMode === 'direct'
            ? importedSettings.fillMode
            : currentSettings.fillMode,
        // 导出已剔除 Key；空字符串时保留本机已有 Key，避免误清空
        apiKey:
          typeof importedSettings.apiKey === 'string' &&
          importedSettings.apiKey.length > 0
            ? importedSettings.apiKey
            : currentSettings.apiKey,
      });
    }

    await bootstrapOptionsPage();
    const importedCount = profilesToAppend.length;
    if (skippedCount > 0) {
      showStatus(
        `已导入 ${importedCount} 份档案（跳过 ${skippedCount} 项无效条目）`,
        'success',
      );
    } else {
      showStatus(`已导入 ${importedCount} 份档案`, 'success');
    }
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  } finally {
    importFileInput.value = '';
  }
}

/** 绑定全部交互事件，并在 DOM 就绪后启动页面。 */
function bindEventListeners(): void {
  apiForm.addEventListener('submit', (event) => {
    void handleSaveApiSettings(event);
  });
  testApiButton.addEventListener('click', () => {
    handleTestApiConnection();
  });
  fillModePreview.addEventListener('change', () => {
    void handleFillModeChange();
  });
  fillModeDirect.addEventListener('change', () => {
    void handleFillModeChange();
  });
  createProfileForm.addEventListener('submit', (event) => {
    void handleCreateProfile(event);
  });
  profileEditorForm.addEventListener('submit', (event) => {
    void handleSaveProfileData(event);
  });
  closeEditorButton.addEventListener('click', () => {
    closeEditor();
  });
  exportButton.addEventListener('click', () => {
    void handleExport();
  });
  importFileInput.addEventListener('change', () => {
    void handleImportFileChange();
  });

  profileEditorForm.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const addListKind = target.dataset.addList;
    if (addListKind) {
      handleAddListItem(addListKind);
    }
  });
}

bindEventListeners();
void bootstrapOptionsPage();
