import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkApproachingDeadlines,
  groupWarningsByUser,
  sendDeadlineWarnings,
} from '../services/notifications/deadline-warnings.js';

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
