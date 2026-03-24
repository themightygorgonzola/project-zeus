import type { GameState, IntentType, MechanicResult, PlayerCharacter, StateChange, Item, GameClock, WeaponItem, GameId, NPC, ActiveEncounter, Combatant, PendingCombatAction, PendingCheck, AbilityName, SkillName, CombatIntent } from '$lib/game/types';
import { getAllKnownSpells, getAllPreparedSpells, getAllCantrips, SKILL_ABILITY_MAP } from '$lib/game/types';
import { useConsumable, findItem } from '$lib/game/inventory';
import { shortRest, longRest } from '$lib/game/rest';
import { advanceClock, advanceClockOnState, travelBetween, findLocation, getAvailableExits } from '$lib/game/travel';
import { castSpell, canCastSpell } from '$lib/game/spellcasting';
import { getSpell } from '$lib/game/data/spells';
import { resolveAttack, resolveNpcAttack, allDefeated, advanceTurn, type CombatAttackResult } from '$lib/game/combat';
import { attackToMechanicResult, rollDeathSave } from '$lib/game/mechanics';
import { ulid } from 'ulid';

export interface ParsedTurnIntent {
	rawAction: string;
	primaryIntent: IntentType;
	mentionsHealing: boolean;
	mentionsPotion: boolean;
	mentionsPoison: boolean;
	mentionsCamp: boolean;
	mentionsWait: boolean;
	targetHint: 'self' | 'nearest-ally' | 'named-ally' | 'nearest-enemy' | 'named-enemy' | 'none';
}

export interface ClarificationRequest {
	reason: 'ambiguous-heal-resource' | 'ambiguous-item' | 'ambiguous-heal-target' | 'ambiguous-destination' | 'ambiguous-spell';
	question: string;
	options: string[];
}

export interface TurnTarget {
	id: string;
	type: 'character' | 'npc' | 'location' | 'item' | 'spell';
	name: string;
}

export interface ConsumedResource {
	type: 'spell-slot' | 'item' | 'hit-dice' | 'feature-use' | 'gold';
	label: string;
	amount: number;
}

export interface ResolvedTurn {
	status: 'ready-for-narration' | 'needs-clarification' | 'awaiting-roll';
	intent: ParsedTurnIntent;
	/** The character ID that performed the action. */
	actorId: string;
	/** Structured target references resolved by the engine. */
	targets: TurnTarget[];
	/** Resources consumed by the engine resolution. */
	resourcesConsumed: ConsumedResource[];
	/** Canonical one-line summary of what the engine resolved (for persistence + narrator). */
	resolvedActionSummary: string;
	mechanicResults: MechanicResult[];
	stateChanges: StateChange;
	/** Updated characters (with engine mutations applied). */
	updatedCharacters?: PlayerCharacter[];
	clarification?: ClarificationRequest;
	/**
	 * Sequential combat model: true when the round just completed (all actors have acted),
	 * false when we are mid-round (more actors still to go). undefined for non-combat turns.
	 * adventure-turn.ts uses this to decide whether to fire the AI narrator.
	 */
	roundComplete?: boolean;
	/**
	 * Phase B: if the engine determines a non-trivial check is needed before
	 * narration can proceed, this is the pending check request.
	 * adventure-turn.ts persists this and waits for the player to resolve.
	 */
	pendingCheck?: PendingCheck;
}

const HEALING_SPELLS = new Set([
	'cure-wounds',
	'healing-word',
	'mass-healing-word',
	'mass-cure-wounds',
	'prayer-of-healing',
	'heal',
	'aura-of-vitality',
	'goodberry'
]);

export function classifyIntent(action: string): IntentType {
	const lower = action.toLowerCase();
	// Only treat as "asking about possibility" when the person is NOT issuing a first-person battle action.
	// e.g. "I see this is odd? I attack the brigand!" should still be classified as attack.
	const hasExplicitFirstPersonAttack = /\bi[\s.!,…]*(attack|strike|stab|shoot|fire|hit|charge|slash|fight|swing)\b/.test(lower);
	const asksAboutPossibility = !hasExplicitFirstPersonAttack && (
		lower.trimEnd().endsWith('?')
		|| /^(can|could|would|should|do|does|did|where|what|who|when|why|how|are|is)\b/.test(lower)
		|| /\b(any opportunities|looking for|want to find|are there opportunities|is there a way)\b/.test(lower)
	);

	// Death save must be checked BEFORE attack (to avoid 'throw' matching the attack regex)
	if (/\b(death save|death saving throw|roll.*death|saving throw.*death)\b/.test(lower)) return 'death-save';
	if (asksAboutPossibility && /\b(fight|attack|enemy|enemies|combat|battle|prove my might|low level)\b/.test(lower)) return 'talk';

	if (/\b(attack|strike|hit|fight|slash|stab|shoot|swing|punch|kick|fire|charge|throw|bite|block|parry|thrust|lunge|cleave|slay|kill|smite|smash|bash)\b/.test(lower)) return 'attack';
	if (/\b(go|move|walk|travel|head|enter|leave|climb|swim|run|flee|return|approach|proceed|follow|cross|sneak|creep)\b/.test(lower)) return 'move';
	if (/\b(talk|speak|say|ask|tell|greet|persuade|intimidate|negotiate)\b/.test(lower)) return 'talk';
	if (/\b(equip|unequip|wield|don|doff|put on|take off)\b/.test(lower)) return 'equip-item';
	if (/\b(drop|discard|abandon)\b/.test(lower)) return 'drop-item';
	if (/\b(use|drink|eat|apply|open|activate|read)\b/.test(lower)) return 'use-item';
	if (/\b(cast|spell|magic|invoke|conjure|summon|heal|cure|restore)\b/.test(lower)) return 'cast-spell';
	if (/\b(look|examine|inspect|search|investigate|check|observe|scan|study|survey|watch)\b/.test(lower)) return 'examine';
	if (/\b(rest|sleep|camp|short rest|long rest|wait)\b/.test(lower)) return 'rest';


	return 'free-narration';
}

export function parseTurnIntent(action: string, intentOverride?: IntentType): ParsedTurnIntent {
	const lower = action.toLowerCase();
	const targetHint = /\b(myself|my self|self|me)\b/.test(lower)
		? 'self'
		: /\b(nearest|closest)\s+(companion|ally|friend|party member)\b/.test(lower)
			? 'nearest-ally'
			: /\b(nearest|closest)\s+\w+\b/.test(lower)
				? 'nearest-enemy'
				: /\b(imp|goblin|orc|bandit|bartender|guard|enemy|foe|creature|him|her|them)\b/.test(lower)
						? 'named-enemy'
						: 'none';

	return {
		rawAction: action,
		primaryIntent: intentOverride ?? classifyIntent(action),
		mentionsHealing: /\b(heal|healing|cure|restore|mend|revive)\b/.test(lower),
		mentionsPotion: /\b(potion|elixir|draught|vial)\b/.test(lower),
		mentionsPoison: /\b(poison|venom|toxin)\b/.test(lower),
		mentionsCamp: /\b(camp|campfire|camping|camp while|make camp)\b/.test(lower),
		mentionsWait: /\b(wait|nightfall|until night|pass time)\b/.test(lower),
		targetHint
	};
}

// ---------------------------------------------------------------------------
// Non-combat check detection (Phase B2)
// ---------------------------------------------------------------------------

interface CheckMatch {
	skill: SkillName;
	reason: string;
	dc: number;
}

/**
 * Priority-ordered check patterns. First match wins.
 * Only high-stakes / uncertain-outcome actions trigger a check;
 * trivial or informational actions (looking at a sign, greeting someone)
 * stay as free narration.
 */
export const CHECK_PATTERNS: ReadonlyArray<{ pattern: RegExp; match: CheckMatch }> = [
	// Investigation (INT) ─ searching for hidden/secret things
	{
		pattern: /\b(search\s+(for|the)|look\s+for\s+\S*\s*(trap|hidden|secret|clue|door|passage)|investigate\b|inspect\s+(for|closely)|analyze\b|deduce\b|figure\s+out|examine\s+\S*\s*closely|study\s+\S*\s*carefully|search\s+\S*\s*(room|body|area|chest|bag|desk|shelf|crate))/,
		match: { skill: 'investigation', reason: 'Make an Investigation check.', dc: 12 }
	},
	// Perception (WIS) ─ noticing, listening, spotting
	{
		pattern: /\b(listen\s+(at|to|for|closely)|eavesdrop|keep\s+watch|look\s+for\s+(hidden|danger|ambush)|watch\s+for\b|peer\s+into|look\s+around\b.*?\bcarefully|spot\s+(the|any|a)\b|scan\s+(for|the)|sense\s+danger)/,
		match: { skill: 'perception', reason: 'Make a Perception check.', dc: 12 }
	},
	// Stealth (DEX) ─ sneaking, hiding
	{
		pattern: /\b(sneak\s|sneak$|creep\s|creep$|move\s+quiet|move\s+silent|stealthil|hide\s+(from|behind|in|under|myself)|skulk|tiptoe|stay\s+hidden|remain\s+hidden|approach\s+\S*\s*quiet|approach\s+\S*\s*silent)/,
		match: { skill: 'stealth', reason: 'Make a Stealth check.', dc: 12 }
	},
	// Persuasion (CHA) ─ convincing, negotiating
	{
		pattern: /\b(persuade|convince\s+(him|her|them|the|it)|negotiate\s+(a|the|with)|haggle|plead\b|beg\s+(him|her|them|for)|appeal\s+to|talk\s+\S*\s*into|reason\s+with)/,
		match: { skill: 'persuasion', reason: 'Make a Persuasion check.', dc: 12 }
	},
	// Deception (CHA) ─ lying, bluffing, disguise
	{
		pattern: /\b(lie\s+to|lie\s+about|bluff\b|deceive|pretend\s+to|disguise\s+(my|our)|mislead|make\s+up\s+a\s+story|feign\b|false\s+identity)/,
		match: { skill: 'deception', reason: 'Make a Deception check.', dc: 12 }
	},
	// Intimidation (CHA) ─ threatening, scaring
	{
		pattern: /\b(intimidat|threaten\s+(him|her|them|the|to)|demand\s+(they|that|he|she|it|the)|scare\b|frighten|menac|bully\b|loom\s+over)/,
		match: { skill: 'intimidation', reason: 'Make an Intimidation check.', dc: 12 }
	},
	// Insight (WIS) ─ reading people
	{
		pattern: /\b(sense\s+motive|read\s+(his|her|their|the)\s+(expression|face|emotion|intention)|tell\s+if\b.*?\b(lying|truthful|honest|bluffing|sincere)|detect\s+(lie|deception)|gauge\s+(sincerit|honest|truth))/,
		match: { skill: 'insight', reason: 'Make an Insight check.', dc: 12 }
	},
	// Arcana (INT) ─ identifying magic
	{
		pattern: /\b(identify\s+(the\s+)?(spell|magic|enchantment|rune|glyph|ward)|sense\s+magic|detect\s+magic|recognize\s+\S*\s*arcane|arcane\s+knowledge|magical\s+nature)/,
		match: { skill: 'arcana', reason: 'Make an Arcana check.', dc: 12 }
	},
	// Survival (WIS) ─ tracking, foraging, navigation
	{
		pattern: /\b(track\s+(the|a|foot|prints|animal|creature|it|them|him|her)|forage\b|navigate\s+(the|through)|find\s+(my|our|the|a)\s+(way|path|trail)|read\s+the\s+tracks|follow\s+the\s+trail)/,
		match: { skill: 'survival', reason: 'Make a Survival check.', dc: 12 }
	},
	// Athletics (STR) ─ climbing, swimming, forcing
	{
		pattern: /\b(climb\s+(the|a|up|over)|swim\s+(across|through|the)|jump\s+(over|across)|force\s+open|break\s+down\s+(the|a)|push\s+(the|a)\s+heavy|lift\s+(the|a)\s+heavy|grapple\b|shove\b|pull\s+myself|haul\b)/,
		match: { skill: 'athletics', reason: 'Make an Athletics check.', dc: 12 }
	},
	// Acrobatics (DEX) ─ balancing, tumbling
	{
		pattern: /\b(balance\s+(on|across)|tumble\s+(through|past)|dodge\s+(past|through)|flip\s+over|vault\s+over|swing\s+from|land\s+safely|cartwheel|somersault)/,
		match: { skill: 'acrobatics', reason: 'Make an Acrobatics check.', dc: 12 }
	},
	// Nature (INT) ─ identifying creatures/plants
	{
		pattern: /\b(identify\s+(the\s+)?(plant|herb|flower|tree|animal|beast|creature|fungus|mushroom)|recognize\s+the\s+(creature|beast|animal)|natural\s+phenomenon)/,
		match: { skill: 'nature', reason: 'Make a Nature check.', dc: 12 }
	},
	// Medicine (WIS) ─ treating wounds, diagnosing
	{
		pattern: /\b(tend\s+(to\s+)?(the\s+)?wound|diagnose|stabiliz|examine\s+(the\s+)?(body|corpse|remains|injury|wound)|treat\s+(the\s+)?(injury|wound|poison|disease)|first\s+aid|check\s+(for\s+)?(a\s+)?pulse)/,
		match: { skill: 'medicine', reason: 'Make a Medicine check.', dc: 12 }
	},
	// Sleight of Hand (DEX) ─ pickpocketing, lockpicking
	{
		pattern: /\b(pickpocket|pick\s+(the|a)\s+(lock|pocket)|palm\s+(the|a)|sleight|plant\s+(the|a)\s+(item|evidence|note)|swap\s+(the|a)|conceal\s+(the|a))/,
		match: { skill: 'sleight-of-hand', reason: 'Make a Sleight of Hand check.', dc: 12 }
	}
];

/**
 * Detect whether a player action warrants a non-combat skill check.
 * Returns null for trivial / low-stakes actions that should be free narration.
 */
export function detectPendingCheck(
	action: string,
	intent: ParsedTurnIntent,
	actor: PlayerCharacter,
	state: GameState
): PendingCheck | null {
	const lower = action.toLowerCase();

	// Never intercept OOC or unknown intents
	if (intent.primaryIntent === 'out-of-character' || intent.primaryIntent === 'unknown') return null;

	for (const entry of CHECK_PATTERNS) {
		if (entry.pattern.test(lower)) {
			const { skill, reason, dc } = entry.match;
			const ability = SKILL_ABILITY_MAP[skill];
			return {
				id: ulid(),
				kind: 'skill',
				characterId: actor.id,
				ability,
				skill,
				dc,
				advantageState: 'normal',
				reason,
				combatBound: !!(state.activeEncounter && state.activeEncounter.status === 'active')
			};
		}
	}

	return null;
}

function getActor(state: GameState, actorUserId: string): PlayerCharacter | undefined {
	return state.characters.find((character) => character.userId === actorUserId);
}

function getAvailableHealingOptions(actor: PlayerCharacter): string[] {
	const spellOptions = Array.from(new Set([...getAllPreparedSpells(actor), ...getAllKnownSpells(actor)]))
		.filter((spell) => HEALING_SPELLS.has(spell));
	const itemOptions = actor.inventory
		.filter((item) => item.category === 'consumable')
		.map((item) => item.name)
		.filter((name) => /healing|potion|elixir/i.test(name));
	return Array.from(new Set([...spellOptions, ...itemOptions]));
}

function getPotionOptions(actor: PlayerCharacter): string[] {
	return Array.from(
		new Set(
			actor.inventory
				.filter((item) => item.category === 'consumable')
				.map((item) => item.name)
				.filter((name) => /potion|elixir|draught/i.test(name))
		)
	);
}

function getPoisonOptions(actor: PlayerCharacter): string[] {
	return Array.from(
		new Set(
			actor.inventory
				.filter((item) => item.category === 'consumable' || item.category === 'misc')
				.map((item) => item.name)
				.filter((name) => /poison|venom|toxin/i.test(name))
		)
	);
}

function getHealTargetCount(state: GameState, actorUserId: string): number {
	return state.characters.filter((character) => !character.dead && character.userId !== actorUserId).length;
}

export function resolveTurn(playerAction: string, state: GameState | null, actorUserId: string, intentOverride?: IntentType, combatIntent?: CombatIntent): ResolvedTurn {
	const intent = parseTurnIntent(playerAction, intentOverride);
	const actor = state ? getActor(state, actorUserId) : undefined;
	const base: ResolvedTurn = {
		status: 'ready-for-narration',
		intent,
		actorId: actor?.id ?? '',
		targets: [],
		resourcesConsumed: [],
		resolvedActionSummary: '',
		mechanicResults: [],
		stateChanges: {}
	};

	if (!state) return base;
	if (!actor) return base;

	// -----------------------------------------------------------------------
	// Combat classifier path: when a CombatIntent is provided by the dedicated
	// LLM classifier, route directly by its type. This bypasses the regex
	// waterfall entirely during active combat.
	// -----------------------------------------------------------------------
	if (combatIntent && state.activeEncounter?.status === 'active') {
		switch (combatIntent.type) {
			case 'attack':
				return resolveCombatAttack(base, actor, state, intent, actorUserId, combatIntent.targetId, combatIntent.weaponItemId);
			case 'cast-spell':
				// If the classifier resolved a spell name, inject it into the intent
				if (combatIntent.spellName) {
					// Override the raw action to include the spell name for findSpellInAction
					const spellAction = `cast ${combatIntent.spellName}`;
					const spellIntent = parseTurnIntent(spellAction, 'cast-spell');
					return resolveCastSpell(base, actor, state, spellIntent);
				}
				return resolveCastSpell(base, actor, state, { ...intent, primaryIntent: 'cast-spell' });
			case 'use-item':
				return resolveUseItem(base, actor, state);
			case 'dodge':
			case 'disengage':
			case 'move':
			case 'talk':
			case 'flee': {
				// Improvised combat action — stays in initiative order,
				// the AI narrator will describe it within the combat context.
				const enc = state.activeEncounter!;
				const combatantId =
					enc.awaitingActorId ??
					(enc.combatants.find(c => c.type === 'character' && c.referenceId === actor.id)?.id ?? actor.id);
				if (!enc.roundActions) enc.roundActions = [];
				enc.roundActions.push({
					combatantId,
					rawAction: playerAction,
					mechanicResults: [],
					stateChanges: {},
					timestamp: Date.now()
				});
				const advance = autoAdvancePastNpcs(state, enc);
				const stateChanges: StateChange = {};
				if (advance.stateChanges.hpChanges) stateChanges.hpChanges = advance.stateChanges.hpChanges;
				if (advance.stateChanges.encounterEnded) stateChanges.encounterEnded = advance.stateChanges.encounterEnded;
				const updatedCharacters = syncCharacterHpFromCombatants(state);
				return {
					...base,
					resolvedActionSummary: `Combat action (${combatIntent.type}): ${playerAction}`,
					mechanicResults: advance.mechanicResults,
					stateChanges,
					updatedCharacters,
					roundComplete: advance.roundComplete
				};
			}
			// query type is handled upstream in adventure-turn.ts — should never reach here
			default:
				return resolveCombatAttack(base, actor, state, intent, actorUserId, combatIntent.targetId, combatIntent.weaponItemId);
		}
	}

	if (intent.mentionsHealing) {
		const healingOptions = getAvailableHealingOptions(actor);
		if (healingOptions.length > 1) {
			return {
				...base,
				status: 'needs-clarification',
				clarification: {
					reason: 'ambiguous-heal-resource',
					question: `You have multiple healing options available. Which one do you want to use? (${healingOptions.join(', ')})`,
					options: healingOptions
				}
			};
		}
		if (intent.targetHint === 'none' && getHealTargetCount(state, actorUserId) > 1) {
			const targetOptions = state.characters
				.filter((character) => !character.dead && character.userId !== actorUserId)
				.map((character) => character.name);
			return {
				...base,
				status: 'needs-clarification',
				clarification: {
					reason: 'ambiguous-heal-target',
					question: `Who do you want to heal? (${targetOptions.join(', ')})`,
					options: targetOptions
				}
			};
		}
	}

	if (intent.mentionsPotion) {
		const potionOptions = getPotionOptions(actor);
		if (potionOptions.length > 1) {
			return {
				...base,
				status: 'needs-clarification',
				clarification: {
					reason: 'ambiguous-item',
					question: `You have multiple potion-like consumables. Which one do you want to use? (${potionOptions.join(', ')})`,
					options: potionOptions
				}
			};
		}
	}

	if (intent.mentionsPoison) {
		const poisonOptions = getPoisonOptions(actor);
		if (poisonOptions.length > 1) {
			return {
				...base,
				status: 'needs-clarification',
				clarification: {
					reason: 'ambiguous-item',
					question: `You have multiple poison-like items. Which one do you want to apply? (${poisonOptions.join(', ')})`,
					options: poisonOptions
				}
			};
		}
	}

	// -----------------------------------------------------------------------
	// Authoritative resolution — call engine functions for resolvable intents
	// -----------------------------------------------------------------------

	switch (intent.primaryIntent) {
		case 'attack':
			return resolveCombatAttack(base, actor, state, intent, actorUserId);
		case 'death-save':
			return resolveDeathSave(base, actor, state, actorUserId);
		case 'use-item':
			return resolveUseItem(base, actor, state);
		case 'rest':
			return resolveRest(base, actor, state, intent);
		case 'move': {
			// Check for skill-gated movement FIRST (sneak, climb, swim, etc.)
			// These must intercept before resolveTravel, which would otherwise
			// swallow the action and leave the AI to narrate the check in prose.
			const moveCheck = detectPendingCheck(playerAction, intent, actor, state);
			if (moveCheck) {
				return {
					...base,
					status: 'awaiting-roll',
					pendingCheck: moveCheck,
					resolvedActionSummary: moveCheck.reason
				};
			}
			const travelResult = resolveTravel(base, actor, state, intent);
			return travelResult;
		}
		case 'cast-spell':
			return resolveCastSpell(base, actor, state, intent);
		default: {
			const inCombat = !!(state.activeEncounter && state.activeEncounter.status === 'active');

			// During companion's turn, any input (including 'auto', free-narration)
			// should route to combat so the companion acts.
			if (state.activeEncounter?.awaitingActorId) {
				const awaitingCombatant = state.activeEncounter.combatants.find(
					(c) => c.id === state.activeEncounter!.awaitingActorId
				);
				if (awaitingCombatant?.type === 'npc') {
					const npc = state.npcs.find((n) => n.id === awaitingCombatant.referenceId);
					if (npc?.role === 'companion') {
						return resolveCombatAttack(base, actor, state, intent, actorUserId);
					}
				}
			}

			// ── Combat context routing ──────────────────────────────────
			// When in active combat, non-attack/spell intents ("I ready my crossbow",
			// "I look around") must stay within the combat loop as improvised actions,
			// NOT fall through to open skill checks or unconstrained GM narration.
			if (inCombat) {
				// Only allow combat-valid checks (athletics to grapple/shove,
				// acrobatics to tumble, stealth to hide) during combat.
				const COMBAT_VALID_SKILLS = new Set([
					'athletics', 'acrobatics', 'stealth', 'intimidation', 'medicine'
				]);
				const check = detectPendingCheck(playerAction, intent, actor, state);
				if (check && check.skill && COMBAT_VALID_SKILLS.has(check.skill)) {
					return {
						...base,
						status: 'awaiting-roll',
						pendingCheck: check,
						resolvedActionSummary: check.reason
					};
				}
				// Treat as improvised combat action — stays in initiative order,
				// the AI narrator will describe it within the combat context.
				// Still auto-advance past NPC turns so enemies get to act.
				const improvisedEncounter = state.activeEncounter!;
				const improvisedCombatantId =
					improvisedEncounter.awaitingActorId ??
					(improvisedEncounter.combatants.find(c => c.type === 'character' && c.referenceId === actor.id)?.id ?? actor.id);
				if (!improvisedEncounter.roundActions) improvisedEncounter.roundActions = [];
				improvisedEncounter.roundActions.push({
					combatantId: improvisedCombatantId,
					rawAction: playerAction,
					mechanicResults: [],
					stateChanges: {},
					timestamp: Date.now()
				});
				const improvisedAdvance = autoAdvancePastNpcs(state, improvisedEncounter);
				const improvisedStateChanges: StateChange = {};
				if (improvisedAdvance.stateChanges.hpChanges) {
					improvisedStateChanges.hpChanges = improvisedAdvance.stateChanges.hpChanges;
				}
				if (improvisedAdvance.stateChanges.encounterEnded) {
					improvisedStateChanges.encounterEnded = improvisedAdvance.stateChanges.encounterEnded;
				}
				const updatedCharacters = syncCharacterHpFromCombatants(state);
				return {
					...base,
					resolvedActionSummary: `Improvised combat action: ${playerAction}`,
					mechanicResults: improvisedAdvance.mechanicResults,
					stateChanges: improvisedStateChanges,
					updatedCharacters,
					roundComplete: improvisedAdvance.roundComplete
				};
			}

			// ── Non-combat check detection ──────────────────────────────
			// talk, examine, free-narration: detect if the action warrants
			// a skill check before falling through to unconstrained narrative.
			{
				const check = detectPendingCheck(playerAction, intent, actor, state);
				if (check) {
					return {
						...base,
						status: 'awaiting-roll',
						pendingCheck: check,
						resolvedActionSummary: check.reason
					};
				}
			}
			// Low-stakes / trivial — let AI handle as free narration
			return base;
		}
	}
}

// ---------------------------------------------------------------------------
// Combat Attack Resolver (Phase 8c)
// ---------------------------------------------------------------------------

/**
 * Build a WeaponItem representing an unarmed strike.
 * Uses 1d4 + STR as per the roadmap (slightly above RAW 5e's 1 + STR
 * to keep combat interesting).
 */
function buildUnarmedStrike(): WeaponItem {
	return {
		id: 'unarmed-strike',
		name: 'Unarmed Strike',
		category: 'weapon',
		description: 'An unarmed attack',
		value: 0,
		quantity: 1,
		weight: 0,
		rarity: 'common',
		attunement: false,
		weaponName: 'Unarmed Strike',
		damage: '1d4',
		damageType: 'bludgeoning',
		magicBonus: 0,
		properties: []
	};
}

/**
 * Find the first equipped weapon in the actor's inventory.
 * Returns null if no weapon is equipped.
 */
function getEquippedWeapon(actor: PlayerCharacter): WeaponItem | null {
	return (actor.inventory.find(
		(item): item is WeaponItem => item.category === 'weapon' && (item as WeaponItem).equipped === true
	)) ?? null;
}

/** Mark a weapon as equipped (and un-equip the previous weapon of the same slot). */
function autoEquipWeapon(actor: PlayerCharacter, weapon: WeaponItem): void {
	if (weapon.equipped) return; // already equipped
	// Un-equip other weapons (a character wields one weapon at a time)
	for (const item of actor.inventory) {
		if (item.category === 'weapon' && (item as WeaponItem).equipped) {
			(item as WeaponItem).equipped = false;
		}
	}
	weapon.equipped = true;
}

function getCarriedWeapons(actor: PlayerCharacter): WeaponItem[] {
	return actor.inventory.filter(
		(item): item is WeaponItem => item.category === 'weapon' && item.quantity > 0
	);
}

function normalizeActionText(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
}

function canonicalRoleToken(token: string): string {
	if (['leader', 'boss', 'chief', 'captain', 'lieutenant', 'alpha'].includes(token)) return 'leader';
	if (['caster', 'mage', 'shaman', 'warlock', 'wizard'].includes(token)) return 'caster';
	if (['archer', 'sniper', 'bowman', 'marksman'].includes(token)) return 'ranged';
	return token;
}

function actionMentionsWeapon(actionLower: string, weapon: WeaponItem): boolean {
	const aliases = new Set<string>();
	for (const source of [weapon.name, weapon.weaponName]) {
		for (const token of normalizeActionText(source).split(/\s+/)) {
			if (token.length >= 3 && token !== 'weapon') aliases.add(token);
		}
	}
	const wn = (weapon.weaponName ?? weapon.name).toLowerCase();
	if (wn.includes('crossbow')) {
		aliases.add('crossbow');
		aliases.add('bolt');
	}
	if (wn.includes('bow')) {
		aliases.add('bow');
		aliases.add('arrow');
	}
	// Add common compound-word suffixes so "sword" matches "longsword"/"shortsword",
	// "axe" matches "battleaxe"/"handaxe", etc.
	if (wn.includes('sword')) aliases.add('sword');
	if (wn.includes('axe')) aliases.add('axe');
	if (wn.includes('spear')) aliases.add('spear');
	if (wn.includes('staff')) aliases.add('staff');
	if (wn.includes('hammer')) aliases.add('hammer');
	if (wn.includes('dagger')) aliases.add('dagger');
	if (wn.includes('mace')) aliases.add('mace');
	return [...aliases].some((alias) => actionLower.includes(alias));
}

function chooseAttackWeapon(actor: PlayerCharacter, intent: ParsedTurnIntent): WeaponItem {
	const carriedWeapons = getCarriedWeapons(actor);
	if (carriedWeapons.length === 0) return buildUnarmedStrike();

	const actionLower = normalizeActionText(intent.rawAction);
	const explicitlyMentioned = carriedWeapons.find((weapon) => actionMentionsWeapon(actionLower, weapon));
	if (explicitlyMentioned) {
		autoEquipWeapon(actor, explicitlyMentioned);
		return explicitlyMentioned;
	}

	const equipped = getEquippedWeapon(actor);
	if (equipped) return equipped;

	const prefersRanged = /\b(shoot|fire|snipe|aim|loose|bolt|arrow|crossbow|bow)\b/.test(actionLower);
	if (prefersRanged) {
		const rangedWeapon = carriedWeapons.find((weapon) => weapon.properties.includes('range') || Boolean(weapon.range));
		if (rangedWeapon) {
			autoEquipWeapon(actor, rangedWeapon);
			return rangedWeapon;
		}
	}

	const prefersMelee = /\b(slash|stab|swing|cut|thrust|cleave|smash|bash)\b/.test(actionLower);
	if (prefersMelee) {
		const meleeWeapon = carriedWeapons.find((weapon) => !weapon.properties.includes('range') && !weapon.range);
		if (meleeWeapon) {
			autoEquipWeapon(actor, meleeWeapon);
			return meleeWeapon;
		}
	}

	const fallback = carriedWeapons[0] ?? buildUnarmedStrike();
	if (fallback.id) autoEquipWeapon(actor, fallback);
	return fallback;
}

function scoreEnemyReference(actionLower: string, enemyName: string): number {
	const normalizedName = normalizeActionText(enemyName).trim();
	if (!normalizedName) return 0;
	if (actionLower.includes(normalizedName)) return 100;

	const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
	let score = 0;
	for (const token of nameTokens) {
		if (!actionLower.includes(token) || token.length < 3) continue;
		const canonical = canonicalRoleToken(token);
		if (canonical !== token) {
			score += 12;
		} else if (['goblin', 'orc', 'wolf', 'bandit', 'rat', 'skeleton', 'zombie'].includes(token)) {
			score += 1;
		} else {
			score += 8;
		}
	}

	const actionTokens = actionLower.split(/\s+/).filter(Boolean).map(canonicalRoleToken);
	const enemyRoleTokens = nameTokens.map(canonicalRoleToken).filter((token) => token !== 'goblin');
	if (actionTokens.some((token) => enemyRoleTokens.includes(token))) {
		score += 12;
	}

	return score;
}

/**
 * Find the best attack target by fuzzy-matching the player's action text
 * against enemy combatant names. Falls back to the first non-defeated enemy.
 * Excludes companion NPCs (they're on the player's side).
 */
export function resolveAttackTarget(state: GameState, intent: ParsedTurnIntent): import('$lib/game/types').Combatant | null {
	const encounter = state.activeEncounter;
	if (!encounter) return null;

	// Get non-defeated enemy (non-companion) NPC combatants
	const enemies = encounter.combatants.filter(c => {
		if (c.type !== 'npc' || c.defeated) return false;
		const npc = state.npcs.find(n => n.id === c.referenceId);
		return npc && npc.role !== 'companion';
	});
	if (enemies.length === 0) return null;

	// Try to fuzzy match from player text with role/title aliases
	const actionLower = normalizeActionText(intent.rawAction);
	let bestMatch: typeof enemies[number] | null = null;
	let bestScore = 0;
	for (const enemy of enemies) {
		const score = scoreEnemyReference(actionLower, enemy.name);
		if (score > bestScore) {
			bestScore = score;
			bestMatch = enemy;
		}
	}
	if (bestMatch && bestScore > 0) return bestMatch;

	// No match — return first non-defeated enemy (default target)
	return enemies[0];
}

/**
 * Build MechanicResults from a CombatAttackResult.
 * Returns 1 result (attack roll) on miss, 2 results (attack + damage) on hit.
 */
function buildAttackMechanicResults(
	attackerName: string,
	targetName: string,
	weaponName: string,
	result: CombatAttackResult
): MechanicResult[] {
	const results: MechanicResult[] = [
		attackToMechanicResult(
			`${attackerName} attacks ${targetName} with ${weaponName}`,
			result.attackResult
		)
	];

	if (result.attackResult.hits && result.attackResult.damage) {
		results.push({
			type: 'damage',
			label: `${attackerName} deals ${result.attackResult.totalDamage} ${result.damageType} damage to ${targetName}`,
			dice: result.attackResult.damage,
			success: true
		});
	}

	return results;
}

// ---------------------------------------------------------------------------
// Sequential Combat Helpers (Phase 8e)
// ---------------------------------------------------------------------------

/**
 * Identify who controls the combatant at awaitingActorId.
 *
 * Returns the combatant + disambiguated type, or null if not found / not the
 * actor's turn.  Any connected party member may fill a companion slot.
 */
export function getActorForCombatTurn(
	state: GameState,
	encounter: ActiveEncounter,
	actorUserId: string
): { combatant: Combatant; isCompanion: boolean; character?: PlayerCharacter; npc?: NPC } | null {
	const awaitingId = encounter.awaitingActorId;
	if (!awaitingId) return null;

	const combatant = encounter.combatants.find(c => c.id === awaitingId && !c.defeated);
	if (!combatant) return null;

	if (combatant.type === 'character') {
		// PC slot — actor must be the character's own user
		const character = state.characters.find(
			c => c.id === combatant.referenceId && c.userId === actorUserId
		);
		if (!character) return null;
		return { combatant, isCompanion: false, character };
	}

	if (combatant.type === 'npc') {
		const npc = state.npcs.find(n => n.id === combatant.referenceId);
		if (!npc || npc.role !== 'companion') return null;
		// Companion — any party member may act for them
		const isPartyMember = state.characters.some(c => c.userId === actorUserId);
		if (!isPartyMember) return null;
		return { combatant, isCompanion: true, npc };
	}

	return null;
}

/**
 * Auto-advance through NPC turns after a human actor has taken their action.
 *
 * Loops over advanceTurn() until the next combatant is a human (PC or companion),
 * automatically resolving hostile NPC attacks along the way.
 *
 * Returns all NPC mechanic results + state changes plus a `roundComplete` flag
 * (true when the round number incremented, meaning the full initiative loop wrapped).
 */
/**
 * Get valid targets for hostile NPC attacks: PCs and companion NPCs that are alive.
 */
function getHostileNpcTargets(state: GameState, encounter: ActiveEncounter): Combatant[] {
	return encounter.combatants.filter(c => {
		if (c.defeated) return false;
		if (c.type === 'character') return true;
		// Include companion NPCs as valid targets
		if (c.type === 'npc') {
			const npc = state.npcs.find(n => n.id === c.referenceId);
			return npc?.role === 'companion';
		}
		return false;
	});
}

export function autoAdvancePastNpcs(
	state: GameState,
	encounter: ActiveEncounter
): { mechanicResults: MechanicResult[]; stateChanges: StateChange; roundComplete: boolean } {
	const mechanicResults: MechanicResult[] = [];
	const allHpChanges: Array<{ characterId: GameId; oldHp: number; newHp: number; reason: string }> = [];
	let encounterEnded: StateChange['encounterEnded'];
	const roundBefore = encounter.round;

	// Safety: at most initiativeOrder.length iterations to avoid infinite loops
	const maxIter = encounter.initiativeOrder.length + 1;
	let iters = 0;

	while (iters++ < maxIter) {
		const next = advanceTurn(state, encounter);
		if (!next) break;

		// Is this combatant a human actor (PC or companion)?
		if (next.type === 'character') {
			encounter.awaitingActorId = next.id;
			break;
		}
		if (next.type === 'npc') {
			const npc = state.npcs.find(n => n.id === next.referenceId);
			if (npc?.role === 'companion') {
				encounter.awaitingActorId = next.id;
				break;
			}

			// Hostile NPC — auto-resolve their attack
			if (!encounterEnded && npc?.statBlock && npc.statBlock.attacks.length > 0) {
				// Pick a target from PCs and companion NPCs (round-robin)
				const friendlyTargets = getHostileNpcTargets(state, encounter);
				if (friendlyTargets.length > 0) {
					const targetCombatant = friendlyTargets[iters % friendlyTargets.length];
					const attackResult = resolveNpcAttack(state, npc, 0, targetCombatant, encounter);
					const attackName = npc.statBlock.attacks[0].name;

					// Track where this NPC's results start so we grab exactly theirs
					const npcResultStart = mechanicResults.length;

					mechanicResults.push(
						attackToMechanicResult(
							`${npc.name} attacks ${targetCombatant.name} with ${attackName}`,
							attackResult.attackResult
						)
					);

					if (attackResult.attackResult.hits && attackResult.attackResult.damage) {
						mechanicResults.push({
							type: 'damage',
							label: `${npc.name} deals ${attackResult.attackResult.totalDamage} ${attackResult.damageType} damage to ${targetCombatant.name}`,
							dice: attackResult.attackResult.damage,
							success: true
						});
					}

					// Announce if a pre-death trait saved the target
					if (attackResult.traitSaved) {
						mechanicResults.push({
							type: 'info',
							label: `${targetCombatant.name} activates ${attackResult.traitSaved}! Drops to 1 HP instead of 0.`,
							success: true
						});
					}

					if (attackResult.damageResult) {
						allHpChanges.push({
							characterId: targetCombatant.referenceId,
							oldHp: attackResult.damageResult.previousHp,
							newHp: attackResult.damageResult.currentHp,
							reason: `${npc.name}'s ${attackName} attack`
						});
					}

					// Store in roundActions — slice from this NPC's start index
					if (!encounter.roundActions) encounter.roundActions = [];
					encounter.roundActions.push({
						combatantId: next.id,
						rawAction: `${npc.name} attacks`,
						mechanicResults: mechanicResults.slice(npcResultStart),
						stateChanges: attackResult.damageResult ? {
							hpChanges: [{
								characterId: targetCombatant.referenceId,
								oldHp: attackResult.damageResult.previousHp,
								newHp: attackResult.damageResult.currentHp,
								reason: `${npc.name}'s ${attackName} attack`
							}]
						} : {},
						timestamp: Date.now()
					});

					// Check if all PCs down → defeat
					if (allDefeated(state, encounter, 'character')) {
						encounterEnded = { outcome: 'defeat' };
						encounter.awaitingActorId = null;
						break;
					}
					// Check if all hostile NPCs down → victory
					// (can happen via reactive damage like thorns, retribution effects, etc.)
					if (allDefeated(state, encounter, 'npc')) {
						encounterEnded = { outcome: 'victory' };
						encounter.awaitingActorId = null;
						break;
					}
				}
			}
		}

		// If we just wrapped back to round start, the round is complete
		if (encounter.round > roundBefore) {
			encounter.awaitingActorId = null; // will be set on next iteration if human found
		}
	}

	const stateChanges: StateChange = {};
	if (allHpChanges && allHpChanges.length > 0) stateChanges.hpChanges = allHpChanges;
	if (encounterEnded) stateChanges.encounterEnded = encounterEnded;

	return {
		mechanicResults,
		stateChanges,
		roundComplete: encounter.round > roundBefore
	};
}

/**
 * Resolve a companion NPC's combat action.
 *
 * "auto" / "defer" / empty → engine picks best action (attack nearest enemy).
 * Named target → fuzzy match then attack.
 */
function resolveCompanionAction(
	base: ResolvedTurn,
	state: GameState,
	encounter: ActiveEncounter,
	intent: ParsedTurnIntent,
	combatant: Combatant,
	npc: NPC
): ResolvedTurn {
	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};
	const targets: TurnTarget[] = [];

	// Find target enemy  
	const enemies = encounter.combatants.filter(c => {
		if (c.type !== 'npc' || c.defeated) return false;
		const n = state.npcs.find(x => x.id === c.referenceId);
		return n && n.role !== 'companion';
	});

	if (enemies.length === 0 || !npc.statBlock || npc.statBlock.attacks.length === 0) {
		return { ...base, resolvedActionSummary: `${npc.name} waits.`, roundComplete: false };
	}

	// Choose target: try to fuzzy-match from action text, else nearest enemy
	let target = enemies[0];
	const actionLower = intent.rawAction.toLowerCase();
	if (!/\b(auto|defer|skip|wait|pass)\b/.test(actionLower)) {
		for (const enemy of enemies) {
			if (actionLower.includes(enemy.name.toLowerCase())) {
				target = enemy;
				break;
			}
			const first = enemy.name.split(/\s+/)[0].toLowerCase();
			if (first.length >= 3 && actionLower.includes(first)) {
				target = enemy;
				break;
			}
		}
	}

	const attackResult = resolveNpcAttack(state, npc, 0, target, encounter);
	const attackName = npc.statBlock.attacks[0].name;

	mechanicResults.push(
		attackToMechanicResult(
			`${npc.name} attacks ${target.name} with ${attackName}`,
			attackResult.attackResult
		)
	);

	if (attackResult.attackResult.hits && attackResult.attackResult.damage) {
		mechanicResults.push({
			type: 'damage',
			label: `${npc.name} deals ${attackResult.attackResult.totalDamage} ${attackResult.damageType} damage to ${target.name}`,
			dice: attackResult.attackResult.damage,
			success: true
		});
	}

	targets.push({ id: target.referenceId, type: 'npc', name: target.name });

	if (attackResult.damageResult) {
		stateChanges.hpChanges = [{
			characterId: target.referenceId,
			oldHp: attackResult.damageResult.previousHp,
			newHp: attackResult.damageResult.currentHp,
			reason: `${npc.name}'s ${attackName} attack`
		}];
	}

	let summary: string;
	if (attackResult.attackResult.hits) {
		summary = `${npc.name} attacked ${target.name} with ${attackName} — ${attackResult.attackResult.critical ? 'CRITICAL HIT' : 'hit'} for ${attackResult.attackResult.totalDamage} ${attackResult.damageType} damage`;
		if (attackResult.targetDefeated) summary += ' (defeated!)';
	} else {
		summary = `${npc.name} attacked ${target.name} with ${attackName} — ${attackResult.attackResult.fumble ? 'fumble!' : 'missed'}`;
	}

	// Check encounter end
	if (attackResult.targetDefeated && allDefeated(state, encounter, 'npc')) {
		stateChanges.encounterEnded = { outcome: 'victory' };
	}

	// Store in roundActions
	if (!encounter.roundActions) encounter.roundActions = [];
	encounter.roundActions.push({
		combatantId: combatant.id,
		rawAction: intent.rawAction,
		mechanicResults: [...mechanicResults],
		stateChanges: { ...stateChanges },
		timestamp: Date.now()
	});

	// Auto-advance through NPC turns (enemies etc.) unless encounter ended
	let roundComplete = false;
	if (!stateChanges.encounterEnded) {
		const advance = autoAdvancePastNpcs(state, encounter);
		mechanicResults.push(...advance.mechanicResults);
		if (advance.stateChanges.hpChanges) {
			if (!stateChanges.hpChanges) stateChanges.hpChanges = [];
			stateChanges.hpChanges.push(...advance.stateChanges.hpChanges);
		}
		if (advance.stateChanges.encounterEnded) {
			stateChanges.encounterEnded = advance.stateChanges.encounterEnded;
		}
		roundComplete = advance.roundComplete;
	}

	const updatedCharacters = syncCharacterHpFromCombatants(state);

	return {
		...base,
		status: 'ready-for-narration',
		targets,
		resolvedActionSummary: summary,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		roundComplete
	};
}

/**
 * Resolve a death saving throw.
 *
 * Validates that the actor is at 0 HP and not yet stable/dead, then calls
 * rollDeathSave() and applies the result:
 *   - critical-success / 3 successes → stable (actor.stable = true)
 *   - critical-failure / 3 failures → dead (actor.dead = true)
 *   - otherwise → increment success/failure counter on actor.deathSaves
 */
export function resolveDeathSave(
	base: ResolvedTurn,
	actor: PlayerCharacter,
	state: GameState,
	actorUserId: string
): ResolvedTurn {
	const encounter = state.activeEncounter;

	if (actor.dead || actor.stable || actor.hp > 0) {
		// Not in a death-save state — let AI narrate
		return base;
	}

	const saveResult = rollDeathSave();
	const mechanicResults: MechanicResult[] = [
		{
			type: 'saving-throw',
			label: `${actor.name} rolls a death saving throw`,
			dice: saveResult.roll,
			success: saveResult.result === 'success' || saveResult.result === 'critical-success'
		}
	];

	const stateChanges: StateChange = {
		deathSaveResult: { characterId: actor.id, result: saveResult.result }
	};

	// Mutate in-memory actor for this request cycle
	const successes = actor.deathSaves.successes;
	const failures = actor.deathSaves.failures;
	let summary: string;

	if (saveResult.result === 'critical-success') {
		// Nat 20: revive at 1 HP — clear counters, set HP
		actor.deathSaves.successes = 0;
		actor.deathSaves.failures = 0;
		actor.stable = true;
		stateChanges.hpChanges = [{
			characterId: actor.id,
			oldHp: 0,
			newHp: 1,
			reason: 'Death save natural 20 — revived!'
		}];
		// Sync combatant HP
		const combatant = encounter?.combatants.find(c => c.type === 'character' && c.referenceId === actor.id);
		if (combatant) combatant.currentHp = 1;
		summary = `${actor.name} rolled a natural 20 on their death save and regains 1 HP!`;
	} else if (saveResult.result === 'critical-failure') {
		// Nat 1: two failures
		actor.deathSaves.failures = Math.min(3, failures + 2);
		if (actor.deathSaves.failures >= 3) {
			actor.dead = true;
			stateChanges.deathSaveOutcome = { characterId: actor.id, outcome: 'dead' };
		}
		summary = `${actor.name} rolled a natural 1 — two death save failures (${actor.deathSaves.failures}/3)`;
	} else if (saveResult.result === 'success') {
		actor.deathSaves.successes = successes + 1;
		if (actor.deathSaves.successes >= 3) {
			actor.stable = true;
			actor.deathSaves.successes = 0;
			actor.deathSaves.failures = 0;
			stateChanges.deathSaveOutcome = { characterId: actor.id, outcome: 'stable' };
		}
		summary = `${actor.name} succeeds on their death save (${actor.deathSaves.successes}/3)`;
	} else {
		// failure
		actor.deathSaves.failures = failures + 1;
		if (actor.deathSaves.failures >= 3) {
			actor.dead = true;
			stateChanges.deathSaveOutcome = { characterId: actor.id, outcome: 'dead' };
		}
		summary = `${actor.name} fails their death save (${actor.deathSaves.failures}/3)`;
	}

	// Find combatant id for roundActions
	const combatantId = encounter?.combatants.find(c => c.type === 'character' && c.referenceId === actor.id)?.id ?? actor.id;

	// Store in roundActions
	if (encounter) {
		if (!encounter.roundActions) encounter.roundActions = [];
		encounter.roundActions.push({
			combatantId,
			actorUserId,
			rawAction: base.intent.rawAction,
			mechanicResults: [...mechanicResults],
			stateChanges: { ...stateChanges },
			timestamp: Date.now()
		});
	}

	// Auto-advance past NPC turns unless actor just died
	let roundComplete = false;
	if (encounter && stateChanges.deathSaveOutcome?.outcome !== 'dead') {
		const advance = autoAdvancePastNpcs(state, encounter);
		mechanicResults.push(...advance.mechanicResults);
		if (advance.stateChanges.hpChanges) {
			if (!stateChanges.hpChanges) stateChanges.hpChanges = [];
			stateChanges.hpChanges.push(...advance.stateChanges.hpChanges);
		}
		if (advance.stateChanges.encounterEnded) {
			stateChanges.encounterEnded = advance.stateChanges.encounterEnded;
		}
		roundComplete = advance.roundComplete;
	}

	const updatedCharacters = state.characters.map(c => c.id === actor.id ? { ...actor } : c);

	return {
		...base,
		status: 'ready-for-narration',
		actorId: actor.id,
		resolvedActionSummary: summary,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		roundComplete
	};
}

/**
 * Resolve a player attack action during active combat (sequential turn model — Phase 8e).
 *
 * 1. Validate actor is the awaited combatant (or backward-compat fallback).
 * 2. For companion: route to resolveCompanionAction().
 * 3. For PC: fuzzy-match target, roll attack, apply damage.
 * 4. Store action in encounter.roundActions.
 * 5. Auto-advance past NPC turns (enemies auto-act, stop at next human).
 * 6. Return roundComplete flag so adventure-turn.ts can decide whether to fire AI.
 */
function resolveCombatAttack(
	base: ResolvedTurn,
	actor: PlayerCharacter,
	state: GameState,
	intent: ParsedTurnIntent,
	actorUserId: string,
	preResolvedTargetId?: string,
	preResolvedWeaponItemId?: string
): ResolvedTurn {
	const encounter = state.activeEncounter;
	if (!encounter || encounter.status !== 'active') {
		// No active combat — let AI handle narratively
		return base;
	}

	// --- Authorization / routing ---
	// If awaitingActorId is set, validate and route.
	// If not set (e.g. old encounter / test fixture), fall through to legacy PC handling.
	if (encounter.awaitingActorId) {
		const actorInfo = getActorForCombatTurn(state, encounter, actorUserId);
		if (!actorInfo) {
			// Not this person's turn
			return {
				...base,
				resolvedActionSummary: "It's not your turn.",
				roundComplete: false
			};
		}

		if (actorInfo.isCompanion && actorInfo.npc) {
			// Route to companion handler
			return resolveCompanionAction(base, state, encounter, intent, actorInfo.combatant, actorInfo.npc);
		}

		// PC turn — fall through to normal attack resolution below
	}

	// --- PC attack resolution ---
	// 1. Find target — use pre-resolved targetId from combat classifier if available
	let target: Combatant | null = null;
	if (preResolvedTargetId) {
		// Look up by referenceId (NPC id) first, then combatant id
		target = encounter.combatants.find(c => !c.defeated && (c.referenceId === preResolvedTargetId || c.id === preResolvedTargetId)) ?? null;
	}
	if (!target) {
		target = resolveAttackTarget(state, intent);
	}
	if (!target) {
		return base;
	}

	// 2. Find weapon — use pre-resolved weaponItemId from combat classifier if available
	let weapon: WeaponItem;
	if (preResolvedWeaponItemId) {
		const found = actor.inventory.find(
			(item): item is WeaponItem => item.category === 'weapon' && item.id === preResolvedWeaponItemId
		);
		if (found) {
			autoEquipWeapon(actor, found);
			weapon = found;
		} else {
			weapon = chooseAttackWeapon(actor, intent);
		}
	} else {
		weapon = chooseAttackWeapon(actor, intent);
	}

	// 3. Resolve attack
	const result = resolveAttack(state, actor, target, weapon, encounter);

	// 4. Build mechanic results
	const mechanicResults: MechanicResult[] = buildAttackMechanicResults(
		actor.name, target.name, weapon.weaponName ?? weapon.name, result
	);

	// 5. Build state changes
	const stateChanges: StateChange = {};
	const targets: TurnTarget[] = [{ id: target.referenceId, type: 'npc', name: target.name }];

	if (result.damageResult) {
		stateChanges.hpChanges = [{
			characterId: target.referenceId,
			oldHp: result.damageResult.previousHp,
			newHp: result.damageResult.currentHp,
			reason: `${actor.name}'s ${weapon.weaponName ?? weapon.name} attack`
		}];
	}

	// Build summary
	let summary: string;
	if (result.attackResult.hits) {
		summary = `Attacked ${target.name} with ${weapon.name} — ${result.attackResult.critical ? 'CRITICAL HIT' : 'hit'} for ${result.attackResult.totalDamage} ${result.damageType} damage`;
		if (result.targetDefeated) summary += ' (defeated!)';
	} else {
		summary = `Attacked ${target.name} with ${weapon.name} — ${result.attackResult.fumble ? 'fumble!' : 'missed'}`;
	}

	// Check if all enemies defeated → auto-end encounter
	if (result.targetDefeated && allDefeated(state, encounter, 'npc')) {
		stateChanges.encounterEnded = { outcome: 'victory' };
	}

	// 6. Store PC action in roundActions
	if (!encounter.roundActions) encounter.roundActions = [];
	encounter.roundActions.push({
		combatantId: encounter.awaitingActorId ?? (encounter.combatants.find(c => c.type === 'character' && c.referenceId === actor.id)?.id ?? actor.id),
		actorUserId,
		rawAction: intent.rawAction,
		mechanicResults: [...mechanicResults],
		stateChanges: { ...(stateChanges.hpChanges ? { hpChanges: stateChanges.hpChanges } : {}) },
		timestamp: Date.now()
	});

	// 7. Auto-advance past NPC turns (enemies retaliate, stop at next PC/companion)
	let roundComplete = false;
	if (!stateChanges.encounterEnded) {
		const advance = autoAdvancePastNpcs(state, encounter);
		mechanicResults.push(...advance.mechanicResults);

		if (advance.stateChanges.hpChanges) {
			if (!stateChanges.hpChanges) stateChanges.hpChanges = [];
			stateChanges.hpChanges.push(...advance.stateChanges.hpChanges);
		}
		if (advance.stateChanges.encounterEnded) {
			stateChanges.encounterEnded = advance.stateChanges.encounterEnded;
		}
		roundComplete = advance.roundComplete;

		if (!stateChanges.encounterEnded) {
			summary += ` | Enemies retaliate`;
		}
	}

	// 8. Sync PC HP from combatants back to characters
	const updatedCharacters = syncCharacterHpFromCombatants(state);

	return {
		...base,
		status: 'ready-for-narration',
		targets,
		resolvedActionSummary: summary,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		roundComplete
	};
}

// ---------------------------------------------------------------------------
// Enemy Turn Resolution (Phase 8d)
// ---------------------------------------------------------------------------

/**
 * Resolve all enemy NPC attacks in the current round.
 *
 * Each non-defeated enemy combatant attacks a PC using their first attack
 * from their stat block. Targets are distributed across PCs to avoid
 * all enemies focusing the same character.
 *
 * @returns Mechanic results for all enemy attacks and any HP changes.
 */
export function resolveEnemyTurns(
	state: GameState,
	encounter: import('$lib/game/types').ActiveEncounter
): { mechanicResults: MechanicResult[]; stateChanges: StateChange } {
	const mechanicResults: MechanicResult[] = [];
	const hpChanges: Array<{ characterId: GameId; oldHp: number; newHp: number; reason: string }> = [];

	// Get living enemy (non-companion) NPC combatants
	const enemies = encounter.combatants.filter(c => {
		if (c.type !== 'npc' || c.defeated) return false;
		const npc = state.npcs.find(n => n.id === c.referenceId);
		return npc && npc.role !== 'companion';
	});

	// Get living PC combatants and companion NPCs as potential targets
	const friendlyTargets = getHostileNpcTargets(state, encounter);
	if (friendlyTargets.length === 0 || enemies.length === 0) {
		return { mechanicResults, stateChanges: {} };
	}

	for (let i = 0; i < enemies.length; i++) {
		const enemyCombatant = enemies[i];
		const npc = state.npcs.find(n => n.id === enemyCombatant.referenceId);
		if (!npc?.statBlock || npc.statBlock.attacks.length === 0) continue;

		// Distribute targets across friendlies (round-robin)
		const targetIndex = i % friendlyTargets.length;
		const selectedTarget = friendlyTargets[targetIndex];

		// Use first attack from stat block
		const attackResult = resolveNpcAttack(state, npc, 0, selectedTarget, encounter);

		// Build mechanic results
		const attackName = npc.statBlock.attacks[0].name;
		mechanicResults.push(
			attackToMechanicResult(
				`${npc.name} attacks ${selectedTarget.name} with ${attackName}`,
				attackResult.attackResult
			)
		);

		if (attackResult.attackResult.hits && attackResult.attackResult.damage) {
			mechanicResults.push({
				type: 'damage',
				label: `${npc.name} deals ${attackResult.attackResult.totalDamage} ${attackResult.damageType} damage to ${selectedTarget.name}`,
				dice: attackResult.attackResult.damage,
				success: true
			});

			// Announce if a pre-death trait saved the target
			if (attackResult.traitSaved) {
				mechanicResults.push({
					type: 'info',
					label: `${selectedTarget.name} activates ${attackResult.traitSaved}! Drops to 1 HP instead of 0.`,
					success: true
				});
			}

			// Track HP change for the PC target
			if (attackResult.damageResult) {
				hpChanges.push({
					characterId: selectedTarget.referenceId,
					oldHp: attackResult.damageResult.previousHp,
					newHp: attackResult.damageResult.currentHp,
					reason: `${npc.name}'s ${attackName} attack`
				});
			}
		}
	}

	const stateChanges: StateChange = {};
	if (hpChanges.length > 0) stateChanges.hpChanges = hpChanges;

	// Check if all PCs defeated
	if (allDefeated(state, encounter, 'character')) {
		stateChanges.encounterEnded = { outcome: 'defeat' };
	}

	return { mechanicResults, stateChanges };
}

/**
 * Sync PC HP from encounter combatants back to state characters.
 * After combat mutations, the combatant objects have updated HP values
 * that need to be reflected in the character objects.
 */
function syncCharacterHpFromCombatants(state: GameState): PlayerCharacter[] {
	const encounter = state.activeEncounter;
	if (!encounter) return [...state.characters];

	return state.characters.map(char => {
		const combatant = encounter.combatants.find(
			c => c.type === 'character' && c.referenceId === char.id
		);
		if (combatant && combatant.currentHp !== char.hp) {
			return { ...char, hp: Math.max(0, combatant.currentHp) };
		}
		return char;
	});
}

// ---------------------------------------------------------------------------
// Use-Item Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a use-item action by identifying the target item from action text
 * and calling the inventory engine.
 */
function resolveUseItem(base: ResolvedTurn, actor: PlayerCharacter, state: GameState): ResolvedTurn {
	const lower = base.intent.rawAction.toLowerCase();
	const consumables = actor.inventory.filter(
		(i) => i.category === 'consumable' && ('charges' in i ? (i as { charges: number }).charges > 0 : true)
	);

	if (consumables.length === 0) return base; // no consumables — let AI narrate "you have nothing"

	// Try to match a specific item name from the action text
	const match = findBestItemMatch(lower, consumables);

	if (!match && consumables.length === 1) {
		// Only one consumable — use it implicitly
		return executeUseConsumable(base, actor, state, consumables[0]);
	}

	if (!match) {
		// Multiple consumables but no clear match — clarify
		return {
			...base,
			status: 'needs-clarification',
			clarification: {
				reason: 'ambiguous-item',
				question: `Which item do you want to use? (${consumables.map((i) => i.name).join(', ')})`,
				options: consumables.map((i) => i.name)
			}
		};
	}

	return executeUseConsumable(base, actor, state, match);
}

function executeUseConsumable(base: ResolvedTurn, actor: PlayerCharacter, state: GameState, item: Item): ResolvedTurn {
	const result = useConsumable(actor, item.id);
	if (!result.success) {
		// Engine rejected — let AI narrate the failure reason
		return base;
	}

	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};
	const targets: TurnTarget[] = [{ id: item.id, type: 'item', name: item.name }];
	const resourcesConsumed: ConsumedResource[] = [{ type: 'item', label: item.name, amount: 1 }];

	if (result.healing !== undefined && result.healing > 0) {
		mechanicResults.push({
			type: 'healing',
			label: `${item.name} healed ${result.healing} HP`,
			dice: { notation: item.name, rolls: [result.healing], total: result.healing }
		});
		stateChanges.hpChanges = [{
			characterId: actor.id,
			oldHp: actor.hp,
			newHp: result.character.hp,
			reason: `Used ${item.name}`
		}];
		targets.push({ id: actor.id, type: 'character', name: actor.name });
	}

	if (result.itemRemoved) {
		stateChanges.itemsLost = [{ characterId: actor.id, itemId: item.id, quantity: 1 }];
	}

	// Replace actor in the characters array with updated version
	const updatedCharacters = state.characters.map((c) =>
		c.id === actor.id ? result.character : c
	);

	return {
		...base,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		targets,
		resourcesConsumed,
		resolvedActionSummary: `Used ${item.name}${result.healing ? ` (healed ${result.healing} HP)` : ''}`
	};
}

// ---------------------------------------------------------------------------
// Rest Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a rest action. Detects long vs short rest from action text,
 * then calls the appropriate engine function.
 */
function resolveRest(
	base: ResolvedTurn,
	actor: PlayerCharacter,
	state: GameState,
	intent: ParsedTurnIntent
): ResolvedTurn {
	const lower = intent.rawAction.toLowerCase();
	const isLongRest = /\b(long rest|full rest|sleep|camp for the night|make camp|camp out)\b/.test(lower);
	const isShortRest = /\b(short rest|brief rest|catch my breath|take a breather)\b/.test(lower);

	// If just "rest" or "wait", decide based on time keywords
	const isWaitAction = intent.mentionsWait && !isLongRest && !isShortRest;

	if (isWaitAction) {
		return resolveWait(base, state, intent);
	}

	// Default to short rest if not clearly long
	if (isLongRest) {
		return executeLongRest(base, actor, state);
	}

	return executeShortRest(base, actor, state);
}

function executeShortRest(base: ResolvedTurn, actor: PlayerCharacter, state: GameState): ResolvedTurn {
	// Auto-spend up to half available hit dice for short rest
	const availableDice = actor.classes.reduce((sum, c) => sum + c.hitDiceRemaining, 0);
	const hpDeficit = actor.maxHp - actor.hp;
	const diceToSpend = hpDeficit > 0 ? Math.min(Math.ceil(availableDice / 2), availableDice) : 0;

	const result = shortRest(actor, diceToSpend);
	if (!result.success) return base;

	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};
	const resourcesConsumed: ConsumedResource[] = [];

	if (result.totalHealing > 0) {
		mechanicResults.push({
			type: 'healing',
			label: `Short rest healed ${result.totalHealing} HP (spent ${result.hitDiceResults.length} hit dice)`,
			dice: { notation: `${result.hitDiceResults.length} hit dice`, rolls: result.hitDiceResults.map((r) => r.rolled), total: result.totalHealing }
		});
		stateChanges.hpChanges = [{
			characterId: actor.id,
			oldHp: result.previousHp,
			newHp: result.currentHp,
			reason: 'Short rest'
		}];
	}

	if (result.hitDiceResults.length > 0) {
		stateChanges.hitDiceUsed = { characterId: actor.id, amount: result.hitDiceResults.length };
		resourcesConsumed.push({ type: 'hit-dice', label: 'Hit dice', amount: result.hitDiceResults.length });
	}

	// Advance clock by 2 periods (1 hour ≈ 2 time periods in our system)
	const clockFrom = { ...state.clock };
	const clockTo = advanceClock(state.clock, 2);
	stateChanges.clockAdvance = { from: clockFrom, to: clockTo };

	const updatedCharacters = state.characters.map((c) =>
		c.id === actor.id ? result.character : c
	);

	return {
		...base,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		resourcesConsumed,
		resolvedActionSummary: `Short rest${result.hitDiceResults.length > 0 ? ` (spent ${result.hitDiceResults.length} hit dice, healed ${result.totalHealing} HP)` : ''}`
	};
}

function executeLongRest(base: ResolvedTurn, actor: PlayerCharacter, state: GameState): ResolvedTurn {
	const result = longRest(actor);
	if (!result.success) return base;

	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};

	if (result.hpHealed > 0) {
		mechanicResults.push({
			type: 'healing',
			label: `Long rest restored ${result.hpHealed} HP to full`,
			dice: { notation: 'long rest', rolls: [result.hpHealed], total: result.hpHealed }
		});
		stateChanges.hpChanges = [{
			characterId: actor.id,
			oldHp: result.previousHp,
			newHp: result.currentHp,
			reason: 'Long rest'
		}];
	}

	if (result.hitDiceRecovered > 0) {
		stateChanges.hitDiceUsed = { characterId: actor.id, amount: -result.hitDiceRecovered };
	}

	if (result.spellSlotsRestored.length > 0) {
		mechanicResults.push({
			type: 'other',
			label: `Spell slots restored: ${result.spellSlotsRestored.map((s) => `level ${s.level} (${s.restored})`).join(', ')}`,
			dice: { notation: 'long rest', rolls: [], total: 0 }
		});
	}

	if (result.conditionsRemoved.length > 0) {
		stateChanges.conditionsApplied = result.conditionsRemoved.map((c) => ({
			characterId: actor.id,
			condition: c,
			applied: false
		}));
	}

	if (result.deathSavesReset) {
		stateChanges.deathSaveResult = { characterId: actor.id, result: 'critical-success' };
	}

	// Advance clock by 8 periods (long rest ≈ 8 hours)
	const clockFrom = { ...state.clock };
	const clockTo = advanceClock(state.clock, 8);
	stateChanges.clockAdvance = { from: clockFrom, to: clockTo };

	// Long rest all party members (not just the actor)
	const updatedCharacters = state.characters.map((c) => {
		if (c.id === actor.id) return result.character;
		if (!c.dead) {
			const otherResult = longRest(c);
			return otherResult.success ? otherResult.character : c;
		}
		return c;
	});

	return {
		...base,
		mechanicResults,
		stateChanges,
		updatedCharacters,
		resolvedActionSummary: `Long rest (healed ${result.hpHealed} HP, restored ${result.hitDiceRecovered} hit dice${result.spellSlotsRestored.length > 0 ? ', spell slots restored' : ''})`
	};
}

function resolveWait(base: ResolvedTurn, state: GameState, intent: ParsedTurnIntent): ResolvedTurn {
	const lower = intent.rawAction.toLowerCase();
	// Actual time cycle from travel.ts: ['dawn', 'morning', 'afternoon', 'dusk', 'night'] (5 periods)
	const CYCLE = ['dawn', 'morning', 'afternoon', 'dusk', 'night'] as const;
	const CYCLE_LEN = CYCLE.length;
	const currentIndex = CYCLE.indexOf(state.clock.timeOfDay as typeof CYCLE[number]);

	// Default 1 period unless "until nightfall" / "until morning" etc.
	let periods = 1;
	if (/until\s+(nightfall|night|evening|dusk)/.test(lower)) {
		const targetIndex = CYCLE.indexOf('dusk');
		periods = targetIndex > currentIndex ? targetIndex - currentIndex : (CYCLE_LEN - currentIndex + targetIndex);
		if (periods <= 0) periods = CYCLE_LEN;
	} else if (/until\s+(morning|dawn|sunrise)/.test(lower)) {
		const targetIndex = CYCLE.indexOf('dawn');
		periods = targetIndex > currentIndex ? targetIndex - currentIndex : (CYCLE_LEN - currentIndex + targetIndex);
		if (periods <= 0) periods = CYCLE_LEN;
	} else if (/\b(\d+)\s*hours?\b/.test(lower)) {
		const match = lower.match(/\b(\d+)\s*hours?\b/);
		// Each period ≈ ~5 hours (24h / 5 periods)
		if (match) periods = Math.max(1, Math.min(24, Math.ceil(parseInt(match[1], 10) / 5)));
	}

	const clockFrom = { ...state.clock };
	const clockTo = advanceClock(state.clock, periods);

	return {
		...base,
		mechanicResults: [{
			type: 'other',
			label: `Waited ${periods} period(s): ${clockFrom.timeOfDay} → ${clockTo.timeOfDay}, day ${clockFrom.day} → ${clockTo.day}`,
			dice: { notation: 'wait', rolls: [], total: periods }
		}],
		stateChanges: {
			clockAdvance: { from: clockFrom, to: clockTo }
		},
		resolvedActionSummary: `Waited ${periods} period(s) (${clockFrom.timeOfDay} → ${clockTo.timeOfDay})`
	};
}

// ---------------------------------------------------------------------------
// Travel Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a move/travel action. Tries to match the destination from
 * the action text against known connected locations.
 */
function resolveTravel(
	base: ResolvedTurn,
	_actor: PlayerCharacter,
	state: GameState,
	intent: ParsedTurnIntent
): ResolvedTurn {
	if (!state.partyLocationId) return base; // no location system yet

	const currentLoc = findLocation(state, state.partyLocationId);
	if (!currentLoc) return base;

	const exits = getAvailableExits(state);
	if (exits.length === 0) return base; // no exits — AI will narrate "you can't go that way"

	// Try to match destination name from action text
	const lower = intent.rawAction.toLowerCase();
	const matchedExits = exits.filter((exit) => {
		const exitLower = exit.name.toLowerCase();
		// Check if any significant word from the exit name appears in the action
		const words = exitLower.split(/\s+/).filter((w) => w.length > 2);
		return words.some((word) => lower.includes(word)) || lower.includes(exitLower);
	});

	if (matchedExits.length === 0) {
		// Check for directional keywords that might not match any exit name
		// Let AI handle — it may generate a new location or describe "nothing that way"
		return base;
	}

	if (matchedExits.length > 1) {
		return {
			...base,
			status: 'needs-clarification',
			clarification: {
				reason: 'ambiguous-destination',
				question: `Multiple destinations match. Where do you want to go? (${matchedExits.map((e) => e.name).join(', ')})`,
				options: matchedExits.map((e) => e.name)
			}
		};
	}

	// Exactly one match — execute travel
	const destination = matchedExits[0];
	const travelResult = travelBetween(state, state.partyLocationId, destination.locationId);

	if (!travelResult.success) {
		// Travel engine rejected — let AI narrate
		return base;
	}

	const mechanicResults: MechanicResult[] = [{
		type: 'other',
		label: `Traveled to ${destination.name} (${travelResult.periodsElapsed} period(s))`,
		dice: { notation: 'travel', rolls: [travelResult.periodsElapsed], total: travelResult.periodsElapsed }
	}];

	const stateChanges: StateChange = { ...travelResult.stateChanges };

	if (travelResult.encounter?.triggered) {
		mechanicResults.push({
			type: 'other',
			label: `Random encounter! (rolled ${travelResult.encounter.roll} vs threshold ${travelResult.encounter.threshold})`,
			dice: { notation: '1d100', rolls: [travelResult.encounter.roll], total: travelResult.encounter.roll }
		});
		if (travelResult.encounter.template) {
			stateChanges.encounterStarted = { creatures: [] }; // encounter template — AI will populate
		}
	}

	return {
		...base,
		mechanicResults,
		stateChanges,
		targets: [{ id: destination.locationId, type: 'location', name: destination.name }],
		resolvedActionSummary: `Traveled to ${destination.name} (${travelResult.periodsElapsed} period(s))`
	};
}

// ---------------------------------------------------------------------------
// Cast Spell Resolver
// ---------------------------------------------------------------------------

/**
 * Normalize a spell name from natural language to slug format.
 * "Cure Wounds" → "cure-wounds", "shield" → "shield"
 */
function normalizeSpellNameForLookup(name: string): string {
	return name.trim().toLowerCase().replace(/['']/g, '').replace(/\s+/g, '-');
}

/**
 * Try to find the spell the player is casting from their action text.
 */
function findSpellInAction(action: string, actor: PlayerCharacter): string | null {
	const lower = action.toLowerCase();

	// Collect all spells the character has access to
	const allSpells = Array.from(new Set([
		...getAllKnownSpells(actor),
		...getAllPreparedSpells(actor),
		...getAllCantrips(actor)
	]));

	// Try to match longest spell name first (to avoid "cure" matching before "cure-wounds")
	const displayNames: Array<{ slug: string; display: string }> = [];
	for (const slug of allSpells) {
		const spell = getSpell(slug);
		if (spell) {
			displayNames.push({ slug, display: spell.displayName.toLowerCase() });
		}
		// Also try matching the slug with spaces
		displayNames.push({ slug, display: slug.replace(/-/g, ' ') });
	}
	displayNames.sort((a, b) => b.display.length - a.display.length);

	for (const { slug, display } of displayNames) {
		if (lower.includes(display)) return slug;
	}

	// Also try raw words → slug conversion
	// "I cast cure wounds" → "cure-wounds"
	const castMatch = lower.match(/cast\s+(.+?)(?:\s+(?:on|at|against|toward|into)\b|$)/);
	if (castMatch) {
		const candidate = normalizeSpellNameForLookup(castMatch[1]);
		if (allSpells.includes(candidate)) return candidate;
		// Try with the spell data
		const spell = getSpell(candidate);
		if (spell && allSpells.includes(spell.name)) return spell.name;
	}

	return null;
}

/**
 * Resolve a cast-spell action. Identifies the spell from action text
 * and calls the spellcasting engine.
 */
function resolveCastSpell(
	base: ResolvedTurn,
	actor: PlayerCharacter,
	state: GameState,
	intent: ParsedTurnIntent
): ResolvedTurn {
	const spellName = findSpellInAction(intent.rawAction, actor);

	if (!spellName) {
		// Could not identify spell — let AI interpret
		return base;
	}

	// Check if the character can cast it
	const canCast = canCastSpell(actor, spellName);
	if (!canCast.canCast) {
		// Engine says no — let AI narrate the failure
		return base;
	}

	// Clone actor so engine mutations don't affect original before we commit
	const castActor = JSON.parse(JSON.stringify(actor)) as PlayerCharacter;

	try {
		const result = castSpell(castActor, spellName, canCast.slotToUse);
		const mechanicResults: MechanicResult[] = [];
		const stateChanges: StateChange = { ...result.stateChange };

		if (result.damage) {
			mechanicResults.push({
				type: 'damage',
				label: `${result.spell.displayName} deals ${result.damage.total} damage`,
				dice: result.damage,
				dc: result.saveDC ?? undefined,
				success: undefined // target's save not resolved yet — AI will narrate
			});
		}

		if (result.healing) {
			mechanicResults.push({
				type: 'healing',
				label: `${result.spell.displayName} heals ${result.healing.total} HP`,
				dice: result.healing
			});
		}

		if (!result.damage && !result.healing) {
			mechanicResults.push({
				type: 'other',
				label: `Cast ${result.spell.displayName}${result.slotUsed ? ` (level ${result.slotUsed} slot)` : ''}${result.concentrationStarted ? ' [concentration]' : ''}`,
				dice: { notation: result.spell.displayName, rolls: [], total: 0 }
			});
		}

		if (result.concentrationDropped) {
			mechanicResults.push({
				type: 'other',
				label: `Dropped concentration on ${result.concentrationDropped}`,
				dice: { notation: 'concentration', rolls: [], total: 0 }
			});
		}

		const updatedCharacters = state.characters.map((c) =>
			c.id === actor.id ? castActor : c
		);

		const targets: TurnTarget[] = [{ id: spellName, type: 'spell', name: result.spell.displayName }];
		const resourcesConsumed: ConsumedResource[] = [];
		if (result.slotUsed) {
			resourcesConsumed.push({ type: 'spell-slot', label: `Level ${result.slotUsed} spell slot`, amount: 1 });
		}

		return {
			...base,
			mechanicResults,
			stateChanges,
			updatedCharacters,
			targets,
			resourcesConsumed,
			resolvedActionSummary: `Cast ${result.spell.displayName}${result.slotUsed ? ` (level ${result.slotUsed} slot)` : ''}${result.concentrationStarted ? ' [concentration]' : ''}`
		};
	} catch {
		// castSpell threw (shouldn't happen after canCastSpell check, but be safe)
		return base;
	}
}

// ---------------------------------------------------------------------------
// Item matching helpers
// ---------------------------------------------------------------------------

/**
 * Find the best matching item from the player's action text.
 * Returns null if no reasonable match is found.
 */
function findBestItemMatch(actionLower: string, items: Item[]): Item | null {
	// Try exact name match first (longest first to avoid partial matches)
	const sorted = [...items].sort((a, b) => b.name.length - a.name.length);
	for (const item of sorted) {
		if (actionLower.includes(item.name.toLowerCase())) return item;
	}

	// Try matching significant words from item names
	for (const item of sorted) {
		const words = item.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
		if (words.length > 0 && words.every((word) => actionLower.includes(word))) return item;
	}

	return null;
}
