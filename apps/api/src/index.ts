import { createApp } from './app';
import { env } from './config/env';
import { sqlClient } from './db/client';
import { startAutoSync } from './gcs/gcs-sync.service';

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

const stopAutoSync = startAutoSync();

const shutdown = (signal: string) => {
  console.log(`${signal} received — shutting down`);
  stopAutoSync?.();
  server.close(() => {
    void sqlClient.end({ timeout: 5 }).finally(() => process.exit(0));
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
