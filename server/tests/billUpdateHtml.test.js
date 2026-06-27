import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillUpdateHtml } from '../services/notifications/bill-updates-digest.js';

const change = (over) => ({
  bill_id: 'b1', bill_number: 'HB123', bill_title: 'Local Food Act',
  old_status: 'waiting2', new_status: 'passedCommittees',
  old_dead: false, new_dead: false, ...over,
});

test('renders brand palette colors', () => {
  const html = buildBillUpdateHtml([change()]);
  assert.match(html, /#1F5C5E/, 'deep teal present');
  assert.match(html, /#FAF8F5/, 'cream background present');
  assert.match(html, /#DCE8E8/, 'teal-soft pill present');
});

test('renders bill number and title', () => {
  const html = buildBillUpdateHtml([change()]);
  assert.match(html, /HB123/);
  assert.match(html, /Local Food Act/);
});

test('status change renders human-readable old and new labels', () => {
  const html = buildBillUpdateHtml([change()]);
  // statusLabel maps ids → COLUMN_TITLES
  assert.match(html, /WAITING 2ND/);
  assert.match(html, /CONFERENCE/);
});

test('DEAD change renders coral pill', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'waiting2', new_status: 'waiting2', new_dead: true }),
  ]);
  assert.match(html, /#C97474/, 'coral present');
  assert.match(html, /DEAD/);
});

test('revived change renders olive pill', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'waiting2', new_status: 'waiting2', old_dead: true, new_dead: false }),
  ]);
  assert.match(html, /#A8B660/, 'olive present');
  assert.match(html, /ALIVE/);
});

test('CTA button links to APP_URL', () => {
  const html = buildBillUpdateHtml([change()]);
  const appUrl = process.env.APP_URL || 'https://foodplus.purplemaia.org';
  assert.ok(html.includes(`href="${appUrl}"`), 'CTA href points at APP_URL');
  assert.match(html, /View in\s+Bill Tracker/);
});

test('renders one card per change', () => {
  const html = buildBillUpdateHtml([
    change({ bill_number: 'HB1' }),
    change({ bill_id: 'b2', bill_number: 'SB9', bill_title: null }),
  ]);
  assert.match(html, /HB1/);
  assert.match(html, /SB9/);
  assert.match(html, /2 bills you follow/);
});

test('escapes HTML in bill title', () => {
  const html = buildBillUpdateHtml([change({ bill_title: 'A & B <script>' })]);
  assert.match(html, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
