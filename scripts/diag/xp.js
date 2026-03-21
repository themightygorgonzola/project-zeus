/**
 * xp.js — XP timeline
 *
 * Shows every XP award, per-character running totals, turns where XP was
 * reasonably expected but not awarded, and compares final totals to finalState.
 *
 * Usage:  node scripts/diag/xp.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc   = D.load(D.cliFile());
const all   = D.turns(doc);
const chars = D.charMap(doc);

D.header('XP AUDIT');

const runningTotals = {};
for (const id of Object.keys(chars)) runningTotals[id] = 0;

const xpTurns = D.withChange(doc, 'xpAwarded');

D.divider('XP Timeline');
if (xpTurns.length === 0) {
  console.log('  No XP awarded in any turn.');
} else {
  for (const turn of xpTurns) {
    for (const award of (turn.appliedStateChanges?.xpAwarded ?? [])) {
      const name = chars[award.characterId] ?? award.characterId;
      runningTotals[award.characterId] = (runningTotals[award.characterId] ?? 0) + award.amount;
      const context = turn.intent === 'attack' ? 'combat' : turn.intent;
      console.log(
        `  Turn #${String(turn.turnNumber).padStart(2,' ')}  +${String(award.amount).padStart(4,' ')} XP` +
        `  →  ${name.padEnd(16,' ')}` +
        `  (running: ${runningTotals[award.characterId]})` +
        `  [${context}]`
      );
    }
  }
}

D.divider('Final XP totals: script vs finalState');
let mismatch = false;
for (const c of (doc.finalState?.characters ?? [])) {
  const computed = runningTotals[c.id] ?? 0;
  const stored   = c.xp ?? 0;
  const match    = computed === stored ? '✅' : '❌';
  console.log(`  ${match} ${c.name.padEnd(20,' ')} script computed: ${computed}  |  stored: ${stored}`);
  if (computed !== stored) {
    console.log(`     ^ Discrepancy of ${stored - computed} XP (finalState may include engine-awarded XP not in export)`);
    mismatch = true;
  }
}

D.divider('Missed XP opportunities (combat with no award)');
let missedCount = 0;
for (const turn of all) {
  const sc = turn.appliedStateChanges;
  const hadKill = (sc?.npcChanges ?? []).some(nc => nc.field === 'alive' && nc.newValue === false);
  const hadEncounterEnd = sc?.encounterEnded != null;
  const hadXp = (sc?.xpAwarded?.length ?? 0) > 0;

  if ((hadKill || hadEncounterEnd) && !hadXp) {
    console.log(`  Turn #${turn.turnNumber}: encounter/kill with no XP awarded  — ${D.trunc(turn.action, 55)}`);
    missedCount++;
  }
}
if (missedCount === 0) console.log('  None detected.');

D.divider('Summary');
const totalXp = Object.values(runningTotals).reduce((a, b) => a + b, 0);
console.log(`  Turns with XP  : ${xpTurns.length}`);
console.log(`  Total XP given : ${totalXp}`);
console.log(`  Missed chances : ${missedCount}`);
if (mismatch) console.log(`  ⚠️  XP mismatch between script totals and finalState detected`);
console.log('');
