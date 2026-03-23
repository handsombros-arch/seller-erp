import bcrypt from 'bcryptjs';

const BASE = 'https://api.commerce.naver.com';

function proxyFetch(targetUrl: string, init: RequestInit = {}): Promise<Response> {
  const proxyUrl    = process.env.COUPANG_PROXY_URL;
  const proxySecret = process.env.COUPANG_PROXY_SECRET;
  if (!proxyUrl) return fetch(targetUrl, init);
  return fetch(proxyUrl, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'X-Target-URL': targetUrl,
      ...(proxySecret ? { 'X-Proxy-Secret': proxySecret } : {}),
    },
  });
}

export interface NaverCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * 네이버 커머스 API 서명
 * client_secret_sign = Base64(bcrypt(clientId + "_" + timestamp, clientSecret))
 * clientSecret은 Naver가 bcrypt salt 형태로 발급
 */
function makeSign(clientId: string, clientSecret: string, timestamp: number): string {
  const password = `${clientId}_${timestamp}`;
  const hashed   = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed).toString('base64');
}

/** OAuth2 클라이언트 자격증명 토큰 발급 */
export async function getNaverToken(creds: NaverCredentials): Promise<string> {
  const timestamp = Date.now();
  const sign      = makeSign(creds.clientId, creds.clientSecret, timestamp);

  const params = new URLSearchParams({
    grant_type:         'client_credentials',
    client_id:          creds.clientId,
    timestamp:          String(timestamp),
    client_secret_sign: sign,
    type:               'SELF',
  });

  const res = await proxyFetch(`${BASE}/external/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`네이버 토큰 발급 실패 ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.access_token as string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 인증 헤더 포함 네이버 Commerce API fetch (429 자동 재시도) */
export async function naverFetch(
  path: string,
  token: string,
  options: RequestInit = {},
  retries = 4
): Promise<any> {
  let delay = 1000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await proxyFetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      cache: 'no-store',
    });

    if (res.status === 429 && attempt < retries) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`네이버 API ${res.status}: ${text.slice(0, 300)}`);
    }

    return res.json();
  }
  throw new Error('네이버 API: 최대 재시도 초과 (429)');
}
