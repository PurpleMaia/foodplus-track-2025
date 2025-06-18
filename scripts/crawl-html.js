import fs from 'fs';
import * as cheerio from 'cheerio';

const html = fs.readFileSync('capitol.html', 'utf-8');
const $ = cheerio.load(html);
const bills = [];

    $('table tr').slice(1, 4).each((i, element) => {
    if (i === 0) return; // Skip header row

    // <a>
    const billLink = $(element).find('a.report');
    const billUrl = billLink.attr('href');
    const billNumber = billLink.text().trim();
    
    // measureStatus stuff
    const measureStatus = $(element).find('td:nth-child(2) span');
    const reportTitle = measureStatus.eq(0).text().trim();
    const measureTitle = measureStatus.eq(2).text().trim();
    const description = measureStatus.eq(3).text().trim();

    const currentStatus = $(element).find('td:nth-child(3)').text().trim().replace(/\n\s*/g, ' ');
    const introducers = $(element).find('td:nth-child(4)').text().trim();
    const committeeAssignment = $(element).find('td:nth-child(5)').text().trim();
    // const companion = $(element).find('td:nth-child(6)').text().trim();

    if (billUrl) {
        bills.push({
        bill_url: billUrl,
        bill_number: billNumber,
        report_title: reportTitle,
        measure_title: measureTitle,
        description: description,
        current_status: currentStatus,
        introducers: introducers,
        committee_assignment: committeeAssignment,
        // companion: companion,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        });
    }
   
    });      
 
console.log(JSON.stringify({ bills }, null, 2))