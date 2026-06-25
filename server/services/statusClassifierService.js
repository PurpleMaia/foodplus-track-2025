import { OpenAI } from 'openai';
import { sql } from 'kysely';
import { db } from '../../db/kysely/client.js';
import { KANBAN_COLUMNS, COLUMN_INDEX } from '../kanban-columns.js';

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL
});

const SYSTEM_PROMPT = [
  "# Hawaiʻi Bill-Status Classifier",
  "",
  "## 1. Purpose",
  "You are a legislative bill-status classifier for the Hawaii State Legislature.",
  "You will receive: the bill number, its committee assignments (in order), and the ten most-recent status lines (newest first).",
  "Output exactly one status ID from the list below. No extra text.",
  "",
  "---",
  "",
  "## 2. Crossover Detection (CRITICAL — FOLLOW EXACTLY)",
  "The input includes a pre-computed 'Crossover: YES/NO' line. YOU MUST OBEY THIS LINE.",
  "- If 'Crossover: NO' -> the bill is in its originating chamber. You MUST use non-crossover IDs: introduced, scheduled1, deferred1, waiting2, scheduled2, deferred2, waiting3, scheduled3, deferred3.",
  "- If 'Crossover: YES' -> the bill has crossed to the opposite chamber. You MUST use crossover IDs: crossoverWaiting1, crossoverScheduled1, crossoverDeferred1, crossoverWaiting2, crossoverScheduled2, crossoverDeferred2, crossoverWaiting3, crossoverScheduled3, crossoverDeferred3.",
  "- NEVER output a crossover ID when Crossover is NO. NEVER output a non-crossover ID when Crossover is YES.",
  "- The only exceptions are late-stage IDs (passedCommittees, conference*, transmittedGovernor, vetoList, governorSigns, lawWithoutSignature) which apply regardless of crossover.",
  "",
  "---",
  "",
  "## 3. Committee Counting (CRITICAL)",
  "You are given the committee assignment list, e.g., 'Committees (in order): AGR, ECD, FIN'.",
  "Committees are listed in the order the bill must pass through:",
  "- 1st committee in the list = First Committee Hearing",
  "- 2nd committee in the list = Second Committee Hearing",
  "- 3rd committee in the list = Third Committee Hearing",
  "",
  "To determine the hearing number, find which committee is mentioned in the status text and match it to its position in the list.",
  "Example: Committees are 'AGR, ECD, FIN'. Status says 'committee on ECD recommends PASS' -> ECD is 2nd -> 'Waiting to be Scheduled for Second Committee Hearing' (or crossover variant).",
  "Example: Committees are 'AGR, ECD, FIN'. Status says 'referred to FIN' -> FIN is 3rd -> 'Waiting to be Scheduled for Third Committee Hearing'.",
  "",
  "After crossover, the opposite chamber assigns its own committees. Use the committee names in the status text and the referral order to determine position.",
  "Joint committee hearings (e.g., 'ECD/TOU') count as ONE committee slot.",
  "",
  "---",
  "",
  "## 4. What Counts as a Committee Hearing?",
  "Key phrases and their meaning:",
  "- 'Referred to X, Y, Z, referral sheet N' -> Bill introduced and assigned committees -> introduced.",
  "- 'Bill scheduled to be heard by X on ...' -> Hearing is scheduled -> scheduled1/scheduled2/scheduled3 (or crossover variant).",
  "- 'Bill scheduled for decision making on ...' -> This is a scheduled hearing -> scheduled1/scheduled2/scheduled3 (or crossover variant).",
  "- 'The committee on X recommend that the measure be PASSED' -> Committee passed it. Bill advances to next committee -> waiting2/waiting3 (or crossover variant).",
  "- 'The committee on X deferred the measure' or 'committee on X recommend that the measure be DEFERRED' -> deferred1/deferred2/deferred3 (or crossover variant).",
  "- 'Report adopted; referred to Y' or 'Passed Second Reading and referred to Y' -> Prior hearing done. Bill waiting for NEXT committee (Y's position) -> waiting2/waiting3 (or crossover variant).",
  "- 'Reported from X ... recommending passage on Second Reading and referral to Y' -> Same as above, waiting for Y.",
  "- 'Passed Third Reading' and 'Transmitted to [other chamber]' -> crossoverWaiting1.",
  "- 'Received from [chamber]' in the opposite chamber -> Bill just crossed over -> crossoverWaiting1.",
  "- 'Returned from [chamber] in amended form' -> Both chambers have passed it but versions differ. This typically means conference committees are needed.",
  "",
  "---",
  "",
  "## 5. Allowed Status IDs",
  "You MUST output exactly one of these IDs. No other text.",
  "",
  "### Pre-crossover (originating chamber):",
  "| ID              | Meaning                                                    |",
  "| --------------- | ---------------------------------------------------------- |",
  "| introduced      | Introduced / waiting for 1st committee hearing             |",
  "| scheduled1      | Scheduled for 1st committee hearing                        |",
  "| deferred1       | Deferred after 1st committee hearing                       |",
  "| waiting2        | Waiting for 2nd committee hearing                          |",
  "| scheduled2      | Scheduled for 2nd committee hearing                        |",
  "| deferred2       | Deferred after 2nd committee hearing                       |",
  "| waiting3        | Waiting for 3rd committee hearing                          |",
  "| scheduled3      | Scheduled for 3rd committee hearing                        |",
  "| deferred3       | Deferred after 3rd committee hearing                       |",
  "",
  "### Post-crossover (opposite chamber):",
  "| ID                  | Meaning                                                |",
  "| ------------------- | ------------------------------------------------------ |",
  "| crossoverWaiting1   | Crossed over, waiting for 1st committee hearing        |",
  "| crossoverScheduled1 | Scheduled for 1st committee hearing after crossover    |",
  "| crossoverDeferred1  | Deferred after 1st committee hearing after crossover   |",
  "| crossoverWaiting2   | Waiting for 2nd committee hearing after crossover      |",
  "| crossoverScheduled2 | Scheduled for 2nd committee hearing after crossover    |",
  "| crossoverDeferred2  | Deferred after 2nd committee hearing after crossover   |",
  "| crossoverWaiting3   | Waiting for 3rd committee hearing after crossover      |",
  "| crossoverScheduled3 | Scheduled for 3rd committee hearing after crossover    |",
  "| crossoverDeferred3  | Deferred after 3rd committee hearing after crossover   |",
  "",
  "### Late-stage:",
  "| ID                  | Meaning                                                |",
  "| ------------------- | ------------------------------------------------------ |",
  "| passedCommittees    | Passed all committees in both chambers                 |",
  "| conferenceAssigned  | Conference committees assigned                         |",
  "| conferenceScheduled | Conference hearing scheduled                           |",
  "| conferenceDeferred  | Deferred during conference committee                   |",
  "| conferencePassed    | Passed conference committee                            |",
  "| transmittedGovernor | Transmitted to Governor                                |",
  "| vetoList            | Governor's intent to veto                              |",
  "| governorSigns       | Governor signed bill into law                          |",
  "| lawWithoutSignature | Became law without Governor's signature                |",
  "",
  "---",
  "",
  "## 6. Decision Rubric",
  "Follow these steps in order:",
  "",
  "Step 1: GOVERNOR CHECK (highest priority).",
  "- If ANY status line contains 'Act' followed by a number (e.g., 'Act 048', 'Act 137') -> governorSigns. STOP.",
  "- If ANY status line contains 'Became law without' -> lawWithoutSignature. STOP.",
  "- If ANY status line contains 'intent to veto' -> vetoList. STOP.",
  "- If the newest status line says 'Transmitted to Governor' -> transmittedGovernor. STOP.",
  "",
  "Step 2: CONFERENCE CHECK.",
  "- The input includes a pre-computed 'BothChambers: YES/NO' line indicating whether the status log contains updates from BOTH the House (H) and the Senate (S).",
  "- Conference IDs (conferenceAssigned, conferenceScheduled, conferenceDeferred, conferencePassed) may ONLY be used when 'BothChambers: YES'. A bill cannot reach conference without activity in both chambers.",
  "- If 'BothChambers: NO', NEVER output a conference ID, even if the status text mentions the word 'conference'. Instead, classify using the appropriate committee-stage ID.",
  "- If 'BothChambers: YES' AND status mentions conference committee scheduling, deferral, passage, or assignment -> use the matching conference ID.",
  "",
  "Step 3: CROSSOVER CHECK.",
  "- Read the 'Crossover: YES/NO' line from the input. This is pre-computed and authoritative.",
  "- If NO -> use non-crossover IDs (introduced, scheduled1-3, deferred1-3, waiting2-3).",
  "- If YES -> use crossover IDs (crossoverWaiting1-3, crossoverScheduled1-3, crossoverDeferred1-3).",
  "- Do NOT second-guess this field. It is always correct.",
  "",
  "Step 4: COMMITTEE NUMBER.",
  "- Find which committee is mentioned in the status text.",
  "- Match it to the committee assignment list to determine 1st/2nd/3rd.",
  "- Select the appropriate category based on the action (introduced, scheduled, deferred, waiting, passed).",
  "",
  "Step 5: Output exactly one status ID. Nothing else.",
  "",
  "---",
  "",
  "## 7. Few-Shot Examples",
  "(Bill info and status lines are provided newest -> oldest.)",
  "",
  "Example A:",
  "Bill: SB1234 (Originated in Senate)",
  "Committees (in order): AGR, ECD, FIN",
  "S 3/4/2025 Referred to AGR, ECD, FIN, referral sheet 18",
  "-> Crossover check: SB = Senate, chamber = S, same -> NOT crossover",
  "-> Committee: AGR is 1st, but bill was just introduced",
  "= introduced",
  "",
  "Example B:",
  "Bill: SB1234 (Originated in Senate)",
  "Committees (in order): AGR, ECD, FIN",
  "H 3/21/2025 Report adopted; referred to FIN",
  "H 3/19/2025 Committee on ECD recommends PASS WITH AMENDMENTS",
  "-> Crossover check: SB = Senate, chamber = H, different -> CROSSOVER",
  "-> Committee: FIN is 3rd in original list, but after crossover use referral order. ECD passed, now referred to FIN as next committee.",
  "= crossoverWaiting3",
  "",
  "Example C:",
  "Bill: HB1099 HD1 SD1 CD1 (Originated in House)",
  "S Act 048, on 05/14/2025 (Gov. Msg. No. 1148).",
  "-> Governor check: contains 'Act 048' -> STOP",
  "= governorSigns",
  "",
  "Example D:",
  "Bill: HB1060 HD1 (Originated in House)",
  "Committees (in order): EEP, ECD, FIN",
  "H 2/12/2025 Bill scheduled for decision making on Wednesday, 02-12-25 11:00AM",
  "-> Crossover check: HB = House, chamber = H, same -> NOT crossover",
  "-> This is a scheduled hearing. Which committee? Check context for committee name.",
  "= scheduled1",
  "",
  "## 8. No Backward Regression (CRITICAL)",
  "Bills move FORWARD through the legislative process. They do NOT move backward.",
  "The status IDs are ordered by progression (index 0 = earliest stage, higher index = later stage).",
  "The input includes a 'Current status: <statusId> (index N)' line showing the bill's current position.",
  "Your classification MUST have an index >= the current index. A bill at index 5 cannot regress to index 3.",
  "If the status text is ambiguous, keep the bill at its current status rather than moving it backward.",
  "The ONLY exception: 'unassigned' (index 0) has no restriction — any status is valid from unassigned.",
  "",
  "---",
  "",
  "## 9. Output format",
  "Respond with exactly one status ID (e.g., 'introduced', 'waiting2', 'crossoverWaiting1', 'governorSigns').",
  "No extra text, no explanations, no reasoning.",
  "Do not repeat the status log.",
  "",
  "IMPORTANT: The output must be EXACTLY one of the status IDs listed in Section 5. Nothing else.",
].join('\n');

function detectCrossover(billNumber, newestChamber) {
    const prefix = billNumber.trim().substring(0, 2).toUpperCase();
    const originChamber = prefix === 'HB' ? 'H' : prefix === 'SB' ? 'S' : null;
    if (!originChamber) return false;
    return newestChamber.toUpperCase() !== originChamber;
}

/**
 * Enforces monotonic forward progression of bill status.
 * Returns the proposedStatus if it's at or ahead of currentStatus,
 * otherwise returns currentStatus (no regression allowed).
 * Bills at 'unassigned' have no restriction.
 */
function enforceForwardProgression(currentStatus, proposedStatus) {
    if (!currentStatus || currentStatus === 'unassigned') return proposedStatus;

    const currentIndex = COLUMN_INDEX[currentStatus];
    const proposedIndex = COLUMN_INDEX[proposedStatus];

    // If either status is unknown, allow the proposed status through
    if (currentIndex === undefined || proposedIndex === undefined) return proposedStatus;

    if (proposedIndex < currentIndex) {
        console.warn(`[STATUS-AI] Backward regression blocked: "${proposedStatus}" (index ${proposedIndex}) < current "${currentStatus}" (index ${currentIndex}). Keeping current status.`);
        return currentStatus;
    }

    return proposedStatus;
}

async function getContext(billId) {
    console.log('[STATUS-AI] fetching recent status update context...');
    try {
        const bill = await db.selectFrom('bills')
            .select(['bill_number', 'committee_assignment', 'bill_status'])
            .where('id', '=', billId)
            .executeTakeFirst();

        // Lightweight query: distinct chambers across ALL status updates (for pre-computed flags)
        const distinctChambers = await db.selectFrom('status_updates')
            .select('chamber')
            .distinct()
            .where('bill_id', '=', billId)
            .execute();

        // Limited query: only the most recent status lines for LLM context
        const data = await db.selectFrom('status_updates as su')
            .select(['chamber', 'date', 'statustext'])
            .where('bill_id', '=', billId)
            .orderBy(sql`cast(su.date as date)`, 'desc')
            .limit(10)
            .execute();
        console.log('[STATUS-AI] # of status updates (capped at 10):', data.length);
        console.log('[STATUS-AI] current status update:', data[0]);

        const lines = [];

        // Add bill number so LLM knows originating chamber
        if (bill?.bill_number) {
            const prefix = bill.bill_number.trim().substring(0, 2).toUpperCase();
            const chamber = prefix === 'HB' ? 'House' : prefix === 'SB' ? 'Senate' : 'Unknown';
            lines.push(`Bill: ${bill.bill_number} (Originated in ${chamber})`);
        }

        // Add committee assignment so LLM can count committee order
        if (bill?.committee_assignment) {
            lines.push(`Committees (in order): ${bill.committee_assignment}`);
        }

        // Deterministic crossover detection
        if (bill?.bill_number && data.length > 0) {
            const crossed = detectCrossover(bill.bill_number, data[0].chamber);
            console.log('[STATUS-AI] Crossover detected:', crossed, `(bill prefix: ${bill.bill_number.substring(0, 2).toUpperCase()}, newest chamber: ${data[0].chamber.toUpperCase()})`);
            lines.push(`Crossover: ${crossed ? 'YES — bill is now in the opposite chamber. Use crossover status IDs (crossoverWaiting1, crossoverScheduled1, etc.)' : 'NO — bill is still in its originating chamber. Use non-crossover status IDs (introduced, scheduled1, waiting2, etc.)'}`);
        }

        // Deterministic both-chambers detection (uses full history via distinct query)
        const chambers = new Set(distinctChambers.map(row => row.chamber.toUpperCase()));
        const bothChambers = chambers.has('H') && chambers.has('S');
        console.log('[STATUS-AI] BothChambers: ', bothChambers, ' (distinct chambers in history:', Array.from(chambers).join(', '), ')');
        lines.push(`BothChambers: ${bothChambers ? 'YES — status updates exist from both chambers. Conference IDs are eligible.' : 'NO — only one chamber has acted. Conference IDs are NOT allowed.'}`);

        // Include current status so the LLM can respect the no-backward-regression rule
        if (bill?.bill_status) {
            const currentIndex = COLUMN_INDEX[bill.bill_status];
            lines.push(`Current status: ${bill.bill_status} (index ${currentIndex ?? '?'}). Your classification must have an index >= ${currentIndex ?? '?'}.`);
        }

        lines.push('');
        lines.push('Status log (newest first):');

        // Format as tab-separated string, one row per line
        for (const row of data) {
            lines.push(`${row.chamber}\t${row.date}\t${row.statustext}`);
        }

        return lines.join('\n');
    } catch (error) {
        console.log('[STATUS-AI] Error fetching bill\'s status context:', error);
        return null;
    }
}

/**
 * Classify a bill's current kanban status (bill_status enum) using the LLM.
 * Reads the bill's committee assignment + recent status_updates, derives crossover /
 * both-chambers / current-index flags deterministically, asks the LLM for one status ID,
 * then guards against backward regression.
 * @param {string} billId
 * @param {number} [maxRetries=3]
 * @param {number} [retryDelay=1000]
 * @returns {Promise<string|null|undefined>} a BillStatus id, or null/undefined on failure
 */
export async function classifyStatusWithLLM(billId, maxRetries = 3, retryDelay = 1000) {
    const { finalStatus } = await classifyCore(billId, maxRetries, retryDelay);
    return finalStatus;
}

/**
 * Same classification as {@link classifyStatusWithLLM}, but returns the full debug payload
 * (context sent to the LLM, raw model output, mapped enum, whether the forward-progression
 * guard fired, and the final status). Intended for the test/debug harness so the frontend can
 * see exactly what the backend did. Does NOT write anything to the DB.
 * @param {string} billId
 * @param {number} [maxRetries=3]
 * @param {number} [retryDelay=1000]
 * @returns {Promise<ClassifyDebug>}
 */
export async function classifyStatusWithDebug(billId, maxRetries = 3, retryDelay = 1000) {
    return classifyCore(billId, maxRetries, retryDelay);
}

/**
 * @typedef {Object} ClassifyDebug
 * @property {string|null} context - the full context string sent to the LLM
 * @property {string|null} rawOutput - the raw model output (trimmed), before mapping
 * @property {string|undefined} mapped - the mapped BillStatus id, or undefined if unmappable
 * @property {string|null} priorStatus - the bill's bill_status before this classification
 * @property {boolean} guardApplied - true if forward-progression overrode the mapped status
 * @property {string|null|undefined} finalStatus - the status after the guard (what gets written)
 * @property {string|null} note - a human-readable note when classification could not complete
 */

/**
 * Core classifier shared by classifyStatusWithLLM (enum only) and classifyStatusWithDebug
 * (full payload). Behavior is identical to the original single function — it just also
 * surfaces the intermediate values. Never writes to the DB.
 * @returns {Promise<ClassifyDebug>}
 */
async function classifyCore(billId, maxRetries = 3, retryDelay = 1000) {
    console.log("[STATUS-AI] model:", process.env.VLLM || process.env.LLM);
    console.log("[STATUS-AI] classifying bill:", billId.slice(0, 6), '...');

    const base = { context: null, rawOutput: null, mapped: undefined, priorStatus: null, guardApplied: false, finalStatus: null, note: null };

    const context = await getContext(billId);
    base.context = context;
    let attempt = 0;
    console.log('[STATUS-AI] starting classification attempts...');
    while (attempt < maxRetries) {
        try {
            const model = process.env.VLLM || process.env.LLM || '';
            if (!model) {
                console.log('[STATUS-AI] model not found');
                console.error('[STATUS-AI] LLM model not configured. Please set VLLM or LLM environment variable.');
                return { ...base, note: 'LLM model not configured (set VLLM or LLM)' };
            }
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            "Here is the bill's context and status log:",
                            context,
                            "",
                            "Classify this bill's current status. Respond with only the status ID.",
                            " /no_think"
                        ].join("\n")
                    }
                ],
                temperature: 0.0
            });

            if (!response || !response.choices[0].message.content || !response.choices || !response.choices[0].message) {
                console.log('[STATUS-AI] response not found');
                return { ...base, note: 'No response from LLM' };
            }

            const classification = response.choices[0].message.content.trim();
            console.log("[STATUS-AI] Classification:", classification);
            base.rawOutput = classification;
            const mappedStatus = mapToColumnID(classification);
            console.log("[STATUS-AI] Mapped:", mappedStatus);
            base.mapped = mappedStatus;

            if (!mappedStatus) {
                return { ...base, finalStatus: mappedStatus, note: `Model output "${classification}" did not map to a known status ID` };
            }

            // Deterministic guard: prevent backward regression
            const currentBill = await db.selectFrom('bills')
                .select('bill_status')
                .where('id', '=', billId)
                .executeTakeFirst();
            base.priorStatus = currentBill?.bill_status ?? null;

            const newStatus = enforceForwardProgression(currentBill?.bill_status, mappedStatus);
            if (newStatus !== mappedStatus) {
                base.guardApplied = true;
                console.log(`[STATUS-AI] Final status after guard: ${newStatus} (LLM proposed: ${mappedStatus})`);
            }

            return { ...base, finalStatus: newStatus };
        } catch (error) {
            const err = error;
            const status = err?.response?.status || err?.status;
            const message = typeof err?.message === 'string' ? err.message : String(err);

            // Retry on HTTP 524 (Cloudflare), ETIMEDOUT, or generic timeout message
            const isTimeout =
                status === 524 ||
                err?.code === 'ETIMEDOUT' ||
                message.toLowerCase().includes('timeout');

            if (isTimeout) {
                attempt++;
                if (attempt < maxRetries) {
                    console.warn(`[STATUS-AI] Timeout encountered. Retrying attempt ${attempt + 1} after ${retryDelay}ms...`);
                    await new Promise(res => setTimeout(res, retryDelay));
                    continue;
                }
            }
            console.error(`[STATUS-AI] Error:`, message);
            return { ...base, note: `Error: ${message}` };
        }
    }
    return { ...base, note: 'Exhausted retries' };
}

const VALID_STATUS_IDS = new Set(KANBAN_COLUMNS.map(col => col.id));

function mapToColumnID(classification) {
    const id = classification.trim();
    // Direct ID match (v3+ prompt outputs IDs directly)
    if (VALID_STATUS_IDS.has(id)) return id;
    // Fallback: title match (backwards compatibility)
    const col = KANBAN_COLUMNS.find(col => col.title.trim().toLowerCase() === id.toLowerCase());
    return col ? col.id : undefined;
}
