import axios from 'npm:axios@1.6.7';
import * as cheerio from 'npm:cheerio@1.0.0-rc.12';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// List of user agents to rotate through
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
];

const getRandomUserAgent = () => {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Define the URL outside the try block so it's accessible everywhere
const SCRAPING_URL = 'https://data.capitol.hawaii.gov/advreports/advreport.aspx?year=2025&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20Introduced';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Add a small delay to avoid overwhelming the server
    await delay(1000);
    
    const response = await axios.get(SCRAPING_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://data.capitol.hawaii.gov',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 30000,
      maxRedirects: 5
    });

    console.log('Status:', response.status);

    const $ = cheerio.load(response.data);
    const bills = [];

    $('table tr').each((i, element) => {
      if (i === 0) return; // Skip header row

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

      return i < 25; // Reduced limit to 25 bills to avoid overloading
    });

    return new Response(
      JSON.stringify({ bills }),
      { 
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  } catch (error) {
    console.error('Error scraping bills:', error);
    
    // Add retry logic for 403 errors
    if (error.response?.status === 403) {
      try {
        // Wait 2 seconds before retrying
        await delay(2000);
        
        // Retry the request with a different user agent
        const retryResponse = await axios.get(SCRAPING_URL, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.capitol.hawaii.gov'
          }
        });
        
        const $ = cheerio.load(retryResponse.data);
        const bills = [];
        
        $('table tr').each((i, element) => {
          if (i === 0 || i > 25) return; // Skip header row and limit to 25
          
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
        
        return new Response(
          JSON.stringify({ bills }),
          { 
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      } catch (retryError) {
        return new Response(
          JSON.stringify({ 
            error: 'Failed to scrape bills after retry',
            details: retryError.message
          }),
          { 
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      }
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to scrape bills',
        details: error.message
      }),
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  }
});