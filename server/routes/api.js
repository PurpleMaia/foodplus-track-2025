import { Router } from 'express';
import { main, updateScrapingStats } from '../services/scrapingService.js';
import { saveBills } from '../services/scraping/all-bills.js';
import { scrapeIndividual } from '../services/scraping/individual-bill.js';
import { getAllBillsContext } from '../services/bills.js';
import { db } from '../../db/kysely/client.js';
import { sendAlertEmail } from '../services/notifications/cron-alerts.js';
import { listFixtures } from '../services/__fixtures__/classifier/index.js';
import { seedBefore, injectAfter, resetHarness } from '../services/classifierTestService.js';
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
    
    const { billIds } = await saveBills(bills);
    res.json({ successCount: billIds.length });
  } catch (error) {
    console.error('Error in save-bills endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to save bills',
      details: error instanceof Error ? error.message : 'Unknown error'
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

// ── Classifier test/debug harness ──────────────────────────────────────────
// Deterministic before→after experiment against classifyStatusWithLLM using curated
// fixtures, plus the change→notification email path. Operates only on throwaway
// test:// bill rows — see classifierTestService.js.

// GET /api/classifier-test/fixtures - list available fixtures for the dropdown
router.get('/classifier-test/fixtures', async (req, res) => {
  try {
    res.json({ fixtures: listFixtures() });
  } catch (error) {
    console.error('Error in classifier-test/fixtures endpoint:', error);
    res.status(500).json({ error: 'Failed to list fixtures', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/classifier-test/seed-before - seed "before" state and classify
router.post('/classifier-test/seed-before', async (req, res) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required' });
    const result = await seedBefore(fixtureId);
    res.json(result);
  } catch (error) {
    console.error('Error in classifier-test/seed-before endpoint:', error);
    res.status(500).json({ error: 'Failed to seed before state', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/classifier-test/inject-after - inject new update, re-classify, send notification
router.post('/classifier-test/inject-after', async (req, res) => {
  try {
    const { fixtureId, email } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required' });
    const result = await injectAfter(fixtureId, email);
    res.json(result);
  } catch (error) {
    console.error('Error in classifier-test/inject-after endpoint:', error);
    res.status(500).json({ error: 'Failed to inject after state', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// POST /api/classifier-test/reset - delete throwaway harness bill(s)
router.post('/classifier-test/reset', async (req, res) => {
  try {
    const { fixtureId } = req.body || {};
    const result = await resetHarness(fixtureId);
    res.json(result);
  } catch (error) {
    console.error('Error in classifier-test/reset endpoint:', error);
    res.status(500).json({ error: 'Failed to reset harness', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;