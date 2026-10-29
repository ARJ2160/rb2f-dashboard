import type {
  CategoryResponse,
  CoverageResponse,
  DsrResponse,
  DurMetric,
  DurResponse,
  GcsBrandsResponse,
  GcsFileEntry,
  GcsSyncJob,
  AdsResponse,
  HarvestResponse,
  HourlyResponse,
  PlacementResponse,
  SearchTermResponse,
  SqpResponse,
  StateResponse,
  SummaryResponse,
  UploadLogEntry,
  UploadResponse,
} from '@dash/shared';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

const qs = (p: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

export async function uploadFiles(profileId: string, files: File[]): Promise<UploadResponse> {
  const fd = new FormData();
  fd.set('profileId', profileId);
  for (const f of files) fd.append('files', f, f.name);
  return json(await fetch(`${API_URL}/api/uploads`, { method: 'POST', body: fd }));
}

export async function getUploads(profileId: string): Promise<UploadLogEntry[]> {
  return json(await fetch(`${API_URL}/api/uploads?${qs({ profileId, limit: '30' })}`, { cache: 'no-store' }));
}

export async function getDsr(profileId: string, from: string, to: string, category = ''): Promise<DsrResponse> {
  return json(await fetch(`${API_URL}/api/reports/dsr?${qs({ profileId, from, to, category })}`, { cache: 'no-store' }));
}

export async function getDur(profileId: string, from: string, to: string, metric: DurMetric, category = ''): Promise<DurResponse> {
  return json(await fetch(`${API_URL}/api/reports/dur?${qs({ profileId, from, to, metric, category })}`, { cache: 'no-store' }));
}

export async function getSummary(profileId: string, f: { asOf?: string; category?: string } = {}): Promise<SummaryResponse> {
  return json(await fetch(`${API_URL}/api/reports/summary?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
}

export async function getCoverage(profileId: string): Promise<CoverageResponse> {
  return json(await fetch(`${API_URL}/api/reports/coverage?${qs({ profileId })}`, { cache: 'no-store' }));
}

export type Filters = Record<string, string | undefined>;

export async function getCategory(profileId: string, from: string, to: string, f: Filters = {}): Promise<CategoryResponse> {
  return json(await fetch(`${API_URL}/api/reports/category?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getAds(profileId: string, from: string, to: string, f: Filters): Promise<AdsResponse> {
  return json(await fetch(`${API_URL}/api/reports/ads?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getHourly(profileId: string, from: string, to: string, f: Filters): Promise<HourlyResponse> {
  return json(await fetch(`${API_URL}/api/reports/hourly?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getBrandTerms(profileId: string): Promise<{ terms: string[] }> {
  return json(await fetch(`${API_URL}/api/reports/brand-terms?${qs({ profileId })}`, { cache: 'no-store' }));
}

export async function saveBrandTerms(profileId: string, terms: string[]): Promise<{ terms: string[] }> {
  return json(
    await fetch(`${API_URL}/api/reports/brand-terms?${qs({ profileId })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms }),
    })
  );
}

export async function getSearchTerms(profileId: string, from: string, to: string, f: Filters): Promise<SearchTermResponse> {
  return json(await fetch(`${API_URL}/api/reports/search-terms?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getPlacements(profileId: string, from: string, to: string, f: Filters): Promise<PlacementResponse> {
  return json(await fetch(`${API_URL}/api/reports/placements?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getStates(profileId: string, from: string, to: string, f: Filters): Promise<StateResponse> {
  return json(await fetch(`${API_URL}/api/reports/states?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

/** Search Query Performance for one reporting period (newest when periodStart is empty). */
export async function getSqp(profileId: string, f: Filters): Promise<SqpResponse> {
  return json(await fetch(`${API_URL}/api/reports/sqp?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
}

/** Keyword harvesting: SP / SB search terms with orders that aren't manual targets yet. */
export async function getHarvest(profileId: string, f: Filters): Promise<HarvestResponse> {
  return json(await fetch(`${API_URL}/api/reports/harvest?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
}

// ── GCS warehouse (read-only) ──

/** Marketplace folder synced from GCS: `<brand>/amazon/` (default) or `<brand>/blinkit/`. */
export type Marketplace = 'amazon' | 'blinkit';

export async function getGcsBrands(refresh = false, marketplace: Marketplace = 'amazon'): Promise<GcsBrandsResponse> {
  return json(
    await fetch(`${API_URL}/api/gcs/brands?${qs({ refresh: refresh ? '1' : undefined, marketplace })}`, { cache: 'no-store' })
  );
}

export async function startGcsSync(brand: string, force = false, marketplace: Marketplace = 'amazon'): Promise<GcsSyncJob> {
  return json(
    await fetch(`${API_URL}/api/gcs/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand, force, marketplace }),
    })
  );
}

export async function getGcsFiles(brand: string, marketplace: Marketplace = 'amazon'): Promise<GcsFileEntry[]> {
  return json(await fetch(`${API_URL}/api/gcs/files?${qs({ brand, marketplace })}`, { cache: 'no-store' }));
}
