import { defineConfig } from 'wxt';

// WXT 扩展构建配置：声明权限、内容脚本匹配范围与侧边栏
export default defineConfig({
  // 入口目录位于 src/entrypoints，与仓库文档约定一致
  srcDir: 'src',
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
    action: {
      default_title: 'Resume Autofill',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
