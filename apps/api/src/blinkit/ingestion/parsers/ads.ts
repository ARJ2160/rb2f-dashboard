import type { SheetData } from '../sheet-grid';
import { col } from '../sheet-grid';
import { idStr, inferDateOrder, num, str, toISODate } from '../clean';
import type { ParseResult } from './types';

export type AdType = 'PL' | 'PR' | 'BL';

export interface AdRow {
  date: string; adType: AdType; campaignId: string; campaignName: string;
  targetingType: string; targetingValue: string; matchType: string;
  impressions: number; directAtc: number; indirectAtc: number; directQty: number; indirectQty: number;
  directSales: number; indirectSales: number; newUsers: number; spend: number;
  mvpWeighted: number; mvpImpr: number; reach: number; uniqueClicks: number;
}

const ADDITIVE: (keyof AdRow)[] = ['impressions', 'directAtc', 'indirectAtc', 'directQty', 'indirectQty', 'directSales',
  'indirectSales', 'newUsers', 'spend', 'mvpWeighted', 'mvpImpr', 'reach', 'uniqueClicks'];

/** PRODUCT_LISTING / PRODUCT_RECOMMENDATION / BANNER_LISTING → one shape.
    Ad Sales = Direct + Indirect; Spend = Estimated Budget Consumed.
    Most Viewed Position is impression-weighted so it can be re-averaged. */
export function parseAds(s: SheetData, adType: AdType): ParseResult<AdRow> {
  const H = s.headers;
  const c = {
    date: col(H, 'date'), id: col(H, 'campaign id'), name: col(H, 'campaign name'),
    tt: col(H, 'targeting type'), tv: col(H, 'targeting value'), mt: col(H, 'match type'),
    mvp: col(H, 'most viewed position'), impr: col(H, 'impressions'),
    datc: col(H, 'direct atc'), iatc: col(H, 'indirect atc'),
    dq: col(H, 'direct quantities sold'), iq: col(H, 'indirect quantities sold'),
    ds: col(H, 'direct sales'), is: col(H, 'indirect sales'), nu: col(H, 'new users acquired'),
    spend: col(H, 'estimated budget consumed'), reach: col(H, 'reach'), uc: col(H, 'unique clicks'),
  };
  const v = (r: unknown[], i: number) => (i >= 0 ? num(r[i]) : 0);
  const order = inferDateOrder(s.rows.map((r) => r[c.date]), s.fileName);
  const agg = new Map<string, AdRow>();
  let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(r[c.date], order);
    const campaignId = idStr(r[c.id]);
    if (!date || !campaignId) { bad++; continue; }
    const impr = v(r, c.impr);
    const pos = v(r, c.mvp);
    const row: AdRow = {
      date, adType, campaignId, campaignName: str(r[c.name]),
      targetingType: c.tt >= 0 ? str(r[c.tt]) : '', targetingValue: c.tv >= 0 ? str(r[c.tv]).toLowerCase() : '',
      matchType: c.mt >= 0 ? str(r[c.mt]) : '',
      impressions: impr, directAtc: v(r, c.datc), indirectAtc: v(r, c.iatc), directQty: v(r, c.dq), indirectQty: v(r, c.iq),
      directSales: v(r, c.ds), indirectSales: v(r, c.is), newUsers: v(r, c.nu), spend: v(r, c.spend),
      mvpWeighted: pos > 0 ? pos * impr : 0, mvpImpr: pos > 0 ? impr : 0,
      reach: v(r, c.reach), uniqueClicks: v(r, c.uc),
    };
    const key = [date, campaignId, row.targetingType, row.targetingValue, row.matchType].join('\u0001');
    const prev = agg.get(key);
    if (!prev) agg.set(key, row);
    else for (const k of ADDITIVE) (prev[k] as number) += row[k] as number;
  }
  const records = [...agg.values()];
  return {
    records, dates: [...new Set(records.map((x) => x.date))].sort(), rowsRead: s.rows.length,
    warnings: bad ? [`${bad} rows without a valid Date / Campaign ID were skipped`] : [],
  };
}
