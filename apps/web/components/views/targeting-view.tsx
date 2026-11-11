'use client';

import type { BidActionsResponse } from '@dash/shared';
import { useEffect, useState } from 'react';

import { getBidActions } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';

import { ActionTable } from './action-shared';
import { TermRulesView } from './term-rules-view';
import { AdFilterBar, EMPTY_AD_FILTERS, ViewShell, type AdFilterState } from './shared';

type SubTab = 'rules' | 'reduce' | 'scaleup';
const SUBTABS: Array<{ id: SubTab; label: string }> = [
  { id: 'rules', label: 'Rules' },
  { id: 'reduce', label: 'Bid reduction' },
  { id: 'scaleup', label: 'Bid scale up' },
];

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

/** Bid reduction / scale-up panel — editable preset thresholds, target-level table. Needs a range > 3 days. */
function BidPanel({ profileId, from, to, mode }: { profileId: string; from: string; to: string; mode: 'reduce' | 'scaleup' }) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [reduceAcos, setReduceAcos] = useState('1.5');
  const [reduceClicks, setReduceClicks] = useState('10');
  const [scaleAcos, setScaleAcos] = useState('0.6');
  const [scaleOrders, setScaleOrders] = useState('2');
  const [data, setData] = useState<BidActionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getBidActions(profileId, from, to, {
      ...filters,
      reduceAcosMultiple: reduceAcos,
      reduceMinClicks: reduceClicks,
      scaleAcosMultiple: scaleAcos,
      scaleMinOrders: scaleOrders,
    })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, from, to, filters, reduceAcos, reduceClicks, scaleAcos, scaleOrders]);

  const group = mode === 'reduce' ? data?.reduce : data?.scaleUp;

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
          {mode === 'reduce' ? (
            <>
              <NumField label="ACoS ≥ account ×" value={reduceAcos} onChange={setReduceAcos} step="0.1" />
              <NumField label="Min clicks" value={reduceClicks} onChange={setReduceClicks} />
            </>
          ) : (
            <>
              <NumField label="ACoS ≤ account ×" value={scaleAcos} onChange={setScaleAcos} step="0.1" />
              <NumField label="Min orders" value={scaleOrders} onChange={setScaleOrders} />
            </>
          )}
        </>
      }
    >
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted">
              Account ACoS: <span className="font-semibold text-ink">{fmtPct(data.accountAcosPct)}</span>
            </span>
            {group && (
              <span className="text-muted">
                {mode === 'reduce' ? 'Targets to reduce' : 'Targets to scale up'}:{' '}
                <span className="font-semibold text-ink">{fmtInt(group.totalMatched)}</span>
              </span>
            )}
          </div>
          <ActionTable
            rows={group?.rows ?? []}
            keyLabel="Target"
            grain="target"
            emptyText={
              data.rangeOk
                ? `No targets qualify for ${mode === 'reduce' ? 'a bid reduction' : 'a bid scale-up'} in this range and filters.`
                : 'Pick a time frame longer than 3 days to see bid moves.'
            }
          />
        </>
      )}
    </ViewShell>
  );
}

/** Targeting optimisation: a dynamic Rules tab plus preset bid-reduction / scale-up tabs, all at target level. */
export function TargetingView({ profileId, from, to }: { profileId: string; from: string; to: string }) {
  const [sub, setSub] = useState<SubTab>('rules');
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            onClick={() => setSub(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${sub === t.id ? 'bg-ink font-medium text-white' : 'text-ink/75 hover:bg-black/5'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'rules' && <TermRulesView profileId={profileId} from={from} to={to} grain="target" />}
      {sub === 'reduce' && <BidPanel profileId={profileId} from={from} to={to} mode="reduce" />}
      {sub === 'scaleup' && <BidPanel profileId={profileId} from={from} to={to} mode="scaleup" />}
    </div>
  );
}
