import { db } from '../../db/kysely/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
    const savedBillsCount = await saveBills(bills);
    await updateScrapingStats(savedBillsCount, true);
    return bills;
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
    $('table tr').slice(1, 26).each((i, element) => {
      if (i === 0) return;
      const billLink = $(element).find('a.report');
      const billUrl = billLink.attr('href');
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
          if (i === 0 || i > 25) return;
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