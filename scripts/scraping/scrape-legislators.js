/* On-demand scraper for the Hawaii Legislature legislators page.
 * Run: node scripts/scraping/scrape-legislators.js
 */
import {
  scrapeLegislators,
  saveLegislators,
} from '../../server/services/scraping/legislators.js';

(async () => {
  try {
    console.log('Scraping legislators...');
    const scraped = await scrapeLegislators();
    const summary = await saveLegislators(scraped);

    console.log('\n--- Summary ---');
    console.log(`Total scraped:  ${summary.total}`);
    console.log(`Inserted:       ${summary.inserted}`);
    console.log(`Updated:        ${summary.updated}`);
    console.log(`Deactivated:    ${summary.deactivated}`);
    console.log(`Failures:       ${summary.failures.length}`);
    for (const f of summary.failures) {
      console.log(`  - ${f.member_id ? `[${f.member_id}] ` : ''}${f.reason}`);
    }

    process.exit(summary.failures.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('Legislator scrape failed:', error.message);
    process.exit(1);
  }
})();
