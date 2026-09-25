/**
 * 档案附件种类：头像/简历按档案唯一；证书等按条目 itemId 绑定。
 */
export type AttachmentKind =
  | 'avatar'
  | 'resume'
  | 'certificate'
  | 'award'
  | 'internship'
  | 'project'
  | 'other';

/** 附件元数据（二进制另存在 IndexedDB） */
export interface AttachmentMeta {
  id: string;
  profileId: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
  /**
   * 绑定到证书/奖状/经历/项目等列表条目的稳定 id。
   * 头像、简历不填；旧数据可能为空。
   */
  itemId?: string;
}

/** 兼容旧代码：全局默认上限（取各类型中较大值） */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * 各类型单文件大小上限（贴近常见网申限制）。
 */
export const ATTACHMENT_SIZE_LIMITS: Record<AttachmentKind, number> = {
  avatar: 2 * 1024 * 1024,
  resume: 10 * 1024 * 1024,
  certificate: 5 * 1024 * 1024,
  award: 5 * 1024 * 1024,
  internship: 5 * 1024 * 1024,
  project: 5 * 1024 * 1024,
  other: 5 * 1024 * 1024,
};

/**
 * 同作用域下最多份数：头像/简历按档案；其余按条目 itemId。
 */
export const ATTACHMENT_COUNT_LIMITS: Record<AttachmentKind, number> = {
  avatar: 1,
  resume: 1,
  certificate: 1,
  award: 1,
  internship: 1,
  project: 3,
  other: 3,
};

/** 头像允许的图片类型 */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * 种类中文名，供界面与填写原因展示。
 */
export function attachmentKindLabel(kind: AttachmentKind): string {
  const labels: Record<AttachmentKind, string> = {
    avatar: '头像',
    resume: '简历',
    certificate: '证书扫描件',
    award: '奖状扫描件',
    internship: '实习/在职证明',
    project: '项目附件',
    other: '其他附件',
  };
  return labels[kind];
}

/**
 * 取某类型的单文件字节上限。
 */
export function getAttachmentSizeLimit(kind: AttachmentKind): number {
  return ATTACHMENT_SIZE_LIMITS[kind];
}

/**
 * 人类可读的文件大小文案。
 */
export function formatAttachmentSizeLimit(kind: AttachmentKind): string {
  const bytes = getAttachmentSizeLimit(kind);
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}
