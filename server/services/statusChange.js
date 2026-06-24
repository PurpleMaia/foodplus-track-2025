import { COLUMN_TITLES } from './kanban-columns.js';

/**
 * Human-readable label for a bill_status enum id.
 * Falls back to the raw id, then to 'Unknown'.
 * @param {string | null | undefined} statusId
 * @returns {string}
 */
export function statusLabel(statusId) {
  if (!statusId) return 'Unknown';
  return COLUMN_TITLES[statusId] ?? statusId;
}

/**
 * Decide whether a notifiable change occurred between two bill states.
 * @param {{ oldStatus: string|null, newStatus: string|null, oldDead: boolean|null, newDead: boolean|null }} input
 * @returns {{ changed: boolean, statusChanged: boolean, deadChanged: boolean }}
 */
export function diffBillState({ oldStatus, newStatus, oldDead, newDead }) {
  const statusChanged = (oldStatus ?? null) !== (newStatus ?? null);
  const deadChanged = Boolean(oldDead) !== Boolean(newDead);
  return { changed: statusChanged || deadChanged, statusChanged, deadChanged };
}

/**
 * Build a plain status-change record, or null if nothing notifiable changed.
 * Pure — no DB access — so it can be unit tested.
 * `oldStatus`/`newStatus` are the bill's human-readable current_status_string values.
 * @param {{ billId: string, billNumber: string, billTitle: string|null, oldStatus: string|null, newStatus: string|null, oldDead: boolean|null, newDead: boolean|null }} input
 * @returns {null | { bill_id: string, bill_number: string, bill_title: string|null, old_status: string|null, new_status: string|null, old_dead: boolean|null, new_dead: boolean|null }}
 */
export function computeChange({ billId, billNumber, billTitle, oldStatus, newStatus, oldDead, newDead }) {
  const { changed } = diffBillState({ oldStatus, newStatus, oldDead, newDead });
  if (!changed) return null;
  return {
    bill_id: billId,
    bill_number: billNumber,
    bill_title: billTitle ?? null,
    old_status: oldStatus ?? null,
    new_status: newStatus ?? null,
    old_dead: oldDead ?? null,
    new_dead: newDead ?? null,
  };
}

/**
 * One-line description of a change for a digest email.
 * @param {{ billNumber: string, billTitle: string|null, oldStatus: string|null, newStatus: string|null, oldDead: boolean|null, newDead: boolean|null }} input
 * @returns {string}
 */
export function describeChange({ billNumber, billTitle, oldStatus, newStatus, oldDead, newDead }) {
  const { statusChanged, deadChanged } = diffBillState({ oldStatus, newStatus, oldDead, newDead });
  const titlePart = billTitle ? ` (${billTitle})` : '';
  const parts = [];
  if (statusChanged) {
    parts.push(`${statusLabel(oldStatus)} → ${statusLabel(newStatus)}`);
  }
  if (deadChanged) {
    parts.push(Boolean(newDead) ? 'now marked DEAD' : 'revived (ALIVE)');
  }
  return `${billNumber}${titlePart}: ${parts.join('; ')}`;
}
