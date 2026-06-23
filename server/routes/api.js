import { Router } from 'express';
import { main, saveBills, updateScrapingStats, scrapeIndividual, findExistingBillId, insertMinimalBill } from '../services/scrapingService.js';
import { getAllBillsContext } from '../services/bills.js';
import { cleanCsvRow, validateCleanedBill } from '../services/csvCleaner.js';
import { db } from '../../db/kysely/client.js';
import { sendAlertEmail } from '../services/alertService.js';
const router = Router();

// GET /api/scrape-bills - Start scraping process
router.get('/scrape-bills', async (req, res) => {
  try {
    const result = await main();
    res.json({ 
      bills: result.bills, 
      individualBillsData: result.individualBillsData 
    });
  } catch (error) {
    console.error('Error in scrape-bills endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to scrape bills',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/save-bills - Save bills to database
router.post('/save-bills', async (req, res) => {
  try {
    const { bills } = req.body;
    
    if (!bills || !Array.isArray(bills)) {
      return res.status(400).json({ error: 'Invalid bills data' });
    }
    
    const successCount = await saveBills(bills);
    res.json({ successCount });
  } catch (error) {
    console.error('Error in save-bills endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to save bills',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/upload-csv - Clean, validate, dedup and (optionally) connect CSV bills
//
// Body: { rows: string[][], user_id?: string }
//
// Each row is a raw CSV row from the Hawaii Capitol export (cells may contain
// HTML). Rows are cleaned (HTML stripped, real bill URL + fields extracted) and
// validated before any DB write.
//
// Behaviour depends on the caller:
//   - No user_id (scraper mode): dedup by (bill_number, year). Existing bills are
//     skipped; new bills are inserted. No tracking connections are made.
//   - user_id present (tracker mode): insert any bills not yet in the DB, then
//     create the organization connection (org_bills row for the user's tenant)
//     for every uploaded bill, so the org tracks them.
router.post('/upload-csv', async (req, res) => {
  try {
    const { rows, user_id } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty rows data' });
    }

    // 1. Clean + validate every row.
    const cleaned = [];
    const invalidRows = [];
    rows.forEach((row, index) => {
      const bill = cleanCsvRow(row);
      const { valid, errors } = validateCleanedBill(bill);
      if (valid) {
        cleaned.push(bill);
      } else {
        invalidRows.push({ index, errors });
      }
    });

    // 2a. Scraper mode — dedup + insert, no tracking connections.
    if (!user_id) {
      let insertedBills = 0;
      let duplicateBills = 0;
      for (const bill of cleaned) {
        const existingId = await findExistingBillId(bill.bill_number, bill.year);
        if (existingId) {
          duplicateBills++;
        } else {
          await insertMinimalBill(bill);
          insertedBills++;
        }
      }
      return res.json({
        mode: 'scrape',
        insertedBills,
        duplicateBills,
        invalidRows,
      });
    }

    // 2b. Tracker mode — resolve the user's org, ensure bills exist, connect them.
    const member = await db
      .selectFrom('members')
      .select('tenant_id')
      .where('user_id', '=', user_id)
      .executeTakeFirst();

    if (!member) {
      return res.status(400).json({ error: 'User is not a member of any organization' });
    }
    const tenantId = member.tenant_id;

    let insertedBills = 0;
    let existingBills = 0;
    let connectionsCreated = 0;
    let connectionsSkipped = 0;

    for (const bill of cleaned) {
      // Ensure the bill exists, capturing its id either way.
      let billId = await findExistingBillId(bill.bill_number, bill.year);
      if (billId) {
        existingBills++;
      } else {
        billId = await insertMinimalBill(bill);
        insertedBills++;
      }

      // Create the org connection if it doesn't already exist.
      const existingConnection = await db
        .selectFrom('org_bills')
        .select('bill_id')
        .where('tenant_id', '=', tenantId)
        .where('bill_id', '=', billId)
        .executeTakeFirst();

      if (existingConnection) {
        connectionsSkipped++;
      } else {
        await db
          .insertInto('org_bills')
          .values({ tenant_id: tenantId, bill_id: billId })
          .execute();
        connectionsCreated++;
      }
    }

    return res.json({
      mode: 'track',
      tenant_id: tenantId,
      insertedBills,
      existingBills,
      connectionsCreated,
      connectionsSkipped,
      invalidRows,
    });
  } catch (error) {
    console.error('Error in upload-csv endpoint:', error);
    res.status(500).json({
      error: 'Failed to process CSV upload',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/update-scraping-stats - Update scraping statistics
router.post('/update-scraping-stats', async (req, res) => {
  try {
    const { billsSaved, success, errorMessage } = req.body;
    
    if (typeof billsSaved !== 'number' || typeof success !== 'boolean') {
      return res.status(400).json({ error: 'Invalid stats data' });
    }

    await updateScrapingStats(billsSaved, success, errorMessage);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in update-scraping-stats endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to update scraping stats',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/scrape-individual
router.post('/scrape-individual', async (req, res) =>{
  try{
    const { classifier } = req.body
    console.log('from url body:', classifier)
    const individualBill = await scrapeIndividual(classifier)
    res.json({ individualBill });
  }catch(error){
    console.log('Error in scrape-individual endpoint:', error);
  }
})

// GET /api/cron-health - Check if cron job has run recently
router.get('/cron-health', async (req, res) => {
  try {
    const latest = await db
      .selectFrom('scraping_stats')
      .select(['last_scrape_time', 'success', 'error_message', 'bills_scraped'])
      .orderBy('last_scrape_time', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!latest) {
      const msg = 'No scraping stats found — cron job may have never run.';
      await sendAlertEmail('No scraping history found', msg);
      return res.json({ healthy: false, reason: msg });
    }

    const hoursSince = (Date.now() - new Date(latest.last_scrape_time).getTime()) / (1000 * 60 * 60);
    const stale = hoursSince > 26;
    const healthy = !stale && latest.success;

    if (stale) {
      await sendAlertEmail('Cron job has not run', [
        `The last scrape was ${hoursSince.toFixed(1)} hours ago (${latest.last_scrape_time}).`,
        `Expected a scrape within the last 26 hours.`,
        '',
        `Last result: success=${latest.success}, bills_scraped=${latest.bills_scraped}`,
        latest.error_message ? `Error: ${latest.error_message}` : '',
      ].join('\n'));
    }

    res.json({
      healthy,
      lastScrapeTime: latest.last_scrape_time,
      hoursSinceLastScrape: Math.round(hoursSince * 10) / 10,
      lastSuccess: latest.success,
      lastBillsScraped: latest.bills_scraped,
      lastError: latest.error_message || null,
    });
  } catch (error) {
    console.error('Error in cron-health endpoint:', error);
    res.status(500).json({
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/all-bills-context
router.get('/all-bills-context', async (req, res) => {
  try {
    const { allBills, foodBills, lastScrapeTime } = await getAllBillsContext();
    res.json({ allBills, foodBills, lastScrapeTime });
  } catch (error) {
    console.error('Error in all-bills-context endpoint:', error);
    res.status(500).json({
      error: 'Failed to get bills context',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;