'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createGcsBrand,
  deleteGcsBrand,
  gcsIngestBulk,
  getGcsBrands,
  type BulkIngestResponse,
  type FileAssignment,
  type Marketplace,
} from '@/lib/api';
import { MarketplaceLogo } from '@/components/shell/marketplace-logo';

/** Marketplaces a batch can be routed to — mirrors the GCS page toggle. */
const MARKETPLACES: Array<{ id: Marketplace; label: string }> = [
  { id: 'amazon', label: 'Amazon' },
  { id: 'blinkit', label: 'Blinkit' },
  { id: 'swiggy_instamart', label: 'Swiggy Instamart' },
  { id: 'zepto', label: 'Zepto' },
  { id: 'flipkart', label: 'Flipkart' },
  { id: 'myntra', label: 'Myntra' },
  { id: 'nykaa', label: 'Nykaa' },
  { id: 'firstcry', label: 'Firstcry' },
  { id: 'meesho', label: 'Meesho' },
];

/** Shared with the GCS page so the toggle remembers the same marketplace. */
const MARKETPLACE_KEY = 'dash.gcsMarketplace';

/**
 * A single named upload slot shown in the stepper. `reportType` is the GCS
 * warehouse report-type id the file is assigned to (see gcs-ingest.ts
 * ALL_REPORT_TYPES). Several slots can share one id — e.g. Amazon SP/SB/SD
 * Campaign all map to `campaign`; the bulk upload suffixes duplicates and the
 * sync recovers the exact channel from the file's own columns.
 */
interface Slot {
  key: string;
  label: string;
  hint: string;
  reportType: string;
  /** Report has no dates of its own, so it must be dated by the page's date range. */
  needsRange?: boolean;
}
interface SlotGroup {
  group: string;
  slots: Slot[];
}

const CATALOG: Record<Marketplace, SlotGroup[]> = {
  amazon: [
    {
      group: 'Ads',
      slots: [
        { key: 'sp_campaign', label: 'SP Campaign', hint: 'Sponsored Products campaign report (daily or hourly)', reportType: 'campaign' },
        { key: 'sb_campaign', label: 'SB Campaign', hint: 'Sponsored Brands campaign report', reportType: 'campaign' },
        { key: 'sd_campaign', label: 'SD Campaign', hint: 'Sponsored Display campaign report', reportType: 'campaign' },
        { key: 'sp_advertised', label: 'SP Advertised Product', hint: 'Per-ASIN spend & sales, Sponsored Products', reportType: 'advertised' },
        { key: 'sd_advertised', label: 'SD Advertised Product', hint: 'Per-ASIN spend & sales, Sponsored Display', reportType: 'advertised' },
        { key: 'sb_attributed', label: 'SB Attributed Purchases', hint: 'Attributed sales & units, Sponsored Brands', reportType: 'advertised' },
        { key: 'sp_search_term', label: 'SP Search Term', hint: 'Customer search terms, Sponsored Products', reportType: 'str' },
        { key: 'sb_search_term', label: 'SB Search Term', hint: 'Customer search terms, Sponsored Brands', reportType: 'str' },
        { key: 'sd_targeting', label: 'SD Targeting', hint: 'Targeting report, Sponsored Display', reportType: 'str' },
        { key: 'sp_placement', label: 'SP Placement', hint: 'Placement breakdown, Sponsored Products', reportType: 'placement' },
        { key: 'sb_placement', label: 'SB Placement', hint: 'Placement breakdown, Sponsored Brands', reportType: 'placement' },
      ],
    },
    {
      group: 'Sales & Pi',
      slots: [
        { key: 'business_report', label: 'Business Report', hint: 'Seller Central sales by ASIN (sessions, CR%)', reportType: 'seller_central', needsRange: true },
        { key: 'vendor_central', label: 'VC Sales', hint: 'Vendor Central ordered / shipped revenue & units', reportType: 'vendor_central', needsRange: true },
        { key: 'pi_sales', label: 'Amazon Pi — Sales by Geography', hint: 'ASIN × day × city sales + indexed glance views', reportType: 'pi_sales' },
        { key: 'sqp', label: 'SQP', hint: 'Brand Analytics Search Query Performance', reportType: 'sqp' },
        { key: 'gv', label: 'Amazon Pi — Glance Views', hint: 'Daily indexed glance views per ASIN', reportType: 'gv' },
        { key: 'search_rank', label: 'Amazon Pi — Search Rank', hint: 'Monthly organic search rank per ASIN', reportType: 'search_rank' },
        { key: 'keyword_sov', label: 'Amazon Pi — Keyword SOV', hint: 'Keyword share of voice / CTR / CPC / ACoS', reportType: 'keyword_sov' },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'asin_mapper', label: 'ASIN Mapper', hint: 'ASIN → Category, Brand, Selling Price, Title', reportType: 'asin_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign Name → Category, Type, Targeting, Branded', reportType: 'campaign_mapper' },
      ],
    },
  ],
  blinkit: [
    {
      group: 'Sales',
      slots: [{ key: 'total_sales', label: 'Total Sales', hint: 'Order-level sales export (Sales Summary)', reportType: 'total_sales', needsRange: true }],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'ads', label: 'Ads Data', hint: 'Blinkit ads export — PL / PR / Banner; auto-filed into its ads_sales folder', reportType: 'ads' },
      ],
    },
    {
      group: 'Inventory & mappers',
      slots: [
        { key: 'inventory', label: 'Inventory Reports', hint: 'Daily stock-on-hand dump (InventoryData)', reportType: 'inventory' },
        { key: 'sku_mapper', label: 'ASIN / SKU Mapper', hint: 'Blinkit Item ID → SKU, Category, Price', reportType: 'sku_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign Name/ID → Category, SKU, City', reportType: 'campaign_mapper' },
      ],
    },
  ],
  swiggy_instamart: [
    {
      group: 'Sales',
      slots: [{ key: 'sales', label: 'Total Sales', hint: 'Instamart sales export (date, city, store, item, GMV)', reportType: 'sales', needsRange: true }],
    },
    {
      group: 'Ads',
      slots: [{ key: 'ads', label: 'Ads Data', hint: 'Campaign spend & sales by keyword / city', reportType: 'ads' }],
    },
    {
      group: 'Inventory & mappers',
      slots: [
        { key: 'inventory', label: 'Inventory Reports', hint: 'Daily stock-on-hand export', reportType: 'inventory' },
        { key: 'sku_mapper', label: 'ASIN / SKU Mapper', hint: 'Item Code → SKU / Category', reportType: 'sku_mapper' },
      ],
    },
  ],
  zepto: [
    {
      group: 'Sales',
      slots: [{ key: 'sales', label: 'Total Sales', hint: 'SALES_OVERVIEW — day × city × SKU', reportType: 'sales', needsRange: true }],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'sp_campaign', label: 'SP Campaign', hint: 'Sponsored Product campaign report', reportType: 'sp_campaign' },
        { key: 'sb_campaign', label: 'SB Campaign', hint: 'Sponsored Brand campaign report', reportType: 'sb_campaign' },
        { key: 'sd_campaign', label: 'SD Campaign', hint: 'Sponsored Display campaign report', reportType: 'sd_campaign' },
        { key: 'sp_keyword', label: 'SP Keyword Report', hint: 'Sponsored Product keyword report', reportType: 'sp_keyword' },
        { key: 'sb_keyword', label: 'SB Keyword Report', hint: 'Sponsored Brand keyword report', reportType: 'sb_keyword' },
        { key: 'sd_keyword', label: 'SD Keyword Report', hint: 'Sponsored Display keyword report', reportType: 'sd_keyword' },
        { key: 'sp_product', label: 'SP Product Report', hint: 'Sponsored Product SKU report', reportType: 'sp_product' },
        { key: 'sb_product', label: 'SB Product Report', hint: 'Sponsored Brand SKU report', reportType: 'sb_product' },
        { key: 'sd_product', label: 'SD Product Report', hint: 'Sponsored Display SKU report', reportType: 'sd_product' },
      ],
    },
    {
      group: 'Inventory & mappers',
      slots: [
        { key: 'inventory', label: 'Inventory Report', hint: 'City × SKU stock snapshot', reportType: 'inventory' },
        { key: 'sku_mapper', label: 'ASIN / SKU Mapper', hint: 'SKU ID (PVID) → canonical Category', reportType: 'sku_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign Name → Category', reportType: 'campaign_mapper' },
      ],
    },
  ],
  flipkart: [
    {
      group: 'Sales',
      slots: [
        { key: 'traffic', label: 'Traffic / Total Sales', hint: 'FSN × day: gross revenue, units, ads+organic impressions & clicks', reportType: 'traffic' },
        { key: 'earn_more', label: 'Earn More', hint: 'Returns, cancellations, net revenue & units', reportType: 'earn_more' },
      ],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'campaign', label: 'Campaign', hint: 'Campaign-level ad metrics (summary)', reportType: 'campaign', needsRange: true },
        { key: 'consolidated_fsn', label: 'Consolidated FSN', hint: 'Advertised FSN (ASIN-level)', reportType: 'consolidated_fsn', needsRange: true },
        { key: 'placement', label: 'Placement', hint: 'Placement performance', reportType: 'placement', needsRange: true },
        { key: 'search_term', label: 'Search Term', hint: 'Customer search terms', reportType: 'search_term', needsRange: true },
        { key: 'keyword', label: 'Keyword', hint: 'Keyword report', reportType: 'keyword', needsRange: true },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'fsn_mapper', label: 'FSN Mapper', hint: 'FSN → Category, Title, Selling Price', reportType: 'fsn_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign → Category', reportType: 'campaign_mapper' },
      ],
    },
  ],
  myntra: [
    {
      group: 'Sales',
      slots: [
        { key: 'total_sales', label: 'Total Sales', hint: 'Style × day × state sales', reportType: 'total_sales' },
      ],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'campaign', label: 'Campaign', hint: 'Campaign-level ad metrics', reportType: 'campaign', needsRange: true },
        { key: 'product', label: 'Product', hint: 'Advertised Style (ASIN-level)', reportType: 'product', needsRange: true },
        { key: 'placement', label: 'Placement', hint: 'Placement report', reportType: 'placement', needsRange: true },
        { key: 'search_term', label: 'Search Term', hint: 'Keyword-targeting search terms', reportType: 'search_term', needsRange: true },
        { key: 'targeting', label: 'Targeting', hint: 'Product + keyword targeting (merged)', reportType: 'targeting', needsRange: true },
        { key: 'top_search_terms', label: 'Top Search Terms', hint: 'Platform demand / SOV', reportType: 'top_search_terms', needsRange: true },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'style_mapper', label: 'Style Mapper', hint: 'Style → Category, Title, Price', reportType: 'style_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign → Category', reportType: 'campaign_mapper' },
      ],
    },
  ],
  nykaa: [
    {
      group: 'Sales',
      slots: [
        { key: 'mis', label: 'MIS (Fashion)', hint: 'Sales from Nykaa Fashion MIS', reportType: 'mis' },
        { key: 'sales_report', label: 'Sales Report (Seller)', hint: 'Sales from the Seller Portal', reportType: 'sales_report' },
      ],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'ad_report', label: 'Ad Report', hint: 'Campaign-level ad metrics', reportType: 'ad_report', needsRange: true },
        { key: 'sku_report', label: 'SKU Report', hint: 'Advertised SKU (ASIN-level)', reportType: 'sku_report', needsRange: true },
        { key: 'placement', label: 'Placement', hint: 'Placement report', reportType: 'placement', needsRange: true },
        { key: 'search_term', label: 'Search Term', hint: 'Search terms, if present in the Ad Report', reportType: 'search_term', needsRange: true },
        { key: 'sku_sov', label: 'SKU SOV', hint: 'Share of voice per SKU', reportType: 'sku_sov', needsRange: true },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'sku_mapper', label: 'SKU Mapper', hint: 'SKU → Category, Title, Price', reportType: 'sku_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign → Category', reportType: 'campaign_mapper' },
      ],
    },
  ],
  firstcry: [
    {
      group: 'Sales',
      slots: [
        { key: 'sales', label: 'Sales Report', hint: 'SKU × day sales', reportType: 'sales' },
      ],
    },
    {
      group: 'Ads',
      slots: [
        { key: 'perf_product', label: 'Performance Product', hint: 'Advertised SKU (ASIN-level)', reportType: 'perf_product', needsRange: true },
        { key: 'perf_category', label: 'Performance Category', hint: 'Category-level ad metrics (pre-rolled)', reportType: 'perf_category', needsRange: true },
        { key: 'perf_keyword', label: 'Performance Keyword', hint: 'Keyword ad metrics', reportType: 'perf_keyword', needsRange: true },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'sku_mapper', label: 'SKU Mapper', hint: 'SKU → Category, Title, Price', reportType: 'sku_mapper' },
        { key: 'campaign_mapper', label: 'Campaign Mapper', hint: 'Campaign → Category', reportType: 'campaign_mapper' },
      ],
    },
  ],
  meesho: [
    {
      group: 'Sales',
      slots: [
        { key: 'br', label: 'Business Report', hint: 'SKU × day gross sales (+ state)', reportType: 'br' },
        { key: 'orders', label: 'Orders Report', hint: 'Order status → net (delivered / returned / RTO / cancelled)', reportType: 'orders' },
      ],
    },
    {
      group: 'Mappers',
      slots: [
        { key: 'sku_mapper', label: 'SKU Mapper', hint: 'SKU → Category, Title, Price', reportType: 'sku_mapper' },
      ],
    },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const today = () => isoDaysAgo(0);

const CheckIcon = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 6" />
  </svg>
);
const UploadIcon = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [marketplace, setMarketplace] = useState<Marketplace>('amazon');
  const [startDate, setStartDate] = useState(isoDaysAgo(14));
  const [endDate, setEndDate] = useState(today());
  const [step, setStep] = useState(0);
  const [uploads, setUploads] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkIngestResponse | null>(null);
  const [adding, setAdding] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [creatingBrand, setCreatingBrand] = useState(false);
  const [brandNotice, setBrandNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingBrand, setDeletingBrand] = useState(false);
  const [datesTouched, setDatesTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore the last-used marketplace (shared with the GCS page toggle).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MARKETPLACE_KEY) as Marketplace | null;
      if (saved && MARKETPLACES.some((m) => m.id === saved)) setMarketplace(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    getGcsBrands()
      .then((res) => setBrands((res.brands ?? []).map((b: { brand: string }) => b.brand)))
      .catch(() => setBrands([]));
  }, []);

  const groups = CATALOG[marketplace];
  const slots = useMemo(() => groups.flatMap((g) => g.slots.map((s) => ({ ...s, group: g.group }))), [groups]);
  const total = slots.length;
  const current = slots[Math.min(step, total - 1)];
  const doneCount = slots.filter((s) => uploads[s.key]).length;
  const needsRangePending = slots.some((s) => s.needsRange && uploads[s.key]) && !datesTouched;

  const changeMarketplace = (m: Marketplace) => {
    setMarketplace(m);
    setUploads({});
    setStep(0);
    setResult(null);
    setError(null);
    try {
      localStorage.setItem(MARKETPLACE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const pickFile = useCallback(
    (slotKey: string, file: File | null | undefined) => {
      if (!file) return;
      const wasEmpty = !uploads[slotKey];
      setUploads((prev) => ({ ...prev, [slotKey]: file }));
      // First time a slot is filled, glide to the next report so the flow keeps moving.
      if (wasEmpty) setTimeout(() => setStep((s) => Math.min(total - 1, s + 1)), 450);
    },
    [uploads, total]
  );

  const clearFile = (slotKey: string) =>
    setUploads((prev) => {
      const next = { ...prev };
      delete next[slotKey];
      return next;
    });

  const goto = (i: number) => setStep(Math.max(0, Math.min(total - 1, i)));

  const submit = useCallback(async () => {
    if (!brand.trim()) return setError('Pick or enter a brand name.');
    if (!startDate) return setError('Enter a start date.');
    if (!endDate) return setError('Enter an end date.');
    if (endDate < startDate) return setError('End date must be on or after start date.');
    if (slots.some((s) => s.needsRange && uploads[s.key]) && !datesTouched)
      return setError('Set the date range to the period these sales files cover — it dates any report that has no dates of its own.');
    if (doneCount === 0) return setError('Add at least one report file.');

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const files: File[] = [];
      const assignments: FileAssignment[] = [];
      const usedNames = new Set<string>();
      for (const s of slots) {
        const f = uploads[s.key];
        if (!f) continue;
        // Keep every uploaded name unique so the server can match file → assignment.
        let name = f.name;
        if (usedNames.has(name)) name = `${s.key}__${f.name}`;
        usedNames.add(name);
        const sendFile = name === f.name ? f : new File([f], name, { type: f.type });
        files.push(sendFile);
        assignments.push({ filename: name, marketplace, reportType: s.reportType });
      }
      const res = await gcsIngestBulk(brand.trim(), startDate, endDate, assignments, files);
      setResult(res);
      setUploads({});
      setStep(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [brand, startDate, endDate, doneCount, slots, uploads, marketplace, datesTouched]);

  const addBrand = useCallback(async () => {
    const name = newBrand.trim();
    if (!name) return setError('Enter a brand name.');
    setCreatingBrand(true);
    setError(null);
    setBrandNotice(null);
    try {
      const created = await createGcsBrand(name);
      const list = await getGcsBrands(true, marketplace);
      setBrands((list.brands ?? []).map((b: { brand: string }) => b.brand));
      setBrand(created.brand);
      setAdding(false);
      setNewBrand('');
      setBrandNotice(`Brand \u201c${created.brand}\u201d created in GCS.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingBrand(false);
    }
  }, [newBrand, marketplace]);

  const removeBrand = useCallback(async () => {
    if (!brand) return;
    setDeletingBrand(true);
    setError(null);
    setBrandNotice(null);
    try {
      const res = await deleteGcsBrand(brand);
      const list = await getGcsBrands(true, marketplace);
      setBrands((list.brands ?? []).map((b: { brand: string }) => b.brand));
      setBrand('');
      setDeleting(false);
      setDeleteConfirmText('');
      setBrandNotice(
        `Deleted brand \u201c${res.brand}\u201d and ${res.filesDeleted} file${res.filesDeleted === 1 ? '' : 's'} from GCS.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingBrand(false);
    }
  }, [brand, marketplace]);

  const currentFile = current ? uploads[current.key] : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Upload reports</h1>
        <p className="mt-1 text-sm text-muted">
          Go through each report in turn and drop the matching export into its slot. Every file is renamed to
          the standard format and routed to the right warehouse folder — you tell us what each file is, so
          nothing is guessed.
        </p>
      </div>

      {/* ── Brand + dates + marketplace ── */}
      <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">Account / brand</label>
            {!adding && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => {
                    setAdding(true);
                    setNewBrand('');
                    setBrandNotice(null);
                    setError(null);
                    setDeleting(false);
                  }}
                >
                  + New brand
                </button>
                {brand && brands.includes(brand) && (
                  <button
                    type="button"
                    className="text-xs font-medium text-error hover:underline"
                    onClick={() => {
                      setDeleting((d) => !d);
                      setDeleteConfirmText('');
                      setBrandNotice(null);
                      setError(null);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>

          {adding ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  className="input w-full"
                  placeholder="e.g. eatopia"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addBrand();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary whitespace-nowrap"
                  disabled={creatingBrand || !newBrand.trim()}
                  onClick={() => void addBrand()}
                >
                  {creatingBrand ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={creatingBrand}
                  onClick={() => {
                    setAdding(false);
                    setNewBrand('');
                  }}
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-muted">
                Creates the brand folder in the GCS warehouse bucket. Lower-case letters, digits, “-” and “_”.
              </p>
            </div>
          ) : brands.length > 0 ? (
            <select
              className="select select-bordered w-full"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setDeleting(false);
                setDeleteConfirmText('');
              }}
            >
              <option value="">— select brand —</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="input w-full"
              placeholder="e.g. eatopia"
              value={brand}
              onChange={(e) => setBrand(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
            />
          )}

          {deleting && brand && !adding && (
            <div className="mt-1 flex flex-col gap-2 rounded-lg border border-error/30 bg-error/5 p-3">
              <p className="text-xs text-error">
                This permanently deletes brand <span className="font-semibold">{brand}</span> and every file
                under it in GCS, plus its stored dashboard data. This cannot be undone.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="input input-sm w-full"
                  placeholder={`Type "${brand}" to confirm`}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && deleteConfirmText.trim() === brand) {
                      e.preventDefault();
                      void removeBrand();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-error whitespace-nowrap"
                  disabled={deletingBrand || deleteConfirmText.trim() !== brand}
                  onClick={() => void removeBrand()}
                >
                  {deletingBrand ? 'Deleting…' : 'Delete brand'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={deletingBrand}
                  onClick={() => {
                    setDeleting(false);
                    setDeleteConfirmText('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {brandNotice && <p className="text-[11px] text-success">{brandNotice}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted">
            Date range covered <span className="text-error">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="input w-full"
              value={startDate}
              max={endDate || today()}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatesTouched(true);
              }}
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              className="input w-full"
              value={endDate}
              min={startDate}
              max={today()}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatesTouched(true);
              }}
            />
          </div>
          {needsRangePending ? (
            <p className="text-[11px] text-warning">
              A sales report is queued — set this to the exact period the file covers. It dates any report that
              carries no dates of its own.
            </p>
          ) : (
            <p className="text-[11px] text-muted">Dates any report that has no dates of its own (e.g. the Business Report).</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide text-muted">Marketplace</label>
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-side p-1" role="radiogroup" aria-label="Marketplace">
            {MARKETPLACES.map((m) => {
              const on = marketplace === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => changeMarketplace(m.id)}
                  className={`flex h-9 items-center gap-2 rounded-lg pl-1.5 pr-3.5 text-sm transition-all ${
                    on ? 'bg-surface font-semibold text-ink shadow-[0_1px_3px_rgb(20_23_28/0.12)] ring-1 ring-line' : 'text-ink/65 hover:text-ink'
                  }`}
                >
                  <span className={on ? '' : 'opacity-60 grayscale-[35%]'}>
                    <MarketplaceLogo id={m.id} size={24} />
                  </span>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Progress ── */}
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap text-sm font-medium">
          <span className="font-mono text-primary">{doneCount}</span> of{' '}
          <span className="font-mono">{total}</span> reports added
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <span className="block h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
        </span>
        {doneCount > 0 && (
          <button type="button" className="whitespace-nowrap text-xs text-muted underline hover:text-error" onClick={() => setUploads({})}>
            Clear all
          </button>
        )}
      </div>

      {/* ── Stepper: rail + stage ── */}
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        {/* Rail */}
        <nav className="max-h-[560px] overflow-auto rounded-xl border border-line bg-surface p-2" aria-label="Report steps">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted/70">{g.group}</div>
              {g.slots.map((s) => {
                const i = slots.findIndex((x) => x.key === s.key);
                const done = !!uploads[s.key];
                const isCur = i === step;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => goto(i)}
                    aria-current={isCur}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${
                      isCur ? 'border-primary/30 bg-primary/10 font-semibold text-primary' : 'border-transparent text-muted hover:bg-stripe'
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 flex-none place-items-center rounded-full text-[10px] ${
                        done ? 'bg-success text-white' : 'border border-line text-muted'
                      }`}
                      style={done ? undefined : { borderColor: 'var(--color-line)' }}
                    >
                      {done ? <CheckIcon className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Stage */}
        <div className="flex flex-col rounded-xl border border-line bg-surface p-6">
          {current && (
            <>
              <span className="font-mono text-xs font-semibold text-primary">
                Step {step + 1} of {total} · {current.group}
              </span>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">{current.label}</h2>
              <p className="mt-1 max-w-prose text-sm text-muted">
                {current.hint}. Drop the export for this report below.
              </p>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(current.key, e.dataTransfer.files?.[0]);
                }}
                className={`mt-5 flex min-h-[180px] flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  currentFile
                    ? 'border-success/45 bg-success/5'
                    : dragging
                      ? 'border-primary bg-primary/5'
                      : 'border-line hover:border-primary/60 hover:bg-primary/5'
                }`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-full ${currentFile ? 'bg-success text-white' : 'bg-primary/10 text-primary'}`}>
                  {currentFile ? <CheckIcon className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
                </span>
                {currentFile ? (
                  <>
                    <span className="text-sm font-semibold text-success">File added</span>
                    <span className="break-all font-mono text-xs text-muted">{currentFile.name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-ink">Drop file or click to browse</span>
                    <span className="text-xs text-muted">.xlsx · .xls · .csv</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    pickFile(current.key, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>

              <div className="mt-5 flex items-center gap-2">
                <button type="button" className="btn btn-sm btn-ghost" disabled={step === 0} onClick={() => goto(step - 1)}>
                  ← Back
                </button>
                {currentFile && (
                  <button type="button" className="text-xs text-muted underline hover:text-error" onClick={() => clearFile(current.key)}>
                    Remove file
                  </button>
                )}
                <span className="flex-1" />
                {!currentFile && step < total - 1 && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => goto(step + 1)}>
                    Skip for now
                  </button>
                )}
                {step < total - 1 && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => goto(step + 1)}>
                    Next →
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}

      {/* ── Submit ── */}
      <button type="button" onClick={submit} disabled={busy || doneCount === 0 || !brand} className="btn btn-primary w-full">
        {busy ? 'Uploading…' : `Upload ${doneCount} file${doneCount === 1 ? '' : 's'} to GCS`}
      </button>

      {/* ── Results ── */}
      {result && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <h2 className="text-sm font-semibold">Results</h2>
          <ul className="space-y-1">
            {result.files.map((f) => (
              <li key={f.objectName} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 ${f.status === 'uploaded' ? 'text-success' : 'text-error'}`}>{f.status === 'uploaded' ? '✓' : '✗'}</span>
                <span className="flex-1">
                  <span className="font-mono text-xs">{f.objectName}</span>
                  {f.message && <span className="ml-2 text-xs text-error">{f.message}</span>}
                </span>
              </li>
            ))}
          </ul>
          {result.sync.length > 0 ? (
            <p className="text-sm text-muted">
              Sync started ({result.sync.length} marketplace{result.sync.length > 1 ? 's' : ''}).{' '}
              <a href="/" className="text-primary underline">
                View on GCS page →
              </a>
            </p>
          ) : result.files.some((f) => f.status === 'uploaded') ? (
            <p className="text-sm text-muted">
              Files uploaded.{' '}
              <a href="/" className="text-primary underline">
                Go to GCS → Sync now
              </a>
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
