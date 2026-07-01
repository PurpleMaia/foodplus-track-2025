import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseVersionsAndReports, decodeHtmlBuffer } from '../services/scraping/versions-reports.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '../services/scraping/__fixtures__/hawaii-data-test.html'), 'utf8');

test('parses all 7 versions in document order with absolute links', () => {
  const { versions } = parseVersionsAndReports(html);
  assert.equal(versions.length, 7);
  assert.deepEqual(versions.map(v => v.label),
    ['SB1186_HD3', 'SB1186_CD1', 'SB1186_HD2', 'SB1186_HD1', 'SB1186_SD1', 'SB1186_SD2', 'SB1186']);
  assert.equal(versions[0].html_link, 'https://data.capitol.hawaii.gov/sessions//session2024/bills/SB1186_HD3_.HTM');
  assert.equal(versions[0].pdf_link, 'https://data.capitol.hawaii.gov/sessions//session2024/bills/SB1186_HD3_.PDF');
});

test('parses all 6 committee reports, trims trailing underscore, extracts report_code', () => {
  const { reports } = parseVersionsAndReports(html);
  assert.equal(reports.length, 6);
  assert.deepEqual(reports.map(r => r.label),
    ['SB1186_SD1_SSCR68', 'SB1186_SD2_SSCR687', 'SB1186_HD1_HSCR1175', 'SB1186_HD2_HSCR1445', 'SB1186_HD3_HSCR2000', 'SB1186_CD1_CCR112']);
  assert.deepEqual(reports.map(r => r.report_code),
    ['SSCR68', 'SSCR687', 'HSCR1175', 'HSCR1445', 'HSCR2000', 'CCR112']);
  assert.equal(reports[0].html_link, 'https://data.capitol.hawaii.gov/sessions//session2025/CommReports/SB1186_SD1_SSCR68_.htm');
  assert.equal(reports[0].pdf_link, 'https://data.capitol.hawaii.gov/sessions//session2025/CommReports/SB1186_SD1_SSCR68_.pdf');
});

test('returns empty arrays for html with no version/report cards', () => {
  const { versions, reports } = parseVersionsAndReports('<html><body><p>nothing</p></body></html>');
  assert.deepEqual(versions, []);
  assert.deepEqual(reports, []);
});

test('decodeHtmlBuffer decodes windows-1252 declared in a meta tag', () => {
  // 0x92 is a right single quote in windows-1252; invalid as UTF-8.
  const buf = Buffer.concat([
    Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body>Hawai', 'latin1'),
    Buffer.from([0x92]),
    Buffer.from('i</body></html>', 'latin1'),
  ]);
  const html = decodeHtmlBuffer(buf, 'text/html');
  assert.ok(html.includes('Hawai’i'));
  assert.ok(!html.includes('�'));
});

test('decodeHtmlBuffer prefers the HTTP content-type charset over the meta tag', () => {
  const buf = Buffer.from('<html><head><meta charset="windows-1252"></head><body>café</body></html>', 'utf8');
  const html = decodeHtmlBuffer(buf, 'text/html; charset=utf-8');
  assert.ok(html.includes('café'));
});

test('decodeHtmlBuffer defaults to utf-8 and survives an unknown charset', () => {
  assert.ok(decodeHtmlBuffer(Buffer.from('<body>ok</body>', 'utf8'), null).includes('ok'));
  const bogus = Buffer.from('<meta charset="not-a-charset"><body>ok</body>', 'utf8');
  assert.ok(decodeHtmlBuffer(bogus, null).includes('ok'));
});
