/**
 * ANALYSIS — catalog the distinct NEWEST-line phrasings across ALL bills (digit/committee
 * normalized) with frequency. This is the raw material for the deterministic rule table:
 * it tells us the finite set of sentence shapes the HI legislature actually emits.
 *
 * Run: node scripts/llm/mine-phrasings.mjs
 */
import { db } from '../../db/kysely/client.js';
import { sql } from 'kysely';

// Pull the single newest status line per bill in one query using DISTINCT ON.
const rows = await sql`
  SELECT DISTINCT ON (su.bill_id) su.bill_id, su.chamber, su.statustext
  FROM status_updates su
  ORDER BY su.bill_id, cast(su.date as date) DESC
`.execute(db);

console.log(`Newest lines pulled: ${rows.rows.length}`);

// Normalize: strip vote tallies / names / dates / committee acronyms / numbers to expose shape.
function shape(t) {
  return t
    .replace(/\b[A-Z]{2,4}(\/[A-Z]{2,4})*\b/g, 'CMT')          // committee acronyms
    .replace(/\d{1,2}-\d{1,2}-\d{2,4}/g, 'DATE')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, 'DATE')
    .replace(/\bNo\.\s*\d+/g, 'No. #')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    // Cut off long vote-detail tails to group better.
    .replace(/(Ayes|Aye\(s\)|The votes)[\s\S]*$/i, '$1 ...')
    .replace(/ with (none|Representative|Senator)[\s\S]*$/i, ' with ...')
    .slice(0, 80);
}

const counts = new Map();
for (const r of rows.rows) {
  const s = shape(r.statustext);
  counts.set(s, (counts.get(s) || 0) + 1);
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Distinct shapes: ${sorted.length}\n`);
console.log('=== top newest-line shapes (count :: shape) ===');
for (const [s, c] of sorted.slice(0, 70)) {
  console.log(String(c).padStart(4), '::', s);
}

await db.destroy();
