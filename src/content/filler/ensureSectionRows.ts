/**
 * 按档案条数只点「添加」补行，不写入任何档案正文。
 * 供扫描出预览前调用；有站点适配器时认「新增」等文案。
 * 补行结束后对该分区全部卡片重打「第N行」，保证计划能按行绑定。
 */
import type { SectionAddRequest } from '../../shared/types/fill';
import { shouldFillStop } from '../fillAbort';
import { getActiveSiteAdapter } from '../adapters/registry';
import {
  labelNextEmptyCard,
  locateRepeatSection,
  pressAddButton,
  relabelAllSectionCards,
} from '../scanner/scanFields';

/** 每一段最多额外点几次添加，避免死循环 */
const MAX_ADD_CLICKS_PER_SECTION = 8;

/** 点添加后等待 DOM 出现新行的毫秒数 */
const ADD_SETTLE_MS = 700;

/**
 * 短等待，给站点脚本挂上新行。
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * 按 sectionAdds 把各分区行数补到 neededRows（只点击添加，不填值）。
 */
export async function ensureSectionRows(
  sectionAdds: SectionAddRequest[],
  onProgress?: (message: string) => void,
): Promise<{ clicks: number; notices: string[] }> {
  let clicks = 0;
  const notices: string[] = [];
  const activeAdapter = getActiveSiteAdapter();
  if (activeAdapter) {
    onProgress?.(`已识别站点「${activeAdapter.name}」，按适配器补行…`);
  }

  for (const request of sectionAdds) {
    if (request.neededRows <= 0) {
      continue;
    }
    for (let round = 0; round < MAX_ADD_CLICKS_PER_SECTION; round += 1) {
      if (shouldFillStop()) {
        notices.push('补行已停止（用户取消）');
        return { clicks, notices };
      }
      const snapshot = locateRepeatSection(request.sectionPattern);
      if (!snapshot) {
        notices.push(`未找到可重复分区：${request.sectionPattern}`);
        break;
      }
      if (snapshot.rows >= request.neededRows) {
        break;
      }
      if (!snapshot.addButton) {
        notices.push(`分区没有「添加」按钮：${request.sectionPattern}`);
        break;
      }
      onProgress?.(
        `正在为「${request.sectionPattern}」补行（当前 ${snapshot.rows}/${request.neededRows}）…`,
      );
      const rowsBefore = snapshot.rows;
      pressAddButton(snapshot.addButton);
      clicks += 1;
      await wait(ADD_SETTLE_MS);
      const rowsAfter =
        locateRepeatSection(request.sectionPattern)?.rows ?? rowsBefore;
      if (rowsAfter <= rowsBefore) {
        notices.push(`点了添加但行数未增加：${request.sectionPattern}`);
        break;
      }
      labelNextEmptyCard(request.sectionPattern, request.neededRows);
    }
    // 该分区补行结束：全量重标行号（含单位名称/证书名称等锚点）
    const relabeled = relabelAllSectionCards(request.sectionPattern);
    if (relabeled.length > 0) {
      onProgress?.(
        `已为「${request.sectionPattern}」重标 ${relabeled.length} 个字段行号`,
      );
    }
  }

  return { clicks, notices };
}
