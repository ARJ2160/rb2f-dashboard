import { parentPort } from 'node:worker_threads';

import { readBlinkitWorkbook } from '../blinkit/ingestion/sheet-reader';
import { readInstamartWorkbook } from '../instamart/sheet-reader';
import { readWorkbook } from '../ingestion/sheet-reader';

/**
 * Parse worker: runs the synchronous SheetJS parse OFF the API's event loop.
 *
 * A workbook parse (`XLSX.read` + `sheet_to_json`) is pure CPU and blocks the
 * single Bun event loop for its whole duration — long enough, on a big export,
 * that health checks and the dashboard's `brands` poll time out and Cloud Run /
 * IAP answers 503 during a sync. Doing it here keeps the main thread free.
 *
 * This file must stay free of any DB / env import so the worker never opens a
 * database connection — it only imports the three pure readers.
 */

type Req =
  | { id: number; kind: 'amazon'; buffer: Uint8Array; opts: { maxRows?: number } }
  | { id: number; kind: 'blinkit'; buffer: Uint8Array; fileName: string }
  | { id: number; kind: 'instamart'; buffer: Uint8Array; fileName: string };

const port = parentPort;
if (!port) throw new Error('parse-worker must be run as a worker thread');

/** Re-wrap the cloned bytes as a Buffer view (no copy) for SheetJS. */
function toBuffer(u: Uint8Array): Buffer {
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength);
}

port.on('message', (msg: Req) => {
  try {
    const buf = toBuffer(msg.buffer);
    const result =
      msg.kind === 'amazon'
        ? readWorkbook(buf, msg.opts)
        : msg.kind === 'blinkit'
          ? readBlinkitWorkbook(buf, msg.fileName)
          : readInstamartWorkbook(buf, msg.fileName);
    port.postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    port.postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
});
