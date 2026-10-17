import { relayFetch as proxyFetch } from '../api-relay';
const TOKEN_URL = 'https://oauth2.cert.toss.im/token';
const BASE      = 'https://shopping-fep.toss.im';


export interface TossCredentials {
  accessKey: string;
  secretKey: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getTossToken(creds: TossCredentials): Promise<string> {
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     creds.accessKey,
    client_secret: creds.secretKey,
    scope:         'toss-shopping-fep:write',
  });

  const res = await proxyFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`토스 토큰 발급 실패 ${res.status}`);
  }

  const json = await res.json();
  return json.access_token as string;
}

export async function tossFetch(
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

    if (res.status === 429 && attempt < retries && ['GET', 'HEAD'].includes((options.method ?? 'GET').toUpperCase())) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (!res.ok) {
        throw new Error(`토스 API ${res.status}`);
    }

    return res.json();
  }
  throw new Error('토스 API: 최대 재시도 초과 (429)');
}
