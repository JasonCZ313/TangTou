/**
 * 批次③ P6：健康缓存语义冒烟（与 layaServerClient 逻辑一致的精简复刻）。
 */
const TTL_MS = 120_000;

/** @type {{ baseUrl: string, result: { ok: boolean }, checkedAtMs: number } | null} */
let cache = null;

function normalize(rawUrl) {
  return String(rawUrl || '').trim().replace(/\/+$/, '');
}

function looksLikeHttp(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function peek(rawUrl) {
  if (!cache) {
    return null;
  }
  const baseUrl = normalize(rawUrl);
  if (cache.baseUrl !== baseUrl) {
    return null;
  }
  const ageMs = Date.now() - cache.checkedAtMs;
  if (ageMs < 0 || ageMs > TTL_MS) {
    return null;
  }
  return cache.result;
}

function remember(rawUrl, result) {
  cache = {
    baseUrl: normalize(rawUrl),
    result,
    checkedAtMs: Date.now(),
  };
}

function isReadyFromCache(rawUrl) {
  if (!looksLikeHttp(rawUrl)) {
    return false;
  }
  const cached = peek(rawUrl);
  if (!cached) {
    return true;
  }
  return cached.ok;
}

let failed = 0;
function assert(name, condition) {
  if (!condition) {
    failed += 1;
    console.error(`FAIL ${name}`);
  } else {
    console.log(`OK   ${name}`);
  }
}

assert('空 URL 不可 ready', isReadyFromCache('') === false);
assert('合法 URL 无缓存可 optimistic ready', isReadyFromCache('http://127.0.0.1:8765') === true);

remember('http://127.0.0.1:8765', { ok: false, message: 'dead' });
assert('近期失败 → ready false', isReadyFromCache('http://127.0.0.1:8765') === false);
assert('换 URL 无缓存 → ready true', isReadyFromCache('http://127.0.0.1:9999') === true);

remember('http://127.0.0.1:8765', { ok: true, version: '0.1' });
assert('近期成功 → ready true', isReadyFromCache('http://127.0.0.1:8765') === true);

cache.checkedAtMs = Date.now() - TTL_MS - 1;
assert('过期后 → optimistic true', isReadyFromCache('http://127.0.0.1:8765') === true);

if (failed > 0) {
  process.exit(1);
}
console.log('P6 健康缓存冒烟全部通过');
