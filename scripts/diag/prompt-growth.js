/**
 * prompt-growth.js — Context window growth analysis
 *
 * Per-turn message count, character count, estimated tokens, and an ASCII
 * sparkline of context size.  Flags turns sending the full history and
 * projects future token budget exhaustion.
 *
 * Usage:  node scripts/diag/prompt-growth.js [story.json]
 */

'use strict';

const D = require('./lib');

const doc  = D.load(D.cliFile());
const all  = D.turns(doc);

D.header('CONTEXT-WINDOW GROWTH');

// ── Per-turn metrics ─────────────────────────────────────────────────────────
const rows = [];
for (const turn of all) {
  const msgs  = Array.isArray(turn.promptMessages) ? turn.promptMessages : [];
  const chars  = msgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  const tokens = Math.round(chars / 4);

  // System message is always msgs[0] (role=system)
  const sysMsg   = msgs.find(m => m.role === 'system');
  const sysChars = sysMsg
    ? (typeof sysMsg.content === 'string' ? sysMsg.content.length : JSON.stringify(sysMsg.content).length)
    : 0;

  rows.push({
    turn:  turn.turnNumber,
    intent: turn.intent ?? '',
    msgCount: msgs.length,
    chars,
    tokens,
    sysChars,
  });
}

// ── ASCII sparkline ──────────────────────────────────────────────────────────
D.divider('Context size per turn (tokens ~= chars/4)');
const maxTokens = Math.max(1, ...rows.map(r => r.tokens));

for (const r of rows) {
  const b = D.bar(r.tokens, maxTokens, 30);
  const flag = r.tokens > 60000 ? '  ⚠️ >60k tokens!' : r.tokens > 40000 ? '  ⚠️ >40k tokens' : '';
  console.log(
    `  Turn #${String(r.turn).padStart(2,' ')}  ${b}` +
    `  ${String(r.tokens).padStart(6,' ')} tok` +
    `  ${String(r.msgCount).padStart(3,' ')} msgs${flag}`
  );
}

// ── System prompt size ───────────────────────────────────────────────────────
D.divider('System prompt size over time (should be roughly constant)');
const sysMin = Math.min(...rows.map(r => r.sysChars));
const sysMax = Math.max(...rows.map(r => r.sysChars));
console.log(`  Min sys chars: ${sysMin}`);
console.log(`  Max sys chars: ${sysMax}`);
if (sysMax - sysMin > 1000) {
  console.log(`  ⚠️  System prompt varies by ${sysMax - sysMin} chars — may be including dynamic state`);
} else {
  console.log(`  ✅ System prompt is stable (delta < 1000 chars)`);
}

// ── Full history turns ───────────────────────────────────────────────────────
D.divider('Turns possibly replaying full conversation history');
// Heuristic: message count > 2 × turn number suggests prior turns' messages included
let fullHistoryCount = 0;
for (const r of rows) {
  // At minimum: 1 system + 1 user per turn + prior turns (2 msgs each prev turn max)
  const expectedMax = 1 + 2 * r.turn;  
  if (r.msgCount > expectedMax) {
    console.log(`  Turn #${r.turn}: ${r.msgCount} messages (expected ≤${expectedMax}) — may include full prior history`);
    fullHistoryCount++;
  }
}
if (fullHistoryCount === 0) console.log('  None detected.');

// ── Growth rate & projection ─────────────────────────────────────────────────
D.divider('Growth rate & projection');
if (rows.length >= 2) {
  const first = rows[0].tokens;
  const last  = rows[rows.length - 1].tokens;
  const slope = (last - first) / Math.max(1, rows.length - 1);  // tokens per turn

  console.log(`  Turn 1 context : ${first.toLocaleString()} tokens`);
  console.log(`  Last turn ctx  : ${last.toLocaleString()} tokens`);
  console.log(`  Avg growth/turn: +${Math.round(slope).toLocaleString()} tokens`);

  if (slope > 0) {
    const tokensLeft128k = 128000 - last;
    const turnsLeft128k  = Math.round(tokensLeft128k / slope);
    const tokensLeft32k  = 32000 - last;
    const turnsLeft32k   = Math.round(tokensLeft32k / slope);

    if (turnsLeft32k > 0) {
      console.log(`  At current rate, 32k context exhausted in ~${turnsLeft32k} more turns`);
    }
    if (turnsLeft128k > 0) {
      console.log(`  At current rate, 128k context exhausted in ~${turnsLeft128k} more turns`);
    } else {
      console.log(`  ⚠️  Already over 128k tokens!`);
    }
  } else {
    console.log('  Context size is not growing (or shrinking) — windowing or truncation may be active');
  }
}

D.divider('Summary');
const avgTok = Math.round(rows.reduce((a, r) => a + r.tokens, 0) / Math.max(1, rows.length));
const maxRow = rows.reduce((a, r) => r.tokens > a.tokens ? r : a, rows[0]);
console.log(`  Turns analyzed : ${rows.length}`);
console.log(`  Avg tokens/turn: ${avgTok.toLocaleString()}`);
console.log(`  Peak turn      : #${maxRow?.turn} (${maxRow?.tokens.toLocaleString()} tokens)`);
console.log(`  Full-history fx: ${fullHistoryCount}`);
console.log('');
