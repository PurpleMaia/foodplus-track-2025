/**
 * ANALYSIS PROTOTYPE v2 — not production code.
 * Key fix over v1: scan the ENTIRE log suffix and take the MOST-ADVANCED matched stage
 * (monotonic max), instead of classifying only the newest line. This mirrors the
 * OpenStates/LegiScan pattern: pattern-match every action, then the bill's status is the
 * furthest stage any action reached.
 *
 * Run: node scripts/llm/deterministic-analysis-v2.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawLog = fs.readFileSync(path.join(__dirname, 'status-log.txt'), 'utf-8');
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'classification-truth.json'), 'utf-8'));

const logLines = rawLog.split(/\r?\n/).filter(l => l.trim()).map(l => {
  const [date, chamber, ...rest] = l.split('\t');
  return { date, chamber: chamber.trim(), text: rest.join('\t') };
});

// Ordered stage vocabulary (index = progression). Long-form matches the truth file.
const STAGES = [
  ['introduced', 'Introduced/Waiting to be Scheduled for First Committee Hearing'],
  ['scheduled1', 'Scheduled for First Committee Hearing'],
  ['deferred1', 'Deferred after First Committee Hearing'],
  ['waiting2', 'Waiting to be Scheduled for Second Committee Hearing'],
  ['scheduled2', 'Scheduled for Second Committee Hearing'],
  ['deferred2', 'Deferred after Second Committee Hearing'],
  ['waiting3', 'Waiting to be Scheduled for Third Committee Hearing'],
  ['scheduled3', 'Scheduled for Third Committee Hearing'],
  ['deferred3', 'Deferred after Third Committee Hearing'],
  ['crossoverWaiting1', 'Crossover/Waiting to be Scheduled for First Committee Hearing'],
  ['crossoverScheduled1', 'Scheduled for First Committee Hearing after Crossover'],
  ['crossoverDeferred1', 'Deferred after First Committee Hearing after Crossover'],
  ['crossoverWaiting2', 'Waiting to be Scheduled for Second Committee Hearing after Crossover'],
  ['crossoverScheduled2', 'Scheduled for Second Committee Hearing after Crossover'],
  ['crossoverDeferred2', 'Deferred after Second Committee Hearing after Crossover'],
  ['crossoverWaiting3', 'Waiting to be Scheduled for Third Committee Hearing after Crossover'],
  ['crossoverScheduled3', 'Scheduled for Third Committee Hearing after Crossover'],
  ['crossoverDeferred3', 'Deferred after Third Committee Hearing after Crossover'],
  ['passedCommittees', 'Passed all Committees!'],
  ['conferenceAssigned', 'Assigned Conference Committees/Waiting to be scheduled for Conference Meeting'],
  ['conferenceScheduled', 'Scheduled for Conference Meeting'],
  ['conferenceDeferred', 'Deferred during Conference Committee'],
  ['conferencePassed', 'Passed Conference Committee'],
  ['transmittedGovernor', 'Transmitted to Governor'],
  ['vetoList', "Governor's intent to Veto List"],
  ['governorSigns', 'Governor Signs Bill Into Law'],
  ['lawWithoutSignature', 'Became law without Gov signature'],
];
const IDX = Object.fromEntries(STAGES.map(([id], i) => [id, i]));
const LABEL = Object.fromEntries(STAGES.map(([id, label]) => [id, label]));

const originChamber = 'S';

/**
 * Classify one action line to a stage id, given phase context (crossover, ordinal, bothChambers).
 * Returns a stage id or null if the line is not a stage-advancing action.
 */
function classifyLine(text, { crossover, bothChambers, ordinal }) {
  // Governor
  if (/\bAct\s+\d+/i.test(text)) return 'governorSigns';
  if (/became law without/i.test(text)) return 'lawWithoutSignature';
  if (/intent to veto/i.test(text)) return 'vetoList';
  if (/Enrolled to Governor|Transmitted to the Governor/i.test(text)) return 'transmittedGovernor';

  // Conference (only meaningful once both chambers acted)
  if (bothChambers) {
    if (/Reported from Conference Committee|Conference [Cc]ommittee recommends that the measure be PASSED/i.test(text)) return 'conferencePassed';
    if (/Conference committee meeting scheduled/i.test(text)) return 'conferenceScheduled';
    if (/Conferees Appointed|notice of (Senate|House) conferees|notice of appointment of .*conferees|notice of disagreement|disagrees with/i.test(text)) return 'conferenceAssigned';
  }

  // Passed all committees: second chamber passed final/third reading; versions differ
  if (/Received from (House|Senate).*in amended form/i.test(text)) return 'passedCommittees';
  if (/Passed (Third|Final) Reading.*Transmitted/i.test(text) && crossover) return 'passedCommittees';

  const cap = (base) => crossover ? 'crossover' + base.charAt(0).toUpperCase() + base.slice(1) : base;

  // Scheduled
  if (/scheduled to be heard|will hold a public decision making|has scheduled a public hearing|public decision making on|public hearing on \d/i.test(text))
    return cap(`scheduled${ordinal}`);
  // Deferred
  if (/be DEFERRED|deferred the measure|carried over/i.test(text))
    return cap(`deferred${ordinal}`);
  // Passed a committee / reported out -> waiting for next
  if (/recommend(s)? that the measure be PASSED|Reported from [A-Z]|Report adopted|Report Adopted|Passed Second Reading/i.test(text)) {
    const next = Math.min(ordinal + 1, 3);
    return cap(`waiting${next}`);
  }
  // Crossover landing / introduction
  if (crossover && /Received from (House|Senate)/i.test(text)) return 'crossoverWaiting1';
  if (/Referred to .*referral sheet|Referred to [A-Z]{2,}/i.test(text)) return crossover ? 'crossoverWaiting1' : 'introduced';
  if (/Pass(ed)? First Reading|Introduced/i.test(text)) return crossover ? 'crossoverWaiting1' : 'introduced';
  return null;
}

/**
 * Given the full suffix (newest first), compute per-line context and return the
 * MOST-ADVANCED (max index) stage matched across all lines.
 */
function classify(suffix) {
  const chambersSeen = new Set(suffix.map(r => r.chamber));
  const bothChambers = chambersSeen.has('H') && chambersSeen.has('S');
  const newestChamber = suffix[0].chamber;
  const crossoverNow = newestChamber !== originChamber;

  // Build committee referral order per phase from the chronological log.
  const chron = [...suffix].reverse();
  const referralOrder = { S: [], H: [] };
  for (const r of chron) {
    const m = r.text.match(/[Rr]eferred to (?:the committee\(s\) on )?([A-Z]{2,3}(?:\s*,\s*[A-Z]{2,3})*)/);
    if (m) for (const c of m[1].split(/\s*,\s*/)) if (!referralOrder[r.chamber]?.includes(c)) referralOrder[r.chamber]?.push(c);
  }

  let best = 'introduced';
  for (const r of chron) {
    // Per-line crossover: has the bill crossed by the time of THIS line? Crossed once a
    // "Received from <origin-opposite chamber>" appears. Approx: line chamber != origin.
    const lineCrossover = r.chamber !== originChamber && bothChambersBefore(chron, r);
    const order = referralOrder[r.chamber] || [];
    let ordinal = 1;
    const cm = r.text.match(/\b([A-Z]{2,3})\b/g) || [];
    for (const c of cm) { const idx = order.indexOf(c); if (idx >= 0) { ordinal = Math.min(idx + 1, 3); break; } }

    const stage = classifyLine(r.text, { crossover: lineCrossover, bothChambers, ordinal });
    if (stage && IDX[stage] > IDX[best]) best = stage;
  }
  return LABEL[best];
}

// Has the bill crossed chambers at/before this line? True once a cross-chamber receipt seen.
function bothChambersBefore(chron, upto) {
  let crossed = false;
  for (const r of chron) {
    if (/Received from (House|Senate)|Transmitted to (House|Senate)/i.test(r.text)) crossed = true;
    if (r === upto) break;
  }
  return crossed;
}

let correct = 0;
const misses = [];
for (let i = 0; i < logLines.length; i++) {
  const got = classify(logLines.slice(i));
  if (got === truth[i]) correct++;
  else misses.push({ line: i + 1, text: logLines[i].text.slice(0, 60), expected: truth[i], got });
}

console.log(`\n=== DETERMINISTIC v2 (scan-all + max-stage) ===`);
console.log(`Correct: ${correct}/${logLines.length} (${(100 * correct / logLines.length).toFixed(1)}%)\n`);
for (const m of misses) {
  console.log(`L${m.line} "${m.text}..."\n    exp: ${m.expected}\n    got: ${m.got}\n`);
}
