/**
 * quests.js — Quest and objective audit
 *
 * Lists all quests, when each questUpdate happened, flags objectives that were
 * never touched, and tries to spot organically-completed objectives that the
 * AI never marked done.
 *
 * Usage:  node scripts/diag/quests.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc    = D.load(D.cliFile());
const all    = D.turns(doc);
const qMap   = D.questMap(doc);
const npcMap = D.npcMap(doc);

D.header('QUEST AUDIT');

// ── Build quest update log ───────────────────────────────────────────────────
// Collect every questUpdates and questsAdded entry with their turn number
const updateLog   = {}; // questId → [{turn, type, objectiveId?, done?}]
const addedOnTurn = {}; // questId → turnNumber

for (const turn of all) {
  const sc = turn.appliedStateChanges;
  if (!sc) continue;

  for (const qa of (sc.questsAdded ?? [])) {
    addedOnTurn[qa.questId ?? qa.id] = turn.turnNumber;
  }

  for (const qu of (sc.questUpdates ?? [])) {
    const qid = qu.questId;
    if (!updateLog[qid]) updateLog[qid] = [];
    updateLog[qid].push({
      turn: turn.turnNumber,
      objectiveId: qu.objectiveId,
      done: qu.done,
      stateUpdate: qu.questStateUpdate,
    });
  }
}

// ── Per-quest breakdown ──────────────────────────────────────────────────────
D.divider('Quest breakdown');
const quests = doc.finalState?.quests ?? [];

if (quests.length === 0) {
  console.log('  No quests in finalState.');
} else {
  for (const q of quests) {
    const addedT  = addedOnTurn[q.id] != null ? ` (added turn #${addedOnTurn[q.id]})` : '';
    const status  = q.status ?? 'unknown';
    const icon    = status === 'completed' ? '✅' : status === 'failed' ? '❌' : '🔵';
    console.log(`\n  ${icon} ${q.name ?? q.id}  [${status}]${addedT}`);
    if (q.description) console.log(`     ${D.trunc(q.description, 90)}`);

    const objectives = q.objectives ?? [];
    for (const obj of objectives) {
      const doneIcon = obj.done ? '  ✔' : '  ○';
      const updates  = (updateLog[q.id] ?? []).filter(u => u.objectiveId === obj.id);
      const turns    = updates.length
        ? `  [updated turns: ${updates.map(u => u.turn).join(', ')}]`
        : '  [NEVER updated]';
      console.log(`       ${doneIcon} ${obj.description ?? obj.id}${turns}`);
    }

    const questUpdates = updateLog[q.id] ?? [];
    if (questUpdates.length === 0 && objectives.length === 0) {
      console.log('       ⚠️  No objectives and no questUpdates — quest was never touched by AI');
    }
  }
  console.log('');
}

// ── Objectives never updated ─────────────────────────────────────────────────
D.divider('Objectives NEVER updated (potential tracking failure)');
let neverUpdated = 0;
for (const q of quests) {
  for (const obj of (q.objectives ?? [])) {
    const updates = (updateLog[q.id] ?? []).filter(u => u.objectiveId === obj.id);
    if (updates.length === 0 && !obj.done) {
      console.log(`  Quest: ${q.name ?? q.id}  →  "${obj.description ?? obj.id}"`);
      neverUpdated++;
    }
  }
}
if (neverUpdated === 0) console.log('  All objectives were updated at least once (or are complete).');

// ── Infer potential missed completions ───────────────────────────────────────
// If the quest description / objective mentions an NPC and that NPC is now dead
D.divider('Possible missed quest completions (dead NPCs referenced in objectives)');
const npcs = doc.finalState?.npcs ?? [];
const deadNpcs = npcs.filter(n => n.alive === false);
let possibleMissed = 0;

for (const q of quests) {
  if (q.status === 'completed') continue;
  const qText = [q.name, q.description, ...(q.objectives ?? []).map(o => o.description)].join(' ').toLowerCase();
  for (const dead of deadNpcs) {
    const nname = (dead.name ?? '').toLowerCase();
    if (nname.length > 2 && qText.includes(nname)) {
      console.log(`  Quest "${q.name ?? q.id}" references dead NPC "${dead.name}" but is not completed`);
      possibleMissed++;
    }
  }
}
if (possibleMissed === 0) console.log('  None detected.');

// ── questsAdded per turn ─────────────────────────────────────────────────────
D.divider('Quests added per turn');
const questsAddedTurns = D.withChange(doc, 'questsAdded');
if (questsAddedTurns.length === 0) {
  console.log('  No questsAdded found in appliedStateChanges.');
} else {
  for (const turn of questsAddedTurns) {
    for (const qa of (turn.appliedStateChanges?.questsAdded ?? [])) {
      const name = qMap[qa.questId ?? qa.id] ?? qa.name ?? qa.questId ?? qa.id;
      console.log(`  Turn #${turn.turnNumber}: "${name}"`);
    }
  }
}

D.divider('Summary');
console.log(`  Total quests         : ${quests.length}`);
console.log(`  Completed            : ${quests.filter(q => q.status === 'completed').length}`);
console.log(`  Active               : ${quests.filter(q => q.status === 'active').length}`);
console.log(`  Never-updated objs   : ${neverUpdated}`);
console.log(`  Possible missed comp : ${possibleMissed}`);
console.log('');
