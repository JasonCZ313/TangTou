/**
 * P2c 示例：本地 Laya Server（Node 标准库，无额外依赖）。
 * 协议与扩展约定一致：
 *   GET  /health     → { ok, service: "tangtou-laya", version }
 *   POST /v1/decide  → { items, skippedFieldIds }
 *
 * 启动（PowerShell）：
 *   node scripts/p2c/laya-server.mjs
 * 默认监听 http://127.0.0.1:8765
 *
 * 扩展侧：选项页「Laya 模型 URL」填 http://127.0.0.1:8765
 * 勾选启用本机 Laya + 优先本机 → 保存 →「测试 Laya Server」。
 * 不要对该 URL 点「下载本机包」（那是静态清单根，不是 Server）。
 */
import { createServer } from 'node:http';

const LISTEN_HOST = process.env.LAYA_SERVER_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LAYA_SERVER_PORT || 8765);
const SERVICE_ID = 'tangtou-laya';
const VERSION = '0.1.0-p2c-sample';

/**
 * 读完整请求体。
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

/**
 * 写 JSON 响应。
 */
function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(body);
}

/**
 * 规范化比较用文案。
 */
function normalizeComparableText(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·•\-_/\\，,。.（）()【】\[\]]+/g, '');
}

/**
 * 从档案抽候选短答案（与扩展轻量判断同思路的简化版）。
 */
function collectCandidates(profileData) {
  const basic = profileData?.basic || {};
  const jobIntent = profileData?.jobIntent || {};
  const education = (profileData?.education || [])[0] || {};
  const rows = [];
  const push = (value, hints) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return;
    }
    rows.push({ value: trimmed, hints });
  };
  push(basic.gender, ['性别', 'gender']);
  push(basic.ethnicity, ['民族']);
  push(basic.politicalStatus, ['政治面貌', '政治']);
  push(basic.maritalStatus, ['婚姻', '婚否']);
  push(basic.currentCity, ['现居', '城市', '工作城市']);
  push(jobIntent.jobType, ['工作性质', '全职', '兼职', '实习']);
  push(jobIntent.targetRole, ['意向岗位', '应聘岗位']);
  push(education.degreeLevel || education.degree, ['学历', '学位']);
  push(education.school, ['学校', '院校']);
  push(education.major, ['专业']);
  return rows;
}

/**
 * 在选项中找最接近档案值的一项。
 */
function pickOption(targetValue, options) {
  const targetNorm = normalizeComparableText(targetValue);
  if (!targetNorm || !Array.isArray(options) || options.length === 0) {
    return null;
  }
  let best = null;
  for (const option of options) {
    const optionText = String(option || '').trim();
    const optionNorm = normalizeComparableText(optionText);
    if (!optionNorm) {
      continue;
    }
    let score = 0;
    if (optionNorm === targetNorm) {
      score = 0.98;
    } else if (optionNorm.includes(targetNorm) || targetNorm.includes(optionNorm)) {
      score = 0.86;
    }
    if (score > 0 && (!best || score > best.confidence)) {
      best = { value: optionText, confidence: score };
    }
  }
  return best;
}

/**
 * 处理 /v1/decide。
 */
function handleDecide(body) {
  const minConfidence =
    typeof body.minConfidence === 'number' ? body.minConfidence : 0.55;
  const fields = Array.isArray(body.fields) ? body.fields : [];
  const candidates = collectCandidates(body.profileData || {});
  const items = [];
  const skippedFieldIds = [];

  for (const field of fields) {
    const fieldId = String(field.fieldId || '').trim();
    const label = String(field.label || '');
    if (!fieldId) {
      continue;
    }
    const labelNorm = normalizeComparableText(label);
    let matched = null;
    for (const candidate of candidates) {
      const hintHit = candidate.hints.some((hint) =>
        labelNorm.includes(normalizeComparableText(hint)),
      );
      if (!hintHit) {
        continue;
      }
      const picked = pickOption(candidate.value, field.options || [candidate.value]);
      if (picked && picked.confidence >= minConfidence) {
        matched = {
          fieldId,
          value: picked.value,
          confidence: picked.confidence,
          reason: 'sample-server heuristic',
        };
        break;
      }
    }
    if (matched) {
      items.push(matched);
    } else {
      skippedFieldIds.push(fieldId);
    }
  }

  return {
    items,
    skippedFieldIds,
    notice: 'P2c 示例 Laya Server（启发式，非神经网络）',
  };
}

const server = createServer(async (request, response) => {
  const method = request.method || 'GET';
  const url = new URL(request.url || '/', `http://${LISTEN_HOST}:${LISTEN_PORT}`);

  if (method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: SERVICE_ID,
      version: VERSION,
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/decide') {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, handleDecide(body));
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'bad json',
      });
    }
    return;
  }

  sendJson(response, 404, {
    error: 'not found',
    hint: 'GET /health 或 POST /v1/decide',
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[laya-server] 已监听 http://${LISTEN_HOST}:${LISTEN_PORT} （service=${SERVICE_ID}）`,
  );
});
