/**
 * Options 档案编辑区动态列表渲染：教育（含双学位）、实习、项目、技能等。
 */
import {
  ACADEMIC_DEGREE_OPTIONS,
  AWARD_LEVEL_OPTIONS,
  AWARD_PRIZE_OPTIONS,
  COMMON_CERTIFICATE_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  FAMILY_RELATION_OPTIONS,
  INDUSTRY_OPTIONS,
  LANGUAGE_CERT_OPTIONS,
  LANGUAGE_PROFICIENCY_OPTIONS,
  labelOfCatalog,
  POLITICAL_STATUS_OPTIONS,
  PUBLICATION_KIND_OPTIONS,
  SKILL_LEVEL_OPTIONS,
  STUDY_MODE_OPTIONS,
} from '../../shared/catalogs/enums';
import { deleteAttachmentsForItem } from '../../shared/storage/attachmentStore';
import { isDualAcademicDegree } from '../../shared/storage/normalize';
import { isInternshipExperience } from '../../shared/fill/sectionAdds';
import type { AttachmentKind } from '../../shared/types/attachment';
import type {
  AwardItem,
  CampusActivityItem,
  CertificateItem,
  EducationItem,
  EmergencyContact,
  ExperienceItem,
  FamilyMemberItem,
  LanguageItem,
  LockableListItemFields,
  ProfileData,
  ProjectItem,
  PublicationItem,
  SkillItem,
  TrainingItem,
} from '../../shared/types/profile';
import { mountItemAttachmentSlot } from './attachmentPanel';
import {
  createBoundCheckbox,
  createBoundInput,
  createBoundSelect,
  createBoundTextarea,
  createListItemCard,
  createLockableListItemCard,
} from './editorWidgets';
import { createBoundRegionField } from './regionCascader';

/**
 * 列表条目挂附件时需要的档案上下文（由 Options 主逻辑传入）。
 */
export interface ListAttachmentContext {
  profileId: string;
  notify: (message: string, kind: 'info' | 'success' | 'error') => void;
}

/**
 * 这一条经历、证书或成果里用到或具备的技能。
 * 和档案顶部的总技能列表分开：这里只写和本条有关的内容。
 */
function createSkillsInvolvedInput(
  currentValue: string | undefined,
  onChange: (value: string) => void,
): HTMLLabelElement {
  return createBoundInput(
    '涉及技能',
    currentValue ?? '',
    onChange,
    'text',
    false,
    '多项用顿号分隔，如 Python、Excel',
  );
}

/** 创建网格容器 */
function createCardGrid(): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  return grid;
}

/**
 * 确保列表条目有稳定 id（旧档案归一化后也应已有）。
 */
function ensureItemId(item: LockableListItemFields): string {
  if (!item.id) {
    item.id = crypto.randomUUID();
  }
  return item.id;
}

/**
 * 删除条目时同步清掉绑定附件。
 */
function removeLockableItem<T extends LockableListItemFields>(
  items: T[],
  itemIndex: number,
  attachmentContext: ListAttachmentContext | undefined,
  onRefresh: () => void,
): void {
  const target = items[itemIndex];
  const itemId = target?.id;
  items.splice(itemIndex, 1);
  if (attachmentContext && itemId) {
    void deleteAttachmentsForItem(attachmentContext.profileId, itemId);
  }
  onRefresh();
}

/**
 * 只读全貌：把若干「标签：值」行展示出来。
 */
function createReadonlySummary(
  rows: Array<{ label: string; value: string }>,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'item-readonly-summary';
  for (const row of rows) {
    if (!row.value.trim()) {
      continue;
    }
    const line = document.createElement('p');
    line.className = 'item-readonly-line';
    line.textContent = `${row.label}：${row.value}`;
    wrap.appendChild(line);
  }
  if (wrap.childElementCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '本条暂无内容';
    wrap.appendChild(empty);
  }
  return wrap;
}

/**
 * 条目附件备注 + 网盘字段（编辑态）。
 */
function appendItemNoteFields(
  grid: HTMLElement,
  item: LockableListItemFields,
): void {
  grid.append(
    createBoundInput('附件备注', item.attachmentNote ?? '', (value) => {
      item.attachmentNote = value;
    }),
    createBoundInput('网盘/外链', item.cloudLink ?? '', (value) => {
      item.cloudLink = value;
    }, 'url'),
  );
}

/**
 * 在卡片底部挂上按条附件槽。
 */
function appendItemAttachmentSlot(
  card: HTMLElement,
  attachmentContext: ListAttachmentContext | undefined,
  kind: AttachmentKind,
  itemId: string,
  readOnly: boolean,
  accept = '',
): void {
  if (!attachmentContext) {
    return;
  }
  const slotHost = document.createElement('div');
  mountItemAttachmentSlot({
    host: slotHost,
    profileId: attachmentContext.profileId,
    kind,
    itemId,
    notify: attachmentContext.notify,
    readOnly,
    accept,
  });
  card.appendChild(slotHost);
}

/** 空白教育条目 */
export function createEmptyEducationItem(): EducationItem {
  return {
    school: '',
    degreeLevel: '',
    major: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    isHighest: false,
    isFirstDegree: false,
    academicDegree: '',
    description: '',
    skillsInvolved: '',
    secondDegree: {
      school: '',
      major: '',
      degreeLevel: '',
      academicDegree: '',
      college: '',
      startDate: '',
      endDate: '',
      description: '',
    },
  };
}

export function createEmptyExperienceItem(employmentType: string): ExperienceItem {
  return {
    id: crypto.randomUUID(),
    editingLocked: false,
    attachmentNote: '',
    cloudLink: '',
    employmentType,
    company: '',
    title: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    description: '',
    responsibilities: '',
    workContent: '',
    achievements: '',
    skillsInvolved: '',
    industry: '',
  };
}

export function createEmptyProjectItem(): ProjectItem {
  return {
    id: crypto.randomUUID(),
    editingLocked: false,
    attachmentNote: '',
    cloudLink: '',
    name: '',
    role: '',
    duty: '',
    startDate: '',
    endDate: '',
    description: '',
    content: '',
    value: '',
    link: '',
  };
}

/** 空白证书条目 */
export function createEmptyCertificateItem(): CertificateItem {
  return {
    id: crypto.randomUUID(),
    editingLocked: false,
    attachmentNote: '',
    cloudLink: '',
    name: '',
    level: '',
    issuer: '',
    date: '',
    expireDate: '',
    number: '',
    major: '',
    description: '',
    skillsInvolved: '',
  };
}

/** 空白奖项条目 */
export function createEmptyAwardItem(): AwardItem {
  return {
    id: crypto.randomUUID(),
    editingLocked: false,
    attachmentNote: '',
    cloudLink: '',
    name: '',
    level: '',
    prizeRank: '',
    date: '',
    issuer: '',
    description: '',
    skillsInvolved: '',
  };
}

export function createEmptySkillItem(): SkillItem {
  return { name: '', level: '', years: '', category: '' };
}

export function createEmptyEmergencyContact(): EmergencyContact {
  return { name: '', relationship: '', phone: '' };
}

/**
 * 渲染全部动态列表。
 */
export function renderAllDynamicLists(
  data: ProfileData,
  hosts: {
    education: HTMLDivElement;
    experience: HTMLDivElement;
    projects: HTMLDivElement;
    campus: HTMLDivElement;
    skills: HTMLDivElement;
    language: HTMLDivElement;
    certificate: HTMLDivElement;
    award: HTMLDivElement;
    publication: HTMLDivElement;
    training: HTMLDivElement;
    family: HTMLDivElement;
    emergency: HTMLDivElement;
  },
  onRefresh: () => void,
  attachmentContext?: ListAttachmentContext,
): void {
  renderEducationRows(data.education, hosts.education, onRefresh);
  renderExperienceRows(
    data.experience,
    hosts.experience,
    onRefresh,
    attachmentContext,
  );
  renderProjectRows(
    data.projects,
    hosts.projects,
    onRefresh,
    attachmentContext,
  );
  renderCampusRows(data.campusActivities, hosts.campus, onRefresh);
  renderSkillRows(data.skills, hosts.skills, onRefresh);
  renderLanguageRows(data.languages, hosts.language, onRefresh);
  renderCertificateRows(
    data.certificates,
    hosts.certificate,
    onRefresh,
    attachmentContext,
  );
  renderAwardRows(data.awards, hosts.award, onRefresh, attachmentContext);
  renderPublicationRows(data.publications, hosts.publication, onRefresh);
  renderTrainingRows(data.trainings, hosts.training, onRefresh);
  renderFamilyRows(data.familyMembers, hosts.family, onRefresh);
  renderEmergencyRows(data.emergencyContacts, hosts.emergency, onRefresh);
}

function renderEducationRows(
  items: EducationItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`教育经历 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('学校', item.school, (value) => {
        item.school = value;
      }, 'text', true),
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
      createBoundInput('入学日期', item.startDate, (value) => {
        item.startDate = value;
      }, 'date', true),
      createBoundInput('毕业日期', item.endDate, (value) => {
        item.endDate = value;
      }, 'date'),
      createBoundCheckbox('在读', Boolean(item.isCurrent), (checked) => {
        item.isCurrent = checked;
      }),
      createBoundCheckbox('最高学历', Boolean(item.isHighest), (checked) => {
        item.isHighest = checked;
      }),
      createBoundCheckbox('第一学历', Boolean(item.isFirstDegree), (checked) => {
        item.isFirstDegree = checked;
      }),
      createBoundSelect('学习形式', item.studyMode ?? '', STUDY_MODE_OPTIONS, (value) => {
        item.studyMode = value;
      }),
      createBoundSelect(
        '学位',
        item.academicDegree ?? '',
        ACADEMIC_DEGREE_OPTIONS,
        (value) => {
          item.academicDegree = value;
          if (isDualAcademicDegree(value) && !item.secondDegree) {
            item.secondDegree = {
              school: '',
              major: '',
              degreeLevel: '',
              academicDegree: '',
              college: '',
              startDate: '',
              endDate: '',
              description: '',
            };
          }
          onRefresh();
        },
      ),
      createBoundInput('学院', item.college ?? '', (value) => {
        item.college = value;
      }),
      createBoundInput('学制(年)', item.durationYears ?? '', (value) => {
        item.durationYears = value;
      }),
      createBoundRegionField(
        '就读城市',
        item.city ?? '',
        item.cityRegion,
        (selection, displayText) => {
          item.city = displayText;
          item.cityRegion = selection ?? undefined;
        },
      ),
      createBoundInput('GPA', item.gpa ?? '', (value) => {
        item.gpa = value;
      }),
      createBoundInput('排名', item.rank ?? '', (value) => {
        item.rank = value;
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
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    card.appendChild(grid);

    // 双学位：展开第二学位子卡片
    if (isDualAcademicDegree(item.academicDegree)) {
      if (!item.secondDegree) {
        item.secondDegree = {
          school: '',
          major: '',
          degreeLevel: '',
          academicDegree: '',
          college: '',
          startDate: '',
          endDate: '',
          description: '',
        };
      }
      const second = item.secondDegree;
      const secondBlock = document.createElement('div');
      secondBlock.className = 'second-degree-block';
      const secondTitle = document.createElement('p');
      secondTitle.className = 'second-degree-title';
      secondTitle.textContent = '第二学位信息';
      const secondGrid = createCardGrid();
      secondGrid.append(
        createBoundInput('第二学位学校', second.school, (value) => {
          second.school = value;
        }, 'text', true),
        createBoundInput('第二学位专业', second.major, (value) => {
          second.major = value;
        }, 'text', true),
        createBoundSelect(
          '第二学历层次',
          second.degreeLevel,
          DEGREE_LEVEL_OPTIONS,
          (value) => {
            second.degreeLevel = value;
          },
        ),
        createBoundSelect(
          '第二学位类型',
          second.academicDegree ?? '',
          ACADEMIC_DEGREE_OPTIONS.filter((option) => option.code !== 'dual'),
          (value) => {
            second.academicDegree = value;
          },
        ),
        createBoundInput('第二学院', second.college ?? '', (value) => {
          second.college = value;
        }),
        createBoundInput('第二入学日期', second.startDate ?? '', (value) => {
          second.startDate = value;
        }, 'date'),
        createBoundInput('第二毕业日期', second.endDate ?? '', (value) => {
          second.endDate = value;
        }, 'date'),
        createBoundTextarea('第二学位说明', second.description ?? '', (value) => {
          second.description = value;
        }),
      );
      secondBlock.append(secondTitle, secondGrid);
      card.appendChild(secondBlock);
    }

    host.appendChild(card);
  });
}

function renderExperienceRows(
  items: ExperienceItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
  attachmentContext?: ListAttachmentContext,
): void {
  host.replaceChildren();
  const experienceGroups = [
    {
      headingText: '实习经历',
      titlePrefix: '实习',
      groupItems: items.filter((item) => isInternshipExperience(item)),
    },
    {
      headingText: '工作经历',
      titlePrefix: '工作',
      groupItems: items.filter((item) => !isInternshipExperience(item)),
    },
  ];
  for (const experienceGroup of experienceGroups) {
    const groupHeading = document.createElement('h4');
    groupHeading.textContent = experienceGroup.headingText;
    host.appendChild(groupHeading);
    experienceGroup.groupItems.forEach((item, groupIndex) => {
    const itemIndex = items.indexOf(item);
    const itemId = ensureItemId(item);
    const locked = Boolean(item.editingLocked);
    const card = createLockableListItemCard({
      titleText: `${experienceGroup.titlePrefix} ${groupIndex + 1}`,
      locked,
      onSaveItem: () => {
        item.editingLocked = true;
        onRefresh();
      },
      onEditItem: () => {
        item.editingLocked = false;
        onRefresh();
      },
      onRemove: () => {
        removeLockableItem(items, itemIndex, attachmentContext, onRefresh);
      },
    });

    if (locked) {
      card.appendChild(
        createReadonlySummary([
          { label: '公司', value: item.company },
          { label: '职位', value: item.title },
          { label: '起止', value: `${item.startDate || '—'} ~ ${item.isCurrent ? '至今' : item.endDate || '—'}` },
          { label: '行业', value: item.industry ?? '' },
          { label: '城市', value: item.city ?? '' },
          { label: '职责', value: item.responsibilities ?? '' },
          { label: '内容', value: item.workContent ?? '' },
          { label: '业绩', value: item.achievements ?? '' },
          { label: '涉及技能', value: item.skillsInvolved ?? '' },
          { label: '总述', value: item.description },
          { label: '附件备注', value: item.attachmentNote ?? '' },
          { label: '网盘', value: item.cloudLink ?? '' },
        ]),
      );
      appendItemAttachmentSlot(
        card,
        attachmentContext,
        'internship',
        itemId,
        true,
      );
      host.appendChild(card);
      return;
    }

    const grid = createCardGrid();
    grid.append(
      createBoundInput('公司/单位', item.company, (value) => {
        item.company = value;
      }),
      createBoundInput('职位', item.title, (value) => {
        item.title = value;
      }),
      createBoundInput('开始日期', item.startDate, (value) => {
        item.startDate = value;
      }, 'date'),
      createBoundInput('结束日期', item.endDate, (value) => {
        item.endDate = value;
      }, 'date'),
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
      createBoundSelect('所属行业', item.industry ?? '', INDUSTRY_OPTIONS, (value) => {
        item.industry = value;
      }),
      createBoundSelect('公司性质', item.companyType ?? '', COMPANY_TYPE_OPTIONS, (value) => {
        item.companyType = value;
      }),
      createBoundInput('部门', item.department ?? '', (value) => {
        item.department = value;
      }),
      createBoundRegionField(
        '城市',
        item.city ?? '',
        item.cityRegion,
        (selection, displayText) => {
          item.city = displayText;
          item.cityRegion = selection ?? undefined;
        },
      ),
      createBoundInput('证明人', item.refereeName ?? '', (value) => {
        item.refereeName = value;
      }),
      createBoundInput('证明人电话', item.refereePhone ?? '', (value) => {
        item.refereePhone = value;
      }, 'tel'),
      createBoundInput('离职原因', item.leaveReason ?? '', (value) => {
        item.leaveReason = value;
      }),
      createBoundTextarea('工作职责', item.responsibilities ?? '', (value) => {
        item.responsibilities = value;
      }),
      createBoundTextarea('工作内容', item.workContent ?? '', (value) => {
        item.workContent = value;
      }),
      createBoundTextarea('业绩/成果', item.achievements ?? '', (value) => {
        item.achievements = value;
      }),
      createBoundTextarea('总述', item.description, (value) => {
        item.description = value;
      }),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    appendItemNoteFields(grid, item);
    card.appendChild(grid);
    appendItemAttachmentSlot(
      card,
      attachmentContext,
      'internship',
      itemId,
      false,
      '.pdf,.jpg,.jpeg,.png,image/*,application/pdf',
    );
    host.appendChild(card);
    });
  }
}

function renderProjectRows(
  items: ProjectItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
  attachmentContext?: ListAttachmentContext,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const itemId = ensureItemId(item);
    const locked = Boolean(item.editingLocked);
    const card = createLockableListItemCard({
      titleText: `项目 ${itemIndex + 1}`,
      locked,
      onSaveItem: () => {
        item.editingLocked = true;
        onRefresh();
      },
      onEditItem: () => {
        item.editingLocked = false;
        onRefresh();
      },
      onRemove: () => {
        removeLockableItem(items, itemIndex, attachmentContext, onRefresh);
      },
    });

    if (locked) {
      card.appendChild(
        createReadonlySummary([
          { label: '名称', value: item.name },
          { label: '角色', value: item.role ?? '' },
          { label: '职责', value: item.duty ?? '' },
          { label: '起止', value: `${item.startDate || '—'} ~ ${item.isCurrent ? '进行中' : item.endDate || '—'}` },
          { label: '技术栈', value: item.techStack ?? '' },
          { label: '内容', value: item.content ?? '' },
          { label: '价值', value: item.value ?? '' },
          { label: '总述', value: item.description },
          { label: '链接', value: item.link ?? '' },
          { label: '附件备注', value: item.attachmentNote ?? '' },
          { label: '网盘', value: item.cloudLink ?? '' },
        ]),
      );
      appendItemAttachmentSlot(card, attachmentContext, 'project', itemId, true);
      host.appendChild(card);
      return;
    }

    const grid = createCardGrid();
    grid.append(
      createBoundInput('项目名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('角色', item.role ?? '', (value) => {
        item.role = value;
      }),
      createBoundInput(
        '职责',
        item.duty ?? '',
        (value) => {
          item.duty = value;
        },
        'text',
        false,
        '12个字以内',
        12,
      ),
      createBoundInput('开始日期', item.startDate ?? '', (value) => {
        item.startDate = value;
      }, 'date'),
      createBoundInput('结束日期', item.endDate ?? '', (value) => {
        item.endDate = value;
      }, 'date'),
      createBoundCheckbox('进行中', Boolean(item.isCurrent), (checked) => {
        item.isCurrent = checked;
      }),
      createBoundInput('链接', item.link ?? '', (value) => {
        item.link = value;
      }, 'url'),
      createBoundInput('技术栈', item.techStack ?? '', (value) => {
        item.techStack = value;
      }),
      createBoundInput('团队规模', item.teamSize ?? '', (value) => {
        item.teamSize = value;
      }),
      createBoundTextarea('项目内容', item.content ?? '', (value) => {
        item.content = value;
      }),
      createBoundTextarea('项目价值/成果', item.value ?? '', (value) => {
        item.value = value;
      }),
      createBoundTextarea('总述', item.description, (value) => {
        item.description = value;
      }),
    );
    appendItemNoteFields(grid, item);
    card.appendChild(grid);
    appendItemAttachmentSlot(
      card,
      attachmentContext,
      'project',
      itemId,
      false,
      '.pdf,.doc,.docx,.zip,.jpg,.jpeg,.png,application/pdf',
    );
    host.appendChild(card);
  });
}

function renderCampusRows(
  items: CampusActivityItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`校园经历 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('组织/社团', item.organization, (value) => {
        item.organization = value;
      }),
      createBoundInput('职务', item.role, (value) => {
        item.role = value;
      }),
      createBoundInput('开始日期', item.startDate ?? '', (value) => {
        item.startDate = value;
      }, 'date'),
      createBoundInput('结束日期', item.endDate ?? '', (value) => {
        item.endDate = value;
      }, 'date'),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderSkillRows(
  items: SkillItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`技能 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('技能名称', item.name, (value) => {
        item.name = value;
      }, 'text', true),
      createBoundSelect('熟练度', item.level ?? '', SKILL_LEVEL_OPTIONS, (value) => {
        item.level = value;
      }),
      createBoundInput('年限', item.years ?? '', (value) => {
        item.years = value;
      }),
      createBoundInput('分类', item.category ?? '', (value) => {
        item.category = value;
      }),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderLanguageRows(
  items: LanguageItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`语言 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('语种', item.language, (value) => {
        item.language = value;
      }),
      createBoundSelect('熟练度', item.proficiency, LANGUAGE_PROFICIENCY_OPTIONS, (value) => {
        item.proficiency = value;
      }),
      createBoundSelect('证书', item.certificate ?? '', LANGUAGE_CERT_OPTIONS, (value) => {
        item.certificate = value;
      }),
      createBoundInput('成绩', item.score ?? '', (value) => {
        item.score = value;
      }),
      createBoundInput('获证日期', item.obtainedDate ?? '', (value) => {
        item.obtainedDate = value;
      }, 'date'),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderCertificateRows(
  items: CertificateItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
  attachmentContext?: ListAttachmentContext,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const itemId = ensureItemId(item);
    const locked = Boolean(item.editingLocked);
    const card = createLockableListItemCard({
      titleText: `证书 ${itemIndex + 1}`,
      locked,
      onSaveItem: () => {
        item.editingLocked = true;
        onRefresh();
      },
      onEditItem: () => {
        item.editingLocked = false;
        onRefresh();
      },
      onRemove: () => {
        removeLockableItem(items, itemIndex, attachmentContext, onRefresh);
      },
    });

    if (locked) {
      card.appendChild(
        createReadonlySummary([
          { label: '名称', value: item.name },
          { label: '等级', value: item.level ?? '' },
          { label: '颁发机构', value: item.issuer ?? '' },
          { label: '获证日期', value: item.date ?? '' },
          { label: '有效期至', value: item.expireDate ?? '' },
          { label: '编号', value: item.number ?? '' },
          { label: '说明', value: item.description ?? '' },
          { label: '涉及技能', value: item.skillsInvolved ?? '' },
          { label: '附件备注', value: item.attachmentNote ?? '' },
          { label: '网盘', value: item.cloudLink ?? '' },
        ]),
      );
      appendItemAttachmentSlot(
        card,
        attachmentContext,
        'certificate',
        itemId,
        true,
      );
      host.appendChild(card);
      return;
    }

    const grid = createCardGrid();
    grid.append(
      createBoundSelect('证书名称', item.name, COMMON_CERTIFICATE_OPTIONS, (value) => {
        item.name = value;
      }),
      createBoundInput('等级', item.level ?? '', (value) => {
        item.level = value;
      }),
      createBoundInput('颁发机构', item.issuer ?? '', (value) => {
        item.issuer = value;
      }),
      createBoundInput('获证日期', item.date ?? '', (value) => {
        item.date = value;
      }, 'date'),
      createBoundInput('有效期至', item.expireDate ?? '', (value) => {
        item.expireDate = value;
      }, 'date'),
      createBoundInput('证书编号', item.number ?? '', (value) => {
        item.number = value;
      }),
      createBoundInput('相关专业', item.major ?? '', (value) => {
        item.major = value;
      }),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    appendItemNoteFields(grid, item);
    card.appendChild(grid);
    appendItemAttachmentSlot(
      card,
      attachmentContext,
      'certificate',
      itemId,
      false,
      '.pdf,.jpg,.jpeg,.png,image/*,application/pdf',
    );
    host.appendChild(card);
  });
}

function renderAwardRows(
  items: AwardItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
  attachmentContext?: ListAttachmentContext,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const itemId = ensureItemId(item);
    const locked = Boolean(item.editingLocked);
    const card = createLockableListItemCard({
      titleText: `奖项 ${itemIndex + 1}`,
      locked,
      onSaveItem: () => {
        item.editingLocked = true;
        onRefresh();
      },
      onEditItem: () => {
        item.editingLocked = false;
        onRefresh();
      },
      onRemove: () => {
        removeLockableItem(items, itemIndex, attachmentContext, onRefresh);
      },
    });

    if (locked) {
      card.appendChild(
        createReadonlySummary([
          { label: '名称', value: item.name },
          { label: '级别', value: item.level ?? '' },
          { label: '奖次', value: labelOfCatalog(AWARD_PRIZE_OPTIONS, item.prizeRank ?? '') },
          { label: '日期', value: item.date ?? '' },
          { label: '颁发单位', value: item.issuer ?? '' },
          { label: '说明', value: item.description ?? '' },
          { label: '涉及技能', value: item.skillsInvolved ?? '' },
          { label: '附件备注', value: item.attachmentNote ?? '' },
          { label: '网盘', value: item.cloudLink ?? '' },
        ]),
      );
      appendItemAttachmentSlot(card, attachmentContext, 'award', itemId, true);
      host.appendChild(card);
      return;
    }

    const grid = createCardGrid();
    grid.append(
      createBoundInput('奖项名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundSelect('级别', item.level ?? '', AWARD_LEVEL_OPTIONS, (value) => {
        item.level = value;
      }),
      createBoundSelect('奖次', item.prizeRank ?? '', AWARD_PRIZE_OPTIONS, (value) => {
        item.prizeRank = value;
      }),
      createBoundInput('获奖日期', item.date ?? '', (value) => {
        item.date = value;
      }, 'date'),
      createBoundInput('颁发单位', item.issuer ?? '', (value) => {
        item.issuer = value;
      }),
      createBoundTextarea('说明', item.description ?? '', (value) => {
        item.description = value;
      }),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    appendItemNoteFields(grid, item);
    card.appendChild(grid);
    appendItemAttachmentSlot(
      card,
      attachmentContext,
      'award',
      itemId,
      false,
      '.pdf,.jpg,.jpeg,.png,image/*,application/pdf',
    );
    host.appendChild(card);
  });
}

function renderPublicationRows(
  items: PublicationItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`成果 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundSelect('类型', item.kind, PUBLICATION_KIND_OPTIONS, (value) => {
        item.kind = value;
      }),
      createBoundInput('标题', item.title, (value) => {
        item.title = value;
      }),
      createBoundInput('期刊/专利号', item.venueOrNumber ?? '', (value) => {
        item.venueOrNumber = value;
      }),
      createBoundInput('日期', item.date ?? '', (value) => {
        item.date = value;
      }, 'date'),
      createBoundInput('作者排序', item.authorOrder ?? '', (value) => {
        item.authorOrder = value;
      }),
      createBoundInput('链接', item.link ?? '', (value) => {
        item.link = value;
      }, 'url'),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderTrainingRows(
  items: TrainingItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`培训 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('培训机构', item.organization, (value) => {
        item.organization = value;
      }),
      createBoundInput('课程', item.course, (value) => {
        item.course = value;
      }),
      createBoundInput('开始日期', item.startDate ?? '', (value) => {
        item.startDate = value;
      }, 'date'),
      createBoundInput('结束日期', item.endDate ?? '', (value) => {
        item.endDate = value;
      }, 'date'),
      createBoundInput('结业证书', item.certificate ?? '', (value) => {
        item.certificate = value;
      }),
      createSkillsInvolvedInput(item.skillsInvolved, (value) => {
        item.skillsInvolved = value;
      }),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderFamilyRows(
  items: FamilyMemberItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`家庭成员 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundSelect('关系', item.relationship, FAMILY_RELATION_OPTIONS, (value) => {
        item.relationship = value;
      }),
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
      createBoundInput('电话', item.phone ?? '', (value) => {
        item.phone = value;
      }, 'tel'),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderEmergencyRows(
  items: EmergencyContact[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`紧急联系人 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('姓名', item.name, (value) => {
        item.name = value;
      }),
      createBoundSelect('关系', item.relationship, FAMILY_RELATION_OPTIONS, (value) => {
        item.relationship = value;
      }),
      createBoundInput('电话', item.phone, (value) => {
        item.phone = value;
      }, 'tel'),
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

/**
 * 向草稿追加一条对应类型空白列表项。
 */
export function appendListItem(
  draft: ProfileData,
  listKind: string,
): void {
  switch (listKind) {
    case 'education':
      draft.education.push(createEmptyEducationItem());
      break;
    case 'internship':
      draft.experience.push(createEmptyExperienceItem('internship'));
      break;
    case 'work':
      draft.experience.push(createEmptyExperienceItem('full_time'));
      break;
    case 'projects':
      draft.projects.push(createEmptyProjectItem());
      break;
    case 'campus':
      draft.campusActivities.push({
        organization: '',
        role: '',
        startDate: '',
        endDate: '',
        description: '',
        skillsInvolved: '',
      });
      break;
    case 'skills':
      draft.skills.push(createEmptySkillItem());
      break;
    case 'language':
      draft.languages.push({
        language: '',
        proficiency: '',
        certificate: '',
        score: '',
        obtainedDate: '',
      });
      break;
    case 'certificate':
      draft.certificates.push(createEmptyCertificateItem());
      break;
    case 'award':
      draft.awards.push(createEmptyAwardItem());
      break;
    case 'publication':
      draft.publications.push({
        kind: '',
        title: '',
        venueOrNumber: '',
        date: '',
        authorOrder: '',
        link: '',
        skillsInvolved: '',
      });
      break;
    case 'training':
      draft.trainings.push({
        organization: '',
        course: '',
        startDate: '',
        endDate: '',
        certificate: '',
        skillsInvolved: '',
      });
      break;
    case 'family':
      draft.familyMembers.push({
        relationship: '',
        name: '',
        age: '',
        politicalStatus: '',
        employer: '',
        title: '',
        phone: '',
      });
      break;
    case 'emergency':
      draft.emergencyContacts.push(createEmptyEmergencyContact());
      break;
    default:
      break;
  }
}
