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
	ConditionEffect,
	DiceResult,
	Item,
	MechanicResult,
	PlayerCharacter,
	SkillName
} from './types';
import { CLASS_HIT_DIE, DEFAULT_CONDITION_EFFECTS, SKILL_ABILITY_MAP } from './types';

// ---------------------------------------------------------------------------
// Advantage / Disadvantage
// ---------------------------------------------------------------------------

/** The three possible advantage states for a d20 roll. */
export type AdvantageState = 'advantage' | 'disadvantage' | 'normal';

/**
 * The kind of d20 roll being attempted, used to look up condition effects.
 */
export type RollType = 'attack' | 'ability-check' | 'skill-check' | 'saving-throw';

/**
 * Result of inspecting a character's conditions for a specific roll type.
 * - `advantage` / `disadvantage`: whether the character's conditions impose them.
 * - `autoFail`: the roll should fail without rolling (e.g. paralyzed + STR save).
 * - `resolvedAdvantage`: the final state after cancellation rules.
 *   If both advantage AND disadvantage apply they cancel to 'normal'.
 */
export interface RollModifiers {
	advantage: boolean;
	disadvantage: boolean;
	autoFail: boolean;
	resolvedAdvantage: AdvantageState;
}

/**
 * Inspect a character's active conditions and determine what advantage,
 * disadvantage, or auto-fail applies to a given roll type.
 *
 * @param conditions   The character's active condition list.
 * @param rollType     The kind of d20 roll.
 * @param ability      The ability being used (relevant for auto-fail saves).
 */
export function resolveRollModifiers(
	conditions: Condition[],
	rollType: RollType,
	ability?: AbilityName
): RollModifiers {
	let advantage = false;
	let disadvantage = false;
	let autoFail = false;

	for (const condition of conditions) {
		const effect: ConditionEffect = DEFAULT_CONDITION_EFFECTS[condition];
		if (!effect) continue;

		// --- Auto-fail saves ---
		if (rollType === 'saving-throw' && ability && effect.autoFailSaves.includes(ability)) {
			autoFail = true;
		}

		// --- Advantage ---
		if (rollType === 'attack' && effect.advantageOn.includes('attack-rolls')) {
			advantage = true;
		}

		// --- Disadvantage ---
		if (rollType === 'attack' && effect.disadvantageOn.includes('attack-rolls')) {
			disadvantage = true;
		}
		if (
			(rollType === 'ability-check' || rollType === 'skill-check') &&
			(effect.disadvantageOn.includes('ability-checks') ||
				effect.disadvantageOn.includes('sight-based-ability-checks'))
		) {
			disadvantage = true;
		}
		if (rollType === 'attack' && effect.disadvantageOn.includes('attack-rolls-while-source-visible')) {
			// Frightened: disadvantage while source is visible.
			// We conservatively apply it (the AI can override with explicit advantage param).
			disadvantage = true;
		}
		if (
			(rollType === 'ability-check' || rollType === 'skill-check') &&
			effect.disadvantageOn.includes('ability-checks-while-source-visible')
		) {
			disadvantage = true;
		}
	}

	// 5e rule: if you have both advantage AND disadvantage, they cancel to normal.
	let resolvedAdvantage: AdvantageState = 'normal';
	if (advantage && !disadvantage) resolvedAdvantage = 'advantage';
	else if (disadvantage && !advantage) resolvedAdvantage = 'disadvantage';
	// else both or neither → 'normal'

	return { advantage, disadvantage, autoFail, resolvedAdvantage };
}

/**
 * Roll a d20 with advantage or disadvantage.
 * - `'advantage'`:    roll 2d20, take higher.
 * - `'disadvantage'`: roll 2d20, take lower.
 * - `'normal'`:       roll 1d20.
 *
 * Returns the chosen die value and the full DiceResult.
 */
export function rollD20(advState: AdvantageState = 'normal'): { chosen: number; result: DiceResult } {
	if (advState === 'normal') {
		const result = roll('1d20');
		return { chosen: result.rolls[0], result };
	}
	const die1 = rollDie(20);
	const die2 = rollDie(20);
	const chosen = advState === 'advantage' ? Math.max(die1, die2) : Math.min(die1, die2);
	return {
		chosen,
		result: {
			notation: advState === 'advantage' ? '2d20kh1' : '2d20kl1',
			rolls: [die1, die2],
			total: chosen
		}
	};
}

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
	expertise: boolean;
	bonus: number;
	total: number;
	dc: number;
	success: boolean;
	nat1: boolean;
	nat20: boolean;
	advantageState: AdvantageState;
	autoFailed: boolean;
}

/**
 * Perform a skill check for a character.
 *
 * Conditions are automatically inspected to determine advantage/disadvantage
 * and auto-fail. An explicit `overrideAdvantage` merges with the condition-
 * derived state (if both advantage + disadvantage, they cancel to normal).
 */
export function skillCheck(
	character: PlayerCharacter,
	skill: SkillName,
	dc: number,
	overrideAdvantage?: AdvantageState
): CheckResult {
	const ability = SKILL_ABILITY_MAP[skill];
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.skillProficiencies.includes(skill);
	const expertise = Array.isArray(character.expertiseSkills) && character.expertiseSkills.includes(skill);
	const profBonus = proficient
		? (expertise ? character.proficiencyBonus * 2 : character.proficiencyBonus)
		: 0;
	const bonus = abilityMod + profBonus;

	// Resolve conditions
	const mods = resolveRollModifiers(character.conditions, 'skill-check', ability);

	if (mods.autoFail) {
		return autoFailResult(dc, abilityMod, proficient, expertise, bonus);
	}

	// Merge explicit override with condition-derived advantage
	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	const { chosen, result: diceResult } = rollD20(finalAdv);
	const total = chosen + bonus;

	return {
		roll: diceResult,
		abilityMod,
		proficient,
		expertise,
		bonus,
		total,
		dc,
		success: total >= dc,
		nat1: chosen === 1,
		nat20: chosen === 20,
		advantageState: finalAdv,
		autoFailed: false
	};
}

/**
 * Perform an ability check (no skill, just raw ability).
 */
export function abilityCheck(
	character: PlayerCharacter,
	ability: AbilityName,
	dc: number,
	overrideAdvantage?: AdvantageState
): CheckResult {
	const abilityMod = abilityModifier(character.abilities[ability]);

	const mods = resolveRollModifiers(character.conditions, 'ability-check', ability);

	if (mods.autoFail) {
		return autoFailResult(dc, abilityMod, false, false, abilityMod);
	}

	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	const { chosen, result: diceResult } = rollD20(finalAdv);
	const total = chosen + abilityMod;

	return {
		roll: diceResult,
		abilityMod,
		proficient: false,
		expertise: false,
		bonus: abilityMod,
		total,
		dc,
		success: total >= dc,
		nat1: chosen === 1,
		nat20: chosen === 20,
		advantageState: finalAdv,
		autoFailed: false
	};
}

// ---------------------------------------------------------------------------
// Saving Throws
// ---------------------------------------------------------------------------

export function savingThrow(
	character: PlayerCharacter,
	ability: AbilityName,
	dc: number,
	overrideAdvantage?: AdvantageState
): CheckResult {
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.saveProficiencies.includes(ability);
	const bonus = abilityMod + (proficient ? character.proficiencyBonus : 0);

	const mods = resolveRollModifiers(character.conditions, 'saving-throw', ability);

	if (mods.autoFail) {
		return autoFailResult(dc, abilityMod, proficient, false, bonus);
	}

	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	const { chosen, result: diceResult } = rollD20(finalAdv);
	const total = chosen + bonus;

	return {
		roll: diceResult,
		abilityMod,
		proficient,
		expertise: false,
		bonus,
		total,
		dc,
		success: total >= dc,
		nat1: chosen === 1,
		nat20: chosen === 20,
		advantageState: finalAdv,
		autoFailed: false
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
	advantageState: AdvantageState;
}

/**
 * Parse damage notation into dice portion and modifier portion.
 * E.g. "2d8+3" → { count: 2, sides: 8, modifier: 3 }
 *      "1d6"   → { count: 1, sides: 6, modifier: 0 }
 */
function parseDamageDice(notation: string): { count: number; sides: number; modifier: number } {
	const cleaned = notation.toLowerCase().replace(/\s/g, '');
	const match = cleaned.match(/^(\d+)d(\d+)([+-]\d+)?$/);
	if (!match) return { count: 1, sides: 4, modifier: 0 };
	return {
		count: parseInt(match[1], 10),
		sides: parseInt(match[2], 10),
		modifier: match[3] ? parseInt(match[3], 10) : 0
	};
}

/**
 * Build critical hit damage notation: double the dice count, keep modifier once.
 * "2d8+3" crit → "4d8+3"
 */
function criticalDamageNotation(notation: string): string {
	const { count, sides, modifier } = parseDamageDice(notation);
	const doubled = count * 2;
	const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
	return `${doubled}d${sides}${modStr}`;
}

/**
 * Resolve an attack roll.
 *
 * @param attacker          The attacking character.
 * @param targetAc          The target's armor class.
 * @param damageDice        Damage dice notation (e.g. "1d8+3").
 * @param useAbility        Which ability governs the attack (defaults to 'str').
 * @param proficient        Whether the attacker is proficient with the weapon (default true).
 * @param overrideAdvantage Explicit advantage override (merged with condition-derived state).
 */
export function attackRoll(
	attacker: PlayerCharacter,
	targetAc: number,
	damageDice: string,
	useAbility: AbilityName = 'str',
	proficient = true,
	overrideAdvantage?: AdvantageState
): AttackResult {
	const abilityMod = abilityModifier(attacker.abilities[useAbility]);
	const attackBonus = abilityMod + (proficient ? attacker.proficiencyBonus : 0);

	// Resolve conditions
	const mods = resolveRollModifiers(attacker.conditions, 'attack', useAbility);
	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	const { chosen: rawRoll, result: atkRoll } = rollD20(finalAdv);
	const total = rawRoll + attackBonus;

	const critical = rawRoll === 20;
	const fumble = rawRoll === 1;
	const hits = critical || (!fumble && total >= targetAc);

	let damage: DiceResult | null = null;
	let totalDamage = 0;

	if (hits) {
		if (critical) {
			// Critical hit: double only the dice count, keep modifier once.
			const critNotation = criticalDamageNotation(damageDice);
			damage = roll(critNotation);
		} else {
			damage = roll(damageDice);
		}
		totalDamage = damage.total;
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
		totalDamage,
		advantageState: finalAdv
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
	/** Effective damage after resistance/immunity/vulnerability. */
	effectiveDamage: number;
	/** Whether damage was modified by resistance/immunity/vulnerability. */
	damageModified: 'normal' | 'resistant' | 'immune' | 'vulnerable';
}

/**
 * Compute effective damage after applying resistance, immunity, or vulnerability.
 *
 * @param amount           Raw damage.
 * @param damageType       Damage type (e.g. 'fire', 'slashing'). If omitted, no modification.
 * @param resistances      Damage types the target resists (half, floor).
 * @param immunities       Damage types the target is immune to (0).
 * @param vulnerabilities  Damage types the target is vulnerable to (double).
 */
export function applyDamageTypeModifiers(
	amount: number,
	damageType?: string,
	resistances: string[] = [],
	immunities: string[] = [],
	vulnerabilities: string[] = []
): { effective: number; modifier: DamageApplicationResult['damageModified'] } {
	if (!damageType) return { effective: amount, modifier: 'normal' };

	const dt = damageType.toLowerCase();
	if (immunities.map(s => s.toLowerCase()).includes(dt)) {
		return { effective: 0, modifier: 'immune' };
	}
	if (resistances.map(s => s.toLowerCase()).includes(dt)) {
		return { effective: Math.floor(amount / 2), modifier: 'resistant' };
	}
	if (vulnerabilities.map(s => s.toLowerCase()).includes(dt)) {
		return { effective: amount * 2, modifier: 'vulnerable' };
	}
	return { effective: amount, modifier: 'normal' };
}

/**
 * Apply damage to a character. Temp HP absorbs first.
 * Returns the result; does NOT mutate the character (pure function).
 *
 * @param character        The target.
 * @param amount           Raw damage amount.
 * @param damageType       Optional damage type for resistance/immunity/vulnerability.
 * @param resistances      Target's damage resistances.
 * @param immunities       Target's damage immunities.
 * @param vulnerabilities  Target's damage vulnerabilities.
 */
export function applyDamage(
	character: Pick<PlayerCharacter, 'hp' | 'maxHp' | 'tempHp'>,
	amount: number,
	damageType?: string,
	resistances: string[] = [],
	immunities: string[] = [],
	vulnerabilities: string[] = []
): DamageApplicationResult {
	const { effective, modifier } = applyDamageTypeModifiers(
		amount, damageType, resistances, immunities, vulnerabilities
	);

	let remaining = effective;
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
		dead,
		effectiveDamage: effective,
		damageModified: modifier
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
// Death Saves
// ---------------------------------------------------------------------------

/**
 * The result of a single death saving throw roll.
 */
export type DeathSaveRollResult = 'success' | 'failure' | 'critical-success' | 'critical-failure';

/**
 * Full result returned by rollDeathSave.
 */
export interface DeathSaveResult {
	roll: DiceResult;
	natural: number;
	result: DeathSaveRollResult;
}

/**
 * Roll a death saving throw (1d20, unmodified).
 *
 * - Natural 20 → critical-success (character regains 1 HP, saves reset)
 * - Natural 1 → critical-failure (counts as 2 failures)
 * - 10+ → success
 * - <10 → failure
 *
 * This is a pure roll — it does NOT mutate the character.
 * Use the functions in conditions.ts to apply the result.
 */
export function rollDeathSave(): DeathSaveResult {
	const diceResult = roll('1d20');
	const natural = diceResult.rolls[0];

	let result: DeathSaveRollResult;
	if (natural === 20) {
		result = 'critical-success';
	} else if (natural === 1) {
		result = 'critical-failure';
	} else if (natural >= 10) {
		result = 'success';
	} else {
		result = 'failure';
	}

	return { roll: diceResult, natural, result };
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
// Passive Scores
// ---------------------------------------------------------------------------

/**
 * Compute a passive score for any skill or ability.
 *
 * Passive = 10 + ability mod + proficiency (if proficient)
 *         + 5 (if advantage) − 5 (if disadvantage)
 *
 * With expertise, proficiency is doubled (as in active checks).
 */
export function passiveScore(
	character: PlayerCharacter,
	skill: SkillName,
	overrideAdvantage?: AdvantageState
): number {
	const ability = SKILL_ABILITY_MAP[skill];
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.skillProficiencies.includes(skill);
	const expertise = Array.isArray(character.expertiseSkills) && character.expertiseSkills.includes(skill);
	const profBonus = proficient
		? (expertise ? character.proficiencyBonus * 2 : character.proficiencyBonus)
		: 0;

	// Check conditions for advantage/disadvantage on skill checks
	const mods = resolveRollModifiers(character.conditions, 'skill-check', ability);
	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	let advBonus = 0;
	if (finalAdv === 'advantage') advBonus = 5;
	else if (finalAdv === 'disadvantage') advBonus = -5;

	return 10 + abilityMod + profBonus + advBonus;
}

// ---------------------------------------------------------------------------
// Contested Checks
// ---------------------------------------------------------------------------

export interface ContestedCheckResult {
	actor: CheckResult;
	opponent: CheckResult;
	winner: 'actor' | 'opponent' | 'tie';
	margin: number;
}

/**
 * Resolve a contested check between two characters.
 *
 * Each side rolls their respective skill (or ability, if `skillOrAbility`
 * is an `AbilityName`). The higher total wins. Ties go to the defender
 * (opponent), per common 5e convention.
 */
export function contestedCheck(
	actor: PlayerCharacter,
	actorSkill: SkillName,
	opponent: PlayerCharacter,
	opponentSkill: SkillName,
	overrideActorAdv?: AdvantageState,
	overrideOpponentAdv?: AdvantageState
): ContestedCheckResult {
	// We use DC 0 because there's no fixed DC — the opponent's roll IS the DC.
	const actorResult = skillCheck(actor, actorSkill, 0, overrideActorAdv);
	const opponentResult = skillCheck(opponent, opponentSkill, 0, overrideOpponentAdv);

	const margin = actorResult.total - opponentResult.total;

	// Tie goes to the opponent (defender) per 5e convention
	let winner: 'actor' | 'opponent' | 'tie';
	if (margin > 0) winner = 'actor';
	else if (margin < 0) winner = 'opponent';
	else winner = 'tie';

	return {
		actor: { ...actorResult, dc: opponentResult.total, success: margin > 0 },
		opponent: { ...opponentResult, dc: actorResult.total, success: margin <= 0 },
		winner,
		margin
	};
}

// ---------------------------------------------------------------------------
// Tool Checks
// ---------------------------------------------------------------------------

/**
 * Perform a tool proficiency check.
 *
 * This is an ability check where proficiency bonus is added if the character
 * has the named tool in their `toolProficiencies` list.
 */
export function toolCheck(
	character: PlayerCharacter,
	ability: AbilityName,
	toolName: string,
	dc: number,
	overrideAdvantage?: AdvantageState
): CheckResult {
	const abilityMod = abilityModifier(character.abilities[ability]);
	const proficient = character.toolProficiencies.includes(toolName);
	const bonus = abilityMod + (proficient ? character.proficiencyBonus : 0);

	const mods = resolveRollModifiers(character.conditions, 'ability-check', ability);

	if (mods.autoFail) {
		return autoFailResult(dc, abilityMod, proficient, false, bonus);
	}

	const finalAdv = mergeAdvantage(mods.resolvedAdvantage, overrideAdvantage);

	const { chosen, result: diceResult } = rollD20(finalAdv);
	const total = chosen + bonus;

	return {
		roll: diceResult,
		abilityMod,
		proficient,
		expertise: false,
		bonus,
		total,
		dc,
		success: total >= dc,
		nat1: chosen === 1,
		nat20: chosen === 20,
		advantageState: finalAdv,
		autoFailed: false
	};
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Merge a condition-derived advantage state with an explicit override.
 * If both advantage and disadvantage are present, they cancel to 'normal'.
 */
function mergeAdvantage(conditionAdv: AdvantageState, override?: AdvantageState): AdvantageState {
	if (!override || override === 'normal') return conditionAdv;
	if (conditionAdv === 'normal') return override;
	// Both provided and they agree → use it
	if (conditionAdv === override) return conditionAdv;
	// They disagree (one is advantage, other is disadvantage) → cancel
	return 'normal';
}

/**
 * Build a CheckResult for an auto-failed check.
 */
function autoFailResult(
	dc: number,
	abilityMod: number,
	proficient: boolean,
	expertise: boolean,
	bonus: number
): CheckResult {
	return {
		roll: { notation: '0d20', rolls: [0], total: 0 },
		abilityMod,
		proficient,
		expertise,
		bonus,
		total: 0,
		dc,
		success: false,
		nat1: false,
		nat20: false,
		advantageState: 'normal',
		autoFailed: true
	};
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
