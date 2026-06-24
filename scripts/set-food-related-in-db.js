// note: using this script to update all bills in the database with the AI determination of food-related or not
// DO NOT USE AFTER

import { db } from '../db/kysely/client.js';
import { determineIfFoodRelated } from '../server/services/llmService.js';

const BATCH_SIZE = 4;
const DELAY = 1000;


async function main() {
    const bills = await db.selectFrom('bills').selectAll().execute();


    // Pause execution for a given time
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < bills.length; i += BATCH_SIZE) {
        // iterate and process 4 bills at a time
        const batch = bills.slice(i, i + BATCH_SIZE);

        // define promise function to happen each time
        const batchPromises = batch.map(async (bill) => {
            const isFoodRelated = await determineIfFoodRelated(bill.bill_title, bill.description || '');
            if (isFoodRelated !== null) {
                await db.updateTable('bills')
                    .set({ food_related: isFoodRelated })
                    .where('id', '=', bill.id)
                    .execute();
                console.log(`[BILL UPDATE] Updated bill ID ${bill.id} - Food Related: ${isFoodRelated}`);
            } else {
                console.log(`[BILL UPDATE] Could not determine food-related status for bill ID ${bill.id}`);
            }
        });

        // wait for all defined promises in the batch to complete
        await Promise.all(batchPromises);

        console.log(`Completed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(bills.length / BATCH_SIZE)}`);

        // Delay before processing the next batch
        if (i + BATCH_SIZE < bills.length) {
            await sleep(DELAY);
        }
    }

    console.log(`[DONE] Finished processing ${bills.length} bills.`);
}

main().catch((error) => {
    console.error('Error updating food-related status:', error);
    process.exit(1);
});