# CSV Upload — Verification Guide

How to verify the `POST /api/upload-csv` endpoint and the two apps that use it.

The endpoint cleans dirty CSV rows from the Hawaii Capitol website (strips HTML,
extracts the real bill URL + fields), validates them, dedups against the DB, and
— for the tracker app — creates org tracking connections.

- **Cleaning + validation:** `server/services/csvCleaner.js`
- **Endpoint:** `server/routes/api.js` → `POST /api/upload-csv`
- **Shared dedup/insert helpers:** `server/services/scrapingService.js`
  (`findExistingBillId`, `insertMinimalBill`)

## Two modes (one endpoint)

| Caller | `user_id` in body? | Behavior |
|---|---|---|
| **Scraper app** (this repo's `CsvUpload.tsx`, admin) | No | Dedup by `(bill_number, year)`. Existing bills skipped, new bills inserted. **No** tracking connection. |
| **Tracker app** (separate client codebase) | Yes | Insert any missing bills, then create an `org_bills` connection (the user's org tracks each bill). Tenant resolved via the `members` table. |

## Setup

```bash
npm install
# Terminal 1 — Express API (serves /api on :3000)
npm start
# Terminal 2 — Vite dev app (proxies /api to :3000), available at :5173
npm run dev
```

Requires `DATABASE_URL` (Postgres/Supabase) in `.env` for the DB-touching steps.

---

## 1. Cleaner unit check (no DB needed)

Confirms HTML is stripped, the real `href` is extracted, and `year` is derived
from the URL's `year=` query param.

Create `test-cleaner.mjs` at the repo root:

```js
import { cleanCsvRow, validateCleanedBill } from './server/services/csvCleaner.js';

const cells = [
  '<a href=/sessions/session2026/bills/HB9_HD1_.pdf></a>',
  '<a href=></a>', '<a href=></a>', '<a href=></a>', '<a href=></a>',
  '<a href=https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=HB&billnumber=9&year=2026>HB9 HD1</a>',
  'Hawaii; Purple Heart State',
  'DESIGNATING HAWAII AS A PURPLE HEART STATE.',
  'Designates Hawaii as a Purple Heart State.  Effective 7/1/3000.  (HD1)',
  'S 3/10/2026: Referred to PSM/WLA.',
  'KONG',
  'PSM/WLA',
];

const cleaned = cleanCsvRow(cells);
console.log(JSON.stringify(cleaned, null, 2));
console.log('valid:', JSON.stringify(validateCleanedBill(cleaned)));
console.log('has HTML:', Object.values(cleaned).some(v => typeof v === 'string' && /<[^>]+>/.test(v)));
```

```bash
node ./test-cleaner.mjs && rm test-cleaner.mjs
```

**Expected:**
```json
{
  "bill_url": "https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=HB&billnumber=9&year=2026",
  "bill_number": "HB9",
  "year": 2026,
  "bill_title": "DESIGNATING HAWAII AS A PURPLE HEART STATE.",
  "description": "Designates Hawaii as a Purple Heart State. Effective 7/1/3000. (HD1)",
  "introducer": "KONG",
  "committee_assignment": "PSM/WLA"
}
valid: {"valid":true,"errors":[]}
has HTML: false
```

The short title (`Hawaii; Purple Heart State`) and the status line
(`S 3/10/2026: ...`) are intentionally ignored per the field mapping.

---

## 2. Scraper app — scraper mode (no `user_id`)

Dedup + insert, no tracking connection.

```bash
curl -X POST http://localhost:3000/api/upload-csv \
  -H 'Content-Type: application/json' \
  -d '{
    "rows": [
      ["<a href=></a>","<a href=https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=HB&billnumber=9&year=2026>HB9 HD1</a>","Hawaii; Purple Heart State","DESIGNATING HAWAII AS A PURPLE HEART STATE.","Designates Hawaii as a Purple Heart State.","S 3/10/2026: Referred to PSM/WLA.","KONG","PSM/WLA"]
    ]
  }'
```

**First call** → `{ "mode": "scrape", "insertedBills": 1, "duplicateBills": 0, "invalidRows": [] }`

**Repeat the same call** → `{ "mode": "scrape", "insertedBills": 0, "duplicateBills": 1, "invalidRows": [] }`
(dedup by `(bill_number, year)` skips the existing bill).

**Verify no HTML reached the DB:**
```sql
SELECT bill_url, bill_title, introducer, committee_assignment
FROM bills WHERE bill_number = 'HB9' AND year = 2026;
-- bill_url is the clean https URL; no `<a>` tags in any column.
```

### Via the UI (this repo)

1. Open `http://localhost:5173`, go to the scraper controls / CSV upload panel.
2. Pick the raw Capitol CSV export. A preview of the first 5 rows shows.
3. Click **Upload**. The toast reports `N inserted, M duplicates` (and any invalid
   rows skipped). Confirm the bills appear clean in the bills table.

---

## 3. Tracker app — tracker mode (`user_id` present)

Inserts missing bills **and** creates the org connection. The separate tracker
client app calls this directly; you can reproduce it with curl.

Pick a `user_id` that has a row in `members` (so a `tenant_id` can be resolved):

```sql
SELECT user_id, tenant_id FROM members LIMIT 1;
```

```bash
curl -X POST http://localhost:3000/api/upload-csv \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id": "<USER_ID_WITH_MEMBERSHIP>",
    "rows": [
      ["<a href=https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=HB&billnumber=9&year=2026>HB9 HD1</a>","Hawaii; Purple Heart State","DESIGNATING HAWAII AS A PURPLE HEART STATE.","Designates Hawaii as a Purple Heart State.","S 3/10/2026: Referred to PSM/WLA.","KONG","PSM/WLA"]
    ]
  }'
```

**First call** →
```json
{ "mode": "track", "tenant_id": "...", "insertedBills": 0, "existingBills": 1,
  "connectionsCreated": 1, "connectionsSkipped": 0, "invalidRows": [] }
```
(`existingBills: 1` if step 2 already inserted HB9; `insertedBills: 1` if it's new.)

**Repeat the same call** → `connectionsCreated: 0, connectionsSkipped: 1`
(the org → bill connection already exists).

**Verify the connection:**
```sql
SELECT ob.tenant_id, b.bill_number, b.year
FROM org_bills ob
JOIN bills b ON b.id = ob.bill_id
WHERE b.bill_number = 'HB9' AND b.year = 2026;
```

**User not in any org** → `400`:
```bash
curl -X POST http://localhost:3000/api/upload-csv \
  -H 'Content-Type: application/json' \
  -d '{ "user_id": "00000000-0000-0000-0000-000000000000", "rows": [...] }'
# { "error": "User is not a member of any organization" }
```

---

## 4. Invalid / dirty rows are rejected (both modes)

Rows with no real bill URL or leftover HTML are **skipped, not inserted**, and
reported in `invalidRows`.

```bash
curl -X POST http://localhost:3000/api/upload-csv \
  -H 'Content-Type: application/json' \
  -d '{
    "rows": [
      ["<a href=></a>","<a href=/local.pdf></a>","short","TITLE","desc","status","INTRO","COMM"]
    ]
  }'
# { "mode": "scrape", "insertedBills": 0, "duplicateBills": 0,
#   "invalidRows": [ { "index": 0, "errors": ["Row could not be parsed"] } ] }
```

---

## Response shape reference

**Scraper mode:**
```json
{ "mode": "scrape", "insertedBills": 0, "duplicateBills": 0,
  "invalidRows": [ { "index": 0, "errors": ["..."] } ] }
```

**Tracker mode:**
```json
{ "mode": "track", "tenant_id": "...", "insertedBills": 0, "existingBills": 0,
  "connectionsCreated": 0, "connectionsSkipped": 0,
  "invalidRows": [ { "index": 0, "errors": ["..."] } ] }
```
