// 后台服务工作者入口：后续在此注册消息与 Side Panel 行为
export default defineBackground(() => {
  // 点击扩展图标时不自动打开侧边栏（后续由产品交互决定）
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);

  console.log('[Resume Autofill] background ready');
});
