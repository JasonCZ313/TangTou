/**
 * Options 页主逻辑：API / 填写模式 / 超全档案 CRUD / 导入导出。
 * 在扩展页上下文中直接调用 storage API，不经 Background。
 */
import {
  ACADEMIC_DEGREE_OPTIONS,
  AWARD_LEVEL_OPTIONS,
  COMPUTER_LEVEL_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  ETHNICITY_OPTIONS,
  FAMILY_RELATION_OPTIONS,
  FERTILITY_STATUS_OPTIONS,
  GENDER_OPTIONS,
  HEALTH_STATUS_OPTIONS,
  HUKOU_TYPE_OPTIONS,
  ID_TYPE_OPTIONS,
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
  LANGUAGE_CERT_OPTIONS,
  LANGUAGE_PROFICIENCY_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  MILITARY_STATUS_OPTIONS,
  OFFICE_SKILL_OPTIONS,
  POLITICAL_STATUS_OPTIONS,
  PUBLICATION_KIND_OPTIONS,
  STUDY_MODE_OPTIONS,
  YES_NO_OPTIONS,
  type CatalogOption,
} from '../../shared/catalogs/enums';
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
import { MAX_PROFILES } from '../../shared/storage/defaults';
import {
  normalizeProfileData,
  validateProfileData,
} from '../../shared/storage/normalize';
import type {
  AwardItem,
  CampusActivityItem,
  CertificateItem,
  EducationItem,
  ExperienceItem,
  FamilyMemberItem,
  FillMode,
  LanguageItem,
  Profile,
  ProfileData,
  ProjectItem,
  PublicationItem,
  TrainingItem,
} from '../../shared/types/profile';
import type { ExtensionMessage } from '../../shared/types/messages';
import {
  createBoundCheckbox,
  createBoundInput,
  createBoundSelect,
  createBoundTextarea,
  createListItemCard,
  fillStaticSelectsByCatalog,
} from './editorWidgets';

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

/** 静态表单 data-catalog 与枚举表映射 */
const STATIC_CATALOG_MAP: Record<string, CatalogOption[]> = {
  gender: GENDER_OPTIONS,
  ethnicity: ETHNICITY_OPTIONS,
  hukouType: HUKOU_TYPE_OPTIONS,
  idType: ID_TYPE_OPTIONS,
  political: POLITICAL_STATUS_OPTIONS,
  marital: MARITAL_STATUS_OPTIONS,
  fertility: FERTILITY_STATUS_OPTIONS,
  health: HEALTH_STATUS_OPTIONS,
  military: MILITARY_STATUS_OPTIONS,
  jobType: JOB_TYPE_OPTIONS,
  jobStatus: JOB_STATUS_OPTIONS,
  yesNo: YES_NO_OPTIONS,
  computer: COMPUTER_LEVEL_OPTIONS,
  office: OFFICE_SKILL_OPTIONS,
};

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
const createProfileButton = document.getElementById(
  'createProfileButton',
) as HTMLButtonElement;
const profileLimitTip = document.getElementById(
  'profileLimitTip',
) as HTMLParagraphElement;
const editorSection = document.getElementById('editorSection') as HTMLElement;
const editingProfileName = document.getElementById(
  'editingProfileName',
) as HTMLParagraphElement;
const profileEditorForm = document.getElementById(
  'profileEditorForm',
) as HTMLFormElement;
const editorValidationHint = document.getElementById(
  'editorValidationHint',
) as HTMLParagraphElement;
const educationListElement = document.getElementById(
  'educationList',
) as HTMLDivElement;
const experienceListElement = document.getElementById(
  'experienceList',
) as HTMLDivElement;
const projectsListElement = document.getElementById(
  'projectsList',
) as HTMLDivElement;
const campusListElement = document.getElementById(
  'campusList',
) as HTMLDivElement;
const languageListElement = document.getElementById(
  'languageList',
) as HTMLDivElement;
const certificateListElement = document.getElementById(
  'certificateList',
) as HTMLDivElement;
const awardListElement = document.getElementById(
  'awardList',
) as HTMLDivElement;
const publicationListElement = document.getElementById(
  'publicationList',
) as HTMLDivElement;
const trainingListElement = document.getElementById(
  'trainingList',
) as HTMLDivElement;
const familyListElement = document.getElementById(
  'familyList',
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
  if (message === 'PROFILE_VALIDATION_FAILED') {
    return '档案必填项未完成，请检查编辑区提示';
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
 * 页面加载：读取 settings + profiles，填充枚举下拉并渲染全部区域。
 */
async function bootstrapOptionsPage(): Promise<void> {
  try {
    fillStaticSelectsByCatalog(profileEditorForm, STATIC_CATALOG_MAP);

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
 * 按当前档案数量启用/禁用新建相关控件，并切换满员中文提示。
 */
function syncCreateControlsWithLimit(): void {
  const isAtProfileLimit = cachedProfiles.length >= MAX_PROFILES;
  createProfileButton.disabled = isAtProfileLimit;
  newProfileNameInput.disabled = isAtProfileLimit;
  cloneSourceSelect.disabled = isAtProfileLimit;
  profileLimitTip.classList.toggle('hidden', !isAtProfileLimit);
}

/**
 * 刷新档案列表卡片（名称、更新时间、操作按钮）。
 */
function renderProfileList(): void {
  profileListElement.replaceChildren();
  profileCountHint.textContent = `已保存 ${cachedProfiles.length} / ${MAX_PROFILES} 份`;
  emptyProfilesHint.classList.toggle('hidden', cachedProfiles.length > 0);
  syncCreateControlsWithLimit();

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
 */
function handleTestApiConnection(): void {
  const requestId = createRequestId();
  const message: ExtensionMessage = { type: 'TEST_API', requestId };

  try {
    chrome.runtime.sendMessage(
      message,
      (response: ExtensionMessage | undefined) => {
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
      },
    );
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
  editorValidationHint.textContent = '';
  editorSection.classList.add('hidden');
}

/**
 * 将 ProfileData 填入静态字段（input/select/textarea）与全部动态列表。
 */
function fillEditorForm(data: ProfileData): void {
  const pathFields = profileEditorForm.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('[data-path]');
  for (const fieldElement of pathFields) {
    const pathText = fieldElement.dataset.path ?? '';
    fieldElement.value = readPathValue(data, pathText);
  }

  skillsTextarea.value = data.skills.join('\n');
  notesTextarea.value = data.notes;
  renderAllDynamicLists(data);
  updateValidationHint(data);
}

/**
 * 刷新编辑区全部动态列表（教育/经历/项目等）。
 */
function renderAllDynamicLists(data: ProfileData): void {
  renderEducationRows(data.education);
  renderExperienceRows(data.experience);
  renderProjectRows(data.projects);
  renderCampusRows(data.campusActivities);
  renderLanguageRows(data.languages);
  renderCertificateRows(data.certificates);
  renderAwardRows(data.awards);
  renderPublicationRows(data.publications);
  renderTrainingRows(data.trainings);
  renderFamilyRows(data.familyMembers);
}

/**
 * 按点分路径读取嵌套字符串字段（如 basic.fullName、computerLevel）。
 */
function readPathValue(data: ProfileData, pathText: string): string {
  if (!pathText) {
    return '';
  }
  const pathParts = pathText.split('.');
  let current: unknown = data;
  for (const pathPart of pathParts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return '';
    }
    current = (current as Record<string, unknown>)[pathPart];
  }
  return typeof current === 'string' ? current : '';
}

/**
 * 按点分路径写入嵌套字符串字段；支持顶层字段（如 computerLevel）。
 */
function writePathValue(
  data: ProfileData,
  pathText: string,
  value: string,
): void {
  const pathParts = pathText.split('.').filter((part) => part.length > 0);
  if (pathParts.length === 0) {
    return;
  }

  if (pathParts.length === 1) {
    (data as unknown as Record<string, unknown>)[pathParts[0]] = value;
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
 * 在卡片内创建网格容器，便于动态字段排版。
 */
function createCardGrid(): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  return grid;
}

/**
 * 渲染教育经历动态行（含学历枚举、在读/最高学历勾选）。
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
      updateValidationHint(draftProfileData);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput(
        '学校',
        item.school,
        (value) => {
          item.school = value;
        },
        'text',
        true,
      ),
      createBoundSelect(
        '学历层次',
        item.degreeLevel || item.degree || '',
        DEGREE_LEVEL_OPTIONS,
        (value) => {
          item.degreeLevel = value;
          item.degree = value;
        },
        true,
      ),
      createBoundInput('专业', item.major, (value) => {
        item.major = value;
      }),
      createBoundInput(
        '入学日期',
        item.startDate,
        (value) => {
          item.startDate = value;
        },
        'date',
        true,
      ),
      createBoundInput(
        '毕业日期',
        item.endDate,
        (value) => {
          item.endDate = value;
        },
        'date',
      ),
      createBoundCheckbox('在读', Boolean(item.isCurrent), (checked) => {
        item.isCurrent = checked;
      }),
      createBoundCheckbox('最高学历', Boolean(item.isHighest), (checked) => {
        item.isHighest = checked;
      }),
      createBoundCheckbox('第一学历', Boolean(item.isFirstDegree), (checked) => {
        item.isFirstDegree = checked;
      }),
      createBoundSelect(
        '学习形式',
        item.studyMode ?? '',
        STUDY_MODE_OPTIONS,
        (value) => {
          item.studyMode = value;
        },
      ),
      createBoundSelect(
        '学位',
        item.academicDegree ?? '',
        ACADEMIC_DEGREE_OPTIONS,
        (value) => {
          item.academicDegree = value;
        },
      ),
      createBoundInput('学院', item.college ?? '', (value) => {
        item.college = value;
      }),
      createBoundInput('学制(年)', item.durationYears ?? '', (value) => {
        item.durationYears = value;
      }),
      createBoundInput('就读城市', item.city ?? '', (value) => {
        item.city = value;
      }),
      createBoundInput('GPA', item.gpa ?? '', (value) => {
        item.gpa = value;
      }),
      createBoundInput('排名', item.rank ?? '', (value) => {
        item.rank = value;
      }),
      createBoundInput('教育类型备注', item.educationType ?? '', (value) => {
        item.educationType = value;
      }),
      createBoundTextarea('主修课程', item.courses ?? '', (value) => {
        item.courses = value;
      }),
      createBoundTextarea('论文/课题', item.thesis ?? '', (value) => {
        item.thesis = value;
      }),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
    );
    card.appendChild(grid);
    educationListElement.appendChild(card);
  });
}

/**
 * 渲染实习/工作经历动态行。
 */
function renderExperienceRows(items: ExperienceItem[]): void {
  experienceListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`工作/实习 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.experience.splice(itemIndex, 1);
      renderExperienceRows(draftProfileData.experience);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('公司/单位', item.company, (value) => {
        item.company = value;
      }),
      createBoundInput('职位', item.title, (value) => {
        item.title = value;
      }),
      createBoundInput(
        '开始日期',
        item.startDate,
        (value) => {
          item.startDate = value;
        },
        'date',
      ),
      createBoundInput(
        '结束日期',
        item.endDate,
        (value) => {
          item.endDate = value;
        },
        'date',
      ),
      createBoundCheckbox('至今在职', Boolean(item.isCurrent), (checked) => {
        item.isCurrent = checked;
      }),
      createBoundSelect(
        '雇佣类型',
        item.employmentType ?? '',
        EMPLOYMENT_TYPE_OPTIONS,
        (value) => {
          item.employmentType = value;
        },
      ),
      createBoundInput('部门', item.department ?? '', (value) => {
        item.department = value;
      }),
      createBoundInput('城市', item.city ?? '', (value) => {
        item.city = value;
      }),
      createBoundInput('公司性质', item.companyType ?? '', (value) => {
        item.companyType = value;
      }),
      createBoundInput('行业', item.industry ?? '', (value) => {
        item.industry = value;
      }),
      createBoundInput('下属人数', item.subordinateCount ?? '', (value) => {
        item.subordinateCount = value;
      }),
      createBoundInput('证明人', item.refereeName ?? '', (value) => {
        item.refereeName = value;
      }),
      createBoundInput(
        '证明人电话',
        item.refereePhone ?? '',
        (value) => {
          item.refereePhone = value;
        },
        'tel',
      ),
      createBoundInput('离职原因', item.leaveReason ?? '', (value) => {
        item.leaveReason = value;
      }),
      createBoundTextarea('职责描述', item.description, (value) => {
        item.description = value;
      }),
    );
    card.appendChild(grid);
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

    const grid = createCardGrid();
    grid.append(
      createBoundInput('项目名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('角色', item.role ?? '', (value) => {
        item.role = value;
      }),
      createBoundInput(
        '开始日期',
        item.startDate ?? '',
        (value) => {
          item.startDate = value;
        },
        'date',
      ),
      createBoundInput(
        '结束日期',
        item.endDate ?? '',
        (value) => {
          item.endDate = value;
        },
        'date',
      ),
      createBoundCheckbox('进行中', Boolean(item.isCurrent), (checked) => {
        item.isCurrent = checked;
      }),
      createBoundInput(
        '链接',
        item.link ?? '',
        (value) => {
          item.link = value;
        },
        'url',
      ),
      createBoundInput('技术栈', item.techStack ?? '', (value) => {
        item.techStack = value;
      }),
      createBoundInput('团队规模', item.teamSize ?? '', (value) => {
        item.teamSize = value;
      }),
      createBoundTextarea('项目描述', item.description, (value) => {
        item.description = value;
      }),
    );
    card.appendChild(grid);
    projectsListElement.appendChild(card);
  });
}

/**
 * 渲染校园/社团/志愿动态行。
 */
function renderCampusRows(items: CampusActivityItem[]): void {
  campusListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`校园经历 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.campusActivities.splice(itemIndex, 1);
      renderCampusRows(draftProfileData.campusActivities);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('组织/社团', item.organization, (value) => {
        item.organization = value;
      }),
      createBoundInput('职务', item.role, (value) => {
        item.role = value;
      }),
      createBoundInput(
        '开始日期',
        item.startDate ?? '',
        (value) => {
          item.startDate = value;
        },
        'date',
      ),
      createBoundInput(
        '结束日期',
        item.endDate ?? '',
        (value) => {
          item.endDate = value;
        },
        'date',
      ),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
    );
    card.appendChild(grid);
    campusListElement.appendChild(card);
  });
}

/**
 * 渲染语言能力动态行。
 */
function renderLanguageRows(items: LanguageItem[]): void {
  languageListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`语言 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.languages.splice(itemIndex, 1);
      renderLanguageRows(draftProfileData.languages);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('语种', item.language, (value) => {
        item.language = value;
      }),
      createBoundSelect(
        '熟练度',
        item.proficiency,
        LANGUAGE_PROFICIENCY_OPTIONS,
        (value) => {
          item.proficiency = value;
        },
      ),
      createBoundSelect(
        '证书',
        item.certificate ?? '',
        LANGUAGE_CERT_OPTIONS,
        (value) => {
          item.certificate = value;
        },
      ),
      createBoundInput('成绩', item.score ?? '', (value) => {
        item.score = value;
      }),
      createBoundInput(
        '获证日期',
        item.obtainedDate ?? '',
        (value) => {
          item.obtainedDate = value;
        },
        'date',
      ),
    );
    card.appendChild(grid);
    languageListElement.appendChild(card);
  });
}

/**
 * 渲染证书动态行。
 */
function renderCertificateRows(items: CertificateItem[]): void {
  certificateListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`证书 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.certificates.splice(itemIndex, 1);
      renderCertificateRows(draftProfileData.certificates);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('证书名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('等级', item.level ?? '', (value) => {
        item.level = value;
      }),
      createBoundInput('颁发机构', item.issuer ?? '', (value) => {
        item.issuer = value;
      }),
      createBoundInput(
        '获证日期',
        item.date ?? '',
        (value) => {
          item.date = value;
        },
        'date',
      ),
      createBoundInput('证书编号', item.number ?? '', (value) => {
        item.number = value;
      }),
      createBoundInput('相关专业', item.major ?? '', (value) => {
        item.major = value;
      }),
    );
    card.appendChild(grid);
    certificateListElement.appendChild(card);
  });
}

/**
 * 渲染奖项动态行。
 */
function renderAwardRows(items: AwardItem[]): void {
  awardListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`奖项 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.awards.splice(itemIndex, 1);
      renderAwardRows(draftProfileData.awards);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('奖项名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundSelect(
        '级别',
        item.level ?? '',
        AWARD_LEVEL_OPTIONS,
        (value) => {
          item.level = value;
        },
      ),
      createBoundInput(
        '获奖日期',
        item.date ?? '',
        (value) => {
          item.date = value;
        },
        'date',
      ),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
    );
    card.appendChild(grid);
    awardListElement.appendChild(card);
  });
}

/**
 * 渲染论文/专利/著作动态行。
 */
function renderPublicationRows(items: PublicationItem[]): void {
  publicationListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`成果 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.publications.splice(itemIndex, 1);
      renderPublicationRows(draftProfileData.publications);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundSelect(
        '类型',
        item.kind,
        PUBLICATION_KIND_OPTIONS,
        (value) => {
          item.kind = value;
        },
      ),
      createBoundInput('标题', item.title, (value) => {
        item.title = value;
      }),
      createBoundInput('期刊/专利号', item.venueOrNumber ?? '', (value) => {
        item.venueOrNumber = value;
      }),
      createBoundInput(
        '日期',
        item.date ?? '',
        (value) => {
          item.date = value;
        },
        'date',
      ),
      createBoundInput('作者排序', item.authorOrder ?? '', (value) => {
        item.authorOrder = value;
      }),
      createBoundInput(
        '链接',
        item.link ?? '',
        (value) => {
          item.link = value;
        },
        'url',
      ),
    );
    card.appendChild(grid);
    publicationListElement.appendChild(card);
  });
}

/**
 * 渲染培训经历动态行。
 */
function renderTrainingRows(items: TrainingItem[]): void {
  trainingListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`培训 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.trainings.splice(itemIndex, 1);
      renderTrainingRows(draftProfileData.trainings);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundInput('培训机构', item.organization, (value) => {
        item.organization = value;
      }),
      createBoundInput('课程', item.course, (value) => {
        item.course = value;
      }),
      createBoundInput(
        '开始日期',
        item.startDate ?? '',
        (value) => {
          item.startDate = value;
        },
        'date',
      ),
      createBoundInput(
        '结束日期',
        item.endDate ?? '',
        (value) => {
          item.endDate = value;
        },
        'date',
      ),
      createBoundInput('结业证书', item.certificate ?? '', (value) => {
        item.certificate = value;
      }),
    );
    card.appendChild(grid);
    trainingListElement.appendChild(card);
  });
}

/**
 * 渲染家庭成员动态行。
 */
function renderFamilyRows(items: FamilyMemberItem[]): void {
  familyListElement.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`家庭成员 ${itemIndex + 1}`, () => {
      if (!draftProfileData) {
        return;
      }
      draftProfileData.familyMembers.splice(itemIndex, 1);
      renderFamilyRows(draftProfileData.familyMembers);
    });

    const grid = createCardGrid();
    grid.append(
      createBoundSelect(
        '关系',
        item.relationship,
        FAMILY_RELATION_OPTIONS,
        (value) => {
          item.relationship = value;
        },
      ),
      createBoundInput('姓名', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('年龄', item.age ?? '', (value) => {
        item.age = value;
      }),
      createBoundSelect(
        '政治面貌',
        item.politicalStatus ?? '',
        POLITICAL_STATUS_OPTIONS,
        (value) => {
          item.politicalStatus = value;
        },
      ),
      createBoundInput('工作单位', item.employer ?? '', (value) => {
        item.employer = value;
      }),
      createBoundInput('职务', item.title ?? '', (value) => {
        item.title = value;
      }),
      createBoundInput(
        '电话',
        item.phone ?? '',
        (value) => {
          item.phone = value;
        },
        'tel',
      ),
    );
    card.appendChild(grid);
    familyListElement.appendChild(card);
  });
}

/**
 * 创建空白教育经历条目。
 */
function createEmptyEducationItem(): EducationItem {
  return {
    school: '',
    degreeLevel: '',
    major: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    isHighest: false,
    isFirstDegree: false,
    description: '',
  };
}

/**
 * 创建空白工作/实习条目。
 */
function createEmptyExperienceItem(): ExperienceItem {
  return {
    company: '',
    title: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    description: '',
  };
}

/**
 * 创建空白项目条目。
 */
function createEmptyProjectItem(): ProjectItem {
  return {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    description: '',
    link: '',
  };
}

/**
 * 向草稿追加一条对应类型的空白列表项。
 */
function handleAddListItem(listKind: string): void {
  if (!draftProfileData) {
    return;
  }

  switch (listKind) {
    case 'education':
      draftProfileData.education.push(createEmptyEducationItem());
      renderEducationRows(draftProfileData.education);
      break;
    case 'experience':
      draftProfileData.experience.push(createEmptyExperienceItem());
      renderExperienceRows(draftProfileData.experience);
      break;
    case 'projects':
      draftProfileData.projects.push(createEmptyProjectItem());
      renderProjectRows(draftProfileData.projects);
      break;
    case 'campus':
      draftProfileData.campusActivities.push({
        organization: '',
        role: '',
        startDate: '',
        endDate: '',
        description: '',
      });
      renderCampusRows(draftProfileData.campusActivities);
      break;
    case 'language':
      draftProfileData.languages.push({
        language: '',
        proficiency: '',
        certificate: '',
        score: '',
        obtainedDate: '',
      });
      renderLanguageRows(draftProfileData.languages);
      break;
    case 'certificate':
      draftProfileData.certificates.push({
        name: '',
        level: '',
        issuer: '',
        date: '',
        number: '',
        major: '',
      });
      renderCertificateRows(draftProfileData.certificates);
      break;
    case 'award':
      draftProfileData.awards.push({
        name: '',
        level: '',
        date: '',
        description: '',
      });
      renderAwardRows(draftProfileData.awards);
      break;
    case 'publication':
      draftProfileData.publications.push({
        kind: '',
        title: '',
        venueOrNumber: '',
        date: '',
        authorOrder: '',
        link: '',
      });
      renderPublicationRows(draftProfileData.publications);
      break;
    case 'training':
      draftProfileData.trainings.push({
        organization: '',
        course: '',
        startDate: '',
        endDate: '',
        certificate: '',
      });
      renderTrainingRows(draftProfileData.trainings);
      break;
    case 'family':
      draftProfileData.familyMembers.push({
        relationship: '',
        name: '',
        age: '',
        politicalStatus: '',
        employer: '',
        title: '',
        phone: '',
      });
      renderFamilyRows(draftProfileData.familyMembers);
      break;
    default:
      break;
  }

  updateValidationHint(draftProfileData);
}

/**
 * 从静态表单收集 path 字段到草稿（不含动态列表，列表已直接改对象）。
 */
function collectStaticFieldsIntoDraft(data: ProfileData): void {
  const pathFields = profileEditorForm.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('[data-path]');
  for (const fieldElement of pathFields) {
    const pathText = fieldElement.dataset.path ?? '';
    writePathValue(data, pathText, fieldElement.value.trim());
  }

  data.skills = skillsTextarea.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  data.notes = notesTextarea.value;
}

/**
 * 根据校验结果更新编辑区顶部提示文案。
 */
function updateValidationHint(data: ProfileData): void {
  const result = validateProfileData(data);
  const hintParts: string[] = [];
  if (!result.ok) {
    hintParts.push(`硬必填未完成：${result.missingRequired.join('；')}`);
  }
  if (result.softWarnings.length > 0) {
    hintParts.push(`建议补全：${result.softWarnings.join('；')}`);
  }
  editorValidationHint.textContent = hintParts.join(' —— ');
}

/**
 * 从编辑表单收集草稿，校验硬必填后调用 updateProfileData 持久化。
 */
async function handleSaveProfileData(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!editingProfileId || !draftProfileData) {
    showStatus('当前没有正在编辑的档案', 'error');
    return;
  }

  collectStaticFieldsIntoDraft(draftProfileData);
  updateValidationHint(draftProfileData);

  const validation = validateProfileData(draftProfileData);
  if (!validation.ok) {
    showStatus(
      `无法保存：${validation.missingRequired.join('；')}`,
      'error',
    );
    return;
  }

  try {
    const updated = await updateProfileData(
      editingProfileId,
      draftProfileData,
    );
    await refreshProfilesFromStorage();
    editingProfileName.textContent = `正在编辑：${updated.name}`;
    draftProfileData = structuredClone(updated.data);
    fillEditorForm(draftProfileData);
    const softText =
      validation.softWarnings.length > 0
        ? `（建议：${validation.softWarnings.join('；')}）`
        : '';
    showStatus(`档案内容已保存${softText}`, 'success');
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
 * 生成新档案 id（导入批次在内存组装时使用）。
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
 * 将导入的残缺 data 规范化为超全 ProfileData。
 */
function normalizeImportedProfileData(rawData: unknown): ProfileData {
  return normalizeProfileData(rawData);
}

/**
 * 导入 JSON：先校验并在内存组装全部待写入档案，再一次性原子追加。
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
