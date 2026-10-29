import type { Request, RequestHandler } from 'express';

import { formatWait, RateLimiter } from '../lib/limits';
import { HttpError } from './error-handler';

/**
 * Who is calling. In production the web app forwards the IAP-verified email of the signed-in person as
 * `x-user-email` (and only the web app can reach the API); locally, or if it is missing, the client IP.
 */
export function requestUser(req: Request): string {
  const email = req.get('x-user-email')?.trim().toLowerCase();
  if (email && email.length <= 320 && email.includes('@')) return email;
  return `ip:${req.ip ?? 'unknown'}`;
}

/** Per-user request limit; answers 429 with Retry-After when exceeded. */
export function rateLimit(opts: { limit: number; windowMs: number; what: string }): RequestHandler {
  const limiter = new RateLimiter(opts.limit, opts.windowMs);
  return (req, res, next) => {
    const r = limiter.hit(requestUser(req));
    const resetSec = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
    res.setHeader('RateLimit-Limit', String(opts.limit));
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    res.setHeader('RateLimit-Reset', String(resetSec));
    if (r.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(resetSec));
    next(new HttpError(429, `Too many ${opts.what} — try again in ${formatWait(resetSec * 1000)}.`));
  };
}
