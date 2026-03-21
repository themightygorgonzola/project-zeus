/**
 * state-drift.js — compare what the AI proposed vs what was actually applied
 *
 * Flags turns where:
 *   • The AI proposed a state change that wasn't applied (lost)
 *   • A state change was applied that the AI didn't propose (engine-injected)
 *   • The AI produced no proposals at all despite a mechanic-heavy action
 *
 * Usage:  node scripts/diag/state-drift.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc = D.load(D.cliFile());
const all = D.turns(doc);

D.header('STATE DRIFT — Proposed vs Applied');

let lostCount = 0;
let injectedCount = 0;
let emptyGmCount = 0;

console.log('\n  Scanning all full-gm turns…\n');

for (const turn of all) {
  if (turn.mode !== 'full-gm') continue;

  const { proposedOnly, appliedOnly } = D.diffChanges(turn);
  const aiEmpty = !turn.gmProposedChanges || Object.keys(turn.gmProposedChanges).length === 0;

  const hasDrift = proposedOnly.length > 0 || appliedOnly.length > 0;

  if (hasDrift) {
    console.log(`  ${D.t(turn)}`);
    console.log(`    Action: ${D.trunc(turn.action, 70)}`);

    if (proposedOnly.length > 0) {
      lostCount += proposedOnly.length;
      console.log(`    ❌ PROPOSED but NOT applied: ${proposedOnly.join(', ')}`);
    }
    if (appliedOnly.length > 0) {
      injectedCount += appliedOnly.length;
      console.log(`    ⚙️  Applied but NOT proposed (engine): ${appliedOnly.join(', ')}`);
    }
    console.log('');
  }

  // Flag turns where the GM returned empty stateChanges despite seeming to do something
  if (aiEmpty && isActionWithExpectedEffect(turn.action, turn.intent)) {
    emptyGmCount++;
    if (!hasDrift) {
      console.log(`  ${D.t(turn)}`);
      console.log(`    Action: ${D.trunc(turn.action, 70)}`);
    }
    console.log(`    ⚠️  GM returned empty stateChanges (possibly missed mechanic)`);
    console.log('');
  }
}

D.divider('Summary');
console.log(`  Proposed-but-lost fields   : ${lostCount}`);
console.log(`  Engine-injected fields     : ${injectedCount}`);
console.log(`  Empty-GM suspicious turns  : ${emptyGmCount}`);
console.log('');

// Heuristic: was this an action type that usually produces state changes?
function isActionWithExpectedEffect(action, intent) {
  if (['attack', 'cast-spell', 'use-item', 'drop-item'].includes(intent)) return true;
  const lower = (action ?? '').toLowerCase();
  return /\b(kill|slay|defeat|take|pick up|buy|sell|gain|receive|loot|award|heal|damage|hurt|wound)\b/.test(lower);
}
