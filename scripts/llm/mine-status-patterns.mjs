/**
 * ANALYSIS — mine the real DB to build the pattern table.
 * For every bill, pair its stored bill_status (the human/LLM-assigned kanban stage) with
 * its MOST-RECENT status_updates line. Group newest-line text by resulting stage so we can
 * see exactly which phrasings map to which stage across the whole corpus.
 *
 * Run: node scripts/llm/mine-status-patterns.mjs
 */
import { db } from '../../db/kysely/client.js';
import { sql } from 'kysely';

const bills = await db.selectFrom('bills')
  .select(['id', 'bill_number', 'bill_status'])
  .where('bill_status', 'is not', null)
  .execute();

console.log(`Bills with a bill_status: ${bills.length}`);

// For each bill, grab the newest status_updates line.
const byStage = new Map(); // stageId -> array of { billNumber, chamber, text }
let noUpdates = 0;

for (const b of bills) {
  const newest = await db.selectFrom('status_updates as su')
    .select(['chamber', 'date', 'statustext'])
    .where('bill_id', '=', b.id)
    .orderBy(sql`cast(su.date as date)`, 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!newest) { noUpdates++; continue; }
  if (!byStage.has(b.bill_status)) byStage.set(b.bill_status, []);
  byStage.get(b.bill_status).push({
    billNumber: b.bill_number,
    chamber: newest.chamber,
    text: newest.statustext,
  });
}

console.log(`Bills with no status_updates: ${noUpdates}\n`);

// Stage distribution
console.log('=== bill_status distribution ===');
const dist = [...byStage.entries()].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
for (const [k, v] of dist) console.log(String(v).padStart(4), k);

// For each stage, show up to N sample newest-lines (dedup by a normalized prefix).
console.log('\n=== sample newest status text per stage ===');
const SAMPLES = 8;
for (const [stage, rows] of byStage) {
  console.log(`\n### ${stage} (${rows.length}) ###`);
  const seen = new Set();
  let shown = 0;
  for (const r of rows) {
    const norm = r.text.replace(/\d/g, '#').slice(0, 55);
    if (seen.has(norm)) continue;
    seen.add(norm);
    console.log(`  [${r.chamber}] ${r.text.slice(0, 90)}`);
    if (++shown >= SAMPLES) break;
  }
}

await db.destroy();
