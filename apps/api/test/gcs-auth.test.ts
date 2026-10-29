import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { GcsClient } from '../src/gcs/gcs-client';

/** Cloud Run: no key file — the access token comes from the metadata server. */
test('GcsClient without a key uses the metadata server token', async () => {
  let tokenCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/token') {
      tokenCalls++;
      assert.equal(req.headers['metadata-flavor'], 'Google', 'metadata requests must carry Metadata-Flavor');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'meta-token', expires_in: 3599, token_type: 'Bearer' }));
    } else if (url.pathname === '/storage/v1/b/bkt/o') {
      assert.equal(req.headers.authorization, 'Bearer meta-token');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ prefixes: ['eatopia/'] }));
    } else {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: { message: 'denied' } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const c = new GcsClient('bkt', null, `http://127.0.0.1:${port}/storage/v1`, `http://127.0.0.1:${port}/token`);
    assert.deepEqual(await c.listPrefixes(''), ['eatopia/']);
    assert.deepEqual(await c.listPrefixes(''), ['eatopia/']);
    assert.equal(tokenCalls, 1, 'token is cached');
    await assert.rejects(c.download('nope.csv'), /403.*denied.*the API's service account.*Storage Object Viewer/);
  } finally {
    server.close();
  }
});

test('GcsClient reports a metadata server without a token', async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end('not here');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const c = new GcsClient('bkt', null, `http://127.0.0.1:${port}/storage/v1`, `http://127.0.0.1:${port}/token`);
    await assert.rejects(c.listPrefixes(''), /GCS auth failed \(404\)/);
  } finally {
    server.close();
  }
});
