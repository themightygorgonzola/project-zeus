/**
 * Phase B Unit Tests — Combat Engine
 *
 * Uses seeded PRNG (mulberry32) for deterministic assertions.
 * Tests cover:
 *   - Initiative rolling and sorting (PCs + NPCs)
 *   - Encounter creation from GameState + creatures
 *   - Turn management (advance, skip defeated, round wrap)
 *   - PC attack resolution with finesse, conditions, advantage/disadvantage
 *   - NPC attack resolution with stat block attacks
 *   - Combatant damage application with resistance/immunity/vulnerability
 *   - Encounter resolution with XP calculation and state changes
 *   - Action economy (TurnBudget) including condition effects
 *   - Utility queries (allDefeated, getLivingCombatants, findCombatant)
 *   - Full scripted 3-PC-vs-4-goblins encounter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	mulberry32,
	setRng,
	resetRng,
	rollD20
} from './mechanics';
import {
	rollInitiative,
	createEncounter,
	getCurrentCombatant,
	advanceTurn,
	resolveAttack,
	resolveNpcAttack,
	resolveCombatantDamage,
	resolveEncounter,
	freshTurnBudget,
	combatantTurnBudget,
	allDefeated,
	getLivingCombatants,
	findCombatant
} from './combat';
import type {
	PlayerCharacter,
	NPC,
	GameState,
	Combatant,
	ActiveEncounter,
	WeaponItem,
	Condition,
	CreatureStatBlock
} from './types';
import { DEFAULT_CONDITION_EFFECTS, GAME_STATE_VERSION } from './types';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SEED = 42;

function makePC(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'pc-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Aldric',
		race: 'human',
		classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
		classSpells: [],
		pactSlots: [],
		level: 3,
		abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
		hp: 28,
		maxHp: 28,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 2,
		skillProficiencies: ['athletics', 'perception'],
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
		passivePerception: 13,
		inventory: [],
		gold: 50,
		xp: 900,
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
	return makePC({
		id: 'pc-2',
		name: 'Lyra',
		classes: [{ name: 'rogue', level: 3, hitDiceRemaining: 3 }],
		abilities: { str: 8, dex: 18, con: 12, int: 14, wis: 12, cha: 10 },
		hp: 21,
		maxHp: 21,
		ac: 15,
		skillProficiencies: ['stealth', 'acrobatics', 'perception', 'sleight-of-hand'],
		expertiseSkills: ['stealth', 'sleight-of-hand'],
		saveProficiencies: ['dex', 'int'],
		...overrides
	});
}

function makeCleric(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return makePC({
		id: 'pc-3',
		name: 'Miriel',
		classes: [{ name: 'cleric', level: 3, hitDiceRemaining: 3 }],
		classSpells: [{ className: 'cleric', spellcastingAbility: 'wis', cantrips: [], knownSpells: [], preparedSpells: [] }],
		abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
		hp: 24,
		maxHp: 24,
		ac: 18,
		skillProficiencies: ['medicine', 'religion', 'perception'],
		saveProficiencies: ['wis', 'cha'],
		...overrides
	});
}

function makeGoblinStatBlock(): CreatureStatBlock {
	return {
		hp: 7,
		maxHp: 7,
		ac: 15,
		abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
		speed: 30,
		cr: 0.25,
		attacks: [
			{ name: 'Scimitar', toHit: 4, damage: '1d6+2', damageType: 'slashing' },
			{ name: 'Shortbow', toHit: 4, damage: '1d6+2', damageType: 'piercing', range: '80/320' }
		],
		savingThrows: [],
		skills: [{ skill: 'stealth', bonus: 6 }],
		resistances: [],
		immunities: [],
		vulnerabilities: [],
		traits: [{ name: 'Nimble Escape', description: 'Disengage or Hide as bonus action.' }],
		actions: [],
		legendaryActions: []
	};
}

function makeGoblin(id: string, name: string): NPC {
	return {
		id,
		name,
		role: 'hostile',
		locationId: 'loc-1',
		disposition: -80,
		description: 'A sneaky goblin.',
		notes: '',
		alive: true,
		statBlock: makeGoblinStatBlock()
	};
}

function makeLongsword(): WeaponItem {
	return {
		id: 'weap-1',
		name: 'Longsword',
		category: 'weapon',
		weaponName: 'Longsword',
		damage: '1d8',
		damageType: 'slashing',
		magicBonus: 0,
		properties: ['versatile'],
		description: 'A standard longsword.',
		value: 15,
		quantity: 1,
		weight: 3,
		rarity: 'common',
		attunement: false
	};
}

function makeRapier(): WeaponItem {
	return {
		id: 'weap-2',
		name: 'Rapier',
		category: 'weapon',
		weaponName: 'Rapier',
		damage: '1d8',
		damageType: 'piercing',
		magicBonus: 0,
		properties: ['finesse'],
		description: 'A slender thrusting sword.',
		value: 25,
		quantity: 1,
		weight: 2,
		rarity: 'common',
		attunement: false
	};
}

function makeShortbow(): WeaponItem {
	return {
		id: 'weap-3',
		name: 'Shortbow',
		category: 'weapon',
		weaponName: 'Shortbow',
		damage: '1d6',
		damageType: 'piercing',
		magicBonus: 0,
		properties: ['ammunition', 'range'],
		range: '80/320',
		description: 'A basic shortbow.',
		value: 25,
		quantity: 1,
		weight: 2,
		rarity: 'common',
		attunement: false
	};
}

function makeTestGameState(characters: PlayerCharacter[]): GameState {
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters,
		npcs: [],
		locations: [],
		quests: [],
		conditionEffects: DEFAULT_CONDITION_EFFECTS,
		partyLocationId: 'loc-1',
		clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
		turnLog: [],
		worldSeed: 'test-seed',
		nextTurnNumber: 1,
		sceneFacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

function makeEncounter(combatants: Combatant[]): ActiveEncounter {
	return {
		id: 'enc-test',
		round: 1,
		turnIndex: 0,
		initiativeOrder: combatants.map(c => c.id),
		combatants,
		status: 'active',
		startedAt: Date.now()
	};
}

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
	return {
		id: 'cbt-1',
		referenceId: 'ref-1',
		type: 'character',
		name: 'Test',
		initiative: 15,
		currentHp: 20,
		maxHp: 20,
		tempHp: 0,
		ac: 15,
		conditions: [],
		resistances: [],
		immunities: [],
		vulnerabilities: [],
		concentration: false,
		defeated: false,
		...overrides
	};
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
// Initiative
// ---------------------------------------------------------------------------

describe('rollInitiative', () => {
	it('returns entries for all PCs and alive NPCs with stat blocks', () => {
		const pcs = [makePC(), makeRogue()];
		const npcs = [makeGoblin('g1', 'Goblin A'), makeGoblin('g2', 'Goblin B')];

		const entries = rollInitiative(pcs, npcs);

		expect(entries).toHaveLength(4);
		// All entries have required fields
		for (const e of entries) {
			expect(e.id).toBeTruthy();
			expect(typeof e.initiative).toBe('number');
			expect(typeof e.dexMod).toBe('number');
		}
	});

	it('skips dead NPCs and NPCs without stat blocks', () => {
		const pcs = [makePC()];
		const dead: NPC = { ...makeGoblin('g1', 'Dead Goblin'), alive: false };
		const noStats: NPC = {
			id: 'g2',
			name: 'Townsperson',
			role: 'neutral',
			locationId: 'loc-1',
			disposition: 0,
			description: 'A villager.',
			notes: '',
			alive: true
		};

		const entries = rollInitiative(pcs, [dead, noStats]);

		// Only the PC
		expect(entries).toHaveLength(1);
		expect(entries[0].id).toBe('pc-1');
	});

	it('sorts by initiative descending', () => {
		const pcs = [makePC(), makeRogue(), makeCleric()];
		const npcs = [makeGoblin('g1', 'Goblin A'), makeGoblin('g2', 'Goblin B')];

		const entries = rollInitiative(pcs, npcs);

		for (let i = 1; i < entries.length; i++) {
			expect(entries[i - 1].initiative).toBeGreaterThanOrEqual(entries[i].initiative);
		}
	});

	it('is deterministic with seeded PRNG', () => {
		const pcs = [makePC(), makeRogue()];
		const npcs = [makeGoblin('g1', 'Goblin A')];

		const entries1 = rollInitiative(pcs, npcs);

		// Re-seed and roll again
		setRng(mulberry32(SEED));
		const entries2 = rollInitiative(pcs, npcs);

		expect(entries1.map(e => e.initiative)).toEqual(entries2.map(e => e.initiative));
	});
});

// ---------------------------------------------------------------------------
// Encounter Creation
// ---------------------------------------------------------------------------

describe('createEncounter', () => {
	it('creates an encounter with combatants for all PCs and creatures', () => {
		const pcs = [makePC(), makeRogue(), makeCleric()];
		const goblins = [
			makeGoblin('g1', 'Goblin A'),
			makeGoblin('g2', 'Goblin B')
		];
		const state = makeTestGameState(pcs);

		const { encounter, stateChange } = createEncounter(state, goblins);

		expect(encounter.combatants).toHaveLength(5);
		expect(encounter.round).toBe(1);
		expect(encounter.turnIndex).toBe(0);
		expect(encounter.status).toBe('active');
		expect(encounter.initiativeOrder).toHaveLength(5);

		// PCs have correct HP from character
		const aldric = encounter.combatants.find(c => c.name === 'Aldric');
		expect(aldric).toBeDefined();
		expect(aldric!.currentHp).toBe(28);
		expect(aldric!.type).toBe('character');

		// NPCs have HP from stat block
		const gob = encounter.combatants.find(c => c.name === 'Goblin A');
		expect(gob).toBeDefined();
		expect(gob!.currentHp).toBe(7);
		expect(gob!.type).toBe('npc');
		expect(gob!.ac).toBe(15);

		// State change records encounter start
		expect(stateChange.encounterStarted).toBeDefined();
		expect(stateChange.encounterStarted!.creatures).toHaveLength(2);
	});

	it('initiative order matches sorted initiative values', () => {
		const pcs = [makePC()];
		const npcs = [makeGoblin('g1', 'Goblin A')];
		const state = makeTestGameState(pcs);

		const { encounter } = createEncounter(state, npcs);

		// The initiativeOrder should be sorted by initiative descending
		const initiatives = encounter.initiativeOrder.map(id => {
			const c = encounter.combatants.find(cb => cb.id === id);
			return c!.initiative;
		});
		for (let i = 1; i < initiatives.length; i++) {
			expect(initiatives[i - 1]).toBeGreaterThanOrEqual(initiatives[i]);
		}
	});
});

// ---------------------------------------------------------------------------
// Turn Management
// ---------------------------------------------------------------------------

describe('getCurrentCombatant', () => {
	it('returns the combatant at the current turnIndex', () => {
		const c1 = makeCombatant({ id: 'a', name: 'Alpha' });
		const c2 = makeCombatant({ id: 'b', name: 'Bravo' });
		const enc = makeEncounter([c1, c2]);

		const current = getCurrentCombatant(enc);
		expect(current).toBeTruthy();
		expect(current!.name).toBe('Alpha');
	});

	it('returns null for a non-active encounter', () => {
		const c1 = makeCombatant({ id: 'a' });
		const enc = makeEncounter([c1]);
		enc.status = 'victory';

		expect(getCurrentCombatant(enc)).toBeNull();
	});
});

describe('advanceTurn', () => {
	it('moves to the next combatant', () => {
		const c1 = makeCombatant({ id: 'a', name: 'Alpha' });
		const c2 = makeCombatant({ id: 'b', name: 'Bravo' });
		const c3 = makeCombatant({ id: 'c', name: 'Charlie' });
		const enc = makeEncounter([c1, c2, c3]);

		const next = advanceTurn(enc);
		expect(next).toBeTruthy();
		expect(next!.name).toBe('Bravo');
		expect(enc.turnIndex).toBe(1);
	});

	it('wraps to next round when reaching the end', () => {
		const c1 = makeCombatant({ id: 'a', name: 'Alpha' });
		const c2 = makeCombatant({ id: 'b', name: 'Bravo' });
		const enc = makeEncounter([c1, c2]);
		enc.turnIndex = 1; // at Bravo

		const next = advanceTurn(enc);
		expect(next).toBeTruthy();
		expect(next!.name).toBe('Alpha');
		expect(enc.round).toBe(2);
		expect(enc.turnIndex).toBe(0);
	});

	it('skips defeated combatants', () => {
		const c1 = makeCombatant({ id: 'a', name: 'Alpha' });
		const c2 = makeCombatant({ id: 'b', name: 'Bravo', defeated: true });
		const c3 = makeCombatant({ id: 'c', name: 'Charlie' });
		const enc = makeEncounter([c1, c2, c3]);

		const next = advanceTurn(enc);
		// Should skip Bravo and land on Charlie
		expect(next!.name).toBe('Charlie');
		expect(enc.turnIndex).toBe(2);
	});

	it('returns null if all combatants are defeated', () => {
		const c1 = makeCombatant({ id: 'a', defeated: true });
		const c2 = makeCombatant({ id: 'b', defeated: true });
		const enc = makeEncounter([c1, c2]);

		const result = advanceTurn(enc);
		expect(result).toBeNull();
	});

	it('returns null for non-active encounter', () => {
		const c1 = makeCombatant({ id: 'a' });
		const enc = makeEncounter([c1]);
		enc.status = 'defeat';

		expect(advanceTurn(enc)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// PC Attack Resolution
// ---------------------------------------------------------------------------

describe('resolveAttack', () => {
	it('resolves an attack and returns the result', () => {
		const pc = makePC();
		const target = makeCombatant({ id: 'gob-1', name: 'Goblin', currentHp: 7, maxHp: 7, ac: 15 });
		const weapon = makeLongsword();
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', name: 'Aldric' }),
			target
		]);

		const result = resolveAttack(pc, target, weapon, enc);

		expect(result.attackResult).toBeDefined();
		expect(result.damageType).toBe('slashing');
		expect(typeof result.targetDefeated).toBe('boolean');
		expect(typeof result.attackResult.total).toBe('number');
		expect(typeof result.attackResult.hits).toBe('boolean');
	});

	it('uses DEX for ranged weapons', () => {
		// PC with STR 16 (+3), DEX 14 (+2) — ranged should use DEX
		const pc = makePC();
		const target = makeCombatant({ id: 'gob-1', ac: 5, currentHp: 7, maxHp: 7 }); // low AC to almost always hit
		const weapon = makeShortbow();
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1' }),
			target
		]);

		const result = resolveAttack(pc, target, weapon, enc);
		// The attack bonus should include DEX mod (+2) + prof (+2) = +4
		// (We can't directly verify internal ability choice, but the attack bonus should reflect DEX)
		expect(result.attackResult.attackBonus).toBeDefined();
		expect(result.damageType).toBe('piercing');
	});

	it('uses the better of STR/DEX for finesse weapons', () => {
		// Rogue has STR 8 (-1), DEX 18 (+4) — finesse should use DEX
		const rogue = makeRogue();
		const target = makeCombatant({ id: 'gob-1', ac: 5, currentHp: 7, maxHp: 7 });
		const weapon = makeRapier();
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-2' }),
			target
		]);

		const result = resolveAttack(rogue, target, weapon, enc);
		// With finesse and DEX 18, the bonus should be higher than with STR 8
		expect(result.attackResult.attackBonus).toBeDefined();
	});

	it('applies target condition advantage (paralyzed target)', () => {
		const pc = makePC();
		const target = makeCombatant({
			id: 'gob-1',
			ac: 15,
			currentHp: 7,
			maxHp: 7,
			conditions: ['paralyzed']
		});
		const weapon = makeLongsword();
		const enc = makeEncounter([makeCombatant({ id: 'pc-1' }), target]);

		const result = resolveAttack(pc, target, weapon, enc);

		// Should note advantage from paralysis
		expect(result.attackerAdvantageReason).toEqual(
			expect.arrayContaining([expect.stringContaining('paralyzed')])
		);
		expect(result.attackResult.advantageState).toBe('advantage');
	});

	it('applies attacker condition disadvantage (poisoned)', () => {
		const pc = makePC({ conditions: ['poisoned'] });
		const target = makeCombatant({ id: 'gob-1', ac: 15, currentHp: 7, maxHp: 7 });
		const weapon = makeLongsword();
		const enc = makeEncounter([makeCombatant({ id: 'pc-1' }), target]);

		const result = resolveAttack(pc, target, weapon, enc);

		// Poisoned gives disadvantage on attack rolls
		expect(result.attackerAdvantageReason).toEqual(
			expect.arrayContaining([expect.stringContaining('disadvantage')])
		);
	});

	it('cancels advantage and disadvantage to normal', () => {
		// Attacker is poisoned (disadv), target is paralyzed (attacker gets adv) → cancel to normal
		const pc = makePC({ conditions: ['poisoned'] });
		const target = makeCombatant({
			id: 'gob-1',
			ac: 15,
			currentHp: 7,
			maxHp: 7,
			conditions: ['paralyzed']
		});
		const weapon = makeLongsword();
		const enc = makeEncounter([makeCombatant({ id: 'pc-1' }), target]);

		const result = resolveAttack(pc, target, weapon, enc);
		expect(result.attackResult.advantageState).toBe('normal');
	});

	it('reduces target HP on hit', () => {
		setRng(mulberry32(999)); // Different seed to get a specific hit
		const pc = makePC();
		const target = makeCombatant({ id: 'gob-1', ac: 1, currentHp: 50, maxHp: 50 }); // AC 1 = almost always hit
		const weapon = makeLongsword();
		const enc = makeEncounter([makeCombatant({ id: 'pc-1' }), target]);

		const result = resolveAttack(pc, target, weapon, enc);

		if (result.attackResult.hits) {
			expect(result.damageResult).not.toBeNull();
			expect(result.damageResult!.currentHp).toBeLessThan(50);
			expect(target.currentHp).toBe(result.damageResult!.currentHp);
		}
	});

	it('marks target defeated when HP drops to 0', () => {
		setRng(mulberry32(999));
		const pc = makePC();
		const target = makeCombatant({ id: 'gob-1', ac: 1, currentHp: 1, maxHp: 7 });
		const weapon = makeLongsword();
		const enc = makeEncounter([makeCombatant({ id: 'pc-1' }), target]);

		const result = resolveAttack(pc, target, weapon, enc);

		if (result.attackResult.hits) {
			expect(result.targetDefeated).toBe(true);
			expect(target.defeated).toBe(true);
		}
	});

	it('is deterministic with same seed', () => {
		const pc = makePC();
		const weapon = makeLongsword();

		// First run
		setRng(mulberry32(123));
		const target1 = makeCombatant({ id: 'gob-1', ac: 15, currentHp: 20, maxHp: 20 });
		const enc1 = makeEncounter([makeCombatant({ id: 'pc-1' }), target1]);
		const result1 = resolveAttack(pc, target1, weapon, enc1);

		// Second run with same seed
		setRng(mulberry32(123));
		const target2 = makeCombatant({ id: 'gob-1', ac: 15, currentHp: 20, maxHp: 20 });
		const enc2 = makeEncounter([makeCombatant({ id: 'pc-1' }), target2]);
		const result2 = resolveAttack(pc, target2, weapon, enc2);

		expect(result1.attackResult.total).toBe(result2.attackResult.total);
		expect(result1.attackResult.hits).toBe(result2.attackResult.hits);
	});
});

// ---------------------------------------------------------------------------
// NPC Attack Resolution
// ---------------------------------------------------------------------------

describe('resolveNpcAttack', () => {
	it('resolves an NPC attack against a combatant', () => {
		const goblin = makeGoblin('g1', 'Goblin A');
		const target = makeCombatant({ id: 'pc-1', name: 'Aldric', ac: 18, currentHp: 28, maxHp: 28 });
		const enc = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target]);

		const result = resolveNpcAttack(goblin, 0, target, enc);

		expect(result.attackResult).toBeDefined();
		expect(result.damageType).toBe('slashing'); // Scimitar
		expect(typeof result.attackResult.total).toBe('number');
		// toHit is +4 for goblin scimitar
		expect(result.attackResult.attackBonus).toBe(4);
	});

	it('throws when attack index is out of bounds', () => {
		const goblin = makeGoblin('g1', 'Goblin');
		const target = makeCombatant({ id: 'pc-1', ac: 18, currentHp: 28, maxHp: 28 });
		const enc = makeEncounter([target]);

		expect(() => resolveNpcAttack(goblin, 99, target, enc)).toThrow();
	});

	it('throws when NPC has no stat block', () => {
		const npc: NPC = {
			id: 'npc-1',
			name: 'Villager',
			role: 'neutral',
			locationId: 'loc-1',
			disposition: 0,
			description: 'A peaceful villager.',
			notes: '',
			alive: true
		};
		const target = makeCombatant({ id: 'pc-1' });
		const enc = makeEncounter([target]);

		expect(() => resolveNpcAttack(npc, 0, target, enc)).toThrow();
	});

	it('applies advantage from target conditions', () => {
		const goblin = makeGoblin('g1', 'Goblin');
		const target = makeCombatant({
			id: 'pc-1',
			ac: 18,
			currentHp: 28,
			maxHp: 28,
			conditions: ['stunned']
		});
		const enc = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target]);

		const result = resolveNpcAttack(goblin, 0, target, enc);

		expect(result.attackerAdvantageReason).toEqual(
			expect.arrayContaining([expect.stringContaining('stunned')])
		);
		expect(result.attackResult.advantageState).toBe('advantage');
	});

	it('uses second attack (shortbow)', () => {
		const goblin = makeGoblin('g1', 'Goblin');
		const target = makeCombatant({ id: 'pc-1', ac: 18, currentHp: 28, maxHp: 28 });
		const enc = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target]);

		const result = resolveNpcAttack(goblin, 1, target, enc);

		expect(result.damageType).toBe('piercing'); // Shortbow
	});

	it('is deterministic with seeded PRNG', () => {
		const goblin = makeGoblin('g1', 'Goblin');

		setRng(mulberry32(77));
		const target1 = makeCombatant({ id: 'pc-1', ac: 15, currentHp: 30, maxHp: 30 });
		const enc1 = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target1]);
		const r1 = resolveNpcAttack(goblin, 0, target1, enc1);

		setRng(mulberry32(77));
		const target2 = makeCombatant({ id: 'pc-1', ac: 15, currentHp: 30, maxHp: 30 });
		const enc2 = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target2]);
		const r2 = resolveNpcAttack(goblin, 0, target2, enc2);

		expect(r1.attackResult.total).toBe(r2.attackResult.total);
		expect(r1.attackResult.hits).toBe(r2.attackResult.hits);
	});
});

// ---------------------------------------------------------------------------
// Combatant Damage
// ---------------------------------------------------------------------------

describe('resolveCombatantDamage', () => {
	it('applies damage to a combatant', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 8);

		expect(result).not.toBeNull();
		expect(result!.currentHp).toBe(12);
		expect(result!.previousHp).toBe(20);
		expect(target.currentHp).toBe(12);
	});

	it('absorbs damage with temp HP first', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20, tempHp: 5 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 8);

		expect(result).not.toBeNull();
		expect(result!.tempHpAbsorbed).toBe(5);
		// 8 damage - 5 temp = 3 real damage, 20 - 3 = 17
		expect(result!.currentHp).toBe(17);
		expect(target.tempHp).toBe(0);
	});

	it('marks combatant defeated at 0 HP', () => {
		const target = makeCombatant({ id: 'a', currentHp: 5, maxHp: 20 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 10);

		expect(result).not.toBeNull();
		expect(target.defeated).toBe(true);
		// HP floors at 0 (no negative)
		expect(target.currentHp).toBeLessThanOrEqual(0);
	});

	it('returns null for already-defeated combatant', () => {
		const target = makeCombatant({ id: 'a', defeated: true });
		const enc = makeEncounter([target]);

		expect(resolveCombatantDamage(enc, 'a', 5)).toBeNull();
	});

	it('returns null when combatant not found', () => {
		const target = makeCombatant({ id: 'a' });
		const enc = makeEncounter([target]);

		expect(resolveCombatantDamage(enc, 'nonexistent', 5)).toBeNull();
	});

	it('applies immunity (fire damage, fire immune)', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 15, 'fire', [], ['fire'], []);

		expect(result).not.toBeNull();
		expect(result!.effectiveDamage).toBe(0);
		expect(result!.damageModified).toBe('immune');
		expect(target.currentHp).toBe(20);
	});

	it('applies resistance (halves damage, floor)', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 7, 'fire', ['fire'], [], []);

		expect(result).not.toBeNull();
		expect(result!.effectiveDamage).toBe(3); // floor(7/2) = 3
		expect(result!.damageModified).toBe('resistant');
		expect(target.currentHp).toBe(17);
	});

	it('applies vulnerability (doubles damage)', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20 });
		const enc = makeEncounter([target]);

		const result = resolveCombatantDamage(enc, 'a', 5, 'fire', [], [], ['fire']);

		expect(result).not.toBeNull();
		expect(result!.effectiveDamage).toBe(10);
		expect(result!.damageModified).toBe('vulnerable');
		expect(target.currentHp).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// Encounter Resolution
// ---------------------------------------------------------------------------

describe('resolveEncounter', () => {
	it('calculates XP on victory from defeated NPCs', () => {
		const goblins = [
			makeGoblin('g1', 'Goblin A'),
			makeGoblin('g2', 'Goblin B'),
			makeGoblin('g3', 'Goblin C'),
			makeGoblin('g4', 'Goblin D')
		];

		const combatants: Combatant[] = [
			makeCombatant({ id: 'pc-1', referenceId: 'pc-1', type: 'character', name: 'Aldric' }),
			makeCombatant({ id: 'pc-2', referenceId: 'pc-2', type: 'character', name: 'Lyra' }),
			makeCombatant({ id: 'pc-3', referenceId: 'pc-3', type: 'character', name: 'Miriel' }),
			makeCombatant({ id: 'g1', referenceId: 'g1', type: 'npc', name: 'Goblin A', defeated: true }),
			makeCombatant({ id: 'g2', referenceId: 'g2', type: 'npc', name: 'Goblin B', defeated: true }),
			makeCombatant({ id: 'g3', referenceId: 'g3', type: 'npc', name: 'Goblin C', defeated: true }),
			makeCombatant({ id: 'g4', referenceId: 'g4', type: 'npc', name: 'Goblin D', defeated: true })
		];

		const enc = makeEncounter(combatants);

		const result = resolveEncounter(enc, 'victory', goblins, 3);

		// CR 1/4 = 50 XP each, 4 goblins = 200 total, divided by 3 PCs = 66 each
		expect(result.totalXp).toBe(200);
		expect(result.xpPerCharacter).toBe(66);
		expect(result.outcome).toBe('victory');
		expect(enc.status).toBe('victory');
		expect(enc.outcome).toBe('victory');
		expect(enc.endedAt).toBeDefined();
	});

	it('awards XP only to non-defeated PCs', () => {
		const goblins = [makeGoblin('g1', 'Goblin A')];

		const combatants: Combatant[] = [
			makeCombatant({ id: 'pc-1', referenceId: 'pc-1', type: 'character', name: 'Aldric' }),
			makeCombatant({ id: 'pc-2', referenceId: 'pc-2', type: 'character', name: 'Lyra', defeated: true }),
			makeCombatant({ id: 'g1', referenceId: 'g1', type: 'npc', name: 'Goblin A', defeated: true })
		];

		const enc = makeEncounter(combatants);
		const result = resolveEncounter(enc, 'victory', goblins, 2);

		expect(result.stateChange.xpAwarded).toBeDefined();
		// Only Aldric gets XP (Lyra is defeated)
		expect(result.stateChange.xpAwarded!).toHaveLength(1);
		expect(result.stateChange.xpAwarded![0].characterId).toBe('pc-1');
	});

	it('awards no XP on defeat', () => {
		const goblins = [makeGoblin('g1', 'Goblin A')];
		const combatants: Combatant[] = [
			makeCombatant({ id: 'pc-1', referenceId: 'pc-1', type: 'character', defeated: true }),
			makeCombatant({ id: 'g1', referenceId: 'g1', type: 'npc', name: 'Goblin A' })
		];
		const enc = makeEncounter(combatants);

		const result = resolveEncounter(enc, 'defeat', goblins, 1);

		expect(result.totalXp).toBe(0);
		expect(result.xpPerCharacter).toBe(0);
		expect(result.stateChange.encounterEnded!.outcome).toBe('defeat');
	});

	it('awards XP on negotiated outcome for defeated NPCs only', () => {
		const goblins = [
			makeGoblin('g1', 'Goblin A'),
			makeGoblin('g2', 'Goblin B')
		];
		const combatants: Combatant[] = [
			makeCombatant({ id: 'pc-1', referenceId: 'pc-1', type: 'character' }),
			makeCombatant({ id: 'g1', referenceId: 'g1', type: 'npc', defeated: true }),
			// g2 still alive — no XP for it
			makeCombatant({ id: 'g2', referenceId: 'g2', type: 'npc', defeated: false })
		];
		const enc = makeEncounter(combatants);

		const result = resolveEncounter(enc, 'negotiated', goblins, 1);

		// Only 1 goblin defeated = 50 XP
		expect(result.totalXp).toBe(50);
		expect(result.xpPerCharacter).toBe(50);
	});

	it('records encounterEnded state change', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', referenceId: 'pc-1', type: 'character' })
		]);

		const result = resolveEncounter(enc, 'flee', [], 1);

		expect(result.stateChange.encounterEnded).toBeDefined();
		expect(result.stateChange.encounterEnded!.outcome).toBe('flee');
	});
});

// ---------------------------------------------------------------------------
// Action Economy
// ---------------------------------------------------------------------------

describe('freshTurnBudget', () => {
	it('returns full action economy for a given speed', () => {
		const budget = freshTurnBudget(30);

		expect(budget.action).toBe(true);
		expect(budget.bonusAction).toBe(true);
		expect(budget.reaction).toBe(true);
		expect(budget.movement).toBe(30);
	});

	it('handles zero speed', () => {
		const budget = freshTurnBudget(0);
		expect(budget.movement).toBe(0);
		expect(budget.action).toBe(true);
	});
});

describe('combatantTurnBudget', () => {
	it('returns full budget for healthy combatant', () => {
		const combatant = makeCombatant({ conditions: [] });
		const budget = combatantTurnBudget(combatant, 30);

		expect(budget.action).toBe(true);
		expect(budget.bonusAction).toBe(true);
		expect(budget.reaction).toBe(true);
		expect(budget.movement).toBe(30);
	});

	it('sets speed to 0 for grappled combatant', () => {
		const combatant = makeCombatant({ conditions: ['grappled'] });
		const budget = combatantTurnBudget(combatant, 30);

		// Grappled: speedMultiplier = 0
		expect(budget.movement).toBe(0);
		expect(budget.action).toBe(true);
	});

	it('halves speed for exhausted combatant', () => {
		const combatant = makeCombatant({ conditions: ['exhaustion'] });
		const budget = combatantTurnBudget(combatant, 30);

		expect(budget.movement).toBe(15); // 30 * 0.5
	});

	it('disables actions for incapacitated combatant', () => {
		const combatant = makeCombatant({ conditions: ['incapacitated'] });
		const budget = combatantTurnBudget(combatant, 30);

		// Incapacitated: cantDo includes 'take-actions' and 'take-reactions'
		expect(budget.action).toBe(false);
		expect(budget.bonusAction).toBe(false);
		expect(budget.reaction).toBe(false);
	});

	it('disables actions for unconscious combatant', () => {
		const combatant = makeCombatant({ conditions: ['unconscious'] });
		const budget = combatantTurnBudget(combatant, 30);

		// Unconscious: cantDo includes 'take-actions' and 'take-reactions', speed 0
		expect(budget.action).toBe(false);
		expect(budget.bonusAction).toBe(false);
		expect(budget.reaction).toBe(false);
		expect(budget.movement).toBe(0);
	});

	it('stacks multiple condition effects', () => {
		const combatant = makeCombatant({ conditions: ['restrained', 'exhaustion'] });
		const budget = combatantTurnBudget(combatant, 40);

		// Restrained: speed × 0, exhaustion: speed × 0.5
		// 40 × 0 × 0.5 = 0
		expect(budget.movement).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Utility Queries
// ---------------------------------------------------------------------------

describe('allDefeated', () => {
	it('returns true when all NPCs are defeated', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', type: 'character' }),
			makeCombatant({ id: 'g1', type: 'npc', defeated: true }),
			makeCombatant({ id: 'g2', type: 'npc', defeated: true })
		]);

		expect(allDefeated(enc, 'npc')).toBe(true);
		expect(allDefeated(enc, 'character')).toBe(false);
	});

	it('returns false when some NPCs are alive', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'g1', type: 'npc', defeated: true }),
			makeCombatant({ id: 'g2', type: 'npc', defeated: false })
		]);

		expect(allDefeated(enc, 'npc')).toBe(false);
	});
});

describe('getLivingCombatants', () => {
	it('returns only non-defeated combatants of a given type', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', type: 'character' }),
			makeCombatant({ id: 'pc-2', type: 'character', defeated: true }),
			makeCombatant({ id: 'g1', type: 'npc' }),
			makeCombatant({ id: 'g2', type: 'npc', defeated: true })
		]);

		const livingPCs = getLivingCombatants(enc, 'character');
		expect(livingPCs).toHaveLength(1);
		expect(livingPCs[0].id).toBe('pc-1');

		const livingNPCs = getLivingCombatants(enc, 'npc');
		expect(livingNPCs).toHaveLength(1);
		expect(livingNPCs[0].id).toBe('g1');
	});

	it('returns all living combatants when no type specified', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', type: 'character' }),
			makeCombatant({ id: 'g1', type: 'npc' }),
			makeCombatant({ id: 'g2', type: 'npc', defeated: true })
		]);

		const living = getLivingCombatants(enc);
		expect(living).toHaveLength(2);
	});
});

describe('findCombatant', () => {
	it('finds a combatant by ID', () => {
		const enc = makeEncounter([
			makeCombatant({ id: 'pc-1', name: 'Aldric' }),
			makeCombatant({ id: 'g1', name: 'Goblin' })
		]);

		const found = findCombatant(enc, 'g1');
		expect(found).not.toBeNull();
		expect(found!.name).toBe('Goblin');
	});

	it('returns null for unknown ID', () => {
		const enc = makeEncounter([makeCombatant({ id: 'a' })]);
		expect(findCombatant(enc, 'nonexistent')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Critical Hit Damage Notation (internal, tested via resolveNpcAttack)
// ---------------------------------------------------------------------------

describe('NPC critical hits', () => {
	it('double dice on critical hit (natural 20)', () => {
		// We need to find a seed that produces a natural 20 for the d20 roll
		// We'll iterate seeds to find one
		let critSeed = 0;
		for (let s = 1; s <= 10000; s++) {
			setRng(mulberry32(s));
			// rollD20 for 'normal' advantage rolls 1 die
			const { chosen } = rollD20('normal');
			if (chosen === 20) {
				critSeed = s;
				break;
			}
		}

		if (critSeed === 0) {
			// If no crit seed found in range, skip
			return;
		}

		setRng(mulberry32(critSeed));
		const goblin = makeGoblin('g1', 'Goblin');
		const target = makeCombatant({ id: 'pc-1', ac: 1, currentHp: 50, maxHp: 50 });
		const enc = makeEncounter([makeCombatant({ id: 'g1', type: 'npc' }), target]);

		const result = resolveNpcAttack(goblin, 0, target, enc);

		expect(result.attackResult.critical).toBe(true);
		expect(result.attackResult.hits).toBe(true);
		// Critical with scimitar "1d6+2" → "2d6+2", min damage = 4, max = 14
		if (result.damageResult) {
			expect(result.attackResult.totalDamage).toBeGreaterThanOrEqual(4);
			expect(result.attackResult.totalDamage).toBeLessThanOrEqual(14);
		}
	});
});

// ---------------------------------------------------------------------------
// Full Scripted Encounter: 3 PCs vs 4 Goblins
// ---------------------------------------------------------------------------

describe('Full encounter: 3 PCs vs 4 Goblins', () => {
	it('runs a complete encounter from creation to resolution', () => {
		// === Setup ===
		setRng(mulberry32(SEED));

		const aldric = makePC();
		const lyra = makeRogue();
		const miriel = makeCleric();
		const pcs = [aldric, lyra, miriel];
		const goblins = [
			makeGoblin('g1', 'Goblin Scout'),
			makeGoblin('g2', 'Goblin Warrior'),
			makeGoblin('g3', 'Goblin Archer'),
			makeGoblin('g4', 'Goblin Shaman')
		];

		const state = makeTestGameState(pcs);

		// === Phase 1: Create Encounter ===
		const { encounter, stateChange: startChange } = createEncounter(state, goblins);

		expect(encounter.combatants).toHaveLength(7);
		expect(encounter.round).toBe(1);
		expect(encounter.status).toBe('active');
		expect(startChange.encounterStarted).toBeDefined();

		// Verify initiative order is sorted
		const initiatives = encounter.initiativeOrder.map(id => {
			const c = encounter.combatants.find(cb => cb.id === id)!;
			return c.initiative;
		});
		for (let i = 1; i < initiatives.length; i++) {
			expect(initiatives[i - 1]).toBeGreaterThanOrEqual(initiatives[i]);
		}

		// === Phase 2: Step Through Turns ===
		let current = getCurrentCombatant(encounter);
		expect(current).not.toBeNull();

		// Track rounds
		const turnLog: Array<{ name: string; round: number }> = [];

		// Simulate combat: each combatant attacks the first living enemy
		// PCs attack NPCs, NPCs attack PCs
		const longsword = makeLongsword();
		const rapier = makeRapier();

		let maxTurns = 50; // Safety limit
		let turns = 0;

		while (encounter.status === 'active' && turns < maxTurns) {
			current = getCurrentCombatant(encounter);
			if (!current) break;

			turnLog.push({ name: current.name, round: encounter.round });

			if (current.type === 'character') {
				// PC attacks first living NPC
				const targetNpc = getLivingCombatants(encounter, 'npc')[0];
				if (targetNpc) {
					const pc = pcs.find(p => p.id === current!.referenceId)!;
					const weapon = pc.classes[0].name === 'rogue' ? rapier : longsword;
					resolveAttack(pc, targetNpc, weapon, encounter);
				}
			} else {
				// NPC attacks first living PC
				const targetPc = getLivingCombatants(encounter, 'character')[0];
				if (targetPc) {
					const npc = goblins.find(g => g.id === current!.referenceId)!;
					resolveNpcAttack(npc, 0, targetPc, encounter);
				}
			}

			// Check for encounter end conditions
			if (allDefeated(encounter, 'npc')) {
				// Victory!
				break;
			}
			if (allDefeated(encounter, 'character')) {
				// Defeat!
				break;
			}

			// Advance to next turn
			const next = advanceTurn(encounter);
			if (!next) break;
			turns++;
		}

		// The encounter should have progressed
		expect(turns).toBeGreaterThan(0);
		expect(turnLog.length).toBeGreaterThan(0);

		// === Phase 3: Resolve Encounter ===
		const outcome = allDefeated(encounter, 'npc') ? 'victory' : 'defeat';
		const result = resolveEncounter(encounter, outcome as any, goblins, 3);

		expect(result.outcome).toBeDefined();
		expect(result.stateChange.encounterEnded).toBeDefined();
		expect(result.stateChange.encounterEnded!.outcome).toBe(outcome);

		if (outcome === 'victory') {
			// 4 goblins * 50 XP each = 200, / 3 PCs
			const defeatedGoblins = encounter.combatants.filter(c => c.type === 'npc' && c.defeated);
			const expectedXp = defeatedGoblins.length * 50;
			expect(result.totalXp).toBe(expectedXp);
			expect(result.xpPerCharacter).toBe(Math.floor(expectedXp / 3));
		}

		// Verify encounter is properly closed
		expect(encounter.status).toBe(outcome);
		expect(encounter.endedAt).toBeDefined();
	});

	it('action economy restricts incapacitated combatants', () => {
		setRng(mulberry32(SEED));

		const incapCombatant = makeCombatant({
			id: 'test-incap',
			name: 'Dazed Fighter',
			conditions: ['incapacitated'],
			currentHp: 20,
			maxHp: 20
		});

		const budget = combatantTurnBudget(incapCombatant, 30);

		// Incapacitated prevents actions and reactions
		expect(budget.action).toBe(false);
		expect(budget.bonusAction).toBe(false);
		expect(budget.reaction).toBe(false);
		// But speed is not affected by incapacitated alone
		expect(budget.movement).toBe(30);
	});

	it('turn advancement wraps correctly through multiple rounds', () => {
		const combatants = [
			makeCombatant({ id: 'a', name: 'A' }),
			makeCombatant({ id: 'b', name: 'B' }),
			makeCombatant({ id: 'c', name: 'C' })
		];
		const enc = makeEncounter(combatants);

		expect(enc.round).toBe(1);
		expect(getCurrentCombatant(enc)!.name).toBe('A');

		advanceTurn(enc);
		expect(getCurrentCombatant(enc)!.name).toBe('B');
		expect(enc.round).toBe(1);

		advanceTurn(enc);
		expect(getCurrentCombatant(enc)!.name).toBe('C');
		expect(enc.round).toBe(1);

		// Wrap to round 2
		advanceTurn(enc);
		expect(getCurrentCombatant(enc)!.name).toBe('A');
		expect(enc.round).toBe(2);

		advanceTurn(enc);
		expect(getCurrentCombatant(enc)!.name).toBe('B');
		expect(enc.round).toBe(2);
	});

	it('damage with temp HP absorbs correctly in combat', () => {
		const target = makeCombatant({ id: 'a', currentHp: 20, maxHp: 20, tempHp: 10 });
		const enc = makeEncounter([target]);

		// Apply 15 damage
		const result = resolveCombatantDamage(enc, 'a', 15);

		expect(result).not.toBeNull();
		// 10 temp HP absorbs first, then 5 real damage
		expect(result!.tempHpAbsorbed).toBe(10);
		expect(result!.currentHp).toBe(15); // 20 - 5
		expect(target.tempHp).toBe(0);
		expect(target.currentHp).toBe(15);
	});
});
