import { startScraping } from '../server/services/scrapingService.js';

async function main() {
  await startScraping();
}

main().catch((error) => {
  console.error('Error during cron job scraping:', error);
  process.exit(1);
});