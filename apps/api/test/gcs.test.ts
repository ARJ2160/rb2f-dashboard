import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { signJwt } from '../src/gcs/gcs-client';
import {
  brandFoldersFromPrefixes,
  brandSlug,
  ingestableObjects,
  isGcsProfile,
  marketplacePrefix,
  relativeName,
  syncOrder,
} from '../src/gcs/paths';

test('brand folders: trims stray spaces, skips internal folders, prefixes the profile', () => {
  const brands = brandFoldersFromPrefixes([
    ' milkitbaby/',
    '_tmp/',
    'eatopia/',
    'tata1mg/',
    'Ubalance Naturals/',
  ]);
  assert.deepEqual(
    brands.map((b) => [b.brand, b.folder, b.profileId]),
    [
      ['eatopia', 'eatopia', 'gcs_eatopia'],
      ['milkitbaby', ' milkitbaby', 'gcs_milkitbaby'],
      ['tata1mg', 'tata1mg', 'gcs_tata1mg'],
      ['ubalance-naturals', 'Ubalance Naturals', 'gcs_ubalance-naturals'],
    ]
  );
  assert.equal(brandSlug('___'), '___');
  assert.ok(isGcsProfile('gcs_eatopia'));
  assert.ok(!isGcsProfile('eatopia'));
});

test('ingestable objects: only spreadsheets under the marketplace folder', () => {
  const prefix = marketplacePrefix('eatopia', 'amazon');
  const o = (name: string, size = 10, updated = '2026-09-02T11:52:34.000Z') => ({
    name,
    generation: '1',
    size,
    updated,
  });
  const objs = [
    o('eatopia/amazon/campaign_mapper/eatopia_campaign_mapper.csv'),
    o('eatopia/amazon/campaign/'),
    o('eatopia/amazon/campaign/empty.csv', 0),
    o('eatopia/amazon/sqp/notes.txt'),
    o('eatopia/blinkit/sales.csv'),
    o('eatopia/amazon/seller_central/2026/br.xlsx'),
  ];
  assert.deepEqual(
    ingestableObjects(objs, prefix).map((x) => relativeName(x.name, prefix)),
    ['campaign_mapper/eatopia_campaign_mapper.csv', 'seller_central/2026/br.xlsx']
  );
});

test('sync order: mappers first, then oldest → newest', () => {
  const prefix = 'b/amazon/';
  const o = (name: string, updated: string) => ({ name: prefix + name, generation: '1', size: 1, updated });
  const sorted = syncOrder(
    [
      o('campaign/new.csv', '2026-10-02T00:00:00.000Z'),
      o('campaign/old.csv', '2026-09-01T00:00:00.000Z'),
      o('asin_mapper/m.csv', '2026-10-05T00:00:00.000Z'),
      o('campaign_mapper/c.csv', '2026-09-03T00:00:00.000Z'),
    ],
    prefix
  ).map((x) => relativeName(x.name, prefix));
  assert.deepEqual(sorted, [
    'campaign_mapper/c.csv',
    'asin_mapper/m.csv',
    'campaign/old.csv',
    'campaign/new.csv',
  ]);
});

test('service-account JWT is RS256-signed with the read-only scope', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signJwt({ client_email: 'sync@proj.iam.gserviceaccount.com', private_key: pem }, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
  assert.equal(claims.iss, 'sync@proj.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/devstorage.read_only');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url')));
});

test('GcsClient: token exchange, paginated listing, generation-pinned download', async () => {
  const { createServer } = await import('node:http');
  const { GcsClient } = await import('../src/gcs/gcs-client');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const seen: string[] = [];
  let tokens = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    seen.push(`${req.method} ${url.pathname}${url.search}`);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/token') {
      tokens++;
      res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      return;
    }
    if (req.headers.authorization !== 'Bearer tok') {
      res.statusCode = 401;
      res.end('{}');
      return;
    }
    if (url.pathname === '/storage/v1/b/bkt/o' && url.searchParams.get('delimiter') === '/') {
      res.end(JSON.stringify({ prefixes: ['eatopia/', ' milkitbaby/'] }));
    } else if (url.pathname === '/storage/v1/b/bkt/o') {
      const page2 = url.searchParams.get('pageToken') === 'p2';
      res.end(
        JSON.stringify(
          page2
            ? {
                items: [
                  {
                    name: 'eatopia/amazon/str/b.csv',
                    generation: '2',
                    size: '5',
                    updated: '2026-10-01T00:00:00Z',
                  },
                ],
              }
            : {
                items: [
                  {
                    name: 'eatopia/amazon/str/a.csv',
                    generation: '1',
                    size: '3',
                    updated: '2026-09-01T00:00:00Z',
                  },
                ],
                nextPageToken: 'p2',
              }
        )
      );
    } else if (url.pathname === `/storage/v1/b/bkt/o/${encodeURIComponent(' milkitbaby/amazon/x y.csv')}`) {
      res.setHeader('content-type', 'text/csv');
      res.end(`a,b\n1,${url.searchParams.get('generation')}`);
    } else {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: { message: 'denied' } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const key = {
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `http://127.0.0.1:${port}/token`,
    };
    const c = new GcsClient('bkt', key, `http://127.0.0.1:${port}/storage/v1`);
    assert.deepEqual(await c.listPrefixes(''), ['eatopia/', ' milkitbaby/']);
    const objs = await c.listObjects('eatopia/amazon/');
    assert.deepEqual(
      objs.map((o) => [o.name, o.size]),
      [
        ['eatopia/amazon/str/a.csv', 3],
        ['eatopia/amazon/str/b.csv', 5],
      ]
    );
    assert.equal((await c.download(' milkitbaby/amazon/x y.csv', '42')).toString(), 'a,b\n1,42');
    await assert.rejects(c.download('nope.csv'), /403.*denied.*Storage Object Viewer/);
    assert.equal(tokens, 1, 'access token is cached');
  } finally {
    server.close();
  }
});

test('brand marker object name: <brand>/.keep', async () => {
  const { brandMarkerObject, BRAND_MARKER_OBJECT } = await import('../src/gcs/gcs-ingest');
  assert.equal(BRAND_MARKER_OBJECT, '.keep');
  assert.equal(brandMarkerObject('eatopia'), 'eatopia/.keep');
});

test('a created brand marker surfaces the brand folder in the picker', () => {
  // createBrandInGcs writes `acme/.keep`, so listPrefixes('') returns `acme/`.
  const brands = brandFoldersFromPrefixes(['acme/']);
  assert.deepEqual(
    brands.map((b) => [b.brand, b.folder, b.profileId]),
    [['acme', 'acme', 'gcs_acme']]
  );
});

test('GcsClient.upload: POSTs bytes to the upload endpoint and returns the new generation', async () => {
  const { createServer } = await import('node:http');
  const { GcsClient } = await import('../src/gcs/gcs-client');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let received: { name: string | null; method: string; body: string } | null = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/token') {
      res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      return;
    }
    if (req.headers.authorization !== 'Bearer tok') {
      res.statusCode = 401;
      res.end('{}');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/upload/storage/v1/b/bkt/o') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        received = { name: url.searchParams.get('name'), method: req.method!, body: body.toString() };
        res.end(JSON.stringify({ name: url.searchParams.get('name'), generation: '99', size: String(body.length) }));
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const key = {
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `http://127.0.0.1:${port}/token`,
    };
    const c = new GcsClient('bkt', key, `http://127.0.0.1:${port}/storage/v1`);
    const out = await c.upload('acme/.keep', Buffer.from('hi'), 'text/plain');
    assert.equal(out.generation, '99');
    assert.equal(out.name, 'acme/.keep');
    const got = received as { name: string | null; method: string; body: string } | null;
    assert.ok(got, 'server received the upload');
    assert.equal(got.method, 'POST');
    assert.equal(got.name, 'acme/.keep');
    assert.equal(got.body, 'hi');
  } finally {
    server.close();
  }
});

test('blinkit ads upload resolves to its native ads_sales subtype', async () => {
  const { resolveBlinkitAdReportType } = await import('../src/gcs/gcs-ingest');

  // By file-name token (native exports: <brand>_<sub>_<dates>.csv).
  assert.equal(
    resolveBlinkitAdReportType('eatopia_product_listing_20260201_20260228.csv', Buffer.from('')),
    'product_listing'
  );
  assert.equal(resolveBlinkitAdReportType('eatopia_banner_listing_x.csv', Buffer.from('')), 'banner_listing');
  assert.equal(
    resolveBlinkitAdReportType('x_product_recommendation_y.csv', Buffer.from('')),
    'product_recommendation'
  );

  // By columns when the name carries no token.
  const banner = [
    'Date,Campaign ID,Campaign Name,Impressions,Estimated Budget Consumed,Reach,Unique Clicks',
    '01-02-2026,123,Brand BL,1000,500,800,40',
  ].join('\n');
  assert.equal(resolveBlinkitAdReportType('ads_export.csv', Buffer.from(banner)), 'banner_listing');

  const pl = [
    'Date,Campaign ID,Campaign Name,Targeting Value,Impressions,Estimated Budget Consumed',
    '01-02-2026,123,Brand PL,protein,1000,500',
  ].join('\n');
  assert.equal(resolveBlinkitAdReportType('ads_export.csv', Buffer.from(pl)), 'product_listing');

  // Not a recognisable single ad subtype → null (caller keeps the generic type).
  assert.equal(resolveBlinkitAdReportType('ads_export.csv', Buffer.from('foo,bar\n1,2')), null);
});

test('GcsClient.deleteObject: DELETEs the object; 404 is treated as already gone', async () => {
  const { createServer } = await import('node:http');
  const { GcsClient } = await import('../src/gcs/gcs-client');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const seen: string[] = [];
  const keepPath = `/storage/v1/b/bkt/o/${encodeURIComponent('acme/.keep')}`;
  const gonePath = `/storage/v1/b/bkt/o/${encodeURIComponent('acme/gone.csv')}`;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/token') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      return;
    }
    if (req.headers.authorization !== 'Bearer tok') {
      res.statusCode = 401;
      res.end('{}');
      return;
    }
    seen.push(`${req.method} ${url.pathname}`);
    if (req.method === 'DELETE' && url.pathname === keepPath) {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'DELETE' && url.pathname === gonePath) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Not Found' } }));
      return;
    }
    res.statusCode = 500;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const key = {
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `http://127.0.0.1:${port}/token`,
    };
    const c = new GcsClient('bkt', key, `http://127.0.0.1:${port}/storage/v1`);
    await c.deleteObject('acme/.keep'); // 204 → ok
    await c.deleteObject('acme/gone.csv'); // 404 → treated as success, no throw
    assert.ok(seen.includes(`DELETE ${keepPath}`));
    assert.ok(seen.includes(`DELETE ${gonePath}`));
  } finally {
    server.close();
  }
});
