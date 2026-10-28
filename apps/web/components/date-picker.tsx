'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DayPicker, type DateRange as RdpRange } from 'react-day-picker';

import { fmtDateLong } from '@/lib/format';

/* Dates stay ISO 'YYYY-MM-DD' strings everywhere else in the app; convert at the edge (local time). */
const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Button that opens a calendar below it; closes on outside click or Escape. */
function Popup({ label, open, setOpen, children }: {
  label: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="input input-sm w-auto cursor-pointer gap-2 text-ink">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-muted" aria-hidden>
          <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm10 6H4v8h12V8Z" />
        </svg>
        <span className="num whitespace-nowrap">{label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 rounded-box border border-line bg-base-100 p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

/** From → to range in one calendar: first click picks the start, second the end. */
export function DateRangePicker({ value, onChange, min, max }: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
  min?: string | null | undefined;
  max?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Date | null>(null);
  const selected: RdpRange = start ? { from: start, to: undefined } : { from: toDate(value.from), to: toDate(value.to) };
  const setOpenAndReset = (v: boolean) => {
    setOpen(v);
    setStart(null);
  };
  const pick = (day: Date) => {
    if (!start) return setStart(day);
    const [a, b] = start <= day ? [start, day] : [day, start];
    onChange({ from: toIso(a), to: toIso(b) });
    setOpenAndReset(false);
  };
  return (
    <Popup
      open={open}
      setOpen={setOpenAndReset}
      label={`${fmtDateLong(value.from)} → ${fmtDateLong(value.to)}`}
    >
      <DayPicker
        className="react-day-picker"
        mode="range"
        numberOfMonths={2}
        defaultMonth={toDate(value.from)}
        selected={selected}
        onSelect={(_r, day) => pick(day)}
        disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
        weekStartsOn={1}
      />
      <p className="px-2 pb-1 text-xs text-muted">{start ? 'Now pick the end date' : 'Pick a start date'}</p>
    </Popup>
  );
}

/** Single date. */
export function DatePicker({ value, onChange, max }: {
  value: string;
  onChange: (v: string) => void;
  max?: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popup open={open} setOpen={setOpen} label={value ? fmtDateLong(value) : 'Pick a date'}>
      <DayPicker
        className="react-day-picker"
        mode="single"
        required
        defaultMonth={value ? toDate(value) : undefined}
        selected={value ? toDate(value) : undefined}
        onSelect={(d) => {
          if (d) onChange(toIso(d));
          setOpen(false);
        }}
        disabled={max ? { after: toDate(max) } : undefined}
        weekStartsOn={1}
      />
    </Popup>
  );
}
