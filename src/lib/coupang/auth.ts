import crypto from 'crypto';

export interface CoupangCredentials {
  accessKey: string;
  secretKey: string;
  vendorId: string;
}

/**
 * Coupang Open API HMAC-SHA256 인증 헤더 생성
 * datetime 포맷: YYMMDDTHHmmssZ (2자리 연도)
 * message = method + path + sortedQueryString + datetime
 */
export function buildCoupangAuth(
  method: string,
  path: string,
  params: Record<string, string>,
  creds: CoupangCredentials
): { authorization: string; url: string } {
  // YYMMDDTHHmmssZ 포맷 (UTC 기준, strftime %y%m%dT%H%M%SZ 동일)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datetime =
    String(now.getUTCFullYear()).slice(-2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) + 'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) + 'Z';

  // URL 인코딩된 query string (서명 + URL 모두 동일하게 사용)
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(sorted).toString();

  // 메시지 순서: datetime + method + path + query (쿠팡 공식 스펙)
  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac('sha256', creds.secretKey)
    .update(message)
    .digest('hex');

  const authorization = `CEA algorithm=HmacSHA256, access-key=${creds.accessKey}, signed-date=${datetime}, signature=${signature}`;
  const url = `https://api-gateway.coupang.com${path}${query ? '?' + query : ''}`;

  return { authorization, url };
}

async function coupangFetchOnce(
  url: string,
  authorization: string,
  vendorId: string,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Requested-By': vendorId,
      ...extraHeaders,
    },
    cache: 'no-store',
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Coupang API ${res.status}: ${text.slice(0, 400)}`);
  }

  if (text.trimStart().startsWith('<')) {
    throw new Error(`Coupang API: HTML 응답 수신 (프록시/게이트웨이 오류) - ${text.slice(0, 200)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Coupang API: JSON 파싱 실패 - ${text.slice(0, 200)}`);
  }
  if (json.code && String(json.code) !== '200') {
    throw new Error(`Coupang API 오류: ${json.message ?? json.code}`);
  }

  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 쿠팡 API 호출 (리트라이 3회 + 프록시 실패 시 직접 호출 폴백)
 */
export async function coupangFetch(
  path: string,
  params: Record<string, string>,
  creds: CoupangCredentials
): Promise<any> {
  const { authorization, url } = buildCoupangAuth('GET', path, params, creds);

  const proxyUrl = process.env.COUPANG_PROXY_URL;
  const proxySecret = process.env.COUPANG_PROXY_SECRET;
  const useProxy = !!proxyUrl;

  const MAX_RETRIES = 3;
  const BACKOFF = [1000, 2000, 4000];

  // 프록시 먼저 시도, 실패하면 직접 호출 폴백
  const strategies: Array<{ label: string; fetchUrl: string; extra: Record<string, string> }> = [];
  if (useProxy) {
    strategies.push({
      label: 'proxy',
      fetchUrl: proxyUrl!,
      extra: { 'X-Target-URL': url, ...(proxySecret ? { 'X-Proxy-Secret': proxySecret } : {}) },
    });
  }
  strategies.push({ label: 'direct', fetchUrl: url, extra: {} });

  let lastError: Error | null = null;

  for (const strategy of strategies) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await coupangFetchOnce(strategy.fetchUrl, authorization, creds.vendorId, strategy.extra);
      } catch (err: any) {
        lastError = err;
        const status = err.message?.match(/Coupang API (\d+)/)?.[1];
        // 인증 오류(401/403)는 리트라이 무의미 → 즉시 다음 전략
        if (status === '401' || status === '403') break;
        // 마지막 시도가 아니면 백오프 후 재시도
        if (attempt < MAX_RETRIES - 1) {
          await sleep(BACKOFF[attempt]);
        }
      }
    }
    // 프록시 실패 → 직접 호출 폴백 로그
    if (strategy.label === 'proxy' && strategies.length > 1) {
      console.warn(`[coupangFetch] 프록시 실패, 직접 호출로 폴백: ${lastError?.message?.slice(0, 100)}`);
    }
  }

  throw lastError ?? new Error('Coupang API: 알 수 없는 오류');
}
