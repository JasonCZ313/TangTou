# 躺投 × Laya 双引擎完整技术方案（现行版）

**日期：** 2026-09-30  
**状态：** P0～P1、P2a、P2b、P3、P4a、P4b、P5、P7a、P7b、**P7c** 已编码；**P2c / P6 待做**  
**产品约束（锁定）：**

1. 双引擎：本机 Laya（判断）+ 用户 API（映射/润色/视觉兜底）  
2. 页内浮层 + 字段高亮  
3. **只预览后写入**（无 direct）  
4. Laya URL 可配；**默认空占位 + 引导**（不写死 HF）  

**总原则：**

- `FillSession.plan` = 预览 = 唯一写入源  
- Laya 只做 choice / score / noul；自由文本走规则 + 用户 API  
- 规则 →（可选）本机 typed → 云端 batch_map  
- 补行在扫描期 `ENSURE_SECTION_ROWS`；写入不偷偷填值  
- **错填不可接受**：不确定 → Miss / 请用户确认；写入后必须回读  

---

## 一、阶段总览（含 P7）

| 阶段 | 名称 | 状态 | 依赖 |
|------|------|------|------|
| **P0** | Session 真相 + 砍 direct + QA 热修 | **已完成** | — |
| **P1** | Decision 壳 + 云端 batch | **已完成** | P0 |
| **P2a** | 分题路由（选项/是否 vs 自由文本） | **已完成** | P1 |
| **P2b** | 浏览器本机 Laya（下载/内置轻量 + Offscreen ORT 骨架） | **已完成** | P2a |
| **P2c** | 自建 Laya Server（高级可选） | 待做（可插） | P2a |
| **P3** | 静态站点适配器（北森/Moka/智易/牛客/Boss） | **已完成** | P0 |
| **P4a** | 页内进度浮层 | **已完成** | P1 |
| **P4b** | 截图 + OCR 辅助进预览 | **已完成** | P4a |
| **P5** | 驾驶舱 UI + README 纠偏（来源列/徽章/去 direct 文档） | **已完成** | P2b/P4 已齐 |
| **P6** | 打磨上架 | 待做 | P5 |
| **P7** | **大厂/特殊 ATS 智能探活与安全填写** | **P7a/P7b/P7c 已完成** | P3+P4b+P5 |

**推荐节奏：**  
`P2b`（本机模型）与 `P4a`（浮层）可二选一优先 → `P4b` → **`P7` 设计与 POC** → `P5` → `P6`。  
P2c 仅高级用户需要时再做。

---

## 二、已落地能力（不得回退）

| 能力 | 要点 |
|------|------|
| 预览=写入 | `applyFillPlan` 只按 plan；无 Chao 整页乱填 |
| Popup 手势 | 同步 `sidePanel.open` + PENDING 交接 |
| 扫描补行 | ENSURE 只点添加 → 再扫 → BUILD_FILL_PLAN |
| Decision | Router：规则 → typed 试本机 → 云端 batch |
| 适配器 | 北森 / Moka / 智易 / 牛客 / Boss；添加文案白名单 |
| Laya URL | 默认空；旧 HF 默认迁空；UI 引导自建/ModelScope |
| 附件撤销 | 清文件 + 文案区分 |

**主路径：**

```
扫描 → ENSURE 补行 → 再扫 → BUILD_FILL_PLAN（Decision）
→ 侧栏预览（可改）→ APPLY（仅 plan）→ 可 UNDO
```

---

## 三、待做阶段摘要

### P2b — 浏览器本机 Laya（产品主路径）✅

- Offscreen + `onnxruntime-web` + IndexedDB 缓存；一键下载 / 启用内置轻量包 / 清除  
- 只服务选项/是否题；失败静默云端  
- 包内不含权重；`tangtou-choice-v0` 立即可用；`tangtou-ort-v0` 会话骨架已接（I/O 待权重导出对齐）  
- 示例清单：`public/laya-sample/tangtou-laya-manifest.json`

### P2c — Laya Server（高级）

- 同一 `layaModelUrl` 若为 HTTP 服务则走客户端  
- 不写进新手必做  

### P4a / P4b — 浮层与截图 ✅

- P4a：页内进度/取消/描边（扫描与写入）  
- P4b：`captureVisibleTab` → 页内 tesseract → 弱标签 enrichment + 轻量提案进预览（失败不挡主路径） 

### P5 / P6 — UI 与上架

#### P5 — 驾驶舱（修订版）✅ 已完成

- `FillMappingItem.source` 正式字段（含预留 `probe`）  
- `FILL_PLAN_RESULT` / `FillSession` 带 `primaryEngine`、`siteAdapterName`  
- 侧栏映射表「来源」列 + 驾驶舱徽章（引擎 / 当前站 / 来源分布）  
- README、验收清单去掉「直接填写」  

#### P6 — 打磨上架

- 隐私说明补「截图 OCR / 本机模型缓存」（README 已部分写入）；降级矩阵；ORT wasm 体积策略；Chrome/Edge 冒烟 

---

## 四、P7 — 大厂 / 特殊 ATS 智能探活（修订版）

### 4.1 产品硬要求（必须满足）

目标站点示例：**京东、字节、联想、阿里、外企**及各类「年份控件 / 点选添加 / 多步弹层」与通用 ATS 不同的页面。

能力要求：

1. **探活识别**：截图/OCR，和/或 DOM 文本，和/或**安全的前期点击探测**（不提交、不保存）  
2. **思考方案**：Decision 产出「点哪里、填什么、几段、年份怎么选」的可执行计划  
3. **正确高效填写**：仍经**预览确认**；写入后**回读校验**；失败标 Miss，**禁止把错填当成功**  
4. **与 P3 关系**：常见 ATS 继续用静态适配器（快、稳、省 Token）；P7 专治「适配器不够或页面变态」  

### 4.2 与现码的衔接（避免重复造轮子）

| 已有能力 | P7 用法 |
|----------|---------|
| `content/ui/pageOverlay.ts` | 探活/逐步执行进度与停止 |
| `content/vision/pageOcr.ts` + `visionAssist` | 并入 EvidencePack；不必另起 OCR 栈 |
| `adapterIsDangerSaveLabel` / `saveLabels` | 探测与执行的**提交黑名单** |
| `fillFields` 回读 | P7b 逐步执行的回读闸 |
| `FillSession.plan` 唯一写入源 | Playbook 必须先合并进 plan，再走确认写入 |
| P3 适配器 | 有匹配适配器时默认**不自动**开探活；用户可手动点 |

### 4.3 架构（扩展内可落地，不引入 Playwright 运行时）

```
触发（用户点「智能探活」；后期：适配器置信不足时建议）
  → 收集证据：DOM 摘要 + 可见区截图/OCR（复用 P4b）+（P7c）受控探测点击
  → EvidencePack 送 Background
  → Decision：产出 SitePlaybook（步骤图，非直接写 DOM）
  → 【P7a】侧栏只展示方案，零写入
  → 【P7b】合并进 FillSession 预览 → 用户确认 → 逐步执行 + 每步回读
  → 任一步失败：停、标红、不继续盲点
```

**质量闸门（强制）：**

| 闸门 | 规则 |
|------|------|
| 预览闸 | 无用户确认不得执行探活方案中的写入步 |
| 黑名单 | 永不点「提交/投递/最终确认」类按钮（复用 adapter saveLabels） |
| 回读闸 | 写入后值不匹配 → Miss，不计入成功 |
| 不确定闸 | 模型置信低于 decisionMinConfidence → 跳过或请用户手选 |
| 探测预算 | 前期点击有次数/超时上限，防死循环 |

### 4.4 可借鉴的开源（思想移植，非整仓搬进扩展）

| 项目 | 可借鉴点 | **不能直接做的** |
|------|----------|------------------|
| Stagehand | 观察→方案→预览→执行 | Playwright 进 MV3 |
| browser-use | 失败重试叙事 | 全自动 Agent 乱点 |
| OpenJobAutofill | 适配器 + 状态色 | 勿整文件替换 |

### 4.5 建议模块与消息（分期落地）

| 模块 | 阶段 | 职责 |
|------|------|------|
| `shared/playbook/types.ts` | P7a | `EvidencePack` / `SitePlaybook` / 步骤风险级 |
| `content/probe/collectEvidence.ts` | P7a | DOM 摘要 + 调已有 OCR；**无点击** |
| `shared/decision/playbookEngine.ts` | P7a | Evidence → Playbook（用户 API；无 Key 则规则/占位说明） |
| 侧栏「智能探活」+ 步骤列表 | P7a | 只展示；可复制说明；不合并写入 |
| Playbook → FillPlan 合并 | **P7b 已完成** | `mergeToPlan`；来源 `probe`；侧栏「合并进预览」 |
| 逐步执行器 | **P7b 已完成** | `executePlaybook` + `EXECUTE_PLAYBOOK`；确认后执行；overlay + 回读 |
| `content/probe/safeClick.ts` | **P7c 已完成** | 预算内探测点击；黑名单；不点添加行 |
| 多模态截图进 API | **P7c 已完成** | jpeg 截图可选送云端；失败回退 OCR/纯文本 |
| `shared/playbook/megaCorpCatalog.ts` | **P7c 已完成** | 大厂 hostname 样例 + P3 快路径提示 |

### 4.6 验收（P7）

- [x] P7a：点探活能看到步骤列表；零写入、零提交  
- [x] P7b：合并进预览（source=probe）+ 确认后逐步执行 + 回读闸；低置信不假成功（置信阈值过滤）  
- [x] P7c：探测过程零提交；有适配器的站仍可走 P3 快路径；多模态可选 + `scripts/p7c/probe-fixture.html`  

### 4.7 分期建议（修订）

| 子步 | 内容 | 依赖 |
|------|------|------|
| **P7a** | EvidencePack + Playbook **只展示不执行** | P4b 已有；**建议 P5 后来源列已就绪** |
| **P7b** | 预览合并 + 逐步执行 + 回读闸 | P7a + P5 |
| **P7c** | 受控探测点击 + 多模态；大厂样例库 | P7b |

---

## 五、依赖与权限

| 项 | 阶段 |
|----|------|
| openai 兼容 API | P1/P2a/P4b/P7 |
| onnxruntime-web + offscreen + unlimitedStorage | P2b |
| 适配器（无新 npm） | P3 已做 |
| tesseract（已有） | P4b/P7 |
| captureVisibleTab | P4b/P7 |
| **不引入** browser-use / Playwright 进扩展包 | 全阶段 |

---

## 六、明确不做

- 直接填写、自动提交  
- 商店包打进 Laya 整模  
- Agent 绕过预览直接写页  
- Laya 生成长自我评价  
- 强迫用户自建 Server  
- 把 Playwright Agent 塞进 MV3  

---

## 七、下一步应该怎么做（执行建议 · 2026-10-01 修订）

**代码盘点结论：**

- 后端已能区分规则/本机/云端，但**侧栏看不到来源**；`primaryEngine` **未传到 UI**。  
- README / 验收清单仍宣传已删除的「直接填写」——文档债。  
- P4a/P4b/适配器黑名单/回读已可作为 P7 基建；**尚无** playbook / probe / 探活按钮。

**修订后的编码顺序：**

1. ~~**下一步：P5（驾驶舱 + 文档纠偏）**~~ **已完成** — 正式 `source` 字段、来源列、引擎徽章、README 去 direct。  
2. ~~**下一步：P7a**~~ **已完成** — EvidencePack + Playbook 只展示；本地 fixture `scripts/p7a/probe-fixture.html`。  
3. ~~**下一步：P7b**~~ **已完成** — 合并预览 + 逐步执行 + 回读闸（`EXECUTE_PLAYBOOK` 需 userConfirmed）。  
4. ~~**下一步：P7c**~~ **已完成** — 受控探测点击 + 多模态（可回退）+ 大厂样例目录。  
5. **下一步：P6** — 上架打磨。  
6. **可插：P2c** — Laya Server / ORT 真推理（有权重再做）。

**若只选一个下一编码步：`P6`。**

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-09-30 | P0～P1、热修、P2a+P3、URL 空占位、Boss 适配器 |
| 2026-09-30 | **完整技术方案定稿**：纳入 P7 大厂智能探活；Stagehand/browser-use/OpenJobAutofill 借鉴边界；明确下一步优先 P4a→P4b→P7 |
| 2026-09-30 | **P2b + P4a + P4b 落地**：内置轻量包/下载缓存/Offscreen ORT 骨架；页内浮层；截图 OCR 辅助预览 |
| 2026-10-01 | **盘点现码后修订 P5～P7**：P5 收窄为来源列+徽章+文档纠偏；P7 明确复用 overlay/OCR/黑名单/回读；推荐顺序改为 P5→P7a→P7b→P7c→P6 |
| 2026-10-01 | **P5 落地**：`FillMappingItem.source` 正式字段；FILL_PLAN/会话带 primaryEngine+站点名；侧栏来源列与驾驶舱徽章；README/验收去「直接填写」 |
| 2026-10-01 | **P7a 落地**：EvidencePack 收集、启发式/云端 Playbook、侧栏「智能探活」只展示；`scripts/p7a/probe-fixture.html` |
| 2026-10-01 | **P7b 落地**：`mergePlaybookIntoFillPlan`（source=probe）；侧栏合并/确认执行；`EXECUTE_PLAYBOOK`+逐步回读；永不点提交 |
| 2026-10-01 | **P7c 落地**：`safeClick` 预算探测；Evidence 并入 probeClicks；多模态截图可回退；`megaCorpCatalog`+`scripts/p7c/probe-fixture.html` |
