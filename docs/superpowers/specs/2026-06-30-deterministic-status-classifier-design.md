# Deterministic Bill-Status Classifier — Design

**Date:** 2026-06-30
**Status:** Design (pending review)
**Replaces:** the LLM call in `server/services/statusClassifierService.js`

## 1. Problem & Motivation

Bill-stage classification (which kanban column a bill sits in) is currently done by an LLM
(`classifyStatusWithLLM`, called at `server/services/scraping/individual-bill.js:221`). We want to
replace the LLM with a **deterministic regex/pattern-table classifier**: no AI, fully reproducible,
debuggable, and cheaper.

### Evidence this is the right move

Measured on the repo's 47-case labeled truth set (`scripts/llm/status-log.txt` +
`classification-truth.json`), same cases for both:

| Approach | Accuracy | Failure modes |
|---|---|---|
| LLM (`scripts/llm/classify-bill-status.js` eval) | **19% (9/47)** | 7 timeouts/nulls; garbage output (echoed status text, `"House Zone Labels:"` leaked); systematic crossover + committee-number errors |
| Deterministic v1 prototype (untuned) | **53% (25/47)** | committee-ordinal bugs; one labeling-convention edge case |

Production LLM accuracy is higher than 19% (production pre-computes crossover/both-chambers/index
deterministically), but the LLM's remaining misses cluster in exactly the parts already computed in
code — so its genuine added value is small. A DB deep-dive (`scripts/llm/mine-status-patterns.mjs`)
further shows stored `bill_status` is largely the noisy LLM output (many flatly wrong labels; 114
bills in 2025 human-flagged via `ai_misclassification_type`).

### Industry precedent (no one uses AI for this)

Open States, GovTrack, and LegiScan all classify bill stage with ordered regex/keyword tables → a
fixed enum. Open States even ships a Hawaii rule table (`scrapers/hi/actions.py`). Common recipe:
fixed enum + ordered regex table + cross-wording handled by regex alternation + rollup to
"most-advanced stage matched, never decreasing," with veto/dead as terminal overrides.

## 2. Goals / Non-Goals

**Goals**
- Deterministic pure-function classifier mapping a bill's status history → one `BillStatus` id.
- Rule table authored from the real 2026 corpus (138 shapes, top ~30 dominant).
- Match or beat the LLM's accuracy on the 2026 eval set; be fully reproducible.
- Direct replacement at the single call site; remove the OpenAI call from the status path.

**Non-Goals**
- Not touching `llmService.js` (the food-related classifier — a separate, retained LLM use).
- Not adding new kanban columns; new stages map onto the existing enum (per decision).
- Not re-labeling the production DB (a separate cleanup; this only changes future classification).

## 3. Architecture

New pure module **`server/services/statusClassifier.js`** — no DB, no network, no OpenAI:

```js
classifyStatus({ billNumber, committeeAssignment, statusUpdates, currentStatus }) → BillStatus
// statusUpdates: [{ chamber, date, statustext }] newest-first
```

Same inputs → same output. Trivially unit-testable, no mocking.

`statusClassifierService.js` keeps its DB-context gathering (`getContext`, the crossover/
both-chambers/index derivation) but swaps the OpenAI call for `classifyStatus`. The existing
`enforceForwardProgression` and `mapToColumnID` helpers are reused.

Internal units (each independently testable):

1. **`deriveContext(billNumber, statusUpdates)`** → `{ originChamber, crossover, bothChambers }`.
   Lifted from existing deterministic code.
2. **`committeeOrdinal(statusLine, statusUpdates, crossover)`** → 1/2/3. Parses referral order for
   the current chamber phase; matches the committee named in the line to its position. Joint
   committees (`ECD/TOU`) = one slot. Crossover resets the referral list.
3. **`RULES`** — the ordered pattern table (see `docs/bill-status-pattern-table.md`, authoritative).
4. **`classifyLine(text, ctx)`** → a `BillStatus` id or `null`. Walks `RULES` top-to-bottom, first
   match wins; family rules resolved via `crossover` prefix + `committeeOrdinal`.
5. **`rollup(statusUpdates, ctx, currentStatus)`** → final `BillStatus`. Tags every line, takes the
   max `COLUMN_INDEX`; terminal tags (governor/veto) and the hearing-cancelled revert applied first;
   then `enforceForwardProgression` blocks regression. `Failed to pass Third Reading` sets `dead`.

## 4. Pattern Table

The full, authoritative rule table lives in **`docs/bill-status-pattern-table.md`** — 5 precedence
tiers (Terminal/Governor → Conference → Passed-all → Committee-stage → Introduction), each rule with
its regex, resulting stage, and the 2026 corpus phrasing + frequency it derives from. Key points:

- **Matching:** case-insensitive, whitespace-relaxed (` ` → `\s{,10}`), `.search()` substring.
- **Precedence is the disambiguation logic:** governor/conference beat committee stages.
- **Committee ordinal:** committee N *passes* → `waiting{N+1}` (confirmed convention); committee N
  *defers* → `deferred{N}`; a `referred to X` line uses X's position directly (no +1).
- **New stages mapped onto existing enum:** hearing-cancelled reverts `scheduled{n}`→`waiting{n}`;
  `Vetoed`→`vetoList`; `Failed Third Reading`→sets `dead`; re-referral/recommit → referral.
- **Explicit non-match guard:** `Received from Governor re: emergency appropriation` /
  `Recommended for Immediate Passage` do NOT trigger a governor stage.
- **No match → keep current status + log the line** (self-healing; log is the rule backlog).

## 5. Data Flow

```
scrape individual bill
  → saveUpdates() writes status_updates rows
  → getContext(billId): fetch bill + status_updates (existing DB code)
  → classifyStatus({...}) [NEW pure fn, replaces classifyStatusWithLLM]
       deriveContext → for each line: classifyLine → rollup (max stage, guard) 
  → write bill_status (existing)
```

## 6. Error Handling

- **Unmatched line:** no throw. The line contributes no tag; if NO line in the history matches,
  the bill keeps `currentStatus`. Every unmatched line is `console.warn`-logged with bill number +
  text so new rules can be authored.
- **Missing committee in an ordinal lookup:** ordinal defaults such that the rule keeps the bill at
  its current committee stage (no forward jump on ambiguous committee); logged.
- **Empty history:** returns `unassigned`.
- **No OpenAI dependency** in this path → the timeout/retry/null-parse failure modes disappear.

## 7. Testing

- **Unit (pure fn):** one case per rule (~30), using real 2026 phrasings as fixtures. Covers each
  tier, crossover variants, ordinal 1/2/3, hearing-cancelled revert, terminal overrides, no-match.
- **Regression:** the existing 47-case truth set (`classification-truth.json`) must pass at **≥ 90%**
  (43/47). This is a single fully-known bill with corpus-authored rules, so near-perfect is the bar;
  any remaining miss must be a documented labeling-convention case, not a rule gap.
- **Accuracy report:** `scripts/llm/eval-deterministic.mjs` runs the classifier against the **2026
  non-unassigned bills** (~239 across ~15 stages) and prints accuracy + a disagreement list.
  Because stored `bill_status` is noisy, disagreements are triaged: classifier-correct vs
  genuinely-wrong. Flag suspected-mislabeled DB rows for review rather than treating them as misses.
- Run via `npm test` (node --test) for units; the eval script is run manually.

## 8. Rollout

- **Direct replacement** (per decision): swap `classifyStatusWithLLM(billID)` → `classifyStatus(...)`
  at `individual-bill.js:221`. Remove the OpenAI call from the status classifier path.
- Keep `statusClassifierService.js`'s DB-context and guard code.
- `classifyStatusWithDebug` (used by the test harness / `classifierTestService.js`) is re-pointed at
  the deterministic classifier so the debug UI keeps working (now showing matched rule + tags
  instead of LLM raw output).
- Leave `scripts/llm/*` analysis scripts in place (they're the mining/eval tooling).

## 9. Open Questions / Risks

- **Ordinal counting across crossover** was the hardest empirical part; the committee-name→referral
  -order approach is the mitigation but needs the 2026 eval to confirm on multi-committee bills.
- **Labeling nuance** (PASSED = waiting-next) resolved; watch for any 2026 rows that contradict.
- **DB label noise** means the eval accuracy number needs human triage of disagreements, not a raw
  match rate.

## References
- `docs/bill-status-pattern-table.md` — authoritative rule table
- `scripts/llm/mine-phrasings.mjs`, `mine-status-patterns.mjs` — corpus mining
- `scripts/llm/deterministic-analysis.mjs` — prototype (53% baseline)
- Open States HI rules: https://github.com/openstates/openstates-scrapers/blob/main/scrapers/hi/actions.py
- GovTrack status logic: https://github.com/unitedstates/congress/blob/main/congress/tasks/bill_info.py
