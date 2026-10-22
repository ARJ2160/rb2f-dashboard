import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from './config/env';
import { gcsRouter } from './gcs/gcs.router';
import { uploadsRouter } from './ingestion/uploads.router';
import { errorHandler, notFound } from './middleware/error-handler';
import { reportsRouter } from './reports/reports.router';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // The web app on :3000 reads these responses cross-origin.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/uploads', uploadsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/gcs', gcsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
