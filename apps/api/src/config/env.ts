import { z } from 'zod';

// Bun loads apps/api/.env by itself; this keeps other tooling (drizzle-kit) working too. Real env vars win.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — fine in production */
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Unix socket to connect through instead of the URL's host — Cloud SQL on Cloud Run:
   *  /cloudsql/<project>:<region>:<instance>/.s.PGSQL.5432 (user, password and database still come from the URL). */
  DB_SOCKET_PATH: z.string().trim().optional(),

  // ── Database pool ──
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Server-side limit per SQL statement, so a runaway report query can't hold a connection forever (0 = off). */
  DB_STATEMENT_TIMEOUT_SEC: z.coerce.number().int().min(0).default(300),

  // ── Uploads ──
  /** Per-file limit in MB. On Cloud Run a whole request is capped at 32 MiB anyway. */
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  MAX_UPLOAD_FILES: z.coerce.number().int().min(1).max(100).default(50),
  /** Files parsed at the same time across uploads and GCS syncs (each parse can take several hundred MB). */
  INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),

  // ── Rate limits (per signed-in user; in memory — the API runs as a single instance) ──
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_UPLOADS_PER_10MIN: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_SYNC_PER_10MIN: z.coerce.number().int().min(1).default(20),

  // ── GCS warehouse (read-only) ──
  /** Bucket holding `<brand>/<marketplace>/<report folder>/<file>.csv`. */
  GCS_BUCKET: z.string().trim().default('rb2f-warehouse-dropzone'),
  /** Path to a service-account JSON key with read access to the bucket (local development). */
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
  /** Brand syncs allowed to run at the same time. */
  SYNC_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(2),
  /** After a sync of a brand finishes, "Sync now" for that brand is available again after this many seconds. */
  SYNC_COOLDOWN_SEC: z.coerce.number().int().min(0).default(120),
  /** "Re-ingest all" (re-processes every file) can run once per brand in this many minutes. */
  REINGEST_COOLDOWN_MIN: z.coerce.number().int().min(0).default(30),

  // ── Blinkit ──
  /** JSON object of extra category aliases, e.g. {"gift box":"Gift Hamper"}. */
  BK_CATEGORY_ALIASES: z.string().trim().optional(),
  /** JSON object of extra SKU aliases, e.g. {"farmers honey":"Harvest Honey"}. */
  BK_SKU_ALIASES: z.string().trim().optional(),
  /** Days-of-cover bands: critical,low,excess (default 7,15,45). */
  BK_DOC_BANDS: z.string().trim().optional(),

  /** `json` (one JSON object per line, read by Cloud Logging) or `pretty`. Defaults to json in production. */
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  gcsCredentialsFile: parsed.data.GCS_CREDENTIALS_FILE || parsed.data.GOOGLE_APPLICATION_CREDENTIALS || null,
  /** Cloud Run sets K_SERVICE (services) or CLOUD_RUN_JOB (jobs); there the attached service account is used. */
  onCloudRun: Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB),
  logJson: (parsed.data.LOG_FORMAT ?? (parsed.data.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json',
};
