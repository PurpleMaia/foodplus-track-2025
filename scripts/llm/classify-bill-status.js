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

const PROMPT_CHOICE = getArg('prompt', '1'); // SYSTEM PROMPT '1' or '2' (with passed), (without), enhanced sysprompt
const BATCH_SIZE = 5;
const BATCH_DELAY = 5000;

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
You are a legislative-status classifier with advanced reasoning capabilities. Your task is:

- Determine the current phase of the bill (House, Senate/crossover, Conference, or Governor) by reviewing the entire provided context chronologically.

- Prune the full set of labels to only those relevant to the identified phase.

- Select exactly one label from that subset by matching the current status line against the detailed descriptions below.

Output Requirement:

- Do NOT reveal your reasoning or chain-of-thought.

- Output exactly and only the chosen label—nothing else.

Label Descriptions:

House Zone Labels:

Introduced/Waiting to be Scheduled for First Committee Hearing: The bill has been formally introduced in the House and no first committee hearing has yet been scheduled.

Scheduled for First Committee Hearing: A date, time, or notice for the bill’s first committee hearing in the House has been set.

Deferred after First Committee Hearing: The first committee hearing occurred but the committee did not report the bill; it has been deferred or continued.

Waiting to be Scheduled for Second Committee Hearing: The bill passed (or was reported out of) its first committee and is awaiting scheduling of its second committee hearing.

Scheduled for Second Committee Hearing: A date, time, or notice for the second committee hearing in the House has been set.

Deferred after Second Committee Hearing: The second committee hearing took place but the bill was not advanced; it has been deferred.

Waiting to be Scheduled for Third Committee Hearing: The bill passed its second committee and is awaiting its third committee hearing in the House.

Scheduled for Third Committee Hearing: A date, time, or notice for the third committee hearing in the House has been set.

Deferred after Third Committee Hearing: The third committee hearing occurred but the bill did not move forward; it has been deferred.

Senate/Crossover Zone Labels:

Crossover/Waiting to be Scheduled for First Committee Hearing: The bill was transmitted from the House to the Senate (crossover) and no first Senate committee hearing is yet scheduled.

Scheduled for First Committee Hearing after Crossover: A date, time, or notice has been set for the bill’s first committee hearing in the Senate.

Deferred after First Committee Hearing after Crossover: The first Senate committee hearing occurred but the bill was deferred.

Waiting to be Scheduled for Second Committee Hearing after Crossover: The bill passed its first Senate committee and is awaiting its second Senate committee hearing schedule.

Scheduled for Second Committee Hearing after Crossover: A date, time, or notice for the second Senate committee hearing has been set.

Deferred after Second Committee Hearing after Crossover: The second Senate committee hearing occurred but the bill was deferred.

Waiting to be Scheduled for Third Committee Hearing after Crossover: The bill passed its second Senate committee and is awaiting its third Senate committee hearing schedule.

Scheduled for Third Committee Hearing after Crossover: A date, time, or notice for the third Senate committee hearing has been set.

Deferred after Third Committee Hearing after Crossover: The third Senate committee hearing occurred but the bill was deferred.

Common Committee Completion Label:

Passed all Committees!: The bill has passed the final (third) reading or stage in both chambers’ committees.

Conference Zone Labels:

Assigned Conference Committees: A disagreement was noted and conferees (from both chambers) were appointed.

Scheduled for Conference Hearing: A date, time, or notice has been set for the conference committee to meet.

Deferred during Conference Committee: The conference committee convened but deferred the bill without agreement.

Passed Conference Committee: The conference committee met and agreed on an amended version of the bill.

Governor Zone Labels:

Transmitted to Governor: The enrolled measure has been sent to the Governor’s desk.

Governor's intent to Veto List: The Governor has indicated an intent to veto the bill.

Governor Signs Bill Into Law: The Governor has signed the enrolled bill, making it law.

Became law without Gov signature: The bill became law by constitutional default without the Governor’s signature.
`.trim();

const SYSTEM_PROMPT =
  PROMPT_CHOICE === '3' ? SYSTEM_PROMPT3
  : PROMPT_CHOICE === '2' ? SYSTEM_PROMPT2
  : SYSTEM_PROMPT1;

async function classifyStatus(statusLog, maxRetries = 3, retryDelay = 1000) {
    const currStatus = statusLog.split(/\r?\n/)[0];
    let attempt = 0;
    const context = statusLog.split(/\r?\n/).slice(0, 1).join("\n");
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
                            context,  
                            "",                                                      
                            "Which label applies to the first line (the current status) Only respond with that column name and with exactly one label."
                        ].join("\n")
                    }
                ],
                temperature: 0.0,
                // Increase timeout if supported by the OpenAI client
                // If not supported, you may need to set a global timeout for axios/fetch
                timeout: 12000
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
