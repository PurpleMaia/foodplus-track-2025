import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillUpdateBody } from './alertService.js';

test('buildBillUpdateBody lists each change line', () => {
  const body = buildBillUpdateBody([
    'HB123 (Local Food Act): WAITING 2ND → CONFERENCE',
    'SB9 (Test): now marked DEAD',
  ]);
  assert.match(body, /HB123/);
  assert.match(body, /SB9/);
  assert.match(body, /CONFERENCE/);
});

test('buildBillUpdateBody includes an intro line', () => {
  const body = buildBillUpdateBody(['HB1: x → y']);
  assert.match(body, /bill|follow|update/i);
});
