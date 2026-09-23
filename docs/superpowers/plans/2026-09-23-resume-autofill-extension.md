# Resume Autofill Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Edge/Chrome MV3 扩展：本机最多 5 份可命名简历档案、用户自备 OpenAI 兼容 API Key、通用站点 DOM 扫描 + AI 映射填写（默认预览，可直填），无自建服务器。

**Architecture:** WXT + TypeScript；Background Service Worker 独占 API Key 与 LLM 调用；Content Script 负责字段扫描/安全写入/撤销；Popup / Side Panel / Options 经类型化消息与 Background 通信；`chrome.storage.local` 持久化 `settings` 与 `profiles`。

**Tech Stack:** WXT、TypeScript、Chrome Extensions MV3 API、OpenAI Chat Completions 兼容 HTTP、原生 CSS（无重 UI 框架）。

**Spec:** `docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md`

## Global Constraints

- 平台：Microsoft Edge / Google Chrome，Manifest V3。
- 工程根目录：仓库根（`m:\项目\躺投`），已有 `docs/` 保留不动。
- 包管理：npm（生成 `package-lock.json`）；Node ≥ 20。
- 语言：TypeScript strict；用户可见文案与代码注释用简体中文；标识符英文语义化，禁止无意义单字母变量名。
- 存储：`chrome.storage.local`；`profiles.length` 硬上限 5；导出默认剔除 `apiKey`。
- LLM：仅 OpenAI 兼容；Key 仅 Background 使用。
- 禁止：自动提交表单、自建后端、单元测试文件（用户要求；用 `npm run build` + 手动验收）。
- Shell：仅 Windows PowerShell / cmd 指令。
- Git：仅在用户明确要求时 commit；计划中的 commit 步骤标为「可选，需用户确认」。

---

## File Structure

```
package.json
wxt.config.ts
tsconfig.json
.gitignore
.editorconfig
LICENSE
README.md
public/icons/icon-16.png, icon-48.png, icon-128.png
src/shared/types/profile.ts          # Profile / ProfileData / AppSettings
src/shared/types/fill.ts             # FieldDescriptor / FillPlan / FillMappingItem
src/shared/types/messages.ts         # Message 联合类型
src/shared/storage/defaults.ts       # 空 ProfileData、默认 settings
src/shared/storage/profileStore.ts   # CRUD、复制、上限校验
src/shared/storage/settingsStore.ts  # settings 读写
src/shared/llm/openaiCompatible.ts   # chatCompletions + 解析 FillPlan
src/shared/llm/prompt.ts             # 系统/用户 prompt 组装
src/shared/messaging/send.ts         # 带 requestId 的发送封装
src/content/scanner/scanFields.ts    # DOM → FieldDescriptor[]
src/content/filler/fillFields.ts     # 应用 FillPlan、高亮、UndoSnapshot
src/content/filler/setNativeValue.ts # 框架兼容设值
src/entrypoints/background.ts
src/entrypoints/content.ts
src/entrypoints/popup/index.html
src/entrypoints/popup/main.ts
src/entrypoints/popup/style.css
src/entrypoints/options/index.html
src/entrypoints/options/main.ts
src/entrypoints/options/style.css
src/entrypoints/sidepanel/index.html
src/entrypoints/sidepanel/main.ts
src/entrypoints/sidepanel/style.css
fixtures/sample-form.html            # 本地验收用静态表单
```

---

### Task 1: 脚手架与 Manifest 权限骨架

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `.gitignore`, `.editorconfig`
- Create: `public/icons/icon-16.png`, `icon-48.png`, `icon-128.png`（可用同色简单 PNG 占位）
- Create: `src/entrypoints/background.ts`, `content.ts`
- Create: `src/entrypoints/popup/index.html`, `main.ts`, `style.css`
- Create: `src/entrypoints/options/index.html`, `main.ts`, `style.css`
- Create: `src/entrypoints/sidepanel/index.html`, `main.ts`, `style.css`

**Interfaces:**
- Consumes: 无
- Produces: 可 `npm run build` 的 WXT 项目；manifest 含 `storage`、`sidePanel`、`scripting`；content matches `http://*/*`、`https://*/*`；`optional_host_permissions`: `https://*/*`, `http://127.0.0.1/*`, `http://localhost/*`

- [ ] **Step 1: 初始化 npm + WXT**

在仓库根执行：

```powershell
cd "m:\项目\躺投"
npm create wxt@latest . -- --template vanilla
```

若交互式询问覆盖，选择保留已有 `docs/`。若脚手架拒绝非空目录，则手动创建 `package.json`：

```json
{
  "name": "resume-autofill",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:edge": "wxt -b edge",
    "build": "wxt build",
    "build:edge": "wxt build -b edge",
    "zip": "wxt zip",
    "postinstall": "wxt prepare"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "wxt": "^0.19.25"
  }
}
```

然后：

```powershell
npm install
```

- [ ] **Step 2: 写 `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

// WXT 扩展构建配置：声明权限、内容脚本匹配范围与侧边栏
export default defineConfig({
  modules: [],
  manifest: {
    name: 'Resume Autofill',
    description: '本机档案 + 用户自备 API Key，通用站点智能填写简历表单（不自动提交）。',
    permissions: ['storage', 'sidePanel', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],
    optional_host_permissions: [
      'https://*/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    action: {
      default_title: 'Resume Autofill',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
```

说明：WXT 会按 `src/entrypoints/*` 自动生成入口；若实际生成的 side panel 路径不同，以 `wxt build` 产物为准微调 `default_path`。

- [ ] **Step 3: 写最小入口文件**

`src/entrypoints/background.ts`：

```ts
// 后台服务工作者入口：后续在此注册消息与 Side Panel 行为
export default defineBackground(() => {
  // 点击扩展图标时打开侧边栏（便于预览模式）
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);

  console.log('[Resume Autofill] background ready');
});
```

`src/entrypoints/content.ts`：

```ts
// 内容脚本入口：后续挂载扫描与填写监听
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Resume Autofill] content ready');
  },
});
```

Popup / Options / Sidepanel 各放一个标题为对应名称的 HTML + `main.ts` 设置 `document.body` 文本「骨架已加载」。

- [ ] **Step 4: 构建验证**

```powershell
npm run build
npm run build:edge
```

Expected: 退出码 0；生成 `.output/chrome-mv3` 与 edge 产物（路径以 WXT 实际输出为准）。

- [ ] **Step 5: 提交（可选，需用户确认）**

```powershell
git add package.json package-lock.json wxt.config.ts tsconfig.json .gitignore .editorconfig public src
git commit -m "chore: scaffold WXT MV3 extension skeleton"
```

---

### Task 2: 共享类型与默认值

**Files:**
- Create: `src/shared/types/profile.ts`
- Create: `src/shared/types/fill.ts`
- Create: `src/shared/types/messages.ts`
- Create: `src/shared/storage/defaults.ts`

**Interfaces:**
- Consumes: 无
- Produces: `FillMode`, `AppSettings`, `ProfileData`, `Profile`, `StorageRoot`, `FieldDescriptor`, `FillMappingItem`, `FillPlan`, `ExtensionMessage`, `createEmptyProfileData()`, `DEFAULT_SETTINGS`, `MAX_PROFILES = 5`

- [ ] **Step 1: 实现 `profile.ts`**

按规格第 5 节完整写出 `EducationItem`、`ExperienceItem`、`ProjectItem`、`ProfileData`、`Profile`、`AppSettings`、`FillMode`、`StorageRoot`，全部 `export`。

- [ ] **Step 2: 实现 `fill.ts`**

```ts
/** 页面上扫描到的单个表单字段描述，供模型映射与回填定位 */
export interface FieldDescriptor {
  fieldId: string;
  tag: string;
  type: string;
  name?: string;
  label: string;
  placeholder?: string;
  options?: string[];
  currentValue?: string;
  required?: boolean;
  selectorHint: string;
}

/** 模型或用户确认后的单字段填写项 */
export interface FillMappingItem {
  fieldId: string;
  value: string;
  confidence: number;
  reason?: string;
}

/** 一轮填写计划 */
export interface FillPlan {
  items: FillMappingItem[];
  skippedFieldIds: string[];
}
```

- [ ] **Step 3: 实现 `messages.ts`**

```ts
import type { FieldDescriptor, FillPlan } from './fill';
import type { Profile, AppSettings } from './profile';

/** 扩展内部消息联合类型（UI / Background / Content） */
export type ExtensionMessage =
  | { type: 'SCAN_FIELDS'; requestId: string }
  | { type: 'SCAN_FIELDS_RESULT'; requestId: string; fields: FieldDescriptor[] }
  | {
      type: 'BUILD_FILL_PLAN';
      requestId: string;
      profileId: string;
      fields: FieldDescriptor[];
    }
  | { type: 'FILL_PLAN_RESULT'; requestId: string; plan: FillPlan }
  | { type: 'APPLY_FILL_PLAN'; requestId: string; plan: FillPlan }
  | {
      type: 'APPLY_FILL_RESULT';
      requestId: string;
      filled: number;
      skipped: number;
    }
  | { type: 'UNDO_LAST_FILL'; requestId: string }
  | { type: 'UNDO_FILL_RESULT'; requestId: string; restored: number }
  | { type: 'GET_STATE'; requestId: string }
  | {
      type: 'GET_STATE_RESULT';
      requestId: string;
      settings: AppSettings;
      profiles: Profile[];
    }
  | { type: 'OPEN_SIDE_PANEL'; requestId: string }
  | { type: 'TEST_API'; requestId: string }
  | { type: 'TEST_API_RESULT'; requestId: string; ok: boolean; detail: string }
  | {
      type: 'ERROR';
      requestId: string;
      code: string;
      message: string;
    };
```

- [ ] **Step 4: 实现 `defaults.ts`**

导出 `MAX_PROFILES = 5`、`createEmptyProfileData(): ProfileData`（全空字符串/空数组）、`DEFAULT_SETTINGS: AppSettings`（`apiBaseUrl: 'https://api.openai.com/v1'`，`apiKey: ''`，`model: 'gpt-4o-mini'`，`fillMode: 'preview'`，`activeProfileId: null`）。

- [ ] **Step 5: 构建验证**

```powershell
npm run build
```

Expected: PASS。

---

### Task 3: Storage — settings 与多档案（含复制 / 上限 5）

**Files:**
- Create: `src/shared/storage/settingsStore.ts`
- Create: `src/shared/storage/profileStore.ts`

**Interfaces:**
- Consumes: Task 2 类型与 defaults
- Produces:
  - `getSettings(): Promise<AppSettings>`
  - `saveSettings(partial: Partial<AppSettings>): Promise<AppSettings>`
  - `listProfiles(): Promise<Profile[]>`
  - `getProfile(profileId: string): Promise<Profile | null>`
  - `createProfile(options: { name: string; cloneFromId?: string }): Promise<Profile>`
  - `renameProfile(profileId: string, name: string): Promise<Profile>`
  - `updateProfileData(profileId: string, data: ProfileData): Promise<Profile>`
  - `deleteProfile(profileId: string): Promise<void>`
  - `setActiveProfileId(profileId: string | null): Promise<void>`
  - 错误：满 5 份时 `createProfile` throw `Error('PROFILE_LIMIT_REACHED')`

- [ ] **Step 1: 实现 `settingsStore.ts`**

用 `chrome.storage.local.get('settings')` / `set`；读不到则写回 `DEFAULT_SETTINGS`；`saveSettings` 做浅合并。

- [ ] **Step 2: 实现 `profileStore.ts` 核心逻辑**

```ts
import { MAX_PROFILES, createEmptyProfileData } from './defaults';
import type { Profile, ProfileData } from '../types/profile';
import { getSettings, saveSettings } from './settingsStore';

function createId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 读取全部档案列表；缺失时返回空数组 */
export async function listProfiles(): Promise<Profile[]> {
  const stored = await chrome.storage.local.get('profiles');
  const profiles = stored.profiles;
  return Array.isArray(profiles) ? (profiles as Profile[]) : [];
}

async function writeProfiles(profiles: Profile[]): Promise<void> {
  if (profiles.length > MAX_PROFILES) {
    throw new Error('PROFILE_LIMIT_REACHED');
  }
  await chrome.storage.local.set({ profiles });
}

/**
 * 创建档案：可空白，或从已有档案深拷贝 data 后再独立修改。
 * 已满 5 份时抛出 PROFILE_LIMIT_REACHED。
 */
export async function createProfile(options: {
  name: string;
  cloneFromId?: string;
}): Promise<Profile> {
  const profiles = await listProfiles();
  if (profiles.length >= MAX_PROFILES) {
    throw new Error('PROFILE_LIMIT_REACHED');
  }

  let data = createEmptyProfileData();
  if (options.cloneFromId) {
    const sourceProfile = profiles.find(
      (item) => item.id === options.cloneFromId,
    );
    if (!sourceProfile) {
      throw new Error('SOURCE_PROFILE_NOT_FOUND');
    }
    data = structuredClone(sourceProfile.data);
  }

  const timestamp = nowIso();
  const newProfile: Profile = {
    id: createId(),
    name: options.name.trim() || `档案 ${profiles.length + 1}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    data,
  };

  const nextProfiles = [...profiles, newProfile];
  await writeProfiles(nextProfiles);

  const settings = await getSettings();
  if (!settings.activeProfileId) {
    await saveSettings({ activeProfileId: newProfile.id });
  }

  return newProfile;
}

/** 删除档案；若删的是当前选用，则切到剩余第一份或 null */
export async function deleteProfile(profileId: string): Promise<void> {
  const profiles = await listProfiles();
  const nextProfiles = profiles.filter((item) => item.id !== profileId);
  await writeProfiles(nextProfiles);

  const settings = await getSettings();
  if (settings.activeProfileId === profileId) {
    await saveSettings({
      activeProfileId: nextProfiles[0]?.id ?? null,
    });
  }
}

// renameProfile / updateProfileData / getProfile / setActiveProfileId
// 按同样模式实现：改 name 不改 id；更新 data 时刷新 updatedAt
```

补全其余函数，逻辑与上一致。

- [ ] **Step 3: 手动逻辑自检（在 background 临时调用或 Options 未完成前用控制台）**

实现 Options 前，可在 `background.ts` 临时暴露调试（**合并 PR 前删除**），或等到 Task 4 用 UI 验证：

1. 连续创建 5 份成功。  
2. 第 6 份抛 `PROFILE_LIMIT_REACHED`。  
3. 将档案 1 改名为「海投版」，`createProfile({ name: '精投版', cloneFromId })` 后改精投版 `data.basic.fullName`，确认海投版姓名未变。

- [ ] **Step 4: 构建验证 + 可选提交**

```powershell
npm run build
```

---

### Task 4: Options 页 — API、填写模式、档案管理

**Files:**
- Modify: `src/entrypoints/options/index.html`
- Modify: `src/entrypoints/options/main.ts`
- Modify: `src/entrypoints/options/style.css`

**Interfaces:**
- Consumes: `profileStore` / `settingsStore` 全部公开函数
- Produces: 可用的 Options UI（不经过 Background 也可直接调 storage API，因 Options 在扩展页上下文）

- [ ] **Step 1: 布局 HTML**

分区：

1. API 设置：`apiBaseUrl`、`apiKey`（password）、`model`、按钮「保存」「测试连接」  
2. 填写模式：radio `preview` / `direct`  
3. 档案列表：名称、更新时间、「设为默认」「改名」「编辑」「删除」  
4. 新建：输入名称 + 下拉「空白 / 从某份复制」+「创建」  
5. 编辑区：折叠分块表单（basic / education / experience / projects / skills / jobIntent / notes）+ 保存  
6. 导入导出：导出全部（剔除 key）、导入 JSON

- [ ] **Step 2: 绑定 `main.ts`**

- 页面加载：`listProfiles` + `getSettings` 渲染。  
- 保存 settings：`saveSettings`。  
- 测试连接：`chrome.runtime.sendMessage({ type: 'TEST_API', requestId })`（Task 6 实现；此处先做按钮，未实现时显示「后台未就绪」）。  
- 创建/复制/改名/删除/更新：调用 Task 3 API；捕获 `PROFILE_LIMIT_REACHED` 显示中文「最多保存 5 份档案」。  
- 导出：

```ts
const exportPayload = {
  version: 1,
  profiles: await listProfiles(),
  settings: { ...(await getSettings()), apiKey: '' },
};
```

- 导入：解析 JSON，若 `profiles.length` 与现有合计超过 5 则拒绝并提示。

- [ ] **Step 3: 手动验收**

Edge 加载扩展 → 打开 Options → 完成创建/改名/复制/满 5 限制/导出文件打开无 apiKey。

- [ ] **Step 4: 可选提交**

`git commit -m "feat: options page for profiles and API settings"`

---

### Task 5: Content — 字段扫描与安全写入 / 撤销

**Files:**
- Create: `src/content/scanner/scanFields.ts`
- Create: `src/content/filler/setNativeValue.ts`
- Create: `src/content/filler/fillFields.ts`
- Modify: `src/entrypoints/content.ts`
- Create: `fixtures/sample-form.html`

**Interfaces:**
- Consumes: `FieldDescriptor`, `FillPlan`
- Produces:
  - `scanFields(root?: ParentNode): FieldDescriptor[]`
  - `applyFillPlan(plan: FillPlan): { filled: number; skipped: number }`
  - `undoLastFill(): { restored: number }`
  - Content 监听 `SCAN_FIELDS` / `APPLY_FILL_PLAN` / `UNDO_LAST_FILL`

- [ ] **Step 1: `setNativeValue.ts`**

```ts
/**
 * 以兼容 React/Vue 等框架的方式设置输入类控件的值，
 * 并派发 input/change 事件，避免只改 attribute 不更新受控状态。
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  nextValue: string,
): void {
  const prototype = Object.getPrototypeOf(element);
  const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (valueDescriptor?.set) {
    valueDescriptor.set.call(element, nextValue);
  } else {
    element.value = nextValue;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
```

- [ ] **Step 2: `scanFields.ts`**

- 查询 `input, textarea, select, [contenteditable="true"]`。  
- 跳过 `type` 为 `hidden|submit|button|image|file|password`（password 跳过防误填）。  
- 不可见（`offsetParent === null` 且非 fixed 特例简化：用 `getClientRects().length === 0`）跳过。  
- `label`：`htmlFor`、包裹 label、`aria-label`、`placeholder`、`name` 依次回退。  
- `fieldId`：`crypto.randomUUID()`。  
- 用 `WeakMap` 或模块级 `Map<fieldId, Element>` 保存在 content 会话内供回填（`selectorHint` 作辅助）。  
- `select` 收集 `options` 文案。

- [ ] **Step 3: `fillFields.ts`**

- 模块级 `lastUndoSnapshots: Array<{ fieldId: string; previousValue: string }>`。  
- `applyFillPlan`：按 `fieldId` 找元素；input/textarea 用 `setNativeValue`；select 按文案或 value 匹配；contenteditable 设 `textContent` 并派发事件；加 CSS class `raf-filled-highlight`；写入前记录旧值。  
- `undoLastFill`：恢复快照并清空高亮。  
- **禁止** `form.submit()` 或点击 `[type=submit]`。

- [ ] **Step 4: `content.ts` 消息处理**

```ts
import { scanFields } from '../content/scanner/scanFields';
import { applyFillPlan, undoLastFill } from '../content/filler/fillFields';
import type { ExtensionMessage } from '../shared/types/messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === 'SCAN_FIELDS') {
        const fields = scanFields(document);
        sendResponse({
          type: 'SCAN_FIELDS_RESULT',
          requestId: message.requestId,
          fields,
        } satisfies ExtensionMessage);
        return true;
      }
      if (message.type === 'APPLY_FILL_PLAN') {
        const result = applyFillPlan(message.plan);
        sendResponse({
          type: 'APPLY_FILL_RESULT',
          requestId: message.requestId,
          ...result,
        } satisfies ExtensionMessage);
        return true;
      }
      if (message.type === 'UNDO_LAST_FILL') {
        const result = undoLastFill();
        sendResponse({
          type: 'UNDO_FILL_RESULT',
          requestId: message.requestId,
          ...result,
        } satisfies ExtensionMessage);
        return true;
      }
      return false;
    });
  },
});
```

注意：若 WXT 对异步 `sendResponse` 有要求，改为 `return true` 且异步调用时保持端口；同步扫描可直接 `sendResponse`。

- [ ] **Step 5: 写 `fixtures/sample-form.html`**

含姓名、邮箱、电话、城市、`select` 学历、`textarea` 自我评价等字段，用本地文件或任意静态服务器打开。

- [ ] **Step 6: 手动验收**

在 background 临时用 `chrome.tabs.sendMessage` 测扫描数量 > 0；或先完成 Task 7 Popup 再测。构建：

```powershell
npm run build
```

---

### Task 6: LLM 客户端 + Background 编排

**Files:**
- Create: `src/shared/llm/prompt.ts`
- Create: `src/shared/llm/openaiCompatible.ts`
- Create: `src/shared/messaging/send.ts`
- Modify: `src/entrypoints/background.ts`

**Interfaces:**
- Consumes: `ProfileData`, `FieldDescriptor`, `FillPlan`, storage
- Produces:
  - `buildFillPrompt(profileData, fields): { system: string; user: string }`
  - `requestFillPlan(args): Promise<FillPlan>`
  - `ensureHostPermission(apiBaseUrl): Promise<boolean>`
  - Background 处理 `BUILD_FILL_PLAN`、`TEST_API`、`GET_STATE`、`OPEN_SIDE_PANEL`

- [ ] **Step 1: `prompt.ts`**

System：你是简历表单填写助手；只输出 JSON 对象，键为 `items` 与 `skippedFieldIds`；`items` 每项含 `fieldId,value,confidence,reason`；不要编造档案中没有的事实；不确定则放入 skipped。  
User：序列化精简后的 profile + fields（去掉过大 description 可截断至 500 字）。

- [ ] **Step 2: `openaiCompatible.ts`**

```ts
/**
 * 调用 OpenAI 兼容 Chat Completions，解析为 FillPlan。
 * apiKey 仅在此函数参数中出现，调用方必须是 background。
 */
export async function requestFillPlan(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<FillPlan> {
  const base = options.apiBaseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM_HTTP_${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM_EMPTY_CONTENT');
    }
    const parsed = JSON.parse(content) as FillPlan;
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.skippedFieldIds)) {
      throw new Error('LLM_INVALID_SHAPE');
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
```

若目标服务不支持 `response_format`，捕获后去掉该字段重试一次。

- [ ] **Step 3: 主机权限**

```ts
export async function ensureHostPermission(apiBaseUrl: string): Promise<boolean> {
  const url = new URL(apiBaseUrl);
  const originPattern = `${url.protocol}//${url.host}/*`;
  const already = await chrome.permissions.contains({ origins: [originPattern] });
  if (already) return true;
  return chrome.permissions.request({ origins: [originPattern] });
}
```

- [ ] **Step 4: Background 消息路由**

- `GET_STATE` → settings + profiles（**返回给 UI 的 settings 可含 apiKey**，因为 Options/Popup 在扩展源；不要打日志打印 Key）。  
- `TEST_API` → `ensureHostPermission` + 最小 messages 请求。  
- `BUILD_FILL_PLAN` → `getProfile` + `requestFillPlan`；失败回 `ERROR`。  
- `OPEN_SIDE_PANEL` → `chrome.sidePanel.open({ tabId })`。  
- 向 tab 转发 `SCAN_FIELDS` / `APPLY_FILL_PLAN` / `UNDO_LAST_FILL` 的辅助函数：`sendToActiveTab(message)`。

**严禁**把 `apiKey` 放进发往 content 的消息。

- [ ] **Step 5: 构建验证**

```powershell
npm run build
```

---

### Task 7: Popup — 选档案 + 按 fillMode 主路径

**Files:**
- Modify: `src/entrypoints/popup/index.html`, `main.ts`, `style.css`

**Interfaces:**
- Consumes: Background `GET_STATE`、`BUILD_FILL_PLAN`、tab scan/apply；`OPEN_SIDE_PANEL`
- Produces: 一键流程 UI

- [ ] **Step 1: UI**

- 下拉选择档案（显示 `name`）。  
- 按钮：「扫描并填写」「打开侧边栏」「打开设置」「撤销本轮」。  
- 状态区：文案反馈。  
- 勾选「设为默认档案」。

- [ ] **Step 2: 主流程伪代码（必须按此实现）**

```ts
async function runFillFlow(profileId: string) {
  const requestId = crypto.randomUUID();
  const scanResult = await sendToActiveTab({ type: 'SCAN_FIELDS', requestId });
  // scanResult.fields
  const planResult = await chrome.runtime.sendMessage({
    type: 'BUILD_FILL_PLAN',
    requestId: crypto.randomUUID(),
    profileId,
    fields: scanResult.fields,
  });
  if (planResult.type === 'ERROR') {
    showError(planResult.message);
    return;
  }
  const settings = (await chrome.runtime.sendMessage({
    type: 'GET_STATE',
    requestId: crypto.randomUUID(),
  })).settings;

  if (settings.fillMode === 'preview') {
    await chrome.storage.session.set({ pendingFillPlan: planResult.plan });
    await chrome.runtime.sendMessage({
      type: 'OPEN_SIDE_PANEL',
      requestId: crypto.randomUUID(),
    });
    showStatus('已生成预览，请在侧边栏确认写入');
    return;
  }

  const applyResult = await sendToActiveTab({
    type: 'APPLY_FILL_PLAN',
    requestId: crypto.randomUUID(),
    plan: planResult.plan,
  });
  showStatus(`已填写 ${applyResult.filled} 项，跳过 ${applyResult.skipped}`);
}
```

`chrome.storage.session` 用于 Side Panel 读取待确认 plan（Task 8）。若需权限，在 manifest `permissions` 增加 `storage` 已够（session 同属 storage API）。

- [ ] **Step 3: 手动验收**

`fillMode=direct` + sample form + 真实或 mock API；`preview` 时打开 Side Panel。

---

### Task 8: Side Panel — 预览编辑确认与撤销

**Files:**
- Modify: `src/entrypoints/sidepanel/index.html`, `main.ts`, `style.css`

**Interfaces:**
- Consumes: `pendingFillPlan`（session）、档案列表、APPLY/UNDO 消息
- Produces: 可编辑映射表 + 确认写入

- [ ] **Step 1: UI**

- 档案选择器。  
- 表格：label（从 plan 关联：Side Panel 同时存一份 `pendingFields` 或在 plan items 旁显示 fieldId；更好：session 存 `{ plan, fields }`）。  
- 调整 Task 7：session 键改为 `pendingFillSession: { plan, fields }`。  
- 每行可编辑 value；显示 confidence。  
- 按钮：「确认写入」「撤销本轮」「重新扫描」。

- [ ] **Step 2: 确认写入**

收集编辑后的 `FillPlan` → `APPLY_FILL_PLAN` → 显示结果 → 清除 session pending。

- [ ] **Step 3: 手动验收预览改值后再写入**

---

### Task 9: 本地启发式预填（省 Token）+ 打磨

**Files:**
- Create: `src/shared/llm/localHeuristics.ts`
- Modify: `src/entrypoints/background.ts`（在调 LLM 前合并）

**Interfaces:**
- Consumes: `ProfileData`, `FieldDescriptor[]`
- Produces: `applyLocalHeuristics(profile, fields): { partialPlan: FillPlan; remainingFields: FieldDescriptor[] }`

- [ ] **Step 1: 规则**

对 label/name 匹配（含中英）：邮箱→`basic.email`，手机/电话→`phone`，姓名/名字→`fullName`，城市→`city`；confidence 设 `0.95`。  
其余字段进 LLM。合并 items，skipped 仅来自 LLM。

- [ ] **Step 2: 无 Key 时**

若仅启发式能填且用户未配 Key：允许只应用启发式并提示「未配置 API，仅填写高置信基础字段」；若还有剩余字段则报错要求配置 Key。

---

### Task 10: README、LICENSE、验收清单

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: spec 状态可改为「已批准」

- [ ] **Step 1: README 必须章节**

- 功能简介  
- 安装（Edge/Chrome 加载已解压扩展目录）  
- 配置 API（OpenAI 兼容示例：DeepSeek / 通义 / Ollama）  
- 多档案说明（5 份、复制新建）  
- 预览 vs 直填  
- 隐私：数据本地；请求发往用户 Base URL；不自动提交  
- 开发：`npm install` / `npm run dev` / `npm run build`  
- 权限说明  

- [ ] **Step 2: MIT LICENSE**

- [ ] **Step 3: 对照规格验收清单第 13 节逐项勾选**

---

## Spec Coverage Self-Review

| 规格项 | 任务 |
|--------|------|
| 混合 UI Popup/Options/Side Panel | T1, T4, T7, T8 |
| preview / direct | T2 settings, T4, T7 |
| OpenAI 兼容 + Key 仅 Background | T6 |
| 结构化 + notes | T2, T4 |
| 最多 5 档案、改名、复制新建 | T3, T4 |
| 无服务器 | 全任务 |
| DOM 扫描 / 安全写入 / 撤销 | T5 |
| 不自动提交 | T5 |
| 导入导出去 Key | T4 |
| optional host permission | T6 |
| README / 开源结构 | T1, T10 |
| 本地启发式 | T9 |

## Placeholder Scan

无 TBD；权限、session 键、错误码已写明。

## Type Consistency

- 消息类型以 `ExtensionMessage` 为准；Task 7/8 使用 `pendingFillSession: { plan, fields }`。  
- `MAX_PROFILES = 5` 与 `PROFILE_LIMIT_REACHED` 贯穿 T3/T4。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-resume-autofill-extension.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间复查，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 连续执行，设检查点  

你要哪一种？
