import { db } from '../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { read, writeFileSync } from 'fs';

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

const SCRAPING_URL =
  'https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=2025&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20Introduced';

// Start the scraping process for the Hawaii State Legislature website
export async function startScraping() {
  shouldCancelScraping = false;
  try {
    const bills = await scrapeBills();
    const individualBillsData = [];
    
    for (const bill of bills) {
      console.log("ABOUT TO TEST THE SCRAPE INDIV");
      console.log("bill.bill_url:", bill.bill_url);
      const billClassifier = bill.bill_url
      const individualBillData = await scrapeIndividual(billClassifier);
      if (individualBillData) {
        individualBillsData.push(individualBillData);
      }      
    }
    
    const savedBillsCount = await saveBills(bills);
    await updateScrapingStats(savedBillsCount, true);

    // Return both regular bills and individual bill data
    return { bills, individualBillsData };
  } catch (error) {
    console.error('Error during scraping:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await updateScrapingStats(0, false, errorMessage);
    throw error;
  }
}

// Cancel the scraping process
export async function cancelScraping() {
  shouldCancelScraping = true;
}

// Scrape bills from the Hawaii State Legislature website
export async function scrapeBills() {
  try {
    console.log('Starting to scrape bills from Hawaii Legislature website');
    await delay(1000);
    const response = await axios.get(SCRAPING_URL, {
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
    $('table tr').slice(1, 5).each((i, element) => {
      if (i === 0) return;
      const billLink = $(element).find('a.report');
      const billUrl = billLink.attr('href'); //www.capitol. replace it data. using regex
      const billNumber = billLink.text().trim();
      const measureStatus = $(element).find('td:nth-child(2) span');
      const measureTitle = measureStatus.eq(2).text().trim();
      const description = measureStatus.eq(3).text().trim();
      const currentStatus = $(element).find('td:nth-child(3)').text().trim().replace(/\n\s*/g, ' ');
      const introducers = $(element).find('td:nth-child(4)').text().trim();
      const committeeAssignment = $(element).find('td:nth-child(5)').text().trim();
      if (billUrl) {
        bills.push({
          bill_url: billUrl,
          description: description,
          current_status: currentStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          committee_assignment: committeeAssignment,
          bill_title: measureTitle,
          introducer: introducers,
          bill_number: billNumber,
        });
      }
    });
    if (shouldCancelScraping) {
      console.log('Scraping cancelled by user');
      return [];
    }
    console.log(`Scraped ${bills.length} bills`);
    return bills;
  } catch (error) {
    console.error('Error scraping bills:', error);
    if (error.response && error.response.status === 403) {
      try {
        await delay(2000);
        const retryResponse = await axios.get(SCRAPING_URL, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            Referer: 'https://data.capitol.hawaii.gov',
          },
        });
        const $ = cheerio.load(retryResponse.data);
        const bills = [];
        $('table tr').each((i, element) => {
          if (i === 0) return;
          const billLink = $(element).find('td:nth-child(1) a');
          const billUrl = billLink.attr('href');
          const billNumber = billLink.text().trim();
          const measureStatus = $(element).find('td:nth-child(2)').text().trim();
          const currentStatus = $(element).find('td:nth-child(3)').text().trim();
          if (billUrl) {
            bills.push({
              bill_url: `https://data.capitol.hawaii.gov${billUrl}`,
              bill_number: billNumber,
              description: measureStatus,
              current_status: currentStatus,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        });
        return bills;
      } catch (retryError) {
        console.error('Retry failed:', retryError);
        throw new Error('Failed to scrape bills after retry');
      }
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
  console.log(`Saving ${bills.length} bills to database`);
  let successCount = 0;
  for (const bill of bills) {
    if (shouldCancelScraping) {
      console.log('Saving cancelled by user');
      break;
    }
    try {
      const existingBill = await db
        .selectFrom('bills')
        .select(['id', 'updated_at'])
        .where('bill_url', '=', bill.bill_url)
        .limit(1)
        .executeTakeFirst();
      console.log(existingBill);
      if (existingBill) {
        await db
          .updateTable('bills')
          .set({
            description: bill.description,
            current_status: bill.current_status,
            updated_at: new Date(),
          })
          .where('id', '=', existingBill.id)
          .execute();
      } else {
        await db
          .insertInto('bills')
          .values({
            bill_url: bill.bill_url,
            bill_number: bill.bill_number || null,
            bill_title: bill.bill_title || null,
            current_status: bill.current_status,
            description: bill.description,
            committee_assignment: bill.committee_assignment || null,
            introducer: bill.introducer || null,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();
      }
      successCount++;
    } catch (error) {
      console.error('Error saving bill:', error);
    }
  }
  console.log(`Successfully saved ${successCount} bills`);
  return successCount;
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

console.log("GOING IN");

export async function scrapeIndividual(billClassifier) {
  console.log('scrapeIndividual classifer:', billClassifier)

  let url, billID
  if (billClassifier.startsWith('https://')) {
    // bill url was passed
    console.log('using billURL...')

    // get bill_id for foreign key constraints in later insertions
    const result = await db
      .selectFrom('bills')
      .select('id')
      .where('bill_url', '=', billClassifier)
      .executeTakeFirst();
  
    console.log('found bill id:', result.id)

    billID = result.id
    url = billClassifier
  } else {
    // bill id was passed through api call
    console.log('using billID...')
    billID = billClassifier

    // get bill_url from passed in billID parameter
    const result = await db
      .selectFrom('bills')
      .select('bill_url')
      .where('id', '=', billID)
      .executeTakeFirst();
  
    console.log('found bill url:', result.bill_url)
    url = result.bill_url
  }
  
  // error handle if the url is from the old scrape (has all the html)
  if (url.startsWith('<a')) {
    const match = url.match(/href=(["']?)([^"'\s>]+)\1/);
    url = match ? match[2] : null;
    console.log('Had to convert:', url)
  }

  const updatedUrl = url.replace("www.", "data.");
  const INDIVIDUAL_URL = updatedUrl
  try {
    // ==== test-scrape.js ====
     console.log('Starting to test scrape the individual page')
     await delay(1000)

    const response = await axios.get(INDIVIDUAL_URL, {
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
    const introducers = $('#MainContent_ListView1_introducerLabel_0').text().trim();
    const billTitle = $('#MainContent_LinkButtonMeasure').text().trim();
    const currentReferral = $('#MainContent_ListView1_current_referralLabel_0').text().trim();
    const description = $('#MainContent_ListView1_descriptionLabel_0').text().trim();
    const measureType = $('#MainContent_ListView1_measure_titleLabel_0').text().trim();
    
    // const statuses = $('#ctl00_MainContent_UpdatePanel1').text().trim();
    
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

    // data object of inidividual web page scrape (only caring about updates for now...)
    const billData = {
      introducers: introducers,
      billTitle: billTitle,
      currentReferral: currentReferral,
      // currentStatus: currentStatus,
      description: description,
      measureType: measureType,
      updates: updates
    };

    // console.log(billData);

    console.log('scraped updates:', updates)
    await saveUpdates(updates)    

    return billData;

  } catch (error) {
    console.error('Error scraping bills:', error);
  }

}

export async function saveUpdates(updates) {
  if (!updates || updates.length === 0) {
    console.log('No bills to save');
    return 0;
  }
  console.log(`Attempting to save ${updates.length} updates to database`);
  let successCount = 0;
  for (const update of updates) {
    if (shouldCancelScraping) {
      console.log('Saving cancelled by user');
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
      console.log('existingUpdate:', existingUpdate);
      if (existingUpdate) {
        console.log('found the same update, skipping insertion...')
      } else {
        console.log('new update, inserting into db...')
        await db
          .insertInto('status_updates')
          .values(updates)
          .execute();
      }
      successCount++;
    } catch (error) {
      console.error('Error saving update:', error);
    }
  }
  console.log(`Successfully saved ${successCount} updates`);
  return successCount;
}