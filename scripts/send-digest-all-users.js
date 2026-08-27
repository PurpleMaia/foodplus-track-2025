/**
 * Blast the branded bill-update digest to every user, for local testing.
 *
 * This is a LOCAL testing tool, not part of the production cron. The real cron
 * (`server/cron-scrape.js`) sends per-follower digests of actual scraped changes; this
 * script instead renders the real digest email (`buildBillUpdateHtml`) with SAMPLE data
 * and fans it out to all users in the `user` table.
 *
 * Safety:
 *   - Only SENDS to real addresses. Fake `@example.com` seed users (37 of ~38 in the local
 *     DB) are iterated but SKIPPED, so we never hard-bounce them and hurt sender reputation.
 *   - The logo is inlined as a base64 data URI, so it renders before the hosted
 *     `${APP_URL}/email/foodplus-logo.png` is deployed.
 *   - --seed also assigns a sample bill to jaden so the DB reflects a real follow;
 *     --revert removes exactly what --seed added.
 *
 * Modes:
 *   node scripts/send-digest-all-users.js --dry-run   # iterate all users, print who WOULD get an email, send nothing
 *   node scripts/send-digest-all-users.js --send       # actually send (skips @example.com)
 *   node scripts/send-digest-all-users.js --seed        # assign the sample bill to jaden (revertable)
 *   node scripts/send-digest-all-users.js --revert      # undo --seed
 *
 * --send implies the sample data below; it does NOT scrape.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/kysely/client.js';
import { buildBillUpdateHtml, buildBillUpdateBody } from '../server/services/notifications/bill-updates-digest.js';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(__dirname, '.send-digest-snapshot.json');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.ALERT_FROM || 'Hawaiʻi Bill Tracker <onboarding@resend.dev>';
const APP_URL = (process.env.APP_URL || 'https://foodplus.purplemaia.org').replace(/\/$/, '');
const JADEN_EMAIL = 'jaden.kapali@purplemaia.org';

// Real send is ALLOWLISTED to these addresses only. The `user` table holds other real
// inboxes (personal gmail, shared data@) we must not blast without consent — so even
// though they aren't @example.com, they're not on the list and get skipped. Widen this
// deliberately if you truly want to reach more people.
const SEND_ALLOWLIST = new Set([JADEN_EMAIL]);

// Sendable only if it's a real address AND on the allowlist.
const isSendable = (email) =>
  !!email && !/@example\.com$/i.test(email) && SEND_ALLOWLIST.has(email.toLowerCase());

// ── sample digest content (kanban stages + raw Capitol subtext) ──────────────
const sampleChanges = [
  { bill_id: 'aaa111', bill_number: 'HB812', bill_title: 'RELATING TO AGRICULTURE',
    old_status: 'scheduled1', new_status: 'waiting2', old_dead: false, new_dead: false,
    raw_status: '(H) 2/23/2026 Report adopted; Passed Second Reading, as amended (SD 1) and referred to WAM.',
    hearing_today: null },
  { bill_id: 'bbb222', bill_number: 'HB123', bill_title: 'RELATING TO LOCAL FOOD PROCUREMENT',
    old_status: 'introduced', new_status: 'scheduled1', old_dead: false, new_dead: false,
    raw_status: '(H) 2/23/2026 Bill scheduled to be heard by FIN on Wednesday, 02-25-26 2:00PM in House conference room 308 VIA VIDEOCONFERENCE.',
    hearing_today: { date: new Date().toISOString().split('T')[0], time: '2:00PM' } },
  { bill_id: 'ddd444', bill_number: 'HB456', bill_title: 'RELATING TO AGRICULTURAL LAND',
    old_status: 'waiting3', new_status: 'waiting3', old_dead: false, new_dead: true,
    raw_status: '(H) Carried over; failed to meet a decking deadline.', hearing_today: null },
];
const sampleLines = [
  'HB812 (RELATING TO AGRICULTURE): SCHEDULED 1ST → WAITING 2ND',
  'HB123 (RELATING TO LOCAL FOOD PROCUREMENT): INTRODUCED & WAITING 1ST → SCHEDULED 1ST',
  'HB456 (RELATING TO AGRICULTURAL LAND): FAILED',
];

function renderHtml() {
  let html = buildBillUpdateHtml(sampleChanges);
  const hostedLogo = `${APP_URL}/email/foodplus-logo.png`;
  const logoPath = path.join(ROOT, 'public', 'email', 'foodplus-logo.png');
  if (fs.existsSync(logoPath) && html.includes(hostedLogo)) {
    const dataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
    html = html.split(hostedLogo).join(dataUri);
  }
  return html;
}

async function sendOne(toEmail, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [toEmail],
      subject: 'Hawaiʻi Bill Tracker: 3 updates on bills you follow',
      text, html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function blast({ dryRun }) {
  if (!dryRun && !RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const users = await db.selectFrom('user').select(['id', 'email']).execute();
  const html = renderHtml();
  const text = buildBillUpdateBody(sampleLines);

  let sent = 0, skipped = 0;
  console.log(`[BLAST] ${users.length} users. Mode: ${dryRun ? 'DRY-RUN (no sends)' : 'SEND'}\n`);
  for (const u of users) {
    if (!isSendable(u.email)) {
      skipped++;
      const why = !u.email ? 'no email'
        : /@example\.com$/i.test(u.email) ? 'example.com (fake)'
        : 'not on send allowlist';
      console.log(`  skip   ${u.email || '(no email)'} — ${why}`);
      continue;
    }
    if (dryRun) {
      console.log(`  WOULD  ${u.email}`);
      sent++;
      continue;
    }
    try {
      const id = await sendOne(u.email, html, text);
      console.log(`  sent   ${u.email} — id ${id}`);
      sent++;
    } catch (err) {
      console.error(`  FAIL   ${u.email} — ${err.message}`);
    }
  }
  console.log(`\n[BLAST] Done. ${dryRun ? 'would-send' : 'sent'}: ${sent}, skipped: ${skipped}.`);
}

// ── --seed / --revert: make jaden follow the sample bill ─────────────────────
async function seed() {
  if (fs.existsSync(SNAPSHOT_PATH)) throw new Error('Snapshot exists — run --revert first.');
  const jaden = await db.selectFrom('user').select(['id']).where('email', '=', JADEN_EMAIL).executeTakeFirst();
  if (!jaden) throw new Error(`No user ${JADEN_EMAIL}`);
  // Pick a real classified bill jaden does NOT already follow.
  const followed = (await db.selectFrom('user_bills').select(['bill_id']).where('user_id', '=', jaden.id).execute()).map(r => r.bill_id);
  const bill = await db.selectFrom('bills').select(['id', 'bill_number'])
    .where('bill_status', 'is not', null).where('bill_number', 'is not', null)
    .$if(followed.length > 0, qb => qb.where('id', 'not in', followed))
    .limit(1).executeTakeFirst();
  if (!bill) throw new Error('No eligible bill to assign.');
  // tenant_id: copy from an existing user_bills row for jaden, else any row.
  const tenantRow = await db.selectFrom('user_bills').select(['tenant_id']).where('user_id', '=', jaden.id).limit(1).executeTakeFirst()
    ?? await db.selectFrom('user_bills').select(['tenant_id']).limit(1).executeTakeFirst();
  const inserted = await db.insertInto('user_bills')
    .values({ user_id: jaden.id, bill_id: bill.id, tenant_id: tenantRow?.tenant_id ?? null })
    .returning('id').executeTakeFirst();
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ userBillId: inserted.id, bill_number: bill.bill_number }, null, 2));
  console.log(`[SEED] Assigned ${bill.bill_number} to ${JADEN_EMAIL} (user_bills ${inserted.id}). Snapshot written.`);
}

async function revert() {
  if (!fs.existsSync(SNAPSHOT_PATH)) { console.log('[REVERT] No snapshot — nothing to undo.'); return; }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
  await db.deleteFrom('user_bills').where('id', '=', snap.userBillId).execute();
  fs.unlinkSync(SNAPSHOT_PATH);
  console.log(`[REVERT] Removed the seeded follow (${snap.bill_number}). Snapshot consumed.`);
}

// ── entry ────────────────────────────────────────────────────────────────────
const mode = process.argv[2];
(async () => {
  try {
    if (mode === '--dry-run') await blast({ dryRun: true });
    else if (mode === '--send') await blast({ dryRun: false });
    else if (mode === '--seed') await seed();
    else if (mode === '--revert') await revert();
    else {
      console.log('Usage: node scripts/send-digest-all-users.js [--dry-run | --send | --seed | --revert]');
      process.exit(1);
    }
  } catch (err) {
    console.error('[ERROR]', err?.message || err);
    process.exitCode = 1;
  } finally {
    await db.destroy?.();
  }
})();
