/**
 * combat.js — encounter audit
 *
 * Shows every encounter that started/ended, creatures involved,
 * outcomes, XP awarded per combat, and flags mismatched start/end pairs.
 *
 * Usage:  node scripts/diag/combat.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc  = D.load(D.cliFile());
const all  = D.turns(doc);
const chars = D.charMap(doc);

D.header('COMBAT AUDIT');

// Walk turns and pair encounterStarted → encounterEnded
const encounters = [];
let openEncounter = null;

for (const turn of all) {
  const sc = turn.appliedStateChanges;
  if (!sc) continue;

  // Only track encounters that were actually applied (not stripped proposals)
  const started = sc.encounterStarted ?? null;
  const ended   = sc.encounterEnded   ?? null;

  if (started) {
    if (openEncounter) {
      // Previous encounter never closed
      openEncounter.endTurn = turn.turnNumber - 1;
      openEncounter.outcome = 'NEVER_CLOSED';
      encounters.push(openEncounter);
    }
    openEncounter = {
      startTurn: turn.turnNumber,
      endTurn: null,
      outcome: null,
      creatures: started.creatures ?? [],
      xpTurns: [],
    };
  }

  if (openEncounter && sc.xpAwarded?.length) {
    openEncounter.xpTurns.push({ turn: turn.turnNumber, awards: sc.xpAwarded });
  }

  if (ended && openEncounter) {
    openEncounter.endTurn = turn.turnNumber;
    openEncounter.outcome = ended.outcome;
    encounters.push(openEncounter);
    openEncounter = null;
  }
}

if (openEncounter) {
  openEncounter.outcome = 'NEVER_CLOSED';
  encounters.push(openEncounter);
}

// Find attack turns that happened outside any open encounter
// (an encounter is "open" from the turn with encounterStarted until
// the turn with encounterEnded)
const attackTurnsWithoutEncounter = [];
{
  let inEncounter = false;
  for (const t of all) {
    const sc = t.appliedStateChanges;
    if (sc?.encounterStarted) inEncounter = true;
    if (t.intent === 'attack' && !inEncounter) {
      attackTurnsWithoutEncounter.push(t);
    }
    if (sc?.encounterEnded) inEncounter = false;
  }
}

if (encounters.length === 0) {
  console.log('\n  No encounters found.');
} else {
  console.log(`\n  Found ${encounters.length} encounter(s):\n`);
}

for (let i = 0; i < encounters.length; i++) {
  const enc = encounters[i];
  const outcomeIcon = enc.outcome === 'victory' ? '✅'
    : enc.outcome === 'defeat' ? '💀'
    : enc.outcome === 'flee' ? '🏃'
    : enc.outcome === 'NEVER_CLOSED' ? '⚠️ '
    : '❓';

  console.log(`  Encounter ${i + 1}: turns #${enc.startTurn}–${enc.endTurn ?? '?'}  ${outcomeIcon} ${enc.outcome}`);

  if (enc.creatures.length > 0) {
    console.log(`    Creatures: ${enc.creatures.map(c => c.name).join(', ')}`);
  }

  let totalXp = 0;
  for (const xt of enc.xpTurns) {
    for (const award of xt.awards) {
      totalXp += award.amount;
      const who = chars[award.characterId] ?? award.characterId;
      console.log(`    Turn #${xt.turn}: +${award.amount} XP → ${who}`);
    }
  }
  if (enc.xpTurns.length > 0) console.log(`    Total XP from encounter: ${totalXp}`);
  else console.log(`    ⚠️  No XP awarded for this encounter`);

  console.log('');
}

if (attackTurnsWithoutEncounter.length > 0) {
  D.divider('Attack turns missing encounterStarted');
  for (const t of attackTurnsWithoutEncounter) {
    console.log(`  ${D.t(t)}  ${D.trunc(t.action, 65)}`);
  }
}

// NPC kill timeline
D.divider('NPC deaths (npcChanges alive→false)');
let killCount = 0;
for (const turn of all) {
  const kills = (turn.appliedStateChanges?.npcChanges ?? [])
    .filter(nc => nc.field === 'alive' && nc.newValue === false);
  for (const kill of kills) {
    console.log(`  Turn #${turn.turnNumber}: ${kill.npcId} killed`);
    killCount++;
  }
}
if (killCount === 0) console.log('  (none recorded)');

D.divider('Summary');
console.log(`  Total encounters tracked : ${encounters.length}`);
console.log(`  Victories                : ${encounters.filter(e => e.outcome === 'victory').length}`);
console.log(`  Never closed             : ${encounters.filter(e => e.outcome === 'NEVER_CLOSED').length}`);
console.log(`  Attack turns w/o framing : ${attackTurnsWithoutEncounter.length}`);
console.log(`  NPCs killed              : ${killCount}`);
console.log('');
