/**
 * Project Zeus — GM Context Assembler
 *
 * Builds the full message array sent to the AI before each turn.
 * This is WHERE the GM gets its knowledge of the world, the party,
 * the current location, conversation history, and game rules.
 *
 * The assembler is the bridge between structured game state and the
 * unstructured LLM context window.
 */

import type { ChatMessageInput } from '$lib/server/ai/openai';
import type { GameState, MechanicResult, NPC, PendingCombatAction, PlayerCharacter, TurnRecord } from '$lib/game/types';
import { getPrimaryClass, getAllCantrips, getAllPreparedSpells } from '$lib/game/types';
import { getSpellSaveDCForClass, getSpellAttackBonusForClass } from '$lib/game/spellcasting';
import type { PrototypeWorld } from '$lib/worldgen/prototype';
import type { ResolvedTurn } from '$lib/server/ai/turn-executor';
import type { ChatRecord } from '$lib/game/state';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max recent turns to include in narrative / free-narration context. */
export const MAX_HISTORY_TURNS = 8;

/** Longer window used only for narrator mode & round narration (engine-resolved facts). */
export const MAX_NARRATOR_HISTORY_TURNS = 12;

/** Max characters for the world brief section. */
const MAX_WORLD_BRIEF_CHARS = 3000;

/** Max NPCs to show in the KNOWN NPCs prompt section. */
const MAX_KNOWN_NPCS = 25;

/** Max locations to show in the KNOWN LOCATIONS prompt section. */
const MAX_KNOWN_LOCATIONS = 15;

// ---------------------------------------------------------------------------
// NPC helpers
// ---------------------------------------------------------------------------

/**
 * Translate a disposition score (-100 to 100) into a human-readable label.
 */
function dispositionLabel(d: number): string {
	if (d >= 75) return 'adoring';
	if (d >= 40) return 'friendly';
	if (d >= 10) return 'warm';
	if (d >= -10) return 'neutral';
	if (d >= -40) return 'unfriendly';
	if (d >= -75) return 'hostile';
	return 'hateful';
}

function escapeProtocolText(value: string): string {
	return value.replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatNameIdRef(name: string, id: string): string {
	return `[name: ${escapeProtocolText(name)}][id: ${escapeProtocolText(id)}]`;
}

function formatObjectiveRef(text: string, id: string, done: boolean): string {
	return `objective(status: ${done ? 'done' : 'pending'}, text: ${escapeProtocolText(text)}, id: ${escapeProtocolText(id)})`;
}

/**
 * Build a one-line interaction summary for an NPC by cross-referencing
 * scene facts that mention the NPC by name.
 *
 * Returns a compressed string like "hired Day 1 for 5gp/day; fought rogues alongside party"
 * or empty string if no relevant facts exist.
 */
function buildNpcInteractionSummary(npc: NPC, sceneFacts: string[]): string {
	// Prefer structured interactionNotes when available
	if (npc.interactionNotes && npc.interactionNotes.length > 0) {
		return npc.interactionNotes.slice(-3).map((n) => n.note).join('; ');
	}

	// Fallback: cross-reference scene facts by NPC name
	if (!sceneFacts || sceneFacts.length === 0) return '';

	const nameLower = npc.name.toLowerCase();
	// Also match first name only (e.g. "Bjorik" from "Bjorik the Bold")
	const firstName = npc.name.split(/\s+/)[0].toLowerCase();

	const relevant = sceneFacts.filter((f) => {
		const fl = f.toLowerCase();
		return fl.includes(nameLower) || (firstName.length >= 3 && fl.includes(firstName));
	});

	if (relevant.length === 0) return '';

	// Only show the last 3 most recent facts to keep the summary concise
	return relevant.slice(-3).join('; ');
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Build the narrative-only system prompt for Pass 1 (the streaming storyteller).
 *
 * This prompt gives the AI full game context so it can make informed narrative
 * decisions, but explicitly tells it to return ONLY prose — no JSON, no state
 * tracking. A separate state-extraction pass will handle structured changes.
 */
function buildNarrativeSystemPrompt(state: GameState, worldBrief: string): string {
	const parts: string[] = [];

	// ── Core identity ──
	parts.push(`You are the Game Master of a tabletop-style fantasy RPG.`);
	parts.push(`You adjudicate player actions like a skilled tabletop GM: narrate consequences, call for dice checks when the outcome is uncertain, and announce combat clearly.`);
	parts.push(`You narrate in second-person perspective, speaking directly to the party.`);
	parts.push(`You are authoritative about the world — you describe what happens as a consequence of player actions.`);
	parts.push(`You respect the mechanics: when dice results are provided, narrate around those outcomes faithfully.`);
	parts.push(`Keep responses vivid and concise (2–5 sentences for normal actions, more for important moments).`);
	parts.push('');
	parts.push(`IMPORTANT: Return ONLY narrative prose. Do NOT return JSON. A separate system handles game state updates.`);
	parts.push('');

	// ── Tabletop adjudication procedure ──
	parts.push(`=== TABLETOP ADJUDICATION ===`);
	parts.push(`Think like a tabletop GM running a session at a table:`);
	parts.push('');
	parts.push(`CALLING FOR CHECKS:`);
	parts.push(`- When the outcome is uncertain and failure has interesting consequences, call for a check.`);
	parts.push(`- Name the check explicitly: "Make a Perception check", "Roll a Stealth check", "Give me a Persuasion check.""`);
	parts.push(`- If the action is trivial or routine (opening an unlocked door, walking down a road), just narrate the result.`);
	parts.push(`- Do NOT silently decide contested outcomes — if a player tries to sneak, lie, or persuade and there is resistance, call for the roll.`);
	parts.push('');
	parts.push(`STARTING COMBAT:`);
	parts.push(`- Combat begins ONLY when hostilities are explicit: someone attacks, an ambush springs, or a creature charges.`);
	parts.push(`- When combat truly begins, announce it clearly with a phrase like "Combat begins!" or "Hostilities break out!" so the boundary is unmistakable.`);
	parts.push(`- IMPORTANT: Do NOT say "Roll for initiative!" — initiative is automatically resolved by the engine. Never ask the player to roll initiative.`);
	parts.push(`- Do NOT write combat-declaration prose ("Combat begins!", "Prepare yourself!", etc.) unless your state changes ALSO include a valid encounterStarted with named creatures. If enemies are present but the encounter isn't ready yet, describe the approach or discovery — save the combat announcement for the turn that includes encounterStarted.`);
	parts.push(`- Scouting, observing, reconnaissance, hearing rumors about enemies, and cautious dialogue NEVER start combat on their own.`);
	parts.push(`- A player saying "I look for enemies" or "I scout ahead" is gathering information, not starting a fight.`);
	parts.push(`- ALL COMBAT IS TURN-BASED: If a player character is actively participating in a fight — attacking, defending, using abilities, or being targeted — the encounter MUST be started via encounterStarted with ALL relevant combatants listed. There is no such thing as a 'minor scuffle' that bypasses combat tracking. The ONLY exception is purely observational combat: a player character watching a battle from complete safety (a telescope, a hidden overlook, through a window) may receive pure narrative description. The moment the player character joins, intervenes, is targeted, or enters the area of conflict, encounterStarted MUST fire immediately.`);
	parts.push('');
	parts.push(`DURING COMBAT:`);
	parts.push(`- Think in terms of turns, actions, bonus actions, reactions, movement, and positioning.`);
	parts.push(`- Narrate each combatant's actions with tactical clarity: who attacks whom, what weapon or ability is used, and what happens.`);
	parts.push(`- Reference engine-provided dice results faithfully. Do NOT invent hit/miss/damage beyond what the engine resolved.`);
	parts.push(`- NEVER write engine mechanic format strings in your narrative (e.g. "[Mechanics: ...]", "[Attack: ...]"). Narrate outcomes naturally.`);
	parts.push(`- When a character is at or below 25% HP, remind them of available recovery options (Second Wind, healing potions, retreat, etc.).`);
	parts.push(`- When combat resolves an objective related to an active quest (e.g. defeating bandits for a "clear the road" quest), include a questUpdates entry to advance or complete that quest.`);
	parts.push(`- If the ACTIVE ENCOUNTER block appears in the game state, combat is ALREADY in progress. Do NOT emit encounterStarted again and do NOT write combat-declaration prose ("Combat begins!", "Roll for initiative!") — the fight is ongoing, just narrate the action.`);
	parts.push(`- GROUP COMBAT RULE: When multiple enemies are present in an encounter, only ONE creature actively engages the player character at a time — the lead creature steps forward while the others hang back, circle, or wait for an opening. Narrate a brief reason for this each round ("the pack circles warily, waiting for an opening" / "the others hold position at the treeline"). If remaining creatures disengage after one is defeated, write a single clear narrative reason in one sentence ("the others bolt into the underbrush as their packmate falls"). This keeps combat legible and prevents multi-enemy tracking confusion.`);
	parts.push('');
	parts.push(`DIALOGUE & SOCIAL ENCOUNTERS:`);
	parts.push(`- When a player speaks to an NPC, roleplay the NPC's response in character.`);
	parts.push(`- If the player is trying to persuade, deceive, or intimidate and the NPC would resist, call for the appropriate check.`);
	parts.push(`- Low-stakes conversation (asking for directions, buying supplies, friendly banter) does not require a roll.`);
	parts.push(`- When stakes are high (convincing a guard to let you pass, lying to a noble, negotiating a hostage release), call for a check before resolving the outcome.`);
	parts.push('');

	// ── Creature naming ──
	parts.push(`=== CREATURE NAMING ===`);
	parts.push(`NEVER use a generic label like "Beast", "Monster", "Creature", or "Entity" as a creature's proper name.`);
	parts.push(`Always give enemy creatures a specific, descriptive identity before or at the moment the encounter starts.`);
	parts.push(`Good examples: "Dire Wolf", "Corrupted Warg", "Mountain Cave Bear", "Rotting Forest Serpent", "Alpha Timber Wolf", "Valley Troll", "Lab-Bred Houndfiend".`);
	parts.push(`Flavor prefixes and titles are encouraged: "Elder", "Alpha", "Cursed", "Great", "Iron-Jaw", "Shadow", "Lab-Created", "Hollow-Eyed".`);
	parts.push(`If you introduced an NPC as "Beast" earlier and it still exists in state, use npcChanges with field "name" to rename it to a proper identity.`);
	parts.push(`The creature description field should explain what the creature looks like — its size, color, distinctive features — not just repeat the name.`);
	parts.push('');

	// ── Currency rules ──
	parts.push(`=== CURRENCY RULES ===`);
	parts.push(`The ONLY currencies with mechanical value in this game are:`);
	parts.push(`  - Gold Pieces (gp) — standard coin`);
	parts.push(`  - Silver Pieces (sp) — 10 sp = 1 gp`);
	parts.push(`  - Copper Pieces (cp) — 10 cp = 1 sp`);
	parts.push(`Any world-specific currency name ("Crowns", "Ducats", "Marks", "Crowns", "Coins of the Realm", "Halholm Marks") is PURELY cosmetic flavor. Treat it as 1:1 with Gold Pieces.`);
	parts.push(`In all stateChanges goldChange entries, ALWAYS use standard GP amounts — never use fictional currency names as amounts.`);
	parts.push(`When a quest reward, NPC payment, or loot is described in world-flavor currency, record it as GP in goldChange. Example: "50 Crowns" → goldChange delta: 50 (50 gp).`);
	parts.push(`Do NOT treat "Crowns" as worth more or less than gp unless the adventure notes explicitly define a conversion.`);
	parts.push('');

	// ── Discretion rules ──
	parts.push(`=== DISCRETION RULES ===`);
	parts.push(`YOU MAY freely:`);
	parts.push(`- Infer the nearest enemy, closest ally, or default equipped weapon when context is obvious`);
	parts.push(`- Describe the environment, add sensory details, weather effects, ambient sounds`);
	parts.push(`- Advance NPC dialogue, create NPC reactions, and roleplay NPC personalities`);
	parts.push(`- Introduce new NPCs, locations, and quests when the story calls for it`);
	parts.push(`- Decide obvious movement paths (e.g., "I go inside" → enter the building)`);
	parts.push(`- Add dramatic tension, foreshadowing, and world flavor`);
	parts.push(`- Resolve trivial actions without a roll (picking up an object, sitting down, eating rations)`);
	parts.push('');
	parts.push(`YOU MUST NOT:`);
	parts.push(`- Silently choose between multiple materially different resource expenditures (healing spells vs potions, different spell slots)`);
	parts.push(`- Violate action economy, spell legality, slot availability, or rest rules`);
	parts.push(`- Override or contradict engine-provided mechanic results (if [Mechanics: ...] is present, those are FACTS)`);
	parts.push(`- Kill or permanently incapacitate a player character without mechanical justification`);
	parts.push(`- Grant magical items above the party's level range without quest justification`);
	parts.push(`- Start combat from scouting, observation, or cautious inquiry alone`);
	parts.push(`- Silently decide the outcome of a contested or high-stakes action without calling for a roll`);
	parts.push(`- Invent breath weapon effects beyond raw damage — no Poisoned condition, no unconsciousness, no sleep from a breath weapon`);
	parts.push(`- Reference or hand out consumable items (dusts, powders, antidotes) that do not appear in a character's inventory`);
	parts.push(`- Narrate a character using a weapon or armor they do not have in their inventory — if the Gear list is empty or lacks a weapon, the character is unarmed; narrate bare-hands or improvised weapon options, or suggest they acquire a weapon before combat`);
	parts.push(`- Assume a character has a class feature, proficiency, or spell if their class information is missing or classless — always check the PARTY section before granting class-specific mechanics`);
	parts.push('');
	parts.push(`WHEN AMBIGUOUS:`);
	parts.push(`- If the player's intent is unclear but harmless, make a reasonable assumption and narrate`);
	parts.push(`- If the ambiguity could cost significant resources, ask a brief in-world clarifying question instead of acting`);
	parts.push('');

	// ── Narrative style ──
	parts.push(`=== NARRATIVE STYLE ===`);
	parts.push(`- Write immersive second-person prose. Show the world; do not summarise it.`);
	parts.push(`- Do NOT end responses with questions or prompts that invite the player to act ("What do you do?", "Where do you go?", "How do you respond?" etc.). The player decides their own next move.`);
	parts.push(`- Do NOT list every NPC present in a location unprompted. Introduce names only when earned — when a character speaks up, steps forward, or is directly addressed.`);
	parts.push(`- Do NOT reveal quest names, objectives, or active leads in narration. Quests are discovered through play. Use ambient hooks only: a posted notice, an overheard fragment, a weeping figure in an alley. Never announce a quest directly.`);
	parts.push(`- Do NOT state day numbers in narrative text. Time of day and weather provide sufficient atmospheric context. Day numbers exist for mechanical deadline tracking only.`);
	parts.push(`- Escalation rule: if a player actively investigates an ambient hint (asks about the crier, picks up the flyer, approaches the crying figure), you MAY sharpen the detail. If they pursue it further, give them the full information plainly.`);
	parts.push(`- QUEST ACTIVATION: When a player directly and intentionally engages a quest hook — reads a posted notice, explicitly accepts a task from a quest giver, heeds a town crier, or responds to a pleading citizen — emit a questUpdates entry with field: 'status', oldValue: 'available', newValue: 'active'. This transitions the quest from invisible world-state into the player's journal. Do NOT activate quests from passive overhearing, casual mention, or mere proximity to a hook. Activation requires clear, deliberate player engagement. SAME-TURN DISCOVER + ACTIVATE: If the quest is brand-new this turn (you are also emitting it in questsAdded), include BOTH questsAdded AND questUpdates { field: 'status', oldValue: 'available', newValue: 'active' } in the same response — the engine applies questsAdded before questUpdates, so the quest exists when the activation fires. Do not defer activation to the next turn when the player already engaged the hook in this action.`);
	parts.push('');
	parts.push(buildGameStateContextBlock(state, worldBrief));

	return parts.join('\n');
}

/**
 * Build the combined game-state context block used by multiple prompt types.
 * Contains world brief, locations, NPCs, party, companions, encounters,
 * quests, time, and established facts.
 */
function buildGameStateContextBlock(state: GameState, worldBrief: string): string {
	const parts: string[] = [];

	// World knowledge
	if (worldBrief) {
		parts.push(`=== WORLD ===`);
		parts.push(worldBrief);
		parts.push('');
	}

	// Current location
	const loc = state.locations.find((l) => l.id === state.partyLocationId);
	if (loc) {
		parts.push(`=== CURRENT LOCATION ===`);
		parts.push(`${formatNameIdRef(loc.name, loc.id)}`);
		parts.push(`Type: ${loc.type}`);
		parts.push(`Description: ${loc.description}`);
		if (loc.features.length > 0) {
			parts.push(`Features: ${loc.features.join('; ')}`);
		}
		const connections = loc.connections
			.map((cid) => state.locations.find((l) => l.id === cid))
			.filter(Boolean)
			.map((l) => formatNameIdRef(l!.name, l!.id));
		if (connections.length > 0) {
			parts.push(`Connections: ${connections.join(', ')}`);
		}
		const localNpcs = state.npcs.filter((n) => n.locationId === loc.id && n.alive && !n.archived);
		if (localNpcs.length > 0) {
			parts.push(`NPCs present: ${localNpcs.map((n) => {
				const condStr = (n.conditions && n.conditions.length > 0) ? ` [${n.conditions.join(', ')}]` : '';
				return `${formatNameIdRef(n.name, n.id)} (${n.role}, ${dispositionLabel(n.disposition)}${condStr})`;
			}).join(', ')}`);
		}
		if (loc.groundItems && loc.groundItems.length > 0) {
			parts.push(`On the ground: ${loc.groundItems.map((i) => `${formatNameIdRef(i.name, i.id)} (${i.category})`).join(', ')}`);
		}
		parts.push('');
	}

	// Known locations — show all discovered locations beyond the current one
	const otherLocations = state.locations
		.filter((l) => l.id !== state.partyLocationId)
		.slice(0, MAX_KNOWN_LOCATIONS);
	if (otherLocations.length > 0) {
		parts.push(`=== KNOWN LOCATIONS ===`);
		for (const l of otherLocations) {
			const tag = `(visited: ${l.visited ? 'yes' : 'no'})`;
			const conns = l.connections
				.map((cid) => state.locations.find((x) => x.id === cid))
				.filter(Boolean)
				.map((x) => formatNameIdRef(x!.name, x!.id));
			const connStr = conns.length > 0 ? ` → connects to: ${conns.join(', ')}` : '';
			parts.push(`- ${formatNameIdRef(l.name, l.id)} (${l.type}) ${tag}${connStr}`);
		}
		parts.push('');
	}

	// Known NPCs — all alive NPCs NOT at the current location, grouped by location
	const remoteNpcs = state.npcs
		.filter((n) => n.alive && !n.archived && n.locationId !== state.partyLocationId);
	if (remoteNpcs.length > 0) {
		const npcRolePriority: Record<string, number> = {
			'companion': 0, 'ally': 0, 'quest-giver': 1, 'merchant': 2, 'neutral': 3, 'hostile': 4, 'boss': 5
		};
		const sorted = [...remoteNpcs].sort((a, b) => {
			const pa = npcRolePriority[a.role] ?? 3;
			const pb = npcRolePriority[b.role] ?? 3;
			if (pa !== pb) return pa - pb;
			const ta = a.lastInteractionTurn ?? 0;
			const tb = b.lastInteractionTurn ?? 0;
			if (ta !== tb) return tb - ta;
			return b.disposition - a.disposition;
		});
		const capped = sorted.slice(0, MAX_KNOWN_NPCS);

		const byLocation = new Map<string, NPC[]>();
		for (const npc of capped) {
			const key = npc.locationId;
			if (!byLocation.has(key)) byLocation.set(key, []);
			byLocation.get(key)!.push(npc);
		}

		parts.push(`=== KNOWN NPCs (away from party) ===`);
		for (const [locId, npcs] of byLocation) {
			const loc = state.locations.find((l) => l.id === locId);
			parts.push(`At ${loc ? formatNameIdRef(loc.name, loc.id) : `locationId: ${locId}`}:`);
			for (const n of npcs) {
				const interactionSummary = buildNpcInteractionSummary(n, state.sceneFacts ?? []);
				const summaryStr = interactionSummary ? ` — ${interactionSummary}` : '';
				const aliasStr = n.aliases?.length ? ` (also known as: ${n.aliases.join(', ')})` : '';
				parts.push(`  - ${formatNameIdRef(n.name, n.id)} (${n.role}, ${dispositionLabel(n.disposition)})${aliasStr}${summaryStr}`);
			}
		}
		parts.push('');
	}

	// Party sheet
	if (state.characters.length > 0) {
		parts.push(`=== PARTY ===`);
		for (const c of state.characters) {
			parts.push(formatCharacterBrief(c));
		}
		parts.push('');
	}

	// Companions
	const companions = state.npcs.filter(
		(n) => n.alive && !n.archived && (n.role === 'ally' || n.role === 'companion') && n.locationId === state.partyLocationId
	);
	if (companions.length > 0) {
		parts.push(`=== COMPANIONS ===`);
		parts.push(`These NPCs are traveling with the party. Companions (role: companion) auto-join combat. Allies (role: ally) only join combat if explicitly listed in encounterStarted.creatures.`);
		for (const c of companions) {
			const interactionSummary = buildNpcInteractionSummary(c, state.sceneFacts ?? []);
			const summaryStr = interactionSummary ? ` — ${interactionSummary}` : '';
			if (c.statBlock) {
				const attacks = c.statBlock.attacks.map((a) => `${a.name} +${a.toHit} (${a.damage} ${a.damageType})`).join(', ');
				const attackStr = attacks ? ` | Attacks: ${attacks}` : '';
				parts.push(`- ${formatNameIdRef(c.name, c.id)} (${c.role}, ${dispositionLabel(c.disposition)}) — ${c.statBlock.hp}/${c.statBlock.maxHp} HP, AC ${c.statBlock.ac}${attackStr}${summaryStr}`);
			} else {
				parts.push(`- ${formatNameIdRef(c.name, c.id)} (${c.role}, ${dispositionLabel(c.disposition)})${summaryStr} [NO STATS — use companionPromoted with just npcId to auto-assign a stat block]`);
			}
		}
		parts.push('');
	}

	// Active encounter
	if (state.activeEncounter && state.activeEncounter.status === 'active') {
		const enc = state.activeEncounter;
		parts.push(`=== ACTIVE ENCOUNTER (Round ${enc.round}) ===`);
		for (const cmb of enc.combatants) {
			const tag = cmb.defeated ? ' (defeated: yes)' : '';
			parts.push(`- ${formatNameIdRef(cmb.name, cmb.id)} (${cmb.type}): ${cmb.currentHp}/${cmb.maxHp} HP, AC ${cmb.ac}${tag}`);
		}
		parts.push(`Use the exact [id:] values above as characterId in hpChanges. Use encounterEnded in stateChanges when the encounter resolves.`);
		parts.push('');
	}

	// Quests
	const visibleQuests = state.quests.filter(
		(q) => q.status === 'active' || q.status === 'available' || q.status === 'completed' || q.status === 'failed'
	);
	if (visibleQuests.length > 0) {
		parts.push(`=== QUESTS ===`);
		for (const q of visibleQuests) {
			const statusTag = `(status: ${q.status})`;
			const objectives = q.objectives.map((o) => formatObjectiveRef(o.text, o.id, o.done)).join('; ');
			const consequence = q.failureConsequence && q.status === 'active'
				? ` | ⚠ Consequence if failed: ${q.failureConsequence}`
				: '';
			const deadlineStr = q.deadline && q.status === 'active'
				? ` | Deadline: Day ${q.deadline.day} — ${q.deadline.description}`
				: '';
			const followUps = q.followUpQuestIds && q.followUpQuestIds.length > 0
				? ` | Unlocks: ${q.followUpQuestIds.map((fid) => { const fq = state.quests.find((x) => x.id === fid); return fq ? formatNameIdRef(fq.name, fq.id) : fid; }).join(', ')}`
				: '';
			const prereqs = q.prerequisiteQuestIds && q.prerequisiteQuestIds.length > 0
				? ` | Requires: ${q.prerequisiteQuestIds.map((pid) => { const pq = state.quests.find((x) => x.id === pid); return pq ? formatNameIdRef(pq.name, pq.id) : pid; }).join(', ')}`
				: '';
			parts.push(`- ${formatNameIdRef(q.name, q.id)} ${statusTag}: ${q.description} | Objectives: ${objectives}${consequence}${deadlineStr}${followUps}${prereqs}`);
		}
		parts.push('');
	}

	// Game clock
	parts.push(`=== TIME ===`);
	parts.push(`Day ${state.clock.day}, ${state.clock.timeOfDay}. Weather: ${state.clock.weather}.`);
	parts.push(`(Day count is for deadline tracking only. Do not reference day numbers in narrative output.)`);
	parts.push('');

	// Time-of-day rules
	parts.push(`=== TIME-OF-DAY RULES ===`);
	parts.push(`- dawn: Most residents sleeping or just waking. Shops closed. Bakers, smiths, and stable hands active. Town gates closed — only known residents admitted.`);
	parts.push(`- morning / afternoon: Full commerce. Gates open. Markets and services trading normally.`);
	parts.push(`- dusk: Merchants closing stalls. Town gate guards becoming strict. Taverns and inns start filling.`);
	parts.push(`- night: Town gates SEALED — no entry or exit (enforce the gatePolicy field; "daytime-only" = hard block). City gates guarded — travellers may enter but guards challenge and interrogate ("guarded-at-night"). Shops closed. Inns and taverns open. Entering a private residence at night is an intrusion — occupants are startled and may react with alarm or hostility. Guards actively patrolling.`);
	parts.push(`Location gatePolicy values: "none" = no gate; "daytime-only" = sealed dusk to dawn; "guarded-at-night" = guards challenge at night but entry is possible.`);
	parts.push('');

	// Established scene facts
	const sceneFacts = state.sceneFacts ?? [];
	if (sceneFacts.length > 0) {
		parts.push(`=== ESTABLISHED FACTS ===`);
		const recentFacts = sceneFacts.slice(-20);
		for (const fact of recentFacts) {
			parts.push(`- ${fact}`);
		}
		parts.push('');
	}

	return parts.join('\n');
}

/**
 * Build the legacy combined system prompt (narrative + JSON format instructions).
 * This is the original single-pass prompt used before the two-pass split.
 * Kept for backward compatibility and fallback mode.
 */
function buildSystemPrompt(state: GameState, worldBrief: string): string {
	const parts: string[] = [];

	parts.push(`You are the Game Master of a text-based fantasy RPG adventure.`);
	parts.push(`You narrate in second-person perspective, speaking directly to the party.`);
	parts.push(`You are authoritative about the world — you describe what happens as a consequence of player actions.`);
	parts.push(`You respect the mechanics: when dice results are provided, narrate around those outcomes faithfully.`);
	parts.push(`Keep responses vivid and concise (2–5 sentences for normal actions, more for important moments).`);
	parts.push('');

	// Decision rubric
	parts.push(`=== DISCRETION RULES ===`);
	parts.push(`YOU MAY freely:`);
	parts.push(`- Infer the nearest enemy, closest ally, or default equipped weapon when context is obvious`);
	parts.push(`- Describe the environment, add sensory details, weather effects, ambient sounds`);
	parts.push(`- Advance NPC dialogue, create NPC reactions, and roleplay NPC personalities`);
	parts.push(`- Introduce new NPCs, locations, and quests when the story calls for it (use npcsAdded/locationsAdded/questsAdded)`);
	parts.push(`- Award small XP for roleplay, exploration, or clever solutions`);
	parts.push(`- Decide obvious movement paths (e.g., "I go inside" → enter the building)`);
	parts.push(`- Add dramatic tension, foreshadowing, and world flavor`);
	parts.push('');
	parts.push(`YOU MUST NOT:`);
	parts.push(`- Silently choose between multiple materially different resource expenditures (healing spells vs potions, different spell slots)`);
	parts.push(`- Change HP, spell slots, or inventory without reflecting it in stateChanges`);
	parts.push(`- Violate action economy, spell legality, slot availability, or rest rules`);
	parts.push(`- Create encounters or combat without using encounterStarted in stateChanges (encounterStarted is REQUIRED whenever your narrative describes enemies attacking or combat beginning — never omit it and never submit an empty creatures array)`);
	parts.push(`- Override or contradict engine-provided mechanic results (if [Mechanics: ...] is present, those are FACTS)`);
	parts.push(`- Kill or permanently incapacitate a player character without mechanical justification`);
	parts.push(`- Move the party to a new location without a locationChange in stateChanges`);
	parts.push(`- Grant magical items above the party's level range without quest justification`);
	parts.push(`- Use "Beast", "Monster", "Creature", or any other generic label as a creature's name — always give a specific, descriptive identity (e.g. "Dire Wolf", "Corrupted Warg", "Mountain Cave Bear")`);
	parts.push(`- Start combat without firing encounterStarted regardless of how minor the fight seems — ALL player-involved combat uses the turn-based encounter system`);
	parts.push(`- Narrate a character using a weapon or armor they do not have in their inventory — if their Gear list is empty or lacks a suitable weapon, they are unarmed; present improvised weapon or bare-hand options, or suggest acquiring a weapon first`);
	parts.push(`- Assume class features or spells for a character whose class is shown as classless or not assigned`);
	parts.push('');
	parts.push(`WHEN AMBIGUOUS:`);
	parts.push(`- If the player's intent is unclear but harmless, make a reasonable assumption and narrate`);
	parts.push(`- If the ambiguity could cost significant resources, ask a brief in-world clarifying question instead of acting`);
	parts.push('');

	// ── Narrative style ──
	parts.push(`=== NARRATIVE STYLE ===`);
	parts.push(`- Write immersive second-person prose. Show the world; do not summarise it.`);
	parts.push(`- Do NOT end responses with questions or prompts that invite the player to act ("What do you do?", "Where do you go?", "How do you respond?" etc.). The player decides their own next move.`);
	parts.push(`- Do NOT list every NPC present in a location unprompted. Introduce names only when earned — when a character speaks up, steps forward, or is directly addressed.`);
	parts.push(`- Do NOT reveal quest names, objectives, or active leads in narration. Quests are discovered through play. Use ambient hooks only: a posted notice, an overheard fragment, a weeping figure in an alley. Never announce a quest directly.`);
	parts.push(`- Do NOT state day numbers in narrative text. Time of day and weather provide sufficient atmospheric context. Day numbers exist for mechanical deadline tracking only.`);
	parts.push(`- Escalation rule: if a player actively investigates an ambient hint (asks about the crier, picks up the flyer, approaches the crying figure), you MAY sharpen the detail. If they pursue it further, give them the full information plainly.`);
	parts.push(`- QUEST ACTIVATION: When a player directly and intentionally engages a quest hook — reads a posted notice, explicitly accepts a task from a quest giver, heeds a town crier, or responds to a pleading citizen — emit a questUpdates entry with field: 'status', oldValue: 'available', newValue: 'active'. This transitions the quest from invisible world-state into the player's journal. Do NOT activate quests from passive overhearing, casual mention, or mere proximity to a hook. Activation requires clear, deliberate player engagement. SAME-TURN DISCOVER + ACTIVATE: If the quest is brand-new this turn (you are also emitting it in questsAdded), include BOTH questsAdded AND questUpdates { field: 'status', oldValue: 'available', newValue: 'active' } in the same response — the engine applies questsAdded before questUpdates, so the quest exists when the activation fires. Do not defer activation to the next turn when the player already engaged the hook in this action.`);
	parts.push('');

	// Shared game state block
	parts.push(buildGameStateContextBlock(state, worldBrief));

	// Response format instructions (JSON)
	parts.push(`=== RESPONSE FORMAT ===`);
	parts.push(`Return a JSON object with exactly these fields:`);
	parts.push(`{`);
	parts.push(`  "narrativeText": "Your narration of what happens (shown to players)",`);
	parts.push(`  "stateChanges": {`);
	parts.push(`    "hpChanges": [{"characterId": "exact-id-from-PARTY-id-field", "oldHp": N, "newHp": N, "reason": "..."}] or omit,`);
	parts.push(`    "itemsGained": [{"characterId": "exact-id-from-PARTY-id-field", "item": {"id": "new-ulid", "name": "...", "category": "weapon|armor|consumable|quest|misc", "description": "...", "value": N, "quantity": N}}] or omit,`);
	parts.push(`    "itemsLost": [{"characterId": "exact-id-from-PARTY-id-field", "itemId": "exact-item-id-from-inventory", "quantity": N}] or omit,`);
	parts.push(`    "itemsDropped": [{"characterId": "exact-id-from-PARTY-id-field", "itemId": "exact-item-id-from-inventory"}] or omit,`);
	parts.push(`    "itemsPickedUp": [{"characterId": "exact-id-from-PARTY-id-field", "itemId": "exact-item-id-from-ON-THE-GROUND"}] or omit,`);
	parts.push(`    "locationItemsAdded": [{"locationId": "exact-location-id-from-visible-[id:-field]", "item": {"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}}] or omit,`);
	parts.push(`    "locationChange": {"from": "exact-current-location-id-from-visible-[id:-field]-or-null", "to": "exact-location-id-from-visible-[id:-field]"} or omit,`);
	parts.push(`    "npcChanges": [{"npcId": "exact-id-from-visible-[id:-field]", "field": "disposition|alive|hp", "oldValue": X, "newValue": Y} or {"npcId": "exact-id-from-visible-[id:-field]", "field": "notes", "newValue": Y}] or omit,`);
	parts.push(`    "questUpdates": [{"questId": "exact-id-from-visible-[id:-field]", "field": "status", "oldValue": "active", "newValue": "available|active|completed|failed", "completionMethod": "combat|diplomacy|stealth|bribery|deception|custom (include when completing or failing)"} or {"questId": "exact-id-from-visible-[id:-field]", "field": "objective", "objectiveId": "exact-objective-id-from-objective(..., id: ...)", "oldValue": false, "newValue": true}] or omit,`);
	parts.push(`    "conditionsApplied": [{"characterId": "exact-id-from-PARTY-or-NPC-id-field", "condition": "blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious|exhaustion", "applied": true|false}] or omit — use for PCs AND NPCs,`);
	parts.push(`    "xpAwarded": [{"characterId": "exact-id-from-PARTY-id-field", "amount": N}] or omit,`);
	parts.push(`    "goldChange": [{"characterId": "exact-id-from-PARTY-id-field", "delta": N, "reason": "..."}] or omit — use for direct gold payments/earnings/exchanges (positive delta = receive gold, negative = spend gold),`);
	parts.push(`    "npcsAdded": [{"id": "npc-<unique>", "name": "...", "role": "merchant|quest-giver|hostile|neutral|ally|companion|boss", "locationId": "exact-location-id-from-visible-[id:-field]", "disposition": 0, "description": "..."}] or omit,`);
	parts.push(`    "locationsAdded": [{"id": "loc-<unique>", "name": "...", "type": "settlement|wilderness|dungeon|interior|road", "description": "...", "connections": ["exact-location-id-from-visible-[id:-field]"], "features": ["..."], "groundItems": [{"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}]}] or omit,`);
	parts.push(`    "questsAdded": [{"id": "quest-<unique>", "name": "...", "description": "...", "giverNpcId": "exact-npc-id-from-visible-[id:-field]-or-null", "objectives": [{"id": "obj-<unique>", "text": "..."}], "recommendedLevel": N, "rewards": {"xp": N, "gold": N}, "status": "available|active (optional — use 'active' only if the player engaged this hook in the current action)", "failureConsequence": "one-sentence consequence if not completed (optional)", "deadline": {"day": N, "description": "..."} (optional), "followUpQuestIds": ["quest-id"] (optional)}] or omit,`);
	parts.push(`    "sceneFactsAdded": ["fact about the scene or world"] or omit,`);
	parts.push(`    "encounterStarted": {"creatures": [{"id": "npc-<unique>", "name": "...", "role": "hostile", "locationId": "exact-location-id-from-visible-[id:-field]-or-omit-for-party-location", "disposition": -100, "description": "...", "tier": "weak|normal|tough|elite|boss"}]} — REQUIRED when narrative describes combat starting; NEVER omit and NEVER submit an empty creatures array — list each enemy with id, name, role:'hostile', and tier,`);
	parts.push(`    "encounterEnded": {"outcome": "victory|defeat|flee|negotiated"} or omit,`);
	parts.push(`    "companionPromoted": [{"npcId": "exact-npc-id-from-visible-[id:-field]"}] or omit (array — include one entry per NPC to recruit; statBlock is optional, the engine auto-generates if omitted),`);
	parts.push(`    "clockAdvance": {"from": {"day": N, "timeOfDay": "...", "weather": "..."}, "to": {"day": N, "timeOfDay": "...", "weather": "..."}} or omit`);
	parts.push(`  },`);
	parts.push(`  "gmNotes": "optional private reasoning"`);
	parts.push(`}`);
	parts.push('');
	parts.push(`=== CRITICAL RULES ===`);
	parts.push(`IMPORTANT: For every "characterId" field, output ONLY the bare ID string from the [id: ...] field in the PARTY section — e.g. if the party entry reads "[name: Alice][id: 01ABC123]" then characterId must be "01ABC123", NOT "Alice" and NOT the full token string. Never use a character's name or any invented string as a characterId.`);
	parts.push(`- Every NPC you mention by name for the FIRST TIME must be tracked via npcsAdded. Do not introduce named NPCs only in narrative.`);
	parts.push(`- Before adding a new NPC via npcsAdded, check KNOWN NPCs for any existing entry showing "(also known as: ...)" — if the name matches an alias, use that NPC's existing id rather than creating a duplicate.`);
	parts.push(`- Every item gained or lost MUST appear in the correct stateChanges field(s). Do not mention acquiring or losing items only in narrative.`);
	parts.push(`- ITEM DROP/PICKUP RULES: Use itemsDropped (with itemId from inventory) when a character sets an item down — it lands at the current location shown as "On the ground" next turn. Use itemsPickedUp (with the exact itemId shown in "On the ground") when recovering a dropped item — this restores the ORIGINAL item id intact. Use itemsLost only for consumed/sold/stolen/destroyed items. Use itemsGained only for truly new items (purchases, loot, rewards). Use locationItemsAdded to place new items at any location (chest unlocked, enemy killed, GM loot).`);
	parts.push(`- PURCHASE PAYMENTS: When the narrative shows the player paying gold for goods, services, or passage, you MUST emit goldChange with a negative delta equal to the amount paid. Recording it in sceneFactsAdded alone is NOT sufficient.`);
	parts.push(`- ITEM ACQUISITION NARRATION: Every item the narrative describes as looted, found, gifted, picked up, or purchased MUST have a corresponding stateChanges entry (itemsGained or itemsPickedUp). If you narrate it, track it mechanically — failure means the item does not exist in the game.`);
	parts.push(`- ITEM NAMING RULES: Every item in itemsGained or locationItemsAdded must be a single, atomic item. Never combine two or more distinct items into one name using "and" — e.g. "Sword and Shield" is FORBIDDEN; instead list them as two separate entries. Do not add an item whose name or weaponName already exists in the character's inventory.`);
	parts.push(`- When a companion NPC (shown in COMPANIONS) is in combat, include their combat actions in narrativeText and any HP/alive changes via npcChanges (use field: "hp" for companion HP changes).`);
	parts.push(`- Use npcChanges with field: "notes" to record important NPC interaction details (e.g. deals struck, secrets revealed, favors owed). The note text goes in newValue as a string.`);
	parts.push(`- To formally recruit NPCs as companions, use companionPromoted with an ARRAY of entries — one per NPC, e.g. [{"npcId": "npc-001"}, {"npcId": "npc-002"}]. You may include a full statBlock per entry or omit it — the engine auto-generates stats if missing. This changes their role to "companion" and they will auto-travel with the party and auto-join combat.`);
	parts.push(`- COMPANION vs ALLY: "companion" NPCs auto-join every encounter. "ally" NPCs only fight if you explicitly list them in encounterStarted.creatures (useful for temporary or situational allies). Do NOT change an NPC's role to companion/ally via npcChanges — always use companionPromoted.`);
	parts.push(`- When an encounter has multiple enemies, create separate creatures entries for EACH enemy, not just a representative sample.`);
	parts.push(`- Do NOT start and end an encounter in the same response. Combat should span multiple turns.`);
	parts.push(`- During active combat the engine resolves all attacks, damage, and dice rolls mechanically. Do NOT specify attack targets or actions in stateChanges — the engine handles this authoritatively.`);
	parts.push(`- Treat locationChange.from, questUpdates.oldValue, and npcChanges.oldValue as concurrency guards. When included, they MUST match the current state shown in the prompt or the write may be rejected.`);
	parts.push(`- Only reference NPC IDs, quest IDs, location IDs, and item IDs that exist in the state shown above. Do not invent references to entities you haven't created via *Added fields.`);
	parts.push(`- If the action has no mechanical effect, return an empty stateChanges object {}.`);
	parts.push(`- When creating new NPCs/locations/quests, generate unique IDs prefixed with "npc-", "loc-", or "quest-".`);
	parts.push(`- Connect new locations to existing ones via the connections array.`);
	parts.push(`- IMPORTANT: Always return valid JSON. The narrativeText field is required.`);
	parts.push(`- Record important world details (NPC agreements, prices, promises, discoveries) as sceneFactsAdded so they persist across turns.`);
	parts.push(`- GOLD PAYMENTS: When an NPC pays or rewards the party, ALWAYS use goldChange (not just sceneFactsAdded). The delta amount MUST match the active quest reward if a quest covers this payment — never invent a different amount. If no quest exists, base the amount on negotiated/agreed terms visible in the narrative.`);
	parts.push(`- QUEST REWARD GOLD: When a quest is completed, the engine automatically distributes quest.rewards.gold to every party member. NEVER also emit a goldChange entry for that same amount in the same response — it will be applied twice, giving the party double gold. Do not narrate an NPC paying out the quest reward amount AND also emit goldChange in the same turn.`);
	parts.push(`- QUEST COMPLETION METHOD: When completing or failing a quest via questUpdates status change, always include "completionMethod". Choose: "combat" (defeated in battle), "diplomacy" (talked down or negotiated), "stealth" (bypassed undetected), "bribery" (paid off), "deception" (tricked), "custom" (other). A "defeat-encounter" objective CAN be resolved by diplomacy — if the party talked down enemies without fighting, mark objectives done with completionMethod "diplomacy".`);
	parts.push(`- QUEST STAKES: When creating new quests via questsAdded, add a "failureConsequence" (one sentence) describing what happens in the world if the party fails. For time-sensitive quests, add a "deadline" with a specific day number and plain-language description. These fields make the world feel reactive and create narrative stakes.`);
	parts.push('');
	parts.push(`=== BREATH WEAPON & CONDITION RULES ===`);
	parts.push(`- A breath weapon deals DAMAGE ONLY based on its damage type. It NEVER automatically applies the Poisoned condition, NEVER causes unconsciousness, and NEVER induces sleep on a failed save. No conditions are applied unless a separate racial ability or magic item explicitly states it.`);
	parts.push(`- The POISONED condition means: disadvantage on attack rolls and ability checks ONLY. It does NOT cause sleep, paralysis, or unconsciousness. Never conflate the Poisoned condition with being knocked out.`);
	parts.push(`- GRAPPLE sets the target's speed to 0. It does NOT impose disadvantage on saving throws and does NOT affect breath weapon saves or spell saves in any way.`);
	parts.push(`- NPC conditions: use conditionsApplied with the NPC's exact id (from KNOWN NPCS) to track active conditions. Conditions are shown in brackets next to NPCs in the CURRENT LOCATION section when present.`);
	parts.push('');
	parts.push(`=== NON-LETHAL DAMAGE ===`);
	parts.push(`- When the engine emits a mechanic result labelled "Non-lethal KO — [target]", the target is unconscious at 0 HP but NOT dead. Do NOT emit npcChanges with field alive: false. Narrate them being knocked out, not killed.`);
	parts.push(`- Non-lethal applies to melee weapon attacks only. Spells, breath weapons, and ranged attacks CANNOT be declared non-lethal — they always deal lethal damage.`);
	parts.push(`- A non-lethally knocked-out target is alive, unconscious, stable at 0 HP. They may be tied up, questioned, or left behind.`);
	parts.push('');
	parts.push(`=== ENCOUNTER DECLARATION DISCIPLINE ===`);
	parts.push(`- NEVER write combat-declaration prose ("Combat begins!", "Hostilities break out!", "Prepare yourself!") unless your stateChanges for THIS SAME response include a valid encounterStarted with named creatures. Violating this creates broken encounter state — the UI enters combat mode with no combatants.`);
	parts.push(`- If the ACTIVE ENCOUNTER block is already present in the game state, combat is ongoing. Do NOT write "Combat begins!" or any variant again, and do NOT emit encounterStarted — the fight is already in progress, just narrate the current action.`);
	parts.push(`- Scouting, observing enemies from a distance, hearing about enemies, and cautious dialogue NEVER warrant combat-declaration prose.`);
	parts.push(`- ALL COMBAT IS TURN-BASED: When a player character is actively participating in any fight, encounterStarted MUST be emitted with all combatants. There is no minor skirmish that bypasses this. Pure narration-only combat is only valid when the player is a completely passive spectator (e.g. watching through a telescope).`);
	parts.push(`- GROUP COMBAT: When multiple enemies are present, only ONE engages at a time. The rest hang back with a brief narrative reason. When remaining enemies leave after a defeat, give one clear sentence: "the others bolt into the dark as their leader falls."`);
	parts.push(`- CREATURE NAMING: Never name an NPC just "Beast", "Monster", or "Creature". Always use a specific descriptive identity: "Dire Wolf", "Corrupted Warg", "Elder Cave Bear", etc.`);
	parts.push(`- CURRENCY: Only Gold Pieces (gp), Silver Pieces (sp), and Copper Pieces (cp) are mechanical currencies. World-flavor currency names (Crowns, Marks, Ducats) are 1:1 with gp. Always record goldChange in GP amounts.`);
	parts.push('');
	parts.push(`=== CRAFTING & HOMEBREW ITEMS ===`);
	parts.push(`- No crafting system exists in this campaign unless a quest or explicit DM note introduces one. Do NOT invent harvesting mechanics, ingredient lists, or crafting recipes from creature bodies.`);
	parts.push(`- If a player asks to craft something, describe the 5e downtime crafting baseline (days of work = item value ÷ 25 GP, tool proficiency required) and note it needs GM approval before beginning.`);
	parts.push(`- When adding a crafted or player-assembled item via itemsGained, include crafted: true and craftedFrom describing the source materials in the item object.`);
	parts.push(`- PHANTOM ITEMS: Never reference or hand out consumable items (dusts, powders, antidotes, tinctures) that do not already appear in a character's inventory or in locationItems. If a player says "I use my dragon-scale dust", check the inventory first — if it isn't there, tell them they don't have it.`);
	parts.push('');
	parts.push(`=== DRAGONBORN SUBRACES ===`);
	parts.push(`- "Lead dragonborn" has no official 5e SRD entry. Treat it as the Green dragon ancestry: 15-foot cone, Constitution saving throw, poison damage type.`);
	parts.push(`- Breath weapon DC = 8 + CON modifier + proficiency bonus. Damage: 2d6 at levels 1–5, 3d6 at 6–10, 4d6 at 11–15, 5d6 at 16+.`);
	parts.push(`- Poison damage type from this breath weapon is damage only — it does NOT apply the Poisoned condition unless a separate ability explicitly grants it.`);
	parts.push('');
	parts.push(`=== RAGE / BARBARIAN RULES ===`);
	parts.push(`- When a barbarian activates Rage (says "I rage", "I enter rage", etc.), emit featureUsed: {"characterId": "...", "feature": "Rage"}. The engine automatically applies physical damage resistance and the rage damage bonus — do NOT manually adjust HP changes for these effects.`);
	parts.push(`- Do NOT emit conditionsApplied for "raging" — the engine manages the raging condition internally.`);
	parts.push(`- Rage ends automatically when combat ends. Remaining Rage uses are shown in the party stat block under featureUses.Rage.current.`);

	return parts.join('\n');
}

// ---------------------------------------------------------------------------
// State extraction prompt (Pass 2)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the state-extraction AI (Pass 2).
 *
 * This AI receives the current game state and the narrative that just happened,
 * and must extract all mechanical state changes as structured JSON.
 * It uses response_format: json_object, so must mention JSON.
 */
export function buildStateExtractionPrompt(state: GameState): string {
	const parts: string[] = [];

	parts.push(`You are the Game State Tracker for a text-based fantasy RPG.`);
	parts.push(`You will receive the current game state and a narrative description of what just happened.`);
	parts.push(`Your ONLY job is to extract the mechanical state changes from the narrative and return them as a JSON object.`);
	parts.push(`Do NOT write narrative prose. Return ONLY the JSON object described below.`);
	parts.push('');
	parts.push(`=== EXTRACTION RULES ===`);
	parts.push(`Read the narrative carefully and identify ALL of the following that occurred:`);
	parts.push(`- HP changes to any character or NPC (damage, healing)`);
	parts.push(`- Items gained or lost by any character`);
	parts.push(`- Movement to a new location (if the party traveled somewhere new)`);
	parts.push(`- New NPCs introduced by name for the first time`);
	parts.push(`- New locations described for the first time`);
	parts.push(`- New quests or quest objectives mentioned`);
	parts.push(`- Quest progress (objectives completed, quest status changes)`);
	parts.push(`- QUEST ACTIVATION: When the narrative clearly shows a player directly and intentionally engaging a quest hook (reading a posted notice, accepting from a quest giver, heeding a town crier, responding to a pleading citizen), emit questUpdates with field: 'status', oldValue: 'available', newValue: 'active'. This is the mechanic that makes a quest appear in the player's journal. Do NOT activate quests for passive observation, accidental overhearing, or casual proximity to a hook. SAME-TURN DISCOVER + ACTIVATE: If the narrative shows a brand-new quest being created AND the player engaging it in the same action, emit BOTH questsAdded AND questUpdates { field: 'status', oldValue: 'available', newValue: 'active' } — the engine processes questsAdded before questUpdates, so this is safe.`);
	parts.push(`- NPC disposition changes (became friendlier/hostile)`);
	parts.push(`- NPC deaths (alive → false, hp → 0)`);
	parts.push(`- Conditions applied or removed (poisoned, charmed, etc.)`);
	parts.push(`- XP that should be awarded for accomplishments`);
	parts.push(`- Combat encounters starting or ending`);
	parts.push(`- Important world facts that should be remembered (agreements, prices, discoveries, lore)`);
	parts.push(`- NPC interaction notes (deals struck, secrets revealed, promises made)`);
	parts.push(`- NPCs being recruited as companions`);
	parts.push('');
	parts.push(`=== IMPORTANT GUIDELINES ===`);
	parts.push(`- If the narrative describes movement to a NEW place not in KNOWN LOCATIONS, you MUST emit locationsAdded AND locationChange.`);
	parts.push(`- LOCATION ENFORCEMENT: When a quest or mission sends the player to a distinctly-named new place not in KNOWN LOCATIONS (a supply camp, new outpost, dungeon, etc.), emit locationsAdded with a new unique id AND locationChange to move the party there. Never narrate arrival at a mission area without creating its location. Never reuse an existing location id for a different, new place.`);
	parts.push(`- DESTROYED LOCATIONS: If ESTABLISHED FACTS mention a location was burned, ruined, destroyed, or abandoned, treat it as inactive. Do not generate active enemy encounters at that location id, and do not send the player on new missions there — create a fresh location entry for new missions.`);
	parts.push(`- If the narrative mentions a new NPC by name, you MUST emit npcsAdded — unless the name matches an alias shown in parentheses after any existing KNOWN NPC entry (e.g. "(also known as: Aunt Tess)"), in which case use that NPC's existing id instead.`);
	parts.push(`- If the narrative describes gaining or losing an item, emit the correct field: itemsDropped (placed on ground), itemsPickedUp (recovered from ground using exact id), itemsLost (consumed/sold/destroyed), itemsGained (brand new item), or locationItemsAdded (new item at a location).`);
	parts.push(`- ITEM DROP/PICKUP: itemsDropped moves an item from inventory to the location's ground (preserving its original id). itemsPickedUp moves it back — use the EXACT item id from "On the ground" in the location state. Never use itemsGained to recover a ground item; that creates a hallucinated duplicate.`);
	parts.push(`- If an NPC is killed in the narrative, emit npcChanges with field "alive", newValue false, AND field "hp", newValue 0.`);
	parts.push(`- Use EXACT character/NPC/location/quest IDs from the state below. Do not invent references to entities not in state or not in your *Added fields.`);
	parts.push(`- For new entities, generate unique IDs with prefixes: "npc-", "loc-", "quest-", "obj-", "item-".`);
	parts.push(`- Connect new locations to existing ones via the connections array.`);
	parts.push(`- Record important world details as sceneFactsAdded — agreements, prices, discoveries, lore, NPC promises.`);
	parts.push(`- GOLD PAYMENTS: When the narrative shows an NPC paying the party or the party spending gold, emit goldChange with the exact amount. Use positive delta for received gold, negative for spent gold.`);
	parts.push(`- CURRENCY NORMALIZATION: All in-world currency names ("Crowns", "Marks", "Ducats", "Coins of the Realm") are 1:1 with Gold Pieces. Always record goldChange in GP amounts even if the narrative uses a world-flavor currency name.`);
	parts.push(`- CREATURE NAMING: If an NPC in state is named generically ("Beast", "Monster", "Creature"), and the narrative gives it a more specific identity, emit npcChanges with field "name" and the new descriptive name.`);
	parts.push(`- COMBAT TRACKING: If the narrative describes a fight in which the player character participated but no encounterStarted was emitted this turn, you MUST emit encounterStarted with all enemies present. All player-involved combat requires encounter tracking.`);
	parts.push(`- GROUP COMBAT: When enemies flee or disengage after a partial defeat, emit npcChanges alive: false (or escaped: true via notes) for those NPCs so they are not left in limbo.`);
	parts.push(`- Use npcChanges with field "notes" to record significant NPC interaction details.`);
	parts.push(`- If the narrative has NO mechanical effects, return {"stateChanges": {}}.`);
	parts.push(`- Do NOT award XP or complete quest objectives for merely asking questions, hearing rumors, scouting from safety, or discussing possible plans.`);
	parts.push(`- Do NOT start combat for simple observation or reconnaissance unless hostilities actually begin, the party is discovered, or the narrative clearly commits to battle.`);
	parts.push(`- Only use encounterStarted when the narrative contains an EXPLICIT attack, ambush, or charge — words like "attacks", "lunges", "combat begins", "roll for initiative". Scouting, observing, and cautious dialogue are NOT combat.`);
	parts.push(`- ENCOUNTER NPC IDENTITY: In encounterStarted.creatures, each creature MUST use either (a) a brand-new unique id (e.g., npc-guard-1) or (b) an existing NPC id ONLY if that NPC is currently at the party's location with hostile disposition. NEVER use the id of a quest-giver, merchant, ally, or companion as a hostile creature — give enemy commanders new ids.`);
	parts.push(`- Award small XP (10-50) for clever roleplay, exploration, or puzzle-solving.`);
	parts.push(`- Do NOT emit xpAwarded for enemy kills or combat victories — the game engine awards combat XP automatically via resolveEncounter. Only emit xpAwarded for roleplay, exploration, puzzle-solving, or social accomplishments.`);
	parts.push(`- QUEST COMPLETION METHOD: When a quest is completed or failed, include "completionMethod" in the questUpdates status entry. Choose: "combat" (enemies defeated in battle), "diplomacy" (negotiated/talked-down), "stealth" (bypassed unseen), "bribery" (paid off), "deception" (tricked), "custom" (other). A "defeat-encounter" objective CAN be resolved by diplomacy — if the narrative shows the party talked enemies down without combat, mark objectives done with completionMethod "diplomacy".`);
	parts.push(`- QUEST REWARDS: Every quest created via questsAdded MUST include a "rewards" object with non-zero xp appropriate to the difficulty (minimum 50 per recommendedLevel). Include gold when the quest-giver is a noble, officer, or merchant. Never omit rewards or emit {xp: 0, gold: 0}.`);
	parts.push(`- BREATH WEAPON EXTRACTION: A breath weapon hit causes DAMAGE ONLY. Never emit conditionsApplied for "poisoned" or "unconscious" as a direct result of a breath weapon. If the narrative says the target was "knocked out by the breath", do NOT emit conditionsApplied — the engine handles melee KO only.`);
	parts.push(`- NON-LETHAL KO EXTRACTION: If the narrative describes a melee attack knocking a target unconscious (non-lethal), emit conditionsApplied for "unconscious" on the target's NPC id. Do NOT also emit npcChanges with alive: false — the target survived.`);
	parts.push(`- PHANTOM ITEMS: Do not emit itemsGained for items the narrative invents on-the-fly (dusts, powders, antidotes) unless those items already exist as locationItems or the narrative shows them being purchased/rewarded in this same turn.`);
	parts.push(`- PURCHASE SPENDING: When the narrative shows the player spending or paying gold, emit goldChange with a negative delta equal to the amount paid.`);
	parts.push(`- ITEM ACQUISITION: Every item the narrative describes as acquired (looted, picked up, purchased, gifted) must be emitted in itemsGained or itemsPickedUp. Do not let inventory acquisitions exist only in narrative.`);
	parts.push(`- COMBAT PROSE WITHOUT encounterStarted: If the narrative shows actual combat taking place (enemies attacking, damage being dealt, characters fighting) but no encounterStarted was included in the stateChanges, you MUST emit encounterStarted with all enemies present — omitting it leaves the encounter untracked. The ONLY exception is a narrative that contains ONLY a declaration phrase ("Combat begins!") with no actual combat actions described — in that case do not emit encounterStarted.`);
	parts.push(`- QUEST GOLD EXTRACTION: If the narrative describes an NPC paying the party an amount that matches a quest completion reward AND that quest has a non-zero gold reward in this same turn, do NOT emit goldChange — the engine's distributeQuestRewards function already handles distributing that gold. However, if the completed quest had no gold reward (rewards.gold === 0) or if the gold payment is clearly separate from quest reward distribution, you MUST emit goldChange for that payment.`);
	parts.push(`- RAGE: When the narrative shows a barbarian activating rage, emit featureUsed: {"characterId": "...", "feature": "Rage"}. Do NOT emit conditionsApplied for "raging" — the engine manages this condition.`);
	parts.push('');

	// Response format
	parts.push(`=== JSON RESPONSE FORMAT ===`);
	parts.push(`Return a JSON object with exactly this structure:`);
	parts.push(`{`);
	parts.push(`  "stateChanges": {`);
	parts.push(`    "hpChanges": [{"characterId": "exact-id", "oldHp": N, "newHp": N, "reason": "..."}] or omit,`);
	parts.push(`    "itemsGained": [{"characterId": "exact-id-from-CHARACTERS-id-field", "item": {"id": "item-<unique>", "name": "...", "category": "weapon|armor|consumable|quest|misc", "description": "...", "value": N, "quantity": N}}] or omit,`);
	parts.push(`    "itemsLost": [{"characterId": "exact-id-from-CHARACTERS-id-field", "itemId": "exact-item-id", "quantity": N}] or omit,`);
	parts.push(`    "itemsDropped": [{"characterId": "exact-id-from-CHARACTERS-id-field", "itemId": "exact-item-id-from-inventory"}] or omit,`);
	parts.push(`    "itemsPickedUp": [{"characterId": "exact-id-from-CHARACTERS-id-field", "itemId": "exact-item-id-from-ground"}] or omit,`);
	parts.push(`    "locationItemsAdded": [{"locationId": "exact-location-id-from-visible-[id:-field]", "item": {"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}}] or omit,`);
	parts.push(`    "locationChange": {"from": "exact-current-location-id-or-null", "to": "exact-destination-location-id"} or omit,`);
	parts.push(`    "npcChanges": [{"npcId": "exact-id-from-visible-[id:-field]", "field": "disposition|alive|hp", "oldValue": X, "newValue": Y} or {"npcId": "exact-id-from-visible-[id:-field]", "field": "notes", "newValue": Y}] or omit,`);
	parts.push(`    "questUpdates": [{"questId": "exact-id-from-visible-[id:-field]", "field": "status", "oldValue": "active", "newValue": "available|active|completed|failed", "completionMethod": "combat|diplomacy|stealth|bribery|deception|custom (include when completing/failing)"} or {"questId": "...", "field": "objective", "objectiveId": "...", "oldValue": false, "newValue": true}] or omit,`);
	parts.push(`    "conditionsApplied": [{"characterId": "exact-id-from-CHARACTERS-or-NPCs-id-field", "condition": "blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious|exhaustion", "applied": true|false}] or omit — applies to PCs and NPCs,`);
	parts.push(`    "xpAwarded": [{"characterId": "exact-id-from-CHARACTERS-id-field", "amount": N}] or omit,`);
	parts.push(`    "goldChange": [{"characterId": "exact-id-from-CHARACTERS-id-field", "delta": N, "reason": "..."}] or omit — use for direct gold payments, sales, or wages (positive = received, negative = spent),`);
	parts.push(`    "npcsAdded": [{"id": "npc-<unique>", "name": "...", "role": "merchant|quest-giver|hostile|neutral|ally|companion|boss", "locationId": "exact-location-id-from-visible-[id:-field]", "disposition": 0, "description": "..."}] or omit,`);
	parts.push(`    "locationsAdded": [{"id": "loc-<unique>", "name": "...", "type": "settlement|wilderness|dungeon|interior|road", "description": "...", "connections": ["exact-location-id-from-visible-[id:-field]"], "features": ["..."], "groundItems": [{"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}]}] or omit,`);
	parts.push(`    "questsAdded": [{"id": "quest-<unique>", "name": "...", "description": "...", "giverNpcId": "exact-npc-id-from-visible-[id:-field]-or-null", "objectives": [{"id": "obj-<unique>", "text": "..."}], "recommendedLevel": N, "rewards": {"xp": N, "gold": N}, "status": "available|active (optional — use 'active' only if the player engaged this hook in the current action)", "failureConsequence": "one-sentence consequence if not completed (optional)", "deadline": {"day": N, "description": "..."} (optional), "followUpQuestIds": ["quest-id"] (optional)}] or omit,`);
	parts.push(`    "sceneFactsAdded": ["important fact to remember"] or omit,`);
	parts.push(`    "encounterStarted": {"creatures": [{"id": "npc-<unique>", "name": "...", "role": "hostile", "locationId": "exact-location-id-from-visible-[id:-field]-or-omit-for-party-location", "disposition": -100, "description": "...", "tier": "weak|normal|tough|elite|boss"}]} — REQUIRED when narrative describes combat starting; NEVER omit and NEVER submit an empty creatures array — list each enemy with id, name, role:'hostile', and tier,`);
	parts.push(`    "encounterEnded": {"outcome": "victory|defeat|flee|negotiated"} or omit,`);
	parts.push(`    "companionPromoted": [{"npcId": "exact-npc-id-from-visible-[id:-field]"}] or omit (array — one entry per NPC; statBlock optional),`);
	parts.push(`    "clockAdvance": {"from": {"day": N, "timeOfDay": "...", "weather": "..."}, "to": {"day": N, "timeOfDay": "...", "weather": "..."}} or omit`);
	parts.push(`  }`);
	parts.push(`}`);
	parts.push('');
	parts.push(`=== COMBAT EXTRACTION RULES ===`);
	parts.push(`During active combat the engine resolves all attacks, damage, and dice rolls authoritatively.`);
	parts.push(`- Do NOT invent hit/miss results, damage numbers, or specify attack targets in stateChanges.`);
	parts.push(`- You may still extract encounterStarted/encounterEnded, HP changes from non-engine sources, and condition changes.`);
	parts.push(`- IMPORTANT: Even during a combat turn, you MUST still extract ALL non-attack state changes: goldChange (gold paid/received), questUpdates (quest completed/objectives done), itemsGained/Lost (loot picked up, items consumed), conditionsApplied, npcChanges (NPC dying, fleeing, disposition change), locationsAdded, sceneFactsAdded, and companionPromoted. Combat does NOT exempt you from extracting these. Returning {} during combat is almost always wrong.`);
	parts.push(`- Treat locationChange.from, questUpdates.oldValue, and npcChanges.oldValue as concurrency guards. When included, they MUST match the current state shown below or the write may be rejected.`);

	// Current game state snapshot for ID reference
	parts.push(`=== CURRENT GAME STATE ===`);

	// Characters
	if (state.characters.length > 0) {
		parts.push(`CHARACTERS:`);
		for (const c of state.characters) {
			const items = c.inventory.map((i) => formatNameIdRef(i.name, i.id)).join(', ');
			const itemStr = items ? ` | Inventory: ${items}` : '';
			parts.push(`- ${formatNameIdRef(c.name, c.id)}: Lv${c.level} ${c.race}, HP ${c.hp}/${c.maxHp}, AC ${c.ac}, XP ${c.xp}, Gold ${c.gold}${itemStr}`);
		}
		parts.push('');
	}

	// NPCs
	if (state.npcs.length > 0) {
		parts.push(`NPCs:`);
		for (const n of state.npcs.filter((n) => n.alive && !n.archived)) {
			const hp = n.statBlock ? ` HP ${n.statBlock.hp}/${n.statBlock.maxHp}` : '';
			const loc = state.locations.find((l) => l.id === n.locationId);
			const locStr = loc ? formatNameIdRef(loc.name, loc.id) : `locationId: ${n.locationId}`;
			parts.push(`- ${formatNameIdRef(n.name, n.id)} (${n.role}, disposition ${n.disposition})${hp} at ${locStr}`);
		}
		parts.push('');
	}

	// Locations
	if (state.locations.length > 0) {
		parts.push(`LOCATIONS:`);
		for (const l of state.locations) {
			const conns = l.connections
				.map((cid) => state.locations.find((x) => x.id === cid))
				.filter(Boolean)
				.map((x) => formatNameIdRef(x!.name, x!.id))
				.join(', ');
			const connStr = conns ? ` → ${conns}` : '';
			const groundStr = l.groundItems && l.groundItems.length > 0
				? ` | On ground: ${l.groundItems.map((i) => formatNameIdRef(i.name, i.id)).join(', ')}`
				: '';
			parts.push(`- ${formatNameIdRef(l.name, l.id)} (${l.type})${connStr}${groundStr}`);
		}
		parts.push('');
	}

	// Quests
	if (state.quests.length > 0) {
		parts.push(`QUESTS:`);
		for (const q of state.quests) {
			const objs = q.objectives.map((o) => formatObjectiveRef(o.text, o.id, o.done)).join('; ');
			const consequence = q.failureConsequence && q.status === 'active'
				? ` | ⚠ Consequence if failed: ${q.failureConsequence}`
				: '';
			const deadlineStr = q.deadline && q.status === 'active'
				? ` | Deadline: Day ${q.deadline.day} — ${q.deadline.description}`
				: '';
			parts.push(`- ${formatNameIdRef(q.name, q.id)} (status: ${q.status}): ${objs}${consequence}${deadlineStr}`);
		}
		parts.push('');
	}

	// Active encounter
	if (state.activeEncounter && state.activeEncounter.status === 'active') {
		parts.push(`ACTIVE ENCOUNTER (Round ${state.activeEncounter.round}):`);
		for (const cmb of state.activeEncounter.combatants) {
			const tag = cmb.defeated ? ' (defeated: yes)' : '';
			parts.push(`- ${cmb.name} (${cmb.type}): ${cmb.currentHp}/${cmb.maxHp} HP, AC ${cmb.ac}${tag}`);
		}
		parts.push('');
	}

	// Current location
	const partyLoc = state.locations.find((l) => l.id === state.partyLocationId);
	parts.push(`PARTY LOCATION: ${partyLoc ? formatNameIdRef(partyLoc.name, partyLoc.id) : state.partyLocationId ?? 'unknown'}`);
	parts.push(`TIME: Day ${state.clock.day}, ${state.clock.timeOfDay}, Weather: ${state.clock.weather}`);
	parts.push('');

	// Established facts
	const facts = state.sceneFacts ?? [];
	if (facts.length > 0) {
		parts.push(`ESTABLISHED FACTS:`);
		for (const f of facts.slice(-20)) {
			parts.push(`- ${f}`);
		}
		parts.push('');
	}

	return parts.join('\n');
}

/**
 * Assemble the full message array for the state-extraction AI (Pass 2).
 *
 * @param state          Current GameState (before this turn's changes)
 * @param narrativeText  The narrative text produced by Pass 1
 * @param playerAction   The original player action text
 * @param combatVictory  When true, injects a COMBAT VICTORY quest-completion
 *                       check into the user message so the AI links defeated
 *                       enemies to quest objectives.
 */
export function assembleStateExtractionContext(
	state: GameState,
	narrativeText: string,
	playerAction: string,
	combatVictory = false
): ChatMessageInput[] {
	const combatVictoryPrefix = combatVictory
		? `COMBAT VICTORY — QUEST CHECK REQUIRED:\n` +
		  `Check every active/available quest objective against the enemies just defeated in combat. ` +
		  `If ANY objective's text describes defeating, eliminating, stopping, or dealing with those enemies, ` +
		  `mark it done with questUpdates (field: "objective", newValue: true). ` +
		  `If ALL objectives for a quest are now done, also emit a questUpdates entry setting status to "completed". ` +
		  `Do NOT skip this step even if the connection seems indirect.\n---\n`
		: '';
	return [
		{
			role: 'system',
			content: buildStateExtractionPrompt(state)
		},
		{
			role: 'user',
			content: `${combatVictoryPrefix}PLAYER ACTION: ${playerAction}\n\nNARRATIVE RESULT:\n${narrativeText}`
		}
	];
}

// ---------------------------------------------------------------------------
// Character brief
// ---------------------------------------------------------------------------

function formatCharacterBrief(c: PlayerCharacter): string {
	const hpStr = `${c.hp}/${c.maxHp} HP`;
	const conditions = c.conditions.length > 0 ? ` | Conditions: ${c.conditions.join(', ')}` : '';
	const notableItems = c.inventory
		.filter((i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'quest' || i.category === 'consumable')
		.slice(0, 8)
		.map((i) => formatNameIdRef(i.name, i.id));
	const itemStr = notableItems.length > 0 ? ` | Gear: ${notableItems.join(', ')}` : '';

	const classDesc = c.classes.length === 0
		? '(classless — no class selected)'
		: c.classes.length > 1
			? c.classes.map((cl) => `${cl.name} ${cl.level}`).join('/')
			: getPrimaryClass(c);

	// Per-class spellcasting summary
	const spellParts: string[] = [];
	for (const cs of c.classSpells) {
		const dc = getSpellSaveDCForClass(c, cs.className);
		const atk = getSpellAttackBonusForClass(c, cs.className);
		const cantrips = cs.cantrips.length;
		const prepared = cs.preparedSpells.length;
		spellParts.push(`${cs.className}(DC${dc} +${atk} ${cantrips}C/${prepared}P)`);
	}
	const spellStr = spellParts.length > 0 ? ` | Spells: ${spellParts.join(', ')}` : '';

	// Slot summary
	const slotStr = c.spellSlots.length > 0
		? ` | Slots: ${c.spellSlots.map((s) => `L${s.level}:${s.current}/${s.max}`).join(' ')}`
		: '';
	const pactStr = c.pactSlots.length > 0
		? ` | Pact: ${c.pactSlots.map((s) => `L${s.level}:${s.current}/${s.max}`).join(' ')}`
		: '';

	return `- ${formatNameIdRef(c.name, c.id)} (Lv${c.level} ${c.race} ${classDesc}) — ${hpStr}${conditions} | AC ${c.ac}${itemStr}${spellStr}${slotStr}${pactStr}`;
}

// ---------------------------------------------------------------------------
// World brief builder
// ---------------------------------------------------------------------------

/**
 * Condense a PrototypeWorld into a short paragraph the GM can reference.
 * Focuses on the party's current region / settlement context.
 */
export function buildWorldBrief(
	world: PrototypeWorld,
	state: GameState
): string {
	const parts: string[] = [];

	// General setting
	parts.push(`The world is called ${world.metadata.info.mapName}. It is the year ${world.metadata.chronology.year} of the ${world.metadata.chronology.era}.`);

	// Political powers
	const topStates = world.politics.states.slice(0, 5);
	if (topStates.length > 0) {
		const stateNames = topStates.map((s) => s.fullName).join(', ');
		parts.push(`Major powers: ${stateNames}.`);
	}

	// Relations summary
	const tensions = world.politics.relations.filter((r) => r.type === 'enemy' || r.type === 'rival');
	if (tensions.length > 0) {
		const tensionNames = tensions
			.slice(0, 3)
			.map((r) => {
				const from = world.politics.states.find((s) => s.i === r.from);
				const to = world.politics.states.find((s) => s.i === r.to);
				return `${from?.name ?? '?'} and ${to?.name ?? '?'} (${r.type})`;
			});
		parts.push(`Tensions: ${tensionNames.join('; ')}.`);
	}

	// Current location context
	const loc = state.locations.find((l) => l.id === state.partyLocationId);
	if (loc && loc.regionRef !== null) {
		const settlement = world.politics.settlements.find((s) => s.i === loc.regionRef);
		if (settlement) {
			const ownerState = world.politics.states.find((s) => s.i === settlement.state);
			const culture = world.societies.cultures.find((c) => c.i === settlement.culture);
			const sizeLabel =
				settlement.group === 'city'   ? 'a walled city'   :
				settlement.group === 'town'   ? 'a fortified town' :
				settlement.group === 'village' ? 'a village'        : 'a small hamlet';
			parts.push(
				`The party is currently in ${settlement.name}, ${sizeLabel}` +
					(ownerState ? ` in the territory of ${ownerState.fullName}` : '') +
					(culture ? `; local customs follow ${culture.name} tradition` : '') +
					`.`
			);
		}
	}

	// Lore hooks relevant to context
	const loreHooks = world.lore.notes.slice(0, 3).map((n) => n.legend);
	if (loreHooks.length > 0) {
		parts.push(`Rumors and legends: ${loreHooks.join(' ')}`);
	}

	// Truncate if too long
	let brief = parts.join(' ');
	if (brief.length > MAX_WORLD_BRIEF_CHARS) {
		brief = brief.slice(0, MAX_WORLD_BRIEF_CHARS - 3) + '...';
	}

	return brief;
}

// ---------------------------------------------------------------------------
// Conversation history
// ---------------------------------------------------------------------------

/**
 * Convert recent TurnRecords into the alternating user/assistant messages
 * that the LLM expects for conversation context.
 */
function turnsToMessages(turns: TurnRecord[], useJsonFormat = false): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	for (const turn of turns) {
		// Player action → user message
		if (turn.action) {
			let userContent = turn.action;

			// If there were mechanic results, append a summary so the AI knows
			// what happened mechanically.
			if (turn.mechanicResults.length > 0) {
				const mechSummary = turn.mechanicResults.map(formatMechanicResult).join(' | ');
				userContent += `\n[Mechanics: ${mechSummary}]`;
			}

			messages.push({ role: 'user', content: userContent });
		}

		// GM narrative → assistant message
		if (turn.narrativeText) {
			if (useJsonFormat) {
				// Reconstruct the JSON envelope so the model sees the format it is
				// expected to produce (used by legacy single-pass GM context).
				const sc = turn.stateChanges ?? {};
				const compactSc: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(sc)) {
					if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null) {
						compactSc[k] = v;
					}
				}
				const assistantJson = JSON.stringify({
					narrativeText: turn.narrativeText,
					stateChanges: compactSc
				});
				messages.push({ role: 'assistant', content: assistantJson });
			} else {
				// Plain prose — trains the model to reply with narrative only
				// (used by narrator context and two-pass narrative context).
				messages.push({ role: 'assistant', content: turn.narrativeText });
			}
		}
	}

	return messages;
}

function formatMechanicResult(m: MechanicResult): string {
	const diceStr = m.dice ? `${m.dice.notation} → ${m.dice.total}` : '';
	const dcStr = m.dc !== undefined ? ` vs DC ${m.dc}` : '';
	const successStr = m.success !== undefined ? (m.success ? ' ✓' : ' ✗') : '';
	return `${m.label}${diceStr ? ': ' + diceStr : ''}${dcStr}${successStr}`;
}

// ---------------------------------------------------------------------------
// Party chat injection
// ---------------------------------------------------------------------------

/**
 * Build a single user-role message summarising unconsumed party chat.
 * Returns null if there are no chat records to inject.
 */
function chatToPartyBlock(recentChat: ChatRecord[]): ChatMessageInput | null {
	if (recentChat.length === 0) return null;

	// Categorize chat for clearer GM context
	const lines = recentChat.map((c) => {
		const isGmInvoke = /@gm\b/i.test(c.text);
		const isOoc = /^\s*(ooc|\/\/|\(ooc\))/i.test(c.text);

		if (isOoc) return `[OOC — ${c.username}]: ${c.text}`;
		if (isGmInvoke) return `[${c.username} → GM]: ${c.text.replace(/@gm\b/gi, '').trim()}`;
		return `[${c.username}]: ${c.text}`;
	});

	return {
		role: 'user',
		content: `[Party chat since last GM response]\n${lines.join('\n')}`
	};
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

/**
 * Build the complete messages array for the narrative-only AI (Pass 1 of two-pass).
 *
 * The narrative AI knows about the full game state (world, party, NPCs, quests,
 * etc.) so it can write informed prose, but it is NOT asked to produce JSON or
 * track state changes. History is shown as plain prose (not JSON objects).
 *
 * @param state        Current GameState
 * @param world        The PrototypeWorld
 * @param recentTurns  Last N turns from the durable store
 * @param playerAction The raw text the player just typed
 * @param mechanicResults Any dice rolls already resolved for this action
 * @param recentChat   Unconsumed party chat messages to inject into context
 */
export function assembleNarrativeGMContext(
	state: GameState,
	world: PrototypeWorld | null,
	recentTurns: TurnRecord[],
	playerAction: string,
	mechanicResults: MechanicResult[] = [],
	recentChat: ChatRecord[] = []
): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	// 1. Narrative-only system prompt (no JSON format instructions)
	const worldBrief = world ? buildWorldBrief(world, state) : '';
	messages.push({
		role: 'system',
		content: buildNarrativeSystemPrompt(state, worldBrief)
	});

	// 2. Conversation history as plain prose (no JSON wrapping)
	const historyTurns = recentTurns.slice(-MAX_HISTORY_TURNS);
	messages.push(...turnsToMessages(historyTurns, false));

	// 3. Party chat since last GM response (if any)
	const chatBlock = chatToPartyBlock(recentChat);
	if (chatBlock) messages.push(chatBlock);

	// 4. Current player action
	let currentAction = playerAction;
	if (mechanicResults.length > 0) {
		const mechSummary = mechanicResults.map(formatMechanicResult).join(' | ');
		currentAction += `\n[Mechanics: ${mechSummary}]`;
	}
	messages.push({ role: 'user', content: currentAction });

	return messages;
}

/**
 * Build the complete messages array for an AI turn (legacy single-pass).
 *
 * @param state       Current GameState
 * @param world       The PrototypeWorld (loaded from state or separately)
 * @param recentTurns Last N turns from the durable store
 * @param playerAction The raw text the player just typed
 * @param mechanicResults Any dice rolls already resolved for this action
 * @param recentChat  Unconsumed party chat messages to inject into context
 */
export function assembleGMContext(
	state: GameState,
	world: PrototypeWorld | null,
	recentTurns: TurnRecord[],
	playerAction: string,
	mechanicResults: MechanicResult[] = [],
	recentChat: ChatRecord[] = []
): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	// 1. System prompt with all structured context
	const worldBrief = world ? buildWorldBrief(world, state) : '';
	messages.push({
		role: 'system',
		content: buildSystemPrompt(state, worldBrief)
	});

	// 2. Conversation history (capped) — use JSON format so model stays consistent
	const historyTurns = recentTurns.slice(-MAX_HISTORY_TURNS);
	messages.push(...turnsToMessages(historyTurns, true));

	// 3. Party chat since last GM response (if any)
	const chatBlock = chatToPartyBlock(recentChat);
	if (chatBlock) messages.push(chatBlock);

	// 4. Current player action
	let currentAction = playerAction;
	if (mechanicResults.length > 0) {
		const mechSummary = mechanicResults.map(formatMechanicResult).join(' | ');
		currentAction += `\n[Mechanics: ${mechSummary}]`;
	}
	messages.push({ role: 'user', content: currentAction });

	return messages;
}

// ---------------------------------------------------------------------------
// Narrator-only context (Step 3 / Step 9)
// ---------------------------------------------------------------------------

/**
 * Build a narrator-only system prompt.
 *
 * Unlike the full GM prompt, the narrator receives **already-resolved**
 * mechanic results as facts. It may NOT re-interpret the mechanics, alter
 * HP values, or change game state. Its only job is vivid prose narration
 * of what has already happened.
 */
function buildNarratorSystemPrompt(state: GameState, worldBrief: string): string {
	const parts: string[] = [];

	parts.push(`You are the Narrator of a text-based fantasy RPG adventure.`);
	parts.push(`The game engine has ALREADY resolved the player's action mechanically.`);
	parts.push(`Your job is to narrate what happened in vivid second-person prose.`);
	parts.push('');
	parts.push(`RULES:`);
	parts.push(`- The mechanic results provided to you are FACTS. Do not contradict them.`);
	parts.push(`- If the player healed 7 HP, narrate them healing 7 HP. If a spell slot was used, mention the magical exertion.`);
	parts.push(`- If a healing potion was consumed, describe drinking it. If travel occurred, describe the journey.`);
	parts.push(`- Do NOT invent additional mechanical effects (no extra damage, no bonus healing, no status changes beyond what's given).`);
	parts.push(`- You MAY add sensory detail, NPC reactions, environmental flavor, and dramatic tension.`);
	parts.push(`- Keep responses vivid and concise (2–5 sentences for normal actions, more for important moments).`);
	parts.push(`- NON-LETHAL KO: If a mechanic result says "Non-lethal KO \u2014 [target]", narrate them being knocked unconscious, NOT killed. They are alive on the ground. Do NOT describe their death.`);
	parts.push(`- BREATH WEAPONS: Never narrate a breath weapon applying the Poisoned condition or causing unconsciousness \u2014 a breath weapon deals damage only. Describe the target singed, scorched, poisoned by the gas (sickened description), etc., but NOT dropping unconscious or falling asleep from the breath itself.`);
	parts.push(`- Return ONLY narrative prose. Do NOT return JSON.`);
	parts.push('');

	// ── Narrative style (universal) ──
	parts.push(`=== NARRATIVE STYLE ===`);
	parts.push(`- Write immersive second-person prose. Show the world; do not summarise it.`);
	parts.push(`- Do NOT end responses with questions or prompts that invite the player to act ("What do you do?", "Where do you go?", "How do you respond?" etc.). The player decides their own next move.`);
	parts.push(`- Do NOT list every NPC present in a location unprompted. Introduce names only when earned — when a character speaks up, steps forward, or is directly addressed.`);
	parts.push(`- Do NOT reveal quest names, objectives, or active leads in narration. Quests are discovered through play. Use ambient hooks only: a posted notice, an overheard fragment, a weeping figure in an alley. Never announce a quest directly.`);
	parts.push(`- Do NOT state day numbers in narrative text. Time of day and weather provide sufficient atmospheric context. Day numbers exist for mechanical deadline tracking only.`);
	parts.push(`- Escalation rule: if a player actively investigates an ambient hint (asks about the crier, picks up the flyer, approaches the crying figure), you MAY sharpen the detail. If they pursue it further, give them the full information plainly.`);
	parts.push('');

	// World knowledge
	if (worldBrief) {
		parts.push(`=== WORLD ===`);
		parts.push(worldBrief);
		parts.push('');
	}

	// Current location
	const loc = state.locations.find((l) => l.id === state.partyLocationId);
	if (loc) {
		parts.push(`=== CURRENT LOCATION ===`);
		parts.push(`Name: ${loc.name}`);
		parts.push(`Type: ${loc.type}`);
		parts.push(`Description: ${loc.description}`);
		const localNpcs = state.npcs.filter((n) => n.locationId === loc.id && n.alive);
		if (localNpcs.length > 0) {
			parts.push(`NPCs present: ${localNpcs.map((n) => {
				const condStr = (n.conditions && n.conditions.length > 0) ? ` [${n.conditions.join(', ')}]` : '';
				return `${n.name} (${n.role}${condStr})`;
			}).join(', ')}`);
		}
		parts.push('');
	}

	// Party summary (brief)
	if (state.characters.length > 0) {
		parts.push(`=== PARTY ===`);
		for (const c of state.characters) {
			parts.push(formatCharacterBrief(c));
		}
		parts.push('');
	}

	// Time
	parts.push(`=== TIME ===`);
	parts.push(`Day ${state.clock.day}, ${state.clock.timeOfDay}. Weather: ${state.clock.weather}.`);
	parts.push(`(Day count is for deadline tracking only. Do not reference day numbers in narrative output.)`);
	parts.push('');

	parts.push(`=== TIME-OF-DAY RULES ===`);
	parts.push(`- dawn: Most residents sleeping or just waking. Shops closed. Town gates closed.`);
	parts.push(`- morning / afternoon: Full commerce. Gates open. Normal social interactions.`);
	parts.push(`- dusk: Merchants closing. Town gate guards alert. Taverns filling.`);
	parts.push(`- night: Town gates SEALED (daytime-only policy = hard block). City gates: guards challenge travellers (guarded-at-night). Shops closed. Inns and taverns open. Entering homes at night is an intrusion. Guards patrolling.`);
	parts.push('');

	return parts.join('\n');
}

/**
 * Format a resolved turn's mechanic results into a clear summary for the narrator.
 */
export function formatMechanicSummaryForNarrator(resolvedTurn: ResolvedTurn): string {
	const parts: string[] = [];

	parts.push(`RESOLVED ACTION: "${resolvedTurn.intent.rawAction}"`);
	parts.push(`INTENT: ${resolvedTurn.intent.primaryIntent}`);

	if (resolvedTurn.mechanicResults.length > 0) {
		parts.push('');
		parts.push(`MECHANIC RESULTS (these are FACTS — narrate around them):`);
		for (const result of resolvedTurn.mechanicResults) {
			const diceStr = result.dice && result.dice.notation !== '' ? ` [${result.dice.notation} → ${result.dice.total}]` : '';
			const dcStr = result.dc !== undefined ? ` (DC ${result.dc})` : '';
			const successStr = result.success !== undefined ? ` ${result.success ? '(succeeded)' : '(failed)'}` : '';
			parts.push(`- ${result.type.toUpperCase()}: ${result.label}${diceStr}${dcStr}${successStr}`);
		}
	}

	if (resolvedTurn.stateChanges.hpChanges && resolvedTurn.stateChanges.hpChanges.length > 0) {
		parts.push('');
		parts.push('HP CHANGES:');
		for (const hc of resolvedTurn.stateChanges.hpChanges) {
			parts.push(`- ${hc.reason}: ${hc.oldHp} → ${hc.newHp} HP`);
		}
	}

	if (resolvedTurn.stateChanges.locationChange) {
		parts.push('');
		parts.push(`LOCATION: Party moved to a new location.`);
	}

	if (resolvedTurn.stateChanges.clockAdvance) {
		const from = resolvedTurn.stateChanges.clockAdvance.from;
		const to = resolvedTurn.stateChanges.clockAdvance.to;
		parts.push(`TIME: ${from.timeOfDay} day ${from.day} → ${to.timeOfDay} day ${to.day}`);
	}

	if (resolvedTurn.stateChanges.spellSlotUsed) {
		const ssu = resolvedTurn.stateChanges.spellSlotUsed;
		parts.push(`SPELL SLOT: Used a level ${ssu.level} slot for ${ssu.spellName}`);
	}

	if (resolvedTurn.stateChanges.itemsLost && resolvedTurn.stateChanges.itemsLost.length > 0) {
		parts.push(`ITEMS CONSUMED: ${resolvedTurn.stateChanges.itemsLost.length} item(s) used up`);
	}

	return parts.join('\n');
}

/**
 * Assemble the narrator context: a targeted prompt for AI to narrate
 * around already-resolved mechanic outcomes.
 *
 * Used when `resolveTurn()` produced engine-authoritative results.
 * The AI receives the facts and produces only prose — no JSON, no
 * re-interpretation of mechanics.
 *
 * @param state         Current GameState (after engine mutations)
 * @param world         The PrototypeWorld
 * @param recentTurns   Recent turn history
 * @param resolvedTurn  The engine-resolved turn with mechanic results
 */
export function assembleNarratorContext(
	state: GameState,
	world: PrototypeWorld | null,
	recentTurns: TurnRecord[],
	resolvedTurn: ResolvedTurn,
	recentChat: ChatRecord[] = []
): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	// 1. Narrator system prompt (no JSON format instructions)
	const worldBrief = world ? buildWorldBrief(world, state) : '';
	messages.push({
		role: 'system',
		content: buildNarratorSystemPrompt(state, worldBrief)
	});

	// 2. Conversation history (capped — narrator gets a slightly longer window)
	const historyTurns = recentTurns.slice(-MAX_NARRATOR_HISTORY_TURNS);
	messages.push(...turnsToMessages(historyTurns));

	// 3. Party chat since last GM response (if any)
	const chatBlock = chatToPartyBlock(recentChat);
	if (chatBlock) messages.push(chatBlock);

	// 4. The resolved action + mechanic facts as the user message
	const mechanicSummary = formatMechanicSummaryForNarrator(resolvedTurn);
	messages.push({
		role: 'user',
		content: `The player said: "${resolvedTurn.intent.rawAction}"\n\n${mechanicSummary}\n\nNarrate what happens.`
	});

	return messages;
}

// ---------------------------------------------------------------------------
// Round Narrator Context (Phase 8e — sequential turns)
// ---------------------------------------------------------------------------

/**
 * Format all actions from a combat round into a factual summary for the narrator.
 *
 * Each entry describes what a combatant did and what the engine resolved.
 */
function formatRoundActionsSummary(
	state: GameState,
	roundActions: PendingCombatAction[]
): string {
	if (roundActions.length === 0) return 'No actions were taken this round.';

	const lines: string[] = ['ROUND ACTIONS (in initiative order, these are FACTS):'];

	for (const action of roundActions) {
		// Resolve combatant name
		const combatant = state.activeEncounter?.combatants.find(c => c.id === action.combatantId);
		const actorName = combatant?.name ?? action.combatantId;

		lines.push(`\n${actorName}: "${action.rawAction}"`);

		for (const result of action.mechanicResults) {
			const diceStr = result.dice?.notation
				? ` [${result.dice.notation} → ${result.dice.total}]`
				: '';
			const successStr =
				result.success !== undefined ? ` (${result.success ? 'success' : 'failure'})` : '';
			lines.push(`  - ${result.type.toUpperCase()}: ${result.label}${diceStr}${successStr}`);
		}

		if (action.stateChanges.hpChanges) {
			for (const hc of action.stateChanges.hpChanges) {
				// Resolve name from state
				const char = state.characters.find(c => c.id === hc.characterId);
				const npc = state.npcs.find(n => n.id === hc.characterId);
				const targetName = char?.name ?? npc?.name ?? hc.characterId;
				const delta = hc.newHp - hc.oldHp;
				const sign = delta >= 0 ? '+' : '';
				lines.push(
					`  - HP: ${targetName} ${hc.oldHp} → ${hc.newHp} HP (${sign}${delta})`
				);
			}
		}

		if (action.stateChanges.deathSaveResult) {
			const ds = action.stateChanges.deathSaveResult;
			lines.push(`  - DEATH SAVE: ${ds.result}`);
		}
		if (action.stateChanges.deathSaveOutcome) {
			const dso = action.stateChanges.deathSaveOutcome;
			lines.push(`  - OUTCOME: ${dso.outcome.toUpperCase()}`);
		}
	}

	return lines.join('\n');
}

/**
 * Build the narrator context for a completed combat round.
 *
 * Called from adventure-turn.ts when `resolvedTurn.roundComplete === true`.
 * Presents the entire round's actions as a factual block and asks the AI
 * to narrate it as a cohesive combat scene.
 *
 * @param state        Current game state (after all mutations applied)
 * @param world        The PrototypeWorld
 * @param roundActions All actions resolved this round, in initiative order
 * @param recentTurns  Recent turn history for context
 * @param recentChat   Recent party chat for context
 */
export function assembleRoundNarratorContext(
	state: GameState,
	world: PrototypeWorld | null,
	roundActions: PendingCombatAction[],
	recentTurns: TurnRecord[],
	recentChat: ChatRecord[] = [],
	encounterOutcome?: { outcome: string; reason?: string }
): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	// 1. Narrator system prompt (same as single-turn narrator)
	const worldBrief = world ? buildWorldBrief(world, state) : '';
	messages.push({
		role: 'system',
		content: buildNarratorSystemPrompt(state, worldBrief)
	});

	// 2. Recent conversation history (capped — narrator gets a slightly longer window)
	const historyTurns = recentTurns.slice(-MAX_NARRATOR_HISTORY_TURNS);
	messages.push(...turnsToMessages(historyTurns));

	// 3. Party chat since last GM response (if any)
	const chatBlock = chatToPartyBlock(recentChat);
	if (chatBlock) messages.push(chatBlock);

	// 4. The full round as facts → narrate as a cohesive scene
	const roundSummary = formatRoundActionsSummary(state, roundActions);
	// encounter.round has already been incremented to the NEXT round by
	// advanceTurn, so subtract 1 to label the round that just completed.
	const round = Math.max(1, (state.activeEncounter?.round ?? 2) - 1);

	// Build the outcome instruction block
	let outcomeBlock = '';
	if (encounterOutcome) {
		if (encounterOutcome.outcome === 'victory') {
			outcomeBlock = '\n\n⚔️ ENCOUNTER OUTCOME: VICTORY — The heroes have won! Narrate their triumph, describe fallen enemies, and transition out of combat.';
		} else if (encounterOutcome.outcome === 'defeat') {
			outcomeBlock = '\n\n💀 ENCOUNTER OUTCOME: DEFEAT — The heroes have fallen. Narrate their defeat dramatically. They may be captured, left for dead, or rescued — but the fight is over.';
		}
	}

	// Build low-HP warning block for PCs in danger
	let lowHpBlock = '';
	if (!encounterOutcome) {
		const warnings: string[] = [];
		for (const pc of state.characters) {
			if (pc.hp <= 0) continue; // already down, different handling
			const ratio = pc.hp / pc.maxHp;
			if (ratio <= 0.3) {
				const resources: string[] = [];
				// Check healing features
				const secondWind = pc.featureUses?.['Second Wind'];
				if (secondWind && secondWind.current > 0) resources.push('Second Wind');
				const layOnHands = pc.featureUses?.['Lay on Hands'];
				if (layOnHands && layOnHands.current > 0) resources.push('Lay on Hands');
				// Check healing potions
				const potions = pc.inventory?.filter(i => i.category === 'consumable' && /heal/i.test(i.name));
				if (potions && potions.length > 0) resources.push(`${potions.length} healing potion(s)`);
				const hint = resources.length > 0
					? ` (available: ${resources.join(', ')})`
					: '';
				warnings.push(`⚠️ ${pc.name} is at ${pc.hp}/${pc.maxHp} HP${hint}`);
			}
		}
		if (warnings.length > 0) {
			lowHpBlock = '\n\n' + warnings.join('\n') + '\nThe narrator should subtly remind the player about their perilous state through vivid description (bloodied, staggering, etc.) without breaking character.';
		}
	}

	messages.push({
		role: 'user',
		content: [
			`Combat round ${round} just completed.`,
			'',
			roundSummary,
			outcomeBlock,
			lowHpBlock,
			'',
			'Narrate this round as a cohesive, vivid combat scene. Weave all the actions together — do not just list them. End with a beat that invites the next round of actions.'
		].join('\n')
	});

	return messages;
}
