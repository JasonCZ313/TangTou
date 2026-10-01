/**
 * P7a：EvidencePack → SitePlaybook（只分析，不执行）。
 * 有 API 时走云端 JSON；无 Key 或失败时用本机启发式方案，保证侧栏总能看到步骤。
 */
import {
  ensureHostPermission,
} from '../llm/openaiCompatible';
import type { LlmTokenUsage } from '../types/usage';
import type { ProfileData } from '../types/profile';
import type {
  EvidencePack,
  PlaybookStep,
  SitePlaybook,
} from '../playbook/types';
import { parseUsageFromPayload } from '../storage/usageStore';

/** 探活方案生成超时 */
const PLAYBOOK_TIMEOUT_MS = 90_000;

/**
 * 生成步骤 id。
 */
function createStepId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

/**
 * 按控件标签从档案猜一个短值，供启发式方案带上 suggestedValue（便于 P7b 合并预览）。
 */
function suggestProfileValueForLabel(
  label: string,
  profileData?: ProfileData,
): string | undefined {
  if (!profileData) {
    return undefined;
  }
  const blob = label.replace(/\s+/g, '');
  const basic = profileData.basic ?? {};
  if (/姓名|名字|联系人/.test(blob)) {
    return basic.fullName?.trim() || undefined;
  }
  if (/手机|电话|联系方式/.test(blob)) {
    return basic.phone?.trim() || undefined;
  }
  if (/邮箱|邮件|email/i.test(blob)) {
    return basic.email?.trim() || undefined;
  }
  if (/城市|现居|所在地/.test(blob)) {
    return basic.currentCity?.trim() || undefined;
  }
  if (/学历|学位/.test(blob)) {
    return (
      profileData.education?.[0]?.degreeLevel?.trim() ||
      profileData.education?.[0]?.degree?.trim() ||
      undefined
    );
  }
  if (/学校|院校/.test(blob)) {
    return profileData.education?.[0]?.school?.trim() || undefined;
  }
  return undefined;
}

/**
 * 从档案日期字符串拆出四位年份（如 2020-09 / 2020.9 / 2020年）。
 */
function extractYearFromDateText(rawDate: string | undefined): string | undefined {
  const text = rawDate?.trim() ?? '';
  if (!text) {
    return undefined;
  }
  const match = text.match(/(19|20)\d{2}/);
  return match?.[0];
}

/**
 * 从档案日期字符串拆出月份文案（统一成「M月」，便于与下拉「1月」…「12月」匹配）。
 */
function extractMonthFromDateText(rawDate: string | undefined): string | undefined {
  const text = rawDate?.trim() ?? '';
  if (!text) {
    return undefined;
  }
  // 2020-09 / 2020/9 / 2020.09 / 2020年09月
  const afterYear = text.match(
    /(?:19|20)\d{2}\s*[./\-年]?\s*(0?[1-9]|1[0-2])(?:\s*[月日]|\/|$|\D)/,
  );
  if (afterYear?.[1]) {
    return `${Number.parseInt(afterYear[1], 10)}月`;
  }
  const chineseMonth = text.match(/(0?[1-9]|1[0-2])\s*月/);
  if (chineseMonth?.[1]) {
    return `${Number.parseInt(chineseMonth[1], 10)}月`;
  }
  return undefined;
}

/**
 * 按年/月控件标签从档案挑一段日期（入学/毕业/入职/离职等），供启发式补 suggestedValue。
 */
function pickProfileDateForTemporalLabel(
  label: string,
  profileData?: ProfileData,
): string | undefined {
  if (!profileData) {
    return undefined;
  }
  const blob = label.replace(/\s+/g, '');
  const education = profileData.education?.[0];
  const experience = profileData.experience?.[0];
  const project = profileData.projects?.[0];

  if (/毕业|结束|截至|至今前/.test(blob)) {
    // 结束类：优先看标签所属段，再回退
    if (/教育|学历|入学|就读|毕业/.test(blob)) {
      return education?.endDate?.trim() || undefined;
    }
    if (/工作|实习|入职|离职|任职/.test(blob)) {
      return experience?.endDate?.trim() || undefined;
    }
    if (/项目/.test(blob)) {
      return project?.endDate?.trim() || undefined;
    }
    return (
      education?.endDate?.trim() ||
      experience?.endDate?.trim() ||
      project?.endDate?.trim() ||
      undefined
    );
  }
  if (/入职|到岗|任职|工作开始|实习开始/.test(blob) || (/工作|实习/.test(blob) && /开始|年月|日期/.test(blob))) {
    return (
      experience?.startDate?.trim() ||
      project?.startDate?.trim() ||
      undefined
    );
  }
  if (/离职|工作结束|实习结束/.test(blob)) {
    return experience?.endDate?.trim() || undefined;
  }
  if (/项目开始/.test(blob) || (/项目/.test(blob) && /开始|年月|日期/.test(blob))) {
    return project?.startDate?.trim() || undefined;
  }
  if (/项目结束/.test(blob)) {
    return project?.endDate?.trim() || undefined;
  }
  // 教育明确词：不含裸「开始」，避免「开始年月」误绑教育
  if (/入学|就读|教育|学历/.test(blob)) {
    if (/结束|毕业|截至/.test(blob)) {
      return education?.endDate?.trim() || undefined;
    }
    return education?.startDate?.trim() || undefined;
  }
  // 仅「开始/年月」无段落语义：不猜，避免写错段
  if (/^(开始|年月|日期|时间)$/.test(blob) || /^(开始)?(年|月|年月|日期)$/.test(blob)) {
    return undefined;
  }
  if (/开始/.test(blob) && !/教育|学历|入学|就读|工作|实习|项目|入职/.test(blob)) {
    return undefined;
  }
  // 无明确语义时：不默认教育，避免错填；有明确年/月控件标签时上面已覆盖
  return undefined;
}

/**
 * 无云端时的启发式 Playbook：观察分区、添加按钮、年份控件、危险提交。
 */
export function buildHeuristicPlaybook(
  evidence: EvidencePack,
  profileData?: ProfileData,
): SitePlaybook {
  const steps: PlaybookStep[] = [];
  const warnings: string[] = [...evidence.notices];

  steps.push({
    stepId: createStepId('observe', steps.length),
    kind: 'observe',
    title: '通读页面结构',
    detail: `标题「${evidence.pageTitle || '无'}」· 控件约 ${evidence.controls.length} 个 · 分区约 ${evidence.sections.length} 个。P7a 仅展示方案，不会自动点写。`,
    risk: 'low',
    confidence: 0.9,
    isWrite: false,
  });

  for (const danger of evidence.dangerButtons) {
    steps.push({
      stepId: createStepId('warn', steps.length),
      kind: 'warn',
      title: '禁止点击提交类按钮',
      detail: `页面存在「${danger}」。任何探活/填写路径都不得点击。`,
      risk: 'high',
      confidence: 1,
      isWrite: false,
    });
    warnings.push(`黑名单按钮：${danger}`);
  }

  for (const section of evidence.sections) {
    if (!section.addButtonText) {
      continue;
    }
    const needed =
      /教育|学历/.test(section.title)
        ? profileData?.education?.length
        : /工作|实习|经历/.test(section.title)
          ? profileData?.experience?.length
          : /项目/.test(section.title)
            ? profileData?.projects?.length
            : undefined;
    steps.push({
      stepId: createStepId('add', steps.length),
      kind: 'click_add',
      title: `分区「${section.title}」可能需补行`,
      detail: needed
        ? `发现「${section.addButtonText}」。档案约 ${needed} 条，确认后（P7b）再按需点击添加，禁止一次点穿提交。`
        : `发现「${section.addButtonText}」。请人工确认行数后再添加（P7a 不执行点击）。`,
      risk: 'medium',
      confidence: 0.72,
      isWrite: true,
    });
  }

  const yearControls = evidence.controls.filter((control) => control.kind === 'year');
  const monthControls = evidence.controls.filter((control) => control.kind === 'month');
  for (const yearControl of yearControls.slice(0, 8)) {
    const dateText = pickProfileDateForTemporalLabel(
      yearControl.label,
      profileData,
    );
    const yearValue = extractYearFromDateText(dateText);
    steps.push({
      stepId: createStepId('year', steps.length),
      kind: 'open_picker',
      title: `年份控件：${yearControl.label}`,
      detail: yearValue
        ? `建议选择「${yearValue}」。确认执行后会尝试打开并点选；勿把长文本硬塞进选择器。`
        : '疑似年份点选/下拉。档案未拆出年份时仅展示、不自动执行（避免假成功掐断后续）。',
      risk: 'medium',
      targetFieldId: yearControl.fieldId,
      suggestedValue: yearValue,
      confidence: yearValue ? 0.74 : 0.7,
      isWrite: true,
    });
  }
  for (const monthControl of monthControls.slice(0, 8)) {
    const dateText = pickProfileDateForTemporalLabel(
      monthControl.label,
      profileData,
    );
    const monthValue = extractMonthFromDateText(dateText);
    steps.push({
      stepId: createStepId('month', steps.length),
      kind: 'select_option',
      title: `月份控件：${monthControl.label}`,
      detail: monthValue
        ? `建议写入「${monthValue}」。确认执行后按选项匹配选择。`
        : '疑似月份选择。档案未拆出月份时仅展示、不自动执行（避免无值步中断后续填写）。',
      risk: 'medium',
      targetFieldId: monthControl.fieldId,
      suggestedValue: monthValue,
      confidence: monthValue ? 0.74 : 0.68,
      isWrite: true,
    });
  }

  const comboboxes = evidence.controls.filter((control) => control.kind === 'combobox');
  for (const combo of comboboxes.slice(0, 10)) {
    steps.push({
      stepId: createStepId('combo', steps.length),
      kind: 'open_picker',
      title: `自定义下拉：${combo.label}`,
      detail: '仿 Ant/Element 下拉。需点开读选项再匹配档案值；P7a 只提示不操作。',
      risk: 'medium',
      targetFieldId: combo.fieldId,
      confidence: 0.66,
      isWrite: true,
    });
  }

  const emptyishText = evidence.controls.filter(
    (control) =>
      (control.kind === 'text' || control.kind === 'select') &&
      control.label &&
      control.label !== '未命名控件',
  );
  for (const control of emptyishText.slice(0, 12)) {
    const suggestedValue = suggestProfileValueForLabel(
      control.label,
      profileData,
    );
    steps.push({
      stepId: createStepId('fill', steps.length),
      kind: control.kind === 'select' ? 'select_option' : 'fill_field',
      title: `常规字段：${control.label}`,
      detail: control.fieldId
        ? suggestedValue
          ? `建议写入「${suggestedValue}」（P7b 可合并进预览后确认执行）。`
          : `已有扫描 id，可走普通预览映射；探活未猜到具体值。`
        : `尚未绑定扫描 id，建议先「扫描本页」再对照档案。`,
      risk: 'low',
      targetFieldId: control.fieldId,
      suggestedValue,
      confidence: suggestedValue ? 0.72 : 0.55,
      isWrite: true,
    });
  }

  // 城市 combobox：若档案有现居城市，带上建议值供打开后点选
  for (const combo of comboboxes.slice(0, 5)) {
    if (!/城市|现居|工作地/.test(combo.label)) {
      continue;
    }
    const cityValue = profileData?.basic?.currentCity?.trim();
    if (!cityValue) {
      continue;
    }
    const existing = steps.find(
      (step) =>
        step.kind === 'open_picker' && step.targetFieldId === combo.fieldId,
    );
    if (existing) {
      existing.suggestedValue = cityValue;
      existing.confidence = Math.max(existing.confidence, 0.7);
      existing.detail = `建议选择「${cityValue}」。确认执行后会尝试打开并点选。`;
    }
  }

  // P7c：把探测点击读到的选项写进观察步，方便侧栏核对
  const successfulProbes = (evidence.probeClicks ?? []).filter(
    (record) => record.ok,
  );
  if (successfulProbes.length > 0) {
    const optionPreview = successfulProbes
      .map((record) => {
        const options = (record.discoveredOptions ?? []).slice(0, 6).join('/');
        return options
          ? `${record.label}→${options}`
          : `${record.label}（未读到选项）`;
      })
      .slice(0, 5)
      .join('；');
    steps.splice(1, 0, {
      stepId: createStepId('probe', 0),
      kind: 'observe',
      title: '受控探测已读选项',
      detail: optionPreview || '已做预算内探测点击，未读到选项。',
      risk: 'low',
      confidence: 0.8,
      isWrite: false,
    });
  }

  if (evidence.siteAdapterName) {
    warnings.push(
      `已命中适配器「${evidence.siteAdapterName}」：日常填写可优先「扫描本页」快路径。`,
    );
  }

  if (steps.length <= 1) {
    steps.push({
      stepId: createStepId('wait', steps.length),
      kind: 'wait',
      title: '证据不足',
      detail: '控件/分区特征很少。可展开折叠面板后重试探活，或先扫描本页。',
      risk: 'low',
      confidence: 0.5,
      isWrite: false,
    });
  }

  return {
    createdAt: new Date().toISOString(),
    pageUrl: evidence.pageUrl,
    summary: `启发式方案共 ${steps.length} 步（P7a 只展示；P7b 可合并预览并确认执行）。站点：${evidence.siteAdapterName ?? '通用'}。`,
    engine: 'heuristic',
    steps,
    warnings: [...new Set(warnings)],
    executable: false,
  };
}

/**
 * 校验并归一化模型返回的 Playbook JSON。
 */
function normalizeCloudPlaybook(
  raw: unknown,
  evidence: EvidencePack,
): SitePlaybook | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const stepsRaw = Array.isArray(record.steps) ? record.steps : [];
  const steps: PlaybookStep[] = [];
  for (const [index, entry] of stepsRaw.entries()) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const stepRecord = entry as Record<string, unknown>;
    const kind = String(stepRecord.kind ?? 'observe');
    const allowedKinds = new Set([
      'observe',
      'click_add',
      'open_picker',
      'fill_field',
      'select_option',
      'wait',
      'warn',
    ]);
    if (!allowedKinds.has(kind)) {
      continue;
    }
    const title =
      typeof stepRecord.title === 'string' && stepRecord.title.trim()
        ? stepRecord.title.trim()
        : `步骤 ${index + 1}`;
    const detail =
      typeof stepRecord.detail === 'string' ? stepRecord.detail.trim() : '';
    const riskRaw = String(stepRecord.risk ?? 'medium');
    const risk =
      riskRaw === 'low' || riskRaw === 'high' || riskRaw === 'medium'
        ? riskRaw
        : 'medium';
    const confidence =
      typeof stepRecord.confidence === 'number' && Number.isFinite(stepRecord.confidence)
        ? Math.max(0, Math.min(1, stepRecord.confidence))
        : 0.55;
    steps.push({
      stepId:
        typeof stepRecord.stepId === 'string' && stepRecord.stepId.trim()
          ? stepRecord.stepId.trim()
          : createStepId('cloud', index),
      kind: kind as PlaybookStep['kind'],
      title,
      detail,
      risk,
      targetFieldId:
        typeof stepRecord.targetFieldId === 'string'
          ? stepRecord.targetFieldId
          : undefined,
      suggestedValue:
        typeof stepRecord.suggestedValue === 'string'
          ? stepRecord.suggestedValue
          : undefined,
      confidence,
      isWrite: stepRecord.isWrite === true ||
        kind === 'fill_field' ||
        kind === 'select_option' ||
        kind === 'click_add' ||
        kind === 'open_picker',
    });
  }
  if (steps.length === 0) {
    return null;
  }
  const warnings = Array.isArray(record.warnings)
    ? record.warnings
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const summary =
    typeof record.summary === 'string' && record.summary.trim()
      ? record.summary.trim()
      : `云端方案共 ${steps.length} 步（只展示，不执行）`;

  return {
    createdAt: new Date().toISOString(),
    pageUrl: evidence.pageUrl,
    summary,
    engine: 'cloud',
    steps,
    warnings,
    executable: false,
  };
}

/**
 * 构造探活 system/user 提示（文本部分）。
 */
function buildPlaybookPrompt(
  evidence: EvidencePack,
  profileData: ProfileData,
): { system: string; userText: string } {
  const system = [
    '你是招聘网申「安全探活」助手。根据页面证据输出 JSON 填写方案 SitePlaybook。',
    '硬规则：不得建议点击提交/投递/最终确认；不得假设已获用户授权执行。',
    '只输出 JSON，形状：{"summary":string,"warnings":string[],"steps":[{"stepId":string,"kind":"observe|click_add|open_picker|fill_field|select_option|wait|warn","title":string,"detail":string,"risk":"low|medium|high","targetFieldId":string|null,"suggestedValue":string|null,"confidence":0到1,"isWrite":boolean}]}',
    '步骤要具体、可人工核对；不确定就 kind=observe 或 warn。',
    '若证据含 probeClicks（受控探测），优先利用已读到的 optionsSample。',
  ].join('\n');

  const profileBrief = {
    name: profileData.basic?.fullName,
    phone: profileData.basic?.phone,
    educationCount: profileData.education?.length ?? 0,
    experienceCount: profileData.experience?.length ?? 0,
    projectCount: profileData.projects?.length ?? 0,
  };

  const userText = [
    '【档案摘要】',
    JSON.stringify(profileBrief),
    '【页面证据 EvidencePack】',
    JSON.stringify({
      pageUrl: evidence.pageUrl,
      pageTitle: evidence.pageTitle,
      siteAdapterName: evidence.siteAdapterName,
      megaCorpSampleId: evidence.megaCorpSampleId,
      dangerButtons: evidence.dangerButtons,
      sections: evidence.sections.slice(0, 16),
      controls: evidence.controls.slice(0, 40),
      probeClicks: (evidence.probeClicks ?? []).slice(0, 10),
      ocrText: (evidence.ocrText ?? '').slice(0, 600),
      visibleTextSample: evidence.visibleTextSample.slice(0, 800),
      notices: evidence.notices,
    }),
  ].join('\n');

  return { system, userText };
}

/**
 * 调用用户 API 生成 Playbook；失败返回 null。
 * P7c：可附带可见区截图做多模态；模型不支持时自动回退纯文本。
 */
async function requestCloudPlaybook(options: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  evidence: EvidencePack;
  profileData: ProfileData;
  /** jpeg/png data URL；空则纯文本 */
  screenshotDataUrl?: string;
}): Promise<{ playbook: SitePlaybook; usage: LlmTokenUsage | null } | null> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '');
  const endpointUrl = `${baseUrl}/chat/completions`;
  const { system, userText } = buildPlaybookPrompt(
    options.evidence,
    options.profileData,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYBOOK_TIMEOUT_MS);

  const screenshotDataUrl = options.screenshotDataUrl?.trim() ?? '';
  const useMultimodal = screenshotDataUrl.startsWith('data:image/');

  type MultimodalPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

  const textUserMessage = {
    role: 'user' as const,
    content: userText,
  };
  const multimodalUserMessage = {
    role: 'user' as const,
    content: [
      { type: 'text', text: `${userText}\n\n【附：当前可见区截图，请对照控件布局】` },
      { type: 'image_url', image_url: { url: screenshotDataUrl } },
    ] satisfies MultimodalPart[],
  };

  /**
   * 发起一次 chat/completions；withMultimodal 控制是否带图。
   * 返回 response 与（若失败）错误正文，避免重复读 body。
   */
  async function postOnce(
    withMultimodal: boolean,
  ): Promise<{ response: Response; errorText: string }> {
    const bodyBase = {
      model: options.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        withMultimodal ? multimodalUserMessage : textUserMessage,
      ],
    };
    let response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        ...bodyBase,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      if (/response_format|json_object/i.test(errorText)) {
        response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(bodyBase),
          signal: controller.signal,
        });
        if (!response.ok) {
          return { response, errorText: await response.text() };
        }
        return { response, errorText: '' };
      }
      return { response, errorText };
    }
    return { response, errorText: '' };
  }

  try {
    let attempt = await postOnce(useMultimodal);
    if (!attempt.response.ok && useMultimodal) {
      // 模型/网关不支持多模态时回退纯文本 OCR 路径
      if (
        /image|vision|multimodal|content.*array|invalid.*message/i.test(
          attempt.errorText,
        ) ||
        attempt.response.status === 400
      ) {
        attempt = await postOnce(false);
      }
    }
    if (!attempt.response.ok) {
      return null;
    }
    const payload = (await attempt.response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return null;
    }
    const parsed: unknown = JSON.parse(content);
    const playbook = normalizeCloudPlaybook(parsed, options.evidence);
    if (!playbook) {
      return null;
    }
    return { playbook, usage: parseUsageFromPayload(payload) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 主入口：优先云端，失败/无 Key 则启发式。始终 executable:false。
 */
export async function buildSitePlaybook(options: {
  evidence: EvidencePack;
  profileData: ProfileData;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  /** P7c：可选可见区截图（多模态）；失败自动回退纯文本 */
  screenshotDataUrl?: string;
}): Promise<{ playbook: SitePlaybook; usage: LlmTokenUsage | null }> {
  const hasApi =
    options.apiBaseUrl.trim().length > 0 && options.apiKey.trim().length > 0;

  if (hasApi) {
    const granted = await ensureHostPermission(options.apiBaseUrl);
    if (granted) {
      const cloud = await requestCloudPlaybook(options);
      if (cloud) {
        // 强制不可执行，防止模型乱改标志
        cloud.playbook.executable = false;
        if (options.evidence.dangerButtons.length > 0) {
          cloud.playbook.warnings = [
            ...cloud.playbook.warnings,
            ...options.evidence.dangerButtons.map(
              (label) => `页面提交类按钮「${label}」禁止点击`,
            ),
          ];
        }
        return cloud;
      }
    }
  }

  return {
    playbook: buildHeuristicPlaybook(options.evidence, options.profileData),
    usage: null,
  };
}
