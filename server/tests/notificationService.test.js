import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChangesByUser, sendStatusChangeNotifications } from '../services/notificationService.js';

const change = (over) => ({
  bill_id: 'b1', bill_number: 'HB1', bill_title: 'One',
  old_status: 'scheduled2', new_status: 'passedCommittees',
  old_dead: false, new_dead: false, ...over,
});

// Stub so the hearing-today enrichment never touches the DB in these unit tests.
const noHearings = async () => new Map();

test('groupChangesByUser groups multiple bills under one user', () => {
  const rows = [
    { user_id: 'u1', email: 'a@x.com', change: change({ bill_number: 'HB1' }) },
    { user_id: 'u1', email: 'a@x.com', change: change({ bill_id: 'b2', bill_number: 'HB2', old_status: 'x', new_status: 'x', new_dead: true }) },
  ];
  const grouped = groupChangesByUser(rows);
  assert.equal(grouped.size, 1);
  const u1 = grouped.get('u1');
  assert.equal(u1.email, 'a@x.com');
  assert.equal(u1.lines.length, 2);
  assert.match(u1.lines[0], /HB1/);
  assert.match(u1.lines[1], /HB2/);
  assert.match(u1.lines[1], /DEAD/);
  // structured changes are carried alongside the text lines (for HTML rendering)
  assert.equal(u1.changes.length, 2);
  assert.equal(u1.changes[0].bill_number, 'HB1');
  assert.equal(u1.changes[1].bill_number, 'HB2');
});

test('groupChangesByUser separates different users', () => {
  const rows = [
    { user_id: 'u1', email: 'a@x.com', change: change({}) },
    { user_id: 'u2', email: 'b@x.com', change: change({}) },
  ];
  const grouped = groupChangesByUser(rows);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('u2').email, 'b@x.com');
});

test('groupChangesByUser returns empty map for no rows', () => {
  assert.equal(groupChangesByUser([]).size, 0);
});

// ---------------------------------------------------------------------------
// sendStatusChangeNotifications — orchestrator tests (injected fakes, no DB)
// ---------------------------------------------------------------------------

// old/new status are kanban bill_status enum ids (not raw Capitol text).
const mkChange = (over) => ({
  bill_id: 'b1', bill_number: 'HB1', bill_title: 'One',
  old_status: 'introduced', new_status: 'scheduled1',
  old_dead: false, new_dead: false, ...over,
});

test('sendStatusChangeNotifications: two followers of one bill each get an email', async () => {
  const calls = [];
  const fakeSend = async (email, lines, changes) => calls.push({ email, lines, changes });
  const fakeFollowers = async () => [
    { bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' },
    { bill_id: 'b1', user_id: 'u2', email: 'u2@test.com' },
  ];

  const result = await sendStatusChangeNotifications(
    [mkChange({})],
    { fetchFollowers: fakeFollowers, fetchHearingsToday: noHearings, sendEmail: fakeSend },
  );

  assert.equal(calls.length, 2, 'sendEmail called once per user');
  assert.equal(calls[0].email, 'u1@test.com');
  assert.equal(calls[1].email, 'u2@test.com');
  assert.equal(calls[0].changes.length, 1, 'sendEmail receives structured changes');
  assert.equal(calls[0].changes[0].bill_number, 'HB1');
  assert.equal(result.usersNotified, 2);
  assert.equal(result.changesSent, 1);
});

test('sendStatusChangeNotifications: one user following two changed bills gets one email with 2 lines', async () => {
  const calls = [];
  const fakeSend = async (email, lines) => calls.push({ email, lines });
  const fakeFollowers = async () => [
    { bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' },
    { bill_id: 'b2', user_id: 'u1', email: 'u1@test.com' },
  ];

  const result = await sendStatusChangeNotifications(
    [mkChange({ bill_id: 'b1', bill_number: 'HB1' }), mkChange({ bill_id: 'b2', bill_number: 'HB2' })],
    { fetchFollowers: fakeFollowers, fetchHearingsToday: noHearings, sendEmail: fakeSend },
  );

  assert.equal(calls.length, 1, 'only one email for one user');
  assert.equal(calls[0].lines.length, 2, 'two lines in the digest');
  assert.match(calls[0].lines[0], /HB1/);
  assert.match(calls[0].lines[1], /HB2/);
  assert.equal(result.usersNotified, 1);
  assert.equal(result.changesSent, 2);
});

test('sendStatusChangeNotifications: follower with null email is filtered out', async () => {
  const calls = [];
  const fakeSend = async (email, lines) => calls.push({ email, lines });
  const fakeFollowers = async () => [
    { bill_id: 'b1', user_id: 'u1', email: null },
    { bill_id: 'b1', user_id: 'u2', email: 'u2@test.com' },
  ];

  const result = await sendStatusChangeNotifications(
    [mkChange({})],
    { fetchFollowers: fakeFollowers, fetchHearingsToday: noHearings, sendEmail: fakeSend },
  );

  assert.equal(calls.length, 1, 'null-email user not sent to');
  assert.equal(calls[0].email, 'u2@test.com');
  assert.equal(result.usersNotified, 1);
});

test('sendStatusChangeNotifications: a hearing-today bill is annotated onto its change', async () => {
  const calls = [];
  const fakeSend = async (email, lines, changes) => calls.push({ email, changes });
  const fakeFollowers = async () => [{ bill_id: 'b1', user_id: 'u1', email: 'u1@test.com' }];
  const fakeHearings = async () => new Map([['b1', { date: '2026-03-06', time: '1:02PM' }]]);

  await sendStatusChangeNotifications(
    [mkChange({})],
    { fetchFollowers: fakeFollowers, fetchHearingsToday: fakeHearings, today: '2026-03-06', sendEmail: fakeSend },
  );

  assert.deepEqual(calls[0].changes[0].hearing_today, { date: '2026-03-06', time: '1:02PM' });
});

test('sendStatusChangeNotifications: empty changes → returns zeroes, no DB/email calls', async () => {
  let fetchCalled = false;
  let sendCalled = false;
  const fakeFollowers = async () => { fetchCalled = true; return []; };
  const fakeSend = async () => { sendCalled = true; };

  const result = await sendStatusChangeNotifications(
    [],
    { fetchFollowers: fakeFollowers, sendEmail: fakeSend },
  );

  assert.equal(result.usersNotified, 0);
  assert.equal(result.changesSent, 0);
  assert.equal(fetchCalled, false, 'fetchFollowers must NOT be called for empty changes');
  assert.equal(sendCalled, false, 'sendEmail must NOT be called for empty changes');
});

test('sendStatusChangeNotifications: changes present but no followers → no emails sent', async () => {
  const calls = [];
  const fakeSend = async (email, lines) => calls.push({ email, lines });
  const fakeFollowers = async () => [];

  const result = await sendStatusChangeNotifications(
    [mkChange({})],
    { fetchFollowers: fakeFollowers, sendEmail: fakeSend },
  );

  assert.equal(calls.length, 0, 'no emails when no followers');
  assert.equal(result.usersNotified, 0);
  assert.equal(result.changesSent, 1);
});
