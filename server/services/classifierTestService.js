import { db } from '../../db/kysely/client.js';
import { classifyStatusWithDebug } from './statusClassifierService.js';
import { computeChange, describeChange } from './statusChange.js';
import { sendBillUpdateEmail } from './notifications/bill-updates-digest.js';
import { getFixture } from './__fixtures__/classifier/index.js';

// All harness bills share this URL prefix so resetHarness() can find and delete only them.
// Real scraped bills never use a test:// URL, so production data is never touched.
const SENTINEL_PREFIX = 'test://classifier-harness/';

const sentinelUrl = (fixtureId) => `${SENTINEL_PREFIX}${fixtureId}`;

/**
 * Replace a bill's status_updates with the given fixture rows.
 * Mirrors the delete-then-insert pattern in scraping/individual-bill.js saveUpdates().
 * @param {string} billId
 * @param {Array<[string, string, string]>} statusLog rows of [date, chamber, statustext]
 */
async function replaceStatusUpdates(billId, statusLog) {
  await db.deleteFrom('status_updates').where('bill_id', '=', billId).execute();
  if (!statusLog?.length) return;
  await db.insertInto('status_updates').values(
    statusLog.map(([date, chamber, statustext]) => ({
      bill_id: billId,
      date,
      chamber,
      statustext,
    }))
  ).execute();
}

/** Newest status text in a fixture log (row 0 is newest first). */
const newestText = (statusLog) => statusLog?.[0]?.[2] ?? '';

/**
 * Seed the fixture's "before" state into a throwaway bill and classify it.
 * Idempotent: re-running upserts the same sentinel row.
 * @param {string} fixtureId
 * @returns {Promise<object>} { fixtureId, billId, debug, classified, expected, match }
 */
export async function seedBefore(fixtureId) {
  const fixture = getFixture(fixtureId);
  if (!fixture) throw new Error(`Unknown fixture: ${fixtureId}`);

  const url = sentinelUrl(fixtureId);
  const before = fixture.before;

  // Upsert the throwaway bill row (find by sentinel url, else insert). bill_status reset to null
  // so the "before" classification starts from a clean baseline each run.
  const existing = await db.selectFrom('bills').select('id').where('bill_url', '=', url).executeTakeFirst();
  let billId;
  const billValues = {
    bill_number: fixture.billNumber,
    committee_assignment: fixture.committeeAssignment,
    bill_title: fixture.label,
    description: 'classifier test harness',
    current_status_string: newestText(before.statusLog),
    bill_status: null,
    updated_at: new Date(),
  };
  if (existing) {
    billId = existing.id;
    await db.updateTable('bills').set(billValues).where('id', '=', billId).execute();
  } else {
    const inserted = await db.insertInto('bills')
      .values({ bill_url: url, created_at: new Date(), ...billValues })
      .returning('id')
      .executeTakeFirst();
    billId = inserted.id;
  }

  await replaceStatusUpdates(billId, before.statusLog);

  const debug = await classifyStatusWithDebug(billId);

  // Persist the before result so the "after" step's forward-progression guard has a baseline.
  if (debug.finalStatus) {
    await db.updateTable('bills').set({ bill_status: debug.finalStatus }).where('id', '=', billId).execute();
  }

  return {
    fixtureId,
    billId,
    debug,
    classified: debug.finalStatus ?? null,
    expected: before.expected,
    match: debug.finalStatus === before.expected,
  };
}

/**
 * Inject the fixture's new status update into the throwaway bill, re-classify, write the new
 * bill_status, and fire the change-notification email to the supplied address.
 * @param {string} fixtureId
 * @param {string} email recipient for the notification
 * @returns {Promise<object>}
 */
export async function injectAfter(fixtureId, email) {
  const fixture = getFixture(fixtureId);
  if (!fixture) throw new Error(`Unknown fixture: ${fixtureId}`);

  const url = sentinelUrl(fixtureId);
  const bill = await db.selectFrom('bills')
    .select(['id', 'bill_status', 'bill_number', 'bill_title'])
    .where('bill_url', '=', url)
    .executeTakeFirst();
  if (!bill) throw new Error(`Run "Before" first — no harness bill for fixture ${fixtureId}`);

  const after = fixture.after;
  const oldStatus = bill.bill_status ?? null;

  // Swap to the "after" status log (includes the newUpdate row) and update the raw status string.
  await replaceStatusUpdates(bill.id, after.statusLog);
  await db.updateTable('bills')
    .set({ current_status_string: newestText(after.statusLog), updated_at: new Date() })
    .where('id', '=', bill.id)
    .execute();

  const debug = await classifyStatusWithDebug(bill.id);
  const newStatus = debug.finalStatus ?? null;

  if (newStatus) {
    await db.updateTable('bills').set({ bill_status: newStatus }).where('id', '=', bill.id).execute();
  }

  // Build the change line exactly as the scrape→notify path does, then send the email.
  let emailResult;
  const change = computeChange({
    billId: bill.id,
    billNumber: bill.bill_number,
    billTitle: bill.bill_title,
    oldStatus,
    newStatus,
    oldDead: false,
    newDead: false,
  });

  if (!change) {
    emailResult = 'skipped (no status change detected)';
  } else {
    const line = describeChange({
      billNumber: bill.bill_number,
      billTitle: bill.bill_title,
      oldStatus,
      newStatus,
      oldDead: false,
      newDead: false,
    });
    emailResult = await sendNotification(email, [line]);
  }

  return {
    fixtureId,
    billId: bill.id,
    debug,
    classified: newStatus,
    expected: after.expected,
    match: newStatus === after.expected,
    oldStatus,
    emailResult,
  };
}

/**
 * Send the bill-update email, reporting a clear outcome string for the UI.
 * Wraps sendBillUpdateEmail (which is fire-and-forget / void) so the harness can surface status.
 * @param {string} email
 * @param {string[]} lines
 * @returns {Promise<string>}
 */
async function sendNotification(email, lines) {
  if (!process.env.RESEND_API_KEY) {
    return 'skipped (RESEND_API_KEY not set)';
  }
  if (!email) {
    return 'skipped (no email provided)';
  }
  await sendBillUpdateEmail(email, lines);
  return `sent to ${email}`;
}

/**
 * Delete harness bills (and their status_updates). With a fixtureId, only that one; otherwise all.
 * @param {string} [fixtureId]
 * @returns {Promise<{ deleted: number }>}
 */
export async function resetHarness(fixtureId) {
  const query = db.selectFrom('bills').select('id');
  const rows = fixtureId
    ? await query.where('bill_url', '=', sentinelUrl(fixtureId)).execute()
    : await query.where('bill_url', 'like', `${SENTINEL_PREFIX}%`).execute();

  const ids = rows.map(r => r.id);
  if (ids.length === 0) return { deleted: 0 };

  await db.deleteFrom('status_updates').where('bill_id', 'in', ids).execute();
  await db.deleteFrom('bills').where('id', 'in', ids).execute();
  return { deleted: ids.length };
}
