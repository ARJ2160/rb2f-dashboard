'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { DateRangePicker } from '@/components/date-picker';
import { isoAddDays } from '@/lib/format';

import { Icon, type IconName } from './icons';

/* Shared frame for the Amazon and Blinkit dashboards: a left sidebar with the
   report tabs (collapsible, remembered per browser), a filter bar on top and
   the active report below. On narrow screens the sidebar becomes a scrolling
   strip of tabs. */

export interface ShellTab<T extends string> {
  id: T;
  label: string;
  hint: string;
  icon: IconName;
}

export type MarketplaceId = 'amazon' | 'blinkit';

const MARK: Record<MarketplaceId, { letter: string; className: string; label: string }> = {
  amazon: { letter: 'a', className: 'bg-[#232f3e] text-white', label: 'Amazon' },
  blinkit: { letter: 'b', className: 'bg-[#f8cb46] text-[#14171c]', label: 'Blinkit' },
};

const COLLAPSE_KEY = 'dash.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function DashboardShell<T extends string>({
  marketplace,
  title,
  subtitle,
  tabs,
  tab,
  onTab,
  toolbar,
  sideCard,
  heading = true,
  children,
}: {
  marketplace: MarketplaceId;
  title: string;
  subtitle?: ReactNode;
  tabs: Array<ShellTab<T>>;
  tab: T;
  onTab: (t: T) => void;
  /** Filters for the active tab (period, category, …) */
  toolbar?: ReactNode;
  /** Small card pinned to the bottom of the sidebar (data coverage). */
  sideCard?: ReactNode;
  /** Show the tab name + description above the report (off for the Overview, which has its own). */
  heading?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed()), []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* private window — just don't remember it */
    }
  };
  const mark = MARK[marketplace];
  const active = tabs.find((t) => t.id === tab);

  return (
    <div className="flex min-h-[75vh] overflow-hidden rounded-2xl border border-line bg-surface">
      <aside
        className={`hidden shrink-0 flex-col border-r border-line bg-side transition-[width] duration-200 lg:flex ${collapsed ? 'w-[68px]' : 'w-60'}`}
      >
        <div className={`flex items-center gap-2.5 px-3 pb-3 pt-4 ${collapsed ? 'flex-col' : ''}`}>
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-lg text-base font-bold ${mark.className}`}
            aria-hidden
          >
            {mark.letter}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[17px] font-semibold capitalize tracking-tight">{title}</div>
              <div className="truncate text-xs text-muted">{mark.label} dashboard</div>
            </div>
          )}
          <button
            onClick={toggle}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-black/5 hover:text-ink"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="collapse" />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 pb-4" aria-label={`${mark.label} reports`}>
          {tabs.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                title={collapsed ? `${t.label} — ${t.hint}` : t.hint}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[14.5px] transition-colors ${
                  collapsed ? 'justify-center px-0' : ''
                } ${on ? 'bg-side-active font-medium text-ink' : 'text-ink/75 hover:bg-black/[0.04] hover:text-ink'}`}
              >
                <Icon name={t.icon} className="size-[19px] shrink-0" />
                {!collapsed && <span className="truncate">{t.label}</span>}
              </button>
            );
          })}
        </nav>

        {!collapsed && sideCard && <div className="mt-auto border-t border-line p-3">{sideCard}</div>}
      </aside>

      <div className="min-w-0 flex-1">
        {/* narrow screens: tabs as a scrolling strip */}
        <div className="flex items-center gap-2 border-b border-line px-4 pt-3 lg:hidden">
          <span className={`grid size-7 shrink-0 place-items-center rounded-md text-sm font-bold ${mark.className}`} aria-hidden>
            {mark.letter}
          </span>
          <span className="truncate text-sm font-semibold capitalize">{title}</span>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => onTab(t.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${t.id === tab ? 'bg-ink text-white' : 'text-ink/75 hover:bg-black/5'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-5 px-4 py-5 sm:px-7">
          {(toolbar || subtitle) && (
            <div className="flex flex-wrap items-center gap-2.5">
              {toolbar}
              {subtitle && <span className="ml-auto text-xs text-muted">{subtitle}</span>}
            </div>
          )}
          {heading && (
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">{active?.label}</h2>
              <p className="mt-0.5 text-[15px] text-muted">{active?.hint}</p>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Green "data coverage" card at the foot of the sidebar. */
export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#bfe8cf] bg-[#effaf3] p-3 text-xs leading-relaxed text-ink/80">
      <span className="mb-1.5 inline-block rounded bg-[#127a46] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        {title}
      </span>
      {children}
    </div>
  );
}

// ── Period presets (relative to the latest day that has data) ─────────────

export type PresetId = 'l7' | 'week' | 'l14' | 'l30' | 'mtd' | 'lm' | 'custom';

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'l7', label: 'Last 7 days' },
  { id: 'week', label: 'This week' },
  { id: 'l14', label: 'Last 14 days' },
  { id: 'l30', label: 'Last 30 days' },
  { id: 'mtd', label: 'This month' },
  { id: 'lm', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

export function presetRange(id: Exclude<PresetId, 'custom'>, latest: string, earliest?: string | null) {
  const clip = (from: string) => (earliest && from < earliest ? earliest : from);
  const d = new Date(`${latest}T00:00:00Z`);
  switch (id) {
    case 'l7':
      return { from: clip(isoAddDays(latest, -6)), to: latest };
    case 'l14':
      return { from: clip(isoAddDays(latest, -13)), to: latest };
    case 'l30':
      return { from: clip(isoAddDays(latest, -29)), to: latest };
    case 'week': {
      const back = (d.getUTCDay() + 6) % 7; // Monday start
      return { from: clip(isoAddDays(latest, -back)), to: latest };
    }
    case 'mtd':
      return { from: clip(`${latest.slice(0, 8)}01`), to: latest };
    case 'lm': {
      const firstThis = `${latest.slice(0, 8)}01`;
      const end = isoAddDays(firstThis, -1);
      return { from: clip(`${end.slice(0, 8)}01`), to: end };
    }
  }
}

/** Which preset (if any) a range corresponds to. */
export function presetOf(r: { from: string; to: string }, latest: string, earliest?: string | null): PresetId {
  for (const p of PRESETS) {
    if (p.id === 'custom') continue;
    const x = presetRange(p.id, latest, earliest);
    if (x.from === r.from && x.to === r.to) return p.id;
  }
  return 'custom';
}

/** "Last 7 days ▾" + the date range, like the Brand Central header. */
export function PeriodPicker({ value, onChange, latest, earliest }: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
  latest: string;
  earliest?: string | null;
}) {
  const preset = presetOf(value, latest, earliest);
  return (
    <>
      <FieldSelect
        label="Period"
        value={preset}
        onChange={(v) => v !== 'custom' && onChange(presetRange(v as Exclude<PresetId, 'custom'>, latest, earliest))}
        options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
      />
      <DateRangePicker value={value} onChange={onChange} />
    </>
  );
}

/** Bordered select with its label inside the box. */
export function FieldSelect({ label, value, onChange, options, allLabel = null }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  allLabel?: string | null;
}) {
  return (
    <label className="field cursor-pointer">
      <span className="text-xs text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-56 cursor-pointer bg-transparent pr-1 font-medium text-ink outline-none">
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          return (
            <option key={v} value={v}>
              {typeof o === 'string' ? o : o.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}
