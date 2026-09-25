import versionRecord from '../../version.json';

/**
 * 界面版本号 = git 标签 + 本地修订。
 * 标签仍是 V1.5.2 时，每次改动把 version.json 的 localRevision 加 1，变成 V1.5.2.1、V1.5.2.2。
 * 若用户推送后的新标签是 V1.6.0，下一次改动把 baseTag 改成 V1.6.0，localRevision 改为 1，即 V1.6.0.1。
 * 与标签完全一致、尚未再改时，localRevision 为 0，显示 V1.5.2.0。
 */
export const APP_VERSION_BASE_TAG = versionRecord.baseTag;

/** 当前标签之后已经做过的本地改动次数 */
export const APP_VERSION_LOCAL_REVISION = versionRecord.localRevision;

/** 侧栏、弹窗、档案页上给人看的版本号 */
export const APP_VERSION_LABEL = `${APP_VERSION_BASE_TAG}.${APP_VERSION_LOCAL_REVISION}`;

/**
 * 扩展清单用的四段数字版本，不含字母 V。Chrome 要求版本只能是点分数字。
 */
export function appVersionForManifest(): string {
  const numericBase = APP_VERSION_BASE_TAG.replace(/^V/i, '');
  return `${numericBase}.${APP_VERSION_LOCAL_REVISION}`;
}

/**
 * 把页脚的版本号写成当前 APP_VERSION_LABEL，用来确认扩展是否已经载入这次改动。
 */
export function mountAppVersionLabel(): void {
  const versionLabel = document.getElementById('appVersionLabel');
  if (!(versionLabel instanceof HTMLElement)) {
    return;
  }
  versionLabel.textContent = `版本 ${APP_VERSION_LABEL}`;
}
