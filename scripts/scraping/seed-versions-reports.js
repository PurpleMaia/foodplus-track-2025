/* One-time (resumable) backfill of bill versions + committee reports for bills
 * already in the DB. The daily scrape captures these for current-year bills on
 * each run, but prior-year bills (e.g. 2025) are no longer on the list pages
 * and never fill in naturally — this script covers them.
 *
 * Only touches bill_versions / committee_reports; never rewrites the bills row
 * or status_updates.
 *
 * Run: node scripts/scraping/seed-versions-reports.js [--year 2025] [--limit N] [--bill HB1001] [--force]
 *   --year N     restrict to one legislative year (default: all)
 *   --limit N    process at most N bills (smoke testing)
 *   --bill HBnnn target a single bill by number (implies --force; combine with --year)
 *   --force      process bills even if they already look complete
 */
import axios from 'axios';
import { db } from '../../db/kysely/client.js';
import {
  parseVersionsAndReports,
  saveVersionsAndReports,
} from '../../server/services/scraping/versions-reports.js';
import {
  getRandomUserAgent,
  delay,
  INDIVIDUAL_TIMEOUT,
  INDIVIDUAL_BATCH_SIZE,
  INDIVIDUAL_BATCH_DELAY,
  INDIVIDUAL_MAX_RETRIES,
  INDIVIDUAL_RETRY_DELAY,
} from '../../server/services/scraping/config.js';

function parseArgs(argv) {
  const args = { year: null, limit: null, bill: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--year') args.year = Number(argv[++i]);
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--bill') args.bill = String(argv[++i]).toUpperCase();
    else if (argv[i] === '--force') args.force = true;
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (args.bill) args.force = true; // explicitly targeted bills always re-run
  return args;
}

// Same normalization as individual-bill.js: unwrap legacy `<a href=...>` URLs
// and hit the data. subdomain instead of www.
function normalizeBillUrl(url) {
  if (!url) return null;
  if (url.startsWith('<a')) {
    const match = url.match(/href=(["']?)([^"'\s>]+)\1/);
    url = match ? match[2] : null;
    if (!url) return null;
  }
  return url.replace('www.', 'data.');
}

async function fetchBillPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= INDIVIDUAL_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) await delay(INDIVIDUAL_RETRY_DELAY * (attempt - 1));
      const response = await axios.get(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html',
          Referer: 'https://data.capitol.hawaii.gov',
        },
        timeout: INDIVIDUAL_TIMEOUT,
        maxRedirects: 5,
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' ||
        error?.code === 'ECONNRESET' || error?.response?.status === 503 || error?.response?.status === 502;
      if ((isTimeout || isNetworkError) && attempt < INDIVIDUAL_MAX_RETRIES) {
        console.warn(`[SEED-VERSIONS] Attempt ${attempt} failed (${error.message}). Retrying...`);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// A bill is "done" when its page has been parsed at least once (every bill has
// at least the introduced version, so >=1 bill_versions row) AND no linked
// document is still missing its original_text.
async function computeDoneSet() {
  const withVersions = await db.selectFrom('bill_versions')
    .select('bill_id').distinct().execute();
  const pendingVersions = await db.selectFrom('bill_versions')
    .select('bill_id').distinct()
    .where('html_link', 'is not', null)
    .where('original_text', 'is', null)
    .execute();
  const pendingReports = await db.selectFrom('committee_reports')
    .select('bill_id').distinct()
    .where('html_link', 'is not', null)
    .where('original_text', 'is', null)
    .execute();

  const pending = new Set([...pendingVersions, ...pendingReports].map((r) => r.bill_id));
  const done = new Set();
  for (const { bill_id } of withVersions) {
    if (!pending.has(bill_id)) done.add(bill_id);
  }
  return done;
}

async function seedBill(bill) {
  const url = normalizeBillUrl(bill.bill_url);
  if (!url) throw new Error('no usable bill_url');
  const html = await fetchBillPage(url);
  const parsed = parseVersionsAndReports(html);
  // saveVersionsAndReports upserts links, then fetches original_text only for
  // rows that don't have it yet (1s politeness delay per document).
  await saveVersionsAndReports(bill.id, bill.bill_number, parsed);
  return { versions: parsed.versions.length, reports: parsed.reports.length };
}

async function main() {
  const args = parseArgs(process.argv);

  let query = db.selectFrom('bills')
    .select(['id', 'bill_number', 'bill_url', 'year'])
    .orderBy('year')
    .orderBy('bill_number');
  if (args.year) query = query.where('year', '=', args.year);
  // Stored bill_number carries draft suffixes ("HB1001 HD1 SD3 CD1"), so match
  // the base number exactly or as the first token.
  if (args.bill) {
    query = query.where((eb) => eb.or([
      eb('bill_number', '=', args.bill),
      eb('bill_number', 'like', `${args.bill} %`),
    ]));
  }
  const allBills = await query.execute();

  const done = args.force ? new Set() : await computeDoneSet();
  let bills = allBills.filter((b) => !done.has(b.id));
  const skipped = allBills.length - bills.length;
  if (args.limit) bills = bills.slice(0, args.limit);

  console.log(`[SEED-VERSIONS] ${allBills.length} bills selected` +
    `${args.year ? ` (year ${args.year})` : ''}, ${skipped} already complete, ` +
    `processing ${bills.length}${args.force ? ' (--force)' : ''}`);

  const summary = { processed: 0, skipped, failed: 0, versionsSeen: 0, reportsSeen: 0 };
  const failures = [];
  let position = 0;

  for (let i = 0; i < bills.length; i += INDIVIDUAL_BATCH_SIZE) {
    const batch = bills.slice(i, i + INDIVIDUAL_BATCH_SIZE);
    await Promise.all(batch.map(async (bill) => {
      const n = ++position;
      try {
        const counts = await seedBill(bill);
        summary.processed++;
        summary.versionsSeen += counts.versions;
        summary.reportsSeen += counts.reports;
        console.log(`[SEED-VERSIONS] (${n}/${bills.length}) ${bill.bill_number} (${bill.year}): ` +
          `${counts.versions} versions, ${counts.reports} reports`);
      } catch (err) {
        summary.failed++;
        failures.push({ billNumber: bill.bill_number, year: bill.year, error: err?.message || String(err) });
        console.warn(`[SEED-VERSIONS] (${n}/${bills.length}) ${bill.bill_number} (${bill.year}) FAILED: ` +
          `${err?.message || err}`);
      }
    }));
    if (i + INDIVIDUAL_BATCH_SIZE < bills.length) await delay(INDIVIDUAL_BATCH_DELAY);
  }

  console.log('\n--- Summary ---');
  console.log(`Processed:  ${summary.processed}`);
  console.log(`Skipped:    ${summary.skipped} (already complete)`);
  console.log(`Failed:     ${summary.failed}`);
  console.log(`Versions:   ${summary.versionsSeen}`);
  console.log(`Reports:    ${summary.reportsSeen}`);
  for (const f of failures) {
    console.log(`  - ${f.billNumber} (${f.year}): ${f.error}`);
  }
}

(async () => {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    console.error('[SEED-VERSIONS] Seed run crashed:', error?.message || error);
    exitCode = 1;
  } finally {
    await db.destroy?.();
  }
  process.exit(exitCode);
})();
