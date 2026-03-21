/**
 * Project Zeus — Combat Engine
 *
 * Initiative, turn order, attack resolution, encounter lifecycle.
 * All functions are pure (no DB, no side effects) and deterministic when
 * used with a seeded PRNG from mechanics.ts.
 *
 * Phase B of the Content-Complete Push.
 */

import type {
	AbilityName,
	ActiveEncounter,
	Combatant,
	CombatantType,
	Condition,
	CreatureStatBlock,
	DiceResult,
	EncounterOutcome,
	GameId,
	GameState,
	NPC,
	PlayerCharacter,
	StateChange,
	WeaponItem
} from './types';
import {
	abilityModifier,
	applyDamage,
	attackRoll,
	resolveRollModifiers,
	roll,
	rollD20,
	rollDie,
	type AdvantageState,
	type AttackResult,
	type DamageApplicationResult
} from './mechanics';
import { XP_BY_CR } from './data/monsters';
import { DEFAULT_CONDITION_EFFECTS } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Action economy budget for a single combatant's turn. */
export interface TurnBudget {
	action: boolean;
	bonusAction: boolean;
	reaction: boolean;
	movement: number;
}

/** Result of the initiative roll for one participant. */
export interface InitiativeEntry {
	id: GameId;
	referenceId: GameId;
	type: CombatantType;
	name: string;
	initiative: number;
	dexMod: number;
}

/** Full result returned by resolveAttack. */
export interface CombatAttackResult {
	attackResult: AttackResult;
	damageResult: DamageApplicationResult | null;
	targetDefeated: boolean;
	attackerAdvantageReason: string[];
	damageType: string;
}

/** Result of encounter resolution. */
export interface EncounterResolutionResult {
	outcome: EncounterOutcome;
	xpPerCharacter: number;
	totalXp: number;
	stateChange: StateChange;
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

/**
 * Roll initiative for an array of PCs and NPCs.
 *
 * Returns a sorted array of InitiativeEntry objects (highest first).
 * Tiebreaker: higher DEX mod wins. If still tied, random die roll.
 */
export function rollInitiative(
	characters: PlayerCharacter[],
	npcs: NPC[]
): InitiativeEntry[] {
	const entries: InitiativeEntry[] = [];

	for (const pc of characters) {
		const dexMod = abilityModifier(pc.abilities.dex);
		const initRoll = rollDie(20);
		entries.push({
			id: pc.id,
			referenceId: pc.id,
			type: 'character',
			name: pc.name,
			initiative: initRoll + dexMod,
			dexMod
		});
	}

	for (const npc of npcs) {
		if (!npc.statBlock || !npc.alive) continue;
		const dexMod = abilityModifier(npc.statBlock.abilities.dex);
		const initRoll = rollDie(20);
		entries.push({
			id: npc.id,
			referenceId: npc.id,
			type: 'npc',
			name: npc.name,
			initiative: initRoll + dexMod,
			dexMod
		});
	}

	// Sort descending by initiative; tiebreak by DEX mod, then random
	entries.sort((a, b) => {
		if (b.initiative !== a.initiative) return b.initiative - a.initiative;
		if (b.dexMod !== a.dexMod) return b.dexMod - a.dexMod;
		// Final tiebreak: random
		return rollDie(2) === 1 ? -1 : 1;
	});

	return entries;
}

// ---------------------------------------------------------------------------
// Encounter Creation
// ---------------------------------------------------------------------------

/**
 * Create an ActiveEncounter from the current game state and hostile NPCs.
 *
 * Rolls initiative for all PCs + creatures, builds sorted initiative order,
 * and returns a new encounter object plus a StateChange.
 */
export function createEncounter(
	state: GameState,
	creatures: NPC[]
): { encounter: ActiveEncounter; stateChange: StateChange } {
	const initEntries = rollInitiative(state.characters, creatures);

	const combatants: Combatant[] = initEntries.map(entry => {
		if (entry.type === 'character') {
			const pc = state.characters.find(c => c.id === entry.referenceId)!;
			return {
				id: entry.id,
				referenceId: entry.referenceId,
				type: 'character' as CombatantType,
				name: entry.name,
				initiative: entry.initiative,
				currentHp: pc.hp,
				maxHp: pc.maxHp,
				tempHp: pc.tempHp,
				ac: pc.ac,
				conditions: [...pc.conditions],
				resistances: [...pc.resistances],
				immunities: [],
				vulnerabilities: [],
				concentration: false,
				defeated: false
			};
		} else {
			const npc = creatures.find(c => c.id === entry.referenceId)!;
			const sb = npc.statBlock!;
			return {
				id: entry.id,
				referenceId: entry.referenceId,
				type: 'npc' as CombatantType,
				name: entry.name,
				initiative: entry.initiative,
				currentHp: sb.hp,
				maxHp: sb.maxHp,
				tempHp: 0,
				ac: sb.ac,
				conditions: [],
				resistances: [...sb.resistances],
				immunities: [...sb.immunities],
				vulnerabilities: [...sb.vulnerabilities],
				concentration: false,
				defeated: false
			};
		}
	});

	const encounterId = `enc-${Date.now()}`;

	const encounter: ActiveEncounter = {
		id: encounterId,
		round: 1,
		turnIndex: 0,
		initiativeOrder: combatants.map(c => c.id),
		combatants,
		status: 'active',
		startedAt: Date.now()
	};

	const stateChange: StateChange = {
		encounterStarted: { creatures }
	};

	return { encounter, stateChange };
}

// ---------------------------------------------------------------------------
// Turn Management
// ---------------------------------------------------------------------------

/**
 * Get the combatant whose turn it currently is.
 */
export function getCurrentCombatant(encounter: ActiveEncounter): Combatant | null {
	if (encounter.status !== 'active') return null;
	const id = encounter.initiativeOrder[encounter.turnIndex];
	return encounter.combatants.find(c => c.id === id) ?? null;
}

/**
 * Set awaitingActorId on a newly-created encounter to the first human-controlled
 * combatant (character or companion NPC) in initiative order, skipping hostile NPCs.
 * Call this once after createEncounter() to bootstrap the sequential turn model.
 *
 * Returns the combatant ID that should act first, or null if no human combatants exist.
 */
export function initEncounterTurnOrder(
	encounter: ActiveEncounter,
	npcs: NPC[]
): GameId | null {
	// Walk the initiative order from the start, looking for the first human actor.
	// If hostile NPCs appear before any human, we skip them — they'll be
	// auto-resolved the first time a human submits an action.
	for (const combatantId of encounter.initiativeOrder) {
		const combatant = encounter.combatants.find(c => c.id === combatantId);
		if (!combatant || combatant.defeated) continue;

		if (combatant.type === 'character') {
			encounter.awaitingActorId = combatantId;
			return combatantId;
		}

		// Companion NPCs are human-controlled
		const npc = npcs.find(n => n.id === combatant.referenceId);
		if (npc && npc.role === 'companion') {
			encounter.awaitingActorId = combatantId;
			return combatantId;
		}
	}

	encounter.awaitingActorId = null;
	return null;
}

/**
 * Advance to the next active (non-defeated) combatant's turn.
 *
 * Returns the new current combatant, or null if no active combatants remain.
 * Mutates the encounter's round and turnIndex in-place.
 */
export function advanceTurn(encounter: ActiveEncounter): Combatant | null {
	if (encounter.status !== 'active') return null;

	const count = encounter.initiativeOrder.length;
	if (count === 0) return null;

	// Try to find the next non-defeated combatant, wrapping at most once
	let checked = 0;
	while (checked < count) {
		encounter.turnIndex++;
		if (encounter.turnIndex >= count) {
			encounter.turnIndex = 0;
			encounter.round++;
		}
		checked++;

		const current = getCurrentCombatant(encounter);
		if (current && !current.defeated) {
			return current;
		}
	}

	// All combatants defeated — shouldn't happen in normal play
	return null;
}

// ---------------------------------------------------------------------------
// Attack Resolution
// ---------------------------------------------------------------------------

/**
 * Determine which conditions on the TARGET grant advantage to the attacker.
 * Per 5e rules:
 *   - Paralyzed, stunned, unconscious, restrained → attacks have advantage
 *   - Prone → melee attacks have advantage (we assume melee for simplicity)
 *   - Invisible target → attacks have disadvantage
 */
function getTargetConditionAdvantage(targetConditions: Condition[]): {
	advantage: boolean;
	disadvantage: boolean;
	reasons: string[];
} {
	let advantage = false;
	let disadvantage = false;
	const reasons: string[] = [];

	for (const cond of targetConditions) {
		switch (cond) {
			case 'paralyzed':
			case 'stunned':
			case 'unconscious':
				advantage = true;
				reasons.push(`target is ${cond}`);
				break;
			case 'restrained':
				advantage = true;
				reasons.push('target is restrained');
				break;
			case 'prone':
				// Melee attacks have advantage, ranged have disadvantage.
				// We'll assume melee for now; callers can override.
				advantage = true;
				reasons.push('target is prone (melee)');
				break;
			case 'invisible':
				disadvantage = true;
				reasons.push('target is invisible');
				break;
		}
	}

	return { advantage, disadvantage, reasons };
}

/**
 * Determine the attack ability for a weapon.
 *
 * - Ranged weapons use DEX.
 * - Melee weapons use STR.
 * - Finesse weapons use the higher of STR or DEX.
 */
function resolveAttackAbility(
	weapon: WeaponItem,
	attackerAbilities: { str: number; dex: number }
): AbilityName {
	const isRanged = weapon.properties?.includes('ammunition') ||
	                 weapon.properties?.includes('range') && !weapon.properties?.includes('thrown');

	if (isRanged) return 'dex';

	const isFinesse = weapon.properties?.includes('finesse');
	if (isFinesse) {
		return abilityModifier(attackerAbilities.dex) >= abilityModifier(attackerAbilities.str)
			? 'dex' : 'str';
	}

	return 'str';
}

/**
 * Merge attacker's condition advantage with target's condition advantage.
 * Returns the final AdvantageState after cancellation.
 */
function combineCombatAdvantage(
	attackerConditionAdv: AdvantageState,
	targetAdvantageForAttacker: boolean,
	targetDisadvantageForAttacker: boolean
): AdvantageState {
	let hasAdvantage = attackerConditionAdv === 'advantage' || targetAdvantageForAttacker;
	let hasDisadvantage = attackerConditionAdv === 'disadvantage' || targetDisadvantageForAttacker;

	if (hasAdvantage && hasDisadvantage) return 'normal';
	if (hasAdvantage) return 'advantage';
	if (hasDisadvantage) return 'disadvantage';
	return 'normal';
}

/**
 * Resolve a full attack in combat.
 *
 * Determines ability (STR vs DEX for finesse), checks conditions on both
 * attacker and target for advantage/disadvantage, rolls the attack, and
 * applies damage on hit (with damage type awareness).
 *
 * @param attacker     The attacking combatant's source character or stat block.
 * @param target       The target combatant.
 * @param weapon       The weapon being used.
 * @param encounter    The active encounter (for looking up combatants).
 * @param overrideAdv  Explicit advantage override (e.g., from features).
 */
export function resolveAttack(
	attacker: PlayerCharacter,
	target: Combatant,
	weapon: WeaponItem,
	encounter: ActiveEncounter,
	overrideAdv?: AdvantageState
): CombatAttackResult {
	const reasons: string[] = [];

	// Determine attack ability
	const useAbility = resolveAttackAbility(weapon, attacker.abilities);

	// Note attacker's condition-based advantage for reporting purposes.
	// (attackRoll handles this internally — we just record reasons.)
	const attackerMods = resolveRollModifiers(attacker.conditions, 'attack', useAbility);
	if (attackerMods.resolvedAdvantage === 'advantage') reasons.push('attacker condition advantage');
	if (attackerMods.resolvedAdvantage === 'disadvantage') reasons.push('attacker condition disadvantage');

	// Get target's condition-based advantage for the attacker
	const targetMods = getTargetConditionAdvantage(target.conditions);
	reasons.push(...targetMods.reasons);

	// Build the target-derived advantage state to pass as override to attackRoll.
	// attackRoll already processes attacker conditions internally, so we only
	// pass target-derived and explicit overrides here to avoid double-counting.
	let targetAdv: AdvantageState = 'normal';
	if (targetMods.advantage && targetMods.disadvantage) {
		targetAdv = 'normal'; // cancel
	} else if (targetMods.advantage) {
		targetAdv = 'advantage';
	} else if (targetMods.disadvantage) {
		targetAdv = 'disadvantage';
	}

	// Merge target advantage with explicit caller override
	if (overrideAdv && overrideAdv !== 'normal') {
		if (targetAdv === 'normal') {
			targetAdv = overrideAdv;
		} else if (targetAdv !== overrideAdv) {
			targetAdv = 'normal'; // cancel
		}
	}

	// For logging only, compute the effective combined state
	const combinedAdv = combineCombatAdvantage(
		attackerMods.resolvedAdvantage,
		targetMods.advantage,
		targetMods.disadvantage
	);

	// Build damage dice string with magic bonus
	const magicBonus = weapon.magicBonus ?? 0;
	const abilityMod = abilityModifier(attacker.abilities[useAbility]);
	const totalDamageMod = abilityMod + magicBonus;
	const modStr = totalDamageMod >= 0 ? `+${totalDamageMod}` : `${totalDamageMod}`;

	// Parse base weapon damage dice to build the full notation
	const baseDice = weapon.damage.replace(/[+-]\d+$/, '').trim();
	const damageDice = `${baseDice}${modStr}`;
	const damageType = weapon.damageType || 'bludgeoning';

	// Determine proficiency
	const proficient = true; // In combat, we assume weapon proficiency was checked at equip time

	// Roll the attack (attackRoll handles attacker conditions + our targetAdv override)
	const atkResult = attackRoll(attacker, target.ac, damageDice, useAbility, proficient, targetAdv);

	// Apply damage to target combatant if hit
	let damageResult: DamageApplicationResult | null = null;
	let targetDefeated = false;

	if (atkResult.hits) {
		// Look up target's resistances/immunities/vulnerabilities
		const { resistances, immunities, vulnerabilities } = getTargetDefenses(target, encounter);

		damageResult = applyDamage(
			{ hp: target.currentHp, maxHp: target.maxHp, tempHp: target.tempHp },
			atkResult.totalDamage,
			damageType,
			resistances,
			immunities,
			vulnerabilities
		);

		// Update the combatant in-place
		target.currentHp = damageResult.currentHp;
		target.tempHp = target.tempHp - damageResult.tempHpAbsorbed;
		if (target.tempHp < 0) target.tempHp = 0;

		if (damageResult.currentHp <= 0) {
			target.defeated = true;
			targetDefeated = true;
		}
	}

	return {
		attackResult: atkResult,
		damageResult,
		targetDefeated,
		attackerAdvantageReason: reasons,
		damageType
	};
}

/**
 * Parse damage notation to produce critical hit notation (double dice, keep modifier).
 * "2d8+3" → "4d8+3", "1d6" → "2d6"
 */
function critDamageNotation(notation: string): string {
	const cleaned = notation.toLowerCase().replace(/\s/g, '');
	const match = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/);
	if (!match) return notation;
	const count = parseInt(match[1], 10) * 2;
	const sides = match[2];
	const mod = match[3] ?? '';
	return `${count}d${sides}${mod}`;
}

/**
 * Resolve an NPC attack against a combatant using the creature's stat block attack data.
 */
export function resolveNpcAttack(
	npc: NPC,
	attackIndex: number,
	target: Combatant,
	encounter: ActiveEncounter,
	attackerConditions: Condition[] = []
): CombatAttackResult {
	const reasons: string[] = [];
	const sb = npc.statBlock;
	if (!sb || !sb.attacks[attackIndex]) {
		throw new Error(`NPC ${npc.name} has no attack at index ${attackIndex}`);
	}

	const attack = sb.attacks[attackIndex];

	// Get attacker's condition-based advantage
	const attackerMods = resolveRollModifiers(attackerConditions, 'attack');
	if (attackerMods.resolvedAdvantage !== 'normal') {
		reasons.push(`attacker condition: ${attackerMods.resolvedAdvantage}`);
	}

	// Get target's condition-based advantage for the attacker
	const targetMods = getTargetConditionAdvantage(target.conditions);
	reasons.push(...targetMods.reasons);

	// Combine
	const combinedAdv = combineCombatAdvantage(
		attackerMods.resolvedAdvantage,
		targetMods.advantage,
		targetMods.disadvantage
	);

	// NPC attacks use pre-computed toHit and damage dice from the stat block
	const { chosen, result: atkDice } = rollD20(combinedAdv);
	const total = chosen + attack.toHit;
	const critical = chosen === 20;
	const fumble = chosen === 1;
	const hits = critical || (!fumble && total >= target.ac);

	let totalDamage = 0;
	let damageDice: DiceResult | null = null;
	let damageResult: DamageApplicationResult | null = null;
	let targetDefeated = false;

	if (hits) {
		if (critical) {
			const critNotation = critDamageNotation(attack.damage);
			damageDice = roll(critNotation);
			totalDamage = damageDice.total;
		} else {
			damageDice = roll(attack.damage);
			totalDamage = damageDice.total;
		}

		const { resistances, immunities, vulnerabilities } = getTargetDefenses(target, encounter);

		damageResult = applyDamage(
			{ hp: target.currentHp, maxHp: target.maxHp, tempHp: target.tempHp },
			totalDamage,
			attack.damageType,
			resistances,
			immunities,
			vulnerabilities
		);

		target.currentHp = damageResult.currentHp;
		target.tempHp = target.tempHp - damageResult.tempHpAbsorbed;
		if (target.tempHp < 0) target.tempHp = 0;

		if (damageResult.currentHp <= 0) {
			target.defeated = true;
			targetDefeated = true;
		}
	}

	return {
		attackResult: {
			roll: atkDice,
			attackBonus: attack.toHit,
			total,
			targetAc: target.ac,
			hits,
			critical,
			fumble,
			damage: damageDice,
			totalDamage,
			advantageState: combinedAdv
		},
		damageResult,
		targetDefeated,
		attackerAdvantageReason: reasons,
		damageType: attack.damageType
	};
}

// ---------------------------------------------------------------------------
// Combatant Damage
// ---------------------------------------------------------------------------

/**
 * Get a target combatant's resistances, immunities, and vulnerabilities.
 */
function getTargetDefenses(
	target: Combatant,
	_encounter: ActiveEncounter
): { resistances: string[]; immunities: string[]; vulnerabilities: string[] } {
	return {
		resistances: target.resistances,
		immunities: target.immunities,
		vulnerabilities: target.vulnerabilities
	};
}

// ---------------------------------------------------------------------------
// Combatant Damage (direct)
// ---------------------------------------------------------------------------

/**
 * Apply damage directly to a specific combatant in an encounter.
 *
 * Finds the combatant, applies damage with resistance/immunity/vulnerability,
 * marks defeated if HP ≤ 0. Mutates the combatant in-place.
 *
 * @returns The DamageApplicationResult or null if combatant not found.
 */
export function resolveCombatantDamage(
	encounter: ActiveEncounter,
	targetId: GameId,
	amount: number,
	damageType?: string,
	resistances: string[] = [],
	immunities: string[] = [],
	vulnerabilities: string[] = []
): DamageApplicationResult | null {
	const target = encounter.combatants.find(c => c.id === targetId);
	if (!target || target.defeated) return null;

	const result = applyDamage(
		{ hp: target.currentHp, maxHp: target.maxHp, tempHp: target.tempHp },
		amount,
		damageType,
		resistances,
		immunities,
		vulnerabilities
	);

	target.currentHp = result.currentHp;
	target.tempHp = target.tempHp - result.tempHpAbsorbed;
	if (target.tempHp < 0) target.tempHp = 0;

	if (result.currentHp <= 0) {
		target.defeated = true;
	}

	return result;
}

// ---------------------------------------------------------------------------
// Encounter Resolution
// ---------------------------------------------------------------------------

/**
 * Convert a CR number to the XP_BY_CR lookup key.
 * Handles fractional CRs (0.125 → '1/8', 0.25 → '1/4', 0.5 → '1/2').
 */
function crToKey(cr: number): string {
	if (cr === 0.125) return '1/8';
	if (cr === 0.25) return '1/4';
	if (cr === 0.5) return '1/2';
	return String(cr);
}

/**
 * Resolve an encounter, calculating XP and producing state changes.
 *
 * @param encounter  The encounter to resolve.
 * @param outcome    How the encounter ended.
 * @param creatures  The original NPCs with stat blocks (for CR → XP lookup).
 * @param partySize  Number of PCs for XP division.
 */
export function resolveEncounter(
	encounter: ActiveEncounter,
	outcome: EncounterOutcome,
	creatures: NPC[],
	partySize: number
): EncounterResolutionResult {
	encounter.status = outcome;
	encounter.outcome = outcome;
	encounter.endedAt = Date.now();

	// Calculate XP from defeated NPCs
	let totalXp = 0;
	if (outcome === 'victory' || outcome === 'negotiated') {
		for (const combatant of encounter.combatants) {
			if (combatant.type === 'npc' && combatant.defeated) {
				const npc = creatures.find(c => c.id === combatant.referenceId);
				if (npc?.statBlock) {
					const key = crToKey(npc.statBlock.cr);
					totalXp += XP_BY_CR[key] ?? 0;
				}
			}
		}
	}

	const xpPerCharacter = partySize > 0 ? Math.floor(totalXp / partySize) : 0;

	const stateChange: StateChange = {
		encounterEnded: { outcome }
	};

	// Only award XP on victory/negotiated
	if (xpPerCharacter > 0) {
		stateChange.xpAwarded = [];
		for (const combatant of encounter.combatants) {
			if (combatant.type === 'character' && !combatant.defeated) {
				stateChange.xpAwarded.push({
					characterId: combatant.referenceId,
					amount: xpPerCharacter
				});
			}
		}
	}

	return {
		outcome,
		xpPerCharacter,
		totalXp,
		stateChange
	};
}

// ---------------------------------------------------------------------------
// Action Economy
// ---------------------------------------------------------------------------

/**
 * Create a fresh turn budget for a combatant.
 * All resources available at the start of each turn.
 *
 * @param speed The combatant's movement speed in feet.
 */
export function freshTurnBudget(speed: number): TurnBudget {
	return {
		action: true,
		bonusAction: true,
		reaction: true,
		movement: speed
	};
}

/**
 * Create a turn budget for a specific combatant in an encounter.
 * Accounts for conditions that reduce speed (grappled, restrained, etc.)
 * via the DEFAULT_CONDITION_EFFECTS speedMultiplier.
 */
export function combatantTurnBudget(
	combatant: Combatant,
	baseSpeed: number
): TurnBudget {
	// Use DEFAULT_CONDITION_EFFECTS from types (already imported)

	let effectiveSpeed = baseSpeed;
	let canAct = true;

	for (const condition of combatant.conditions) {
		const effect = DEFAULT_CONDITION_EFFECTS[condition];
		if (effect) {
			effectiveSpeed *= effect.speedMultiplier;
			if (effect.cantDo.includes('take-actions')) canAct = false;
		}
	}

	return {
		action: canAct,
		bonusAction: canAct,
		reaction: !combatant.conditions.some(c => {
			const effect = DEFAULT_CONDITION_EFFECTS[c];
			return effect?.cantDo.includes('take-reactions');
		}),
		movement: Math.floor(effectiveSpeed)
	};
}

// ---------------------------------------------------------------------------
// Utility Queries
// ---------------------------------------------------------------------------

/**
 * Check if all combatants of a given type are defeated.
 */
export function allDefeated(encounter: ActiveEncounter, type: CombatantType): boolean {
	return encounter.combatants
		.filter(c => c.type === type)
		.every(c => c.defeated);
}

/**
 * Get all living combatants of a given type.
 */
export function getLivingCombatants(encounter: ActiveEncounter, type?: CombatantType): Combatant[] {
	return encounter.combatants.filter(c =>
		!c.defeated && (type === undefined || c.type === type)
	);
}

/**
 * Find a combatant by ID.
 */
export function findCombatant(encounter: ActiveEncounter, id: GameId): Combatant | null {
	return encounter.combatants.find(c => c.id === id) ?? null;
}
