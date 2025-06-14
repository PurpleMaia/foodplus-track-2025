import fs from 'fs';
import * as cheerio from 'cheerio';

const html = fs.readFileSync('capitol.html', 'utf-8');
const $ = cheerio.load(html);
const bills = [];

    $('table tr').slice(1, 6).each((i, element) => {
    if (i === 0) return; // Skip header row

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
 
console.log(JSON.stringify({ bills }, null, 2))