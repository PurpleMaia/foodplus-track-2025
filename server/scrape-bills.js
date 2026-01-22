import { scrapeBills } from '../server/services/scrapingService.js';

// LOCAL DEFINITION FOR CRON JOB (same as in scrapingService.js)
async function startScraping(url) {
  try {
    const bills = await scrapeBills(url);
    const individualBillsData = [];
    
    for (const bill of bills) {
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

async function main() {
    const currentYear = new Date().getFullYear();
    console.log(`Starting cron job, scraping for year ${currentYear}...`);

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

main().catch((error) => {
  console.error('Error during cron job scraping:', error);
  process.exit(1);
});

