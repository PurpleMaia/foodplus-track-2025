import { db } from '../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { determineIfFoodRelated } from './llm.js';
import { isBillDead } from './dead-bill.js';
import sessionDeadlines from '../../session-deadlines-2026.json' with { type: 'json' };
import { diffBillState } from './statusChange.js';

// Flag to track if scraping should be cancelled
let shouldCancelScraping = false;

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
];

const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Timeout settings
const MAIN_LIST_TIMEOUT = 60000; // 60s for main bill list pages
const INDIVIDUAL_TIMEOUT = 45000; // 45s for individual bill pages
const MAIN_LIST_MAX_RETRIES = 3;
const MAIN_LIST_RETRY_DELAY = 5000; // 5s between retries

// Individual scraping settings
const INDIVIDUAL_BATCH_SIZE = 5;
const INDIVIDUAL_BATCH_DELAY = 2000; // 2s between batches
const INDIVIDUAL_MAX_RETRIES = 3;
const INDIVIDUAL_RETRY_DELAY = 3000; // 3s base delay, doubles each retry

/**
 * Build a plain status-change record, or null if nothing notifiable changed.
 * Pure — no DB access — so it can be unit tested.
 * `oldStatus`/`newStatus` are the bill's human-readable current_status_string values.
 * @param {{ billId: string, billNumber: string, billTitle: string|null, oldStatus: string|null, newStatus: string|null, oldDead: boolean|null, newDead: boolean|null }} input
 * @returns {null | { bill_id: string, bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }}
 */
export function computeChange({ billId, billNumber, billTitle, oldStatus, newStatus, oldDead, newDead }) {
  const { changed } = diffBillState({ oldStatus, newStatus, oldDead, newDead });
  if (!changed) return null;
  return {
    bill_id: billId,
    bill_number: billNumber,
    bill_title: billTitle ?? null,
    old_status: oldStatus ?? null,
    new_status: newStatus ?? null,
    old_dead: oldDead ?? null,
    new_dead: newDead ?? null,
  };
}

export async function main() {
    const currentYear = new Date().getFullYear();
    console.log(`Starting server job scraping for year ${currentYear}...`);

    const houseURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;
    const senateURL = `https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=${currentYear}&report=deadline&active=true&rpt_type=&measuretype=sb&title=Senate%20Bills%20with%20Action%20Taken%20in%20${currentYear}%20Only`;


    console.log('[MAIN] Scraping House bills...');
    const startTime = Date.now();
    
    await startScraping(houseURL);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60; // in minutes
    console.log(`[MAIN] Finished scraping House bills in ${duration} minutes.`);

    console.log('[MAIN] Scraping Senate bills...');
    const startTimeSenate = Date.now();

    await startScraping(senateURL);

    const endTimeSenate = Date.now();
    const durationSenate = (endTimeSenate - startTimeSenate) / 1000 / 60; // in minutes
    console.log(`[MAIN] Finished scraping Senate bills in ${durationSenate} minutes.`);
}

// Start the scraping process for the Hawaii State Legislature website
export async function startScraping(url) {
  const startTime = Date.now();
  let billCount = 0;
  let individualSuccessCount = 0;
  let individualFailCount = 0;
  const individualFailures = []; // per-bill failure details for alerting
  const statusChanges = []; // notifiable status/dead changes collected this run

  try {
    const bills = await scrapeBills(url);
    billCount = bills.length;

    // return bill ids for scraping individual bills
    const billIds = await saveBills(bills);

    // Scrape individual bills in batches for concurrency
    const individualBillsData = [];
    console.log(`[INDIVIDUAL] Scraping ${billIds.length} individual bills in batches of ${INDIVIDUAL_BATCH_SIZE}...`);

    for (let i = 0; i < billIds.length; i += INDIVIDUAL_BATCH_SIZE) {
      if (shouldCancelScraping) {
        console.log('[INDIVIDUAL] Scraping cancelled by user');
        break;
      }

      const batch = billIds.slice(i, i + INDIVIDUAL_BATCH_SIZE);
      const batchNum = Math.floor(i / INDIVIDUAL_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(billIds.length / INDIVIDUAL_BATCH_SIZE);
      console.log(`[INDIVIDUAL] Batch ${batchNum}/${totalBatches} (bills ${i + 1}-${Math.min(i + INDIVIDUAL_BATCH_SIZE, billIds.length)})`)

      const batchResults = await Promise.allSettled(
        batch.map(id => scrapeIndividual(id, statusChanges))
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

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const statsMessage = `Scraped ${billCount} bills, ${individualSuccessCount}/${billIds.length} individual pages in ${durationSec}s` +
      (individualFailCount > 0 ? ` (${individualFailCount} individual failures)` : '');
    console.log(`[STATS] ${statsMessage}`);
    await updateScrapingStats(billIds.length, true, individualFailCount > 0 ? `${individualFailCount} individual scrape failures` : null);

    // Return bills, individual bill data, and failure details for alerting
    return { bills, individualBillsData, individualFailCount, individualFailures, totalIndividual: billIds.length, statusChanges };
  } catch (error) {
    console.error('Error during scraping:', error);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const errorMessage = `${error instanceof Error ? error.message : 'Unknown error'} (after ${durationSec}s, ${billCount} bills found)`;
    await updateScrapingStats(0, false, errorMessage);
    throw error;
  }
}

// Scrape bills from the Hawaii State Legislature website (with retry)
export async function scrapeBills(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAIN_LIST_MAX_RETRIES; attempt++) {
    try {
      console.log(`[ALL BILLS] Scraping main bill list (attempt ${attempt}/${MAIN_LIST_MAX_RETRIES})...`);
      await delay(attempt === 1 ? 1000 : MAIN_LIST_RETRY_DELAY);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html',
          Referer: 'https://data.capitol.hawaii.gov',
        },
        timeout: MAIN_LIST_TIMEOUT,
        maxRedirects: 5,
      });
      const $ = cheerio.load(response.data);
      const bills = [];
      const rows = $('table tr').toArray().slice(1); // Skip header row

      for (const element of rows) {
        if (shouldCancelScraping) {
          console.log('Scraping cancelled by user');
          return [];
        }

        const billLink = $(element).find('a.report');
        const billUrl = billLink.attr('href');
        const billNumber = billLink.text().trim();
        const billYear = new URL(billUrl, 'https://data.capitol.hawaii.gov').searchParams.get('year');
        const measureStatus = $(element).find('td:nth-child(2) span');
        const measureTitle = measureStatus.eq(2).text().trim();
        const description = measureStatus.eq(3).text().trim();
        const currentStatus = $(element).find('td:nth-child(3)').text().trim().replace(/\n\s*/g, ' ');
        const introducers = $(element).find('td:nth-child(4)').text().trim();
        const committeeAssignment = $(element).find('td:nth-child(5)').text().trim();

        if (billUrl) {
          bills.push({
            bill_url: billUrl,
            bill_number: billNumber,
            year: billYear,
            bill_title: measureTitle,
            description: description,
            current_status_string: currentStatus,
            committee_assignment: committeeAssignment,
            introducer: introducers,
          });
        }
      }

      console.log(`[ALL BILLS] Scraped ${bills.length} bills`);
      return bills;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' ||
        error?.response?.status === 503 || error?.response?.status === 502;

      if ((isTimeout || isNetworkError) && attempt < MAIN_LIST_MAX_RETRIES) {
        console.warn(`[ALL BILLS] Attempt ${attempt} failed (${error.message}). Retrying in ${MAIN_LIST_RETRY_DELAY / 1000}s...`);
        continue;
      }

      console.error(`[ALL BILLS] Failed after ${attempt} attempt(s):`, error.message);
      throw error;
    }
  }

  throw lastError;
}

// Save bills to the database
export async function saveBills(bills) {
  if (!bills || bills.length === 0) {
    console.log('No bills to save');
    return 0;
  }
  console.log(`[SAVE] Saving ${bills.length} bills to database...`);
  
  const BATCH_SIZE = 4;
  const DELAY_BETWEEN_BATCHES = 1000;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let billIds = [];
  const newBills = [];

  // First pass: find existing bills, collect new bills
  console.log('[SAVE] First pass: finding existing bills...');
  for (const bill of bills) {
    if (shouldCancelScraping) {
      console.log('Saving cancelled by user');
      break;
    }
    try {
      // Find existing bill by bill_number and bill_year constraint
      const existingBill = await db
        .selectFrom('bills')
        .select(['id', 'updated_at', 'food_related'])
        .where('bill_number', '=', bill.bill_number)
        .where('year', '=', bill.year)
        .limit(1)
        .executeTakeFirst();

      if (existingBill) {
        // Update existing bill - no LLM call needed
        await db
          .updateTable('bills')
          .set({
            description: bill.description,
            current_status: bill.current_status,
            committee_assignment: bill.committee_assignment,
            introducer: bill.introducer,
            bill_title: bill.bill_title,
            updated_at: new Date(),
          })
          .where('id', '=', existingBill.id)
          .execute();

        // Log the existing bill ID for scrapeIndividual use
        billIds.push(existingBill.id);
        
        console.log(`[SAVE] Updated existing bill: ${bill.bill_number}`);
      } else {
        // Collect new bills for batched LLM processing
        newBills.push(bill);
      }
    } catch (error) {
      console.error(`Error processing bill ${bill.bill_number}:`, error);
    }
  }

  // Second pass: process new bills in batches with LLM calls
  console.log('[SAVE] Second pass: classifying new bills with LLM calls...');
  if (newBills.length > 0) {
    console.log(`[SAVE] Processing ${newBills.length} new bills in batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < newBills.length; i += BATCH_SIZE) {
      if (shouldCancelScraping) {
        console.log('Saving cancelled by user');
        break;
      }
      
      const batch = newBills.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (bill) => {
        try {
          console.log(`[SAVE] New bill ${bill.bill_number} - determining food-related...`);
          const isFoodRelated = await determineIfFoodRelated(bill.bill_title, bill.description);
          console.log(`[SAVE] Bill ${bill.bill_number} - Food Related: ${isFoodRelated}`);

          const newBill = await db
            .insertInto('bills')
            .values({
              bill_url: bill.bill_url,
              year: bill.year || null,
              bill_number: bill.bill_number || null,
              bill_title: bill.bill_title || null,
              current_status_string: bill.current_status_string || null,
              description: bill.description,
              committee_assignment: bill.committee_assignment || null,
              introducer: bill.introducer || null,
              food_related: isFoodRelated,
              archived: false,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning('id')
            .executeTakeFirst();
            
          console.log(`[SAVE] Inserted new bill: ${bill.bill_number}`);

          // Log the new bill ID for scrapeIndividual use
          return newBill.id;
        } catch (error) {
          console.error(`Error saving new bill ${bill.bill_number}:`, error);
          return null;
        }
      });

      // Append the bill IDs from this batch
      const results = await Promise.all(batchPromises);
      billIds.push(...results.filter(id => id !== null));

      console.log(`[SAVE] Completed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newBills.length / BATCH_SIZE)}`);

      // Delay before next batch (skip on last batch)
      if (i + BATCH_SIZE < newBills.length) {
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }
  }

  return billIds;
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

// Scrape individual bill 
// const INDIVIDUAL_URL = 'https://data.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=1186&year=2025'; // example endpoint: bills dataset

export async function scrapeIndividual(billClassifier, statusChanges = null) {
  console.log('[INDIVIDUAL] NEW CALL WITH CLASSIFIER: ', billClassifier)

  let newBill = false
  let url, billID
  const urlPattern = /^https?:\/\//i;
  if (urlPattern.test(billClassifier)) {
    // bill url was passed
    console.log('[INDIVIDUAL] using bill URL...')

    // get bill_id for foreign key constraints in later insertions
    const result = await db
      .selectFrom('bills')
      .select('id')
      .where('bill_url', '=', billClassifier)
      .executeTakeFirst();

    // if no result, the bill url is new and not in db yet
    if (!result) {
      console.log('[INDIVIDUAL] No bill found for this URL in DB yet.')  
      newBill = true
    } else {
      console.log('[INDIVIDUAL] found bill id:', result.id)      
      billID = result.id
    }

    url = billClassifier
  } else {
    // bill id was passed through api call
    console.log('[INDIVIDUAL] using billID...');
    billID = billClassifier;

    // get bill_url from passed in billID parameter
    const result = await db
      .selectFrom('bills')
      .select('bill_url')
      .where('id', '=', billID)
      .executeTakeFirst();

    // console.log('[INDIVIDUAL] found bill url:', result.bill_url)
    url = result.bill_url
  }
  
  // normalize if the url is from the old scrape (has all the html)
  if (url.startsWith('<a')) {
    const match = url.match(/href=(["']?)([^"'\s>]+)\1/);
    url = match ? match[2] : null;
    console.log('[INDIVIDUAL] Had to convert:', url)
  }

  // modify url to use data subdomain instead of www subdomain
  const updatedUrl = url.replace("www.", "data.");

  let lastError;

  for (let attempt = 1; attempt <= INDIVIDUAL_MAX_RETRIES; attempt++) {
    try {
      console.log(`[INDIVIDUAL] Scraping individual page (attempt ${attempt}/${INDIVIDUAL_MAX_RETRIES})...`)

      // rate limiting delay — increases with each retry
      await delay(attempt === 1 ? 1000 : INDIVIDUAL_RETRY_DELAY * (attempt - 1))

      const response = await axios.get(updatedUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html',
          Referer: 'https://data.capitol.hawaii.gov',
        },
        timeout: INDIVIDUAL_TIMEOUT,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data)

      // extract base metadata from the page
      const description = $('#MainContent_ListView1_descriptionLabel_0').text().trim();
      const currentStatus = $('#MainContent_ListView1_current_statusLabel_0').text().trim();
      const committeeAssignment = $('#MainContent_ListView1_current_referralLabel_0').text().trim();
      const billTitle = $('#MainContent_ListView1_measure_titleLabel_0').text().trim();
      const introducers = $('#MainContent_ListView1_introducerLabel_0').text().trim();
      const billNumber = $('#MainContent_LinkButtonMeasure').text().trim().split(' ')[0];

      // If new bill, insert into bills table to get billID for foreign key constraints
      // Should only happen when using URL parameter
      if (newBill) {
        console.log('[INDIVIDUAL] This is a NEW BILL, inserting bill info into bills table...')
        const newBillId = await db
          .insertInto('bills')
          .values({
            bill_url: url,
            description: description,
            current_status_string: currentStatus,
            committee_assignment: committeeAssignment,
            bill_title: billTitle,
            introducer: introducers,
            bill_number: billNumber,
            updated_at: new Date(),
          }).returning('bills.id').executeTakeFirst();
        console.log('[INDIVIDUAL] New bill inserted with ID:', newBillId.id)
        billID = newBillId.id
        newBill = false; // only insert once even if we somehow retry past this point
      }

      // extract status updates
      const updates = []
      $('#MainContent_GridViewStatus tr').each((_, row) => {
        const tds = $(row).find('td');
        if (tds.length === 3) {
          const date = $(tds[0]).text().trim();
          const chamber = $(tds[1]).text().trim();
          const statusText = $(tds[2]).text().trim();

          // building row in status_updates
          updates.push({
            bill_id: billID, // FK
            chamber: chamber,
            date: date,
            statustext: statusText
          });
        }
      });

      // build bill data object to return, including updates array
      const billData = {
        bill_url: updatedUrl,
        bill_number: billNumber,
        bill_title: billTitle,
        description: description,
        current_status: currentStatus,
        committee_assignment: committeeAssignment,
        introducer: introducers,
        updates: updates
      };

      console.log('[INDIVIDUAL] # Updates found:', updates.length)

      // save updates to database
      await saveUpdates(updates)

      // Read the previously stored status BEFORE we overwrite it, so we can
      // detect whether the scraped status differs from last run's value.
      const priorRow = await db
        .selectFrom('bills')
        .select(['current_status_string', 'dead', 'bill_title'])
        .where('id', '=', billID)
        .executeTakeFirst();
      const priorStatus = priorRow?.current_status_string ?? null;
      const priorDead = priorRow?.dead ?? false;

      // save bill data if new amendments were made
      await db.updateTable('bills')
        .set({
          description: description,
          committee_assignment: committeeAssignment,
          introducer: introducers,
          current_status_string: currentStatus,
          updated_at: new Date(),
        })
        .where('id', '=', billID)
        .execute();
      console.log('[INDIVIDUAL] Bill data updated', billID);

      // check if the bill is dead after saving updates (returns whether dead flipped)
      const deadResult = await checkAndUpdateDeadStatus(billID, billNumber, committeeAssignment, updates);

      // Record a notifiable change (status string differs, or dead flipped) for
      // end-of-run follower notifications. Skipped for brand-new bills (no prior baseline).
      if (statusChanges && priorRow) {
        const change = computeChange({
          billId: billID,
          billNumber,
          billTitle: billTitle,
          oldStatus: priorStatus,
          newStatus: currentStatus,
          oldDead: priorDead,
          newDead: deadResult.dead,
        });
        if (change) {
          statusChanges.push(change);
          console.log(`[NOTIFY] Change captured for ${billNumber}: "${change.old_status}" → "${change.new_status}", dead ${change.old_dead}→${change.new_dead}`);
        }
      }

      return billData;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' ||
        error?.code === 'ECONNRESET' || error?.response?.status === 503 || error?.response?.status === 502;

      if ((isTimeout || isNetworkError) && attempt < INDIVIDUAL_MAX_RETRIES) {
        const retryIn = INDIVIDUAL_RETRY_DELAY * attempt;
        console.warn(`[INDIVIDUAL] Attempt ${attempt} failed for ${billClassifier} (${error.message}). Retrying in ${retryIn / 1000}s...`);
        continue;
      }

      console.error('[INDIVIDUAL] Error scraping bill:', billClassifier, error?.message || error);
      throw new Error(`Bill ${billClassifier}: ${error?.message || error}`);
    }
  }

  throw new Error(`Bill ${billClassifier}: Failed after ${INDIVIDUAL_MAX_RETRIES} attempts — ${lastError?.message || lastError}`);

}

/**
 * Checks if a bill is dead after its status updates have been saved,
 * and flips the `dead` boolean on the bills row if the status changed.
 *
 * @param {string} billID - the bill's DB id
 * @param {string} billNumber - e.g. "HB123"
 * @param {string} committeeAssignment - comma-separated committee names
 * @param {Array<{bill_id: string, chamber: string, date: string, statustext: string}>} updates - the status updates just saved
 */
async function checkAndUpdateDeadStatus(billID, billNumber, committeeAssignment, updates) {
  try {
    // Get the bill's current bill_status and dead flag from the DB
    const bill = await db
      .selectFrom('bills')
      .select(['bill_status', 'dead'])
      .where('id', '=', billID)
      .executeTakeFirst();

    if (!bill || !bill.bill_status) {
      return { dead: false, changed: false };
    }

    const today = new Date().toISOString().split('T')[0];

    const result = isBillDead(
      {
        bill_number: billNumber,
        bill_status: bill.bill_status,
        committee_assignment: committeeAssignment,
      },
      updates.map(u => ({ statustext: u.statustext, date: u.date, chamber: u.chamber })),
      sessionDeadlines,
      today,
    );

    const wasDead = bill.dead ?? false;
    const deadChanged = result.dead !== wasDead;

    // Only update if the dead flag changed
    if (deadChanged) {
      await db
        .updateTable('bills')
        .set({ dead: result.dead })
        .where('id', '=', billID)
        .execute();

      const action = result.dead ? 'DEAD' : 'ALIVE';
      console.log(`[DEAD-BILL] ${billNumber}: ${action} — ${result.reason} - Deadline: ${result.failedDeadline}`);
    }

    return { dead: result.dead, changed: deadChanged };
  } catch (err) {
    console.error(`[DEAD-BILL] Error checking dead status for ${billNumber}:`, err);
    return { dead: false, changed: false };
  }
}

export async function saveUpdates(updates) {
  if (!updates || updates.length === 0) {
    console.log('[SAVE UPDATES] No updates to save');
    return 0;
  }

  const billId = updates[0].bill_id;
  console.log(`[SAVE UPDATES] Replacing ${updates.length} updates for bill ${billId}...`);

  try {
    // Delete all existing updates for this bill
    await db
      .deleteFrom('status_updates')
      .where('bill_id', '=', billId)
      .execute();

    // Insert all fresh updates
    await db
      .insertInto('status_updates')
      .values(updates)
      .execute();

    console.log(`[SAVE UPDATES] Saved ${updates.length} updates for bill ${billId}`);
    return updates.length;
  } catch (error) {
    console.error(`[SAVE UPDATES] Error saving updates for bill ${billId}:`, error);
    return 0;
  }
}