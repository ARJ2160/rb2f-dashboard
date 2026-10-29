import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../config/env';

// apps/api/drizzle, next to src/.
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
if (!existsSync(path.join(migrationsFolder, 'meta', '_journal.json'))) {
  console.error(`No drizzle migrations at ${migrationsFolder}. Run \`bun run db:generate\` first.`);
  process.exit(1);
}

// One connection and no statement timeout: a migration may rebuild an index on a large table.
const sql = postgres(env.DATABASE_URL, {
  ...(env.DB_SOCKET_PATH ? { path: env.DB_SOCKET_PATH } : {}),
  max: 1,
  onnotice: () => {},
});
const LOCK_ID = 7_202_610; // any constant — keeps two deploys from migrating at the same time

try {
  await sql`select pg_advisory_lock(${LOCK_ID})`;
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('Migrations applied from', migrationsFolder);
} finally {
  await sql`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
  await sql.end();
}
