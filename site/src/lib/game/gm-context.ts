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
import type { GameState, MechanicResult, PlayerCharacter, TurnRecord } from '$lib/game/types';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max recent turns to include in context. */
const MAX_HISTORY_TURNS = 20;

/** Max characters for the world brief section. */
const MAX_WORLD_BRIEF_CHARS = 3000;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(state: GameState, worldBrief: string): string {
	const parts: string[] = [];

	parts.push(`You are the Game Master of a text-based fantasy RPG adventure.`);
	parts.push(`You narrate in second-person perspective, speaking directly to the party.`);
	parts.push(`You are authoritative about the world — you describe what happens as a consequence of player actions.`);
	parts.push(`You respect the mechanics: when dice results are provided, narrate around those outcomes faithfully.`);
	parts.push(`Keep responses vivid and concise (2–5 sentences for normal actions, more for important moments).`);
	parts.push(`End each response with a beat that invites the next player action.`);
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
		if (loc.features.length > 0) {
			parts.push(`Features: ${loc.features.join('; ')}`);
		}
		const localNpcs = state.npcs.filter((n) => n.locationId === loc.id && n.alive);
		if (localNpcs.length > 0) {
			parts.push(`NPCs present: ${localNpcs.map((n) => `${n.name} (${n.role})`).join(', ')}`);
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

	// Active quests
	const activeQuests = state.quests.filter((q) => q.status === 'active');
	if (activeQuests.length > 0) {
		parts.push(`=== ACTIVE QUESTS ===`);
		for (const q of activeQuests) {
			const objectives = q.objectives.map((o) => `${o.done ? '[x]' : '[ ]'} ${o.text}`).join('; ');
			parts.push(`- ${q.name}: ${q.description} | Objectives: ${objectives}`);
		}
		parts.push('');
	}

	// Game clock
	parts.push(`=== TIME ===`);
	parts.push(`Day ${state.clock.day}, ${state.clock.timeOfDay}. Weather: ${state.clock.weather}.`);
	parts.push('');

	// Response format instructions
	parts.push(`=== RESPONSE FORMAT ===`);
	parts.push(`Return a JSON object with exactly these fields:`);
	parts.push(`{`);
	parts.push(`  "narrativeText": "Your narration of what happens (shown to players)",`);
	parts.push(`  "stateChanges": {`);
	parts.push(`    "hpChanges": [{"characterId": "...", "oldHp": N, "newHp": N, "reason": "..."}] or omit,`);
	parts.push(`    "itemsGained": [{"characterId": "...", "item": {"id": "new-ulid", "name": "...", "category": "weapon|armor|consumable|quest|misc", "description": "...", "properties": {}, "value": N, "quantity": N}}] or omit,`);
	parts.push(`    "locationChange": {"from": "id-or-null", "to": "location-id"} or omit,`);
	parts.push(`    "npcChanges": [{"npcId": "...", "field": "disposition|alive", "oldValue": X, "newValue": Y}] or omit,`);
	parts.push(`    "questUpdates": [{"questId": "...", "field": "status|objective", "oldValue": X, "newValue": Y}] or omit,`);
	parts.push(`    "conditionsApplied": [{"characterId": "...", "condition": "...", "applied": true|false}] or omit,`);
	parts.push(`    "xpAwarded": [{"characterId": "...", "amount": N}] or omit`);
	parts.push(`  },`);
	parts.push(`  "gmNotes": "optional private reasoning"`);
	parts.push(`}`);
	parts.push(`If the action has no mechanical effect, return an empty stateChanges object {}.`);
	parts.push(`IMPORTANT: Always return valid JSON. The narrativeText field is required.`);

	return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Character brief
// ---------------------------------------------------------------------------

function formatCharacterBrief(c: PlayerCharacter): string {
	const hpStr = `${c.hp}/${c.maxHp} HP`;
	const conditions = c.conditions.length > 0 ? ` [${c.conditions.join(', ')}]` : '';
	const notableItems = c.inventory
		.filter((i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'quest')
		.map((i) => i.name)
		.slice(0, 5);
	const itemStr = notableItems.length > 0 ? ` | Gear: ${notableItems.join(', ')}` : '';

	return `- ${c.name} (Lv${c.level} ${c.race} ${c.class}) — ${hpStr}${conditions} | AC ${c.ac}${itemStr}`;
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
				`The party is in ${settlement.name}, a ${settlement.group} of ${settlement.population} people` +
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
function turnsToMessages(turns: TurnRecord[]): ChatMessageInput[] {
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
			messages.push({ role: 'assistant', content: turn.narrativeText });
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
// Main assembler
// ---------------------------------------------------------------------------

/**
 * Build the complete messages array for an AI turn.
 *
 * @param state       Current GameState
 * @param world       The PrototypeWorld (loaded from state or separately)
 * @param recentTurns Last N turns from the durable store
 * @param playerAction The raw text the player just typed
 * @param mechanicResults Any dice rolls already resolved for this action
 */
export function assembleGMContext(
	state: GameState,
	world: PrototypeWorld | null,
	recentTurns: TurnRecord[],
	playerAction: string,
	mechanicResults: MechanicResult[] = []
): ChatMessageInput[] {
	const messages: ChatMessageInput[] = [];

	// 1. System prompt with all structured context
	const worldBrief = world ? buildWorldBrief(world, state) : '';
	messages.push({
		role: 'system',
		content: buildSystemPrompt(state, worldBrief)
	});

	// 2. Conversation history (capped)
	const historyTurns = recentTurns.slice(-MAX_HISTORY_TURNS);
	messages.push(...turnsToMessages(historyTurns));

	// 3. Current player action
	let currentAction = playerAction;
	if (mechanicResults.length > 0) {
		const mechSummary = mechanicResults.map(formatMechanicResult).join(' | ');
		currentAction += `\n[Mechanics: ${mechSummary}]`;
	}
	messages.push({ role: 'user', content: currentAction });

	return messages;
}
