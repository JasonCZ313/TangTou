# 通用站点 AI 简历自动填写扩展 — 设计规格

**日期：** 2026-09-23  
**状态：** 已批准  
**产品名（工作名）：** Resume Autofill（仓库建议名：`resume-autofill`）  
**目标平台：** Microsoft Edge / Google Chrome（Manifest V3，WebExtensions 兼容）

---

## 1. 背景与目标

用户在招聘网站、公司官网投递页反复填写同类信息。本扩展让用户在本机维护最多 5 份可命名档案，自备 OpenAI 兼容 API Key，在任意网页上一键扫描表单并由 AI 辅助映射填写。

### 1.1 成功标准

- 无自建服务器；档案与 API Key 仅存用户本机。
- 通用站点可用：以 DOM 扫描为主，不依赖单站硬编码即可完成多数标准表单。
- 默认「预览后写入」；可切换「直接填写」。
- 最多 5 份档案；可改名；新建时可从已有档案深拷贝再改。
- 绝不自动提交表单。
- 仓库结构、命名、文档符合常见开源扩展规范，便于上传 GitHub 与后续上架。

### 1.2 非目标（第一期不做）

- 开发者托管的后端、账号体系、云端同步。
- Claude / Gemini 等非 OpenAI 兼容的原生协议适配。
- OCR / 截图识表作为主路径。
- 自动点击「提交 / 投递」。
- 超过 5 份档案。
- 针对单一招聘站的深度逆向或破解反爬（合法 DOM 交互范围内工作）。

---

## 2. 已确认产品决策

| 决策点 | 选择 |
|--------|------|
| UI 形态 | 混合：Popup 一键 + Options 管理 + Side Panel 预览与精细控制 |
| 填写安全策略 | 默认预览确认；设置中可开「直接填写」 |
| 大模型接入 | 仅 OpenAI 兼容（Base URL + API Key + 模型名） |
| 档案组织 | 结构化字段 + 可选「补充说明」自由文本 |
| 多档案 | 最多 5 份；可命名；创建可从已有深拷贝 |
| 后端 | 无 |
| 工程栈 | WXT + TypeScript |

---

## 3. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  UI                                                      │
│  Popup          Side Panel           Options             │
│  选档案/一键填   映射预览/编辑写入    档案CRUD/API/模式   │
└──────────────────────────┬──────────────────────────────┘
                           │ chrome.runtime messaging
┌──────────────────────────▼──────────────────────────────┐
│  Background Service Worker（编排中枢）                     │
│  · storage 读写与 5 份上限校验                            │
│  · 调用 OpenAI 兼容 Chat Completions                     │
│  · API Key 仅在此上下文使用，不注入页面                    │
│  · 错误归一化为可展示文案                                 │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Content Script（任意 http/https 页）                     │
│  · 扫描可见表单控件 → FieldDescriptor[]                   │
│  · 按 FillPlan 安全写入（含框架兼容事件）                  │
│  · 高亮已填字段；支持撤销本轮填写                         │
└─────────────────────────────────────────────────────────┘
                           │
                  chrome.storage.local
            settings + profiles[0..5]
```

### 3.1 职责边界

| 单元 | 职责 | 不负责 |
|------|------|--------|
| Popup | 选档案、触发扫描/填写、展示简要状态 | 直接持有 API Key 调模型（经 background） |
| Side Panel | 展示字段映射、允许改值后确认写入、撤销 | 持久化业务规则外的逻辑 |
| Options | 档案 CRUD/改名/复制、API 配置、fillMode | 页面 DOM 操作 |
| Background | 编排、LLM、storage 权威读写 | 操作页面 DOM |
| Content | DOM 扫描与写入 | 存储 Key、发起带 Key 的网络请求 |
| shared/* | 类型、消息协议、纯函数 | 浏览器入口副作用 |

### 3.2 安全原则

1. **API Key 隔离**：只写入 `chrome.storage.local`，只由 Background 读取并用于 `fetch`；Content Script 消息载荷中不得包含 Key。
2. **最小权限（第一期明确选择）**：
   - 权限：`storage`、`sidePanel`、`scripting`。
   - 内容脚本：因「通用任意站点」，`host_permissions` / `content_scripts.matches` 使用 `http://*/*` 与 `https://*/*`（上架文案需说明为何需要访问网页以读取表单）。
   - LLM：Background `fetch` 发往用户配置的 `apiBaseUrl`；第一期对扩展外请求采用 Manifest 允许的主机权限策略——在 `optional_host_permissions` 中声明 `https://*/*`（及可选 `http://*/*` 供本地 Ollama），首次测连或填写前按需请求授权，避免把 Key 相关流量绑死在单一厂商域名。
3. **不自动提交**：写入控件后停止；不模拟点击 submit。
4. **隐私说明**：README 明确「数据不出开发者服务器；请求发往用户配置的 API 地址」。

---

## 4. 多档案规则

### 4.1 容量与标识

- `profiles.length` 最大为 **5**。
- 每份档案：`id`（UUID）、`name`（展示名，可改）、`createdAt`、`updatedAt`、`data`。
- 全局 `settings.activeProfileId` 指向当前默认选用档案；可为 `null`（无档案时）。

### 4.2 操作

| 操作 | 行为 |
|------|------|
| 新建（空白） | 若未满 5，创建默认名（如「档案 2」）与空 `data` |
| 新建（从已有复制） | 深拷贝源档案 `data`；新 `id`；用户指定新名称；源档案不变 |
| 改名 | 只改 `name`，不改 `id` |
| 编辑 | 更新 `data` 与 `updatedAt` |
| 删除 | 移除该份；若删的是 `activeProfileId`，则切换到列表第一份或 `null` |
| 设为默认 | 更新 `activeProfileId` |

### 4.3 填写时选择

- Popup / Side Panel 提供档案下拉（显示 `name`）。
- 默认选中 `activeProfileId`；用户可临时改选；可选「设为默认」。
- 本轮填写只注入所选档案的 `data`（含补充说明）。

### 4.4 导入 / 导出

- **导出单份** / **导出全部**（含 `profiles`，可选是否包含 settings；**导出包默认不含 apiKey**，或导出时明确警告并默认剔除 Key）。
- **导入**：合并前校验总数 ≤ 5；超出时阻断并提示先删除；同 `id` 可选择跳过或覆盖。

---

## 5. 数据模型

```ts
/** 填写模式：预览确认 或 直接写入 */
type FillMode = 'preview' | 'direct';

/** 全局设置（与档案分离） */
interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  fillMode: FillMode;
  activeProfileId: string | null;
}

/** 结构化档案正文 + 补充说明 */
interface ProfileData {
  basic: {
    fullName: string;
    phone: string;
    email: string;
    city: string;
    birthday?: string;
    gender?: string;
    personalWebsite?: string;
  };
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: string[];
  jobIntent: {
    targetRole: string;
    expectedSalary?: string;
    availableDate?: string;
    workCity?: string;
  };
  /** 证书、自我评价等零散信息，供模型参考 */
  notes: string;
}

interface EducationItem {
  school: string;
  degree: string;
  major: string;
  startDate: string;
  endDate: string;
  description?: string;
}

interface ExperienceItem {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface ProjectItem {
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  description: string;
  link?: string;
}

interface Profile {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  data: ProfileData;
}

interface StorageRoot {
  settings: AppSettings;
  profiles: Profile[]; // 0..5
}
```

存储键建议：`settings`、`profiles` 分 key 存放，避免单次读写过大；读写封装在 `shared/storage`，所有写路径强制 `profiles.length <= 5`。

---

## 6. 填写流水线

### 6.1 字段扫描（Content）

对当前文档（含可访问的同源 iframe，第一期可先做顶层 document，iframe 作为增强）收集可见的：

- `input`（排除 hidden / submit / button / file 除非后续明确支持）
- `textarea`
- `select`
- `contenteditable`
- 常见自定义组件：尽量通过关联 `label`、`aria-label`、`placeholder`、邻近文本描述

每个字段生成：

```ts
interface FieldDescriptor {
  fieldId: string;       // 扩展生成的稳定会话内 id
  tag: string;
  type: string;
  name?: string;
  label: string;         // 归一化后的人类可读标签
  placeholder?: string;
  options?: string[];    // select / radio 选项文案
  currentValue?: string;
  required?: boolean;
  // 用于回填的定位提示（不把脆弱 xpath 当作唯一依据）
  selectorHint: string;
}
```

### 6.2 匹配策略（Background）

1. **本地启发式（可选第一期简化版）**：对邮箱、电话、姓名等高置信标签直接从档案映射，降低 Token。
2. **LLM 映射**：将 `FieldDescriptor[]`（可脱敏掉无关键属性）+ 所选 `ProfileData` 发给模型，要求 **严格 JSON** 输出：

```ts
interface FillMappingItem {
  fieldId: string;
  value: string;
  confidence: number; // 0..1
  reason?: string;
}

interface FillPlan {
  items: FillMappingItem[];
  skippedFieldIds: string[];
}
```

3. **预览模式**：把 `FillPlan` 发给 Side Panel / Popup，用户可改 `value` 后确认。
4. **直接模式**：跳过确认，Content 立即执行写入，并支持撤销。

### 6.3 安全写入（Content）

- 使用原生值设置方式兼容 React 等框架（设置 property + 派发 `input`/`change`）。
- 记录本轮 `UndoSnapshot`（fieldId → 旧值），供「撤销本轮」。
- 视觉高亮已填字段；不点击提交按钮。

### 6.4 失败与降级

- 无 API Key / 网络错误 / 非 JSON 响应：UI 展示明确错误，不部分静默失败到不可知状态。
- 模型超时：可配置超时（默认建议 60s），失败后保留已扫描字段列表，便于重试。

---

## 7. UI 职责细节

### 7.1 Options

- API：Base URL、Key、模型名；测连（发最小 chat 请求）。
- 填写模式：`preview` | `direct`。
- 档案列表：名称、更新时间；新建（空白/复制）、改名、编辑、删除。
- 档案编辑器：分块表单 + `notes` 文本域；保存写入 storage。
- 导入 / 导出。

### 7.2 Popup

- 当前页快捷操作：选择档案 → 扫描并填写（按 fillMode）。
- 打开 Side Panel、打开 Options 的入口。
- 简短状态：成功数 / 跳过数 / 错误。

### 7.3 Side Panel

- 档案选择器。
- 映射表：字段标签、拟定值、置信度；可编辑后「确认写入」。
- 「撤销本轮填写」。
- 适合长时间停留在招聘页时使用。

---

## 8. 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 框架 | WXT | MV3 入口、HMR、Chrome/Edge 双端打包成熟 |
| 语言 | TypeScript | 消息与存储边界类型安全 |
| UI | 轻量实现（WXT 默认或 Vanilla/TS + CSS 变量） | 扩展 UI 面小，避免过重依赖；若需组件再引入 |
| 存储 | `chrome.storage.local` | 容量与持久化满足档案；无需服务器 |
| LLM | OpenAI Chat Completions 兼容 | 覆盖 DeepSeek / 通义兼容 / Ollama 等 |
| 包管理 | pnpm 或 npm（仓库锁定一种） | 锁文件保证可复现构建 |
| 质量 | ESLint + Prettier；`wxt build` CI 可选 | 开源协作标准 |
| 许可 | MIT（建议） | 便于 GitHub 分发 |

借鉴的**公开实践方向**（思路级，不复制代码）：

- Background 编排 + Content 只碰 DOM（Hugging Face / 社区 MV3 AI 扩展常见拆分）。
- 用户自备 Key、本地档案、不自动提交（开源填表类扩展的产品边界）。
- OpenAI 兼容单适配器降低维护面。
- 写入时派发合成事件以兼容现代前端框架。

---

## 9. 仓库结构（GitHub 标准）

```
resume-autofill/
├── README.md
├── LICENSE
├── package.json
├── pnpm-lock.yaml          # 或 package-lock.json
├── wxt.config.ts
├── tsconfig.json
├── .gitignore
├── .editorconfig
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-23-resume-autofill-extension-design.md
├── public/
│   └── icons/
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
└── src/
    ├── entrypoints/
    │   ├── background.ts
    │   ├── content.ts
    │   ├── popup/
    │   ├── options/
    │   └── sidepanel/
    ├── shared/
    │   ├── types/
    │   ├── storage/
    │   ├── llm/
    │   └── messaging/
    ├── content/
    │   ├── scanner/
    │   └── filler/
    └── assets/
```

约定：

- 源码与注释：关键逻辑使用**简体中文注释**说明用途。
- 标识符：英文语义化命名，禁止无意义单字母变量。
- 不提交 `.env`、真实 API Key、用户档案样例中的隐私数据。
- README 含：功能、本地加载扩展步骤（Edge/Chrome）、配置 API、隐私说明。

---

## 10. 消息协议（概要）

统一信封，便于扩展：

```ts
type Message =
  | { type: 'SCAN_FIELDS'; requestId: string }
  | { type: 'SCAN_FIELDS_RESULT'; requestId: string; fields: FieldDescriptor[] }
  | { type: 'BUILD_FILL_PLAN'; requestId: string; profileId: string; fields: FieldDescriptor[] }
  | { type: 'FILL_PLAN_RESULT'; requestId: string; plan: FillPlan }
  | { type: 'APPLY_FILL_PLAN'; requestId: string; plan: FillPlan }
  | { type: 'APPLY_FILL_RESULT'; requestId: string; filled: number; skipped: number }
  | { type: 'UNDO_LAST_FILL'; requestId: string }
  | { type: 'ERROR'; requestId: string; code: string; message: string };
```

Content ↔ Background ↔ UI 均走类型守卫解析；未知消息忽略并打日志。

---

## 11. 实现顺序

1. WXT 脚手架 + 三 UI 入口空壳 + 图标占位。
2. `shared/storage`：settings、profiles、五份上限、复制新建、改名。
3. Options：API 配置 + 档案管理 UI。
4. Content：scanner + filler + undo。
5. Background：LLM 客户端 + BUILD_FILL_PLAN。
6. Popup：选档案 + 按 fillMode 跑通主路径。
7. Side Panel：预览编辑确认。
8. 导入导出、错误文案、README / LICENSE。
9. 手动验收清单（通用 HTML 表单 + 1～2 个真实招聘站冒烟）。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 站点 DOM 极度定制 | 通用扫描尽力；映射预览可手改；后续可加站点适配层但不作为第一期阻塞 |
| Service Worker 休眠 | 短请求一次性完成；长请求注意 MV3 生命周期，避免依赖全局可变状态 |
| 模型胡填 | 默认预览；confidence 低的标出；禁止自动提交 |
| Key 泄露到页面 | Key 仅 Background；审查消息类型 |
| 存储满 5 份误操作 | UI 禁用新建并提示；删除需确认 |

---

## 13. 验收清单（第一期）

- [ ] 可创建至 5 份档案；第 6 份被拒绝并提示。
- [ ] 可将档案改名为「海投版」；从该档案复制新建第二份后修改，源档案内容不变。
- [ ] 配置 OpenAI 兼容 Key 后，在本地测试 HTML 表单上完成预览填写与直接填写。
- [ ] 撤销本轮填写可恢复写入前值。
- [ ] 导出 JSON 默认不含 apiKey（或明显警告后可选包含）。
- [ ] Edge 与 Chrome 均可 `wxt` 构建并加载 `dist`。
- [ ] README 可独立完成安装与配置，无需作者服务器。

---

## 14. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-23 | 初稿：混合 UI、预览/直填可切换、OpenAI 兼容、结构化+notes、最多 5 档案与复制新建；用户确认后落盘 |
| 2026-09-23 | 文档：根 README / MIT LICENSE / `docs/acceptance-checklist.md`；状态保持「已批准」 |
