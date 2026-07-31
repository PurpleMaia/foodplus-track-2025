/* Seeding / on-demand scraper for the Hawaii Legislature committees page.
 *
 * Scrapes every committee (both chambers) plus its chair and vice-chair, and
 * links chairs to `legislators` by the Capitol's member id.
 *
 * Run once per legislative session (chairs change at session start, rarely
 * mid-session) — NOT part of the daily bill cron. Chair changes are reconciled
 * via soft-delete: a replaced chair is retired (kept as history), not deleted.
 *
 * Run: npm run seed:committees   (or: node scripts/scraping/scrape-committees.js)
 *
 * NOTE: chairs link to existing `legislators` rows, so seed those FIRST:
 *   node scripts/scraping/scrape-legislators.js
 * Chairs with no matching legislator row are reported and skipped; the
 * committees themselves still save.
 */
import {
  scrapeCommittees,
  saveCommittees,
} from '../../server/services/scraping/committees.js';

(async () => {
  try {
    console.log('Scraping committees...');
    const scraped = await scrapeCommittees();
    const summary = await saveCommittees(scraped);

    console.log('\n--- Summary ---');
    console.log(`Total scraped:  ${summary.total}`);
    console.log(`Inserted:       ${summary.inserted}`);
    console.log(`Updated:        ${summary.updated}`);
    console.log(`Deactivated:    ${summary.deactivated}`);
    console.log(`Chairs added:   ${summary.chairsChanged}`);
    console.log(`Chairs retired: ${summary.chairsRetired}`);
    console.log(`Failures:       ${summary.failures.length}`);
    for (const f of summary.failures) {
      const tag = [f.acronym, f.member_id].filter(Boolean).join(' ');
      console.log(`  - ${tag ? `[${tag}] ` : ''}${f.reason}`);
    }

    process.exit(summary.failures.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('Committee scrape failed:', error.message);
    process.exit(1);
  }
})();
