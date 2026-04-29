/**
 * Project Zeus — Rest & Recovery Engine
 *
 * 5e short rest and long rest mechanics. Hit dice healing, feature recovery,
 * spell slot restoration, and rest validation.
 *
 * All functions are pure — they return new state rather than mutating input.
 */

import type { PlayerCharacter, SpellSlotPool, Condition, ClassName } from './types';
import { CLASS_HIT_DIE, getPrimaryClass, getTotalHitDiceRemaining } from './types';
import { rollDie, abilityModifier } from './mechanics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a single hit die spend during a short rest. */
export interface HitDieResult {
	/** The die size rolled (e.g. 10 for a d10). */
	dieSides: number;
	/** Raw die roll. */
	rolled: number;
	/** CON modifier added. */
	conMod: number;
	/** Effective healing (rolled + conMod, minimum 0). */
	healing: number;
}

/** Complete short rest result. */
export interface ShortRestResult {
	/** Was the rest performed? */
	success: boolean;
	/** Reason if not successful. */
	reason?: string;
	/** Hit dice results (one per die spent). */
	hitDiceResults: HitDieResult[];
	/** Total HP healed. */
	totalHealing: number;
	/** HP before the rest. */
	previousHp: number;
	/** HP after the rest. */
	currentHp: number;
	/** Hit dice remaining before the rest. */
	previousHitDice: number;
	/** Hit dice remaining after the rest. */
	currentHitDice: number;
	/** Features whose uses were recovered. */
	featuresRecovered: string[];
	/** The updated character. */
	character: PlayerCharacter;
}

/** Complete long rest result. */
export interface LongRestResult {
	/** Was the rest performed? */
	success: boolean;
	/** Reason if not successful. */
	reason?: string;
	/** HP healed. */
	hpHealed: number;
	/** HP before the rest. */
	previousHp: number;
	/** HP after the rest (should equal maxHp). */
	currentHp: number;
	/** Hit dice recovered. */
	hitDiceRecovered: number;
	/** Hit dice remaining before the rest. */
	previousHitDice: number;
	/** Hit dice remaining after the rest. */
	currentHitDice: number;
	/** Spell slots restored (per level). */
	spellSlotsRestored: { level: number; restored: number }[];
	/** Features whose uses were recovered. */
	featuresRecovered: string[];
	/** Conditions removed by the rest. */
	conditionsRemoved: Condition[];
	/** Whether death saves were reset. */
	deathSavesReset: boolean;
	/** The updated character. */
	character: PlayerCharacter;
}

/** Preview of what a short rest would do (no randomness). */
export interface ShortRestPreview {
	/** Number of hit dice available to spend (total across all classes). */
	hitDiceAvailable: number;
	/** Hit die size for the character's primary class. */
	hitDieSides: number;
	/** Per-class hit die breakdown. */
	perClassDice: { className: ClassName; dieSides: number; available: number; total: number }[];
	/** CON modifier that would be added per die. */
	conMod: number;
	/** Average healing per die (floor of average primary roll + CON mod, minimum 0). */
	averageHealingPerDie: number;
	/** Expected total healing for the requested number of dice. */
	expectedTotalHealing: number;
	/** HP deficit (maxHp - hp). */
	hpDeficit: number;
	/** Features that would recover. */
	featuresRecovering: string[];
	/** Whether pact slots would be recovered. */
	pactSlotsToRecover: number;
}

/** Preview of what a long rest would do. */
export interface LongRestPreview {
	/** HP that would be healed. */
	hpToRestore: number;
	/** Hit dice that would be recovered. */
	hitDiceToRecover: number;
	/** Current hit dice remaining. */
	currentHitDice: number;
	/** Hit dice after the rest. */
	hitDiceAfter: number;
	/** Spell slots that would be restored (per level). */
	spellSlotsToRestore: { level: number; toRestore: number }[];
	/** Features that would recover. */
	featuresRecovering: string[];
	/** Conditions that would be removed. */
	conditionsToRemove: Condition[];
	/** Whether death saves would be reset. */
	deathSavesWouldReset: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conditions automatically removed by a long rest. */
const LONG_REST_CLEARABLE_CONDITIONS: ReadonlySet<Condition> = new Set<Condition>([
	'frightened',
	'charmed',
	'unconscious',
	'prone',
	'stunned',
	'paralyzed',
	'poisoned'
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Whether the character can take a short rest.
 * Dead characters cannot rest.
 */
export function canShortRest(character: PlayerCharacter): { allowed: boolean; reason?: string } {
	if (character.dead) {
		return { allowed: false, reason: 'Dead characters cannot rest.' };
	}
	return { allowed: true };
}

/**
 * Whether the character can take a long rest.
 * Dead characters cannot rest.
 */
export function canLongRest(character: PlayerCharacter): { allowed: boolean; reason?: string } {
	if (character.dead) {
		return { allowed: false, reason: 'Dead characters cannot rest.' };
	}
	return { allowed: true };
}

// ---------------------------------------------------------------------------
// Short Rest
// ---------------------------------------------------------------------------

/**
 * Perform a short rest.
 *
 * During a short rest a character can spend hit dice to recover HP.
 * Each hit die rolled uses the class hit die + CON modifier (minimum 0 healing per die).
 * Features with `recoversOn: 'short-rest'` are restored.
 *
 * @param character – The character taking the rest.
 * @param hitDiceToSpend – Number of hit dice to spend (0 or more). Clamped to available dice.
 * @returns ShortRestResult with the updated character and details.
 */
export function shortRest(character: PlayerCharacter, hitDiceToSpend: number = 0): ShortRestResult {
	const validation = canShortRest(character);
	if (!validation.allowed) {
		const totalDice = getTotalHitDiceRemaining(character);
		return {
			success: false,
			reason: validation.reason,
			hitDiceResults: [],
			totalHealing: 0,
			previousHp: character.hp,
			currentHp: character.hp,
			previousHitDice: totalDice,
			currentHitDice: totalDice,
			featuresRecovered: [],
			character
		};
	}

	const conMod = abilityModifier(character.abilities.con);
	const totalDiceAvailable = getTotalHitDiceRemaining(character);
	const diceToSpend = Math.min(Math.max(0, Math.floor(hitDiceToSpend)), totalDiceAvailable);

	// Sort classes by hit die size (descending) — spend largest dice first
	const sortedClasses = [...character.classes]
		.filter((c) => c.hitDiceRemaining > 0)
		.sort((a, b) => (CLASS_HIT_DIE[b.name] ?? 8) - (CLASS_HIT_DIE[a.name] ?? 8));

	// Build spending plan per class
	const classSpending = new Map<ClassName, number>();
	let remaining = diceToSpend;
	for (const cls of sortedClasses) {
		if (remaining <= 0) break;
		const spend = Math.min(remaining, cls.hitDiceRemaining);
		if (spend > 0) classSpending.set(cls.name, spend);
		remaining -= spend;
	}

	let hp = character.hp;
	const hitDiceResults: HitDieResult[] = [];

	// Roll dice per class, largest dice first
	for (const cls of sortedClasses) {
		const spend = classSpending.get(cls.name) ?? 0;
		const dieSides = CLASS_HIT_DIE[cls.name] ?? 8;
		for (let i = 0; i < spend; i++) {
			const rolled = rollDie(dieSides);
			const healing = Math.max(0, rolled + conMod);
			const effectiveHealing = Math.min(healing, character.maxHp - hp);
			hp += effectiveHealing;
			hitDiceResults.push({ dieSides, rolled, conMod, healing: effectiveHealing });
		}
	}

	// Recover short-rest features
	const featuresRecovered: string[] = [];
	const newFeatureUses = { ...character.featureUses };
	for (const [name, usage] of Object.entries(newFeatureUses)) {
		if (usage.recoversOn === 'short-rest' && usage.current < usage.max) {
			newFeatureUses[name] = { ...usage, current: usage.max };
			featuresRecovered.push(name);
		}
	}

	// Also restore pact slots on short rest
	const newPactSlots: SpellSlotPool[] = character.pactSlots.map((slot) => ({
		...slot,
		current: slot.max
	}));

	// Update per-class hit dice remaining
	const updatedClasses = character.classes.map((c) => ({
		...c,
		hitDiceRemaining: c.hitDiceRemaining - (classSpending.get(c.name) ?? 0)
	}));

	const updated: PlayerCharacter = {
		...character,
		hp,
		classes: updatedClasses,
		pactSlots: newPactSlots,
		featureUses: newFeatureUses
	};

	return {
		success: true,
		hitDiceResults,
		totalHealing: hp - character.hp,
		previousHp: character.hp,
		currentHp: hp,
		previousHitDice: totalDiceAvailable,
		currentHitDice: getTotalHitDiceRemaining(updated),
		featuresRecovered,
		character: updated
	};
}

// ---------------------------------------------------------------------------
// Long Rest
// ---------------------------------------------------------------------------

/**
 * Perform a long rest.
 *
 * A long rest restores:
 * - HP to maximum
 * - All spell slots to maximum
 * - Hit dice: recover floor(level / 2) dice (minimum 1), up to level max
 * - Death saves reset to 0/0
 * - Features with `recoversOn: 'short-rest'` or `'long-rest'` restored
 * - Certain conditions removed (frightened, charmed)
 * - Stabilized state cleared (HP restored anyway)
 *
 * @param character – The character taking the rest.
 * @returns LongRestResult with the updated character and details.
 */
export function longRest(character: PlayerCharacter): LongRestResult {
	const validation = canLongRest(character);
	const totalDiceBefore = getTotalHitDiceRemaining(character);
	if (!validation.allowed) {
		return {
			success: false,
			reason: validation.reason,
			hpHealed: 0,
			previousHp: character.hp,
			currentHp: character.hp,
			hitDiceRecovered: 0,
			previousHitDice: totalDiceBefore,
			currentHitDice: totalDiceBefore,
			spellSlotsRestored: [],
			featuresRecovered: [],
			conditionsRemoved: [],
			deathSavesReset: false,
			character
		};
	}

	// Restore HP to max
	const hpHealed = character.maxHp - character.hp;
	const hp = character.maxHp;

	// Recover hit dice: floor(level / 2) minimum 1, distributed per class
	const hitDiceToRecover = Math.max(1, Math.floor(character.level / 2));
	let recoveryBudget = hitDiceToRecover;
	const updatedClasses = character.classes.map((c) => {
		const missing = c.level - c.hitDiceRemaining;
		const recover = Math.min(recoveryBudget, missing);
		recoveryBudget -= recover;
		return { ...c, hitDiceRemaining: c.hitDiceRemaining + recover };
	});
	const totalDiceAfter = updatedClasses.reduce((sum, c) => sum + c.hitDiceRemaining, 0);
	const hitDiceRecovered = totalDiceAfter - totalDiceBefore;

	// Restore all spell slots to max
	const spellSlotsRestored: { level: number; restored: number }[] = [];
	const newSpellSlots: SpellSlotPool[] = character.spellSlots.map((slot) => {
		const restored = slot.max - slot.current;
		if (restored > 0) {
			spellSlotsRestored.push({ level: slot.level, restored });
		}
		return { ...slot, current: slot.max };
	});

	// Restore pact slots to max
	const newPactSlots: SpellSlotPool[] = character.pactSlots.map((slot) => ({
		...slot,
		current: slot.max
	}));

	// Recover features (both short-rest and long-rest)
	const featuresRecovered: string[] = [];
	const newFeatureUses = { ...character.featureUses };
	for (const [name, usage] of Object.entries(newFeatureUses)) {
		if ((usage.recoversOn === 'short-rest' || usage.recoversOn === 'long-rest') && usage.current < usage.max) {
			newFeatureUses[name] = { ...usage, current: usage.max };
			featuresRecovered.push(name);
		}
	}

	// Remove clearable conditions
	const conditionsRemoved: Condition[] = [];
	const newConditions = character.conditions.filter((c) => {
		if (LONG_REST_CLEARABLE_CONDITIONS.has(c)) {
			conditionsRemoved.push(c);
			return false;
		}
		return true;
	});

	// Reset death saves
	const hadDeathSaves = character.deathSaves.successes > 0 || character.deathSaves.failures > 0;

	const updated: PlayerCharacter = {
		...character,
		hp,
		tempHp: 0,
		classes: updatedClasses,
		spellSlots: newSpellSlots,
		pactSlots: newPactSlots,
		featureUses: newFeatureUses,
		conditions: newConditions,
		deathSaves: { successes: 0, failures: 0 },
		stable: false,
		dead: false,
		concentratingOn: null,
		exhaustionLevel: Math.max(0, character.exhaustionLevel - 1)
	};

	return {
		success: true,
		hpHealed,
		previousHp: character.hp,
		currentHp: hp,
		hitDiceRecovered,
		previousHitDice: totalDiceBefore,
		currentHitDice: totalDiceAfter,
		spellSlotsRestored,
		featuresRecovered,
		conditionsRemoved,
		deathSavesReset: hadDeathSaves,
		character: updated
	};
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

/**
 * Preview what a short rest would look like without actually performing it.
 * Useful for the UI to show expected healing.
 */
export function previewShortRest(character: PlayerCharacter, hitDiceToSpend: number = 0): ShortRestPreview {
	const primaryDieSides = CLASS_HIT_DIE[getPrimaryClass(character)] ?? 8;
	const conMod = abilityModifier(character.abilities.con);
	const hitDiceAvailable = getTotalHitDiceRemaining(character);
	const diceToSpend = Math.min(Math.max(0, Math.floor(hitDiceToSpend)), hitDiceAvailable);

	// Per-class die breakdown
	const perClassDice = character.classes.map(c => ({
		className: c.name,
		dieSides: CLASS_HIT_DIE[c.name] ?? 8,
		available: c.hitDiceRemaining,
		total: c.level
	}));

	// Average of a dN = (N + 1) / 2
	const averageRoll = (primaryDieSides + 1) / 2;
	const averageHealingPerDie = Math.max(0, Math.floor(averageRoll + conMod));
	const hpDeficit = character.maxHp - character.hp;
	const expectedTotalHealing = Math.min(diceToSpend * averageHealingPerDie, hpDeficit);

	// Features that would recover
	const featuresRecovering: string[] = [];
	for (const [name, usage] of Object.entries(character.featureUses)) {
		if (usage.recoversOn === 'short-rest' && usage.current < usage.max) {
			featuresRecovering.push(name);
		}
	}

	// Pact slots to recover
	const pactSlotsToRecover = character.pactSlots.reduce((sum, s) => sum + (s.max - s.current), 0);

	return {
		hitDiceAvailable,
		hitDieSides: primaryDieSides,
		perClassDice,
		conMod,
		averageHealingPerDie,
		expectedTotalHealing,
		hpDeficit,
		featuresRecovering,
		pactSlotsToRecover
	};
}

/**
 * Preview what a long rest would restore.
 * Useful for the UI to show recovery summary.
 */
export function previewLongRest(character: PlayerCharacter): LongRestPreview {
	const hpToRestore = character.maxHp - character.hp;

	const hitDiceToRecover = Math.max(1, Math.floor(character.level / 2));
	const currentHitDice = getTotalHitDiceRemaining(character);
	const maxHitDice = character.level;
	const hitDiceAfter = Math.min(currentHitDice + hitDiceToRecover, maxHitDice);

	const spellSlotsToRestore: { level: number; toRestore: number }[] = [];
	for (const slot of character.spellSlots) {
		const toRestore = slot.max - slot.current;
		if (toRestore > 0) {
			spellSlotsToRestore.push({ level: slot.level, toRestore });
		}
	}

	const featuresRecovering: string[] = [];
	for (const [name, usage] of Object.entries(character.featureUses)) {
		if ((usage.recoversOn === 'short-rest' || usage.recoversOn === 'long-rest') && usage.current < usage.max) {
			featuresRecovering.push(name);
		}
	}

	const conditionsToRemove: Condition[] = character.conditions.filter((c) =>
		LONG_REST_CLEARABLE_CONDITIONS.has(c)
	);

	const deathSavesWouldReset = character.deathSaves.successes > 0 || character.deathSaves.failures > 0;

	return {
		hpToRestore,
		hitDiceToRecover: hitDiceAfter - currentHitDice,
		currentHitDice,
		hitDiceAfter,
		spellSlotsToRestore,
		featuresRecovering,
		conditionsToRemove,
		deathSavesWouldReset
	};
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Use a limited-use feature, decrementing its current uses by 1.
 * Returns the updated character, or null if the feature has no uses remaining.
 */
export function useFeature(character: PlayerCharacter, featureName: string): { character: PlayerCharacter; used: boolean; remaining: number } {
	const usage = character.featureUses[featureName];
	if (!usage) {
		// Feature not tracked — allow unlimited use
		return { character, used: true, remaining: Infinity };
	}
	if (usage.current <= 0) {
		return { character, used: false, remaining: 0 };
	}
	const newUses = { ...character.featureUses, [featureName]: { ...usage, current: usage.current - 1 } };
	return {
		character: { ...character, featureUses: newUses },
		used: true,
		remaining: usage.current - 1
	};
}
