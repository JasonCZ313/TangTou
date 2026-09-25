/**
 * 分散附件 UI：简历置顶识别、头像进基本信息、条目卡片内上传。
 */
import { describeUserFacingError } from '../../shared/messaging/userFacingError';
import { extractResumeText } from '../../shared/resume/extractResumeText';
import { overlayLocalResumeContacts } from '../../shared/resume/resumeContacts';
import {
  deleteAttachment,
  listAttachments,
  listAttachmentsForItem,
  profileHasAvatar,
  readAttachmentFile,
  saveAttachment,
} from '../../shared/storage/attachmentStore';
import { mergeProfileFillBlanks } from '../../shared/storage/mergeProfileBlanks';
import {
  clearResumeRecognition,
  readResumeRecognition,
  RESUME_RECOGNITION_REVISION,
  writeResumeRecognition,
  type SavedResumeRecognition,
} from '../../shared/storage/resumeRecognitionStore';
import {
  attachmentKindLabel,
  formatAttachmentSizeLimit,
  type AttachmentKind,
  type AttachmentMeta,
} from '../../shared/types/attachment';
import type { ProfileData } from '../../shared/types/profile';
import type { ExtensionMessage } from '../../shared/types/messages';
import { createRequestId, sendRuntimeMessage } from '../../shared/messaging/send';

/** 通知回调类型 */
export type AttachmentNotify = (
  message: string,
  kind: 'info' | 'success' | 'error',
) => void;

/**
 * 保存前检查头像是否已上传。
 */
export async function assertAvatarUploaded(profileId: string): Promise<void> {
  const hasAvatar = await profileHasAvatar(profileId);
  if (!hasAvatar) {
    throw new Error('请先上传头像（必填）');
  }
}

/**
 * 简历区：上传只存文件；识别结果另存；点「写入空白项」才改档案。
 */
export function mountResumeBlock(options: {
  host: HTMLElement;
  profileId: string;
  readDraft: () => ProfileData | null;
  applyDraft: (nextDraft: ProfileData) => void;
  notify: AttachmentNotify;
}): void {
  const { host, profileId, readDraft, applyDraft, notify } = options;
  host.replaceChildren();

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `支持 PDF / DOCX / TXT，单文件不超过 ${formatAttachmentSizeLimit('resume')}。上传只保存文件，网申时挂到简历附件框。几乎没有文字的页面会在本机识字，可能多等一会儿。`;

  const recognizeButton = document.createElement('button');
  recognizeButton.type = 'button';
  recognizeButton.className = 'btn btn-secondary btn-sm';
  recognizeButton.textContent = '识别并保存';

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'btn btn-primary btn-sm';
  applyButton.textContent = '写入空白项';

  const toolbar = document.createElement('div');
  toolbar.className = 'attachment-toolbar';
  toolbar.append(
    createUploadButton(
      '上传简历',
      '.pdf,.docx,.txt,application/pdf,text/plain',
      async (file) => {
        await saveAttachment({
          profileId,
          kind: 'resume',
          fileName: file.name,
          mimeType: file.type || guessMime(file.name),
          buffer: await file.arrayBuffer(),
        });
        await clearResumeRecognition(profileId);
        clearResumeResult();
        hideProgress();
        notify('简历文件已保存，尚未写入档案', 'success');
        await refresh();
      },
    ),
    recognizeButton,
    applyButton,
  );

  const progressWrap = document.createElement('div');
  progressWrap.className = 'parse-progress hidden';
  progressWrap.setAttribute('aria-live', 'polite');
  const progressBar = document.createElement('div');
  progressBar.className = 'parse-progress-bar';
  const progressLabel = document.createElement('span');
  progressLabel.className = 'parse-progress-label';
  progressWrap.append(progressBar, progressLabel);

  const list = document.createElement('ul');
  list.className = 'attachment-list';

  const recognitionStatus = document.createElement('p');
  recognitionStatus.className = 'hint';

  const resultBox = document.createElement('p');
  resultBox.className = 'resume-result';
  resultBox.hidden = true;

  host.append(hint, toolbar, progressWrap, resultBox, recognitionStatus, list);

  /** 错误红框停留时间。只收起提示，不关编辑区、不写档案。 */
  const RESUME_ERROR_VISIBLE_MS = 10000;
  let resumeErrorTimer: number | null = null;

  /**
   * 取消尚未到期的错误消失倒计时。
   */
  function cancelResumeErrorTimer(): void {
    if (resumeErrorTimer !== null) {
      window.clearTimeout(resumeErrorTimer);
      resumeErrorTimer = null;
    }
  }

  /**
   * 收起进度条，不影响档案和折叠状态。
   */
  function hideProgress(): void {
    progressWrap.classList.add('hidden');
    progressBar.style.width = '0%';
    progressLabel.textContent = '';
  }

  /**
   * 在简历区留下绿框或红框。红框 5 秒后自行消失。
   */
  function showResumeResult(tone: 'ok' | 'bad', message: string): void {
    cancelResumeErrorTimer();
    host.classList.remove('is-ok', 'is-bad');
    host.classList.add(tone === 'ok' ? 'is-ok' : 'is-bad');
    resultBox.hidden = false;
    resultBox.classList.remove('is-ok', 'is-bad');
    resultBox.classList.add(tone === 'ok' ? 'is-ok' : 'is-bad');
    resultBox.textContent = message;
    if (tone === 'bad') {
      resumeErrorTimer = window.setTimeout(() => {
        resumeErrorTimer = null;
        clearResumeResult();
        hideProgress();
      }, RESUME_ERROR_VISIBLE_MS);
    }
  }

  /**
   * 清掉简历区的红框或绿框。不收起所在分区，也不保存档案。
   */
  function clearResumeResult(): void {
    cancelResumeErrorTimer();
    host.classList.remove('is-ok', 'is-bad');
    resultBox.hidden = true;
    resultBox.textContent = '';
    resultBox.classList.remove('is-ok', 'is-bad');
  }

  /**
   * 把异常收成简历区能直接看懂的一句中文。
   */
  function describeResumeError(error: unknown): string {
    const message = error instanceof Error ? error.message : '识别失败';
    if (/未处理的消息类型:\s*PARSE_RESUME/.test(message)) {
      return '扩展后台还是旧的，所以识别请求没人接。请到扩展管理页对躺投点一次「重新加载」，再识别。只刷新本页不够。';
    }
    if (/请/.test(message)) {
      return message;
    }
    if (/API|钥匙|权限|LLM_HTTP|401|403/.test(message)) {
      return '模型没接住。到侧栏核对地址、钥匙和模型名，测试连接通过后再识别。';
    }
    return describeUserFacingError(
      message || '识别失败。请再点一次；若仍如此，换 DOCX 试试。',
    );
  }

  /** 当前简历文件，没有则为 null */
  let currentResume: AttachmentMeta | null = null;
  /** 与当前文件匹配的已保存识别结果 */
  let savedRecognition: SavedResumeRecognition | null = null;

  /**
   * 更新识别进度条显示。
   */
  function setProgress(percent: number, labelText: string): void {
    progressWrap.classList.remove('hidden');
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progressLabel.textContent = labelText;
  }

  /**
   * 按当前文件和识别缓存，更新两个按钮是否可点，以及状态文案。
   */
  function syncRecognitionControls(): void {
    recognizeButton.disabled = !currentResume;
    const recognitionMatchesFile =
      currentResume !== null &&
      savedRecognition !== null &&
      savedRecognition.attachmentId === currentResume.id;
    applyButton.disabled = !recognitionMatchesFile;
    if (!currentResume) {
      recognitionStatus.classList.remove('is-stale');
      recognitionStatus.textContent = '尚未上传简历。';
      return;
    }
    if (!recognitionMatchesFile) {
      recognitionStatus.classList.remove('is-stale');
      recognitionStatus.textContent = `已保存文件「${currentResume.fileName}」。点「识别并保存」只抽出内容，不会改档案。`;
      return;
    }
    const recognitionIsStale =
      (savedRecognition?.recognitionRevision ?? 0) < RESUME_RECOGNITION_REVISION;
    recognitionStatus.classList.toggle('is-stale', recognitionIsStale);
    recognitionStatus.textContent = recognitionIsStale
      ? '识别结果已保存在本机。点「写入空白项」才会填进空着的字段。识别规则已更新，请再点一次识别并保存。'
      : '识别结果已保存在本机。点「写入空白项」才会填进档案里仍为空的字段，已填内容不会被覆盖。';
  }

  /**
   * 刷新简历列表、识别缓存和按钮状态。
   */
  async function refresh(): Promise<void> {
    const rows = (await listAttachments(profileId)).filter(
      (row) => row.kind === 'resume',
    );
    currentResume = rows[0] ?? null;
    savedRecognition = await readResumeRecognition(profileId);
    if (
      savedRecognition &&
      currentResume &&
      savedRecognition.attachmentId !== currentResume.id
    ) {
      await clearResumeRecognition(profileId);
      savedRecognition = null;
    }
    list.replaceChildren();
    if (!currentResume) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'hint';
      emptyItem.textContent = '上传后，网申时会把这份文件挂到简历附件框。';
      list.appendChild(emptyItem);
    } else {
      list.appendChild(renderResumeRow(currentResume));
    }
    syncRecognitionControls();
  }

  /**
   * 单条简历行：只展示文件名和删除，不在这里写入档案。
   */
  function renderResumeRow(row: AttachmentMeta): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'attachment-row';
    const name = document.createElement('span');
    name.textContent = row.fileName;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-ghost btn-sm';
    removeButton.textContent = '删除';
    removeButton.addEventListener('click', () => {
      void (async () => {
        await deleteAttachment(row.id);
        await clearResumeRecognition(profileId);
        clearResumeResult();
        hideProgress();
        notify('已删除简历文件和识别缓存', 'info');
        await refresh();
      })();
    });
    item.append(name, removeButton);
    return item;
  }

  /**
   * 抽出简历文字并调用模型，只把结果存到本机，不改档案草稿。
   */
  async function recognizeAndSave(): Promise<void> {
    if (!currentResume) {
      notify('请先上传简历', 'error');
      return;
    }
    const resumeRow = currentResume;
    recognizeButton.disabled = true;
    applyButton.disabled = true;
    clearResumeResult();
    setProgress(6, '读取简历文件…');
    const stored = await readAttachmentFile(resumeRow.id);
    if (!stored) {
      throw new Error('找不到简历文件。请重新上传。');
    }
    const resumeText = await extractResumeText(
      stored.meta.fileName,
      stored.meta.mimeType,
      stored.buffer,
      (update) => {
        setProgress(Math.round(update.percent * 0.7), update.label);
      },
    );
    setProgress(78, '调用模型整理字段…');
    const response = await sendRuntimeMessage({
      type: 'PARSE_RESUME',
      requestId: createRequestId(),
      resumeText,
    } satisfies ExtensionMessage);
    if (response.type === 'ERROR') {
      throw new Error(response.message);
    }
    if (response.type !== 'PARSE_RESUME_RESULT') {
      throw new Error('识别失败。请再点一次。');
    }
    setProgress(92, '保存识别结果…');
    const profilePatch = overlayLocalResumeContacts(
      response.profilePatch,
      resumeText,
    );
    savedRecognition = {
      attachmentId: resumeRow.id,
      fileName: resumeRow.fileName,
      savedAt: new Date().toISOString(),
      profilePatch,
      recognitionRevision: RESUME_RECOGNITION_REVISION,
    };
    await writeResumeRecognition(profileId, savedRecognition);
    setProgress(100, '识别结果已保存');
    showResumeResult(
      'ok',
      '已识别并保存。档案还没改，点「写入空白项」才会填进空着的字段。',
    );
    notify('已识别并保存。需要时再点「写入空白项」', 'success');
    syncRecognitionControls();
  }

  /**
   * 把已保存的识别结果合并进档案空白项。已填写的字段保持不变。
   */
  function applySavedRecognition(): void {
    const draft = readDraft();
    if (!draft || !savedRecognition || !currentResume) {
      notify('还没有可写入的识别结果', 'error');
      return;
    }
    if (savedRecognition.attachmentId !== currentResume.id) {
      notify('识别结果和当前简历文件不是同一份，请重新识别', 'error');
      return;
    }
    const merged = mergeProfileFillBlanks(draft, savedRecognition.profilePatch);
    applyDraft(merged);
    notify('已写入空白项。核对后点「保存进度」或「保存档案」', 'success');
  }

  recognizeButton.addEventListener('click', () => {
    void recognizeAndSave().catch((error: unknown) => {
      const message = describeResumeError(error);
      showResumeResult('bad', message);
      progressWrap.classList.remove('hidden');
      progressLabel.textContent = message;
      syncRecognitionControls();
      notify(message, 'error');
    });
  });
  applyButton.addEventListener('click', () => {
    applySavedRecognition();
  });

  void refresh();
}

/**
 * 头像区：必填上传与预览/删除。
 */
export function mountAvatarBlock(options: {
  host: HTMLElement;
  profileId: string;
  notify: AttachmentNotify;
  onChanged?: () => void;
}): void {
  const { host, profileId, notify, onChanged } = options;
  host.replaceChildren();

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `证件照/头像为硬必填，JPG/PNG/WEBP，不超过 ${formatAttachmentSizeLimit('avatar')}。`;

  const toolbar = document.createElement('div');
  toolbar.className = 'attachment-toolbar';
  toolbar.append(
    createUploadButton(
      '上传头像（必填）',
      'image/jpeg,image/png,image/webp',
      async (file) => {
        await saveAttachment({
          profileId,
          kind: 'avatar',
          fileName: file.name,
          mimeType: file.type,
          buffer: await file.arrayBuffer(),
        });
        notify('头像已保存到本机', 'success');
        await refresh();
        onChanged?.();
      },
    ),
  );

  const preview = document.createElement('div');
  preview.className = 'avatar-preview-row';

  host.append(hint, toolbar, preview);

  /**
   * 刷新头像预览与删除按钮。
   */
  async function refresh(): Promise<void> {
    preview.replaceChildren();
    const rows = (await listAttachments(profileId)).filter(
      (row) => row.kind === 'avatar',
    );
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '尚未上传头像。';
      preview.appendChild(empty);
      return;
    }
    const row = rows[0];
    const stored = await readAttachmentFile(row.id);
    if (stored) {
      const image = document.createElement('img');
      image.className = 'avatar-thumb';
      image.alt = '头像预览';
      const blob = new Blob([stored.buffer], { type: stored.meta.mimeType });
      image.src = URL.createObjectURL(blob);
      preview.appendChild(image);
    }
    const name = document.createElement('span');
    name.textContent = row.fileName;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-ghost btn-sm';
    removeButton.textContent = '删除头像';
    removeButton.addEventListener('click', () => {
      void (async () => {
        await deleteAttachment(row.id);
        notify('已删除头像', 'info');
        await refresh();
        onChanged?.();
      })();
    });
    preview.append(name, removeButton);
  }

  void refresh();
}

/**
 * 条目卡片内的附件槽：上传、列表、删除；可选备注/网盘由外部表单绑定。
 */
export function mountItemAttachmentSlot(options: {
  host: HTMLElement;
  profileId: string;
  kind: AttachmentKind;
  itemId: string;
  notify: AttachmentNotify;
  /** 只读态只展示列表，不允许上传删除 */
  readOnly?: boolean;
  accept?: string;
}): void {
  const {
    host,
    profileId,
    kind,
    itemId,
    notify,
    readOnly = false,
    accept = '',
  } = options;
  host.replaceChildren();
  host.classList.add('item-attachment-slot');

  const title = document.createElement('p');
  title.className = 'item-attachment-title';
  title.textContent = `${attachmentKindLabel(kind)}（≤${formatAttachmentSizeLimit(kind)}）`;

  const toolbar = document.createElement('div');
  toolbar.className = 'attachment-toolbar';
  if (!readOnly) {
    toolbar.append(
      createUploadButton(`上传${attachmentKindLabel(kind)}`, accept, async (file) => {
        await saveAttachment({
          profileId,
          kind,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          buffer: await file.arrayBuffer(),
          itemId,
        });
        notify(`已保存${attachmentKindLabel(kind)}`, 'success');
        await refresh();
      }),
    );
  }

  const list = document.createElement('ul');
  list.className = 'attachment-list';

  host.append(title, toolbar, list);

  /**
   * 刷新本条目附件列表。
   */
  async function refresh(): Promise<void> {
    const rows = await listAttachmentsForItem(profileId, itemId, kind);
    list.replaceChildren();
    if (rows.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'hint';
      emptyItem.textContent = readOnly ? '无附件' : '尚未上传';
      list.appendChild(emptyItem);
      return;
    }
    for (const row of rows) {
      const item = document.createElement('li');
      item.className = 'attachment-row';
      const name = document.createElement('span');
      name.textContent = row.fileName;
      item.appendChild(name);
      if (!readOnly) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn btn-ghost btn-sm';
        removeButton.textContent = '删除';
        removeButton.addEventListener('click', () => {
          void (async () => {
            await deleteAttachment(row.id);
            notify('已删除附件', 'info');
            await refresh();
          })();
        });
        item.appendChild(removeButton);
      }
      list.appendChild(item);
    }
  }

  void refresh();
}

/**
 * 创建一个选文件按钮。
 */
function createUploadButton(
  labelText: string,
  accept: string,
  onFile: (file: File) => Promise<void>,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-sm';
  button.textContent = labelText;
  button.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) {
      input.accept = accept;
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void onFile(file).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '上传失败';
        window.alert(message);
      });
    });
    input.click();
  });
  return button;
}

/**
 * 按扩展名猜测简历 MIME。
 */
function guessMime(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lowerName.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lowerName.endsWith('.txt')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}
