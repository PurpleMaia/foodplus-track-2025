import { COLUMN_INDEX } from './kanban-columns.js';

// --- Types (JSDoc) ---

/** @typedef {'single' | 'double' | 'triple'} ReferralType */
/** @typedef {'HB' | 'SB'} Chamber */
/** @typedef {string} BillStatus - A bill status string (e.g. 'waiting2', 'passedCommittees', 'crossoverWaiting1', etc.) */

/**
 * @typedef {Object} DeadlineEntry
 * @property {string} name
 * @property {string} date - YYYY-MM-DD format
 * @property {BillStatus} minimumStatus
 */

/**
 * @typedef {Object} DeadBillResult
 * @property {boolean} dead
 * @property {string} reason
 * @property {DeadlineEntry} [failedDeadline] - The specific deadline the bill failed, if death was due to a missed deadline
 */

/**
 * @typedef {Object} SessionDeadlines
 * @property {number} session
 * @property {Object} deadlines
 * @property {{HB: string, SB: string}} deadlines.first_triple_referral_filing
 * @property {string} deadlines.first_lateral_filing
 * @property {string} deadlines.first_lateral
 * @property {{SB: string, HB: string}} deadlines.single_referral_filing
 * @property {string} deadlines.first_decking
 * @property {string} deadlines.first_crossover
 * @property {string} deadlines.second_triple_referral_filing
 * @property {string} deadlines.second_lateral_filing
 * @property {string} deadlines.second_lateral
 * @property {string} deadlines.second_decking
 * @property {string} deadlines.second_crossover
 * @property {string} deadlines.final_decking_non_fiscal
 * @property {string} deadlines.final_decking_fiscal
 * @property {string} deadlines.adjournment_sine_die
 */

/**
 * @typedef {Object} StatusUpdate
 * @property {string} statustext
 * @property {string} date
 * @property {string} chamber
 */

// --- Committee Parsing ---

/**
 * @param {string} committeeAssignment - comma-separated committee names (e.g. "JDC, FIN")
 * @returns {string[]} - array of trimmed, non-empty committee names
 */
export function parseCommittees(committeeAssignment) {
  return committeeAssignment
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * @param {number} committeeCount - number of committees assigned
 * @returns {ReferralType} - 'single' | 'double' | 'triple'
 */
export function getReferralType(committeeCount) {
  if (committeeCount >= 3) return 'triple';
  if (committeeCount === 2) return 'double';
  return 'single';
}

/**
 * @param {string} billNumber - e.g. "HB123" or "SB456"
 * @returns {Chamber} - 'HB' or 'SB'
 */
export function getBillChamber(billNumber) {
  const prefix = billNumber.replace(/[0-9]/g, '').toUpperCase();
  if (prefix.startsWith('SB')) return 'SB';
  return 'HB';
}

/**
 * A bill is fiscal if its committee assignment includes FIN or WAM.
 * Joint committees like JDL/WAM also count.
 *
 * @param {string} committeeAssignment - comma-separated committee names
 * @returns {boolean} - true if the bill is fiscal
 */
export function isFiscalBill(committeeAssignment) {
  return committeeAssignment.toUpperCase().includes('FIN') ||
    committeeAssignment.toUpperCase().includes('WAM');
}

// --- Phase Detection ---

/**
 * @param {BillStatus} status - current bill status
 * @returns {boolean} - true if the bill has not yet crossed over
 */
export function isPreCrossover(status) {
  return !status.startsWith('crossover') &&
    !['passedCommittees', 'conferenceAssigned', 'conferenceScheduled',
      'conferenceDeferred', 'conferencePassed', 'transmittedGovernor',
      'vetoList', 'governorSigns', 'lawWithoutSignature'].includes(status);
}

// --- Kill Condition 1: Explicit Deferral ---

/**
 * A permanent deferral looks like:
 *   "The committee on JDC deferred the measure."
 *   "The committee(s) on LAB recommend(s) that the measure be deferred."
 *   "The recommendation was not adopted."
 *
 * A temporary deferral (NOT a kill) looks like: "...deferred the measure until 04-06-26..."
 *
 * Only permanent deferrals count as kills. A deferral is permanent if:
 * 1. The statustext contains a kill phrase (see below) WITHOUT "until" after it, AND
 * 2. There is no subsequent status update after the deferral (bill did not recover)
 */

/**
 * @param {string} text - lowercased status text
 * @returns {boolean} - true if text contains deferral language
 */
function isDeferralText(text) {
  return text.includes('deferred the measure') ||
    text.includes('measure be deferred') ||
    text.includes('recommendation was not adopted');
}

/**
 * @param {StatusUpdate[]} statusUpdates - all status updates for the bill
 * @returns {StatusUpdate | null} - the permanent deferral update, or null if none found
 */
export function findPermanentDeferral(statusUpdates) {
  // Sort by date properly (dates may be M/D/YYYY strings, not ISO)
  const sorted = [...statusUpdates].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (let i = 0; i < sorted.length; i++) {
    const text = sorted[i].statustext.toLowerCase();

    if (!isDeferralText(text)) continue;

    // Skip temporary deferrals ("deferred the measure until ...")
    if (text.includes('deferred the measure until')) continue;

    // Check if the bill recovered — any subsequent status update that is NOT a deferral means it did
    const hasSubsequentActivity = sorted.slice(i + 1).some((u) => {
      const uText = u.statustext.toLowerCase();
      return !isDeferralText(uText);
    });
    if (hasSubsequentActivity) continue;

    return sorted[i];
  }
  return null;
}

/**
 * @param {StatusUpdate[]} statusUpdates - all status updates for the bill
 * @returns {boolean} - true if the bill was permanently deferred
 */
export function isExplicitlyDeferred(statusUpdates) {
  return findPermanentDeferral(statusUpdates) !== null;
}

/**
 * Derives a short human-readable death reason from just the latest status update text.
 * Used on the kanban card where we don't have full algorithm context.
 *
 * @param {string | null} latestStatusText - the most recent status update text
 * @returns {string} - a short reason string (e.g. "Deferred by JDC", "Missed deadline")
 */
export function getDeadReasonFromUpdate(latestStatusText) {
  if (!latestStatusText) return 'Missed deadline';

  const text = latestStatusText.toLowerCase();

  // Check for explicit deferral language
  if (isDeferralText(text)) {
    if (text.includes('recommendation was not adopted')) {
      const committeeMatch = latestStatusText.match(/committee(?:\(s\))?\s+on\s+(\S+)/i);
      const committee = committeeMatch ? committeeMatch[1] : null;
      return committee ? `Recommendation not adopted by ${committee}` : 'Recommendation not adopted';
    }
    const committeeMatch = latestStatusText.match(/committee(?:\(s\))?\s+on\s+(\S+)/i);
    const committee = committeeMatch ? committeeMatch[1] : null;
    return committee ? `Deferred by ${committee}` : 'Deferred by committee';
  }

  return 'Missed deadline';
}

/**
 * Returns the next upcoming deadline for a bill based on its current status,
 * referral type, chamber, and fiscal status. Returns null if all deadlines passed.
 *
 * @param {string} billNumber - e.g. "HB123"
 * @param {BillStatus} billStatus - current bill status
 * @param {string} committeeAssignment - comma-separated committee names
 * @param {SessionDeadlines} deadlines - session deadline configuration
 * @param {string} today - today's date in YYYY-MM-DD format
 * @returns {DeadlineEntry | null} - the next upcoming deadline, or null
 */
export function getNextDeadline(billNumber, billStatus, committeeAssignment, deadlines, today) {
  const committees = parseCommittees(committeeAssignment);
  const referralType = getReferralType(committees.length);
  const chamber = getBillChamber(billNumber);
  const preCrossover = isPreCrossover(billStatus);
  const applicable = getApplicableDeadlines(referralType, chamber, preCrossover, deadlines, committeeAssignment);
  const currentIndex = COLUMN_INDEX[billStatus] ?? 0;

  // Find the next deadline that:
  // 1. Hasn't passed yet (date >= today), AND
  // 2. The bill hasn't already met (bill status is below the minimum required)
  const upcoming = applicable.filter((d) => {
    const requiredIndex = COLUMN_INDEX[d.minimumStatus] ?? 0;
    return d.date >= today && currentIndex < requiredIndex;
  });
  if (upcoming.length === 0) return null;
  return upcoming[0];
}

// --- Deadline Resolution ---

/**
 * @param {string | {HB: string, SB: string}} entry - a date string or chamber-keyed object
 * @param {Chamber} chamber - 'HB' or 'SB'
 * @returns {string} - resolved date string
 */
function resolveDate(entry, chamber) {
  if (typeof entry === 'string') return entry;
  return entry[chamber];
}

/**
 * Returns all deadlines applicable to this bill, in chronological order,
 * with the minimum status the bill must have reached by each deadline.
 * Minimum status indices are monotonically non-decreasing with date.
 * All dates use YYYY-MM-DD format for lexicographic comparison.
 *
 * @param {ReferralType} referralType - 'single' | 'double' | 'triple'
 * @param {Chamber} chamber - 'HB' | 'SB'
 * @param {boolean} preCrossover - true if the bill has not yet crossed over
 * @param {SessionDeadlines} deadlines - session deadline configuration
 * @param {string} [committeeAssignment] - comma-separated committee names (optional, used for fiscal detection)
 * @returns {DeadlineEntry[]} - sorted array of applicable deadlines
 */
export function getApplicableDeadlines(referralType, chamber, preCrossover, deadlines, committeeAssignment) {
  const d = deadlines.deadlines;
  const entries = [];

  if (preCrossover) {
    if (referralType === 'triple') {
      entries.push({
        name: 'First Triple Referral Filing',
        date: resolveDate(d.first_triple_referral_filing, chamber),
        minimumStatus: 'waiting2',
      });
    }

    if (referralType === 'double' || referralType === 'triple') {
      entries.push({
        name: 'First Lateral',
        date: d.first_lateral,
        minimumStatus: referralType === 'triple' ? 'waiting3' : 'waiting2',
      });
    }

    // Single referral SBs have a pre-crossover filing deadline (Mar 5).
    // Single referral HBs have a post-crossover filing deadline (Apr 9) — handled in the else branch.
    if (referralType === 'single' && chamber === 'SB') {
      entries.push({
        name: 'Single Referral Filing (SBs)',
        date: resolveDate(d.single_referral_filing, 'SB'),
        minimumStatus: 'waiting2',
      });
    }

    entries.push({
      name: 'First Decking',
      date: d.first_decking,
      minimumStatus: 'passedCommittees',
    });

    entries.push({
      name: 'First Crossover',
      date: d.first_crossover,
      minimumStatus: 'crossoverWaiting1',
    });
  } else {
    if (referralType === 'triple') {
      entries.push({
        name: 'Second Triple Referral Filing',
        date: d.second_triple_referral_filing,
        minimumStatus: 'crossoverWaiting2',
      });
    }

    if (referralType === 'double' || referralType === 'triple') {
      entries.push({
        name: 'Second Lateral',
        date: d.second_lateral,
        minimumStatus: referralType === 'triple' ? 'crossoverWaiting3' : 'crossoverWaiting2',
      });
    }

    if (referralType === 'single' && chamber === 'HB') {
      entries.push({
        name: 'Single Referral Filing (HBs)',
        date: resolveDate(d.single_referral_filing, 'HB'),
        minimumStatus: 'crossoverWaiting2',
      });
    }

    entries.push({
      name: 'Second Decking',
      date: d.second_decking,
      minimumStatus: 'passedCommittees',
    });

    entries.push({
      name: 'Second Crossover',
      date: d.second_crossover,
      minimumStatus: 'conferenceAssigned',
    });
  }

  // --- Endgame deadlines (apply to all bills regardless of phase) ---

  // Final Decking: fiscal bills (FIN/WAM) get until May 1, non-fiscal until Apr 29
  const fiscal = committeeAssignment ? isFiscalBill(committeeAssignment) : false;
  entries.push({
    name: fiscal ? 'Final Decking (Fiscal)' : 'Final Decking (Non-Fiscal)',
    date: fiscal ? d.final_decking_fiscal : d.final_decking_non_fiscal,
    minimumStatus: 'transmittedGovernor',
  });

  // Adjournment Sine Die: session over, bill must be signed or law
  entries.push({
    name: 'Adjournment Sine Die',
    date: d.adjournment_sine_die,
    minimumStatus: 'governorSigns',
  });

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

/**
 * Given today's date (YYYY-MM-DD), find the most recent deadline that has passed
 * and return it. Returns null if no deadlines have passed yet.
 *
 * @param {ReferralType} referralType - 'single' | 'double' | 'triple'
 * @param {Chamber} chamber - 'HB' | 'SB'
 * @param {boolean} preCrossover - true if the bill has not yet crossed over
 * @param {SessionDeadlines} deadlines - session deadline configuration
 * @param {string} today - today's date in YYYY-MM-DD format
 * @param {string} [committeeAssignment] - comma-separated committee names (optional)
 * @returns {DeadlineEntry | null} - the most recent passed deadline, or null
 */
export function getRelevantDeadline(referralType, chamber, preCrossover, deadlines, today, committeeAssignment) {
  const applicable = getApplicableDeadlines(referralType, chamber, preCrossover, deadlines, committeeAssignment);
  const passed = applicable.filter((d) => d.date <= today);
  if (passed.length === 0) return null;
  return passed[passed.length - 1];
}

// --- Top-Level Verdict ---

/**
 * Determines whether a bill is dead based on explicit deferrals and missed deadlines.
 *
 * @param {Object} bill
 * @param {string} bill.bill_number - e.g. "HB123"
 * @param {BillStatus} bill.bill_status - current bill status
 * @param {string} bill.committee_assignment - comma-separated committee names
 * @param {StatusUpdate[]} statusUpdates - all status updates for the bill
 * @param {SessionDeadlines} deadlines - session deadline configuration
 * @param {string} today - today's date in YYYY-MM-DD format
 * @returns {DeadBillResult} - { dead: boolean, reason: string, failedDeadline?: DeadlineEntry }
 */
export function isBillDead(bill, statusUpdates, deadlines, today) {
  // Kill Condition 1: Explicit deferral / recommendation not adopted
  // This supersedes the deadline kill condition — committee action is the authoritative reason.
  const deferralUpdate = findPermanentDeferral(statusUpdates);
  if (deferralUpdate) {
    const committeeMatch = deferralUpdate.statustext.match(/committee(?:\(s\))?\s+on\s+(\S+)/i);
    const committee = committeeMatch ? committeeMatch[1] : 'committee';
    const text = deferralUpdate.statustext.toLowerCase();
    if (text.includes('recommendation was not adopted')) {
      return {
        dead: true,
        reason: `Recommendation not adopted by ${committee}`,
      };
    }
    return {
      dead: true,
      reason: `Deferred by ${committee}`,
    };
  }

  // Parse bill properties
  const committees = parseCommittees(bill.committee_assignment);
  const referralType = getReferralType(committees.length);
  const chamber = getBillChamber(bill.bill_number);
  const preCrossover = isPreCrossover(bill.bill_status);

  // Kill Condition 2: Missed deadline
  // Walk deadlines chronologically and find the FIRST one the bill failed.
  // This gives a specific, actionable reason (e.g. "Missed First Lateral")
  // instead of always blaming the most recent deadline (e.g. Adjournment).
  const applicable = getApplicableDeadlines(referralType, chamber, preCrossover, deadlines, bill.committee_assignment);
  const passed = applicable.filter((d) => d.date <= today);

  if (passed.length === 0) {
    return {
      dead: false,
      reason: 'No applicable deadline has passed yet',
    };
  }

  const currentIndex = COLUMN_INDEX[bill.bill_status] ?? 0;

  // Find the earliest deadline the bill failed to meet
  const firstFailed = passed.find((d) => {
    const requiredIndex = COLUMN_INDEX[d.minimumStatus] ?? 0;
    return currentIndex < requiredIndex;
  });

  if (firstFailed) {
    return {
      dead: true,
      reason: `Missed ${firstFailed.name} deadline (${firstFailed.date})`,
      failedDeadline: firstFailed,
    };
  }

  // Bill met all passed deadlines
  const lastPassed = passed[passed.length - 1];
  return {
    dead: false,
    reason: `Bill meets all passed deadlines through ${lastPassed.name} (${lastPassed.date}). Status "${bill.bill_status}" (index ${currentIndex}) is on track.`,
  };
}
