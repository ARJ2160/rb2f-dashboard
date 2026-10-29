# Amazon Dashboard

Upload raw Amazon **Seller Central / Vendor Central / Ads** exports → the API detects each report, parses it, and stores it **per day** → the web app shows the **DSR** (Daily Sales Report) and **DUR** (Daily Units Report) for any date range.

Business logic follows `GCP_Dashboard_Rule_Book.md` (§3 categorisation, §4 Seller + Vendor combination, §7 metric formulas, §9 cleaning, §10 DSR/DUR).

## Layout (Bun workspaces monorepo)

```
apps/
  api/        Express 5 + TypeScript on Bun + Drizzle ORM (Postgres)   → http://localhost:4000
  web/        Next.js 16 (App Router) + Tailwind 4                     → http://localhost:3000
packages/
  shared/     Types + metric formulas used by both (ships TS source, no build step)
docker-compose.yml   local Postgres 16
apps/*/Dockerfile    production images (Cloud Run); cloudbuild.yaml deploys them
```

```
apps/api/src
  config/env.ts              env validation (zod), loads apps/api/.env
  db/schema.ts               tables (see "Storage model")
  db/migrate.ts              applies ./drizzle migrations
  ingestion/
    sheet-reader.ts          xlsx/csv → rows; finds the real header row; every tab of a workbook
    detect-report.ts         report type from COLUMNS first, then sheet / file name
    parsers/*.ts             one pure parser per report (no I/O — unit-tested)
    store.ts                 replace-by-date writes
    ingest.service.ts        file → sheets → detect → parse → store, per-sheet results
    uploads.router.ts        POST/GET /api/uploads
  gcs/
    gcs-client.ts            read-only GCS JSON API client (key-file JWT locally, metadata server on Cloud Run; no Google SDK)
    paths.ts                 bucket layout → brands / files (pure, unit-tested)
    gcs-sync.service.ts      bucket files → the same ingest pipeline, per brand profile
    gcs.router.ts            /api/gcs/*
  lib/limits.ts              rate limiter, semaphore, cooldowns (in memory — one API instance)
  middleware/rate-limit.ts   per-user limits on /api, uploads and syncs
  reports/
    dsr.service.ts           GET /api/reports/dsr
    dur.service.ts           GET /api/reports/dur
    coverage.service.ts      GET /api/reports/coverage
  blinkit/                   Blinkit marketplace (see "Blinkit" below)
    schema.ts                bk_* tables (re-exported from db/schema.ts)
    ingestion/               sheet reader, detect-by-columns, pure parsers, replace-by-date store, ingest.ts
    reports/                 dims (mappers), MoM/WoW, DSR, DUR, category/SKU, geo, city ads, keywords, inventory DOC
    blinkit.router.ts        /api/blinkit/*
apps/web
  app/upload/page.tsx        drag-and-drop upload + per-sheet results + history
  app/reports/page.tsx       report tabs for the profile in the top bar (uploaded data)
  app/gcs/page.tsx           same report tabs for a brand synced from the GCS warehouse
  app/api/[...path]/route.ts every browser /api/* call is forwarded to the API (lib/api-proxy.ts)
  components/reports-dashboard.tsx  the shared report tabs used by both pages
  components/blinkit/        Blinkit report tabs (shown on /gcs when "Blinkit" is selected)
  lib/blinkit-api.ts         /api/blinkit/* client
packages/shared/src/blinkit  Blinkit types, metric formulas, city rule, DOC maths — import from `@dash/shared/blinkit`
```

## Getting started

Requirements: **Bun 1.3+**, **Node 22+** (Next.js runs on it), and Docker (for Postgres) — or any Postgres 14+ and a `DATABASE_URL`.

```bash
bun install
bun run db:up                         # starts Postgres on :5432 (see docker-compose.yml)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
bun run db:migrate                    # creates the tables
bun run dev                           # api :4000 + web :3000
```

The browser only talks to the web app: `/api/*` on :3000 is forwarded to the API (`API_INTERNAL_URL`), locally and in production.

Open http://localhost:3000 → **Upload** → drop your exports → **Reports**.

**Upgrading an existing install:** `bun install` (new web dependency `@svg-maps/india`) → `bun run db:migrate` (0004–0006 recreate the Advertised Product table and add the campaign-dimension tables) → re-upload the SP/SD Advertised Product, campaign, search-term and placement exports so the per-campaign dimensions are rebuilt.

Other scripts: `bun run typecheck`, `bun run test`, `bun run build` (web), `bun run db:generate` (after editing `apps/api/src/db/schema.ts`), `cd apps/api && bun run db:studio`. The API needs no build: Bun runs its TypeScript directly.

## Production

Runs on Google Cloud: two Cloud Run services (web behind IAP sign-in, private API as one always-on instance), Cloud SQL Postgres 16, a Cloud Run job for migrations, deployed by `cloudbuild.yaml` on every push to `master`. Step-by-step setup is in the go-live runbook.

Safeguards built in:

- **Sync**: one job per brand (clicking again joins it), at most `SYNC_MAX_CONCURRENT` (2) syncs at once, *Sync now* cools down `SYNC_COOLDOWN_SEC` (120 s) after a sync, *Re-ingest all* runs at most once per `REINGEST_COOLDOWN_MIN` (30 min) per brand and asks for confirmation. The buttons show the countdown.
- **Rate limits per signed-in user**: 600 API requests / min, 30 uploads / 10 min, 20 sync requests / 10 min (429 + `Retry-After`).
- **Uploads**: per-file size and count limits, content must be a real spreadsheet / CSV, filenames sanitised; at most `INGEST_CONCURRENCY` (2) files are parsed at once across uploads and syncs, so memory stays bounded.
- **Security**: IAP sign-in (the proxy verifies IAP's signed JWT before trusting the email), the API accepts only the web service's identity, an allowlist of headers crosses the proxy, security headers + CSP on every page, helmet on the API, no key files in production (GCS uses the API's service account).
- **Operations**: JSON logs for Cloud Logging / Error Reporting (uploads and syncs logged with the user), `/health` and `/health/db`, DB pool limits + statement timeout, graceful shutdown on SIGTERM, migrations and per-brand syncs behind Postgres advisory locks (safe while two revisions overlap during a deploy).

## Upload flow

1. **Read** – every sheet of every uploaded `.xlsx/.xls/.csv`. The header row is located by content (Vendor Central adds metadata lines above it).
2. **Detect** – report type from the sheet's **columns** (e.g. `Sessions - Total` → Business Report, `Ordered Revenue` → Vendor Central, `14 Day Detail Page Views (DPV)` → SD). Falls back to the sheet name, then the file name. Channel (SP/SB/SD) is never trusted from the name alone.
3. **Date** – each row's own date (`Date`, or `Start Date` = `End Date` on daily ad exports). If a report has no per-row date (the Business Report usually doesn't), the **file name** must identify a **single day** (`…_10_April.xlsx`, `…2026-04-10…`). A multi-day file without per-row dates is rejected rather than mis-dated.
4. **Clean** – `₹`, commas, `%`, scientific notation stripped/handled for every numeric cell (§9).
5. **Store** – *replace-by-date*: rows for that source and those dates are deleted and re-inserted in one transaction, so re-uploading a corrected export is safe.
6. **Report** – per file/sheet: detected type, dates stored, rows stored/read, warnings.

| Report | Ingested | Stored as |
|---|---|---|
| Business Report (Seller Central) | ✅ | `daily_asin_sales` source=`seller` |
| Vendor Central sales (see *Vendor Central rules* below) | ✅ | `daily_asin_sales` source=`vendor` |
| SP / SB / SD Campaign (daily **or hourly** — hours are summed per day) | ✅ | `daily_campaign_ads`, `daily_hourly_ads` (hourly exports), `campaign_attrs` (video flag) |
| ASIN Mapper (`ASIN`/`Amazon ASIN` → `Category`, else `Article Type`, else `Sub-Cat`; + Title) | ✅ | `products` (replaces previous mapping) |
| SP / SD Advertised Product | ✅ | `daily_asin_campaign_ads` (per campaign × ASIN) |
| SB Attributed Purchases | ✅ | `sb_attributed_daily` (SB spend prorated at query time, §5) |
| SP / SB Search Term, SD Targeting | ✅ | `daily_search_terms` |
| SP / SB Placement | ✅ | `daily_placements` |
| Order report (Seller, ship-state) | ✅ | `daily_state_sales` source=`seller` |
| Vendor Central *View By = State* | ✅ (same file as Vendor sales) | `daily_state_sales` source=`vendor` |
| Campaign mapper (Category / Type / Targeting / Branded) | ✅ | `campaign_mapper` (replaces previous mapping) |
| Search Query Performance | recognised, not ingested yet | — |

## GCS warehouse (read-only)

The **GCS** tab shows data that comes only from the `rb2f-warehouse-dropzone` bucket — nothing is uploaded by hand there, and the bucket is never written to.

```
gs://rb2f-warehouse-dropzone/<brand>/amazon/<report folder>/<file>.csv
  e.g. eatopia/amazon/{advertised, asin_mapper, campaign, campaign_mapper, placement, seller_central, sqp, str}/…
gs://rb2f-warehouse-dropzone/<brand>/blinkit/<report folder>/<file>.(csv|xlsx|xls)
  e.g. eatopia/blinkit/{ads_sales/{banner_listing, product_listing, product_recommendation}, campaign_mapper, sku_mapper, total_sales, inventory}/…
```

The page has an **Amazon | Blinkit** switch next to the brand picker (remembered per browser). Brand list, *Sync now*, *Re-ingest all*, *Show files* and the report tabs below all follow it; the API takes `marketplace=amazon|blinkit` (default `amazon`, so existing calls are unchanged).

- **Brands** = the bucket's top-level folders (names are trimmed and lower-cased; folders starting with `_`, like `_tmp/`, are ignored). Each brand's data is stored under its own profile **`gcs_<brand>`**, so it never mixes with uploaded profiles. Manual uploads into a `gcs_…` profile are refused.
- **Amazon** reads only the `amazon/` folder (`GCS_MARKETPLACE_FOLDER`); **Blinkit** reads only `blinkit/` (`GCS_BLINKIT_FOLDER`) through the Blinkit pipeline (see "Blinkit"). Every `.csv/.xlsx/.xls` below it, at any depth, goes through the exact upload pipeline (detect by columns → parse → replace-by-date), so the reports are identical to uploading the same files. The report folder stays in the file name (`campaign_mapper/eatopia_campaign_mapper.csv`) and is used by the name fallback of detection.
- **Sync**: picking a brand that was never synced pulls it automatically; *Sync now* pulls new or changed files (by GCS generation), *Re-ingest all* re-reads everything. Mapper files go first, then oldest → newest, so a newer export of the same dates wins. Campaign filters are rebuilt once per sync. Optional background sync: `GCS_SYNC_INTERVAL_MIN`.
- **Ledger**: `gcs_objects` records every object synced (both marketplaces; object names carry the folder, so counts are kept apart) (generation, status, report type, dates, rows); *Show files* on the page lists it. Each file is also in the normal upload log of the `gcs_<brand>` profile.
- Files deleted from the bucket keep their data in the dashboard (same as an upload); re-ingest a corrected file to replace those dates.
- **Warehouse formats** (`apps/api/src/gcs/warehouse.ts`, GCS route only). The warehouse holds the *new Amazon Ads console* exports, which the upload parsers don't read directly; each sheet is rewritten into the classic columns and then parsed / stored exactly like an upload:

  | Folder | Warehouse format | Becomes |
  |---|---|---|
  | `campaign/` | one file for all ad products; `Ad product` = Sponsored Products / Brands / Display | SP / SB / SD Campaign (+ campaign → channel, used by the other files) |
  | `advertised/` | per campaign × ad group × product × day, SP **and SB** | SP / SD Advertised Product, and **SB at ASIN level with its own spend** (no §5 proration needed). SB rows have no product ID — the ASIN is matched by product name (other rows of the file, Business Report and mapper titles), else stored as `UNKNOWN` |
  | `placement/` | `Placement classification` | SP / SB Placement: Top of Search → TOS, Other on-Amazon → ROS, Detail Page → PDP, Homepage kept |
  | `str/` | `Search term`, no targeting columns | SP / SB Search Term; targeting type from the campaign name token (`RB/SP/KT|PT|CT|Auto/…`) |
  | `seller_central/` | Business Report whose `Date` is only the day of month | month / year taken from the file name `…_YYYYMMDD_YYYYMMDD.csv` |
  | `asin_mapper/`, `campaign_mapper/` | same as uploads | unchanged |
  | `sqp/` | Search Query Performance | recognised, not used yet (no screen) |

  Common to all: dates from `Day of Month` + `Month` + `Year`; `Total cost` = spend; `Sales` = ad sales (promoted + halo, so ASIN totals equal campaign totals); `Units sold` = ad units (the campaign file has only `Purchases`, used as units on campaign-fallback days); the channel of advertised / placement / search-term rows comes from the campaign export, else the `SP`/`SB`/`SD` token in the campaign name. Windows-1252 CSVs are converted to UTF-8 so titles, campaign names and search terms match across files. Files are synced in the order mappers → campaign → Business Report → the rest.
- Hour-wise and State Wise Data stay empty for warehouse brands: the bucket has no hourly campaign or order exports.
- Only files that were **stored** are skipped while unchanged; skipped / failed files are retried on every sync.

**Setup**

1. Service account with **Storage Object Viewer** on the bucket → download its JSON key (e.g. `apps/api/gcs-service-account.json` — `*service-account*.json` is git-ignored).
2. `apps/api/.env`: `GCS_CREDENTIALS_FILE=./gcs-service-account.json` (or `GOOGLE_APPLICATION_CREDENTIALS`), optionally `GCS_BUCKET`, `GCS_MARKETPLACE_FOLDER`, `GCS_BLINKIT_FOLDER`, `GCS_SYNC_INTERVAL_MIN` (syncs Amazon and Blinkit), `GCS_MAX_FILE_MB`.
3. `bun run db:migrate` (adds `gcs_objects`, migration 0007) → restart the API → open **GCS**.

On Cloud Run no key is used: the API authenticates as its own service account through the metadata server (grant that account Storage Object Viewer on the bucket). No Google SDK: the client signs the key-file JWT with `node:crypto` and calls the GCS JSON API with `fetch`.

## Vendor Central rules

1. **Ordered** Revenue / Units present → use them (Shipped columns ignored).
2. No Ordered columns → use **Shipped** Revenue / Units.
3. Shipped Revenue = ₹0 but Shipped Units > 0 → revenue = units × **selling price from the ASIN mapper** (`Selling Price` / `Price` / `BAU`, else `Event Price`; never MRP). These units are stored as `unpriced_units` and valued **when the report is queried**, so uploading or fixing mapper prices corrects past revenue without re-uploading the Vendor file. Units with no mapper price are listed in the DSR notes.

Dates: the row's `Date` column, else the day in that block's `Viewing Range=[d - d]` line — several daily exports can be pasted one under another in a single sheet. State-view rows are summed per ASIN per day.

## Storage model

Only **additive raw numbers** are stored, keyed by day. Every ratio is derived from sums at query time, so any range aggregates correctly (§7).

- `daily_asin_sales (profile_id, date, asin, source)` – sales, units, order_items, sessions, page_views. `asin = ''` keeps rows that had no ASIN.
- `daily_campaign_ads (profile_id, date, channel, campaign_name)` – impressions, clicks, spend, ad_sales, ad_units.
- `daily_asin_campaign_ads (profile_id, date, channel, campaign_name, asin)` – SP/SD Advertised Product.
- `daily_hourly_ads (profile_id, date, hour, channel, campaign_name)` – hourly campaign exports.
- `products (profile_id, asin)` – mapper category/title/brand/selling price, last title seen in a report.
- Derived, rebuilt after every upload batch: `campaign_dims` (per campaign: ad type, category, targeting, branding) and `search_term_classes` (Branded / Competitor / Generic per term). `profile_settings.brand_terms` holds the brand words.
- `uploads` – audit log of every file/sheet processed.
- `gcs_objects (profile_id, object_name)` – GCS sync ledger (generation, status, dates, rows).

`profile_id` = brand / seller account (switch it in the top bar).

## Views

**MoM / WoW** (default screen) – the team's summary sheet: Sales, Units, AOV, Sessions, CR%, Organic Sales, Ad Sales, Ad Spends, Ad Units, ACOS%, TACOS%, ROAS for **MTD vs PMTD** and **L7D vs P7D**, with Change %. Windows end on the **latest day with data** (the earlier of the latest sales day and latest ads day, so both sides of a comparison cover the same days): data through 21 Oct → MTD 1–21 Oct vs PMTD 1–21 Sep (clamped at month end, e.g. 31 Mar → 1–28 Feb), L7D 15–21 Oct vs P7D 8–14 Oct. Every value uses the same rules as the DSR (ratios recomputed from each period's totals). Sessions = Seller Business Report sessions (Vendor has none); CR% = Units ÷ Sessions. *As of* date and Category filter on the screen; notes flag periods with missing upload days.

**DSR** – one row per date + TOTAL and AVG rows. Sales/Units = Seller + Vendor (§4), Page Views = Seller *Page Views - Total* + Vendor *Glance Views*, ad metrics = rule book Main View sources: SP & SD **Advertised Product** reports + SB **Attributed Purchases** (Ad Sales/Units direct; Spend/Impressions/Clicks prorated from the SB Campaign report by attributed-sales share, §5 — spend on campaign-days with no attributed purchase can't be allocated and is listed in the notes). A day missing the ASIN-level report for a channel falls back to that channel's campaign report (flagged on the channel card), Organic Sales = Sales − Ad Sales. Ratios with a zero denominator show `—`, not 0.

**Category filter on DSR / DUR** – pick a category in the top bar. DSR: Sales/Units/Page Views of that category's ASINs; SP/SD ads of its ASINs; SB ad sales of its ASINs with spend prorated by attributed-sales share; campaign-report fallback days count campaigns of that category. DUR: only that category's ASIN rows.

**DUR** – ASIN × date pivot with Totals and Avg (Totals ÷ days in range). Item-name and Category come from the ASIN mapper (`Unmapped` if absent). Rows whose source ASIN was blank appear as a separate `null` row.

**Comparison** – every tab except DSR/DUR has *Compare with* in the top bar (defaults to the equal-length period just before the selected range; editable). Each number then shows the comparison value and Δ% underneath (green = better; for CPC, ACoS and TACoS a decrease is better). Charts show both periods in their tooltips.

**Shared ad filters** – views built 100% on ads data (Search Terms, Placements, Ads Analysis, Hour-wise) filter by **Category, Ad type, Targeting and Branding**. Each campaign gets those dimensions in `campaign_dims`:
- *Ad type* SP / SB / SBV / SD / SDV — campaign mapper `Type`, else channel + video signals (video columns or `SBV/SDV/video` in the name).
- *Category* — campaign mapper `Category`, else the category of the ASINs it advertises (rule book §3), else `Unmapped`.
- *Targeting* Keyword / Product / Category / Auto / Audience — campaign mapper `Targeting` (KT/PT/CT/Auto…), else its dominant search-term target type.
- *Branding* — campaign mapper `Branded`, else its dominant search-term class.

These classes and dimensions **build themselves**: every report checks they exist and cover every search term, and rebuilds if not (e.g. data uploaded before these tables existed). If brand terms are empty they're seeded from product titles. Force a rebuild with `POST /api/reports/rebuild-dims?profileId=…`.

Search-term level views (Search Terms; Ads Analysis targeting/branding tables) use each row's own target type and term class instead of the campaign's. **Branded** = contains a brand term or is one of your ASINs; **Competitor** = an ASIN code (`b0…`, 10 chars) not in your ASIN mapper; **Generic** = everything else. Brand terms are seeded from the mapper `Brand` column (else the commonest first word of titles) and are editable on the Ads Analysis tab — saving reclassifies everything.

**Category** (§10.4) – DSR columns grouped by ASIN-mapper category, donut of share for a chosen metric and TACoS bars, then the **ASIN table** below. The category select (or clicking a category row) filters the ASIN table. `Unmapped` = ASIN not in mapper, `(missing ASIN)` = blank ASIN in the source.

**Search Terms** – SP + SB customer search terms and SD targets, grouped by term (top 500 by Spend; search box for the rest). **Targeting** column = the target type(s) and the keywords/ASINs that triggered the term; **Campaigns** column = campaigns it appeared in (top 10 by spend). Top-10 spend bars and a Branded/Competitor/Generic donut.

**Placements** – SP + SB as TOS / ROS / PDP with every ad metric, a bar chart for any selected metric, and a spend-share donut.

**State Wise Data** (§8 name) – Sales, units, orders and ASINs per ship-to state with an **India heat map** (hover a state for orders, units, sales and the comparison period) and a share donut. Seller rows from the **Order report**, Vendor rows from the Vendor Central *State* view. State names are normalised (abbreviations, old names, typos). Filters: source, category. Map: [svg-maps/india](https://github.com/VictorCazanave/svg-maps) (CC BY 4.0); Ladakh is drawn within J&K.

**Ads Analysis** – three tables, each with a donut: **ad types** (SP / SB / SBV / SD / SDV, campaign reports + Advertised Product), **targeting** (search-term reports), and **Branded / Competitor / Generic**. SB here is the full SB campaign spend (the DSR only counts the part that can be prorated to ASINs, §5).

**Hour-wise** – all ad metrics for hours 00–23 from hourly campaign exports, with a column chart for the selected metric. Only channels with hourly exports appear (Cult: SP).

## Decisions to confirm (from the rule book's open questions)

- **DUR values: units vs orders** (§10.2) — both are available via the *Units sold / Orders* toggle (`metric=units|orders`). *Orders* = Seller "Total Order Items"; Vendor has no order count, so Vendor-only cells show `—`. Default is units (matches the report name) — confirm.
- **Page Views** (§10.1) — Vendor *Glance Views* is used only if the column exists in the export; otherwise Vendor contributes nothing and the upload shows a warning.
- **SB spend undercount (§5.6)** — on Cult Aug–Oct data ~25% of SB spend sits on campaign-days with no attributed purchase and is not in DSR Spends. Confirm whether the date-level DSR should add it back (it's known per day; only the ASIN split is impossible).

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/uploads` | multipart: `files[]`, `profileId` |
| GET | `/api/uploads?profileId=` | upload history |
| GET | `/api/reports/summary?profileId&asOf&category` | MoM / WoW (asOf defaults to the latest day with data) |
| GET | `/api/reports/dsr?profileId&from&to&category` | dates `YYYY-MM-DD`, max 367 days |
| GET | `/api/reports/dur?profileId&from&to&metric=units\|orders&category` | |
| GET | `/api/reports/coverage?profileId=` | uploaded ranges per source + ASIN-mapper match rate |
| GET | `/api/reports/category?profileId&from&to&category` | Category view (+ ASIN rows) |
| GET | `/api/reports/search-terms?profileId&from&to&channel&q&sort&limit&category&adType&targeting&branding` | |
| GET | `/api/reports/placements?profileId&from&to&channel&category&adType&targeting&branding` | |
| GET | `/api/reports/ads?profileId&from&to&category&adType&targeting&branding` | Ads Analysis |
| GET | `/api/reports/hourly?profileId&from&to&channel&category&adType&targeting&branding` | Hour-wise |
| POST | `/api/reports/rebuild-dims?profileId` | rebuild campaign filters + Branded/Competitor/Generic |
| GET / PUT | `/api/reports/brand-terms?profileId` | PUT `{ "terms": ["cult", "avant"] }` reclassifies |
| GET | `/api/reports/states?profileId&from&to&source&category` | State Wise Data |
| GET | `/api/gcs/brands?refresh=1&marketplace=amazon\|blinkit` | brand folders in the bucket, last sync, running job |
| POST | `/api/gcs/sync` | `{ "brand": "eatopia", "force": false, "marketplace": "blinkit" }` → 202 + job (runs in background); 429 during a cooldown or when too many syncs run |
| GET | `/api/gcs/files?brand=&marketplace=` | synced objects for a brand (ledger) |
| GET | `/api/blinkit/meta?profileId` | ranges, categories, campaigns + their geography, unmapped items / campaigns, snapshots |
| GET | `/api/blinkit/mom?profileId&asOf&category` | MoM / WoW (same shape as `/api/reports/summary`) |
| GET | `/api/blinkit/dsr?profileId&from&to&category` | raw sums per day + PL / PR / BL spend split |
| GET | `/api/blinkit/dur?profileId&from&to&metric=units\|orders\|revenue&category` | item × date (same shape as `/api/reports/dur`) |
| GET | `/api/blinkit/groups?profileId&from&to&category&groupBy=category\|sku` | Category view |
| GET | `/api/blinkit/geo?profileId&from&to&category` | sales by customer state / city |
| GET | `/api/blinkit/city-ads?profileId&from&to&category` | ads of exact-city campaigns only + not-attributable total |
| GET | `/api/blinkit/keywords?profileId&from&to&category&geo&campaignId&adType&grain&q&minImpr&sort&limit` | |
| GET | `/api/blinkit/inventory?profileId&snapshot&category` | run rate + days of cover per item × feeder |
| GET | `/api/blinkit/inventory/trend?profileId&category&itemId&facilityId` | DOC across daily snapshots |
| POST | `/api/blinkit/uploads` | multipart `files`, `profileId` — Blinkit files for a non-GCS profile |
| GET | `/health` | liveness |
| GET | `/health/db` | readiness — 503 when the database doesn't answer |

## Blinkit

Blinkit runs on the same flow (GCS `<brand>/blinkit/` → detect by columns → parse → replace-by-date → reports) in its own module: `apps/api/src/blinkit`, `bk_*` tables (migration `0010_blinkit`), `@dash/shared/blinkit`, `apps/web/components/blinkit`. Nothing in the Amazon pipeline changed except the marketplace switch on the GCS sync.

| File | Recognised by | Stored as | Date |
|---|---|---|---|
| Sales (Sales Summary) | `Order Id` + `Item Id` + `Total Gross Bill Amount` | `bk_sales_lines` (order line; orders = distinct Order Id) | `Order Date` |
| Ads — `PRODUCT_LISTING` / `PRODUCT_RECOMMENDATION` / `BANNER_LISTING` tabs | `Campaign ID` + `Estimated Budget Consumed` + (`Targeting Value` / `Direct ATC` / `Reach`) | `bk_daily_ads` ad_type PL / PR / BL | `Date` (dd-mm-yyyy) |
| Inventory (Stock On Hand, daily) | `Item ID` + `Warehouse Facility ID` + `Total sellable` | `bk_inventory`, one snapshot per day | "This sheet was generated at …", else `InventoryData - YYYY-MM-DD…` in the file name; else rejected |
| SKU mapper | `Product Name` / `Item ID` + `SKU` (+ `Category`, `Price`) | `bk_sku_map` (replaces previous) | — |
| Campaign mapper | `Campaign Name` / `Campaign ID` + `Category` / `SKU` / **`City`** (also side-by-side ID blocks) | `bk_campaign_map` (per sheet / file source) | — |

Warehouse layout (as the bucket has it): `ads_sales/banner_listing`, `ads_sales/product_listing`, `ads_sales/product_recommendation` (one CSV per ad type, e.g. `eatopia_product_listing_20260201_20260228.csv`), `campaign_mapper`, `sku_mapper`, `total_sales`; daily inventory files can go in `inventory/`. Folder names don't matter for detection (columns decide), only for sync order.

Sync order: mappers → ads → sales → inventory, oldest → newest. Cancelled / returned lines are dropped; duplicate order lines (overlapping exports) count once — but when `S.No.` is present, two lines of the same Order Id × Item Id with different S.No. are both kept (quantities summed).

**Dates.** Day/month order is inferred per file and column: a value > 12 in the first part means D/M, in the second part M/D; when every value is ambiguous, the `_YYYYMMDD_YYYYMMDD` range in the file name decides. The warehouse `total_sales` export uses `M/D/YYYY` (`2/13/2026`), the ads exports `DD-MM-YYYY`.

**Warehouse campaign mapper.** Several side-by-side blocks headed `Campaign Name` (some with an unlabelled category column right after the name — read as that block's Category). It has no `SKU` or `City` column, so ads by SKU show "<Category> (no SKU)" and city comes from the campaign name: full names, common aliases and 3-letter codes (`Hyd`, `Ahm`, `PNQ`, `BLR`, `GGN`, `Mum`…). "Top 5 cities" / "oth-top cities" are never city-level. Add `SKU` / `City` columns to the mapper to override. Revenue = Total Gross Bill Amount; Ad Sales / Ad Units / ATC = direct + indirect; Spend = Estimated Budget Consumed; Most Viewed Position is impression-weighted.

**Tabs** (GCS page → Blinkit): **MoM / WoW** (same table as Amazon, plus Blinkit ad rows), **DSR** (one row per date, TOTAL + AVG, PL / PR / BL spend cards), **DUR** (Item ID × date; units / orders / sales), **Category** (category or SKU table with *Compare with*, share donut, TACoS bars, daily trend), **City Wise Data**, **Keywords**, **Inventory · DOC**.

**City-level ads — exact targeting only.** Blinkit ad reports carry no city. A campaign's spend is shown at city level only when its targeting is one city or cities inside one metro (Delhi NCR, Mumbai MMR, Chandigarh Tricity), from the campaign mapper's `City` column, else an unambiguous city in the campaign name. Several metros → a group row, never split. Top City / ROC / Pan-India / no city → excluded and reported as one *not city-attributable* total (attributable + not attributable = total spend). Nothing is allocated by revenue share. The Keywords city filter follows the same rule. Blinkit's Sales report books Noida / Greater Noida orders under customer city *Ghaziabad* (UP-NCR), so a Noida campaign is matched to Ghaziabad sales (`SALES_CITY_OF` in `geo.ts`).

**Inventory · DOC** (per item × feeder warehouse): run rate = `Last 7 days` ÷ 7 (per facility, from the report itself); DOC = `Total sellable` ÷ run rate; *DOC incl. incoming* adds `Incoming scheduled inventory`. Status: stock-out · critical < 7 d · low < 15 d · healthy · excess > 45 d · no sales L7D · inactive (`BK_DOC_BANDS`). Views: SKU × feeder matrix, by SKU (feeders at risk), detail; trend once ≥ 2 snapshots exist. Feeder → city from the facility name (Kundli / Farukhnagar / Faridabad → Delhi NCR).

**Label aliases.** The SKU mapper and campaign mapper don't share labels (`NPD-NCS` vs `NCS`, `Farmer's Honey` vs `Harvest Honey`, `Gift Box` vs `Gift hamper`); `packages/shared/src/blinkit/categories.ts` normalises them — extend per brand with `BK_CATEGORY_ALIASES` / `BK_SKU_ALIASES` (JSON).

Setup: `bun install` (no new packages) → `bun run db:migrate` (0010) → put files under `<brand>/blinkit/…` → GCS page → **Blinkit** → *Sync now*.

## Adding the next report type

1. Add/flip it in `packages/shared/src/report-types.ts` (`inScope: true`).
2. Write a pure parser in `apps/api/src/ingestion/parsers/` + a test in `apps/api/test/`.
3. Add a table in `db/schema.ts` → `bun run db:generate` → `bun run db:migrate`.
4. Wire it in `ingest.service.ts` and `store.ts`.
