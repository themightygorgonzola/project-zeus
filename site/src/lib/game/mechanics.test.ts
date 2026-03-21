/**
 * Phase A Unit Tests — Core Roll Engine + Condition Enforcement
 *
 * Uses seeded PRNG (mulberry32) for deterministic assertions.
 * Tests cover:
 *   - Advantage / disadvantage roll mechanics
 *   - Condition-driven roll modifiers (resolveRollModifiers)
 *   - Auto-fail saves (paralyzed + STR/DEX)
 *   - Expertise (double proficiency)
 *   - Passive scores
 *   - Contested checks
 *   - Tool checks
 *   - Fixed critical hit damage (double dice, not modifier)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	mulberry32,
	setRng,
	resetRng,
	roll,
	rollDie,
	rollDice,
	rollD20,
	abilityModifier,
	proficiencyBonus,
	resolveRollModifiers,
	skillCheck,
	abilityCheck,
	savingThrow,
	attackRoll,
	passiveScore,
	contestedCheck,
	toolCheck,
	applyDamage,
	applyHealing,
	toMechanicResult,
	attackToMechanicResult
} from './mechanics';
import type { PlayerCharacter, Condition } from './types';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Deterministic seed for all tests. */
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

function makeRogue(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeCharacter({
		name: 'Sneaky Pete',
		classes: [{ name: 'rogue', level: 5, hitDiceRemaining: 5 }],
		abilities: { str: 8, dex: 18, con: 12, int: 14, wis: 12, cha: 10 },
		skillProficiencies: ['stealth', 'sleight-of-hand', 'acrobatics', 'perception'],
		expertiseSkills: ['stealth', 'sleight-of-hand'],
		saveProficiencies: ['dex', 'int'],
		toolProficiencies: ['thieves-tools'],
		...overrides
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

// ---------------------------------------------------------------------------
// Core Dice
// ---------------------------------------------------------------------------

describe('Core Dice Rolling', () => {
	it('rollDie produces values in range [1, sides]', () => {
		for (let i = 0; i < 100; i++) {
			const val = rollDie(20);
			expect(val).toBeGreaterThanOrEqual(1);
			expect(val).toBeLessThanOrEqual(20);
		}
	});

	it('rollDice returns correct count', () => {
		const results = rollDice(4, 6);
		expect(results).toHaveLength(4);
		for (const v of results) {
			expect(v).toBeGreaterThanOrEqual(1);
			expect(v).toBeLessThanOrEqual(6);
		}
	});

	it('roll parses standard notation', () => {
		const result = roll('2d6+3');
		expect(result.notation).toBe('2d6+3');
		expect(result.rolls).toHaveLength(2);
		expect(result.total).toBe(result.rolls.reduce((s, v) => s + v, 0) + 3);
	});

	it('roll with keep highest', () => {
		const result = roll('4d6kh3');
		expect(result.rolls).toHaveLength(4);
		// total should be sum of top 3
		const sorted = [...result.rolls].sort((a, b) => b - a);
		const expected = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
		expect(result.total).toBe(expected);
	});

	it('roll throws on invalid notation', () => {
		expect(() => roll('garbage')).toThrow('Invalid dice notation');
	});
});

// ---------------------------------------------------------------------------
// Ability Helpers
// ---------------------------------------------------------------------------

describe('Ability Helpers', () => {
	it('abilityModifier follows 5e formula', () => {
		expect(abilityModifier(1)).toBe(-5);
		expect(abilityModifier(8)).toBe(-1);
		expect(abilityModifier(10)).toBe(0);
		expect(abilityModifier(11)).toBe(0);
		expect(abilityModifier(14)).toBe(2);
		expect(abilityModifier(18)).toBe(4);
		expect(abilityModifier(20)).toBe(5);
	});

	it('proficiencyBonus follows 5e table', () => {
		expect(proficiencyBonus(1)).toBe(2);
		expect(proficiencyBonus(4)).toBe(2);
		expect(proficiencyBonus(5)).toBe(3);
		expect(proficiencyBonus(8)).toBe(3);
		expect(proficiencyBonus(9)).toBe(4);
		expect(proficiencyBonus(12)).toBe(4);
		expect(proficiencyBonus(13)).toBe(5);
		expect(proficiencyBonus(16)).toBe(5);
		expect(proficiencyBonus(17)).toBe(6);
		expect(proficiencyBonus(20)).toBe(6);
	});
});

// ---------------------------------------------------------------------------
// rollD20 with advantage/disadvantage
// ---------------------------------------------------------------------------

describe('rollD20', () => {
	it('normal roll returns one die result', () => {
		const { chosen, result } = rollD20('normal');
		expect(result.rolls).toHaveLength(1);
		expect(chosen).toBe(result.rolls[0]);
	});

	it('advantage rolls two dice and takes highest', () => {
		const { chosen, result } = rollD20('advantage');
		expect(result.rolls).toHaveLength(2);
		expect(chosen).toBe(Math.max(result.rolls[0], result.rolls[1]));
		expect(result.notation).toBe('2d20kh1');
	});

	it('disadvantage rolls two dice and takes lowest', () => {
		const { chosen, result } = rollD20('disadvantage');
		expect(result.rolls).toHaveLength(2);
		expect(chosen).toBe(Math.min(result.rolls[0], result.rolls[1]));
		expect(result.notation).toBe('2d20kl1');
	});

	it('advantage produces statistically higher results over many rolls', () => {
		setRng(mulberry32(123));
		let advSum = 0;
		let normSum = 0;
		const N = 1000;
		for (let i = 0; i < N; i++) {
			advSum += rollD20('advantage').chosen;
		}
		setRng(mulberry32(123));
		for (let i = 0; i < N; i++) {
			normSum += rollD20('normal').chosen;
		}
		// Advantage mean should be ~13.82 vs normal ~10.5
		expect(advSum / N).toBeGreaterThan(normSum / N);
	});
});

// ---------------------------------------------------------------------------
// resolveRollModifiers
// ---------------------------------------------------------------------------

describe('resolveRollModifiers', () => {
	it('no conditions → no modifiers', () => {
		const mods = resolveRollModifiers([], 'attack');
		expect(mods.advantage).toBe(false);
		expect(mods.disadvantage).toBe(false);
		expect(mods.autoFail).toBe(false);
		expect(mods.resolvedAdvantage).toBe('normal');
	});

	it('invisible → advantage on attacks', () => {
		const mods = resolveRollModifiers(['invisible'], 'attack');
		expect(mods.advantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('advantage');
	});

	it('poisoned → disadvantage on attacks and ability checks', () => {
		const atkMods = resolveRollModifiers(['poisoned'], 'attack');
		expect(atkMods.disadvantage).toBe(true);
		expect(atkMods.resolvedAdvantage).toBe('disadvantage');

		const checkMods = resolveRollModifiers(['poisoned'], 'ability-check');
		expect(checkMods.disadvantage).toBe(true);
		expect(checkMods.resolvedAdvantage).toBe('disadvantage');
	});

	it('poisoned → disadvantage on skill checks too', () => {
		const mods = resolveRollModifiers(['poisoned'], 'skill-check');
		expect(mods.disadvantage).toBe(true);
	});

	it('paralyzed → auto-fail STR and DEX saves', () => {
		const strMods = resolveRollModifiers(['paralyzed'], 'saving-throw', 'str');
		expect(strMods.autoFail).toBe(true);

		const dexMods = resolveRollModifiers(['paralyzed'], 'saving-throw', 'dex');
		expect(dexMods.autoFail).toBe(true);

		const wisMods = resolveRollModifiers(['paralyzed'], 'saving-throw', 'wis');
		expect(wisMods.autoFail).toBe(false);
	});

	it('petrified → auto-fail STR and DEX saves', () => {
		const mods = resolveRollModifiers(['petrified'], 'saving-throw', 'str');
		expect(mods.autoFail).toBe(true);
	});

	it('unconscious → auto-fail STR and DEX saves', () => {
		const mods = resolveRollModifiers(['unconscious'], 'saving-throw', 'dex');
		expect(mods.autoFail).toBe(true);
	});

	it('stunned → auto-fail STR and DEX saves', () => {
		const mods = resolveRollModifiers(['stunned'], 'saving-throw', 'str');
		expect(mods.autoFail).toBe(true);
	});

	it('restrained → auto-fail DEX saves, disadvantage on attacks', () => {
		const saveMods = resolveRollModifiers(['restrained'], 'saving-throw', 'dex');
		expect(saveMods.autoFail).toBe(true);

		const atkMods = resolveRollModifiers(['restrained'], 'attack');
		expect(atkMods.disadvantage).toBe(true);
	});

	it('invisible + poisoned → advantage AND disadvantage cancel to normal on attacks', () => {
		const mods = resolveRollModifiers(['invisible', 'poisoned'], 'attack');
		expect(mods.advantage).toBe(true);
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('normal');
	});

	it('blinded → disadvantage on attack-rolls and sight-based ability checks', () => {
		const atkMods = resolveRollModifiers(['blinded'], 'attack');
		expect(atkMods.disadvantage).toBe(true);

		const checkMods = resolveRollModifiers(['blinded'], 'ability-check');
		expect(checkMods.disadvantage).toBe(true);
	});

	it('prone → disadvantage on attacks', () => {
		const mods = resolveRollModifiers(['prone'], 'attack');
		expect(mods.disadvantage).toBe(true);
	});

	it('frightened → disadvantage on attacks and ability checks', () => {
		const atkMods = resolveRollModifiers(['frightened'], 'attack');
		expect(atkMods.disadvantage).toBe(true);

		const checkMods = resolveRollModifiers(['frightened'], 'ability-check');
		expect(checkMods.disadvantage).toBe(true);
	});

	it('exhaustion → disadvantage on ability checks', () => {
		const mods = resolveRollModifiers(['exhaustion'], 'ability-check');
		expect(mods.disadvantage).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// skillCheck with conditions + expertise
// ---------------------------------------------------------------------------

describe('skillCheck', () => {
	it('basic proficient skill check adds ability mod + proficiency', () => {
		const char = makeCharacter();
		// Athletics: STR-based, proficient. STR 16 → mod +3, prof +3 = +6
		const result = skillCheck(char, 'athletics', 15);
		expect(result.proficient).toBe(true);
		expect(result.expertise).toBe(false);
		expect(result.abilityMod).toBe(3);
		expect(result.bonus).toBe(6); // +3 (STR) + 3 (prof)
		expect(result.autoFailed).toBe(false);
	});

	it('non-proficient skill check adds only ability mod', () => {
		const char = makeCharacter();
		// Stealth: DEX-based, NOT proficient. DEX 14 → mod +2
		const result = skillCheck(char, 'stealth', 10);
		expect(result.proficient).toBe(false);
		expect(result.bonus).toBe(2); // just DEX mod
	});

	it('expertise doubles proficiency bonus', () => {
		const rogue = makeRogue();
		// Stealth: DEX-based, proficient + expertise. DEX 18 → mod +4, prof 3, expertise → 3*2=6
		const result = skillCheck(rogue, 'stealth', 10);
		expect(result.proficient).toBe(true);
		expect(result.expertise).toBe(true);
		expect(result.bonus).toBe(10); // +4 (DEX) + 6 (expertise)
	});

	it('poisoned character gets disadvantage on skill checks', () => {
		const char = makeCharacter({ conditions: ['poisoned'] });
		const result = skillCheck(char, 'athletics', 10);
		expect(result.advantageState).toBe('disadvantage');
	});

	it('explicit advantage overrides to cancel disadvantage from condition', () => {
		const char = makeCharacter({ conditions: ['poisoned'] });
		// Poisoned → disadvantage, explicit advantage → they cancel
		const result = skillCheck(char, 'athletics', 10, 'advantage');
		expect(result.advantageState).toBe('normal');
	});

	it('returns new CheckResult shape with all fields', () => {
		const char = makeCharacter();
		const result = skillCheck(char, 'athletics', 10);
		expect(result).toHaveProperty('expertise');
		expect(result).toHaveProperty('advantageState');
		expect(result).toHaveProperty('autoFailed');
	});
});

// ---------------------------------------------------------------------------
// abilityCheck with conditions
// ---------------------------------------------------------------------------

describe('abilityCheck', () => {
	it('basic ability check adds only ability modifier', () => {
		const char = makeCharacter();
		// STR 16 → mod +3
		const result = abilityCheck(char, 'str', 12);
		expect(result.abilityMod).toBe(3);
		expect(result.proficient).toBe(false);
		expect(result.bonus).toBe(3);
	});

	it('exhaustion gives disadvantage on ability checks', () => {
		const char = makeCharacter({ conditions: ['exhaustion'] });
		const result = abilityCheck(char, 'str', 10);
		expect(result.advantageState).toBe('disadvantage');
	});
});

// ---------------------------------------------------------------------------
// savingThrow with conditions
// ---------------------------------------------------------------------------

describe('savingThrow', () => {
	it('proficient save adds proficiency bonus', () => {
		const char = makeCharacter(); // proficient in STR, CON
		// STR save: mod +3, prof +3 = bonus 6
		const result = savingThrow(char, 'str', 12);
		expect(result.proficient).toBe(true);
		expect(result.bonus).toBe(6);
	});

	it('non-proficient save adds only ability modifier', () => {
		const char = makeCharacter(); // not proficient in WIS
		// WIS save: mod +1
		const result = savingThrow(char, 'wis', 12);
		expect(result.proficient).toBe(false);
		expect(result.bonus).toBe(1);
	});

	it('paralyzed character auto-fails STR saves', () => {
		const char = makeCharacter({ conditions: ['paralyzed'] });
		const result = savingThrow(char, 'str', 5);
		expect(result.autoFailed).toBe(true);
		expect(result.success).toBe(false);
		expect(result.total).toBe(0);
	});

	it('paralyzed character auto-fails DEX saves', () => {
		const char = makeCharacter({ conditions: ['paralyzed'] });
		const result = savingThrow(char, 'dex', 1);
		expect(result.autoFailed).toBe(true);
		expect(result.success).toBe(false);
	});

	it('paralyzed character does NOT auto-fail WIS saves', () => {
		const char = makeCharacter({ conditions: ['paralyzed'] });
		const result = savingThrow(char, 'wis', 10);
		expect(result.autoFailed).toBe(false);
	});

	it('stunned character auto-fails STR and DEX saves', () => {
		const char = makeCharacter({ conditions: ['stunned'] });
		expect(savingThrow(char, 'str', 5).autoFailed).toBe(true);
		expect(savingThrow(char, 'dex', 5).autoFailed).toBe(true);
		expect(savingThrow(char, 'wis', 5).autoFailed).toBe(false);
	});

	it('explicit advantage is applied when no conflicting condition', () => {
		const char = makeCharacter();
		const result = savingThrow(char, 'wis', 10, 'advantage');
		expect(result.advantageState).toBe('advantage');
	});
});

// ---------------------------------------------------------------------------
// attackRoll with conditions + fixed crit damage
// ---------------------------------------------------------------------------

describe('attackRoll', () => {
	it('basic attack adds ability mod + proficiency', () => {
		const char = makeCharacter();
		// STR 16 → mod +3, prof +3 = attack bonus +6
		const result = attackRoll(char, 15, '1d8+3');
		expect(result.attackBonus).toBe(6);
	});

	it('poisoned attacker gets disadvantage', () => {
		const char = makeCharacter({ conditions: ['poisoned'] });
		const result = attackRoll(char, 10, '1d8+3');
		expect(result.advantageState).toBe('disadvantage');
	});

	it('invisible attacker gets advantage', () => {
		const char = makeCharacter({ conditions: ['invisible'] });
		const result = attackRoll(char, 10, '1d8+3');
		expect(result.advantageState).toBe('advantage');
	});

	it('critical hit doubles dice count, not modifier', () => {
		// Force a nat-20 by using a custom seed that produces 20
		// We'll test the damage notation logic instead
		const char = makeCharacter();

		// Seed a PRNG that will produce a nat-20 on the first d20
		// With mulberry32(42), we know the sequence. Let's find a seed that gives 20.
		// Alternatively, test the critical damage path more directly:
		// We run many attacks and check that any critical damage is correct.
		let foundCrit = false;
		for (let seed = 0; seed < 500 && !foundCrit; seed++) {
			setRng(mulberry32(seed));
			const result = attackRoll(char, 15, '2d8+3');
			if (result.critical) {
				foundCrit = true;
				// Critical: should roll 4d8+3 (double dice, single modifier)
				// The damage notation should be 4d8+3
				expect(result.damage).not.toBeNull();
				expect(result.damage!.notation).toBe('4d8+3');
				// Total should be sum of 4 dice + 3
				expect(result.damage!.rolls).toHaveLength(4);
				expect(result.totalDamage).toBe(result.damage!.total);
			}
		}
		expect(foundCrit).toBe(true);
	});

	it('non-critical hit uses original damage notation', () => {
		const char = makeCharacter();
		let foundHit = false;
		for (let seed = 0; seed < 500 && !foundHit; seed++) {
			setRng(mulberry32(seed));
			const result = attackRoll(char, 15, '2d8+3');
			if (result.hits && !result.critical) {
				foundHit = true;
				expect(result.damage!.notation).toBe('2d8+3');
				expect(result.damage!.rolls).toHaveLength(2);
			}
		}
		expect(foundHit).toBe(true);
	});

	it('fumble (nat 1) always misses', () => {
		const char = makeCharacter();
		let foundFumble = false;
		for (let seed = 0; seed < 500 && !foundFumble; seed++) {
			setRng(mulberry32(seed));
			// Even against AC 1, a nat 1 should miss
			const result = attackRoll(char, 1, '1d8+3');
			if (result.fumble) {
				foundFumble = true;
				expect(result.hits).toBe(false);
				expect(result.damage).toBeNull();
				expect(result.totalDamage).toBe(0);
			}
		}
		expect(foundFumble).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// passiveScore
// ---------------------------------------------------------------------------

describe('passiveScore', () => {
	it('computes passive score = 10 + ability mod + proficiency', () => {
		const char = makeCharacter();
		// Perception: WIS-based, proficient. WIS 12 → mod +1, prof +3
		const score = passiveScore(char, 'perception');
		expect(score).toBe(10 + 1 + 3); // 14
	});

	it('non-proficient passive score = 10 + ability mod only', () => {
		const char = makeCharacter();
		// Stealth: DEX-based, NOT proficient. DEX 14 → mod +2
		const score = passiveScore(char, 'stealth');
		expect(score).toBe(10 + 2); // 12
	});

	it('expertise doubles proficiency in passive score', () => {
		const rogue = makeRogue();
		// Stealth: DEX 18 → mod +4, expertise → prof * 2 = 6
		const score = passiveScore(rogue, 'stealth');
		expect(score).toBe(10 + 4 + 6); // 20
	});

	it('advantage adds +5 to passive', () => {
		const char = makeCharacter();
		const score = passiveScore(char, 'perception', 'advantage');
		expect(score).toBe(10 + 1 + 3 + 5); // 19
	});

	it('disadvantage subtracts 5 from passive', () => {
		const char = makeCharacter();
		const score = passiveScore(char, 'perception', 'disadvantage');
		expect(score).toBe(10 + 1 + 3 - 5); // 9
	});

	it('condition-based disadvantage applies to passive', () => {
		const char = makeCharacter({ conditions: ['poisoned'] });
		// Poisoned → disadvantage on ability checks → passive -5
		const score = passiveScore(char, 'perception');
		expect(score).toBe(10 + 1 + 3 - 5); // 9
	});

	it('condition disadvantage + explicit advantage cancel in passive', () => {
		const char = makeCharacter({ conditions: ['poisoned'] });
		const score = passiveScore(char, 'perception', 'advantage');
		expect(score).toBe(10 + 1 + 3); // 14 (no bonus/penalty)
	});
});

// ---------------------------------------------------------------------------
// contestedCheck
// ---------------------------------------------------------------------------

describe('contestedCheck', () => {
	it('returns actor, opponent results, winner, and margin', () => {
		const fighter = makeCharacter();
		const rogue = makeRogue();
		const result = contestedCheck(fighter, 'athletics', rogue, 'acrobatics');

		expect(result).toHaveProperty('actor');
		expect(result).toHaveProperty('opponent');
		expect(result).toHaveProperty('winner');
		expect(result).toHaveProperty('margin');
		expect(['actor', 'opponent', 'tie']).toContain(result.winner);
	});

	it('margin is actor.total - opponent.total', () => {
		const a = makeCharacter();
		const b = makeRogue();
		const result = contestedCheck(a, 'athletics', b, 'acrobatics');
		expect(result.margin).toBe(result.actor.total - result.opponent.total);
	});

	it('actor wins when total is higher', () => {
		// Run multiple seeds to find an actor-wins case
		let foundActorWin = false;
		for (let seed = 0; seed < 200 && !foundActorWin; seed++) {
			setRng(mulberry32(seed));
			const a = makeCharacter(); // Athletics +6
			const b = makeRogue();     // Acrobatics +7
			const result = contestedCheck(a, 'athletics', b, 'acrobatics');
			if (result.winner === 'actor') {
				foundActorWin = true;
				expect(result.margin).toBeGreaterThan(0);
				expect(result.actor.success).toBe(true);
			}
		}
		expect(foundActorWin).toBe(true);
	});

	it('opponent wins when total is higher', () => {
		let foundOpponentWin = false;
		for (let seed = 0; seed < 200 && !foundOpponentWin; seed++) {
			setRng(mulberry32(seed));
			const a = makeCharacter();
			const b = makeRogue();
			const result = contestedCheck(a, 'athletics', b, 'acrobatics');
			if (result.winner === 'opponent') {
				foundOpponentWin = true;
				expect(result.margin).toBeLessThan(0);
				expect(result.opponent.success).toBe(true);
			}
		}
		expect(foundOpponentWin).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// toolCheck
// ---------------------------------------------------------------------------

describe('toolCheck', () => {
	it('proficient tool user adds proficiency bonus', () => {
		const rogue = makeRogue(); // has thieves-tools
		// DEX 18 → mod +4, prof +3 = bonus +7
		const result = toolCheck(rogue, 'dex', 'thieves-tools', 15);
		expect(result.proficient).toBe(true);
		expect(result.bonus).toBe(7);
	});

	it('non-proficient tool user adds only ability mod', () => {
		const char = makeCharacter(); // no tool proficiencies
		// DEX 14 → mod +2
		const result = toolCheck(char, 'dex', 'thieves-tools', 15);
		expect(result.proficient).toBe(false);
		expect(result.bonus).toBe(2);
	});

	it('conditions apply to tool checks (treated as ability checks)', () => {
		const rogue = makeRogue({ conditions: ['poisoned'] });
		const result = toolCheck(rogue, 'dex', 'thieves-tools', 15);
		expect(result.advantageState).toBe('disadvantage');
	});

	it('paralyzed auto-fails DEX-based tool checks', () => {
		// paralyzed doesn't auto-fail ability checks, only saves
		// tool checks are ability checks, not saves
		const rogue = makeRogue({ conditions: ['paralyzed'] });
		const result = toolCheck(rogue, 'dex', 'thieves-tools', 10);
		// Paralyzed auto-fails STR/DEX SAVES, not checks
		expect(result.autoFailed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// applyDamage & applyHealing (unchanged but verify still work)
// ---------------------------------------------------------------------------

describe('applyDamage', () => {
	it('reduces HP by damage amount', () => {
		const char = makeCharacter({ hp: 30, maxHp: 44 });
		const result = applyDamage(char, 10);
		expect(result.previousHp).toBe(30);
		expect(result.currentHp).toBe(20);
		expect(result.unconscious).toBe(false);
		expect(result.dead).toBe(false);
	});

	it('temp HP absorbs damage first', () => {
		const char = makeCharacter({ hp: 30, maxHp: 44, tempHp: 5 });
		const result = applyDamage(char, 8);
		expect(result.tempHpAbsorbed).toBe(5);
		expect(result.currentHp).toBe(27); // 30 - (8-5)
	});

	it('HP at 0 → unconscious', () => {
		const char = makeCharacter({ hp: 5, maxHp: 44 });
		const result = applyDamage(char, 10);
		expect(result.currentHp).toBe(0);
		expect(result.unconscious).toBe(true);
		expect(result.dead).toBe(false);
	});

	it('massive damage → instant death', () => {
		const char = makeCharacter({ hp: 10, maxHp: 44 });
		// 10 HP - 55 damage = -45, which is <= -44 (maxHp)
		const result = applyDamage(char, 55);
		expect(result.dead).toBe(true);
		expect(result.unconscious).toBe(false);
	});
});

describe('applyHealing', () => {
	it('heals up to max HP', () => {
		const char = makeCharacter({ hp: 20, maxHp: 44 });
		const result = applyHealing(char, 100);
		expect(result.currentHp).toBe(44);
	});

	it('heals by exact amount when below max', () => {
		const char = makeCharacter({ hp: 20, maxHp: 44 });
		const result = applyHealing(char, 10);
		expect(result.currentHp).toBe(30);
	});
});

// ---------------------------------------------------------------------------
// Mechanic Result Builders
// ---------------------------------------------------------------------------

describe('Mechanic Result Builders', () => {
	it('toMechanicResult builds from CheckResult', () => {
		const char = makeCharacter();
		const check = skillCheck(char, 'athletics', 15);
		const mr = toMechanicResult('skill-check', 'Athletics check', check);
		expect(mr.type).toBe('skill-check');
		expect(mr.label).toBe('Athletics check');
		expect(mr.dc).toBe(15);
		expect(typeof mr.success).toBe('boolean');
	});

	it('attackToMechanicResult builds from AttackResult', () => {
		const char = makeCharacter();
		const atk = attackRoll(char, 15, '1d8+3');
		const mr = attackToMechanicResult('Longsword attack', atk);
		expect(mr.type).toBe('attack-roll');
		expect(mr.dc).toBe(15);
	});
});

// ---------------------------------------------------------------------------
// Deterministic PRNG verification
// ---------------------------------------------------------------------------

describe('PRNG determinism', () => {
	it('same seed produces identical sequence', () => {
		setRng(mulberry32(999));
		const rolls1 = Array.from({ length: 10 }, () => rollDie(20));

		setRng(mulberry32(999));
		const rolls2 = Array.from({ length: 10 }, () => rollDie(20));

		expect(rolls1).toEqual(rolls2);
	});

	it('different seeds produce different sequences', () => {
		setRng(mulberry32(111));
		const rolls1 = Array.from({ length: 10 }, () => rollDie(20));

		setRng(mulberry32(222));
		const rolls2 = Array.from({ length: 10 }, () => rollDie(20));

		expect(rolls1).not.toEqual(rolls2);
	});
});

// ---------------------------------------------------------------------------
// Integration: full condition-affected combat scenario
// ---------------------------------------------------------------------------

describe('Integration: condition-affected combat', () => {
	it('poisoned + invisible attacker cancels to normal advantage, hits or misses cleanly', () => {
		const char = makeCharacter({ conditions: ['poisoned', 'invisible'] });
		const result = attackRoll(char, 15, '1d8+3');
		// Invisible gives advantage, poisoned gives disadvantage → they cancel
		expect(result.advantageState).toBe('normal');
	});

	it('paralyzed character auto-fails DEX saves regardless of high stats', () => {
		const char = makeCharacter({
			conditions: ['paralyzed'],
			abilities: { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 },
			saveProficiencies: ['str', 'dex', 'con', 'int', 'wis', 'cha']
		});
		// Even with +5 mod and +3 prof, paralyzed auto-fails STR/DEX saves
		expect(savingThrow(char, 'str', 1).autoFailed).toBe(true);
		expect(savingThrow(char, 'dex', 1).autoFailed).toBe(true);
		// But WIS save is fine
		expect(savingThrow(char, 'wis', 1).autoFailed).toBe(false);
	});

	it('rogue expertise makes stealth checks significantly better', () => {
		setRng(mulberry32(42));
		const rogue = makeRogue();
		const fighter = makeCharacter({ skillProficiencies: ['stealth'] });

		// Over many rolls, rogue (bonus +10) should beat fighter (bonus +5) more often
		let rogueWins = 0;
		let fighterWins = 0;
		for (let i = 0; i < 100; i++) {
			const rogueResult = skillCheck(rogue, 'stealth', 15);
			const fighterResult = skillCheck(fighter, 'stealth', 15);
			if (rogueResult.success) rogueWins++;
			if (fighterResult.success) fighterWins++;
		}
		expect(rogueWins).toBeGreaterThan(fighterWins);
	});
});
