# Bill Introducer → Legislator Matching — Design Spec

Date: 2026-06-29
Target codebase: the client-facing app (Node + Kysely/Postgres, same stack as
the scraper). This spec is portable — paths below are suggestions; adapt to the
client repo's layout.

## Goal

Given a single bill, resolve its `introducer` free-text field into the actual
`legislators` rows that introduced it — for display on a bill detail view
("who introduced this bill?"). Computed **at runtime**, on read. No join
table, no migration, no backfill: the link is always derived from current
`bills.introducer` + `legislators` data and never goes stale.

The reverse direction ("all bills by legislator X") is explicitly out of
scope; if that need arises later, persist a join table then.

## Inputs (verified against live data)

`bills.introducer` is a comma-separated list of legislator surnames. Real
examples and the hazards they create:

| Example introducer string | Hazard it demonstrates |
|---|---|
| `ILAGAN` | single name |
| `KOUCHI (Introduced by request of another party)` | trailing parenthetical annotation — strip it |
| `MCKELVEY, CHANG, HASHIMOTO, Moriwaki, San Buenaventura, Wakai` | comma-separated; **mixed case** (not all-caps) |
| `LEE, C.` / `LEE, M.` | the comma is **NOT a separator** — it is surname + first initial disambiguating the two Lees |
| `DELA CRUZ`, `REYES ODA`, `SAN BUENAVENTURA`, `KEOHOKAPU-LEE LOY`, `LA CHICA` | multi-word / hyphenated surnames — match as a unit |

`legislators` rows expose (at least): `id`, `last_name`, `first_name`,
`party`, `chamber`, `district`, `email` (plus area/room/phone). 76 rows.

### Verified matching constraints (do not skip — each killed a naive approach)

1. **Mixed case.** Match case-insensitively.
2. **Trailing annotation.** `(Introduced by request of another party)` (and any
   parenthetical) is never a name — strip before matching.
3. **Substring collisions make `ILIKE '%name%'` WRONG.** Verified collisions
   among the 76 surnames:
   - `AWA` (Sen. Brenton Awa) is a substring of `KITAGAWA` and `MORIKAWA`.
   - `LEE` is a substring of `KEOHOKAPU-LEE LOY`.
   Matching MUST be **token/word-boundary aware**, not bare substring, or Awa
   gets falsely linked to every Kitagawa/Morikawa bill.
4. **Exactly one duplicate surname: LEE.** Chris Lee (Senate) and Mike Lee
   (House), written `LEE, C.` and `LEE, M.`. Route by first initial so each
   links to only the correct person.
5. **Suffix mismatch.** `legislators.last_name` may carry a suffix the
   introducer omits: `"Alcos III"` vs `ALCOS`. Strip `II/III/IV/V/Jr/Sr`
   from `last_name` before matching.
6. **Unmatched names are normal.** If an introducer name matches no current
   legislator, skip it (their term ended). Never error. Surface it as plain
   text so the UI can still show the name.

## Approach

**Iterate the 76 legislators and regex-test each against the raw introducer
string.** Do NOT tokenize the introducer first — the comma is overloaded
(separator vs. the `LEE, C.` initial delimiter), so tokenizing requires
solving the ambiguity with no ground truth. Iterating legislators flips it:
each legislator is the ground truth ("does this known person appear as a whole
token-run?"). For one bill this is trivially fast (76 cheap regex tests).

Match order (lead introducer first) is recovered from each match's character
offset in the string.

## Components

Suggested location: a server-side service module (e.g.
`server/services/billLegislators.js` or the client repo's equivalent). MUST
run server-side (DB access + regex), not in the React client.

> Implementation note: if `legislators` is not yet in the Kysely generated
> types, access the table/columns via string literals; regenerate types after.

### `matchIntroducer(introducer, legislators)` — PURE, no DB

`legislators`: array of `{ id, last_name, first_name }` (extra fields ignored).
Returns:

```
{
  matched: [ { legislator, introducer_position, is_primary } ],  // sorted by source order
  unmatched: [ "GHOST", ... ]                                    // names with no legislator
}
```

Algorithm:

1. **Pre-clean:** `cleaned = introducer.replace(/\([^)]*\)/g, '').trim()`.
2. **Normalize a surname** (`normalizeLastName`):
   - uppercase
   - strip word-final suffix: `replace(/\s+(?:II|III|IV|V|JR|SR)\.?$/i, '')`
   - collapse internal whitespace to single spaces, trim
   - keep internal spaces and hyphens (multi-word names match verbatim)
3. **Per legislator, build a boundary-safe matcher:**
   - `nameEsc` = regex-escape(normalized surname), then internal ` ` → `\s+`
   - regex: `new RegExp("(?<![\\w-])" + nameEsc + "(?![\\w-])", "i")`
   - The `(?<![\w-])` / `(?![\w-])` lookarounds enforce token boundaries:
     `AWA` fails inside `KITAGAWA` (preceded by `\w`); `LEE` fails inside
     `KEOHOKAPU-LEE LOY` (preceded by `-`). A standalone `AWA` or `LEE, …`
     still matches.
4. **LEE special case:** when `normalizeLastName(last_name) === "LEE"`, ignore
   the generic matcher and require the initial:
   - `initial = first_name.trim()[0].toUpperCase()`
   - regex: `new RegExp("(?<![\\w-])LEE\\s*,\\s*" + initial + "\\.?(?![\\w])", "i")`
   - Routes `LEE, C.` → Chris only, `LEE, M.` → Mike only. If a future
     introducer writes a bare `LEE` with no initial, both miss → it lands in
     `unmatched` for manual review rather than being guessed.
5. **Record matches & order:** for each matching legislator, capture
   `regex.exec(cleaned).index`. Sort matched legislators ascending by offset →
   assign `introducer_position` (0-based) and `is_primary = position === 0`.
6. **Compute `unmatched`:** remove all matched spans from `cleaned`, split the
   remainder on commas, drop empty fragments and lone-initial fragments
   (`/^[A-Z]\.?$/`), trim → leftover names.

### `getBillIntroducers(billOrId)` — runtime helper, DB

- Accept a bill row (with `.introducer`) or a bill id; if id, fetch
  `introducer` from `bills`.
- Load all legislator rows once: `db.selectFrom('legislators').selectAll()`
  (76 rows; `selectAll` so the caller gets name/party/district/email/etc.).
- Run `matchIntroducer`, then return **full legislator rows in introducer
  order** with `is_primary` on the lead, plus `unmatched` names as plain
  strings:

```
{
  introducers: [ { ...legislatorRow, introducer_position, is_primary } ],
  unmatched: [ "GHOST", ... ]
}
```

UI renders `introducers` as linked legislator chips (lead highlighted) and
`unmatched` as plain text.

## Edge cases & decisions

- **Caching:** the 76-row legislator load can be cached in-process (it changes
  ~once per session) to avoid a query per bill on list views; invalidate when
  the legislator scrape runs. Optional; start without it.
- **`bills.introducer` is never null/empty** in current data (verified, 6110
  rows), but the function must tolerate `null`/`""` → return empty matched +
  empty unmatched.
- **Two legislators in one string with the same matched span** can't happen
  except LEE, which is initial-routed.
- **Diacritics** (ʻokina, macrons) appear in `area`, not surnames, so they
  don't affect matching. If a future surname carries them, normalization
  should NOT strip them — match verbatim.

## Testing

Unit test against the **pure** `matchIntroducer` (no DB), inlining a minimal
legislator fixture covering every hazard: Awa, Kitagawa, Morikawa, Lee×2
(Chris/Mike), Keohokapu-Lee Loy, Dela Cruz, Alcos III, Kouchi. Use the client
repo's test runner (here: `node:test` + `assert/strict`). Required assertions:

1. `"KITAGAWA, MORIKAWA"` → matches Kitagawa + Morikawa, **NOT** Awa.
2. `"AWA"` → matches Awa, **NOT** Kitagawa/Morikawa.
3. `"LEE, C."` → Chris only; `"LEE, M."` → Mike only.
4. `"KEOHOKAPU-LEE LOY"` → Keohokapu-Lee Loy, **NOT** either Lee.
5. `"DELA CRUZ"` and `"Dela Cruz"` → Dela Cruz (multi-word + mixed case).
6. `"ALCOS"` → Alcos III (suffix stripped).
7. `"KOUCHI (Introduced by request of another party)"` → Kouchi, no unmatched
   token from the parenthetical.
8. Order/primary: for `"MCKELVEY, CHANG, …"`, first matched has
   `introducer_position === 0` / `is_primary === true`; positions increase by
   source order.
9. `"GHOST, AWA"` → Awa matched, `"GHOST"` in `unmatched`, no error.
10. `null` / `""` introducer → empty matched + empty unmatched, no throw.

### Live spot-checks (after wiring `getBillIntroducers`)

- A `KITAGAWA`-only bill → Awa absent from `introducers`.
- A `LEE, C.` bill → only Chris Lee present.
- `SB1170` (`MCKELVEY, CHANG, HASHIMOTO, Moriwaki, San Buenaventura, Wakai`)
  → all six in order, McKelvey primary.
- Eyeball recurring `unmatched` names — a frequent one is likely a term-ended
  legislator (expected per constraint 6), not a matcher bug.

## Out of scope

- Bill-by-legislator reverse queries / analytics (would need a persisted join
  table).
- Persisting matches; any migration.
- The React/UI rendering itself — this spec delivers the server-side helper
  and its contract.
