import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChangesByUser } from './notificationService.js';

const change = (over) => ({
  bill_id: 'b1', bill_number: 'HB1', bill_title: 'One',
  old_status: 'Passed 2nd', new_status: 'Referred to JDC',
  old_dead: false, new_dead: false, ...over,
});

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
