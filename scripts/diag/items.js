/**
 * items.js — Item / inventory timeline
 *
 * Chronological log of every itemsGained / itemsLost event, per-character
 * running inventory, final reconciliation vs finalState, and flags
 * suspicious item IDs (non-ULID placeholders like "item-dagger").
 *
 * Usage:  node scripts/diag/items.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc   = D.load(D.cliFile());
const all   = D.turns(doc);
const chars = D.charMap(doc);

D.header('ITEM / INVENTORY AUDIT');

// ── Running inventory ────────────────────────────────────────────────────────
// {characterId → Map<itemId, {name, quantity}>}
const inventory = {};
for (const id of Object.keys(chars)) inventory[id] = new Map();

// Detect ULID-style IDs (26-char alphanumeric)
const isUlid = id => /^[0-9A-Z]{26}$/i.test(id);

const gainTurns = D.withChange(doc, 'itemsGained');
const loseTurns = D.withChange(doc, 'itemsLost');

// Build combined event list for chronological display
const events = [];

for (const turn of all) {
  const sc = turn.appliedStateChanges;
  if (!sc) continue;

  for (const item of (sc.itemsGained ?? [])) {
    const charName = chars[item.characterId] ?? item.characterId;
    const qty      = item.quantity ?? 1;
    const idFlag   = !isUlid(item.itemId ?? '') ? '  ⚠️ non-ULID' : '';
    events.push({ turn: turn.turnNumber, type: 'GAIN', charName, item, qty, idFlag });

    if (!inventory[item.characterId]) inventory[item.characterId] = new Map();
    const inv = inventory[item.characterId];
    const existing = inv.get(item.itemId) ?? { name: item.name, quantity: 0 };
    existing.quantity += qty;
    inv.set(item.itemId, existing);
  }

  for (const item of (sc.itemsLost ?? [])) {
    const charName = chars[item.characterId] ?? item.characterId;
    const qty      = item.quantity ?? 1;
    const idFlag   = !isUlid(item.itemId ?? '') ? '  ⚠️ non-ULID' : '';
    events.push({ turn: turn.turnNumber, type: 'LOSE', charName, item, qty, idFlag });

    if (!inventory[item.characterId]) inventory[item.characterId] = new Map();
    const inv = inventory[item.characterId];
    const existing = inv.get(item.itemId) ?? { name: item.name ?? item.itemId, quantity: 0 };
    existing.quantity = Math.max(0, existing.quantity - qty);
    inv.set(item.itemId, existing);
  }
}

D.divider('Chronological item events');
if (events.length === 0) {
  console.log('  No item events found.');
} else {
  for (const e of events) {
    const sign = e.type === 'GAIN' ? '+' : '-';
    const name = e.item.name ?? e.item.itemId ?? '(unknown)';
    console.log(
      `  Turn #${String(e.turn).padStart(2,' ')}  ${sign}${String(e.qty).padStart(2,' ')}` +
      `  ${name.padEnd(28,' ')}` +
      `  → ${e.charName}${e.idFlag}`
    );
  }
}

// ── Script-computed vs finalState ────────────────────────────────────────────
D.divider('Inventory reconciliation: script computed vs finalState');
const finalChars = doc.finalState?.characters ?? [];
let totalMismatch = 0;

for (const c of finalChars) {
  const computed = inventory[c.id] ?? new Map();
  const stored   = c.inventory ?? [];

  console.log(`\n  Character: ${c.name}`);

  // Build stored map
  const storedMap = new Map();
  for (const it of stored) {
    const key = it.id ?? it.itemId;
    if (key != null) storedMap.set(key, it);
  }

  const allIds = new Set([...computed.keys(), ...storedMap.keys()]);

  let mismatch = false;
  for (const id of allIds) {
    const c_ = computed.get(id);
    const s_ = storedMap.get(id);
    const cQty = c_?.quantity ?? 0;
    const sQty = s_?.quantity ?? s_?.count ?? (s_ ? 1 : 0);
    const name = String(s_?.name ?? c_?.name ?? id ?? '(unknown)');
    if (cQty === sQty) {
      console.log(`    ✅ ${name.padEnd(26,' ')} ${cQty}`);
    } else {
      console.log(`    ❌ ${name.padEnd(26,' ')} script:${cQty}  stored:${sQty}`);
      mismatch = true;
      totalMismatch++;
    }
  }

  if (!mismatch && allIds.size === 0) {
    console.log('    (empty inventory)');
  }
}

// ── Non-ULID item IDs ────────────────────────────────────────────────────────
D.divider('Non-ULID item IDs (placeholder / hallucinated IDs)');
let badCount = 0;
for (const e of events) {
  if (e.idFlag) {
    console.log(`  Turn #${e.turn}  ${e.type}  ${e.item.name ?? e.item.itemId}  id="${e.item.itemId}"`);
    badCount++;
  }
}
if (badCount === 0) console.log('  All item IDs appear valid.');

D.divider('Summary');
console.log(`  Gain events       : ${events.filter(e => e.type === 'GAIN').length}`);
console.log(`  Lose events       : ${events.filter(e => e.type === 'LOSE').length}`);
console.log(`  Non-ULID IDs      : ${badCount}`);
console.log(`  Inventory mismatches : ${totalMismatch}`);
console.log('');
