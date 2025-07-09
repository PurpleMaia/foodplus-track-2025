import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const router = express.Router();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

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

router.get('/', async (req, res) => {
  try {
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
    
    $('table tr').slice(1, 25).each((i, element) => {
      if (i === 0) return; // skip header row
      
      // <a>
      const billLink = $(element).find('a.report');
      const billUrl = billLink.attr('href');
      const billNumber = billLink.text().trim();
      
      // measureStatus stuff
      const measureStatus = $(element).find('td:nth-child(2) span');
      // const reportTitle = measureStatus.eq(0).text().trim();
      const measureTitle = measureStatus.eq(2).text().trim();
      const description = measureStatus.eq(3).text().trim();

      const companion = null;
      const currentReferral = null;
      



      const currentStatus = $(element).find('td:nth-child(3)').text().trim().replace(/\n\s*/g, ' ');
      const introducers = $(element).find('td:nth-child(4)').text().trim();
      const committeeAssignment = $(element).find('td:nth-child(5)').text().trim();
      // const companion = $(element).find('td:nth-child(6)').text().trim();
      
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
    res.set(corsHeaders).json({ bills });
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

        return res.set(corsHeaders).json({ bills });
      } catch (retryError) {
        return res
          .status(500)
          .set(corsHeaders)
          .json({ error: 'Failed to scrape bills after retry', details: retryError.message });
      }
    }

    res.status(500).set(corsHeaders).json({ error: 'Failed to scrape bills', details: error.message });
  }
});

export default router;
