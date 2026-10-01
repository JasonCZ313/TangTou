# 躺投 — Chrome / Edge 商店上架材料（P6）

填写 [Chrome Web Store](https://chrome.google.com/webstore/devconsole) 或 Edge 合作伙伴中心时，可直接摘用本节文案。上架前请自行替换「隐私政策公开 URL」为你托管的页面（仓库内正文见 [`../privacy-policy.md`](../privacy-policy.md)）。

## 单一用途（Privacy practices）

在用户确认后，将本机维护的简历档案辅助映射并填写到当前网页的求职/申请表单；不自动提交表单。

## 简短描述（≤132 字符建议）

躺投：本机简历档案 + 自备 API，预览确认后智能填写网申表单，不自动提交。

## 详细描述（商店长文案）

躺投帮你把简历档案留在浏览器本机，打开任意网申页后：

1. 扫描页面表单  
2. 用规则 / 本机判断 / 你自备的 OpenAI 兼容 API 生成填写预览  
3. 你在侧栏核对（可改）后再写入  
4. 写入后回读校验；不确定的字段标为未填，绝不假装成功  

**不会**自动点击投递/提交。常见 ATS（北森、Moka、智易、牛客、Boss 等）有站点适配加速；复杂大厂页可用「智能探活」生成步骤方案后再确认执行。

数据默认不出开发者服务器：档案与 API Key 存本机；仅在你配置了 API 时，字段摘要才会发往该地址。

## 分类建议

Productivity（效率工具） / 办公。

## 权限说明（Dashboard 逐条粘贴）

| 权限 | 用途说明（英文可略译） |
|------|------------------------|
| `storage` | 本机保存档案、设置、会话预览与 Token 统计 |
| `sidePanel` | 侧栏展示预览映射、探活方案、确认写入 |
| `scripting` | 向当前页注入内容脚本以扫描、高亮、安全写入 |
| `activeTab` | 在用户操作时对当前标签可见区截图，供本机 OCR / 可选探活多模态 |
| `offscreen` | 在离屏文档中加载 onnxruntime-web，供可选本机 ONNX 判断 |
| `unlimitedStorage` | 缓存本机 Laya 判断包（避免 storage 配额不足） |
| Host `http://*/*` `https://*/*` | 在用户打开的网页上读取表单 DOM 并写入（通用网申场景） |
| Optional host | 按需授权用户配置的 API 域名（含 localhost / Ollama） |

未使用与上述无关的权限（无 identity、无 tabs 常驻追踪、无企业远程代码）。

## 数据披露勾选建议

- Personally identifiable information：是（档案中的姓名/电话等，存本机；云端映射时发往用户 API）  
- Authentication information：是（用户自备 API Key，仅本机）  
- Website content：是（扫描当前页表单标签与可见区截图 OCR）  
- 不出售用户数据；不用于与单一用途无关的广告画像  

## 截图建议（至少 1～5 张）

1. 选项页：档案 + API 配置  
2. 侧栏：映射预览「来源」列 + 确认写入  
3. 页内浮层：扫描/填写进度  
4. 智能探活步骤列表（强调不自动提交）  
5. （可选）未填原因表 / 撤销本轮  

分辨率按商店要求（Chrome 常见 1280×800 或 640×400）。

## 版本与包体

- 构建：`npm run sync:ort` → `npm run build` → `npm run zip`  
- ORT：仅打包 wasm EP（约 12MB），不含 JSEP；无大模型权重  
- 冒烟：`npm run smoke:build`（Chrome + Edge 产物校验）
