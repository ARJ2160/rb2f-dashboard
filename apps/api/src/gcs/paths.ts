/**
 * Pure helpers for the GCS warehouse layout (no I/O — unit-tested).
 *
 *   <bucket>/<brand>/<marketplace>/<report folder>/<file>.csv
 *   e.g. rb2f-warehouse-dropzone/eatopia/amazon/campaign_mapper/eatopia_campaign_mapper.csv
 *
 * Each brand folder becomes its own profile, `gcs_<brand>`, so warehouse data
 * never mixes with manually uploaded profiles.
 */

export const GCS_PROFILE_PREFIX = 'gcs_';

export interface BrandFolder {
  /** Clean id used in URLs and the API ("milkitbaby"). */
  brand: string;
  /** Folder name exactly as in the bucket — may carry stray spaces (" milkitbaby"). */
  folder: string;
  profileId: string;
}

/** Brand folder name → URL-safe brand id ('' when nothing usable is left). */
export function brandSlug(folder: string): string {
  return folder
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64 - GCS_PROFILE_PREFIX.length);
}

export const profileIdForBrand = (brand: string) => `${GCS_PROFILE_PREFIX}${brand}`;

export const isGcsProfile = (profileId: string) => profileId.startsWith(GCS_PROFILE_PREFIX);

/**
 * Top-level bucket prefixes ("eatopia/", " milkitbaby/", "_tmp/") → brand folders.
 * Folders starting with "_" or "." are internal (e.g. `_tmp/`) and ignored.
 */
export function brandFoldersFromPrefixes(prefixes: string[]): BrandFolder[] {
  const out = new Map<string, BrandFolder>();
  for (const p of prefixes) {
    const folder = p.replace(/\/$/, '');
    const trimmed = folder.trim();
    if (!trimmed || trimmed.startsWith('_') || trimmed.startsWith('.')) continue;
    const brand = brandSlug(folder);
    if (!brand || out.has(brand)) continue;
    out.set(brand, { brand, folder, profileId: profileIdForBrand(brand) });
  }
  return [...out.values()].sort((a, b) => a.brand.localeCompare(b.brand));
}

/** `<folder>/<marketplace>/` — the prefix whose files are synced for a brand. */
export const marketplacePrefix = (folder: string, marketplace: string) => `${folder}/${marketplace}/`;

const SPREADSHEET = /\.(csv|xlsx|xls)$/i;

export interface ObjectMeta {
  name: string;
  generation: string;
  size: number;
  updated: string;
}

/** Files under the marketplace prefix that the upload pipeline can read. */
export function ingestableObjects<T extends ObjectMeta>(objects: T[], prefix: string): T[] {
  return objects.filter(
    (o) => o.name.startsWith(prefix) && !o.name.endsWith('/') && SPREADSHEET.test(o.name) && o.size > 0
  );
}

/**
 * Name handed to the ingest pipeline: the path below the marketplace folder,
 * e.g. `campaign_mapper/eatopia_campaign_mapper.csv`. Keeping the report folder
 * in the name lets the filename fallback of report detection use it.
 */
export const relativeName = (objectName: string, prefix: string) => objectName.slice(prefix.length);

/**
 * Ingest order: mapper files first (categories exist before campaign filters
 * are rebuilt), then the campaign export (it says which campaigns are SP / SB
 * / SD — the other ad exports don't), then the Business Report (its titles
 * identify SB advertised products), then everything else; within a group
 * oldest → newest so a newer export of the same dates replaces an older one,
 * exactly like uploading them in that order.
 */
export function syncOrder<T extends ObjectMeta>(objects: T[], prefix: string): T[] {
  const rank = (o: T) => {
    const folder = (relativeName(o.name, prefix).split('/')[0] ?? '').toLowerCase();
    if (folder.includes('mapper')) return 0;
    if (folder === 'campaign' || folder === 'campaigns') return 1;
    // Business Report titles help match SB advertised rows (no product ID) to ASINs.
    if (folder.includes('seller_central') || folder.includes('business')) return 2;
    return 3;
  };
  return [...objects].sort(
    (a, b) => rank(a) - rank(b) || a.updated.localeCompare(b.updated) || a.name.localeCompare(b.name)
  );
}
