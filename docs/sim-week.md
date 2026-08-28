# Sim Week — operator runbook

A week-long simulation (Sept 14–18, 2026) that drives **20 fake bills** through
the real scrape → classify → notify pipeline, so you can train advocates / demo
the product without touching real Capitol data.

Design & rationale: `docs/superpowers/specs/2026-08-27-sim-week-design.md`.

## What it does

- **4 auto bills** march the full lifecycle no matter what (2 per scenario).
- **16 user-driven bills** follow the same scenarios but **die** at a checkpoint
  unless the required action happened before that day's run.
- Two actions move a user-driven bill:
  - **Contact a legislator** (bill is *waiting*) → advances to **scheduled**.
    You flag this manually after participants email you (fake emails).
  - **Complete a testimony** (support/oppose) → committee **passes** (support)
    or **defers/kills** (oppose). Read from the real `testimonies` table.

Fake bills are isolated by `bill_url = test://sim-week/<SIM_ID>` and are fully
removed by `reset.js`. They are numbered `HB9001`–`HB9020`.

## Scenarios (per day)

**Scenario 1** (SIM-01/02 auto, SIM-03…10 user):
`introduced → scheduled1(contact) → waiting2(testify) → crossoverWaiting1 → crossoverScheduled1(contact)`

**Scenario 2** (SIM-11/12 auto, SIM-13…20 user):
`waiting2(testify) → crossoverWaiting1 → crossoverScheduled1(contact) → passedCommittees(testify) → conferenceAssigned`

`(contact)` / `(testify)` mark the day whose advance requires that action for
user-driven bills. Miss it → the bill is permanently deferred (dead) and stops.

## Commands

```bash
# 1. Seed the 20 bills at day-0 (refuses if they already exist; --force to recreate)
node scripts/sim/seed.js

# 2a. Run ONE day (real notifications; needs RESEND_API_KEY to actually email)
node scripts/sim/run-day.js --date=2026-09-14
node scripts/sim/run-day.js --date=2026-09-16 --dry   # report only, no email

# 2b. …or walk the whole week, pausing between days so you can flag actions
node scripts/sim/run-week.js            # ENTER between days
node scripts/sim/run-week.js --dry      # no emails
node scripts/sim/run-week.js --auto     # no pauses, blast all 5 days

# 3. Flag a contact (after seeing a participant's fake email)
node scripts/sim/flag.js --bill SIM-03 --action contact
node scripts/sim/flag.js --list
node scripts/sim/flag.js --clear SIM-03

# Insert a testimony for a sim bill (test convenience; real app normally does this)
node scripts/sim/flag.js --bill SIM-04 --action testify --stance support
node scripts/sim/flag.js --bill SIM-05 --action testify --stance oppose

# 4. Tear it all down
node scripts/sim/reset.js
```

## Running the real week

The daily cron (`npm run cron:scrape`) automatically advances sim bills when
today is within Sept 14–18 — no extra step. Just make sure the bills are seeded
(`seed.js`) before Sept 14, and flag contacts as the fake emails arrive. Outside
the window the sim is a no-op.

Notifications land in `ALERT_EMAIL` (your address) because `seed.js` creates a
`user_bills` follow for that user against every sim bill. Sim bills are excluded
from the *real* deadline-warning scan (their fake dates would otherwise read as
"missed deadline"), so the only deadline mail you get for them comes from the
sim-scoped `run-day.js`.

## Quick "does it work" walkthrough

```bash
node scripts/sim/seed.js
node scripts/sim/flag.js --bill SIM-03 --action contact              # will advance then die at testimony
node scripts/sim/flag.js --bill SIM-04 --action contact
node scripts/sim/flag.js --bill SIM-04 --action testify --stance support   # will fully advance
node scripts/sim/run-week.js --auto --dry
# Expect: SIM-01/02 march full cycle; SIM-04 advances; SIM-03 dies at day 3; SIM-06 dies at day 2.
node scripts/sim/reset.js
```

## Notes / gotchas

- **Testimony stance is free text.** `support`/`favor`/`for`/`aye`/`yes`/`endorse`
  → support; anything else (including empty/unknown) → **oppose** (safe default).
- **Death is permanent.** Once a bill is deferred it injects nothing further and
  stays dead for the rest of the week; flagging it afterward won't revive it.
- **Idempotent.** Re-running a day (or the cron firing twice) does not
  double-advance — the engine recomputes the full log from scratch each run.
- **Status wording is load-bearing.** The status lines in
  `server/services/sim/scenarios.js` are validated against the real classifier
  by `server/tests/simEngine.test.js`; don't reword them without re-running that
  test.
