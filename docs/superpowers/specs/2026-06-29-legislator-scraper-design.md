# Legislator Scraper — Design

Date: 2026-06-29

## Goal

Scrape the Hawaii State Legislature legislators page and store each
legislator's contact information in the database, preserving history so that
archived bills can be traced to whoever introduced them (even after that
person leaves office).

Source page: https://data.capitol.hawaii.gov/legislature/legislators.aspx

Each legislator is rendered as a repeating card. Example card content:

```
Dela Cruz, Donovan M. (D)
Senate District 17
Portion of Mililani, Mililani Mauka, portion of Waipi'o Acres, Launani Valley, Wahiawā, Whitmore Village
Hawai'i State Capitol, Room 208
Phone/Fax: 808-586-6090
sendelacruz@capitol.hawaii.gov
```

## Scope / wiring

Standalone, on-demand scraper. **Not** wired into the daily bill cron
(`server/cron-scrape.js`). Legislator data changes roughly once per session,
so a daily re-scrape would be wasted work. Run manually via a script.

Mirrors the existing bill-scraper patterns: `axios` + `cheerio` + `kysely`,
reusing retry/timeout constants from
`server/services/scraping/config.js` (`MAIN_LIST_TIMEOUT`,
`MAIN_LIST_MAX_RETRIES`, `MAIN_LIST_RETRY_DELAY`, `getRandomUserAgent`,
`delay`).

## Data model

The migration is provided as golang-migrate up/down SQL at
`db/migrations/000006_create-legislators-table.{up,down}.sql` (matching the
repo's existing migration format and conventions — `gen_random_uuid()`,
`timestamptz ... DEFAULT now()`, `public.` schema). The user commits/applies
it. The scraper's save logic assumes the following `legislators` table. UUID
primary key, matching the `bills` table convention (`id: Generated<string>`).

| column        | type                     | notes |
|---------------|--------------------------|-------|
| `id`          | uuid PK (generated)      | surrogate key |
| `member_id`   | text, **unique, not null** | Capitol's per-person id, from `member=NNN` in the card's `#member-link` href. Person identity key. |
| `last_name`   | text                     | parsed from name card |
| `first_name`  | text                     | parsed from name card (includes middle initial, e.g. "Donovan M.") |
| `party`       | text (`'D'` / `'R'`)     | the `(X)` suffix |
| `chamber`     | text (`'House'` / `'Senate'`) | first word of the district line |
| `district`    | integer                  | number in the district line |
| `area`        | text                     | region description |
| `room`        | text, nullable           | from the address block |
| `phone`       | text, nullable           | from the address block |
| `email`       | text, nullable           | from the `mailto:` link |
| `in_office`   | boolean, not null, default true | maintained by the scraper |
| `term_ended`  | date, nullable           | parsed from `Term of Office Ended: MM/DD/YYYY` when present |
| `created_at`  | timestamptz              | like `bills` |
| `updated_at`  | timestamptz              | like `bills` |

**Identity key:** `member_id` identifies a *person*. The same person updates
in place across runs. A seat changing hands is handled by `in_office`
(see Save logic), not by overwriting the person — this preserves history.

## HTML structure (verified against live page 2026-06-29)

The page contains 76 active cards (51 House + 25 Senate). The repeating unit:

```html
<div id="..._memberDiv_N" class="... legislator-list">
  <div class="contact-box center-version active">
    <a id="member-link" href='/legislature/memberpage.aspx?member=162&year=2026'>
      <img src='/MemberFiles/RepSenPhotos/delacruz.jpg' .../>
      <h2 class="namecard"><strong>
        Dela Cruz, Donovan M. (D)
      </strong></h2>
    </a>
    <div class="district">
      Senate District 17
      <br />
      <strong>Portion of Mililani, ... Whitmore Village</strong>
      <span id="..._LabelChairDistrict_N"></span>
    </div>
    <div id="..._PanelMemberContactInfo_N">
      <address>
        Hawai'i State Capitol, Room 208<br />
        Phone/Fax: 808-586-6090<br />
        <a href='mailto:sendelacruz@capitol.hawaii.gov'>sendelacruz@capitol.hawaii.gov</a>
      </address>
      ...
    </div>
  </div>
  ...
</div>
```

Selector anchors:
- Card: `div.legislator-list`
- Member id: `#member-link` (or `a[id="member-link"]`) `href`, extract `member=(\d+)`
- Name: `h2.namecard`
- District/area: `div.district` (text for chamber+district; inner `<strong>` for area)
- Contact: `address`

### Parsing edge cases (observed)

- **Name whitespace:** the name `<h2>` can contain newlines (e.g. "Elefante,
  Brandon J.C.\n (D)"). Collapse whitespace before parsing.
- **Name split:** `"Last, First M. (P)"` — split on the **first** comma →
  `last_name` = before; remainder = `"First M. (P)"`; strip trailing `(P)`
  to get `party` and `first_name`.
- **Phone formats:** 25 cards use a single combined line `Phone/Fax: NNN`;
  51 cards use separate `Phone: NNN` and `Fax: NNN` lines. Capture the
  **Phone** number (the combined line's number when only that exists).
- **Title text** (e.g. "Asst. Minority Leader") may appear in/near the name
  block — ignored.
- Room / phone / email are each individually nullable — capture what's
  present, leave the rest null.

## Components

### `server/services/scraping/legislators.js`

Two exported functions, mirroring `all-bills.js`:

- `scrapeLegislators()` — fetch the page with retry (reusing the
  `MAIN_LIST_*` retry/timeout approach from `scrapeBills`), then
  `$('div.legislator-list')` → array of parsed legislator objects. Each
  object also carries an `outOfOffice` boolean (see below). Per-card parse
  errors are caught and logged; the scrape continues.

- `saveLegislators(legislators)` — history-preserving upsert (below).
  Returns a summary `{ total, inserted, updated, deactivated, failures }`.

### `scripts/scraping/scrape-legislators.js`

Thin runnable entry: `node scripts/scraping/scrape-legislators.js`. Calls
`scrapeLegislators()` then `saveLegislators()`, logs the summary. No cron
wiring.

## Save logic (history-preserving)

1. Scrape all current cards. For each card capture its `member_id`, the
   parsed attributes, and an `outOfOffice` boolean — `true` if the card's
   text matches any out-of-office marker phrase.
2. Upsert each scraped legislator by `member_id`:
   - exists → update all attributes, set `in_office = !outOfOffice`.
   - new → insert, `in_office = !outOfOffice`.
3. Any stored row whose `member_id` is **not** in the current scrape →
   set `in_office = false`. No sane-count guard: a person absent from the
   scrape is treated as out of office.

A seat changing hands therefore results in: the previous occupant flipped to
`in_office = false` (row + history retained), and the new occupant inserted
as a new row. Archived bills referencing a historical introducer can still
resolve the person.

### Out-of-office detection

Two signals, both flipping `in_office = false`:

1. **Absence from the scrape** (step 3) — a stored `member_id` not present in
   the current scrape.
2. **In-card verbiage** — a card containing the text
   `Term of Office Ended: MM/DD/YYYY`. When this appears, set
   `in_office = false` and parse the trailing date into `term_ended` (a
   nullable date column). The match is a case-insensitive regex
   `/Term of Office Ended:\s*(\d{1,2}\/\d{1,2}\/\d{4})/`.

The live `MembersActive` repeater currently shows only active members (no
such verbiage present 2026-06-29), but cards can carry this string when a
member's term has ended, so the parser handles it.

## Error handling

- Network/timeout: same retry approach as `scrapeBills` (reuse
  `MAIN_LIST_MAX_RETRIES` / `MAIN_LIST_RETRY_DELAY` / `MAIN_LIST_TIMEOUT`),
  throw after exhausting retries.
- Per-card parse errors: caught and logged, collected into `failures`,
  scrape continues.

## Testing

Unit test under `server/services/scraping/` (`node --test`, matching the
existing `server/**/*.test.js` setup), running the **parser** against a
saved HTML fixture of this page. Assertions:

- The Dela Cruz card parses to the expected object (Senate, district 17,
  party D, combined Phone/Fax, email present, room 208).
- The Elefante card (name with embedded newline) parses with correct
  first/last name and party.
- A card using separate `Phone:` / `Fax:` lines captures the Phone number.

The fixture is a saved copy of the live HTML so the parser test runs without
network access. Save logic (DB upsert) is exercised manually via the script;
no DB integration test in this scope.

## Out of scope

- Applying/committing the migration (SQL is written here; the user runs it).
- Regenerating `db/generated.ts` types (the user does this after migrating).
- Cron / scheduling.
- Linking `bills.introducer` to `legislators` rows (future work; this design
  only ensures the history needed for it exists).
