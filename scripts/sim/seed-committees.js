/**
 * Seed FAKE committees + chair legislators for Sim Week, so the two committees the
 * sim exercises (JHA origin, CPN receiving) have a "chair" whose email is YOUR
 * inbox tagged by committee code (Gmail + addressing). A participant who "contacts
 * the chair" during the sim then mails you at jaden.kapali+<code>@… instead of a
 * real Hawaiʻi legislator.
 *
 *   node scripts/sim/seed-committees.js            # create (idempotent upsert)
 *   node scripts/sim/seed-committees.js --list     # show what's seeded
 *   node scripts/sim/seed-committees.js --remove    # tear down only the fakes
 *
 * ISOLATION / SAFETY
 * - These are SEPARATE rows from the real JHA/CPN committees. Real committees,
 *   legislators, and chairs are never read or modified.
 * - Fakes are tagged so removal only ever hits them:
 *     committees.acronym      starts with SIM_ACRONYM_PREFIX ("SIM-")
 *     legislators.member_id   starts with SIM_MEMBER_PREFIX  ("SIM-")
 *   Real acronyms are bare (e.g. "JHA") and real member_ids are numeric strings,
 *   so a prefixed delete can never touch production data.
 * - Nothing in the app currently RESOLVES a bill→committee→chair→email (verified),
 *   so this seed is inert to the running app: it just parks contact rows in the DB
 *   for the sim/demo and for any future "contact your chair" feature to read.
 */

import { db } from '../../db/kysely/client.js';

const SIM_ACRONYM_PREFIX = 'SIM-';
const SIM_MEMBER_PREFIX = 'SIM-';

/** Base inbox for the tagged +code addresses (falls back to the known alert addr). */
const BASE_EMAIL = process.env.ALERT_EMAIL || 'jaden.kapali@purplemaia.org';
const [local, domain] = BASE_EMAIL.split('@');
const tagged = (code) => `${local}+${code.toLowerCase()}@${domain}`;

/**
 * The committees the sim actually touches (see server/services/sim/scenarios.js:
 * COMMITTEE_1 = JHA origin/House, COMMITTEE_2 = CPN receiving/Senate). Each gets a
 * fake row with a SIM- acronym and a single fake chair on the tagged inbox.
 */
const SIM_COMMITTEES = [
  { code: 'JHA', name: 'Judiciary & Hawaiian Affairs (SIM)', chamber: 'House', chair: 'Sim Chair JHA' },
  { code: 'CPN', name: 'Commerce and Consumer Protection (SIM)', chamber: 'Senate', chair: 'Sim Chair CPN' },
];

const simAcronym = (code) => `${SIM_ACRONYM_PREFIX}${code}`;
const simMemberId = (code) => `${SIM_MEMBER_PREFIX}${code}`;

async function upsertCommittee(c) {
  const acronym = simAcronym(c.code);
  const existing = await db.selectFrom('committees').select('id').where('acronym', '=', acronym).executeTakeFirst();
  const values = { acronym, name: c.name, chamber: c.chamber, is_active: true, updated_at: new Date() };
  if (existing) {
    await db.updateTable('committees').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const row = await db.insertInto('committees').values({ ...values, created_at: new Date() }).returning('id').executeTakeFirst();
  return row.id;
}

async function upsertChairLegislator(c) {
  const memberId = simMemberId(c.code);
  const [firstName, ...rest] = c.chair.split(' ');
  const values = {
    last_name: rest.join(' ') || c.code,
    first_name: firstName,
    chamber: c.chamber,
    email: tagged(c.code),
    in_office: true,
    updated_at: new Date(),
  };
  const existing = await db.selectFrom('legislators').select('id').where('member_id', '=', memberId).executeTakeFirst();
  if (existing) {
    await db.updateTable('legislators').set(values).where('id', '=', existing.id).execute();
    return existing.id;
  }
  const row = await db.insertInto('legislators')
    .values({ member_id: memberId, created_at: new Date(), ...values })
    .returning('id').executeTakeFirst();
  return row.id;
}

async function linkChair(committeeId, legislatorId) {
  const existing = await db.selectFrom('committee_chairs').select('id')
    .where('committee_id', '=', committeeId).where('legislator_id', '=', legislatorId).executeTakeFirst();
  if (existing) {
    await db.updateTable('committee_chairs')
      .set({ role: 'chair', is_active: true, ended_at: null, updated_at: new Date() })
      .where('id', '=', existing.id).execute();
    return;
  }
  await db.insertInto('committee_chairs').values({
    committee_id: committeeId,
    legislator_id: legislatorId,
    role: 'chair',
    is_active: true,
    started_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();
}

/**
 * Seed the fake sim committees + chairs. Does NOT close the db connection, so it
 * can be called inline by other scripts (e.g. scripts/sim/seed.js) as well as run
 * standalone. Idempotent.
 * @returns {Promise<Array<{committee: string, chair: string, email: string}>>}
 */
export async function seedSimCommittees() {
  const out = [];
  for (const c of SIM_COMMITTEES) {
    const committeeId = await upsertCommittee(c);
    const legislatorId = await upsertChairLegislator(c);
    await linkChair(committeeId, legislatorId);
    out.push({ committee: simAcronym(c.code), chair: c.chair, email: tagged(c.code) });
  }
  return out;
}

async function seed() {
  const out = await seedSimCommittees();
  console.log('Seeded fake sim committees + chairs:');
  for (const r of out) console.log(`  ${r.committee.padEnd(8)} chair "${r.chair}"  ->  ${r.email}`);
}

async function list() {
  const rows = await db.selectFrom('committees as c')
    .leftJoin('committee_chairs as cc', 'cc.committee_id', 'c.id')
    .leftJoin('legislators as l', 'l.id', 'cc.legislator_id')
    .select(['c.acronym', 'c.name', 'c.chamber', 'cc.role', 'l.first_name', 'l.last_name', 'l.email', 'l.member_id'])
    .where('c.acronym', 'like', `${SIM_ACRONYM_PREFIX}%`)
    .execute();
  if (!rows.length) return console.log('No sim committees seeded.');
  console.log('Sim committees currently seeded:');
  for (const r of rows) {
    console.log(`  ${r.acronym.padEnd(8)} ${r.chamber ?? '?'}  chair=${r.first_name ?? ''} ${r.last_name ?? ''} <${r.email ?? 'none'}> (member_id ${r.member_id ?? 'n/a'})`);
  }
}

/** Remove ONLY the SIM- prefixed fakes: chairs, then legislators, then committees. */
async function remove() {
  const committees = await db.selectFrom('committees').select('id').where('acronym', 'like', `${SIM_ACRONYM_PREFIX}%`).execute();
  const legislators = await db.selectFrom('legislators').select('id').where('member_id', 'like', `${SIM_MEMBER_PREFIX}%`).execute();
  const cIds = committees.map((r) => r.id);
  const lIds = legislators.map((r) => r.id);

  if (cIds.length) await db.deleteFrom('committee_chairs').where('committee_id', 'in', cIds).execute();
  if (lIds.length) await db.deleteFrom('committee_chairs').where('legislator_id', 'in', lIds).execute();
  if (lIds.length) await db.deleteFrom('legislators').where('id', 'in', lIds).execute();
  if (cIds.length) await db.deleteFrom('committees').where('id', 'in', cIds).execute();

  console.log(`Removed ${cIds.length} sim committee(s) and ${lIds.length} sim legislator(s).`);
}

// Run the CLI only when invoked directly (not when imported by seed.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv.includes('--remove') ? remove
    : process.argv.includes('--list') ? list
    : seed;

  mode()
    .then(() => db.destroy())
    .catch(async (err) => { console.error(err); try { await db.destroy(); } catch { /* ignore */ } process.exit(1); });
}
