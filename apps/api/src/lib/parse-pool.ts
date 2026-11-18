import { Worker } from 'node:worker_threads';

import type { SheetData as BlinkitSheetData } from '../blinkit/ingestion/sheet-grid';
import { readBlinkitWorkbook } from '../blinkit/ingestion/sheet-reader';
import { readInstamartWorkbook, type Sheet as InstamartSheet } from '../instamart/sheet-reader';
import { readWorkbook, type SheetData } from '../ingestion/sheet-reader';
import { env } from '../config/env';
import { log } from './logger';

/**
 * A small pool of worker threads that run the synchronous workbook parse off the
 * API's single event loop (see lib/parse-worker.ts for why). Pool size matches
 * INGEST_CONCURRENCY, so it bounds concurrent parses — and therefore memory —
 * exactly like the ingest-slot semaphore it runs alongside.
 *
 * It degrades safely: if a worker can't be spawned (unsupported runtime) or a
 * parse rejects for any reason, the public helpers fall back to parsing on the
 * main thread, so ingest behaves exactly as before — just without the offload.
 * In tests, workers are skipped entirely for determinism.
 */

type Req =
  | { id: number; kind: 'amazon'; buffer: Uint8Array; opts: { maxRows?: number } }
  | { id: number; kind: 'blinkit'; buffer: Uint8Array; fileName: string }
  | { id: number; kind: 'instamart'; buffer: Uint8Array; fileName: string };

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Omit that distributes over a union, so each variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Job {
  id: number;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
interface Slot {
  worker: Worker;
  job: Job | null;
}

const POOL_SIZE = Math.max(1, env.INGEST_CONCURRENCY);
let disabled = env.NODE_ENV === 'test';
let seq = 0;
const slots: Slot[] = [];
const queue: Array<{ req: Req; resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];

function spawn(): Slot | null {
  try {
    const worker = new Worker(new URL('./parse-worker.ts', import.meta.url));
    const slot: Slot = { worker, job: null };
    worker.on('message', (reply: Reply) => {
      const job = slot.job;
      if (!job || job.id !== reply.id) return;
      slot.job = null;
      if (reply.ok) job.resolve(reply.result);
      else job.reject(new Error(reply.error));
      pump();
    });
    const fail = (err: Error) => {
      const idx = slots.indexOf(slot);
      if (idx >= 0) slots.splice(idx, 1);
      void worker.terminate().catch(() => {});
      if (slot.job) {
        slot.job.reject(err);
        slot.job = null;
      }
      pump();
    };
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (code !== 0) fail(new Error(`parse worker exited with code ${code}`));
    });
    worker.unref(); // never keep the process alive for an idle worker
    return slot;
  } catch (err) {
    log.warn('Workbook parse worker could not be created — parsing on the main thread', { err });
    disabled = true;
    return null;
  }
}

function runOnMainThread(req: Req): unknown {
  const buf = Buffer.from(req.buffer);
  if (req.kind === 'amazon') return readWorkbook(buf, req.opts);
  if (req.kind === 'blinkit') return readBlinkitWorkbook(buf, req.fileName);
  return readInstamartWorkbook(buf, req.fileName);
}

function pump(): void {
  if (!disabled) {
    while (slots.length < POOL_SIZE) {
      const slot = spawn();
      if (!slot) break; // spawn failed → disabled is now set
      slots.push(slot);
    }
  }
  if (disabled) {
    for (const q of queue.splice(0)) {
      try {
        q.resolve(runOnMainThread(q.req));
      } catch (err) {
        q.reject(err as Error);
      }
    }
    return;
  }
  for (const slot of slots) {
    if (queue.length === 0) break;
    if (slot.job) continue;
    const next = queue.shift()!;
    slot.job = { id: next.req.id, resolve: next.resolve, reject: next.reject };
    try {
      slot.worker.postMessage(next.req);
    } catch (err) {
      slot.job = null;
      next.reject(err as Error);
    }
  }
}

function submit(req: DistributiveOmit<Req, 'id'>): Promise<unknown> {
  const full = { ...req, id: ++seq } as Req;
  return new Promise<unknown>((resolve, reject) => {
    queue.push({ req: full, resolve, reject });
    pump();
  });
}

/** Parse an Amazon / Seller-Central workbook off-thread (falls back to the main thread on any failure). */
export async function parseAmazonWorkbook(
  buffer: Buffer,
  opts: { maxRows?: number } = {}
): Promise<SheetData[]> {
  try {
    return (await submit({ kind: 'amazon', buffer, opts })) as SheetData[];
  } catch (err) {
    log.warn('Amazon workbook parse fell back to the main thread', { err: (err as Error).message });
    return readWorkbook(buffer, opts);
  }
}

/** Parse a Blinkit workbook off-thread (falls back to the main thread on any failure). */
export async function parseBlinkitWorkbook(
  buffer: Buffer,
  fileName: string
): Promise<{ sheets: BlinkitSheetData[]; skippedTabs: string[] }> {
  try {
    return (await submit({ kind: 'blinkit', buffer, fileName })) as {
      sheets: BlinkitSheetData[];
      skippedTabs: string[];
    };
  } catch (err) {
    log.warn('Blinkit workbook parse fell back to the main thread', { err: (err as Error).message });
    return readBlinkitWorkbook(buffer, fileName);
  }
}

/** Parse a Swiggy Instamart workbook off-thread (falls back to the main thread on any failure). */
export async function parseInstamartWorkbook(buffer: Buffer, fileName: string): Promise<InstamartSheet[]> {
  try {
    return (await submit({ kind: 'instamart', buffer, fileName })) as InstamartSheet[];
  } catch (err) {
    log.warn('Instamart workbook parse fell back to the main thread', { err: (err as Error).message });
    return readInstamartWorkbook(buffer, fileName);
  }
}
