import { env } from '../config/env';
import { Semaphore } from './limits';

/**
 * Every file parse (manual upload or GCS sync) runs through here, so memory stays bounded no matter how
 * many people upload or sync at once. A big workbook can need several hundred MB while it is parsed.
 */
export const ingestSlots = new Semaphore(env.INGEST_CONCURRENCY);
