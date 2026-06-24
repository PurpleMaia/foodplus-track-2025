import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChange } from './scrapingService.js';

test('computeChange returns a record when status string changed', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'Passed 2nd reading', newStatus: 'Referred to JDC',
    oldDead: false, newDead: false,
  });
  assert.ok(rec);
  assert.equal(rec.bill_id, 'b1');
  assert.equal(rec.bill_number, 'HB1');
  assert.equal(rec.old_status, 'Passed 2nd reading');
  assert.equal(rec.new_status, 'Referred to JDC');
});

test('computeChange returns a record when dead flipped', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'Referred to JDC', newStatus: 'Referred to JDC',
    oldDead: false, newDead: true,
  });
  assert.ok(rec);
  assert.equal(rec.old_dead, false);
  assert.equal(rec.new_dead, true);
});

test('computeChange returns null when nothing changed', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'Referred to JDC', newStatus: 'Referred to JDC',
    oldDead: false, newDead: false,
  });
  assert.equal(rec, null);
});

test('computeChange treats first-seen (null old) status as a change only if new differs', () => {
  assert.ok(computeChange({ billId: 'b1', billNumber: 'HB1', billTitle: null, oldStatus: null, newStatus: 'Introduced', oldDead: false, newDead: false }));
  assert.equal(computeChange({ billId: 'b1', billNumber: 'HB1', billTitle: null, oldStatus: null, newStatus: null, oldDead: false, newDead: false }), null);
});
