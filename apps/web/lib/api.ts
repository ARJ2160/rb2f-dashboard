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
  SummaryCompareResponse,
  NegationsResponse,
  TermRulesResponse,
  TermActionGrain,
  TermRule,
  BidActionsResponse,
  SearchRankResponse,
  GlanceViewsResponse,
  KeywordSovResponse,
} from '@dash/shared';

/** Same origin: this app forwards /api/* to the API service (app/api/[...path]/route.ts). */
export const API_URL = '';

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


export async function getDsr(profileId: string, from: string, to: string, category = ''): Promise<DsrResponse> {
  return json(await fetch(`${API_URL}/api/reports/dsr?${qs({ profileId, from, to, category })}`, { cache: 'no-store' }));
}

export async function getDur(profileId: string, from: string, to: string, metric: DurMetric, category = ''): Promise<DurResponse> {
  return json(await fetch(`${API_URL}/api/reports/dur?${qs({ profileId, from, to, metric, category })}`, { cache: 'no-store' }));
}

export async function getSummary(profileId: string, f: { asOf?: string; category?: string } = {}): Promise<SummaryResponse> {
  return json(await fetch(`${API_URL}/api/reports/summary?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
}

export async function getSummaryCompare(
  profileId: string,
  f: { aFrom: string; aTo: string; bFrom: string; bTo: string; category?: string }
): Promise<SummaryCompareResponse> {
  return json(await fetch(`${API_URL}/api/reports/summary-compare?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
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

export async function getNegations(profileId: string, from: string, to: string, f: Filters = {}): Promise<NegationsResponse> {
  return json(await fetch(`${API_URL}/api/reports/negations?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getTermRules(
  profileId: string,
  from: string,
  to: string,
  grain: TermActionGrain,
  rules: TermRule[],
  f: Filters = {}
): Promise<TermRulesResponse> {
  return json(
    await fetch(`${API_URL}/api/reports/term-rules?${qs({ profileId, from, to, grain, rules: JSON.stringify(rules), ...f })}`, {
      cache: 'no-store',
    })
  );
}

export async function getBidActions(profileId: string, from: string, to: string, f: Filters = {}): Promise<BidActionsResponse> {
  return json(await fetch(`${API_URL}/api/reports/bid-actions?${qs({ profileId, from, to, ...f })}`, { cache: 'no-store' }));
}

export async function getSearchRank(profileId: string): Promise<SearchRankResponse> {
  return json(await fetch(`${API_URL}/api/reports/search-rank?${qs({ profileId })}`, { cache: 'no-store' }));
}

export async function getGlanceViews(profileId: string, f: { from?: string; to?: string; category?: string } = {}): Promise<GlanceViewsResponse> {
  return json(await fetch(`${API_URL}/api/reports/glance-views?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
}

export async function getKeywordSov(profileId: string, f: { duration?: string; date?: string; keywordType?: string } = {}): Promise<KeywordSovResponse> {
  return json(await fetch(`${API_URL}/api/reports/keyword-sov?${qs({ profileId, ...f })}`, { cache: 'no-store' }));
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
export type Marketplace = 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto';

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

// ── GCS ingest (upload → warehouse) ───────────────────────────────────────────

export interface ReportType {
  id: string;
  label: string;
  folder: string;
  marketplace: Marketplace;
  hint?: string;
}

export interface IngestFileResult {
  filename: string;
  objectName: string;
  size: number;
  status: 'uploaded' | 'error';
  message?: string;
}

export interface IngestResponse {
  files: IngestFileResult[];
  sync: { jobId: string; brand: string } | null;
}

export async function getGcsReportTypes(marketplace?: Marketplace): Promise<ReportType[]> {
  return json(
    await fetch(
      `${API_URL}/api/gcs/report-types${marketplace ? `?marketplace=${marketplace}` : ''}`,
      { cache: 'no-store' }
    )
  );
}

export async function gcsIngest(
  brand: string,
  marketplace: Marketplace,
  reportType: string,
  files: File[]
): Promise<IngestResponse> {
  const fd = new FormData();
  fd.set('brand', brand);
  fd.set('marketplace', marketplace);
  fd.set('reportType', reportType);
  for (const f of files) fd.append('files', f, f.name);
  return json(await fetch(`${API_URL}/api/gcs/ingest`, { method: 'POST', body: fd }));
}

// ── Bulk ingest (detect → assign → upload a mixed batch) ──────────────────────

export interface FileAssignment {
  filename: string;
  marketplace: Marketplace;
  reportType: string;
}

export interface GcsDetection {
  filename: string;
  /** Coarse warehouse folder id, or null when unmapped. */
  reportType: string | null;
  /** Fine-grained pipeline guess, for display. */
  fineType: string | null;
  detectedBy: 'headers' | 'filename' | null;
  note?: string;
  /** Set when the columns belong to another marketplace than Amazon (e.g. Swiggy Instamart). */
  marketplace?: Marketplace;
}

export interface BulkIngestResponse {
  files: IngestFileResult[];
  sync: GcsSyncJob[];
}

/** Guess each file's report type from its columns — no upload happens. */
export async function gcsDetect(files: File[]): Promise<{ detections: GcsDetection[] }> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  return json(await fetch(`${API_URL}/api/gcs/detect`, { method: 'POST', body: fd }));
}

/** Upload a mixed batch of reports in one call, then kick off a sync per marketplace touched. */
export async function gcsIngestBulk(
  brand: string,
  startDate: string,
  endDate: string,
  assignments: FileAssignment[],
  files: File[]
): Promise<BulkIngestResponse> {
  const fd = new FormData();
  fd.set('brand', brand);
  fd.set('startDate', startDate);
  fd.set('endDate', endDate);
  fd.set('assignments', JSON.stringify(assignments));
  for (const f of files) fd.append('files', f, f.name);
  return json(await fetch(`${API_URL}/api/gcs/ingest-bulk`, { method: 'POST', body: fd }));
}
