import { pick, str, type Row } from '../../lib/values';
import type { ParseResult } from './types';

export interface CampaignMapperRecord {
  campaignKey: string;
  campaignName: string;
  category: string | null;
  type: string | null;
  targeting: string | null;
  branded: string | null;
  autoManual: string | null;
}

/** Join key shared with every campaign-level report (case/space-insensitive). */
export const campaignKeyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

const JUNK = /^(#n\/a|n\/a|na|-|—)$/i;
const clean = (v: unknown) => {
  const s = str(v);
  return s && !JUNK.test(s) ? s : null;
};

/**
 * Campaign Name → Category / Type / Targeting / Branded (rule book §3).
 * Sheets often list a campaign more than once with partly-filled rows; the
 * first non-empty value of each field wins.
 */
export function parseCampaignMapper(rows: Row[]): ParseResult<CampaignMapperRecord> {
  const warnings: string[] = [];
  const seen = new Map<string, CampaignMapperRecord>();
  for (const r of rows) {
    const campaignName = str(pick(r, ['Campaign Name', 'Campaign name', 'Campaigns', 'Campaign']));
    if (!campaignName) continue;
    const key = campaignKeyOf(campaignName);
    const rec: CampaignMapperRecord = {
      campaignKey: key,
      campaignName,
      category: clean(pick(r, ['Category'])),
      type: clean(pick(r, ['Type', 'Ad Type', 'Channel'])),
      targeting: clean(pick(r, ['Targeting', 'Targeting Type'])),
      branded: clean(pick(r, ['Branded/Non-Branded', 'Branded / Non-Branded', 'Branded', 'Brand Type'])),
      autoManual: clean(pick(r, ['Auto/Manual', 'Auto / Manual'])),
    };
    const prev = seen.get(key);
    seen.set(
      key,
      prev
        ? {
            ...prev,
            category: prev.category ?? rec.category,
            type: prev.type ?? rec.type,
            targeting: prev.targeting ?? rec.targeting,
            branded: prev.branded ?? rec.branded,
            autoManual: prev.autoManual ?? rec.autoManual,
          }
        : rec
    );
  }
  const records = [...seen.values()];
  const noCat = records.filter((r) => !r.category).length;
  if (noCat === records.length && records.length) {
    warnings.push('No "Category" column — campaign-level views (Search Terms, Placements) will show every campaign as "Unmapped"; Type / Branded filters still work.');
  } else if (noCat) {
    warnings.push(`${noCat} campaign(s) have no Category — they show as "Unmapped".`);
  }
  if (!records.length) return { records, rowsRead: rows.length, warnings, error: 'No campaign names found.' };
  return { records, rowsRead: rows.length, warnings };
}
