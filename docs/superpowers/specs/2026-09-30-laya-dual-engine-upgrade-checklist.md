# 躺投 × Laya 双引擎改造清单

**日期：** 2026-09-30  
**状态：** 已确认，按阶段实施  
**产品约束（已锁定）：**

1. **双引擎一开始就做：** 本机 Laya ONNX + 用户 API（同一 Decision 接口，可切换/回退）  
2. **页内浮层：** 进度壳 + 字段高亮（躺投青绿风格）  
3. **只保留预览后写入：** 删除 `fillMode: direct` / 「直接填写」  
4. **模型 URL 可配：** `layaModelUrl` 有默认地址，用户可改  

**总原则：**

- 单一真相：`FillSession` = 预览所见 = 最终写入  
- 判断：本机 Laya 优先（就绪时）→ 用户 API → 规则短路  
- 用户 API：润色、识图兜底、Laya 未就绪/低置信时的判断  
- 写入：真实点击 + 回读；不自动保存/提交  
- UI：侧栏驾驶舱 + 页内浮层；操作简单、能力不阉割  

---

## 阶段总览

| 阶段 | 名称 | 状态 |
|------|------|------|
| **P0** | Session 真相 + 砍 direct + 预览=写入 | **已完成（2026-09-30）** |
| **P1** | Decision 协议 + 双引擎壳（云端先通） | 待做 |
| **P2** | 本机真 Laya（下载/缓存/推理/回退） | 待做 |
| **P3** | 侦察升级 + 真实点击（适配器） | 待做 |
| **P4** | 页内浮层 + 截图辅助 | 待做 |
| **P5** | 侧栏/Popup/Options 驾驶舱 UI | 待做（P0 起渐进） |
| **P6** | 打磨上架 | 待做 |

建议节奏：P0 → P1 → P2（可与 P3 并行）→ P4 → P5 收束 → P6。

---

## P0 — Session 真相 + 去掉 direct

### 技术要点

- 预览映射表收集的值，确认写入时必须原样执行（经 `prepareFieldForWrite` + Chao `writeField`）。  
- 禁止再「空 plan + 只跑 Chao 边扫边写」作为主路径。  
- 删除全产品 `fillMode`。  
- Popup / 侧栏主按钮改为：扫描→对照预览；另钮「确认写入」。  

### 文件

| 动作 | 路径 |
|------|------|
| 新建 | `src/shared/session/types.ts` |
| 新建 | `src/shared/session/sessionStore.ts` |
| 新建 | `src/shared/session/mergeIntents.ts` |
| 改 | `src/shared/types/fill.ts`、`messages.ts`、`profile.ts` |
| 改 | `src/shared/storage/defaults.ts`、`settingsStore.ts` |
| 改 | `src/content/filler/fillFields.ts`（按 plan 写入） |
| 改 | `src/entrypoints/sidepanel/*`、`popup/*`、`options/*` |
| 改 | `src/entrypoints/background.ts`（APPLY 必须带有效 plan） |

### 验收

- [ ] 侧栏改手机号后，确认写入即为该号  
- [ ] 无 fillMode UI / 设置项  
- [ ] Popup 只交给侧栏做「扫描+预览」，不直接写页  
- [ ] 仍不自动提交；撤销可用  

---

## P1 — Decision 协议 + 双引擎壳

### 技术要点

- `decideChoice` / `decideYesNo` / `decideScore` / `decideBatch`  
- `DecisionRouter`：local → cloud → rule  
- 云端：用户 API + 严格 JSON（Laya 题型）  
- `localHeuristics` 降为高置信短路  

### 文件

| 动作 | 路径 |
|------|------|
| 新建 | `src/shared/decision/types.ts`、`router.ts`、`cloudLaya.ts`、`prompts.ts`、`ruleShortCircuit.ts` |
| 改 | `openaiCompatible.ts`、`localHeuristics.ts`、`prompt.ts`、`background.ts`、`usageStore.ts`、`apiGuide.ts` |

### 验收

- [ ] 无本机模型时判断走用户 API  
- [ ] 规则命中不耗 Token  
- [ ] Key 不进 content  

---

## P2 — 本机真 Laya

### 技术要点

- `laya-ts` + `onnxruntime-web`；`settings.layaModelUrl`  
- 首次下载缓存；Offscreen 推理；失败回退云端  
- 包内不含 1GB 权重；下载域名走 optional host permission  

### 文件

| 动作 | 路径 |
|------|------|
| 改 | `package.json`、`wxt.config.ts` |
| 新建 | `layaLocal.ts`、`layaModelStore.ts`、可选 `offscreen/*` |
| 改 | `router.ts`、`defaults`/`profile` 设置、`options` UI、侧栏引擎徽章、`background.ts` |

### 验收

- [ ] 默认可下载缓存；改 URL 可重下  
- [ ] 本机成功时判断不耗 Token  
- [ ] 失败自动云端  

---

## P3 — 侦察 + 真实点击

### 技术要点

- OpenJobAutofill `SITE_ADAPTERS`（MIT）  
- `FieldNode` + `revealPath`；写入再点开  
- jobfill 事件序列并入 `chao/dom`  

### 文件

| 动作 | 路径 |
|------|------|
| 新建 | `src/content/adapters/**` |
| 改 | `scanFields.ts`、`chao/dom.ts`、`setNativeValue.ts`、`chao/rules.ts`、`content.ts` |

### 验收

- [ ] 难表单展开/关弹层仍在  
- [ ] 下拉点选并回读  
- [ ] 无适配器站仍可用  

---

## P4 — 页内浮层 + 截图辅助

### 技术要点

- Shadow 进度壳 + 字段描边  
- 选区截图 → OCR → Decision；视觉 API 兜底  

### 文件

| 动作 | 路径 |
|------|------|
| 新建 | `src/content/overlay/**`、`src/content/vision/**`、`src/shared/vision/**` |
| 改 | `brand.css`、`wxt.config.ts`、`background.ts`、`content.ts`、侧栏「截图辅助」 |

### 验收

- [ ] 扫描时页内有进度且可取消  
- [ ] 截图支路仍真实点击写入  

---

## P5 — 驾驶舱 UI

- 阶段条、来源标、引擎徽章、增强折叠  
- Popup 极简：档案 + 扫描（交接侧栏）+ 打开助手  

---

## P6 — 打磨上架

- 权限/隐私文案、错误文案、无 Key/无模型降级矩阵、版本号、体积检查  

---

## 依赖与权限（总表）

| 项 | 用途 |
|----|------|
| `laya-ts` + `onnxruntime-web` | 本机判断（P2） |
| 现有 `tesseract.js` | OCR |
| 可选 snapdom / modern-screenshot | DOM 截图 |
| `offscreen` / `tabs` / `unlimitedStorage` | 推理、截图、模型缓存 |
| optional hosts | 用户 API + `layaModelUrl` |

---

## 明确不做

- 「直接填写」模式  
- 自动提交/保存  
- browser-use / Playwright 进扩展包  
- 商店包打进 Laya 整模  
- 整仓替换成 OpenJobAutofill 单文件  

---

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-09-30 | 清单定稿；**P0 已落地**：Session 存储、预览=写入、去掉 direct、Popup 交接侧栏预览 |
