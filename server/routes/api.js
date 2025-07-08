import { Router } from 'express';
import { startScraping, saveBills, updateScrapingStats, scrapeIndividual } from '../services/scrapingService.js';
const router = Router();

// GET /api/scrape-bills - Start scraping process
router.get('/scrape-bills', async (req, res) => {
  try {
    const result = await startScraping();
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
router.get('/scrape-individual', async (req, res) =>{
  try{
    const individualBill = await scrapeIndividual()
    res.json({ individualBill });
  }catch(error){
    console.log('Error in scrape-individual endpoint:', error);
  }
})
export default router;
