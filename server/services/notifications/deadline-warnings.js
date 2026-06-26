import { db } from '../../../db/kysely/client.js';
import { getNextDeadline } from '../dead-bill.js';
import sessionDeadlines from '../../../session-deadlines-2026.json' with { type: 'json' };
import { sendDeadlineWarningEmail } from './bill-updates-digest.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HEADS_UP_DAYS = 7; // first "heads up" tier
const URGENT_DAYS = 3;   // second "urgent / final" tier

// Stateless by design: the scrape runs once per day, so we recompute each bill's next
// deadline from scratch every run and email followers whenever the bill is within the
// warning window. No de-dup state is stored — a follower of an at-risk bill receives a
// daily countdown reminder (escalating to URGENT at the 3-day tier) until the bill
// advances past the deadline or the deadline passes.

/**
 * @typedef {object} BillRow
 * @property {string} id
 * @property {string} bill_number
 * @property {string|null} bill_title
 * @property {string|null} bill_status
 * @property {string|null} committee_assignment
 */

/**
 * Whole days from `today` until `date` (both YYYY-MM-DD), rounded up.
 * @param {string} date
 * @param {string} today
 * @returns {number}
 */
export function daysUntil(date, today) {
  const diff = new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`);
  return Math.ceil(diff / DAY_MS);
}

/**
 * Warning tier for a number of days remaining, or null if outside the window.
 * The single source of truth for the 7-day / 3-day thresholds.
 * A passed deadline (daysLeft < 0) yields no tier — the bill is dead, not "urgent".
 * @param {number} daysLeft
 * @returns {'7'|'3'|null}
 */
export function tierForDaysLeft(daysLeft) {
  if (daysLeft < 0) return null;
  if (daysLeft <= URGENT_DAYS) return '3';
  if (daysLeft <= HEADS_UP_DAYS) return '7';
  return null;
}

/**
 * Pure decision: given a bill's recomputed next deadline, decide which warning tier
 * (if any) applies today. Stateless — depends only on days remaining.
 *
 * @param {BillRow} bill
 * @param {string} today - YYYY-MM-DD
 * @param {object} [deadlines] - session deadline config (defaults to the 2026 file)
 * @returns {null | { nextName: string, nextDate: string, daysLeft: number, tier: ('7'|'3'|null) }}
 */
export function computeDeadlineWarning(bill, today, deadlines = sessionDeadlines) {
  const next = getNextDeadline(
    bill.bill_number,
    bill.bill_status,
    bill.committee_assignment,
    deadlines,
    today,
  );
  if (!next) return null;

  const daysLeft = daysUntil(next.date, today);
  return { nextName: next.name, nextDate: next.date, daysLeft, tier: tierForDaysLeft(daysLeft) };
}

/**
 * Default loader: living, unarchived, classified bills (the only ones that can have a
 * meaningful next deadline).
 * @returns {Promise<BillRow[]>}
 */
async function defaultFetchBills() {
  return db
    .selectFrom('bills')
    .select(['id', 'bill_number', 'bill_title', 'bill_status', 'committee_assignment'])
    .where('dead', '=', false)
    .where('archived', '=', false)
    .where('bill_status', 'is not', null)
    .where('bill_number', 'is not', null)
    .execute();
}

/**
 * Recompute every living bill's next deadline and return the bills within a warning
 * window this run. Stateless — no persistence.
 *
 * @param {string} today - YYYY-MM-DD
 * @param {{ fetchBills?: () => Promise<BillRow[]>, deadlines?: object }} [deps]
 * @returns {Promise<Array<{ bill: BillRow, nextName: string, nextDate: string, daysLeft: number, tier: ('7'|'3') }>>}
 */
export async function checkApproachingDeadlines(today, { fetchBills = defaultFetchBills, deadlines = sessionDeadlines } = {}) {
  const bills = await fetchBills();
  const toWarn = [];

  for (const bill of bills) {
    const result = computeDeadlineWarning(bill, today, deadlines);
    if (!result || !result.tier) continue;

    toWarn.push({
      bill,
      nextName: result.nextName,
      nextDate: result.nextDate,
      daysLeft: result.daysLeft,
      tier: result.tier,
    });
  }

  return toWarn;
}

/**
 * Default follower lookup — mirrors notificationService.defaultFetchFollowers.
 * @param {string[]} billIds
 * @returns {Promise<Array<{ bill_id: string, user_id: string, email: string }>>}
 */
async function defaultFetchFollowers(billIds) {
  if (billIds.length === 0) return [];
  return db
    .selectFrom('user_bills as ub')
    .innerJoin('user as u', 'u.id', 'ub.user_id')
    .where('ub.bill_id', 'in', billIds)
    .select(['ub.bill_id as bill_id', 'u.id as user_id', 'u.email as email'])
    .execute();
}

/**
 * Group warned bills into one entry per following user. Pure — no DB access.
 * Each user's `urgent` flag is true if any of their warned bills is in the 3-day tier.
 * @param {Array<{ user_id: string, email: string, item: object }>} followerRows
 * @returns {Map<string, { email: string, items: object[], urgent: boolean }>}
 */
export function groupWarningsByUser(followerRows) {
  const byUser = new Map();
  for (const { user_id, email, item } of (followerRows ?? [])) {
    if (!byUser.has(user_id)) {
      byUser.set(user_id, { email, items: [], urgent: false });
    }
    const entry = byUser.get(user_id);
    entry.items.push(item);
    if (item.tier === '3') entry.urgent = true;
  }
  return byUser;
}

/**
 * Email each follower a deadline-warning digest for the bills they follow.
 * @param {Array<{ bill: BillRow, nextName: string, nextDate: string, daysLeft: number, tier: ('7'|'3') }>} warnings
 * @param {{ fetchFollowers?: (billIds: string[]) => Promise<Array<{ bill_id: string, user_id: string, email: string }>>, sendEmail?: (toEmail: string, items: object[], opts: { urgent: boolean }) => Promise<void> }} [deps]
 * @returns {Promise<{ usersNotified: number, billsWarned: number }>}
 */
export async function sendDeadlineWarnings(warnings, { fetchFollowers = defaultFetchFollowers, sendEmail = sendDeadlineWarningEmail } = {}) {
  if (!warnings || warnings.length === 0) {
    console.log('[NOTIFY] No bills approaching a deadline');
    return { usersNotified: 0, billsWarned: 0 };
  }

  const billIds = [...new Set(warnings.map((w) => w.bill.id))];
  const followers = await fetchFollowers(billIds);
  if (followers.length === 0) {
    console.log(`[NOTIFY] ${warnings.length} bill(s) near deadline but no followers — nothing to send`);
    return { usersNotified: 0, billsWarned: warnings.length };
  }

  // Build the per-bill email item once, then fan out to that bill's followers.
  const itemByBill = new Map(
    warnings.map((w) => [
      w.bill.id,
      {
        bill_number: w.bill.bill_number,
        bill_title: w.bill.bill_title,
        current_status: w.bill.bill_status,
        deadline_name: w.nextName,
        deadline_date: w.nextDate,
        days_left: w.daysLeft,
        tier: w.tier,
      },
    ]),
  );

  const followerRows = followers
    .filter((f) => itemByBill.has(f.bill_id) && f.email)
    .map((f) => ({ user_id: f.user_id, email: f.email, item: itemByBill.get(f.bill_id) }));

  const grouped = groupWarningsByUser(followerRows);

  let usersNotified = 0;
  for (const { email, items, urgent } of grouped.values()) {
    await sendEmail(email, items, { urgent });
    usersNotified++;
  }

  console.log(`[NOTIFY] Deadline warnings: ${usersNotified} user(s) across ${warnings.length} bill(s)`);
  return { usersNotified, billsWarned: warnings.length };
}
