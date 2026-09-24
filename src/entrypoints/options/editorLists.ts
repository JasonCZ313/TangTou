/**
 * Options 档案编辑区动态列表渲染：教育（含双学位）、实习、项目、技能等。
 */
import {
  ACADEMIC_DEGREE_OPTIONS,
  AWARD_LEVEL_OPTIONS,
  COMMON_CERTIFICATE_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  DEGREE_LEVEL_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  FAMILY_RELATION_OPTIONS,
  INDUSTRY_OPTIONS,
  LANGUAGE_CERT_OPTIONS,
  LANGUAGE_PROFICIENCY_OPTIONS,
  POLITICAL_STATUS_OPTIONS,
  PUBLICATION_KIND_OPTIONS,
  SKILL_LEVEL_OPTIONS,
  STUDY_MODE_OPTIONS,
} from '../../shared/catalogs/enums';
import { isDualAcademicDegree } from '../../shared/storage/normalize';
import type {
  AwardItem,
  CampusActivityItem,
  CertificateItem,
  EducationItem,
  EmergencyContact,
  ExperienceItem,
  FamilyMemberItem,
  LanguageItem,
  ProfileData,
  ProjectItem,
  PublicationItem,
  SkillItem,
  TrainingItem,
} from '../../shared/types/profile';
import {
  createBoundCheckbox,
  createBoundInput,
  createBoundSelect,
  createBoundTextarea,
  createListItemCard,
} from './editorWidgets';
import { createBoundRegionField } from './regionCascader';

/** 创建网格容器 */
function createCardGrid(): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  return grid;
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

export function createEmptyExperienceItem(): ExperienceItem {
  return {
    company: '',
    title: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    description: '',
    responsibilities: '',
    workContent: '',
    achievements: '',
    industry: '',
  };
}

export function createEmptyProjectItem(): ProjectItem {
  return {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    description: '',
    content: '',
    value: '',
    link: '',
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
): void {
  renderEducationRows(data.education, hosts.education, onRefresh);
  renderExperienceRows(data.experience, hosts.experience, onRefresh);
  renderProjectRows(data.projects, hosts.projects, onRefresh);
  renderCampusRows(data.campusActivities, hosts.campus, onRefresh);
  renderSkillRows(data.skills, hosts.skills, onRefresh);
  renderLanguageRows(data.languages, hosts.language, onRefresh);
  renderCertificateRows(data.certificates, hosts.certificate, onRefresh);
  renderAwardRows(data.awards, hosts.award, onRefresh);
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
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`工作/实习 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
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
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderProjectRows(
  items: ProjectItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`项目 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('项目名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundInput('角色', item.role ?? '', (value) => {
        item.role = value;
      }),
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
    card.appendChild(grid);
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
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`证书 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
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
    );
    card.appendChild(grid);
    host.appendChild(card);
  });
}

function renderAwardRows(
  items: AwardItem[],
  host: HTMLDivElement,
  onRefresh: () => void,
): void {
  host.replaceChildren();
  items.forEach((item, itemIndex) => {
    const card = createListItemCard(`奖项 ${itemIndex + 1}`, () => {
      items.splice(itemIndex, 1);
      onRefresh();
    });
    const grid = createCardGrid();
    grid.append(
      createBoundInput('奖项名称', item.name, (value) => {
        item.name = value;
      }),
      createBoundSelect('级别', item.level ?? '', AWARD_LEVEL_OPTIONS, (value) => {
        item.level = value;
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
    );
    card.appendChild(grid);
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
    case 'experience':
      draft.experience.push(createEmptyExperienceItem());
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
      draft.certificates.push({
        name: '',
        level: '',
        issuer: '',
        date: '',
        expireDate: '',
        number: '',
        major: '',
        description: '',
      });
      break;
    case 'award':
      draft.awards.push({
        name: '',
        level: '',
        date: '',
        issuer: '',
        description: '',
      });
      break;
    case 'publication':
      draft.publications.push({
        kind: '',
        title: '',
        venueOrNumber: '',
        date: '',
        authorOrder: '',
        link: '',
      });
      break;
    case 'training':
      draft.trainings.push({
        organization: '',
        course: '',
        startDate: '',
        endDate: '',
        certificate: '',
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
