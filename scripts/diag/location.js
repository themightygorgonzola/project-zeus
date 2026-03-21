/**
 * location.js — Location movement timeline
 *
 * Tracks every locationChange, flags narrative movement with no applied change,
 * shows visit frequency, and orphan locations never referenced during play.
 *
 * Usage:  node scripts/diag/location.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc   = D.load(D.cliFile());
const all   = D.turns(doc);
const locs  = D.locationMap(doc);

D.header('LOCATION AUDIT');

// ── Timeline ────────────────────────────────────────────────────────────────
D.divider('Movement Timeline');
const moveTurns = D.withChange(doc, 'locationChange');
if (moveTurns.length === 0) {
  console.log('  No locationChange applied in any turn.');
} else {
  for (const turn of moveTurns) {
    const lc = turn.appliedStateChanges?.locationChange;
    if (!lc) continue;
    const from = locs[lc.from] ?? lc.from ?? '(unknown)';
    const to   = locs[lc.to]   ?? lc.to   ?? '(unknown)';
    const proposed = turn.gmProposedChanges?.stateChanges?.locationChange;
    const proposedTo = proposed ? (locs[proposed.to] ?? proposed.to) : null;
    const diverge = proposedTo && proposedTo !== to ? `  ⚠️ AI said→${proposedTo}` : '';
    console.log(`  Turn #${String(turn.turnNumber).padStart(2,' ')}  ${from.padEnd(22,' ')} → ${to}${diverge}`);
  }
}

// ── Narrative movement without locationChange ────────────────────────────────
D.divider('Narrative movement with no locationChange applied');
const travelWords = /\b(travel(l?ed|ing)?|walk(ed|ing)|arriv(ed|ing)|enter(ed|ing)|head(ed|ing) (to|toward|into)|move[sd]? (to|toward|into)|leav(es|ing)|left (the|for))\b/i;

let flaggedMove = 0;
for (const turn of all) {
  const sc = turn.appliedStateChanges;
  const hasAppliedMove = sc?.locationChange != null;
  if (hasAppliedMove) continue;

  const narrative = turn.narrativeText ?? '';
  if (travelWords.test(narrative)) {
    console.log(`  Turn #${String(turn.turnNumber).padStart(2,' ')}  [${(turn.intent ?? '').padEnd(12,' ')}]  ${D.trunc(narrative, 70)}`);
    flaggedMove++;
  }
}
if (flaggedMove === 0) console.log('  None detected.');

// ── Visit frequency ──────────────────────────────────────────────────────────
D.divider('Location visit frequency');
const visits = {};
const allLocIds = Object.keys(locs);
for (const id of allLocIds) visits[id] = 0;

for (const turn of moveTurns) {
  const to = turn.appliedStateChanges?.locationChange?.to;
  if (to) visits[to] = (visits[to] ?? 0) + 1;
}

// Count starting location as one visit
const firstLoc = doc.finalState?.partyLocationId;
if (firstLoc) {
  // Check where the party started (before any moves) by finding first move's `from`
  const firstMove = moveTurns[0]?.appliedStateChanges?.locationChange?.from;
  if (firstMove) visits[firstMove] = (visits[firstMove] ?? 0) + 1;
}

const maxVisits = Math.max(1, ...Object.values(visits));
for (const id of allLocIds) {
  const name = locs[id];
  const count = visits[id] ?? 0;
  const b = D.bar(count, maxVisits, 20);
  console.log(`  ${b} ${String(count).padStart(2,' ')}  ${name}`);
}

// ── Orphan locations ─────────────────────────────────────────────────────────
D.divider('Orphan locations (0 visits, never referenced in narrative)');
const allNarratives = all.map(t => t.narrativeText ?? '').join(' ');
let orphans = 0;
for (const id of allLocIds) {
  if ((visits[id] ?? 0) > 0) continue;
  const name = locs[id];
  const mentionedByName = name && allNarratives.toLowerCase().includes(name.toLowerCase());
  const mentionedById   = allNarratives.includes(id);
  if (!mentionedByName && !mentionedById) {
    console.log(`  🏚  ${name} (${id})`);
    orphans++;
  }
}
if (orphans === 0) console.log('  None.');

D.divider('Summary');
console.log(`  Total locationChange turns : ${moveTurns.length}`);
console.log(`  Flagged narrative moves    : ${flaggedMove}`);
console.log(`  Orphan locations           : ${orphans}`);
console.log('');
