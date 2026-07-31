import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCommitteeList, diffChairs } from '../services/scraping/committees.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../services/scraping/__fixtures__/committees.html'),
  'utf8'
);

const { committees, failures } = parseCommitteeList(fixture);
const byAcronym = (a) => committees.find((c) => c.acronym === a);

test('parses every committee row without failures', () => {
  assert.equal(failures.length, 0);
  // The GridView has NO header row — all 33 <tr>s are committees. An
  // off-by-one that skips the first row silently drops AEN.
  assert.equal(committees.length, 33);
});

test('parses the FIRST row (AEN) — guards the no-header-row off-by-one', () => {
  assert.deepEqual(byAcronym('AEN'), {
    acronym: 'AEN',
    name: 'Agriculture and Environment',
    chamber: 'Senate',
    chairMemberId: '169',
    viceChairMemberId: '244',
  });
});

test('parses a House committee (AGR) with an ampersand in the name', () => {
  assert.deepEqual(byAcronym('AGR'), {
    acronym: 'AGR',
    name: 'Agriculture & Food Systems',
    chamber: 'House',
    chairMemberId: '252',
    viceChairMemberId: '297',
  });
});

test('name is the committee name only, not the acronym link text', () => {
  // Both links share the `HyperLinkComm` id prefix; the name selector must
  // exclude `...CommAcro` or the name comes back as "CPC".
  const cpc = byAcronym('CPC');
  assert.equal(cpc.name, 'Consumer Protection & Commerce');
  assert.notEqual(cpc.name, 'CPC');
});

test('chamber comes from the sibling Label1 span, and disambiguates same-named committees', () => {
  // EDN and EDU are both "Education" — only the chamber tells them apart.
  const edn = byAcronym('EDN');
  const edu = byAcronym('EDU');
  assert.equal(edn.name, 'Education');
  assert.equal(edu.name, 'Education');
  assert.equal(edn.chamber, 'House');
  assert.equal(edu.chamber, 'Senate');

  // HOU / HSG are both "Housing" — and the mapping is the opposite of what the
  // acronyms suggest: HOU is the SENATE committee, HSG is the HOUSE one. Never
  // infer chamber from the acronym; it must come from the Label1 span.
  assert.equal(byAcronym('HOU').chamber, 'Senate');
  assert.equal(byAcronym('HSG').chamber, 'House');
});

test('every committee has an acronym and a chamber', () => {
  for (const c of committees) {
    assert.ok(c.acronym, `missing acronym: ${JSON.stringify(c)}`);
    assert.ok(['House', 'Senate'].includes(c.chamber), `bad chamber: ${JSON.stringify(c)}`);
  }
});

test('acronyms are unique — the upsert key must not collide', () => {
  const acronyms = committees.map((c) => c.acronym);
  assert.equal(new Set(acronyms).size, acronyms.length);
});

test('a legislator may chair one committee and vice-chair another', () => {
  // member 169 (Gabbard) chairs AEN and vice-chairs GVO in this fixture.
  assert.equal(byAcronym('AEN').chairMemberId, '169');
  assert.equal(byAcronym('GVO').viceChairMemberId, '169');
});

test('a missing vice-chair photo link yields null, not a crash', () => {
  const html = `
    <table id="MainContent_GridView1"><tr>
      <td><a id="MainContent_GridView1_HyperLinkCommAcro_0" href="?comm=ZZZ">ZZZ</a></td>
      <td>
        <span id="MainContent_GridView1_Label1_0">House Committee on</span>
        <a id="MainContent_GridView1_HyperLinkCommName_0" href="?comm=ZZZ">Ghost Committee</a>
      </td>
      <td><a href="/legislature/memberpage.aspx?member=999&year=2026"
             id="MainContent_GridView1_HyperLinkmemberphotos_0"><img alt="chair photo"></a></td>
      <td></td>
    </tr></table>`;
  const result = parseCommitteeList(html);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.committees, [{
    acronym: 'ZZZ',
    name: 'Ghost Committee',
    chamber: 'House',
    chairMemberId: '999',
    viceChairMemberId: null,
  }]);
});

test('a row with no committee links is skipped, not reported as a failure', () => {
  const html = `
    <table id="MainContent_GridView1">
      <tr><td colspan="4">&nbsp;</td></tr>
      <tr>
        <td><a id="MainContent_GridView1_HyperLinkCommAcro_0" href="?comm=AGR">AGR</a></td>
        <td>
          <span id="MainContent_GridView1_Label1_0">House Committee on</span>
          <a id="MainContent_GridView1_HyperLinkCommName_0" href="?comm=AGR">Ag</a>
        </td>
        <td></td><td></td>
      </tr>
    </table>`;
  const result = parseCommitteeList(html);
  assert.equal(result.failures.length, 0);
  assert.equal(result.committees.length, 1);
  assert.equal(result.committees[0].acronym, 'AGR');
});

test('unknown chamber wording yields null chamber rather than throwing', () => {
  const html = `
    <table id="MainContent_GridView1"><tr>
      <td><a id="MainContent_GridView1_HyperLinkCommAcro_0" href="?comm=JNT">JNT</a></td>
      <td>
        <span id="MainContent_GridView1_Label1_0">Joint Committee on</span>
        <a id="MainContent_GridView1_HyperLinkCommName_0" href="?comm=JNT">Something New</a>
      </td>
      <td></td><td></td>
    </tr></table>`;
  const result = parseCommitteeList(html);
  assert.equal(result.committees[0].chamber, null);
  assert.equal(result.failures.length, 0);
});

// --- diffChairs: the soft-delete decision, pure so it needs no DB ---
// active rows come from the DB: { id, legislator_id, role }.
// scraped pairs come from the scrape: { legislator_id, role }.
// Result: { toRetire: [rowId...], toInsert: [{ legislator_id, role }...] }.

test('diffChairs: new chair for an empty seat is inserted, nothing retired', () => {
  const result = diffChairs([], [{ legislator_id: 'L1', role: 'chair' }]);
  assert.deepEqual(result, {
    toRetire: [],
    toInsert: [{ legislator_id: 'L1', role: 'chair' }],
  });
});

test('diffChairs: a chair no longer scraped is retired, nothing inserted', () => {
  const active = [{ id: 'R1', legislator_id: 'L1', role: 'chair' }];
  const result = diffChairs(active, []);
  assert.deepEqual(result, { toRetire: ['R1'], toInsert: [] });
});

test('diffChairs: an unchanged chair is left alone (preserves started_at)', () => {
  const active = [{ id: 'R1', legislator_id: 'L1', role: 'chair' }];
  const scraped = [{ legislator_id: 'L1', role: 'chair' }];
  const result = diffChairs(active, scraped);
  assert.deepEqual(result, { toRetire: [], toInsert: [] });
});

test('diffChairs: a replacement retires the old chair and inserts the new one', () => {
  const active = [{ id: 'R1', legislator_id: 'L1', role: 'chair' }];
  const scraped = [{ legislator_id: 'L2', role: 'chair' }];
  const result = diffChairs(active, scraped);
  assert.deepEqual(result, {
    toRetire: ['R1'],
    toInsert: [{ legislator_id: 'L2', role: 'chair' }],
  });
});

test('diffChairs: role matters — same legislator in a different role is a distinct seat', () => {
  // L1 was vice_chair, is now chair: retire the vice_chair row, insert chair.
  const active = [{ id: 'R1', legislator_id: 'L1', role: 'vice_chair' }];
  const scraped = [{ legislator_id: 'L1', role: 'chair' }];
  const result = diffChairs(active, scraped);
  assert.deepEqual(result, {
    toRetire: ['R1'],
    toInsert: [{ legislator_id: 'L1', role: 'chair' }],
  });
});

test('diffChairs: a returning chair is inserted (retired rows are not "active")', () => {
  // Only active rows are passed in, so a previously-retired L1 simply isn't in
  // `active`; L1 reappearing in the scrape is a plain insert.
  const active = [];
  const scraped = [{ legislator_id: 'L1', role: 'chair' }];
  const result = diffChairs(active, scraped);
  assert.deepEqual(result, {
    toRetire: [],
    toInsert: [{ legislator_id: 'L1', role: 'chair' }],
  });
});
