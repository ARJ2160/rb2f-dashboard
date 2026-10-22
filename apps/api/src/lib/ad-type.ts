/** "SBV", "SDV" or "video" as a token in a campaign / ad-group name marks a video campaign. */
export function looksVideo(...names: Array<string | null | undefined>): boolean {
  return names.some((n) => !!n && /(^|[^a-z])(sbv|sdv|video|vid)([^a-z]|$)/i.test(n));
}

export interface CampaignAttr {
  campaignName: string;
  channel: 'sp' | 'sb' | 'sd';
  isVideo: boolean;
}

/** Merge per-row signals into one attr per campaign (video if any row says so). */
export function collectAttrs(rows: CampaignAttr[]): CampaignAttr[] {
  const m = new Map<string, CampaignAttr>();
  for (const r of rows) {
    const prev = m.get(r.campaignName);
    m.set(r.campaignName, prev ? { ...prev, isVideo: prev.isVideo || r.isVideo } : r);
  }
  return [...m.values()];
}
