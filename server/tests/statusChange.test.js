import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel, diffBillState, describeChange } from '../services/statusChange.js';

test('statusLabel maps known status to title', () => {
  assert.equal(statusLabel('passedCommittees'), 'CONFERENCE');
});

test('statusLabel falls back to raw id for unknown status', () => {
  assert.equal(statusLabel('someFutureStatus'), 'someFutureStatus');
});

test('statusLabel handles null', () => {
  assert.equal(statusLabel(null), 'Unknown');
});

test('diffBillState detects a status change', () => {
  const r = diffBillState({ oldStatus: 'waiting2', newStatus: 'passedCommittees', oldDead: false, newDead: false });
  assert.equal(r.changed, true);
  assert.equal(r.statusChanged, true);
  assert.equal(r.deadChanged, false);
});

test('diffBillState detects a dead flip', () => {
  const r = diffBillState({ oldStatus: 'waiting2', newStatus: 'waiting2', oldDead: false, newDead: true });
  assert.equal(r.changed, true);
  assert.equal(r.statusChanged, false);
  assert.equal(r.deadChanged, true);
});

test('diffBillState reports no change when nothing moved', () => {
  const r = diffBillState({ oldStatus: 'waiting2', newStatus: 'waiting2', oldDead: false, newDead: false });
  assert.equal(r.changed, false);
});

test('diffBillState treats null->value as a change', () => {
  const r = diffBillState({ oldStatus: null, newStatus: 'introduced', oldDead: false, newDead: false });
  assert.equal(r.statusChanged, true);
  assert.equal(r.changed, true);
});

test('diffBillState treats null->null as no change', () => {
  const r = diffBillState({ oldStatus: null, newStatus: null, oldDead: false, newDead: false });
  assert.equal(r.changed, false);
});

test('diffBillState normalizes nullish dead to false', () => {
  const r = diffBillState({ oldStatus: 'waiting2', newStatus: 'waiting2', oldDead: null, newDead: false });
  assert.equal(r.deadChanged, false);
});

test('describeChange renders status transition and dead flip', () => {
  const line = describeChange({
    billNumber: 'HB123', billTitle: 'Local Food Act',
    oldStatus: 'waiting2', newStatus: 'passedCommittees',
    oldDead: false, newDead: true,
  });
  assert.match(line, /HB123/);
  assert.match(line, /Local Food Act/);
  assert.match(line, /WAITING 2ND/);
  assert.match(line, /CONFERENCE/);
  assert.match(line, /DEAD/);
});

test('describeChange omits status arrow when only dead changed', () => {
  const line = describeChange({
    billNumber: 'SB9', billTitle: 'Test',
    oldStatus: 'waiting2', newStatus: 'waiting2',
    oldDead: true, newDead: false,
  });
  assert.doesNotMatch(line, /→/);
  assert.match(line, /revived|ALIVE/i);
});
