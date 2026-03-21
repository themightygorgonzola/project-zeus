/**
 * State Migration Unit Tests — v2/v3 normalization and multiclass persistence.
 */

import { describe, expect, it } from 'vitest';
import { buildOpeningPreamble, createInitialGameState, createOpeningGmTurn, migrateState } from './state';
import { GAME_STATE_VERSION } from './types';

describe('migrateState', () => {
	it('returns an initial state for invalid input', () => {
		const state = migrateState(null);
		expect(state.stateVersion).toBe(GAME_STATE_VERSION);
		expect(state.characters).toEqual([]);
		expect(state.locations).toEqual([]);
	});

	it('preserves already-multiclass v3 characters', () => {
		const raw = createInitialGameState('seed-v3');
		raw.characters.push({
			id: 'pc-1',
			userId: 'user-1',
			adventureId: 'adv-1',
			name: 'Elara',
			race: 'human',
			classes: [
				{ name: 'fighter', level: 3, hitDiceRemaining: 2 },
				{ name: 'wizard', level: 2, hitDiceRemaining: 1, subclass: 'School of Evocation' }
			],
			subrace: undefined,
			background: 'sage',
			alignment: 'neutral-good',
			level: 5,
			abilities: { str: 16, dex: 14, con: 14, int: 16, wis: 10, cha: 8 },
			hp: 33,
			maxHp: 33,
			tempHp: 0,
			ac: 16,
			speed: 30,
			size: 'Medium',
			proficiencyBonus: 3,
			skillProficiencies: ['athletics', 'arcana'],
			expertiseSkills: [],
			saveProficiencies: ['str', 'con'],
			languages: ['common', 'elvish'],
			armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
			weaponProficiencies: ['simple', 'martial'],
			toolProficiencies: [],
			classFeatures: [
				{ name: 'Second Wind', level: 1, source: 'class', sourceClass: 'fighter' },
				{ name: 'Arcane Recovery', level: 1, source: 'class', sourceClass: 'wizard' }
			],
			feats: [],
			spellSlots: [{ level: 1, current: 4, max: 4 }, { level: 2, current: 2, max: 2 }],
			pactSlots: [],
			classSpells: [
				{ className: 'wizard', spellcastingAbility: 'int', cantrips: ['fire-bolt'], knownSpells: [], preparedSpells: ['shield'] }
			],
			concentratingOn: null,
			deathSaves: { successes: 0, failures: 0 },
			inspiration: false,
			passivePerception: 10,
			inventory: [],
			gold: 12,
			xp: 6500,
			conditions: [],
			resistances: [],
			exhaustionLevel: 0,
			stable: false,
			dead: false,
			featureUses: {},
			attunedItems: [],
			backstory: ''
		});

		const migrated = migrateState(raw);
		expect(migrated.characters[0].classes).toHaveLength(2);
		expect(migrated.characters[0].level).toBe(5);
		expect(migrated.characters[0].classSpells[0].className).toBe('wizard');
		expect(migrated.characters[0].classFeatures[1].sourceClass).toBe('wizard');
	});

	it('migrates legacy single-class wizard into multiclass structures', () => {
		const legacy = {
			stateVersion: 2,
			worldSeed: 'legacy-seed',
			characters: [
				{
					id: 'pc-legacy-wiz',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Old Wizard',
					race: 'human',
					class: 'wizard',
					subclass: 'School of Evocation',
					level: 3,
					hitDiceRemaining: 2,
					spellcastingAbility: 'int',
					cantrips: ['fire-bolt', 'mage-hand'],
					knownSpells: ['magic-missile', 'shield'],
					preparedSpells: ['magic-missile', 'shield'],
					abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
					hp: 18,
					maxHp: 18,
					tempHp: 0,
					ac: 12,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: ['arcana'],
					expertiseSkills: [],
					saveProficiencies: ['int', 'wis'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: ['dagger'],
					toolProficiencies: [],
					classFeatures: [
						{ name: 'Arcane Recovery', level: 1, source: 'class' },
						{ name: 'Evocation Savant', level: 2, source: 'subclass' }
					],
					feats: [],
					spellSlots: [{ level: 1, current: 4, max: 4 }, { level: 2, current: 2, max: 2 }],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
					inventory: [],
					gold: 15,
					xp: 900,
					conditions: [],
					resistances: [],
					exhaustionLevel: 0,
					stable: false,
					dead: false,
					featureUses: {},
					attunedItems: [],
					backstory: ''
				}
			],
			npcs: [],
			locations: [],
			quests: []
		};

		const state = migrateState(legacy);
		const pc = state.characters[0];
		expect(pc.classes).toEqual([
			{ name: 'wizard', level: 3, subclass: 'School of Evocation', hitDiceRemaining: 2 }
		]);
		expect(pc.classSpells).toEqual([
			{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: ['fire-bolt', 'mage-hand'],
				knownSpells: ['magic-missile', 'shield'],
				preparedSpells: ['magic-missile', 'shield']
			}
		]);
		expect(pc.classFeatures.every((feature) => feature.sourceClass === 'wizard')).toBe(true);
		expect(pc.spellSlots).toHaveLength(2);
		expect(pc.pactSlots).toEqual([]);
	});

	it('migrates legacy single-class warlock spell slots into pact slots', () => {
		const legacy = {
			characters: [
				{
					id: 'pc-warlock',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Old Hexer',
					race: 'tiefling',
					class: 'warlock',
					level: 2,
					hitDiceRemaining: 2,
					spellcastingAbility: 'cha',
					cantrips: ['eldritch-blast'],
					knownSpells: ['hex', 'armor-of-agathys'],
					preparedSpells: [],
					abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
					hp: 15,
					maxHp: 15,
					tempHp: 0,
					ac: 13,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: ['arcana'],
					expertiseSkills: [],
					saveProficiencies: ['wis', 'cha'],
					languages: ['common'],
					armorProficiencies: ['light'],
					weaponProficiencies: ['simple'],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [{ level: 1, current: 2, max: 2 }],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
					inventory: [],
					gold: 15,
					xp: 300,
					conditions: [],
					resistances: ['fire'],
					exhaustionLevel: 0,
					stable: false,
					dead: false,
					featureUses: {},
					attunedItems: [],
					backstory: ''
				}
			],
			npcs: [],
			locations: [],
			quests: []
		};

		const state = migrateState(legacy);
		const pc = state.characters[0];
		expect(pc.classes[0].name).toBe('warlock');
		expect(pc.spellSlots).toEqual([]);
		expect(pc.pactSlots).toEqual([{ level: 1, current: 2, max: 2 }]);
		expect(pc.classSpells[0].className).toBe('warlock');
	});

	it('normalizes old lobby-created state blobs without explicit version', () => {
		const legacy = {
			worldSeed: 'lobby-seed',
			characters: [{ id: 'pc-1', userId: 'u1', adventureId: 'a1', name: 'Lobby Hero', race: 'human', classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }], abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium', proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [], saveProficiencies: ['str', 'con'], languages: ['common'], armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [], classFeatures: [], feats: [], spellSlots: [], pactSlots: [], classSpells: [], concentratingOn: null, deathSaves: { successes: 0, failures: 0 }, inspiration: false, passivePerception: 10, inventory: [], gold: 0, xp: 0, conditions: [], resistances: [], exhaustionLevel: 0, stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: '' }],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Town', regionRef: null, type: 'settlement', description: '', connections: [], npcs: [], features: [], visited: true }],
			quests: [],
			partyLocationId: 'loc-1'
		};

		const state = migrateState(legacy);
		expect(state.worldSeed).toBe('lobby-seed');
		expect(state.characters[0].classes[0].name).toBe('fighter');
		expect(state.partyLocationId).toBe('loc-1');
		expect(state.stateVersion).toBe(GAME_STATE_VERSION);
	});

	it('backfills sceneFacts as empty array for legacy states', () => {
		const legacy: Record<string, unknown> = {
			version: 2,
			stateVersion: 2,
			worldSeed: 'old-seed',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			turnLog: [],
			nextTurnNumber: 1,
			characters: [],
			npcs: [],
			locations: [],
			quests: [],
			partyLocationId: null
			// No sceneFacts field — old format
		};

		const state = migrateState(legacy);
		expect(state.sceneFacts).toEqual([]);
	});

	it('preserves existing sceneFacts during migration', () => {
		const existing: Record<string, unknown> = {
			version: 2,
			stateVersion: 2,
			worldSeed: 'seed',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			turnLog: [],
			nextTurnNumber: 1,
			characters: [],
			npcs: [],
			locations: [],
			quests: [],
			partyLocationId: null,
			sceneFacts: ['The dragon sleeps', 'The bridge is out']
		};

		const state = migrateState(existing);
		expect(state.sceneFacts).toEqual(['The dragon sleeps', 'The bridge is out']);
	});
});

describe('createInitialGameState', () => {
	it('includes sceneFacts as empty array', () => {
		const state = createInitialGameState('test-seed');
		expect(state.sceneFacts).toEqual([]);
	});
});

describe('opening GM preamble helpers', () => {
	it('builds a grounded opening preamble from the starting state', () => {
		const state = createInitialGameState('seed');
		state.partyLocationId = 'loc-1';
		state.locations.push({
			id: 'loc-1',
			name: 'Loryr Port',
			regionRef: null,
			type: 'settlement',
			description: 'a bustling riverside village full of rumors',
			connections: [],
			npcs: ['npc-1'],
			features: ['River barges creak at the docks'],
			visited: true
		});
		state.npcs.push({
			id: 'npc-1',
			name: 'Gormis',
			role: 'quest-giver',
			locationId: 'loc-1',
			disposition: 25,
			description: 'A watchful veteran',
			notes: '',
			alive: true
		});
		state.quests.push({
			id: 'quest-1',
			name: 'Trouble Near Loryr Port',
			description: 'Something is menacing the eastern woods.',
			status: 'available',
			giverNpcId: 'npc-1',
			objectives: [{ id: 'obj-1', text: 'Speak with the locals to learn more', done: false }],
			recommendedLevel: 1,
			rewards: { xp: 0, gold: 0, items: [], reputationChanges: [] },
			encounterTemplates: []
		});

		const text = buildOpeningPreamble(state);
		expect(text).toContain('Loryr Port');
		expect(text).toContain('Gormis');
		expect(text).toContain('Trouble Near Loryr Port');
		expect(text).toContain('What do you do first?');
	});

	it('creates an opening GM turn and advances nextTurnNumber', () => {
		const state = createInitialGameState('seed');
		state.partyLocationId = 'loc-1';
		state.locations.push({
			id: 'loc-1',
			name: 'Loryr Port',
			regionRef: null,
			type: 'settlement',
			description: 'a bustling riverside village full of rumors',
			connections: [],
			npcs: [],
			features: [],
			visited: true
		});

		const turn = createOpeningGmTurn(state);
		expect(turn).not.toBeNull();
		expect(turn?.actorType).toBe('gm');
		expect(turn?.turnNumber).toBe(1);
		expect(state.nextTurnNumber).toBe(2);
		expect(state.turnLog).toHaveLength(1);
	});
});
