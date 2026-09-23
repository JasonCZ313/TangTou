import { defineConfig } from 'wxt';

// WXT 扩展构建配置：声明权限、内容脚本匹配范围与侧边栏
export default defineConfig({
  // 入口目录位于 src/entrypoints，与仓库文档约定一致
  srcDir: 'src',
  // 相对 srcDir：指向仓库根目录 public/（内含 icons/*.png）
  publicDir: '../public',
  modules: [],
  manifest: {
    name: 'Resume Autofill',
    description: '本机档案 + 用户自备 API Key，通用站点智能填写简历表单（不自动提交）。',
    permissions: ['storage', 'sidePanel', 'scripting'],
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
      default_title: 'Resume Autofill',
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
  },
});
