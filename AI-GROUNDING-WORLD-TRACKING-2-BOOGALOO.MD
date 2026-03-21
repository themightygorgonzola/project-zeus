Okay. Fantastic. We now have 64 turns in story2.json of a new adventure!
Dude I love how adaptable it is. I will note weaknesses that I managed to notice, and I assume there will be more I didnt:

Location change seemed to never happen? Idk? Always seemed to be in the starting town

Combat is still as of yet entirely missing from the experience. Hasn't happened once. We only had one fight in this adventure but it was a multi turn fight definitely

It feels -- and you'll have to assess this for yourself -- but it feels like the AI is very forgiving. As long as I speak and give enough words in the right way that protect me from plot threats, the situation mostly always goes flawlessly. The AI definitely doesn't let me just one-shot enemies but if I keep my guard up and act smartly I almost never experience trouble. That being said, maybe that's my issue, and I should try a stupid scenario. Maybe we can try that later but just wanted to share that thought

I see items like "pouch of gold" and I kinda wonder what exactly I'm supposed to do with that other than barter it idk and the dagger issue from the first story, we might due with systemetizing the items better with classes and things the ai can give -- but.. I do like how fluid it is right now. It can just add an item called "a week's worth of rations" which is kinda cool lol

The follower seemed cool the location never changed but I saw him as a real NPC and he was in the list of nearby (as was every NPC to be fair.)

The NPCs seem fine and at some point we instantly completed a quest? I didn't see myself making progress on it and a quest we'd started called River's Unease never finished. I think the quest system is forcing the quest to be finished and we just haven't taken on another quest yet. That being said, how do we handle multiple quests anyways?

Mystic Amulet
An amulet with faint magical aura, possibly worth investigating further.

Runic Amulet
An amulet etched with ancient runes, emanating a faint magical aura.

Both of these amulets stayed in my inventory even though I put them on the shrine

It's BETTER but still TONS of gaps -- which given the structure we've already built in leads me to believe that something fundamental is the issue -- and we're giving the AI far too many tasks and responsibilities. It's not easy being a DM.
Is there any value in having a two pass kind of thing? We directly stream the narrative response (with good context so the AI is aware of the state), (I say stream because that experience is better and if we split as such we can have our cake and eat it too), and given the state and the narrative, a second ai pass updates the gamestate? Is that valuable? I mean the narrative then is alot simpler to do and the game state updating is harder but do you think it would help to separate out the prompts so that one ai is YOU ARE THE VOICE AND DECISION MAKING AI and one that is YOU ARE THE ONE RESPONSIBLE FOR UPDATING THE GAME GIVEN THE VOICE / DECISION MADE ?

But -- don't immediately take my solutions or diagnosis. Please investigate fully, for yourself, and come up with a series of improvements, overhauls, changes, identify weaknesses in the architecture and suggest a better path or set of paths given the current project state.
---
Based on my analysis, there are two fundamentally different architectural approaches to fix the systemic issues. Before I present the full plan, I want to confirm one key constraint: The user's two-pass idea (narrative AI + state-update AI) is one option. Another is making the engine do MORE work mechanically (so the AI has LESS responsibility). A third is using OpenAI structured output / tool calling to force valid JSON. These can be combined. Which framing resonates most?
I want 1. and 2. And 3. I would pick 4 but I want to stress specifically
- a streaming narrative decision making ai is important for responsiveness and interactability -- seeing the words come out at once feels better. But it's clear we can do some things to help the AI out in - mechanically, as in 2, like gold maybe idk and 3 i didn't even know you can do that. Yes one should stream and one should force valid json that's cracked
Asked 3 questions (Combat, Scope, Gold/Items)

Combat is the biggest gap. The engine already has `attackRoll()`, `applyDamage()`, initiative support in mechanics.ts — all unused. The key question: should the **engine** resolve attacks mechanically (like it already does for spells, rest, travel), or keep them AI-driven but force structured output?
My vision is, the AI says okay, you accomplish an attack with advantage, and it presents two literal icons on the screen in the chat window that are d20s and we can roll them. BG3 style. That's for later though. There should be an AI making the kinds of decisions a real GM would -- but forced to a combat mode -- perhaps a literal combat mode that is made A. to give UI for enemies damage party cooldowns idk we can be creative with that, but B to swap the prompts for the two tandem AIs to be much more focused and reliable while being creative, how does that sound? Like the AI proposes mechanics idk? ou'll probably get what I mean better than I can explain it anyways from what I've given good luck friend
This is a significant architectural change touching the turn pipeline, AI calls, prompt engineering, combat resolution, location tracking, and item management. How should we scope it?
Incremental (many small phases)
- 5+ small phases, one system at a time
The gold system is broken — the AI tracks gold as inventory items ("Gold Coins", "Pouch of Gold") but the engine has a separate `character.gold` integer. Neither system talks to the other. Which approach?
Well like I don't want it converting stuff like gold bars or something. And if it puts something like Satchel of Gold and we didn't hardcode the regex of satchel into it then we miss that or if they put Emblem of the Gold Knight we don't want that being compressed into 1gp or something. I'm not sure how to handle this other than strict prompting. We can't cover every scenario with a regex so autoconverting stuff is hard. Keeping as inventory is whatever but like then there's just tons of gold puches everywhere idk
Great - I now have a very clear picture of what the user wants and the current state. Let me synthesize everything into a comprehensive plan.

Key takeaways from user answers:

Two-pass architecture: YES - streaming narrative AI + structured state-update AI

Combat: User wants a full combat mode eventually with BG3-style dice rolling UI. For now, the AI should propose mechanics and the engine should resolve them. There should be a distinct "combat mode" with different prompts.

Scope: Incremental (many small phases)

Gold/Items: Can't reliably auto-convert by regex. Need a different approach - maybe the state-update AI is told specifically about gold and can use a structured tool to award gold vs items.

The real issue: The current system overloads a single AI call with too many conflicting tasks - creative narrative writing, JSON state tracking, rule compliance, and combat mechanics all at once. The narrative AI excels at storytelling but fails at structured state updates, which is why stateChanges are empty 77% of the time. The solution is splitting these concerns: one pass for creative narrative flow, another dedicated to parsing state changes through structured tools.

Phased rollout: I'm reconsidering the order - starting with OpenAI's JSON mode and fixing the nested state issue as a quick win, then moving to the two-pass architecture where the narrative stream feeds into a state extraction layer, followed by proper combat resolution with engine-tracked mechanics and location persistence. Phase 7 handles combat detection and round tracking, with the engine resolving attack rolls while the AI proposes actions. Phase 8 auto-generates locations when described and forces state updates for movement. Phase 9 tightens up gold awards, quest tracking, and other mechanics to prevent vague or malformed state changes.
---

I've done the full forensic analysis. Here's what I found and the plan I'm proposing.

---

## Forensic Report: story2.json (64 Turns)

### The Numbers

| Metric | Value | Assessment |
|---|---|---|
| Turns with state changes | **15 / 64** (23%) | **Critical** — 77% of turns are narrative-only with zero mechanical effect |
| Location changes | **0 functional** (1 broken no-op) | **Broken** |
| Encounter rounds advanced | **0** (stuck at Round 1 for 17 turns) | **Broken** |
| hpChanges (player) | **0** across 64 turns | **Broken** |
| Dice rolls | **0** across entire combat | **Broken** |
| Quest objectives marked done | **0** (quest "completed" with all 3 objectives `done:false`) | **Broken** |
| Clock advances | **1** (Day 1 morning → afternoon, frozen for 46 more turns) | **Broken** |
| Scene facts recorded | **2** across 64 turns | Severely underused |
| NPC interaction notes | **0** recorded | Broken |
| itemsLost for used items | **1 of 3** (amulets placed on shrines were never removed) | Broken |
| Gold field provenance | **Unaccountable** — `gold: 40` has no corresponding events | Broken |
| Double-nested JSON | **3 occurrences** (turns 18, 27, 44) | AI format issue |
| XP discrepancy | **100 XP** unaccounted for | Unknown |

### Root Cause Analysis

Your instinct is right — **the AI has too many jobs**. But the problem is deeper than that. There are three categories of failure:

**1. The AI ignores its rules (prompt compliance ~25%)**
The system prompt has clear instructions — "every NPC must use `npcsAdded`", "every location must use `locationChange`", "record important details as `sceneFactsAdded`". The AI follows these **maybe 1 in 4 times**. It narrates beautifully but treats state tracking as optional. The prompt is ~3,500 characters of instructions competing with the creative task. The creative task wins.

**2. Combat has no engine support**
`attackRoll()`, `applyDamage()`, `rollDeathSave()` — all fully implemented in mechanics.ts, all **never called**. When the player types "I attack the wolf", the turn executor sees intent `attack` and... passes it straight to the AI. The AI is expected to decide hit/miss, roll damage, track HP, advance rounds — none of which it does. The encounter stuck at Round 1 for 17 turns because there's no `StateChange` field for round advancement, and nothing in the engine increments it.

**3. No JSON enforcement at the API level**
openai.ts sends `{ model, messages }` — no `response_format`, no tools, no function calling. The AI returns JSON purely because the prompt asks nice. When it doesn't feel like it (3 double-nested responses, several empty stateChanges where they shouldn't be), there's no guardrail except post-hoc parsing fallbacks.

### The Key Insight

The current architecture asks **one AI call** to simultaneously:
- Write compelling, creative narrative (requires freedom, personality, flow)
- Track 14 different state-change categories with exact IDs and schemas (requires precision, structure, compliance)

These are **opposing cognitive demands**. Creative writing rewards fluidity. State tracking rewards rigidity. When combined, creativity wins and state tracking suffers — exactly what we see: beautiful prose, 77% empty stateChanges.

---

## Plan: Two-Pass Architecture + Engine-Resolved Combat

**TL;DR:** Split the single AI call into two specialized passes — a streaming narrative AI that decides what happens in the story, and a state-extraction AI that reads the narrative and produces structured state changes via OpenAI's JSON mode. Separately, move combat into an engine-resolved mode where mechanics.ts does the dice rolling. This is 7 incremental phases, each shippable and testable independently.

**Steps**

### Phase 6 — Structured Output (Quick Win) ✅ COMPLETE

Added `completeChatJSON` function to `openai.ts` with `response_format: { type: "json_object" }` for guaranteed valid JSON output. The existing `completeChat` and `streamChat` functions remain untouched for narrative streaming.

- **Files changed:** `openai.ts` (added `completeChatJSON`)
- **Tests:** 1235 passing (full suite)

### Phase 7 — Two-Pass Split (Core Architecture Change) ✅ COMPLETE

Split `executeAdventureTurn` into two sequential AI calls:

**Pass 1 — Narrative AI (streaming)** ✅
- `buildNarrativeSystemPrompt()` — narrative-only prompt with full game context (world, NPCs, quests, locations, encounters, party). Explicitly says "Return ONLY narrative prose. Do NOT return JSON."
- `assembleNarrativeGMContext()` — builds the full message array for Pass 1 with prose-formatted conversation history (no JSON wrapping)
- Uses `streamChat` or `completeChat` — chunks stream to the client in real-time
- `turnsToMessages()` refactored — `useJsonFormat` parameter now actually functional: `true` = JSON-wrapped (legacy), `false` = plain prose (narrative/narrator)

**Pass 2 — State AI (structured, non-streaming)** ✅
- `buildStateExtractionPrompt()` — focused state extraction prompt with extraction rules, full JSON response format schema, and current game state snapshot with all IDs. Mentions "JSON" (required for `json_object` mode)
- `assembleStateExtractionContext()` — builds message array with system prompt + user message containing player action + narrative text
- Uses `completeChatJSON` with `response_format: { type: "json_object" }` — guaranteed valid JSON
- `parseStateExtractionResponse()` — handles `{ stateChanges: {...} }` wrapper or flat state-change keys at top level; graceful fallback to empty `{}` on malformed input

**Pipeline changes** ✅
- `executeAdventureTurn` now has three execution modes: `full-gm-2pass` (new, when currentState exists), `full-gm` (legacy fallback, no currentState), `narrator` (unchanged)
- `TurnDebugData` type updated with `'full-gm-2pass'` mode, `pass2Messages`, `rawPass2Response`, `pass2LatencyMs` fields
- Streaming now works in full-GM mode — Pass 1 streams prose to client (previously chunks were swallowed because JSON tokens would confuse clients)
- `buildGameStateContextBlock()` — shared helper extracted from legacy prompt, used by both narrative and legacy system prompts

**Files changed:**
- `gm-context.ts` — added `buildNarrativeSystemPrompt`, `buildGameStateContextBlock`, `buildStateExtractionPrompt`, `assembleStateExtractionContext`, `assembleNarrativeGMContext`; refactored `turnsToMessages`; kept `buildSystemPrompt` as legacy/fallback
- `adventure-turn.ts` — split full-GM path into two passes, added `parseStateExtractionResponse`, updated `TurnDebugData`, updated imports
- `openai.ts` — `completeChatJSON` (from Phase 6)

**Tests:** 1304 passing (full suite across 21 test files)
- 33 new `gm-context.test.ts` tests: `buildStateExtractionPrompt` (JSON mention, no narrative instructions, includes IDs/schema/extraction rules, quest/NPC/encounter support), `assembleStateExtractionContext` (message structure, no history), `assembleNarrativeGMContext` (narrative-only prompt, full game context, prose history, mechanic results, party chat, JSON vs prose history comparison)
- 10 new `adventure-turn.test.ts` tests: `parseStateExtractionResponse` (wrapper, flat keys, empty, malformed, whitespace), two-pass execution (completeChatJSON called, debug data persisted with `full-gm-2pass` mode)
- 155 existing `adventure-turn.test.ts` tests updated for two-pass mock architecture
- 60 new `creature-templates.test.ts` tests: all 5 tiers, party level scaling, CR snapping, keyword-based attacks, ability scores, boss features, resistances/immunities/vulnerabilities, edge cases, tier parsing, average party level
- 9 new `adventure-turn.test.ts` pipeline tests: stat block generation with tier, combatant stats from generated blocks, initiative rolling, tier defaulting, XP calculation, combat-start/combat-end event broadcasting, flee→fled mapping, sanitizer tier validation


### Phase 8 — Combat Mode (Engine-Resolved Attacks)

## Plan: Phase 8 — Engine-Resolved Combat

**TL;DR:** Wire up the fully-implemented-but-dead combat engine (`combat.ts`, `mechanics.ts`) into the turn pipeline. Combat uses a **party turn / enemy turn** cadence with conversational player input. The AI triggers encounters (via state extraction) and decides enemy tactics — the engine rolls all dice and tracks all HP/damage mechanically. A combat info panel in the right sidebar shows initiative order, enemy HP bars, and round count. Companion NPCs are player-directed. Death saves are player-triggered. Creature stats are auto-generated from a 5-tier template system scaled to party level.

**Steps**

### 8a — Creature stat template system ✅ COMPLETE

Create a new module site/src/lib/game/creature-templates.ts with a `generateCreatureStatBlock(name, tier, partyLevel)` function. The 5 tiers map to CR ranges relative to party level:

| Tier | CR Formula | Example (Lv5 party) | HP Range | AC Range |
|------|-----------|---------------------|----------|----------|
| `weak` | partyLevel × 0.25 → CR ¼–½ | CR ½ | 10–20 | 10–12 |
| `normal` | partyLevel × 0.5 → CR 1–3 | CR 2 | 25–45 | 12–14 |
| `tough` | partyLevel × 0.75 → CR 3–4 | CR 3–4 | 50–80 | 14–16 |
| `elite` | partyLevel × 1.0 → CR 5 | CR 5 | 80–120 | 15–17 |
| `boss` | partyLevel × 1.5 → CR 7–8 | CR 7 | 120–180 | 16–18 |

The function generates a full `CreatureStatBlock`: HP, AC, speed, abilities, 1–2 attacks (scaling toHit and damage dice by CR), saving throws, and CR. Attack names/damage types can be influenced by the creature name (e.g. "wolf" → bite/slashing, "bandit" → shortsword/piercing) using a simple keyword table, with a generic fallback.

- Add `tier?: 'weak' | 'normal' | 'tough' | 'elite' | 'boss'` to the `encounterStarted` creature schema in `StateChange` (types.ts)
- The state extraction prompt in gm-context.ts gets updated to instruct the AI to provide a `tier` field for each creature

**Implementation notes:**
- Created `site/src/lib/game/creature-templates.ts` (~310 lines) with exports: `CreatureTier`, `CREATURE_TIERS`, `generateCreatureStatBlock()`, `snapCR()`, `averagePartyLevel()`, `parseCreatureTier()`
- `CR_BENCHMARKS` table: 21 entries (CR 0–20) with hp/ac/toHit/dpr/saveDC based on 5e DMG
- `CREATURE_KEYWORDS`: ~30 regex patterns mapping creature names to attack flavours (wolf→Bite, dragon→Bite+Claw+Breath, mage→Arcane Blast, skeleton→Rusty Shortsword, ghost→Withering Touch, etc.)
- `inferSpeed`, `generateAbilities`, `inferResistances/Immunities/Vulnerabilities` — keyword-based inference
- Boss tier gets Legendary Resistance trait + 2 legendary actions; elite/boss get WIS save proficiency
- Updated `StateChange.encounterStarted` in types.ts: creatures now `(NPC & { tier?: string })[]`
- Updated gm-context.ts: added `"tier": "weak|normal|tough|elite|boss"` to encounterStarted schema in both prompt locations
- 60 unit tests in `creature-templates.test.ts` — all passing

### 8b — Encounter creation pipeline ✅ COMPLETE

Replace the placeholder encounter creation in `applyGMStateChanges()` (adventure-turn.ts):

1. When `encounterStarted` is in stateChanges, for each creature:
   - Call `generateCreatureStatBlock(name, tier ?? 'normal', partyAverageLevel)` to get real stats
   - Attach the stat block to the NPC before adding to `state.npcs`
2. Call `createEncounter(state, hostileNpcs)` from `combat.ts` — this rolls initiative for all PCs + companions + enemies and builds the full `ActiveEncounter`
3. Broadcast `game:combat-start` event (currently defined but never emitted)

For encounter ending — call `resolveEncounter()` from `combat.ts` instead of just clearing the encounter. This auto-calculates XP from defeated creature CRs.

**Implementation notes:**
- `encounterStarted` handler rewritten: computes `partyLevel` via `averagePartyLevel()`, generates stat blocks via `generateCreatureStatBlock()` for each creature, calls `createEncounter(state, allCombatCreatures)` for real initiative + proper stats
- `encounterEnded` handler rewritten: marks defeated NPCs, calls `resolveEncounter()` for XP calculation, applies XP to characters, surfaces XP in `stateChanges.xpAwarded`
- Combat event broadcasting added in `broadcastTurnEvents()`: `game:combat-start` (enemy names) and `game:combat-end` (outcome + XP)
- Maps `'flee'` (EncounterOutcome) → `'fled'` (CombatEndEvent) to fix type mismatch
- Sanitizer updated: validates/defaults `tier` field on encounterStarted creatures (valid: weak/normal/tough/elite/boss, default: 'normal')
- 9 pipeline tests in `adventure-turn.test.ts` — all passing
- **Eliminated:** hardcoded `hp:20, maxHp:20, ac:12, initiative:0` placeholder stats
- **Activated:** previously dead code in combat.ts (`createEncounter`, `resolveEncounter`, `rollInitiative`)

### 8c — Attack resolution in the turn executor ✅ COMPLETE

Add a `resolveAttack` case to the `switch` in turn-executor.ts:

When `intent === 'attack'` AND `state.activeEncounter?.status === 'active'`:
1. **Target resolution**: AI infers target from context. The narrative AI's prose should name the target. The state extraction AI gets a new field: `combatAction?: { targetId: string, type: 'attack' | 'spell' | 'other' }`. If no target is specified, pick the nearest non-defeated enemy combatant.
2. **Weapon selection**: Use the attacker's equipped weapon (first equipped weapon in inventory). If no weapon equipped, unarmed strike (1d4 + STR).
3. Call `resolveAttack(attacker, targetCombatant, weapon, encounter)` from `combat.ts`
4. Convert result to `MechanicResult[]` via `attackToMechanicResult()`
5. If target is defeated, check `allDefeated(encounter, 'npc')` — if true, auto-trigger `resolveEncounter()`
6. Return `ResolvedTurn` with `status: 'ready-for-narration'` and mechanic results — this routes to **narrator mode** so the AI narrates around the established facts

**Implementation notes:**
- Added `case 'attack':` → `resolveCombatAttack()` to the switch in `resolveTurn()` (turn-executor.ts)
- New functions added to turn-executor.ts:
  - `buildUnarmedStrike()` — WeaponItem with 1d4 bludgeoning, no properties
  - `getEquippedWeapon(actor)` — finds first `equipped: true` weapon in inventory
  - `resolveAttackTarget(state, intent)` (exported) — fuzzy name match (full name, first name ≥3 chars) against enemy combatant names; excludes companions; falls back to first non-defeated enemy
  - `buildAttackMechanicResults()` — creates attack-roll + damage MechanicResult array
  - `resolveCombatAttack()` — full combat turn: find target → get weapon → resolve player attack → resolve enemy counter-attacks → advance round → sync HP → check encounter end
- Updated `combatAction` and `enemyCombatActions` fields added to `StateChange` (types.ts)
- Updated gm-context.ts: both legacy GM prompt and state extraction prompt include combat action schema + extraction rules
- Updated adventure-turn.ts: `mergeStateChanges()`, `tryParseGMJson` rescue keys, `parseStateExtractionResponse` state keys, `sanitizeStateChanges` validation (combatAction, enemyCombatActions)
- Fixed `resolveNpcAttack()` in combat.ts: was discarding the damage `DiceResult` (returning `damage: null`), now properly captures and returns it
- 14 unit tests for player attack resolution + 8 tests for `resolveAttackTarget`

### 8d — Enemy turn resolution ✅ COMPLETE

After the player's action resolves and the narrative is generated, if there's still an active encounter, the engine resolves enemy turns:

After the player's action resolves and the narrative is generated, if there's still an active encounter, the engine resolves enemy turns:

1. Determine which enemy combatants act this round (all non-defeated enemies — party turn / enemy turn cadence)
2. For each enemy combatant:
   - The narrative AI (Pass 1) decides what each enemy does as part of its prose ("The wolf lunges at Conan, snapping its jaws")
   - The state extraction AI (Pass 2) extracts `enemyCombatActions?: Array<{ npcId, targetId, attackIndex? }>` 
   - The engine calls `resolveNpcAttack(npc, attackIndex, targetCombatant, encounter)` for each
   - Results become `MechanicResult[]` appended to the turn
3. Apply damage to PC combatants, sync back to `state.characters[].hp`
4. Advance the round via `advanceTurn()` or simply increment `encounter.round` (since we're doing party/enemy phases, not individual initiative)
5. If any PC drops to 0 HP, mark them as needing a death save next turn

**Key design:** Enemy actions happen in the SAME turn as the player's action. The flow is: Player acts → engine resolves player attack → narrative AI describes player's hit + enemy reactions → engine resolves enemy attacks → mechanic results for both sides shown → round advances.

**Implementation notes:**
- New functions in turn-executor.ts:
  - `resolveEnemyTurns(state, encounter)` (exported) — iterates non-defeated hostile enemies, each attacks a PC (round-robin targeting: `i % pcTargets.length`), uses `resolveNpcAttack(npc, 0, target, encounter)` with attack index 0, checks `allDefeated(encounter, 'character')` for defeat outcome
  - `syncCharacterHpFromCombatants(state)` — copies combatant currentHp back to character.hp after combat mutations
- Enemy targeting: round-robin distribution across non-defeated PC combatants to spread damage
- Companion NPCs excluded from both targeting (won't be attacked) and enemies list (won't attack PCs)
- Round advancement: `encounter.round++` after both player and enemy attacks, only if encounter hasn't ended
- HP sync: encounter combatant objects hold authoritative HP during combat; `syncCharacterHpFromCombatants()` bridges back to `state.characters[].hp`
- Adventure-turn.ts `persistResolvedTurnAndState` uses `resolvedTurn.updatedCharacters` to apply synced HP
- 10 unit tests for enemy turn resolution + 3 integration tests (full combat round, victory suppresses enemy attacks, updatedCharacters returned)
- **Total new tests:** 35 (14 player attack + 8 target resolution + 10 enemy turns + 3 integration)
- **Total test count:** 1339 tests across 21 files — all passing

### 8e — Sequential per-actor combat turns + companion combat ✅ COMPLETE

**Sequential model implemented.** Each combatant gets an individual turn prompt rather than a party-block/enemy-block model:
- `ActiveEncounter.awaitingActorId` tracks whose turn it is; null = nobody/round complete
- `ActiveEncounter.roundActions[]` accumulates all resolved actions this round; cleared after round-end narration
- `PendingCombatAction` records each actor's raw action, mechanic results, and state changes
- `initEncounterTurnOrder(encounter, npcs)` — sets `awaitingActorId` to the first human actor when a new encounter starts
- `getActorForCombatTurn(state, encounter, actorUserId)` — authorization: PC slot requires matching userId; companion slot allows any party member
- `autoAdvancePastNpcs(state, encounter)` — auto-resolves hostile NPCs, stops at next PC/companion, detects round wrap
- **Mid-round shortcut:** `roundComplete === false` → skip AI, broadcast dice + `game:combat-turn` event, return empty narrative
- **Round-end narration:** `roundComplete === true` → `assembleRoundNarratorContext` builds narrator context from all `roundActions[]`
- `assembleRoundNarratorContext(state, world, roundActions, recentTurns)` — formats actions by initiative order with dice notation + HP changes
- Companions (NPC `role: 'companion'`) are player-controlled slots; "auto"/"defer" → engine picks best action
- **New tests:** 34 (turn-executor.test.ts) + 9 (gm-context.test.ts) = 43 new tests
- **Total test count:** 1382 tests across 21 files — all passing

### 8f — Death saves (player-triggered) ✅ COMPLETE

**Conversational death saves implemented.** When a PC is at 0 HP:
- Player types "roll death save" or any natural language variant
- `classifyIntent` detects it (checked BEFORE attack regex to avoid "throw" collision) → `'death-save'` IntentType
- `resolveDeathSave()` calls `rollDeathSave()` from mechanics.ts, updates `character.deathSaves.successes/failures`
- `StateChange.deathSaveResult` + `deathSaveOutcome` fields carry result through the pipeline
- Nat 20 → revive at 1 HP, `character.stable = true`; Nat 1 → 2 failures at once
- 3 successes → `deathSaveOutcome: { outcome: 'stable' }`; 3 failures → `character.dead = true`
- Death save stored in `roundActions[]` so AI narrates drama at round end via `assembleRoundNarratorContext`
- Included in Phase 8e test count above

### 8g — Round advancement & auto-advance ✅ COMPLETE

**Already implemented by prior phases.** Assessment:
- ✅ `encounter.round` increments via `advanceTurn()` / `autoAdvancePastNpcs()` in turn-executor.ts
- ✅ Victory: `resolveEncounter(encounter, 'victory', ...)` fires automatically when `allDefeated(encounter, 'npc')` in `resolveCombatAttack`
- ✅ Defeat: `resolveEnemyTurns()` checks `allDefeated(encounter, 'character')` and sets `encounterEnded: { outcome: 'defeat' }`
- ✅ Flee: AI detects "I flee" / "we run" narrative and emits `encounterEnded: { outcome: 'flee' }` — handled by `applyGMStateChanges`
- ✅ Negotiation: AI emits `encounterEnded: { outcome: 'negotiated' }` — handled the same way
- **Clock advance note:** D&D rounds = 6 seconds. Typical combats (3–10 rounds = 18–60 seconds) do not warrant a time-period advance (each period ≈ 3 hours). The engine already advances the clock for travel and rest. No additional combat clock logic is needed for realistic play.

### 8h — Combat info panel (frontend) ✅ COMPLETE

Added `CombatPanel.svelte` to the **left sidebar** of `+page.svelte` (user preference — right sidebar holds the JournalPanel):

**`site/src/lib/components/CombatPanel.svelte`** (new file):
- Shown conditionally when `gameState.activeEncounter` is set
- **Round badge**: `Round N` in red when active, outcome label when ended
- **Initiative list**: Combatants sorted by `encounter.initiativeOrder` (highest first)
  - Type dot: blue = PC (`character`), green = companion NPC (`role: 'companion'`), red = enemy NPC
  - Active combatant gets animated `▶` arrow + highlighted row border
  - Name + AC badge + initiative badge per row
  - HP bar (green >60%, yellow 25–60%, red <25%) with current/max HP
  - Defeated combatants: grayed at 40% opacity with strikethrough name + "☠ Defeated" tag
  - Stable PCs: "💤 Stable" tag instead of HP bar
  - **Dying PCs**: `Dying` label + death-save pip tracker (◆ success = green, ◆ failure = red, 3 pips each)
  - Conditions rendered as yellow tags below HP
  - Props: `encounter`, `characters`, `npcs?` (for companion detection), `localAwaitingId?`

**`site/src/routes/adventures/[id]/+page.svelte`** changes:
- Added `CombatPanel` import
- Added `NPC, ActiveEncounter` to type imports from `$lib/game`
- Extended `gameState` type cast to include `activeEncounter?: ActiveEncounter`
- Added `combatEncounter = $derived(gameState?.activeEncounter ?? null)` reactive state
- Added `localAwaitingId = $state<string | null | undefined>(undefined)` for socket-driven turn highlighting
- Added `$effect` to sync `localAwaitingId` from server-refreshed encounter data
- **Socket handlers** for new combat events:
  - `game:combat-start` → system message "⚔️ Combat begins! Enemies: …" + `invalidateAll()`
  - `game:combat-end` → system message with outcome emoji + XP per character + `invalidateAll()`
  - `game:combat-turn` → updates `localAwaitingId` + system message "🎯 {name}'s turn" (mid-round only) + `invalidateAll()`
- CombatPanel renders above Party panel in left sidebar when encounter is active

**No new unit tests** — frontend Svelte components are not covered by the vitest suite. BackendSocket event handling is integration-tested via the e2e flow.
- **Total test count: 1382 tests across 21 files — all passing** (unchanged)

### 8i — State extraction prompt updates ✅ COMPLETE

Update `buildStateExtractionPrompt()` in gm-context.ts:
- Add `tier` field to `encounterStarted.creatures` schema: `"tier": "weak|normal|tough|elite|boss"`
- Add `combatAction` extraction: `"combatAction": { "targetId": "combatant-id", "type": "attack" }` — tells the engine who the player is attacking
- Add `enemyCombatActions` extraction: `"enemyCombatActions": [{ "npcId": "...", "targetId": "...", "attackIndex": 0 }]` — tells the engine what each enemy NPC does
- Add guidance: "During active combat, you MUST extract combat actions for all active combatants"

**Status**: All prompt additions were already implemented in gm-context.ts as part of Phase 8c. Added 4 unit tests in `gm-context.test.ts` verifying `combatAction`, `enemyCombatActions`, `tier`, and MUST-extract guidance are present in the prompt output.
- **Total test count: 1389 tests across 21 files — all passing**

### 8j — Event broadcasting ✅ COMPLETE

Wire up the existing but unused events:
- `game:combat-start` — broadcast when encounter is created (includes enemy names, initiative order)
- `game:combat-end` — broadcast when encounter resolves (includes outcome, XP awarded)
- `game:dice-roll` — broadcast individual attack rolls, damage rolls, death saves for the combat panel to animate/display

**Status**: All broadcasts were already implemented in `adventure-turn.ts`. Fixed 2 field name bugs in `+page.svelte` socket handlers (`msg.enemyNames` → `msg.enemies`, `msg.xpPerCharacter` → `msg.xpAwarded`). Added 3 unit tests in `adventure-turn.test.ts` for the mid-round shortcut path: `game:dice-roll` broadcast, `game:combat-turn` broadcast (nextCombatantId/roundComplete), and no-AI-call verification.

**Verification**
- Unit tests: `creature-templates.test.ts` — stat generation for all 5 tiers, scaling with party level, keyword-based attack types
- Unit tests: Turn executor `attack` case — resolves via `resolveAttack`, produces `MechanicResult`, routes to narrator mode
- Unit tests: Enemy turn resolution — NPC attacks resolved, damage applied to PCs, round advances
- Unit tests: Encounter creation — uses `createEncounter()` with real initiative, template stats instead of placeholder 20/12
- Unit tests: Encounter end — calls `resolveEncounter()`, awards XP, clears encounter
- Unit tests: Death saves — player-triggered, 3 successes/failures, nat 20 revive
- Integration: Start encounter → player attacks → enemy attacks → round advances → encounter ends → XP awarded
- Manual: Play a 5-round combat, verify HP tracking, dice rolls visible, combat panel shows correct state

**Decisions**
- Party turn / enemy turn over individual initiative: faster pacing for text-based game, less "waiting" feel
- Template-based creature scaling over AI-generated stat blocks: reliable, CR-appropriate stats without relying on AI to produce valid numbers
- State AI detects hostility over AI-triggered `encounterStarted`: the narrative AI decides the story, the state AI detects the mechanical trigger
- AI infers targets over explicit UI picker: keeps the conversational feel, avoids premature UI complexity
- Player-directed companions over AI-controlled: gives player tactical agency
- Player-triggered death saves over auto-roll: more interactive, respects the drama of death saves
- Enemy actions same turn as player: avoids extra round-trips, keeps combat snappy
- Backend + info panel scope: get the mechanics right first, fancy UI (dice animations, attack buttons) in a future phase

---
### Phase 9 — Location Tracking

The AI never emits `locationsAdded` or `locationChange`. Fix by making both AIs location-aware:

1. **State AI prompt** gets explicit instruction: "If the narrative describes the party arriving at, entering, or moving to a named place that is NOT in the known locations list, you MUST emit `locationsAdded` with the new location AND `locationChange` to move there."
2. **Post-extraction validation**: If the narrative mentions arriving somewhere and the state AI didn't emit a `locationChange`, log a warning. Eventually, auto-detect this.
3. **Clock co-advancement**: Travel between locations should advance the clock (the engine already does this for `resolveTravel`, but the AI-driven movement doesn't).
4. Fix the `loc-` prefix bug — the broken no-op locationChange at turn 34 happened because `from` had `loc-` prefix but `to` didn't.

- **Files:** gm-context.ts (state AI location instructions), adventure-turn.ts (location validation, prefix normalization)
- **Tests:** Narrative describing new location → state AI emits locationsAdded + locationChange, prefix normalization, clock advance on travel

### Phase 10 — NPC, Quest & Scene Facts Hardening

1. **Quest objectives**: The state AI must mark objectives done individually before completing the quest. Add validation: if `questUpdate.status = 'completed'` but objectives aren't all `done`, **auto-mark matching objectives** or reject the completion.
2. **NPC alive flag**: When `npcChanges` sets HP to 0, automatically set `alive: false`. Don't rely on the AI to do both.
3. **Scene facts**: The state AI gets explicit instruction: "Record any NPC agreements, prices, promises, quest clues, or world discoveries as `sceneFactsAdded`." With the two-pass split, fact extraction should improve dramatically since the state AI reads the full narrative and can extract all important details.
4. **NPC interaction notes**: Same — state AI should emit `npcChanges` with `field: "notes"` for significant conversations.

- **Files:** adventure-turn.ts (quest objective validation, auto-alive), gm-context.ts (state AI scene fact/NPC note instructions)
- **Tests:** Quest can't complete with `done:false` objectives, HP=0 → alive=false, scene facts extracted from narrative

### Phase 11 — Items & Gold Cleanup

1. **Gold tracking**: This is genuinely hard to auto-convert. The approach: the state AI prompt explicitly tells it to use `xpAwarded`-style entries for gold awards: "When gold is given as a reward, add it to `goldAwarded` (new field), NOT as an inventory item called 'Gold Coins'." Add a `goldAwarded` field to `StateChange` type. This is a prompt+schema solution, not regex.
2. **itemsLost enforcement**: The state AI reads the narrative — if it describes placing, giving away, consuming, or losing an item, it MUST emit `itemsLost`. The two-pass split helps enormously here since the state AI can focus on extraction.
3. **Item categories**: Better schema guidance in the state AI prompt — weapons should be `weapon` category, consumables should be `consumable`, etc.

- **Files:** types.ts (add `goldAwarded` to StateChange), adventure-turn.ts (apply goldAwarded), gm-context.ts (state AI item/gold instructions)
- **Tests:** Gold awarded via new field, items properly categorized, itemsLost for used items

### Phase 12 — Clock & Time Auto-Advance

1. **Activity-based clock**: After N turns without a clock advance, auto-advance time. Map activities to time cost: combat turn ≈ 6 seconds (D&D round), exploration ≈ 10 minutes, travel ≈ hours. The state AI can emit `clockAdvance` but the engine provides a fallback.
2. **Weather variation**: Occasionally change weather when clock advances (simple random table).
3. **Day/night effects**: When it's night, the prompt mentions darkness and visibility.

- **Files:** adventure-turn.ts (auto-clock), gm-context.ts (time-of-day narrative hints)

**Verification**

- Phase 6: Run existing tests, verify JSON mode produces valid responses in a test adventure
- Phase 7: Play a 10-turn adventure, verify streaming works, verify state changes are extracted by Pass 2, run full test suite
- Phase 8: Start a combat encounter, verify dice rolls, HP tracking, round advancement, encounter end
- Phase 9: Travel to a new location, verify it appears in state, verify clock advances  
- Phase 10: Complete a quest, verify objectives marked, verify scene facts accumulate
- Phase 11: Receive gold reward, verify it goes to `gold` field not inventory
- Phase 12: Play 20 turns, verify clock advances naturally

**Decisions**
- Two-pass over single-pass: eliminates the creative-vs-structured conflict that causes 77% empty stateChanges
- Engine-resolved combat over AI combat: leverages existing `attackRoll`/`applyDamage` code, grounds combat in real dice
- Streaming narrative + non-streaming state: user gets responsive UX from Pass 1 while Pass 2 runs in background
- `goldAwarded` field over regex auto-conversion: avoids false positives ("Golden Knight" ≠ gold)
- Many small phases over big-bang: each phase shippable and testable independently
- Phase 6 first: smallest possible diff with immediate reliability improvement, de-risks Phase 7