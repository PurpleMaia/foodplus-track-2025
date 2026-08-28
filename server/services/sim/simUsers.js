/**
 * Sim Week user/follow helpers.
 *
 * Notifications reach a user via user_bills ⋈ user (see notificationService
 * defaultFetchFollowers). To make sim digests/deadline mail land in Jaden's
 * inbox, we ensure a `user` row exists for ALERT_EMAIL and that every sim bill
 * has a `user_bills` follow row pointing at it.
 *
 * These rows are cleaned up by scripts/sim/reset.js (follows keyed on sim bills;
 * the user row is left in place since it may be a real account).
 */

import { db } from '../../../db/kysely/client.js';

/**
 * Find or create the user that will receive sim notifications.
 * Uses ALERT_EMAIL (the address the cron already emails). If a user with that
 * email exists, reuse it; otherwise create a minimal sim user.
 * @returns {Promise<{ id: string, email: string, created: boolean }>}
 */
export async function resolveSimUser() {
  const email = process.env.ALERT_EMAIL;
  if (!email) throw new Error('ALERT_EMAIL is not set; cannot resolve sim notification user');

  const existing = await db
    .selectFrom('user')
    .select(['id', 'email'])
    .where('email', '=', email)
    .executeTakeFirst();
  if (existing) return { ...existing, created: false };

  const inserted = await db
    .insertInto('user')
    .values({
      email,
      username: 'sim-week',
      account_status: 'active',
      role: 'user',
      system_role: 'user',
    })
    .returning(['id', 'email'])
    .executeTakeFirst();
  return { ...inserted, created: true };
}

/**
 * Ensure a user_bills follow row exists linking `userId` to `billId`.
 * Idempotent: skips if a row already exists.
 * @param {string} userId
 * @param {string} billId
 */
export async function ensureFollow(userId, billId) {
  const existing = await db
    .selectFrom('user_bills')
    .select('id')
    .where('user_id', '=', userId)
    .where('bill_id', '=', billId)
    .executeTakeFirst();
  if (existing) return;
  await db
    .insertInto('user_bills')
    .values({ user_id: userId, bill_id: billId, adopted_at: new Date() })
    .execute();
}
