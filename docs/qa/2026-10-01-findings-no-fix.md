# 躺投近期功能排查报告（只发现、不修复）

**日期：** 2026-10-01  
**范围：** P5 / P7a–c / P6 / P2c 及相关接线  
**方法：** 200 条用例清单 + 代码静态复核 + 逻辑复现脚本 + 本地 HTTP fixture 真点模拟（Cursor 浏览器 CDP，**未**注入扩展 content script）  
**约束：** 本轮**不改产品代码**，只汇总问题与深挖案例。

用例总表：[`docs/qa/2026-10-01-p5-p7-p6-p2c-200-cases.md`](./2026-10-01-p5-p7-p6-p2c-200-cases.md)

---

## 一、已核实的问题清单（按严重度）

### P1 — 探活合并会覆盖更高/同级云端本机提案（含低置信覆盖高置信）

**表现：** `mergePlaybookIntoFillPlan` 只要原项不是 `user`，一律用 probe 覆盖；注释写「优先级」，实现未比较 `mergeIntents` 的来源优先级，也未比较 confidence。  
**复现（脚本）：**

- 已有 `llm` conf=0.95「云端值」→ 探活 conf=0.6「探活值」→ 结果变为探活值。  
**代码：**

- `src/shared/playbook/mergeToPlan.ts` 约 71–79 行：仅跳过 `source==='user'`。  
- 对比 `src/shared/session/mergeIntents.ts`：`user > probe = laya = llm > rule`，同级才允许后写覆盖；探活合并路径**未走**该优先级表。  
**影响：** 用户先扫描得到云端/本机较好映射，再「合并进预览」，可能被较弱探活建议冲掉；与产品「不确定勿假成功」冲突。  
**深挖案例：** 见下文 §P1-D01～D25。

---

### P2 — 确认执行时，无建议值的月份步会失败并中断后续填写

**表现：** 启发式方案顺序为：年份 `open_picker` → 月份 `select_option`（常无 `suggestedValue`）→ 常规 `fill_field`。  
`selectExecutablePlaybookSteps` 不过滤「有无建议值」；执行到 `select_option` 缺值 → `ok:false` → **整段停止**，姓名等 fill 永不执行。  
**代码：**

- `src/shared/decision/playbookEngine.ts` 年份/月份步构造（约 124–147 行）月份无 `suggestedValue`。  
- `src/shared/playbook/mergeToPlan.ts` `selectExecutablePlaybookSteps`（105–125 行）。  
- `src/content/probe/executePlaybook.ts` fill/select 缺值直接失败（116–123）；主循环失败即 `break`（266–273）。  
**影响：** fixture / 真实变态页一点「确认执行探活方案」，极易在月份步倒下，表现为「执行失败、前面只乱开了下拉、正文没填」。  
**深挖案例：** §P2-D01～D25。

---

### P3 — `open_picker` 仅打开未选中仍返回成功

**表现：** 无 `suggestedValue` 或选项未匹配时，仍 `ok: true`，文案「已打开选择器（未匹配到建议选项，请人工点选）」。在「逐步回读闸」语义下，这是**假成功**：未改变字段值却推进 completed。  
**代码：** `src/content/probe/executePlaybook.ts` 184–223 行。  
**影响：** 与 P2 叠加时，年份步「成功」→ 月份步失败停止；用户以为年份已填好。  
**深挖案例：** §P3-D01～D20。

---

### P4 — 侧栏无法关闭受控探测点击（产品/安全可控性缺口）

**表现：** `runProbeAnalyzeFlow` 写死 `enableProbeClicks: true`；Background 默认 `!== false` 即开。UI 无开关。  
**代码：** `src/entrypoints/sidepanel/main.ts` 写死 `enableProbeClicks: true`；`src/entrypoints/background.ts` 约 601 行默认 `!== false`。  
**影响：** 敏感页无法「只读探活」；误点风险只能依赖黑名单（虽对 fixture 保存/提交/添加验证通过）。  
**深挖案例：** §P4-D01～D15。

---

### P5 — 危险文案用 `includes('确定'|'保存'|…)` 可能过宽

**表现：** `adapterIsDangerSaveLabel`：`compact.includes(label)`。`保存` 命中「保存草稿」（期望）；但「确定」也会命中「已确定的工作城市」等**非按钮**长文案，或「确定添加本行」类按钮在执行路径被拒。  
**代码：** `src/content/adapters/types.ts` 51–57 行；`src/content/probe/safeClick.ts` `isDangerProbeLabel` 复用。  
**影响：** 误杀安全点击 / 或日志噪音；需案例矩阵确认。  
**深挖案例：** §P5-D01～D20。

---

### P6 — `localEngine.ready()` 对任意 http(s) URL 返回 true

**表现：** 未启用包缓存时，只要 `layaModelUrl` 像 URL 即 ready；每次 decide 先打 `/health`。用户误填 API Base、静态包根、死链，都会多一轮探测再 `LOCAL_ENGINE_NOT_READY` 或回退。  
**代码：** `src/shared/decision/localEngine.ts` 35–45、53–70 行。  
**影响：** 延迟、权限弹窗骚扰、日志难懂；不是功能全挂，但是 P2c 接线缺陷。  
**深挖案例：** §P6-D01～D20。

---

### P7 — 侧栏缺少「测试 Laya Server」，与选项页能力不一致

**表现：** Options 有测 Server；Sidepanel 仅 URL 框。  
**影响：** 用户只开侧栏时无法验证 P2c 连通。  
**级别：** 中低（体验 inconsistency）。

---

### P8 — file:// 打开 fixture 时扩展通常不注入（环境陷阱）

**表现：** 文档/习惯用 file 打开 HTML；MV3 content_scripts 对 file 默认不匹配或需「允许访问文件」。  
**核实：** 本轮用 `http://127.0.0.1:8766` 才能稳定测 DOM；file 路径需单独案例。  
**级别：** 文档/验收陷阱（易误判「探活坏了」）。

---

### P9 —（观察）Cursor 浏览器无法加载未打包扩展，本轮「扩展内真探活」未跑通

**表现：** IDE 浏览器可打开 fixture 并模拟点击逻辑，但**没有**躺投 content script，故 BUILD_SITE_PLAYBOOK / safeClick 真扩展路径需 Chrome 加载 `.output/chrome-mv3` 后手测。  
**级别：** 测试覆盖缺口，不是产品 bug；已在 200 案标注 `[真点]`。

---

### 本轮真点模拟通过的项（非问题）

在 fixture `http://127.0.0.1:8766/` 用 CDP 模拟探测点击策略：

- 城市/年/月下拉可读到选项；展开更多信息可打开。  
- **添加教育 / 保存草稿 / 提交投递 点击计数均为 0**（黑名单+添加过滤逻辑与预期一致）。  

→ P7c 黑名单在「纯 DOM 策略模拟」下对 fixture **未发现误点提交**；仍需扩展注入后回归。

---

## 二、深挖案例包（按问题）

### §P1 探活合并覆盖 — 25 案

| ID | 案例 | 目的 |
|----|------|------|
| P1-D01 | llm 0.95 vs probe 0.55 同 fieldId 合并 | 低置信覆盖？ |
| P1-D02 | llm 0.95 vs probe 0.95 | 同级策略 |
| P1-D03 | laya 0.9 vs probe 0.7 | 本机被盖？ |
| P1-D04 | rule 0.99 vs probe 0.6 | 规则被盖（或符合设计） |
| P1-D05 | user 改值后合并 | 必须保留 user |
| P1-D06 | 无 source 旧项 vs probe | 视为可盖？ |
| P1-D07 | 合并两次探活 | 值与计数 |
| P1-D08 | 合并后 reason 是否丢云端理由 | 可追溯性 |
| P1-D09 | 驾驶舱来源分布合并前后 | UI |
| P1-D10 | 与 mergeMappingItems 行为对比单测 | 一致性 |
| P1-D11 | 先合并再扫云端 | 顺序 |
| P1-D12 | 先云端再合并 | 主伤路径 |
| P1-D13 | 附件 attachmentId 被 probe 冲掉？ | 附件 |
| P1-D14 | skippedNotes 清理 | 边界 |
| P1-D15 | 合成 field 行标签 | UX |
| P1-D16 | 置信阈值卡掉 probe 后 llm 是否仍在 | 交互 |
| P1-D17 | 多 field 部分覆盖 | 局部 |
| P1-D18 | 空 plan 首次合并 | 基线 |
| P1-D19 | 合并文案「已合并 N 项」与真覆盖数 | 计数语义 |
| P1-D20 | primaryEngine 合并后是否仍显示 cloud | 徽章误导 |
| P1-D21 | 撤销写入与 plan source | 会话 |
| P1-D22 | 导出/无导出 plan | N/A |
| P1-D23 | 并发点两次合并 | 竞态 |
| P1-D24 | probe 空值过滤 | 负例 |
| P1-D25 | 代码注释 vs 实现 diff 评审 | 文档债 |

**根因判断：** 与 `mergeMappingItems` 在「来源等级」上同属 probe=llm，但本路径**无置信度比较、无择优**，低 conf 探活可冲掉高 conf 云端/本机值；注释写「同级覆盖」未说明置信门槛，属明确体验/质量缺陷。

---

### §P2 执行链被无值月份步掐断 — 25 案

| ID | 案例 | 目的 |
|----|------|------|
| P2-D01 | p7c fixture 启发式步骤顺序打印 | 确认 year→month→fill |
| P2-D02 | selectExecutable 列表是否含无值 month | 过滤缺口 |
| P2-D03 | 确认执行后姓名是否仍空 | 端到端 |
| P2-D04 | misses 是否停在月份 | 停点 |
| P2-D05 | completed 是否仅 1（年份假成功） | 与 P3 |
| P2-D06 | 调高阈值过滤掉 0.68 month | 权宜是否「碰巧修好」 |
| P2-D07 | 档案含入学月时启发式是否补 suggestedValue | 引擎缺口 |
| P2-D08 | 云端 playbook 是否也缺月值 | 云端 |
| P2-D09 | 手动改方案不可能（无编辑器） | 产品 |
| P2-D10 | 只保留 fill 步能否写完 | 对照 |
| P2-D11 | click_add 在前且失败 | 同样中断模型 |
| P2-D12 | fill 失败中断 | 对照回读闸 |
| P2-D13 | 多月份控件连续失败 | 步数 |
| P2-D14 | 先合并再执行（合并不含 month） | 路径差 |
| P2-D15 | 执行过滤应要求 suggestedValue 或非 select | 修复方向（勿在本轮做） |
| P2-D16 | open_picker 无值是否应跳过而非成功 | 联动 P3 |
| P2-D17 | 教育行添加后新月份 | 动态 |
| P2-D18 | Boss 真站月份控件 | 外推 |
| P2-D19 | 停止按钮在月份失败前 | 交互 |
| P2-D20 | 浮层最终文案 | UX |
| P2-D21 | 与「确认写入」路径对比同页 | 双路径 |
| P2-D22 | 置信 0.55 无值 fill 是否也进可执行 | 同类 |
| P2-D23 | 单元：selectExecutable 快照 | 回归钉 |
| P2-D24 | 单元：execute 遇缺值应 skip 或 fail-continue？ | 产品决策 |
| P2-D25 | 代码审：失败即 break 是否过严 | 架构 |

**根因判断：** 「可执行过滤」与「执行前置条件」不一致 + 「失败即全局停止」过严，导致启发式方案结构性写不全。

---

### §P3 open_picker 假成功 — 20 案

| ID | 案例 | 目的 |
|----|------|------|
| P3-D01 | 无 suggestedValue 打开年 | ok 值 |
| P3-D02 | 有建议值但选项不匹配 | ok 值 |
| P3-D03 | 有建议值匹配成功 | 真成功 |
| P3-D04 | completed++ 是否发生 | 计数 |
| P3-D05 | 回读字段仍为「请选择年」 | 页面 |
| P3-D06 | 与 fill 回读闸对比 | 标准不一致 |
| P3-D07 | 城市建议值北京 | 正路径 |
| P3-D08 | 危险建议值拒绝 | 安全 |
| P3-D09 | 找不到 host | ok=false |
| P3-D10 | 打开后选项在 portal/body 外 | 选择器 |
| P3-D11 | 执行后下拉仍挂起 | UX |
| P3-D12 | 连续多个 open_picker | 面板叠 |
| P3-D13 | 与探测阶段打开的差异 | 职责 |
| P3-D14 | Miss 表是否记录「仅打开」 | 可观测 |
| P3-D15 | 产品：仅打开应算 observe？ | 语义 |
| P3-D16 | 代码 ok:true 分支文案 | 审查 |
| P3-D17 | 自动化断言 actualValue | 钉缺陷 |
| P3-D18 | Ant Select 只开未选 | 组件 |
| P3-D19 | 原生 select 误走 open_picker | 分类 |
| P3-D20 | 修复方向：ok=false 或 skipped | 勿本轮改 |

---

### §P4 探测开关缺失 — 15 案

| ID | 案例 | 目的 |
|----|------|------|
| P4-D01 | 侧栏无「关闭探测」 | UI |
| P4-D02 | 消息 enableProbeClicks:false 是否生效 | API |
| P4-D03 | 敏感页误展开隐私区 | 风险 |
| P4-D04 | 探测 notice 文案 | 知情 |
| P4-D05 | 与隐私政策「可关闭」表述对照 | 文档一致性 |
| P4-D06～D15 | 各站点只读探活需求矩阵 | 产品 |

---

### §P5 危险匹配过宽 — 20 案

| ID | 案例 | 目的 |
|----|------|------|
| P5-D01 | 「保存草稿」 | 应危险 |
| P5-D02 | 「提交投递」 | 应危险 |
| P5-D03 | 「确定」独词按钮 | 应危险 |
| P5-D04 | 「我已确定上述信息属实」checkbox 标签 | 是否误杀 |
| P5-D05 | 「下一步填写教育」 | includes 下一步 |
| P5-D06 | 「完成」工具提示 | 边界 |
| P5-D07 | 无适配器默认名单 | 对照 |
| P5-D08 | Boss saveLabels | 站点 |
| P5-D09 | 执行 click_add「确定添加」 | 误拒？ |
| P5-D10～D20 | 真实站按钮文案采样表 | 外推 |

---

### §P6 localEngine.ready 过宽 — 20 案

| ID | 案例 | 目的 |
|----|------|------|
| P6-D01 | URL=https://api.openai.com/v1 | ready? |
| P6-D02 | URL=静态包根无 /health | 延迟 |
| P6-D03 | URL=死链 | 超时 |
| P6-D04 | URL 空 + 内置包 | 正常 |
| P6-D05 | Server 正常 | 正路径 |
| P6-D06 | layaEnabled false | ready false |
| P6-D07 | 每次 BUILD 打 health 次数 | 性能 |
| P6-D08 | 权限弹窗频率 | UX |
| P6-D09 | health 200 但 service 错 | 拒绝 |
| P6-D10～D20 | 混用 API URL 与 Laya URL | 配置错误态 |

---

## 三、建议的下一步（仍不在本轮改代码）

1. **优先处理 P1 + P2 + P3**：直接破坏「预览质量」和「确认执行」主路径。  
2. 用 Chrome 加载扩展，对 `http://127.0.0.1:8766` 跑用例 183/184/105–107，给 P2/P3 补「扩展内」证据截图。  
3. P4/P5/P6/P7 可列为 P2c/P7c 体验与安全加固。  
4. 验收文档明确：**fixture 必须用 http(s) 本地服，不要 file://**（P8）。

---

## 四、本轮未覆盖 / 需你本地补的真扩展点击

因 IDE 浏览器无扩展注入，下列必须在真实 Chrome/Edge 加载产物后勾选：

- 侧栏「智能探活」完整消息链  
- 「合并进预览」「确认执行」  
- Options「测试 Laya Server」+ 实际 BUILD_FILL_PLAN 来源列  
- 页内浮层停止  

对应总表中所有 `[真点]` 且依赖扩展的行。
