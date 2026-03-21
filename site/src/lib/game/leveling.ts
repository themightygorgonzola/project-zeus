/**
 * Project Zeus — Character Progression (Level Up) Engine
 *
 * XP thresholds, level-up flow, HP increase, feature grants,
 * ASI/feat selection, spell progression, derived stat recalculation,
 * and multiclass foundation.
 *
 * All functions are pure — they return new state rather than mutating input.
 */

import type {
	PlayerCharacter,
	AbilityName,
	AbilityScores,
	ClassName,
	SkillName,
	SpellSlotPool,
	CharacterFeatureRef,
	ClassLevel,
	ClassSpellList
} from './types';
import { SKILL_ABILITY_MAP, CLASS_HIT_DIE, getPrimaryClass, getPrimarySpellcastingAbility, getClassEntry, getAllKnownSpells, getAllPreparedSpells, getAllCantrips, getClassSpellEntry, getTotalHitDiceRemaining, hasClass } from './types';
import { abilityModifier, levelUpHpIncrease } from './mechanics';
import {
	getClass,
	getCantripsKnown,
	getSpellSlots,
	getFeaturesAtLevel,
	isASILevel,
	XP_THRESHOLDS,
	PROFICIENCY_BONUS,
	getMulticlassSpellSlots,
	getPactSlotInfo
} from './data/classes';
import type { ClassFeature, FeatDefinition, FeatEffect, FeatPrerequisite } from './data';
import { getFeat, FEATS } from './data/feats';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum ability score in 5e (before epic boons). */
export const MAX_ABILITY_SCORE = 20;

/** Standard ASI total points: +2 to one or +1 to two. */
export const ASI_POINT_BUDGET = 2;

/** Maximum character level. */
export const MAX_LEVEL = 20;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CanLevelUpResult {
	canLevel: boolean;
	/** Number of pending level-ups (could be >1 for massive XP awards). */
	levelsAvailable: number;
	/** XP needed for the next level (0 if already at max). */
	xpForNext: number;
	/** Current character level. */
	currentLevel: number;
}

export interface ASIChoice {
	type: 'asi';
	/** Ability increases. Values should sum to ASI_POINT_BUDGET (2). Each ability ≤ +2. */
	abilities: Partial<Record<AbilityName, number>>;
}

export interface FeatChoice {
	type: 'feat';
	feat: string;
	/**
	 * Some feats (e.g. Resilient, Athlete) let you choose an ability to increase.
	 * Provide the ability name here when the feat requires a choice.
	 */
	abilityChoice?: AbilityName;
}

export interface LevelUpChoices {
	/** Which class to level up. Defaults to primary class if omitted. */
	targetClass?: ClassName;
	/** ASI or feat choice — required only if the new level is an ASI level for the target class. */
	asiOrFeat?: ASIChoice | FeatChoice;
	/** New spells to learn (for known-casters gaining new spells known). */
	newSpells?: string[];
	/** New cantrips to learn (when cantrips known increases). */
	newCantrips?: string[];
	/** For prepared casters: updated prepared spell list. Optional. */
	preparedSpells?: string[];
	/** Hit points can be rolled instead of using the average. If provided, use this value. */
	hpRoll?: number;
}

export interface LevelUpResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
	/** The level the character reached. */
	newLevel: number;
	/** HP gained this level. */
	hpGained: number;
	/** New features gained at this level. */
	newFeatures: string[];
	/** Whether this level was an ASI level. */
	isASI: boolean;
	/** New spell slots gained (if any). */
	spellSlotChanges: boolean;
}

export interface DerivedStats {
	proficiencyBonus: number;
	passivePerception: number;
	spellSaveDC: number | null;
	spellAttackBonus: number | null;
	maxPreparedSpells: number | null;
}

export interface FeatValidationResult {
	valid: boolean;
	reason?: string;
}

// ---------------------------------------------------------------------------
// Multiclass Foundation Types
// ---------------------------------------------------------------------------

export interface ClassEntry {
	name: ClassName;
	level: number;
}

export interface MulticlassInfo {
	classes: ClassEntry[];
	primaryClass: ClassName;
	totalLevel: number;
	/** Effective caster level for multiclass spell slot calculation. */
	effectiveCasterLevel: number;
}

export interface MulticlassPrereqResult {
	canMulticlass: boolean;
	/** Which ability requirements are not met. */
	failedRequirements: { ability: AbilityName; required: number; actual: number }[];
}

// ---------------------------------------------------------------------------
// XP & Level Checks
// ---------------------------------------------------------------------------

/**
 * Check how many levels a character can gain with their current XP.
 */
export function canLevelUp(character: PlayerCharacter): CanLevelUpResult {
	const current = character.level;
	if (current >= MAX_LEVEL) {
		return { canLevel: false, levelsAvailable: 0, xpForNext: 0, currentLevel: current };
	}

	let levelsAvailable = 0;
	for (let l = current + 1; l <= MAX_LEVEL; l++) {
		if (character.xp >= XP_THRESHOLDS[l - 1]) {
			levelsAvailable++;
		} else {
			break;
		}
	}

	const xpForNext = current < MAX_LEVEL ? XP_THRESHOLDS[current] : 0;
	return {
		canLevel: levelsAvailable > 0,
		levelsAvailable,
		xpForNext,
		currentLevel: current
	};
}

/**
 * Get XP required to reach a specific level.
 */
export function xpForLevel(level: number): number {
	if (level < 1 || level > MAX_LEVEL) return 0;
	return XP_THRESHOLDS[level - 1];
}

/**
 * Award XP to a character and return updated character.
 */
export function awardXP(character: PlayerCharacter, xp: number): PlayerCharacter {
	if (xp < 0) return { ...character };
	return { ...character, xp: character.xp + xp };
}

// ---------------------------------------------------------------------------
// ASI / Feat Validation
// ---------------------------------------------------------------------------

/**
 * Validate an ASI choice: points must sum to 2, each ability +1 or +2,
 * and no ability can exceed MAX_ABILITY_SCORE.
 */
export function validateASI(character: PlayerCharacter, choice: ASIChoice): FeatValidationResult {
	const entries = Object.entries(choice.abilities) as [AbilityName, number][];
	if (entries.length === 0) {
		return { valid: false, reason: 'No abilities selected for ASI.' };
	}
	const total = entries.reduce((sum, [, v]) => sum + v, 0);
	if (total !== ASI_POINT_BUDGET) {
		return { valid: false, reason: `ASI points must total ${ASI_POINT_BUDGET}, got ${total}.` };
	}
	for (const [ability, amount] of entries) {
		if (amount < 1 || amount > 2) {
			return { valid: false, reason: `Each ability increase must be 1 or 2, got ${amount} for ${ability}.` };
		}
		if (character.abilities[ability] + amount > MAX_ABILITY_SCORE) {
			return { valid: false, reason: `${ability} would exceed ${MAX_ABILITY_SCORE} (currently ${character.abilities[ability]} + ${amount}).` };
		}
	}
	return { valid: true };
}

/**
 * Check if a character meets the prerequisites for a feat.
 */
export function validateFeatPrerequisites(
	character: PlayerCharacter,
	feat: FeatDefinition
): FeatValidationResult {
	for (const prereq of feat.prerequisites) {
		if (prereq.ability) {
			const score = character.abilities[prereq.ability.name];
			if (score < prereq.ability.minimum) {
				return {
					valid: false,
					reason: `Requires ${prereq.ability.name.toUpperCase()} ${prereq.ability.minimum}, have ${score}.`
				};
			}
		}
		if (prereq.proficiency) {
			// Check armor, weapon, or tool proficiencies.
			// Match both directions: "medium" matches "medium armor" and vice-versa.
			const reqLower = prereq.proficiency.toLowerCase();
			const matches = (p: string) => {
				const pl = p.toLowerCase();
				return pl.includes(reqLower) || reqLower.includes(pl);
			};
			const hasProficiency =
				character.armorProficiencies.some(matches) ||
				character.weaponProficiencies.some(matches) ||
				character.toolProficiencies.some(matches);
			if (!hasProficiency) {
				return { valid: false, reason: `Requires proficiency: ${prereq.proficiency}.` };
			}
		}
		if (prereq.spellcasting) {
			if (!getPrimarySpellcastingAbility(character)) {
				return { valid: false, reason: 'Requires spellcasting ability.' };
			}
		}
	}
	return { valid: true };
}

/**
 * Apply a feat's mechanical effects to a character.
 * Returns a new character with the effects applied.
 */
export function applyFeatEffects(
	character: PlayerCharacter,
	feat: FeatDefinition,
	abilityChoice?: AbilityName
): PlayerCharacter {
	let char = { ...character, abilities: { ...character.abilities } };

	for (const effect of feat.effects) {
		switch (effect.tag) {
			case 'ability-increase': {
				const ability = effect.ability;
				char.abilities[ability] = Math.min(MAX_ABILITY_SCORE, char.abilities[ability] + effect.amount);
				break;
			}
			case 'skill-proficiency': {
				if (!char.skillProficiencies.includes(effect.skill)) {
					char = { ...char, skillProficiencies: [...char.skillProficiencies, effect.skill] };
				}
				break;
			}
			case 'armor-proficiency': {
				if (!char.armorProficiencies.includes(effect.armor)) {
					char = { ...char, armorProficiencies: [...char.armorProficiencies, effect.armor] };
				}
				break;
			}
			case 'weapon-proficiency': {
				if (!char.weaponProficiencies.includes(effect.weapon)) {
					char = { ...char, weaponProficiencies: [...char.weaponProficiencies, effect.weapon] };
				}
				break;
			}
			case 'tool-proficiency': {
				if (!char.toolProficiencies.includes(effect.tool)) {
					char = { ...char, toolProficiencies: [...char.toolProficiencies, effect.tool] };
				}
				break;
			}
			case 'hp-increase': {
				// Feats like "Tough" grant +2 HP per level
				const hpBonus = effect.amount * char.level;
				char = { ...char, maxHp: char.maxHp + hpBonus, hp: char.hp + hpBonus };
				break;
			}
			case 'cantrip-grant': {
				const csEntry = char.classSpells[0];
				if (csEntry && !csEntry.cantrips.includes(effect.spell)) {
					const updatedCS = [...char.classSpells];
					updatedCS[0] = { ...csEntry, cantrips: [...csEntry.cantrips, effect.spell] };
					char = { ...char, classSpells: updatedCS };
				}
				break;
			}
			case 'spell-grant': {
				const csEntry2 = char.classSpells[0];
				if (csEntry2 && !csEntry2.knownSpells.includes(effect.spell)) {
					const updatedCS = [...char.classSpells];
					updatedCS[0] = { ...csEntry2, knownSpells: [...csEntry2.knownSpells, effect.spell] };
					char = { ...char, classSpells: updatedCS };
				}
				break;
			}
			case 'custom':
				// Custom effects are narrative — handled by the AI narrator
				break;
		}
	}

	return char;
}

// ---------------------------------------------------------------------------
// Spell Progression
// ---------------------------------------------------------------------------

/**
 * Get the number of spells a known-caster should know at a given class level.
 * Returns null for prepared casters (who don't have a fixed "spells known" count).
 */
export function getSpellsKnown(className: ClassName, level: number): number | null {
	const cls = getClass(className);
	if (!cls?.spellcasting) return null;
	const known = cls.spellcasting.spellsKnown[level - 1];
	return known ?? null;
}

/**
 * Compute how many spells a prepared caster can prepare.
 * Formula: ability modifier + class level (minimum 1).
 */
export function getMaxPreparedSpells(
	className: ClassName,
	level: number,
	abilityScore: number
): number | null {
	const cls = getClass(className);
	if (!cls?.spellcasting || !cls.spellcasting.preparesCasts) return null;
	return Math.max(1, abilityModifier(abilityScore) + level);
}

/**
 * Get the highest spell level a class can cast at a given class level.
 */
export function getMaxSpellLevel(className: ClassName, level: number): number {
	const slots = getSpellSlots(className, level);
	for (let i = slots.length - 1; i >= 0; i--) {
		if (slots[i] > 0) return i + 1;
	}
	return 0;
}

/**
 * Build updated spell slot pools for a class at a given level.
 */
export function buildSpellSlots(className: ClassName, level: number): SpellSlotPool[] {
	const slotArray = getSpellSlots(className, level);
	return slotArray
		.map((max, i) => ({ level: i + 1, current: max, max }))
		.filter((s) => s.max > 0);
}

/**
 * Compute spell progression changes between two levels.
 * Returns info about new cantrips and spells the character gains.
 */
export function getSpellProgression(className: ClassName, oldLevel: number, newLevel: number): {
	/** Number of new cantrips to learn. */
	newCantrips: number;
	/** Number of new spells to learn (for known-casters), or null for prepared. */
	newSpellsKnown: number | null;
	/** New max prepared count (for prepared casters), or null for known. */
	newMaxPrepared: null; // Requires ability score, computed at call site
	/** Highest spell level now available. */
	maxSpellLevel: number;
	/** Whether the character is a caster at all. */
	isCaster: boolean;
} {
	const cls = getClass(className);
	if (!cls?.spellcasting) {
		return { newCantrips: 0, newSpellsKnown: null, newMaxPrepared: null, maxSpellLevel: 0, isCaster: false };
	}

	const oldCantrips = getCantripsKnown(className, oldLevel);
	const newCantripsTotal = getCantripsKnown(className, newLevel);

	const oldKnown = cls.spellcasting.spellsKnown[oldLevel - 1];
	const newKnown = cls.spellcasting.spellsKnown[newLevel - 1];
	let newSpellsKnown: number | null = null;
	if (oldKnown !== null && newKnown !== null) {
		newSpellsKnown = newKnown - oldKnown;
	}

	return {
		newCantrips: newCantripsTotal - oldCantrips,
		newSpellsKnown,
		newMaxPrepared: null,
		maxSpellLevel: getMaxSpellLevel(className, newLevel),
		isCaster: true
	};
}

// ---------------------------------------------------------------------------
// Derived Stats
// ---------------------------------------------------------------------------

/**
 * Recalculate all derived stats after a level-up or ability change.
 */
export function recalculateDerivedStats(character: PlayerCharacter): DerivedStats {
	const profBonus = PROFICIENCY_BONUS[character.level - 1] ?? 2;

	const wisMod = abilityModifier(character.abilities.wis);
	const perceptionProf = character.skillProficiencies.includes('perception') ? profBonus : 0;
	const passivePerception = 10 + wisMod + perceptionProf;

	let spellSaveDC: number | null = null;
	let spellAttackBonus: number | null = null;
	let maxPreparedSpells: number | null = null;

	const spellAbility = getPrimarySpellcastingAbility(character);
	if (spellAbility) {
		const castMod = abilityModifier(character.abilities[spellAbility]);
		spellSaveDC = 8 + profBonus + castMod;
		spellAttackBonus = profBonus + castMod;

		// Compute max prepared spells across all prepared-caster classes
		// Each class uses: ability modifier + CLASS level (minimum 1)
		let totalPrepared = 0;
		let hasPreparedCaster = false;
		for (const classEntry of character.classes) {
			const cls = getClass(classEntry.name);
			if (cls?.spellcasting?.preparesCasts) {
				hasPreparedCaster = true;
				const csEntry = character.classSpells.find(cs => cs.className === classEntry.name);
				const abilityMod = csEntry
					? abilityModifier(character.abilities[csEntry.spellcastingAbility])
					: castMod;
				totalPrepared += Math.max(1, abilityMod + classEntry.level);
			}
		}
		if (hasPreparedCaster) {
			maxPreparedSpells = totalPrepared;
		}
	}

	return {
		proficiencyBonus: profBonus,
		passivePerception,
		spellSaveDC,
		spellAttackBonus,
		maxPreparedSpells
	};
}

/**
 * Apply derived stats to a character, returning a new character.
 */
export function applyDerivedStats(character: PlayerCharacter): PlayerCharacter {
	const stats = recalculateDerivedStats(character);
	return {
		...character,
		proficiencyBonus: stats.proficiencyBonus,
		passivePerception: stats.passivePerception
	};
}

// ---------------------------------------------------------------------------
// Level Up — Core
// ---------------------------------------------------------------------------

/**
 * Get the new features gained at a specific level (not cumulative — just this level).
 */
export function getNewFeatures(className: ClassName, level: number, includeSubclass = true): ClassFeature[] {
	const cls = getClass(className);
	if (!cls) return [];
	const features = cls.features.filter((f) => f.level === level);
	if (includeSubclass && level >= cls.subclassLevel) {
		features.push(...cls.subclass.features.filter((f) => f.level === level));
	}
	return features;
}

/**
 * Apply a single level-up to a character.
 *
 * Supports multiclass: specify `choices.targetClass` to level a specific class.
 * If the target class is new (not yet in `character.classes`), multiclass prereqs
 * are enforced and multiclass proficiency grants are applied.
 *
 * This function:
 * - Increments total level and target class level
 * - Increases max HP using the target class's hit die
 * - Adds new class features at the target class's new level
 * - Recalculates proficiency bonus and derived stats
 * - Updates spell slots (multiclass-aware)
 * - Handles ASI or feat choice (based on target CLASS level, not total level)
 * - Updates cantrips and spells known for the target class
 */
export function applyLevelUp(
	character: PlayerCharacter,
	choices: LevelUpChoices = {}
): LevelUpResult {
	const failResult = (reason: string): LevelUpResult => ({
		success: false,
		reason,
		character: { ...character },
		newLevel: character.level,
		hpGained: 0,
		newFeatures: [],
		isASI: false,
		spellSlotChanges: false
	});

	// Validate level cap
	if (character.level >= MAX_LEVEL) {
		return failResult(`Already at maximum level (${MAX_LEVEL}).`);
	}

	// Validate can level
	const levelCheck = canLevelUp(character);
	if (!levelCheck.canLevel) {
		return failResult(`Insufficient XP. Need ${levelCheck.xpForNext}, have ${character.xp}.`);
	}

	const oldTotalLevel = character.level;
	const newTotalLevel = oldTotalLevel + 1;
	const targetClassName = choices.targetClass ?? getPrimaryClass(character);
	const isNewClass = !hasClass(character, targetClassName);

	// If adding a brand-new class, enforce multiclass prerequisites
	if (isNewClass) {
		// Must also meet prereqs for LEAVING primary class
		const leaveCheck = checkMulticlassPrereqs(character, getPrimaryClass(character));
		if (!leaveCheck.canMulticlass) {
			const failed = leaveCheck.failedRequirements.map(r => `${r.ability.toUpperCase()} ${r.required} (have ${r.actual})`).join(', ');
			return failResult(`Cannot multiclass out of ${getPrimaryClass(character)}: unmet prerequisites — ${failed}.`);
		}
		const enterCheck = checkMulticlassPrereqs(character, targetClassName);
		if (!enterCheck.canMulticlass) {
			const failed = enterCheck.failedRequirements.map(r => `${r.ability.toUpperCase()} ${r.required} (have ${r.actual})`).join(', ');
			return failResult(`Cannot multiclass into ${targetClassName}: unmet prerequisites — ${failed}.`);
		}
	}

	const targetClassDef = getClass(targetClassName);

	// Start building the new character
	let char: PlayerCharacter = {
		...character,
		abilities: { ...character.abilities },
		classes: character.classes.map((c) => ({ ...c })),
		classFeatures: [...character.classFeatures],
		feats: [...character.feats],
		skillProficiencies: [...character.skillProficiencies],
		armorProficiencies: [...character.armorProficiencies],
		weaponProficiencies: [...character.weaponProficiencies],
		toolProficiencies: [...character.toolProficiencies],
		spellSlots: character.spellSlots.map((s) => ({ ...s })),
		pactSlots: character.pactSlots.map((s) => ({ ...s })),
		classSpells: character.classSpells.map((cs) => ({
			...cs,
			cantrips: [...cs.cantrips],
			knownSpells: [...cs.knownSpells],
			preparedSpells: [...cs.preparedSpells]
		})),
		conditions: [...character.conditions],
		resistances: [...character.resistances],
		inventory: character.inventory.map((i) => ({ ...i })),
		attunedItems: [...character.attunedItems],
		featureUses: { ...character.featureUses }
	};

	// 1. New class entry or increment existing
	let newClassLevel: number;
	if (isNewClass) {
		newClassLevel = 1;
		char.classes.push({
			name: targetClassName,
			level: 1,
			hitDiceRemaining: 1
		});

		// Apply multiclass proficiency grants
		if (targetClassDef) {
			const grants = targetClassDef.multiclassGrants;
			for (const armor of grants.armor) {
				if (!char.armorProficiencies.includes(armor)) {
					char.armorProficiencies.push(armor);
				}
			}
			for (const weapon of grants.weapons) {
				if (!char.weaponProficiencies.includes(weapon)) {
					char.weaponProficiencies.push(weapon);
				}
			}
			for (const tool of grants.tools) {
				if (!char.toolProficiencies.includes(tool)) {
					char.toolProficiencies.push(tool);
				}
			}
		}

		// Add ClassSpellList entry if the new class is a caster
		if (targetClassDef?.spellcasting && targetClassDef.spellcasting.style !== 'none') {
			char.classSpells.push({
				className: targetClassName,
				spellcastingAbility: targetClassDef.spellcasting.ability,
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			});

			// Warlock: set up pact slots
			if (targetClassDef.spellcasting.style === 'pact') {
				const pactInfo = getPactSlotInfo(1);
				if (pactInfo) {
					char.pactSlots = [{ level: pactInfo.slotLevel, current: pactInfo.count, max: pactInfo.count }];
				}
			}
		}
	} else {
		const entry = char.classes.find((c) => c.name === targetClassName);
		if (entry) {
			entry.level += 1;
			entry.hitDiceRemaining += 1;
			newClassLevel = entry.level;
		} else {
			newClassLevel = 1;
		}
	}

	// 2. Update total level
	char.level = newTotalLevel;

	// 3. HP increase (uses TARGET class hit die)
	let hpGained: number;
	if (choices.hpRoll !== undefined && choices.hpRoll > 0) {
		const maxRoll = targetClassDef?.hitDie ?? CLASS_HIT_DIE[targetClassName] ?? 6;
		hpGained = Math.min(choices.hpRoll, maxRoll) + abilityModifier(char.abilities.con);
		hpGained = Math.max(1, hpGained);
	} else if (isNewClass) {
		// First level in a new class: use average for that class's hit die
		hpGained = levelUpHpIncrease(targetClassName, char.abilities.con);
		hpGained = Math.max(1, hpGained);
	} else {
		hpGained = levelUpHpIncrease(targetClassName, char.abilities.con);
		hpGained = Math.max(1, hpGained);
	}
	char.maxHp += hpGained;
	char.hp += hpGained;

	// 4. Proficiency bonus based on TOTAL level
	char.proficiencyBonus = PROFICIENCY_BONUS[newTotalLevel - 1] ?? 2;

	// 5. New class features (at the target CLASS level, not total level)
	const newFeatures = getNewFeatures(targetClassName, newClassLevel);
	const newFeatureNames: string[] = [];
	for (const feat of newFeatures) {
		if (feat.tags.includes('asi')) continue;

		const ref: CharacterFeatureRef = {
			name: feat.name,
			level: feat.level,
			source: 'class',
			sourceClass: targetClassName,
			description: feat.description
		};
		char.classFeatures.push(ref);
		newFeatureNames.push(feat.name);
	}

	// 6. Handle ASI / Feat (based on target CLASS level)
	const isASI = isASILevelForClass(targetClassName, newClassLevel);
	if (isASI && choices.asiOrFeat) {
		if (choices.asiOrFeat.type === 'asi') {
			const validation = validateASI(char, choices.asiOrFeat);
			if (!validation.valid) {
				return failResult(`Invalid ASI: ${validation.reason}`);
			}
			const entries = Object.entries(choices.asiOrFeat.abilities) as [AbilityName, number][];
			for (const [ability, amount] of entries) {
				char.abilities[ability] = Math.min(MAX_ABILITY_SCORE, char.abilities[ability] + amount);
			}
		} else if (choices.asiOrFeat.type === 'feat') {
			const featDef = getFeat(choices.asiOrFeat.feat);
			if (!featDef) {
				return failResult(`Unknown feat: "${choices.asiOrFeat.feat}".`);
			}
			const prereqCheck = validateFeatPrerequisites(char, featDef);
			if (!prereqCheck.valid) {
				return failResult(`Feat prerequisite not met: ${prereqCheck.reason}`);
			}
			char = applyFeatEffects(char, featDef, choices.asiOrFeat.abilityChoice);
			char.feats = [...char.feats, featDef.name];
		}
	}

	// 7. Spell progression — multiclass-aware slot computation
	let spellSlotChanges = false;
	const hasMutipleCasterClasses = char.classes.filter(c => {
		const cd = getClass(c.name);
		return cd?.spellcasting && cd.spellcasting.style !== 'none' && cd.spellcasting.style !== 'pact';
	}).length > 1;

	if (hasMutipleCasterClasses) {
		// Multiclass caster: use shared multiclass spell slot table
		const newSlotArray = getMulticlassSpellSlots(char.classes);
		const newSlots: SpellSlotPool[] = newSlotArray
			.map((max, i) => ({ level: i + 1, current: max, max }))
			.filter((s) => s.max > 0);

		// Merge: keep current usage, expand max
		const mergedSlots: SpellSlotPool[] = newSlots.map((ns) => {
			const old = char.spellSlots.find((s) => s.level === ns.level);
			if (old) {
				const gained = ns.max - old.max;
				return {
					level: ns.level,
					max: ns.max,
					current: Math.min(ns.max, old.current + Math.max(0, gained))
				};
			}
			return ns;
		});

		if (JSON.stringify(mergedSlots) !== JSON.stringify(char.spellSlots)) {
			spellSlotChanges = true;
		}
		char.spellSlots = mergedSlots;
	} else {
		// Single caster class (or non-caster): use that class's own slot table
		const casterEntry = char.classes.find(c => {
			const cd = getClass(c.name);
			return cd?.spellcasting && cd.spellcasting.style !== 'none' && cd.spellcasting.style !== 'pact';
		});

		if (casterEntry) {
			const newSlots = buildSpellSlots(casterEntry.name, casterEntry.level);
			const mergedSlots: SpellSlotPool[] = newSlots.map((ns) => {
				const old = char.spellSlots.find((s) => s.level === ns.level);
				if (old) {
					const gained = ns.max - old.max;
					return {
						level: ns.level,
						max: ns.max,
						current: Math.min(ns.max, old.current + Math.max(0, gained))
					};
				}
				return ns;
			});

			if (JSON.stringify(mergedSlots) !== JSON.stringify(char.spellSlots)) {
				spellSlotChanges = true;
			}
			char.spellSlots = mergedSlots;
		}
	}

	// Pact slot progression (Warlock)
	const warlockEntry = char.classes.find(c => c.name === 'warlock');
	if (warlockEntry && targetClassName === 'warlock') {
		const pactInfo = getPactSlotInfo(warlockEntry.level);
		if (pactInfo) {
			char.pactSlots = [{ level: pactInfo.slotLevel, current: pactInfo.count, max: pactInfo.count }];
		}
	}

	// Per-class spell list updates (cantrips, known spells, prepared spells)
	const targetSpellEntry = char.classSpells.find((cs) => cs.className === targetClassName);
	if (targetSpellEntry) {
		if (choices.newCantrips && choices.newCantrips.length > 0) {
			for (const cantrip of choices.newCantrips) {
				if (!targetSpellEntry.cantrips.includes(cantrip)) {
					targetSpellEntry.cantrips.push(cantrip);
				}
			}
		}

		if (choices.newSpells && choices.newSpells.length > 0) {
			for (const spell of choices.newSpells) {
				if (!targetSpellEntry.knownSpells.includes(spell)) {
					targetSpellEntry.knownSpells.push(spell);
				}
			}
		}

		if (choices.preparedSpells) {
			targetSpellEntry.preparedSpells = [...choices.preparedSpells];
		}
	}

	// 8. Recalculate derived stats
	char = applyDerivedStats(char);

	return {
		success: true,
		character: char,
		newLevel: newTotalLevel,
		hpGained,
		newFeatures: newFeatureNames,
		isASI: isASI,
		spellSlotChanges
	};
}

// ---------------------------------------------------------------------------
// Convenience: multi-level up
// ---------------------------------------------------------------------------

/**
 * Apply multiple level-ups in sequence—useful when massive XP skips levels.
 * Only the first level can use detailed choices; subsequent levels use defaults.
 */
export function applyMultipleLevelUps(
	character: PlayerCharacter,
	choicesPerLevel: LevelUpChoices[] = []
): LevelUpResult[] {
	const results: LevelUpResult[] = [];
	let current = { ...character };

	const available = canLevelUp(character);
	for (let i = 0; i < available.levelsAvailable; i++) {
		const choices = choicesPerLevel[i] ?? {};
		const result = applyLevelUp(current, choices);
		results.push(result);
		if (!result.success) break;
		current = result.character;
	}
	return results;
}

// ---------------------------------------------------------------------------
// Multiclass Foundation
// ---------------------------------------------------------------------------

/**
 * Check whether a character's ability scores meet the prerequisites
 * to multiclass INTO a given class (all prerequisite abilities must be ≥ 13).
 */
export function checkMulticlassPrereqs(
	character: PlayerCharacter,
	targetClass: ClassName
): MulticlassPrereqResult {
	const cls = getClass(targetClass);
	if (!cls) {
		return { canMulticlass: false, failedRequirements: [] };
	}

	const failed: { ability: AbilityName; required: number; actual: number }[] = [];
	for (const ability of cls.multiclassPrereqs) {
		if (character.abilities[ability] < 13) {
			failed.push({ ability, required: 13, actual: character.abilities[ability] });
		}
	}

	return {
		canMulticlass: failed.length === 0,
		failedRequirements: failed
	};
}

/**
 * Compute the effective caster level for a multiclass character
 * using the 5e multiclass spellcasting rules.
 *
 * Full caster levels count fully, half caster levels count as half (rounded down),
 * third caster levels count as a third (rounded down).
 * Pact magic (Warlock) is tracked separately and doesn't contribute.
 */
export function computeMulticlassCasterLevel(classes: ClassEntry[]): number {
	let total = 0;
	for (const entry of classes) {
		const cls = getClass(entry.name);
		if (!cls?.spellcasting) continue;
		switch (cls.spellcasting.style) {
			case 'full':
				total += entry.level;
				break;
			case 'half':
				total += Math.floor(entry.level / 2);
				break;
			case 'third':
				total += Math.floor(entry.level / 3);
				break;
			// 'pact' and 'none' don't contribute to multiclass caster level
		}
	}
	return total;
}

/**
 * Build a MulticlassInfo from a character's current class setup.
 * For single-class characters, creates a single entry.
 */
export function buildMulticlassInfo(character: PlayerCharacter): MulticlassInfo {
	const classes: ClassEntry[] = character.classes.map((c) => ({ name: c.name, level: c.level }));
	return {
		classes,
		primaryClass: getPrimaryClass(character),
		totalLevel: character.level,
		effectiveCasterLevel: computeMulticlassCasterLevel(classes)
	};
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a given level is an ASI level for the character's class.
 */
function isASILevelForClass(className: ClassName, level: number): boolean {
	return isASILevel(className, level);
}
