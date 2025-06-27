

import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

// 1. Read the JSON file
const raw = readFileSync('./hawaii-data-test.html');

// // 2. Parse JSON (if it's stored as a stringified object with HTML content)
// const parsed = JSON.parse(raw);

// // 3. Get the HTML content — adjust key if needed
// const rawHtml = parsed.html || parsed; // fallback if file is just a raw string

// 4. Load HTML into Cheerio
const $ = cheerio.load(raw);

$('span').each((i, el) => {
    const id = $(el).attr('id');
    const text = $(el).text().trim();
    if (id) {
      console.log(`🆔 ${id} => ${text}`);
    }
  });

// 5. Extract introducers
const introducers = $('#ctl00_MainContent_ListView1_ctrl0_introducerLabel').text().trim();
const billTitle = $('#ctl00_MainContent_ListView1_ctrl0_titleLabel').text().trim();
const currentReferral = $('#ctl00_MainContent_ListView1_ctrl0_current_referralLabel').text().trim();
const currentStatus = $('#ctl00_MainContent_ListView1_ctrl0_statusLabel').text().trim();
const description = $('#ctl00_MainContent_ListView1_ctrl0_descriptionLabel').text().trim();
const measureType = $('#ctl00_MainContent_ListView1_ctrl0_measuretypeLabel').text().trim();
const contentOfStatusText = $('#ctl00_MainContent_UpdatePanel1').text().trim();


console.log('✅ Introducers:', introducers || '[Not found]');
console.log('✅ billTitle:', billTitle || '[Not found]');
console.log('✅ currentReferals:', currentReferral || '[Not found]');
console.log('✅ Current status:', currentStatus || '[Not found]');
console.log('✅ desccription:', description || '[Not found]');
console.log('✅ measureType:', measureType || '[Not found]');
// console.log('✅ Introduced date:', contentOfStatusText || '[Not found]');



console.log('📜 HISTORY — Filtered for "Introduced":');

// Loop over each <tr> in the status table
$('#ctl00_MainContent_GridViewStatus tr').each((i, row) => {
  const tds = $(row).find('td');
  if (tds.length === 3) {
    const date = $(tds[0]).text().trim();
    const statusText = $(tds[2]).text().trim();
    console.log(`✅ ${date} — ${statusText}`)
    // if (statusText.toLowerCase().includes('introduc')) {
    //   console.log(`✅ ${date} — ${statusText}`);
    // }
  }
});
