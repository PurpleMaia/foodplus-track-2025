import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeadlineWarning, tierForDaysLeft } from '../services/notifications/deadline-warnings.js';

// HB1 at waiting2 (single committee AGR) → First Decking on 2026-03-06.
// Stateless: the tier depends only on days remaining.
const bill = (over) => ({
  id: 'b1', bill_number: 'HB1', bill_title: 'RELATING TO X',
  bill_status: 'waiting2', committee_assignment: 'AGR', ...over,
});

test('8 days out → no tier', () => {
  const r = computeDeadlineWarning(bill(), '2026-02-26'); // 8 days before
  assert.equal(r.nextName, 'First Decking');
  assert.equal(r.daysLeft, 8);
  assert.equal(r.tier, null);
});

test('exactly 7 days out → tier 7 heads-up', () => {
  const r = computeDeadlineWarning(bill(), '2026-02-27'); // 7 days before
  assert.equal(r.daysLeft, 7);
  assert.equal(r.tier, '7');
});

test('5 days out → still tier 7 (daily countdown, no de-dup state)', () => {
  const r = computeDeadlineWarning(bill(), '2026-03-01'); // 5 days before
  assert.equal(r.daysLeft, 5);
  assert.equal(r.tier, '7');
});

test('3 days out → tier 3 urgent', () => {
  const r = computeDeadlineWarning(bill(), '2026-03-03'); // 3 days before
  assert.equal(r.daysLeft, 3);
  assert.equal(r.tier, '3');
});

test('2 days out → tier 3 urgent', () => {
  const r = computeDeadlineWarning(bill(), '2026-03-04'); // 2 days before
  assert.equal(r.daysLeft, 2);
  assert.equal(r.tier, '3');
});

test('no upcoming deadline → null', () => {
  // Bill already at end of pipeline / all deadlines met.
  const r = computeDeadlineWarning(bill({ bill_status: 'governorSigns' }), '2026-03-01');
  assert.equal(r, null);
});

// Regression: a bill with no committee assignment must NOT crash the deadline calc.
// It still computes a deadline from date + status, treated as non-fiscal.
test('null committee → still computes a deadline, no crash', () => {
  const r = computeDeadlineWarning(bill({ committee_assignment: null }), '2026-02-27');
  assert.ok(r, 'expected a deadline result, got null');
  assert.equal(r.daysLeft, 7);
  assert.equal(r.tier, '7');
});

test('empty-string committee → treated as non-fiscal, no crash', () => {
  const r = computeDeadlineWarning(bill({ committee_assignment: '' }), '2026-02-27');
  assert.ok(r, 'expected a deadline result, got null');
  assert.equal(r.tier, '7');
});

// tierForDaysLeft thresholds — a passed deadline (negative days) must NOT be urgent.
test('tierForDaysLeft: passed deadline (negative) → null, not urgent', () => {
  assert.equal(tierForDaysLeft(-1), null);
  assert.equal(tierForDaysLeft(-5), null);
});

test('tierForDaysLeft: window boundaries', () => {
  assert.equal(tierForDaysLeft(0), '3');  // deadline is today — still urgent
  assert.equal(tierForDaysLeft(3), '3');
  assert.equal(tierForDaysLeft(4), '7');
  assert.equal(tierForDaysLeft(7), '7');
  assert.equal(tierForDaysLeft(8), null);
});
