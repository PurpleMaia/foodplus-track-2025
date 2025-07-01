import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs'
import path from 'path'
import { OpenAI } from 'openai';

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
    const arg = args.find(a => a.startsWith(`--${flag}=`));
    if (arg) return arg.split('=')[1];
    return defaultValue;
}

const PROMPT_CHOICE = getArg('prompt', '1'); // SYSTEM PROMPT '1' or '2' (with passed), (without)
const BATCH_SIZE = 5;
const BATCH_DELAY = 2000;

const client = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
    baseURL: process.env.OPENAI_BASE_URL
});

const SYSTEM_PROMPT1 = `
You are a bill-status classifier. You must choose exactly one of these labels—nothing else:
Introduced/Waiting to be Scheduled for First Committee Hearing
Scheduled for First Committee Hearing
Deferred after First Committee Hearing
Waiting to be Scheduled for Second Committee Hearing
Scheduled for Second Committee Hearing
Deferred after Second Committee Hearing
Waiting to be Scheduled for Third Committee Hearing
Scheduled for Third Committee Hearing
Deferred after Third Committee Hearing
Crossover/Waiting to be Scheduled for First Committee Hearing
Scheduled for First Committee Hearing after Crossover
Deferred after First Committee Hearing after Crossover
Waiting to be Scheduled for Second Committee Hearing after Crossover
Scheduled for Second Committee Hearing after Crossover
Deferred after Second Committee Hearing after Crossover
Waiting to be Scheduled for Third Committee Hearing after Crossover
Scheduled for Third Committee Hearing after Crossover
Deferred after Third Committee Hearing after Crossover
Passed all Committees!
Assigned Conference Committees
Scheduled for Conference Hearing
Deferred during Conference Committee
Passed Conference Committee
Transmitted to Governor
Governor's intent to Veto List
Governor Signs Bill Into Law
Became law without Gov signature
Only output exactly one of those labels, with no extra text.
`.trim();

const SYSTEM_PROMPT2 = `
You are a bill-status classifier. You must choose exactly one of these labels—nothing else:
Introduced/Waiting to be Scheduled for First Committee Hearing
Scheduled for First Committee Hearing
Deferred after First Committee Hearing
Waiting to be Scheduled for Second Committee Hearing
Scheduled for Second Committee Hearing
Deferred after Second Committee Hearing
Waiting to be Scheduled for Third Committee Hearing
Scheduled for Third Committee Hearing
Deferred after Third Committee Hearing
Crossover/Waiting to be Scheduled for First Committee Hearing
Scheduled for First Committee Hearing after Crossover
Deferred after First Committee Hearing after Crossover
Waiting to be Scheduled for Second Committee Hearing after Crossover
Scheduled for Second Committee Hearing after Crossover
Deferred after Second Committee Hearing after Crossover
Waiting to be Scheduled for Third Committee Hearing after Crossover
Scheduled for Third Committee Hearing after Crossover
Deferred after Third Committee Hearing after Crossover
Assigned Conference Committees
Scheduled for Conference Hearing
Deferred during Conference Committee
Passed Conference Committee
Transmitted to Governor
Governor's intent to Veto List
Governor Signs Bill Into Law
Became law without Gov signature
Only output exactly one of those labels, with no extra text.
`.trim();

const SYSTEM_PROMPT3 = `
You are a bill-status classifier. You must choose exactly one of these labels—nothing else. Here are the labels and what they mean:

• Introduced/Waiting to be Scheduled for First Committee Hearing  
   – The bill has just been introduced in the originating chamber and no committee hearing is yet scheduled.

• Scheduled for First Committee Hearing  
   – A date has been set for the bill’s first committee hearing in the current chamber.

• Deferred after First Committee Hearing  
   – A first committee hearing was scheduled but no favorable report or passage followed, indicating deferral.

• Waiting to be Scheduled for Second Committee Hearing  
   – The bill passed or was reported from the first committee, and the second committee hearing has not yet been scheduled.

• Scheduled for Second Committee Hearing  
   – A date has been set for the second committee hearing.

• Deferred after Second Committee Hearing  
   – The second committee hearing was scheduled but no report or passage followed, indicating deferral.

• Waiting to be Scheduled for Third Committee Hearing  
   – The bill passed the second committee, and the third committee hearing has not yet been scheduled.

• Scheduled for Third Committee Hearing  
   – A date has been set for the third committee hearing.

• Deferred after Third Committee Hearing  
   – The third committee hearing was scheduled but no report or passage followed, indicating deferral.

• Crossover/Waiting to be Scheduled for First Committee Hearing  
    – The bill has passed the originating chamber and been transmitted to the other chamber, and no committee hearing is yet scheduled there.

• Scheduled for First Committee Hearing after Crossover  
    – A date has been set for the bill’s first committee hearing in the new chamber after crossover.

• Deferred after First Committee Hearing after Crossover  
    – That first hearing in the new chamber was scheduled but no report or passage followed, indicating deferral.

• Waiting to be Scheduled for Second Committee Hearing after Crossover  
    – The bill passed or was reported from its first committee after crossover, and the second hearing has not yet been scheduled.

• Scheduled for Second Committee Hearing after Crossover  
    – A date has been set for the second committee hearing in the new chamber after crossover.

• Deferred after Second Committee Hearing after Crossover  
    – The second hearing after crossover was scheduled but no report/passage followed, indicating deferral.

• Waiting to be Scheduled for Third Committee Hearing after Crossover  
    – The bill passed the second committee after crossover, and the third hearing has not yet been scheduled.

• Scheduled for Third Committee Hearing after Crossover  
    – A date has been set for the third committee hearing after crossover.

• Deferred after Third Committee Hearing after Crossover  
    – The third hearing after crossover was scheduled but no report/passage followed, indicating deferral.

• Passed House and Senate Committees!  
    – After crossover, the bill has successfully passed the final reading, NOT the conference committee.

• Assigned Conference Committees  
    – Conferees have been appointed and a conference committee has been convened.

• Scheduled for Conference Hearing  
    – A date has been set for the conference committee hearing.

• Deferred during Conference Committee  
    – A conference hearing was scheduled but no conference report followed, indicating deferral.

• Passed Conference Committee  
    – The Conference Committee has issued a report recommending the measure be passed.

• Transmitted to Governor  
    – The enrolled bill has been sent to the Governor for consideration.

• Governor’s intent to Veto List  
    – The Governor has formally indicated intent to veto the bill.

• Governor Signs Bill Into Law  
    – The Governor has signed the bill into law.

• Became law without Gov signature  
    – The bill became law without the Governor’s signature (e.g., by default).

Always review the status entries in strict chronological order and base your label solely on the *last* relevant status action. Do NOT consider earlier steps once a later phase (e.g. crossover or conference) has begun.  

ONLY respond with exactly one of the 27 labels above, with no additional text.  
`.trim();

const SYSTEM_PROMPT =
  PROMPT_CHOICE === '3' ? SYSTEM_PROMPT3
  : PROMPT_CHOICE === '2' ? SYSTEM_PROMPT2
  : SYSTEM_PROMPT1;

async function classifyStatus(statusLog, maxRetries = 3, retryDelay = 1000) {
    const currStatus = statusLog.split(/\r?\n/)[0];
    let attempt = 0;
    // const context = statusLog.split(/\r?\n/).slice(0, 1).join("\n");
    while (attempt < maxRetries) {
        try {
            const response = await client.chat.completions.create({
                model: process.env.MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            "Here is the bill's status log so far (oldest first):",
                            statusLog,
                            "Here is the current status of the bill:",
                            currStatus,
                            "",
                            "Which of the defined labels does this bill's current status belong to? Only respond with that column name."
                        ].join("\n")
                    }
                ],
                temperature: 0.0,
                // Increase timeout if supported by the OpenAI client
                // If not supported, you may need to set a global timeout for axios/fetch
                timeout: 120000 // 2 minutes
            });
            const classification = response.choices[0].message.content.trim();
            console.log("Current Status:", currStatus);
            console.log("Classification:", classification);
            console.log("--------------------------------")
            return classification;
        } catch (error) {
            // Check for 524 error (Cloudflare timeout)
            const status = error?.response?.status || error?.status;
            if (status === 524) {
                attempt++;
                if (attempt < maxRetries) {
                    console.warn(`524 Timeout error encountered. Retrying attempt ${attempt + 1} after ${retryDelay}ms...`);
                    await new Promise(res => setTimeout(res, retryDelay));
                    continue;
                }
            }
            console.error(`Error:`, error.message);
            return null;
        }
    }
}

async function runAutomatedTesting() {
    let statusLog = fs.readFileSync('scripts/llm/status-log.txt', 'utf-8');
    const originalLines = statusLog.split(/\r?\n/).filter(line => line.trim());
    
    console.log(`Starting automated testing with ${originalLines.length} lines...`);
    
    const allTests = [];
    
    // Prepare all tests
    for (let i = 0; i < originalLines.length; i++) {
        const currentLines = originalLines.slice(i); // Remove top i lines
        const currentStatusLog = currentLines.join('\n');
        
        if (currentLines.length === 0) break;
        
        allTests.push({ statusLog: currentStatusLog });
    }
    
    console.log(`Total tests to run: ${allTests.length}`);
    
    // Split tests into batches
    const batches = [];
    for (let i = 0; i < allTests.length; i += BATCH_SIZE) {
        batches.push(allTests.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Running in ${batches.length} batches of ${BATCH_SIZE} tests each (prompt: ${PROMPT_CHOICE})`);
    
    // Run batches sequentially with delays
    const allResults = [];
    for (let i = 0; i < batches.length; i++) {
        const batchResults = await runBatchTests(batches[i], i + 1);
        allResults.push(...batchResults);
        
        // Add delay between batches (except for the last batch)
        if (i < batches.length - 1) {
            console.log(`Waiting ${BATCH_DELAY}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }
    
    // Save results to file
    const resultsFile = 'scripts/llm/classification-results.json';
    fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
    
    console.log(`\n=== Automated testing completed ===`);
    console.log(`Results saved to: ${resultsFile}`);
    console.log(`Total tests completed: ${allResults.length}`);
    
    // Print summary
    const successfulTests = allResults.filter(r => r.classification !== null);
    const failedTests = allResults.filter(r => r.classification === null);
    
    console.log(`Successful tests: ${successfulTests.length}`);
    console.log(`Failed tests: ${failedTests.length}`);
    
    console.log("\n=== Automated testing completed ===");
}

async function runBatchTests(batch, batchNumber) {
    console.log(`\n--- Starting Batch ${batchNumber} with ${batch.length} tests ---`);
    
    const batchPromises = batch.map(({ statusLog }) => classifyStatus(statusLog));
    
    const results = await Promise.all(batchPromises);
    
    console.log(`--- Completed Batch ${batchNumber} ---`);
    return results;
}

// Run the automated testing
runAutomatedTesting().catch(console.error);
