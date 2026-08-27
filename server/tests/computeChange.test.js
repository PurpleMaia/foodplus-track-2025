import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChange } from '../services/scrapingService.js';

// old/new status are KANBAN bill_status enum ids (introduced, scheduled1, ...), not raw
// Capitol text — detection keys on the stage move, so a wording tweak within one stage
// no longer counts as a change.
test('computeChange returns a record when the kanban stage changed', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'scheduled2', newStatus: 'passedCommittees',
    oldDead: false, newDead: false,
  });
  assert.ok(rec);
  assert.equal(rec.bill_id, 'b1');
  assert.equal(rec.bill_number, 'HB1');
  assert.equal(rec.old_status, 'scheduled2');
  assert.equal(rec.new_status, 'passedCommittees');
});

test('computeChange returns a record when dead flipped', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'waiting2', newStatus: 'waiting2',
    oldDead: false, newDead: true,
  });
  assert.ok(rec);
  assert.equal(rec.old_dead, false);
  assert.equal(rec.new_dead, true);
});

test('computeChange returns null when the stage and dead flag are unchanged', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Food Act',
    oldStatus: 'waiting2', newStatus: 'waiting2',
    oldDead: false, newDead: false,
  });
  assert.equal(rec, null);
});

test('computeChange treats first-seen (null old) stage as a change only if new differs', () => {
  assert.ok(computeChange({ billId: 'b1', billNumber: 'HB1', billTitle: null, oldStatus: null, newStatus: 'introduced', oldDead: false, newDead: false }));
  assert.equal(computeChange({ billId: 'b1', billNumber: 'HB1', billTitle: null, oldStatus: null, newStatus: null, oldDead: false, newDead: false }), null);
});

test('computeChange preserves bill_title in the returned record', () => {
  const rec = computeChange({
    billId: 'b1', billNumber: 'HB1', billTitle: 'Relating to Food Safety',
    oldStatus: null, newStatus: 'introduced',
    oldDead: false, newDead: false,
  });
  assert.ok(rec);
  assert.equal(rec.bill_title, 'Relating to Food Safety');
});
