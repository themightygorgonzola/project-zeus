/**
 * Project Zeus — Conditions, Death Saves, and Exhaustion
 *
 * Condition cascading, death save orchestration, damage-while-unconscious,
 * and the full 5e exhaustion table. All functions are pure (no DB, no side
 * effects) and deterministic when used with a seeded PRNG.
 *
 * Phase C of the Content-Complete Push.
 */

import type {
	Condition,
	NPC,
	PlayerCharacter,
	StateChange
} from './types';
import { DEFAULT_CONDITION_EFFECTS } from './types';
import {
	rollDeathSave,
	resolveRollModifiers,
	type DeathSaveResult,
	type DeathSaveRollResult,
	type AdvantageState
} from './mechanics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome after checking a character's accumulated death saves. */
export type DeathSaveOutcome = 'stable' | 'dead' | 'ongoing';

/** Result of applying a death save to a character. */
export interface AppliedDeathSaveResult {
	roll: DeathSaveResult;
	outcome: DeathSaveOutcome;
	stateChange: StateChange;
}

/** Result of applying damage to an unconscious character. */
export interface UnconsciousDamageResult {
	failuresAdded: number;
	outcome: DeathSaveOutcome;
	stateChange: StateChange;
}

/** The 5e exhaustion table, levels 1-6. */
export interface ExhaustionEffects {
	level: number;
	disadvantageOnAbilityChecks: boolean;
	speedHalved: boolean;
	disadvantageOnAttacksAndSaves: boolean;
	hpMaxHalved: boolean;
	speedZero: boolean;
	death: boolean;
}

// ---------------------------------------------------------------------------
// Condition Cascading
// ---------------------------------------------------------------------------

/**
 * Conditions that are implicitly applied when another condition is applied.
 * Per 5e rules:
 *   - Unconscious → also incapacitated
 *   - Paralyzed → also incapacitated
 *   - Petrified → also incapacitated
 *   - Stunned → also incapacitated
 */
const CONDITION_IMPLIES: Partial<Record<Condition, Condition[]>> = {
	unconscious: ['incapacitated'],
	paralyzed: ['incapacitated'],
	petrified: ['incapacitated'],
	stunned: ['incapacitated']
};

/**
 * Conditions that, if still active, PREVENT removal of a dependent condition.
 * E.g., removing 'paralyzed' should NOT remove 'incapacitated' if the
 * character is also 'stunned' or 'unconscious'.
 */
const INCAPACITATED_SOURCES: Condition[] = ['unconscious', 'paralyzed', 'petrified', 'stunned'];

/**
 * Apply a condition to a character, following 5e cascading rules.
 *
 * - Adds the condition if not already present.
 * - Adds implied conditions (e.g., unconscious → incapacitated).
 * - Does NOT add duplicates.
 *
 * Returns the list of conditions actually added (may include cascaded ones).
 * Mutates `character.conditions` in-place.
 */
export function applyCondition(
	character: PlayerCharacter,
	condition: Condition
): { added: Condition[]; stateChange: StateChange } {
	const added: Condition[] = [];
	const stateChanges: StateChange['conditionsApplied'] = [];

	// Add the primary condition
	if (!character.conditions.includes(condition)) {
		character.conditions.push(condition);
		added.push(condition);
		stateChanges.push({ characterId: character.id, condition, applied: true });
	}

	// Add cascaded conditions
	const implied = CONDITION_IMPLIES[condition];
	if (implied) {
		for (const c of implied) {
			if (!character.conditions.includes(c)) {
				character.conditions.push(c);
				added.push(c);
				stateChanges.push({ characterId: character.id, condition: c, applied: true });
			}
		}
	}

	return {
		added,
		stateChange: { conditionsApplied: stateChanges }
	};
}

/**
 * Remove a condition from a character, following 5e cascading rules.
 *
 * - Removes the condition.
 * - Removes cascaded conditions ONLY if no other source still requires them.
 *   E.g., removing 'paralyzed' removes 'incapacitated' ONLY if the character
 *   is not also 'stunned', 'unconscious', or 'petrified'.
 *
 * Returns the list of conditions actually removed.
 * Mutates `character.conditions` in-place.
 */
export function removeCondition(
	character: PlayerCharacter,
	condition: Condition
): { removed: Condition[]; stateChange: StateChange } {
	const removed: Condition[] = [];
	const stateChanges: StateChange['conditionsApplied'] = [];

	// Remove the primary condition
	const idx = character.conditions.indexOf(condition);
	if (idx !== -1) {
		character.conditions.splice(idx, 1);
		removed.push(condition);
		stateChanges.push({ characterId: character.id, condition, applied: false });
	}

	// Check if we should remove cascaded conditions
	const implied = CONDITION_IMPLIES[condition];
	if (implied) {
		for (const cascaded of implied) {
			// Don't remove 'incapacitated' if another source still requires it
			if (cascaded === 'incapacitated') {
				const otherSources = INCAPACITATED_SOURCES.filter(
					c => c !== condition && character.conditions.includes(c)
				);
				if (otherSources.length > 0) continue;
			}

			const cIdx = character.conditions.indexOf(cascaded);
			if (cIdx !== -1) {
				character.conditions.splice(cIdx, 1);
				removed.push(cascaded);
				stateChanges.push({ characterId: character.id, condition: cascaded, applied: false });
			}
		}
	}

	return {
		removed,
		stateChange: { conditionsApplied: stateChanges }
	};
}

/**
 * Check whether a character has a specific condition.
 */
export function hasCondition(character: PlayerCharacter, condition: Condition): boolean {
	return character.conditions.includes(condition);
}

// ---------------------------------------------------------------------------
// Death Saves
// ---------------------------------------------------------------------------

/**
 * Perform a death saving throw for a character at 0 HP.
 *
 * Rolls 1d20 and applies the result to the character's deathSaves tracker.
 * Checks for stabilization or death after updating.
 *
 * Precondition: character.hp === 0, character.stable === false, character.dead === false.
 *
 * Mutates: character.deathSaves, and on nat-20 also character.hp and character.stable.
 * On stabilization: character.stable = true.
 * On death: character.dead = true.
 */
export function performDeathSave(character: PlayerCharacter): AppliedDeathSaveResult {
	const deathRoll = rollDeathSave();

	// Apply the roll's effect to the death save tracker
	switch (deathRoll.result) {
		case 'critical-success':
			// Nat 20: character regains 1 HP, death saves reset
			character.hp = 1;
			character.deathSaves = { successes: 0, failures: 0 };
			character.stable = false; // They're conscious now, not "stable at 0"
			// Remove unconscious condition
			if (character.conditions.includes('unconscious')) {
				removeCondition(character, 'unconscious');
			}
			break;
		case 'critical-failure':
			// Nat 1: counts as 2 failures
			character.deathSaves.failures += 2;
			break;
		case 'success':
			character.deathSaves.successes += 1;
			break;
		case 'failure':
			character.deathSaves.failures += 1;
			break;
	}

	// Check outcome AFTER applying
	const outcome = checkDeathSaveOutcome(character);

	const stateChange: StateChange = {
		deathSaveResult: {
			characterId: character.id,
			result: deathRoll.result
		}
	};

	if (outcome !== 'ongoing') {
		stateChange.deathSaveOutcome = {
			characterId: character.id,
			outcome
		};
	}

	return { roll: deathRoll, outcome, stateChange };
}

/**
 * Check the current death save outcome based on accumulated successes/failures.
 *
 * - 3+ successes → 'stable' (HP stays 0, character is stable)
 * - 3+ failures → 'dead'
 * - Otherwise → 'ongoing'
 *
 * Also mutates character.stable / character.dead accordingly.
 */
export function checkDeathSaveOutcome(character: PlayerCharacter): DeathSaveOutcome {
	if (character.deathSaves.failures >= 3) {
		character.dead = true;
		return 'dead';
	}
	if (character.deathSaves.successes >= 3) {
		character.stable = true;
		return 'stable';
	}
	return 'ongoing';
}

/**
 * Apply damage to an unconscious character (at 0 HP).
 *
 * Per 5e rules:
 *   - Any damage causes an automatic death save failure.
 *   - If the attack was a critical hit (attacker within 5 ft), it causes 2 failures.
 *
 * Mutates character.deathSaves and possibly character.dead.
 */
export function damageWhileUnconscious(
	character: PlayerCharacter,
	isCritical: boolean
): UnconsciousDamageResult {
	const failuresAdded = isCritical ? 2 : 1;
	character.deathSaves.failures += failuresAdded;

	const outcome = checkDeathSaveOutcome(character);

	const stateChange: StateChange = {
		deathSaveResult: {
			characterId: character.id,
			result: isCritical ? 'critical-failure' : 'failure'
		}
	};

	if (outcome !== 'ongoing') {
		stateChange.deathSaveOutcome = {
			characterId: character.id,
			outcome
		};
	}

	return { failuresAdded, outcome, stateChange };
}

/**
 * Reset a character's death saves (called when they regain HP or stabilize).
 */
export function resetDeathSaves(character: PlayerCharacter): void {
	character.deathSaves = { successes: 0, failures: 0 };
}

// ---------------------------------------------------------------------------
// NPC Condition Helpers
// ---------------------------------------------------------------------------

/**
 * Apply a condition to an NPC, following the same cascade rules as PCs.
 *
 * NPCs track conditions in an optional `conditions` array (defaults to []).
 * Returns the list of conditions actually added and a StateChange record.
 * Mutates `npc.conditions` in-place.
 */
export function applyNpcCondition(
	npc: NPC,
	condition: Condition
): { added: Condition[]; stateChange: StateChange } {
	if (!npc.conditions) npc.conditions = [];

	const added: Condition[] = [];
	const stateChanges: StateChange['conditionsApplied'] = [];

	if (!npc.conditions.includes(condition)) {
		npc.conditions.push(condition);
		added.push(condition);
		stateChanges.push({ characterId: npc.id, condition, applied: true });
	}

	const implied = CONDITION_IMPLIES[condition];
	if (implied) {
		for (const c of implied) {
			if (!npc.conditions.includes(c)) {
				npc.conditions.push(c);
				added.push(c);
				stateChanges.push({ characterId: npc.id, condition: c, applied: true });
			}
		}
	}

	return { added, stateChange: { conditionsApplied: stateChanges } };
}

/**
 * Remove a condition from an NPC, following cascade rules.
 * Mutates `npc.conditions` in-place.
 */
export function removeNpcCondition(
	npc: NPC,
	condition: Condition
): { removed: Condition[]; stateChange: StateChange } {
	if (!npc.conditions) npc.conditions = [];

	const removed: Condition[] = [];
	const stateChanges: StateChange['conditionsApplied'] = [];

	const idx = npc.conditions.indexOf(condition);
	if (idx !== -1) {
		npc.conditions.splice(idx, 1);
		removed.push(condition);
		stateChanges.push({ characterId: npc.id, condition, applied: false });
	}

	const implied = CONDITION_IMPLIES[condition];
	if (implied) {
		for (const cascaded of implied) {
			if (cascaded === 'incapacitated') {
				const otherSources = INCAPACITATED_SOURCES.filter(
					c => c !== condition && npc.conditions!.includes(c)
				);
				if (otherSources.length > 0) continue;
			}
			const cIdx = npc.conditions.indexOf(cascaded);
			if (cIdx !== -1) {
				npc.conditions.splice(cIdx, 1);
				removed.push(cascaded);
				stateChanges.push({ characterId: npc.id, condition: cascaded, applied: false });
			}
		}
	}

	return { removed, stateChange: { conditionsApplied: stateChanges } };
}

// ---------------------------------------------------------------------------
// Exhaustion (6-Level System)
// ---------------------------------------------------------------------------

/**
 * The 5e exhaustion effects table.
 *
 * Level 1: Disadvantage on ability checks
 * Level 2: Speed halved
 * Level 3: Disadvantage on attack rolls and saving throws
 * Level 4: Hit point maximum halved
 * Level 5: Speed reduced to 0
 * Level 6: Death
 *
 * Effects are CUMULATIVE — level 3 includes all of levels 1 and 2.
 */
export function getExhaustionEffects(level: number): ExhaustionEffects {
	const clamped = Math.max(0, Math.min(6, level));
	return {
		level: clamped,
		disadvantageOnAbilityChecks: clamped >= 1,
		speedHalved: clamped >= 2,
		disadvantageOnAttacksAndSaves: clamped >= 3,
		hpMaxHalved: clamped >= 4,
		speedZero: clamped >= 5,
		death: clamped >= 6
	};
}

/**
 * Add exhaustion levels to a character. Clamps to 0-6.
 * Level 6 = dead.
 *
 * Mutates character.exhaustionLevel (and character.dead if level 6).
 * Returns the new level.
 */
export function addExhaustion(character: PlayerCharacter, levels: number = 1): number {
	character.exhaustionLevel = Math.min(6, character.exhaustionLevel + levels);
	if (character.exhaustionLevel >= 6) {
		character.dead = true;
	}
	return character.exhaustionLevel;
}

/**
 * Remove exhaustion levels from a character. Clamps to 0.
 * Mutates character.exhaustionLevel.
 * Returns the new level.
 */
export function removeExhaustion(character: PlayerCharacter, levels: number = 1): number {
	character.exhaustionLevel = Math.max(0, character.exhaustionLevel - levels);
	return character.exhaustionLevel;
}

/**
 * Resolve roll modifiers taking exhaustion into account.
 *
 * This extends the base resolveRollModifiers with exhaustion effects:
 *   - Level 1+: disadvantage on ability checks (and skill checks)
 *   - Level 3+: disadvantage on attack rolls and saving throws
 *
 * Returns the combined modifier state.
 */
export function resolveRollModifiersWithExhaustion(
	conditions: Condition[],
	exhaustionLevel: number,
	rollType: 'attack' | 'ability-check' | 'skill-check' | 'saving-throw',
	ability?: import('./types').AbilityName
): import('./mechanics').RollModifiers {
	// Start with base condition modifiers
	const base = resolveRollModifiers(conditions, rollType, ability);

	if (exhaustionLevel <= 0) return base;

	const effects = getExhaustionEffects(exhaustionLevel);

	let disadvantage = base.disadvantage;

	// Level 1+: disadvantage on ability checks (skill checks are ability checks)
	if (effects.disadvantageOnAbilityChecks &&
		(rollType === 'ability-check' || rollType === 'skill-check')) {
		disadvantage = true;
	}

	// Level 3+: disadvantage on attack rolls and saving throws
	if (effects.disadvantageOnAttacksAndSaves &&
		(rollType === 'attack' || rollType === 'saving-throw')) {
		disadvantage = true;
	}

	// Recompute resolved advantage
	let resolvedAdvantage: AdvantageState = 'normal';
	if (base.advantage && !disadvantage) resolvedAdvantage = 'advantage';
	else if (disadvantage && !base.advantage) resolvedAdvantage = 'disadvantage';
	// else both or neither → 'normal'

	return {
		advantage: base.advantage,
		disadvantage,
		autoFail: base.autoFail,
		resolvedAdvantage
	};
}

/**
 * Get the effective max HP for a character accounting for exhaustion level 4+.
 * Level 4: HP maximum halved (floor).
 */
export function effectiveMaxHp(character: PlayerCharacter): number {
	if (character.exhaustionLevel >= 4) {
		return Math.floor(character.maxHp / 2);
	}
	return character.maxHp;
}

/**
 * Get the effective speed for a character accounting for exhaustion.
 * Level 2: speed halved
 * Level 5: speed reduced to 0
 */
export function effectiveSpeed(character: PlayerCharacter): number {
	if (character.exhaustionLevel >= 5) return 0;
	if (character.exhaustionLevel >= 2) return Math.floor(character.speed / 2);
	return character.speed;
}
