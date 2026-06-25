import { db } from '../../db/kysely/client.js';
import { describeChange } from './statusChange.js';
import { sendBillUpdateEmail } from './notifications/bill-updates-digest.js';

/**
 * Group follower rows into one entry per user, building digest lines.
 * Pure — no DB access.
 * @param {Array<{ user_id: string, email: string, change: { bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null } }>} followerRows
 * @returns {Map<string, { email: string, lines: string[], changes: object[] }>}
 */
export function groupChangesByUser(followerRows) {
  const byUser = new Map();
  for (const { user_id, email, change } of (followerRows ?? [])) {
    if (!byUser.has(user_id)) {
      byUser.set(user_id, { email, lines: [], changes: [] });
    }
    const entry = byUser.get(user_id);
    entry.lines.push(describeChange({
      billNumber: change.bill_number,
      billTitle: change.bill_title,
      oldStatus: change.old_status,
      newStatus: change.new_status,
      oldDead: change.old_dead,
      newDead: change.new_dead,
    }));
    entry.changes.push(change);
  }
  return byUser;
}

/**
 * Default fetchFollowers implementation — queries user_bills ⋈ user for all
 * followers of the given bill IDs.
 * @param {string[]} billIds
 * @returns {Promise<Array<{ bill_id: string, user_id: string, email: string }>>}
 */
async function defaultFetchFollowers(billIds) {
  return db
    .selectFrom('user_bills as ub')
    .innerJoin('user as u', 'u.id', 'ub.user_id')
    .where('ub.bill_id', 'in', billIds)
    .select(['ub.bill_id as bill_id', 'u.id as user_id', 'u.email as email'])
    .execute();
}

/**
 * Given the changes collected during a scrape run, email each follower a digest.
 * @param {Array<{ bill_id: string, bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }>} changes
 * @param {{ fetchFollowers?: (billIds: string[]) => Promise<Array<{ bill_id: string, user_id: string, email: string }>>, sendEmail?: (toEmail: string, lines: string[], changes: object[]) => Promise<void> }} [deps]
 * @returns {Promise<{ usersNotified: number, changesSent: number }>}
 */
export async function sendStatusChangeNotifications(changes, { fetchFollowers = defaultFetchFollowers, sendEmail = sendBillUpdateEmail } = {}) {
  if (!changes || changes.length === 0) {
    console.log('[NOTIFY] No bill changes to notify');
    return { usersNotified: 0, changesSent: 0 };
  }

  // Look up every follower of every changed bill in one query.
  const billIds = [...new Set(changes.map(c => c.bill_id))];
  const followers = await fetchFollowers(billIds);

  if (followers.length === 0) {
    console.log(`[NOTIFY] ${changes.length} change(s) but no followers — nothing to send`);
    return { usersNotified: 0, changesSent: changes.length };
  }

  // Join followers to their changes (a bill may have several followers).
  const changeByBill = new Map(changes.map(c => [c.bill_id, c]));
  const followerRows = followers
    .filter(f => changeByBill.has(f.bill_id) && f.email)
    .map(f => ({ user_id: f.user_id, email: f.email, change: changeByBill.get(f.bill_id) }));

  const grouped = groupChangesByUser(followerRows);

  let usersNotified = 0;
  for (const { email, lines, changes: userChanges } of grouped.values()) {
    await sendEmail(email, lines, userChanges);
    usersNotified++;
  }

  console.log(`[NOTIFY] Notified ${usersNotified} user(s) across ${changes.length} change(s)`);
  return { usersNotified, changesSent: changes.length };
}
