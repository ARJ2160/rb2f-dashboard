/**
 * Greedily pack items into chunks whose combined `size` (in bytes) stays under
 * `maxBytes`. Used to split a batch of uploads across several requests so no one
 * request approaches Cloud Run's 32 MiB request-body cap (which rejects the whole
 * upload with a 413 before it reaches the API, however small any single file is).
 *
 * - Order is preserved.
 * - An item larger than `maxBytes` on its own still gets its own chunk (best
 *   effort — nothing can make an over-cap single file fit).
 * - An item whose running total lands exactly on `maxBytes` stays in the chunk;
 *   the next item that would push it over opens a new chunk.
 * - Empty input yields no chunks.
 */
export function packBySize<T extends { size: number }>(items: readonly T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && bytes + item.size > maxBytes) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
