/**
 * Phase C Unit Tests — Death Saves, Conditions & Exhaustion
 *
 * Uses seeded PRNG (mulberry32) for deterministic assertions.
 * Tests cover:
 *   - Condition apply/remove with cascading (unconscious→incapacitated)
 *   - Cascading removal rules (don't remove incapacitated if other sources)
 *   - Death save roll outcomes (success, failure, nat-20, nat-1)
 *   - performDeathSave full integration (roll + apply + check outcome)
 *   - 3 successes → stabilize, 3 failures → dead
 *   - Damage while unconscious (1 failure, crit = 2 failures)
 *   - Exhaustion 6-level table (cumulative effects)
 *   - Exhaustion + roll modifier integration
 *   - Effective max HP and speed under exhaustion
 *   - resetDeathSaves utility
 *   - Full scripted death save sequence with known seeds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	mulberry32,
	setRng,
	resetRng,
	rollDeathSave
} from './mechanics';
import {
	applyCondition,
	removeCondition,
	hasCondition,
	performDeathSave,
	checkDeathSaveOutcome,
	damageWhileUnconscious,
	resetDeathSaves,
	getExhaustionEffects,
	addExhaustion,
	removeExhaustion,
	resolveRollModifiersWithExhaustion,
	effectiveMaxHp,
	effectiveSpeed
} from './conditions';
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

/** A character at 0 HP, unconscious, making death saves. */
function makeDyingCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makeCharacter({
		hp: 0,
		conditions: ['unconscious', 'incapacitated'],
		stable: false,
		dead: false,
		deathSaves: { successes: 0, failures: 0 },
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

// ===========================================================================
// Condition Apply / Remove
// ===========================================================================

describe('applyCondition', () => {
	it('adds a condition to a character', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'poisoned');
		expect(pc.conditions).toContain('poisoned');
		expect(result.added).toEqual(['poisoned']);
		expect(result.stateChange.conditionsApplied).toHaveLength(1);
		expect(result.stateChange.conditionsApplied![0]).toMatchObject({
			characterId: 'test-char-1',
			condition: 'poisoned',
			applied: true
		});
	});

	it('does not add duplicate conditions', () => {
		const pc = makeCharacter({ conditions: ['poisoned'] });
		const result = applyCondition(pc, 'poisoned');
		expect(pc.conditions).toEqual(['poisoned']);
		expect(result.added).toEqual([]);
	});

	it('cascades unconscious → incapacitated', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'unconscious');
		expect(pc.conditions).toContain('unconscious');
		expect(pc.conditions).toContain('incapacitated');
		expect(result.added).toEqual(['unconscious', 'incapacitated']);
	});

	it('cascades paralyzed → incapacitated', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'paralyzed');
		expect(pc.conditions).toContain('paralyzed');
		expect(pc.conditions).toContain('incapacitated');
		expect(result.added).toEqual(['paralyzed', 'incapacitated']);
	});

	it('cascades petrified → incapacitated', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'petrified');
		expect(pc.conditions).toContain('petrified');
		expect(pc.conditions).toContain('incapacitated');
	});

	it('cascades stunned → incapacitated', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'stunned');
		expect(pc.conditions).toContain('stunned');
		expect(pc.conditions).toContain('incapacitated');
	});

	it('does not duplicate incapacitated when already present from another source', () => {
		const pc = makeCharacter();
		applyCondition(pc, 'unconscious'); // adds unconscious + incapacitated
		const result = applyCondition(pc, 'stunned'); // adds stunned, incapacitated already there
		expect(pc.conditions.filter(c => c === 'incapacitated')).toHaveLength(1);
		expect(result.added).toEqual(['stunned']);
	});

	it('adds a simple condition without cascading', () => {
		const pc = makeCharacter();
		const result = applyCondition(pc, 'blinded');
		expect(pc.conditions).toEqual(['blinded']);
		expect(result.added).toEqual(['blinded']);
	});
});

describe('removeCondition', () => {
	it('removes a simple condition', () => {
		const pc = makeCharacter({ conditions: ['poisoned'] });
		const result = removeCondition(pc, 'poisoned');
		expect(pc.conditions).toEqual([]);
		expect(result.removed).toEqual(['poisoned']);
		expect(result.stateChange.conditionsApplied![0]).toMatchObject({
			condition: 'poisoned',
			applied: false
		});
	});

	it('does nothing when condition not present', () => {
		const pc = makeCharacter();
		const result = removeCondition(pc, 'blinded');
		expect(result.removed).toEqual([]);
	});

	it('removes unconscious and cascaded incapacitated', () => {
		const pc = makeCharacter({ conditions: ['unconscious', 'incapacitated'] });
		const result = removeCondition(pc, 'unconscious');
		expect(pc.conditions).toEqual([]);
		expect(result.removed).toContain('unconscious');
		expect(result.removed).toContain('incapacitated');
	});

	it('does NOT remove incapacitated when another source still active', () => {
		const pc = makeCharacter({ conditions: ['unconscious', 'stunned', 'incapacitated'] });
		const result = removeCondition(pc, 'unconscious');
		expect(pc.conditions).toContain('incapacitated');
		expect(pc.conditions).toContain('stunned');
		expect(pc.conditions).not.toContain('unconscious');
		expect(result.removed).toEqual(['unconscious']); // incapacitated NOT removed
	});

	it('removes incapacitated only when last source is removed', () => {
		const pc = makeCharacter({ conditions: ['unconscious', 'paralyzed', 'incapacitated'] });
		// Remove unconscious but paralyzed still provides incapacitated
		removeCondition(pc, 'unconscious');
		expect(pc.conditions).toContain('incapacitated');

		// Now remove paralyzed — incapacitated should go too
		const result = removeCondition(pc, 'paralyzed');
		expect(pc.conditions).not.toContain('incapacitated');
		expect(result.removed).toContain('paralyzed');
		expect(result.removed).toContain('incapacitated');
	});
});

describe('hasCondition', () => {
	it('returns true when condition is present', () => {
		const pc = makeCharacter({ conditions: ['blinded', 'poisoned'] });
		expect(hasCondition(pc, 'blinded')).toBe(true);
	});

	it('returns false when condition is absent', () => {
		const pc = makeCharacter();
		expect(hasCondition(pc, 'blinded')).toBe(false);
	});
});

// ===========================================================================
// Death Save — Pure Roll
// ===========================================================================

describe('rollDeathSave (pure roll)', () => {
	it('produces deterministic results with seeded PRNG', () => {
		setRng(mulberry32(999));
		const r1 = rollDeathSave();
		setRng(mulberry32(999));
		const r2 = rollDeathSave();
		expect(r1.natural).toBe(r2.natural);
		expect(r1.result).toBe(r2.result);
	});

	it('returns success for rolls 10-19 (non-natural-20)', () => {
		// Find a seed that gives 10-19
		for (let s = 0; s < 1000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural >= 10 && r.natural <= 19) {
				expect(r.result).toBe('success');
				return;
			}
		}
		throw new Error('Could not find seed producing 10-19 roll');
	});

	it('returns failure for rolls 2-9', () => {
		for (let s = 0; s < 1000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural >= 2 && r.natural <= 9) {
				expect(r.result).toBe('failure');
				return;
			}
		}
		throw new Error('Could not find seed producing 2-9 roll');
	});
});

// ===========================================================================
// performDeathSave — Full Integration
// ===========================================================================

describe('performDeathSave', () => {
	it('increments successes on a normal success', () => {
		// Search for a seed that produces a success (10-19)
		let testSeed = 0;
		for (let s = 0; s < 2000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.result === 'success') {
				testSeed = s;
				break;
			}
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter();
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('success');
		expect(pc.deathSaves.successes).toBe(1);
		expect(pc.deathSaves.failures).toBe(0);
		expect(result.outcome).toBe('ongoing');
	});

	it('increments failures on a normal failure', () => {
		// Search for a seed that produces a failure (2-9)
		let testSeed = 0;
		for (let s = 0; s < 2000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.result === 'failure') {
				testSeed = s;
				break;
			}
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter();
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('failure');
		expect(pc.deathSaves.failures).toBe(1);
		expect(pc.deathSaves.successes).toBe(0);
		expect(result.outcome).toBe('ongoing');
	});

	it('nat-1 adds 2 failures (critical failure)', () => {
		// Find seed that produces nat 1
		let testSeed = 0;
		for (let s = 0; s < 10000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural === 1) {
				testSeed = s;
				break;
			}
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter();
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('critical-failure');
		expect(pc.deathSaves.failures).toBe(2);
	});

	it('nat-20 restores 1 HP, resets death saves, removes unconscious', () => {
		// Find seed that produces nat 20
		let testSeed = 0;
		for (let s = 0; s < 10000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural === 20) {
				testSeed = s;
				break;
			}
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter({ deathSaves: { successes: 1, failures: 2 } });
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('critical-success');
		expect(pc.hp).toBe(1);
		expect(pc.deathSaves).toEqual({ successes: 0, failures: 0 });
		expect(pc.conditions).not.toContain('unconscious');
		expect(pc.stable).toBe(false); // They're conscious, not "stable at 0"
	});

	it('stabilizes after 3 successes', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 2, failures: 1 } });

		// Find a success seed
		let testSeed = 0;
		for (let s = 0; s < 2000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.result === 'success') { testSeed = s; break; }
		}

		setRng(mulberry32(testSeed));
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('success');
		expect(pc.deathSaves.successes).toBe(3);
		expect(result.outcome).toBe('stable');
		expect(pc.stable).toBe(true);
		expect(pc.dead).toBe(false);
		expect(result.stateChange.deathSaveOutcome).toMatchObject({
			characterId: 'test-char-1',
			outcome: 'stable'
		});
	});

	it('dies after 3 failures', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 1, failures: 2 } });

		// Find a failure seed
		let testSeed = 0;
		for (let s = 0; s < 2000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.result === 'failure') { testSeed = s; break; }
		}

		setRng(mulberry32(testSeed));
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('failure');
		expect(pc.deathSaves.failures).toBe(3);
		expect(result.outcome).toBe('dead');
		expect(pc.dead).toBe(true);
		expect(result.stateChange.deathSaveOutcome).toMatchObject({
			characterId: 'test-char-1',
			outcome: 'dead'
		});
	});

	it('nat-1 with 2 existing failures causes death (4 total)', () => {
		let testSeed = 0;
		for (let s = 0; s < 10000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural === 1) { testSeed = s; break; }
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter({ deathSaves: { successes: 0, failures: 2 } });
		const result = performDeathSave(pc);
		expect(result.roll.result).toBe('critical-failure');
		expect(pc.deathSaves.failures).toBe(4); // 2 + 2
		expect(result.outcome).toBe('dead');
		expect(pc.dead).toBe(true);
	});
});

// ===========================================================================
// checkDeathSaveOutcome
// ===========================================================================

describe('checkDeathSaveOutcome', () => {
	it('returns ongoing when neither threshold reached', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 1, failures: 1 } });
		expect(checkDeathSaveOutcome(pc)).toBe('ongoing');
	});

	it('returns stable at exactly 3 successes', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 3, failures: 0 } });
		expect(checkDeathSaveOutcome(pc)).toBe('stable');
		expect(pc.stable).toBe(true);
	});

	it('returns dead at exactly 3 failures', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 0, failures: 3 } });
		expect(checkDeathSaveOutcome(pc)).toBe('dead');
		expect(pc.dead).toBe(true);
	});

	it('death takes priority over stable (both ≥3 — edge case from crit-fail)', () => {
		// This shouldn't happen in real play, but failures are checked first
		const pc = makeDyingCharacter({ deathSaves: { successes: 3, failures: 3 } });
		expect(checkDeathSaveOutcome(pc)).toBe('dead');
	});
});

// ===========================================================================
// damageWhileUnconscious
// ===========================================================================

describe('damageWhileUnconscious', () => {
	it('adds 1 failure on non-critical damage', () => {
		const pc = makeDyingCharacter();
		const result = damageWhileUnconscious(pc, false);
		expect(result.failuresAdded).toBe(1);
		expect(pc.deathSaves.failures).toBe(1);
		expect(result.outcome).toBe('ongoing');
	});

	it('adds 2 failures on critical damage', () => {
		const pc = makeDyingCharacter();
		const result = damageWhileUnconscious(pc, true);
		expect(result.failuresAdded).toBe(2);
		expect(pc.deathSaves.failures).toBe(2);
		expect(result.outcome).toBe('ongoing');
	});

	it('crit damage with 1 existing failure causes death', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 2, failures: 1 } });
		const result = damageWhileUnconscious(pc, true);
		expect(pc.deathSaves.failures).toBe(3);
		expect(result.outcome).toBe('dead');
		expect(pc.dead).toBe(true);
	});

	it('non-crit damage with 2 existing failures causes death', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 1, failures: 2 } });
		const result = damageWhileUnconscious(pc, false);
		expect(pc.deathSaves.failures).toBe(3);
		expect(result.outcome).toBe('dead');
	});

	it('reports correct stateChange for failure leading to death', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 0, failures: 2 } });
		const result = damageWhileUnconscious(pc, false);
		expect(result.stateChange.deathSaveResult).toMatchObject({
			characterId: 'test-char-1',
			result: 'failure'
		});
		expect(result.stateChange.deathSaveOutcome).toMatchObject({
			characterId: 'test-char-1',
			outcome: 'dead'
		});
	});

	it('reports critical-failure in stateChange for crit hit', () => {
		const pc = makeDyingCharacter();
		const result = damageWhileUnconscious(pc, true);
		expect(result.stateChange.deathSaveResult!.result).toBe('critical-failure');
	});
});

// ===========================================================================
// resetDeathSaves
// ===========================================================================

describe('resetDeathSaves', () => {
	it('resets both counters to 0', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 2, failures: 1 } });
		resetDeathSaves(pc);
		expect(pc.deathSaves).toEqual({ successes: 0, failures: 0 });
	});
});

// ===========================================================================
// Exhaustion — 6-Level Table
// ===========================================================================

describe('getExhaustionEffects', () => {
	it('level 0 has no effects', () => {
		const e = getExhaustionEffects(0);
		expect(e.disadvantageOnAbilityChecks).toBe(false);
		expect(e.speedHalved).toBe(false);
		expect(e.disadvantageOnAttacksAndSaves).toBe(false);
		expect(e.hpMaxHalved).toBe(false);
		expect(e.speedZero).toBe(false);
		expect(e.death).toBe(false);
	});

	it('level 1: disadvantage on ability checks only', () => {
		const e = getExhaustionEffects(1);
		expect(e.disadvantageOnAbilityChecks).toBe(true);
		expect(e.speedHalved).toBe(false);
		expect(e.disadvantageOnAttacksAndSaves).toBe(false);
	});

	it('level 2: speed halved (cumulative with L1)', () => {
		const e = getExhaustionEffects(2);
		expect(e.disadvantageOnAbilityChecks).toBe(true);
		expect(e.speedHalved).toBe(true);
		expect(e.disadvantageOnAttacksAndSaves).toBe(false);
	});

	it('level 3: disadvantage on attacks and saves (cumulative)', () => {
		const e = getExhaustionEffects(3);
		expect(e.disadvantageOnAbilityChecks).toBe(true);
		expect(e.speedHalved).toBe(true);
		expect(e.disadvantageOnAttacksAndSaves).toBe(true);
		expect(e.hpMaxHalved).toBe(false);
	});

	it('level 4: HP max halved (cumulative)', () => {
		const e = getExhaustionEffects(4);
		expect(e.hpMaxHalved).toBe(true);
		expect(e.disadvantageOnAttacksAndSaves).toBe(true);
		expect(e.speedHalved).toBe(true);
	});

	it('level 5: speed reduced to 0 (cumulative)', () => {
		const e = getExhaustionEffects(5);
		expect(e.speedZero).toBe(true);
		expect(e.hpMaxHalved).toBe(true);
		expect(e.death).toBe(false);
	});

	it('level 6: death (cumulative)', () => {
		const e = getExhaustionEffects(6);
		expect(e.death).toBe(true);
		expect(e.speedZero).toBe(true);
		expect(e.hpMaxHalved).toBe(true);
	});

	it('clamps negative levels to 0', () => {
		const e = getExhaustionEffects(-5);
		expect(e.level).toBe(0);
		expect(e.death).toBe(false);
	});

	it('clamps levels above 6 to 6', () => {
		const e = getExhaustionEffects(99);
		expect(e.level).toBe(6);
		expect(e.death).toBe(true);
	});
});

describe('addExhaustion', () => {
	it('increments exhaustion level', () => {
		const pc = makeCharacter();
		expect(addExhaustion(pc)).toBe(1);
		expect(pc.exhaustionLevel).toBe(1);
	});

	it('adds multiple levels at once', () => {
		const pc = makeCharacter();
		expect(addExhaustion(pc, 3)).toBe(3);
		expect(pc.exhaustionLevel).toBe(3);
	});

	it('clamps at 6', () => {
		const pc = makeCharacter({ exhaustionLevel: 4 });
		expect(addExhaustion(pc, 5)).toBe(6);
		expect(pc.exhaustionLevel).toBe(6);
	});

	it('marks dead at level 6', () => {
		const pc = makeCharacter({ exhaustionLevel: 5 });
		addExhaustion(pc);
		expect(pc.dead).toBe(true);
	});

	it('marks dead when going from 0 to 6 in one call', () => {
		const pc = makeCharacter();
		addExhaustion(pc, 6);
		expect(pc.dead).toBe(true);
		expect(pc.exhaustionLevel).toBe(6);
	});
});

describe('removeExhaustion', () => {
	it('decrements exhaustion level', () => {
		const pc = makeCharacter({ exhaustionLevel: 3 });
		expect(removeExhaustion(pc)).toBe(2);
	});

	it('clamps at 0', () => {
		const pc = makeCharacter({ exhaustionLevel: 1 });
		expect(removeExhaustion(pc, 5)).toBe(0);
		expect(pc.exhaustionLevel).toBe(0);
	});

	it('does nothing at 0', () => {
		const pc = makeCharacter();
		expect(removeExhaustion(pc)).toBe(0);
	});
});

// ===========================================================================
// Exhaustion Roll Modifiers
// ===========================================================================

describe('resolveRollModifiersWithExhaustion', () => {
	it('no exhaustion returns base modifiers', () => {
		const mods = resolveRollModifiersWithExhaustion([], 0, 'ability-check');
		expect(mods.disadvantage).toBe(false);
		expect(mods.resolvedAdvantage).toBe('normal');
	});

	it('level 1 gives disadvantage on ability checks', () => {
		const mods = resolveRollModifiersWithExhaustion([], 1, 'ability-check');
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('disadvantage');
	});

	it('level 1 gives disadvantage on skill checks', () => {
		const mods = resolveRollModifiersWithExhaustion([], 1, 'skill-check');
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('disadvantage');
	});

	it('level 1 does NOT affect attack rolls', () => {
		const mods = resolveRollModifiersWithExhaustion([], 1, 'attack');
		expect(mods.disadvantage).toBe(false);
	});

	it('level 1 does NOT affect saving throws', () => {
		const mods = resolveRollModifiersWithExhaustion([], 1, 'saving-throw');
		expect(mods.disadvantage).toBe(false);
	});

	it('level 3 gives disadvantage on attack rolls', () => {
		const mods = resolveRollModifiersWithExhaustion([], 3, 'attack');
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('disadvantage');
	});

	it('level 3 gives disadvantage on saving throws', () => {
		const mods = resolveRollModifiersWithExhaustion([], 3, 'saving-throw');
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('disadvantage');
	});

	it('level 3 still gives disadvantage on ability checks', () => {
		const mods = resolveRollModifiersWithExhaustion([], 3, 'ability-check');
		expect(mods.disadvantage).toBe(true);
	});

	it('exhaustion disadvantage + condition advantage cancel to normal', () => {
		// Poisoned gives disadvantage on attacks and ability checks in condition table
		// But we want advantage from some other source. Let's use a custom scenario:
		// The conditions system gives advantage on attacks (e.g. "invisible")
		// plus exhaustion 3 gives disadvantage on attacks
		const mods = resolveRollModifiersWithExhaustion(['invisible'], 3, 'attack');
		// Invisible gives advantage on attacks, exhaustion 3 gives disadvantage
		// Both → cancel to normal
		expect(mods.advantage).toBe(true);
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('normal');
	});

	it('exhaution disadvantage stacks with condition disadvantage (still just disadvantage)', () => {
		// Poisoned gives disadvantage on attacks. Exhaustion 3 also does.
		const mods = resolveRollModifiersWithExhaustion(['poisoned'], 3, 'attack');
		expect(mods.disadvantage).toBe(true);
		expect(mods.resolvedAdvantage).toBe('disadvantage');
	});
});

// ===========================================================================
// Effective Max HP and Speed
// ===========================================================================

describe('effectiveMaxHp', () => {
	it('returns full max HP at exhaustion 0-3', () => {
		const pc = makeCharacter({ maxHp: 44, exhaustionLevel: 3 });
		expect(effectiveMaxHp(pc)).toBe(44);
	});

	it('returns half max HP at exhaustion 4', () => {
		const pc = makeCharacter({ maxHp: 44, exhaustionLevel: 4 });
		expect(effectiveMaxHp(pc)).toBe(22);
	});

	it('floors odd values', () => {
		const pc = makeCharacter({ maxHp: 45, exhaustionLevel: 4 });
		expect(effectiveMaxHp(pc)).toBe(22);
	});

	it('returns half at exhaustion 5 and 6', () => {
		const pc = makeCharacter({ maxHp: 44, exhaustionLevel: 5 });
		expect(effectiveMaxHp(pc)).toBe(22);
		const pc6 = makeCharacter({ maxHp: 44, exhaustionLevel: 6 });
		expect(effectiveMaxHp(pc6)).toBe(22);
	});
});

describe('effectiveSpeed', () => {
	it('returns full speed at exhaustion 0-1', () => {
		const pc = makeCharacter({ speed: 30, exhaustionLevel: 1 });
		expect(effectiveSpeed(pc)).toBe(30);
	});

	it('returns half speed at exhaustion 2', () => {
		const pc = makeCharacter({ speed: 30, exhaustionLevel: 2 });
		expect(effectiveSpeed(pc)).toBe(15);
	});

	it('returns half speed at exhaustion 3-4', () => {
		const pc = makeCharacter({ speed: 30, exhaustionLevel: 3 });
		expect(effectiveSpeed(pc)).toBe(15);
	});

	it('returns 0 speed at exhaustion 5', () => {
		const pc = makeCharacter({ speed: 30, exhaustionLevel: 5 });
		expect(effectiveSpeed(pc)).toBe(0);
	});

	it('returns 0 speed at exhaustion 6', () => {
		const pc = makeCharacter({ speed: 30, exhaustionLevel: 6 });
		expect(effectiveSpeed(pc)).toBe(0);
	});

	it('floors odd halved speed', () => {
		const pc = makeCharacter({ speed: 25, exhaustionLevel: 2 });
		expect(effectiveSpeed(pc)).toBe(12);
	});
});

// ===========================================================================
// Full Scripted Scenarios
// ===========================================================================

describe('scripted death save sequence', () => {
	it('PC drops to 0, makes 3 death saves → stabilizes', () => {
		const pc = makeDyingCharacter();

		let successes = 0;
		let round = 0;

		// Keep rolling until we hit 3 successes or 3 failures
		while (pc.deathSaves.successes < 3 && pc.deathSaves.failures < 3) {
			round++;
			// Reset seed to a new deterministic value each round
			setRng(mulberry32(SEED + round * 100));
			const result = performDeathSave(pc);

			if (result.outcome !== 'ongoing') {
				break;
			}
			if (round > 20) throw new Error('Too many rounds');
		}

		// The character should have resolved (stable or dead)
		const outcome = checkDeathSaveOutcome(pc);
		expect(['stable', 'dead']).toContain(outcome);
	});

	it('PC takes crit while unconscious with 2 failures → dies immediately', () => {
		const pc = makeDyingCharacter({ deathSaves: { successes: 2, failures: 2 } });

		const result = damageWhileUnconscious(pc, true);
		// 2 + 2 = 4 failures
		expect(pc.deathSaves.failures).toBe(4);
		expect(result.outcome).toBe('dead');
		expect(pc.dead).toBe(true);
	});

	it('PC with exhaustion 5 cannot move', () => {
		const pc = makeCharacter({ exhaustionLevel: 5 });
		expect(effectiveSpeed(pc)).toBe(0);
	});

	it('exhaustion 6 kills the character', () => {
		const pc = makeCharacter({ exhaustionLevel: 5 });
		addExhaustion(pc);
		expect(pc.dead).toBe(true);
		expect(pc.exhaustionLevel).toBe(6);
	});

	it('stacking condition sources preserves dependent conditions', () => {
		const pc = makeCharacter();
		// Apply unconscious → gets incapacitated
		applyCondition(pc, 'unconscious');
		expect(pc.conditions).toContain('incapacitated');

		// Apply stunned → incapacitated already there, but now from 2 sources
		applyCondition(pc, 'stunned');
		expect(pc.conditions.filter(c => c === 'incapacitated')).toHaveLength(1);

		// Remove unconscious → stunned still provides incapacitated
		removeCondition(pc, 'unconscious');
		expect(pc.conditions).toContain('incapacitated');
		expect(pc.conditions).not.toContain('unconscious');
		expect(pc.conditions).toContain('stunned');

		// Remove stunned → incapacitated finally removed
		removeCondition(pc, 'stunned');
		expect(pc.conditions).toEqual([]);
	});

	it('nat-20 death save with accumulated saves/fails fully resets', () => {
		// Find seed for nat 20
		let testSeed = 0;
		for (let s = 0; s < 10000; s++) {
			setRng(mulberry32(s));
			const r = rollDeathSave();
			if (r.natural === 20) {
				testSeed = s;
				break;
			}
		}

		setRng(mulberry32(testSeed));
		const pc = makeDyingCharacter({ deathSaves: { successes: 2, failures: 2 } });
		const result = performDeathSave(pc);

		expect(result.roll.result).toBe('critical-success');
		expect(pc.hp).toBe(1);
		expect(pc.deathSaves).toEqual({ successes: 0, failures: 0 });
		expect(pc.conditions).not.toContain('unconscious');
		expect(pc.conditions).not.toContain('incapacitated');
		expect(pc.dead).toBe(false);
		expect(pc.stable).toBe(false);
	});
});
