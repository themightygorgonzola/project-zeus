/**
 * summary.js — adventure overview
 *
 * Usage:  node scripts/diag/summary.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc   = D.load(D.cliFile());
const all   = D.turns(doc);
const chars = D.charMap(doc);
const adv   = doc.adventure;
const state = doc.finalState;

D.header(`ADVENTURE SUMMARY — ${adv.name}`);

// ─── Basic meta ──────────────────────────────────────────────────────────
console.log(`\n  ID          : ${adv.id}`);
console.log(`  Status      : ${adv.status}`);
console.log(`  Mode        : ${adv.mode}`);
console.log(`  Created     : ${adv.createdAt}`);
console.log(`  Exported    : ${doc.exportedAt}`);
console.log(`  Members     : ${doc.members.map(m => `${m.username} (${m.role})`).join(', ')}`);

// ─── Turn counts ─────────────────────────────────────────────────────────
D.divider('Turns');
const total = all.length;
const byMode = {};
const byIntent = {};
const byStatus = {};
let totalLatency = 0;
let latencyCount = 0;

for (const turn of all) {
  byMode[turn.mode]   = (byMode[turn.mode]   ?? 0) + 1;
  byIntent[turn.intent] = (byIntent[turn.intent] ?? 0) + 1;
  byStatus[turn.status] = (byStatus[turn.status] ?? 0) + 1;
  if (turn.latencyMs != null) { totalLatency += turn.latencyMs; latencyCount++; }
}

console.log(`\n  Total turns : ${total}`);
console.log(`  Avg latency : ${D.fmtMs(latencyCount ? Math.round(totalLatency / latencyCount) : null)}`);
console.log(`  Total latency: ${D.fmtMs(totalLatency)}`);

console.log('\n  By mode:');
for (const [k, v] of Object.entries(byMode).sort((a,b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(14,' ')} ${D.bar(v, total)} ${v}`);
}

console.log('\n  By intent:');
for (const [k, v] of Object.entries(byIntent).sort((a,b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(14,' ')} ${D.bar(v, total)} ${v}`);
}

console.log('\n  By status:');
for (const [k, v] of Object.entries(byStatus)) {
  console.log(`    ${k.padEnd(14,' ')} ${v}`);
}

// ─── Characters ───────────────────────────────────────────────────────────
D.divider('Characters (final state)');
for (const c of (state?.characters ?? [])) {
  const cls = c.classes?.map(cl => `${cl.name} ${cl.level}`).join('/') ?? '—';
  const totalXp = c.xp ?? 0;
  const conditions = c.conditions?.length ? ` [${c.conditions.join(', ')}]` : '';
  console.log(`\n  ${c.name} (${c.race} ${cls})`);
  console.log(`    HP     : ${c.hp}/${c.maxHp}${conditions}`);
  console.log(`    AC     : ${c.ac}`);
  console.log(`    XP     : ${totalXp}`);
  const gear = (c.inventory ?? [])
    .filter(i => i.category !== 'misc' || i.equipped)
    .map(i => `${i.name}${i.equipped ? '*' : ''}`)
    .slice(0, 10).join(', ');
  console.log(`    Gear   : ${gear || '(none)'}`);
  console.log(`    Items  : ${(c.inventory ?? []).length} total in inventory`);
}

// ─── World ────────────────────────────────────────────────────────────────
D.divider('World (final state)');
console.log(`  Locations   : ${(state?.locations ?? []).length} total`);
const visited = (state?.locations ?? []).filter(l => l.visited);
console.log(`  Visited     : ${visited.map(l => l.name).join(', ') || '(none)'}`);
console.log(`  NPCs        : ${(state?.npcs ?? []).length} total (${(state?.npcs ?? []).filter(n => !n.alive).length} dead)`);
console.log(`  Quests      : ${(state?.quests ?? []).length} total`);
for (const q of (state?.quests ?? [])) {
  const done = (q.objectives ?? []).filter(o => o.done).length;
  const total = (q.objectives ?? []).length;
  console.log(`    [${q.status.padEnd(9,' ')}] ${q.name} (${done}/${total} objectives)`);
}
console.log(`  Party at    : ${D.locationMap(doc)[state?.partyLocationId] ?? state?.partyLocationId ?? '?'}`);
console.log(`  Clock       : Day ${state?.clock?.day}, ${state?.clock?.timeOfDay}, ${state?.clock?.weather}`);

// ─── State changes summary ────────────────────────────────────────────────
D.divider('State change totals across all turns');
const fields = ['hpChanges','xpAwarded','itemsGained','itemsLost','locationChange',
                'questUpdates','npcChanges','conditionsApplied','encounterStarted',
                'encounterEnded','npcsAdded','locationsAdded','questsAdded','clockAdvance'];

for (const f of fields) {
  const matching = D.withChange(doc, f);
  if (matching.length > 0)
    console.log(`  ${f.padEnd(22,' ')} ${matching.length} turns`);
}

// ─── Slowest turns ────────────────────────────────────────────────────────
D.divider('Slowest AI turns (top 5)');
const sorted = [...all].filter(t => t.latencyMs).sort((a, b) => b.latencyMs - a.latencyMs);
for (const turn of sorted.slice(0, 5)) {
  console.log(`  ${D.t(turn)}  ${D.fmtMs(turn.latencyMs).padEnd(8,' ')}  ${D.trunc(turn.action, 55)}`);
}

console.log('');
