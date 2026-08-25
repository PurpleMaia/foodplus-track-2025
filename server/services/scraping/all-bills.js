import { db } from '../../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { determineIfFoodRelated } from '../llmService.js';
import { sendAlertEmail } from '../notifications/cron-alerts.js';
// import { fetchListHtmlViaBrowser } from './playwright-list.js'; // Playwright/www fallback — parked (see commented block below).
import {
  getRandomUserAgent,
  delay,
  MAIN_LIST_TIMEOUT,
  MAIN_LIST_MAX_RETRIES,
  MAIN_LIST_RETRY_DELAY,
} from './config.js';

/**
 * Parse the main bill-list report HTML into an array of bill objects. Pure: no
 * network, no DB. Works on HTML from either the axios (`data`) path or the
 * Playwright (`www`) fallback, since both render the same report table.
 * @param {string} html
 * @returns {Array<object>}
 */
export function parseBillListHtml(html) {
  const $ = cheerio.load(html);
  const bills = [];
  const rows = $('table tr').toArray().slice(1); // Skip header row

  for (const element of rows) {
    const billLink = $(element).find('a.report');
    const billUrl = billLink.attr('href');
    if (!billUrl) continue;

    const billNumber = billLink.text().trim();
    const billYear = new URL(billUrl, 'https://data.capitol.hawaii.gov').searchParams.get('year');
    const measureStatus = $(element).find('td:nth-child(2) span');
    const measureTitle = measureStatus.eq(2).text().trim();
    const description = measureStatus.eq(3).text().trim();
    const currentStatus = $(element).find('td:nth-child(3)').text().trim().replace(/\n\s*/g, ' ');
    const introducers = $(element).find('td:nth-child(4)').text().trim();
    const committeeAssignment = $(element).find('td:nth-child(5)').text().trim();

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

  return bills;
}

/**
 * Default list-HTML fetcher: plain axios GET against the data host. Extracted so
 * the fetch strategy can be swapped (e.g. a local Playwright/www fetcher) without
 * duplicating scrapeBills's retry/parse/alert orchestration.
 * @param {string} url
 * @returns {Promise<string>} the report page HTML
 */
export async function fetchListHtmlViaAxios(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      Accept: 'text/html',
      Referer: 'https://data.capitol.hawaii.gov',
    },
    timeout: MAIN_LIST_TIMEOUT,
    maxRedirects: 5,
  });
  return response.data;
}

/**
 * Scrape the main bill list page for the given URL, returning an array of bill objects with basic info. Retries on network errors or timeouts.
 * @param {string} url
 * @param {object} [options]
 * @param {(url: string) => Promise<string>} [options.fetchListHtml] - fetch strategy for the
 *   report HTML. Defaults to axios against the data host; a local recovery scraper can pass a
 *   Playwright fetcher to reach the Cloudflare-fronted www host. Errors it throws flow through
 *   the same retry loop below.
 * @returns
 */
export async function scrapeBills(url, { fetchListHtml = fetchListHtmlViaAxios } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAIN_LIST_MAX_RETRIES; attempt++) {
    try {
      console.log(`[ALL BILLS] Scraping main bill list (attempt ${attempt}/${MAIN_LIST_MAX_RETRIES})...`);
      await delay(attempt === 1 ? 1000 : MAIN_LIST_RETRY_DELAY);

      const html = await fetchListHtml(url);
      const bills = parseBillListHtml(html);

      console.log(`[ALL BILLS] Scraped ${bills.length} bills`);
      // Only announce a genuine data-host success. When a caller injects a
      // different fetcher (e.g. the local Playwright/www recovery scraper), the
      // data URL did NOT pass — sending this would be a false positive.
      if (fetchListHtml === fetchListHtmlViaAxios) {
        await sendAlertEmail(
          'data URL passed',
          `The data.capitol.hawaii.gov bill-list report succeeded on attempt ${attempt} and scraped ${bills.length} bills.\n\n` +
          `URL: ${url}`
        );
      }
      return bills;
    } catch (error) {
      lastError = error;
      const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
        error?.message?.toLowerCase().includes('timeout');
      const isServerError = error?.response?.status === 503 || error?.response?.status === 502 ||
        error?.response?.status === 500;
      const isNetworkError = error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND';

      if ((isTimeout || isServerError || isNetworkError) && attempt < MAIN_LIST_MAX_RETRIES) {
        console.warn(`[ALL BILLS] Attempt ${attempt} failed (${error.message}). Retrying in ${MAIN_LIST_RETRY_DELAY / 1000}s...`);
        continue;
      }

      // --- PARKED: Playwright/www fallback on the known HTTP 500 upstream crash. ---
      // Kept as commented code (with playwright-list.js) in case the data host's
      // recurring 500 returns. Re-enable by uncommenting the fetchListHtmlViaBrowser
      // import above and this block. NOTE: www is behind Cloudflare and was returning
      // 403 to headless Chromium from the Dokku host — revisit before relying on it.
      // if (error?.response?.status === 500) {
      //   await sendAlertEmail(
      //     'data URL failed (HTTP 500)',
      //     `The data.capitol.hawaii.gov bill-list report returned HTTP 500 after ${attempt} attempt(s).\n\n` +
      //     `URL: ${url}\n\nAttempting the Playwright/www fallback...`
      //   );
      //   try {
      //     const html = await fetchListHtmlViaBrowser(url);
      //     const bills = parseBillListHtml(html);
      //     console.log(`[ALL BILLS] Scraped ${bills.length} bills via Playwright fallback`);
      //     const wwwUrl = url.replace('data.capitol.hawaii.gov', 'www.capitol.hawaii.gov');
      //     await sendAlertEmail(
      //       'www URL passed (Playwright fallback)',
      //       `The Playwright fallback against www.capitol.hawaii.gov succeeded and scraped ${bills.length} bills.\n\nURL: ${wwwUrl}`
      //     );
      //     return bills;
      //   } catch (fallbackError) {
      //     console.error(`[ALL BILLS] Playwright fallback also failed:`, fallbackError.message);
      //     throw fallbackError;
      //   }
      // }

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
    return { billIds: [], newBillIds: [] };
  }
  console.log(`[SAVE] Saving ${bills.length} bills to database...`);
  
  const BATCH_SIZE = 4;
  const DELAY_BETWEEN_BATCHES = 1000;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  let billIds = [];
  let newBillIds = []; // ids of bills inserted this run (brand-new)
  const newBills = [];

  // First pass: find existing bills, collect new bills
  console.log('[SAVE] First pass: finding existing bills...');
  for (const bill of bills) {
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

      // Append the bill IDs from this batch (new bills only)
      const results = await Promise.all(batchPromises);
      const validIds = results.filter(id => id !== null);
      billIds.push(...validIds);
      newBillIds.push(...validIds); // track newly-inserted ids for brand-new bill suppression

      console.log(`[SAVE] Completed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newBills.length / BATCH_SIZE)}`);

      // Delay before next batch (skip on last batch)
      if (i + BATCH_SIZE < newBills.length) {
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }
  }

  return { billIds, newBillIds };
}