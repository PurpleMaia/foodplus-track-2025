# Committee Chair History — Design

**Date:** 2026-07-30
**Status:** Approved (pending spec review)

## Problem

`committee_chairs` rows are rewritten on every committee scrape. `saveCommittees`
does a blind `DELETE` of a committee's chair rows followed by a fresh `INSERT`.
When a chair changes (e.g. Rep. Jones is replaced by Rep. Smith as chair of FIN),
the old row is gone with no trace, and even unchanged chairs get a reset
`created_at`. There is no way to answer "did this committee's chair change?" or
"who chaired FIN before?".

The `committees` table already handles a *committee* disappearing via `is_active`.
This design gives `committee_chairs` the same soft-delete treatment so a *chair*
being replaced is recorded rather than erased.

## Scope / cadence

Committee scraping is **not** part of the daily bill cron (`server/cron-scrape.js`)
and stays that way. It is a run-once-per-legislative-session task, invoked manually
like the legislators seed:

```
npm run seed:legislators   # chairs FK-link to these — run FIRST
npm run seed:committees     # then this (new alias for scripts/scraping/scrape-committees.js)
```

Because it runs ad-hoc per session rather than on a fixed schedule, the timeline
columns are explicit (`started_at`/`ended_at`) and NOT derived from row-insert time.

## Schema change

Applied to the existing `committee_chairs` table. Captured as a `.sql` file in
`db/migrations/` for the record even though this repo currently applies schema
changes directly in Supabase (the directory is otherwise empty).

```sql
-- Add soft-delete + explicit timeline columns.
ALTER TABLE committee_chairs
    ADD COLUMN is_active   boolean     NOT NULL DEFAULT true,
    ADD COLUMN started_at  timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN ended_at    timestamptz;

-- The old constraint blocks history: a chair who leaves and returns to the same
-- seat would collide with their own retired row. Replace it with a PARTIAL unique
-- index that only constrains ACTIVE rows. Retired rows are unconstrained.
ALTER TABLE committee_chairs DROP CONSTRAINT committee_chairs_unique;

CREATE UNIQUE INDEX committee_chairs_active_unique
    ON committee_chairs (committee_id, legislator_id, role)
    WHERE is_active;
```

Column semantics:
- `started_at` — when this chairship began (set on insert; never changes).
- `ended_at` — when it was retired (null while active).
- `created_at` — reverts to pure row-insert bookkeeping; not used for the timeline.
- `is_active` — true for the current chair set, false for retired rows.

## Save-logic change (`saveCommittees`)

Replace the blind delete+insert with a per-committee diff of scraped-vs-active.

Extract the pure decision into a testable function:

```
diffChairs(activeRows, scrapedPairs) -> { toRetire: [rowId...], toInsert: [pair...] }
```

where a "pair" is `{ legislator_id, role }`.

- **retire:** active rows whose `(legislator_id, role)` is NOT in the scraped set
  → `UPDATE ... SET is_active = false, ended_at = now()`.
- **insert:** scraped pairs NOT already active → `INSERT` with `is_active = true`,
  `started_at = now()`.
- **keep:** pairs present in both → left untouched, so `started_at` is preserved
  (this is the fix for the daily-reset problem).

Everything else in `saveCommittees` (committee upsert, legislator FK resolution,
per-committee try/catch failure isolation, the committee deactivation sweep) is
unchanged.

### Edge cases the diff must handle
- New chair added → insert only.
- Chair removed (seat now empty) → retire only.
- Chair unchanged → no-op (preserves `started_at`).
- Chair A replaced by chair B in same role → retire A, insert B.
- Chair returns to a seat previously held → insert succeeds because the retired
  row is not covered by the partial unique index.

## Read-site impact

Any query reading `committee_chairs` as "current chairs" must now filter
`WHERE is_active`. Audit at implementation time confirmed no read sites exist yet
(only `committees.js` writes the table), so there is no fallout — but this is the
one behavioral contract change to watch for future consumers.

## `ON DELETE CASCADE` note

`committee_chairs.committee_id` has `ON DELETE CASCADE`. History survives only
because the committee deactivation sweep sets `is_active = false` and **never
deletes** committee rows. If a committee row were ever hard-deleted, its chair
history would cascade away. No change needed; documented so the dependency is
explicit.

## Testing

Follows the classifier convention: put the risky logic in a **pure function** so it
is unit-testable without mocking Postgres.

- Unit test `diffChairs(active, scraped)` in `server/tests/committees.test.js`:
  new chair, removed chair, unchanged chair (asserts no retire/insert), replacement,
  and returning chair.
- Existing `parseCommitteeList` tests are unaffected.
- `npm test` must pass.

## Follow-up steps

1. Add `seed:committees` to `package.json` scripts.
2. Regenerate Kysely types after the schema change: `npm run kysely-codegen`
   (adds `is_active`, `started_at`, `ended_at` to the `CommitteeChairs` type).
3. Update the header comment in `scripts/scraping/scrape-committees.js` to mention
   the once-per-session cadence, if not already clear.
