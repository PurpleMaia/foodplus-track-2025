/**
 * EVAL — run the deterministic classifier against every 2026 non-unassigned bill and compare
 * to the stored bill_status. Reports match rate + a full mismatch breakdown for triage.
 * NOTE: stored bill_status is partly noisy (old AI output), so mismatches are triaged, not
 * assumed to be classifier errors.
 *
 * Run: node scripts/llm/eval-deterministic.mjs
 */
import { db } from '../../db/kysely/client.js';
import { sql } from 'kysely';
import { classifyStatus } from '../../server/services/statusClassifier.js';

const bills = await db.selectFrom('bills')
  .select(['id', 'bill_number', 'bill_status'])
  .where('year', '=', 2026)
  .where('bill_status', 'is not', null)
  .where('bill_status', '<>', 'unassigned')
  .execute();

let match = 0;
const mismatches = [];
const confusion = new Map(); // `${db}->${got}` -> count

for (const b of bills) {
  const updates = await db.selectFrom('status_updates as su')
    .select(['chamber', 'date', 'statustext'])
    .where('bill_id', '=', b.id)
    .orderBy(sql`cast(su.date as date)`, 'desc')
            .orderBy('statustext', 'asc') // stable tiebreaker for same-date rows
    .execute();

  // Classify from scratch (no currentStatus) so we test the rules, not the guard.
  const { status, unmatched } = classifyStatus({
    billNumber: b.bill_number,
    statusUpdates: updates,
    currentStatus: null,
  });

  if (status === b.bill_status) { match++; continue; }
  const key = `${b.bill_status} -> ${status}`;
  confusion.set(key, (confusion.get(key) || 0) + 1);
  mismatches.push({
    billNumber: b.bill_number,
    db: b.bill_status,
    got: status,
    newest: updates[0]?.statustext?.slice(0, 75),
    unmatchedCount: unmatched.length,
  });
}

const total = bills.length;
console.log(`\n=== DETERMINISTIC vs stored bill_status (2026, non-unassigned) ===`);
console.log(`Match: ${match}/${total} (${(100 * match / total).toFixed(1)}%)\n`);

console.log(`=== Confusion (db -> classifier), by frequency ===`);
for (const [k, v] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(4), k);
}

console.log(`\n=== Mismatch samples (up to 40) ===`);
for (const m of mismatches.slice(0, 40)) {
  console.log(`${m.billNumber}: db=${m.db} got=${m.got}  | "${m.newest}"`);
}

await db.destroy();
