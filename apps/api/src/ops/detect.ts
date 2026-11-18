import type { OpsChannel, OpsFileType } from '@dash/shared';
import { OPS_FILE_TYPES } from '@dash/shared';

import { hasColumn, pick, str, type Row } from '../lib/values';

/**
 * Decide what an ops export is, from its column headers (and, for Vendor
 * Central Retail Analytics files, the metadata preamble above the header row).
 * Detection is by content only — never the file name (§1.1).
 */

export interface OpsDetection {
  fileType: OpsFileType;
  channel: OpsChannel;
  detectedBy: 'headers' | 'metadata';
}

const joinPreamble = (preamble: readonly string[]) => preamble.join(' · ');

/** Retail Analytics files carry `Programme=[Retail]` / `View By=[ASIN]` in row 1. */
const isRetailAnalytics = (preamble: readonly string[]) => {
  const text = joinPreamble(preamble);
  return /Programme\s*=\s*\[\s*Retail/i.test(text) || /View\s*By\s*=\s*\[\s*ASIN/i.test(text);
};

export function detectOpsFile(headers: string[], preamble: readonly string[] = []): OpsDetection | null {
  const has = (...aliases: string[]) => hasColumn(headers, aliases);

  // ── Seller Central ─────────────────────────────────────────────────────
  // Inventory Ledger — Summary view (aggregate by FC).
  if (
    has('FNSKU') &&
    has('MSKU') &&
    has('Disposition') &&
    has('Ending Warehouse Balance') &&
    has('Location')
  ) {
    return { fileType: 'sc_ledger_summary', channel: 'sc', detectedBy: 'headers' };
  }
  // Inventory Ledger — Detailed view (one row per event).
  if (
    has('Event Type') &&
    has('Reference ID') &&
    has('Quantity') &&
    has('Fulfillment Center', 'Fulfilment Center')
  ) {
    return { fileType: 'sc_ledger_detail', channel: 'sc', detectedBy: 'headers' };
  }
  // FBA Inventory snapshot (national per SKU).
  if (has('snapshot-date') && (has('available') || has('sales-shipped-last-30-days', 'units-shipped-t30'))) {
    return { fileType: 'sc_fba_inventory', channel: 'sc', detectedBy: 'headers' };
  }
  // Shipments list.
  if (has('Shipment name') && has('Units expected') && has('Units located') && has('Destination')) {
    return { fileType: 'sc_shipments', channel: 'sc', detectedBy: 'headers' };
  }
  // Shipment contents (per shipment: SKU-level shipped vs received).
  if (
    has('Shipment ID', 'Shipment Id', 'FBA Shipment ID') &&
    has('MSKU', 'SKU', 'Merchant SKU') &&
    has('Shipped', 'Units shipped', 'Shipped quantity', 'Quantity shipped') &&
    has('Received', 'Units received', 'Received quantity', 'Quantity received')
  ) {
    return { fileType: 'sc_shipment_contents', channel: 'sc', detectedBy: 'headers' };
  }

  // ── Vendor Central ─────────────────────────────────────────────────────
  // PO items export (one row = one ASIN on one PO).
  if (has('PO') && has('Vendor code') && has('Requested quantity') && has('Ship-to location')) {
    return { fileType: 'vc_po', channel: 'vc', detectedBy: 'headers' };
  }
  // Retail Analytics — Inventory vs Sales share one metadata block; split by columns.
  if (isRetailAnalytics(preamble) && has('ASIN')) {
    if (
      has(
        'Sellable On Hand Units',
        'Sellable On-Hand Inventory',
        'Net Received Units',
        'Open Purchase Order Quantity'
      )
    ) {
      return { fileType: 'vc_inventory', channel: 'vc', detectedBy: 'metadata' };
    }
    if (has('Shipped Units', 'Ordered Units', 'Shipped Revenue', 'Ordered Revenue')) {
      return { fileType: 'vc_sales', channel: 'vc', detectedBy: 'metadata' };
    }
  }

  return null;
}

/** The channel a detected type belongs to. */
export const channelOf = (fileType: OpsFileType): OpsChannel => OPS_FILE_TYPES[fileType].channel;

export interface IdentifierSniff {
  kind: 'vendorCode' | 'businesses' | 'sellerId';
  value: string;
}

/**
 * Best-effort identifier the file carries, to check against the selected
 * brand's identifiers (§1.1). PO exports carry the vendor code per row; Retail
 * Analytics files carry `Businesses=[...]` in the metadata. Seller Central
 * exports usually carry no account identifier.
 */
export function sniffIdentifier(
  fileType: OpsFileType,
  rows: readonly Row[],
  preamble: readonly string[]
): IdentifierSniff | null {
  if (fileType === 'vc_po') {
    const first = rows.find((r) => str(pick(r, ['Vendor code'])).trim());
    const code = first ? str(pick(first, ['Vendor code'])).trim() : '';
    return code ? { kind: 'vendorCode', value: code } : null;
  }
  if (fileType === 'vc_inventory' || fileType === 'vc_sales') {
    const m = joinPreamble(preamble).match(/Businesses\s*=\s*\[\s*([^\]]+?)\s*\]/i);
    const value = m?.[1]?.trim();
    return value ? { kind: 'businesses', value } : null;
  }
  return null;
}
