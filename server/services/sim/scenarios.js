/**
 * Sim Week scenario data — the two bill lifecycles as pure data.
 *
 * See docs/superpowers/specs/2026-08-27-sim-week-design.md.
 *
 * Every status line below has been validated against the real deterministic
 * classifier (server/services/statusClassifier.js) so that the cumulative log
 * up to each sim-day resolves to the intended kanban stage. Do NOT reword a
 * line without re-running server/tests/simEngine.test.js — the wording is
 * load-bearing (it must match docs/bill-status-pattern-table.md).
 *
 * A "step" is one sim-day (1..5). Each step contributes zero or more status
 * lines to the bill's cumulative log. Lines are authored oldest->newest here;
 * the engine reverses to newest-first before handing to the classifier.
 *
 * `requiredAction` marks a checkpoint that user-driven bills must satisfy:
 *   - 'contact'  : bill is waiting; a contact flag advances it (else it dies).
 *   - 'testify'  : bill is at a hearing; a support testimony passes it,
 *                  an oppose testimony (or none) defers/kills it.
 * Auto bills ignore requiredAction and always take the advancing line(s).
 *
 * When a user-driven bill fails a checkpoint, the engine replaces that day's
 * advancing line with a `deathLine` (a permanent committee deferral that
 * dead-bill.js recognizes) and injects nothing further.
 */

/** @typedef {{ chamber: string, statustext: string }} Line */
/**
 * @typedef {Object} Step
 * @property {number} day             - sim-day 1..5
 * @property {string} label           - human label (matches Jaden's table)
 * @property {string} targetStage     - kanban stage expected after this step
 * @property {Line[]} advance         - lines added when the step succeeds
 * @property {('contact'|'testify')} [requiredAction] - checkpoint gate
 * @property {Line} [deathLine]       - committee deferral used when a
 *                                      user-driven bill fails the checkpoint
 */
/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {Line[]} history         - lines that predate day 1 (back-history)
 * @property {Step[]} steps
 */

// The date a line carries is the sim date for its step; the engine stamps it.
// `chamber` is 'H' (origin) or 'S' (receiving), matching the classifier's
// chamber-phase logic. Both scenarios are House-origin (crossover to Senate).

const COMMITTEE_1 = 'JHA'; // origin-chamber committee
const COMMITTEE_2 = 'CPN'; // receiving-chamber committee

const deferOrigin = { chamber: 'H', statustext: `The committee(s) on ${COMMITTEE_1} deferred the measure.` };
const deferRecv = { chamber: 'S', statustext: `The committee(s) on ${COMMITTEE_2} deferred the measure.` };

/**
 * SCENARIO 1 — introduced -> first hearing -> crossover -> crossover hearing.
 * Checkpoints: day 2 (contact -> scheduled1), day 3 (testify -> pass/defer),
 * day 5 (contact -> crossoverScheduled1).
 */
const scenario1 = {
  id: 'scenario1',
  history: [],
  steps: [
    {
      day: 1,
      label: 'Introduced & Waiting',
      targetStage: 'introduced',
      advance: [
        { chamber: 'H', statustext: 'Introduced and passed First Reading.' },
        { chamber: 'H', statustext: `Referred to ${COMMITTEE_1}, referral sheet 1.` },
      ],
    },
    {
      day: 2,
      label: 'Hearing Notice',
      targetStage: 'scheduled1',
      requiredAction: 'contact',
      advance: [
        { chamber: 'H', statustext: `The committee(s) on ${COMMITTEE_1} has scheduled a public hearing on 09-16-26 2:00PM.` },
      ],
      deathLine: deferOrigin,
    },
    {
      day: 3,
      label: 'Hearing',
      targetStage: 'waiting2',
      requiredAction: 'testify',
      advance: [
        { chamber: 'H', statustext: `The committee(s) on ${COMMITTEE_1} recommend(s) that the measure be PASSED, unamended.` },
      ],
      deathLine: deferOrigin,
    },
    {
      day: 4,
      label: 'Crossover & Waiting',
      targetStage: 'crossoverWaiting1',
      advance: [
        { chamber: 'H', statustext: 'Passed Third Reading. Ayes, 25. Transmitted to the Senate.' },
        { chamber: 'S', statustext: `Received from the House. Referred to ${COMMITTEE_2}.` },
      ],
    },
    {
      day: 5,
      label: 'Crossed Over Hearing Notice',
      targetStage: 'crossoverScheduled1',
      requiredAction: 'contact',
      advance: [
        { chamber: 'S', statustext: `The committee(s) on ${COMMITTEE_2} has scheduled a public hearing on 09-21-26 2:00PM.` },
      ],
      deathLine: deferRecv,
    },
  ],
};

/**
 * SCENARIO 2 — first hearing -> crossover -> crossover hearing -> conference.
 * Back-history seeds an introduced+referred bill before day 1.
 * Checkpoints: day 1 (testify -> pass/defer), day 3 (contact -> crossoverScheduled1),
 * day 4 (testify -> pass/defer).
 */
const scenario2 = {
  id: 'scenario2',
  history: [
    { chamber: 'H', statustext: 'Introduced and passed First Reading.' },
    { chamber: 'H', statustext: `Referred to ${COMMITTEE_1}, referral sheet 1.` },
    { chamber: 'H', statustext: `The committee(s) on ${COMMITTEE_1} has scheduled a public hearing on 09-14-26 2:00PM.` },
  ],
  steps: [
    {
      day: 1,
      label: 'Hearing',
      targetStage: 'waiting2',
      requiredAction: 'testify',
      advance: [
        { chamber: 'H', statustext: `The committee(s) on ${COMMITTEE_1} recommend(s) that the measure be PASSED, unamended.` },
      ],
      deathLine: deferOrigin,
    },
    {
      day: 2,
      label: 'Crossover & Waiting',
      targetStage: 'crossoverWaiting1',
      advance: [
        { chamber: 'H', statustext: 'Passed Third Reading. Ayes, 25. Transmitted to the Senate.' },
        { chamber: 'S', statustext: `Received from the House. Referred to ${COMMITTEE_2}.` },
      ],
    },
    {
      day: 3,
      label: 'Crossed Over Hearing Notice',
      targetStage: 'crossoverScheduled1',
      requiredAction: 'contact',
      advance: [
        { chamber: 'S', statustext: `The committee(s) on ${COMMITTEE_2} has scheduled a public hearing on 09-18-26 2:00PM.` },
      ],
      deathLine: deferRecv,
    },
    {
      day: 4,
      label: 'Crossed Over Hearing',
      targetStage: 'passedCommittees',
      requiredAction: 'testify',
      advance: [
        { chamber: 'S', statustext: `The committee(s) on ${COMMITTEE_2} recommend(s) that the measure be PASSED, unamended.` },
        { chamber: 'S', statustext: 'Passed Third Reading in amended form. Transmitted to the House.' },
      ],
      deathLine: deferRecv,
    },
    {
      day: 5,
      label: 'Conference / Conference Hearing Notice',
      targetStage: 'conferenceAssigned',
      advance: [
        { chamber: 'H', statustext: 'House disagrees with Senate amendments.' },
        { chamber: 'H', statustext: 'House Conferees Appointed: SMITH, JONES.' },
        { chamber: 'S', statustext: 'Senate Conferees Appointed: LEE, KIM.' },
      ],
    },
  ],
};

/**
 * The 20-bill roster. 4 auto (isAuto:true) + 16 user-driven, split evenly.
 * SIM_ID is the operator handle (flag.js, sentinel URL); billNumber is what the
 * classifier parses for origin chamber. Both scenarios are House-origin, so
 * numbers are HB9001..HB9020 in a reserved high range (see spec §5a).
 */
const ROSTER = [
  // Scenario 1
  { simId: 'SIM-01', billNumber: 'HB9001', scenario: 'scenario1', isAuto: true },
  { simId: 'SIM-02', billNumber: 'HB9002', scenario: 'scenario1', isAuto: true },
  { simId: 'SIM-03', billNumber: 'HB9003', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-04', billNumber: 'HB9004', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-05', billNumber: 'HB9005', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-06', billNumber: 'HB9006', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-07', billNumber: 'HB9007', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-08', billNumber: 'HB9008', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-09', billNumber: 'HB9009', scenario: 'scenario1', isAuto: false },
  { simId: 'SIM-10', billNumber: 'HB9010', scenario: 'scenario1', isAuto: false },
  // Scenario 2
  { simId: 'SIM-11', billNumber: 'HB9011', scenario: 'scenario2', isAuto: true },
  { simId: 'SIM-12', billNumber: 'HB9012', scenario: 'scenario2', isAuto: true },
  { simId: 'SIM-13', billNumber: 'HB9013', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-14', billNumber: 'HB9014', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-15', billNumber: 'HB9015', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-16', billNumber: 'HB9016', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-17', billNumber: 'HB9017', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-18', billNumber: 'HB9018', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-19', billNumber: 'HB9019', scenario: 'scenario2', isAuto: false },
  { simId: 'SIM-20', billNumber: 'HB9020', scenario: 'scenario2', isAuto: false },
];

const SCENARIOS = { scenario1, scenario2 };

/** The sim week: Sept 14 (Mon) .. Sept 18 (Fri) 2026, indexed by sim-day 1..5. */
const SIM_DATES = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];

const SENTINEL_PREFIX = 'test://sim-week/';

/** Origin/receiving committees, exported for tooling/tests. */
const COMMITTEES = { origin: COMMITTEE_1, receiving: COMMITTEE_2 };

export { SCENARIOS, ROSTER, SIM_DATES, SENTINEL_PREFIX, COMMITTEES };
