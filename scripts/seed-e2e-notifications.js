/**
 * E2E notification seed script.
 *
 * Sets up the dev DB so tonight's real cron scrape (`cron-scrape.js`) emails the target
 * user one of each of the four follower-notification cases:
 *
 *   1. NEW UPDATE   — a real bill whose stored current_status_string is rewound so the
 *                     scrape re-fetches the live page, sees a diff, and fires the teal digest.
 *   2. DEAD         — a real bill rewound to dead=false with a status/committee whose deadlines
 *                     have all passed, so checkAndUpdateDeadStatus flips it to dead → digest.
 *   3. DEADLINE 7d  — a bill at `transmittedGovernor` + temp adjournment_sine_die date +7d.
 *   4. DEADLINE 3d  — a bill at `conferencePassed` (fiscal/FIN) + temp final_decking_fiscal +3d.
 *
 * The two deadline cases are driven by `checkApproachingDeadlines`, which scans ALL living
 * bills in the DB (independent of the scrape), so those bills just need the right status —
 * they don't need to appear in tonight's live report. The two change cases DO need to be in
 * the live report, so the script picks them from `scrapeBills(liveURL)`.
 *
 * Modes:
 *   node scripts/seed-e2e-notifications.js --check   # probe the live report, print counts
 *   node scripts/seed-e2e-notifications.js --seed     # do the seeding (mutates dev DB + JSON)
 *   node scripts/seed-e2e-notifications.js --revert    # FULLY undo --seed (DB rows + JSON)
 *
 * --seed records everything it changes to scripts/.seed-e2e-snapshot.json:
 *   - original current_status_string / bill_status / dead of each mutated real bill
 *   - the user_bills assignments it created
 *   - the demo bills it inserted
 * --revert reads that snapshot to restore mutated bills, delete created demo bills + the
 * assignments it made, and restore session-deadlines-2026.json from its .bak. After revert
 * the DB and JSON are back to their pre-seed state. (Pre-existing assignments are left alone.)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/kysely/client.js';
import { scrapeBills } from '../server/services/scraping/all-bills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEADLINES_PATH = path.join(ROOT, 'session-deadlines-2026.json');
const BACKUP_PATH = `${DEADLINES_PATH}.bak`;
// Records everything --seed mutated so --revert can fully undo it.
const SNAPSHOT_PATH = path.join(__dirname, '.seed-e2e-snapshot.json');

const TARGET_EMAIL = 'jaden.kapali@purplemaia.org';
const YEAR = new Date().getFullYear();
const HOUSE_URL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${YEAR}&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills`;

const iso = (d) => d.toISOString().split('T')[0];
const addDays = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

// ── helpers ────────────────────────────────────────────────────────────────

async function getTargetUserId() {
  const user = await db.selectFrom('user').select('id').where('email', '=', TARGET_EMAIL).executeTakeFirst();
  if (!user) throw new Error(`No user found for ${TARGET_EMAIL} — create the account first.`);
  return user.id;
}

// ── --check ──────────────────────────────────────────────────────────────────

async function check() {
  console.log(`[CHECK] Probing live report for year ${YEAR}...`);
  const bills = await scrapeBills(HOUSE_URL);
  console.log(`[CHECK] Live report returned ${bills.length} House bills.`);
  console.log('[CHECK] Sample:', bills.slice(0, 5).map(b => `${b.bill_number} (${b.current_status_string?.slice(0, 40)}…)`));

  // How many of those are already in the DB (so we can rewind them)?
  const urls = bills.map(b => b.bill_url);
  const known = urls.length
    ? await db.selectFrom('bills').select(['id', 'bill_url']).where('bill_url', 'in', urls).execute()
    : [];
  console.log(`[CHECK] ${known.length} of the live bills are already in the DB (rewindable for the change cases).`);
  if (bills.length === 0) {
    console.warn('[CHECK] ⚠ Live report is EMPTY — the change-detection cases (update/dead) cannot fire tonight.');
  }
}

// ── --seed ─────────────────────────────────────────────────────────────────

async function seed() {
  if (fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(`A seed snapshot already exists (${path.basename(SNAPSHOT_PATH)}). Run --revert before re-seeding.`);
  }

  const userId = await getTargetUserId();
  console.log(`[SEED] Target user ${TARGET_EMAIL} → ${userId}`);

  // Snapshot accumulator — everything we mutate, so --revert can fully undo it.
  const snapshot = {
    createdAt: new Date().toISOString(),
    targetEmail: TARGET_EMAIL,
    bills: [],          // { id, original: { current_status_string, bill_status, dead } }
    createdBillIds: [], // demo bills we inserted (delete on revert)
    assignments: [],    // user_bills rows we created { user_id, bill_id }
  };

  // 1 & 2: pick two live bills already in the DB so the scrape will re-fetch + diff them.
  const liveBills = await scrapeBills(HOUSE_URL);
  if (liveBills.length === 0) {
    throw new Error('Live report empty — cannot seed the update/dead change cases. Run --check.');
  }
  const liveUrls = liveBills.map(b => b.bill_url);
  const dbBills = await db
    .selectFrom('bills')
    .select(['id', 'bill_number', 'bill_url', 'current_status_string', 'bill_status', 'committee_assignment', 'dead'])
    .where('bill_url', 'in', liveUrls)
    .where('dead', '=', false)
    .limit(2)
    .execute();
  if (dbBills.length < 2) {
    throw new Error(`Only ${dbBills.length} live bills are in the DB; need 2 for the update + dead cases.`);
  }

  const [updateBill, deadBill] = dbBills;
  // Record originals BEFORE mutating.
  for (const b of [updateBill, deadBill]) {
    snapshot.bills.push({
      id: b.id,
      bill_number: b.bill_number,
      original: { current_status_string: b.current_status_string, bill_status: b.bill_status, dead: b.dead },
    });
  }

  // CASE 1 — NEW UPDATE: rewind current_status_string so tonight's scrape detects a diff.
  await db.updateTable('bills')
    .set({ current_status_string: '[E2E SEED] stale status — should change on next scrape' })
    .where('id', '=', updateBill.id)
    .execute();
  await recordAssign(snapshot, userId, updateBill.id);
  console.log(`[SEED] CASE 1 (update): ${updateBill.bill_number} rewound + assigned.`);

  // CASE 2 — DEAD: set dead=false and a deliberately EARLY bill_status (waiting2). Every real
  // 2026 deadline is already in the past, so checkAndUpdateDeadStatus (run during the scrape)
  // computes this early-stage bill as having missed a deadline → flips dead false→true →
  // dead-change digest. Also rewind current_status_string so there's a detectable change too.
  await db.updateTable('bills')
    .set({
      dead: false,
      bill_status: 'waiting2',
      current_status_string: '[E2E SEED] stale — bill should be marked DEAD on next scrape',
    })
    .where('id', '=', deadBill.id)
    .execute();
  await recordAssign(snapshot, userId, deadBill.id);
  console.log(`[SEED] CASE 2 (dead): ${deadBill.bill_number} set dead=false, bill_status=waiting2 (will miss a past deadline) + assigned.`);

  // 3 & 4: deadline-warning bills. These are read by checkApproachingDeadlines directly
  // (not the scrape), so we just set their status and assign them. Dedicated demo rows.
  const demo7 = await upsertDemoBill(snapshot, 'e2e://deadline-7day', {
    bill_number: 'HB-E2E-7DAY',
    bill_title: 'RELATING TO A 7-DAY DEADLINE TEST',
    bill_status: 'transmittedGovernor',
    committee_assignment: 'AGR, ECD, FIN',
  });
  const demo3 = await upsertDemoBill(snapshot, 'e2e://deadline-3day', {
    bill_number: 'SB-E2E-3DAY',
    bill_title: 'RELATING TO A 3-DAY DEADLINE TEST',
    bill_status: 'conferencePassed',
    committee_assignment: 'FIN',
  });
  await recordAssign(snapshot, userId, demo7);
  await recordAssign(snapshot, userId, demo3);
  console.log(`[SEED] CASE 3 (7d): HB-E2E-7DAY assigned. CASE 4 (3d): SB-E2E-3DAY assigned.`);

  // Temp deadlines so getNextDeadline yields +7d / +3d for those two bills.
  patchDeadlines();

  // Persist the snapshot so --revert can undo everything.
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`[SEED] Snapshot written to ${path.basename(SNAPSHOT_PATH)}.`);

  console.log('\n[SEED] Done. Tonight\'s cron should email', TARGET_EMAIL, 'for all 4 cases.');
  console.log('[SEED] After the test, run: node scripts/seed-e2e-notifications.js --revert');
}

/** Insert a user_bills row if missing, recording it in the snapshot for revert. */
async function recordAssign(snapshot, userId, billId) {
  const existing = await db
    .selectFrom('user_bills')
    .select('id')
    .where('user_id', '=', userId)
    .where('bill_id', '=', billId)
    .executeTakeFirst();
  if (existing) return; // pre-existing assignment — leave it alone on revert
  await db.insertInto('user_bills').values({ user_id: userId, bill_id: billId }).execute();
  snapshot.assignments.push({ user_id: userId, bill_id: billId });
}

/** Upsert a demo bill; record creation (for delete on revert) or original values (for restore). */
async function upsertDemoBill(snapshot, url, values) {
  const existing = await db
    .selectFrom('bills')
    .select(['id', 'current_status_string', 'bill_status', 'dead'])
    .where('bill_url', '=', url)
    .executeTakeFirst();
  if (existing) {
    snapshot.bills.push({
      id: existing.id,
      bill_number: values.bill_number,
      original: { current_status_string: existing.current_status_string, bill_status: existing.bill_status, dead: existing.dead },
    });
    await db.updateTable('bills').set({ ...values, dead: false, archived: false, updated_at: new Date() }).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const inserted = await db.insertInto('bills')
    .values({ bill_url: url, description: 'E2E deadline test', current_status_string: 'seeded', created_at: new Date(), updated_at: new Date(), ...values })
    .returning('id')
    .executeTakeFirst();
  snapshot.createdBillIds.push(inserted.id);
  return inserted.id;
}

function patchDeadlines() {
  const raw = fs.readFileSync(DEADLINES_PATH, 'utf-8');
  if (!fs.existsSync(BACKUP_PATH)) fs.writeFileSync(BACKUP_PATH, raw);
  const json = JSON.parse(raw);
  const sevenDays = addDays(7);
  const threeDays = addDays(3);
  json.deadlines.adjournment_sine_die = sevenDays;       // → 7d case (transmittedGovernor)
  json.deadlines.final_decking_fiscal = threeDays;        // → 3d case (conferencePassed, FIN)
  fs.writeFileSync(DEADLINES_PATH, JSON.stringify(json, null, 2) + '\n');
  console.log(`[SEED] Temp deadlines set — adjournment_sine_die=${sevenDays} (7d), final_decking_fiscal=${threeDays} (3d). Backup: ${path.basename(BACKUP_PATH)}`);
}

async function revert() {
  // 1. Restore the deadlines JSON.
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, DEADLINES_PATH);
    fs.unlinkSync(BACKUP_PATH);
    console.log('[REVERT] Restored session-deadlines-2026.json from backup.');
  } else {
    console.log('[REVERT] No deadlines backup found — JSON may already be original.');
  }

  // 2. Restore mutated bill rows, remove created demo bills + assignments.
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.log('[REVERT] No DB snapshot found — nothing to restore in the database.');
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));

  // Remove the user_bills assignments we created.
  for (const a of snapshot.assignments ?? []) {
    await db.deleteFrom('user_bills')
      .where('user_id', '=', a.user_id)
      .where('bill_id', '=', a.bill_id)
      .execute();
  }
  console.log(`[REVERT] Removed ${snapshot.assignments?.length ?? 0} user_bills assignment(s).`);

  // Restore original values on bills we mutated.
  for (const b of snapshot.bills ?? []) {
    await db.updateTable('bills')
      .set({
        current_status_string: b.original.current_status_string,
        bill_status: b.original.bill_status,
        dead: b.original.dead,
      })
      .where('id', '=', b.id)
      .execute();
  }
  console.log(`[REVERT] Restored ${snapshot.bills?.length ?? 0} mutated bill row(s).`);

  // Delete demo bills we created (and any stray assignments to them).
  for (const id of snapshot.createdBillIds ?? []) {
    await db.deleteFrom('user_bills').where('bill_id', '=', id).execute();
    await db.deleteFrom('bills').where('id', '=', id).execute();
  }
  console.log(`[REVERT] Deleted ${snapshot.createdBillIds?.length ?? 0} demo bill(s).`);

  fs.unlinkSync(SNAPSHOT_PATH);
  console.log('[REVERT] Snapshot consumed. Database restored to pre-seed state.');
}

// ── entry ────────────────────────────────────────────────────────────────────

const mode = process.argv[2];
(async () => {
  try {
    if (mode === '--check') await check();
    else if (mode === '--seed') await seed();
    else if (mode === '--revert') await revert();
    else {
      console.log('Usage: node scripts/seed-e2e-notifications.js [--check | --seed | --revert]');
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR]', err?.message || err);
    process.exitCode = 1;
  } finally {
    await db.destroy?.();
  }
})();
