/**
 * zeus-diag — core library
 *
 * Loads a zeus-adventure-export-v1 JSON file and provides
 * query helpers used by all diagnostic scripts.
 *
 * Usage in a script:
 *   const { load } = require('./lib');
 *   const story = load();           // defaults to ../../story.json
 *   const story = load('./my.json');
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Loader ────────────────────────────────────────────────────────────────

function load(filePath) {
  const resolved = filePath
    ? path.resolve(filePath)
    : path.resolve(__dirname, '../../story.json');

  if (!fs.existsSync(resolved)) {
    die(`File not found: ${resolved}\nPass a path as the first CLI arg or place story.json in project-zeus root.`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { die(`JSON parse error: ${e.message}`); }

  if (doc._schema !== 'zeus-adventure-export-v1') {
    console.warn('Warning: _schema mismatch — file may not be a zeus export.');
  }

  return doc;
}

// ─── Turn helpers ──────────────────────────────────────────────────────────

/** All turns, sorted ascending. */
function turns(doc)        { return [...doc.turns].sort((a, b) => a.turnNumber - b.turnNumber); }

/** Turns matching a specific intent. */
function byIntent(doc, intent) { return turns(doc).filter(t => t.intent === intent); }

/** Turns that are full-gm mode (AI made state decisions). */
function fullGmTurns(doc) { return turns(doc).filter(t => t.mode === 'full-gm'); }

/** Turns where AI proposed at least one change. */
function withProposedChanges(doc) {
  return turns(doc).filter(t =>
    t.gmProposedChanges && Object.keys(t.gmProposedChanges).length > 0);
}

/** Turns where at least one concrete state field was applied. */
function withAppliedChanges(doc) {
  return turns(doc).filter(t => hasAnyField(t.appliedStateChanges));
}

/** Turns of a specific change type (hpChanges, xpAwarded, locationChange, etc.). */
function withChange(doc, field) {
  return turns(doc).filter(t => {
    const sc = t.appliedStateChanges;
    if (!sc) return false;
    const v = sc[field];
    return Array.isArray(v) ? v.length > 0 : v != null;
  });
}

// ─── State helpers ─────────────────────────────────────────────────────────

function charMap(doc) {
  const map = {};
  for (const c of (doc.finalState?.characters ?? [])) map[c.id] = c.name;
  return map;
}

function npcMap(doc) {
  const map = {};
  for (const n of (doc.finalState?.npcs ?? [])) map[n.id] = n.name;
  return map;
}

function locationMap(doc) {
  const map = {};
  for (const l of (doc.finalState?.locations ?? [])) map[l.id] = l.name;
  return map;
}

function questMap(doc) {
  const map = {};
  for (const q of (doc.finalState?.quests ?? [])) map[q.id] = q.name;
  return map;
}

// ─── Diff helpers ──────────────────────────────────────────────────────────

/**
 * Compare gmProposedChanges vs appliedStateChanges for a turn.
 * Returns { proposedOnly, appliedOnly } — fields present in one but not the other.
 */
function diffChanges(turn) {
  const proposed = normaliseChanges(turn.gmProposedChanges ?? {});
  const applied  = normaliseChanges(turn.appliedStateChanges ?? {});

  const allKeys = new Set([...Object.keys(proposed), ...Object.keys(applied)]);
  const proposedOnly = [];
  const appliedOnly  = [];

  for (const k of allKeys) {
    const inP = hasValue(proposed[k]);
    const inA = hasValue(applied[k]);
    if (inP && !inA)  proposedOnly.push(k);
    if (inA && !inP)  appliedOnly.push(k);
  }
  return { proposedOnly, appliedOnly };
}

/**
 * Returns true if the AI rawAiResponse is not valid JSON
 * (or doesn't contain a narrativeText field as the top-level key).
 */
function aiReturnedProse(turn) {
  if (!turn.rawAiResponse) return false;
  try {
    const p = JSON.parse(turn.rawAiResponse.trim()
      .replace(/^```json?\s*/i, '').replace(/\s*```$/, ''));
    return typeof p?.narrativeText !== 'string';
  } catch { return true; }
}

// ─── Formatting ────────────────────────────────────────────────────────────

/** Prints a section header. */
function header(title) {
  const line = '═'.repeat(Math.max(60, title.length + 4));
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

/** Prints a subsection divider. */
function divider(label) {
  console.log(`\n  ─── ${label} ${'─'.repeat(Math.max(0, 55 - label.length))}`);
}

/** Formats a turn prefix. */
function t(turn) { return `Turn #${String(turn.turnNumber).padStart(2,' ')} [${turn.intent.padEnd(14,' ')}]`; }

/** Formats ms to a human string. */
function fmtMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;
}

/** Truncates a string. */
function trunc(s, n = 80) {
  if (!s) return '(empty)';
  s = s.replace(/\n/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Pad a number left. */
function pad(n, w = 4) { return String(n).padStart(w, ' '); }

/** Basic bar chart in ASCII. */
function bar(value, max, width = 20) {
  const filled = Math.round((value / max) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function hasAnyField(sc) {
  if (!sc || typeof sc !== 'object') return false;
  for (const [k, v] of Object.entries(sc)) {
    if (k === '_schema') continue;
    if (hasValue(v)) return true;
  }
  return false;
}

function hasValue(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function normaliseChanges(sc) {
  const out = {};
  for (const [k, v] of Object.entries(sc ?? {})) {
    if (hasValue(v)) out[k] = v;
  }
  return out;
}

function die(msg) {
  console.error(`\nFATAL: ${msg}\n`);
  process.exit(1);
}

// ─── CLI argument helper ───────────────────────────────────────────────────

/** Returns the first CLI argument as the story file path, or undefined. */
function cliFile() { return process.argv[2]; }

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  load, cliFile,
  turns, byIntent, fullGmTurns, withProposedChanges, withAppliedChanges, withChange,
  charMap, npcMap, locationMap, questMap,
  diffChanges, aiReturnedProse,
  header, divider, t, fmtMs, trunc, pad, bar,
};
