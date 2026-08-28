/**
 * Deadline-scan fetchers that EXCLUDE sim bills.
 *
 * The real session deadlines (session-deadlines-2026.json) all fall before the
 * Sept sim window, so sim bills must never be scored against them (they would
 * all read as "missed deadline"). These wrap the default deadline loaders with
 * a `bill_url NOT LIKE 'test://sim-week/%'` filter, so the cron can pass them to
 * checkApproachingDeadlines / checkTestimonyDeadlines and keep sim bills out of
 * the real deadline-warning path.
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md §5a.
 */

import { sql } from 'kysely';
import { db } from '../../../db/kysely/client.js';
import { SENTINEL_PREFIX } from './scenarios.js';

const SIM_LIKE = `${SENTINEL_PREFIX}%`;

/** Living non-sim bills — mirrors deadline-warnings.defaultFetchBills + sim exclusion. */
export async function fetchLivingNonSim() {
  return db
    .selectFrom('bills')
    .select(['id', 'bill_number', 'bill_title', 'bill_status', 'committee_assignment'])
    .where('dead', '=', false)
    .where('archived', '=', false)
    .where('bill_status', 'is not', null)
    .where('bill_number', 'is not', null)
    .where('bill_url', 'not like', SIM_LIKE)
    .execute();
}

/** Same, joined to status_updates — mirrors defaultFetchBillsWithStatus + sim exclusion. */
export async function fetchLivingNonSimWithStatus() {
  const bills = await fetchLivingNonSim();
  if (bills.length === 0) return [];
  const rows = await db
    .selectFrom('status_updates as su')
    .select(['su.bill_id as bill_id', 'su.date as date', 'su.statustext as statustext'])
    .where('su.bill_id', 'in', bills.map((b) => b.id))
    .orderBy(sql`cast(su.date as date)`, 'desc')
    .execute();
  const byBill = new Map();
  for (const r of rows) {
    if (!byBill.has(r.bill_id)) byBill.set(r.bill_id, []);
    byBill.get(r.bill_id).push({ date: r.date, statustext: r.statustext });
  }
  return bills.map((b) => ({ ...b, statusUpdates: byBill.get(b.id) ?? [] }));
}
