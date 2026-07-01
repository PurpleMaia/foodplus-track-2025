/**
 * ANALYSIS PROTOTYPE — not production code.
 * Replays the labeled truth set (status-log.txt + classification-truth.json) through a
 * DETERMINISTIC pattern-table classifier and reports accuracy vs the human labels.
 *
 * The truth set is one bill (SB-origin, crosses to House, goes to conference, to Governor).
 * Row i's label = classification when the newest line is status-log line i (0-based),
 * i.e. we classify the log SUFFIX starting at line i (newest-first ordering).
 *
 * Run: node scripts/llm/deterministic-analysis.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawLog = fs.readFileSync(path.join(__dirname, 'status-log.txt'), 'utf-8');
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'classification-truth.json'), 'utf-8'));

// Parse "MM/DD/YYYY\tCHAMBER\ttext"
const logLines = rawLog.split(/\r?\n/).filter(l => l.trim()).map(l => {
  const [date, chamber, ...rest] = l.split('\t');
  return { date, chamber: chamber.trim(), text: rest.join('\t') };
});

// Committee order for THIS bill. Originating chamber (Senate) committees: AEN, WAM.
// After crossover to House: AGR, ECD, FIN (referral sheet 18).
// The classifier does NOT hardcode these — it reads referral order from the log itself.

// ---- Normalized label vocabulary (maps to the truth-file long-form strings) ----
const L = {
  introduced: 'Introduced/Waiting to be Scheduled for First Committee Hearing',
  scheduled1: 'Scheduled for First Committee Hearing',
  deferred1: 'Deferred after First Committee Hearing',
  waiting2: 'Waiting to be Scheduled for Second Committee Hearing',
  scheduled2: 'Scheduled for Second Committee Hearing',
  deferred2: 'Deferred after Second Committee Hearing',
  waiting3: 'Waiting to be Scheduled for Third Committee Hearing',
  scheduled3: 'Scheduled for Third Committee Hearing',
  deferred3: 'Deferred after Third Committee Hearing',
  crossoverWaiting1: 'Crossover/Waiting to be Scheduled for First Committee Hearing',
  crossoverScheduled1: 'Scheduled for First Committee Hearing after Crossover',
  crossoverDeferred1: 'Deferred after First Committee Hearing after Crossover',
  crossoverWaiting2: 'Waiting to be Scheduled for Second Committee Hearing after Crossover',
  crossoverScheduled2: 'Scheduled for Second Committee Hearing after Crossover',
  crossoverDeferred2: 'Deferred after Second Committee Hearing after Crossover',
  crossoverWaiting3: 'Waiting to be Scheduled for Third Committee Hearing after Crossover',
  crossoverScheduled3: 'Scheduled for Third Committee Hearing after Crossover',
  crossoverDeferred3: 'Deferred after Third Committee Hearing after Crossover',
  passedCommittees: 'Passed all Committees!',
  conferenceAssigned: 'Assigned Conference Committees/Waiting to be scheduled for Conference Meeting',
  conferenceScheduled: 'Scheduled for Conference Meeting',
  conferenceDeferred: 'Deferred during Conference Committee',
  conferencePassed: 'Passed Conference Committee',
  transmittedGovernor: 'Transmitted to Governor',
  vetoList: "Governor's intent to Veto List",
  governorSigns: 'Governor Signs Bill Into Law',
  lawWithoutSignature: 'Became law without Gov signature',
};

const originChamber = 'S'; // SB bill

/**
 * Deterministic classifier. Input: the log suffix (newest first) starting at cursor `i`.
 * Returns a normalized long-form label. Pure pattern-matching — no AI.
 */
function classify(suffix) {
  const newest = suffix[0];
  const text = newest.text;
  const allText = suffix.map(r => r.text).join('\n');
  const chambersSeen = new Set(suffix.map(r => r.chamber));
  const bothChambers = chambersSeen.has('H') && chambersSeen.has('S');
  // Crossover = newest activity chamber differs from originating chamber
  const crossover = newest.chamber !== originChamber;

  // ---- Step 1: GOVERNOR (highest priority) ----
  if (/\bAct\s+\d+/i.test(text)) return L.governorSigns;
  if (/became law without/i.test(text)) return L.lawWithoutSignature;
  if (/intent to veto/i.test(text)) return L.vetoList;
  if (/Enrolled to Governor|Transmitted to the Governor/i.test(text)) return L.transmittedGovernor;

  // ---- Step 2: CONFERENCE (only if both chambers acted) ----
  if (bothChambers) {
    // Reported from Conference Committee ... = passed conference
    if (/Reported from Conference Committee/i.test(text)) return L.conferencePassed;
    if (/Conference [Cc]ommittee recommends that the measure be PASSED/i.test(text)) return L.conferencePassed;
    // Conference meeting scheduled
    if (/Conference committee meeting scheduled/i.test(text)) return L.conferenceScheduled;
    // 48 hours notice while in conference (both chambers, after conferees) = scheduled
    // Conferees appointed / received notice of conferees = assigned, waiting
    if (/Conferees Appointed|notice of (Senate|House) conferees|notice of appointment of .* conferees/i.test(text))
      return L.conferenceAssigned;
    // Disagreement noted -> heading into conference assignment
    if (/disagree|Received notice of disagreement/i.test(text)) return L.conferenceAssigned;
  }

  // ---- Passed all committees: passed final/third reading in the SECOND chamber, pre-conference ----
  // "Received from <chamber> ... in amended form" => both passed, versions differ => passed all committees
  if (/Received from (House|Senate).*in amended form/i.test(text)) return L.passedCommittees;
  // Passed Third Reading + Transmitted (in the crossed-to chamber) => passed all committees
  if (/Passed Third Reading.*Transmitted/i.test(text) && crossover) return L.passedCommittees;
  if (/Report Adopted; Passed Third Reading.*Transmitted/i.test(text)) return L.passedCommittees;

  // ---- Committee-stage classification ----
  // Determine committee ordinal from referral order within the CURRENT chamber phase.
  const phaseChamber = crossover ? 'H' : 'S'; // simplistic: crossed-to chamber is House here
  const ordinal = committeeOrdinal(suffix, phaseChamber, crossover);

  const prefix = crossover ? 'crossover' : '';
  const cap = (s) => prefix ? 'crossover' + s.charAt(0).toUpperCase() + s.slice(1) : s;

  // Scheduled: hearing/decision-making scheduled
  if (/scheduled to be heard|scheduled (a )?public hearing|will hold a public decision making|has scheduled a public hearing|public decision making on/i.test(text)) {
    return L[cap(`scheduled${ordinal}`)] || L.introduced;
  }
  // Deferred
  if (/deferred|recommend that the measure be DEFERRED|carried over/i.test(text)) {
    return L[cap(`deferred${ordinal}`)] || L.introduced;
  }
  // Passed committee / reported out / report adopted -> waiting for NEXT committee
  if (/recommend(s)? that the measure be PASSED|Reported from|Report adopted|Report Adopted/i.test(text)) {
    const next = Math.min(ordinal + 1, 3);
    // If this was the last committee, waiting stays at next but bill effectively awaits floor.
    return L[cap(`waiting${next}`)] || L[cap(`waiting2`)];
  }
  // Passed Second Reading and referred -> waiting for next committee
  if (/Passed Second Reading.*referred|referred to the committee/i.test(text)) {
    const next = Math.min(ordinal + 1, 3);
    return L[cap(`waiting${next}`)] || L[cap(`waiting2`)];
  }

  // ---- Introduction / crossover landing ----
  if (crossover && /Received from (House|Senate)/i.test(text)) return L.crossoverWaiting1;
  if (/Referred to .*referral sheet|Referred to [A-Z]{2,}/i.test(text))
    return crossover ? L.crossoverWaiting1 : L.introduced;
  if (/Pass(ed)? First Reading|Introduced/i.test(text))
    return crossover ? L.crossoverWaiting1 : L.introduced;

  return crossover ? L.crossoverWaiting1 : L.introduced;
}

/**
 * Compute which committee (1/2/3) the newest action refers to, by counting DISTINCT
 * committees referred/heard within the current chamber phase, in the log.
 * Reads referral order from the log — no hardcoded committee list.
 */
function committeeOrdinal(suffix, phaseChamber, crossover) {
  // Collect committee mentions oldest->newest within this phase.
  const chron = [...suffix].reverse().filter(r => (crossover ? r.chamber === 'H' : r.chamber === 'S'));
  // Extract committee acronyms from referral lines: "Referred to AEN, WAM" / "referred to FIN"
  const order = [];
  for (const r of chron) {
    const m = r.text.match(/[Rr]eferred to (?:the committee\(s\) on )?([A-Z]{2,3}(?:\s*,\s*[A-Z]{2,3})*)/);
    if (m) {
      for (const c of m[1].split(/\s*,\s*/)) if (!order.includes(c)) order.push(c);
    }
  }
  // Which committee does the newest line mention?
  const newest = suffix[0].text;
  const cm = newest.match(/\b([A-Z]{2,3})\b/g) || [];
  for (const c of cm) {
    const idx = order.indexOf(c);
    if (idx >= 0) return Math.min(idx + 1, 3);
  }
  // Fallback: count how many committees already reported/passed to infer position.
  return 1;
}

// ---- Run the replay ----
let correct = 0;
const misses = [];
for (let i = 0; i < logLines.length; i++) {
  const suffix = logLines.slice(i);
  const expected = truth[i];
  const got = classify(suffix);
  if (got === expected) correct++;
  else misses.push({ line: i + 1, date: logLines[i].date, chamber: logLines[i].chamber, text: logLines[i].text.slice(0, 70), expected, got });
}

console.log(`\n=== DETERMINISTIC CLASSIFIER ACCURACY ===`);
console.log(`Correct: ${correct}/${logLines.length} (${(100 * correct / logLines.length).toFixed(1)}%)\n`);
console.log(`=== MISSES (${misses.length}) ===`);
for (const m of misses) {
  console.log(`L${m.line} [${m.chamber}] "${m.text}..."`);
  console.log(`    expected: ${m.expected}`);
  console.log(`    got:      ${m.got}\n`);
}
