# CLAUDE.md

Guidance for working in the Hawaiʻi Legislature Bill Scraper. Read this before making changes.

## What this is

A dashboard + scraper that tracks bills from the Hawaiʻi State Legislature and flags food-related
ones for advocates. It scrapes capitol.hawaii.gov, stores bills/status/committees in Postgres,
classifies each bill's kanban **stage**, flags whether it's **food-related**, and emails
notifications (status digests + deadline warnings).

## Stack & layout

- **Frontend:** React + Vite + TypeScript + Tailwind (`src/`). SPA served by Express in prod.
- **Backend:** Express (`server/index.js` → `server/routes/api.js`). ESM (`"type": "module"`).
- **DB:** Postgres (Supabase) via **Kysely**. Client: `db/kysely/client.js` (reads `DATABASE_URL`).
  Generated types: `db/generated.d.ts` (regenerate with `npm run kysely-codegen`). Migrations in
  `db/migrations/`.
- **Scraping:** `axios` + `cheerio` (and `playwright` for some scripts) under
  `server/services/scraping/`.
- **Scheduled work:** `server/cron-scrape.js` (`npm run cron:scrape`) — scrapes House + Senate,
  classifies, then sends notifications. Runs **once/day**; there is no local scheduler (running the
  dev server does NOT fire the cron).
- **Deploy:** push-to-deploy via Dokku. `dev` branch → sandbox, `main` → production
  (`.github/workflows/`).

## Commands

- `npm run dev` — Vite dev server (http://localhost:5173)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm test` — `node --test "server/**/*.test.js"` (all backend tests)
- `npm run cron:scrape` — run the full scrape→classify→notify pipeline
- `npm run kysely-codegen` — regenerate DB types after a schema change

## Environment

Set in `.env` (present only in the main checkout — **fresh git worktrees have neither deps nor env;
run `npm install` and copy `.env`**). Keys: `DATABASE_URL`, `OPENAI_API_KEY` / `OPENAI_BASE_URL`
(food-related classifier only), `RESEND_API_KEY` + `ALERT_EMAIL`/`ALERT_FROM` (email),
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, `APP_URL`, `PORT`.

## Git & deploy safety (IMPORTANT)

- **A push auto-deploys.** Pushing `dev` deploys to sandbox; pushing `main` deploys to production.
- **Never push unless the user explicitly asks.** You may commit when asked, but do not `git push`.
- **Never commit directly to `main`.** Work on `dev` or a feature branch.
- Confirm before anything outward-facing (deploys, emails to real addresses).

---

## Bill-stage classification — the core custom system

A bill's kanban column (`bills.bill_status`, enum in `server/kanban-columns.js`) is derived by a
**deterministic pattern-table classifier**. This replaced an LLM classifier that scored ~19% vs the
deterministic classifier's ~100% on the labeled/real data.

**Key files**
- `server/services/statusClassifier.js` — the pure classifier (`classifyStatus`). No DB, no
  network, no OpenAI. This is where rules live.
- `server/services/statusClassifierService.js` — DB wrapper (`classifyStatusWithLLM` /
  `classifyStatusWithDebug`, names kept for back-compat) that fetches `status_updates` and calls
  the pure fn. Wired into the scrape at `server/services/scraping/individual-bill.js`.
- `docs/bill-status-pattern-table.md` — **authoritative** rule table (regex → stage, per tier).
- `docs/bill-status-classifier-maintenance.md` — the session maintenance loop.
- `server/tests/statusClassifier.test.js` — per-rule + edge-case unit tests.

### Hard rules for this classifier

1. **It stays deterministic. Do NOT add an LLM/AI to bill-stage classification** — not even as a
   fallback. New/unseen wording is handled by **adding a regex rule + a unit test**, never a model.
   (The separate *food-related* classifier in `server/services/llmService.js` DOES use an LLM —
   that's fine and unrelated.)
2. **The raw `status_updates` text is the source of truth; stored `bill_status` labels are
   suspect.** Many stored labels are old AI output and some are wrong. When the classifier disagrees
   with a stored label, default to trusting the classifier and flag the label — do not "fix" the
   classifier to reproduce a bad label.
3. **`docs/bill-status-pattern-table.md` is authoritative.** Any rule change in code must be
   mirrored there, and vice versa. Keep them in sync.

### How the classifier works (mental model)

- Status = **the newest status line that yields a confident stage**, walking newest→oldest. History
  is folded into *context* (crossover, committee ordinal, both-chambers, both-conferees), NOT a
  "furthest stage ever reached" — the crossover ladder resets, so max-stage is wrong.
- Rules are evaluated in **tier order** (Governor/terminal → Conference → Passed-all → Committee →
  Introduction); first match wins. Terminal states (Act/veto/failed) are absorbing and scanned
  first.
- **No match → keep current status + log the line** (`unmatched`). The system never guesses; the
  log is the backlog of rules to add.

### Confirmed domain rules (do not "simplify" these away)

- **Committee deferral stays at `scheduled{N}`** — a deferral does NOT populate `deferred{N}`; the
  bill stays scheduled and the UI explains the death from the text.
- **`conferenceAssigned` requires BOTH chambers' conferees** — one chamber alone stays
  `passedCommittees`.
- **Re-referral after a prior committee passage → `waiting2`**; otherwise it's an intro/landing
  reassignment.
- **Hearing cancelled** (`deleted from the ... hearing/meeting`) reverts `scheduled{N}`→`waiting{N}`
  (→`introduced` when N=1; there is no `waiting1` column).
- **"The recommendation was not adopted"** negates a same-date committee PASS — the bill stays at
  its hearing stage rather than advancing.
- **First reading in the RECEIVING chamber after crossover → `crossoverWaiting1`** (not
  `introduced`).
- **Gubernatorial origination** (`Received from Governor re: emergency appropriation` /
  `Recommended for Immediate Passage`) is NOT a governor terminal — it falls through.

### Regex gotchas that have bitten us

- `recommend(s)?` (optional s) does **not** match the literal `recommend(s)` (Senate form). Use
  `recommend(?:\(s\)|s)?`.
- `Transmitted to Governor` has **no "the"** (the enum title does). Match `Transmitted to (the )?Governor`.
- `committeeOrdinal` scans `[A-Z]{2,4}` runs; draft markers (`HD/SD/CD`) and vote words
  (`PASS/WITH`) are excluded via the `NON_COMMITTEE` set — extend it if a junk token ever collides.
- Same-date row order is NOT guaranteed by the DB; date-keyed logic (e.g. not-adopted) must be
  order-independent.

### Verification gate — required before claiming classifier work is done

Run and confirm all three (documented in `docs/bill-status-classifier-maintenance.md`):

1. `node --test server/tests/statusClassifier.test.js` — unit tests must pass, and **add a test for
   any new/changed rule**.
2. `node scripts/llm/eval-deterministic.mjs` — matches stored `bill_status` for classified 2026
   bills (triage disagreements: classifier-correct-vs-stale-label vs a real bug).
3. `node scripts/llm/audit-unmatched.mjs [--year N | --all]` — report unmatched line-shapes; a
   meaningful new shape should become a rule.

Do not report success without showing this output. Evidence before assertions.

## Other subsystems (brief)

- **Food-related classifier** (`server/services/llmService.js`) — LLM-based; retained.
- **Notifications** (`server/services/notifications/`) — two paths: status-change digests and coral
  deadline warnings. E2E-testable via the `/api/classifier-test/*` harness
  (`server/services/classifierTestService.js`) using sentinel `test://` bills.
- **Dead-bill detection** (`server/services/dead-bill.js`) — flags bills that missed a deadline.
- **Design specs** live in `docs/superpowers/specs/`; consult the relevant one before large changes.

## Conventions

- ESM everywhere; backend tests use the built-in `node:test` + `node:assert/strict`.
- Keep classifier changes as **pure functions** where possible — easy to unit-test, no mocking.
- Match surrounding code's style; scraping/notification services isolate failures in try/catch so
  one bill or one email never fails the whole scrape.
