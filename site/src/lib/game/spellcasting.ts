/**
 * Project Zeus — Spellcasting Engine
 *
 * Slot management, concentration, save DCs, spell attacks, ritual casting,
 * cantrip scaling, and upcast resolution. All functions are pure (no DB,
 * no side effects) and deterministic when used with a seeded PRNG.
 *
 * Phase D of the Content-Complete Push.
 */

import type {
	AbilityName,
	ClassName,
	Condition,
	DiceResult,
	PlayerCharacter,
	StateChange
} from './types';
import {
	getPrimarySpellcastingAbility,
	getAllCantrips,
	getAllKnownSpells,
	getAllPreparedSpells,
	getPrimaryClass,
	hasClass,
	getClassSpellEntry
} from './types';
import {
	abilityModifier,
	roll,
	savingThrow,
	type CheckResult
} from './mechanics';
import {
	getSpell,
	getClass,
	type SpellDefinition,
	type SpellcastingConfig
} from './data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Whether the character can cast a given spell. */
export interface CanCastResult {
	canCast: boolean;
	reason?: string;
	/** The slot level that would be consumed (undefined for cantrips). */
	slotToUse?: number;
}

/** Result of a full spell cast. */
export interface SpellCastResult {
	spell: SpellDefinition;
	slotUsed: number | null;
	damage: DiceResult | null;
	healing: DiceResult | null;
	saveDC: number | null;
	savingThrowAbility: AbilityName | null;
	concentrationStarted: boolean;
	concentrationDropped: string | null;
	isRitual: boolean;
	stateChange: StateChange;
}

/** Result of a concentration check. */
export interface ConcentrationCheckResult {
	check: CheckResult;
	dc: number;
	maintained: boolean;
	droppedSpell: string | null;
}

/** Result of ritual casting. */
export interface RitualCastResult {
	spell: SpellDefinition;
	stateChange: StateChange;
}

// ---------------------------------------------------------------------------
// Spell Save DC & Spell Attack Bonus
// ---------------------------------------------------------------------------

/**
 * Get a caster's spell save DC.
 * `8 + proficiency bonus + spellcasting ability modifier`
 *
 * Returns 0 if the character has no spellcasting ability.
 * For multiclass, uses the primary class's casting ability.
 */
export function getSpellSaveDC(character: PlayerCharacter): number {
	const ability = getPrimarySpellcastingAbility(character);
	if (!ability) return 0;
	return 8 + character.proficiencyBonus + abilityModifier(character.abilities[ability]);
}

/**
 * Get the spell save DC for a specific class's spellcasting.
 * Useful for multiclass characters whose classes use different abilities.
 *
 * Returns 0 if the class has no spellcasting.
 */
export function getSpellSaveDCForClass(character: PlayerCharacter, className: ClassName): number {
	const csEntry = getClassSpellEntry(character, className);
	if (!csEntry) return 0;
	return 8 + character.proficiencyBonus + abilityModifier(character.abilities[csEntry.spellcastingAbility]);
}

/**
 * Get a caster's spell attack bonus.
 * `proficiency bonus + spellcasting ability modifier`
 *
 * Returns 0 if the character has no spellcasting ability.
 */
export function getSpellAttackBonus(character: PlayerCharacter): number {
	const ability = getPrimarySpellcastingAbility(character);
	if (!ability) return 0;
	return character.proficiencyBonus + abilityModifier(character.abilities[ability]);
}

/**
 * Get the spell attack bonus for a specific class's spellcasting.
 *
 * Returns 0 if the class has no spellcasting.
 */
export function getSpellAttackBonusForClass(character: PlayerCharacter, className: ClassName): number {
	const csEntry = getClassSpellEntry(character, className);
	if (!csEntry) return 0;
	return character.proficiencyBonus + abilityModifier(character.abilities[csEntry.spellcastingAbility]);
}

// ---------------------------------------------------------------------------
// Slot Management
// ---------------------------------------------------------------------------

/**
 * Check whether a character can cast a given spell.
 *
 * Validates:
 *   (a) The spell exists in the database.
 *   (b) The character knows/has prepared the spell (cantrips, known, or prepared list).
 *   (c) Has a standard slot or pact slot at the required level or higher.
 *   (d) If already concentrating and the new spell requires concentration,
 *       the cast is still allowed — old concentration will be dropped.
 *   (e) Character is not dead.
 *
 * Pact slots are checked alongside standard slots. The system prefers standard
 * slots but will use pact slots if no standard slot is available.
 *
 * @param slotLevel — Force the slot level used (for upcasting). Must be ≥ spell level.
 */
export function canCastSpell(
	character: PlayerCharacter,
	spellName: string,
	slotLevel?: number
): CanCastResult {
	if (character.dead) {
		return { canCast: false, reason: 'Character is dead' };
	}

	const spell = getSpell(spellName);
	if (!spell) {
		return { canCast: false, reason: `Unknown spell: ${spellName}` };
	}

	// Cantrips: no slots needed, just check the character knows it
	if (spell.level === 0) {
		const hasCantrip = getAllCantrips(character).some(c => normalizeSpellName(c) === spell.name);
		if (!hasCantrip) {
			return { canCast: false, reason: `${spell.displayName} is not in your cantrip list` };
		}
		return { canCast: true, slotToUse: undefined };
	}

	// Leveled spell: check known or prepared
	const isKnown = getAllKnownSpells(character).some(s => normalizeSpellName(s) === spell.name);
	const isPrepared = getAllPreparedSpells(character).some(s => normalizeSpellName(s) === spell.name);
	if (!isKnown && !isPrepared) {
		return { canCast: false, reason: `${spell.displayName} is not known or prepared` };
	}

	// Determine the slot level to use
	const targetLevel = slotLevel ?? spell.level;
	if (targetLevel < spell.level) {
		return { canCast: false, reason: `Cannot cast ${spell.displayName} at slot level ${targetLevel} (minimum: ${spell.level})` };
	}

	// Check standard slots first, then pact slots
	const availableSlot = findAvailableSlot(character, targetLevel);
	const availablePact = findAvailablePactSlot(character, targetLevel);
	if (availableSlot === null && availablePact === null) {
		return { canCast: false, reason: `No spell slot available at level ${targetLevel} or higher` };
	}

	// Prefer standard slot; fall back to pact slot
	const slotToUse = availableSlot ?? availablePact!;
	return { canCast: true, slotToUse };
}

/**
 * Expend a spell slot at the given level.
 *
 * Checks standard spell slots first; if none available at that level,
 * checks pact slots. Mutates the character in-place.
 */
export function expendSpellSlot(
	character: PlayerCharacter,
	level: number
): { success: boolean; remaining: number; reason?: string; pactSlotUsed?: boolean } {
	// Try standard slots first
	const slot = character.spellSlots.find(s => s.level === level);
	if (slot && slot.current > 0) {
		slot.current -= 1;
		return { success: true, remaining: slot.current, pactSlotUsed: false };
	}

	// Try pact slots
	const pactSlot = character.pactSlots.find(s => s.level === level);
	if (pactSlot && pactSlot.current > 0) {
		pactSlot.current -= 1;
		return { success: true, remaining: pactSlot.current, pactSlotUsed: true };
	}

	// If there's a standard slot pool but it's empty, report that
	if (slot) {
		return { success: false, remaining: 0, reason: `No slots remaining at level ${level}` };
	}
	if (pactSlot) {
		return { success: false, remaining: 0, reason: `No pact slots remaining at level ${level}` };
	}

	return { success: false, remaining: 0, reason: `No slot pool at level ${level}` };
}

// ---------------------------------------------------------------------------
// Full Spell Cast
// ---------------------------------------------------------------------------

/**
 * Cast a spell — full orchestration.
 *
 * Flow:
 * 1. Validate via canCastSpell()
 * 2. Expend slot (if leveled)
 * 3. Drop existing concentration if the new spell requires it
 * 4. Mark concentration if applicable
 * 5. Resolve damage/healing dice (with upcast scaling)
 * 6. Compute save DC for save-based spells
 * 7. Return SpellCastResult with state changes and narrative hints
 *
 * Mutates character in-place (spell slots, concentratingOn).
 *
 * @throws if canCastSpell returns false (caller should check first)
 */
export function castSpell(
	character: PlayerCharacter,
	spellName: string,
	slotLevel?: number
): SpellCastResult {
	const canCast = canCastSpell(character, spellName, slotLevel);
	if (!canCast.canCast) {
		throw new Error(`Cannot cast spell: ${canCast.reason}`);
	}

	const spell = getSpell(spellName)!;
	const isCantrip = spell.level === 0;
	let slotUsed: number | null = null;
	let concentrationDropped: string | null = null;
	const stateChange: StateChange = {};

	// 1. Expend slot (if leveled)
	if (!isCantrip && canCast.slotToUse !== undefined) {
		slotUsed = canCast.slotToUse;
		expendSpellSlot(character, slotUsed);
		stateChange.spellSlotUsed = {
			characterId: character.id,
			level: slotUsed,
			spellName: spell.name
		};
	}

	// 2. Handle concentration
	let concentrationStarted = false;
	if (spell.concentration) {
		// Drop existing concentration
		if (character.concentratingOn) {
			concentrationDropped = character.concentratingOn;
		}
		character.concentratingOn = spell.name;
		concentrationStarted = true;
	}

	// 3. Resolve damage
	let damage: DiceResult | null = null;
	if (spell.damage) {
		if (isCantrip) {
			const scaledNotation = cantripDamageAtLevel(spell.name, character.level);
			if (scaledNotation) {
				damage = roll(scaledNotation);
			}
		} else if (slotUsed !== null && slotUsed > spell.level && spell.higherLevels) {
			const upcastNotation = resolveSpellUpcast(spell, slotUsed);
			if (upcastNotation) {
				damage = roll(upcastNotation);
			} else {
				damage = rollSpellDamage(spell.damage);
			}
		} else {
			damage = rollSpellDamage(spell.damage);
		}
	}

	// 4. Resolve healing
	let healing: DiceResult | null = null;
	if (spell.healing) {
		const healNotation = resolveHealingNotation(spell, character, slotUsed);
		if (healNotation) {
			healing = roll(healNotation);
		}
	}

	// 5. Save DC
	let saveDC: number | null = null;
	let savingThrowAbility: AbilityName | null = null;
	if (spell.savingThrow) {
		saveDC = getSpellSaveDC(character);
		savingThrowAbility = spell.savingThrow;
	}

	return {
		spell,
		slotUsed,
		damage,
		healing,
		saveDC,
		savingThrowAbility,
		concentrationStarted,
		concentrationDropped,
		isRitual: false,
		stateChange
	};
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

/**
 * Make a concentration check when a concentrating character takes damage.
 *
 * DC = max(10, floor(damageTaken / 2)).
 * Uses a CON saving throw. On failure, concentration drops.
 *
 * Mutates character.concentratingOn on failure.
 */
export function concentrationCheck(
	character: PlayerCharacter,
	damageTaken: number
): ConcentrationCheckResult {
	const dc = Math.max(10, Math.floor(damageTaken / 2));
	const check = savingThrow(character, 'con', dc);

	let droppedSpell: string | null = null;
	if (!check.success) {
		droppedSpell = character.concentratingOn;
		character.concentratingOn = null;
	}

	return {
		check,
		dc,
		maintained: check.success,
		droppedSpell
	};
}

/**
 * Drop concentration manually (for any reason — casting a new concentration
 * spell, choosing to end it, etc.).
 *
 * Returns the spell that was dropped, or null if not concentrating.
 * Mutates character.concentratingOn.
 */
export function dropConcentration(character: PlayerCharacter): string | null {
	const dropped = character.concentratingOn;
	character.concentratingOn = null;
	return dropped;
}

// ---------------------------------------------------------------------------
// Cantrip Damage Scaling
// ---------------------------------------------------------------------------

/**
 * 5e cantrip damage scaling: base dice at level 1, then additional dice
 * at character levels 5, 11, and 17.
 *
 * Level 1-4:  1× base dice
 * Level 5-10: 2× base dice
 * Level 11-16: 3× base dice
 * Level 17+: 4× base dice
 *
 * Parses the damage notation from the SpellDefinition and returns the
 * scaled notation string, or null if the cantrip has no damage.
 */
export function cantripDamageAtLevel(spellName: string, characterLevel: number): string | null {
	const spell = getSpell(spellName);
	if (!spell || spell.level !== 0 || !spell.damage) return null;

	const multiplier = cantripDiceMultiplier(characterLevel);
	return scaleDamageNotation(spell.damage, multiplier);
}

/**
 * Get the cantrip dice multiplier for a given character level.
 */
export function cantripDiceMultiplier(characterLevel: number): number {
	if (characterLevel >= 17) return 4;
	if (characterLevel >= 11) return 3;
	if (characterLevel >= 5) return 2;
	return 1;
}

// ---------------------------------------------------------------------------
// Ritual Casting
// ---------------------------------------------------------------------------

/**
 * Attempt to ritual-cast a spell.
 *
 * Validates:
 *   - The spell has `ritual: true`
 *   - The character's class supports ritual casting
 *   - The character knows/has prepared the spell
 *   - Character is not dead
 *
 * No slot is consumed. Adds 10 minutes to casting time.
 *
 * Mutates: nothing (ritual casts don't consume resources or start concentration —
 * if the ritual spell is concentration, it DOES start concentration).
 */
export function ritualCast(
	character: PlayerCharacter,
	spellName: string
): { success: boolean; result?: RitualCastResult; reason?: string } {
	if (character.dead) {
		return { success: false, reason: 'Character is dead' };
	}

	const spell = getSpell(spellName);
	if (!spell) {
		return { success: false, reason: `Unknown spell: ${spellName}` };
	}

	if (!spell.ritual) {
		return { success: false, reason: `${spell.displayName} cannot be cast as a ritual` };
	}

	// Check class supports ritual casting — check ALL classes for ritual capability
	let canRitualCast = false;
	for (const classEntry of character.classes) {
		const classDef = getClass(classEntry.name);
		if (classDef?.spellcasting?.ritual) {
			canRitualCast = true;
			break;
		}
	}
	if (!canRitualCast) {
		const primaryDef = getClass(getPrimaryClass(character));
		return { success: false, reason: `${primaryDef?.displayName ?? getPrimaryClass(character)} cannot ritual cast` };
	}

	// Character must know/have the spell
	const isKnown = getAllKnownSpells(character).some(s => normalizeSpellName(s) === spell.name);
	const isPrepared = getAllPreparedSpells(character).some(s => normalizeSpellName(s) === spell.name);
	const isCantrip = getAllCantrips(character).some(c => normalizeSpellName(c) === spell.name);
	if (!isKnown && !isPrepared && !isCantrip) {
		return { success: false, reason: `${spell.displayName} is not known or prepared` };
	}

	// Handle concentration if the ritual spell requires it
	if (spell.concentration) {
		character.concentratingOn = spell.name;
	}

	const stateChange: StateChange = {};

	return {
		success: true,
		result: {
			spell,
			stateChange
		}
	};
}

// ---------------------------------------------------------------------------
// Upcast Resolution
// ---------------------------------------------------------------------------

/**
 * Parse a spell's `higherLevels` text to determine the adjusted damage
 * notation when upcasting.
 *
 * Supports common SRD patterns:
 *   - "Damage increases by XdY for each slot level above Nth."
 *   - "Create one more dart for each slot level above 1st." (magic missile)
 *
 * Returns the adjusted damage notation with the bonus dice added,
 * or null if the higher-level text can't be mechanically parsed.
 */
export function resolveSpellUpcast(spell: SpellDefinition, slotLevel: number): string | null {
	if (!spell.higherLevels || !spell.damage || slotLevel <= spell.level) return null;

	const levelsAbove = slotLevel - spell.level;

	// Pattern: "Damage increases by XdY for each slot level above Nth."
	const damageIncrease = spell.higherLevels.match(/(?:damage|healing)\s+increases?\s+by\s+(\d+d\d+)\s+for\s+each\s+slot\s+level/i);
	if (damageIncrease) {
		const bonusDice = damageIncrease[1]; // e.g. "1d6"
		const bonusMatch = bonusDice.match(/^(\d+)d(\d+)$/);
		if (bonusMatch) {
			const bonusCount = parseInt(bonusMatch[1], 10) * levelsAbove;
			const bonusSides = parseInt(bonusMatch[2], 10);

			// Parse the base damage notation
			const baseParsed = parseDamageNotation(spell.damage);
			if (baseParsed) {
				const newCount = baseParsed.count + bonusCount;
				let notation = `${newCount}d${baseParsed.sides}`;
				if (baseParsed.modifier !== 0) {
					notation += baseParsed.modifier > 0 ? `+${baseParsed.modifier}` : `${baseParsed.modifier}`;
				}
				return notation;
			}
		}
	}

	// Pattern: "Create one more dart/ray for each slot level above Nth." (Magic Missile, Scorching Ray)
	const moreProjectile = spell.higherLevels.match(/(?:one\s+(?:more|additional)\s+(?:dart|ray|missile|beam))\s+for\s+each\s+slot\s+level/i);
	if (moreProjectile) {
		// Magic missile: "3 x (1d4 + 1) force" → add levelsAbove more projectiles
		const multiMatch = spell.damage.match(/^(\d+)\s*x\s*\((.+?)\)\s*(\w+)$/i);
		if (multiMatch) {
			const baseProjectiles = parseInt(multiMatch[1], 10);
			const projectileDamage = multiMatch[2]; // "1d4 + 1"
			const newProjectiles = baseProjectiles + levelsAbove;
			// Return the total number of projectiles × individual damage
			// We express this as total dice for rolling
			const projParsed = parseDamageNotation(projectileDamage.replace(/\s/g, ''));
			if (projParsed) {
				const totalCount = projParsed.count * newProjectiles;
				let notation = `${totalCount}d${projParsed.sides}`;
				const totalMod = projParsed.modifier * newProjectiles;
				if (totalMod !== 0) {
					notation += totalMod > 0 ? `+${totalMod}` : `${totalMod}`;
				}
				return notation;
			}
		}
	}

	// Pattern: "Damage increases by 1d8 every two slot levels above 2nd." (Spiritual Weapon)
	const everyTwoLevels = spell.higherLevels.match(/(?:damage|healing)\s+increases?\s+by\s+(\d+d\d+)\s+(?:for\s+)?every\s+two\s+slot\s+levels?\s+above/i);
	if (everyTwoLevels) {
		const bonusDice = everyTwoLevels[1];
		const bonusMatch = bonusDice.match(/^(\d+)d(\d+)$/);
		if (bonusMatch) {
			const steps = Math.floor(levelsAbove / 2);
			if (steps > 0) {
				const bonusCount = parseInt(bonusMatch[1], 10) * steps;
				const baseParsed = parseDamageNotation(spell.damage);
				if (baseParsed) {
					const newCount = baseParsed.count + bonusCount;
					let notation = `${newCount}d${baseParsed.sides}`;
					if (baseParsed.modifier !== 0) {
						notation += baseParsed.modifier > 0 ? `+${baseParsed.modifier}` : `${baseParsed.modifier}`;
					}
					return notation;
				}
			}
		}
	}

	// Fallback: can't parse mechanically
	return null;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a spell name for comparison.
 */
function normalizeSpellName(name: string): string {
	return name.trim().toLowerCase().replace(/['']/g, '').replace(/\s+/g, '-');
}

/**
 * Find an available standard spell slot at the given level.
 * Returns the level of the slot to use, or null if none available.
 */
function findAvailableSlot(character: PlayerCharacter, minLevel: number): number | null {
	// Try exact level first, then look for higher slots
	for (let level = minLevel; level <= 9; level++) {
		const slot = character.spellSlots.find(s => s.level === level);
		if (slot && slot.current > 0) {
			return level;
		}
	}
	return null;
}

/**
 * Find an available pact spell slot at or above the given level.
 * Returns the pact slot level, or null if none available.
 */
function findAvailablePactSlot(character: PlayerCharacter, minLevel: number): number | null {
	for (const pactSlot of character.pactSlots) {
		if (pactSlot.level >= minLevel && pactSlot.current > 0) {
			return pactSlot.level;
		}
	}
	return null;
}

/** Parsed damage notation components. */
interface ParsedDamage {
	count: number;
	sides: number;
	modifier: number;
	damageType: string;
}

/**
 * Parse a damage notation string like "3d6 fire", "1d8+3 necrotic", "8d6 fire".
 * Strips damage type suffix for mechanical parsing.
 */
function parseDamageNotation(notation: string): ParsedDamage | null {
	// Strip damage type if present (word at the end after space)
	const parts = notation.trim().split(/\s+/);
	let damageType = '';
	let diceStr = parts[0];

	if (parts.length > 1) {
		// Last part might be damage type if it's purely alpha
		const last = parts[parts.length - 1];
		if (/^[a-z]+$/i.test(last)) {
			damageType = last.toLowerCase();
			diceStr = parts.slice(0, -1).join('');
		} else {
			// No damage type suffix — join everything as dice notation
			diceStr = parts.join('');
		}
	}

	const match = diceStr.match(/^(\d+)d(\d+)([+-]\d+)?$/);
	if (!match) return null;

	return {
		count: parseInt(match[1], 10),
		sides: parseInt(match[2], 10),
		modifier: match[3] ? parseInt(match[3], 10) : 0,
		damageType
	};
}

/**
 * Scale a damage notation's dice count by a multiplier.
 * E.g., "1d8 cold" × 3 → "3d8"
 */
function scaleDamageNotation(notation: string, multiplier: number): string | null {
	const parsed = parseDamageNotation(notation);
	if (!parsed) return null;

	const newCount = parsed.count * multiplier;
	let result = `${newCount}d${parsed.sides}`;
	if (parsed.modifier !== 0) {
		result += parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`;
	}
	return result;
}

/**
 * Roll damage from a spell's damage field, stripping the damage type suffix.
 */
function rollSpellDamage(damageField: string): DiceResult | null {
	const parsed = parseDamageNotation(damageField);
	if (!parsed) {
		// Try parsing multi-projectile patterns like "3 x (1d4 + 1) force"
		const multi = damageField.match(/^(\d+)\s*x\s*\((.+?)\)\s*(\w+)?$/i);
		if (multi) {
			const projCount = parseInt(multi[1], 10);
			const projDice = multi[2].replace(/\s/g, '');
			const projParsed = parseDamageNotation(projDice);
			if (projParsed) {
				const totalCount = projParsed.count * projCount;
				const totalMod = projParsed.modifier * projCount;
				let notation = `${totalCount}d${projParsed.sides}`;
				if (totalMod !== 0) {
					notation += totalMod > 0 ? `+${totalMod}` : `${totalMod}`;
				}
				return roll(notation);
			}
		}
		return null;
	}

	let notation = `${parsed.count}d${parsed.sides}`;
	if (parsed.modifier !== 0) {
		notation += parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`;
	}
	return roll(notation);
}

/**
 * Resolve a healing notation, substituting "spellcasting ability modifier"
 * with the character's actual modifier, and applying upcast scaling.
 */
function resolveHealingNotation(
	spell: SpellDefinition,
	character: PlayerCharacter,
	slotUsed: number | null
): string | null {
	if (!spell.healing) return null;

	let notation = spell.healing;

	// Replace "spellcasting ability modifier" with actual value
	const castAbility = getPrimarySpellcastingAbility(character);
	if (castAbility) {
		const mod = abilityModifier(character.abilities[castAbility]);
		notation = notation.replace(/\+?\s*spellcasting ability modifier/i, mod >= 0 ? `+${mod}` : `${mod}`);
	}

	// Handle upcast scaling for healing spells
	if (slotUsed !== null && slotUsed > spell.level && spell.higherLevels) {
		const healIncrease = spell.higherLevels.match(/healing\s+increases?\s+by\s+(\d+d\d+)\s+for\s+each\s+slot\s+level/i);
		if (healIncrease) {
			const levelsAbove = slotUsed - spell.level;
			const bonusDice = healIncrease[1];
			const bonusMatch = bonusDice.match(/^(\d+)d(\d+)$/);
			if (bonusMatch) {
				const bonusCount = parseInt(bonusMatch[1], 10) * levelsAbove;
				const bonusSides = parseInt(bonusMatch[2], 10);

				// Parse the base healing and add bonus
				const baseParsed = parseDamageNotation(notation);
				if (baseParsed) {
					const newCount = baseParsed.count + bonusCount;
					let result = `${newCount}d${baseParsed.sides}`;
					if (baseParsed.modifier !== 0) {
						result += baseParsed.modifier > 0 ? `+${baseParsed.modifier}` : `${baseParsed.modifier}`;
					}
					return result;
				}
			}
		}
	}

	// Try to extract a rollable notation from the healing string
	const diceMatch = notation.match(/(\d+d\d+(?:[+-]\d+)?)/);
	if (diceMatch) return diceMatch[1];

	// Fixed healing (e.g., "70")
	const fixedMatch = notation.match(/^(\d+)$/);
	if (fixedMatch) return `1d1+${parseInt(fixedMatch[1], 10) - 1}`;

	return null;
}
