import { supabase } from './supabaseClient';

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
    await updateScrapingStats(0, false, error.message);
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

/**
 * Save bills to the database
 * @returns {Promise<number>} The number of successfully saved bills
 */
const saveBills = async (bills) => {
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
      const { data: existingBill, error: selectError } = await supabase
        .from('bills')
        .select('id, updated_at')
        .filter('bill_url', 'eq', bill.bill_url)
        .limit(1);

      console.log(existingBill)

      if (selectError) throw selectError;
      
      if (existingBill?.length > 0) {
        // Update existing bill if status has changed
        const { error: updateError } = await supabase
          .from('bills')
          .update({
            measure_status: bill.measure_status,
            current_status: bill.current_status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingBill[0].id);

        if (updateError) throw updateError;
      } else {
        // Insert new bill
        const { error: insertError } = await supabase
          .from('bills')
          .insert([bill]);

        if (insertError) throw insertError;
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
    const { error } = await supabase.rpc('insert_scraping_stats', {
      p_bills_scraped: billsSaved,
      p_success: success,
      p_error_message: errorMessage || null
    });

    if (error) throw error;
    
    console.log('Scraping stats updated');
  } catch (error) {
    console.error('Error updating scraping stats:', error);
    throw error;
  }
};