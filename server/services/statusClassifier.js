/**
 * Deterministic bill-stage classifier — pure function, no DB / network / OpenAI.
 * Implements docs/bill-status-pattern-table.md. Replaces the LLM classifier.
 *
 * @typedef {{ chamber: string, date: string, statustext: string }} StatusUpdate
 */
import { COLUMN_INDEX } from '../kanban-columns.js';

/** Which chamber a bill number originates in. */
function originChamberOf(billNumber) {
  const p = (billNumber || '').trim().slice(0, 2).toUpperCase();
  return p === 'HB' ? 'H' : p === 'SB' ? 'S' : null;
}

/** crossover prefix helper: waiting2 -> crossoverWaiting2 */
function pref(crossover, base) {
  if (!crossover) return base;
  return 'crossover' + base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Build the ordered committee referral list for a chamber phase, oldest->newest,
 * from referral lines. Joint committees (ECD/TOU) count as ONE slot.
 * @param {StatusUpdate[]} updatesNewestFirst
 * @param {string} phaseChamber 'H' | 'S'
 * @returns {string[]} e.g. ['AGR','ECD','FIN']
 */
function referralOrder(updatesNewestFirst, phaseChamber) {
  const chron = [...updatesNewestFirst].reverse();
  const order = [];
  for (const u of chron) {
    if (u.chamber !== phaseChamber) continue;
    const m = u.statustext.match(/[Rr]e-?[Rr]eferred to |[Rr]eferred to |[Rr]ecommitted to /);
    if (!m) continue;
    const after = u.statustext.slice(m.index + m[0].length);
    // grab the committee-acronym run up to a period / "referral sheet" / "with"
    const seg = after.split(/\breferral sheet\b|\bwith\b|\./i)[0];
    const cmts = seg.match(/[A-Z]{2,4}(?:\/[A-Z]{2,4})*/g) || [];
    for (const c of cmts) if (!order.includes(c)) order.push(c);
  }
  return order;
}

/** Ordinal (1-based) of the committee named in `text`, per the referral order. 0 if none. */
function committeeOrdinal(text, order) {
  const cmts = text.match(/[A-Z]{2,4}(?:\/[A-Z]{2,4})*/g) || [];
  for (const c of cmts) {
    const i = order.indexOf(c);
    if (i >= 0) return i + 1;
  }
  return 0;
}

/**
 * Classify ONE status line. Returns { stage } | { dead:true } | { revert:true } | null.
 * ctx: { crossover, bothChambers, order }
 */
function classifyLine(text, ctx) {
  const { crossover, bothChambers, bothConferees, order, priorPassageInPhase } = ctx;

  // ---- Tier 0: terminal / governor ----
  if (/\bAct\s+\d+/i.test(text)) return { stage: 'governorSigns' };
  if (/became law without/i.test(text)) return { stage: 'lawWithoutSignature' };
  if (/\bVetoed\b|Notice of Intent to veto|intent to veto/i.test(text)) return { stage: 'vetoList' };
  if (/Failed to pass (Third|Final) Reading/i.test(text)) return { dead: true };
  if (/Enrolled to Governor|Transmitted to (the )?Governor/i.test(text)) return { stage: 'transmittedGovernor' };
  // gubernatorial origination is NOT a governor terminal — fall through
  // (Received from Governor re: emergency appropriation / Recommended for Immediate Passage)

  // ---- Tier 1: conference (only if both chambers acted) ----
  if (bothChambers) {
    if (/Reported from Conference Committee/i.test(text)) return { stage: 'conferencePassed' };
    if (/Conference [Cc]ommittee recommends that the measure be PASSED/i.test(text)) return { stage: 'conferencePassed' };
    if (/Bill scheduled for Conference Committee Meeting|Conference committee meeting (to reconvene|scheduled)|Conference Committee Meeting will reconvene/i.test(text)) return { stage: 'conferenceScheduled' };
    if (/discharge of all .*Conferees|Conferee\(s\) discharged|conferees being discharged/i.test(text)) return { stage: 'conferenceAssigned' };
    // DOMAIN RULE: conferenceAssigned requires BOTH chambers to have appointed conferees.
    // One chamber's appointment (or a bare disagreement) alone = still passedCommittees.
    if (/Conferees Appointed|notice of (appointment of )?(Senate|House) conferees|notice of change in .*conferees/i.test(text))
      return { stage: bothConferees ? 'conferenceAssigned' : 'passedCommittees' };
    if (/Received notice of disagreement|(Senate|House) disagrees with .*amendment/i.test(text))
      return { stage: bothConferees ? 'conferenceAssigned' : 'passedCommittees' };
  }

  // ---- Tier 2: passed all committees ----
  if (/Received from (House|Senate).*in amended form/i.test(text)) return { stage: 'passedCommittees' };
  if (crossover && /Passed (Third|Final) Reading.*Transmitted/i.test(text)) return { stage: 'passedCommittees' };

  // ---- Ambiguous context-only lines: no-op (skip to the next line) ----
  if (/The recommendation was not adopted|Received notice of Final Reading/i.test(text)) return null;

  // ---- Tier 3: committee stage (family rules) ----
  const ord = committeeOrdinal(text, order) || 1;
  // 3.1 hearing cancelled -> revert scheduled{n} to waiting{n}
  if (/deleted the measure from (the public hearing|decision making)|measure has been deleted from the meeting/i.test(text)) return { revert: true };
  // 3.2 scheduled
  if (/scheduled to be heard by|has scheduled a public hearing|will hold a public decision making|Meeting Scheduled on/i.test(text))
    return { stage: pref(crossover, `scheduled${ord}`) };
  // 3.3 deferred — DOMAIN RULE: an explicit committee deferral does NOT move the bill to a
  // deferred{N} column. The bill STAYS at scheduled{N} (the hearing it was scheduled for); the
  // deferral is effectively a death and the UI reads the deferral text to explain why.
  if (/deferred the measure|be DEFERRED|recommend(s)? that the measure be deferred/i.test(text))
    return { stage: pref(crossover, `scheduled${ord}`) };
  // 3.4 committee passed -> waiting for next
  if (/recommend(s)? that the measure be PASSED/i.test(text))
    return { stage: pref(crossover, `waiting${Math.min(ord + 1, 3)}`) };
  // 3.5/3.6/3.7 reported-out / passed-second-reading + referral -> waiting for the named next cmt.
  // Here the named committee IS the next one, so use its ordinal directly (no +1).
  if (/Reported from .*recommendation of passage on (Second|Third)|recommending passage on (Second|Third)|Reported from .*recommending referral to|Report adopted; referred to the committee|Passed Second Reading.*referred to the committee|Report adopted; Passed Second Reading.*referred/i.test(text)) {
    const nextOrd = committeeOrdinal(text, order);
    const n = nextOrd > 0 ? nextOrd : Math.min(ord + 1, 3);
    return { stage: pref(crossover, `waiting${Math.max(n, 2)}`) };
  }

  // ---- Tier 4: introduction / crossover landing ----
  if (crossover && /Received from (House|Senate)/i.test(text)) return { stage: 'crossoverWaiting1' };
  // Re-referral / recommit: a bill re-referred AFTER already passing a committee in this phase
  // is waiting for its next committee (waiting2/crossoverWaiting2). A re-referral with no prior
  // passage is just a (re)assignment at the intro/landing stage.
  if (/(Re-?[Rr]eferred|Recommitted) to /i.test(text)) {
    if (priorPassageInPhase) return { stage: pref(crossover, 'waiting2') };
    return { stage: crossover ? 'crossoverWaiting1' : 'introduced' };
  }
  if (/Referred to .*(referral sheet|,)|Referred to [A-Z]/i.test(text)) return { stage: crossover ? 'crossoverWaiting1' : 'introduced' };
  if (/Introduced and Pass(ed)? First Reading|Pass(ed)? First Reading|^Introduced\.|Pending introduction/i.test(text)) return { stage: 'introduced' };

  return null; // no match
}

/**
 * Classify a bill's stage from its status history. Pure.
 * @param {{ billNumber: string, committeeAssignment?: string, statusUpdates: StatusUpdate[], currentStatus?: string }} args
 * @returns {{ status: string, dead: boolean, unmatched: string[] }}
 */
export function classifyStatus({ billNumber, statusUpdates, currentStatus }) {
  if (!statusUpdates || statusUpdates.length === 0) {
    return { status: 'unassigned', dead: false, unmatched: [] };
  }
  const origin = originChamberOf(billNumber);
  const newestChamber = statusUpdates[0].chamber?.toUpperCase();
  const crossover = origin != null && newestChamber != null && newestChamber !== origin;
  const chambers = new Set(statusUpdates.map(u => u.chamber?.toUpperCase()));
  const bothChambers = chambers.has('H') && chambers.has('S');
  const phaseChamber = crossover ? (origin === 'H' ? 'S' : 'H') : origin;
  const order = referralOrder(statusUpdates, phaseChamber);

  // Both-conferees flag: has EACH chamber appointed its own conferees? "House Conferees
  // Appointed" (in H) + notice thereof (in S), and vice versa. We detect an appointment for a
  // chamber via either the chamber's own "<Chamber> Conferees Appointed" or the other chamber's
  // "notice of appointment of <Chamber> conferees".
  const houseConferees = statusUpdates.some(u => /House Conferees Appointed|notice of (appointment of )?House conferees/i.test(u.statustext));
  const senateConferees = statusUpdates.some(u => /Senate Conferees Appointed|notice of (appointment of )?Senate conferees/i.test(u.statustext));
  const bothConferees = houseConferees && senateConferees;

  // Has a committee passed the bill within the current chamber phase? Used to disambiguate
  // re-referral (passed-then-re-referred = waiting for next committee).
  const priorPassageInPhase = statusUpdates.some(u =>
    u.chamber?.toUpperCase() === phaseChamber &&
    /recommend(s)? that the measure be PASSED|recommendation of passage on (Second|Third)/i.test(u.statustext)
  );

  const ctx = { crossover, bothChambers, bothConferees, order, priorPassageInPhase };
  const unmatched = [];

  // Terminal scan first (governor/veto/dead can appear then be followed by admin lines).
  // These override regardless of position because they are absorbing states.
  let dead = false;
  for (const u of statusUpdates) {
    if (/Failed to pass (Third|Final) Reading/i.test(u.statustext)) dead = true;
    if (/\bAct\s+\d+/i.test(u.statustext)) return finalize('governorSigns', dead, currentStatus);
    if (/became law without/i.test(u.statustext)) return finalize('lawWithoutSignature', dead, currentStatus);
    if (/\bVetoed\b|Notice of Intent to veto|intent to veto/i.test(u.statustext)) return finalize('vetoList', dead, currentStatus);
  }

  // Current status = the newest line that yields a confident stage. Walk newest->oldest.
  // History is already folded into ctx (crossover / ordinal / bothChambers). "revert" and
  // context-only lines (e.g. "Received notice of passage") are skipped to the next line.
  let pendingRevert = false;
  for (const u of statusUpdates) {
    const res = classifyLine(u.statustext, ctx);
    if (!res) { unmatched.push(`[${u.chamber}] ${u.statustext}`); continue; }
    if (res.dead) { dead = true; continue; }
    if (res.revert) { pendingRevert = true; continue; }
    let stage = res.stage;
    if (pendingRevert) {
      // A hearing was cancelled AFTER this scheduling line: scheduled{n} -> waiting{n}.
      // A cancelled 1st hearing reverts to introduced/crossoverWaiting1 (no waiting1 column).
      if (/^(crossover)?[Ss]cheduled1$/.test(stage)) stage = crossover ? 'crossoverWaiting1' : 'introduced';
      else stage = stage.replace(/([Ss])cheduled(\d)/, (_, c, n) => (c === 'S' ? 'Waiting' : 'waiting') + n);
    }
    return finalize(stage, dead, currentStatus);
  }

  // Nothing matched: keep current status (self-healing; unmatched logged by caller).
  return { status: currentStatus && COLUMN_INDEX[currentStatus] != null ? currentStatus : 'unassigned', dead, unmatched };

  function finalize(stage, isDead, cur) {
    let status = stage;
    // Monotonic guard vs an explicit currentStatus (no regression) — unless dead/terminal.
    if (cur && cur !== 'unassigned') {
      const ci = COLUMN_INDEX[cur], si = COLUMN_INDEX[stage];
      if (ci != null && si != null && si < ci) status = cur;
    }
    return { status, dead: isDead, unmatched };
  }
}
