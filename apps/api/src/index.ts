import { createApp } from './app';
import { env } from './config/env';
import { sqlClient } from './db/client';
import { startAutoSync, stopSyncs } from './gcs/gcs-sync.service';
import { log } from './lib/logger';

const server = createApp().listen(env.PORT, () => {
  log.info(`API listening on port ${env.PORT}`, { nodeEnv: env.NODE_ENV });
});

const stopAutoSync = startAutoSync();

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — shutting down`);
  stopAutoSync?.();
  stopSyncs();
  // Cloud Run sends SIGKILL 10 s after SIGTERM; finish (or give up) before that.
  setTimeout(() => {
    log.warn('Shutdown took too long — exiting');
    process.exit(1);
  }, 8_000).unref();
  server.close(() => {
    void sqlClient.end({ timeout: 5 }).finally(() => process.exit(0));
  });
  server.closeIdleConnections?.();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { err: reason });
});
process.on('uncaughtException', (err) => {
  // State is unknown after this; exit and let Cloud Run start a fresh instance.
  log.error('Uncaught exception — exiting', { err });
  process.exit(1);
});
