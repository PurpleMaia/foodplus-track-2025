import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDigestItems,
  buildDailyDigestHtml,
  buildDailyDigestBody,
  DAILY_DIGEST_SUBJECT,
} from '../services/notifications/bill-updates-digest.js';

// A status change record (as produced by computeChange, plus hearing_today).
const change = (over = {}) => ({
  bill_id: 'b1', bill_number: 'HB1', bill_title: 'RELATING TO FOOD',
  old_status: 'introduced', new_status: 'scheduled1', old_dead: false, new_dead: false,
  raw_status: 'The committee(s) on JHA has scheduled a public hearing on 09-16-26.',
  hearing_today: null, ...over,
});

// A deadline-warning item (as produced by sendDeadlineWarnings' itemByBill).
const warning = (over = {}) => ({
  bill_id: 'b2', bill_number: 'HB2', bill_title: 'RELATING TO WATER',
  current_status: 'waiting2', deadline_name: 'First Lateral', deadline_date: '2026-09-20',
  days_left: 2, tier: '3', ...over,
});

// -----------------------------------------------------------------------------
// mergeDigestItems — union of changes + warnings, keyed by bill, urgent first
// -----------------------------------------------------------------------------
test('merge: a bill that only changed produces a change-only item', () => {
  const items = mergeDigestItems([change()], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].bill_id, 'b1');
  assert.ok(items[0].change, 'has change');
  assert.equal(items[0].warning, null, 'no warning');
});

test('merge: a bill that is only at-risk produces a warning-only item', () => {
  const items = mergeDigestItems([], [warning()]);
  assert.equal(items.length, 1);
  assert.equal(items[0].bill_id, 'b2');
  assert.equal(items[0].change, null);
  assert.ok(items[0].warning);
});

test('merge: a bill that both changed AND is at-risk becomes ONE item carrying both', () => {
  const items = mergeDigestItems(
    [change({ bill_id: 'x', bill_number: 'HBX' })],
    [warning({ bill_id: 'x', bill_number: 'HBX' })],
  );
  assert.equal(items.length, 1, 'deduped to one card');
  assert.ok(items[0].change, 'has change');
  assert.ok(items[0].warning, 'has warning');
});

test('merge: urgent (tier 3) items sort before non-urgent, changed-only last', () => {
  const items = mergeDigestItems(
    [change({ bill_id: 'chg', bill_number: 'CHG' })],
    [
      warning({ bill_id: 'soon', bill_number: 'SOON', tier: '7', days_left: 6 }),
      warning({ bill_id: 'urg', bill_number: 'URG', tier: '3', days_left: 1 }),
    ],
  );
  assert.deepEqual(items.map((i) => i.bill_id), ['urg', 'soon', 'chg']);
});

test('merge: carries hearing_today onto the merged item', () => {
  const items = mergeDigestItems(
    [change({ bill_id: 'h', hearing_today: { date: '2026-09-16', time: '2:00PM' } })],
    [],
  );
  assert.deepEqual(items[0].hearing_today, { date: '2026-09-16', time: '2:00PM' });
});

// -----------------------------------------------------------------------------
// buildDailyDigestHtml — one email, both kinds of content, single CTA per card
// -----------------------------------------------------------------------------
test('subject is a constant daily-digest line with no counts', () => {
  assert.match(DAILY_DIGEST_SUBJECT, /daily digest/i);
  assert.doesNotMatch(DAILY_DIGEST_SUBJECT, /\d/, 'no counts in the subject');
});

test('html: a changed bill shows status pills and meaning', () => {
  const html = buildDailyDigestHtml(mergeDigestItems([change({ bill_id: 'b1' })], []));
  assert.match(html, /HB1/);
  assert.match(html, /scheduled for a committee hearing/i);
});

test('html: an at-risk bill shows the deadline line', () => {
  const html = buildDailyDigestHtml(mergeDigestItems([], [warning()]));
  assert.match(html, /First Lateral/);
  assert.match(html, /2026-09-20/);
  assert.match(html, /2 days left/);
});

test('html: deadline CTA — scheduled -> testimony, else -> contact', () => {
  const sched = buildDailyDigestHtml(mergeDigestItems([], [warning({ bill_id: 's', current_status: 'scheduled1' })]));
  assert.match(sched, /Submit testimony/);
  assert.match(sched, /\/bills\/s\/testimony/);

  const wait = buildDailyDigestHtml(mergeDigestItems([], [warning({ bill_id: 'w', current_status: 'waiting2' })]));
  assert.match(wait, /Contact your legislator/);
  assert.match(wait, /\/bills\/w\/contact/);
});

test('html: accent is coral when any item is urgent, teal otherwise', () => {
  const urgent = buildDailyDigestHtml(mergeDigestItems([], [warning({ tier: '3' })]));
  assert.match(urgent, /#BE4934/, 'coral accent present when urgent');

  const calm = buildDailyDigestHtml(mergeDigestItems([change()], []));
  assert.match(calm, /#255E6D/, 'teal accent when nothing urgent');
});

test('html: a bill both changed and at-risk renders one card with both pills and deadline', () => {
  const html = buildDailyDigestHtml(mergeDigestItems(
    [change({ bill_id: 'x', bill_number: 'HBX' })],
    [warning({ bill_id: 'x', bill_number: 'HBX', current_status: 'scheduled1' })],
  ));
  // Only one card for HBX (bill number appears once as the card header)
  assert.equal((html.match(/HBX/g) || []).length, 1);
  assert.match(html, /First Lateral/, 'deadline line present');
  assert.match(html, /Submit testimony/, 'scheduled CTA');
});

test('body: plain-text digest lists changed and at-risk bills', () => {
  const body = buildDailyDigestBody(mergeDigestItems([change()], [warning()]));
  assert.match(body, /HB1/);
  assert.match(body, /HB2/);
  assert.match(body, /First Lateral/);
});

test('renders logo (CID) and footer credits', () => {
  const html = buildDailyDigestHtml(mergeDigestItems([change()], []));
  assert.match(html, /src="cid:foodplus-logo"/);
  assert.match(html, /Purple Maiʻa Foundation/);
});
