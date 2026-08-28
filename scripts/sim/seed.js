/**
 * Seed the 20 Sim Week bills at day-0 state and follow them as the sim user.
 *
 *   node scripts/sim/seed.js            # create sim bills + follows (refuses if present)
 *   node scripts/sim/seed.js --force    # recreate even if sim bills already exist
 *
 * Bills are isolated by bill_url = test://sim-week/<SIM_ID>. Day-0 means the
 * bill row exists with no status_updates yet; run-day.js advances them.
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md.
 */

import { db } from '../../db/kysely/client.js';
import { ROSTER } from '../../server/services/sim/scenarios.js';
import { sentinelUrl } from '../../server/services/sim/simRunner.js';
import { resolveSimUser, ensureFollow } from '../../server/services/sim/simUsers.js';

const force = process.argv.includes('--force');

async function main() {
  const urls = ROSTER.map((b) => sentinelUrl(b.simId));
  const existing = await db
    .selectFrom('bills')
    .select(['id', 'bill_url'])
    .where('bill_url', 'in', urls)
    .execute();

  if (existing.length > 0 && !force) {
    console.error(`Refusing to seed: ${existing.length} sim bills already exist. Use --force to recreate (or run reset.js first).`);
    process.exit(1);
  }

  const user = await resolveSimUser();
  console.log(`Sim user: ${user.email} (${user.id})${user.created ? ' [created]' : ''}`);

  let created = 0;
  let refreshed = 0;
  for (const bill of ROSTER) {
    const url = sentinelUrl(bill.simId);
    const values = {
      bill_number: bill.billNumber,
      bill_title: bill.title ?? `SIM WEEK — ${bill.simId} (${bill.scenario}${bill.isAuto ? ', auto' : ''})`,
      committee_assignment: '',
      description: bill.description ?? 'sim week',
      current_status_string: '',
      bill_status: null,
      dead: false,
      archived: false,
      food_related: true,
      year: 2027,
      updated_at: new Date(),
    };

    const found = existing.find((e) => e.bill_url === url);
    let billId;
    if (found) {
      billId = found.id;
      await db.updateTable('bills').set(values).where('id', '=', billId).execute();
      // Clear any stale status updates so a re-seed is a true day-0 reset.
      await db.deleteFrom('status_updates').where('bill_id', '=', billId).execute();
      refreshed++;
    } else {
      const inserted = await db
        .insertInto('bills')
        .values({ bill_url: url, created_at: new Date(), ...values })
        .returning('id')
        .executeTakeFirst();
      billId = inserted.id;
      created++;
    }

    await ensureFollow(user.id, billId);
  }

  console.log(`Seeded sim bills: ${created} created, ${refreshed} refreshed, ${ROSTER.length} follows ensured.`);
  console.log('Next: node scripts/sim/run-day.js --date=2026-09-14  (or run-week.js)');
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
