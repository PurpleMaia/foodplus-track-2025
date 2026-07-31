/**
 * BACKFILL — re-assign every bill's kanban `bill_status` from the deterministic pattern-table
 * classifier (server/services/statusClassifier.js), rewriting stored labels that are stale/wrong.
 *
 * This is the bulk-apply counterpart to eval-deterministic.mjs (which only reports). It uses the
 * SAME classify path the live scrape uses — classifyStatusWithLLM(billId) from
 * statusClassifierService.js — so the regression guard and context folding behave identically.
 *
 * DRY-RUN BY DEFAULT. Prints proposed changes and a summary; writes NOTHING. Pass --write to
 * persist the new bill_status values to the DB.
 *
 * Flags:
 *   --write        actually UPDATE bills.bill_status (otherwise dry-run)
 *   --year=N       restrict to a single year (default: all years)
 *   --limit=N      cap the number of bills processed (for spot-checking)
 *
 * Run (dry-run):  node scripts/llm/backfill-bill-status.mjs
 * Run (write):    node scripts/llm/backfill-bill-status.mjs --write
 */
import { db } from '../../db/kysely/client.js';
import { classifyStatusWithLLM } from '../../server/services/statusClassifierService.js';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const yearArg = argv.find(a => a.startsWith('--year='));
const limitArg = argv.find(a => a.startsWith('--limit='));
const YEAR = yearArg ? Number(yearArg.split('=')[1]) : null;
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

let q = db.selectFrom('bills').select(['id', 'bill_number', 'bill_status', 'year']);
if (YEAR != null) q = q.where('year', '=', YEAR);
q = q.orderBy('year', 'desc').orderBy('bill_number', 'asc');
if (LIMIT != null) q = q.limit(LIMIT);

const bills = await q.execute();

console.log(`\n=== BACKFILL bill_status (deterministic pattern-table) ===`);
console.log(`Mode: ${WRITE ? 'WRITE (persisting to DB)' : 'DRY-RUN (no writes)'}`);
console.log(`Scope: ${YEAR != null ? `year=${YEAR}` : 'all years'}${LIMIT != null ? `, limit=${LIMIT}` : ''}`);
console.log(`Bills to process: ${bills.length}\n`);

let changed = 0, unchanged = 0, noClassification = 0, errors = 0, written = 0;
const changes = []; // { billNumber, from, to }

for (const b of bills) {
  let proposed;
  try {
    proposed = await classifyStatusWithLLM(b.id);
  } catch (err) {
    errors++;
    console.error(`[ERR] ${b.bill_number}: ${err?.message || err}`);
    continue;
  }

  if (!proposed) {
    noClassification++;
    continue; // classifier couldn't decide → leave bill_status untouched (same as scrape path)
  }

  if (proposed === b.bill_status) {
    unchanged++;
    continue;
  }

  changed++;
  changes.push({ billNumber: b.bill_number, year: b.year, from: b.bill_status, to: proposed });

  if (WRITE) {
    try {
      await db.updateTable('bills')
        .set({ bill_status: proposed })
        .where('id', '=', b.id)
        .execute();
      written++;
    } catch (err) {
      errors++;
      console.error(`[ERR-WRITE] ${b.bill_number}: ${err?.message || err}`);
    }
  }
}

// Report the proposed / applied changes, and a confusion breakdown for triage.
console.log(`\n=== Changes (${WRITE ? 'applied' : 'proposed'}) ===`);
for (const c of changes) {
  console.log(`${c.billNumber} (${c.year}): ${c.from ?? '(null)'}  ->  ${c.to}`);
}

const confusion = new Map();
for (const c of changes) {
  const key = `${c.from ?? '(null)'} -> ${c.to}`;
  confusion.set(key, (confusion.get(key) || 0) + 1);
}
console.log(`\n=== Change breakdown (from -> to), by frequency ===`);
for (const [k, v] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(4), k);
}

console.log(`\n=== Summary ===`);
console.log(`Total processed:      ${bills.length}`);
console.log(`Changed:              ${changed}`);
console.log(`Unchanged:            ${unchanged}`);
console.log(`No classification:    ${noClassification}`);
console.log(`Errors:               ${errors}`);
if (WRITE) console.log(`Written to DB:        ${written}`);
else console.log(`(dry-run — re-run with --write to persist these ${changed} changes)`);

await db.destroy();
