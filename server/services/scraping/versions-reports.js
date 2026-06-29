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

async function fetchDocumentText(htmlLink) {
  const response = await axios.get(htmlLink, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      Accept: 'text/html',
      Referer: 'https://data.capitol.hawaii.gov',
    },
    timeout: INDIVIDUAL_TIMEOUT,
    maxRedirects: 5,
  });
  const $ = cheerio.load(response.data);
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Fetch raw HTML only for rows that don't have it yet. Each fetch is isolated
// so one dead link doesn't stop the rest. A short delay keeps us polite.
async function backfillRawHtml(table, billId) {
  const rows = await db.selectFrom(table)
    .select(['id', 'html_link'])
    .where('bill_id', '=', billId)
    .where('raw_html', 'is', null)
    .execute();

  for (const row of rows) {
    if (!row.html_link) continue;
    try {
      await delay(1000);
      const text = await fetchDocumentText(row.html_link);
      await db.updateTable(table)
        .set({ raw_html: text, updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
    } catch (err) {
      console.warn(`[VERSIONS] Failed to fetch raw HTML for ${table} row ${row.id} (${row.html_link}):`, err?.message || err);
    }
  }
}

export async function saveVersionsAndReports(billId, billNumber, parsed) {
  const { versions = [], reports = [] } = parsed || {};
  try {
    await upsertVersions(billId, versions);
    await upsertReports(billId, reports);
    console.log(`[VERSIONS] ${billNumber}: upserted ${versions.length} versions, ${reports.length} reports`);
    await backfillRawHtml('bill_versions', billId);
    await backfillRawHtml('committee_reports', billId);
  } catch (err) {
    console.warn(`[VERSIONS] ${billNumber}: versions/reports step failed:`, err?.message || err);
  }
}
