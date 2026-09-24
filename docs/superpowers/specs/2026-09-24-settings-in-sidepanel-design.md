# 设置进侧栏 + 日常仍用 Popup

> 状态：已实现（2026-09-24）

## 约定

| 场景 | 入口 |
|------|------|
| 日常扫描 / 写入 / 撤销 | **右上角 Popup**（点扩展图标） |
| 改 API、填写模式、新建档案 | **侧边助手**（Popup「打开设置」会打开并展开设置区） |
| 编辑完整简历（民族/省市区等） | 侧栏「编辑完整简历档案」→ **新标签页** Options |

点扩展图标 **不会** 直接开侧栏（`openPanelOnActionClick: false`）。

## 技术点

- `options_ui.open_in_tab: true`，避免 Edge 盖在 `edge://extensions` 上的小窗
- 完整编辑用 `chrome.tabs.create(options.html)`，不用 `openOptionsPage` 弹窗体验
- Popup「打开设置」写 `session.sidePanelFocusSettings` 后 `OPEN_SIDE_PANEL`
