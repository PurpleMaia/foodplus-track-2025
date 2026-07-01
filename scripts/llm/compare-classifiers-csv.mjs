/**
 * Produce a CSV comparing, per 2026 non-unassigned bill:
 *   - the AI classifier output stored in the DB (bill_status, and ai_status if different)
 *   - the deterministic classifier output
 *   - the newest status line (context) + whether they match + dead/unmatched flags
 *
 * Run: node scripts/llm/compare-classifiers-csv.mjs > classifier-comparison.csv
 */
import { db } from '../../db/kysely/client.js';
import { sql } from 'kysely';
import { classifyStatus } from '../../server/services/statusClassifier.js';

// Note: the DB stores the AI classifier's output directly in `bill_status` (there is no separate
// ai_status column). `ai_misclassification_type` is the human review flag, included as context.
const bills = await db.selectFrom('bills')
  .select(['id', 'bill_number', 'bill_status', 'ai_misclassification_type'])
  .where('year', '=', 2026)
  .where('bill_status', 'is not', null)
  .where('bill_status', '<>', 'unassigned')
  .orderBy('bill_number')
  .execute();

// Bulk-fetch status_updates for all bills, newest first.
const ids = bills.map(b => b.id);
const updatesById = new Map();
if (ids.length) {
  const rows = await db.selectFrom('status_updates')
    .select(['bill_id', 'chamber', 'date', 'statustext'])
    .where('bill_id', 'in', ids)
    .orderBy(sql`cast(date as date)`, 'desc')
    .orderBy('statustext', 'asc') // stable tiebreaker for same-date rows
    .execute();
  for (const r of rows) {
    if (!updatesById.has(r.bill_id)) updatesById.set(r.bill_id, []);
    updatesById.get(r.bill_id).push({ chamber: r.chamber, date: r.date, statustext: r.statustext });
  }
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = ['bill_number', 'ai_classifier_db_status', 'deterministic_classifier', 'match', 'human_flagged_misclassification', 'dead', 'unmatched_count', 'newest_chamber', 'newest_date', 'newest_status_line'];
const lines = [header.join(',')];

for (const b of bills) {
  const updates = updatesById.get(b.id) || [];
  const { status, dead, unmatched } = updates.length
    ? classifyStatus({ billNumber: b.bill_number, statusUpdates: updates, currentStatus: null })
    : { status: '', dead: false, unmatched: [] };
  const newest = updates[0];
  lines.push([
    csvCell(b.bill_number),
    csvCell(b.bill_status),
    csvCell(status),
    csvCell(status === b.bill_status ? 'YES' : 'NO'),
    csvCell(b.ai_misclassification_type),
    csvCell(dead ? 'YES' : ''),
    csvCell(unmatched.length),
    csvCell(newest?.chamber),
    csvCell(newest?.date),
    csvCell(newest?.statustext),
  ].join(','));
}

process.stdout.write(lines.join('\n') + '\n');
await db.destroy();
