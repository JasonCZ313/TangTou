import { defineConfig } from 'wxt';
import { appVersionForManifest } from './src/shared/appVersion';

// WXT 扩展构建配置：声明权限、内容脚本匹配范围与侧边栏
export default defineConfig({
  // 入口目录位于 src/entrypoints，与仓库文档约定一致
  srcDir: 'src',
  // 相对 srcDir：指向仓库根目录 public/（内含 icons/*.png）
  publicDir: '../public',
  modules: [],
  manifest: {
    name: '躺投',
    version: appVersionForManifest(),
    description:
      '躺投：本机档案 + 用户自备 API Key，通用站点智能填写简历表单（不自动提交）。',
    // offscreen：本机 ORT（wasm EP）；unlimitedStorage：模型缓存；activeTab：截图 OCR（P4b/P7）
    // ORT 资产经 scripts/sync-ort-wasm.mjs 精简（不含 jsep）
    permissions: [
      'storage',
      'sidePanel',
      'scripting',
      'offscreen',
      'unlimitedStorage',
      'activeTab',
      // 关打开的名单时发一次真实鼠标点击；点完立即解除，不长期挂着调试
      'debugger',
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    optional_host_permissions: [
      'https://*/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    // 工具栏与扩展管理页图标（对应 public/icons 下的 PNG）
    icons: {
      16: 'icons/icon-16.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: '躺投 — 一键填写',
      // 与 icons 同源，避免加载后仍显示浏览器默认拼图图标
      default_icon: {
        16: 'icons/icon-16.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    // 内容脚本 OCR / Offscreen ORT 需要读取扩展内静态资源
    web_accessible_resources: [
      {
        resources: ['tesseract/*', 'ort/*', 'laya-sample/*'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
    // 本机识字需要在扩展页里编译 WASM
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  /**
   * WXT 生成 options_ui.page 后补上 open_in_tab，
   * 避免 Edge 把 Options 盖在扩展管理页上的小弹窗。
   */
  hooks: {
    'build:manifestGenerated'(_wxt, manifest) {
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
    },
  },
});
