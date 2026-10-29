import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimal, read-only Google Cloud Storage client (JSON API) built on `fetch`
 * and `node:crypto`, so no Google SDK is needed. Two ways to authenticate:
 *
 *   - a service-account JSON key (local development) — signed JWT, scope
 *     `devstorage.read_only`;
 *   - the metadata server (Cloud Run) — the service account attached to the
 *     service, no key file anywhere. Its IAM role on the bucket (Storage
 *     Object Viewer) is what limits it to reading.
 *
 * This module can only list and download objects, never write or delete them.
 */

const STORAGE_API = 'https://storage.googleapis.com/storage/v1';
const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface ServiceAccountKey {
  type?: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface GcsObject {
  name: string;
  generation: string;
  size: number;
  updated: string;
  contentType?: string;
}

export class GcsError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

export function loadServiceAccount(file: string): ServiceAccountKey {
  const full = path.resolve(file);
  let raw: string;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (err) {
    throw new GcsError(`Cannot read the GCS service-account key at ${full}: ${(err as Error).message}`);
  }
  let key: Partial<ServiceAccountKey>;
  try {
    key = JSON.parse(raw) as Partial<ServiceAccountKey>;
  } catch {
    throw new GcsError(`${full} is not valid JSON — expected a service-account key file.`);
  }
  if (!key.client_email || !key.private_key) {
    throw new GcsError(
      `${full} has no client_email / private_key — download a JSON key for a service account.`
    );
  }
  // Keys pasted through env files sometimes carry literal "\n".
  return { ...key, client_email: key.client_email, private_key: key.private_key.replace(/\\n/g, '\n') };
}

/** Signed RS256 JWT for the OAuth 2.0 JWT-bearer grant. Exported for tests. */
export function signJwt(key: ServiceAccountKey, nowSec: number, scope = READ_ONLY_SCOPE): string {
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: key.client_email,
    scope,
    aud,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  return `${unsigned}.${signature}`;
}

export class GcsClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    readonly bucket: string,
    /** Service-account key, or null to use the metadata server (Cloud Run). */
    private readonly key: ServiceAccountKey | null,
    /** Overridable for tests. */
    private readonly apiBase = STORAGE_API,
    private readonly metadataTokenUrl = METADATA_TOKEN_URL
  ) {}

  static fromKeyFile(bucket: string, file: string): GcsClient {
    return new GcsClient(bucket, loadServiceAccount(file));
  }

  /** Cloud Run: authenticate as the service account attached to the service. */
  static fromMetadataServer(bucket: string): GcsClient {
    return new GcsClient(bucket, null);
  }

  private get principal(): string {
    return this.key?.client_email ?? "the API's service account";
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    this.token = this.key ? await this.keyToken(this.key) : await this.metadataToken();
    return this.token.value;
  }

  private async metadataToken(): Promise<{ value: string; expiresAt: number }> {
    let res: Response;
    try {
      res = await fetch(this.metadataTokenUrl, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new GcsError(`GCS auth failed: metadata server unreachable (${(err as Error).message})`);
    }
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      throw new GcsError(`GCS auth failed (${res.status}): the metadata server returned no access token`, res.status);
    }
    return { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  }

  private async keyToken(key: ServiceAccountKey): Promise<{ value: string; expiresAt: number }> {
    const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
    const res = await fetch(tokenUri, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signJwt(key, Math.floor(Date.now() / 1000)),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new GcsError(
        `GCS auth failed (${res.status}): ${body.error_description ?? body.error ?? 'no access token returned'}`,
        res.status
      );
    }
    return { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  }

  /** GET with retries; `timeoutMs` bounds each attempt so a stalled connection can't hang a sync. */
  private async get(url: string, timeoutMs = 60_000): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { authorization: `Bearer ${await this.accessToken()}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err instanceof GcsError) throw err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        const timedOut = (err as Error).name === 'TimeoutError';
        throw new GcsError(`GCS request ${timedOut ? 'timed out' : `failed: ${(err as Error).message}`}`);
      }
      if (res.ok) return res;
      if (res.status === 401 && attempt === 0) {
        this.token = null; // expired / revoked — fetch a new one once
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      const text = await res.text().catch(() => '');
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        /* not JSON */
      }
      const hint =
        res.status === 403
          ? ` — give ${this.principal} "Storage Object Viewer" on gs://${this.bucket}`
          : '';
      throw new GcsError(`GCS request failed (${res.status}): ${msg}${hint}`, res.status);
    }
  }

  private objectsUrl(params: Record<string, string>): string {
    return `${this.apiBase}/b/${encodeURIComponent(this.bucket)}/o?${new URLSearchParams(params)}`;
  }

  /** Immediate "sub-folders" of `prefix` (e.g. brand folders at the bucket root with prefix ''). */
  async listPrefixes(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.get(
        this.objectsUrl({
          prefix,
          delimiter: '/',
          maxResults: '1000',
          fields: 'prefixes,nextPageToken',
          ...(pageToken ? { pageToken } : {}),
        })
      );
      const body = (await res.json()) as { prefixes?: string[]; nextPageToken?: string };
      out.push(...(body.prefixes ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Every object below `prefix`, recursively. */
  async listObjects(prefix: string): Promise<GcsObject[]> {
    const out: GcsObject[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.get(
        this.objectsUrl({
          prefix,
          maxResults: '1000',
          fields: 'items(name,generation,size,updated,contentType),nextPageToken',
          ...(pageToken ? { pageToken } : {}),
        })
      );
      const body = (await res.json()) as {
        items?: Array<{
          name: string;
          generation: string;
          size: string;
          updated: string;
          contentType?: string;
        }>;
        nextPageToken?: string;
      };
      for (const i of body.items ?? []) {
        out.push({
          name: i.name,
          generation: i.generation,
          size: Number(i.size) || 0,
          updated: i.updated,
          ...(i.contentType ? { contentType: i.contentType } : {}),
        });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Object bytes, pinned to `generation` so a file overwritten mid-sync isn't mixed up. */
  async download(name: string, generation?: string): Promise<Buffer> {
    const url = `${this.apiBase}/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(name)}?${new URLSearchParams(
      {
        alt: 'media',
        ...(generation ? { generation } : {}),
      }
    )}`;
    const res = await this.get(url, 5 * 60_000);
    return Buffer.from(await res.arrayBuffer());
  }
}
