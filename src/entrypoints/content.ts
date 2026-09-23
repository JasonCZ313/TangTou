// 内容脚本入口：后续挂载扫描与填写监听
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Resume Autofill] content ready');
  },
});
