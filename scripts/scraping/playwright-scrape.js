/* Local recovery cron: same flow as server/cron-scrape.js, but resilient to the
 * data host's HTTP 500 by falling back to a real browser.
 *
 * WHY: the daily Dokku cron scrapes the main bill-list report from
 * data.capitol.hawaii.gov via axios. That host intermittently 500s. The cron's
 * own Playwright/www fallback can't run — www is behind Cloudflare and returns
 * 403 to headless Chromium from the datacenter IP. Run from a residential IP,
 * Chromium clears Cloudflare and reaches the www copy of the report.
 *
 * FLOW (per chamber):
 *   1. Try the REAL data-URL scrape first (default axios path, identical to the
 *      deployed cron). If it works, the genuine "data URL passed" email fires and
 *      we're done — no browser involved.
 *   2. Only if that throws, fall back to the same pipeline with a Playwright
 *      fetcher pointed at www. No "data URL passed" email is sent on this path.
 *
 * Only the list fetch differs on the fallback. Everything downstream — saveBills,
 * individual bill scrapes, status classification, follower notifications and
 * deadline warnings — runs through the exact same service functions the deployed
 * cron uses, so the outcome is identical.
 *
 * Takes no arguments: current year, House + Senate, full parity with cron-scrape.js.
 * Intended to be driven by a LOCAL cron. Requires DATABASE_URL, OPENAI_API_KEY,
 * RESEND_API_KEY etc. in the local .env — this DOES send real notification emails.
 */
import { chromium } from 'playwright';
import { startScraping } from '../../server/services/scrapingService.js';
import { getRandomUserAgent, MAIN_LIST_TIMEOUT } from '../../server/services/scraping/config.js';
import { sendAlertEmail } from '../../server/services/notifications/cron-alerts.js';
import { sendStatusChangeNotifications } from '../../server/services/notificationService.js';
import { checkApproachingDeadlines, sendDeadlineWarnings } from '../../server/services/notifications/deadline-warnings.js';

/**
 * Fetch the report HTML with a real browser. Drop-in for scrapeBills's default
 * axios fetcher (same (url) => Promise<string> shape), pointed at the
 * Cloudflare-fronted www host that Playwright can clear.
 */
async function fetchListHtmlViaBrowser(url) {
  const wwwUrl = url.replace('data.capitol.hawaii.gov', 'www.capitol.hawaii.gov');
  console.log(`[PW CRON] Fetching ${wwwUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: getRandomUserAgent() });
    const page = await context.newPage();
    const response = await page.goto(wwwUrl, {
      waitUntil: 'domcontentloaded',
      timeout: MAIN_LIST_TIMEOUT,
    });
    const status = response?.status();
    if (status && status >= 400) {
      throw new Error(`Playwright fetch got HTTP ${status} from ${wwwUrl}`);
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Scrape one chamber. Try the real data-URL path first; only on failure fall back
 * to the Playwright/www fetcher. Returns the startScraping result.
 */
async function scrapeChamber(label, url) {
  try {
    console.log(`[MAIN] Scraping ${label} bills via data URL...`);
    return await startScraping(url);
  } catch (dataError) {
    console.warn(`[MAIN] ${label} data-URL scrape failed (${dataError.message}). Falling back to Playwright/www...`);
    return await startScraping(url, { fetchListHtml: fetchListHtmlViaBrowser });
  }
}

async function cronScrape() {
  const currentYear = new Date().getFullYear();
  console.log(`Starting recovery cron, scraping for year ${currentYear}...`);

  const houseURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;
  const senateURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=sb&title=Senate%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;

  const errors = [];

  // Scrape House bills (data URL first, Playwright fallback)
  const houseResult = await scrapeChamber('House', houseURL);
  console.log(`[MAIN] Finished scraping House bills in ${houseResult.durationMin} minutes.`);

  if (!houseResult.totalBills) {
    errors.push(`House bills: 0 bills scraped from ${houseURL}`);
  }

  // Scrape Senate bills (data URL first, Playwright fallback)
  const senateResult = await scrapeChamber('Senate', senateURL);
  console.log(`[MAIN] Finished scraping Senate bills in ${senateResult.durationMin} minutes.`);

  if (!senateResult.totalBills) {
    errors.push(`Senate bills: 0 bills scraped from ${senateURL}`);
  }

  // Collect all individual failures across both chambers
  const allIndividualFailures = [];
  for (const [label, result] of [['House', houseResult], ['Senate', senateResult]]) {
    if (result?.individualFailCount > 0) {
      errors.push(`${label}: ${result.individualFailCount}/${result.totalIndividual} individual bill scrapes failed`);
      for (const f of (result.individualFailures || [])) {
        allIndividualFailures.push({ ...f, chamber: label });
      }
    }
  }

  // Send cron job alert email if there were any errors or individual failures
  if (errors.length > 0) {
    const body = [
      `Recovery cron completed at ${new Date().toISOString()} with issues:`,
      '',
      ...errors.map(e => `- ${e}`),
      '',
      `Year: ${currentYear}`,
      `House bills scraped: ${houseResult.totalBills ?? 0}`,
      `Senate bills scraped: ${senateResult.totalBills ?? 0}`,
    ];

    if (allIndividualFailures.length > 0) {
      body.push('', '--- Individual Bill Failures ---', '');
      for (const f of allIndividualFailures) {
        body.push(`  [${f.chamber}] Bill ID ${f.billId}: ${f.reason}`);
      }
    }

    await sendAlertEmail('Scraping completed with failures (recovery cron)', body.join('\n'));
  }

  // Notify followers of any bill status / dead changes detected this run.
  // Merge changes collected across both chambers. Wrapped so a notification
  // failure never fails the scrape.
  try {
    const allChanges = [
      ...(houseResult?.statusChanges || []),
      ...(senateResult?.statusChanges || []),
    ];
    const { usersNotified, changesSent } = await sendStatusChangeNotifications(allChanges);
    console.log(`[MAIN] Notifications: ${usersNotified} user(s), ${changesSent} change(s)`);
  } catch (notifyErr) {
    console.error('[MAIN] Notification dispatch failed:', notifyErr);
    await sendAlertEmail('Bill notification dispatch failed', [
      `The follower notification step failed at ${new Date().toISOString()}.`,
      '',
      `Error: ${notifyErr?.message || notifyErr}`,
      '',
      notifyErr?.stack || 'No stack trace available',
    ].join('\n'));
  }

  // Warn followers of bills approaching a legislative deadline (7-day heads-up,
  // 3-day urgent). Runs on the fresh bill_status data this scrape just persisted.
  // Wrapped so a failure never fails the scrape.
  try {
    const today = new Date().toISOString().split('T')[0];
    const warnings = await checkApproachingDeadlines(today);
    const { usersNotified } = await sendDeadlineWarnings(warnings);
    console.log(`[MAIN] Deadline warnings: ${usersNotified} user(s), ${warnings.length} bill(s)`);
  } catch (deadlineErr) {
    console.error('[MAIN] Deadline warning dispatch failed:', deadlineErr);
    await sendAlertEmail('Deadline warning dispatch failed', [
      `The deadline warning step failed at ${new Date().toISOString()}.`,
      '',
      `Error: ${deadlineErr?.message || deadlineErr}`,
      '',
      deadlineErr?.stack || 'No stack trace available',
    ].join('\n'));
  }
}

cronScrape()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Error during recovery cron:', error);

    await sendAlertEmail('Cron job CRASHED (recovery cron)', [
      `The recovery scrape crashed at ${new Date().toISOString()}.`,
      '',
      `Error: ${error?.message || error}`,
      '',
      `Stack trace:`,
      error?.stack || 'No stack trace available',
    ].join('\n'));

    process.exit(1);
  });
