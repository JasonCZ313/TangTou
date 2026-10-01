# 第一期验收清单

对照设计规格 [§13 验收清单](superpowers/specs/2026-09-23-resume-autofill-extension-design.md#13-验收清单第一期)。

说明：

- **已完成（文档/构建）**：本任务可自动或静态确认的项。
- **待手动**：需在浏览器中人工操作后才能勾选。

| 规格项 | 状态 | 备注 |
| --- | --- | --- |
| 可创建至 5 份档案；第 6 份被拒绝并提示 | 待手动 | Options 页创建至上限后验证错误提示 |
| 可将档案改名为「海投版」；从该档案复制新建第二份后修改，源档案内容不变 | 待手动 | 验证深拷贝与改名互不影响 |
| 配置 OpenAI 兼容 Key 后，在本地测试 HTML 表单上完成「扫描 → 预览核对 → 确认写入」 | 待手动 | 需自备 Key；一律预览后写入（无 direct） |
| 撤销本轮填写可恢复写入前值 | 待手动 | 填写后点撤销，对照写入前快照 |
| 导出 JSON 默认不含 apiKey（或明显警告后可选包含） | 待手动 | 导出文件抽查；含 Key 路径须有警告 |
| Edge 与 Chrome 均可 `wxt` 构建并加载 `dist` | 部分完成 | `npm run smoke:build` 校验产物；浏览器内「加载已解压」仍须手测 |
| README 可独立完成安装与配置，无需作者服务器 | 已完成 | 见根目录 `README.md`；无自建后端要求 |
| 隐私政策含截图 OCR / 本机模型缓存 | 已完成 | `docs/privacy-policy.md`；选项页有显著披露 |
| ORT 商店包不含 jsep 大文件 | 已完成 | `npm run sync:ort` + smoke 检查 |
| 降级矩阵文档 | 已完成 | `docs/degradation-matrix.md` |

## 建议冒烟步骤（手动）

### A. 构建冒烟（可半自动）

1. `npm install` → `npm run smoke:build`（内含 sync:ort、Chrome/Edge 构建与产物检查）。
2. 确认输出无 `ort/*jsep*`，且存在 `ort-wasm-simd-threaded.wasm`。

### B. Chrome / Edge 加载冒烟（手动）

1. Chrome 加载 `.output/chrome-mv3`；Edge 加载 `.output/edge-mv3`。
2. Options：看到隐私披露；配置 Base URL / Key / 模型；测连；创建、改名、复制档案至 5 份上限。
3. 打开本地静态 HTML 表单页：扫描 → 预览核对（看来源列）→ 确认写入 → 撤销。
4. 打开 `scripts/p7c/probe-fixture.html`：智能探活 → 方案出现探测/选项信息；页面「提交投递」「添加教育」未被自动点；可「合并进预览」后确认写入（或确认执行探活）。
5. 导出 JSON，确认默认无 `apiKey`。
6. 可选：1～2 个真实招聘站仅做扫描与填写冒烟（勿自动提交）。有 P3 适配器的站应提示可走扫描快路径。

勾选完成后，可将上表「待手动」改为「已完成」，并同步更新设计规格 §13 中的复选框。
