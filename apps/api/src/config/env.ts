import { z } from 'zod';

// Load apps/api/.env when present (Node ≥ 20.12). Real env vars win.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — fine in production */
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),

  // ── GCS warehouse (read-only) ──
  /** Bucket holding `<brand>/<marketplace>/<report folder>/<file>.csv`. */
  GCS_BUCKET: z.string().trim().default('rb2f-warehouse-dropzone'),
  /** Path to a service-account JSON key with read access to the bucket. */
  GCS_CREDENTIALS_FILE: z.string().trim().optional(),
  /** Standard Google variable — used when GCS_CREDENTIALS_FILE is not set. */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().optional(),
  /** Marketplace folder under each brand that is synced. */
  GCS_MARKETPLACE_FOLDER: z.string().trim().default('amazon'),
  /** Blinkit folder under each brand (`<brand>/blinkit/…`), synced from the GCS page's Blinkit view. */
  GCS_BLINKIT_FOLDER: z.string().trim().default('blinkit'),
  /** Re-sync every brand every N minutes (0 = only when "Sync" is clicked). */
  GCS_SYNC_INTERVAL_MIN: z.coerce.number().min(0).default(0),
  /** Files larger than this are skipped. */
  GCS_MAX_FILE_MB: z.coerce.number().positive().default(200),

  // ── Blinkit ──
  /** JSON object of extra category aliases, e.g. {"gift box":"Gift Hamper"}. */
  BK_CATEGORY_ALIASES: z.string().trim().optional(),
  /** JSON object of extra SKU aliases, e.g. {"farmers honey":"Harvest Honey"}. */
  BK_SKU_ALIASES: z.string().trim().optional(),
  /** Days-of-cover bands: critical,low,excess (default 7,15,45). */
  BK_DOC_BANDS: z.string().trim().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  gcsCredentialsFile: parsed.data.GCS_CREDENTIALS_FILE || parsed.data.GOOGLE_APPLICATION_CREDENTIALS || null,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
