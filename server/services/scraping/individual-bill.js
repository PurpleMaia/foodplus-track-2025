import { db } from '../../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { checkAndUpdateDeadStatus } from '../dead-bill.js';
import { computeChange } from '../statusChange.js';
// Deterministic pattern-table classifier (kept the export name for back-compat).
import { classifyStatusWithLLM as classifyBillStatus } from '../statusClassifierService.js';
import { parseVersionsAndReports, saveVersionsAndReports } from './versions-reports.js';
import {
  getRandomUserAgent,
  delay,
  INDIVIDUAL_TIMEOUT,
  INDIVIDUAL_MAX_RETRIES,
  INDIVIDUAL_RETRY_DELAY,
} from './config.js';

// Scrape individual bill
// const INDIVIDUAL_URL = 'https://data.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=1186&year=2025'; // example endpoint: bills dataset

export async function scrapeIndividual(billClassifier, statusChanges = null, isNewBill = false) {
  console.log('[INDIVIDUAL] NEW CALL WITH CLASSIFIER: ', billClassifier)

  let newBill = false
  let insertedNewBill = false // true once the URL-path insert created a brand-new bills row
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
      const currentStatus = $('#MainContent_ListView1_current_statusLabel_0').text().trim().replace(/\n\s*/g, ' ');
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
        insertedNewBill = true; // ensure bill_status gets classified below
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

      // save this bill's status updates to status_updates table (replaces any existing updates for this bill) 
      await saveUpdates(updates)

      // Read the previously stored status BEFORE we overwrite it, so we can
      // detect whether the scraped status differs from last run's value.
      // Isolated try/catch: a DB hiccup here must not fail the HTTP scrape.
      let priorRow = null;
      try {
        priorRow = await db
          .selectFrom('bills')
          .select(['current_status_string', 'dead', 'bill_title'])
          .where('id', '=', billID)
          .executeTakeFirst();
      } catch (err) {
        console.error(`[NOTIFY] Could not read prior status for ${billNumber}:`, err?.message || err);
      }
      const priorStatus = priorRow?.current_status_string ?? null;
      const priorDead = priorRow?.dead ?? false;

      // Guard against a transient empty scrape overwriting the stored baseline.
      const hasStatus = !!currentStatus && currentStatus.trim().length > 0;

      // update bill data in bills table if new amendments were made
      const billUpdate = {
        description: description,
        committee_assignment: committeeAssignment,
        introducer: introducers,
        updated_at: new Date(),
      };
      if (hasStatus) billUpdate.current_status_string = currentStatus;
      await db.updateTable('bills')
        .set(billUpdate)
        .where('id', '=', billID)
        .execute();
      console.log('[INDIVIDUAL] Bill data updated', billID);

      // check if the bill is dead after saving updates (returns whether dead flipped)
      const deadResult = await checkAndUpdateDeadStatus(billID, billNumber, committeeAssignment, updates);

      // Record a notifiable change (status string differs, or dead flipped) for
      // end-of-run follower notifications. Skipped for brand-new bills (no prior baseline).
      if (statusChanges && priorRow && !isNewBill && hasStatus) {
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

      // Derive the kanban bill_status (deterministic pattern-table classifier) when the status
      // changed or this is a brand-new bill. Runs after updates + bill row are persisted (the
      // classifier reads status_updates and the bills row). Isolated try/catch: a classification
      // failure must not fail the HTTP scrape.
      const isBrandNew = isNewBill || insertedNewBill;
      if (hasStatus && (isBrandNew || priorStatus !== currentStatus)) {
        try {
          console.log(`[STATUS] Status changed for ${billNumber} (new=${isBrandNew}); classifying...`);
          const newBillStatus = await classifyBillStatus(billID);
          if (newBillStatus) {
            await db.updateTable('bills')
              .set({ bill_status: newBillStatus })
              .where('id', '=', billID)
              .execute();
            console.log(`[STATUS] ${billNumber} bill_status set to "${newBillStatus}"`);
          } else {
            console.warn(`[STATUS] ${billNumber}: no usable classification, bill_status left unchanged`);
          }
        } catch (err) {
          console.error(`[STATUS] Failed to classify bill_status for ${billNumber}:`, err?.message || err);
        }
      }

      // Capture measure versions and committee reports. Isolated: any failure here
      // (parse, DB, or a single document fetch) must not fail the main scrape.
      try {
        const parsedDocs = parseVersionsAndReports(response.data);
        await saveVersionsAndReports(billID, billNumber, parsedDocs);
      } catch (err) {
        console.warn(`[VERSIONS] ${billNumber}: failed to capture versions/reports:`, err?.message || err);
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