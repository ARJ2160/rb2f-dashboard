import express from 'express';
import helmet from 'helmet';

import { env } from './config/env';
import { blinkitRouter } from './blinkit/blinkit.router';
import { sqlClient } from './db/client';
import { gcsRouter } from './gcs/gcs.router';
import { uploadsRouter } from './ingestion/uploads.router';
import { log } from './lib/logger';
import { errorHandler, notFound } from './middleware/error-handler';
import { rateLimit } from './middleware/rate-limit';
import { reportsRouter } from './reports/reports.router';

const MINUTE = 60_000;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Requests arrive through the web app's /api proxy, which sends X-Forwarded-For with exactly one entry:
  // the client IP Cloud Run's front end saw. Cloud Run may append the proxy's own address on the way in, so
  // trusting two hops makes req.ip that client either way, and a browser can't inject its own value.
  // It is only a fallback rate-limit key (the signed-in user's email is the normal one).
  app.set('trust proxy', 2);
  // The browser never calls the API directly (the web app proxies /api/*), so helmet's defaults fit.
  app.use(helmet());

  /** Liveness: the process is up. */
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** Readiness: the database answers. */
  app.get('/health/db', async (_req, res) => {
    try {
      await Promise.race([
        sqlClient`select 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      res.json({ ok: true });
    } catch (err) {
      log.warn('Database health check failed', { err });
      res.status(503).json({ ok: false, error: 'Database unreachable' });
    }
  });

  // Per-user limits, checked before any body is read.
  app.use('/api', rateLimit({ limit: env.RATE_LIMIT_API_PER_MIN, windowMs: MINUTE, what: 'requests' }));
  app.post(
    ['/api/uploads', '/api/blinkit/uploads'],
    rateLimit({ limit: env.RATE_LIMIT_UPLOADS_PER_10MIN, windowMs: 10 * MINUTE, what: 'uploads' })
  );
  app.post(
    ['/api/gcs/sync', '/api/reports/rebuild-dims', '/api/blinkit/rebuild-dims'],
    rateLimit({ limit: env.RATE_LIMIT_SYNC_PER_10MIN, windowMs: 10 * MINUTE, what: 'sync requests' })
  );

  app.use(express.json({ limit: '100kb' }));

  app.use('/api/uploads', uploadsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/gcs', gcsRouter);
  app.use('/api/blinkit', blinkitRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
