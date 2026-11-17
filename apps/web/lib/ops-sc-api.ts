import type { ScAllResponse } from '@dash/shared';

const q = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

/** All Seller Central views for a brand in one call. */
export async function getScAll(brandId: string, f: { from?: string; to?: string } = {}): Promise<ScAllResponse> {
  return json(await fetch(`/api/ops/sc/all?${q({ brandId, from: f.from, to: f.to })}`, { cache: 'no-store' }));
}
