/* Bill fetching function for the frontend of this application (not bill-tracker) */

import { db } from '../../db/kysely/client.js';
const BILL_SELECT_FIELDS = [
  'id',
  'bill_url',
  'bill_number',
  'bill_title',
  'current_status_string',
  'committee_assignment',
  'description',
  'introducer',
  'created_at',
  'updated_at',
  'food_related'
];
export async function getAllBillsContext() {

    const [allBills, foodBills, lastScrapeTime] = await Promise.all([
        db.selectFrom('bills').select(BILL_SELECT_FIELDS).execute(),
        db.selectFrom('bills').select(BILL_SELECT_FIELDS).where('food_related', '=', true).execute(),
        db.selectFrom('scraping_stats').select('last_scrape_time').orderBy('last_scrape_time', 'desc').limit(1).executeTakeFirst()
    ]);
    
    console.log('[SERVICE] Fetched', allBills.length, 'total bills and', foodBills.length, 'food-related bills');
    console.log('[SERVICE] Last scrape time:', lastScrapeTime?.last_scrape_time || 'N/A');

    return { allBills, foodBills, lastScrapeTime: lastScrapeTime?.last_scrape_time || null };
}