# 躺投 — 能力降级矩阵（P6）

不确定或依赖不可用时，扩展**降级继续**或**标 Miss**，禁止把错填当成功。

| 场景 | 表现 | 用户可做什么 |
|------|------|--------------|
| 未配置 API Key / Base URL | 规则启发式映射；探活用启发式 Playbook | 配置 OpenAI 兼容 API 提升云端质量 |
| API 超时 / HTTP 失败 | 回退规则或上次启发式；侧栏红字提示 | 检查网络、域名权限、测连 |
| 本机 Laya 未启用/未缓存/无 Server | Decision 跳过 local，走规则→云端 | 启用内置包，或配置 Laya Server URL |
| Laya Server 不可达 / 非 tangtou-laya | 回退 ORT 包或轻量判断，再不行上云 | `npm run laya:server` 自测；选项页「测试 Laya Server」 |
| ORT 会话失败 / I/O 不对齐 / 无命中 | 静默回退轻量 choice，不挡预览 | 自备 `tangtou-score-v0` 对齐的 model.onnx |
| 截图失败 | 跳过 OCR，仅用 DOM 标签；侧栏警告色软提示 | 确认标签页可见、有 `activeTab` 场景 |
| OCR 失败 / 空文本 | 预览仍可生成，弱标签可能变少；软提示不以红框冒充整次失败 | 重新加载扩展后再扫；OCR 在 Offscreen（扩展同源）运行 |
| Offscreen 不可用 | 跳过截图识字，对照主路径继续 | Chromium 内核浏览器；扩展详情确认未禁用 |
| 内容脚本 Tesseract Worker | **已禁止**；页内 `createWorker` 会触发 origin 拒绝 | 识字只走 `OFFSCREEN_OCR`（可搜索该关键字） |
| 多模态被模型拒绝 | 自动回退纯文本探活提示 | 换支持视觉的模型，或忽略 |
| 受控探测点击失败/超时 | 仍用只读 DOM 证据生成方案 | 手动展开面板后重试探活 |
| 置信度低于阈值 | 进跳过/未填，不写入 | 调高档案完整度或侧栏手填 |
| 写入后回读不匹配 | Miss + 标红，不计入成功 | 手改页面或改预览值再写 |
| 命中提交类按钮 | 永不点击 | — |
| 已命中 P3 适配器 | 提示优先「扫描本页」快路径；探活可选 | 日常站用扫描；变态页再探活 |
| 用户点停止 | 当前格结束后中断 | — |

相关代码路径：`DecisionRouter`、`localEngine`、`playbookEngine`、`safeClick`、`fillFields` 回读；P4b OCR：`offscreenOcrBridge` / `OFFSCREEN_OCR`（禁止内容脚本 Worker）。
