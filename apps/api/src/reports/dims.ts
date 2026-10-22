import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';

/** Campaign join key used everywhere (matches campaignKeyOf in the mapper parser). */
export const ck = (col: string) => sql.raw(`lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`);

// ── Brand terms (rule book §6: stored as data, editable without a redeploy) ──

export async function getBrandTerms(profileId: string): Promise<string[]> {
  const [r] = await db.execute<{ brand_terms: string[] }>(
    sql`select brand_terms from profile_settings where profile_id = ${profileId}`
  );
  return (r?.brand_terms ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export async function setBrandTerms(profileId: string, terms: string[]): Promise<string[]> {
  const clean = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  await db.execute(sql`
    insert into profile_settings (profile_id, brand_terms, updated_at)
    values (${profileId}, ${JSON.stringify(clean)}::jsonb, now())
    on conflict (profile_id) do update set brand_terms = excluded.brand_terms, updated_at = now()`);
  return clean;
}

/** Postgres regex matching any brand term at a word start ("cult" matches "cultsport", not "difficult"). */
export function brandRegex(terms: string[]): string {
  if (!terms.length) return '';
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(^|[^a-z0-9])(${esc.join('|')})`;
}

/**
 * Search term → Branded / Competitor / Generic.
 *   Competitor = an ASIN-looking term (b0 + 8 chars) that is NOT in this
 *                brand's ASIN mapper (agreed rule, Oct 2026)
 *   Branded    = one of our own ASINs, or contains a brand term
 *   Generic    = everything else
 */
export function termClassSql(termCol: SQL, profileId: string, regex: string): SQL {
  return sql`case
    when ${termCol} ~* '^b0[a-z0-9]{8}$' then
      case when exists (
        select 1 from products p
        where p.profile_id = ${profileId} and p.asin = upper(${termCol})
          and (p.mapper_category is not null or p.mapper_title is not null or p.selling_price is not null)
      ) then 'Branded' else 'Competitor' end
    when ${regex} <> '' and ${termCol} ~* ${regex} then 'Branded'
    else 'Generic' end`;
}

/** `left join search_term_classes tc` for a search-term table aliased `alias`. */
export function termClassJoin(alias: string): SQL {
  return sql`left join search_term_classes tc on tc.profile_id = ${sql.raw(alias)}.profile_id and tc.search_term = ${sql.raw(alias)}.search_term`;
}

/** Rebuild the per-term Branded / Competitor / Generic lookup. */
export async function refreshTermClasses(profileId: string): Promise<void> {
  const regex = brandRegex(await getBrandTerms(profileId));
  const t = sql.raw('d');
  await db.execute(sql`delete from search_term_classes where profile_id = ${profileId}`);
  await db.execute(sql`
    insert into search_term_classes (profile_id, search_term, branding)
    select ${profileId}, d.search_term, ${termClassSql(sql`${t}.search_term`, profileId, regex)}
    from (select distinct search_term from daily_search_terms where profile_id = ${profileId}) d`);
}

/** Targeting expression → Keyword / Product / Category / Auto / Audience / Other. */
export function targetTypeSql(target: SQL, matchType: SQL, channel: SQL): SQL {
  return sql`case
    when ${target} in ('close-match', 'loose-match', 'substitutes', 'complements') or ${target} like 'keywords-related-to%' then 'Auto'
    when ${target} like 'asin="%' or ${target} like 'asin-expanded="%' or ${target} ~ '^b0[a-z0-9]{8}$' then 'Product'
    when ${target} like 'category=%' then 'Category'
    when ${channel} = 'sd' and (${target} ~ '^(views|purchases|audience|remarketing|similar|in-market|interest|lifestyle|contextual)') then 'Audience'
    when ${matchType} in ('EXACT', 'PHRASE', 'BROAD') or ${matchType} like '%BROAD%' then 'Keyword'
    -- GCS warehouse search terms carry no targeting columns: the RB campaign-name token (KT/PT/CT/Auto) is stored as match type.
    when ${matchType} = 'KT' then 'Keyword'
    when ${matchType} = 'PT' then 'Product'
    when ${matchType} = 'CT' then 'Category'
    when ${matchType} = 'AUTO' then 'Auto'
    else 'Other' end`;
}

/** Campaign-mapper "Targeting" codes → the same targeting types. */
const MAPPER_TARGETING = sql`case upper(btrim(coalesce(cm.targeting, '')))
    when 'KT' then 'Keyword' when 'KW' then 'Keyword' when 'KEYWORD' then 'Keyword'
    when 'PT' then 'Product' when 'PRODUCT' then 'Product' when 'ASIN' then 'Product'
    when 'CT' then 'Category' when 'CATEGORY' then 'Category'
    when 'AUTO' then 'Auto'
    when 'VR' then 'Audience' when 'PR' then 'Audience' when 'AUDIENCE' then 'Audience'
    else null end`;

/**
 * Rebuild campaign_dims for a profile. Run after every upload batch and after
 * brand-term changes. See the campaign_dims schema comment for each rule.
 */
export async function refreshCampaignDims(profileId: string): Promise<number> {
  const st = sql.raw('st');
  const rows = await db.execute<{ n: string }>(sql`
    with keys as (
      select ${ck('campaign_name')} as k, min(campaign_name) as name, min(channel) as channel from (
        select campaign_name, channel from daily_campaign_ads where profile_id = ${profileId}
        union all select campaign_name, channel from daily_asin_campaign_ads where profile_id = ${profileId}
        union all select campaign_name, channel from daily_search_terms where profile_id = ${profileId}
        union all select campaign_name, channel from daily_placements where profile_id = ${profileId}
        union all select campaign_name, channel from daily_hourly_ads where profile_id = ${profileId}
        union all select campaign_name, 'sb' from sb_attributed_daily where profile_id = ${profileId}
        union all select campaign_name, channel from campaign_attrs where profile_id = ${profileId}
        union all select campaign_name, null from campaign_mapper where profile_id = ${profileId}
      ) x group by 1
    ),
    attrs as (select campaign_key as k, channel, is_video from campaign_attrs where profile_id = ${profileId}),
    cat_w as (
      select k, cat, sum(w) as w from (
        select ${ck('a.campaign_name')} as k, p.mapper_category as cat, a.spend + a.ad_sales as w
        from daily_asin_campaign_ads a join products p on p.profile_id = a.profile_id and p.asin = a.asin
        where a.profile_id = ${profileId} and p.mapper_category is not null
        union all
        select ${ck('s.campaign_name')}, p.mapper_category, s.ad_sales
        from sb_attributed_daily s join products p on p.profile_id = s.profile_id and p.asin = s.asin
        where s.profile_id = ${profileId} and p.mapper_category is not null
      ) x group by k, cat
    ),
    cat_top as (select distinct on (k) k, cat from cat_w order by k, w desc, cat),
    st_w as (
      select ${ck('st.campaign_name')} as k,
             ${targetTypeSql(sql`${st}.target`, sql`${st}.match_type`, sql`${st}.channel`)} as tt,
             coalesce(tcl.branding, 'Generic') as tc,
             sum(st.spend) + 0.0001 * sum(st.impressions) as w
      from daily_search_terms st
      left join search_term_classes tcl on tcl.profile_id = st.profile_id and tcl.search_term = st.search_term
      where st.profile_id = ${profileId}
      group by 1, 2, 3
    ),
    tt_top as (select distinct on (k) k, tt from (select k, tt, sum(w) w from st_w group by k, tt) x order by k, w desc, tt),
    tc_any as (select distinct on (k) k, tc from (select k, tc, sum(w) w from st_w group by k, tc) x order by k, w desc, tc),
    tc_nb as (select distinct on (k) k, tc from (select k, tc, sum(w) w from st_w where tc <> 'Branded' group by k, tc) x order by k, w desc, tc),
    ins as (
      insert into campaign_dims (profile_id, campaign_key, campaign_name, channel, ad_type, category, category_source, targeting, branding)
      select ${profileId}, keys.k, keys.name,
        coalesce(attrs.channel, keys.channel),
        coalesce(
          case when upper(btrim(cm.type)) in ('SP', 'SB', 'SBV', 'SD', 'SDV') then upper(btrim(cm.type)) end,
          case coalesce(attrs.channel, keys.channel)
            when 'sp' then 'SP'
            when 'sb' then case when attrs.is_video or keys.name ~* '(^|[^a-z])(sbv|video)([^a-z]|$)' then 'SBV' else 'SB' end
            when 'sd' then case when attrs.is_video or keys.name ~* '(^|[^a-z])(sdv|video)([^a-z]|$)' then 'SDV' else 'SD' end
          end,
          case when keys.name ~* '/\\s*sbv\\s*/' then 'SBV' when keys.name ~* '/\\s*sb\\s*/' then 'SB'
               when keys.name ~* '/\\s*sdv?\\s*/' then 'SD' when keys.name ~* '/\\s*sp\\s*/' then 'SP' end,
          'Unknown'),
        coalesce(cm.category, cat_top.cat, 'Unmapped'),
        case when cm.category is not null then 'mapper' when cat_top.cat is not null then 'advertised' else 'none' end,
        coalesce(${MAPPER_TARGETING}, tt_top.tt,
          case when keys.name ~* '(^|[^a-z])auto([^a-z]|$)' then 'Auto'
               when keys.name ~* '/\\s*pt\\s*/' then 'Product' when keys.name ~* '/\\s*ct\\s*/' then 'Category'
               when keys.name ~* '/\\s*kt\\s*/' then 'Keyword' end,
          'Other'),
        case
          when cm.branded ~* '^branded$' then 'Branded'
          when cm.branded ~* 'non' then coalesce(tc_nb.tc, 'Generic')
          else coalesce(tc_any.tc, 'Generic')
        end
      from keys
      left join attrs on attrs.k = keys.k
      left join campaign_mapper cm on cm.profile_id = ${profileId} and cm.campaign_key = keys.k
      left join cat_top on cat_top.k = keys.k
      left join tt_top on tt_top.k = keys.k
      left join tc_any on tc_any.k = keys.k
      left join tc_nb on tc_nb.k = keys.k
      returning 1
    )
    select count(*) as n from ins`);
  return Number(rows[0]?.n ?? 0);
}

/** Wipe + rebuild in one transaction-less step (dims are derived, so a crash just means a re-run). */
export async function rebuildCampaignDims(profileId: string): Promise<number> {
  if (!(await getBrandTerms(profileId)).length) await seedBrandTerms(profileId);
  await refreshTermClasses(profileId);
  await db.execute(sql`delete from campaign_dims where profile_id = ${profileId}`);
  const n = await refreshCampaignDims(profileId);
  fresh.add(profileId);
  return n;
}

/**
 * Seed brand terms from the product titles when none are set (e.g. the ASIN
 * mapper was uploaded before brand terms existed): the most common first word
 * of titles, plus any other first word covering ≥ 15% of titles (max 3).
 * Never overwrites a list the user has saved.
 */
export async function seedBrandTerms(profileId: string): Promise<string[]> {
  const rows = await db.execute<{ w: string; n: string; total: string }>(sql`
    with t as (
      select lower(split_part(btrim(coalesce(mapper_title, report_title)), ' ', 1)) as w
      from products where profile_id = ${profileId} and coalesce(mapper_title, report_title) is not null
    )
    select w, count(*) as n, (select count(*) from t) as total from t
    where length(w) > 2 and w ~ '^[a-z][a-z0-9&-]*$'
    group by w order by count(*) desc limit 5`);
  const total = Number(rows[0]?.total ?? 0);
  const seed = rows.filter((r, i) => i === 0 || Number(r.n) >= 0.15 * total).slice(0, 3).map((r) => r.w);
  if (!seed.length) return [];
  await db.execute(sql`
    insert into profile_settings (profile_id, brand_terms) values (${profileId}, ${JSON.stringify(seed)}::jsonb)
    on conflict (profile_id) do update set brand_terms = excluded.brand_terms, updated_at = now()
    where profile_settings.brand_terms = '[]'::jsonb`);
  return getBrandTerms(profileId);
}

// ── Self-healing: build dims / term classes when they're missing ───────────

/** Profiles whose dims are known to be current in this process. */
const fresh = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();

/** Call after anything that changes the inputs of campaign_dims (uploads, brand terms). */
export function markDimsStale(profileId: string): void {
  fresh.delete(profileId);
}

/**
 * Make sure campaign_dims and search_term_classes exist and cover every
 * search term before a report reads them. Cheap after the first call per
 * process; rebuilds (~seconds) only when something is missing — e.g. data
 * uploaded before these tables existed, or a failed post-upload rebuild.
 * Returns an error message instead of throwing so reports still render.
 */
export function ensureDims(profileId: string): Promise<string | null> {
  if (fresh.has(profileId)) return Promise.resolve(null);
  const running = inflight.get(profileId);
  if (running) return running;
  const p = (async () => {
    try {
      const [r] = await db.execute<{ missing_terms: boolean; missing_dims: boolean; no_terms: boolean }>(sql`
        select
          exists (
            select 1 from daily_search_terms d
            where d.profile_id = ${profileId}
              and not exists (select 1 from search_term_classes tc where tc.profile_id = d.profile_id and tc.search_term = d.search_term)
          ) as missing_terms,
          (exists (select 1 from daily_campaign_ads where profile_id = ${profileId})
            or exists (select 1 from daily_asin_campaign_ads where profile_id = ${profileId})
            or exists (select 1 from daily_search_terms where profile_id = ${profileId}))
            and not exists (select 1 from campaign_dims where profile_id = ${profileId}) as missing_dims,
          coalesce((select brand_terms = '[]'::jsonb from profile_settings where profile_id = ${profileId}), true) as no_terms`);
      const seeded = r?.no_terms ? (await seedBrandTerms(profileId)).length > 0 : false;
      if (seeded || r?.missing_terms || r?.missing_dims) {
        const t0 = Date.now();
        const n = await rebuildCampaignDims(profileId);
        console.log(`[dims] rebuilt ${n} campaign(s) for "${profileId}" in ${Date.now() - t0} ms`);
      }
      fresh.add(profileId);
      return null;
    } catch (err) {
      console.error('[dims] rebuild failed', err);
      return err instanceof Error ? err.message : String(err);
    } finally {
      inflight.delete(profileId);
    }
  })();
  inflight.set(profileId, p);
  return p;
}
