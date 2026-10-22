import { isIsoDate } from '@dash/shared';
import { z } from 'zod';

export const profileIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/, 'profileId: letters, digits, - and _ only (max 64)')
  .default('default');

const isoDate = z.string().refine(isIsoDate, 'Expected a date as YYYY-MM-DD');

export const rangeQuerySchema = z
  .object({ profileId: profileIdSchema, from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] })
  .refine((q) => (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000 <= 366, {
    message: 'Range is limited to 367 days',
    path: ['to'],
  });
