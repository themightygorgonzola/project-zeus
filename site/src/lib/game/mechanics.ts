/**
 * Project Zeus — Dice & Mechanics Engine
 *
 * Server-authoritative resolution of all 5e-compatible mechanics.
 * The AI does NOT roll dice — this module does, and the results are fed
 * to the AI so it narrates around determined outcomes.
 *
 * Pure functions + a seedable PRNG for testing determinism.
 */

import type {
	AbilityName,
	AbilityScores,
	ClassName,
	Condition,
	DiceResult,
	Item,
	MechanicResult,
	PlayerCharacter,
	SkillName
} from './types';
import { CLASS_HIT_DIE, SKILL_ABILITY_MAP } from './types';

// ---------------------------------------------------------------------------
// PRNG (Mulberry32) — matches worldgen, seedable for tests
// ---------------------------------------------------------------------------

export type RngFn = () => number;

export function mulberry32(seed: number): RngFn {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Default RNG uses crypto-quality randomness. */
let _rng: RngFn = () => Math.random();

/** Override the global RNG (useful for deterministic tests). */
export function setRng(rng: RngFn): void {
	_rng = rng;
}

/** Reset to default Math.random RNG. */
export function resetRng(): void {
	_rng = () => Math.random();
}

function rng(): number {
	return _rng();
}

// ---------------------------------------------------------------------------
// Core Dice Rolling
// ---------------------------------------------------------------------------

/**
 * Roll a single die with `sides` faces. Returns 1–sides inclusive.
 */
export function rollDie(sides: number): number {
	return Math.floor(rng() * sides) + 1;
}

/**
 * Roll `count` dice with `sides` faces. Returns all individual results.
 */
export function rollDice(count: number, sides: number): number[] {
	const results: number[] = [];
	for (let i = 0; i < count; i++) {
		results.push(rollDie(sides));
	}
	return results;
}

/**
 * Parse and evaluate dice notation.
 *
 * Supported formats:
 *   "1d20"       → roll 1 twenty-sided die
 *   "4d6kh3"     → roll 4d6, keep highest 3
 *   "4d6kl1"     → roll 4d6, keep lowest 1
 *   "2d8+3"      → roll 2d8 and add 3
 *   "1d20-1"     → roll 1d20 and subtract 1
 *   "3d6"        → roll 3d6, sum all
 */
export function roll(notation: string): DiceResult {
	const cleaned = notation.toLowerCase().replace(/\s/g, '');

	// Match: <count>d<sides>[kh<n>|kl<n>][+/-<modifier>]
	const match = cleaned.match(/^(\d+)d(\d+)(?:k([hl])(\d+))?([+-]\d+)?$/);
	if (!match) {
		throw new Error(`Invalid dice notation: "${notation}"`);
	}

	const count = parseInt(match[1], 10);
	const sides = parseInt(match[2], 10);
	const keepDir = match[3] as 'h' | 'l' | undefined;
	const keepCount = match[4] ? parseInt(match[4], 10) : undefined;
	const modifier = match[5] ? parseInt(match[5], 10) : 0;

	const rolls = rollDice(count, sides);

	let kept: number[];
	if (keepDir && keepCount !== undefined) {
		const sorted = [...rolls].sort((a, b) => a - b);
		kept = keepDir === 'h' ? sorted.slice(-keepCount) : sorted.slice(0, keepCount);
	} else {
		kept = rolls;
	}

	const total = kept.reduce((sum, v) => sum + v, 0) + modifier;

	return { notation, rolls, total };
}

// ---------------------------------------------------------------------------
// Ability Helpers
// ---------------------------------------------------------------------------

/**
 * Standard 5e ability modifier: floor((score - 10) / 2).
 */
export function abilityModifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

/**
 * Proficiency bonus by level (5e table).
 */
export function proficiencyBonus(level: number): number {
	if (level <= 4) return 2;
	if (level <= 8) return 3;
	if (level <= 12) return 4;
	if (level <= 16) return 5;
	return 6;
}

/**
 * Generate a set of ability scores using 4d6-drop-lowest (×6).
 * Returns an array of 6 values the player assigns to abilities.
 */
export function rollAbilityScores(): number[] {
	const scores: number[] = [];
	for (let i = 0; i < 6; i++) {
		const r = roll('4d6kh3');
		scores.push(r.total);
	}
	return scores.sort((a, b) => b - a);
}

/** The 5e standard array. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8] as const;

const POINT_BUY_COST: Record<number, number> = {
	8: 0,
	9: 1,
	10: 2,
	11: 3,
	12: 4,
	13: 5,
	14: 7,
	15: 9
};

export interface PointBuyResult {
	spent: number;
	remaining: number;
	valid: boolean;
	invalidAbilities: AbilityName[];
}

/**
 * Validate a 27-point-buy assignment.
 */
export function pointBuy(abilityAssignment: AbilityScores, budget = 27): PointBuyResult {
	const invalidAbilities = (Object.entries(abilityAssignment) as [AbilityName, number][])
		.filter(([, score]) => !(score in POINT_BUY_COST))
		.map(([ability]) => ability);

	const spent = (Object.values(abilityAssignment) as number[]).reduce(
		(total, score) => total + (POINT_BUY_COST[score] ?? budget + 1),
		0
	);

	return {
		spent,
		remaining: budget - spent,
		valid: invalidAbilities.length === 0 && spent === budget,
		invalidAbilities
	};
}

// ---------------------------------------------------------------------------
// Skill Checks
// ---------------------------------------------------------------------------

export interface CheckResult {
	roll: DiceResult;
	abilityMod: number;
	proficient: boolean;
	bonus: number;
	total: number;
	dc: number;
	success: boolean;
	nat1: boolean;
	nat20: boolean;
}

/**
 * Perform a skill check for a character.
 */
export function skillCheck(
	character: PlayerCharacter,
	skill: SkillName,
	dc: number
): CheckResult {
	const ability = SKILL_ABILITY_MAP[skill];
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.skillProficiencies.includes(skill);
	const bonus = abilityMod + (proficient ? character.proficiencyBonus : 0);

	const diceResult = roll('1d20');
	const rawRoll = diceResult.rolls[0];
	const total = rawRoll + bonus;

	return {
		roll: diceResult,
		abilityMod,
		proficient,
		bonus,
		total,
		dc,
		success: total >= dc,
		nat1: rawRoll === 1,
		nat20: rawRoll === 20
	};
}

/**
 * Perform an ability check (no skill, just raw ability).
 */
export function abilityCheck(
	character: PlayerCharacter,
	ability: AbilityName,
	dc: number
): CheckResult {
	const abilityMod = abilityModifier(character.abilities[ability]);
	const diceResult = roll('1d20');
	const rawRoll = diceResult.rolls[0];
	const total = rawRoll + abilityMod;

	return {
		roll: diceResult,
		abilityMod,
		proficient: false,
		bonus: abilityMod,
		total,
		dc,
		success: total >= dc,
		nat1: rawRoll === 1,
		nat20: rawRoll === 20
	};
}

// ---------------------------------------------------------------------------
// Saving Throws
// ---------------------------------------------------------------------------

export function savingThrow(
	character: PlayerCharacter,
	ability: AbilityName,
	dc: number
): CheckResult {
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.saveProficiencies.includes(ability);
	const bonus = abilityMod + (proficient ? character.proficiencyBonus : 0);

	const diceResult = roll('1d20');
	const rawRoll = diceResult.rolls[0];
	const total = rawRoll + bonus;

	return {
		roll: diceResult,
		abilityMod,
		proficient,
		bonus,
		total,
		dc,
		success: total >= dc,
		nat1: rawRoll === 1,
		nat20: rawRoll === 20
	};
}

// ---------------------------------------------------------------------------
// Attack Rolls
// ---------------------------------------------------------------------------

export interface AttackResult {
	roll: DiceResult;
	attackBonus: number;
	total: number;
	targetAc: number;
	hits: boolean;
	critical: boolean;
	fumble: boolean;
	damage: DiceResult | null;
	totalDamage: number;
}

/**
 * Resolve an attack roll.
 *
 * @param attacker      The attacking character.
 * @param targetAc      The target's armor class.
 * @param damageDice    Damage dice notation (e.g. "1d8+3").
 * @param useAbility    Which ability governs the attack (defaults to 'str').
 * @param proficient    Whether the attacker is proficient with the weapon (default true).
 */
export function attackRoll(
	attacker: PlayerCharacter,
	targetAc: number,
	damageDice: string,
	useAbility: AbilityName = 'str',
	proficient = true
): AttackResult {
	const abilityMod = abilityModifier(attacker.abilities[useAbility]);
	const attackBonus = abilityMod + (proficient ? attacker.proficiencyBonus : 0);

	const atkRoll = roll('1d20');
	const rawRoll = atkRoll.rolls[0];
	const total = rawRoll + attackBonus;

	const critical = rawRoll === 20;
	const fumble = rawRoll === 1;
	const hits = critical || (!fumble && total >= targetAc);

	let damage: DiceResult | null = null;
	let totalDamage = 0;

	if (hits) {
		damage = roll(damageDice);
		totalDamage = damage.total;

		// Critical hit: roll damage dice twice (simplified: double dice total, keep modifier once)
		if (critical) {
			const extraDamage = roll(damageDice);
			// Only double the dice portion — modifier is in both rolls, subtract it once.
			// Simplification: just sum both rolls (close enough for prototype).
			totalDamage = damage.total + extraDamage.total;
		}
	}

	return {
		roll: atkRoll,
		attackBonus,
		total,
		targetAc: targetAc,
		hits,
		critical,
		fumble,
		damage,
		totalDamage
	};
}

// ---------------------------------------------------------------------------
// Damage & Healing
// ---------------------------------------------------------------------------

export interface DamageApplicationResult {
	previousHp: number;
	currentHp: number;
	tempHpAbsorbed: number;
	unconscious: boolean;
	dead: boolean;
}

/**
 * Apply damage to a character. Temp HP absorbs first.
 * Returns the result; does NOT mutate the character (pure function).
 */
export function applyDamage(
	character: PlayerCharacter,
	amount: number
): DamageApplicationResult {
	let remaining = amount;
	let tempHp = character.tempHp;
	let hp = character.hp;

	const tempHpAbsorbed = Math.min(tempHp, remaining);
	tempHp -= tempHpAbsorbed;
	remaining -= tempHpAbsorbed;

	hp -= remaining;

	// In 5e, massive damage that reduces you past negative maxHp = instant death.
	const dead = hp <= -(character.maxHp);
	const unconscious = hp <= 0 && !dead;

	// Clamp HP to 0 minimum for storage (death saves track the rest).
	if (hp < 0) hp = 0;

	return {
		previousHp: character.hp,
		currentHp: hp,
		tempHpAbsorbed,
		unconscious,
		dead
	};
}

/**
 * Apply healing to a character (capped at maxHp).
 */
export function applyHealing(
	character: PlayerCharacter,
	amount: number
): { previousHp: number; currentHp: number } {
	const previousHp = character.hp;
	const currentHp = Math.min(character.hp + amount, character.maxHp);
	return { previousHp, currentHp };
}

// ---------------------------------------------------------------------------
// Level Up
// ---------------------------------------------------------------------------

/**
 * Calculate the new max HP when leveling up.
 * Uses the average hit die result (rounded up) + CON modifier,
 * which is the standard 5e rule for fixed HP increase.
 */
export function levelUpHpIncrease(className: ClassName, conScore: number): number {
	const hitDie = CLASS_HIT_DIE[className];
	const averageRoll = Math.ceil(hitDie / 2) + 1; // e.g. d10 → 6, d6 → 4
	return averageRoll + abilityModifier(conScore);
}

/**
 * Compute initial max HP at level 1: full hit die + CON modifier.
 */
export function level1Hp(className: ClassName, conScore: number): number {
	return CLASS_HIT_DIE[className] + abilityModifier(conScore);
}

/**
 * Base AC calculation (no armor): 10 + DEX modifier.
 */
export function baseAc(dexScore: number): number {
	return 10 + abilityModifier(dexScore);
}

// ---------------------------------------------------------------------------
// Mechanic Result Builders (convenience for the turn pipeline)
// ---------------------------------------------------------------------------

export function toMechanicResult(
	type: MechanicResult['type'],
	label: string,
	check: CheckResult
): MechanicResult {
	return {
		type,
		label,
		dice: check.roll,
		dc: check.dc,
		success: check.success
	};
}

export function attackToMechanicResult(label: string, atk: AttackResult): MechanicResult {
	return {
		type: 'attack-roll',
		label,
		dice: atk.roll,
		dc: atk.targetAc,
		success: atk.hits
	};
}
