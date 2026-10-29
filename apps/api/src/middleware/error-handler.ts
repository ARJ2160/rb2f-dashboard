import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError, z } from 'zod';

import { log } from '../lib/logger';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => next(new HttpError(404, `Not found: ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) {
    log.error('Error after the response started', { err, method: req.method, path: req.path });
    res.end();
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', details: z.flattenError(err) });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    return;
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) log.warn(err.message, { status: err.status, method: req.method, path: req.path });
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // body-parser errors (malformed JSON, body too large) carry a safe status + message.
  const e = err as { status?: unknown; expose?: unknown; message?: unknown };
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.expose === true) {
    res.status(e.status).json({ error: String(e.message) });
    return;
  }
  log.error('Unhandled error', { err, method: req.method, path: req.path, user: req.get('x-user-email') });
  res.status(500).json({ error: 'Internal server error' });
};
