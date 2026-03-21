/**
 * Phase 8a Unit Tests — Creature Template System
 *
 * Tests cover:
 *   - All 5 tiers produce valid CreatureStatBlock values
 *   - Stats scale appropriately with party level
 *   - CR snapping to valid stops
 *   - Creature name keywords influence attack types / damage types
 *   - Ability score generation responds to creature name
 *   - Edge cases: level 1, level 20, unknown creature names
 *   - Tier parsing and validation
 *   - Average party level calculation
 *   - Resistances / immunities / vulnerabilities inferred from name
 *   - Boss tier gets legendary resistance trait and legendary actions
 */

import { describe, it, expect } from 'vitest';
import {
	generateCreatureStatBlock,
	snapCR,
	averagePartyLevel,
	parseCreatureTier,
	CREATURE_TIERS,
	type CreatureTier
} from './creature-templates';
import type { CreatureStatBlock } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidStatBlock(sb: CreatureStatBlock): void {
	// HP
	expect(sb.hp).toBeGreaterThan(0);
	expect(sb.maxHp).toBe(sb.hp);

	// AC
	expect(sb.ac).toBeGreaterThanOrEqual(10);
	expect(sb.ac).toBeLessThanOrEqual(24);

	// Abilities — all between 1 and 30
	for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
		expect(sb.abilities[key]).toBeGreaterThanOrEqual(1);
		expect(sb.abilities[key]).toBeLessThanOrEqual(30);
	}

	// Speed
	expect(sb.speed).toBeGreaterThanOrEqual(0);

	// CR
	expect(sb.cr).toBeGreaterThanOrEqual(0);
	expect(sb.cr).toBeLessThanOrEqual(20);

	// Attacks — at least one
	expect(sb.attacks.length).toBeGreaterThanOrEqual(1);
	for (const atk of sb.attacks) {
		expect(atk.name).toBeTruthy();
		expect(atk.toHit).toBeGreaterThanOrEqual(0);
		expect(atk.damage).toBeTruthy();
		expect(atk.damageType).toBeTruthy();
	}

	// Saving throws
	expect(sb.savingThrows.length).toBeGreaterThanOrEqual(1);

	// Skills
	expect(sb.skills.length).toBeGreaterThanOrEqual(1);

	// Arrays exist
	expect(Array.isArray(sb.resistances)).toBe(true);
	expect(Array.isArray(sb.immunities)).toBe(true);
	expect(Array.isArray(sb.vulnerabilities)).toBe(true);
	expect(Array.isArray(sb.traits)).toBe(true);
	expect(Array.isArray(sb.actions)).toBe(true);
	expect(Array.isArray(sb.legendaryActions)).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Creature Template System (Phase 8a)', () => {
	describe('generateCreatureStatBlock', () => {
		describe('produces valid stat blocks for all tiers', () => {
			const tiers: CreatureTier[] = ['weak', 'normal', 'tough', 'elite', 'boss'];

			for (const tier of tiers) {
				it(`tier="${tier}" at party level 5`, () => {
					const sb = generateCreatureStatBlock('Bandit', tier, 5);
					isValidStatBlock(sb);
				});
			}
		});

		describe('produces valid stat blocks across party levels', () => {
			const levels = [1, 3, 5, 10, 15, 20];

			for (const level of levels) {
				it(`party level ${level} with "normal" tier`, () => {
					const sb = generateCreatureStatBlock('Orc Warrior', 'normal', level);
					isValidStatBlock(sb);
				});
			}
		});

		describe('stats scale with party level', () => {
			it('higher party level → higher HP', () => {
				const low = generateCreatureStatBlock('Wolf', 'normal', 1);
				const mid = generateCreatureStatBlock('Wolf', 'normal', 10);
				const high = generateCreatureStatBlock('Wolf', 'normal', 20);
				expect(mid.hp).toBeGreaterThan(low.hp);
				expect(high.hp).toBeGreaterThan(mid.hp);
			});

			it('higher party level → higher AC', () => {
				const low = generateCreatureStatBlock('Guard', 'normal', 1);
				const high = generateCreatureStatBlock('Guard', 'normal', 20);
				expect(high.ac).toBeGreaterThanOrEqual(low.ac);
			});

			it('higher party level → higher CR', () => {
				const low = generateCreatureStatBlock('Spider', 'normal', 1);
				const mid = generateCreatureStatBlock('Spider', 'normal', 10);
				const high = generateCreatureStatBlock('Spider', 'normal', 20);
				expect(mid.cr).toBeGreaterThanOrEqual(low.cr);
				expect(high.cr).toBeGreaterThan(mid.cr);
			});
		});

		describe('stats scale with tier', () => {
			it('boss has more HP than weak at same party level', () => {
				const weak = generateCreatureStatBlock('Orc', 'weak', 5);
				const boss = generateCreatureStatBlock('Orc', 'boss', 5);
				expect(boss.hp).toBeGreaterThan(weak.hp);
			});

			it('tiers produce ascending CR for same party level', () => {
				const tiers: CreatureTier[] = ['weak', 'normal', 'tough', 'elite', 'boss'];
				const crs = tiers.map(t => generateCreatureStatBlock('Bandit', t, 8).cr);
				for (let i = 1; i < crs.length; i++) {
					expect(crs[i]).toBeGreaterThanOrEqual(crs[i - 1]);
				}
			});

			it('elite and boss get WIS saving throw proficiency', () => {
				const elite = generateCreatureStatBlock('Guard', 'elite', 8);
				const boss = generateCreatureStatBlock('Guard', 'boss', 8);
				const normal = generateCreatureStatBlock('Guard', 'normal', 8);

				expect(elite.savingThrows.some(s => s.ability === 'wis')).toBe(true);
				expect(boss.savingThrows.some(s => s.ability === 'wis')).toBe(true);
				expect(normal.savingThrows.some(s => s.ability === 'wis')).toBe(false);
			});
		});

		describe('creature name keywords influence attacks', () => {
			it('wolf gets Bite attack', () => {
				const sb = generateCreatureStatBlock('Dire Wolf', 'normal', 5);
				expect(sb.attacks.some(a => a.name === 'Bite')).toBe(true);
				expect(sb.attacks.some(a => a.damageType === 'piercing')).toBe(true);
			});

			it('bandit gets Shortsword', () => {
				const sb = generateCreatureStatBlock('Highway Bandit', 'normal', 5);
				expect(sb.attacks.some(a => a.name === 'Shortsword')).toBe(true);
				expect(sb.attacks.some(a => a.damageType === 'piercing')).toBe(true);
			});

			it('skeleton gets Rusty Shortsword', () => {
				const sb = generateCreatureStatBlock('Skeleton Guard', 'normal', 5);
				expect(sb.attacks.some(a => a.name === 'Rusty Shortsword')).toBe(true);
			});

			it('dragon gets Bite + Claw + Breath Weapon', () => {
				const sb = generateCreatureStatBlock('Young Red Dragon', 'boss', 10);
				expect(sb.attacks.some(a => a.name === 'Bite')).toBe(true);
				expect(sb.attacks.some(a => a.name === 'Claw')).toBe(true);
				expect(sb.attacks.some(a => a.name === 'Breath Weapon')).toBe(true);
			});

			it('mage gets Arcane Blast with force damage', () => {
				const sb = generateCreatureStatBlock('Dark Mage', 'tough', 5);
				expect(sb.attacks.some(a => a.name === 'Arcane Blast')).toBe(true);
				expect(sb.attacks.some(a => a.damageType === 'force')).toBe(true);
			});

			it('unknown creature gets generic Strike/Slam', () => {
				const sb = generateCreatureStatBlock('Zxyblorg the Unknowable', 'normal', 5);
				const names = sb.attacks.map(a => a.name);
				expect(names.includes('Strike') || names.includes('Slam')).toBe(true);
			});

			it('ghost gets Withering Touch with necrotic damage', () => {
				const sb = generateCreatureStatBlock('Vengeful Ghost', 'tough', 8);
				expect(sb.attacks.some(a => a.name === 'Withering Touch')).toBe(true);
				expect(sb.attacks.some(a => a.damageType === 'necrotic')).toBe(true);
			});

			it('ranged attacks include range property', () => {
				const sb = generateCreatureStatBlock('Goblin Archer', 'normal', 3);
				const rangedAttack = sb.attacks.find(a => a.range);
				expect(rangedAttack).toBeDefined();
			});
		});

		describe('ability scores respond to creature name', () => {
			it('ogre has high STR', () => {
				const sb = generateCreatureStatBlock('Ogre Brute', 'tough', 5);
				expect(sb.abilities.str).toBeGreaterThan(sb.abilities.int);
			});

			it('mage has high INT', () => {
				const sb = generateCreatureStatBlock('Arcane Mage', 'tough', 5);
				expect(sb.abilities.int).toBeGreaterThan(sb.abilities.str);
			});

			it('assassin has high DEX', () => {
				const sb = generateCreatureStatBlock('Shadow Assassin', 'tough', 5);
				expect(sb.abilities.dex).toBeGreaterThan(sb.abilities.str);
			});

			it('cleric has high WIS', () => {
				const sb = generateCreatureStatBlock('Dark Priest', 'tough', 5);
				expect(sb.abilities.wis).toBeGreaterThanOrEqual(sb.abilities.str);
			});
		});

		describe('boss tier special features', () => {
			it('boss gets Legendary Resistance trait', () => {
				const sb = generateCreatureStatBlock('War Chief', 'boss', 10);
				expect(sb.traits.some(t => t.name === 'Legendary Resistance')).toBe(true);
			});

			it('boss gets legendary actions', () => {
				const sb = generateCreatureStatBlock('Ancient Warden', 'boss', 10);
				expect(sb.legendaryActions.length).toBeGreaterThanOrEqual(2);
				expect(sb.legendaryActions.some(a => a.name === 'Attack')).toBe(true);
				expect(sb.legendaryActions.some(a => a.name === 'Move')).toBe(true);
			});

			it('non-boss tiers have no legendary actions', () => {
				for (const tier of ['weak', 'normal', 'tough', 'elite'] as const) {
					const sb = generateCreatureStatBlock('Guard', tier, 5);
					expect(sb.legendaryActions.length).toBe(0);
				}
			});

			it('non-boss tiers have no Legendary Resistance trait', () => {
				for (const tier of ['weak', 'normal', 'tough', 'elite'] as const) {
					const sb = generateCreatureStatBlock('Guard', tier, 5);
					expect(sb.traits.some(t => t.name === 'Legendary Resistance')).toBe(false);
				}
			});
		});

		describe('resistances / immunities / vulnerabilities', () => {
			it('skeleton is immune to poison and vulnerable to bludgeoning', () => {
				const sb = generateCreatureStatBlock('Skeletal Warrior', 'normal', 5);
				expect(sb.immunities).toContain('poison');
				expect(sb.vulnerabilities).toContain('bludgeoning');
			});

			it('ghost has necrotic-themed resistances and poison immunity', () => {
				const sb = generateCreatureStatBlock('Howling Ghost', 'tough', 8);
				expect(sb.resistances.length).toBeGreaterThan(0);
				expect(sb.immunities).toContain('poison');
			});

			it('golem is immune to poison and psychic', () => {
				const sb = generateCreatureStatBlock('Iron Golem', 'elite', 10);
				expect(sb.immunities).toContain('poison');
				expect(sb.immunities).toContain('psychic');
			});

			it('treant is vulnerable to fire', () => {
				const sb = generateCreatureStatBlock('Ancient Treant', 'boss', 12);
				expect(sb.vulnerabilities).toContain('fire');
			});

			it('generic creature has no resistances/immunities/vulnerabilities', () => {
				const sb = generateCreatureStatBlock('Random Creature', 'normal', 5);
				expect(sb.resistances.length).toBe(0);
				expect(sb.immunities.length).toBe(0);
				expect(sb.vulnerabilities.length).toBe(0);
			});
		});

		describe('edge cases', () => {
			it('party level 0 or negative clamps to 1', () => {
				const sb = generateCreatureStatBlock('Rat', 'normal', 0);
				isValidStatBlock(sb);
				expect(sb.cr).toBeGreaterThanOrEqual(0);
			});

			it('empty creature name produces valid stats with generic attacks', () => {
				const sb = generateCreatureStatBlock('', 'normal', 5);
				isValidStatBlock(sb);
			});

			it('actions mirror attacks', () => {
				const sb = generateCreatureStatBlock('Wolf', 'normal', 5);
				expect(sb.actions.length).toBe(sb.attacks.length);
				for (let i = 0; i < sb.attacks.length; i++) {
					expect(sb.actions[i].name).toBe(sb.attacks[i].name);
					expect(sb.actions[i].attack).toEqual(sb.attacks[i]);
				}
			});

			it('speed varies by creature type', () => {
				const wolf = generateCreatureStatBlock('Dire Wolf', 'normal', 5);
				const zombie = generateCreatureStatBlock('Shambling Zombie', 'normal', 5);
				expect(wolf.speed).toBeGreaterThan(zombie.speed);
			});
		});
	});

	describe('snapCR', () => {
		it('snaps 0.1 to 0.125', () => {
			expect(snapCR(0.1)).toBe(0.125);
		});

		it('snaps 0.3 to 0.25', () => {
			expect(snapCR(0.3)).toBe(0.25);
		});

		it('snaps 0.4 to 0.5', () => {
			expect(snapCR(0.4)).toBe(0.5);
		});

		it('snaps 0.8 to 1', () => {
			expect(snapCR(0.8)).toBe(1);
		});

		it('integer CRs pass through', () => {
			for (const cr of [1, 2, 5, 10, 15, 20]) {
				expect(snapCR(cr)).toBe(cr);
			}
		});

		it('clamps above 20 to 20', () => {
			expect(snapCR(25)).toBe(20);
		});

		it('clamps negative to 0', () => {
			expect(snapCR(-5)).toBe(0);
		});

		it('snaps 2.5 to nearest integer CR', () => {
			const result = snapCR(2.5);
			expect(result === 2 || result === 3).toBe(true);
		});
	});

	describe('averagePartyLevel', () => {
		it('returns 1 for empty party', () => {
			expect(averagePartyLevel([])).toBe(1);
		});

		it('returns exact level for single-member party', () => {
			expect(averagePartyLevel([{ level: 5 }])).toBe(5);
		});

		it('averages multiple members', () => {
			expect(averagePartyLevel([
				{ level: 3 },
				{ level: 5 },
				{ level: 7 }
			])).toBe(5);
		});

		it('rounds to nearest integer', () => {
			expect(averagePartyLevel([
				{ level: 3 },
				{ level: 4 }
			])).toBe(4); // 3.5 rounds to 4
		});

		it('clamps to minimum 1', () => {
			expect(averagePartyLevel([{ level: 0 }])).toBe(1);
		});
	});

	describe('parseCreatureTier', () => {
		it('parses valid tier strings', () => {
			for (const tier of CREATURE_TIERS) {
				expect(parseCreatureTier(tier)).toBe(tier);
			}
		});

		it('returns "normal" for unknown string', () => {
			expect(parseCreatureTier('legendary')).toBe('normal');
			expect(parseCreatureTier('minion')).toBe('normal');
			expect(parseCreatureTier('garbage')).toBe('normal');
		});

		it('returns "normal" for non-string input', () => {
			expect(parseCreatureTier(42)).toBe('normal');
			expect(parseCreatureTier(null)).toBe('normal');
			expect(parseCreatureTier(undefined)).toBe('normal');
			expect(parseCreatureTier({})).toBe('normal');
		});
	});

	describe('CREATURE_TIERS constant', () => {
		it('contains exactly 5 tiers', () => {
			expect(CREATURE_TIERS).toHaveLength(5);
		});

		it('lists tiers in ascending difficulty', () => {
			expect(CREATURE_TIERS).toEqual(['weak', 'normal', 'tough', 'elite', 'boss']);
		});
	});
});
