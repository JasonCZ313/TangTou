# Resume Autofill

本机维护简历档案，自备 OpenAI 兼容 API Key，在任意网页扫描表单并由 AI 辅助映射填写。无自建服务器、不自动提交表单。

> 本仓库历史远程为躺投（TangTou）：`http://git.jflare.com/CaoZ/TangTou.git`。产品工作名与扩展名为 **Resume Autofill**。

## 功能简介

- **多档案**：最多 5 份可命名档案；新建时可从已有档案深拷贝再改。
- **通用站点**：以 DOM 扫描为主，不依赖单站硬编码即可覆盖多数标准表单。
- **填写安全**：默认「预览后写入」；可在设置中切换为「直接填写」。
- **本轮撤销**：支持撤销本轮填写，恢复写入前字段值。
- **导入导出**：JSON 导入/导出；导出默认不含 API Key。
- **混合 UI**：Popup 一键操作、Options 管理档案与 API、Side Panel 预览与精细控制。

## 安装（Edge / Chrome）

本扩展基于 Manifest V3，可用 Edge 或 Chrome 加载已解压构建产物。

### 1. 构建

```powershell
npm install
npm run build
```

Chrome / 通用产物目录一般为 `.output/chrome-mv3`（以本机 `wxt build` 输出为准）。

若面向 Edge：

```powershell
npm run build:edge
```

产物目录一般为 `.output/edge-mv3`。

### 2. 加载已解压扩展

**Microsoft Edge**

1. 打开 `edge://extensions/`
2. 开启「开发人员模式」
3. 「加载解压缩的扩展」→ 选择构建输出目录（如 `.output/edge-mv3`）

**Google Chrome**

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择构建输出目录（如 `.output/chrome-mv3`）

安装后无需注册账号；在扩展 **选项页** 配置 API 并维护档案即可使用。

## 配置 API（OpenAI 兼容）

在选项页填写：

| 字段 | 说明 |
| --- | --- |
| Base URL | OpenAI 兼容接口根路径（通常以 `/v1` 结尾） |
| API Key | 由你自行向服务商申请，仅存本机 |
| 模型名 | 如 `gpt-4o-mini`、`deepseek-chat` 等 |

默认 Base URL 为 `https://api.openai.com/v1`，默认模型为 `gpt-4o-mini`。

### 示例

**OpenAI**

- Base URL：`https://api.openai.com/v1`
- 模型：`gpt-4o-mini`（或其他你有权限的模型）

**DeepSeek**

- Base URL：`https://api.deepseek.com/v1`
- 模型：`deepseek-chat`

**通义（DashScope 兼容模式）**

- Base URL：以阿里云 DashScope 文档中的 OpenAI 兼容端点为准（常见形如 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
- 模型：如 `qwen-plus`（以控制台可用模型为准）

**Ollama（本机）**

- Base URL：`http://127.0.0.1:11434/v1`
- API Key：可填任意非空占位（视 Ollama 配置而定）
- 模型：本机已拉取的模型名，如 `llama3.2`

首次请求某 Base URL 时，浏览器可能弹出可选主机权限确认；请允许你实际使用的 API 域名。

## 多档案说明

- 上限 **5** 份；尝试创建第 6 份会失败并提示。
- 可为档案改名（例如「海投版」「校招版」）。
- **复制新建**：从已有档案深拷贝生成新档案，再单独修改；源档案内容不变。
- Popup 可选择当前填写使用的档案，并可设为默认档案。

## 预览 vs 直填

| 模式 | 行为 |
| --- | --- |
| **预览后写入**（默认） | 扫描并生成填写计划，在侧边栏确认后再写入页面 |
| **直接填写** | 跳过确认步骤，按映射结果直接写入（仍不自动提交表单） |

在选项页「填写模式」中切换。无论哪种模式，扩展都 **不会** 点击提交 / 投递按钮。

## 隐私

- 档案与 API Key 仅存于浏览器本机 `storage`，无作者后端、无云端同步。
- 填写时，表单字段摘要与档案相关内容会发往 **你配置的 Base URL**（你的 LLM 服务商或本机 Ollama）。
- 导出 JSON **不含** `apiKey`（实现上强制剔除，无可选包含）。
- 绝不自动提交表单。

## 开发脚本

```powershell
npm install          # 安装依赖，并执行 wxt prepare
npm run dev          # Chrome 开发模式热重载
npm run dev:edge     # Edge 开发模式
npm run build        # 生产构建（Chrome MV3）
npm run build:edge   # 生产构建（Edge）
npm run zip          # 打包 zip（便于分发）
```

技术栈：WXT + TypeScript。源码入口在 `src/entrypoints/`。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 本机保存档案、设置与会话中的填写计划 |
| `sidePanel` | 打开侧边栏进行预览与确认填写 |
| `scripting` | 向当前页注入内容脚本以扫描 / 写入表单 |
| `host_permissions`（`http://*/*`、`https://*/*`） | 在用户打开的网页上扫描与填写 |
| `optional_host_permissions` | 按需授权用户配置的 API 域名（含 localhost / 127.0.0.1） |

扩展不会请求与上述用途无关的权限。

## 验收与规格

- 设计规格：[`docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md`](docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md)
- 第一期验收勾选：[`docs/acceptance-checklist.md`](docs/acceptance-checklist.md)

## 仓库信息

| 项 | 说明 |
| --- | --- |
| 主远程（历史） | `http://git.jflare.com/CaoZ/TangTou.git` |
| 默认分支 | `main` / 功能分支如 `feat/resume-autofill` |
| 编码 / 换行 | UTF-8 / LF |

## 许可证

MIT © 2026 Resume Autofill Contributors。详见 [`LICENSE`](LICENSE)。
