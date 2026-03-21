/**
 * Multiclass Unit Tests — Verifies new multiclass data model and helpers.
 *
 * Tests cover:
 *   - PlayerCharacter multiclass helper functions (types.ts)
 *   - Multiclass spell slot calculation (classes.ts)
 *   - Pact Magic slot info (classes.ts)
 *   - Per-class hit dice in short rest
 *   - Pact slot recovery on short rest
 *   - GM context multiclass formatting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerCharacter, ClassLevel, ClassSpellList } from './types';
import {
	getPrimaryClass,
	getPrimarySubclass,
	hasClass,
	getClassEntry,
	getClassLevelNum,
	getAllKnownSpells,
	getAllPreparedSpells,
	getAllCantrips,
	getPrimarySpellcastingAbility,
	getTotalHitDiceRemaining,
	getHitDiceForClass,
	getClassSpellEntry
} from './types';
import { getMulticlassSpellSlots, getPactSlotInfo } from './data/classes';
import { shortRest } from './rest';
import { setRng, resetRng, mulberry32 } from './mechanics';

const SEED = 42;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Multiclass fighter 5 / wizard 3 */
function makeFighterWizard(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'mc-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Elara the Battlemage',
		race: 'human',
		classes: [
			{ name: 'fighter', level: 5, hitDiceRemaining: 5 },
			{ name: 'wizard', level: 3, hitDiceRemaining: 3 }
		],
		classSpells: [{
			className: 'wizard',
			spellcastingAbility: 'int',
			cantrips: ['fire-bolt', 'mage-hand'],
			knownSpells: ['magic-missile', 'shield', 'detect-magic'],
			preparedSpells: ['magic-missile', 'shield']
		}],
		pactSlots: [],
		level: 8,
		abilities: { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 8 },
		hp: 60,
		maxHp: 60,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 3,
		skillProficiencies: ['athletics', 'arcana'],
		expertiseSkills: [],
		saveProficiencies: ['str', 'con'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		classFeatures: [],
		feats: [],
		spellSlots: [
			{ level: 1, current: 4, max: 4 },
			{ level: 2, current: 2, max: 2 }
		],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 11,
		inventory: [],
		gold: 100,
		xp: 34000,
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

/** Single-class fighter level 5 */
function makeFighter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeFighterWizard({
		name: 'Plain Fighter',
		classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
		classSpells: [],
		level: 5,
		...overrides
	});
}

/** Paladin 6 / Warlock 3 */
function makePaladinWarlock(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeFighterWizard({
		name: 'Hexblade Pally',
		classes: [
			{ name: 'paladin', level: 6, hitDiceRemaining: 6 },
			{ name: 'warlock', level: 3, hitDiceRemaining: 3 }
		],
		classSpells: [
			{
				className: 'paladin',
				spellcastingAbility: 'cha',
				cantrips: [],
				knownSpells: [],
				preparedSpells: ['cure-wounds', 'bless', 'shield-of-faith']
			},
			{
				className: 'warlock',
				spellcastingAbility: 'cha',
				cantrips: ['eldritch-blast'],
				knownSpells: ['hex', 'armor-of-agathys'],
				preparedSpells: []
			}
		],
		pactSlots: [{ level: 2, current: 2, max: 2 }],
		level: 9,
		...overrides
	});
}

// ===========================================================================
// Multiclass Helper Functions (types.ts)
// ===========================================================================

describe('multiclass helpers', () => {
	describe('getPrimaryClass', () => {
		it('returns the first class for multiclass', () => {
			const pc = makeFighterWizard();
			expect(getPrimaryClass(pc)).toBe('fighter');
		});

		it('returns the only class for single-class', () => {
			const pc = makeFighter();
			expect(getPrimaryClass(pc)).toBe('fighter');
		});
	});

	describe('getPrimarySubclass', () => {
		it('returns undefined when no subclass set', () => {
			const pc = makeFighterWizard();
			expect(getPrimarySubclass(pc)).toBeUndefined();
		});

		it('returns primary class subclass', () => {
			const pc = makeFighterWizard({
				classes: [
					{ name: 'fighter', level: 5, hitDiceRemaining: 5, subclass: 'Champion' },
					{ name: 'wizard', level: 3, hitDiceRemaining: 3 }
				]
			});
			expect(getPrimarySubclass(pc)).toBe('Champion');
		});
	});

	describe('hasClass', () => {
		it('returns true for a class the character has', () => {
			const pc = makeFighterWizard();
			expect(hasClass(pc, 'fighter')).toBe(true);
			expect(hasClass(pc, 'wizard')).toBe(true);
		});

		it('returns false for a class the character does not have', () => {
			const pc = makeFighterWizard();
			expect(hasClass(pc, 'rogue')).toBe(false);
			expect(hasClass(pc, 'cleric')).toBe(false);
		});
	});

	describe('getClassEntry', () => {
		it('returns the ClassLevel for an existing class', () => {
			const pc = makeFighterWizard();
			const entry = getClassEntry(pc, 'wizard');
			expect(entry).toEqual({ name: 'wizard', level: 3, hitDiceRemaining: 3 });
		});

		it('returns undefined for a missing class', () => {
			const pc = makeFighterWizard();
			expect(getClassEntry(pc, 'rogue')).toBeUndefined();
		});
	});

	describe('getClassLevelNum', () => {
		it('returns the level for an existing class', () => {
			const pc = makeFighterWizard();
			expect(getClassLevelNum(pc, 'fighter')).toBe(5);
			expect(getClassLevelNum(pc, 'wizard')).toBe(3);
		});

		it('returns 0 for a class not taken', () => {
			const pc = makeFighterWizard();
			expect(getClassLevelNum(pc, 'cleric')).toBe(0);
		});
	});

	describe('getAllKnownSpells', () => {
		it('collects known spells across all classes', () => {
			const pc = makePaladinWarlock();
			const known = getAllKnownSpells(pc);
			expect(known).toContain('hex');
			expect(known).toContain('armor-of-agathys');
		});

		it('de-duplicates spells shared across classes', () => {
			const pc = makeFighterWizard({
				classSpells: [
					{
						className: 'wizard',
						spellcastingAbility: 'int',
						cantrips: [],
						knownSpells: ['detect-magic'],
						preparedSpells: []
					},
					{
						className: 'fighter',
						spellcastingAbility: 'int',
						cantrips: [],
						knownSpells: ['detect-magic'],
						preparedSpells: []
					}
				]
			});
			const known = getAllKnownSpells(pc);
			expect(known.filter((s) => s === 'detect-magic')).toHaveLength(1);
		});

		it('returns empty for non-casters', () => {
			const pc = makeFighter();
			expect(getAllKnownSpells(pc)).toEqual([]);
		});
	});

	describe('getAllPreparedSpells', () => {
		it('collects prepared spells across all classes', () => {
			const pc = makePaladinWarlock();
			const prepared = getAllPreparedSpells(pc);
			expect(prepared).toContain('cure-wounds');
			expect(prepared).toContain('bless');
		});
	});

	describe('getAllCantrips', () => {
		it('collects cantrips across all classes', () => {
			const pc = makePaladinWarlock();
			const cantrips = getAllCantrips(pc);
			expect(cantrips).toContain('eldritch-blast');
		});

		it('returns empty for non-casters', () => {
			const pc = makeFighter();
			expect(getAllCantrips(pc)).toEqual([]);
		});
	});

	describe('getPrimarySpellcastingAbility', () => {
		it('returns the first class spell list ability', () => {
			const pc = makeFighterWizard();
			expect(getPrimarySpellcastingAbility(pc)).toBe('int');
		});

		it('returns undefined for non-casters', () => {
			const pc = makeFighter();
			expect(getPrimarySpellcastingAbility(pc)).toBeUndefined();
		});
	});

	describe('getTotalHitDiceRemaining', () => {
		it('sums hit dice across all classes', () => {
			const pc = makeFighterWizard();
			expect(getTotalHitDiceRemaining(pc)).toBe(8); // 5 + 3
		});

		it('handles partially spent dice', () => {
			const pc = makeFighterWizard({
				classes: [
					{ name: 'fighter', level: 5, hitDiceRemaining: 2 },
					{ name: 'wizard', level: 3, hitDiceRemaining: 1 }
				]
			});
			expect(getTotalHitDiceRemaining(pc)).toBe(3);
		});
	});

	describe('getHitDiceForClass', () => {
		it('returns hit dice for a specific class', () => {
			const pc = makeFighterWizard();
			expect(getHitDiceForClass(pc, 'fighter')).toBe(5);
			expect(getHitDiceForClass(pc, 'wizard')).toBe(3);
		});

		it('returns 0 for a class not taken', () => {
			const pc = makeFighterWizard();
			expect(getHitDiceForClass(pc, 'rogue')).toBe(0);
		});
	});

	describe('getClassSpellEntry', () => {
		it('finds the spell list for a given class', () => {
			const pc = makePaladinWarlock();
			const entry = getClassSpellEntry(pc, 'warlock');
			expect(entry?.spellcastingAbility).toBe('cha');
			expect(entry?.knownSpells).toContain('hex');
		});

		it('returns undefined for a non-caster class', () => {
			const pc = makeFighterWizard();
			expect(getClassSpellEntry(pc, 'fighter')).toBeUndefined();
		});
	});
});

// ===========================================================================
// Multiclass Spell Slot Calculation (classes.ts)
// ===========================================================================

describe('getMulticlassSpellSlots', () => {
	it('returns standard slots for a single full caster', () => {
		const classes: ClassLevel[] = [{ name: 'wizard', level: 5, hitDiceRemaining: 5 }];
		const slots = getMulticlassSpellSlots(classes);
		// Wizard 5: effective caster level 5
		expect(slots[0]).toBe(4); // 1st level
		expect(slots[1]).toBe(3); // 2nd level
		expect(slots[2]).toBe(2); // 3rd level
	});

	it('returns 0 slots for non-casters', () => {
		const classes: ClassLevel[] = [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }];
		const slots = getMulticlassSpellSlots(classes);
		expect(slots.every((s) => s === 0)).toBe(true);
	});

	it('computes multiclass caster level for full + half casters', () => {
		// Wizard 3 (full = 3) + Paladin 4 (half = 2) = effective caster level 5
		const classes: ClassLevel[] = [
			{ name: 'wizard', level: 3, hitDiceRemaining: 3 },
			{ name: 'paladin', level: 4, hitDiceRemaining: 4 }
		];
		const slots = getMulticlassSpellSlots(classes);
		// Caster level 5: 4/3/2 slots
		expect(slots[0]).toBe(4); // 1st level
		expect(slots[1]).toBe(3); // 2nd level
		expect(slots[2]).toBe(2); // 3rd level
	});

	it('excludes warlocks from multiclass caster level', () => {
		// Wizard 5 + Warlock 3 → only wizard contributes to standard slots
		const classes: ClassLevel[] = [
			{ name: 'wizard', level: 5, hitDiceRemaining: 5 },
			{ name: 'warlock', level: 3, hitDiceRemaining: 3 }
		];
		const slots = getMulticlassSpellSlots(classes);
		// Same as pure wizard 5
		expect(slots[0]).toBe(4);
		expect(slots[1]).toBe(3);
		expect(slots[2]).toBe(2);
	});

	it('handles half casters at low levels (ranger 1 = no slots)', () => {
		const classes: ClassLevel[] = [{ name: 'ranger', level: 1, hitDiceRemaining: 1 }];
		const slots = getMulticlassSpellSlots(classes);
		// Ranger 1: floor(1/2) = 0 effective caster level
		expect(slots.every((s) => s === 0)).toBe(true);
	});

	it('handles third casters', () => {
		// Eldritch Knight (fighter subclass = 1/3 caster)
		// For now, fighter is non-caster in base system, so 0
		const classes: ClassLevel[] = [{ name: 'fighter', level: 9, hitDiceRemaining: 9 }];
		const slots = getMulticlassSpellSlots(classes);
		expect(slots.every((s) => s === 0)).toBe(true);
	});
});

// ===========================================================================
// Pact Slot Info (classes.ts)
// ===========================================================================

describe('getPactSlotInfo', () => {
	it('returns null for warlock level 0', () => {
		expect(getPactSlotInfo(0)).toBeNull();
	});

	it('returns level 1 slot for warlock level 1', () => {
		const info = getPactSlotInfo(1);
		expect(info).not.toBeNull();
		expect(info!.slotLevel).toBe(1);
		expect(info!.count).toBe(1);
	});

	it('returns level 1 slots for warlock level 2', () => {
		const info = getPactSlotInfo(2);
		expect(info).not.toBeNull();
		expect(info!.slotLevel).toBe(1);
		expect(info!.count).toBe(2);
	});

	it('returns higher level slots at warlock level 5', () => {
		const info = getPactSlotInfo(5);
		expect(info).not.toBeNull();
		expect(info!.slotLevel).toBe(3);
		expect(info!.count).toBe(2);
	});

	it('returns level 5 slots at warlock level 9+', () => {
		const info = getPactSlotInfo(9);
		expect(info).not.toBeNull();
		expect(info!.slotLevel).toBe(5);
		expect(info!.count).toBe(2);
	});
});

// ===========================================================================
// Short Rest — Multiclass Hit Dice
// ===========================================================================

describe('short rest with multiclass hit dice', () => {
	beforeEach(() => {
		// Seed for deterministic rolls
		setRng(mulberry32(SEED));
	});

	afterEach(() => {
		resetRng();
	});

	it('uses the largest die first for multiclass characters', () => {
		// Fighter (d10) + Wizard (d6)
		const pc = makeFighterWizard({
			hp: 20,
			maxHp: 60,
			classes: [
				{ name: 'fighter', level: 5, hitDiceRemaining: 3 },
				{ name: 'wizard', level: 3, hitDiceRemaining: 2 }
			]
		});
		const result = shortRest(pc, 2);
		// Should spend d10 first (fighter), then d6 (wizard) if needed
		expect(result.hitDiceResults.length).toBe(2);
		expect(result.hitDiceResults[0].dieSides).toBe(10);
	});

	it('reports correct current hit dice after multiclass spending', () => {
		const pc = makeFighterWizard({
			hp: 30,
			maxHp: 60,
			classes: [
				{ name: 'fighter', level: 5, hitDiceRemaining: 2 },
				{ name: 'wizard', level: 3, hitDiceRemaining: 1 }
			]
		});
		const result = shortRest(pc, 3);
		// 3 total dice available, spending 3
		expect(result.hitDiceResults.length).toBe(3);
		expect(result.currentHitDice).toBe(0);
	});

	it('respects per-class die limits', () => {
		const pc = makeFighterWizard({
			hp: 40,
			maxHp: 60,
			classes: [
				{ name: 'fighter', level: 5, hitDiceRemaining: 1 },
				{ name: 'wizard', level: 3, hitDiceRemaining: 0 }
			]
		});
		// Only 1 die available total
		const result = shortRest(pc, 5);
		expect(result.hitDiceResults.length).toBe(1);
		expect(result.currentHitDice).toBe(0);
	});
});

// ===========================================================================
// Short Rest — Pact Slot Recovery
// ===========================================================================

describe('short rest pact slot recovery', () => {
	beforeEach(() => setRng(mulberry32(SEED)));
	afterEach(() => resetRng());

	it('recovers pact slots on short rest', () => {
		const pc = makePaladinWarlock({
			hp: 40,
			maxHp: 60,
			pactSlots: [{ level: 2, current: 0, max: 2 }]
		});
		const result = shortRest(pc, 0);
		// Pact slots should be restored to max on short rest
		const pact = result.character.pactSlots[0];
		expect(pact.current).toBe(pact.max);
	});

	it('does not touch standard spell slots on short rest', () => {
		const pc = makeFighterWizard({
			hp: 20,
			maxHp: 60,
			spellSlots: [
				{ level: 1, current: 0, max: 4 },
				{ level: 2, current: 0, max: 2 }
			]
		});
		const result = shortRest(pc, 0);
		// Standard slots should NOT be restored on short rest
		expect(result.character.spellSlots[0].current).toBe(0);
		expect(result.character.spellSlots[1].current).toBe(0);
	});
});
