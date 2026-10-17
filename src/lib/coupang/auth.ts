import { relayFetch } from '../api-relay';
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
  const res = await relayFetch(url, {
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
    throw new Error(`Coupang API ${res.status}`);
  }

  if (text.trimStart().startsWith('<')) {
    throw new Error('COUPANG_RESPONSE_INVALID');
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('COUPANG_RESPONSE_INVALID');
  }
  if (json.code && String(json.code) !== '200') {
    throw new Error('COUPANG_PROVIDER_FAILED');
  }

  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authenticated relay only; bounded retries for transient GET failures. */
export async function coupangFetch(
  path: string,
  params: Record<string, string>,
  creds: CoupangCredentials
): Promise<any> {
  const { authorization, url } = buildCoupangAuth('GET', path, params, creds);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await coupangFetchOnce(url, authorization, creds.vendorId); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = message.match(/^Coupang API (\d+)$/)?.[1];
      // Never retry authentication/IP failures or missing/broken relay configuration.
      if (!status || !['429','500','502','503','504'].includes(status) || attempt === 2) throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error('COUPANG_REQUEST_FAILED');
}
