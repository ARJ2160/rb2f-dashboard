import { daysInRange, enumerateDates, pct, ratio, type DsrMetrics, type SummaryPeriod, type SummaryResponse, type SummaryRow } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';
import { getDsr } from './dsr.service';
import { changePct, periodLabel, summaryPeriods } from '../lib/periods';
import { asinCategorySql, listCategories } from './filters';

// ── Data ──────────────────────────────────────────────────────────────

interface PeriodData {
  m: DsrMetrics;
  sessions: number | null;
  vendorUnits: number;
}

async function latestDates(profileId: string): Promise<{ sales: string | null; ads: string | null }> {
  const [r] = await db.execute<{ sales: string | null; ads: string | null }>(sql`
    select
      (select max(date)::text from daily_asin_sales where profile_id = ${profileId}) as sales,
      (select max(m)::text from (
        select max(date) as m from daily_asin_campaign_ads where profile_id = ${profileId}
        union all select max(date) from daily_campaign_ads where profile_id = ${profileId}
        union all select max(date) from sb_attributed_daily where profile_id = ${profileId}
      ) x) as ads`);
  return { sales: r?.sales ?? null, ads: r?.ads ?? null };
}

/** Days in [from, to] that have a sales upload / any ad upload. */
async function datesWithData(profileId: string, from: string, to: string) {
  const rows = await db.execute<{ date: string; kind: 'sales' | 'ads' }>(sql`
    select distinct date::text as date, 'sales' as kind from daily_asin_sales
      where profile_id = ${profileId} and date between ${from} and ${to}
    union
    select distinct date::text, 'ads' from (
      select date from daily_asin_campaign_ads where profile_id = ${profileId} and date between ${from} and ${to}
      union all select date from daily_campaign_ads where profile_id = ${profileId} and date between ${from} and ${to}
      union all select date from sb_attributed_daily where profile_id = ${profileId} and date between ${from} and ${to}
    ) a`);
  return {
    sales: new Set(rows.filter((r) => r.kind === 'sales').map((r) => r.date)),
    ads: new Set(rows.filter((r) => r.kind === 'ads').map((r) => r.date)),
  };
}

/** Seller sessions (Vendor Central has none) and Vendor units for a period, category-filtered like the DSR. */
async function sessionsAndVendor(profileId: string, from: string, to: string, category?: string) {
  const cat = category ? sql`and ${asinCategorySql('s.asin')} = ${category}` : sql``;
  const [r] = await db.execute<{ sessions: string | null; vendor_units: string | null }>(sql`
    select sum(s.sessions) as sessions,
           coalesce(sum(s.units) filter (where s.source = 'vendor'), 0) as vendor_units
    from daily_asin_sales s
    left join products p on p.profile_id = s.profile_id and p.asin = s.asin
    where s.profile_id = ${profileId} and s.date between ${from} and ${to} ${cat}`);
  return { sessions: r?.sessions == null ? null : Number(r.sessions), vendorUnits: Number(r?.vendor_units ?? 0) };
}

async function loadPeriod(profileId: string, p: { from: string; to: string }, category?: string): Promise<PeriodData> {
  const [dsr, extra] = await Promise.all([getDsr(profileId, p.from, p.to, category), sessionsAndVendor(profileId, p.from, p.to, category)]);
  return { m: dsr.total, ...extra };
}

// ── Rows ──────────────────────────────────────────────────────────────

type Def = Pick<SummaryRow, 'key' | 'label' | 'format' | 'better'> & { get: (p: PeriodData) => number | null };

/** The metric rows, in the order of the team's MoM / WoW sheet. */
const ROWS: Def[] = [
  { key: 'sales', label: 'Sales', format: 'money', better: 'up', get: (p) => p.m.sales },
  { key: 'units', label: 'Units', format: 'int', better: 'up', get: (p) => p.m.unitsSold },
  { key: 'aov', label: 'AOV', format: 'money', better: 'up', get: (p) => p.m.aov },
  { key: 'sessions', label: 'Sessions', format: 'int', better: 'up', get: (p) => p.sessions },
  { key: 'crPct', label: 'CR%', format: 'pct', better: 'up', get: (p) => pct(p.m.unitsSold, p.sessions) },
  { key: 'organicSales', label: 'Organic Sales', format: 'money', better: 'up', get: (p) => p.m.organicSales },
  { key: 'adSales', label: 'Ad Sales', format: 'money', better: 'up', get: (p) => p.m.adSales },
  { key: 'spends', label: 'Ad Spends', format: 'money', better: 'none', get: (p) => p.m.spends },
  { key: 'adUnits', label: 'Ad Units', format: 'int', better: 'up', get: (p) => p.m.adUnits },
  { key: 'acosPct', label: 'ACOS%', format: 'pct', better: 'down', get: (p) => p.m.acosPct },
  { key: 'tacosPct', label: 'TACOS%', format: 'pct', better: 'down', get: (p) => p.m.tacosPct },
  { key: 'roas', label: 'ROAS', format: 'ratio', better: 'up', get: (p) => ratio(p.m.adSales, p.m.spends) },
];

/**
 * MoM / WoW summary (the default screen). "As of" defaults to the latest day
 * that has data — the earlier of the latest sales day and the latest ads day,
 * so both sides of every comparison cover the same days. E.g. data through
 * 21 Oct → MTD 1–21 Oct vs PMTD 1–21 Sep, L7D 15–21 Oct vs P7D 8–14 Oct.
 */
export async function getSummary(profileId: string, opts: { asOf?: string; category?: string } = {}): Promise<SummaryResponse> {
  const [latest, categories] = await Promise.all([latestDates(profileId), listCategories(profileId)]);
  const notes: string[] = [];
  const known = [latest.sales, latest.ads].filter((x): x is string => !!x).sort();
  const autoAsOf = known[0] ?? null;
  const asOf = opts.asOf ?? autoAsOf;

  if (!asOf) {
    return { profileId, asOf: null, autoAsOf: null, latest, category: opts.category ?? null, categories, periods: null, rows: [], notes: ['No data for this profile yet.'] };
  }
  if (!opts.asOf && latest.sales && latest.ads && latest.sales !== latest.ads) {
    const behind = latest.sales < latest.ads ? 'Sales' : 'Ads';
    notes.push(
      `${behind} data is only uploaded through ${periodLabel(asOf, asOf)} (${behind === 'Sales' ? 'ads' : 'sales'} go to ${periodLabel(known[1]!, known[1]!)}), so the summary is as of ${periodLabel(asOf, asOf)} to keep both sides of each comparison on the same days.`
    );
  }

  const ranges = summaryPeriods(asOf);
  const [mtd, pmtd, l7d, p7d, have] = await Promise.all([
    loadPeriod(profileId, ranges.mtd, opts.category),
    loadPeriod(profileId, ranges.pmtd, opts.category),
    loadPeriod(profileId, ranges.l7d, opts.category),
    loadPeriod(profileId, ranges.p7d, opts.category),
    datesWithData(profileId, ranges.pmtd.from < ranges.p7d.from ? ranges.pmtd.from : ranges.p7d.from, asOf),
  ]);

  const period = (key: keyof typeof ranges, short: string): SummaryPeriod => {
    const r = ranges[key];
    const dates = enumerateDates(r.from, r.to);
    return {
      ...r,
      label: periodLabel(r.from, r.to),
      short,
      days: daysInRange(r.from, r.to),
      missingSalesDays: dates.filter((x) => !have.sales.has(x)).length,
      missingAdDays: dates.filter((x) => !have.ads.has(x)).length,
    };
  };
  const periods = { mtd: period('mtd', 'MTD'), pmtd: period('pmtd', 'PMTD'), l7d: period('l7d', 'L7D'), p7d: period('p7d', 'P7D') };

  const rows: SummaryRow[] = ROWS.map(({ get, ...def }) => {
    const v = { mtd: get(mtd), pmtd: get(pmtd), l7d: get(l7d), p7d: get(p7d) };
    return { ...def, ...v, mom: changePct(v.mtd, v.pmtd), wow: changePct(v.l7d, v.p7d) };
  });

  for (const p of Object.values(periods)) {
    const gaps = [
      p.missingSalesDays ? `${p.missingSalesDays} day(s) without sales data` : '',
      p.missingAdDays ? `${p.missingAdDays} day(s) without ad data` : '',
    ].filter(Boolean);
    if (gaps.length) notes.push(`${p.short} (${p.label}): ${gaps.join(', ')} — that change % compares incomplete periods.`);
  }
  if ([mtd, pmtd, l7d, p7d].some((p) => p.vendorUnits > 0)) {
    notes.push('Sessions come from the Seller Central Business Report only (Vendor Central has no sessions). CR% = Units ÷ Sessions, so Vendor units make it read high.');
  }
  if (opts.category) notes.push(`Category "${opts.category}" — same rules as the DSR category filter.`);

  return { profileId, asOf, autoAsOf, latest, category: opts.category ?? null, categories, periods, rows, notes };
}
