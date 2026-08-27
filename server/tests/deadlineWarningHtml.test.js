import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeadlineWarningHtml,
  buildDeadlineWarningBody,
} from '../services/notifications/bill-updates-digest.js';

const item = (over) => ({
  bill_number: 'HB1', bill_title: 'RELATING TO AGRICULTURE',
  current_status: 'waiting2',
  deadline_name: 'First Decking', deadline_date: '2026-03-06', days_left: 7, ...over,
});

test('renders coral accent and deadline line', () => {
  const html = buildDeadlineWarningHtml([item()]);
  assert.match(html, /#C97474/, 'coral present');
  assert.match(html, /First Decking/);
  assert.match(html, /2026-03-06/);
  assert.match(html, /7 days left/);
});

test('renders bill number and title', () => {
  const html = buildDeadlineWarningHtml([item()]);
  assert.match(html, /HB1/);
  assert.match(html, /RELATING TO AGRICULTURE/);
});

test('singular day wording at 1 day left', () => {
  const html = buildDeadlineWarningHtml([item({ days_left: 1 })]);
  assert.match(html, /1 day left/);
  assert.doesNotMatch(html, /1 days left/);
});

test('non-urgent title', () => {
  const html = buildDeadlineWarningHtml([item()], { urgent: false });
  assert.match(html, /Deadline approaching/);
  assert.doesNotMatch(html, /URGENT/);
});

test('urgent framing at tier 3', () => {
  const html = buildDeadlineWarningHtml([item({ days_left: 2 })], { urgent: true });
  assert.match(html, /URGENT: Deadline approaching/);
});

test('CTA links to APP_URL', () => {
  const html = buildDeadlineWarningHtml([item()]);
  const appUrl = process.env.APP_URL || 'https://foodplus.purplemaia.org';
  assert.ok(html.includes(`href="${appUrl}"`));
  assert.match(html, /View in Hawaiʻi Bill Tracker/);
});

test('header renders the logo image and wordmark', () => {
  const html = buildDeadlineWarningHtml([item()]);
  const appUrl = process.env.APP_URL || 'https://foodplus.purplemaia.org';
  assert.ok(html.includes(`${appUrl}/email/foodplus-logo.png`), 'logo src derives from APP_URL');
  assert.match(html, /Hawaiʻi Bill Tracker/);
});

test('footer credits the partner organizations', () => {
  const html = buildDeadlineWarningHtml([item()]);
  assert.match(html, /Purple Maiʻa Foundation/);
  assert.match(html, /ʻĀina Foundry/);
  assert.match(html, /Hawaiʻi Food\+ Policy/);
});

test('current status pill rendered when present', () => {
  const html = buildDeadlineWarningHtml([item()]);
  assert.match(html, /WAITING 2ND/); // statusLabel('waiting2')
});

test('deadline card explains the stage and links to an action when bill_id is present', () => {
  const html = buildDeadlineWarningHtml([item({ bill_id: 'd1', current_status: 'scheduled1' })]);
  assert.match(html, /scheduled for a committee hearing/i);
  assert.match(html, /Submit testimony/);
  assert.match(html, /\/bills\/d1\/testimony/);
});

test('deadline card omits the action link when bill_id is missing', () => {
  const html = buildDeadlineWarningHtml([item({ current_status: 'scheduled1' })]); // no bill_id
  assert.doesNotMatch(html, /\/bills\/[^/]+\/testimony/, 'no link without an id');
});

test('plain-text body mirrors the warning', () => {
  const text = buildDeadlineWarningBody([item()], { urgent: false });
  assert.match(text, /Bills you follow are approaching a deadline/);
  assert.match(text, /HB1 \(RELATING TO AGRICULTURE\): First Decking on 2026-03-06 — 7 days left/);
});

test('plain-text urgent header', () => {
  const text = buildDeadlineWarningBody([item({ days_left: 2 })], { urgent: true });
  assert.match(text, /URGENT/);
});

test('escapes HTML in title', () => {
  const html = buildDeadlineWarningHtml([item({ bill_title: 'A & B <x>' })]);
  assert.match(html, /A &amp; B &lt;x&gt;/);
});
