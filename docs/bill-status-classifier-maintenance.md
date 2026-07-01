# Maintaining the Deterministic Bill-Status Classifier

How to keep `server/services/statusClassifier.js` accurate as the legislature's status wording
evolves. The classifier is a **pure function + ordered regex rule table** (see
`docs/bill-status-pattern-table.md`). It has no AI, so it is only as complete as its rules — this
doc is the loop that keeps the rules complete.

## Mental model (read this first)

- A bill's status = **the newest status line that yields a confident stage**, walking newest→oldest.
  History is folded into *context* (crossover, committee ordinal, both-chambers, both-conferees),
  NOT into a "furthest stage ever" — the crossover ladder resets, so max-stage is wrong.
- Terminal states (Act/veto/failed) are absorbing and scanned first.
- **No match → the bill keeps its current status, and the line is logged in `unmatched`.** The
  system never guesses. Unmatched lines are your to-do list.

## The maintenance tools

| Command | What it does |
|---|---|
| `node --test server/tests/statusClassifier.test.js` | Unit tests — one per rule + edge cases. **Run after any rule change.** |
| `node scripts/llm/eval-deterministic.mjs` | Integration eval vs stored `bill_status` for the current session (2026). The regression gate. |
| `node scripts/llm/audit-unmatched.mjs [--year N \| --all]` | **The maintenance driver.** Lists (a) unmatched line-shapes = candidates for new rules, and (b) classification disagreements to triage. |
| `node scripts/llm/mine-phrasings.mjs` | Full frequency catalog of newest-line shapes (for authoring rules from real data). |

## The loop — run each session (or after a large scrape)

1. **Audit.** `node scripts/llm/audit-unmatched.mjs` (defaults to the current session year).
2. **Read the UNMATCHED SHAPES.** Each row is wording no rule covers, with a frequency. High count
   = worth a rule. Ignore one-off oddities (they'll just keep the bill at its prior status, which
   is safe).
3. **Author a rule** in `classifyLine` (`statusClassifier.js`) for each meaningful shape:
   - Put it in the correct **tier** (Governor > Conference > Passed-all > Committee > Intro). Order
     matters — the first matching rule wins.
   - Use **alternations** for wording variants (`Pass(ed)?`, `(House|Senate)`) and remember the
     literal-parens gotcha: `recommend(?:\(s\)|s)?` matches `recommend`, `recommends`, AND
     `recommend(s)`. `recommend(s)?` does NOT match the literal `(s)` form.
   - If the stage depends on committee number / crossover, return a family stage via
     `pref(crossover, \`waiting${ord}\`)`.
4. **Mirror the rule** into `docs/bill-status-pattern-table.md` (keep the doc authoritative).
5. **Add a unit test** in `statusClassifier.test.js` locking in the new phrasing → stage.
6. **Triage DISAGREEMENTS.** For each `db=X got=Y`, decide:
   - **Classifier correct, DB stale** (common — the old label was AI output). No code change; the
     DB self-corrects on the next scrape once the classifier is wired in.
   - **Real rule bug** → fix the rule, add a unit test proving the fix.
7. **Re-run** unit tests + eval. Eval should return to ~100% on true matches (remember some
   disagreements are stale DB labels, not misses — triage, don't chase a raw number).

## Confirmed domain rules (don't "simplify" these away)

These differ from generic legislative trackers and are load-bearing:

1. **Committee deferral stays at `scheduled{N}`** — a deferral does NOT populate `deferred{N}`; the
   bill remains scheduled and the UI explains the death from the text.
2. **`conferenceAssigned` requires BOTH chambers' conferees** — one chamber alone (or a bare
   disagreement) stays `passedCommittees`.
3. **Re-referral after a prior committee passage → `waiting2`**; otherwise it's an intro/landing
   reassignment (`introduced` / `crossoverWaiting1`).
4. **Hearing cancelled** (`deleted from the ... hearing/meeting`) reverts `scheduled{N}`→
   `waiting{N}` (→`introduced` when N=1; there is no `waiting1` column).
5. **"The recommendation was not adopted"** negates the immediately-preceding PASS — the bill stays
   at its committee hearing stage rather than advancing.
6. **Gubernatorial origination** (`Received from Governor re: emergency appropriation` /
   `Recommended for Immediate Passage`) is NOT a governor terminal — it must fall through.

## Known regex gotchas (bit us before)

- `recommend(s)?` vs literal `recommend(s)` — see step 3. Use `recommend(?:\(s\)|s)?`.
- `Transmitted to Governor` has **no "the"** (the enum text does). Match `Transmitted to (the )?Governor`.
- `committeeOrdinal` matches `[A-Z]{2,4}` runs; draft markers (`HD`, `SD`, `CD`) and vote words
  (`PASS`, `WITH`) are excluded via the `NON_COMMITTEE` set. Add to that set if a new junk token
  ever collides with a real committee acronym.

## When NOT to touch the classifier

- A single weird bill that keeps its prior status correctly — leave it; the no-match fallback is
  working as designed.
- Pressure to add an LLM "for the hard ones" — the hard ones here are ordinal/crossover logic,
  which is exactly what the LLM got wrong (19% vs 100%). Add a rule, not a model.
