/**
 * Walk the whole Sim Week (days 1–5) in one process, pausing between days so
 * you can inject contact flags / testimony from another terminal.
 *
 *   node scripts/sim/run-week.js               # pause for ENTER between days
 *   node scripts/sim/run-week.js --dry         # no emails
 *   node scripts/sim/run-week.js --auto        # no pauses (blast all 5 days)
 *
 * Between days (when paused) run, in another terminal, e.g.:
 *   node scripts/sim/flag.js --bill SIM-03 --action contact
 *   node scripts/sim/flag.js --bill SIM-04 --action testify --stance support
 *   node scripts/sim/flag.js --bill SIM-05 --action testify --stance oppose
 *
 * This drives the same runSimDay + notification paths as run-day.js. It is the
 * "quick scrape + notices" walkthrough: an auto bill marches the full cycle, a
 * flagged user bill advances, an un-flagged one dies.
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md §8.
 */

import { createInterface } from 'node:readline';
import { db } from '../../db/kysely/client.js';
import { runSimDay } from '../../server/services/sim/simRunner.js';
import { sendDailyDigest } from '../../server/services/notificationService.js';
import { SIM_DATES } from '../../server/services/sim/scenarios.js';

const dry = process.argv.includes('--dry');
const auto = process.argv.includes('--auto');

function pause(prompt) {
  if (auto) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(prompt, () => { rl.close(); res(); }));
}

async function main() {
  for (let i = 0; i < SIM_DATES.length; i++) {
    const date = SIM_DATES[i];
    const { simDay, statusChanges, summary } = await runSimDay(date);

    console.log(`\n=== Sim day ${simDay} (${date}) ===`);
    for (const s of summary) {
      if (s.error) console.log(`  ${s.simId}: ERROR ${s.error}`);
      else if (s.skipped) console.log(`  ${s.simId}: skipped (${s.skipped})`);
      else console.log(`  ${s.simId} ${s.billNumber}: ${s.stage}${s.dead ? ' [DEAD]' : ''}${s.changed ? '  <-- changed' : ''}`);
    }
    console.log(`Status changes: ${statusChanges.length}${dry ? ' [dry: no email]' : ''}`);

    if (!dry && statusChanges.length) {
      await sendDailyDigest(statusChanges, [], { today: date });
    }

    if (i < SIM_DATES.length - 1) {
      await pause(`\n-- Day ${simDay} done. Inject flags now if you want, then press ENTER for day ${simDay + 1} --\n`);
    }
  }
  console.log('\nSim week complete.');
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
