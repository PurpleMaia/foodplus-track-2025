/**
 * Run ONE Sim Week day end-to-end: advance sim bills, then fire the real
 * notification paths (status-change digest + deadline/testimony warnings).
 *
 *   node scripts/sim/run-day.js --date=2026-09-14
 *   node scripts/sim/run-day.js --date=2026-09-16 --dry   # no emails, just report
 *
 * `--dry` prints the status changes and would-be warnings without sending mail.
 * Emails require RESEND_API_KEY (the notification layer no-ops without it).
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md.
 */

import { db } from '../../db/kysely/client.js';
import { runSimDay } from '../../server/services/sim/simRunner.js';
import { sendStatusChangeNotifications } from '../../server/services/notificationService.js';
import { checkApproachingDeadlines, checkTestimonyDeadlines, sendDeadlineWarnings } from '../../server/services/notifications/deadline-warnings.js';
import { ROSTER } from '../../server/services/sim/scenarios.js';
import { sentinelUrl } from '../../server/services/sim/simRunner.js';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

const date = arg('--date');
const dry = process.argv.includes('--dry');

/** Deadline fetchers scoped to ONLY sim bills, so the demo shows sim deadline mail. */
async function fetchSimBills() {
  const urls = ROSTER.map((b) => sentinelUrl(b.simId));
  return db
    .selectFrom('bills')
    .select(['id', 'bill_number', 'bill_title', 'bill_status', 'committee_assignment'])
    .where('bill_url', 'in', urls)
    .where('dead', '=', false)
    .where('bill_status', 'is not', null)
    .execute();
}
async function fetchSimBillsWithStatus() {
  const bills = await fetchSimBills();
  if (bills.length === 0) return [];
  const rows = await db
    .selectFrom('status_updates')
    .select(['bill_id', 'date', 'statustext'])
    .where('bill_id', 'in', bills.map((b) => b.id))
    .execute();
  const byBill = new Map();
  for (const r of rows) {
    if (!byBill.has(r.bill_id)) byBill.set(r.bill_id, []);
    byBill.get(r.bill_id).push({ date: r.date, statustext: r.statustext });
  }
  return bills.map((b) => ({ ...b, statusUpdates: byBill.get(b.id) ?? [] }));
}

async function main() {
  if (!date) throw new Error('Usage: node scripts/sim/run-day.js --date=YYYY-MM-DD [--dry]');

  const { simDay, statusChanges, summary } = await runSimDay(date);
  if (simDay === 0) {
    console.log(`${date} is outside the sim window (Sept 14–18). No-op.`);
    await db.destroy();
    return;
  }

  console.log(`\n=== Sim day ${simDay} (${date}) ===`);
  for (const s of summary) {
    if (s.error) console.log(`  ${s.simId}: ERROR ${s.error}`);
    else if (s.skipped) console.log(`  ${s.simId}: skipped (${s.skipped})`);
    else console.log(`  ${s.simId} ${s.billNumber}: ${s.stage}${s.dead ? ' [DEAD]' : ''}${s.changed ? '  <-- changed' : ''}`);
  }

  // Deadline/testimony warnings scoped to sim bills (for the demo).
  const [approaching, testimony] = await Promise.all([
    checkApproachingDeadlines(date, { fetchBills: fetchSimBills }),
    checkTestimonyDeadlines(date, { fetchBills: fetchSimBillsWithStatus }),
  ]);
  const warnings = [...approaching, ...testimony];

  console.log(`\nStatus changes: ${statusChanges.length}. Deadline/testimony warnings: ${warnings.length}.`);

  if (dry) {
    console.log('[dry] skipping email send.');
    await db.destroy();
    return;
  }

  if (statusChanges.length) await sendStatusChangeNotifications(statusChanges, { today: date });
  if (warnings.length) await sendDeadlineWarnings(warnings);
  console.log('Notifications dispatched (subject to RESEND_API_KEY).');
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.destroy(); } catch { /* ignore */ }
  process.exit(1);
});
