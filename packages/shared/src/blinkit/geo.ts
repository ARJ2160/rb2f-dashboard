/* ---------------------------------------------------------------------------
   City normalisation and campaign → geography resolution.

   RULE (business correction, Oct 2026): Blinkit ad reports carry no city.
   Ad metrics are shown at city level ONLY for campaigns whose targeting is
   known to be exactly one city, or a set of cities inside ONE metro cluster
   (e.g. "Delhi NCR", "Gurgaon + Delhi"). Nothing is ever split / allocated
   by revenue share. Multi-metro, Top City, ROC, Pan-India and unknown
   campaigns are excluded from every city-level ad number and reported as
   "not city-attributable" so totals still reconcile.
--------------------------------------------------------------------------- */

export const normKey = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();

/** Display-name aliases → canonical city (keys are normKey'd). */
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru', banglore: 'Bengaluru', bengaluru: 'Bengaluru', blr: 'Bengaluru', bang: 'Bengaluru',
  gurgaon: 'Gurgaon', gurugram: 'Gurgaon', ggn: 'Gurgaon', ggm: 'Gurgaon',
  delhi: 'Delhi', 'new delhi': 'Delhi', del: 'Delhi',
  noida: 'Noida', 'greater noida': 'Greater Noida', ghaziabad: 'Ghaziabad', faridabad: 'Faridabad', fbd: 'Faridabad',
  hyderabad: 'Hyderabad', hyd: 'Hyderabad',
  mumbai: 'Mumbai', mum: 'Mumbai', bombay: 'Mumbai', bom: 'Mumbai', thane: 'Thane', 'navi mumbai': 'Navi Mumbai',
  pune: 'Pune', pnq: 'Pune',
  chennai: 'Chennai', hennai: 'Chennai', madras: 'Chennai', maa: 'Chennai',
  kolkata: 'Kolkata', calcutta: 'Kolkata', kol: 'Kolkata', ccu: 'Kolkata',
  ahmedabad: 'Ahmedabad', amd: 'Ahmedabad', ahm: 'Ahmedabad', ahd: 'Ahmedabad', jaipur: 'Jaipur', lucknow: 'Lucknow', lko: 'Lucknow',
  kochi: 'Kochi', cochin: 'Kochi', trivandrum: 'Trivandrum', thiruvananthapuram: 'Trivandrum',
  chandigarh: 'Chandigarh', mohali: 'Mohali', panchkula: 'Panchkula', zirakpur: 'Zirakpur', kharar: 'Kharar',
  surat: 'Surat', indore: 'Indore', bhopal: 'Bhopal', nagpur: 'Nagpur', vadodara: 'Vadodara', baroda: 'Vadodara',
  ludhiana: 'Ludhiana', dehradun: 'Dehradun', coimbatore: 'Coimbatore', mysore: 'Mysore', mysuru: 'Mysore',
  'udaipur rajasthan': 'Udaipur (Rajasthan)', udaipur: 'Udaipur (Rajasthan)', goa: 'Goa',
};

/** 3-letter codes accepted inside campaign NAMES (other short aliases are too ambiguous there). */
const NAME_CODES = new Set(['hyd', 'ahm', 'ahd', 'amd', 'pnq', 'blr', 'ggn', 'mum', 'bom', 'lko', 'fbd', 'ccu', 'maa', 'kol']);

/**
 * Blinkit's Sales report books every UP-NCR order (Noida, Greater Noida) under
 * customer city "Ghaziabad". Campaign targeting keeps its own city; this map is
 * used only to find the matching SALES when setting ad spend against revenue.
 */
export const SALES_CITY_OF: Record<string, string> = { Noida: 'Ghaziabad', 'Greater Noida': 'Ghaziabad' };
export const salesCityOf = (city: string) => SALES_CITY_OF[city] ?? city;

/** Metro clusters: a campaign targeting any subset of ONE cluster is still a
    single, exact geography (the user's "Delhi NCR" case). */
export const CLUSTERS: Record<string, string[]> = {
  'Delhi NCR': ['Delhi', 'Gurgaon', 'Noida', 'Greater Noida', 'Ghaziabad', 'Faridabad'],
  'Mumbai MMR': ['Mumbai', 'Thane', 'Navi Mumbai'],
  'Chandigarh Tricity': ['Chandigarh', 'Mohali', 'Panchkula', 'Zirakpur', 'Kharar', 'New Chandigarh'],
};
const CLUSTER_ALIASES: Record<string, string> = {
  ncr: 'Delhi NCR', 'delhi ncr': 'Delhi NCR', 'delhi ncr region': 'Delhi NCR', 'hr ncr': 'Delhi NCR', 'up ncr': 'Delhi NCR',
  mmr: 'Mumbai MMR', 'mumbai mmr': 'Mumbai MMR', tricity: 'Chandigarh Tricity', 'chandigarh tricity': 'Chandigarh Tricity',
};

/** Tokens that mean "many cities we cannot name" → never city-attributable. */
const NON_CITY = /\b(pan ?india|all ?india|all|top ?\d* ?cit(y|ies)|roc\d*|rest of (india|cities)|oth(er)? ?top ?\d* ?cities|national|india)\b/;
/** Stricter version for campaign NAMES ("All in One NCR" is a product, not "all cities"). */
const NON_CITY_NAME = /\b(pan ?india|all ?india|top ?\d* ?cit(y|ies)|roc ?\d*|rest of (india|cities)|oth(er)? ?top ?\d* ?cities)\b/;

export function canonicalCity(raw: unknown): string {
  const k = normKey(raw);
  if (!k) return '';
  if (CITY_ALIASES[k]) return CITY_ALIASES[k];
  // keep the report's own spelling, title-cased
  return String(raw).trim().replace(/\s+/g, ' ');
}

export type CampaignGeo =
  | { kind: 'city'; key: string; label: string; cities: string[]; source: 'mapper' | 'name' }
  | { kind: 'multi'; key: string; label: string; cities: string[]; source: 'mapper' | 'name' }
  | { kind: 'none'; reason: string };

function clusterOf(city: string): string | null {
  for (const [c, members] of Object.entries(CLUSTERS)) if (members.includes(city)) return c;
  return null;
}

function unitFromCities(cities: string[], source: 'mapper' | 'name'): CampaignGeo {
  const set = [...new Set(cities)].sort();
  if (!set.length) return { kind: 'none', reason: 'no city' };
  const key = set.join(' + ');
  if (set.length === 1) return { kind: 'city', key, label: set[0]!, cities: set, source };
  const cl = set.map(clusterOf);
  const first = cl[0];
  if (first && cl.every((c) => c === first)) {
    const full = (CLUSTERS[first] ?? []).every((m) => set.includes(m));
    return { kind: 'city', key, label: full ? first : key, cities: set, source };
  }
  return { kind: 'multi', key, label: key, cities: set, source };
}

/** Parse a mapper "City" cell like "Gurgaon + Delhi", "Hyderabad, Bengaluru", "Pan India". */
export function parseCityList(text: unknown, source: 'mapper' | 'name' = 'mapper'): CampaignGeo {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'none', reason: 'no city in mapper' };
  if (NON_CITY.test(normKey(raw))) return { kind: 'none', reason: raw };
  const parts = raw.split(/\s*(?:,|\+|&|\/|;|\band\b)\s*/i).filter(Boolean);
  const cities: string[] = [];
  for (const p of parts) {
    const k = normKey(p);
    const cluster = CLUSTER_ALIASES[k];
    if (cluster) { cities.push(...(CLUSTERS[cluster] ?? [])); continue; }
    const alias = CITY_ALIASES[k];
    if (alias) { cities.push(alias); continue; }
    if (k) cities.push(canonicalCity(p));
  }
  return unitFromCities(cities, source);
}

/** Fallback when the mapper has no city: look for city tokens in the
    campaign name. Only an unambiguous single geography counts. */
export function geoFromCampaignName(name: string): CampaignGeo {
  const k = normKey(name);
  if (NON_CITY_NAME.test(k)) return { kind: 'none', reason: 'Top City / ROC / Pan-India in name' };
  const found: string[] = [];
  for (const [alias, cl] of Object.entries(CLUSTER_ALIASES))
    if (new RegExp(`\\b${alias}\\b`).test(k)) found.push(...(CLUSTERS[cl] ?? []));
  for (const [alias, city] of Object.entries(CITY_ALIASES))
    if ((alias.length >= 4 || NAME_CODES.has(alias)) && new RegExp(`\\b${alias}\\b`).test(k)) found.push(city);
  if (!found.length) return { kind: 'none', reason: 'no city in mapper or name' };
  return unitFromCities(found, 'name');
}

export function resolveCampaignGeo(mapperCity: unknown, campaignName: string): CampaignGeo {
  if (String(mapperCity ?? '').trim()) return parseCityList(mapperCity, 'mapper');
  return geoFromCampaignName(campaignName);
}
