/**
 * Normalise Indian state / UT names to one canonical spelling (ported from the
 * eigen order-report parser). Handles abbreviations (MH, HR…), casing
 * ("WEST BENGAL"), and old names (Orissa, Pondicherry…). Unknown values are
 * title-cased and kept, never dropped.
 */
const MAP: Record<string, string> = {
  ap: 'Andhra Pradesh', ar: 'Arunachal Pradesh', as: 'Assam', br: 'Bihar', cg: 'Chhattisgarh', ct: 'Chhattisgarh',
  ga: 'Goa', gj: 'Gujarat', hr: 'Haryana', hp: 'Himachal Pradesh', jh: 'Jharkhand', ka: 'Karnataka', kl: 'Kerala',
  mp: 'Madhya Pradesh', mh: 'Maharashtra', mn: 'Manipur', ml: 'Meghalaya', mz: 'Mizoram', nl: 'Nagaland',
  od: 'Odisha', or: 'Odisha', pb: 'Punjab', rj: 'Rajasthan', sk: 'Sikkim', tn: 'Tamil Nadu', tg: 'Telangana',
  ts: 'Telangana', tr: 'Tripura', up: 'Uttar Pradesh', uk: 'Uttarakhand', ua: 'Uttarakhand', wb: 'West Bengal',
  an: 'Andaman and Nicobar Islands', ch: 'Chandigarh', dn: 'Dadra and Nagar Haveli and Daman and Diu',
  dd: 'Dadra and Nagar Haveli and Daman and Diu', dl: 'Delhi', jk: 'Jammu and Kashmir', la: 'Ladakh',
  ld: 'Lakshadweep', py: 'Puducherry',
  pondicherry: 'Puducherry', puducherry: 'Puducherry', 'new delhi': 'Delhi', delhi: 'Delhi', 'nct of delhi': 'Delhi',
  orissa: 'Odisha', odisha: 'Odisha', uttaranchal: 'Uttarakhand', uttarakhand: 'Uttarakhand',
  'jammu & kashmir': 'Jammu and Kashmir', 'jammu and kashmir': 'Jammu and Kashmir',
  'tamil nadu': 'Tamil Nadu', tamilnadu: 'Tamil Nadu', telangana: 'Telangana', chattisgarh: 'Chhattisgarh',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands', 'andaman and nicobar islands': 'Andaman and Nicobar Islands',
  'andaman & nicobar': 'Andaman and Nicobar Islands',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
};

const CANONICAL = [...new Set(Object.values(MAP))];
const CANON_KEYS = new Map(CANONICAL.map((c) => [c.toLowerCase().replace(/[^a-z]/g, ''), c]));

/** Levenshtein distance, early-exit above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export function normalizeIndianState(raw: unknown): string {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return 'Unknown';
  const key = s.toLowerCase().replace(/\s+/g, ' ').replace(/[.]/g, '').trim();
  if (MAP[key]) return MAP[key]!;
  // "UTTARPRADESH", "Tamil-Nadu": compare letters only.
  const letters = key.replace(/[^a-z]/g, '');
  if (CANON_KEYS.has(letters)) return CANON_KEYS.get(letters)!;
  // Districts of Delhi ("South Delhi", "North West Delhi").
  if (/\bdelhi$/.test(key)) return 'Delhi';
  // Typos ("MAHARASHATRA", "TELENGANA"): nearest canonical name within 2 edits.
  if (letters.length >= 6) {
    let best: string | null = null;
    let bestD = 3;
    for (const [k, name] of CANON_KEYS) {
      const d = editDistance(letters, k, 2);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    if (best) return best;
  }
  return key
    .split(' ')
    .map((w) => (w === 'and' || w === 'of' ? w : w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
