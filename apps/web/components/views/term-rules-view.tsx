'use client';

import type { TermActionGrain, TermRule, TermRulesResponse } from '@dash/shared';
import { useEffect, useMemo, useState } from 'react';

import { getTermRules } from '@/lib/api';
import { fmtInt } from '@/lib/format';

import { ActionTable, RuleBuilder, activeRules, defaultUiRules, type UiRule } from './action-shared';
import { AdFilterBar, EMPTY_AD_FILTERS, ViewShell, type AdFilterState } from './shared';

/**
 * Dynamic rule page: the advertiser combines up to four metric conditions and
 * every search term (grain "term") or target (grain "target") matching all of
 * them is listed. With no active rule the full data set is shown. Shared by the
 * Search Term Rules page and the Targeting "Rules" tab.
 */
export function TermRulesView({
  profileId,
  from,
  to,
  grain = 'term',
}: {
  profileId: string;
  from: string;
  to: string;
  grain?: TermActionGrain;
}) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [rules, setRules] = useState<UiRule[]>(defaultUiRules);
  const [applied, setApplied] = useState<TermRule[]>([]);
  const [data, setData] = useState<TermRulesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const active = useMemo(() => activeRules(rules), [rules]);

  // Debounce so typing a threshold doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setApplied(active), 400);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getTermRules(profileId, from, to, grain, applied, { ...filters })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, from, to, grain, applied, filters]);

  const noun = grain === 'term' ? 'search terms' : 'targets';

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={<AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />}
    >
      <RuleBuilder rules={rules} onChange={setRules} />
      {data && (
        <>
          <div className="text-sm text-muted">
            {applied.length === 0 ? 'All' : 'Matching'} {noun}: <span className="font-semibold text-ink">{fmtInt(data.totalMatched)}</span>
          </div>
          <ActionTable
            rows={data.rows}
            keyLabel={grain === 'term' ? 'Search term' : 'Target'}
            grain={grain}
            emptyText={`No ${noun} ${applied.length === 0 ? 'in this range and filters' : 'match all the rules'}.`}
          />
        </>
      )}
    </ViewShell>
  );
}
