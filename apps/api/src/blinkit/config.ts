import { env } from '../config/env';

/** Blinkit settings derived from apps/api/.env (see .env.example). */
function jsonMap(raw: string | undefined, name: string): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
  } catch {
    /* fall through */
  }
  console.warn(`[blinkit] ${name} is not a JSON object — ignored`);
  return {};
}

const [critical = 7, low = 15, excess = 45] = (env.BK_DOC_BANDS ?? '7,15,45').split(',').map((s) => Number(s.trim()));

export const bkConfig = {
  /** Folder under each brand in the GCS bucket that holds Blinkit exports. */
  gcsFolder: env.GCS_BLINKIT_FOLDER,
  categoryAliases: jsonMap(env.BK_CATEGORY_ALIASES, 'BK_CATEGORY_ALIASES'),
  skuAliases: jsonMap(env.BK_SKU_ALIASES, 'BK_SKU_ALIASES'),
  docBands: { critical, low, excess },
};
