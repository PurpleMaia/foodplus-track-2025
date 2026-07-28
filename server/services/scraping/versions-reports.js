import * as cheerio from 'cheerio';
import axios from 'axios';
import { db } from '../../../db/kysely/client.js';
import { getRandomUserAgent, delay, INDIVIDUAL_TIMEOUT } from './config.js';

const BASE_URL = 'https://data.capitol.hawaii.gov';

function absolutize(href) {
  if (!href) return null;
  return new URL(href, BASE_URL).toString();
}

// Reads the trailing "_<N>" index from an element id so we can pair an HTML
// link with its sibling PDF link by index instead of relying on DOM order.
function indexFromId(id) {
  const m = /_(\d+)$/.exec(id || '');
  return m ? Number(m[1]) : null;
}

function collectByIndex($, htmlSelector, pdfSelector) {
  const pdfByIndex = new Map();
  $(pdfSelector).each((_, el) => {
    const idx = indexFromId($(el).attr('id'));
    if (idx !== null) pdfByIndex.set(idx, absolutize($(el).attr('href')));
  });
  const rows = [];
  $(htmlSelector).each((_, el) => {
    const $el = $(el);
    const idx = indexFromId($el.attr('id'));
    rows.push({
      index: idx,
      label: $el.text().trim(),
      html_link: absolutize($el.attr('href')),
      pdf_link: idx !== null ? (pdfByIndex.get(idx) ?? null) : null,
    });
  });
  return rows;
}

export function parseVersionsAndReports(html) {
  const $ = cheerio.load(html);

  const versions = collectByIndex(
    $,
    'a[id*="RepeaterVersions_VersionsLink"]',
    'a[id*="RepeaterVersions_PdfLink"]',
  ).map(({ label, html_link, pdf_link }) => ({ label, html_link, pdf_link }));

  const reports = collectByIndex(
    $,
    'a[id*="RepeaterCommRpt_CategoryLink"]',
    'a[id*="RepeaterCommRpt_PdfLink"]',
  ).map(({ label, html_link, pdf_link }) => {
    const trimmed = label.replace(/_+$/, '');
    const segments = trimmed.split('_');
    const report_code = segments[segments.length - 1] || null;
    return { label: trimmed, report_code, html_link, pdf_link };
  });

  return { versions, reports };
}

async function upsertVersions(billId, versions) {
  for (const v of versions) {
    if (!v.label) continue;
    await db.insertInto('bill_versions')
      .values({ bill_id: billId, label: v.label, html_link: v.html_link, pdf_link: v.pdf_link })
      .onConflict((oc) => oc.columns(['bill_id', 'label']).doUpdateSet({
        html_link: v.html_link, pdf_link: v.pdf_link, updated_at: new Date(),
      }))
      .execute();
  }
}

async function upsertReports(billId, reports) {
  for (const r of reports) {
    if (!r.label) continue;
    await db.insertInto('committee_reports')
      .values({ bill_id: billId, label: r.label, report_code: r.report_code, html_link: r.html_link, pdf_link: r.pdf_link })
      .onConflict((oc) => oc.columns(['bill_id', 'label']).doUpdateSet({
        report_code: r.report_code, html_link: r.html_link, pdf_link: r.pdf_link, updated_at: new Date(),
      }))
      .execute();
  }
}

// windows-1252 is latin1 except 0x80-0x9F, which hold printable characters
// (smart quotes, dashes, €, …). Node's TextDecoder leaves that range as raw
// control chars, so we map it ourselves.
const CP1252_C1 = {
  '\x80': '€', '\x82': '‚', '\x83': 'ƒ', '\x84': '„',
  '\x85': '…', '\x86': '†', '\x87': '‡', '\x88': 'ˆ',
  '\x89': '‰', '\x8A': 'Š', '\x8B': '‹', '\x8C': 'Œ',
  '\x8E': 'Ž', '\x91': '‘', '\x92': '’', '\x93': '“',
  '\x94': '”', '\x95': '•', '\x96': '–', '\x97': '—',
  '\x98': '˜', '\x99': '™', '\x9A': 'š', '\x9B': '›',
  '\x9C': 'œ', '\x9E': 'ž', '\x9F': 'Ÿ',
};

// Decode a fetched document by its declared charset. Capitol documents are
// typically windows-1252 (declared only in the meta tag, not the HTTP header);
// decoding them as UTF-8 turns special characters into U+FFFD mojibake.
export function decodeHtmlBuffer(buffer, contentTypeHeader) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentTypeHeader || '')?.[1];
  if (!charset) {
    // Charset meta tags are ASCII, so a latin1 peek at the head is safe.
    const head = buffer.toString('latin1', 0, 1024);
    charset = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'windows-1252' || charset === 'iso-8859-1' || charset === 'latin1') {
    return buffer.toString('latin1').replace(/[\x80-\x9F]/g, (c) => CP1252_C1[c] ?? c);
  }
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function fetchDocumentText(htmlLink) {
  const response = await axios.get(htmlLink, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      Accept: 'text/html',
      Referer: 'https://data.capitol.hawaii.gov',
    },
    timeout: INDIVIDUAL_TIMEOUT,
    maxRedirects: 5,
    responseType: 'arraybuffer',
  });
  const html = decodeHtmlBuffer(Buffer.from(response.data), response.headers?.['content-type']);
  const $ = cheerio.load(html);
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Fetch document text only for rows that don't have it yet. Each fetch is
// isolated so one dead link doesn't stop the rest. A short delay keeps us polite.
async function backfillOriginalText(table, billId) {
  const rows = await db.selectFrom(table)
    .select(['id', 'html_link'])
    .where('bill_id', '=', billId)
    .where('original_text', 'is', null)
    .execute();

  for (const row of rows) {
    if (!row.html_link) continue;
    try {
      await delay(1000);
      const text = await fetchDocumentText(row.html_link);
      await db.updateTable(table)
        .set({ original_text: text, updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
    } catch (err) {
      console.warn(`[VERSIONS] Failed to fetch document text for ${table} row ${row.id} (${row.html_link}):`, err?.message || err);
    }
  }
}

export async function saveVersionsAndReports(billId, billNumber, parsed) {
  const { versions = [], reports = [] } = parsed || {};
  try {
    await upsertVersions(billId, versions);
    await upsertReports(billId, reports);
    console.log(`[VERSIONS] ${billNumber}: upserted ${versions.length} versions, ${reports.length} reports`);
    await backfillOriginalText('bill_versions', billId);
    await backfillOriginalText('committee_reports', billId);
  } catch (err) {
    console.warn(`[VERSIONS] ${billNumber}: versions/reports step failed:`, err?.message || err);
    // Rethrow so callers can count the failure; the scrape path isolates this
    // call in its own try/catch, and the seed script marks the bill failed so
    // a resumed run retries it.
    throw err;
  }
}
