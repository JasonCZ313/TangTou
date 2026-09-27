import versionRecord from '../../version.json';

/**
 * 界面版本号 = git 最近一次提交备注里的版本号 + 本地修订。
 *
 * 规则（与仓库 git 备注保持一致）：
 *  1) git 最近一次提交备注写成「V1.11.0：…」时，baseTag 就跟着改成 V1.11.0；
 *  2) 该标签之后每做一次改动，把 version.json 的 localRevision 加 1，得到 V1.11.0.1、V1.11.0.2…；
 *  3) 用户下次提交备注升级为「V1.12.0：…」时，把 baseTag 改成 V1.12.0、localRevision 归 1，即 V1.12.0.1。
 *  4) 与标签完全一致、尚未再改时，localRevision 为 0，显示 V1.11.0.0。
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
