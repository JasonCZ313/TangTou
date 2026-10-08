/**
 * 选区填入 P2：框定矩形后识别框内空白字段，把清单发给侧栏展示。
 * 不写入、不生成填写计划、不碰整页扫描会话。
 */

import type { ExtensionMessage } from '../../shared/types/messages';
import type { FieldDescriptor } from '../../shared/types/fill';
import {
  scanBlankFieldsInRegionBox,
  type RegionViewportBox,
} from '../scanner/scanFields';
import { getRegionSelectBox } from './regionSelect';

/** 框内识别结束后交给侧栏或消息回执的结果形状 */
export interface RegionFieldScanOutcome {
  fields: FieldDescriptor[];
  durationMs: number;
  notice?: string;
}

/** 同一矩形连拖时合并识别请求，避免重复扫。 */
let regionScanDebounceTimer = 0;

/** 最近一次识别对应的请求 id，侧栏可用来对齐进度。 */
let activeRegionScanRequestId = '';

/**
 * 把进度或结果发给扩展页面（侧栏监听 runtime 消息）。
 */
function reportRegionScanMessage(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/**
 * 读取当前合格矩形；没有 boxed 阶段时返回 null。
 */
export function readActiveRegionBox(): RegionViewportBox | null {
  return getRegionSelectBox();
}

/**
 * 在矩形已框好后执行一次框内空白识别，并上报侧栏。
 * 调用方：框好矩形的生命周期、侧栏对照前补扫（SCAN_REGION_FIELDS）。
 * 输入：可选请求 id。输出：识别结果；没有合格矩形则为 null。
 * 会改 activeRegionScanRequestId，并向 runtime 发进度/结果。
 */
export async function runRegionFieldScan(
  requestId?: string,
): Promise<RegionFieldScanOutcome | null> {
  const regionBox = readActiveRegionBox();
  if (!regionBox) {
    reportRegionScanMessage({ type: 'REGION_SCAN_CLEARED' });
    return null;
  }
  const scanRequestId = requestId ?? crypto.randomUUID();
  activeRegionScanRequestId = scanRequestId;
  reportRegionScanMessage({
    type: 'REGION_SCAN_PROGRESS',
    requestId: scanRequestId,
    percent: 8,
    message: '正在识别框内空白字段…',
  });
  try {
    const scanResult = await scanBlankFieldsInRegionBox(regionBox);
    if (activeRegionScanRequestId !== scanRequestId) {
      return {
        fields: scanResult.fields,
        durationMs: scanResult.durationMs,
      };
    }
    reportRegionScanMessage({
      type: 'REGION_SCAN_PROGRESS',
      requestId: scanRequestId,
      percent: 100,
      foundCount: scanResult.fields.length,
      message: `框内空白字段 ${scanResult.fields.length} 个（${scanResult.durationMs}ms）`,
    });
    reportRegionScanMessage({
      type: 'REGION_SCAN_RESULT',
      requestId: scanRequestId,
      fields: scanResult.fields,
      durationMs: scanResult.durationMs,
    });
    return {
      fields: scanResult.fields,
      durationMs: scanResult.durationMs,
    };
  } catch {
    const failedOutcome: RegionFieldScanOutcome = {
      fields: [],
      durationMs: 0,
      notice: '框内识别失败。请右键取消后重新框选。',
    };
    reportRegionScanMessage({
      type: 'REGION_SCAN_RESULT',
      requestId: scanRequestId,
      fields: failedOutcome.fields,
      durationMs: failedOutcome.durationMs,
      notice: failedOutcome.notice,
    });
    return failedOutcome;
  }
}

/**
 * 矩形刚框好或改大小时调用；短防抖后触发识别。
 */
export function scheduleRegionFieldScan(): void {
  window.clearTimeout(regionScanDebounceTimer);
  regionScanDebounceTimer = window.setTimeout(() => {
    void runRegionFieldScan();
  }, 48);
}

/**
 * 选区结束时清空侧栏清单状态。
 */
export function clearRegionFieldScanUi(): void {
  window.clearTimeout(regionScanDebounceTimer);
  activeRegionScanRequestId = '';
  reportRegionScanMessage({ type: 'REGION_SCAN_CLEARED' });
}
