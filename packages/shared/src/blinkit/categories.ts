import { normKey } from './geo';

/* The SKU mapper and the campaign mapper do not use the same category labels
   (SKU: "NPD-NCS", "Hamper", "Gift Box"; campaigns: "NCS", "Gift hamper").
   TACoS needs one taxonomy, so both sides go through this alias table.
   Override / extend per brand with the BK_CATEGORY_ALIASES env var
   (JSON: {"gift box":"Gift Hamper"}). */
export const DEFAULT_CATEGORY_ALIASES: Record<string, string> = {
  'npd pfb': 'PFB',
  'npd ncs': 'NCS',
  'nut choco spread': 'NCS',
  hamper: 'Gift Hamper',
  'gift hamper': 'Gift Hamper',
  'gift box': 'Gift Hamper',
  honey: 'Honey',
  jam: 'Jam',
  pfb: 'PFB',
  ncs: 'NCS',
  ketchup: 'Ketchup',
  branded: 'Branded',
};

export function makeCategoryNormaliser(extra: Record<string, string> = {}) {
  const table: Record<string, string> = { ...DEFAULT_CATEGORY_ALIASES };
  for (const [k, v] of Object.entries(extra)) table[normKey(k)] = v;
  return (raw: unknown): string => {
    const s = String(raw ?? '').trim();
    if (!s) return 'Unmapped';
    return table[normKey(s)] ?? s.replace(/\s+/g, ' ');
  };
}

/** SKU labels differ slightly between mappers ("Farmer's Honey" vs "Harvest Honey",
    "Bluberry Jam"). Same idea as categories. */
export const DEFAULT_SKU_ALIASES: Record<string, string> = {
  'farmers honey': 'Harvest Honey',
  'bluberry jam': 'Blueberry Jam',
  'mixedberry & strawberry jam': 'Mixedberry & Strawberry Jam',
  'mxb & sb combo': 'Mixedberry & Strawberry Jam',
  'nut chocolate spread': 'Nut Choco Spread',
  ncs: 'Nut Choco Spread',
  'choco pfb': 'Protein Choco Bites',
  'tomato ketchup': 'Ketchup',
  'gift hamper': 'Gift Box',
  'gift box': 'Gift Box',
};
export function makeSkuNormaliser(extra: Record<string, string> = {}) {
  const table: Record<string, string> = { ...DEFAULT_SKU_ALIASES };
  for (const [k, v] of Object.entries(extra)) table[normKey(k)] = v;
  return (raw: unknown): string => {
    const s = String(raw ?? '').trim();
    if (!s) return 'Unmapped';
    return table[normKey(s)] ?? s.replace(/\s+/g, ' ');
  };
}
