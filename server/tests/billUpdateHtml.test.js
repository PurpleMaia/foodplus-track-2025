import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBillUpdateHtml, stageGuidance } from '../services/notifications/bill-updates-digest.js';

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

test('newly-dead change renders a FAILED pill (not DEAD) and a failed explanation', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'waiting2', new_status: 'waiting2', new_dead: true }),
  ]);
  assert.match(html, /#C97474/, 'coral present');
  assert.match(html, /FAILED/);
  assert.doesNotMatch(html, /DEAD/, 'the word DEAD is retired in favor of FAILED');
  assert.match(html, /failed to meet a legislative deadline/i, 'explains the failure');
});

test('a newly-failed bill offers no action link', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'waiting2', new_status: 'waiting2', new_dead: true }),
  ]);
  assert.doesNotMatch(html, /\/testimony|\/contact/, 'no CTA route on a dead bill');
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
  assert.match(html, /View in Hawaiʻi Bill Tracker/);
});

test('header renders the logo image and wordmark', () => {
  const html = buildBillUpdateHtml([change()]);
  const appUrl = process.env.APP_URL || 'https://foodplus.purplemaia.org';
  assert.ok(html.includes(`${appUrl}/email/foodplus-logo.png`), 'logo src derives from APP_URL');
  assert.match(html, /Hawaiʻi Bill Tracker/);
});

test('footer credits the partner organizations', () => {
  const html = buildBillUpdateHtml([change()]);
  assert.match(html, /Purple Maiʻa Foundation/);
  assert.match(html, /ʻĀina Foundry/);
  assert.match(html, /Hawaiʻi Food\+ Policy/);
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

test('renders the kanban stage labels, with the raw Capitol line as subtext', () => {
  const html = buildBillUpdateHtml([
    change({
      old_status: 'introduced', new_status: 'scheduled1',
      raw_status: '(H) Bill scheduled to be heard by FIN on 02-25-26 2:00PM in conference room 308.',
    }),
  ]);
  // clean kanban labels from statusLabel(COLUMN_TITLES) — '&' is HTML-escaped
  assert.match(html, /INTRODUCED &amp; WAITING 1ST/);
  assert.match(html, /SCHEDULED 1ST/);
  // raw Capitol text present as detail subtext
  assert.match(html, /scheduled to be heard by FIN on 02-25-26 2:00PM/);
});

test('omits the raw subtext when raw_status is absent', () => {
  const html = buildBillUpdateHtml([change({ raw_status: undefined })]);
  assert.doesNotMatch(html, /conference room/);
});

test('logo image has no background color (transparent PNG stands alone)', () => {
  const html = buildBillUpdateHtml([change()]);
  const imgTag = /<img[^>]*foodplus-logo[^>]*>/.exec(html)?.[0] ?? '';
  assert.ok(imgTag, 'logo img present');
  assert.doesNotMatch(imgTag, /background-color/, 'no white box behind the logo');
});

test('a scheduled bill explains the change and links to submit testimony', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'introduced', new_status: 'scheduled1', bill_id: 'abc' }),
  ]);
  assert.match(html, /scheduled for a committee hearing/i, 'meaning explained');
  assert.match(html, /Submit testimony/);
  assert.match(html, /\/bills\/abc\/testimony/, 'links to the per-bill testimony route');
});

test('an introduced bill links to contact your legislator', () => {
  const html = buildBillUpdateHtml([
    change({ old_status: 'unassigned', new_status: 'introduced', bill_id: 'xyz' }),
  ]);
  assert.match(html, /introduced and is awaiting its first committee referral/i);
  assert.match(html, /Contact your legislator/);
  assert.match(html, /\/bills\/xyz\/contact/, 'links to the per-bill contact route');
});

test('a hearing-today bill renders the highlighted banner with the time', () => {
  const html = buildBillUpdateHtml([
    change({ new_status: 'scheduled1', hearing_today: { date: '2026-03-06', time: '1:02PM' } }),
  ]);
  assert.match(html, /Hearing today/i);
  assert.match(html, /1:02PM/);
});

test('a bill with no hearing today renders no banner', () => {
  const html = buildBillUpdateHtml([change({ new_status: 'scheduled1', hearing_today: null })]);
  assert.doesNotMatch(html, /Hearing today/i);
});

test('stageGuidance classifies by family with a safe default', () => {
  assert.equal(stageGuidance('scheduled3').action.kind, 'testimony');
  assert.equal(stageGuidance('crossoverScheduled1').action.kind, 'testimony');
  assert.equal(stageGuidance('waiting2').action.kind, 'contact');
  assert.equal(stageGuidance('introduced').action.kind, 'contact');
  assert.equal(stageGuidance('governorSigns').action.kind, null);
  // Unknown id: no invented meaning, but still a safe default action.
  const unknown = stageGuidance('someBrandNewStage');
  assert.equal(unknown.meaning, '');
  assert.equal(unknown.action.kind, 'contact');
});
