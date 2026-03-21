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
	parts.push(`End each response with a beat that invites the next player action.`);
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
	parts.push(`- When combat truly begins, announce it clearly with a phrase like "Roll for initiative!" or "Combat begins!" so the boundary is unmistakable.`);
	parts.push(`- Scouting, observing, reconnaissance, hearing rumors about enemies, and cautious dialogue NEVER start combat on their own.`);
	parts.push(`- A player saying "I look for enemies" or "I scout ahead" is gathering information, not starting a fight.`);
	parts.push('');
	parts.push(`DURING COMBAT:`);
	parts.push(`- Think in terms of turns, actions, bonus actions, reactions, movement, and positioning.`);
	parts.push(`- Narrate each combatant's actions with tactical clarity: who attacks whom, what weapon or ability is used, and what happens.`);
	parts.push(`- Reference engine-provided dice results faithfully. Do NOT invent hit/miss/damage beyond what the engine resolved.`);
	parts.push('');
	parts.push(`DIALOGUE & SOCIAL ENCOUNTERS:`);
	parts.push(`- When a player speaks to an NPC, roleplay the NPC's response in character.`);
	parts.push(`- If the player is trying to persuade, deceive, or intimidate and the NPC would resist, call for the appropriate check.`);
	parts.push(`- Low-stakes conversation (asking for directions, buying supplies, friendly banter) does not require a roll.`);
	parts.push(`- When stakes are high (convincing a guard to let you pass, lying to a noble, negotiating a hostage release), call for a check before resolving the outcome.`);
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
	parts.push('');
	parts.push(`WHEN AMBIGUOUS:`);
	parts.push(`- If the player's intent is unclear but harmless, make a reasonable assumption and narrate`);
	parts.push(`- If the ambiguity could cost significant resources, ask a brief in-world clarifying question instead of acting`);
	parts.push('');

	// World knowledge + state sections (shared between narrative and legacy prompts)
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
			parts.push(`NPCs present: ${localNpcs.map((n) => `${formatNameIdRef(n.name, n.id)} (${n.role}, ${dispositionLabel(n.disposition)})`).join(', ')}`);
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
				parts.push(`  - ${formatNameIdRef(n.name, n.id)} (${n.role}, ${dispositionLabel(n.disposition)})${summaryStr}`);
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
		parts.push(`These NPCs are traveling with the party and participate in combat.`);
		for (const c of companions) {
			const interactionSummary = buildNpcInteractionSummary(c, state.sceneFacts ?? []);
			const summaryStr = interactionSummary ? ` — ${interactionSummary}` : '';
			if (c.statBlock) {
				const attacks = c.statBlock.attacks.map((a) => `${a.name} +${a.toHit} (${a.damage} ${a.damageType})`).join(', ');
				const attackStr = attacks ? ` | Attacks: ${attacks}` : '';
				parts.push(`- ${formatNameIdRef(c.name, c.id)} (${c.role}, ${dispositionLabel(c.disposition)}) — ${c.statBlock.hp}/${c.statBlock.maxHp} HP, AC ${c.statBlock.ac}${attackStr}${summaryStr}`);
			} else {
				parts.push(`- ${formatNameIdRef(c.name, c.id)} (${c.role}, ${dispositionLabel(c.disposition)})${summaryStr}`);
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
			parts.push(`- ${cmb.name} (${cmb.type}): ${cmb.currentHp}/${cmb.maxHp} HP, AC ${cmb.ac}${tag}`);
		}
		parts.push(`Use encounterEnded in stateChanges when the encounter resolves.`);
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
			parts.push(`- ${formatNameIdRef(q.name, q.id)} ${statusTag}: ${q.description} | Objectives: ${objectives}`);
		}
		parts.push('');
	}

	// Game clock
	parts.push(`=== TIME ===`);
	parts.push(`Day ${state.clock.day}, ${state.clock.timeOfDay}. Weather: ${state.clock.weather}.`);
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
	parts.push(`End each response with a beat that invites the next player action.`);
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
	parts.push(`- Create encounters or combat without using encounterStarted in stateChanges`);
	parts.push(`- Override or contradict engine-provided mechanic results (if [Mechanics: ...] is present, those are FACTS)`);
	parts.push(`- Kill or permanently incapacitate a player character without mechanical justification`);
	parts.push(`- Move the party to a new location without a locationChange in stateChanges`);
	parts.push(`- Grant magical items above the party's level range without quest justification`);
	parts.push('');
	parts.push(`WHEN AMBIGUOUS:`);
	parts.push(`- If the player's intent is unclear but harmless, make a reasonable assumption and narrate`);
	parts.push(`- If the ambiguity could cost significant resources, ask a brief in-world clarifying question instead of acting`);
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
	parts.push(`    "locationChange": {"from": "exact-location-id-from-visible-[id:-field]-or-null", "to": "exact-location-id-from-visible-[id:-field]"} or omit,`);
	parts.push(`    "npcChanges": [{"npcId": "exact-id-from-visible-[id:-field]", "field": "disposition|alive|hp|notes", "oldValue": X, "newValue": Y}] or omit,`);
	parts.push(`    "questUpdates": [{"questId": "exact-id-from-visible-[id:-field]", "field": "status", "oldValue": "active", "newValue": "available|active|completed|failed"} or {"questId": "exact-id-from-visible-[id:-field]", "field": "objective", "objectiveId": "exact-objective-id-from-objective(..., id: ...)", "oldValue": false, "newValue": true}] or omit,`);
	parts.push(`    "conditionsApplied": [{"characterId": "exact-id-from-PARTY-id-field", "condition": "...", "applied": true|false}] or omit,`);
	parts.push(`    "xpAwarded": [{"characterId": "exact-id-from-PARTY-id-field", "amount": N}] or omit,`);
	parts.push(`    "npcsAdded": [{"id": "npc-<unique>", "name": "...", "role": "merchant|quest-giver|hostile|neutral|ally|companion|boss", "locationId": "exact-location-id-from-visible-[id:-field]", "disposition": 0, "description": "..."}] or omit,`);
	parts.push(`    "locationsAdded": [{"id": "loc-<unique>", "name": "...", "type": "settlement|wilderness|dungeon|interior|road", "description": "...", "connections": ["exact-location-id-from-visible-[id:-field]"], "features": ["..."], "groundItems": [{"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}]}] or omit,`);
	parts.push(`    "questsAdded": [{"id": "quest-<unique>", "name": "...", "description": "...", "giverNpcId": "exact-npc-id-from-visible-[id:-field]-or-null", "objectives": [{"id": "obj-<unique>", "text": "..."}], "recommendedLevel": N}] or omit,`);
	parts.push(`    "sceneFactsAdded": ["fact about the scene or world"] or omit,`);
	parts.push(`    "encounterStarted": {"creatures": [{"id": "npc-<unique>", "name": "...", "role": "hostile", "locationId": "exact-location-id-from-visible-[id:-field]-or-omit-for-party-location", "disposition": -100, "description": "...", "tier": "weak|normal|tough|elite|boss"}]} or omit,`);
	parts.push(`    "encounterEnded": {"outcome": "victory|defeat|flee|negotiated"} or omit,`);
	parts.push(`    "companionPromoted": {"npcId": "exact-npc-id-from-visible-[id:-field]", "statBlock": {"hp": N, "maxHp": N, "ac": N, "speed": N, "cr": N, "abilities": {"str": N, ...}, "attacks": [{"name": "...", "toHit": N, "damage": "...", "damageType": "..."}], "savingThrows": [], "skills": [], "resistances": [], "immunities": [], "vulnerabilities": [], "traits": [], "actions": [], "legendaryActions": []}} or omit,`);
	parts.push(`    "clockAdvance": {"from": {"day": N, "timeOfDay": "...", "weather": "..."}, "to": {"day": N, "timeOfDay": "...", "weather": "..."}} or omit`);
	parts.push(`  },`);
	parts.push(`  "gmNotes": "optional private reasoning"`);
	parts.push(`}`);
	parts.push('');
	parts.push(`=== CRITICAL RULES ===`);
	parts.push(`IMPORTANT: For every "characterId" field, output ONLY the bare ID string from the [id: ...] field in the PARTY section — e.g. if the party entry reads "[name: Alice][id: 01ABC123]" then characterId must be "01ABC123", NOT "Alice" and NOT the full token string. Never use a character's name or any invented string as a characterId.`);
	parts.push(`- Every NPC you mention by name for the FIRST TIME must be tracked via npcsAdded. Do not introduce named NPCs only in narrative.`);
	parts.push(`- Every item gained or lost MUST appear in the correct stateChanges field(s). Do not mention acquiring or losing items only in narrative.`);
	parts.push(`- ITEM DROP/PICKUP RULES: Use itemsDropped (with itemId from inventory) when a character sets an item down — it lands at the current location shown as "On the ground" next turn. Use itemsPickedUp (with the exact itemId shown in "On the ground") when recovering a dropped item — this restores the ORIGINAL item id intact. Use itemsLost only for consumed/sold/stolen/destroyed items. Use itemsGained only for truly new items (purchases, loot, rewards). Use locationItemsAdded to place new items at any location (chest unlocked, enemy killed, GM loot).`);
	parts.push(`- When a companion NPC (shown in COMPANIONS) is in combat, include their combat actions in narrativeText and any HP/alive changes via npcChanges (use field: "hp" for companion HP changes).`);
	parts.push(`- Use npcChanges with field: "notes" to record important NPC interaction details (e.g. deals struck, secrets revealed, favors owed). The note text goes in newValue as a string.`);
	parts.push(`- To formally recruit an NPC as a companion, use companionPromoted with the NPC's exact visible [id: ...] and a stat block. This changes their role to "companion" and they will auto-travel with the party.`);
	parts.push(`- When an encounter has multiple enemies, create separate creatures entries for EACH enemy, not just a representative sample.`);
	parts.push(`- Do NOT start and end an encounter in the same response. Combat should span multiple turns.`);
	parts.push(`- During active combat the engine resolves all attacks, damage, and dice rolls mechanically. Do NOT specify attack targets or actions in stateChanges — the engine handles this authoritatively.`);
	parts.push(`- Only reference NPC IDs, quest IDs, location IDs, and item IDs that exist in the state shown above. Do not invent references to entities you haven't created via *Added fields.`);
	parts.push(`- If the action has no mechanical effect, return an empty stateChanges object {}.`);
	parts.push(`- When creating new NPCs/locations/quests, generate unique IDs prefixed with "npc-", "loc-", or "quest-".`);
	parts.push(`- Connect new locations to existing ones via the connections array.`);
	parts.push(`- IMPORTANT: Always return valid JSON. The narrativeText field is required.`);
	parts.push(`- Record important world details (NPC agreements, prices, promises, discoveries) as sceneFactsAdded so they persist across turns.`);

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
	parts.push(`- If the narrative mentions a new NPC by name, you MUST emit npcsAdded.`);
	parts.push(`- If the narrative describes gaining or losing an item, emit the correct field: itemsDropped (placed on ground), itemsPickedUp (recovered from ground using exact id), itemsLost (consumed/sold/destroyed), itemsGained (brand new item), or locationItemsAdded (new item at a location).`);
	parts.push(`- ITEM DROP/PICKUP: itemsDropped moves an item from inventory to the location's ground (preserving its original id). itemsPickedUp moves it back — use the EXACT item id from "On the ground" in the location state. Never use itemsGained to recover a ground item; that creates a hallucinated duplicate.`);
	parts.push(`- If an NPC is killed in the narrative, emit npcChanges with field "alive", newValue false, AND field "hp", newValue 0.`);
	parts.push(`- Use EXACT character/NPC/location/quest IDs from the state below. Do not invent references to entities not in state or not in your *Added fields.`);
	parts.push(`- For new entities, generate unique IDs with prefixes: "npc-", "loc-", "quest-", "obj-", "item-".`);
	parts.push(`- Connect new locations to existing ones via the connections array.`);
	parts.push(`- Record important world details as sceneFactsAdded — agreements, prices, discoveries, lore, NPC promises.`);
	parts.push(`- Use npcChanges with field "notes" to record significant NPC interaction details.`);
	parts.push(`- If the narrative has NO mechanical effects, return {"stateChanges": {}}.`);
	parts.push(`- Do NOT award XP or complete quest objectives for merely asking questions, hearing rumors, scouting from safety, or discussing possible plans.`);
	parts.push(`- Do NOT start combat for simple observation or reconnaissance unless hostilities actually begin, the party is discovered, or the narrative clearly commits to battle.`);
	parts.push(`- Only use encounterStarted when the narrative contains an EXPLICIT attack, ambush, or charge — words like "attacks", "lunges", "combat begins", "roll for initiative". Scouting, observing, and cautious dialogue are NOT combat.`);
	parts.push(`- Award small XP (10-50) for clever roleplay, exploration, or puzzle-solving.`);
	parts.push(`- Award moderate XP (50-200) for combat victories and quest completions.`);
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
	parts.push(`    "npcChanges": [{"npcId": "exact-id-from-visible-[id:-field]", "field": "disposition|alive|hp|notes", "oldValue": X, "newValue": Y}] or omit,`);
	parts.push(`    "questUpdates": [{"questId": "exact-id-from-visible-[id:-field]", "field": "status|objective", ...}] or omit,`);
	parts.push(`    "conditionsApplied": [{"characterId": "exact-id-from-CHARACTERS-id-field", "condition": "blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious|exhaustion", "applied": true|false}] or omit,`);
	parts.push(`    "xpAwarded": [{"characterId": "exact-id-from-CHARACTERS-id-field", "amount": N}] or omit,`);
	parts.push(`    "npcsAdded": [{"id": "npc-<unique>", "name": "...", "role": "merchant|quest-giver|hostile|neutral|ally|companion|boss", "locationId": "exact-location-id-from-visible-[id:-field]", "disposition": 0, "description": "..."}] or omit,`);
	parts.push(`    "locationsAdded": [{"id": "loc-<unique>", "name": "...", "type": "settlement|wilderness|dungeon|interior|road", "description": "...", "connections": ["exact-location-id-from-visible-[id:-field]"], "features": ["..."], "groundItems": [{"id": "item-<unique>", "name": "...", "category": "...", "description": "...", "value": N, "quantity": N}]}] or omit,`);
	parts.push(`    "questsAdded": [{"id": "quest-<unique>", "name": "...", "description": "...", "giverNpcId": "exact-npc-id-from-visible-[id:-field]-or-null", "objectives": [{"id": "obj-<unique>", "text": "..."}], "recommendedLevel": N}] or omit,`);
	parts.push(`    "sceneFactsAdded": ["important fact to remember"] or omit,`);
	parts.push(`    "encounterStarted": {"creatures": [{"id": "npc-<unique>", "name": "...", "role": "hostile", "locationId": "exact-location-id-from-visible-[id:-field]-or-omit-for-party-location", "disposition": -100, "description": "...", "tier": "weak|normal|tough|elite|boss"}]} or omit,`);
	parts.push(`    "encounterEnded": {"outcome": "victory|defeat|flee|negotiated"} or omit,`);
	parts.push(`    "companionPromoted": {"npcId": "exact-npc-id-from-visible-[id:-field]", "statBlock": {...}} or omit,`);
	parts.push(`    "clockAdvance": {"from": {"day": N, "timeOfDay": "...", "weather": "..."}, "to": {"day": N, "timeOfDay": "...", "weather": "..."}} or omit`);
	parts.push(`  }`);
	parts.push(`}`);
	parts.push('');
	parts.push(`=== COMBAT EXTRACTION RULES ===`);
	parts.push(`During active combat the engine resolves all attacks, damage, and dice rolls authoritatively.`);
	parts.push(`- Do NOT invent hit/miss results, damage numbers, or specify attack targets in stateChanges.`);
	parts.push(`- You may still extract encounterStarted/encounterEnded, HP changes from non-engine sources, and condition changes.`);

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
			parts.push(`- ${formatNameIdRef(q.name, q.id)} (status: ${q.status}): ${objs}`);
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
 */
export function assembleStateExtractionContext(
	state: GameState,
	narrativeText: string,
	playerAction: string
): ChatMessageInput[] {
	return [
		{
			role: 'system',
			content: buildStateExtractionPrompt(state)
		},
		{
			role: 'user',
			content: `PLAYER ACTION: ${playerAction}\n\nNARRATIVE RESULT:\n${narrativeText}`
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

	const classDesc = c.classes.length > 1
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
			parts.push(
				`The party is in ${settlement.name}, a ${settlement.group} of ${Math.round(settlement.population * 1000).toLocaleString('en')} people` +
					(ownerState ? ` in ${ownerState.fullName}` : '') +
					(culture ? `, whose people follow ${culture.name} customs` : '') +
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
	const diceStr = `${m.dice.notation} → ${m.dice.total}`;
	const dcStr = m.dc !== undefined ? ` vs DC ${m.dc}` : '';
	const successStr = m.success !== undefined ? (m.success ? ' ✓' : ' ✗') : '';
	return `${m.label}: ${diceStr}${dcStr}${successStr}`;
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
	parts.push(`- End each response with a beat that invites the next player action.`);
	parts.push(`- Return ONLY narrative prose. Do NOT return JSON.`);
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
			parts.push(`NPCs present: ${localNpcs.map((n) => `${n.name} (${n.role})`).join(', ')}`);
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
			const diceStr = result.dice.notation !== '' ? ` [${result.dice.notation} → ${result.dice.total}]` : '';
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
			const diceStr = result.dice.notation
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
	recentChat: ChatRecord[] = []
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
	const round = state.activeEncounter?.round ?? '?';

	messages.push({
		role: 'user',
		content: [
			`Combat round ${round} just completed.`,
			'',
			roundSummary,
			'',
			'Narrate this round as a cohesive, vivid combat scene. Weave all the actions together — do not just list them. End with a beat that invites the next round of actions.'
		].join('\n')
	});

	return messages;
}
