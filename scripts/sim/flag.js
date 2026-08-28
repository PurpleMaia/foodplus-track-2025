/**
 * Sim Week action flagger.
 *
 * CONTACT (manual JSON flag; the runner reads this before the next scrape):
 *   node scripts/sim/flag.js --bill SIM-03 --action contact
 *   node scripts/sim/flag.js --list
 *   node scripts/sim/flag.js --clear SIM-03
 *
 * TESTIMONY (test convenience — inserts a real `testimonies` row against the
 * sim bill so the pass/defer path can be exercised without the front-facing app):
 *   node scripts/sim/flag.js --bill SIM-04 --action testify --stance support
 *   node scripts/sim/flag.js --bill SIM-05 --action testify --stance oppose
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md §7.
 */

import { db } from '../../db/kysely/client.js';
import { ROSTER } from '../../server/services/sim/scenarios.js';
import { sentinelUrl } from '../../server/services/sim/simRunner.js';
import { resolveSimUser } from '../../server/services/sim/simUsers.js';
import { readFlags, setContactFlag, clearFlag } from '../../server/services/sim/flagStore.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const knownSimId = (id) => ROSTER.some((b) => b.simId === id);

async function main() {
  if (process.argv.includes('--list')) {
    const flags = await readFlags();
    const keys = Object.keys(flags);
    if (keys.length === 0) console.log('No pending flags.');
    for (const k of keys) console.log(`${k}: ${flags[k].action} @ ${flags[k].flaggedAt}`);
    return;
  }

  const clearId = arg('--clear');
  if (clearId) {
    if (!knownSimId(clearId)) throw new Error(`Unknown sim id: ${clearId}`);
    await clearFlag(clearId);
    console.log(`Cleared flag for ${clearId}.`);
    return;
  }

  const simId = arg('--bill');
  const action = arg('--action');
  if (!simId || !action) throw new Error('Usage: --bill SIM-NN --action contact|testify [--stance support|oppose]');
  if (!knownSimId(simId)) throw new Error(`Unknown sim id: ${simId}`);

  if (action === 'contact') {
    await setContactFlag(simId, new Date().toISOString());
    console.log(`Flagged ${simId} as CONTACTED. It will advance on the next run-day/cron.`);
    return;
  }

  if (action === 'testify') {
    const stance = (arg('--stance') || '').toLowerCase();
    if (stance !== 'support' && stance !== 'oppose') {
      throw new Error('--action testify requires --stance support|oppose');
    }
    const url = sentinelUrl(simId);
    const bill = await db.selectFrom('bills').select('id').where('bill_url', '=', url).executeTakeFirst();
    if (!bill) throw new Error(`Sim bill ${simId} not seeded — run scripts/sim/seed.js first.`);
    const user = await resolveSimUser();
    await db.insertInto('testimonies').values({
      bill_id: bill.id,
      user_id: user.id,
      position: stance,
      submitted_at: new Date(),
    }).execute();
    console.log(`Inserted ${stance} testimony for ${simId}. It will ${stance === 'support' ? 'PASS' : 'be DEFERRED'} on the next run.`);
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

main()
  .then(async () => { await db.destroy(); })
  .catch(async (err) => {
    console.error(err.message);
    try { await db.destroy(); } catch { /* ignore */ }
    process.exit(1);
  });
