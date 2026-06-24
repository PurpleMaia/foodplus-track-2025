import { db } from '../../db/kysely/client.js';
import { scrapeBills, saveBills } from './scraping/all-bills.js';
import { scrapeIndividual } from './scraping/individual-bill.js';
import { INDIVIDUAL_BATCH_SIZE, INDIVIDUAL_BATCH_DELAY, delay } from './scraping/config.js';

// Re-exported so existing importers (e.g. tests) can keep importing it from here.
export { computeChange } from './statusChange.js';

/**
 * Main entry point for scraping bills from the Hawaii State Legislature website. 
 * Scrapes both House and Senate bills for the current year, saves them to the database, and scrapes individual bill pages for additional details.
 */
export async function main() {
    const currentYear = new Date().getFullYear();

    console.log(`Starting server job scraping for year ${currentYear}...`);
    const houseURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;
    const senateURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=sb&title=Senate%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;

    // Scrape House bills URL
    console.log('[MAIN] Scraping House bills...');
    const houseStartTime = Date.now();    
    await startScraping(houseURL);    
    const houseEndTime = Date.now();
    const dH = (houseEndTime - houseStartTime) / 1000 / 60; // in minutes
    console.log(`[MAIN] Finished scraping House bills in ${dH} minutes.`);

    // Scrape Senate bills URL
    console.log('[MAIN] Scraping Senate bills...');
    const senateStartTime = Date.now();
    await startScraping(senateURL);
    const senateEndTime = Date.now();
    const dS = (senateEndTime - senateStartTime) / 1000 / 60; // in minutes
    console.log(`[MAIN] Finished scraping Senate bills in ${dS} minutes.`);
}

/**
 * Start the full scraping process by scraping the full page of the House/Senate website, then trigger an individual scrape for each of those bills. Returns full scrape metadata. 
 * @param {*} url 
 */
export async function startScraping(url) {
  let billCount = 0;
  let individualSuccessCount = 0;
  let individualFailCount = 0;
  const individualFailures = []; // per-bill failure details for alerting
  const statusChanges = []; // notifiable status/dead changes collected this run
  const startTime = Date.now(); // function-scoped so the catch block can compute duration too

  try {
    const bills = await scrapeBills(url);
    billCount = bills.length;

    // return bill ids for scraping individual bills
    const { billIds, newBillIds } = await saveBills(bills);
    const newBillIdSet = new Set(newBillIds); // for O(1) brand-new bill lookup

    // Scrape individual bills in batches for concurrency
    const individualBillsData = [];
    console.log(`[INDIVIDUAL] Scraping ${billIds.length} individual bills in batches of ${INDIVIDUAL_BATCH_SIZE}...`);

    for (let i = 0; i < billIds.length; i += INDIVIDUAL_BATCH_SIZE) {
      const batch = billIds.slice(i, i + INDIVIDUAL_BATCH_SIZE);
      const batchNum = Math.floor(i / INDIVIDUAL_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(billIds.length / INDIVIDUAL_BATCH_SIZE);
      console.log(`[INDIVIDUAL] Batch ${batchNum}/${totalBatches} (bills ${i + 1}-${Math.min(i + INDIVIDUAL_BATCH_SIZE, billIds.length)})`)

      const batchResults = await Promise.allSettled(
        batch.map(id => scrapeIndividual(id, statusChanges, newBillIdSet.has(id)))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const billId = batch[j];
        if (result.status === 'fulfilled' && result.value) {
          individualBillsData.push(result.value);
          individualSuccessCount++;
        } else {
          individualFailCount++;
          const reason = result.status === 'rejected'
            ? (result.reason?.message || String(result.reason))
            : 'Returned empty result';
          console.error(`[INDIVIDUAL] Failed bill ${billId}: ${reason}`);
          individualFailures.push({ billId, reason });
        }
      }

      // Delay between batches (skip on last batch)
      if (i + INDIVIDUAL_BATCH_SIZE < billIds.length) {
        await delay(INDIVIDUAL_BATCH_DELAY);
      }
    }

    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(1);
    const durationMin = ((endTime - startTime) / 1000 / 60).toFixed(1);

    const statsMessage = `Scraped ${billCount} bills, ${individualSuccessCount}/${billIds.length} individual pages in ${durationSec}s` +
      (individualFailCount > 0 ? ` (${individualFailCount} individual failures)` : '');
    console.log(`[STATS] ${statsMessage}`);
    await updateScrapingStats(billIds.length, true, individualFailCount > 0 ? `${individualFailCount} individual scrape failures` : null);

    // Return metadata and failure details for alerting
    return { totalBills: bills.length, individualFailCount, individualFailures, totalIndividual: billIds.length, statusChanges, durationMin };
  } catch (error) {
    console.error('Error during scraping:', error);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const errorMessage = `${error instanceof Error ? error.message : 'Unknown error'} (after ${durationSec}s, ${billCount} bills found)`;
    await updateScrapingStats(0, false, errorMessage);
    throw error;
  }
}

// Update scraping statistics
export async function updateScrapingStats(billsSaved, success, errorMessage) {
  try {
    // Truncate error message to avoid db column overflow
    const truncatedError = errorMessage ? errorMessage.substring(0, 500) : null;
    await db
      .insertInto('scraping_stats')
      .values({
        bills_scraped: billsSaved,
        success: success,
        error_message: truncatedError,
        last_scrape_time: new Date(),
      })
      .execute();
    console.log(`[STATS] Scraping stats updated: ${billsSaved} bills, success=${success}${truncatedError ? `, error=${truncatedError}` : ''}`);
  } catch (error) {
    console.error('[STATS] Error updating scraping stats:', error);
    throw error;
  }
}

