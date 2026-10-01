# 躺投（TangTou）

本机维护简历档案，自备 OpenAI 兼容 API Key，在任意网页扫描表单并由 AI 辅助映射填写。无自建服务器、不自动提交表单。

> 远程：`http://git.jflare.com/CaoZ/TangTou.git`。产品名 **躺投**。

## 功能简介

- **多档案**：最多 5 份可命名档案；新建时可从已有档案深拷贝再改。
- **通用站点**：以 DOM 扫描为主；北森/Moka/智易/牛客/Boss 等有站点适配加速。
- **填写安全**：**一律「预览后写入」**（侧栏核对映射后再写页）；不提供「直接填写」，也绝不自动提交表单。
- **本机判断**：可选启用内置轻量 Laya 包（选项/是否题）；也可接 **P2c 自建 Laya Server**（同一 URL）；ORT 打分需自备对齐权重，失败自动降级。
- **智能探活**：复杂页可生成步骤方案；可预算内探测点开下拉；合并预览或确认后逐步执行（带回读）。
- **本轮撤销**：支持撤销本轮填写，恢复写入前字段值。
- **导入导出**：JSON 导入/导出；导出默认不含 API Key。
- **混合 UI**：Popup 一键操作、Options 管理档案与 API、Side Panel 预览与精细控制。

## 安装（Edge / Chrome）

本扩展基于 Manifest V3，可用 Edge 或 Chrome 加载已解压构建产物。

### 1. 构建

```powershell
npm install
npm run sync:ort
npm run build
```

Chrome / 通用产物目录一般为 `.output/chrome-mv3`（以本机 `wxt build` 输出为准）。

若面向 Edge：

```powershell
npm run build:edge
```

产物目录一般为 `.output/edge-mv3`。

上架前建议跑产物冒烟（会构建 Chrome + Edge 并检查清单/无 ORT jsep）：

```powershell
npm run smoke:build
```

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

## 预览后写入

扫描并生成填写计划后，在侧边栏核对（可改值）再点「确认写入」。扩展 **不会** 点击提交 / 投递按钮，也 **没有**「跳过预览直接填写」模式。

映射表会标明每条提案的来源（规则 / 本机 / 云端 / 探活 / 用户），并显示本轮主引擎与当前站适配器（若有）。

复杂页可先「智能探活」→「合并进预览」或「确认执行探活方案」（二次确认 + 逐步回读）。

## 隐私

完整政策：[`docs/privacy-policy.md`](docs/privacy-policy.md)（上架请托管为公开 URL，文案见 [`docs/store/listing.md`](docs/store/listing.md)）。

要点：

- 档案与 API Key 仅存于浏览器本机 `storage` / IndexedDB，无作者后端、无云端同步。
- 填写/探活时，表单字段摘要与档案相关内容会发往 **你配置的 Base URL**（你的 LLM 服务商或本机 Ollama）。
- 生成预览或探活时可能对当前标签做**可见区截图**：默认本机 OCR；云端探活且模型支持时可能附带压缩截图（失败回退纯文本）。截图不上传到作者服务器。
- 本机 Laya 判断包（若启用）缓存在本机 IndexedDB；商店包**不含**大模型权重。
- 受控探测可点开下拉读选项，**永不**点提交/投递/保存，也不在探测阶段点「添加行」。
- 导出 JSON **不含** `apiKey`（实现上强制剔除）。
- 绝不自动提交表单。

## 能力降级

API / 本机模型 / OCR / 多模态 / 探测不可用时，扩展按矩阵降级或标 Miss，不把错填当成功。见 [`docs/degradation-matrix.md`](docs/degradation-matrix.md)。

## ORT WASM 体积策略

- Offscreen 仅使用 **wasm EP**；`npm run sync:ort` 只同步 `ort-wasm-simd-threaded.wasm` + `.mjs`（约 12MB）。
- **不打包** `*.jsep.wasm`（约 23MB，WebGPU 路径本扩展未用）。
- ORT 会话失败或 I/O 未对齐时，自动回退内置/轻量判断，不阻塞预览。

## 开发脚本

```powershell
npm install          # 安装依赖，并 sync ORT wasm + wxt prepare
npm run sync:ort     # 仅同步精简 ORT 资产到 public/ort
npm run dev          # Chrome 开发模式热重载
npm run dev:edge     # Edge 开发模式
npm run build        # 生产构建（Chrome MV3）
npm run build:edge   # 生产构建（Edge）
npm run laya:server    # 本地示例 Laya Server（http://127.0.0.1:8765）
npm run smoke:build  # 双浏览器构建 + 产物/文档冒烟
npm run zip          # 打包 zip（便于分发）
```

### P2c：自建 Laya Server（可选）

1. `npm run laya:server`  
2. 选项页 URL 填 `http://127.0.0.1:8765`，点「测试 Laya Server」  
3. 勾选「启用本机 Laya」+「优先本机」，保存  
4. **不要**对 Server 地址点「下载本机包」  

协议：`GET /health`、`POST /v1/decide`（详见 `scripts/p2c/laya-server.mjs`）。ORT 打分协议示例清单：`public/laya-sample/tangtou-laya-ort-score-v0.example.json`。

技术栈：WXT + TypeScript。源码入口在 `src/entrypoints/`。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 本机保存档案、设置与会话中的填写计划 |
| `sidePanel` | 打开侧边栏进行预览与确认填写 |
| `scripting` | 向当前页注入内容脚本以扫描 / 写入表单 |
| `activeTab` | 用户操作时截取当前标签可见区，供本机 OCR / 可选多模态 |
| `offscreen` | 离屏页加载 onnxruntime-web（可选本机 ONNX） |
| `unlimitedStorage` | 缓存本机 Laya 判断包 |
| `host_permissions`（`http://*/*`、`https://*/*`） | 在用户打开的网页上扫描与填写 |
| `optional_host_permissions` | 按需授权用户配置的 API 域名（含 localhost / 127.0.0.1） |

扩展不会请求与上述用途无关的权限。商店 Dashboard 逐条说明见 [`docs/store/listing.md`](docs/store/listing.md)。

## 验收与规格

- 设计规格：[`docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md`](docs/superpowers/specs/2026-09-23-resume-autofill-extension-design.md)
- 双引擎清单：[`docs/superpowers/specs/2026-09-30-laya-dual-engine-upgrade-checklist.md`](docs/superpowers/specs/2026-09-30-laya-dual-engine-upgrade-checklist.md)
- 第一期验收勾选：[`docs/acceptance-checklist.md`](docs/acceptance-checklist.md)
- 探活本地页：`scripts/p7a/probe-fixture.html`、`scripts/p7c/probe-fixture.html`

## 仓库信息

| 项 | 说明 |
| --- | --- |
| 主远程（历史） | `http://git.jflare.com/CaoZ/TangTou.git` |
| 默认分支 | `main` / 功能分支如 `feat/resume-autofill` |
| 编码 / 换行 | UTF-8 / LF |

## 许可证

MIT © 2026 躺投 Contributors。详见 [`LICENSE`](LICENSE)。
