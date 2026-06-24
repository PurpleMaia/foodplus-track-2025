/**
 * @typedef {Object} KanbanColumnData
 * @property {string} id - The bill status identifier
 * @property {string} title - Human-readable column title
 */

/** @type {KanbanColumnData[]} */
export const KANBAN_COLUMNS = [
  { id: 'unassigned', title: 'Not Assigned' },
  { id: 'introduced', title: 'INTRODUCED & WAITING 1ST' },
  { id: 'scheduled1', title: 'SCHEDULED 1ST' },
  { id: 'deferred1', title: 'Deferred after First Committee Hearing' },
  { id: 'waiting2', title: 'WAITING 2ND' },
  { id: 'scheduled2', title: 'SCHEDULED 2ND' },
  { id: 'deferred2', title: 'Deferred after Second Committee Hearing' },
  { id: 'waiting3', title: 'WAITING 3RD' },
  { id: 'scheduled3', title: 'SCHEDULED 3RD' },
  { id: 'deferred3', title: 'Deferred after Third Committee Hearing' },
  { id: 'crossoverWaiting1', title: 'CROSSOVER & WAITING 1ST' },
  { id: 'crossoverScheduled1', title: 'SCHEDULED 1ST' },
  { id: 'crossoverDeferred1', title: 'Deferred after First Committee Hearing after Crossover' },
  { id: 'crossoverWaiting2', title: 'WAITING 2ND' },
  { id: 'crossoverScheduled2', title: 'SCHEDULED 2ND' },
  { id: 'crossoverDeferred2', title: 'Deferred after Second Committee Hearing after Crossover' },
  { id: 'crossoverWaiting3', title: 'WAITING 3RD' },
  { id: 'crossoverScheduled3', title: 'SCHEDULED 3RD' },
  { id: 'crossoverDeferred3', title: 'Deferred after Third Committee Hearing after Crossover' },
  { id: 'passedCommittees', title: 'CONFERENCE' },
  { id: 'conferenceAssigned', title: 'AWAITING COMMITTEES' },
  { id: 'conferenceScheduled', title: 'SCHEDULED' },
  { id: 'conferenceDeferred', title: 'Deferred during Conference Committee' },
  { id: 'conferencePassed', title: 'PASSED CONFERENCE' },
  { id: 'transmittedGovernor', title: 'TRANSMITTED TO GOVERNOR' },
  { id: 'vetoList', title: 'GOVERNOR VETOED' },
  { id: 'governorSigns', title: 'GOVERNOR SIGNED INTO LAW' },
  { id: 'lawWithoutSignature', title: 'LAW WITHOUT SIGNATURE' },
];

/** @type {Record<string, string>} */
export const COLUMN_TITLES = KANBAN_COLUMNS.reduce((acc, col) => {
  acc[col.id] = col.title;
  return acc;
}, {});

/** @type {Record<string, number>} */
export const COLUMN_INDEX = KANBAN_COLUMNS.reduce((acc, col, idx) => {
  acc[col.id] = idx;
  return acc;
}, {});
