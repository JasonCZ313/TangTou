# P0 QA 问题汇总与专项案例（不修复）

**执行日：** 2026-09-30  
**依据：** `docs/superpowers/specs/2026-09-30-p0-qa-50-cases.md` + `scripts/p0-qa/run-p0-probes.mjs`（含 Playwright 浏览器外真实点击）  
**原则：** 只发现问题与扩写专项案例，**不改产品代码**。

---

## 一、总览

| 严重度 | 数量 | 问题 ID |
|--------|------|---------|
| critical | 1 | BUG-01 用户手势丢失导致侧栏可能打不开 |
| high | 1 | BUG-02 多段「添加行」/ Chao 旁路 |
| medium | 2 | BUG-03 附件撤销无效；BUG-04（并入文案/体验） |
| low | 2 | BUG-05 Miss 标签用 reason；BUG-06 文案不一致 |

自动化探针：`scripts/p0-qa/p0-qa-run-report.json`  
外点 Fixture：`scripts/p0-qa/fixture-form.html`（原生 select / 键盘 / 组件点击 / contenteditable / setter 均通过）

---

## 二、BUG-01（critical）：Popup「扫描并预览」在 await 后才 `sidePanel.open`

### 表现（预期）

Chrome/Edge 要求 `sidePanel.open` 必须落在**用户手势的同步调用栈**里。P0 把流程改成：

1. `click` → `await maybePersistDefaultProfile(...)`  
2. → `await chrome.storage.session.set(...)`  
3. → 才 `chrome.sidePanel.open(...)`

中间任意 await 都会打断手势，**侧栏经常打不开或间歇失败**；而「打开侧边助手」按钮是同步 open，往往仍正常 → 用户感觉「预览按钮坏了、旁边按钮却好」。

### 代码位置

- `src/entrypoints/popup/main.ts`：`fillButton` 监听器内 `async` + `await maybePersistDefaultProfile` + `runFillFlow`  
- 同文件 `runFillFlow`：先 `await chrome.storage.session.set`，再 `openSidePanelForCurrentTab`  
- 对比：同文件 `openSidePanelButton` **同步**调用 `openSidePanelForCurrentTab()`（正确模式）  
- 注释已写「前面不能再 await」，但实现与注释相反

### 专项案例（15）

| ID | 案例 | 期望（用于钉死 bug） |
|----|------|----------------------|
| G01-01 | 冷启动扩展后第一次点「扫描并预览」 | 记录侧栏是否打开 |
| G01-02 | 连续快速点 5 次「扫描并预览」 | 是否偶发失败 |
| G01-03 | 勾选「设为默认」后再点扫描并预览 | await setActive 后是否更易失败 |
| G01-04 | 未勾选默认、点扫描并预览 | 是否仍因 storage.await 失败 |
| G01-05 | 同一手势下先点「打开侧边助手」 | 应稳定成功（对照） |
| G01-06 | 打开侧边助手成功后，再点扫描并预览 | 侧栏已开时扫描是否仍触发 |
| G01-07 | Edge 与 Chrome 各测一轮 | 是否一边严一边松 |
| G01-08 | 扩展 Popup 失去焦点瞬间点击 | 失败率 |
| G01-09 | storage 人为变慢（DevTools 节流） | 失败是否必现 |
| G01-10 | 打开侧栏失败时 session 是否已写入 PENDING 请求 | 残留请求导致下次误扫 |
| G01-11 | 失败后手动开侧栏是否自动扫 | startRequestedPopupScan 是否接手 |
| G01-12 | 无网环境 | 与网络无关，应仍复现手势问题 |
| G01-13 | 有档案 / 无档案 | 无档案应禁用，不测 open |
| G01-14 | 从 Options 回到 Popup 再点 | 手势是否仍断 |
| G01-15 | 控制台是否有 sidePanel 相关报错 | 截取错误原文 |

### 分析结论

**根因是调用时序违反扩展 API 约束**，不是网申页问题。修复方向（仅建议，本轮不做）：同步先 `sidePanel.open`，再异步写 storage / 设默认。

---

## 三、BUG-02（high）：多段经历/项目「添加行」与 Chao 整页编排被旁路

### 表现

P0 为「预览=写入」砍掉 `runChaoRuleAutofill`，`sectionAdds` / `profileData` 在 `applyFillPlan` 成了 `_sectionAdds` / `_profileData` **未使用**。  
结果：档案有 2 段实习、页面只有 1 行时，**不会再自动点「添加」补行**；只写扫描时已存在的 `fieldId`。复杂网申（北森/Moka/Boss 多段）成功率相对 P0 前明显下降。

### 代码位置

- `src/content/filler/fillFields.ts`：`applyFillPlan` 签名与实现  
- `src/entrypoints/background.ts`：`forwardApplyWithFiles` 仍计算并下发 `sectionAdds`、`profileData` → **后台白算，内容脚本丢弃**（上下游不一致）

### 专项案例（18）

| ID | 案例 | 期望（钉死） |
|----|------|--------------|
| G02-01 | 档案 2 段工作，页 1 空行，预览仅 1 组字段 | 确认写入后第 2 段是否仍缺行 |
| G02-02 | 档案 3 项目 / 页 1 行 | 同上 |
| G02-03 | 教育 2 段 | 同上 |
| G02-04 | 扫描阶段是否已点过「添加」 | 扫完 DOM 行数 vs 档案条数 |
| G02-05 | 预览里是否出现第 2 行字段 | 若扫描未展开则预览也无 |
| G02-06 | 手动点添加后再扫再写 | 应能写第 2 行（对照：能力在扫描不在写入） |
| G02-07 | background 消息里 sectionAdds 是否非空 | DevTools 看 APPLY 载荷 |
| G02-08 | content 是否忽略 sectionAdds | 断点 applyFillPlan |
| G02-09 | Boss 直聘在线简历多模块 | 编辑展开后多段 |
| G02-10 | 北森重复块 | 添加按钮文案「新增」 |
| G02-11 | 仅 1 段档案 | 应不受影响（基线） |
| G02-12 | 预览改第 1 行值 | 第 1 行仍应写入（Session 主路径） |
| G02-13 | 扫描预算耗尽只扫到部分行 | 写入不会补齐 |
| G02-14 | 撤销后行数 | 添加出的行是否残留 |
| G02-15 | 空 plan 附件-only | 与补行无关，防回归空写 |
| G02-16 | 对比 P0 前 Chao 行为录像 | 列出消失的自动添加步骤 |
| G02-17 | profileData 是否仍传入 | 传入但未用 |
| G02-18 | 校园经历 / 培训多段 | 同类 sectionAdds 模式 |

### 分析结论

这是 **P0 有意换路径时的功能回退**，不是偶然笔误：预览真相修好了，但「补行」责任没接到 Session 写入链。后台与内容脚本契约已破裂（仍传 sectionAdds）。

---

## 四、BUG-03（medium）：附件写入后「撤销本轮」很可能无效

### 表现

文本控件在写入前进入 `lastUndoSnapshots`；`applyFilePayloads` 在之后写 file，**未加入快照**。撤销只还原文本/select，文件框通常清不掉或根本不在快照里。

### 代码位置

- `fillFields.ts`：`captureUndoSnapshotsForElements(preparedElements)` 仅含非 attachment 的 prepare 结果  
- 随后 `applyFilePayloads` 独立写 file  

### 专项案例（12）

| ID | 案例 | 期望（钉死） |
|----|------|--------------|
| G03-01 | 仅文本写入后撤销 | 文本应恢复（对照通过项） |
| G03-02 | 文本+简历 file 写入后撤销 | 文件名是否仍在 |
| G03-03 | 仅附件（若能触发） | 撤销行为 |
| G03-04 | 头像 file | 同上 |
| G03-05 | 撤销次数与 filled 计数 | 文案「已撤销 N 项」是否不含文件 |
| G03-06 | 二次写入再撤销 | 只撤最近一轮文本 |
| G03-07 | file 控件隐藏 display:none | 是否误匹配 |
| G03-08 | 多 file 框串简历/头像 | 写入对不对（功能）+ 撤销 |
| G03-09 | plan.attachmentId 映射 | fieldId 定向 vs 文案兜底 |
| G03-10 | profile 无附件 | 不走 file 路径 |
| G03-11 | 大 PDF | 写入成功标准 |
| G03-12 | 撤销后页面校验必填文件 | 站点是否仍认为已上传 |

---

## 五、BUG-04 / BUG-06（low～medium 体验）：文案与按钮不一致

### 表现

- Popup 按钮：`扫描并预览`（index.html）  
- 就绪状态：`点「扫描并填写」会在侧栏…`（main.ts bootstrap）  

用户以为还有「填写」一键写完。

### 专项案例（10）

| ID | 案例 |
|----|------|
| G06-01 | 冷启动看状态文案 |
| G06-02 | 无档案状态文案 |
| G06-03 | 侧栏 EMPTY_MAPPING_HINT 是否仍写旧话 |
| G06-04 | Options 提示是否提「直接填写」 |
| G06-05 | 清单/README 是否过时 |
| G06-06 | 成功打开侧栏后的 Popup 状态句 |
| G06-07 | 浏览器中英文系统 | 是否仅中文 |
| G06-08 | 截图留档对比按钮 |
| G06-09 | 侧栏主按钮「确认写入」「扫描本页」 |
| G06-10 | 停止/撤销文案是否仍说「一面扫一面写」 |

侧栏 `EMPTY_MAPPING_HINT` 已在 P0 改为「扫描本页…确认写入」——此项侧栏侧基本 OK；问题集中在 Popup。

---

## 六、BUG-05（low）：Miss 表 label 用 `item.reason`

### 表现

`prepareFieldForWrite` 失败时：

```ts
label: item.reason || item.fieldId
```

若 reason 是「启发式：手机」，用户在「没写上的」表看到的是理由不是「手机」字段名。

### 专项案例（10）

| ID | 案例 |
|----|------|
| G05-01 | 刷新后写入制造找不到框 |
| G05-02 | 关闭弹层后写 |
| G05-03 | 多字段同时 Miss，看 label 列 |
| G05-04 | reason 为空时是否回退 fieldId |
| G05-05 | 手动跳过栏写入失败 |
| G05-06 | 与成功高亮字段对照 |
| G05-07 | UUID fieldId 是否直接露给用户 |
| G05-08 | 侧栏 resolveFieldLabel 是否本可用于 Miss |
| G05-09 | 国际化长 reason |
| G05-10 | 截图验收 |

---

## 七、外点探针通过项（说明基础写入能力仍在）

在独立 Fixture 上用 Playwright **真实 click / keyboard**（非扩展注入）：

- 原生 select「硕士」  
- 键盘输入手机并触发 input 监听  
- 仿 Ant 下拉点「深圳」  
- contenteditable 输入  
- 原型 value setter 写姓名  

说明：**单控件写入手段本身可用**；当前高优先级问题在「扩展壳时序」与「多段编排被拿掉」，不在 keyboard/click 基础能力。

---

## 八、50 案覆盖与缺口说明

| 区块 | 本轮如何覆盖 |
|------|----------------|
| A 预览=写入 | 代码确认 plan 已接入；外点模拟改值写入；完整扩展链需手工 1–8 |
| B 去 direct | 代码确认类型删除；Options/侧栏需手工点开确认 UI |
| C Popup 交接 | **代码判定 BUG-01**；需真机扩展验证 G01-* |
| D Session | 模块与监听键代码通过 |
| E 复杂控件 | Fixture 外点部分通过；真网申 34–37、39 需手工；**34 已升格 BUG-02** |
| F Laya 占位 | 默认值代码有；持久化需手工 44–45 |
| G 回归 | 需手工 |

**未在本轮用真扩展跑完的原因：** QA 环境未加载 unpacked 扩展到用户日常浏览器配置；已用源码探针 + Playwright 外点最大化可复现结论。请你本地加载 `.output/chrome-mv3` 后优先跑 **G01、G02** 两组专项。

---

## 九、建议你本地验证的最短路径（仍不修）

1. `npx wxt build` 后加载 `.output/chrome-mv3`  
2. 只跑 **G01-01～G01-05**（Popup 侧栏）  
3. 只跑 **G02-01、G02-06、G02-07**（多段行）  
4. 可选：`node scripts/p0-qa/run-p0-probes.mjs` 复现外点  

将结果对照本汇总即可定修复优先级；**按你的要求，此处不提交任何修复补丁。**
