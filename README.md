# Amazon Dashboard

Upload raw Amazon **Seller Central / Vendor Central / Ads** exports → the API detects each report, parses it, and stores it **per day** → the web app shows the **DSR** (Daily Sales Report) and **DUR** (Daily Units Report) for any date range.

Business logic follows `GCP_Dashboard_Rule_Book.md` (§3 categorisation, §4 Seller + Vendor combination, §7 metric formulas, §9 cleaning, §10 DSR/DUR).

## Layout (npm workspaces monorepo)

```
apps/
  api/        Express 5 + TypeScript + Drizzle ORM (Postgres)   → http://localhost:4000
  web/        Next.js 16 (App Router) + Tailwind 4              → http://localhost:3000
packages/
  shared/     Types + metric formulas used by both (ships TS source, no build step)
docker-compose.yml   local Postgres 16
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
    gcs-client.ts            read-only GCS JSON API client (service-account JWT, no Google SDK)
    paths.ts                 bucket layout → brands / files (pure, unit-tested)
    gcs-sync.service.ts      bucket files → the same ingest pipeline, per brand profile
    gcs.router.ts            /api/gcs/*
  reports/
    dsr.service.ts           GET /api/reports/dsr
    dur.service.ts           GET /api/reports/dur
    coverage.service.ts      GET /api/reports/coverage
apps/web
  app/upload/page.tsx        drag-and-drop upload + per-sheet results + history
  app/reports/page.tsx       report tabs for the profile in the top bar (uploaded data)
  app/gcs/page.tsx           same report tabs for a brand synced from the GCS warehouse
  components/reports-dashboard.tsx  the shared report tabs used by both pages
```

## Getting started

Requirements: **Node 22+**, and Docker (for Postgres) — or any Postgres 14+ and a `DATABASE_URL`.

```bash
npm install
npm run db:up                         # starts Postgres on :5432 (user/pass/db = dash)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run db:migrate                    # creates the tables
npm run dev                           # api :4000 + web :3000
```

Open http://localhost:3000 → **Upload** → drop your exports → **Reports**.

**Upgrading an existing install:** `npm install` (new web dependency `@svg-maps/india`) → `npm run db:migrate` (0004–0006 recreate the Advertised Product table and add the campaign-dimension tables) → re-upload the SP/SD Advertised Product, campaign, search-term and placement exports so the per-campaign dimensions are rebuilt.

Other scripts: `npm run typecheck`, `npm test`, `npm run build`, `npm run db:generate` (after editing `apps/api/src/db/schema.ts`), `cd apps/api && npm run db:studio`. Works the same with `bun run` in place of `npm run`.

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
```

- **Brands** = the bucket's top-level folders (names are trimmed and lower-cased; folders starting with `_`, like `_tmp/`, are ignored). Each brand's data is stored under its own profile **`gcs_<brand>`**, so it never mixes with uploaded profiles. Manual uploads into a `gcs_…` profile are refused.
- **Only the `amazon/` folder** is read (`GCS_MARKETPLACE_FOLDER`). Every `.csv/.xlsx/.xls` below it, at any depth, goes through the exact upload pipeline (detect by columns → parse → replace-by-date), so the reports are identical to uploading the same files. The report folder stays in the file name (`campaign_mapper/eatopia_campaign_mapper.csv`) and is used by the name fallback of detection.
- **Sync**: picking a brand that was never synced pulls it automatically; *Sync now* pulls new or changed files (by GCS generation), *Re-ingest all* re-reads everything. Mapper files go first, then oldest → newest, so a newer export of the same dates wins. Campaign filters are rebuilt once per sync. Optional background sync: `GCS_SYNC_INTERVAL_MIN`.
- **Ledger**: `gcs_objects` records every object synced (generation, status, report type, dates, rows); *Show files* on the page lists it. Each file is also in the normal upload log of the `gcs_<brand>` profile.
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
2. `apps/api/.env`: `GCS_CREDENTIALS_FILE=./gcs-service-account.json` (or `GOOGLE_APPLICATION_CREDENTIALS`), optionally `GCS_BUCKET`, `GCS_MARKETPLACE_FOLDER`, `GCS_SYNC_INTERVAL_MIN`, `GCS_MAX_FILE_MB`.
3. `npm run db:migrate` (adds `gcs_objects`, migration 0007) → restart the API → open **GCS**.

No new npm packages: the client signs the service-account JWT with `node:crypto` and calls the GCS JSON API with `fetch`, using the read-only scope.

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
| GET | `/api/gcs/brands?refresh=1` | brand folders in the bucket, last sync, running job |
| POST | `/api/gcs/sync` | `{ "brand": "eatopia", "force": false }` → 202 + job (runs in background) |
| GET | `/api/gcs/files?brand=` | synced objects for a brand (ledger) |
| GET | `/health` | |

## Adding the next report type

1. Add/flip it in `packages/shared/src/report-types.ts` (`inScope: true`).
2. Write a pure parser in `apps/api/src/ingestion/parsers/` + a test in `apps/api/test/`.
3. Add a table in `db/schema.ts` → `npm run db:generate` → `npm run db:migrate`.
4. Wire it in `ingest.service.ts` and `store.ts`.
