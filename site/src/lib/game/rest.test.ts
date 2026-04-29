/**
 * Phase E Unit Tests — Rest & Recovery Engine
 *
 * Uses seeded PRNG (mulberry32) for deterministic assertions.
 * Tests cover:
 *   - Short rest hit-die healing (single & multi-die, CON mod interaction)
 *   - Short rest feature recovery (short-rest features only)
 *   - Long rest HP restoration, hit dice recovery, spell slot recovery
 *   - Long rest feature recovery (both short-rest and long-rest features)
 *   - Long rest condition clearing, death save reset, exhaustion reduction
 *   - Rest validation (dead characters)
 *   - Preview functions (short rest & long rest)
 *   - Feature use tracking (useFeature)
 *   - Edge cases (0 hit dice, full HP, no spell slots, etc.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	mulberry32,
	setRng,
	resetRng,
	abilityModifier
} from './mechanics';
import {
	shortRest,
	longRest,
	canShortRest,
	canLongRest,
	previewShortRest,
	previewLongRest,
	useFeature
} from './rest';
import type { PlayerCharacter, SpellSlotPool, Condition } from './types';
import { CLASS_HIT_DIE } from './types';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SEED = 42;

function makeCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'test-char-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Testus the Bold',
		race: 'human',
		classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
		classSpells: [],
		pactSlots: [],
		level: 5,
		abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
		hp: 44,
		maxHp: 44,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 3,
		skillProficiencies: ['athletics', 'perception', 'intimidation'],
		expertiseSkills: [],
		saveProficiencies: ['str', 'con'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		classFeatures: [],
		feats: [],
		spellSlots: [],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 14,
		inventory: [],
		gold: 50,
		xp: 6500,
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

/** Fighter at half HP with Action Surge and Second Wind used. */
function makeBatteredFighter(): PlayerCharacter {
	return makeCharacter({
		name: 'Battered Fighter',
		hp: 22,
		maxHp: 44,
		classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 3 }],
		featureUses: {
			'Action Surge': { current: 0, max: 1, recoversOn: 'short-rest' },
			'Second Wind': { current: 0, max: 1, recoversOn: 'short-rest' }
		}
	});
}

/** Level 5 Wizard, partially spent. */
function makeSpentWizard(): PlayerCharacter {
	return makeCharacter({
		name: 'Spent Wizard',
		classes: [{ name: 'wizard', level: 5, hitDiceRemaining: 2 }],
		abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
		hp: 15,
		maxHp: 22,
		spellSlots: [
			{ level: 1, current: 1, max: 4 },
			{ level: 2, current: 0, max: 3 },
			{ level: 3, current: 1, max: 2 }
		],
		featureUses: {
			'Arcane Recovery': { current: 0, max: 1, recoversOn: 'short-rest' }
		}
	});
}

/** Level 3 Barbarian with Rage uses partially spent. */
function makeRagingBarbarian(): PlayerCharacter {
	return makeCharacter({
		name: 'Gruk the Angry',
		classes: [{ name: 'barbarian', level: 3, hitDiceRemaining: 2 }],
		level: 3,
		abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 10, cha: 10 },
		hp: 20,
		maxHp: 35,
		featureUses: {
			'Rage': { current: 1, max: 3, recoversOn: 'long-rest' }
		}
	});
}

/** Level 5 Cleric with Channel Divinity and spell slots. */
function makeCleric(): PlayerCharacter {
	return makeCharacter({
		name: 'Sister Mercy',
		classes: [{ name: 'cleric', level: 5, hitDiceRemaining: 3 }],
		abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
		hp: 18,
		maxHp: 38,
		spellSlots: [
			{ level: 1, current: 0, max: 4 },
			{ level: 2, current: 1, max: 3 },
			{ level: 3, current: 2, max: 2 }
		],
		featureUses: {
			'Channel Divinity': { current: 0, max: 1, recoversOn: 'short-rest' }
		},
		conditions: ['frightened'] as Condition[],
		deathSaves: { successes: 2, failures: 1 }
	});
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	setRng(mulberry32(SEED));
});

afterEach(() => {
	resetRng();
});

// ===========================================================================
// canShortRest / canLongRest
// ===========================================================================

describe('canShortRest', () => {
	it('allows a living character to short rest', () => {
		const result = canShortRest(makeCharacter());
		expect(result.allowed).toBe(true);
		expect(result.reason).toBeUndefined();
	});

	it('prevents a dead character from short resting', () => {
		const result = canShortRest(makeCharacter({ dead: true }));
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Dead');
	});

	it('allows a character at 0 HP (unconscious but not dead) to short rest', () => {
		const result = canShortRest(makeCharacter({ hp: 0 }));
		expect(result.allowed).toBe(true);
	});
});

describe('canLongRest', () => {
	it('allows a living character to long rest', () => {
		const result = canLongRest(makeCharacter());
		expect(result.allowed).toBe(true);
		expect(result.reason).toBeUndefined();
	});

	it('prevents a dead character from long resting', () => {
		const result = canLongRest(makeCharacter({ dead: true }));
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Dead');
	});
});

// ===========================================================================
// shortRest
// ===========================================================================

describe('shortRest', () => {
	describe('hit dice healing', () => {
		it('spends the requested number of hit dice and heals', () => {
			const fighter = makeBatteredFighter();
			const result = shortRest(fighter, 2);

			expect(result.success).toBe(true);
			expect(result.hitDiceResults).toHaveLength(2);
			expect(result.previousHp).toBe(22);
			expect(result.currentHp).toBeGreaterThan(22);
			expect(result.previousHitDice).toBe(3);
			expect(result.currentHitDice).toBe(1);
		});

		it('uses the correct die size for the class', () => {
			const fighter = makeBatteredFighter();
			const result = shortRest(fighter, 1);
			// Fighter uses d10
			expect(result.hitDiceResults[0].dieSides).toBe(10);
		});

		it('adds CON modifier to each die roll', () => {
			const fighter = makeBatteredFighter(); // CON 14, mod +2
			const result = shortRest(fighter, 1);
			expect(result.hitDiceResults[0].conMod).toBe(2);
		});

		it('clamps healing at 0 minimum per die (negative CON)', () => {
			const weakling = makeCharacter({
				hp: 10,
				maxHp: 20,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 3 }],
				abilities: { str: 10, dex: 10, con: 6, int: 10, wis: 10, cha: 10 } // CON mod -2
			});
			const result = shortRest(weakling, 1);
			// Healing per die should be max(0, roll + conMod)
			expect(result.hitDiceResults[0].healing).toBeGreaterThanOrEqual(0);
		});

		it('does not exceed maxHp', () => {
			const almostFull = makeCharacter({
				hp: 43,
				maxHp: 44,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 3 }]
			});
			const result = shortRest(almostFull, 2);
			expect(result.currentHp).toBe(44);
			// Total healing should be exactly 1 (the deficit)
			expect(result.totalHealing).toBe(1);
		});

		it('spends 0 hit dice if requested 0', () => {
			const fighter = makeBatteredFighter();
			const result = shortRest(fighter, 0);
			expect(result.hitDiceResults).toHaveLength(0);
			expect(result.totalHealing).toBe(0);
			expect(result.currentHitDice).toBe(3);
		});

		it('clamps hit dice to available count', () => {
			const fighter = makeCharacter({
				hp: 20,
				maxHp: 44,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 1 }]
			});
			const result = shortRest(fighter, 5); // only 1 available
			expect(result.hitDiceResults).toHaveLength(1);
			expect(result.currentHitDice).toBe(0);
		});

		it('returns 0 healing when at full HP', () => {
			const healthy = makeCharacter({ hp: 44, maxHp: 44, classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 3 }] });
			const result = shortRest(healthy, 1);
			expect(result.totalHealing).toBe(0);
		});

		it('handles character with 0 hit dice remaining', () => {
			const exhausted = makeCharacter({
				hp: 20,
				maxHp: 44,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 0 }]
			});
			const result = shortRest(exhausted, 2);
			expect(result.hitDiceResults).toHaveLength(0);
			expect(result.totalHealing).toBe(0);
		});
	});

	describe('different class hit dice', () => {
		it('uses d12 for barbarian', () => {
			const barb = makeRagingBarbarian();
			const result = shortRest(barb, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(12);
		});

		it('uses d6 for wizard', () => {
			const wiz = makeSpentWizard();
			const result = shortRest(wiz, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(6);
		});

		it('uses d8 for cleric', () => {
			const clr = makeCleric();
			const result = shortRest(clr, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(8);
		});

		it('uses d8 for rogue', () => {
			const rogue = makeCharacter({ classes: [{ name: 'rogue', level: 5, hitDiceRemaining: 3 }], hp: 10, maxHp: 30 });
			const result = shortRest(rogue, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(8);
		});

		it('uses d10 for ranger', () => {
			const ranger = makeCharacter({ classes: [{ name: 'ranger', level: 5, hitDiceRemaining: 3 }], hp: 10, maxHp: 30 });
			const result = shortRest(ranger, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(10);
		});

		it('uses d10 for paladin', () => {
			const paladin = makeCharacter({ classes: [{ name: 'paladin', level: 5, hitDiceRemaining: 3 }], hp: 10, maxHp: 30 });
			const result = shortRest(paladin, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(10);
		});

		it('uses d8 for monk', () => {
			const monk = makeCharacter({ classes: [{ name: 'monk', level: 5, hitDiceRemaining: 3 }], hp: 10, maxHp: 30 });
			const result = shortRest(monk, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(8);
		});

		it('uses d6 for sorcerer', () => {
			const sorc = makeCharacter({ classes: [{ name: 'sorcerer', level: 5, hitDiceRemaining: 3 }], hp: 10, maxHp: 30 });
			const result = shortRest(sorc, 1);
			expect(result.hitDiceResults[0].dieSides).toBe(6);
		});
	});

	describe('feature recovery', () => {
		it('recovers short-rest features', () => {
			const fighter = makeBatteredFighter(); // Action Surge + Second Wind both at 0
			const result = shortRest(fighter, 0);

			expect(result.featuresRecovered).toContain('Action Surge');
			expect(result.featuresRecovered).toContain('Second Wind');
			expect(result.character.featureUses['Action Surge'].current).toBe(1);
			expect(result.character.featureUses['Second Wind'].current).toBe(1);
		});

		it('does NOT recover long-rest features on short rest', () => {
			const barb = makeRagingBarbarian(); // Rage = long-rest, current 1/3
			const result = shortRest(barb, 0);

			expect(result.featuresRecovered).not.toContain('Rage');
			expect(result.character.featureUses['Rage'].current).toBe(1);
		});

		it('does not list already-full features as recovered', () => {
			const fighter = makeCharacter({
				featureUses: {
					'Action Surge': { current: 1, max: 1, recoversOn: 'short-rest' },
					'Second Wind': { current: 1, max: 1, recoversOn: 'short-rest' }
				}
			});
			const result = shortRest(fighter, 0);
			expect(result.featuresRecovered).toHaveLength(0);
		});

		it('handles character with no tracked features', () => {
			const fighter = makeCharacter();
			const result = shortRest(fighter, 0);
			expect(result.featuresRecovered).toHaveLength(0);
		});

		it('recovers Arcane Recovery for wizard', () => {
			const wiz = makeSpentWizard();
			const result = shortRest(wiz, 0);
			expect(result.featuresRecovered).toContain('Arcane Recovery');
			expect(result.character.featureUses['Arcane Recovery'].current).toBe(1);
		});

		it('recovers Channel Divinity for cleric', () => {
			const clr = makeCleric();
			const result = shortRest(clr, 0);
			expect(result.featuresRecovered).toContain('Channel Divinity');
			expect(result.character.featureUses['Channel Divinity'].current).toBe(1);
		});
	});

	describe('does not modify spell slots', () => {
		it('spell slots remain unchanged after short rest', () => {
			const wiz = makeSpentWizard();
			const result = shortRest(wiz, 0);
			expect(result.character.spellSlots).toEqual(wiz.spellSlots);
		});
	});

	describe('validation', () => {
		it('fails for dead character', () => {
			const dead = makeCharacter({ dead: true });
			const result = shortRest(dead, 1);
			expect(result.success).toBe(false);
			expect(result.reason).toContain('Dead');
			expect(result.character).toBe(dead); // unchanged
		});

		it('handles negative hit dice request gracefully', () => {
			const fighter = makeBatteredFighter();
			const result = shortRest(fighter, -3);
			expect(result.hitDiceResults).toHaveLength(0);
		});

		it('handles fractional hit dice request', () => {
			const fighter = makeBatteredFighter();
			const result = shortRest(fighter, 1.7);
			expect(result.hitDiceResults).toHaveLength(1);
		});
	});

	describe('immutability', () => {
		it('does not mutate the input character', () => {
			const fighter = makeBatteredFighter();
			const originalHp = fighter.hp;
			const originalHitDice = fighter.classes[0].hitDiceRemaining;
			shortRest(fighter, 2);
			expect(fighter.hp).toBe(originalHp);
			expect(fighter.classes[0].hitDiceRemaining).toBe(originalHitDice);
			expect(fighter.featureUses['Action Surge'].current).toBe(0);
		});
	});

	describe('deterministic healing (seeded PRNG)', () => {
		it('produces consistent results across runs', () => {
			const fighter = makeBatteredFighter();
			const result1 = shortRest(fighter, 2);

			// Reset and re-run with same seed
			setRng(mulberry32(SEED));
			const result2 = shortRest(fighter, 2);

			expect(result2.hitDiceResults).toEqual(result1.hitDiceResults);
			expect(result2.totalHealing).toBe(result1.totalHealing);
		});
	});
});

// ===========================================================================
// longRest
// ===========================================================================

describe('longRest', () => {
	describe('HP restoration', () => {
		it('restores HP to maximum', () => {
			const fighter = makeBatteredFighter();
			const result = longRest(fighter);

			expect(result.success).toBe(true);
			expect(result.currentHp).toBe(44);
			expect(result.hpHealed).toBe(22);
			expect(result.character.hp).toBe(44);
		});

		it('reports 0 healing if already at full HP', () => {
			const healthy = makeCharacter({ hp: 44, maxHp: 44 });
			const result = longRest(healthy);
			expect(result.hpHealed).toBe(0);
		});
	});

	describe('hit dice recovery', () => {
		it('recovers floor(level/2) hit dice (minimum 1)', () => {
			const fighter = makeBatteredFighter(); // level 5, 3/5 remaining
			const result = longRest(fighter);

			// floor(5/2) = 2 dice recovered
			expect(result.hitDiceRecovered).toBe(2);
			expect(result.currentHitDice).toBe(5);
		});

		it('caps hit dice at level', () => {
			const fighter = makeCharacter({
				level: 5,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 4 }] // only missing 1
			});
			const result = longRest(fighter);
			// floor(5/2) = 2, but only 1 missing, so recover 1
			expect(result.hitDiceRecovered).toBe(1);
			expect(result.currentHitDice).toBe(5);
		});

		it('recovers minimum 1 hit die at level 1', () => {
			const level1 = makeCharacter({
				level: 1,
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 0 }]
			});
			const result = longRest(level1);
			// floor(1/2) = 0, minimum 1
			expect(result.hitDiceRecovered).toBe(1);
			expect(result.currentHitDice).toBe(1);
		});

		it('recovers 0 if already at max hit dice', () => {
			const full = makeCharacter({
				level: 5,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }]
			});
			const result = longRest(full);
			expect(result.hitDiceRecovered).toBe(0);
		});

		it('handles level 2 (floor(2/2) = 1 die)', () => {
			const level2 = makeCharacter({
				level: 2,
				classes: [{ name: 'fighter', level: 2, hitDiceRemaining: 0 }]
			});
			const result = longRest(level2);
			expect(result.hitDiceRecovered).toBe(1);
			expect(result.currentHitDice).toBe(1);
		});

		it('handles level 10 (floor(10/2) = 5 dice)', () => {
			const level10 = makeCharacter({
				level: 10,
				classes: [{ name: 'fighter', level: 10, hitDiceRemaining: 3 }]
			});
			const result = longRest(level10);
			expect(result.hitDiceRecovered).toBe(5);
			expect(result.currentHitDice).toBe(8);
		});

		it('handles level 20 (floor(20/2) = 10 dice)', () => {
			const level20 = makeCharacter({
				level: 20,
				classes: [{ name: 'fighter', level: 20, hitDiceRemaining: 5 }]
			});
			const result = longRest(level20);
			expect(result.hitDiceRecovered).toBe(10);
			expect(result.currentHitDice).toBe(15);
		});
	});

	describe('spell slot restoration', () => {
		it('restores all spell slots to max', () => {
			const wiz = makeSpentWizard();
			const result = longRest(wiz);

			expect(result.character.spellSlots).toEqual([
				{ level: 1, current: 4, max: 4 },
				{ level: 2, current: 3, max: 3 },
				{ level: 3, current: 2, max: 2 }
			]);
		});

		it('reports spell slots restored per level', () => {
			const wiz = makeSpentWizard();
			const result = longRest(wiz);

			expect(result.spellSlotsRestored).toContainEqual({ level: 1, restored: 3 });
			expect(result.spellSlotsRestored).toContainEqual({ level: 2, restored: 3 });
			// Level 3 was already at max (1 current, 2 max) — no wait, 1/2 so restored 1
			expect(result.spellSlotsRestored).toContainEqual({ level: 3, restored: 1 });
		});

		it('does not list full slots in restored list', () => {
			const wiz = makeCharacter({
				classes: [{ name: 'wizard', level: 5, hitDiceRemaining: 5 }],
				spellSlots: [
					{ level: 1, current: 4, max: 4 },
					{ level: 2, current: 0, max: 3 }
				]
			});
			const result = longRest(wiz);
			expect(result.spellSlotsRestored).toHaveLength(1);
			expect(result.spellSlotsRestored[0]).toEqual({ level: 2, restored: 3 });
		});

		it('handles character with no spell slots', () => {
			const fighter = makeBatteredFighter();
			const result = longRest(fighter);
			expect(result.spellSlotsRestored).toHaveLength(0);
		});
	});

	describe('feature recovery', () => {
		it('recovers long-rest features', () => {
			const barb = makeRagingBarbarian(); // Rage: 1/3, long-rest
			const result = longRest(barb);

			expect(result.featuresRecovered).toContain('Rage');
			expect(result.character.featureUses['Rage'].current).toBe(3);
		});

		it('recovers short-rest features on long rest too', () => {
			const fighter = makeBatteredFighter(); // Action Surge + Second Wind at 0
			const result = longRest(fighter);

			expect(result.featuresRecovered).toContain('Action Surge');
			expect(result.featuresRecovered).toContain('Second Wind');
		});

		it('recovers both short-rest and long-rest features', () => {
			const mixed = makeCharacter({
				featureUses: {
					'Action Surge': { current: 0, max: 1, recoversOn: 'short-rest' },
					'Rage': { current: 0, max: 3, recoversOn: 'long-rest' }
				}
			});
			const result = longRest(mixed);

			expect(result.featuresRecovered).toContain('Action Surge');
			expect(result.featuresRecovered).toContain('Rage');
			expect(result.character.featureUses['Action Surge'].current).toBe(1);
			expect(result.character.featureUses['Rage'].current).toBe(3);
		});

		it('does not list already-full features', () => {
			const full = makeCharacter({
				featureUses: {
					'Action Surge': { current: 1, max: 1, recoversOn: 'short-rest' }
				}
			});
			const result = longRest(full);
			expect(result.featuresRecovered).toHaveLength(0);
		});
	});

	describe('condition clearing', () => {
		it('removes frightened condition', () => {
			const clr = makeCleric(); // has 'frightened'
			const result = longRest(clr);

			expect(result.conditionsRemoved).toContain('frightened');
			expect(result.character.conditions).not.toContain('frightened');
		});

		it('removes charmed condition', () => {
			const charmed = makeCharacter({ conditions: ['charmed'] as Condition[] });
			const result = longRest(charmed);

			expect(result.conditionsRemoved).toContain('charmed');
			expect(result.character.conditions).not.toContain('charmed');
		});

		it('does not remove non-clearable conditions', () => {
			const blinded = makeCharacter({ conditions: ['grappled', 'blinded'] as Condition[] });
			const result = longRest(blinded);

			expect(result.conditionsRemoved).toHaveLength(0);
			expect(result.character.conditions).toContain('grappled');
			expect(result.character.conditions).toContain('blinded');
		});

		it('handles multiple clearable and non-clearable conditions', () => {
			const mixed = makeCharacter({
				conditions: ['frightened', 'grappled', 'charmed', 'blinded'] as Condition[]
			});
			const result = longRest(mixed);

			expect(result.conditionsRemoved).toHaveLength(2);
			expect(result.conditionsRemoved).toContain('frightened');
			expect(result.conditionsRemoved).toContain('charmed');
			expect(result.character.conditions).toEqual(['grappled', 'blinded']);
		});
	});

	describe('death save reset', () => {
		it('resets death saves to 0/0', () => {
			const clr = makeCleric(); // has deathSaves: { successes: 2, failures: 1 }
			const result = longRest(clr);

			expect(result.deathSavesReset).toBe(true);
			expect(result.character.deathSaves).toEqual({ successes: 0, failures: 0 });
		});

		it('reports no reset if death saves were already 0/0', () => {
			const healthy = makeCharacter();
			const result = longRest(healthy);
			expect(result.deathSavesReset).toBe(false);
		});
	});

	describe('concentration clearing', () => {
		it('clears concentration on long rest', () => {
			const concentrating = makeCharacter({ concentratingOn: 'Bless' });
			const result = longRest(concentrating);
			expect(result.character.concentratingOn).toBeNull();
		});
	});

	describe('exhaustion reduction', () => {
		it('reduces exhaustion by 1 on long rest', () => {
			const exhausted = makeCharacter({ exhaustionLevel: 3 });
			const result = longRest(exhausted);
			expect(result.character.exhaustionLevel).toBe(2);
		});

		it('does not go below 0 exhaustion', () => {
			const fresh = makeCharacter({ exhaustionLevel: 0 });
			const result = longRest(fresh);
			expect(result.character.exhaustionLevel).toBe(0);
		});

		it('reduces from 1 to 0', () => {
			const tired = makeCharacter({ exhaustionLevel: 1 });
			const result = longRest(tired);
			expect(result.character.exhaustionLevel).toBe(0);
		});
	});

	describe('temp HP and stable flag', () => {
		it('clears tempHp on long rest', () => {
			const defended = makeCharacter({ tempHp: 10 });
			const result = longRest(defended);
			expect(result.character.tempHp).toBe(0);
		});

		it('clears stable flag on long rest', () => {
			const stabilized = makeCharacter({ hp: 0, stable: true });
			const result = longRest(stabilized);
			expect(result.character.stable).toBe(false);
			expect(result.character.hp).toBe(44); // healed to full
		});
	});

	describe('validation', () => {
		it('fails for dead character', () => {
			const dead = makeCharacter({ dead: true });
			const result = longRest(dead);
			expect(result.success).toBe(false);
			expect(result.reason).toContain('Dead');
			expect(result.character).toBe(dead);
		});
	});

	describe('immutability', () => {
		it('does not mutate the input character', () => {
			const wiz = makeSpentWizard();
			const origHp = wiz.hp;
			const origSlots = JSON.parse(JSON.stringify(wiz.spellSlots));
			longRest(wiz);

			expect(wiz.hp).toBe(origHp);
			expect(wiz.spellSlots).toEqual(origSlots);
		});
	});

	describe('comprehensive verification scenario (from plan)', () => {
		it('fighter at half HP, 2/3 hit dice, 0/1 Action Surge — full long rest', () => {
			const fighter = makeCharacter({
				hp: 22,
				maxHp: 44,
				level: 5,
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 2 }],
				spellSlots: [],
				featureUses: {
					'Action Surge': { current: 0, max: 1, recoversOn: 'short-rest' },
					'Second Wind': { current: 0, max: 1, recoversOn: 'short-rest' }
				}
			});

			const result = longRest(fighter);

			expect(result.success).toBe(true);
			// Full HP
			expect(result.currentHp).toBe(44);
			expect(result.hpHealed).toBe(22);
			// Hit dice: 2 + floor(5/2)=2 = 4 (capped at 5)
			expect(result.currentHitDice).toBe(4);
			expect(result.hitDiceRecovered).toBe(2);
			// Features recovered
			expect(result.featuresRecovered).toContain('Action Surge');
			expect(result.featuresRecovered).toContain('Second Wind');
			expect(result.character.featureUses['Action Surge'].current).toBe(1);
		});
	});
});

// ===========================================================================
// previewShortRest
// ===========================================================================

describe('previewShortRest', () => {
	it('shows correct hit die info for fighter', () => {
		const fighter = makeBatteredFighter(); // level 5, fighter d10, CON 14 mod +2
		const preview = previewShortRest(fighter, 2);

		expect(preview.hitDiceAvailable).toBe(3);
		expect(preview.hitDieSides).toBe(10);
		expect(preview.conMod).toBe(2);
		// Average of d10 = 5.5, + 2 = 7.5, floor = 7
		expect(preview.averageHealingPerDie).toBe(7);
		// 2 dice * 7 = 14, hpDeficit = 22
		expect(preview.expectedTotalHealing).toBe(14);
		expect(preview.hpDeficit).toBe(22);
	});

	it('lists features that would recover', () => {
		const fighter = makeBatteredFighter();
		const preview = previewShortRest(fighter, 0);

		expect(preview.featuresRecovering).toContain('Action Surge');
		expect(preview.featuresRecovering).toContain('Second Wind');
	});

	it('does not list long-rest features', () => {
		const barb = makeRagingBarbarian();
		const preview = previewShortRest(barb, 0);
		expect(preview.featuresRecovering).not.toContain('Rage');
	});

	it('caps expected healing at HP deficit', () => {
		const almostFull = makeCharacter({
			hp: 42,
			maxHp: 44,
			classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }]
		});
		const preview = previewShortRest(almostFull, 3);
		// deficit = 2, should not exceed that
		expect(preview.expectedTotalHealing).toBeLessThanOrEqual(2);
	});

	it('clamps dice to available', () => {
		const fighter = makeCharacter({
			hp: 20,
			maxHp: 44,
			classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 1 }]
		});
		const preview = previewShortRest(fighter, 5);
		// Average healing capped at 1 die
		const expectedPerDie = preview.averageHealingPerDie;
		expect(preview.expectedTotalHealing).toBeLessThanOrEqual(preview.hpDeficit);
		// At most 1 die worth
		expect(preview.expectedTotalHealing).toBe(Math.min(expectedPerDie, 24));
	});

	it('shows 0 expected healing for wizard at full HP', () => {
		const healthy = makeCharacter({
			classes: [{ name: 'wizard', level: 5, hitDiceRemaining: 3 }],
			hp: 22,
			maxHp: 22,
		});
		const preview = previewShortRest(healthy, 2);
		expect(preview.expectedTotalHealing).toBe(0);
		expect(preview.hpDeficit).toBe(0);
	});

	it('handles negative CON modifier correctly', () => {
		const weak = makeCharacter({
			hp: 10,
			maxHp: 20,
			classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 3 }],
			abilities: { str: 10, dex: 10, con: 6, int: 10, wis: 10, cha: 10 }
		});
		const preview = previewShortRest(weak, 1);
		expect(preview.conMod).toBe(-2);
		// d10 average 5.5 - 2 = 3.5, floor = 3
		expect(preview.averageHealingPerDie).toBe(3);
	});
});

// ===========================================================================
// previewLongRest
// ===========================================================================

describe('previewLongRest', () => {
	it('shows HP deficit', () => {
		const fighter = makeBatteredFighter();
		const preview = previewLongRest(fighter);
		expect(preview.hpToRestore).toBe(22);
	});

	it('shows hit dice recovery', () => {
		const fighter = makeBatteredFighter(); // level 5, 3 remaining
		const preview = previewLongRest(fighter);
		expect(preview.hitDiceToRecover).toBe(2);
		expect(preview.currentHitDice).toBe(3);
		expect(preview.hitDiceAfter).toBe(5);
	});

	it('shows spell slots to restore', () => {
		const wiz = makeSpentWizard();
		const preview = previewLongRest(wiz);
		expect(preview.spellSlotsToRestore).toContainEqual({ level: 1, toRestore: 3 });
		expect(preview.spellSlotsToRestore).toContainEqual({ level: 2, toRestore: 3 });
		expect(preview.spellSlotsToRestore).toContainEqual({ level: 3, toRestore: 1 });
	});

	it('shows features that would recover', () => {
		const barb = makeRagingBarbarian();
		const preview = previewLongRest(barb);
		expect(preview.featuresRecovering).toContain('Rage');
	});

	it('shows conditions to remove', () => {
		const clr = makeCleric();
		const preview = previewLongRest(clr);
		expect(preview.conditionsToRemove).toContain('frightened');
	});

	it('shows death save reset status', () => {
		const clr = makeCleric(); // has non-zero death saves
		const preview = previewLongRest(clr);
		expect(preview.deathSavesWouldReset).toBe(true);
	});

	it('shows no death save reset when already at 0/0', () => {
		const healthy = makeCharacter();
		const preview = previewLongRest(healthy);
		expect(preview.deathSavesWouldReset).toBe(false);
	});

	it('reports 0 for fully rested character', () => {
		const fresh = makeCharacter({ hp: 44, maxHp: 44, classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }] });
		const preview = previewLongRest(fresh);
		expect(preview.hpToRestore).toBe(0);
		expect(preview.hitDiceToRecover).toBe(0);
		expect(preview.spellSlotsToRestore).toHaveLength(0);
		expect(preview.featuresRecovering).toHaveLength(0);
		expect(preview.conditionsToRemove).toHaveLength(0);
		expect(preview.deathSavesWouldReset).toBe(false);
	});
});

// ===========================================================================
// useFeature
// ===========================================================================

describe('useFeature', () => {
	it('decrements current uses by 1', () => {
		const char = makeCharacter({
			featureUses: {
				'Action Surge': { current: 1, max: 1, recoversOn: 'short-rest' }
			}
		});
		const result = useFeature(char, 'Action Surge');

		expect(result.used).toBe(true);
		expect(result.remaining).toBe(0);
		expect(result.character.featureUses['Action Surge'].current).toBe(0);
	});

	it('returns used: false when feature has 0 uses', () => {
		const char = makeCharacter({
			featureUses: {
				'Action Surge': { current: 0, max: 1, recoversOn: 'short-rest' }
			}
		});
		const result = useFeature(char, 'Action Surge');

		expect(result.used).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it('allows unlimited use for untracked features', () => {
		const char = makeCharacter();
		const result = useFeature(char, 'Extra Attack'); // not in featureUses

		expect(result.used).toBe(true);
		expect(result.remaining).toBe(Infinity);
	});

	it('handles multi-use features correctly', () => {
		const char = makeCharacter({
			featureUses: {
				'Rage': { current: 3, max: 3, recoversOn: 'long-rest' }
			}
		});
		const r1 = useFeature(char, 'Rage');
		expect(r1.remaining).toBe(2);

		const r2 = useFeature(r1.character, 'Rage');
		expect(r2.remaining).toBe(1);

		const r3 = useFeature(r2.character, 'Rage');
		expect(r3.remaining).toBe(0);

		const r4 = useFeature(r3.character, 'Rage');
		expect(r4.used).toBe(false);
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter({
			featureUses: {
				'Action Surge': { current: 1, max: 1, recoversOn: 'short-rest' }
			}
		});
		useFeature(char, 'Action Surge');
		expect(char.featureUses['Action Surge'].current).toBe(1);
	});
});

// ===========================================================================
// Short rest → Long rest scenario (integration)
// ===========================================================================

describe('Short Rest → Long Rest integration', () => {
	it('fighter uses features, short rests, then long rests', () => {
		// Start: Fighter with Action Surge and Second Wind used, damaged
		let fighter = makeBatteredFighter();

		// Use Action Surge (already at 0, so can't use)
		const use1 = useFeature(fighter, 'Action Surge');
		expect(use1.used).toBe(false);
		fighter = use1.character;

		// Short rest: spend 1 hit die, recover features
		const sr = shortRest(fighter, 1);
		expect(sr.success).toBe(true);
		expect(sr.featuresRecovered).toContain('Action Surge');
		expect(sr.featuresRecovered).toContain('Second Wind');
		fighter = sr.character;

		// Use Action Surge (now available)
		const use2 = useFeature(fighter, 'Action Surge');
		expect(use2.used).toBe(true);
		expect(use2.remaining).toBe(0);
		fighter = use2.character;

		// Long rest: full recovery
		const lr = longRest(fighter);
		expect(lr.success).toBe(true);
		expect(lr.currentHp).toBe(44);
		expect(lr.character.featureUses['Action Surge'].current).toBe(1);
		fighter = lr.character;

		// Verify fully restored
		expect(fighter.hp).toBe(44);
		expect(fighter.featureUses['Action Surge'].current).toBe(1);
		expect(fighter.featureUses['Second Wind'].current).toBe(1);
	});

	it('wizard uses slots and features, then long rests to full', () => {
		let wiz = makeSpentWizard();
		// Start: HP 15/22, hitDice 2/5, slots partially spent, Arcane Recovery spent

		// Short rest: recover Arcane Recovery only (no hit dice)
		const sr = shortRest(wiz, 0);
		expect(sr.featuresRecovered).toContain('Arcane Recovery');
		wiz = sr.character;

		// Long rest: everything recovers
		const lr = longRest(wiz);
		expect(lr.currentHp).toBe(22);
		expect(lr.character.spellSlots[0].current).toBe(4); // level 1 slots restored
		expect(lr.character.spellSlots[1].current).toBe(3); // level 2 slots restored
		expect(lr.character.spellSlots[2].current).toBe(2); // level 3 slots restored
	});

	it('barbarian long rest — Rage recovers, short rest does not recover Rage', () => {
		let barb = makeRagingBarbarian(); // Rage: 1/3, long-rest recovery

		// Short rest should NOT restore Rage
		const sr = shortRest(barb, 0);
		expect(sr.featuresRecovered).not.toContain('Rage');
		barb = sr.character;
		expect(barb.featureUses['Rage'].current).toBe(1);

		// Long rest should restore Rage
		const lr = longRest(barb);
		expect(lr.featuresRecovered).toContain('Rage');
		expect(lr.character.featureUses['Rage'].current).toBe(3);
	});

	it('cleric long rest clears conditions, recovers slots and features, resets death saves', () => {
		const clr = makeCleric();
		const lr = longRest(clr);

		// HP restored
		expect(lr.currentHp).toBe(38);
		// Conditions cleared (frightened)
		expect(lr.conditionsRemoved).toContain('frightened');
		// Spell slots restored
		expect(lr.character.spellSlots[0].current).toBe(4);
		expect(lr.character.spellSlots[1].current).toBe(3);
		expect(lr.character.spellSlots[2].current).toBe(2);
		// Channel Divinity recovered
		expect(lr.featuresRecovered).toContain('Channel Divinity');
		// Death saves reset
		expect(lr.deathSavesReset).toBe(true);
		expect(lr.character.deathSaves).toEqual({ successes: 0, failures: 0 });
	});
});

// ===========================================================================
// buildFeatureUses (via character creation)
// ===========================================================================

describe('buildFeatureUses', () => {
	// Test through the exported function from character-creation
	it('is accessible via character-creation module', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [
			{ name: 'Action Surge' },
			{ name: 'Second Wind' },
			{ name: 'Fighting Style' } // not limited use
		];
		const uses = buildFeatureUses(features, 5);
		expect(uses['Action Surge']).toBeDefined();
		expect(uses['Action Surge'].max).toBe(1);
		expect(uses['Action Surge'].recoversOn).toBe('short-rest');
		expect(uses['Second Wind'].max).toBe(1);
		expect(uses['Fighting Style']).toBeUndefined();
	});

	it('scales Rage uses with level', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Rage' }];
		expect(buildFeatureUses(features, 1).Rage.max).toBe(2);
		expect(buildFeatureUses(features, 3).Rage.max).toBe(3);
		expect(buildFeatureUses(features, 6).Rage.max).toBe(4);
		expect(buildFeatureUses(features, 12).Rage.max).toBe(5);
		expect(buildFeatureUses(features, 17).Rage.max).toBe(6);
	});

	it('sets Bardic Inspiration max to CHA mod (minimum 1)', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Bardic Inspiration' }];
		expect(buildFeatureUses(features, 1, { cha: 16 })['Bardic Inspiration'].max).toBe(3);
		expect(buildFeatureUses(features, 1, { cha: 8 })['Bardic Inspiration'].max).toBe(1); // min 1
	});

	it('sets Lay on Hands pool to 5 × level', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Lay on Hands' }];
		expect(buildFeatureUses(features, 3)['Lay on Hands'].max).toBe(15);
		expect(buildFeatureUses(features, 10)['Lay on Hands'].max).toBe(50);
	});

	it('sets Ki points equal to monk level', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Ki' }];
		expect(buildFeatureUses(features, 5).Ki.max).toBe(5);
		expect(buildFeatureUses(features, 5).Ki.recoversOn).toBe('short-rest');
	});

	it('scales Indomitable uses with level', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Indomitable' }];
		expect(buildFeatureUses(features, 9).Indomitable.max).toBe(1);
		expect(buildFeatureUses(features, 13).Indomitable.max).toBe(2);
		expect(buildFeatureUses(features, 17).Indomitable.max).toBe(3);
	});

	it('scales Channel Divinity uses with level', async () => {
		const { buildFeatureUses } = await import('./character-creation');
		const features = [{ name: 'Channel Divinity' }];
		expect(buildFeatureUses(features, 2)['Channel Divinity'].max).toBe(1);
		expect(buildFeatureUses(features, 6)['Channel Divinity'].max).toBe(2);
		expect(buildFeatureUses(features, 18)['Channel Divinity'].max).toBe(3);
	});
});

// ===========================================================================
// CLASS_HIT_DIE coverage
// ===========================================================================

describe('CLASS_HIT_DIE values', () => {
	it('all 12 classes have defined hit die sizes', () => {
		expect(CLASS_HIT_DIE.fighter).toBe(10);
		expect(CLASS_HIT_DIE.wizard).toBe(6);
		expect(CLASS_HIT_DIE.rogue).toBe(8);
		expect(CLASS_HIT_DIE.cleric).toBe(8);
		expect(CLASS_HIT_DIE.ranger).toBe(10);
		expect(CLASS_HIT_DIE.barbarian).toBe(12);
		expect(CLASS_HIT_DIE.bard).toBe(8);
		expect(CLASS_HIT_DIE.paladin).toBe(10);
		expect(CLASS_HIT_DIE.sorcerer).toBe(6);
		expect(CLASS_HIT_DIE.warlock).toBe(8);
		expect(CLASS_HIT_DIE.druid).toBe(8);
		expect(CLASS_HIT_DIE.monk).toBe(8);
	});
});

// ===========================================================================
// Multiclass Rest Scenarios (Step 6)
// ===========================================================================

describe('multiclass rest — short rest preview', () => {
	/** Fighter 3 / Wizard 2 — multiclass character */
	function makeMulticlassChar(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
		return makeCharacter({
			level: 5,
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 2 },
				{ name: 'wizard', level: 2, hitDiceRemaining: 1 }
			],
			hp: 20,
			maxHp: 35,
			...overrides
		});
	}

	it('perClassDice shows breakdown for each class', () => {
		const char = makeMulticlassChar();
		const preview = previewShortRest(char);
		expect(preview.perClassDice).toHaveLength(2);

		const ftrDice = preview.perClassDice.find(d => d.className === 'fighter');
		expect(ftrDice).toBeDefined();
		expect(ftrDice!.dieSides).toBe(10); // fighter d10
		expect(ftrDice!.available).toBe(2);
		expect(ftrDice!.total).toBe(3);

		const wizDice = preview.perClassDice.find(d => d.className === 'wizard');
		expect(wizDice).toBeDefined();
		expect(wizDice!.dieSides).toBe(6); // wizard d6
		expect(wizDice!.available).toBe(1);
		expect(wizDice!.total).toBe(2);
	});

	it('hitDiceAvailable sums across all classes', () => {
		const char = makeMulticlassChar();
		const preview = previewShortRest(char);
		// fighter 2 + wizard 1 = 3
		expect(preview.hitDiceAvailable).toBe(3);
	});

	it('pactSlotsToRecover counts missing pact slots', () => {
		const char = makeMulticlassChar({
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
				{ name: 'warlock', level: 2, hitDiceRemaining: 2 }
			],
			pactSlots: [{ level: 1, current: 0, max: 2 }]
		});
		const preview = previewShortRest(char);
		expect(preview.pactSlotsToRecover).toBe(2);
	});

	it('pactSlotsToRecover is 0 when pact slots full', () => {
		const char = makeMulticlassChar({
			pactSlots: [{ level: 1, current: 2, max: 2 }]
		});
		const preview = previewShortRest(char);
		expect(preview.pactSlotsToRecover).toBe(0);
	});

	it('pactSlotsToRecover is 0 when no pact slots exist', () => {
		const char = makeMulticlassChar();
		const preview = previewShortRest(char);
		expect(preview.pactSlotsToRecover).toBe(0);
	});

	it('rogue 2 / wizard 3 shows separate d8 and d6 hit-die pools', () => {
		const char = makeMulticlassChar({
			classes: [
				{ name: 'rogue', level: 2, hitDiceRemaining: 2 },
				{ name: 'wizard', level: 3, hitDiceRemaining: 1 }
			]
		});
		const preview = previewShortRest(char);
		const rogueDice = preview.perClassDice.find((d) => d.className === 'rogue');
		const wizardDice = preview.perClassDice.find((d) => d.className === 'wizard');
		expect(rogueDice?.dieSides).toBe(8);
		expect(rogueDice?.available).toBe(2);
		expect(wizardDice?.dieSides).toBe(6);
		expect(wizardDice?.available).toBe(1);
	});
});

describe('multiclass rest — short rest pact slot recovery', () => {
	it('short rest recovers pact slots to max', () => {
		setRng(mulberry32(SEED));
		const char = makeCharacter({
			level: 5,
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 3 },
				{ name: 'warlock', level: 2, hitDiceRemaining: 2 }
			],
			hp: 40,
			maxHp: 40,
			pactSlots: [{ level: 1, current: 0, max: 2 }]
		});
		const result = shortRest(char, 0);
		expect(result.success).toBe(true);
		expect(result.character.pactSlots[0].current).toBe(2);
	});
});

describe('multiclass rest — long rest per-class hit dice recovery', () => {
	it('long rest recovers half total level worth of hit dice', () => {
		setRng(mulberry32(SEED));
		const char = makeCharacter({
			level: 6,
			classes: [
				{ name: 'fighter', level: 4, hitDiceRemaining: 1 },
				{ name: 'wizard', level: 2, hitDiceRemaining: 0 }
			],
			hp: 20,
			maxHp: 40,
			spellSlots: [
				{ level: 1, current: 0, max: 4 },
				{ level: 2, current: 0, max: 3 }
			]
		});
		const result = longRest(char);
		expect(result.success).toBe(true);
		// HP fully restored
		expect(result.character.hp).toBe(result.character.maxHp);
		// Hit dice: recover floor(6/2) = 3 dice total across classes
		const totalRecovered =
			(result.character.classes.find(c => c.name === 'fighter')!.hitDiceRemaining - 1) +
			(result.character.classes.find(c => c.name === 'wizard')!.hitDiceRemaining - 0);
		expect(totalRecovered).toBe(3);
	});
});
