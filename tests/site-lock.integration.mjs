import assert from 'node:assert/strict';
import { createServer, preview } from 'vite';
import unavailableResponse from '../middleware.ts';

const paths = [
  '/', '/business', '/business/', '/bussiness', '/agency', '/agency/',
  '/agency/admin', '/agency/admin/', '/video-analysis', '/index.html',
  '/assets/index-DATxVytz.js', '/favicon.ico', '/unknown/nested/page',
  '/api/agency-accounts', '/api/face-compare', '/api/face-intelligence',
];
const expected = await unavailableResponse(new Request('https://example.com')).text();
assert.match(expected, /This app is not reachable\./);
assert.doesNotMatch(expected, /<script|<a\s|<form/i);

for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  const response = unavailableResponse(new Request('https://example.com/agency/admin', { method }));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), method === 'HEAD' ? '' : expected);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
}

async function verifyServer(server, label) {
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  for (const path of paths) {
    const response = await fetch(`${origin}${path}?check=site-lock`, { redirect: 'manual' });
    assert.equal(response.status, 404, `${label}: ${path}`);
    assert.equal(await response.text(), expected, `${label}: ${path} body`);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await fetch(`${origin}/api/agency-accounts`, {
      method,
      redirect: 'manual',
      headers: { Authorization: 'Bearer test-session', Cookie: 'test-session=present' },
    });
    assert.equal(response.status, 404, `${label}: API ${method}`);
    assert.equal(await response.text(), method === 'HEAD' ? '' : expected);
  }
  console.log(`${label}: ${paths.length} routes and all HTTP methods blocked, including requests with session headers.`);
}

const dev = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
});
try {
  await dev.listen();
  await verifyServer(dev, 'Development');
} finally {
  await dev.close();
}

const built = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
try {
  await verifyServer(built, 'Production preview');
} finally {
  await new Promise((resolve, reject) => built.httpServer.close(error => error ? reject(error) : resolve()));
}
console.log('Site lock checks passed.');
