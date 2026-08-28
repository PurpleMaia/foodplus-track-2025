/**
 * Tear down all Sim Week data. Isolated by the sentinel URL, so nothing else
 * is touched.
 *
 *   node scripts/sim/reset.js
 *
 * Removes: sim bills' status_updates, sim testimonies, sim user_bills follows,
 * the sim bills themselves, and the local contact-flag file. The sim `user`
 * row (ALERT_EMAIL) is left in place — it may be a real account.
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md.
 */

import { rm } from 'node:fs/promises';
import { db } from '../../db/kysely/client.js';
import { ROSTER } from '../../server/services/sim/scenarios.js';
import { sentinelUrl } from '../../server/services/sim/simRunner.js';
import { FLAG_FILE } from '../../server/services/sim/flagStore.js';

async function main() {
  const urls = ROSTER.map((b) => sentinelUrl(b.simId));
  const bills = await db.selectFrom('bills').select('id').where('bill_url', 'in', urls).execute();
  const billIds = bills.map((b) => b.id);

  if (billIds.length > 0) {
    await db.deleteFrom('status_updates').where('bill_id', 'in', billIds).execute();
    // testimonies belongs to the front-facing app and may not exist here.
    try {
      await db.deleteFrom('testimonies').where('bill_id', 'in', billIds).execute();
    } catch (err) {
      if (!/relation .*testimonies.* does not exist/i.test(err.message)) throw err;
    }
    await db.deleteFrom('user_bills').where('bill_id', 'in', billIds).execute();
    await db.deleteFrom('bills').where('id', 'in', billIds).execute();
  }

  await rm(FLAG_FILE, { force: true });

  console.log(`Reset complete: removed ${billIds.length} sim bills and their status/testimony/follow rows; cleared flag file.`);
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
