/* Small stroke icons for the dashboard sidebar (20px, currentColor). */

const P = {
  overview: 'M3 10.5 10 4l7 6.5M5 9v7h4v-4h2v4h4V9',
  mom: 'M3 15l4-5 3 3 4-6 3 4M3 17h14',
  dsr: 'M4 3h12v14H4zM7 7h6M7 10h6M7 13h4',
  dur: 'M3 4h14v12H3zM3 8h14M8 4v12M13 4v12',
  category: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
  ads: 'M4 8v4h2l5 3V5L6 8H4zM14 7.5a3 3 0 0 1 0 5M16 5.5a6 6 0 0 1 0 9',
  search: 'M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM12.6 12.6 16 16',
  harvest: 'M10 16V9M10 9c0-3 2-5 5-5 0 3-2 5-5 5zM10 11c0-2.5-1.7-4-4-4 0 2.5 1.7 4 4 4zM6 16h8',
  sqp: 'M4 16V9M8 16V5M12 16v-6M16 16V7',
  placement: 'M3 4h14v4H3zM3 10h6v6H3zM11 10h6v6h-6z',
  map: 'M10 17s-5-4.6-5-8.5A5 5 0 0 1 15 8.5C15 12.4 10 17 10 17zM10 6.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  hourly: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6v4l3 2',
  keywords: 'M4 6h12M4 10h8M4 14h10',
  inventory: 'M3 7 10 3l7 4v7l-7 4-7-4zM3 7l7 4 7-4M10 11v7',
  collapse: 'M3 4h14v12H3zM8 4v12',
  info: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 9v4.5M10 6.5v.01',
  download: 'M10 3v9M6 8.5l4 4 4-4M4 16h12',
  chevronL: 'M12 5l-5 5 5 5',
  chevronR: 'M8 5l5 5-5 5',
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={P[name]} />
    </svg>
  );
}
