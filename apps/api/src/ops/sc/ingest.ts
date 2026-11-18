import type { OpsFileType } from '@dash/shared';

import type { Tx } from '../../db/client';
import type { ParseContext } from '../../ingestion/parsers/types';
import type { SheetData } from '../../ingestion/sheet-reader';
import {
  parseFbaInventory,
  parseLedgerDetail,
  parseLedgerSummary,
  parseShipmentContents,
  parseShipments,
  type ScParseBase,
} from './parse';
import {
  registerWarehouses,
  storeFbaInventory,
  storeLedgerDetail,
  storeLedgerSummary,
  storeShipmentContents,
  storeShipments,
  upsertProducts,
} from './store';

export interface ScIngestResult {
  rows: number;
  from: string | null;
  to: string | null;
  warnings: string[];
  error?: string;
}

/**
 * Parse one detected Seller Central sheet and store it (facts + products +
 * warehouses) inside the caller's transaction. Returns a per-file summary for
 * the upload response and audit log.
 */
export async function ingestScFile(
  tx: Tx,
  brandId: string,
  uploadId: string,
  fileType: OpsFileType,
  sheet: SheetData,
  ctx: ParseContext
): Promise<ScIngestResult> {
  const done = (p: ScParseBase & { records: unknown[] }): ScIngestResult => ({
    rows: p.records.length,
    from: p.from,
    to: p.to,
    warnings: p.warnings,
  });

  switch (fileType) {
    case 'sc_ledger_summary': {
      const p = parseLedgerSummary(sheet.headers, sheet.rows, ctx);
      if (p.error) return { rows: 0, from: null, to: null, warnings: p.warnings, error: p.error };
      await upsertProducts(tx, brandId, p.products);
      await registerWarehouses(tx, p.warehouses);
      await storeLedgerSummary(tx, brandId, uploadId, p.records);
      return done(p);
    }
    case 'sc_ledger_detail': {
      const p = parseLedgerDetail(sheet.headers, sheet.rows, ctx);
      if (p.error) return { rows: 0, from: null, to: null, warnings: p.warnings, error: p.error };
      await upsertProducts(tx, brandId, p.products);
      await registerWarehouses(tx, p.warehouses);
      await storeLedgerDetail(tx, brandId, uploadId, p.records);
      return done(p);
    }
    case 'sc_fba_inventory': {
      const p = parseFbaInventory(sheet.headers, sheet.rows, ctx);
      if (p.error) return { rows: 0, from: null, to: null, warnings: p.warnings, error: p.error };
      await upsertProducts(tx, brandId, p.products);
      await storeFbaInventory(tx, brandId, uploadId, p.records);
      return done(p);
    }
    case 'sc_shipments': {
      const p = parseShipments(sheet.headers, sheet.rows, ctx);
      if (p.error) return { rows: 0, from: null, to: null, warnings: p.warnings, error: p.error };
      await registerWarehouses(tx, p.warehouses);
      await storeShipments(tx, brandId, uploadId, p.records, p.asOf);
      return done(p);
    }
    case 'sc_shipment_contents': {
      const p = parseShipmentContents(sheet.headers, sheet.rows, ctx);
      if (p.error) return { rows: 0, from: null, to: null, warnings: p.warnings, error: p.error };
      await upsertProducts(tx, brandId, p.products);
      await storeShipmentContents(tx, brandId, uploadId, p.records);
      return done(p);
    }
    default:
      return {
        rows: 0,
        from: null,
        to: null,
        warnings: [],
        error: `No Seller Central ingester for "${fileType}".`,
      };
  }
}
