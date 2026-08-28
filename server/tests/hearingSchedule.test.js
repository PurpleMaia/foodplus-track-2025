import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHearingFromText,
  getUpcomingHearing,
  daysUntilHearing,
  hearingToday,
  testimonyClosing,
  parseTimeLabel,
  hoursUntilHearing,
} from '../services/notifications/hearing-schedule.js';

const SCHED = (d) => ({
  statustext: `The committee(s) on AEN will hold a public hearing on ${d}; Conference Room 224 & Videoconference.`,
});

test('parses the real Capitol "hearing on MM-DD-YY H:MMxM" shape', () => {
  const h = parseHearingFromText('will hold a public hearing on 02-03-25 1:02PM; Conference Room 224');
  assert.deepEqual(h, { date: '2025-02-03', time: '1:02PM' });
});

test('parses the "scheduled to be heard by ... on <Weekday>, MM-DD-YY" shape', () => {
  const h = parseHearingFromText(
    'Bill scheduled to be heard by LAB on Tuesday, 02-11-25 9:00AM in House conference room 309 VIA VIDEOCONFERENCE.',
  );
  assert.deepEqual(h, { date: '2025-02-11', time: '9:00AM' });
});

test('parses a 4-digit year and slash separators', () => {
  assert.deepEqual(parseHearingFromText('has scheduled a public hearing on 3/6/2026'), { date: '2026-03-06', time: null });
});

test('does NOT treat a non-scheduling line with a date as a hearing', () => {
  assert.equal(parseHearingFromText('Reported from AGR on 02-11-25 with recommendation of passage.'), null);
  assert.equal(parseHearingFromText('Referred to LAB, JHA on 01-15-26.'), null);
});

test('returns null when there is no hearing line', () => {
  assert.equal(parseHearingFromText('Reported from AEN with recommendation of passage.'), null);
  assert.equal(parseHearingFromText(''), null);
  assert.equal(parseHearingFromText(null), null);
});

test('rejects an out-of-range month/day', () => {
  assert.equal(parseHearingFromText('hearing on 13-45-26'), null);
});

test('getUpcomingHearing ignores past hearings and picks the earliest future one', () => {
  const rows = [SCHED('01-10-26 9:00AM'), SCHED('03-20-26 2:00PM'), SCHED('03-06-26 1:00PM')];
  assert.deepEqual(getUpcomingHearing(rows, '2026-02-01'), { date: '2026-03-06', time: '1:00PM' });
});

test('getUpcomingHearing returns null when every hearing is in the past', () => {
  assert.equal(getUpcomingHearing([SCHED('01-10-26 9:00AM')], '2026-02-01'), null);
});

test('daysUntilHearing: 0 today, 1 tomorrow', () => {
  assert.equal(daysUntilHearing('2026-03-06', '2026-03-06'), 0);
  assert.equal(daysUntilHearing('2026-03-07', '2026-03-06'), 1);
  assert.equal(daysUntilHearing('2026-03-10', '2026-03-06'), 4);
});

test('hearingToday flags a same-day hearing only', () => {
  assert.deepEqual(hearingToday([SCHED('03-06-26 1:02PM')], '2026-03-06'), {
    date: '2026-03-06',
    time: '1:02PM',
  });
  assert.equal(hearingToday([SCHED('03-07-26 1:02PM')], '2026-03-06'), null);
});

test('testimonyClosing flags a hearing today or tomorrow (24h window), not later', () => {
  assert.equal(testimonyClosing([SCHED('03-06-26')], '2026-03-06').daysUntil, 0); // today
  assert.equal(testimonyClosing([SCHED('03-07-26')], '2026-03-06').daysUntil, 1); // tomorrow
  assert.equal(testimonyClosing([SCHED('03-09-26')], '2026-03-06'), null);        // 3 days out
});

// --- hours-until-hearing (testimony deadlines in hours) ----------------------
test('parseTimeLabel handles AM/PM and midnight/noon boundaries', () => {
  assert.deepEqual(parseTimeLabel('2:00PM'), { hour24: 14, minute: 0 });
  assert.deepEqual(parseTimeLabel('10:30AM'), { hour24: 10, minute: 30 });
  assert.deepEqual(parseTimeLabel('12:00PM'), { hour24: 12, minute: 0 }); // noon
  assert.deepEqual(parseTimeLabel('12:15AM'), { hour24: 0, minute: 15 }); // after midnight
  assert.equal(parseTimeLabel('no time'), null);
  assert.equal(parseTimeLabel(null), null);
});

test('hoursUntilHearing counts HST hours to the hearing time', () => {
  // hearing 2026-09-15 2:00PM HST == 2026-09-16 00:00 UTC
  const now = Date.UTC(2026, 8, 15, 4, 0, 0); // 2026-09-14 6:00PM HST
  assert.equal(hoursUntilHearing('2026-09-15', '2:00PM', now), 20);
  // exactly at the hearing -> 0
  assert.equal(hoursUntilHearing('2026-09-15', '2:00PM', Date.UTC(2026, 8, 16, 0, 0, 0)), 0);
  // past the hearing -> clamped to 0, never negative
  assert.equal(hoursUntilHearing('2026-09-15', '2:00PM', Date.UTC(2026, 8, 16, 3, 0, 0)), 0);
  // no parseable time -> null (caller falls back to days)
  assert.equal(hoursUntilHearing('2026-09-15', null, now), null);
});
