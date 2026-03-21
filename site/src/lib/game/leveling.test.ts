/**
 * Phase G Unit Tests — Character Progression (Level Up) Engine
 *
 * Tests cover:
 *   - XP checks and canLevelUp
 *   - Single level-up (HP, features, proficiency, derived stats)
 *   - ASI validation and application
 *   - Feat validation, prerequisites, and effects
 *   - Spell progression (spell slots, cantrips, spells known, prepared)
 *   - Multi-level-up
 *   - Multiclass foundation (prereq checks, caster level calc)
 *   - Derived stat recalculation
 *   - Edge cases and immutability
 */

import { describe, it, expect } from 'vitest';
import {
	canLevelUp,
	xpForLevel,
	awardXP,
	validateASI,
	validateFeatPrerequisites,
	applyFeatEffects,
	getSpellsKnown,
	getMaxPreparedSpells,
	getMaxSpellLevel,
	buildSpellSlots,
	getSpellProgression,
	recalculateDerivedStats,
	applyDerivedStats,
	getNewFeatures,
	applyLevelUp,
	applyMultipleLevelUps,
	checkMulticlassPrereqs,
	computeMulticlassCasterLevel,
	buildMulticlassInfo,
	MAX_ABILITY_SCORE,
	ASI_POINT_BUDGET,
	MAX_LEVEL
} from './leveling';
import type {
	ASIChoice,
	FeatChoice,
	LevelUpChoices,
	ClassEntry
} from './leveling';
import type { PlayerCharacter, AbilityName, ClassName } from './types';
import { XP_THRESHOLDS } from './data/classes';
import { getFeat } from './data/feats';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'test-char-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Testus the Bold',
		race: 'human',
		classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
		classSpells: [],
		pactSlots: [],
		level: 1,
		abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
		hp: 12,
		maxHp: 12,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 2,
		skillProficiencies: ['athletics', 'perception', 'intimidation'],
		expertiseSkills: [],
		saveProficiencies: ['str', 'con'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		classFeatures: [
			{ name: 'Fighting Style', level: 1, source: 'class' },
			{ name: 'Second Wind', level: 1, source: 'class' }
		],
		feats: [],
		spellSlots: [],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 13,
		inventory: [],
		gold: 50,
		xp: 300, // enough for level 2
		conditions: [],
		resistances: [],
		exhaustionLevel: 0,
		stable: false,
		dead: false,
		featureUses: {},
		attunedItems: [],
		backstory: '',
		...overrides
	};
}

function makeWizard(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeCharacter({
		classes: [{ name: 'wizard', level: 1, hitDiceRemaining: 1 }],
		classSpells: [{
			className: 'wizard',
			spellcastingAbility: 'int',
			cantrips: ['fire-bolt', 'mage-hand', 'prestidigitation'],
			knownSpells: ['magic-missile', 'shield', 'detect-magic'],
			preparedSpells: ['magic-missile', 'shield']
		}],
		abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
		hp: 7,
		maxHp: 7, // d6 + CON (1)
		saveProficiencies: ['int', 'wis'],
		armorProficiencies: [],
		weaponProficiencies: [],
		spellSlots: [{ level: 1, current: 2, max: 2 }],
		classFeatures: [
			{ name: 'Arcane Recovery', level: 1, source: 'class' }
		],
		...overrides
	});
}

function makeBard(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeCharacter({
		classes: [{ name: 'bard', level: 1, hitDiceRemaining: 1 }],
		classSpells: [{
			className: 'bard',
			spellcastingAbility: 'cha',
			cantrips: ['vicious-mockery', 'minor-illusion'],
			knownSpells: ['cure-wounds', 'healing-word', 'thunderwave', 'faerie-fire'],
			preparedSpells: []
		}],
		abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 18 },
		hp: 9,
		maxHp: 9, // d8 + CON (1)
		saveProficiencies: ['dex', 'cha'],
		armorProficiencies: ['light'],
		weaponProficiencies: ['simple'],
		spellSlots: [{ level: 1, current: 2, max: 2 }],
		classFeatures: [
			{ name: 'Bardic Inspiration', level: 1, source: 'class' }
		],
		...overrides
	});
}

// ===========================================================================
// canLevelUp
// ===========================================================================

describe('canLevelUp', () => {
	it('returns true when XP meets threshold for next level', () => {
		// Level 1, 300 XP → can reach level 2 (threshold = 300)
		const char = makeCharacter({ level: 1, xp: 300 });
		const result = canLevelUp(char);
		expect(result.canLevel).toBe(true);
		expect(result.levelsAvailable).toBe(1);
		expect(result.xpForNext).toBe(300);
	});

	it('returns false when XP is insufficient', () => {
		const char = makeCharacter({ level: 1, xp: 299 });
		const result = canLevelUp(char);
		expect(result.canLevel).toBe(false);
		expect(result.levelsAvailable).toBe(0);
	});

	it('detects multiple pending levels', () => {
		// Level 1 with 2700 XP → can reach levels 2, 3, 4 (thresholds: 300, 900, 2700)
		const char = makeCharacter({ level: 1, xp: 2700 });
		const result = canLevelUp(char);
		expect(result.canLevel).toBe(true);
		expect(result.levelsAvailable).toBe(3);
	});

	it('returns false at max level', () => {
		const char = makeCharacter({ level: 20, xp: 999999 });
		const result = canLevelUp(char);
		expect(result.canLevel).toBe(false);
		expect(result.levelsAvailable).toBe(0);
	});

	it('reports currentLevel correctly', () => {
		const char = makeCharacter({ level: 5 });
		const result = canLevelUp(char);
		expect(result.currentLevel).toBe(5);
	});
});

// ===========================================================================
// xpForLevel
// ===========================================================================

describe('xpForLevel', () => {
	it('level 1 requires 0 XP', () => {
		expect(xpForLevel(1)).toBe(0);
	});

	it('level 2 requires 300 XP', () => {
		expect(xpForLevel(2)).toBe(300);
	});

	it('level 5 requires 6500 XP', () => {
		expect(xpForLevel(5)).toBe(6500);
	});

	it('level 20 requires 355000 XP', () => {
		expect(xpForLevel(20)).toBe(355000);
	});

	it('returns 0 for out-of-range levels', () => {
		expect(xpForLevel(0)).toBe(0);
		expect(xpForLevel(21)).toBe(0);
	});
});

// ===========================================================================
// awardXP
// ===========================================================================

describe('awardXP', () => {
	it('increases XP', () => {
		const char = makeCharacter({ xp: 100 });
		const result = awardXP(char, 200);
		expect(result.xp).toBe(300);
	});

	it('does not mutate the input', () => {
		const char = makeCharacter({ xp: 100 });
		awardXP(char, 200);
		expect(char.xp).toBe(100);
	});

	it('ignores negative XP awards', () => {
		const char = makeCharacter({ xp: 100 });
		const result = awardXP(char, -50);
		expect(result.xp).toBe(100);
	});
});

// ===========================================================================
// validateASI
// ===========================================================================

describe('validateASI', () => {
	it('accepts +2 to one ability', () => {
		const char = makeCharacter();
		const result = validateASI(char, { type: 'asi', abilities: { str: 2 } });
		expect(result.valid).toBe(true);
	});

	it('accepts +1 to two abilities', () => {
		const char = makeCharacter();
		const result = validateASI(char, { type: 'asi', abilities: { str: 1, dex: 1 } });
		expect(result.valid).toBe(true);
	});

	it('rejects 0 total points', () => {
		const char = makeCharacter();
		const result = validateASI(char, { type: 'asi', abilities: {} });
		expect(result.valid).toBe(false);
	});

	it('rejects total > 2', () => {
		const char = makeCharacter();
		const result = validateASI(char, { type: 'asi', abilities: { str: 2, dex: 1 } });
		expect(result.valid).toBe(false);
	});

	it('rejects total < 2', () => {
		const char = makeCharacter();
		const result = validateASI(char, { type: 'asi', abilities: { str: 1 } });
		expect(result.valid).toBe(false);
	});

	it('rejects if ability would exceed 20', () => {
		const char = makeCharacter({
			abilities: { str: 20, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
		});
		const result = validateASI(char, { type: 'asi', abilities: { str: 2 } });
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('exceed');
	});

	it('allows bringing ability to exactly 20', () => {
		const char = makeCharacter({
			abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
		});
		const result = validateASI(char, { type: 'asi', abilities: { str: 2 } });
		expect(result.valid).toBe(true);
	});

	it('rejects +3 to one ability', () => {
		const char = makeCharacter();
		// @ts-ignore — intentionally invalid
		const result = validateASI(char, { type: 'asi', abilities: { str: 3 } });
		expect(result.valid).toBe(false);
	});
});

// ===========================================================================
// validateFeatPrerequisites
// ===========================================================================

describe('validateFeatPrerequisites', () => {
	it('passes for feats with no prerequisites', () => {
		const char = makeCharacter();
		const feat = getFeat('Alert')!;
		expect(feat).toBeDefined();
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(true);
	});

	it('passes when ability prereq is met', () => {
		const char = makeCharacter({ abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 } });
		const feat = getFeat('Grappler')!; // requires STR 13
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(true);
	});

	it('fails when ability prereq is not met', () => {
		const char = makeCharacter({ abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 8 } });
		const feat = getFeat('Grappler')!; // requires STR 13
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('STR');
	});

	it('fails when spellcasting prereq is not met', () => {
		const char = makeCharacter(); // fighter, no spellcasting
		const feat = getFeat('War Caster')!; // requires spellcasting
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(false);
		expect(result.reason).toContain('spellcasting');
	});

	it('passes spellcasting prereq for a caster', () => {
		const char = makeWizard();
		const feat = getFeat('War Caster')!;
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(true);
	});

	it('checks proficiency prereqs', () => {
		const char = makeCharacter({ armorProficiencies: [] }); // no armor prof
		const feat = getFeat('Medium Armor Master')!; // requires medium armor proficiency
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(false);
	});

	it('passes proficiency prereq when met', () => {
		const char = makeCharacter(); // fighter has medium armor
		const feat = getFeat('Medium Armor Master')!;
		const result = validateFeatPrerequisites(char, feat);
		expect(result.valid).toBe(true);
	});
});

// ===========================================================================
// applyFeatEffects
// ===========================================================================

describe('applyFeatEffects', () => {
	it('applies ability increase', () => {
		const char = makeCharacter({ abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 10 } });
		const feat = getFeat('Actor')!; // +1 CHA
		const result = applyFeatEffects(char, feat);
		expect(result.abilities.cha).toBe(11);
	});

	it('caps ability at 20', () => {
		const char = makeCharacter({ abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 20 } });
		const feat = getFeat('Actor')!; // +1 CHA
		const result = applyFeatEffects(char, feat);
		expect(result.abilities.cha).toBe(20);
	});

	it('applies armor proficiency', () => {
		const char = makeCharacter({ armorProficiencies: [] });
		const feat = getFeat('Heavily Armored')!; // heavy armor
		const result = applyFeatEffects(char, feat);
		expect(result.armorProficiencies).toContain('heavy');
	});

	it('applies HP increase (Tough feat)', () => {
		const char = makeCharacter({ level: 5, hp: 44, maxHp: 44 });
		const feat = getFeat('Tough')!; // +2 HP per level
		const result = applyFeatEffects(char, feat);
		expect(result.maxHp).toBe(54); // 44 + (2 × 5)
		expect(result.hp).toBe(54);
	});

	it('does not mutate the original character', () => {
		const char = makeCharacter();
		const feat = getFeat('Actor')!;
		applyFeatEffects(char, feat);
		expect(char.abilities.cha).toBe(8);
	});
});

// ===========================================================================
// Spell Progression
// ===========================================================================

describe('spell progression', () => {
	describe('getSpellsKnown', () => {
		it('returns spells known for known-casters (bard)', () => {
			expect(getSpellsKnown('bard', 1)).toBe(4);
			expect(getSpellsKnown('bard', 5)).toBe(8);
			expect(getSpellsKnown('bard', 20)).toBe(22);
		});

		it('returns spells known for sorcerer', () => {
			expect(getSpellsKnown('sorcerer', 1)).toBe(2);
			expect(getSpellsKnown('sorcerer', 3)).toBe(4);
		});

		it('returns null for prepared casters (wizard)', () => {
			expect(getSpellsKnown('wizard', 1)).toBeNull();
			expect(getSpellsKnown('wizard', 5)).toBeNull();
		});

		it('returns null for non-casters (fighter)', () => {
			expect(getSpellsKnown('fighter', 1)).toBeNull();
		});
	});

	describe('getMaxPreparedSpells', () => {
		it('returns ability mod + level for wizard', () => {
			// INT 18 → mod +4, level 5 → 4 + 5 = 9
			expect(getMaxPreparedSpells('wizard', 5, 18)).toBe(9);
		});

		it('minimum of 1', () => {
			// INT 8 → mod -1, level 1 → max(1, -1 + 1) = max(1, 0) = 1
			expect(getMaxPreparedSpells('wizard', 1, 8)).toBe(1);
		});

		it('returns null for known-casters (bard)', () => {
			expect(getMaxPreparedSpells('bard', 5, 18)).toBeNull();
		});

		it('returns null for non-casters', () => {
			expect(getMaxPreparedSpells('fighter', 5, 16)).toBeNull();
		});

		it('works for cleric (prepares with WIS)', () => {
			// WIS 16 → mod +3, level 3 → 6
			expect(getMaxPreparedSpells('cleric', 3, 16)).toBe(6);
		});
	});

	describe('getMaxSpellLevel', () => {
		it('wizard level 1 → max spell level 1', () => {
			expect(getMaxSpellLevel('wizard', 1)).toBe(1);
		});

		it('wizard level 5 → max spell level 3', () => {
			expect(getMaxSpellLevel('wizard', 5)).toBe(3);
		});

		it('wizard level 17 → max spell level 9', () => {
			expect(getMaxSpellLevel('wizard', 17)).toBe(9);
		});

		it('fighter → max spell level 0', () => {
			expect(getMaxSpellLevel('fighter', 5)).toBe(0);
		});

		it('ranger level 2 → max spell level 1 (half caster)', () => {
			expect(getMaxSpellLevel('ranger', 2)).toBe(1);
		});

		it('ranger level 1 → max spell level 0 (no slots yet)', () => {
			expect(getMaxSpellLevel('ranger', 1)).toBe(0);
		});
	});

	describe('buildSpellSlots', () => {
		it('wizard level 1: 2 first-level slots', () => {
			const slots = buildSpellSlots('wizard', 1);
			expect(slots).toEqual([{ level: 1, current: 2, max: 2 }]);
		});

		it('wizard level 3: 4 first + 2 second', () => {
			const slots = buildSpellSlots('wizard', 3);
			expect(slots).toEqual([
				{ level: 1, current: 4, max: 4 },
				{ level: 2, current: 2, max: 2 }
			]);
		});

		it('fighter level 3: empty', () => {
			const slots = buildSpellSlots('fighter', 3);
			expect(slots).toEqual([]);
		});
	});

	describe('getSpellProgression', () => {
		it('bard 1→2: 1 new spell known, 1 new slot, 0 new cantrips', () => {
			const prog = getSpellProgression('bard', 1, 2);
			expect(prog.isCaster).toBe(true);
			expect(prog.newSpellsKnown).toBe(1); // 5 - 4
			expect(prog.newCantrips).toBe(0);
		});

		it('wizard 1→2: cantrip count stays same', () => {
			const prog = getSpellProgression('wizard', 1, 2);
			expect(prog.newCantrips).toBe(0);
			expect(prog.newSpellsKnown).toBeNull(); // prepared caster
		});

		it('sorcerer 3→4: gains a cantrip at level 4', () => {
			const prog = getSpellProgression('sorcerer', 3, 4);
			expect(prog.newCantrips).toBe(1);
		});

		it('fighter: not a caster', () => {
			const prog = getSpellProgression('fighter', 1, 2);
			expect(prog.isCaster).toBe(false);
			expect(prog.newCantrips).toBe(0);
		});
	});
});

// ===========================================================================
// recalculateDerivedStats
// ===========================================================================

describe('recalculateDerivedStats', () => {
	it('computes proficiency bonus from level', () => {
		const char = makeCharacter({ level: 5 });
		const stats = recalculateDerivedStats(char);
		expect(stats.proficiencyBonus).toBe(3);
	});

	it('computes passive perception with proficiency', () => {
		// WIS 12 (mod +1), perception proficient, level 5 (prof +3) → 10 + 1 + 3 = 14
		const char = makeCharacter({ level: 5 });
		const stats = recalculateDerivedStats(char);
		expect(stats.passivePerception).toBe(14);
	});

	it('computes passive perception without proficiency', () => {
		const char = makeCharacter({ skillProficiencies: [] }); // no perception
		const stats = recalculateDerivedStats(char);
		// WIS 12 mod +1, no prof → 10 + 1 = 11
		expect(stats.passivePerception).toBe(11);
	});

	it('computes spell save DC for casters', () => {
		// INT 18 (mod +4), level 1 (prof +2) → 8 + 2 + 4 = 14
		const char = makeWizard({ level: 1 });
		const stats = recalculateDerivedStats(char);
		expect(stats.spellSaveDC).toBe(14);
		expect(stats.spellAttackBonus).toBe(6);
	});

	it('returns null spell stats for non-casters', () => {
		const char = makeCharacter();
		const stats = recalculateDerivedStats(char);
		expect(stats.spellSaveDC).toBeNull();
		expect(stats.spellAttackBonus).toBeNull();
	});

	it('computes max prepared spells for prepared casters', () => {
		// Wizard INT 18 mod +4, class level 3 → 4+3 = 7
		const char = makeWizard({ level: 3, classes: [{ name: 'wizard', level: 3, hitDiceRemaining: 3 }] });
		const stats = recalculateDerivedStats(char);
		expect(stats.maxPreparedSpells).toBe(7);
	});

	it('returns null maxPreparedSpells for known-casters', () => {
		const char = makeBard({ level: 3, classes: [{ name: 'bard', level: 3, hitDiceRemaining: 3 }] });
		const stats = recalculateDerivedStats(char);
		expect(stats.maxPreparedSpells).toBeNull();
	});
});

// ===========================================================================
// applyDerivedStats
// ===========================================================================

describe('applyDerivedStats', () => {
	it('updates proficiency and passivePerception on character', () => {
		const char = makeCharacter({ level: 5, proficiencyBonus: 2, passivePerception: 10 });
		const result = applyDerivedStats(char);
		expect(result.proficiencyBonus).toBe(3);
		expect(result.passivePerception).toBe(14); // 10 + 1 (WIS) + 3 (prof)
	});

	it('does not mutate original', () => {
		const char = makeCharacter({ level: 5, proficiencyBonus: 2 });
		applyDerivedStats(char);
		expect(char.proficiencyBonus).toBe(2);
	});
});

// ===========================================================================
// getNewFeatures
// ===========================================================================

describe('getNewFeatures', () => {
	it('returns features at a specific level for fighter', () => {
		const features = getNewFeatures('fighter', 2);
		const names = features.map((f) => f.name);
		expect(names).toContain('Action Surge');
	});

	it('returns ASI feature at fighter level 4', () => {
		const features = getNewFeatures('fighter', 4);
		const names = features.map((f) => f.name);
		expect(names).toContain('Ability Score Improvement');
	});

	it('returns Extra Attack at fighter level 5', () => {
		const features = getNewFeatures('fighter', 5);
		const names = features.map((f) => f.name);
		expect(names).toContain('Extra Attack');
	});

	it('includes subclass features', () => {
		// Fighter Champion gets Improved Critical at level 3
		const features = getNewFeatures('fighter', 3);
		const names = features.map((f) => f.name);
		expect(names).toContain('Improved Critical');
	});

	it('excludes subclass features when flag is false', () => {
		const features = getNewFeatures('fighter', 3, false);
		const names = features.map((f) => f.name);
		expect(names).not.toContain('Improved Critical');
	});

	it('returns empty for level 8 monk (only ASI)', () => {
		const features = getNewFeatures('monk', 8);
		// Only ASI at level 8 for monk
		expect(features.length).toBe(1);
		expect(features[0].tags).toContain('asi');
	});
});

// ===========================================================================
// applyLevelUp — Fighter
// ===========================================================================

describe('applyLevelUp — fighter', () => {
	it('fighter level 1→2: gains Action Surge, HP increases', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		expect(result.success).toBe(true);
		expect(result.newLevel).toBe(2);
		expect(result.hpGained).toBe(8); // d10 avg (6) + CON mod (2) = 8
		expect(result.character.maxHp).toBe(20); // 12 + 8
		expect(result.character.hp).toBe(20);
		expect(result.character.level).toBe(2);
		expect(result.newFeatures).toContain('Action Surge');
		expect(result.character.classes[0].hitDiceRemaining).toBe(2);
	});

	it('proficiency stays 2 at level 2', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const result = applyLevelUp(char);
		expect(result.character.proficiencyBonus).toBe(2);
	});

	it('proficiency increases to 3 at level 5', () => {
		const char = makeCharacter({ level: 4, xp: 6500 });
		const result = applyLevelUp(char);
		expect(result.newLevel).toBe(5);
		expect(result.character.proficiencyBonus).toBe(3);
	});

	it('level 4 is an ASI level — applies ASI choice', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'asi', abilities: { str: 2 } }
		};
		const result = applyLevelUp(char, choices);

		expect(result.success).toBe(true);
		expect(result.isASI).toBe(true);
		expect(result.character.abilities.str).toBe(18); // 16 + 2
	});

	it('level 4 ASI — +1 to two abilities', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'asi', abilities: { str: 1, con: 1 } }
		};
		const result = applyLevelUp(char, choices);

		expect(result.success).toBe(true);
		expect(result.character.abilities.str).toBe(17);
		expect(result.character.abilities.con).toBe(15);
	});

	it('level 4 feat choice — applies feat', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'feat', feat: 'Alert' }
		};
		const result = applyLevelUp(char, choices);

		expect(result.success).toBe(true);
		expect(result.character.feats).toContain('alert');
	});

	it('rejects level-up at max level', () => {
		const char = makeCharacter({ level: 20, xp: 999999 });
		const result = applyLevelUp(char);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('maximum level');
	});

	it('rejects level-up with insufficient XP', () => {
		const char = makeCharacter({ level: 1, xp: 100 });
		const result = applyLevelUp(char);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('XP');
	});

	it('rejects invalid ASI at ASI level', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'asi', abilities: { str: 3 } } // invalid
		};
		const result = applyLevelUp(char, choices);
		expect(result.success).toBe(false);
	});

	it('rejects unknown feat', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'feat', feat: 'Nonexistent Feat' }
		};
		const result = applyLevelUp(char, choices);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('Unknown feat');
	});

	it('rejects feat with unmet prerequisites', () => {
		const char = makeCharacter({
			level: 3, xp: 2700,
			classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
			abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
		});
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'feat', feat: 'Grappler' } // Needs STR 13
		};
		const result = applyLevelUp(char, choices);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('prerequisite');
	});

	it('allows hp roll instead of average', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const choices: LevelUpChoices = { hpRoll: 10 }; // max roll on d10
		const result = applyLevelUp(char, choices);

		expect(result.hpGained).toBe(12); // 10 + CON mod (2)
		expect(result.character.maxHp).toBe(24); // 12 + 12
	});

	it('clamps hp roll to maximum hit die value', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const choices: LevelUpChoices = { hpRoll: 20 }; // exceeds d10
		const result = applyLevelUp(char, choices);

		// Clamped to 10 + CON mod (2) = 12
		expect(result.hpGained).toBe(12);
	});

	it('minimum 1 HP per level', () => {
		const char = makeCharacter({
			level: 1, xp: 300,
			classes: [{ name: 'wizard', level: 1, hitDiceRemaining: 1 }], // d6
			abilities: { str: 8, dex: 10, con: 6, int: 10, wis: 10, cha: 10 } // CON 6, mod -2
		});
		const result = applyLevelUp(char);
		// Average d6 = 4, CON mod = -2 → 2, but even if it were lower, minimum 1
		expect(result.hpGained).toBeGreaterThanOrEqual(1);
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		applyLevelUp(char);
		expect(char.level).toBe(1);
		expect(char.maxHp).toBe(12);
	});

	it('updates passive perception on level-up', () => {
		const char = makeCharacter({ level: 4, xp: 6500, passivePerception: 13 });
		const result = applyLevelUp(char);
		// Level 5: prof bonus = 3, WIS mod = 1, perception proficient → 10+1+3 = 14
		expect(result.character.passivePerception).toBe(14);
	});
});

// ===========================================================================
// applyLevelUp — Wizard (spell progression)
// ===========================================================================

describe('applyLevelUp — wizard (spells)', () => {
	it('wizard 1→2: gains additional first-level slot', () => {
		const char = makeWizard({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		expect(result.success).toBe(true);
		expect(result.spellSlotChanges).toBe(true);
		// Level 2 wizard: 3 first-level slots
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		expect(slot1?.max).toBe(3);
	});

	it('wizard 2→3: gains 2nd-level slots', () => {
		const char = makeWizard({
			level: 2,
			xp: 900,
			classes: [{ name: 'wizard', level: 2, hitDiceRemaining: 2 }],
			spellSlots: [{ level: 1, current: 3, max: 3 }]
		});
		const result = applyLevelUp(char);

		expect(result.spellSlotChanges).toBe(true);
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		const slot2 = result.character.spellSlots.find((s) => s.level === 2);
		expect(slot1?.max).toBe(4);
		expect(slot2?.max).toBe(2);
	});

	it('can add new cantrips on level-up', () => {
		const char = makeWizard({
			level: 3,
			xp: 2700,
			classes: [{ name: 'wizard', level: 3, hitDiceRemaining: 3 }],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: ['fire-bolt', 'mage-hand', 'prestidigitation'],
				knownSpells: ['magic-missile', 'shield', 'detect-magic'],
				preparedSpells: ['magic-missile', 'shield']
			}]
		});
		const choices: LevelUpChoices = {
			newCantrips: ['light'] // wizard gains 4th cantrip at level 4
		};
		const result = applyLevelUp(char, choices);

		expect(result.character.classSpells[0].cantrips).toContain('light');
		expect(result.character.classSpells[0].cantrips).toHaveLength(4);
	});

	it('can add new spells known', () => {
		const char = makeWizard({ level: 1, xp: 300 });
		const choices: LevelUpChoices = {
			newSpells: ['sleep', 'charm-person']
		};
		const result = applyLevelUp(char, choices);

		expect(result.character.classSpells[0].knownSpells).toContain('sleep');
		expect(result.character.classSpells[0].knownSpells).toContain('charm-person');
	});

	it('can update prepared spells', () => {
		const char = makeWizard({ level: 1, xp: 300 });
		const choices: LevelUpChoices = {
			preparedSpells: ['magic-missile', 'sleep', 'detect-magic']
		};
		const result = applyLevelUp(char, choices);

		expect(result.character.classSpells[0].preparedSpells).toEqual(['magic-missile', 'sleep', 'detect-magic']);
	});

	it('preserves current spell slot uses when gaining new slots', () => {
		const char = makeWizard({
			level: 1,
			xp: 300,
			spellSlots: [{ level: 1, current: 0, max: 2 }] // used all slots
		});
		const result = applyLevelUp(char);

		// Wizard level 2 has 3 first-level slots. Old had max 2, new max 3 → gained 1
		// current should be 0 + 1 (gained) = 1
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		expect(slot1?.max).toBe(3);
		expect(slot1?.current).toBe(1);
	});

	it('wizard level 1→2: gains School of Evocation features', () => {
		const char = makeWizard({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		const featureNames = result.character.classFeatures.map((f) => f.name);
		expect(featureNames).toContain('Evocation Savant');
		expect(featureNames).toContain('Sculpt Spells');
	});
});

// ===========================================================================
// applyLevelUp — Bard (known caster)
// ===========================================================================

describe('applyLevelUp — bard (known caster)', () => {
	it('bard 1→2: gains Jack of All Trades, Song of Rest', () => {
		const char = makeBard({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		const featureNames = result.newFeatures;
		expect(featureNames).toContain('Jack of All Trades');
		expect(featureNames).toContain('Song of Rest');
	});

	it('bard spell slot progression', () => {
		const char = makeBard({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		// Bard level 2: 3 first-level slots
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		expect(slot1?.max).toBe(3);
	});

	it('bard adds new spells known', () => {
		const char = makeBard({ level: 1, xp: 300 });
		const choices: LevelUpChoices = {
			newSpells: ['sleep']
		};
		const result = applyLevelUp(char, choices);
		expect(result.character.classSpells[0].knownSpells).toContain('sleep');
	});
});

// ===========================================================================
// applyMultipleLevelUps
// ===========================================================================

describe('applyMultipleLevelUps', () => {
	it('applies multiple level-ups in sequence', () => {
		// Level 1 with 2700 XP → can level to 4 (3 level-ups)
		const char = makeCharacter({ level: 1, xp: 2700 });
		const choicesPerLevel: LevelUpChoices[] = [
			{}, // level 2
			{}, // level 3
			{ asiOrFeat: { type: 'asi', abilities: { str: 2 } } } // level 4 (ASI)
		];
		const results = applyMultipleLevelUps(char, choicesPerLevel);

		expect(results).toHaveLength(3);
		expect(results[0].newLevel).toBe(2);
		expect(results[1].newLevel).toBe(3);
		expect(results[2].newLevel).toBe(4);

		const final = results[2].character;
		expect(final.level).toBe(4);
		expect(final.abilities.str).toBe(18);
	});

	it('stops if a level-up fails', () => {
		// Level 1 with 300 XP — can only level once
		const char = makeCharacter({ level: 1, xp: 300 });
		const results = applyMultipleLevelUps(char);
		expect(results).toHaveLength(1);
		expect(results[0].success).toBe(true);
		expect(results[0].newLevel).toBe(2);
	});

	it('uses default choices when none provided', () => {
		const char = makeCharacter({ level: 1, xp: 900 });
		const results = applyMultipleLevelUps(char);
		expect(results).toHaveLength(2);
		expect(results[0].newLevel).toBe(2);
		expect(results[1].newLevel).toBe(3);
	});
});

// ===========================================================================
// Multiclass Foundation
// ===========================================================================

describe('multiclass foundation', () => {
	describe('checkMulticlassPrereqs', () => {
		it('fighter: needs STR 13', () => {
			const char = makeCharacter(); // STR 16
			const result = checkMulticlassPrereqs(char, 'fighter');
			expect(result.canMulticlass).toBe(true);
		});

		it('fails when STR is too low for fighter', () => {
			const char = makeCharacter({
				abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
			});
			const result = checkMulticlassPrereqs(char, 'fighter');
			expect(result.canMulticlass).toBe(false);
			expect(result.failedRequirements).toHaveLength(1);
			expect(result.failedRequirements[0].ability).toBe('str');
		});

		it('paladin: needs STR 13 AND CHA 13', () => {
			const char = makeCharacter({
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 14 }
			});
			const result = checkMulticlassPrereqs(char, 'paladin');
			expect(result.canMulticlass).toBe(true);
		});

		it('paladin: fails if only STR met', () => {
			const char = makeCharacter({
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }
			});
			const result = checkMulticlassPrereqs(char, 'paladin');
			expect(result.canMulticlass).toBe(false);
			expect(result.failedRequirements.some((r) => r.ability === 'cha')).toBe(true);
		});

		it('monk: needs DEX 13 AND WIS 13', () => {
			const char = makeCharacter({
				abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 14, cha: 10 }
			});
			const result = checkMulticlassPrereqs(char, 'monk');
			expect(result.canMulticlass).toBe(true);
		});

		it('wizard: needs INT 13', () => {
			const char = makeWizard(); // INT 18
			const result = checkMulticlassPrereqs(char, 'wizard');
			expect(result.canMulticlass).toBe(true);
		});
	});

	describe('computeMulticlassCasterLevel', () => {
		it('single full caster: level = class level', () => {
			const classes: ClassEntry[] = [{ name: 'wizard', level: 5 }];
			expect(computeMulticlassCasterLevel(classes)).toBe(5);
		});

		it('single half caster: level = floor(class level / 2)', () => {
			const classes: ClassEntry[] = [{ name: 'paladin', level: 5 }];
			expect(computeMulticlassCasterLevel(classes)).toBe(2);
		});

		it('non-caster: 0', () => {
			const classes: ClassEntry[] = [{ name: 'fighter', level: 10 }];
			expect(computeMulticlassCasterLevel(classes)).toBe(0);
		});

		it('mixed full + half caster', () => {
			const classes: ClassEntry[] = [
				{ name: 'wizard', level: 5 },
				{ name: 'paladin', level: 4 }
			];
			// wizard: 5 + paladin: floor(4/2) = 2 → total 7
			expect(computeMulticlassCasterLevel(classes)).toBe(7);
		});

		it('warlock (pact) does not contribute', () => {
			const classes: ClassEntry[] = [
				{ name: 'wizard', level: 5 },
				{ name: 'warlock', level: 3 }
			];
			expect(computeMulticlassCasterLevel(classes)).toBe(5);
		});

		it('paladin 2 / sorcerer 3 has effective caster level 4', () => {
			const classes: ClassEntry[] = [
				{ name: 'paladin', level: 2 },
				{ name: 'sorcerer', level: 3 }
			];
			expect(computeMulticlassCasterLevel(classes)).toBe(4);
		});

		it('three classes mixing full, half, and non-caster', () => {
			const classes: ClassEntry[] = [
				{ name: 'cleric', level: 6 },   // full: 6
				{ name: 'ranger', level: 5 },    // half: 2
				{ name: 'fighter', level: 3 }     // 0
			];
			expect(computeMulticlassCasterLevel(classes)).toBe(8);
		});
	});

	describe('buildMulticlassInfo', () => {
		it('single-class character', () => {
			const char = makeCharacter({
				level: 5,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }]
			});
			const info = buildMulticlassInfo(char);

			expect(info.classes).toHaveLength(1);
			expect(info.classes[0]).toEqual({ name: 'fighter', level: 5 });
			expect(info.primaryClass).toBe('fighter');
			expect(info.totalLevel).toBe(5);
			expect(info.effectiveCasterLevel).toBe(0); // fighter is not a caster
		});

		it('single-class wizard', () => {
			const char = makeWizard({
				level: 5,
				classes: [{ name: 'wizard', level: 5, hitDiceRemaining: 5 }]
			});
			const info = buildMulticlassInfo(char);
			expect(info.effectiveCasterLevel).toBe(5);
		});
	});
});

// ===========================================================================
// Plan Verification Scenarios
// ===========================================================================

describe('plan verification scenarios', () => {
	it('fighter at 299 XP → award 1 XP → canLevelUp returns true', () => {
		let char = makeCharacter({ level: 1, xp: 299 });
		expect(canLevelUp(char).canLevel).toBe(false);

		char = awardXP(char, 1);
		expect(char.xp).toBe(300);
		expect(canLevelUp(char).canLevel).toBe(true);
	});

	it('apply level-up → verify HP increased, proficiency stayed 2, features include Action Surge', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		expect(result.success).toBe(true);
		expect(result.character.maxHp).toBeGreaterThan(12);
		expect(result.character.proficiencyBonus).toBe(2);
		expect(result.newFeatures).toContain('Action Surge');
	});

	it('hit level 4 → verify ASI choice offered', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const features = getNewFeatures('fighter', 4);
		const hasASI = features.some((f) => f.tags.includes('asi'));
		expect(hasASI).toBe(true);

		// Apply with ASI
		const result = applyLevelUp(char, {
			asiOrFeat: { type: 'asi', abilities: { str: 2 } }
		});
		expect(result.isASI).toBe(true);
		expect(result.character.abilities.str).toBe(18);
	});

	it('wizard level 2 → verify spell slot progression matches PHB table', () => {
		const char = makeWizard({ level: 1, xp: 300 });
		const result = applyLevelUp(char);

		// Wizard level 2: 3 first-level slots (PHB table)
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		expect(slot1?.max).toBe(3);

		// Verify subclass features (Evocation at level 2)
		const featureNames = result.character.classFeatures.map((f) => f.name);
		expect(featureNames).toContain('Evocation Savant');
		expect(featureNames).toContain('Sculpt Spells');
	});
});

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('edge cases', () => {
	it('fighter level 6 (extra ASI): can take feat', () => {
		const char = makeCharacter({
			level: 5,
			xp: 14000,
			classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
			proficiencyBonus: 3
		});
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'feat', feat: 'Sentinel' }
		};
		const result = applyLevelUp(char, choices);
		expect(result.success).toBe(true);
		expect(result.isASI).toBe(true);
		expect(result.character.feats).toContain('sentinel');
	});

	it('Tough feat applies retroactively', () => {
		const char = makeCharacter({
			level: 3, xp: 2700, hp: 30, maxHp: 30,
			classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }]
		});
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'feat', feat: 'Tough' }
		};
		const result = applyLevelUp(char, choices);

		// Level becomes 4. Tough: +2 per level = +8 retroactive
		// HP gain from level: d10 avg (6) + CON (2) = 8
		// Then Tough applies: level 4 × 2 = 8 bonus
		expect(result.character.maxHp).toBe(30 + 8 + 8); // 46
	});

	it('levelup with no choices on ASI level still succeeds (no ASI applied)', () => {
		const char = makeCharacter({ level: 3, xp: 2700, classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }] });
		const result = applyLevelUp(char);
		expect(result.success).toBe(true);
		expect(result.isASI).toBe(true);
		// No ASI or feat applied — character just levels normally
		expect(result.character.abilities.str).toBe(16);
	});

	it('non-ASI level ignores asiOrFeat choices', () => {
		const char = makeCharacter({ level: 1, xp: 300 });
		const choices: LevelUpChoices = {
			asiOrFeat: { type: 'asi', abilities: { str: 2 } }
		};
		const result = applyLevelUp(char);
		// Level 2 is not an ASI level for fighter
		expect(result.character.abilities.str).toBe(16);
	});

	it('half-caster ranger gains spells at level 2', () => {
		const char = makeCharacter({
			classes: [{ name: 'ranger', level: 1, hitDiceRemaining: 1 }],
			classSpells: [{
				className: 'ranger',
				spellcastingAbility: 'wis',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			level: 1,
			xp: 300,
			spellSlots: [],
			saveProficiencies: ['str', 'dex']
		});
		const result = applyLevelUp(char);
		// Ranger level 2: gains spell slots
		expect(result.spellSlotChanges).toBe(true);
		const slot1 = result.character.spellSlots.find((s) => s.level === 1);
		expect(slot1?.max).toBe(2);
	});

	it('immutability: inventory and other arrays are cloned', () => {
		const char = makeCharacter({ level: 1, xp: 300, feats: ['alert'] });
		const result = applyLevelUp(char);
		result.character.feats.push('sentinel');
		expect(char.feats).toEqual(['alert']);
	});
});

// ===========================================================================
// Constants
// ===========================================================================

describe('constants', () => {
	it('MAX_ABILITY_SCORE is 20', () => {
		expect(MAX_ABILITY_SCORE).toBe(20);
	});

	it('ASI_POINT_BUDGET is 2', () => {
		expect(ASI_POINT_BUDGET).toBe(2);
	});

	it('MAX_LEVEL is 20', () => {
		expect(MAX_LEVEL).toBe(20);
	});
});

// ===========================================================================
// Multiclass Level-Up Scenarios (Step 4)
// ===========================================================================

describe('multiclass level-up', () => {
	/** Fighter 4 with STR 16, INT 14 — meets wizard prereqs. */
	function makeMulticlassFighter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
		return makeCharacter({
			level: 4,
			xp: 6500, // enough for level 5
			classes: [{ name: 'fighter', level: 4, hitDiceRemaining: 4 }],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 },
			proficiencyBonus: 2,
			...overrides
		});
	}

	it('adds a new class via targetClass', () => {
		const char = makeMulticlassFighter();
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		expect(result.character.level).toBe(5);
		expect(result.character.classes).toHaveLength(2);
		const wizEntry = result.character.classes.find(c => c.name === 'wizard');
		expect(wizEntry).toBeDefined();
		expect(wizEntry!.level).toBe(1);
		expect(wizEntry!.hitDiceRemaining).toBe(1);
		// Fighter class level unchanged
		const ftrEntry = result.character.classes.find(c => c.name === 'fighter');
		expect(ftrEntry!.level).toBe(4);
	});

	it('applies multiclass proficiency grants when adding new class', () => {
		const char = makeMulticlassFighter({
			armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
			weaponProficiencies: ['simple', 'martial'],
			toolProficiencies: []
		});
		// Multiclass into rogue: grants light armor + thieves' tools
		const result = applyLevelUp(char, { targetClass: 'rogue' });
		expect(result.success).toBe(true);
		expect(result.character.toolProficiencies).toContain('thieves-tools');
		// Already had light armor, no duplicate
		expect(result.character.armorProficiencies.filter(a => a === 'light')).toHaveLength(1);
	});

	it('rejects multiclass when leaving class prereqs unmet', () => {
		const char = makeMulticlassFighter({
			abilities: { str: 10, dex: 14, con: 14, int: 14, wis: 12, cha: 10 }
		});
		// Fighter prereq is STR 13 — with STR 10, can't multiclass OUT
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(false);
		expect(result.reason).toContain('Cannot multiclass out of fighter');
	});

	it('rejects multiclass when entering class prereqs unmet', () => {
		const char = makeMulticlassFighter({
			abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }
		});
		// Wizard needs INT 13 — with INT 10 can't enter
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(false);
		expect(result.reason).toContain('Cannot multiclass into wizard');
	});

	it('uses target class hit die for HP (wizard d6 vs fighter d10)', () => {
		const char = makeMulticlassFighter();
		const ftrResult = applyLevelUp(makeMulticlassFighter(), {}); // default → fighter
		const wizResult = applyLevelUp(char, { targetClass: 'wizard' });
		// Fighter average HP gain: d10/2 + 1 + CON(2) = 8
		// Wizard average HP gain: d6/2 + 1 + CON(2) = 6
		expect(wizResult.hpGained).toBeLessThan(ftrResult.hpGained);
	});

	it('creates ClassSpellList entry for new caster class', () => {
		const char = makeMulticlassFighter();
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		const wizSpells = result.character.classSpells.find(cs => cs.className === 'wizard');
		expect(wizSpells).toBeDefined();
		expect(wizSpells!.spellcastingAbility).toBe('int');
		expect(wizSpells!.cantrips).toEqual([]);
		expect(wizSpells!.knownSpells).toEqual([]);
	});

	it('levels existing second class when targetClass already present', () => {
		const char = makeCharacter({
			level: 5,
			xp: 14000, // enough for level 6
			classes: [
				{ name: 'fighter', level: 4, hitDiceRemaining: 4 },
				{ name: 'wizard', level: 1, hitDiceRemaining: 1 }
			],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 },
			proficiencyBonus: 3,
			spellSlots: [{ level: 1, current: 2, max: 2 }]
		});
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		const wizEntry = result.character.classes.find(c => c.name === 'wizard');
		expect(wizEntry!.level).toBe(2);
		expect(wizEntry!.hitDiceRemaining).toBe(2);
		// No new ClassSpellList entry added (one already existed)
		expect(result.character.classSpells.filter(cs => cs.className === 'wizard')).toHaveLength(1);
	});

	it('uses CLASS level (not total level) for ASI detection', () => {
		// Fighter 3 / Wizard 1 — level up fighter to class level 4 (ASI level)
		const char = makeCharacter({
			level: 4,
			xp: 6500,
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
				{ name: 'wizard', level: 1, hitDiceRemaining: 1 }
			],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 },
			spellSlots: [{ level: 1, current: 2, max: 2 }]
		});
		const result = applyLevelUp(char, {
			targetClass: 'fighter',
			asiOrFeat: { type: 'asi', abilities: { str: 2 } }
		});
		expect(result.success).toBe(true);
		expect(result.isASI).toBe(true);
		expect(result.character.abilities.str).toBe(18);
	});

	it('does NOT trigger ASI based on total level alone', () => {
		// Fighter 1 / Wizard 3 = total level 4, but wizard CLASS level 3 → not ASI
		const char = makeCharacter({
			level: 3,
			xp: 2700,
			classes: [
				{ name: 'fighter', level: 1, hitDiceRemaining: 1 },
				{ name: 'wizard', level: 2, hitDiceRemaining: 2 }
			],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 },
			spellSlots: [{ level: 1, current: 3, max: 3 }]
		});
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		expect(result.isASI).toBe(false);
	});

	it('computes multiclass spell slots when two full casters', () => {
		// Wizard 2 / Cleric 2 = effective caster level 4 → uses multiclass table
		const char = makeCharacter({
			level: 4,
			xp: 6500,
			classes: [
				{ name: 'wizard', level: 2, hitDiceRemaining: 2 },
				{ name: 'cleric', level: 2, hitDiceRemaining: 2 }
			],
			classSpells: [
				{ className: 'wizard', spellcastingAbility: 'int', cantrips: [], knownSpells: [], preparedSpells: [] },
				{ className: 'cleric', spellcastingAbility: 'wis', cantrips: [], knownSpells: [], preparedSpells: [] }
			],
			abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 10 },
			spellSlots: [
				{ level: 1, current: 4, max: 4 },
				{ level: 2, current: 3, max: 3 }
			]
		});
		// Level up wizard → class 3, effective caster level 5
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		expect(result.spellSlotChanges).toBe(true);
		// Effective caster level 5 should have 3rd-level slots
		const slot3 = result.character.spellSlots.find(s => s.level === 3);
		expect(slot3).toBeDefined();
		expect(slot3!.max).toBeGreaterThan(0);
	});

	it('adds pact slots when multiclassing into warlock', () => {
		const char = makeMulticlassFighter({
			abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 14 }
		});
		const result = applyLevelUp(char, { targetClass: 'warlock' });
		expect(result.success).toBe(true);
		expect(result.character.pactSlots).toHaveLength(1);
		expect(result.character.pactSlots[0].level).toBe(1);
		expect(result.character.pactSlots[0].max).toBeGreaterThan(0);
	});

	it('updates pact slots when leveling existing warlock', () => {
		const char = makeCharacter({
			level: 2,
			xp: 900,
			classes: [
				{ name: 'fighter', level: 1, hitDiceRemaining: 1 },
				{ name: 'warlock', level: 1, hitDiceRemaining: 1 }
			],
			classSpells: [{
				className: 'warlock',
				spellcastingAbility: 'cha',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 14 },
			pactSlots: [{ level: 1, current: 1, max: 1 }]
		});
		const result = applyLevelUp(char, { targetClass: 'warlock' });
		expect(result.success).toBe(true);
		const warlockEntry = result.character.classes.find(c => c.name === 'warlock');
		expect(warlockEntry!.level).toBe(2);
		// Warlock level 2 should have 2 pact slots
		expect(result.character.pactSlots[0].max).toBe(2);
	});

	it('scopes new spell additions to the target class spell list', () => {
		const char = makeCharacter({
			level: 5,
			xp: 14000,
			classes: [
				{ name: 'fighter', level: 4, hitDiceRemaining: 4 },
				{ name: 'wizard', level: 1, hitDiceRemaining: 1 }
			],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: ['fire-bolt'],
				knownSpells: ['magic-missile'],
				preparedSpells: ['magic-missile']
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 },
			spellSlots: [{ level: 1, current: 2, max: 2 }]
		});
		const result = applyLevelUp(char, {
			targetClass: 'wizard',
			newSpells: ['shield'],
			newCantrips: ['mage-hand']
		});
		expect(result.success).toBe(true);
		const wizSpells = result.character.classSpells.find(cs => cs.className === 'wizard');
		expect(wizSpells!.knownSpells).toContain('shield');
		expect(wizSpells!.cantrips).toContain('mage-hand');
	});

	it('computes maxPreparedSpells per-class with class level', () => {
		// Wizard 3 (INT 16, mod +3) + Cleric 2 (WIS 14, mod +2)
		const char = makeCharacter({
			level: 5,
			xp: 6500,
			classes: [
				{ name: 'wizard', level: 3, hitDiceRemaining: 3 },
				{ name: 'cleric', level: 2, hitDiceRemaining: 2 }
			],
			classSpells: [
				{ className: 'wizard', spellcastingAbility: 'int', cantrips: [], knownSpells: [], preparedSpells: [] },
				{ className: 'cleric', spellcastingAbility: 'wis', cantrips: [], knownSpells: [], preparedSpells: [] }
			],
			abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 14, cha: 10 }
		});
		const stats = recalculateDerivedStats(char);
		// Wizard: max(1, INT(+3) + classLevel(3)) = 6
		// Cleric: max(1, WIS(+2) + classLevel(2)) = 4
		// Total: 10
		expect(stats.maxPreparedSpells).toBe(10);
	});

	it('defaults to primary class when targetClass omitted', () => {
		const char = makeCharacter({
			level: 4,
			xp: 6500,
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
				{ name: 'wizard', level: 1, hitDiceRemaining: 1 }
			],
			classSpells: [{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: [],
				knownSpells: [],
				preparedSpells: []
			}],
			abilities: { str: 16, dex: 14, con: 14, int: 14, wis: 12, cha: 10 }
		});
		// No targetClass → levels primary (fighter)
		const result = applyLevelUp(char);
		expect(result.success).toBe(true);
		const ftrEntry = result.character.classes.find(c => c.name === 'fighter');
		expect(ftrEntry!.level).toBe(4);
	});

	it('features come from target class at class level, not total level', () => {
		// Fighter 4, adding wizard level 1 → should get wizard level 1 features
		const char = makeMulticlassFighter();
		const result = applyLevelUp(char, { targetClass: 'wizard' });
		expect(result.success).toBe(true);
		// Should have Arcane Recovery (wizard level 1 feature)
		const hasArcaneRecovery = result.character.classFeatures.some(
			f => f.name === 'Arcane Recovery'
		);
		expect(hasArcaneRecovery).toBe(true);
	});
});
