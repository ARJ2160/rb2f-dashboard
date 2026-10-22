import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { db, sqlClient } from './client';

// Resolves to apps/api/drizzle both from src/db (tsx) and dist (built).
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')];
const { existsSync } = await import('node:fs');
const migrationsFolder = candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json')));

if (!migrationsFolder) {
  console.error('Could not find the drizzle migrations folder. Run `npm run db:generate` first.');
  process.exit(1);
}

await migrate(db, { migrationsFolder });
console.log('Migrations applied from', migrationsFolder);
await sqlClient.end();
