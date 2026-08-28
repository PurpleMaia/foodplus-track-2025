/**
 * Sim Week engine — pure. No DB, no network, no clock.
 *
 * Given a roster bill, a sim-day (1..5), and the action state observed so far
 * (contact flag + testimony stance), produce the FULL desired status-update
 * log for that bill up to and including that day, newest-first, ready for the
 * real classifier.
 *
 * Declarative, not incremental: the log for day N is recomputed from scratch,
 * so re-running a day is idempotent and a double cron run is safe (spec §4).
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md and scenarios.js.
 */

import { SCENARIOS, SIM_DATES } from './scenarios.js';

/** @typedef {{ chamber: string, date: string, statustext: string }} StatusUpdate */

/**
 * Interpret a free-text testimony `position` as support vs oppose.
 * Unknown / ambiguous strings are treated as OPPOSE — the safe default: a bill
 * only advances on a clear show of support (spec §7b).
 *
 * @param {string|null|undefined} position
 * @returns {'support'|'oppose'}
 */
export function normalizeStance(position) {
  if (!position) return 'oppose';
  const p = String(position).trim().toLowerCase();
  if (/\b(support|favor|for|aye|yes|endorse)\b/.test(p)) return 'support';
  return 'oppose';
}

/**
 * Is a checkpoint satisfied for a user-driven bill?
 * @param {'contact'|'testify'} requiredAction
 * @param {{ contacted?: boolean, stance?: ('support'|'oppose'|null) }} actions
 * @returns {boolean}
 */
function checkpointPassed(requiredAction, actions) {
  if (requiredAction === 'contact') return actions.contacted === true;
  if (requiredAction === 'testify') return actions.stance === 'support';
  return true;
}

/** stamp a scenario Line ({chamber, statustext}) with a date. */
function stamp(line, date) {
  return { chamber: line.chamber, date, statustext: line.statustext };
}

/**
 * Build the cumulative status log for one sim bill up to `simDay`.
 *
 * @param {Object} bill                 - a roster entry (scenarios.ROSTER item)
 * @param {string} bill.scenario        - 'scenario1' | 'scenario2'
 * @param {boolean} bill.isAuto
 * @param {number} simDay               - 1..5 (values <1 => history only; >5 clamps to 5)
 * @param {Object} [actions]
 * @param {boolean} [actions.contacted] - a contact flag is present
 * @param {('support'|'oppose'|null)} [actions.stance] - normalized testimony stance
 * @returns {{ updates: StatusUpdate[], dead: boolean, reachedStage: string|null }}
 *   updates: newest-first log for the classifier.
 *   dead: true if the bill hit a death line (permanent deferral).
 *   reachedStage: the intended targetStage of the last advancing step (for
 *     assertions / logging; the real classifier is still the source of truth).
 */
export function buildBillLog(bill, simDay, actions = {}) {
  const scenario = SCENARIOS[bill.scenario];
  if (!scenario) throw new Error(`unknown scenario: ${bill.scenario}`);

  const day = Math.min(simDay, SIM_DATES.length);
  /** @type {StatusUpdate[]} oldest-first while building */
  const chron = [];

  // Back-history predates day 1; stamp it one day before the window start.
  // Any date strictly before SIM_DATES[0] works for ordering; use a fixed lead date.
  const historyDate = '2026-09-08';
  for (const line of scenario.history) chron.push(stamp(line, historyDate));

  let dead = false;
  let reachedStage = null;

  for (const step of scenario.steps) {
    if (step.day > day) break;
    const date = SIM_DATES[step.day - 1];

    if (dead) break; // once dead, inject nothing further (spec §6)

    const gated = step.requiredAction && !bill.isAuto;
    const passed = !gated || checkpointPassed(step.requiredAction, {
      contacted: actions.contacted,
      stance: actions.stance ?? null,
    });

    if (passed) {
      for (const line of step.advance) chron.push(stamp(line, date));
      reachedStage = step.targetStage;
    } else {
      // Checkpoint failed: inject the death line and stop advancing.
      if (step.deathLine) chron.push(stamp(step.deathLine, date));
      dead = true;
    }
  }

  return { updates: chron.reverse(), dead, reachedStage };
}
