import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLegislators } from '../services/scraping/legislators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(__dirname, '../services/scraping/__fixtures__/legislators.html'),
  'utf8'
);

const { legislators, failures } = parseLegislators(fixture);
const byMemberId = (id) => legislators.find((l) => l.member_id === id);

test('parses every card in the fixture without failures', () => {
  assert.equal(failures.length, 0);
  assert.equal(legislators.length, 3);
});

test('decodes Cloudflare-obfuscated emails (data-cfemail, no mailto: link)', () => {
  // The fixture uses the live site's Cloudflare email cloaking, not mailto: links.
  assert.equal(byMemberId('249').email, 'repalcos@capitol.hawaii.gov');
  assert.equal(byMemberId('162').email, 'sendelacruz@capitol.hawaii.gov');
  assert.equal(byMemberId('229').email, 'senelefante@capitol.hawaii.gov');
});

test('parses Dela Cruz (combined Phone/Fax)', () => {
  assert.deepEqual(byMemberId('162'), {
    member_id: '162',
    last_name: 'Dela Cruz',
    first_name: 'Donovan M.',
    party: 'D',
    chamber: 'Senate',
    district: 17,
    area: 'Portion of Mililani, Mililani Mauka, portion of Waipi‘o Acres, Launani Valley, Wahiawā, Whitmore Village',
    room: '208',
    phone: '808-586-6090',
    email: 'sendelacruz@capitol.hawaii.gov',
    outOfOffice: false,
    term_ended: null,
  });
});

test('parses Elefante (name with embedded newline)', () => {
  const e = byMemberId('229');
  assert.equal(e.last_name, 'Elefante');
  assert.equal(e.first_name, 'Brandon J.C.');
  assert.equal(e.party, 'D');
  assert.equal(e.chamber, 'Senate');
  assert.equal(e.district, 16);
  assert.equal(e.email, 'senelefante@capitol.hawaii.gov');
});

test('parses Alcos (separate Phone:/Fax: lines, suffix last name, title)', () => {
  const a = byMemberId('249');
  // The Phone number is captured, not the Fax number.
  assert.equal(a.phone, '808-586-6080');
  // Name comes from h2.namecard only — the "Asst. Minority Leader" title is ignored.
  assert.equal(a.last_name, 'Alcos III');
  assert.equal(a.first_name, 'David');
  assert.equal(a.party, 'R');
  assert.equal(a.chamber, 'House');
  assert.equal(a.district, 41);
  assert.equal(a.room, '324');
});
