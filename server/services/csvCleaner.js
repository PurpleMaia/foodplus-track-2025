import * as cheerio from 'cheerio';

/**
 * Cleaning + validation for CSV rows exported from the Hawaii Capitol website.
 *
 * The exported CSV is "dirty": the leading cells are anchor tags
 * (`<a href=...></a>`), one of which holds the real bill URL, and the
 * remaining cells are plain-text fields. This module extracts only the clean
 * data values from a row and validates that nothing HTML-ish slips through.
 *
 * A single raw row looks like (cells shown space-separated):
 *   <a href=/sessions/.../HB9_HD1_.pdf></a>  <a href=></a> ...
 *   <a href=https://www.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=HB&billnumber=9&year=2026>HB9 HD1</a>
 *   Hawaii; Purple Heart State
 *   DESIGNATING HAWAII AS A PURPLE HEART STATE.
 *   Designates Hawaii as a Purple Heart State.  Effective 7/1/3000.  (HD1)
 *   S 3/10/2026: Referred to PSM/WLA.
 *   KONG
 *   PSM/WLA
 *
 * Field mapping for the trailing plain-text cells (in order):
 *   [ignore], bill_title, description, [ignore], introducer, committee_assignment
 */

const HTML_TAG = /<[^>]+>/;
const HREF_PATTERN = /href=(["']?)([^"'\s>]+)\1/i;

/** Collapse newlines / runs of whitespace into single spaces and trim. */
function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if the cell is (or contains) an anchor tag. */
function isAnchorCell(cell) {
  return /<a\b/i.test(cell);
}

/**
 * Pull the bill_url + bill_number from the anchor cell whose href is a real
 * absolute capitol.hawaii.gov URL. Returns { billUrl, billNumber } or null.
 */
function extractUrlAndNumber(cells) {
  for (const cell of cells) {
    if (!isAnchorCell(cell)) continue;

    const match = cell.match(HREF_PATTERN);
    const href = match ? match[2] : null;
    if (!href || !/^https?:\/\//i.test(href)) continue;

    // Use cheerio to read the visible link text (e.g. "HB9 HD1") robustly.
    let linkText = '';
    try {
      const $ = cheerio.load(cell);
      linkText = $('a').first().text();
    } catch {
      linkText = '';
    }
    // bill_number is the leading token of the link text, e.g. "HB9 HD1" -> "HB9"
    const billNumber = normalizeWhitespace(linkText).split(' ')[0] || '';

    return { billUrl: href.trim(), billNumber };
  }
  return null;
}

/** Derive the legislative year strictly from the href's `year=` query param. */
function extractYearFromUrl(billUrl) {
  try {
    const year = new URL(billUrl).searchParams.get('year');
    if (year && /^\d{4}$/.test(year)) {
      return Number(year);
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Clean a single raw CSV row (array of cell strings) into a structured bill.
 * Returns the cleaned bill object, or null if no real bill URL was found.
 */
export function cleanCsvRow(rawCells) {
  if (!Array.isArray(rawCells) || rawCells.length === 0) return null;

  const urlInfo = extractUrlAndNumber(rawCells);
  if (!urlInfo) return null;

  const { billUrl, billNumber } = urlInfo;
  const year = extractYearFromUrl(billUrl);

  // The trailing plain-text fields are every non-anchor, non-empty cell,
  // in order. Map them positionally per the Capitol export layout:
  //   [0] ignore (short title), [1] bill_title, [2] description,
  //   [3] ignore (status line), [4] introducer, [5] committee_assignment
  const textFields = rawCells
    .filter((cell) => !isAnchorCell(cell))
    .map((cell) => normalizeWhitespace(cell))
    .filter((cell) => cell.length > 0);

  const billTitle = textFields[1] || '';
  const description = textFields[2] || '';
  const introducer = textFields[4] || '';
  const committeeAssignment = textFields[5] || '';

  return {
    bill_url: billUrl,
    bill_number: billNumber || null,
    year,
    bill_title: billTitle || null,
    description,
    introducer: introducer || null,
    committee_assignment: committeeAssignment || null,
  };
}

/**
 * Validate a cleaned bill. Guarantees the data is clean (no leftover HTML)
 * and that the required fields are present.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateCleanedBill(bill) {
  const errors = [];

  if (!bill || typeof bill !== 'object') {
    return { valid: false, errors: ['Row could not be parsed'] };
  }

  // No field may still contain HTML tags — the core "clean data" guarantee.
  for (const [key, value] of Object.entries(bill)) {
    if (typeof value === 'string' && HTML_TAG.test(value)) {
      errors.push(`Field "${key}" still contains HTML markup`);
    }
  }

  // bill_url: required, absolute, capitol.hawaii.gov
  if (!bill.bill_url || !/^https?:\/\//i.test(bill.bill_url)) {
    errors.push('Missing or invalid bill_url (must be an absolute http(s) URL)');
  } else if (!/capitol\.hawaii\.gov/i.test(bill.bill_url)) {
    errors.push('bill_url is not a capitol.hawaii.gov URL');
  }

  // bill_title: required
  if (!bill.bill_title || !bill.bill_title.trim()) {
    errors.push('Missing bill_title');
  }

  // description: required
  if (!bill.description || !bill.description.trim()) {
    errors.push('Missing description');
  }

  // committee_assignment and introducer are allowed to be empty/null.

  return { valid: errors.length === 0, errors };
}
