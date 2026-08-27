import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkApproachingDeadlines,
  checkTestimonyDeadlines,
  groupWarningsByUser,
  sendDeadlineWarnings,
} from '../services/notifications/deadline-warnings.js';

// A scheduling status line carrying a hearing date in the real Capitol shape
// (MM-DD-YY), for testimony-deadline tests. `iso` is YYYY-MM-DD.
const sched = (iso) => {
  const [y, m, d] = iso.split('-');
  return { date: iso, statustext: `will hold a public hearing on ${m}-${d}-${y.slice(2)} 1:02PM` };
};

const bill = (over) => ({
  id: 'b1', bill_number: 'HB1', bill_title: 'RELATING TO X',
  bill_status: 'waiting2', committee_assignment: 'AGR', ...over,
});

// --- checkApproachingDeadlines ---------------------------------------------

test('checkApproachingDeadlines returns bills within the warning window', async () => {
  const warnings = await checkApproachingDeadlines('2026-02-27', {
    fetchBills: async () => [bill()],
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].tier, '7');
  assert.equal(warnings[0].nextName, 'First Decking');
});

test('checkApproachingDeadlines omits bills outside the window', async () => {
  const warnings = await checkApproachingDeadlines('2026-01-01', { // far out, no warning
    fetchBills: async () => [bill()],
  });
  assert.equal(warnings.length, 0, 'no bill warned this far out');
});

// --- groupWarningsByUser ----------------------------------------------------

test('groupWarningsByUser groups per user and flags urgent', () => {
  const rows = [
    { user_id: 'u1', email: 'a@x.com', item: { tier: '7', bill_number: 'HB1' } },
    { user_id: 'u1', email: 'a@x.com', item: { tier: '3', bill_number: 'HB2' } },
    { user_id: 'u2', email: 'b@x.com', item: { tier: '7', bill_number: 'HB1' } },
  ];
  const grouped = groupWarningsByUser(rows);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('u1').items.length, 2);
  assert.equal(grouped.get('u1').urgent, true, 'u1 has a 3-day bill → urgent');
  assert.equal(grouped.get('u2').urgent, false, 'u2 only has 7-day bills');
});

// --- sendDeadlineWarnings ---------------------------------------------------

const warning = (over) => ({
  bill: bill(over?.bill),
  nextName: 'First Decking', nextDate: '2026-03-06', daysLeft: 7, tier: '7', ...over,
});

test('sendDeadlineWarnings: two followers of one bill each get an email', async () => {
  const calls = [];
  const result = await sendDeadlineWarnings([warning()], {
    fetchFollowers: async () => [
      { bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' },
      { bill_id: 'b1', user_id: 'u2', email: 'u2@test.com' },
    ],
    sendEmail: async (email, items, opts) => calls.push({ email, items, opts }),
  });
  assert.equal(calls.length, 2);
  assert.equal(result.usersNotified, 2);
  assert.equal(calls[0].items[0].deadline_name, 'First Decking');
  assert.equal(calls[0].opts.urgent, false);
});

test('sendDeadlineWarnings: urgent flag set when a tier-3 bill is present', async () => {
  const calls = [];
  await sendDeadlineWarnings([warning({ tier: '3', daysLeft: 2 })], {
    fetchFollowers: async () => [{ bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' }],
    sendEmail: async (email, items, opts) => calls.push(opts),
  });
  assert.equal(calls[0].urgent, true);
});

test('sendDeadlineWarnings: no warnings → no email, zero counts', async () => {
  let sent = false;
  const result = await sendDeadlineWarnings([], {
    fetchFollowers: async () => { throw new Error('should not fetch'); },
    sendEmail: async () => { sent = true; },
  });
  assert.equal(sent, false);
  assert.equal(result.usersNotified, 0);
});

test('sendDeadlineWarnings: no followers → no email', async () => {
  const calls = [];
  const result = await sendDeadlineWarnings([warning()], {
    fetchFollowers: async () => [],
    sendEmail: async (...a) => calls.push(a),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.usersNotified, 0);
  assert.equal(result.billsWarned, 1);
});

// --- checkTestimonyDeadlines -----------------------------------------------

test('checkTestimonyDeadlines flags a bill whose hearing is today (testimony due now)', async () => {
  const warnings = await checkTestimonyDeadlines('2026-03-06', {
    fetchBills: async () => [{ ...bill(), statusUpdates: [sched('2026-03-06')] }],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].tier, '3', 'testimony closing is always urgent');
  assert.equal(warnings[0].testimony, true);
  assert.match(warnings[0].nextName, /Testimony deadline/);
  assert.equal(warnings[0].nextDate, '2026-03-06');
});

test('checkTestimonyDeadlines flags a hearing tomorrow but not one 3 days out', async () => {
  const tomorrow = await checkTestimonyDeadlines('2026-03-06', {
    fetchBills: async () => [{ ...bill(), statusUpdates: [sched('2026-03-07')] }],
  });
  assert.equal(tomorrow.length, 1);

  const later = await checkTestimonyDeadlines('2026-03-06', {
    fetchBills: async () => [{ ...bill(), statusUpdates: [sched('2026-03-10')] }],
  });
  assert.equal(later.length, 0);
});

test('checkTestimonyDeadlines ignores bills with no upcoming hearing', async () => {
  const warnings = await checkTestimonyDeadlines('2026-03-06', {
    fetchBills: async () => [{ ...bill(), statusUpdates: [{ date: '2026-03-01', statustext: 'Reported from AGR.' }] }],
  });
  assert.equal(warnings.length, 0);
});

test('sendDeadlineWarnings: a testimony warning wins the per-bill slot over a legislative one', async () => {
  const calls = [];
  // Same bill in both lists: a legislative deadline (tier 7) and a testimony close (tier 3).
  const legislative = warning({ nextName: 'First Decking', tier: '7' });
  const testimony = warning({ nextName: 'Testimony deadline', nextDate: '2026-03-06', daysLeft: 0, tier: '3', testimony: true });
  const result = await sendDeadlineWarnings([legislative, testimony], {
    fetchFollowers: async () => [{ bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' }],
    sendEmail: async (email, items, opts) => calls.push({ items, opts }),
  });
  assert.equal(result.usersNotified, 1);
  assert.equal(calls[0].items.length, 1, 'one bill, one item (deduped)');
  assert.match(calls[0].items[0].deadline_name, /Testimony deadline/, 'testimony wins the slot');
  assert.equal(calls[0].opts.urgent, true, 'testimony tier 3 makes the email urgent');
});
