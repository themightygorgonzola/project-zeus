/**
 * Character Creation Unit Tests — Multiclass-aware creation flow.
 *
 * Tests cover:
 *   - Single-class creation produces sourceClass on class features
 *   - Imported multiclass builds features from each class
 *   - Imported multiclass builds classSpells per caster class
 *   - Feature uses are built from merged feature list
 *   - buildFeatureUses tracks limited-use features correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCharacter, validateCharacterInput, buildFeatureUses } from './character-creation';
import type { CharacterCreateInput, ClassLevel } from './types';
import { setRng, resetRng, mulberry32 } from './mechanics';

const SEED = 42;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWizardInput(overrides: Partial<CharacterCreateInput> = {}): CharacterCreateInput {
	return {
		name: 'Gandalf Jr',
		race: 'human',
		class: 'wizard',
		background: 'sage',
		statMethod: 'standard',
		chosenSkills: ['investigation', 'religion'],  // avoid overlap with sage's arcana/history
		chosenLanguages: ['elvish', 'dwarvish', 'infernal'],  // human 1 + sage 2 = 3 extra
		spellChoices: {
			cantrips: ['fire-bolt', 'mage-hand', 'prestidigitation'],
			knownSpells: ['magic-missile', 'shield', 'detect-magic', 'sleep', 'thunderwave', 'mage-armor'],
			preparedSpells: ['magic-missile', 'shield', 'detect-magic', 'mage-armor']
		},
		...overrides
	};
}

function makeFighterInput(overrides: Partial<CharacterCreateInput> = {}): CharacterCreateInput {
	return {
		name: 'Conan',
		race: 'human',
		class: 'fighter',
		background: 'soldier',
		statMethod: 'standard',
		chosenSkills: ['perception', 'survival'],  // avoid overlap with soldier's athletics/intimidation
		chosenLanguages: ['elvish'],  // human gets 1 extra language
		...overrides
	};
}

function makeClericInput(overrides: Partial<CharacterCreateInput> = {}): CharacterCreateInput {
	return {
		name: 'Brother Tuck',
		race: 'dwarf',
		subrace: 'hill-dwarf',
		class: 'cleric',
		statMethod: 'standard',
		chosenSkills: ['medicine', 'religion'],
		spellChoices: {
			cantrips: ['sacred-flame', 'guidance', 'spare-the-dying'],
			preparedSpells: ['cure-wounds', 'bless', 'shield-of-faith']
		},
		...overrides
	};
}

// ===========================================================================
// Single-class creation — sourceClass tagging
// ===========================================================================

describe('createCharacter — single class', () => {
	beforeEach(() => setRng(mulberry32(SEED)));
	afterEach(() => resetRng());

	it('produces sourceClass on all class features for a fighter', () => {
		const pc = createCharacter(makeFighterInput(), 'user-1', 'adv-1');
		const classFeatures = pc.classFeatures.filter((f) => f.source === 'class' || f.source === 'subclass');
		expect(classFeatures.length).toBeGreaterThan(0);
		for (const f of classFeatures) {
			expect(f.sourceClass).toBe('fighter');
		}
	});

	it('produces sourceClass on class features for a wizard', () => {
		const pc = createCharacter(makeWizardInput(), 'user-1', 'adv-1');
		const classFeatures = pc.classFeatures.filter((f) => f.source === 'class' || f.source === 'subclass');
		expect(classFeatures.length).toBeGreaterThan(0);
		for (const f of classFeatures) {
			expect(f.sourceClass).toBe('wizard');
		}
	});

	it('does NOT set sourceClass on race/background features', () => {
		const pc = createCharacter(makeFighterInput({ background: 'acolyte' }), 'user-1', 'adv-1');
		const nonClassFeatures = pc.classFeatures.filter((f) => f.source === 'race' || f.source === 'background');
		for (const f of nonClassFeatures) {
			expect(f.sourceClass).toBeUndefined();
		}
	});

	it('builds single entry in classes array for standard creation', () => {
		const pc = createCharacter(makeFighterInput(), 'user-1', 'adv-1');
		expect(pc.classes).toHaveLength(1);
		expect(pc.classes[0].name).toBe('fighter');
		expect(pc.classes[0].level).toBe(1);
		expect(pc.level).toBe(1);
	});

	it('builds classSpells for wizard with correct spellcastingAbility', () => {
		const pc = createCharacter(makeWizardInput(), 'user-1', 'adv-1');
		expect(pc.classSpells).toHaveLength(1);
		expect(pc.classSpells[0].className).toBe('wizard');
		expect(pc.classSpells[0].spellcastingAbility).toBe('int');
		expect(pc.classSpells[0].cantrips.length).toBeGreaterThan(0);
	});

	it('builds empty classSpells for non-caster fighter', () => {
		const pc = createCharacter(makeFighterInput(), 'user-1', 'adv-1');
		expect(pc.classSpells).toHaveLength(0);
	});

	it('creates pact slots (not standard slots) for warlock', () => {
		const pc = createCharacter({
			name: 'Hexo',
			race: 'tiefling',
			class: 'warlock',
			statMethod: 'standard',
			chosenSkills: ['arcana', 'deception'],
			spellChoices: {
				cantrips: ['eldritch-blast', 'minor-illusion'],
				knownSpells: ['hex', 'armor-of-agathys']
			}
		}, 'user-1', 'adv-1');
		expect(pc.pactSlots.length).toBeGreaterThan(0);
		expect(pc.spellSlots).toHaveLength(0);
	});
});

// ===========================================================================
// Imported multiclass creation
// ===========================================================================

describe('createCharacter — imported multiclass', () => {
	beforeEach(() => setRng(mulberry32(SEED)));
	afterEach(() => resetRng());

	it('uses importClasses for the classes array', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'fighter', level: 5, hitDiceRemaining: 5 },
			{ name: 'wizard', level: 3, hitDiceRemaining: 3 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses }), 'user-1', 'adv-1');
		expect(pc.classes).toHaveLength(2);
		expect(pc.classes[0].name).toBe('fighter');
		expect(pc.classes[0].level).toBe(5);
		expect(pc.classes[1].name).toBe('wizard');
		expect(pc.classes[1].level).toBe(3);
		expect(pc.level).toBe(8);
	});

	it('builds features from each imported class with sourceClass', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
			{ name: 'wizard', level: 2, hitDiceRemaining: 2 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses }), 'user-1', 'adv-1');
		const fighterFeatures = pc.classFeatures.filter((f) => f.sourceClass === 'fighter');
		const wizardFeatures = pc.classFeatures.filter((f) => f.sourceClass === 'wizard');
		expect(fighterFeatures.length).toBeGreaterThan(0);
		expect(wizardFeatures.length).toBeGreaterThan(0);
		// Each feature should have the correct sourceClass
		for (const f of fighterFeatures) expect(f.sourceClass).toBe('fighter');
		for (const f of wizardFeatures) expect(f.sourceClass).toBe('wizard');
	});

	it('retains race/background features without sourceClass in imported multiclass', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
			{ name: 'wizard', level: 2, hitDiceRemaining: 2 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses, background: 'acolyte' }), 'user-1', 'adv-1');
		const raceFeatures = pc.classFeatures.filter((f) => f.source === 'race');
		const bgFeatures = pc.classFeatures.filter((f) => f.source === 'background');
		for (const f of [...raceFeatures, ...bgFeatures]) {
			expect(f.sourceClass).toBeUndefined();
		}
	});

	it('builds classSpells for primary caster class with input spells', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'fighter', level: 5, hitDiceRemaining: 5 },
			{ name: 'wizard', level: 3, hitDiceRemaining: 3 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses }), 'user-1', 'adv-1');
		const wizEntry = pc.classSpells.find((cs) => cs.className === 'wizard');
		expect(wizEntry).toBeDefined();
		expect(wizEntry!.spellcastingAbility).toBe('int');
		expect(wizEntry!.cantrips.length).toBeGreaterThan(0);
		// Fighter is non-caster — no spell entry
		const fighterEntry = pc.classSpells.find((cs) => cs.className === 'fighter');
		expect(fighterEntry).toBeUndefined();
	});

	it('builds classSpells for multiple caster classes', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'cleric', level: 3, hitDiceRemaining: 3 },
			{ name: 'wizard', level: 2, hitDiceRemaining: 2 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses }), 'user-1', 'adv-1');
		// Wizard is the primary class (input.class), so it gets the input spells
		const wizEntry = pc.classSpells.find((cs) => cs.className === 'wizard');
		expect(wizEntry).toBeDefined();
		expect(wizEntry!.cantrips.length).toBeGreaterThan(0);
		// Cleric is secondary — gets an empty spell entry
		const clericEntry = pc.classSpells.find((cs) => cs.className === 'cleric');
		expect(clericEntry).toBeDefined();
		expect(clericEntry!.spellcastingAbility).toBe('wis');
		expect(clericEntry!.cantrips).toEqual([]);
	});

	it('computes featureUses from merged multiclass features at total level', () => {
		const importClasses: ClassLevel[] = [
			{ name: 'fighter', level: 5, hitDiceRemaining: 5 },
			{ name: 'wizard', level: 3, hitDiceRemaining: 3 }
		];
		const pc = createCharacter(makeWizardInput({ importClasses }), 'user-1', 'adv-1');
		// Fighter features like Second Wind, Action Surge should exist if granted at level 5
		const hasSecondWind = pc.classFeatures.some((f) => f.name === 'Second Wind');
		if (hasSecondWind) {
			expect(pc.featureUses['Second Wind']).toBeDefined();
			expect(pc.featureUses['Second Wind'].max).toBeGreaterThan(0);
		}
	});
});

// ===========================================================================
// buildFeatureUses
// ===========================================================================

describe('buildFeatureUses', () => {
	it('creates entries for known limited-use features', () => {
		const features = [
			{ name: 'Second Wind' },
			{ name: 'Action Surge' },
			{ name: 'Regular Feature' }
		];
		const result = buildFeatureUses(features, 5);
		expect(result['Second Wind']).toBeDefined();
		expect(result['Second Wind'].max).toBe(1);
		expect(result['Second Wind'].recoversOn).toBe('short-rest');
		expect(result['Action Surge']).toBeDefined();
		expect(result['Action Surge'].max).toBe(1);
		expect(result['Regular Feature']).toBeUndefined();
	});

	it('scales Bardic Inspiration with charisma modifier', () => {
		const features = [{ name: 'Bardic Inspiration' }];
		const result = buildFeatureUses(features, 1, { cha: 16 }); // +3 mod
		expect(result['Bardic Inspiration'].max).toBe(3);
	});

	it('scales Lay on Hands with level', () => {
		const features = [{ name: 'Lay on Hands' }];
		const result = buildFeatureUses(features, 6);
		expect(result['Lay on Hands'].max).toBe(30); // 6 * 5
	});

	it('current equals max on creation', () => {
		const features = [{ name: 'Rage' }];
		const result = buildFeatureUses(features, 3);
		expect(result['Rage'].current).toBe(result['Rage'].max);
	});
});

// ===========================================================================
// Validation (basic sanity)
// ===========================================================================

describe('validateCharacterInput — basics', () => {
	it('rejects empty name', () => {
		const errors = validateCharacterInput({ ...makeFighterInput(), name: '' });
		expect(errors.some((e) => e.field === 'name')).toBe(true);
	});

	it('accepts a valid fighter input', () => {
		const errors = validateCharacterInput(makeFighterInput());
		expect(errors).toHaveLength(0);
	});

	it('accepts a valid wizard input', () => {
		const errors = validateCharacterInput(makeWizardInput());
		expect(errors).toHaveLength(0);
	});
});
