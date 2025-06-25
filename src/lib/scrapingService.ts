import { db } from '../../db/kysely/client'

// Flag to track if scraping should be cancelled
let shouldCancelScraping = false;

/**
 * Start the scraping process for the Hawaii State Legislature website
 */
export const startScraping = async () => {
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
};

/**
 * Cancel the scraping process
 */
export const cancelScraping = async () => {
  shouldCancelScraping = true;
};

/**
 * Scrape bills from the Hawaii State Legislature website via Edge Function
 */
const scrapeBills = async () => {
  try {
    console.log('Starting to scrape bills via Express API endpoint');
    
    const response = await fetch('/scrape-bills',
      {
        method: 'GET',        
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || 'Failed to scrape bills');
    }

    const { bills } = await response.json();
    
    if (shouldCancelScraping) {
      console.log('Scraping cancelled by user');
      return [];
    }

    console.log(`Scraped ${bills.length} bills`);
    console.log(bills)
    return bills;
  } catch (error) {
    console.error('Error scraping bills:', error);
    throw error;
  }
};

interface BillData {
  bill_url: string;
  bill_number?: string;
  bill_title?: string;
  description: string;
  current_status: string;
  committee_assignment?: string;
  introducer?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Save bills to the database
 * @returns {Promise<number>} The number of successfully saved bills
 */
const saveBills = async (bills: BillData[]) => {
  if (bills.length === 0) {
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
    // https://qxmyadwlppkgagtdcepn.supabase.co/rest/v1/bills?select=id%2Cupdated_at&bill_url=eq.https%3A%2F%2Fwww.capitol.hawaii.gov%2Fsession%2Fmeasure_indiv.aspx%3Fbilltype%3DHB%26billnumber%3D2%26year%3D2025
    try {
      // Check if the bill already exists
      const existingBill = await db
        .selectFrom('bills')
        .select(['id', 'updated_at'])
        .where('bill_url', '=', bill.bill_url)
        .limit(1)
        .executeTakeFirst();

      console.log(existingBill)

      if (existingBill) {
        // Update existing bill if status has changed
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
        // Insert new bill
        await db
          .insertInto('bills')
          .values({
            bill_url: bill.bill_url,
            bill_number: bill.bill_number || null,
            bill_title: bill.bill_title || null,
            description: bill.description,
            current_status: bill.current_status,
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
      // Continue with the next bill instead of failing the entire process
    }
  }
  
  console.log(`Successfully saved ${successCount} bills`);
  return successCount;
};

/**
 * Update scraping statistics
 */
const updateScrapingStats = async (billsSaved: number, success: boolean, errorMessage?: string) => {
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
};