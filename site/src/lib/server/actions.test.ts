import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_CONDITION_EFFECTS,
	GAME_STATE_VERSION,
	type GameState,
	type Location,
	type PlayerCharacter
} from '$lib/game/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadGameState = vi.fn();
const mockPersistTurnAndSaveState = vi.fn();

vi.mock('$lib/game/state', () => ({
	loadGameState: mockLoadGameState,
	persistTurnAndSaveState: mockPersistTurnAndSaveState
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'pc-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Aelar',
		race: 'human',
		classes: [{ name: 'cleric', level: 5, hitDiceRemaining: 5 }],
		classSpells: [{
			className: 'cleric',
			spellcastingAbility: 'wis',
			cantrips: ['guidance'],
			knownSpells: [],
			preparedSpells: ['cure-wounds']
		}],
		pactSlots: [],
		level: 5,
		abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
		hp: 20,
		maxHp: 30,
		tempHp: 0,
		ac: 16,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 3,
		skillProficiencies: ['medicine'],
		expertiseSkills: [],
		saveProficiencies: ['wis', 'cha'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'shields'],
		weaponProficiencies: ['simple'],
		toolProficiencies: [],
		classFeatures: [],
		feats: [],
		spellSlots: [{ level: 1, current: 4, max: 4 }],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 14,
		inventory: [
			{
				id: 'item-1',
				name: 'Potion of Healing',
				category: 'consumable',
				description: 'Heals 2d4+2 HP.',
				charges: 1,
				maxCharges: 1,
				effectDescription: 'Restores 2d4+2 hit points when consumed.',
				consumableType: 'potion',
				value: 50,
				quantity: 1,
				weight: 0.5,
				rarity: 'common',
				attunement: false
			}
		],
		gold: 50,
		xp: 0,
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

function makeLocation(overrides: Partial<Location> = {}): Location {
	return {
		id: 'loc-1',
		name: 'Village Square',
		regionRef: null,
		type: 'settlement',
		description: 'A bustling village square.',
		connections: [],
		npcs: [],
		features: [],
		visited: true,
		...overrides
	};
}

function makeState(overrides: Partial<GameState> = {}): GameState {
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters: [makeCharacter()],
		npcs: [],
		locations: [makeLocation()],
		quests: [],
		conditionEffects: DEFAULT_CONDITION_EFFECTS,
		partyLocationId: 'loc-1',
		clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
		turnLog: [],
		worldSeed: 'seed',
		nextTurnNumber: 1,
		sceneFacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeRestAction', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	it('fails when no game state', async () => {
		mockLoadGameState.mockResolvedValue(null);
		const { executeRestAction } = await import('./actions');
		const result = await executeRestAction('adv-1', 'user-1', 'short');
		expect(result.success).toBe(false);
		expect(result.error).toContain('No game state');
	});

	it('fails when character not found', async () => {
		mockLoadGameState.mockResolvedValue(makeState({ characters: [] }));
		const { executeRestAction } = await import('./actions');
		const result = await executeRestAction('adv-1', 'user-1', 'short');
		expect(result.success).toBe(false);
		expect(result.error).toContain('Character not found');
	});

	it('performs a short rest and persists', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeRestAction } = await import('./actions');
		const result = await executeRestAction('adv-1', 'user-1', 'short');

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('Short rest');
		expect(result.stateChanges.clockAdvance).toBeDefined();
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});

	it('performs a long rest healing the party', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeRestAction } = await import('./actions');
		const result = await executeRestAction('adv-1', 'user-1', 'long');

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('Long rest');
		expect(result.stateChanges.clockAdvance).toBeDefined();
		expect(result.stateChanges.hpChanges).toBeDefined();
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});
});

describe('executeTravelAction', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	it('fails when destination does not exist', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeTravelAction } = await import('./actions');
		const result = await executeTravelAction('adv-1', 'user-1', 'loc-nowhere');
		expect(result.success).toBe(false);
	});

	it('fails when no connection exists', async () => {
		const state = makeState({
			locations: [
				makeLocation({ id: 'loc-1', connections: [] }),
				makeLocation({ id: 'loc-2', name: 'Forest', connections: [] })
			]
		});
		mockLoadGameState.mockResolvedValue(state);
		const { executeTravelAction } = await import('./actions');
		const result = await executeTravelAction('adv-1', 'user-1', 'loc-2');
		expect(result.success).toBe(false);
		expect(result.error).toContain('No direct path');
	});

	it('travels to a connected destination and persists', async () => {
		const state = makeState({
			locations: [
				makeLocation({ id: 'loc-1', connections: ['loc-2'] }),
				makeLocation({ id: 'loc-2', name: 'Dark Forest', connections: ['loc-1'], visited: false })
			]
		});
		mockLoadGameState.mockResolvedValue(state);
		const { executeTravelAction } = await import('./actions');
		const result = await executeTravelAction('adv-1', 'user-1', 'loc-2');

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('Dark Forest');
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});
});

describe('executeUseItemAction', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	it('fails when item not found', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeUseItemAction } = await import('./actions');
		const result = await executeUseItemAction('adv-1', 'user-1', 'item-missing');
		expect(result.success).toBe(false);
		expect(result.error).toContain('Item not found');
	});

	it('uses a healing potion and persists', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeUseItemAction } = await import('./actions');
		const result = await executeUseItemAction('adv-1', 'user-1', 'item-1');

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('Potion of Healing');
		expect(result.stateChanges.hpChanges).toBeDefined();
		expect(result.stateChanges.itemsLost).toBeDefined();
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});
});

describe('executeWaitAction', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	it('waits until a specific time of day', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeWaitAction } = await import('./actions');
		const result = await executeWaitAction('adv-1', 'user-1', { until: 'night' });

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('night');
		expect(result.stateChanges.clockAdvance).toBeDefined();
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});

	it('waits a number of hours', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeWaitAction } = await import('./actions');
		const result = await executeWaitAction('adv-1', 'user-1', { hours: 8 });

		expect(result.success).toBe(true);
		expect(result.stateChanges.clockAdvance).toBeDefined();
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});

	it('defaults to one period when no options', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeWaitAction } = await import('./actions');
		const result = await executeWaitAction('adv-1', 'user-1', {});

		expect(result.success).toBe(true);
		expect(result.narrativeSummary).toContain('1 period');
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});
});

describe('executeEquipAction', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	it('fails when item not found', async () => {
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		const { executeEquipAction } = await import('./actions');
		const result = await executeEquipAction('adv-1', 'user-1', 'item-missing');
		expect(result.success).toBe(false);
		expect(result.error).toContain('Item not found');
	});
});
