/**
 * issues.js — AI failure pattern detector
 *
 * One-stop triage report: prose-only responses, broken JSON, character breaks,
 * hallucinated IDs, instant combats, duplicate NPC IDs, kill/death mismatches,
 * location hallucinations, and more.
 *
 * Usage:  node scripts/diag/issues.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc   = D.load(D.cliFile());
const all   = D.turns(doc);
const chars = D.charMap(doc);
const locs  = D.locationMap(doc);
const npcMap = D.npcMap(doc);

D.header('AI FAILURE / ISSUE REPORT');

let totalIssues = 0;

function issue(label, items) {
  D.divider(label);
  if (items.length === 0) {
    console.log('  ✅ None detected.');
  } else {
    for (const s of items) console.log('  ' + s);
    totalIssues += items.length;
  }
}

// ── 1. Prose-only (non-JSON) responses ──────────────────────────────────────
const proseOnlyIssues = [];
for (const turn of all) {
  if (D.aiReturnedProse(turn)) {
    const snippet = D.trunc(String(turn.rawAiResponse ?? '').trim().replace(/\n/g, ' '), 70);
    proseOnlyIssues.push(`Turn #${turn.turnNumber} [${turn.mode}/${turn.intent}]: "${snippet}"`);
  }
}
issue('Turns where AI returned prose instead of valid GM JSON', proseOnlyIssues);

// ── 2. Markdown code fences in raw response ─────────────────────────────────
const fenceIssues = [];
for (const turn of all) {
  const raw = String(turn.rawAiResponse ?? '');
  if (raw.includes('```')) {
    fenceIssues.push(`Turn #${turn.turnNumber}: rawAiResponse contains markdown code fences`);
  }
}
issue('Turns with markdown fences (```json) in rawAiResponse', fenceIssues);

// ── 3. Apology / character-break in narrative or AI response ────────────────
const apologyPattern = /i'?m\s+(sorry|apologize|unable|not\s+able)|as\s+an?\s+(ai|language\s+model)|i\s+cannot\s+(assist|help|generate)|please\s+note\s+that\s+i/i;
const apologiesIssues = [];
for (const turn of all) {
  const raw       = String(turn.rawAiResponse ?? '');
  const narrative = String(turn.narrativeText ?? '');
  if (apologyPattern.test(raw) || apologyPattern.test(narrative)) {
    const text = D.trunc((apologyPattern.test(raw) ? raw : narrative).replace(/\n/g, ' '), 70);
    apologiesIssues.push(`Turn #${turn.turnNumber} [${turn.mode}]: "${text}"`);
  }
}
issue('AI apologies / character breaks', apologiesIssues);

// ── 4. Instant combats (encounterStarted + encounterEnded same turn) ────────
const instantCombatIssues = [];
for (const turn of all) {
  const sc = turn.appliedStateChanges;
  if (sc?.encounterStarted != null && sc?.encounterEnded != null) {
    instantCombatIssues.push(`Turn #${turn.turnNumber}: encounterStarted AND encounterEnded in same turn — instant combat`);
  }
}
issue('Instant combats (encounterStarted + encounterEnded same turn)', instantCombatIssues);

// ── 5. Hallucinated location IDs ────────────────────────────────────────────
const validLocIds = new Set(Object.keys(locs));
const locHallucinationIssues = [];
for (const turn of all) {
  const lc = turn.appliedStateChanges?.locationChange;
  if (lc) {
    if (lc.from && !validLocIds.has(lc.from)) {
      locHallucinationIssues.push(`Turn #${turn.turnNumber}: locationChange.from="${lc.from}" is unknown`);
    }
    if (lc.to && !validLocIds.has(lc.to)) {
      locHallucinationIssues.push(`Turn #${turn.turnNumber}: locationChange.to="${lc.to}" is unknown`);
    }
  }
  // Also check proposed
  const plc = turn.gmProposedChanges?.stateChanges?.locationChange;
  if (plc) {
    if (plc.to && !validLocIds.has(plc.to)) {
      locHallucinationIssues.push(`Turn #${turn.turnNumber}: PROPOSED locationChange.to="${plc.to}" is unknown (not applied?)`);
    }
  }
}
issue('Hallucinated location IDs in locationChange', locHallucinationIssues);

// ── 6. Hallucinated character IDs in hpChanges ──────────────────────────────
const validCharIds = new Set([
  ...Object.keys(chars),
  ...Object.keys(npcMap),
  // Also include encounter combatant IDs from finalState
  ...(doc.finalState?.activeEncounter?.combatants ?? []).map(c => c.id),
]);
const charHallucinationIssues = [];
for (const turn of all) {
  for (const hp of (turn.appliedStateChanges?.hpChanges ?? [])) {
    if (hp.characterId && !validCharIds.has(hp.characterId)) {
      charHallucinationIssues.push(`Turn #${turn.turnNumber}: hpChange for unknown characterId="${hp.characterId}"`);
    }
  }
}
issue('Hallucinated character IDs in hpChanges', charHallucinationIssues);

// ── 7. Kill/death narrative without npcChanges alive→false ──────────────────
const killNarrative = /\b(kill(s|ed|ing)?|slay(s|ing)?|slew|slain|dead|dies|died|defeated|destroyed)\b/i;
const killMismatchIssues = [];
for (const turn of all) {
  const narrative  = String(turn.narrativeText ?? '');
  const hasKillNarrative = killNarrative.test(narrative);
  const hasNpcDeath = (turn.appliedStateChanges?.npcChanges ?? []).some(
    nc => nc.field === 'alive' && nc.newValue === false
  );
  if (hasKillNarrative && !hasNpcDeath) {
    killMismatchIssues.push(
      `Turn #${turn.turnNumber} [${turn.intent}]: narrative implies kill but no npcChange alive→false` +
      `\n     "${D.trunc(narrative.replace(/\n/g,' '), 80)}"`
    );
  }
}
issue('Kill narrative without NPC alive→false change', killMismatchIssues);

// ── 8. Duplicate NPC IDs across turns (same NPC added twice) ─────────────────
const seenNpcIds = new Set();
const dupNpcIssues = [];
for (const turn of all) {
  for (const na of (turn.appliedStateChanges?.npcsAdded ?? [])) {
    const nid = na.npcId ?? na.id;
    if (nid && seenNpcIds.has(nid)) {
      dupNpcIssues.push(`Turn #${turn.turnNumber}: NPC "${na.name ?? nid}" (${nid}) added again (duplicate)`);
    } else if (nid) {
      seenNpcIds.add(nid);
    }
  }
}
issue('Duplicate NPCs added across turns', dupNpcIssues);

// ── 9. Empty stateChanges on action-heavy turns ──────────────────────────────
const emptyActionIssues = [];
const actionIntents = ['attack', 'loot', 'travel', 'use_item', 'cast_spell'];
for (const turn of all) {
  if (!actionIntents.includes(turn.intent)) continue;
  const sc = turn.appliedStateChanges;
  if (!sc) {
    emptyActionIssues.push(`Turn #${turn.turnNumber} [${turn.intent}]: NO appliedStateChanges at all`);
    continue;
  }
  const hasAnything = ['hpChanges','xpAwarded','itemsGained','itemsLost',
    'npcChanges','locationChange','questUpdates']
    .some(f => Array.isArray(sc[f]) ? sc[f].length > 0 : sc[f] != null);
  if (!hasAnything) {
    emptyActionIssues.push(`Turn #${turn.turnNumber} [${turn.intent}]: appliedStateChanges has no meaningful fields`);
  }
}
issue('Action turns with empty appliedStateChanges', emptyActionIssues);

// ── 10. Double-brace / malformed JSON patterns in rawAiResponse ──────────────
const malformedJsonIssues = [];
for (const turn of all) {
  const raw = String(turn.rawAiResponse ?? '');
  if (/\}{2,}/.test(raw) && !/^[\s\S]*\{[\s\S]*\}[\s\S]*$/.test(raw.trim().replace(/\}{3,}/g, '}'))) {
    malformedJsonIssues.push(`Turn #${turn.turnNumber}: rawAiResponse has extra closing braces`);
  }
}
issue('Double/extra-brace malformed JSON in rawAiResponse', malformedJsonIssues);

// ── Final Tally ─────────────────────────────────────────────────────────────
D.divider('TOTAL ISSUES DETECTED');
console.log(`  ${totalIssues === 0 ? '✅ 0 issues detected!' : `❌ ${totalIssues} issue(s) across ${all.length} turns`}`);
console.log('');
