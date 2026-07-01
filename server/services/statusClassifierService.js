import { sql } from 'kysely';
import { db } from '../../db/kysely/client.js';
import { COLUMN_INDEX } from '../kanban-columns.js';
import { classifyStatus } from './statusClassifier.js';

/**
 * Bill-status classification service.
 *
 * As of 2026-06-30 this is a DETERMINISTIC pattern-table classifier (see
 * ./statusClassifier.js and docs/bill-status-pattern-table.md) — no LLM. The exported function
 * names are kept for backward compatibility with existing callers (scrape path + debug harness).
 * All work is deterministic: fetch the bill's status_updates, run the pure classifier, and write
 * the resulting enum. No network, no OpenAI, no retries needed.
 */

/**
 * Fetch a bill's row + its status_updates (newest first) for the classifier.
 * @param {string} billId
 * @returns {Promise<{ bill: any, statusUpdates: Array<{chamber:string,date:string,statustext:string}> } | null>}
 */
async function fetchBillContext(billId) {
    try {
        const bill = await db.selectFrom('bills')
            .select(['bill_number', 'committee_assignment', 'bill_status'])
            .where('id', '=', billId)
            .executeTakeFirst();

        const statusUpdates = await db.selectFrom('status_updates as su')
            .select(['chamber', 'date', 'statustext'])
            .where('bill_id', '=', billId)
            .orderBy(sql`cast(su.date as date)`, 'desc')
            .orderBy('statustext', 'asc') // stable tiebreaker for same-date rows
            .execute();

        return { bill, statusUpdates };
    } catch (error) {
        console.log('[STATUS] Error fetching bill status context:', error);
        return null;
    }
}

/**
 * Classify a bill's current kanban status (bill_status enum) deterministically.
 * Reads the bill's status_updates, runs the pattern-table classifier (which folds in crossover /
 * committee-order / both-chambers context and enforces no-backward-regression against the bill's
 * current status), and returns the resulting enum.
 * @param {string} billId
 * @returns {Promise<string|null>} a BillStatus id, or null on failure / no classification
 */
export async function classifyStatusWithLLM(billId) {
    const { finalStatus } = await classifyCore(billId);
    return finalStatus;
}

/**
 * Same classification as {@link classifyStatusWithLLM}, but returns the full debug payload so the
 * test/debug harness can see exactly what the classifier did. Does NOT write anything to the DB.
 * @param {string} billId
 * @returns {Promise<ClassifyDebug>}
 */
export async function classifyStatusWithDebug(billId) {
    return classifyCore(billId);
}

/**
 * @typedef {Object} ClassifyDebug
 * @property {string|null} context - human-readable summary of the status log the classifier saw
 * @property {string|null} rawOutput - the classifier's raw stage before the regression guard
 * @property {string|undefined} mapped - the mapped BillStatus id (same as rawOutput here)
 * @property {string|null} priorStatus - the bill's bill_status before this classification
 * @property {boolean} guardApplied - true if forward-progression overrode the classified status
 * @property {string|null} finalStatus - the status after the guard (what gets written)
 * @property {string[]} unmatched - status lines that matched no rule (maintenance backlog)
 * @property {boolean} dead - whether a terminal "failed" line was detected
 * @property {string|null} note - a human-readable note when classification could not complete
 */

/**
 * Core classifier shared by classifyStatusWithLLM (enum only) and classifyStatusWithDebug
 * (full payload). Deterministic; never writes to the DB.
 * @param {string} billId
 * @returns {Promise<ClassifyDebug>}
 */
async function classifyCore(billId) {
    console.log('[STATUS] classifying bill (deterministic):', billId.slice(0, 6), '...');

    const base = {
        context: null, rawOutput: null, mapped: undefined, priorStatus: null,
        guardApplied: false, finalStatus: null, unmatched: [], dead: false, note: null,
    };

    const ctx = await fetchBillContext(billId);
    if (!ctx) return { ...base, note: 'Failed to fetch bill status context' };

    const { bill, statusUpdates } = ctx;
    base.priorStatus = bill?.bill_status ?? null;

    if (!statusUpdates || statusUpdates.length === 0) {
        return { ...base, finalStatus: null, note: 'No status_updates to classify' };
    }

    base.context = [
        `Bill: ${bill?.bill_number ?? '(unknown)'}`,
        bill?.committee_assignment ? `Committees: ${bill.committee_assignment}` : null,
        `Current status: ${bill?.bill_status ?? 'unassigned'}`,
        'Status log (newest first):',
        ...statusUpdates.map(u => `${u.chamber}\t${u.date}\t${u.statustext}`),
    ].filter(Boolean).join('\n');

    // Run WITHOUT currentStatus first so rawOutput shows the classifier's unguarded decision,
    // then compute the guarded result exactly as the pure classifier would with the prior status.
    const unguarded = classifyStatus({
        billNumber: bill?.bill_number,
        committeeAssignment: bill?.committee_assignment,
        statusUpdates,
        currentStatus: null,
    });
    base.rawOutput = unguarded.status;
    base.mapped = unguarded.status;
    base.unmatched = unguarded.unmatched;

    const guarded = classifyStatus({
        billNumber: bill?.bill_number,
        committeeAssignment: bill?.committee_assignment,
        statusUpdates,
        currentStatus: bill?.bill_status ?? null,
    });
    base.dead = guarded.dead;

    const finalStatus = guarded.status ?? null;
    base.guardApplied = finalStatus !== unguarded.status;
    if (base.guardApplied) {
        console.log(`[STATUS] ${bill?.bill_number}: regression guard kept "${finalStatus}" (classifier proposed "${unguarded.status}")`);
    }

    // Surface unmatched lines so the maintenance loop (audit-unmatched.mjs) has a live signal.
    if (unguarded.unmatched?.length) {
        for (const line of unguarded.unmatched) {
            console.warn(`[STATUS] ${bill?.bill_number}: unmatched status line -> ${line}`);
        }
    }

    console.log(`[STATUS] ${bill?.bill_number} classified as "${finalStatus}"`);
    return { ...base, finalStatus };
}

// Re-exported for any callers that referenced these from this module.
export { COLUMN_INDEX };
