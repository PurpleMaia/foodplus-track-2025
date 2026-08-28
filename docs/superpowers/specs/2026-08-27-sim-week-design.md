# Parsing Simulation Framework ("Sim Week") — Design

**Date:** 2026-08-27
**Status:** Approved design, ready for implementation plan
**Author:** Jaden + Claude

## 1. Purpose

A week-long simulation (Sept 14–18, 2026) that exercises the real
scrape → classify → notify pipeline end-to-end using **fake bills**, so
advocates can be trained / a demo can be run without touching real
Capitol data. Each simulated day, fake bills move through kanban stages:

- **4 "auto" bills** carry out the full bill cycle **no matter what input** —
  2 follow Scenario 1, 2 follow Scenario 2.
- **16 "user-driven" bills** follow the same two scenarios but **die** at a
  checkpoint unless the required user action happened before that day.

Two user actions drive movement:

- **Contact a legislator** while a bill is *waiting* → the bill is cached to
  move to **SCHEDULED** on the next scrape. Recorded by a **manual flag
  script** (participants email Jaden fake emails; Jaden flags the bill).
- **Complete a testimony** (support or oppose) → the simulated committee
  **passes** (support) or **defers** (oppose) the bill. Read from the real
  **`testimonies`** table written by the separate front-facing app.

## 2. Non-goals

- No LLM involvement anywhere. Stage derivation stays on the existing
  deterministic classifier. (This is a hard project rule.)
- No changes to the real classifier rules, kanban enum, or notification
  rendering. The sim only *feeds inputs* to the existing pipeline.
- No new user-facing UI in this repo. Interaction is: real testimony in the
  other app + a CLI flag script for contact.
- Not a permanent feature. It is reset-able and isolated; production bills
  are never affected.

## 3. Isolation model (how fake bills stay separate)

Fake bills live in the real `bills` table but are identified **only** by a
sentinel `bill_url`, exactly like the existing classifier-test harness
(`test://classifier-harness/…`). Sim bills use:

```
bill_url = test://sim-week/<SIM_ID>      e.g. test://sim-week/SIM-03
```

- Real scraped bills never use a `test://` URL, so the sim is invisible to
  production queries that filter real bills, and vice versa.
- **`reset.js` deletes only `bill_url LIKE 'test://sim-week/%'`** rows and
  their `status_updates`, plus any sim-created `testimonies` rows and the
  local flag file. Nothing else is touched.
- Sim bills DO appear to the notification system (which reads all living
  bills / followers), which is intentional — that is what we are testing.
  Followers for sim bills are created in `user_bills` pointing at Jaden's
  user id so digests/deadline emails land in `ALERT_EMAIL`.

## 4. Time model

Driven by **real calendar dates**, Sept 14 (Mon) – Sept 18 (Fri) 2026. The
real daily cron, when it runs on one of those dates, advances every sim bill
by that day's scenario step. There is **no separate scheduler**; the cron
already runs daily (see project docs).

A "sim-day" is the ordinal position of today's date within the sim week:

```
2026-09-14 → day 1 (Mon)
2026-09-15 → day 2 (Tue)
2026-09-16 → day 3 (Wed)
2026-09-17 → day 4 (Thu)
2026-09-18 → day 5 (Fri)
```

Dates outside the window are a no-op for the sim. The date is injectable
(default `new Date()`), so the on-demand day-runner (§8) can drive any
sim-day without waiting for the real calendar — satisfying the "quick
scrape and notices" test requirement.

### Idempotency

Running the same sim-day twice must not double-advance a bill. The engine is
**declarative, not incremental**: for a given `(bill, sim-day)` it computes
the *full desired `status_updates` log up to and including that day* and
does a delete-then-insert replace (same pattern as `saveUpdates` /
`replaceStatusUpdates`). Re-running day 3 reproduces the day-1..3 log
exactly. This makes the sim safe to re-run and safe if the cron fires twice
in a day (the project notes a 3pm + 5am cadence).

## 5. The two scenarios

Mapped from Jaden's table onto the kanban enum (`server/kanban-columns.js`)
and real Capitol status-line wording (so the existing classifier derives the
stage — the sim never sets `bill_status` directly; it writes status lines
and lets `classifyStatus` run).

### Scenario 1 (SIM-01, SIM-02 auto; SIM-03…SIM-10 user-driven)

| Day | Table label | Target stage | Status line(s) injected that day | Required action to advance |
| --- | --- | --- | --- | --- |
| 1 (Mon) | Introduced & Waiting | `introduced` | "Introduced and passed First Reading." | — |
| 2 (Tue) | Hearing Notice | `scheduled1` | "The committee(s) on JHA will hold a public hearing on 09-16-26 …" | **Contact** (bill is waiting → schedule) |
| 3 (Wed) | Hearing | `scheduled1`→pass | "The committee(s) on JHA recommend(s) that the measure be PASSED, unamended." | **Testimony** (support→pass / oppose→defer) |
| 4 (Thu) | Crossover & Waiting | `crossoverWaiting1` | "Passed Third Reading. … transmitted to the Senate." + "Received from the House. Referred to CPN." | — |
| 5 (Fri) | Crossed Over Hearing Notice | `crossoverScheduled1` | "The committee(s) on CPN will hold a public hearing on 09-21-26 …" | **Contact** (crossoverWaiting → schedule) |

The "Crossed Over Hearing" (final table cell) is the *result* of day 5's
notice being acted on; within a 5-day window it is represented as the day-5
scheduled state. (The scenario table's 6th column is beyond the sim week.)

### 5a. Reserved bill identifiers

Sim bills use real-shaped numbers in a reserved high range so they are
obviously fake yet still parse as HB/SB (required for the classifier's
origin-chamber logic):

- Scenario 1 (House-origin): `HB9001`–`HB9010` (SIM-01…SIM-10).
- Scenario 2 (House-origin): `HB9011`–`HB9020` (SIM-11…SIM-20).

`SIM_ID` (`SIM-03`) is the stable handle used by `flag.js`, the sentinel URL
(`test://sim-week/SIM-03`), and log output; `bill_number` (`HB9003`) is what
the classifier sees. The mapping lives in `scenarios.js`. Both scenarios use
House-origin bills so the crossover target chamber is the Senate uniformly;
this can be split H/S later if desired but is not required.

### Deadline-scan exclusion

The cron passes **both** deadline scanners a sentinel-excluding `fetchBills`:
`checkApproachingDeadlines(today, { fetchBills: fetchLivingNonSim })` and
`checkTestimonyDeadlines(today, { fetchBills: fetchLivingNonSimWithStatus })`
(the two use different default loaders — `defaultFetchBills` vs
`defaultFetchBillsWithStatus` — so both are wrapped). Each wrapper is the
existing default query plus `where('bill_url', 'not like', 'test://sim-week/%')`.

### Scenario 2 (SIM-11, SIM-12 auto; SIM-13…SIM-20 user-driven)

Starts later in the lifecycle (at a first-committee hearing) and runs to
conference.

| Day | Table label | Target stage | Status line(s) injected that day | Required action to advance |
| --- | --- | --- | --- | --- |
| 1 (Mon) | Hearing | `scheduled1`→pass | back-history through introduced + "The committee(s) on JHA recommend(s) that the measure be PASSED, unamended." | **Testimony** (support→pass / oppose→defer) |
| 2 (Tue) | Crossover & Waiting | `crossoverWaiting1` | "Passed Third Reading. … transmitted to the Senate." + "Received from the House. Referred to CPN." | — |
| 3 (Wed) | Crossed Over Hearing Notice | `crossoverScheduled1` | "The committee(s) on CPN will hold a public hearing on 09-18-26 …" | **Contact** (crossoverWaiting → schedule) |
| 4 (Thu) | Crossed Over Hearing | `crossoverScheduled1`→pass | "The committee(s) on CPN recommend(s) that the measure be PASSED, unamended." + "Passed Third Reading." | **Testimony** (support→pass / oppose→defer) |
| 5 (Fri) | Conference / Conference Hearing Notice | `passedCommittees` → `conferenceAssigned` | "The House disagrees with Senate amendments." + both-chamber conferee lines + "Conference Committee will meet on 09-21-26 …" | — |

Committee names (JHA/CPN etc.) and hearing dates are placeholders chosen so
the classifier resolves the intended stage; exact strings are finalized in
implementation against `docs/bill-status-pattern-table.md` and locked by the
engine unit tests.

## 6. Auto vs. user-driven, and the death mechanic

For every day that has a **required action**:

- **Auto bills (SIM-01/02/11/12):** always inject the *advancing* line
  regardless of flags/testimony. They march the full cycle. (For a testimony
  step, auto bills always take the PASS line.)
- **User-driven bills:** the engine checks whether the required action
  happened **before this sim-day's run**:
  - **Contact checkpoint** (bill is waiting): contact flag present →
    inject the SCHEDULED line. **No flag → inject a permanent-deferral death
    line** and stop advancing this bill for the rest of the week.
  - **Testimony checkpoint** (bill is scheduled/hearing): latest sim
    testimony row's `position`:
    - **support → PASS line** (advance).
    - **oppose → permanent-deferral death line** (dies).
    - **no testimony → permanent-deferral death line** (dies).

**Death line** = a status line the existing `dead-bill.js` recognizes as a
permanent deferral with no recovery, e.g.:

```
The committee(s) on <CMT> deferred the measure.
```

`isExplicitlyDeferred` / `findPermanentDeferral` mark the bill `dead` on the
same cron run (via `checkAndUpdateDeadStatus`, already wired into the
pipeline). This decouples sim death from the real session-deadline table —
we don't need to fake `session-deadlines-2026.json`.

**Critical: the real deadline logic must NOT apply to sim bills.** The real
`session-deadlines-2026.json` dates all fall Mar–Jul 2026, i.e. *before* the
Sept sim window. `dead-bill.js` (`isBillDead`, Kill Condition 2) and the
deadline-warning scanners run over all bills with `today` in September, so
every deadline has "already passed" — an untreated sim bill at `introduced`
would be flagged **dead (missed deadline)** on day 1 and would generate bogus
deadline-warning emails, killing even the auto bills. Therefore the sim
runner must ensure sim bills are killed **only** by the explicit-deferral
mechanism (Kill Condition 1), never by the missed-deadline path, and must be
**excluded from the deadline-warning scan**. Two isolation requirements:

- **Dead-check:** the sim runner does not call the full `checkAndUpdateDeadStatus`
  for sim bills. Instead it applies **only** the explicit-deferral verdict —
  it calls `isExplicitlyDeferred(updates)` (pure, deadline-free) and sets
  `bills.dead` from that alone. (Equivalently: pass sim bills a
  sim-local deadline table whose dates are all after the sim window so no
  deadline can trip; the explicit-deferral path is simpler and preferred.)
- **Deadline warnings:** the default deadline scanners (`defaultFetchBills`
  in `deadline-warnings.js`) select all living bills and would include sim
  bills. Sim bills **need real-looking `bill_number`s** (e.g. `HB9001` /
  `SB9002`) because the classifier derives origin chamber from the prefix
  (`originChamberOf`, `statusClassifier.js:10`) and both scenarios rely on
  crossover lines — a null/blank number would break classification. So we do
  **not** null the number; instead the deadline scanners must **exclude
  sentinel bills**. The cron passes the deadline scanners a `fetchBills` that
  filters out `bill_url LIKE 'test://sim-week/%'` (the scanners already
  accept an injectable `fetchBills`), so sim bills are never scored against
  real deadlines. The classifier and digest paths are unaffected, so sim
  bills still classify and still send status-change digests. This is the
  chosen approach; see §5a for the reserved bill-number range.

Once a user-driven bill has a death line as its newest update, subsequent
sim-days inject **nothing new** for it (the deferral remains newest), so it
stays dead and the classifier/`dead-bill` keep it dead. (Recall the engine
is declarative: a dead bill's computed log simply ends at the deferral.)

### "Die at the next sim-day" timing

An action must be present **before the cron that runs the advancing day**.
Concretely: a contact for a Tuesday hearing-notice step must be flagged
before the day-2 run; testimony for a Wednesday hearing step must exist
before the day-3 run. If it arrives after that day's run, the bill has
already been marked dead — this is the intended, simple rule (grace period
was explicitly declined).

## 7. Action signals

### 7a. Contact — manual JSON flag file

`scripts/sim/flag.js` (Node CLI). Writes/reads `scripts/.sim-pending.json`
(gitignored, mirrors the existing `scripts/.seed-e2e-snapshot.json`
convention).

```
node scripts/sim/flag.js --bill SIM-03 --action contact
node scripts/sim/flag.js --list
node scripts/sim/flag.js --clear SIM-03
```

File shape:

```json
{
  "SIM-03": { "action": "contact", "flaggedAt": "2026-09-15T10:00:00Z" }
}
```

The engine reads this file each run. A contact flag is "consumed" when the
bill actually advances to scheduled (the declarative log records the
scheduled line from that day forward), so it will not re-fire on later days.
`flag.js` is the trigger Jaden runs after seeing fake emails.

### 7b. Testimony — real `testimonies` table

The engine queries `testimonies` for rows where `bill_id` = the sim bill's
DB id and `submitted_at IS NOT NULL`, taking the **latest by `submitted_at`**
and reading `position` (a free-text stance string; matched
case-insensitively against support/oppose synonyms — `support`/`favor` vs
`oppose`/`against`; unknown strings are treated as **oppose/defer**, the
safe "did not clearly support" default).

`flag.js` also supports a **test convenience** to insert a real testimonies
row against a sim bill so the whole path can be exercised without the other
app:

```
node scripts/sim/flag.js --bill SIM-04 --action testify --stance support
node scripts/sim/flag.js --bill SIM-05 --action testify --stance oppose
```

These insert into the shared `testimonies` table (bill_id, user_id =
Jaden, position = stance, submitted_at = now) and are removed by `reset.js`.

## 8. Components

```
server/services/sim/
  scenarios.js     — the two scenarios as pure data (roster + per-day steps)
  simEngine.js     — pure fn: given (bill, simDay, flags, testimonyStance)
                     → the desired status-update log for that bill up to simDay
  simRunner.js     — DB glue: for each sim bill, read flags/testimony,
                     call simEngine, replace status_updates, then run the
                     existing classify + dead-bill steps. Returns statusChanges.
  simUsers.js      — resolve/create the ALERT_EMAIL user + user_bills follows

scripts/sim/
  seed.js          — create the 20 sim bills (+ follows) at day-0 state
  run-day.js       — run one sim-day: simRunner + notify (digest + deadline)
  run-week.js      — run all 5 days in sequence, pausing between for flags
  flag.js          — contact flag + testimony test-insert (see §7)
  reset.js         — delete all sim bills, sim testimonies, follows, flag file

docs/
  sim-week.md      — operator runbook (how to run the week / demo)
```

### Pipeline integration

Two entry points share `simRunner`:

1. **Real cron** (`server/cron-scrape.js`): after the normal House/Senate
   scrape, if today ∈ sim window, call `simRunner(today)` and merge its
   `statusChanges` into `allChanges` before `sendStatusChangeNotifications`.
   Deadline warnings already scan all living bills, so sim bills are
   included automatically. This is a small, guarded addition — if the sim
   throws, it is caught and logged like every other pipeline step and never
   fails the real scrape.
2. **On-demand** (`scripts/sim/run-day.js`): calls the same `simRunner` +
   the same notify functions directly, for fast local walkthroughs.

The engine writes status lines; **classification stays the existing
`classifyStatusWithLLM(billId)`** (deterministic). The sim never writes
`bill_status` itself.

## 9. Data flow (one sim-day)

```
run-day(date) / cron(date in window)
  └─ simRunner(date)
       simDay = ordinal(date)               # 1..5, else no-op
       for each sim bill:
         flags       = read .sim-pending.json[SIM_ID]
         stance      = latest testimonies row for bill (or null)
         log         = simEngine(bill, simDay, flags, stance)   # pure
         replaceStatusUpdates(billId, log)                      # delete+insert
         classifyStatusWithLLM(billId)                          # existing
         dead = isExplicitlyDeferred(log); set bills.dead=dead  # deferral-only,
                                                                #   NOT the deadline path
         push change (computeChange) if bill_status moved
  └─ sendStatusChangeNotifications(changes)   # existing digest path
  └─ sendDeadlineWarnings(scan with sim excluded)  # existing deadline path, §5a filter
```

## 10. Testing & verification

Unit (pure, no DB — the bulk of confidence):

- `server/tests/simEngine.test.js`:
  - Each auto bill produces the full advancing log for days 1–5 regardless
    of flags/stance.
  - A user-driven Scenario-1 bill with **no contact** by day 2 → log ends in
    a deferral; `classifyStatus` over that log yields a non-advancing stage
    and `isExplicitlyDeferred` is true.
  - Contact flag by day 2 → advances to `scheduled1`.
  - Testimony **support** by day 3 → PASS; **oppose** / **none** → deferral.
  - Idempotency: `simEngine(bill, 3, …)` run twice is identical; the day-3
    log is a prefix-superset of the day-2 log.
  - Feed each produced log through the real `classifyStatus` and assert the
    intended stage per day (guards the wording against the pattern table).

Integration (against the sandbox DB, isolated by sentinel URL):

- `run-week.js` dry walkthrough: seed → run days 1–5, flagging one contact
  and one support testimony and one oppose testimony along the way; assert
  one auto bill reaches the scenario's end stage, one user bill advances,
  one user bill is `dead`. Confirm emails are attempted (guarded by
  `RESEND_API_KEY`).

Project verification gate (classifier is touched only as a *consumer*, but
run anyway to prove no regression):

- `node --test server/tests/statusClassifier.test.js`
- `node --test server/tests/simEngine.test.js`

## 11. Risks & mitigations

- **Shared production-named DB.** `DATABASE_URL` points at a DB named
  `civtrack_prod` shared with the other app. *Mitigation:* every sim write is
  namespaced under `test://sim-week/` (bills) or is a clearly-attributable
  sim testimony/follow row; `reset.js` removes all of it; nothing updates or
  deletes non-sim rows. `seed.js` refuses to run if sim bills already exist
  unless `--force`. (`bills.current_status_string` and `committee_assignment`
  are NOT NULL in the real DB, so day-0 seeds them as `''`.)
- **Classifier wording drift.** If a hand-written status line doesn't match
  the pattern table, the bill won't reach the intended stage. *Mitigation:*
  the engine unit tests run each produced line through the real
  `classifyStatus` and assert the stage — wording is locked by tests.
- **Double cron run in a day.** *Mitigation:* declarative + idempotent
  engine (§4).
- **Testimony stance ambiguity.** `position` is free text. *Mitigation:*
  case-insensitive synonym match; unknown → oppose/defer (safe default),
  documented in the runbook.

## 12. Out of scope / future

- Wiring a real "contact legislator" DB signal (no such table exists in the
  shared schema today; the manual flag stands in).
- More than two scenarios or more than 20 bills.
- Any dashboard visualization of sim state (operator reads DB / emails).
