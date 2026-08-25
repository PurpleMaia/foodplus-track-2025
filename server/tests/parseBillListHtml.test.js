import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBillListHtml } from '../services/scraping/all-bills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures', 'bill-list-www.html'), 'utf8');

test('parseBillListHtml extracts a bill row for each a.report link', () => {
  const bills = parseBillListHtml(fixture);
  // Fixture holds 1 header row + 5 data rows.
  assert.equal(bills.length, 5);
});

test('parseBillListHtml pulls all fields from the first row', () => {
  const [first] = parseBillListHtml(fixture);
  assert.equal(first.bill_number, 'HB9 HD1');
  assert.equal(first.year, '2026');
  assert.equal(first.bill_title, 'DESIGNATING HAWAII AS A PURPLE HEART STATE.');
  assert.match(first.bill_url, /measure_indiv\.aspx\?billtype=HB&billnumber=9&year=2026/);
  assert.equal(first.committee_assignment, 'PSM/WLA');
  assert.equal(first.introducer, 'KONG');
  // current_status is collapsed to a single line (newlines/whitespace squashed).
  assert.ok(!/\n/.test(first.current_status_string));
  assert.match(first.current_status_string, /Referred to PSM\/WLA/);
});

test('parseBillListHtml skips rows without a bill link', () => {
  const html = '<table><tr><th>header</th></tr><tr><td>no link here</td></tr></table>';
  assert.deepEqual(parseBillListHtml(html), []);
});

test('parseBillListHtml returns [] for empty / non-table html', () => {
  assert.deepEqual(parseBillListHtml('<html><body>nothing</body></html>'), []);
});
