import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, NPC, Location, Quest, TurnRecord } from '$lib/game/types';
import { DEFAULT_CONDITION_EFFECTS, GAME_STATE_VERSION } from '$lib/game/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadGameState = vi.fn();
const mockSaveGameState = vi.fn();
const mockLoadRecentTurns = vi.fn();
const mockCompleteChat = vi.fn();
const mockNotifyRoom = vi.fn();

vi.mock('@trigger.dev/sdk', () => ({
	task: (config: { id: string; run: (...args: unknown[]) => unknown }) => ({
		...config,
		trigger: config.run
	})
}));

// The vi.mock above injects `run` onto each task object at runtime via
// spread, but the TS `Task` type from @trigger.dev/sdk doesn't declare it.
// We cast dynamic imports to `any` below so `.run()` calls compile.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;

vi.mock('$lib/game/state', () => ({
	loadGameState: (...args: unknown[]) => mockLoadGameState(...args),
	saveGameState: (...args: unknown[]) => mockSaveGameState(...args),
	loadRecentTurns: (...args: unknown[]) => mockLoadRecentTurns(...args)
}));

vi.mock('../lib/server/ai/world-enrichment', async () => {
	const actual = await vi.importActual('../lib/server/ai/world-enrichment') as Record<string, unknown>;
	return {
		...actual,
		expandSettlement: vi.fn(),
		extendQuestArc: vi.fn(),
		reactToPartyHistory: vi.fn()
	};
});

vi.mock('../lib/server/ai/party', () => ({
	notifyRoom: (...args: unknown[]) => mockNotifyRoom(...args)
}));

vi.mock('../lib/server/ai/openai', () => ({
	completeChat: (...args: unknown[]) => mockCompleteChat(...args)
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNpc(overrides: Partial<NPC> = {}): NPC {
	return {
		id: 'npc-1', name: 'Gormric', role: 'neutral', locationId: 'loc-1',
		disposition: 20, description: 'A tavern keeper.', notes: '', alive: true,
		...overrides
	};
}

function makeLocation(overrides: Partial<Location> = {}): Location {
	return {
		id: 'loc-1', name: 'Village Square', regionRef: null, type: 'settlement',
		description: 'A bustling settlement.', connections: [], npcs: ['npc-1'],
		features: ['A stone fountain'], visited: true,
		...overrides
	};
}

function makeQuest(overrides: Partial<Quest> = {}): Quest {
	return {
		id: 'quest-1', name: 'Trouble Near Oakhold',
		description: 'Strange creatures in the woods.',
		giverNpcId: 'npc-1', status: 'completed',
		objectives: [
			{ id: 'obj-1', text: 'Investigate', done: true },
			{ id: 'obj-2', text: 'Resolve', done: true }
		],
		rewards: { xp: 100, gold: 25, items: [], reputationChanges: [] },
		recommendedLevel: 1, encounterTemplates: [],
		...overrides
	};
}

function makeState(overrides: Partial<GameState> = {}): GameState {
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters: [{
			id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
			classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
			classSpells: [], pactSlots: [], level: 3,
			abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
			hp: 28, maxHp: 28, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
			proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
			saveProficiencies: ['str', 'con'], languages: ['common'],
			armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
			classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
			deathSaves: { successes: 0, failures: 0 }, inspiration: false,
			passivePerception: 11, inventory: [], gold: 50, xp: 0,
			conditions: [], resistances: [], exhaustionLevel: 0,
			stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
		}],
		npcs: [makeNpc()],
		locations: [makeLocation()],
		quests: [makeQuest()],
		conditionEffects: DEFAULT_CONDITION_EFFECTS,
		partyLocationId: 'loc-1',
		clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
		turnLog: [],
		worldSeed: 'seed',
		nextTurnNumber: 5,
		sceneFacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides
	};
}

function makeTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
	return {
		id: 'turn-1', turnNumber: 1, actorType: 'player', actorId: 'user-1',
		action: 'I search the room', intent: 'examine', status: 'completed',
		resolvedActionSummary: 'Searched the room', narrativeText: 'You find dusty shelves.',
		mechanicResults: [], stateChanges: {}, timestamp: Date.now(),
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Helper: get the mock enrichment functions after import
// ---------------------------------------------------------------------------

async function getEnrichmentMocks() {
	const mod = await import('../lib/server/ai/world-enrichment');
	return {
		expandSettlement: mod.expandSettlement as unknown as ReturnType<typeof vi.fn>,
		extendQuestArc: mod.extendQuestArc as unknown as ReturnType<typeof vi.fn>,
		reactToPartyHistory: mod.reactToPartyHistory as unknown as ReturnType<typeof vi.fn>
	};
}

// ===========================================================================
// Trigger task broadcasting tests — expandSettlementTask
// ===========================================================================

describe('expandSettlementTask — broadcasts events after success', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockSaveGameState.mockReset();
		mockNotifyRoom.mockReset();
		mockLoadRecentTurns.mockReset();
	});

	it('broadcasts NPC discovery events and enrichment:complete after expanding a settlement', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.expandSettlement.mockResolvedValue({
			success: true,
			summary: 'Added 2 NPCs and 1 scene fact to Village Square.',
			stateChanges: {
				npcsAdded: [
					{ id: 'npc-baker', name: 'Hilda the Baker', role: 'merchant', locationId: 'loc-1', disposition: 15, description: 'A jolly baker.' },
					{ id: 'npc-guard', name: 'Sergeant Bran', role: 'neutral', locationId: 'loc-1', disposition: 5, description: 'A watchful guard.' }
				],
				sceneFactsAdded: ['The smell of fresh bread wafts from the bakery.']
			}
		});

		const { expandSettlementTask } = await import('./world-enrichment') as AnyModule;
		const result = await expandSettlementTask.run({
			adventureId: 'adv-1',
			locationId: 'loc-1'
		});

		expect(result).toEqual({ success: true, summary: 'Added 2 NPCs and 1 scene fact to Village Square.' });

		// Should have broadcast 2 NPC discovery events + 1 enrichment:complete
		expect(mockNotifyRoom).toHaveBeenCalledTimes(3);

		// First two calls: NPC discovery
		const npcCall1 = mockNotifyRoom.mock.calls[0];
		expect(npcCall1[0]).toBe('party.test');
		expect(npcCall1[1]).toBe('adv-1');
		expect(npcCall1[2]).toMatchObject({
			type: 'game:npc-discovered',
			adventureId: 'adv-1',
			npcId: 'npc-baker',
			name: 'Hilda the Baker',
			role: 'merchant',
			locationId: 'loc-1'
		});

		const npcCall2 = mockNotifyRoom.mock.calls[1];
		expect(npcCall2[2]).toMatchObject({
			type: 'game:npc-discovered',
			npcId: 'npc-guard',
			name: 'Sergeant Bran'
		});

		// Last call: enrichment:complete summary
		const summaryCall = mockNotifyRoom.mock.calls[2];
		expect(summaryCall[2]).toMatchObject({
			type: 'enrichment:complete',
			adventureId: 'adv-1',
			taskType: 'expand-settlement',
			summary: 'Added 2 NPCs and 1 scene fact to Village Square.'
		});
		expect(summaryCall[2].changes.npcsAdded).toHaveLength(2);
	});

	it('does NOT broadcast when no PARTYKIT_HOST is set', async () => {
		delete process.env.PARTYKIT_HOST;
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.expandSettlement.mockResolvedValue({
			success: true,
			summary: 'Added 1 NPC.',
			stateChanges: {
				npcsAdded: [
					{ id: 'npc-new', name: 'New NPC', role: 'neutral', locationId: 'loc-1', disposition: 0, description: '' }
				]
			}
		});

		const { expandSettlementTask } = await import('./world-enrichment') as AnyModule;
		const result = await expandSettlementTask.run({
			adventureId: 'adv-1',
			locationId: 'loc-1'
		});

		expect(result.success).toBe(true);
		expect(mockNotifyRoom).not.toHaveBeenCalled();
	});

	it('does NOT broadcast when enrichment fails', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);

		const mocks = await getEnrichmentMocks();
		mocks.expandSettlement.mockResolvedValue({
			success: false,
			error: 'Location not found',
			summary: '',
			stateChanges: {}
		});

		const { expandSettlementTask } = await import('./world-enrichment') as AnyModule;
		const result = await expandSettlementTask.run({
			adventureId: 'adv-1',
			locationId: 'loc-missing'
		});

		expect(result.success).toBe(false);
		expect(mockNotifyRoom).not.toHaveBeenCalled();
	});
});

// ===========================================================================
// Trigger task broadcasting tests — extendQuestArcTask
// ===========================================================================

describe('extendQuestArcTask — broadcasts events after success', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockSaveGameState.mockReset();
		mockNotifyRoom.mockReset();
		mockLoadRecentTurns.mockReset();
	});

	it('broadcasts quest discovery and enrichment:complete after extending a quest arc', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.extendQuestArc.mockResolvedValue({
			success: true,
			summary: 'Generated follow-up quest "The Deeper Threat".',
			stateChanges: {
				questsAdded: [{
					id: 'quest-deeper',
					name: 'The Deeper Threat',
					description: 'The original menace was just a symptom of a deeper evil.',
					giverNpcId: 'npc-1',
					objectives: [
						{ id: 'obj-tomb', text: 'Travel to the ancient tomb' },
						{ id: 'obj-necro', text: 'Defeat the necromancer' }
					],
					recommendedLevel: 4
				}]
			}
		});

		const { extendQuestArcTask } = await import('./world-enrichment') as AnyModule;
		const result = await extendQuestArcTask.run({
			adventureId: 'adv-1',
			questId: 'quest-1'
		});

		expect(result).toEqual({ success: true, summary: 'Generated follow-up quest "The Deeper Threat".' });

		// 1 quest discovery + 1 enrichment:complete = 2 calls
		expect(mockNotifyRoom).toHaveBeenCalledTimes(2);

		const questDiscovery = mockNotifyRoom.mock.calls[0][2];
		expect(questDiscovery).toMatchObject({
			type: 'game:quest-discovered',
			adventureId: 'adv-1',
			questId: 'quest-deeper',
			name: 'The Deeper Threat',
			description: 'The original menace was just a symptom of a deeper evil.'
		});

		const summary = mockNotifyRoom.mock.calls[1][2];
		expect(summary).toMatchObject({
			type: 'enrichment:complete',
			taskType: 'extend-quest-arc'
		});
	});

	it('broadcasts NPC + quest discovery when arc extension includes a new NPC', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.extendQuestArc.mockResolvedValue({
			success: true,
			summary: 'Generated quest with a new quest-giver NPC.',
			stateChanges: {
				npcsAdded: [{
					id: 'npc-sage', name: 'Sage Elendil', role: 'quest-giver', locationId: 'loc-1',
					disposition: 25, description: 'A wise old sage with knowledge of the ancient tomb.'
				}],
				questsAdded: [{
					id: 'quest-sage',
					name: 'The Sage\'s Plea',
					description: 'Help the sage retrieve his lost tome.',
					giverNpcId: 'npc-sage',
					objectives: [{ id: 'obj-tome', text: 'Find the lost tome' }],
					recommendedLevel: 3
				}]
			}
		});

		const { extendQuestArcTask } = await import('./world-enrichment') as AnyModule;
		await extendQuestArcTask.run({ adventureId: 'adv-1', questId: 'quest-1' });

		// 1 NPC discovery + 1 quest discovery + 1 enrichment:complete = 3 calls
		expect(mockNotifyRoom).toHaveBeenCalledTimes(3);
		expect(mockNotifyRoom.mock.calls[0][2].type).toBe('game:npc-discovered');
		expect(mockNotifyRoom.mock.calls[1][2].type).toBe('game:quest-discovered');
		expect(mockNotifyRoom.mock.calls[2][2].type).toBe('enrichment:complete');
	});
});

// ===========================================================================
// Trigger task broadcasting tests — reactToPartyHistoryTask
// ===========================================================================

describe('reactToPartyHistoryTask — broadcasts events after success', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockSaveGameState.mockReset();
		mockNotifyRoom.mockReset();
		mockLoadRecentTurns.mockReset();
	});

	it('broadcasts enrichment:complete with NPC changes after world reaction', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);
		mockLoadRecentTurns.mockResolvedValue([
			makeTurn({ turnNumber: 3, action: 'I help the merchant', resolvedActionSummary: 'Helped merchant' }),
			makeTurn({ turnNumber: 4, action: 'I trade goods', resolvedActionSummary: 'Traded goods' })
		]);

		const mocks = await getEnrichmentMocks();
		mocks.reactToPartyHistory.mockResolvedValue({
			success: true,
			summary: '1 NPC reaction: Gormric now friendlier. 1 scene fact added.',
			stateChanges: {
				npcChanges: [{ npcId: 'npc-1', field: 'disposition', oldValue: 20, newValue: 35 }],
				sceneFactsAdded: ['Word of the party\'s helpfulness spreads.']
			}
		});

		const { reactToPartyHistoryTask } = await import('./world-enrichment') as AnyModule;
		const result = await reactToPartyHistoryTask.run({ adventureId: 'adv-1' });

		expect(result).toEqual({
			success: true,
			summary: '1 NPC reaction: Gormric now friendlier. 1 scene fact added.'
		});

		// Only enrichment:complete (no npcsAdded/locationsAdded/questsAdded in changes)
		expect(mockNotifyRoom).toHaveBeenCalledTimes(1);
		const summary = mockNotifyRoom.mock.calls[0][2];
		expect(summary).toMatchObject({
			type: 'enrichment:complete',
			adventureId: 'adv-1',
			taskType: 'react-to-party',
			summary: '1 NPC reaction: Gormric now friendlier. 1 scene fact added.'
		});
		expect(summary.changes.npcChanges).toHaveLength(1);
	});

	it('broadcasts location discovery events when reaction generates new locations', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);
		mockLoadRecentTurns.mockResolvedValue([makeTurn()]);

		const mocks = await getEnrichmentMocks();
		mocks.reactToPartyHistory.mockResolvedValue({
			success: true,
			summary: 'New rumored location discovered: Shadow Crypt.',
			stateChanges: {
				locationsAdded: [{
					id: 'loc-crypt', name: 'Shadow Crypt', type: 'dungeon',
					description: 'A foreboding crypt whispered about by locals.',
					connections: ['loc-1']
				}]
			}
		});

		const { reactToPartyHistoryTask } = await import('./world-enrichment') as AnyModule;
		await reactToPartyHistoryTask.run({ adventureId: 'adv-1' });

		// 1 location discovery + 1 enrichment:complete
		expect(mockNotifyRoom).toHaveBeenCalledTimes(2);
		expect(mockNotifyRoom.mock.calls[0][2]).toMatchObject({
			type: 'game:location-discovered',
			adventureId: 'adv-1',
			locationId: 'loc-crypt',
			name: 'Shadow Crypt',
			locationType: 'dungeon'
		});
		expect(mockNotifyRoom.mock.calls[1][2].type).toBe('enrichment:complete');
	});

	it('returns early when no game state exists', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.PARTYKIT_HOST = 'party.test';
		mockLoadGameState.mockResolvedValue(null);

		const { reactToPartyHistoryTask } = await import('./world-enrichment') as AnyModule;
		const result = await reactToPartyHistoryTask.run({ adventureId: 'adv-1' });

		expect(result).toEqual({ success: false, error: 'No game state' });
		expect(mockNotifyRoom).not.toHaveBeenCalled();
		expect(mockSaveGameState).not.toHaveBeenCalled();
	});
});

// ===========================================================================
// State mutation — applyEnrichmentChanges
// ===========================================================================

describe('trigger tasks apply enrichment changes to state correctly', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockSaveGameState.mockReset();
		mockNotifyRoom.mockReset();
		mockLoadRecentTurns.mockReset();
	});

	it('expandSettlementTask adds NPCs to game state before saving', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		delete process.env.PARTYKIT_HOST;
		const state = makeState({ npcs: [makeNpc()] });
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.expandSettlement.mockResolvedValue({
			success: true,
			summary: 'Added 1 NPC.',
			stateChanges: {
				npcsAdded: [{
					id: 'npc-new',
					name: 'New Arrival',
					role: 'merchant',
					locationId: 'loc-1',
					disposition: 10,
					description: 'A wandering merchant.'
				}]
			}
		});

		const { expandSettlementTask } = await import('./world-enrichment') as AnyModule;
		await expandSettlementTask.run({ adventureId: 'adv-1', locationId: 'loc-1' });

		// Verify save was called with state containing the new NPC
		expect(mockSaveGameState).toHaveBeenCalledOnce();
		const savedState = mockSaveGameState.mock.calls[0][1];
		expect(savedState.npcs).toHaveLength(2);
		const newNpc = savedState.npcs.find((n: NPC) => n.id === 'npc-new');
		expect(newNpc).toBeDefined();
		expect(newNpc.name).toBe('New Arrival');
		expect(newNpc.alive).toBe(true);
		expect(newNpc.disposition).toBe(10);
	});

	it('extendQuestArcTask adds quests to game state before saving', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		delete process.env.PARTYKIT_HOST;
		const state = makeState();
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.extendQuestArc.mockResolvedValue({
			success: true,
			summary: 'Follow-up quest created.',
			stateChanges: {
				questsAdded: [{
					id: 'quest-follow',
					name: 'Follow-up Quest',
					description: 'Continue the story.',
					objectives: [{ id: 'obj-1', text: 'Do the thing' }],
					recommendedLevel: 3
				}]
			}
		});

		const { extendQuestArcTask } = await import('./world-enrichment') as AnyModule;
		await extendQuestArcTask.run({ adventureId: 'adv-1', questId: 'quest-1' });

		const savedState = mockSaveGameState.mock.calls[0][1];
		expect(savedState.quests).toHaveLength(2);
		const newQuest = savedState.quests.find((q: Quest) => q.id === 'quest-follow');
		expect(newQuest).toBeDefined();
		expect(newQuest.status).toBe('available');
		expect(newQuest.objectives[0].done).toBe(false);
	});

	it('reactToPartyHistoryTask updates NPC dispositions in state', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		delete process.env.PARTYKIT_HOST;
		const state = makeState({ npcs: [makeNpc({ id: 'npc-1', disposition: 20 })] });
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);
		mockLoadRecentTurns.mockResolvedValue([makeTurn()]);

		const mocks = await getEnrichmentMocks();
		mocks.reactToPartyHistory.mockResolvedValue({
			success: true,
			summary: 'NPC disposition updated.',
			stateChanges: {
				npcChanges: [{ npcId: 'npc-1', field: 'disposition', oldValue: 20, newValue: 40 }]
			}
		});

		const { reactToPartyHistoryTask } = await import('./world-enrichment') as AnyModule;
		await reactToPartyHistoryTask.run({ adventureId: 'adv-1' });

		const savedState = mockSaveGameState.mock.calls[0][1];
		const npc = savedState.npcs.find((n: NPC) => n.id === 'npc-1');
		expect(npc.disposition).toBe(40);
	});

	it('updatedAt is set after enrichment changes', async () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		delete process.env.PARTYKIT_HOST;
		const originalUpdatedAt = Date.now() - 10000;
		const state = makeState({ updatedAt: originalUpdatedAt });
		mockLoadGameState.mockResolvedValue(state);
		mockSaveGameState.mockResolvedValue(undefined);

		const mocks = await getEnrichmentMocks();
		mocks.expandSettlement.mockResolvedValue({
			success: true,
			summary: 'Added NPC.',
			stateChanges: {
				npcsAdded: [{
					id: 'npc-fresh', name: 'Fresh', role: 'neutral', locationId: 'loc-1',
					disposition: 0, description: ''
				}]
			}
		});

		const { expandSettlementTask } = await import('./world-enrichment') as AnyModule;
		await expandSettlementTask.run({ adventureId: 'adv-1', locationId: 'loc-1' });

		const savedState = mockSaveGameState.mock.calls[0][1];
		expect(savedState.updatedAt).toBeGreaterThan(originalUpdatedAt);
	});
});
