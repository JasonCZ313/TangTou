/**
 * 快捷条在预览模式下，把扫描交给侧边助手。
 * sidePanel.open 只能出现在用户点击的同一次调用里；扫描要等很久，不能扫完再打开。
 */

/** 会话存储键。快捷条写入，侧栏读走后删除。 */
export const PENDING_POPUP_SCAN_REQUEST_KEY = 'pendingPopupScanRequest';

/**
 * 一次交给侧栏的扫描。
 * profileId 是快捷条里当时选中的档案；requestId 用来区分重复投递。
 */
export interface PendingPopupScanRequest {
  profileId: string;
  requestId: string;
}
