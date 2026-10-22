import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env — rely on the real environment */
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://dash:dash@localhost:5432/dash' },
  strict: true,
  verbose: true,
});
