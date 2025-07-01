import { chromium } from 'playwright'; // Make sure you're using CJS or adjust for ESM
import fs from 'node:fs';

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Set user-agent in the browser context
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  await page.goto('https://www.capitol.hawaii.gov/advreports/advreport.aspx?year=2025&report=deadline&active=true&rpt_type=&measuretype=hb&title=House%20Bills%20Introduced', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  const html = await page.content();

  fs.writeFileSync('capitol.html', html);
  console.log('✅ HTML saved to capitol.html');

  await browser.close();
})();