import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/**
 * Server-side half of every /api/* call the browser makes (see app/api/[...path]/route.ts): the request
 * is forwarded to the API service, so the browser only ever talks to this app (same origin, no CORS).
 *
 * In production the API is private: Cloud Run lets a request through only with an ID token for the web
 * service's identity, which is fetched from the metadata server and attached here. The signed-in person's
 * email, taken from IAP's signed JWT after verifying it, goes along as `x-user-email` for the API's rate
 * limits and audit logs. Locally the request is simply forwarded to API_INTERNAL_URL.
 */

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const ON_CLOUD_RUN = Boolean(process.env.K_SERVICE);
/** Optional exact `aud` check for the IAP JWT: /projects/<number>/locations/<region>/services/<service>. */
const IAP_AUDIENCE = process.env.IAP_AUDIENCE?.trim() || null;
const IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const IAP_KEYS_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const IAP_ISSUER = 'https://cloud.google.com/iap';

/** Only these headers cross the proxy — never the browser's cookies, IAP's own token or Authorization. */
const REQUEST_HEADERS = ['accept', 'content-type', 'x-cloud-trace-context', 'traceparent'];
const RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'content-disposition',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
];

// Requests to the API go through node:http(s) rather than fetch: Node's fetch gives up after 5 minutes
// without response headers, and an upload can legitimately wait longer (it queues behind a running
// sync). The socket timeout below matches Cloud Run's 15-minute request timeout.
const UPSTREAM_TIMEOUT_MS = 15 * 60_000;
const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** Send one request to the API and resolve once its response headers arrive (the body streams on). */
function forward(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstreamReq = send(target, {
      method,
      headers,
      agent: target.protocol === 'https:' ? httpsAgent : httpAgent,
      signal,
      timeout: UPSTREAM_TIMEOUT_MS,
    });
    upstreamReq.on('response', resolve);
    upstreamReq.on('error', reject);
    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('API request timed out')));
    if (body) {
      // Stream uploads straight through instead of buffering them here.
      Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>)
        .on('error', (err) => upstreamReq.destroy(err))
        .pipe(upstreamReq);
    } else {
      upstreamReq.end();
    }
  });
}

// ── ID token for the API ──

let idToken: { value: string; expiresAt: number } | null = null;
let idTokenPending: Promise<string> | null = null;

/** Cached until 5 minutes before it expires (tokens last an hour). */
async function apiIdToken(): Promise<string> {
  if (idToken && Date.now() < idToken.expiresAt - 5 * 60_000) return idToken.value;
  idTokenPending ??= (async () => {
    try {
      const res = await fetch(`${IDENTITY_URL}?audience=${encodeURIComponent(API)}`, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`metadata server answered ${res.status}`);
      const value = (await res.text()).trim();
      idToken = { value, expiresAt: (jwtPayload(value)?.exp ?? 0) * 1000 || Date.now() + 55 * 60_000 };
      return value;
    } finally {
      idTokenPending = null;
    }
  })();
  return idTokenPending;
}

// ── Signed-in user (IAP) ──

type JwtPart = Record<string, unknown> & { exp?: number; iat?: number };

function b64urlJson(part: string | undefined): JwtPart | null {
  try {
    return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as JwtPart;
  } catch {
    return null;
  }
}

function jwtPayload(jwt: string): JwtPart | null {
  return b64urlJson(jwt.split('.')[1]);
}

let iapKeys: { fetchedAt: number; byKid: Map<string, CryptoKey> } | null = null;

/** IAP's public signing keys (ES256), cached for an hour; refetched at most once a minute for a new kid. */
async function iapKey(kid: string): Promise<CryptoKey | undefined> {
  const age = iapKeys ? Date.now() - iapKeys.fetchedAt : Infinity;
  if (age > 60 * 60_000 || (!iapKeys?.byKid.has(kid) && age > 60_000)) {
    const res = await fetch(IAP_KEYS_URL, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!res.ok) throw new Error(`IAP keys: HTTP ${res.status}`);
    const { keys } = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
    const byKid = new Map<string, CryptoKey>();
    for (const k of keys) {
      if (k.kty !== 'EC' || k.crv !== 'P-256' || !k.x || !k.y) continue;
      byKid.set(
        k.kid,
        await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
          'verify',
        ])
      );
    }
    iapKeys = { fetchedAt: Date.now(), byKid };
  }
  return iapKeys?.byKid.get(kid);
}

/**
 * The email in an IAP JWT (`x-goog-iap-jwt-assertion`) once its ES256 signature, issuer, expiry and
 * (when given) audience check out; otherwise null. Exported for tests.
 */
export async function verifyIapJwt(
  jwt: string,
  getKey: (kid: string) => Promise<CryptoKey | undefined>,
  audience: string | null = null,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return null;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (!header || !payload || header.alg !== 'ES256' || typeof header.kid !== 'string') return null;
  const key = await getKey(header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(s, 'base64url'),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) return null;
  if (payload.iss !== IAP_ISSUER) return null;
  if (typeof payload.exp !== 'number' || payload.exp < nowSec - 30) return null;
  if (typeof payload.iat === 'number' && payload.iat > nowSec + 30) return null;
  if (audience && payload.aud !== audience) return null;
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  return email.includes('@') ? email : null;
}

let lastIdentityWarning = 0;

/** Verified email of the signed-in person, or null (locally, or if IAP's assertion doesn't verify). */
async function signedInEmail(headers: Headers): Promise<string | null> {
  if (!ON_CLOUD_RUN) return null;
  const jwt = headers.get('x-goog-iap-jwt-assertion');
  let email: string | null = null;
  try {
    email = jwt ? await verifyIapJwt(jwt, iapKey, IAP_AUDIENCE) : null;
  } catch (err) {
    console.error('[api-proxy] could not verify the IAP assertion', err);
  }
  if (!email && Date.now() - lastIdentityWarning > 60_000) {
    lastIdentityWarning = Date.now();
    console.warn(`[api-proxy] request without a valid IAP assertion (${jwt ? 'did not verify' : 'missing'}) — rate limits fall back to the client IP`);
  }
  return email;
}

/** The client IP Cloud Run's front end appended (the last X-Forwarded-For entry; earlier ones are client-supplied). */
function clientIp(headers: Headers): string | null {
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

// ── Proxy ──

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

export async function proxyToApi(req: Request, path: string[]): Promise<Response> {
  if (path.some((p) => p === '.' || p === '..' || p === '')) return json(400, 'Invalid API path');
  const target = `${API}/api/${path.map(encodeURIComponent).join('/')}${new URL(req.url).search}`;

  const headers: Record<string, string> = {};
  for (const name of REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }
  const email = await signedInEmail(req.headers);
  if (email) headers['x-user-email'] = email;
  const ip = clientIp(req.headers);
  if (ip) headers['x-forwarded-for'] = ip;

  if (ON_CLOUD_RUN) {
    try {
      headers.authorization = `Bearer ${await apiIdToken()}`;
    } catch (err) {
      console.error('[api-proxy] could not get an ID token for the API', err);
      return json(502, 'Could not authenticate to the API service.');
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let res: IncomingMessage;
  try {
    res = await forward(new URL(target), req.method, headers, hasBody ? req.body : null, req.signal);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error('[api-proxy] API request failed', target, err);
    return json(502, 'The API is not reachable right now. Try again in a minute.');
  }

  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const v = res.headers[name];
    if (typeof v === 'string') out.set(name, v);
  }
  const status = res.statusCode ?? 502;
  if (NULL_BODY_STATUS.has(status)) {
    res.resume();
    return new Response(null, { status, headers: out });
  }
  return new Response(Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>, {
    status,
    statusText: res.statusMessage ?? '',
    headers: out,
  });
}
