/**
 * Combat Intent Classifier — dedicated LLM-powered intent classification for
 * active combat turns. Replaces regex-based intent classification during combat,
 * where misclassification has the highest cost (player loses their turn).
 *
 * This classifier resolves intent, target, weapon, and spell in a single
 * ~300-token call on gpt-4o-mini (~100-150ms).
 */

import type { CombatIntent, CombatIntentType, Combatant, PlayerCharacter, GameState } from '$lib/game/types';
import { completeChatJSON } from './openai';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CombatClassifierInput {
	/** Raw player action text. */
	playerAction: string;
	/** Non-defeated enemy combatants. */
	enemies: { id: string; name: string; hp: number; maxHp: number; ac: number }[];
	/** The acting character's weapon inventory. */
	weapons: { id: string; name: string; equipped: boolean }[];
	/** The acting character's prepared/known spells. */
	spells: string[];
	/** The acting character's consumable items. */
	consumables: { id: string; name: string }[];
}

const VALID_COMBAT_INTENTS: CombatIntentType[] = [
	'attack', 'cast-spell', 'use-item', 'move', 'dodge', 'disengage', 'flee', 'talk', 'query'
];

const COMBAT_CLASSIFIER_SYSTEM = `You are a combat intent classifier for a D&D 5e RPG engine, returning JSON. The player is in active combat.

Classify their input into exactly one type:
- "attack": physical weapon attack on an enemy
- "cast-spell": casting a spell (damage, healing, buff, etc.)
- "use-item": using a consumable item (potion, scroll, etc.)
- "move": repositioning on the battlefield
- "dodge": taking the Dodge action
- "disengage": taking the Disengage action
- "flee": attempting to run away from combat entirely
- "talk": speaking to someone during combat (intimidate, parley, etc.)
- "query": the player is asking for information about the battlefield and should NOT consume a turn. Examples: "How many enemies can I see?", "What's the shaman doing?", "Is there cover nearby?". Note that interrogative phrasing of an action ("I attack the rat?", "Can I hit it?") is NOT a query — it's still an action.

Rules:
- If the input clearly implies a physical attack (hitting, striking, stabbing, using a weapon ON something), classify as "attack" even if the word "use" appears.
- For attack: resolve targetId to the enemy id that best matches their description. Resolve weaponItemId to the weapon id that best matches what they mention, or omit if unclear.
- For cast-spell: resolve spellName to the closest match from the available spells list.
- For use-item: provide itemHint with what the player described.
- Set confidence to "high" unless the input is truly ambiguous or nonsensical, in which case set "low".

Return JSON: {"type":"...","targetId":"...","targetDescription":"...","weaponItemId":"...","spellName":"...","itemHint":"...","confidence":"high|low"}
Omit fields that don't apply. Always include type and confidence.`;

/**
 * Classify a player's combat action using a focused LLM call.
 * Returns a structured CombatIntent with resolved target, weapon, and spell references.
 */
export async function classifyCombatIntent(
	input: CombatClassifierInput,
	apiKey: string,
	model = 'gpt-4o-mini'
): Promise<CombatIntent> {
	const userParts: string[] = [];

	if (input.enemies.length > 0) {
		const enemyList = input.enemies
			.map(e => `  - ${e.name} (id: ${e.id}, ${e.hp}/${e.maxHp} HP, AC ${e.ac})`)
			.join('\n');
		userParts.push(`Enemies:\n${enemyList}`);
	} else {
		userParts.push('Enemies: none visible');
	}

	if (input.weapons.length > 0) {
		const weaponList = input.weapons
			.map(w => `  - ${w.name} (id: ${w.id}${w.equipped ? ', equipped' : ''})`)
			.join('\n');
		userParts.push(`Weapons:\n${weaponList}`);
	}

	if (input.spells.length > 0) {
		userParts.push(`Prepared spells: ${input.spells.join(', ')}`);
	}

	if (input.consumables.length > 0) {
		const consumableList = input.consumables
			.map(c => `  - ${c.name} (id: ${c.id})`)
			.join('\n');
		userParts.push(`Consumables:\n${consumableList}`);
	}

	userParts.push(`Player input: "${input.playerAction}"`);

	try {
		const rawJson = await completeChatJSON({
			apiKey,
			model,
			messages: [
				{ role: 'system', content: COMBAT_CLASSIFIER_SYSTEM },
				{ role: 'user', content: userParts.join('\n') }
			]
		});

		const parsed = JSON.parse(rawJson);
		const type = VALID_COMBAT_INTENTS.includes(parsed.type) ? parsed.type : 'attack';
		const confidence = parsed.confidence === 'low' ? 'low' : 'high';

		return {
			type,
			confidence,
			...(parsed.targetId ? { targetId: String(parsed.targetId) } : {}),
			...(parsed.targetDescription ? { targetDescription: String(parsed.targetDescription) } : {}),
			...(parsed.weaponItemId ? { weaponItemId: String(parsed.weaponItemId) } : {}),
			...(parsed.spellName ? { spellName: String(parsed.spellName) } : {}),
			...(parsed.itemHint ? { itemHint: String(parsed.itemHint) } : {})
		};
	} catch (err) {
		console.error('[classifyCombatIntent] Failed, defaulting to attack:', err);
		return { type: 'attack', confidence: 'high' };
	}
}

// ---------------------------------------------------------------------------
// Helper: build classifier input from game state
// ---------------------------------------------------------------------------

/**
 * Extract the classifier input from the current game state.
 * Call this at the top of executeAdventureTurn when in active combat.
 */
export function buildClassifierInput(
	playerAction: string,
	state: GameState,
	actorUserId: string
): CombatClassifierInput {
	const encounter = state.activeEncounter!;
	const actor = state.characters.find(c => c.userId === actorUserId);

	// Non-defeated enemy combatants (exclude companions)
	const enemies = encounter.combatants
		.filter(c => {
			if (c.type !== 'npc' || c.defeated) return false;
			const npc = state.npcs.find(n => n.id === c.referenceId);
			return npc && npc.role !== 'companion';
		})
		.map(c => ({
			id: c.referenceId, // use NPC id so the engine can look it up
			name: c.name,
			hp: c.currentHp,
			maxHp: c.maxHp,
			ac: c.ac
		}));

	// Actor weapons
	const weapons = actor
		? actor.inventory
			.filter((item): item is import('$lib/game/types').WeaponItem => item.category === 'weapon')
			.map(w => ({ id: w.id, name: w.weaponName ?? w.name, equipped: w.equipped ?? false }))
		: [];

	// Actor prepared/known spells + cantrips
	const spells: string[] = [];
	if (actor) {
		for (const cs of actor.classSpells) {
			spells.push(...cs.cantrips);
			spells.push(...cs.preparedSpells);
		}
	}

	// Actor consumables
	const consumables = actor
		? actor.inventory
			.filter(item => item.category === 'consumable' && item.quantity > 0)
			.map(item => ({ id: item.id, name: item.name }))
		: [];

	return {
		playerAction,
		enemies,
		weapons,
		spells: [...new Set(spells)], // dedupe
		consumables
	};
}
