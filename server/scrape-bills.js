import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';

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
  'https://www.capitol.hawaii.gov/advreports/advreport.aspx?year=2025&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20Introduced';

router.get('/', async (req, res) => {
  try {
    await delay(1000);

    const response = await axios.get(SCRAPING_URL, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        Accept: 'text/html',
        Referer: 'https://www.capitol.hawaii.gov',
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);
    const bills = [];

    $('table tr').each((i, element) => {
      if (i === 0) return; // skip header row

      const billLink = $(element).find('td:nth-child(1) a');
      const billUrl = billLink.attr('href');
      const billNumber = billLink.text().trim();
      const measureStatus = $(element).find('td:nth-child(2)').text().trim();
      const currentStatus = $(element).find('td:nth-child(3)').text().trim();

      if (billUrl) {
        bills.push({
          bill_url: `https://www.capitol.hawaii.gov${billUrl}`,
          bill_number: billNumber,
          description: measureStatus,
          current_status: currentStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      return i < 25;
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
            Referer: 'https://www.capitol.hawaii.gov',
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
              bill_url: `https://www.capitol.hawaii.gov${billUrl}`,
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
