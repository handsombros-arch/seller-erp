const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const PROXY_SECRET = process.env.PROXY_SECRET || '';

const server = http.createServer((req, res) => {
  // 헬스체크
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  // Secret 검증 (설정된 경우)
  if (PROXY_SECRET) {
    const auth = req.headers['x-proxy-secret'];
    if (auth !== PROXY_SECRET) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
  }

  // X-Target-URL 헤더로 대상 URL 전달
  const targetUrl = req.headers['x-target-url'];
  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing X-Target-URL header');
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400);
    res.end('Invalid X-Target-URL');
    return;
  }

  // 프록시할 헤더 조립 (hop-by-hop 제거)
  const skipHeaders = new Set(['x-target-url', 'x-proxy-secret', 'host', 'connection', 'transfer-encoding']);
  const proxyHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!skipHeaders.has(k.toLowerCase())) proxyHeaders[k] = v;
  }
  proxyHeaders['host'] = parsed.host;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: proxyHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(`Proxy error: ${err.message}`);
    }
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`Coupang proxy listening on :${PORT}`);
});
