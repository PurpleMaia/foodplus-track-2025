import * as cheerio from 'cheerio';

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
