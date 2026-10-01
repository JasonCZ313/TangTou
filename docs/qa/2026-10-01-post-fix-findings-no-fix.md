# 修复后回归排查报告（只发现、不修复）

**日期：** 2026-10-01  
**范围：** 批次①②③（P1–P8）落地后的二次全量排查  
**方法：** 200 条用例清单 + 代码复核 + 冒烟脚本 + fixture CDP 真点模拟（**未**注入扩展 content script）  
**约束：** **不改产品代码**；问题只汇总与深挖。

用例总表：[`docs/qa/2026-10-01-post-fix-200-cases.md`](./2026-10-01-post-fix-200-cases.md)

---

## 一、修复验证结论（已好转，非问题）

| 原问题 | 现状 |
|--------|------|
| P1 低置信探活冲高置信云端 | 冒烟通过：仅更高 conf 同级可盖；user/rule 行为符合设计 |
| P2 无值月份掐断执行 | `selectExecutable` 要求建议值；启发式可拆年/月 |
| P3 open_picker 假成功 | 无值/未匹配 → soft-skip；completed 只计 wrote |
| P4 无法关探测 | 侧栏/选项有开关，默认 true |
| P5 短「确定」误杀长说明 | 「我已确定…」「已确定的工作城市」冒烟安全 |
| P6 ready 过宽 | 失败缓存 120s 内 ready=false；冒烟通过 |
| P7 侧栏无测 Server | 已有按钮 |
| P8 file 陷阱 | notice + 空态 hint 已提示 http |

Fixture CDP：城/年/月/展开可点；保存草稿/提交投递/添加教育被标为危险/添加，未纳入探测点击目标。

---

## 二、本轮新发现 / 仍存问题（按严重度）

### N1 — 超长按钮文案（>24 字）含「提交」意图时，三层危险判定均可漏拦

**表现：**  
文案如「请您仔细核对下列个人信息与简历内容真实无误之后再点击提交」（len=28）：

- `adapterIsDangerSaveLabel` → **false**（一进函数 `length > 24` 直接 return）
- `executePlaybook.isDangerLabel` → **false**（无「投递/提交申请…」子串）
- `safeClick.isDangerProbeLabel` → **false**（同上）

**代码：**

- `src/content/adapters/types.ts` `textMatchesDangerSaveLabel`：先 `if (compact.length > 24) return false`，**之后**才有 endsWith(提交)，导致长按钮即使以「提交」结尾也被放行。
- `executePlaybook.ts` / `safeClick.ts` 强正则未覆盖「…点击提交」这类自然语言。

**影响：** 若站点用长文案做真实提交按钮，探测或执行路径理论上可能误点（取决于是否被选为 click 目标）。短按钮（保存草稿/提交投递）仍安全。

**深挖案例：** §N1-D01～D25。

---

### N2 — 年月标签「开始」语义过宽，可能绑错档案段

**表现：**  
`pickProfileDateForTemporalLabel` 中 `/入学|就读|教育|学历|开始/`：控件「开始年月」「开始时间」即使属于实习/项目，也可能落到 `education.startDate`。

**代码：** `src/shared/decision/playbookEngine.ts` 约 136–140 行。

**影响：** 启发式年/月 `suggestedValue` 错值 → 执行选错选项或 soft-skip；合并进预览（若 select_option）写入错误月份。

**深挖案例：** §N2-D01～D22。

---

### N3 — 城市等 `open_picker` 有建议值却不能「合并进预览」

**表现：**  
`isPlaybookStepMergeable` 仅允许 `fill_field` / `select_option`。城市 combobox 是 `open_picker`+`suggestedValue`，合并计数为 0（对该 field），用户以为「合并」会带上城市，实际只能靠「确认执行」。

**代码：** `src/shared/playbook/mergeToPlan.ts` 18–20 行。

**影响：** 体验缺口；不是执行假成功，但与 P7b 文案「合并进预览」预期易不符。

**深挖案例：** §N3-D01～D20。

---

### N4 — 确认执行：对话框步数 vs 成功写入数不一致（体验/可观测）

**表现：**  
`window.confirm` 展示 `selectExecutablePlaybookSteps.length`；结束后 `completed` 只计 `wrote===true`。大量 soft-skip 时：说「将执行 N 步」，结果「成功写入 M 步（M≪N）」。

**代码：** `sidepanel/main.ts` confirm；`executePlaybook.ts` completed 逻辑。

**影响：** 用户误判失败；非功能正确性 bug，但是回归后新语义的产品债。

**深挖案例：** §N4-D01～D20。

---

### N5 — 侧栏与选项页「探测开关」无实时同步（中低）

**表现：**  
两处各自读写 `enableProbeClicks`；一侧改完另一侧未打开时仍显示旧勾选，直到重新 `fillSettingsForm`。

**影响：** 以侧栏发起探活时消息带当前勾选为准，功能不错；选项页可能误导。

**深挖：** §N5-D01～D15。

---

### N6 —（观察）Service Worker 休眠后健康缓存丢失

**表现：** 失败 URL 在 SW 重启后重新 optimistic ready，可能再弹权限/打 /health 一次。

**级别：** 可接受的缓存局限，非逻辑错误；深挖作回归钉即可。

---

### N7 —（覆盖缺口）IDE 浏览器无扩展，扩展内真探活未在本轮跑通

与上次相同：需 Chrome 加载 `.output/chrome-mv3` 补 195–200。

---

## 三、深挖案例包

### §N1 超长提交文案漏拦 — 25 案

| ID | 案例 | 目的 |
|----|------|------|
| N1-D01 | len=28「…再点击提交」三路径矩阵 | 复现洞 |
| N1-D02 | len=25 临界 | 边界 |
| N1-D03 | len=24 以提交结尾 | 是否 endsWith 生效 |
| N1-D04 | 「提交申请」在长句中 | 强正则是否救 |
| N1-D05 | 「立即投递」短句 | 对照正例 |
| N1-D06 | 「保存并提交」短句 | 对照 |
| N1-D07 | 长句含「最终提交」 | 强正则 |
| N1-D08 | 长句仅「提交」无其它关键词 | 主洞 |
| N1-D09 | 长句「保存」结尾 >24 | adapter |
| N1-D10 | 探测候选是否包含长按钮 | safeClick 选主 |
| N1-D11 | 执行 click_add 文案命中 | execute |
| N1-D12 | 真实站采样 10 条长按钮 | 外推 |
| N1-D13 | 适配器 saveLabels 定制 | 站点 |
| N1-D14 | 把 length 门禁移到 endsWith 之后？（勿本轮改） | 修复方向记录 |
| N1-D15 | 与「我已确定…」短说明对照 | 回归不伤 |
| N1-D16 | aria-label 长提交 | 文案来源 |
| N1-D17 | title 属性长提交 | |
| N1-D18 | 按钮内多节点拼接长文 | DOM |
| N1-D19 | fixture 增加长提交钮再 CDP | 真点 |
| N1-D20 | 扩展探活是否点到 | 真扩展 |
| N1-D21 | 确认执行是否点到 | 真扩展 |
| N1-D22 | 黑名单日志是否记录跳过 | 可观测 |
| N1-D23 | 英文长 Submit now please | 局限 |
| N1-D24 | 单元钉：len>24 && endsWith(提交) | 回归钉 |
| N1-D25 | 代码审：>24 与 endsWith 顺序 | 根因 |

**根因判断：** P5 收紧时用「长度上限」防误杀，但门禁放在 **前缀/后缀匹配之前**，把「长而真的提交按钮」一并放掉。

---

### §N2 「开始」绑错日期段 — 22 案

| ID | 案例 | 目的 |
|----|------|------|
| N2-D01 | 标签「开始年月」+ 有教育有实习 | 看 suggested 来源 |
| N2-D02 | 「实习开始」 | 是否仍教育 |
| N2-D03 | 「项目开始」 | 是否走项目支 |
| N2-D04 | 「入学」 | 正例教育 |
| N2-D05 | 「入职」 | 正例经历 |
| N2-D06 | 「毕业」 | endDate |
| N2-D07 | 仅经历无教育 | 回退 |
| N2-D08 | 日期格式 2020-09 | 拆解 |
| N2-D09 | 错误段导致执行选错年 | 端到端 |
| N2-D10 | 合并 select 写入错误月 | 预览 |
| N2-D11 | 无「开始」的「年月」 | 默认教育优先 |
| N2-D12～D22 | 真实站标签采样表 | 外推 |

**根因判断：** 正则把「开始」与教育绑在同一分支，缺少「工作/实习/项目」优先于裸「开始」的排序。

---

### §N3 open_picker 不可合并 — 20 案

| ID | 案例 | 目的 |
|----|------|------|
| N3-D01 | 城市有建议值点合并 | merged 含否 |
| N3-D02 | 年份 open_picker 有值 | 含否 |
| N3-D03 | 月份 select_option 有值 | 应能合并 |
| N3-D04 | 用户期望对照文案 | 产品 |
| N3-D05 | 仅执行路径写入城市 | 对照 |
| N3-D06 | 合并后预览无城市行 | UI |
| N3-D07～D20 | 其它 combobox 建议值 | 矩阵 |

**根因判断：** 合并白名单刻意窄（防无值 open 进 plan），但 **有 suggestedValue 的 open_picker** 未纳入，造成能力不对称。

---

### §N4 步数语义 — 20 案

| ID | 案例 | 目的 |
|----|------|------|
| N4-D01 | 打印 executable.length vs completed | 差 |
| N4-D02 | 全 soft-skip | completed=0 |
| N4-D03 | 半成功 | 文案 |
| N4-D04 | confirm 文案改「最多尝试」？（勿改） | 产品 |
| N4-D05～D20 | 各 soft-skip 原因分布 | 可观测 |

---

### §N5 开关双 UI 不同步 — 15 案

| ID | 案例 | 目的 |
|----|------|------|
| N5-D01 | 侧栏关、选项仍勾 | 复现 |
| N5-D02 | 探活以谁为准 | 消息 |
| N5-D03 | storage.onChanged 有无 | 代码 |
| N5-D04～D15 | 重开面板后是否刷新 | |

---

## 四、建议处理顺序（仍不在本轮改代码）

1. **N1（安全）**：长提交文案漏拦 — 优先于体验类。  
2. **N2（正确性）**：年月绑段。  
3. **N3 / N4（体验）**：合并范围与步数文案。  
4. **N5 / N6 / N7**：同步、缓存局限、真扩展补测。

---

## 五、请你本地补的真扩展点击

加载 `.output/chrome-mv3` 后勾选用例 **195–200、30、58–59、86–88、196–198**，把截图/miss 表结果贴回即可继续深挖。
