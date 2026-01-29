import { db } from '../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { determineIfFoodRelated } from './llm.js';

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
  try {
    const bills = await scrapeBills(url);
    const individualBillsData = [];
    
    // return bill ids
    const billIds = await saveBills(bills);
    await updateScrapingStats(billIds.length, true);

    for (const id of billIds) {
      const individualBillData = await scrapeIndividual(id);
      if (individualBillData) {
        individualBillsData.push(individualBillData);
      }      
    }

    // Return both regular bills and individual bill data
    return { bills, individualBillsData };
  } catch (error) {
    console.error('Error during scraping:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await updateScrapingStats(0, false, errorMessage);
    throw error;
  }
}

// Scrape bills from the Hawaii State Legislature website
export async function scrapeBills(url) {
  try {
    console.log('Scraping bills from a main bill list...');
    await delay(1000);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        Accept: 'text/html',
        Referer: 'https://data.capitol.hawaii.gov',
      },
      timeout: 30000,
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
    console.error('[ALL BILLS] Error scraping bills:', error);
    if (error.response && error.response.status === 403) {
      // ... existing retry logic ...
    }
    throw error;
  }
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
  
  // First pass: update existing bills, collect new bills
  console.log('[SAVE] First pass: updating existing bills...');
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
    await db
      .insertInto('scraping_stats')
      .values({
        bills_scraped: billsSaved,
        success: success,
        error_message: errorMessage || null,
        last_scrape_time: new Date(),
      })
      .execute();
    console.log('Scraping stats updated');
  } catch (error) {
    console.error('Error updating scraping stats:', error);
    throw error;
  }
}

// Scrape individual bill 
// const INDIVIDUAL_URL = 'https://data.capitol.hawaii.gov/session/measure_indiv.aspx?billtype=SB&billnumber=1186&year=2025'; // example endpoint: bills dataset

export async function scrapeIndividual(billClassifier) {
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
    console.log('[INDIVIDUAL] using billID...')
    billID = billClassifier

    // get bill_url from passed in billID parameter
    const result = await db
      .selectFrom('bills')
      .select('bill_url')
      .where('id', '=', billID)
      .executeTakeFirst();

    console.log('[INDIVIDUAL] found bill url:', result.bill_url)
    url = result.bill_url
  }
  
  // error handle if the url is from the old scrape (has all the html)
  if (url.startsWith('<a')) {
    const match = url.match(/href=(["']?)([^"'\s>]+)\1/);
    url = match ? match[2] : null;
    console.log('[INDIVIDUAL] Had to convert:', url)
  }

  // modify url to use data. instead of www.
  const updatedUrl = url.replace("www.", "data.");
  try {
    // ==== test-scrape.js ====
     console.log('[INDIVIDUAL] Scraping individual page...')
     await delay(1000)

    const response = await axios.get(updatedUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        Accept: 'text/html',
        Referer: 'https://data.capitol.hawaii.gov',
      },
      timeout: 30000,
      maxRedirects: 5,
    });
    // =========================    

    const $ = cheerio.load(response.data)

    // 5. Extract introducers
    const description = $('#MainContent_ListView1_descriptionLabel_0').text().trim();
    const currentStatus = $('#MainContent_ListView1_current_statusLabel_0').text().trim();
    const committeeAssignment = $('#MainContent_ListView1_current_referralLabel_0').text().trim();
    const billTitle = $('#MainContent_ListView1_measure_titleLabel_0').text().trim();
    const introducers = $('#MainContent_ListView1_introducerLabel_0').text().trim();
    const billNumber = $('#MainContent_LinkButtonMeasure').text().trim().split(' ')[0];

    // If new bill, insert into bills table to get billID for foreign key constraints
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
    }

    const updates = []
    $('#MainContent_GridViewStatus tr').each((i, row) => {
      // console.log('Number of status rows:', $('#MainContent_GridViewStatus tr').length);

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
    await saveUpdates(updates)

    return billData;

  } catch (error) {
    console.error('[INDIVIDUAL] Error scraping bills:', error);
  }

}

export async function saveUpdates(updates) {
  if (!updates || updates.length === 0) {
    console.log('[SAVE UPDATES] No bills to save');
    return 0;
  }
  console.log(`[SAVE UPDATES] Saving ${updates.length} updates to database...`);
  let successCount = 0;
  for (const update of updates) {
    if (shouldCancelScraping) {
      console.log('[SAVE UPDATES] Saving cancelled by user');
      break;
    }
    try {
      const existingUpdate = await db
        .selectFrom('status_updates')
        .select(['id', 'bill_id', 'chamber', 'date', 'statustext'])
        .where('bill_id', '=', update.bill_id)
        .where('chamber', '=', update.chamber)
        .where('date', '=', update.date)
        .where('statustext', '=', update.statustext)
        .limit(1)
        .executeTakeFirst();
      // console.log('existingUpdate:', existingUpdate);
      if (!existingUpdate) {        
        console.log('[updates] NEW UPDATE! inserting into db...')
        await db
          .insertInto('status_updates')
          .values(update)
          .executeTakeFirst();
      }
      successCount++;
    } catch (error) {
      console.error('Error saving update:', error);
    }
  }  
  return successCount;
}