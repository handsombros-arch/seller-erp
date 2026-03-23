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

export async function coupangFetch(
  path: string,
  params: Record<string, string>,
  creds: CoupangCredentials
): Promise<any> {
  const { authorization, url } = buildCoupangAuth('GET', path, params, creds);

  const proxyUrl = process.env.COUPANG_PROXY_URL;
  const proxySecret = process.env.COUPANG_PROXY_SECRET;

  const fetchUrl = proxyUrl ? proxyUrl : url;
  const extraHeaders: Record<string, string> = proxyUrl
    ? { 'X-Target-URL': url, ...(proxySecret ? { 'X-Proxy-Secret': proxySecret } : {}) }
    : {};

  const res = await fetch(fetchUrl, {
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Requested-By': creds.vendorId,
      ...extraHeaders,
    },
    cache: 'no-store',
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Coupang API ${res.status}: ${text.slice(0, 400)}`);
  }

  // HTML 응답 감지 (Fly.io 프록시 또는 게이트웨이 에러 페이지)
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Coupang API: HTML 응답 수신 (프록시/게이트웨이 오류) - ${text.slice(0, 200)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Coupang API: JSON 파싱 실패 - ${text.slice(0, 200)}`);
  }
  // Coupang API는 code: 200 (숫자) 또는 "200" (문자열) 모두 사용
  if (json.code && String(json.code) !== '200') {
    throw new Error(`Coupang API 오류: ${json.message ?? json.code}`);
  }

  return json;
}
