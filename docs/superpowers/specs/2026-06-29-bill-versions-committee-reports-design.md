# Bill Versions & Committee Reports Scraping

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan

## Goal

Capture, for each bill, the full set of measure versions ("All Versions of this
Measure") and committee reports ("Committee Reports") shown on the bill's
individual page, and store them in two new tables. Each row records the
document's label, its HTML and PDF links, and the raw text of the HTML document.
The raw text exists so a downstream AI step can summarize each document into
readable form (that summarization step is out of scope here, but the schema
leaves room for it).

## Background

The individual-bill scraper (`server/services/scraping/individual-bill.js`)
already fetches each bill's detail page with axios and parses it with Cheerio.
The same page contains two sections we are not yet capturing:

- **All Versions of this Measure** — every amended version of the bill
  (`SB1186`, `SB1186_SD1`, `SB1186_HD3`, …), each with an `.HTM` and `.PDF` link.
- **Committee Reports** — each committee report that accompanied the bill at a
  stage (`SB1186_HD1_HSCR1175_`, `SB1186_CD1_CCR112_`, …), each with an `.htm`
  and `.pdf` link.

These mirror the existing `status_updates` pattern (rows keyed to a bill,
written during the individual scrape) but differ in one key way: published
documents are **immutable** once posted, so we fetch their raw text once and
never re-fetch.

### Verified facts from the sample page (`hawaii-data-test.html`, bill SB1186)

- Version links: `#MainContent_RepeaterVersions_VersionsLink_<N>` (label is the
  link text, e.g. `SB1186_HD3`; href is the `.HTM`) paired with
  `#MainContent_RepeaterVersions_PdfLink_<N>` (href is the `.PDF`). The `<N>`
  suffix reliably pairs the HTML and PDF link for the same version. 7 versions
  present.
- Report links: `#MainContent_RepeaterCommRpt_CategoryLink_<N>` (label is link
  text, e.g. `SB1186_HD1_HSCR1175_` — **note the trailing underscore**; href is
  the `.htm`) paired with `#MainContent_RepeaterCommRpt_PdfLink_<N>` (`.pdf`
  href). 6 reports present.
- **Hrefs are root-relative** (`/sessions//session2025/CommReports/...`) and
  must be made absolute against `https://data.capitol.hawaii.gov`.
- **Session-year mismatch:** on the same page, version hrefs point to
  `session2024` while report hrefs point to `session2025`. The session year is
  therefore **not** derivable from the bill and MUST be taken from the href
  itself. Rule: store the href as-given (absolutized); never reconstruct a
  document URL from a year field.
- The "Committee Reports" card renders even for bills with zero reports;
  parsing must yield `[]` (not throw) when a section is empty or missing.

## Architecture

A new module `server/services/scraping/versions-reports.js` exposes two
functions with a clean split between pure parsing and DB persistence:

- `parseVersionsAndReports(html)` — **pure**. Takes the page HTML string,
  returns `{ versions: [...], reports: [...] }`. No DB, no network. This is the
  unit-tested surface.
- `saveVersionsAndReports(billId, billNumber, parsed)` — persistence + raw-HTML
  fetching. Upserts rows, then fetches raw HTML for newly-seen rows.

It is called from `scrapeIndividual` **after** the bill row and status updates
are persisted, wrapped in its own `try/catch` so any failure logs a warning but
never fails the main scrape — matching how `checkAndUpdateDeadStatus` and the
LLM classifier are already isolated in `individual-bill.js`.

### Data flow (per bill, per scrape)

1. `scrapeIndividual` fetches the page (already happens) — `response.data`.
2. After bill/status persistence:
   `const parsed = parseVersionsAndReports(response.data)`.
3. `await saveVersionsAndReports(billID, billNumber, parsed)` inside an isolated
   try/catch.
4. For each version/report: upsert `(bill_id, label)` with links (`raw_html`
   left untouched on conflict). Then, for any row whose `raw_html` is still
   null, fetch the linked document and store its text.
5. Any failure (parse, upsert, or a single document fetch) is logged and
   swallowed; other rows and the main scrape proceed.

### Why this shape

- **Reuse the already-fetched page.** The version/report links live in the page
  `scrapeIndividual` already downloaded — no extra request to discover them.
  The only added requests are the per-document raw-HTML fetches, and only on
  first sight of a row.
- **Pure parse function.** Splitting parsing from I/O lets us test against the
  saved fixture with no DB or network.

## Schema

New committed file: `db/migrations/0001_bill_versions_committee_reports.sql`.
Run it against Supabase, then regenerate types with `npm run kysely-codegen`
(updates `db/generated.ts` / `db/generated.d.ts`).

```sql
-- Versions of a measure (from "All Versions of this Measure")
CREATE TABLE bill_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  label       text NOT NULL,        -- e.g. "SB1186_HD3" (link text)
  html_link   text,                 -- absolute URL to .HTM document
  pdf_link    text,                 -- absolute URL to .PDF document
  raw_html    text,                 -- fetched document body (null until fetched)
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (bill_id, label)
);

-- Committee reports (from "Committee Reports")
CREATE TABLE committee_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id     uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  label       text NOT NULL,        -- e.g. "SB1186_HD1_HSCR1175" (trailing _ trimmed)
  report_code text,                 -- last label segment, e.g. "HSCR1175"
  html_link   text,                 -- absolute URL to .htm document
  pdf_link    text,                 -- absolute URL to .pdf document
  raw_html    text,                 -- fetched document body (null until fetched)
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (bill_id, label)
);

CREATE INDEX idx_bill_versions_bill_id ON bill_versions(bill_id);
CREATE INDEX idx_committee_reports_bill_id ON committee_reports(bill_id);
```

### Schema notes

- `uuid` / `gen_random_uuid()` and `timestamptz` match the existing `bills`
  table conventions (`id` is a generated string id; timestamps are `Timestamp`).
- `ON DELETE CASCADE` so deleting a bill cleans up its versions/reports.
- `report_code` is the trailing `_`-delimited segment of the trimmed label
  (`HSCR1175`, `CCR112`, `SSCR68`). Per decision, we store it but do **not**
  decompose it into chamber / type / sequential-number columns.
- `raw_html` is nullable and populated on first fetch.
- Per-bill uniqueness is `(bill_id, label)`. Labels are unique within a bill in
  practice; the constraint enforces it and powers the upsert.

## Parsing & persistence logic

### Labels

- **Versions:** link text is already clean (`SB1186_HD3`). Store as-is, trimmed
  of surrounding whitespace.
- **Reports:** link text has a trailing underscore (`SB1186_HD1_HSCR1175_`).
  Trim trailing underscore(s) → `SB1186_HD1_HSCR1175`. `report_code` = last
  `_`-segment of the trimmed label.

### Links

Root-relative hrefs are absolutized using the same idiom already used in
`all-bills.js`:
`new URL(href, 'https://data.capitol.hawaii.gov').toString()`. The session year
embedded in the href is preserved (see session-year mismatch note above).

### Selectors

Iterate by element, reading the trailing `_<N>` index from each id to pair
HTML and PDF links rather than relying on DOM sibling order:

- Versions: `a[id*="RepeaterVersions_VersionsLink"]` (label + html href) and
  `a[id*="RepeaterVersions_PdfLink"]` (pdf href), matched by `<N>`.
- Reports: `a[id*="RepeaterCommRpt_CategoryLink"]` (label + html href) and
  `a[id*="RepeaterCommRpt_PdfLink"]` (pdf href), matched by `<N>`.

A missing PDF link for a given index leaves `pdf_link` null rather than failing.

### Persistence (upsert, never delete)

```js
await db.insertInto('bill_versions')
  .values({ bill_id, label, html_link, pdf_link })
  .onConflict((oc) => oc.columns(['bill_id', 'label']).doUpdateSet({
    html_link, pdf_link, updated_at: new Date(),
  }))
  .execute();
```

Links refresh on conflict; **`raw_html` is intentionally not in the
`doUpdateSet`**, so an already-fetched body is preserved across scrapes. Same
pattern for `committee_reports` (plus `report_code`).

This differs from `status_updates` (which deletes-then-inserts). Versions and
reports only ever accumulate — a version is never removed once published — so an
accumulating upsert is correct and avoids re-fetching immutable documents.

### Raw-HTML fetch (fetch-once)

After upserting all rows, query which rows for this bill still have
`raw_html IS NULL`. For each:

1. Fetch the row's `html_link` via axios, reusing `getRandomUserAgent()`, the
   `Accept`/`Referer` headers, and `INDIVIDUAL_TIMEOUT` from `config.js`.
2. Extract text with Cheerio: scope to `body`, take `.text()`, collapse runs of
   whitespace. The committee/version `.htm` files are minimal documents; light
   residual noise is acceptable because the consumer is an AI summarizer, so we
   do not over-engineer cleaning.
3. Update only that row's `raw_html` (and `updated_at`).
4. Each fetch is in its own try/catch — one dead link does not stop the others.
5. A short `delay()` (reuse `config.js`) between fetches keeps load on the
   capitol site polite.

Because we only fetch rows with null `raw_html`, steady-state scrapes of an
unchanged bill perform **zero** document fetches.

## Error handling

- The entire versions/reports step in `scrapeIndividual` is wrapped in one
  `try/catch`; on error it logs `[VERSIONS]`-prefixed warnings and returns,
  never throwing into the main scrape.
- Parsing never throws on empty/missing sections — it returns empty arrays.
- Each document fetch is independently guarded.

## Testing

A `server/tests/versionsReports.test.js` using `node:test` + `node:assert`,
matching the existing pure-function test style. It reads
`hawaii-data-test.html` from disk and calls `parseVersionsAndReports(html)`:

- **Versions:** asserts 7 parsed, correct labels in document order
  (`SB1186_HD3`, `SB1186_CD1`, `SB1186_HD2`, `SB1186_HD1`, `SB1186_SD1`,
  `SB1186_SD2`, `SB1186`), and that html/pdf links are absolute and point at the
  href's own session path (e.g. `session2024`).
- **Reports:** asserts 6 parsed, labels have the trailing underscore trimmed
  (`SB1186_SD1_SSCR68`, `SB1186_CD1_CCR112`, …), `report_code` extracted
  (`SSCR68`, `SSCR687`, `HSCR1175`, `HSCR1445`, `HSCR2000`, `CCR112`), links
  absolute against the href's own session path (e.g. `session2025`).
- **Empty/missing section:** parsing an HTML snippet with no versions/reports
  cards yields `{ versions: [], reports: [] }` and does not throw.

Persistence and raw-HTML fetching are not unit-tested (they require a DB and
network); they are kept thin and exercised in integration during a real scrape.

## Out of scope

- AI summarization of `raw_html` into readable form (future work; the schema
  reserves space by storing the text).
- Decomposing `report_code` into chamber/type/number columns.
- Fetching or storing PDF binary content (we store the PDF link only).
- Backfilling versions/reports for bills already in the DB (they will fill in
  naturally on subsequent scrapes; a backfill can be a follow-up).

## File-level change summary

- **New:** `db/migrations/0001_bill_versions_committee_reports.sql`
- **New:** `server/services/scraping/versions-reports.js`
  (`parseVersionsAndReports`, `saveVersionsAndReports`)
- **New:** `server/tests/versionsReports.test.js`
- **Edit:** `server/services/scraping/individual-bill.js` — call
  `saveVersionsAndReports` in an isolated try/catch after bill/status persist.
- **Regenerate:** `db/generated.ts` / `db/generated.d.ts` via
  `npm run kysely-codegen` after the SQL is applied.
