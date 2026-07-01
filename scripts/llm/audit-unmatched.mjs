/**
 * MAINTENANCE — surface status-update lines the deterministic classifier does NOT match, and
 * bills whose classification disagrees with the stored bill_status. Run this each session (or
 * after a big scrape) to find wording the rule table doesn't yet cover.
 *
 * Usage:
 *   node scripts/llm/audit-unmatched.mjs            # current session bills (year=2026)
 *   node scripts/llm/audit-unmatched.mjs --year 2027
 *   node scripts/llm/audit-unmatched.mjs --all      # every bill
 */
import { db } from '../../db/kysely/client.js';
import { sql } from 'kysely';
import { classifyStatus } from '../../server/services/statusClassifier.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const yi = args.indexOf('--year');
const year = yi >= 0 ? Number(args[yi + 1]) : 2026;

let q = db.selectFrom('bills').select(['id', 'bill_number', 'bill_status']);
if (!all) q = q.where('year', '=', year);
const bills = await q.execute();
console.log(`Auditing ${bills.length} bills${all ? ' (ALL years)' : ` (year=${year})`}\n`);

const unmatchedShapes = new Map();  // normalized shape -> { count, example, bills:Set }
const disagreements = [];           // classified-but-newest-line-only bills where DB differs
let noNewest = 0;

const shape = (t) => t
  .replace(/\b[A-Z]{2,4}(\/[A-Z]{2,4})*\b/g, 'CMT')
  .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, 'DATE')
  .replace(/No\.\s*\d+/g, 'No.#').replace(/\d+/g, '#')
  .replace(/\s+/g, ' ').trim().slice(0, 80);

for (const b of bills) {
  const updates = await db.selectFrom('status_updates as su')
    .select(['chamber', 'date', 'statustext'])
    .where('bill_id', '=', b.id)
    .orderBy(sql`cast(su.date as date)`, 'desc')
    .execute();
  if (!updates.length) { noNewest++; continue; }

  const { status, unmatched } = classifyStatus({ billNumber: b.bill_number, statusUpdates: updates, currentStatus: null });

  for (const line of unmatched) {
    const text = line.replace(/^\[[HS]\]\s*/, '');
    const s = shape(text);
    if (!unmatchedShapes.has(s)) unmatchedShapes.set(s, { count: 0, example: text, bills: new Set() });
    const e = unmatchedShapes.get(s); e.count++; e.bills.add(b.bill_number);
  }

  // Disagreement (only meaningful when the bill has a real stored label to compare against).
  if (b.bill_status && b.bill_status !== 'unassigned' && status !== b.bill_status) {
    disagreements.push({ billNumber: b.bill_number, db: b.bill_status, got: status, newest: updates[0].statustext.slice(0, 70) });
  }
}

console.log('=== UNMATCHED LINE SHAPES (candidates for new rules) ===');
const shapes = [...unmatchedShapes.entries()].sort((a, b) => b[1].count - a[1].count);
if (!shapes.length) console.log('  (none — every line matched a rule)');
for (const [s, info] of shapes.slice(0, 40)) {
  console.log(`  ${String(info.count).padStart(4)}  ${s}`);
}

console.log(`\n=== CLASSIFICATION DISAGREEMENTS vs stored bill_status (${disagreements.length}) ===`);
console.log('  (triage: classifier-correct+DB-stale, or a real rule bug?)');
for (const d of disagreements.slice(0, 40)) {
  console.log(`  ${d.billNumber}: db=${d.db} got=${d.got}  | "${d.newest}"`);
}
if (noNewest) console.log(`\n(${noNewest} bills had no status_updates)`);

await db.destroy();
