import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env';
import * as schema from './schema';

export const sqlClient = postgres(env.DATABASE_URL, {
  ...(env.DB_SOCKET_PATH ? { path: env.DB_SOCKET_PATH } : {}),
  max: env.DB_POOL_MAX,
  idle_timeout: 60, // seconds — close idle connections
  max_lifetime: 30 * 60, // seconds — recycle connections every 30 min
  connect_timeout: 10, // seconds
  connection: {
    application_name: 'amz-dash-api',
    ...(env.DB_STATEMENT_TIMEOUT_SEC ? { statement_timeout: env.DB_STATEMENT_TIMEOUT_SEC * 1000 } : {}), // ms
  },
  onnotice: () => {},
});
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
