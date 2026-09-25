/**
 * Options 页主逻辑：API / 填写模式 / 超全档案 CRUD / 导入导出 / 侧栏目录。
 */
import {
  COMPUTER_LEVEL_OPTIONS,
  DRIVER_LICENSE_OPTIONS,
  ETHNICITY_OPTIONS,
  FERTILITY_STATUS_OPTIONS,
  GENDER_OPTIONS,
  HEALTH_STATUS_OPTIONS,
  HUKOU_TYPE_OPTIONS,
  ID_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
  MANDARIN_LEVEL_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  MILITARY_STATUS_OPTIONS,
  NATIONALITY_OPTIONS,
  OFFICE_SKILL_OPTIONS,
  POLITICAL_STATUS_OPTIONS,
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
import {
  formatTokenUsageBrief,
  getTokenUsageStats,
  resetTokenUsageStats,
} from '../../shared/storage/usageStore';
import type { FillMode, Profile, ProfileData, RegionSelection } from '../../shared/types/profile';
import type { TokenUsageStats } from '../../shared/types/usage';
import type { ExtensionMessage } from '../../shared/types/messages';
import { describeUserFacingError } from '../../shared/messaging/userFacingError';
import { mountFeedbackPanel } from '../../shared/feedback/feedbackMail';
import { mountAppVersionLabel } from '../../shared/appVersion';
import { mountEssayPolishControls } from './polishControl';
import { jumpToEditorTarget, mountEditorSearch } from './editorSearch';
import { fillStaticSelectsByCatalog } from './editorWidgets';
import { appendListItem, renderAllDynamicLists } from './editorLists';
import {
  assertAvatarUploaded,
  mountAvatarBlock,
  mountResumeBlock,
} from './attachmentPanel';
import {
  deleteAttachmentsForProfile,
  profileHasAvatar,
} from '../../shared/storage/attachmentStore';
import { clearResumeRecognition } from '../../shared/storage/resumeRecognitionStore';
import { upgradeStaticCatalogSelects } from './searchableSelect';
import {
  syncRegionBoundDisplays,
  upgradeStaticRegionFields,
  type RegionFieldBinding,
} from './regionCascader';

/** 状态提示的视觉类型 */
type StatusKind = 'info' | 'success' | 'error';

/** 导出文件的 JSON 结构 */
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

/** 侧栏目录项：锚点 id → 显示名 */
const TOC_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'section-resume', label: '简历识别' },
  { id: 'section-basic', label: '基本信息' },
  { id: 'section-jobIntent', label: '求职意向' },
  { id: 'section-education', label: '教育经历' },
  { id: 'section-experience', label: '实习工作' },
  { id: 'section-projects', label: '项目经历' },
  { id: 'section-campus', label: '校园社团' },
  { id: 'section-skills', label: '技能计算机' },
  { id: 'section-language', label: '语言能力' },
  { id: 'section-certificate', label: '证书' },
  { id: 'section-award', label: '奖项' },
  { id: 'section-publication', label: '论文专利' },
  { id: 'section-training', label: '培训' },
  { id: 'section-family', label: '家庭成员' },
  { id: 'section-emergency', label: '紧急联系人' },
  { id: 'section-specialOrg', label: '体制银行' },
  { id: 'section-workAuth', label: '外企工签' },
  { id: 'section-industry', label: '行业补充' },
  { id: 'section-essays', label: '问答素材' },
  { id: 'section-notes', label: '自由补充' },
];

/** 静态表单 data-catalog 映射 */
const STATIC_CATALOG_MAP: Record<string, CatalogOption[]> = {
  gender: GENDER_OPTIONS,
  ethnicity: ETHNICITY_OPTIONS,
  nationality: NATIONALITY_OPTIONS,
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
  industry: INDUSTRY_OPTIONS,
  mandarin: MANDARIN_LEVEL_OPTIONS,
  driver: DRIVER_LICENSE_OPTIONS,
};

/** 静态地区字段：字符串 path ↔ 结构化 path */
const REGION_FIELD_BINDINGS: Record<string, RegionFieldBinding> = {
  currentCity: {
    textPath: 'basic.currentCity',
    regionPath: 'basic.currentCityRegion',
    required: true,
  },
  nativePlace: {
    textPath: 'basic.nativePlace',
    regionPath: 'basic.nativePlaceRegion',
    required: true,
  },
  birthPlace: {
    textPath: 'basic.birthPlace',
    regionPath: 'basic.birthPlaceRegion',
  },
  hukouLocation: {
    textPath: 'basic.hukouLocation',
    regionPath: 'basic.hukouLocationRegion',
  },
  workCity: {
    textPath: 'jobIntent.workCity',
    regionPath: 'jobIntent.workCityRegion',
  },
  expectedCities: {
    textPath: 'jobIntent.expectedCities',
    regionPath: 'jobIntent.expectedCitiesRegions',
    multiAppend: true,
  },
};

let cachedProfiles: Profile[] = [];
let editingProfileId: string | null = null;
let draftProfileData: ProfileData | null = null;
let activeProfileId: string | null = null;
/** 静态 select 是否已升级为可搜索下拉（只执行一次） */
let staticCatalogsUpgraded = false;
/** 静态地区控件是否已升级为 Cascader（只执行一次） */
let staticRegionsUpgraded = false;
let tocObserver: IntersectionObserver | null = null;

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
const tokenUsageSummary = document.getElementById(
  'tokenUsageSummary',
) as HTMLParagraphElement;
const resetTokenUsageButton = document.getElementById(
  'resetTokenUsageButton',
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
const editorTocList = document.getElementById(
  'editorTocList',
) as HTMLUListElement;
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
const skillsListElement = document.getElementById(
  'skillsList',
) as HTMLDivElement;
const languageListElement = document.getElementById(
  'languageList',
) as HTMLDivElement;
const certificateListElement = document.getElementById(
  'certificateList',
) as HTMLDivElement;
const awardListElement = document.getElementById('awardList') as HTMLDivElement;
const publicationListElement = document.getElementById(
  'publicationList',
) as HTMLDivElement;
const trainingListElement = document.getElementById(
  'trainingList',
) as HTMLDivElement;
const familyListElement = document.getElementById(
  'familyList',
) as HTMLDivElement;
const emergencyListElement = document.getElementById(
  'emergencyList',
) as HTMLDivElement;
const notesTextarea = document.getElementById(
  'notesTextarea',
) as HTMLTextAreaElement;
const closeEditorButton = document.getElementById(
  'closeEditorButton',
) as HTMLButtonElement;
const saveProgressButton = document.getElementById(
  'saveProgressButton',
) as HTMLButtonElement;
const saveAndCloseButton = document.getElementById(
  'saveAndCloseButton',
) as HTMLButtonElement;
const stickySaveStatus = document.getElementById(
  'stickySaveStatus',
) as HTMLSpanElement;
const exportButton = document.getElementById(
  'exportButton',
) as HTMLButtonElement;
const importFileInput = document.getElementById(
  'importFileInput',
) as HTMLInputElement;

function showStatus(message: string, kind: StatusKind = 'info'): void {
  statusMessageElement.textContent = message;
  statusMessageElement.classList.remove('is-success', 'is-error', 'is-info');
  statusMessageElement.classList.add(`is-${kind}`);
}

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
  return describeUserFacingError(message || '操作失败');
}

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

function createRequestId(): string {
  return crypto.randomUUID();
}

/**
 * 构建侧栏目录，点击滚到分区垂直居中。
 */
function setupEditorToc(): void {
  editorTocList.replaceChildren();
  for (const section of TOC_SECTIONS) {
    const listItem = document.createElement('li');
    const linkButton = document.createElement('button');
    linkButton.type = 'button';
    linkButton.className = 'editor-toc-link';
    linkButton.dataset.sectionId = section.id;
    linkButton.textContent = section.label;
    linkButton.addEventListener('click', () => {
      const target = document.getElementById(section.id);
      if (!target) {
        return;
      }
      // 展开折叠分区后再滚动
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
      }
      jumpToEditorTarget(target);
      setActiveTocLink(section.id);
    });
    listItem.appendChild(linkButton);
    editorTocList.appendChild(listItem);
  }

  if (tocObserver) {
    tocObserver.disconnect();
  }
  tocObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio);
      if (visible[0]?.target?.id) {
        setActiveTocLink(visible[0].target.id);
      }
    },
    { root: null, rootMargin: '-35% 0px -45% 0px', threshold: [0.1, 0.4, 0.7] },
  );
  for (const section of TOC_SECTIONS) {
    const element = document.getElementById(section.id);
    if (element) {
      tocObserver.observe(element);
    }
  }
}

/**
 * 高亮当前目录项。
 */
function setActiveTocLink(sectionId: string): void {
  const links = editorTocList.querySelectorAll<HTMLButtonElement>(
    '.editor-toc-link',
  );
  for (const link of links) {
    link.classList.toggle('is-active', link.dataset.sectionId === sectionId);
  }
}

/**
 * 确保静态枚举已填充并升级为可搜索下拉；地区字段升级为 Cascader。
 */
function ensureStaticCatalogsReady(): void {
  fillStaticSelectsByCatalog(profileEditorForm, STATIC_CATALOG_MAP);
  if (!staticCatalogsUpgraded) {
    upgradeStaticCatalogSelects(
      profileEditorForm,
      STATIC_CATALOG_MAP,
      (pathText, value) => {
        if (!draftProfileData) {
          return;
        }
        writePathValue(draftProfileData, pathText, value);
      },
    );
    staticCatalogsUpgraded = true;
  }
  if (!staticRegionsUpgraded) {
    upgradeStaticRegionFields(
      profileEditorForm,
      REGION_FIELD_BINDINGS,
      (binding, selection, displayText) => {
        if (!draftProfileData) {
          return;
        }
        applyRegionCommit(draftProfileData, binding, selection, displayText);
        updateValidationHint(draftProfileData);
      },
      (binding) => readRegionInitialFromDraft(binding),
    );
    staticRegionsUpgraded = true;
  }
}

/**
 * 从草稿读取某地区字段的初始文案与结构化值。
 */
function readRegionInitialFromDraft(
  binding: RegionFieldBinding,
): { text: string; region: RegionSelection | null } {
  if (!draftProfileData) {
    return { text: '', region: null };
  }
  const text = readPathValue(draftProfileData, binding.textPath);
  const regionRaw = readPathObject(draftProfileData, binding.regionPath);
  if (binding.multiAppend) {
    // 多选：展示用字符串；结构化为数组，控件自身不回填单次 selection
    return { text, region: null };
  }
  if (regionRaw && typeof regionRaw === 'object' && !Array.isArray(regionRaw)) {
    const region = regionRaw as RegionSelection;
    if (region.text?.trim()) {
      return { text: region.text, region };
    }
  }
  return { text, region: null };
}

/**
 * 将 Cascader 提交结果写入草稿（字符串 + 结构化）。
 */
function applyRegionCommit(
  data: ProfileData,
  binding: RegionFieldBinding,
  selection: RegionSelection | null,
  displayText: string,
): void {
  writePathValue(data, binding.textPath, displayText);
  if (binding.multiAppend) {
    const listPath = binding.regionPath;
    if (!selection) {
      writePathObject(data, listPath, []);
      return;
    }
    const existing = readPathObject(data, listPath);
    const list: RegionSelection[] = Array.isArray(existing)
      ? [...(existing as RegionSelection[])]
      : [];
    list.push(selection);
    writePathObject(data, listPath, list);
    return;
  }
  writePathObject(data, binding.regionPath, selection);
}

/**
 * 把 Token 统计渲染到 API 区用量面板。
 */
function renderTokenUsageSummary(stats: TokenUsageStats): void {
  if (stats.callCount === 0) {
    tokenUsageSummary.textContent =
      '尚无 LLM 填写调用记录。扫描并生成填写计划且走模型时，会按接口返回的 usage 累加（部分兼容接口可能不返回用量）。';
    return;
  }
  const lastText = stats.lastCall
    ? `上次 ${formatTokenUsageBrief(stats.lastCall)}${
        stats.lastCallAt
          ? `（${new Date(stats.lastCallAt).toLocaleString('zh-CN')}）`
          : ''
      }`
    : '上次无明细';
  tokenUsageSummary.textContent = [
    `累计调用 ${stats.callCount} 次`,
    `合计 Token ${stats.totalTokens}（提示 ${stats.totalPromptTokens} · 补全 ${stats.totalCompletionTokens}）`,
    lastText,
  ].join(' · ');
}

async function bootstrapOptionsPage(): Promise<void> {
  mountFeedbackPanel();
  mountAppVersionLabel();
  mountEssayPolishControls(document);
  try {
    ensureStaticCatalogsReady();
    setupEditorToc();
    mountEditorSearch(profileEditorForm);
    bindRequiredMissingClear();

    const [settings, profiles, tokenUsage] = await Promise.all([
      getSettings(),
      listProfiles(),
      getTokenUsageStats(),
    ]);
    cachedProfiles = profiles;
    activeProfileId = settings.activeProfileId;

    apiBaseUrlInput.value = settings.apiBaseUrl;
    apiKeyInput.value = settings.apiKey;
    modelInput.value = settings.model;
    fillModePreview.checked = settings.fillMode === 'preview';
    fillModeDirect.checked = settings.fillMode === 'direct';
    renderTokenUsageSummary(tokenUsage);

    renderProfileList();
    renderCloneSourceOptions();
    showStatus('已加载设置与档案', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

function syncCreateControlsWithLimit(): void {
  const isAtProfileLimit = cachedProfiles.length >= MAX_PROFILES;
  createProfileButton.disabled = isAtProfileLimit;
  newProfileNameInput.disabled = isAtProfileLimit;
  cloneSourceSelect.disabled = isAtProfileLimit;
  profileLimitTip.classList.toggle('hidden', !isAtProfileLimit);
}

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

function handleTestApiConnection(): void {
  const requestId = createRequestId();
  const message: ExtensionMessage = { type: 'TEST_API', requestId };

  try {
    chrome.runtime.sendMessage(
      message,
      (response: ExtensionMessage | undefined) => {
        if (chrome.runtime.lastError || !response) {
          showStatus('后台未就绪', 'error');
          return;
        }
        if (response.type === 'TEST_API_RESULT') {
          showStatus(
            response.detail || (response.ok ? '连接成功' : '连接失败'),
            response.ok ? 'success' : 'error',
          );
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

async function handleCreateProfile(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const name = newProfileNameInput.value.trim();
  const cloneFromId = cloneSourceSelect.value || undefined;

  try {
    const created = await createProfile({ name, cloneFromId });
    newProfileNameInput.value = '';
    cloneSourceSelect.value = '';
    await refreshProfilesFromStorage();
    showStatus(`已创建档案「${created.name}」`, 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

async function handleSetActive(profileId: string): Promise<void> {
  try {
    await setActiveProfileId(profileId);
    await refreshProfilesFromStorage();
    showStatus('已设为默认档案', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

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

async function handleDelete(profile: Profile): Promise<void> {
  const confirmed = window.confirm(
    `确定删除档案「${profile.name}」？此操作不可恢复。`,
  );
  if (!confirmed) {
    return;
  }
  try {
    await deleteProfile(profile.id);
    await deleteAttachmentsForProfile(profile.id);
    await clearResumeRecognition(profile.id);
    if (editingProfileId === profile.id) {
      closeEditor();
    }
    await refreshProfilesFromStorage();
    showStatus(`已删除「${profile.name}」`, 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

function openEditor(profile: Profile): void {
  editingProfileId = profile.id;
  draftProfileData = structuredClone(profile.data);
  editingProfileName.textContent = `正在编辑：${profile.name}`;
  editorSection.classList.remove('hidden');
  ensureStaticCatalogsReady();
  fillEditorForm(draftProfileData);
  remountDistributedAttachments(profile.id);
  void refreshAvatarHint(profile.id);
  clearRequiredAlerts();
  stickySaveStatus.textContent = '';
  editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 挂载分散附件：简历置顶、头像进基本信息；列表条目附件由 render 时挂。
 */
function remountDistributedAttachments(profileId: string): void {
  const resumeHost = document.getElementById('resumeAttachmentHost');
  if (resumeHost) {
    mountResumeBlock({
      host: resumeHost,
      profileId,
      readDraft: () => draftProfileData,
      applyDraft: (nextDraft) => {
        draftProfileData = nextDraft;
        fillEditorForm(nextDraft);
        updateValidationHint(nextDraft);
        remountDistributedAttachments(profileId);
      },
      notify: (message, kind) => showStatus(message, kind),
    });
  }
  const avatarHost = document.getElementById('avatarAttachmentHost');
  if (avatarHost) {
    mountAvatarBlock({
      host: avatarHost,
      profileId,
      notify: (message, kind) => showStatus(message, kind),
      onChanged: () => {
        void refreshAvatarHint(profileId);
      },
    });
  }
}

function closeEditor(): void {
  editingProfileId = null;
  draftProfileData = null;
  editorValidationHint.textContent = '';
  editorSection.classList.add('hidden');
}

/**
 * 刷新动态列表的统一回调。
 */
function refreshDynamicLists(): void {
  if (!draftProfileData) {
    return;
  }
  renderAllDynamicLists(
    draftProfileData,
    {
      education: educationListElement,
      experience: experienceListElement,
      projects: projectsListElement,
      campus: campusListElement,
      skills: skillsListElement,
      language: languageListElement,
      certificate: certificateListElement,
      award: awardListElement,
      publication: publicationListElement,
      training: trainingListElement,
      family: familyListElement,
      emergency: emergencyListElement,
    },
    refreshDynamicLists,
    editingProfileId
      ? {
          profileId: editingProfileId,
          notify: (message, kind) => showStatus(message, kind),
        }
      : undefined,
  );
  updateValidationHint(draftProfileData);
}

function fillEditorForm(data: ProfileData): void {
  const pathFields = profileEditorForm.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('[data-path]');
  for (const fieldElement of pathFields) {
    const pathText = fieldElement.dataset.path ?? '';
    // 已升级为可搜索的字段通过 label[data-path-bound] 管理，跳过原生 select
    if (fieldElement.tagName === 'SELECT' && fieldElement.dataset.catalog) {
      // 升级后 select 已被替换；若仍存在则填值
      fieldElement.value = readPathValue(data, pathText);
      continue;
    }
    fieldElement.value = readPathValue(data, pathText);
  }

  // 同步已升级的可搜索输入展示值
  const boundFields = profileEditorForm.querySelectorAll<HTMLLabelElement>(
    '[data-path-bound]',
  );
  for (const boundLabel of boundFields) {
    // 地区控件另有 data-region-bound，此处跳过避免被 catalog 逻辑清空
    if (boundLabel.dataset.regionBound) {
      continue;
    }
    const pathText = boundLabel.dataset.pathBound ?? '';
    const input = boundLabel.querySelector<HTMLInputElement>(
      '.searchable-select-input',
    );
    if (!input) {
      continue;
    }
    const value = readPathValue(data, pathText);
    const catalogKey = boundLabel.dataset.catalogBound ?? '';
    const options = STATIC_CATALOG_MAP[catalogKey] ?? [];
    const matched = options.find(
      (item) => item.code === value || item.labelZh === value,
    );
    input.value = matched?.labelZh ?? value;
    input.dataset.code = matched?.code ?? value;
  }

  // 同步地区 Cascader 展示
  syncRegionBoundDisplays(
    profileEditorForm,
    REGION_FIELD_BINDINGS,
    (binding) => {
      const text = readPathValue(data, binding.textPath);
      if (binding.multiAppend) {
        return { text, region: null };
      }
      const regionRaw = readPathObject(data, binding.regionPath);
      if (
        regionRaw &&
        typeof regionRaw === 'object' &&
        !Array.isArray(regionRaw)
      ) {
        const region = regionRaw as RegionSelection;
        if (region.text?.trim()) {
          return { text: region.text, region };
        }
      }
      return { text, region: null };
    },
  );

  notesTextarea.value = data.notes;
  refreshDynamicLists();
  updateValidationHint(data);
}

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
 * 按点分路径读取任意对象/数组值（用于 RegionSelection）。
 */
function readPathObject(data: ProfileData, pathText: string): unknown {
  if (!pathText) {
    return undefined;
  }
  const pathParts = pathText.split('.');
  let current: unknown = data;
  for (const pathPart of pathParts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[pathPart];
  }
  return current;
}

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
    let nextValue = current[pathPart];
    if (nextValue === null || typeof nextValue !== 'object') {
      // 自动创建缺失的中间对象（如 industryExtras）
      nextValue = {};
      current[pathPart] = nextValue;
    }
    current = nextValue as Record<string, unknown>;
  }
  current[pathParts[pathParts.length - 1]] = value;
}

/**
 * 按点分路径写入对象/数组（地区结构化字段）。
 */
function writePathObject(
  data: ProfileData,
  pathText: string,
  value: unknown,
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
    let nextValue = current[pathPart];
    if (nextValue === null || typeof nextValue !== 'object') {
      nextValue = {};
      current[pathPart] = nextValue;
    }
    current = nextValue as Record<string, unknown>;
  }
  current[pathParts[pathParts.length - 1]] = value;
}

function collectStaticFieldsIntoDraft(data: ProfileData): void {
  const pathFields = profileEditorForm.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('[data-path]');
  for (const fieldElement of pathFields) {
    const pathText = fieldElement.dataset.path ?? '';
    writePathValue(data, pathText, fieldElement.value.trim());
  }

  // 可搜索控件值已通过 onChange 写入；再扫一遍 data-code 兜底
  const boundFields = profileEditorForm.querySelectorAll<HTMLLabelElement>(
    '[data-path-bound]',
  );
  for (const boundLabel of boundFields) {
    if (boundLabel.dataset.regionBound) {
      continue;
    }
    const pathText = boundLabel.dataset.pathBound ?? '';
    const input = boundLabel.querySelector<HTMLInputElement>(
      '.searchable-select-input',
    );
    if (!input) {
      continue;
    }
    const codeOrText = (input.dataset.code || input.value).trim();
    writePathValue(data, pathText, codeOrText);
  }

  // 地区 Cascader：用展示框文案兜底写入字符串字段
  const regionFields = profileEditorForm.querySelectorAll<HTMLElement>(
    '[data-region-bound]',
  );
  for (const regionField of regionFields) {
    const regionKey = regionField.dataset.regionBound ?? '';
    const binding = REGION_FIELD_BINDINGS[regionKey];
    if (!binding) {
      continue;
    }
    const displayInput = regionField.querySelector<HTMLInputElement>(
      '.region-cascader-display',
    );
    if (!displayInput) {
      continue;
    }
    writePathValue(data, binding.textPath, displayInput.value.trim());
  }

  data.notes = notesTextarea.value;
}

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
 * 把「缺头像」并进校验提示。
 */
async function refreshAvatarHint(profileId: string): Promise<void> {
  const hasAvatar = await profileHasAvatar(profileId);
  if (hasAvatar || !draftProfileData) {
    return;
  }
  const current = editorValidationHint.textContent ?? '';
  if (current.includes('头像')) {
    return;
  }
  editorValidationHint.textContent = current
    ? `${current} —— 硬必填未完成：头像`
    : '硬必填未完成：头像';
}

/**
 * 硬必填文案对应到编辑区里最具体的控件或分区。
 */
const REQUIRED_FIELD_SELECTOR: Record<string, string> = {
  姓名: '[data-path="basic.fullName"]',
  手机: '[data-path="basic.phone"]',
  邮箱: '[data-path="basic.email"]',
  现居城市: '[data-path="basic.currentCity"]',
  国籍: '[data-path="basic.nationality"]',
  籍贯: '[data-path="basic.nativePlace"]',
  证件类型: '[data-path="basic.idType"]',
  证件号码: '[data-path="basic.idNumber"]',
  政治面貌: '[data-path="basic.politicalStatus"]',
  婚姻状况: '[data-path="basic.maritalStatus"]',
  目标职位: '[data-path="jobIntent.targetRole"]',
};

/**
 * 底栏提示用的短名称，避免把整句教育校验贴在按钮旁。
 */
function shortMissingLabel(label: string): string {
  if (label.includes('双学位')) {
    return '第二学位';
  }
  if (label.includes('教育')) {
    return '教育经历';
  }
  if (label.includes('头像')) {
    return '头像';
  }
  return label;
}

/**
 * 按校验文案找到要高亮的字段框；教育类落到整块分区。
 */
function findRequiredTarget(label: string): HTMLElement | null {
  if (label.includes('头像')) {
    return document.getElementById('avatarAttachmentHost');
  }
  if (label.includes('教育') || label.includes('双学位')) {
    return document.getElementById('section-education');
  }
  const selector = REQUIRED_FIELD_SELECTOR[label];
  if (!selector) {
    return null;
  }
  const control = profileEditorForm.querySelector(selector);
  const field = control?.closest('.field');
  return field instanceof HTMLElement ? field : null;
}

/**
 * 清掉上次保存失败留下的红框和底栏红字。
 */
function clearRequiredAlerts(): void {
  stickySaveStatus.classList.remove('is-alert');
  for (const marked of profileEditorForm.querySelectorAll('.is-required-missing')) {
    marked.classList.remove('is-required-missing');
  }
}

/**
 * 未填必填全部加红框，并滚到校验名单里最靠上的那一项。
 */
function focusFirstMissingRequired(labels: string[]): string {
  clearRequiredAlerts();
  const targets: HTMLElement[] = [];
  for (const label of labels) {
    const target = findRequiredTarget(label);
    if (!target) {
      continue;
    }
    target.classList.add('is-required-missing');
    targets.push(target);
  }
  const firstTarget = targets[0];
  const firstLabel = labels[0] ?? '必填项';
  if (firstTarget) {
    jumpToEditorTarget(firstTarget);
  }
  return shortMissingLabel(firstLabel);
}

/**
 * 填上内容后立刻去掉这一格的红框。
 */
function bindRequiredMissingClear(): void {
  const clearFilledField = (event: Event) => {
    const eventTarget = event.target;
    if (!(eventTarget instanceof HTMLElement)) {
      return;
    }
    const field = eventTarget.closest('.field');
    if (!(field instanceof HTMLElement) || !field.classList.contains('is-required-missing')) {
      return;
    }
    const controls = field.querySelectorAll('input, textarea, select');
    for (const control of controls) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) {
        continue;
      }
      if (control instanceof HTMLInputElement && control.type === 'hidden') {
        continue;
      }
      if (control.value.trim()) {
        field.classList.remove('is-required-missing');
        return;
      }
    }
  };
  profileEditorForm.addEventListener('input', clearFilledField);
  profileEditorForm.addEventListener('change', clearFilledField);
}

/**
 * 把当前草稿写入本机。
 * @param options.requireComplete 为 true 时校验硬必填与头像（「保存档案/关闭」）
 * @param options.closeAfterSave 保存成功后关闭编辑区
 */
async function persistDraftProfile(options: {
  requireComplete: boolean;
  closeAfterSave: boolean;
}): Promise<void> {
  if (!editingProfileId || !draftProfileData) {
    showStatus('当前没有正在编辑的档案', 'error');
    return;
  }

  collectStaticFieldsIntoDraft(draftProfileData);
  updateValidationHint(draftProfileData);

  if (options.requireComplete) {
    const validation = validateProfileData(draftProfileData);
    if (!validation.ok) {
      const jumpedLabel = focusFirstMissingRequired(validation.missingRequired);
      stickySaveStatus.textContent = `还不能保存，已跳到${jumpedLabel}`;
      stickySaveStatus.classList.add('is-alert');
      return;
    }
    try {
      await assertAvatarUploaded(editingProfileId);
    } catch (error) {
      const jumpedLabel = focusFirstMissingRequired(['头像']);
      showStatus(
        error instanceof Error ? error.message : '请先上传头像',
        'error',
      );
      stickySaveStatus.textContent = `还不能保存，已跳到${jumpedLabel}`;
      stickySaveStatus.classList.add('is-alert');
      return;
    }
  }

  try {
    const updated = await updateProfileData(
      editingProfileId,
      draftProfileData,
    );
    await refreshProfilesFromStorage();
    if (options.closeAfterSave) {
      showStatus('档案已保存并关闭编辑', 'success');
      closeEditor();
      return;
    }
    editingProfileName.textContent = `正在编辑：${updated.name}`;
    draftProfileData = structuredClone(updated.data);
    fillEditorForm(draftProfileData);
    remountDistributedAttachments(updated.id);
    clearRequiredAlerts();
    stickySaveStatus.textContent = `已保存 ${new Date().toLocaleTimeString()}`;
    const validation = validateProfileData(draftProfileData);
    const softText =
      options.requireComplete && validation.softWarnings.length > 0
        ? `（建议：${validation.softWarnings.join('；')}）`
        : '';
    showStatus(
      options.requireComplete
        ? `档案内容已保存${softText}`
        : `进度已保存到本机${softText}`,
      'success',
    );
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

async function handleSaveProfileData(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  await persistDraftProfile({ requireComplete: true, closeAfterSave: false });
}

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
    downloadLink.download = `tangtou-export-${formatExportStamp()}.json`;
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
    showStatus('已导出（不含 API Key）', 'success');
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  }
}

function formatExportStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

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
    const timestamp = new Date().toISOString();

    for (const importedProfile of parsed.profiles) {
      if (!importedProfile || typeof importedProfile !== 'object') {
        skippedCount += 1;
        continue;
      }
      const profileName =
        typeof importedProfile.name === 'string' && importedProfile.name.trim()
          ? importedProfile.name.trim()
          : '导入档案';
      profilesToAppend.push({
        id: crypto.randomUUID(),
        name: profileName,
        createdAt: timestamp,
        updatedAt: timestamp,
        data: normalizeProfileData(importedProfile.data),
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
    showStatus(
      skippedCount > 0
        ? `已导入 ${profilesToAppend.length} 份档案（跳过 ${skippedCount} 项）`
        : `已导入 ${profilesToAppend.length} 份档案`,
      'success',
    );
  } catch (error) {
    showStatus(mapErrorMessage(error), 'error');
  } finally {
    importFileInput.value = '';
  }
}

function bindEventListeners(): void {
  apiForm.addEventListener('submit', (event) => {
    void handleSaveApiSettings(event);
  });
  testApiButton.addEventListener('click', () => {
    handleTestApiConnection();
  });
  resetTokenUsageButton.addEventListener('click', () => {
    void (async () => {
      try {
        const empty = await resetTokenUsageStats();
        renderTokenUsageSummary(empty);
        showStatus('Token 统计已清零', 'success');
      } catch (error) {
        showStatus(mapErrorMessage(error), 'error');
      }
    })();
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
  saveProgressButton.addEventListener('click', () => {
    void persistDraftProfile({ requireComplete: false, closeAfterSave: false });
  });
  saveAndCloseButton.addEventListener('click', () => {
    void persistDraftProfile({ requireComplete: true, closeAfterSave: true });
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
    if (addListKind && draftProfileData) {
      appendListItem(draftProfileData, addListKind);
      refreshDynamicLists();
    }
  });
}

bindEventListeners();
void bootstrapOptionsPage();
