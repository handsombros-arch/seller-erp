/** Fail closed: all participating services require an authenticated HTTPS relay. */
export async function relayFetch(targetUrl: string, init: RequestInit = {}): Promise<Response> {
  const endpoint = process.env.COUPANG_PROXY_URL;
  const secret = process.env.COUPANG_PROXY_SECRET;
  if (!endpoint || !secret || secret.length < 32) throw new Error('RELAY_CONFIG_REQUIRED');
  let relay: URL;
  try { relay = new URL(endpoint); } catch { throw new Error('RELAY_CONFIG_INVALID'); }
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/' || relay.port) {
    throw new Error('RELAY_CONFIG_INVALID');
  }
  const headers = new Headers(init.headers);
  headers.set('X-Target-URL', targetUrl);
  headers.set('X-Proxy-Secret', secret);
  try {
    const response = await fetch(relay.toString(), { ...init, headers, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(20000) });
    if (response.status >= 300 && response.status < 400) throw new Error('RELAY_REDIRECT_DENIED');
    return response;
  } catch { throw new Error('RELAY_REQUEST_FAILED'); }
}
