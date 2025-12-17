import { Router } from 'express';
import { main, saveBills, updateScrapingStats, scrapeIndividual } from '../services/scrapingService.js';
import { getAllBillsContext } from '../services/bills.js';
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
export default router;

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