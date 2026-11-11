'use client';

import type { NegationsResponse, TermActionRow } from '@dash/shared';
import { useEffect, useState } from 'react';

import { getNegations } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';

import { ActionTable } from './action-shared';
import { AdFilterBar, EMPTY_AD_FILTERS, ViewShell, type AdFilterState } from './shared';

function ReasonBadge({ r }: { r: TermActionRow }) {
  return r.reason === 'zero-orders' ? (
    <span className="badge badge-sm badge-soft badge-warning whitespace-nowrap">0 orders</span>
  ) : (
    <span className="badge badge-sm badge-soft badge-error whitespace-nowrap">High ACoS</span>
  );
}

/** Small labelled number input for a threshold. */
function NumField({ label, value, onChange, step = '1' }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="field">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 bg-transparent font-medium text-ink outline-none"
      />
    </label>
  );
}

/**
 * Search-term negations: terms that spend without converting — 0 orders with
 * more than N clicks, or ACoS above a multiple of the account ACoS with few orders.
 */
export function NegationsView({ profileId, from, to }: { profileId: string; from: string; to: string }) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [minClicks, setMinClicks] = useState('20');
  const [acosMultiple, setAcosMultiple] = useState('2.5');
  const [maxOrders, setMaxOrders] = useState('3');
  const [data, setData] = useState<NegationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getNegations(profileId, from, to, { ...filters, minClicks, acosMultiple, maxOrders })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, from, to, filters, minClicks, acosMultiple, maxOrders]);

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
          <NumField label="Min clicks (0 orders)" value={minClicks} onChange={setMinClicks} />
          <NumField label="ACoS ×" value={acosMultiple} onChange={setAcosMultiple} step="0.1" />
          <NumField label="Max orders" value={maxOrders} onChange={setMaxOrders} />
        </>
      }
    >
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted">
              Account ACoS: <span className="font-semibold text-ink">{fmtPct(data.accountAcosPct)}</span>
            </span>
            <span className="text-muted">
              Flagged terms: <span className="font-semibold text-ink">{fmtInt(data.totalMatched)}</span>
            </span>
          </div>
          <ActionTable
            rows={data.rows}
            keyLabel="Search term"
            grain="term"
            emptyText="No search terms match the negation rules for this range and filters."
            leading={{ label: 'Flag', render: (r) => <ReasonBadge r={r} /> }}
          />
        </>
      )}
    </ViewShell>
  );
}
