# 躺投（TangTou）

本机维护简历档案，自备 OpenAI 兼容 API Key，在任意网申页扫描表单、生成填写预览，确认后再写入。无作者后端、不自动提交表单。

口号：**躺着也能投。**

---

## 目录

- [躺投能做什么](#躺投能做什么)
- [环境要求](#环境要求)
- [如何加载扩展](#如何加载扩展)
- [如何配置](#如何配置)
- [如何使用](#如何使用)
- [隐私与安全](#隐私与安全)
- [开发脚本](#开发脚本)
- [权限说明](#权限说明)
- [仓库信息](#仓库信息)
- [许可证](#许可证)
- [English](#tangtou-english)

---

## 躺投能做什么

躺投是一款 **Chrome / Edge（Manifest V3）** 浏览器扩展：档案留在本机，映射与填写前必须经过侧栏预览确认。

| 能力 | 说明 |
| --- | --- |
| 多档案 | 最多 5 份可命名档案；可从已有档案复制新建 |
| 通用填写 | 以 DOM 扫描为主，适用于常见 http/https 网申页 |
| 站点适配 | 北森 / iTalentX、Moka、智易、牛客、BOSS 直聘等有加速适配 |
| 填写安全 | **一律「预览后写入」**；无「跳过预览直接填」；绝不自动点提交 |
| 决策引擎 | 规则短路 + 可选本机 Laya + 你配置的云端 API |
| 智能探活 | 复杂页可生成探测步骤；预算内可点开下拉读选项，不点提交 |
| 选区填入 | 侧栏框选页面局部，对照档案某一段再写入 |
| 本轮撤销 | 可撤销本轮写入，恢复填写前字段值 |
| 简历导入 | 支持 PDF / DOCX / TXT 识别，写入档案空白项 |
| 导入导出 | JSON 备份；导出强制不含 API Key |

界面分工：

- **Popup（工具栏弹窗）**：选档案、一键「扫描并预览」、打开侧栏 / 设置、撤销本轮
- **Side Panel（侧边助手）**：映射预览、改值、确认写入、智能探活、选区填入
- **Options（选项页）**：API、本机 Laya、档案编辑、导入导出、Token 统计

---

## 环境要求

- **浏览器**：Google Chrome 或 Microsoft Edge（需支持 Side Panel）
- **Node.js**：建议当前 LTS（用于从源码构建）
- **系统**：Windows / macOS / Linux 均可构建；下文命令以 **PowerShell（Windows）** 为例

---

## 如何加载扩展

### 方式 A：从源码构建后加载（推荐）

1. 克隆仓库并进入目录：

```powershell
git clone https://github.com/JasonCZ313/TangTou.git
cd TangTou
```

2. 安装依赖并构建：

```powershell
npm install
npm run build
```

`npm install` 会自动准备 WXT、同步 ORT WASM 与 OCR 语言包。Chrome 产物目录一般为：

```text
.output\chrome-mv3
```

面向 Edge 时：

```powershell
npm run build:edge
```

产物目录一般为：

```text
.output\edge-mv3
```

3. 在浏览器中加载已解压扩展：

**Google Chrome**

1. 地址栏打开 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `.output\chrome-mv3`

**Microsoft Edge**

1. 地址栏打开 `edge://extensions/`
2. 打开左侧「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `.output\edge-mv3`

4. 工具栏出现「躺投」图标即表示加载成功。无需注册账号。

### 方式 B：开发模式（热重载）

```powershell
npm install
npm run dev
```

按终端提示，把开发输出目录加载为已解压扩展（通常类似 `.output\chrome-mv3-dev`，以本机 WXT 为准）。Edge 开发：

```powershell
npm run dev:edge
```

### 方式 C：分发用 zip

```powershell
npm run zip
```

用商店或自行解压 zip 后，同样通过「加载已解压的扩展」指向解压目录即可。

上架或发版前建议跑一遍产物检查：

```powershell
npm run smoke:build
```

---

## 如何配置

打开设置的几种方式：

- 右键工具栏「躺投」图标 →「选项」
- Popup 内点击「打开设置」
- Side Panel 折叠区「设置与新建/编辑档案」→ 可跳转完整选项页

### 1. 配置 OpenAI 兼容 API（必做，自由文本映射需要）

在选项页「API 设置」填写并保存：

| 字段 | 说明 | 默认示例 |
| --- | --- | --- |
| API Base URL | OpenAI 兼容接口根路径，通常以 `/v1` 结尾 | `https://api.openai.com/v1` |
| API Key | 你向服务商申请的密钥，仅存本机 | （空） |
| 模型名 | 服务商控制台里可用的模型 ID | `gpt-4o-mini` |

建议流程：填写三项 → 点「测试连接」→ 通过后再「保存」。

页面内有「怎么获取这三项」教程（含 DeepSeek / 智谱 GLM / 通义千问截图引导）。

**常见配置示例**

| 服务商 | Base URL | 模型示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义（DashScope 兼容） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`（以控制台为准） |
| Ollama（本机） | `http://127.0.0.1:11434/v1` | 本机已拉取的模型名，如 `llama3.2` |

Ollama 的 API Key 可填任意非空占位（视本机配置而定）。

首次请求某 Base URL 时，浏览器可能弹出**可选主机权限**确认，请允许你实际使用的 API 域名。

### 2. 新建并编辑简历档案（必做）

1. 在选项页「档案」区域新建档案（最多 5 份），可命名为「校招版」「海投版」等
2. 可选：从已有档案「复制新建」再改，源档案不变
3. 进入编辑：填写基本信息、求职意向、教育、实习/工作、项目、技能等；带珊瑚色 `*` 的为硬必填
4. 可选：上传 PDF / DOCX / TXT →「识别并保存」→「写入空白项」（只填空位，不覆盖已有内容）
5. 保存档案

Popup / Side Panel 可选当前填写用的档案，并可设为默认档案。

### 3. 本机 Laya（可选）

用于选项/是否题等本机判断，减轻对云端 API 的依赖：

1. 在选项页打开「本机 Laya 判断」
2. 点「启用内置轻量包」，或按说明下载本机包 / 接入自建 Server
3. 勾选「启用本机 Laya」「本机就绪时优先 Laya」（按需）
4. 可调整「预览最低置信度」（默认 `0.55`）

**自建 Laya Server（可选进阶）**

```powershell
npm run laya:server
```

选项页 URL 填 `http://127.0.0.1:8765`，点「测试 Laya Server」。对 Server 地址不要点「下载本机包」。

### 4. 导入 / 导出

- **导出全部**：得到 JSON 备份（不含 API Key）
- **导入 JSON**：合并追加到现有档案；总数超过 5 份会被拒绝

### 5. 其它

- **Token 用量**：选项页可查看与清零；侧栏 / 弹窗有摘要
- **智能探活允许受控探测点击**：敏感页面可关闭
- **意见反馈**：选项页可一键起草邮件

---

## 如何使用

目标页须为普通 **http / https** 网页（不要在 `chrome://`、扩展商店页等受限页上操作）。

### 最小闭环（最常用）

1. 打开目标网申页
2. 点击工具栏「躺投」→ 选用档案 → 点「扫描并预览」
3. 侧边助手自动打开并开始扫描（页内会有进度浮层）
4. 在侧栏核对映射表：字段、填写值、来源（规则 / 本机 / 云端 / 探活 / 用户）、置信度；可直接改值
5. 确认无误后点「确认写入」
6. **由你自己在网站上点提交 / 投递**——躺投不会代点

写完后侧栏会列出「没写上的」字段，并可复制本次操作记录。不满意可点「撤销本轮」。

### 复杂 ATS / 折叠表单

1. 先「扫描本页」看预览
2. 字段藏在下拉、折叠区时，用「智能探活」生成步骤方案
3. 选择「合并进预览」或「确认执行探活方案」（二次确认，逐步回读）
4. 再「确认写入」

探活阶段可点开下拉读选项，**不会**点提交、投递、保存，也不会在探测阶段点「添加行」。

### 只填页面某一块（选区填入）

1. 侧栏点「选区填入」
2. 在页面上框选目标区域
3. 在「框内空白字段」里选对应档案段 →「对照这一段」
4. 「确认写入框内」；可「撤销框内」（与整页「撤销本轮」相互独立）

### 日常小技巧

- 扫描进行中可用 Popup「停止」
- 侧栏驾驶舱徽章会显示本轮主引擎与当前站适配器名（若有）
- 多档案切换后重新扫描，避免用错版本简历
- 控制台日志前缀为 `[躺投]`，便于排查

---

## 隐私与安全

完整政策见 [`docs/privacy-policy.md`](docs/privacy-policy.md)。上架文案见 [`docs/store/listing.md`](docs/store/listing.md)。

要点：

- 档案与 API Key 只存在浏览器本机（`storage` / IndexedDB），无作者后端、无强制云端同步
- 填写 / 探活时，字段摘要与相关档案内容只会发往 **你配置的 Base URL**
- 可能对当前标签做可见区截图（默认本机 OCR；部分探活场景可能附带压缩截图），不上传到作者服务器
- 导出 JSON **强制剔除** `apiKey`
- 绝不自动提交表单

能力不可用时按降级矩阵处理，见 [`docs/degradation-matrix.md`](docs/degradation-matrix.md)。

---

## 开发脚本

```powershell
npm install           # 安装依赖，并 sync ORT + tesseract + wxt prepare
npm run sync:ort      # 仅同步精简 ORT 资产到 public/ort
npm run dev           # Chrome 开发热重载
npm run dev:edge      # Edge 开发热重载
npm run build         # 生产构建（Chrome MV3）
npm run build:edge    # 生产构建（Edge）
npm run laya:server   # 本地示例 Laya Server（http://127.0.0.1:8765）
npm run smoke:build   # 双浏览器构建 + 产物冒烟
npm run zip           # 打包 zip
```

技术栈：WXT + TypeScript。入口在 `src/entrypoints/`。

ORT 策略：Offscreen 仅用 wasm EP（约 12MB），不打包 `*.jsep.wasm`；商店包不含大模型权重。

更多规格与验收：

- [`docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md`](docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md)
- [`docs/acceptance-checklist.md`](docs/acceptance-checklist.md)

---

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 本机保存档案、设置与会话中的填写计划 |
| `sidePanel` | 侧边栏预览与确认填写 |
| `scripting` | 向当前页注入内容脚本以扫描 / 写入 |
| `activeTab` | 用户操作时截取当前标签可见区（OCR / 可选多模态） |
| `offscreen` | 离屏页加载 onnxruntime-web |
| `unlimitedStorage` | 缓存本机 Laya 判断包 |
| `debugger` | 部分控件需短暂真实点击时使用；用完即解除，不长期挂调试 |
| `host_permissions`（`http://*/*`、`https://*/*`） | 在用户打开的网页上扫描与填写 |
| `optional_host_permissions` | 按需授权你配置的 API 域名（含 localhost） |

---

## 仓库信息

| 项 | 说明 |
| --- | --- |
| GitHub | [https://github.com/JasonCZ313/TangTou](https://github.com/JasonCZ313/TangTou) |
| Clone | `https://github.com/JasonCZ313/TangTou.git` |
| Issues | [https://github.com/JasonCZ313/TangTou/issues](https://github.com/JasonCZ313/TangTou/issues) |
| 默认分支 | `main` / `develop` 等以仓库当前分支为准 |
| 编码 / 换行 | UTF-8 / LF |

---

## 许可证

MIT © 2026 躺投 Contributors。详见 [`LICENSE`](LICENSE)。

---

# TangTou (English)

TangTou is a **Chrome / Edge (Manifest V3)** extension that keeps resume profiles on your device, uses **your own OpenAI-compatible API key**, scans application forms on any normal web page, and writes values only after you confirm a preview. There is **no vendor backend** and **no automatic form submit**.

Tagline: fill applications while you stay hands-off—after you review the preview.

---

## Table of contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Load the extension](#load-the-extension)
- [Configure](#configure)
- [Use it](#use-it)
- [Privacy](#privacy)
- [Dev scripts](#dev-scripts)
- [Permissions](#permissions)
- [Repository](#repository)
- [License](#license-1)

---

## What it does

| Feature | Detail |
| --- | --- |
| Multiple profiles | Up to 5 named profiles; clone an existing one when creating |
| Generic fill | DOM scanning on common `http` / `https` application pages |
| Site adapters | Faster paths for Beisen / iTalentX, Moka, Zhiyi, Nowcoder, BOSS Zhipin, and more |
| Safe write | **Preview-then-write only**; no skip-preview mode; never auto-clicks Submit |
| Decision engines | Rules + optional on-device Laya + your cloud API |
| Smart probe | Step plans for complex pages; budgeted clicks to open dropdowns (never Submit) |
| Region fill | Select a page region in the side panel and map one profile section |
| Undo round | Restore field values from before the last write |
| Resume import | PDF / DOCX / TXT recognition into empty profile fields |
| Import / export | JSON backup; exports never include the API key |

UI surfaces:

- **Popup**: pick profile, “Scan & preview”, open side panel / options, undo
- **Side panel**: mapping preview, edits, confirm write, probe, region fill
- **Options**: API, Laya, profile editor, import/export, token usage

---

## Requirements

- **Browser**: Google Chrome or Microsoft Edge (Side Panel support required)
- **Node.js**: current LTS recommended (to build from source)
- Commands below use **PowerShell on Windows**; adapt paths if needed on other OS

---

## Load the extension

### A. Build from source (recommended)

```powershell
git clone https://github.com/JasonCZ313/TangTou.git
cd TangTou
npm install
npm run build
```

Chrome output is typically `.output\chrome-mv3`. For Edge:

```powershell
npm run build:edge
```

Output is typically `.output\edge-mv3`.

**Chrome:** open `chrome://extensions/` → enable Developer mode → Load unpacked → select `.output\chrome-mv3`.

**Edge:** open `edge://extensions/` → enable Developer mode → Load unpacked → select `.output\edge-mv3`.

No account signup is required.

### B. Dev mode (hot reload)

```powershell
npm run dev
# or
npm run dev:edge
```

Load the WXT dev output directory shown in the terminal (often similar to `.output\chrome-mv3-dev`).

### C. Zip package

```powershell
npm run zip
```

Unpack, then Load unpacked. Before release, run:

```powershell
npm run smoke:build
```

---

## Configure

Open Options via: right-click the toolbar icon → Options; Popup → Open settings; or the side panel settings section.

### 1. OpenAI-compatible API (required for free-text mapping)

| Field | Meaning | Default example |
| --- | --- | --- |
| API Base URL | Compatible API root, usually ends with `/v1` | `https://api.openai.com/v1` |
| API Key | Your key; stored only on device | (empty) |
| Model | Model id from your provider console | `gpt-4o-mini` |

Fill → **Test connection** → **Save**. In-app guide covers DeepSeek, Zhipu GLM, and Qwen with screenshots.

| Provider | Base URL | Model example |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Qwen (DashScope compatible) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` (check console) |
| Ollama (local) | `http://127.0.0.1:11434/v1` | e.g. `llama3.2` |

For Ollama, any non-empty API key placeholder is often enough. The first request to a new host may ask for **optional host permission**—allow your API domain.

### 2. Create and edit profiles (required)

1. Create up to 5 named profiles in Options
2. Optionally clone an existing profile
3. Edit sections (basic info, intent, education, work, projects, skills, …); coral `*` marks hard-required fields
4. Optional: upload PDF / DOCX / TXT → recognize → fill empty fields only
5. Save

Pick the active profile (and default) in Popup / Side panel.

### 3. On-device Laya (optional)

Enable the built-in lightweight pack or your own server; prefer Laya when ready; adjust preview confidence (default `0.55`).

Optional local server:

```powershell
npm run laya:server
```

Set URL to `http://127.0.0.1:8765`, test the server, and do **not** use “Download pack” against the server URL.

### 4. Import / export

Export all profiles as JSON (API key stripped). Import merges append-only and rejects totals above 5.

---

## Use it

Work on normal **http / https** pages only (not `chrome://` or restricted chrome pages).

### Minimal loop

1. Open the application page
2. Toolbar → TangTou → select profile → **Scan & preview**
3. Side panel opens and scans (page overlay shows progress)
4. Review mapping (field, value, source, confidence); edit values as needed
5. **Confirm write**
6. **You** click the site’s Submit / Apply button—TangTou never does that for you

Use **Undo this round** if needed. Missed fields are listed after write.

### Complex ATS / collapsed forms

Scan → **Smart probe** → merge into preview or confirm the probe plan (step-by-step with re-read) → confirm write. Probe may open dropdowns; it never clicks Submit / Apply / Save, and does not click “Add row” during probing.

### Region fill

Side panel → Region fill → draw a box on the page → pick a profile section → match → confirm write inside the box (region undo is separate from full-round undo).

---

## Privacy

Full policy: [`docs/privacy-policy.md`](docs/privacy-policy.md). Store listing notes: [`docs/store/listing.md`](docs/store/listing.md).

- Profiles and API keys stay on-device; no TangTou cloud sync
- Field summaries go only to **your configured Base URL**
- Visible-tab screenshots may be used for on-device OCR (and optionally compressed for some probe flows); not uploaded to TangTou servers
- JSON export strips `apiKey`
- Never auto-submits forms

Degradation matrix: [`docs/degradation-matrix.md`](docs/degradation-matrix.md).

---

## Dev scripts

```powershell
npm install
npm run sync:ort
npm run dev
npm run dev:edge
npm run build
npm run build:edge
npm run laya:server
npm run smoke:build
npm run zip
```

Stack: WXT + TypeScript. Entrypoints: `src/entrypoints/`. ORT ships wasm EP only (~12MB), no `*.jsep.wasm`, no large model weights in the store package.

---

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Local profiles, settings, in-session fill plans |
| `sidePanel` | Preview and confirm writes |
| `scripting` | Inject content scripts to scan / fill |
| `activeTab` | Capture visible tab for OCR / optional multimodal |
| `offscreen` | Load onnxruntime-web offscreen |
| `unlimitedStorage` | Cache on-device Laya packs |
| `debugger` | Brief real click for some widgets; detached immediately after |
| Host `http://*/*` `https://*/*` | Scan and fill on pages you open |
| Optional hosts | Authorize your API domain (including localhost) on demand |

---

## Repository

| Item | Detail |
| --- | --- |
| GitHub | [https://github.com/JasonCZ313/TangTou](https://github.com/JasonCZ313/TangTou) |
| Clone | `https://github.com/JasonCZ313/TangTou.git` |
| Issues | [https://github.com/JasonCZ313/TangTou/issues](https://github.com/JasonCZ313/TangTou/issues) |

---

## License

MIT © 2026 TangTou Contributors. See [`LICENSE`](LICENSE).
