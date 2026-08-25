import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBillNumber } from '../services/scraping/all-bills.js';

// The list report renders the bill number WITH adopted draft markers appended
// (e.g. "HB1513 HD1"), but the DB stores — and the frontend expects — the bare
// number ("HB1513"). Storing the suffixed form breaks (bill_number, year)
// identity and the BillsTable link that does bill_number.replace('HB', '').

test('strips a single draft suffix', () => {
  assert.equal(normalizeBillNumber('HB1513 HD1'), 'HB1513');
});

test('strips stacked draft suffixes (HD/SD/CD)', () => {
  assert.equal(normalizeBillNumber('HB20 HD1 SD2'), 'HB20');
  assert.equal(normalizeBillNumber('HB48 HD2 SD1 CD1'), 'HB48');
  assert.equal(normalizeBillNumber('SB6 SD1'), 'SB6');
});

test('leaves a bare bill number unchanged', () => {
  assert.equal(normalizeBillNumber('HB1513'), 'HB1513');
  assert.equal(normalizeBillNumber('SB1'), 'SB1');
});

test('trims surrounding whitespace', () => {
  assert.equal(normalizeBillNumber('  HB9 HD1  '), 'HB9');
});

test('handles null/empty defensively', () => {
  assert.equal(normalizeBillNumber(null), null);
  assert.equal(normalizeBillNumber(''), '');
});
