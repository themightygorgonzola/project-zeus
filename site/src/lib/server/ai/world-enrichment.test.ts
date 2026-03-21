import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_CONDITION_EFFECTS,
	GAME_STATE_VERSION,
	type GameState,
	type Location,
	type NPC,
	type PlayerCharacter,
	type Quest,
	type TurnRecord
} from '$lib/game/types';
import { parseEnrichmentResponse } from './world-enrichment';

// ---------------------------------------------------------------------------
// Mocks — OpenAI
// ---------------------------------------------------------------------------

vi.mock('./openai', () => ({
	completeChat: vi.fn()
}));

async function getMockCompleteChat() {
	const mod = await import('./openai');
	return mod.completeChat as unknown as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNpc(overrides: Partial<NPC> = {}): NPC {
	return {
		id: 'npc-1',
		name: 'Gormric',
		role: 'neutral',
		locationId: 'loc-1',
		disposition: 20,
		description: 'A friendly tavern keeper.',
		notes: '',
		alive: true,
		...overrides
	};
}

function makeLocation(overrides: Partial<Location> = {}): Location {
	return {
		id: 'loc-1',
		name: 'Village Square',
		regionRef: null,
		type: 'settlement',
		description: 'A bustling settlement.',
		connections: [],
		npcs: ['npc-1'],
		features: ['A stone fountain', 'Market stalls'],
		visited: true,
		...overrides
	};
}

function makeQuest(overrides: Partial<Quest> = {}): Quest {
	return {
		id: 'quest-1',
		name: 'Trouble Near Oakhold',
		description: 'Strange creatures in the woods.',
		giverNpcId: 'npc-1',
		status: 'completed',
		objectives: [
			{ id: 'obj-1', text: 'Investigate the source', done: true },
			{ id: 'obj-2', text: 'Resolve the threat', done: true }
		],
		rewards: { xp: 100, gold: 25, items: [], reputationChanges: [] },
		recommendedLevel: 1,
		encounterTemplates: [],
		...overrides
	};
}

function makeCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'pc-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Aelar',
		race: 'human',
		classes: [{ name: 'cleric', level: 3, hitDiceRemaining: 3 }],
		classSpells: [],
		pactSlots: [],
		level: 3,
		abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
		hp: 24,
		maxHp: 24,
		tempHp: 0,
		ac: 16,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 2,
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
		inventory: [],
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

function makeState(overrides: Partial<GameState> = {}): GameState {
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters: [makeCharacter()],
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
		id: 'turn-1',
		turnNumber: 1,
		actorType: 'player',
		actorId: 'user-1',
		action: 'I search the room',
		intent: 'examine',
		status: 'completed',
		resolvedActionSummary: 'Searched the room',
		narrativeText: 'You find dusty shelves.',
		mechanicResults: [],
		stateChanges: {},
		timestamp: Date.now(),
		...overrides
	};
}

// ---------------------------------------------------------------------------
// parseEnrichmentResponse — pure unit tests (no mocks needed)
// ---------------------------------------------------------------------------

describe('parseEnrichmentResponse', () => {
	it('parses valid NPC additions', () => {
		const json = JSON.stringify({
			npcsAdded: [
				{ name: 'Bren', role: 'merchant', locationId: 'loc-1', disposition: 15, description: 'A gruff merchant.' }
			]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.npcsAdded![0].name).toBe('Bren');
		expect(result.npcsAdded![0].role).toBe('merchant');
		expect(result.npcsAdded![0].id).toMatch(/^npc-/);
	});

	it('parses valid location additions', () => {
		const json = JSON.stringify({
			locationsAdded: [
				{ name: 'Dark Cave', type: 'dungeon', description: 'A foreboding cave entrance.', connections: ['loc-1'] }
			]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.locationsAdded).toHaveLength(1);
		expect(result.locationsAdded![0].name).toBe('Dark Cave');
		expect(result.locationsAdded![0].type).toBe('dungeon');
		expect(result.locationsAdded![0].id).toMatch(/^loc-/);
	});

	it('parses valid quest additions with objectives', () => {
		const json = JSON.stringify({
			questsAdded: [
				{
					name: 'The Lost Artifact',
					description: 'Find the ancient relic.',
					giverNpcId: 'npc-1',
					objectives: [{ text: 'Explore the ruins' }, { text: 'Retrieve the artifact' }],
					recommendedLevel: 3
				}
			]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.questsAdded).toHaveLength(1);
		expect(result.questsAdded![0].name).toBe('The Lost Artifact');
		expect(result.questsAdded![0].objectives).toHaveLength(2);
		expect(result.questsAdded![0].id).toMatch(/^quest-/);
	});

	it('parses scene facts', () => {
		const json = JSON.stringify({
			sceneFactsAdded: ['A cold wind blows from the north', 'Merchants whisper about missing caravans']
		});
		const result = parseEnrichmentResponse(json);
		expect(result.sceneFactsAdded).toHaveLength(2);
	});

	it('parses NPC disposition changes', () => {
		const json = JSON.stringify({
			npcChanges: [
				{ npcId: 'npc-1', field: 'disposition', oldValue: 20, newValue: 35 }
			]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcChanges).toHaveLength(1);
		expect(result.npcChanges![0].newValue).toBe(35);
	});

	it('clamps NPC disposition to [-100, 100]', () => {
		const json = JSON.stringify({
			npcsAdded: [
				{ name: 'Extremist', role: 'hostile', locationId: 'loc-1', disposition: 999, description: 'Very angry.' }
			]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded![0].disposition).toBe(100);
	});

	it('assigns correct ID prefixes when AI omits them', () => {
		const json = JSON.stringify({
			npcsAdded: [{ id: 'bad-id', name: 'Test', role: 'neutral', locationId: 'loc-1', disposition: 0, description: '' }],
			locationsAdded: [{ id: 'bad-id', name: 'Test', type: 'wilderness', description: '' }],
			questsAdded: [{ id: 'bad-id', name: 'Test', description: '', objectives: [] }]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded![0].id).toMatch(/^npc-/);
		expect(result.locationsAdded![0].id).toMatch(/^loc-/);
		expect(result.questsAdded![0].id).toMatch(/^quest-/);
	});

	it('defaults invalid NPC role to neutral', () => {
		const json = JSON.stringify({
			npcsAdded: [{ name: 'Unknown', role: 'invalid-role', locationId: 'loc-1', disposition: 0, description: '' }]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded![0].role).toBe('neutral');
	});

	it('defaults invalid location type to wilderness', () => {
		const json = JSON.stringify({
			locationsAdded: [{ name: 'Place', type: 'invalid-type', description: '' }]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.locationsAdded![0].type).toBe('wilderness');
	});

	it('handles markdown-wrapped JSON', () => {
		const json = '```json\n{"npcsAdded": [{"name": "Wrapped", "role": "ally", "locationId": "loc-1", "disposition": 5, "description": "Test"}]}\n```';
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.npcsAdded![0].name).toBe('Wrapped');
	});

	it('returns empty changes on malformed JSON', () => {
		const result = parseEnrichmentResponse('not json at all');
		expect(result.npcsAdded).toBeUndefined();
		expect(result.locationsAdded).toBeUndefined();
		expect(result.questsAdded).toBeUndefined();
	});

	it('filters out entries without required fields', () => {
		const json = JSON.stringify({
			npcsAdded: [{ role: 'neutral' }, { name: 'Valid', role: 'neutral', locationId: 'loc-1', disposition: 0, description: '' }],
			locationsAdded: [{ type: 'dungeon' }, { name: 'Valid', type: 'dungeon', description: '' }]
		});
		const result = parseEnrichmentResponse(json);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.locationsAdded).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// expandSettlement — integration with mocked OpenAI
// ---------------------------------------------------------------------------

describe('expandSettlement', () => {
	beforeEach(async () => {
		const mock = await getMockCompleteChat();
		mock.mockReset();
	});

	it('returns NPCs and scene facts for a valid settlement', async () => {
		const mock = await getMockCompleteChat();
		mock.mockResolvedValue(JSON.stringify({
			npcsAdded: [
				{ name: 'Dara', role: 'merchant', locationId: 'loc-1', disposition: 10, description: 'A spice trader.' }
			],
			sceneFactsAdded: ['The smell of fresh bread fills the square.']
		}));

		const { expandSettlement } = await import('./world-enrichment');
		const state = makeState();
		const result = await expandSettlement(state, 'loc-1', { apiKey: 'test-key' });

		expect(result.success).toBe(true);
		expect(result.stateChanges.npcsAdded).toHaveLength(1);
		expect(result.stateChanges.npcsAdded![0].locationId).toBe('loc-1');
		expect(result.stateChanges.sceneFactsAdded).toHaveLength(1);
		expect(result.summary).toContain('1 NPC');
	});

	it('fails when location not found', async () => {
		const { expandSettlement } = await import('./world-enrichment');
		const state = makeState();
		const result = await expandSettlement(state, 'loc-missing', { apiKey: 'test-key' });
		expect(result.success).toBe(false);
		expect(result.error).toContain('Location not found');
	});

	it('handles AI error gracefully', async () => {
		const mock = await getMockCompleteChat();
		mock.mockRejectedValue(new Error('API timeout'));
		const { expandSettlement } = await import('./world-enrichment');
		const state = makeState();
		const result = await expandSettlement(state, 'loc-1', { apiKey: 'test-key' });
		expect(result.success).toBe(false);
		expect(result.error).toContain('API timeout');
	});
});

// ---------------------------------------------------------------------------
// extendQuestArc — integration with mocked OpenAI
// ---------------------------------------------------------------------------

describe('extendQuestArc', () => {
	beforeEach(async () => {
		const mock = await getMockCompleteChat();
		mock.mockReset();
	});

	it('returns a follow-up quest', async () => {
		const mock = await getMockCompleteChat();
		mock.mockResolvedValue(JSON.stringify({
			questsAdded: [{
				name: 'The Deeper Threat',
				description: 'The original menace was just a symptom.',
				giverNpcId: 'npc-1',
				objectives: [{ text: 'Travel to the ancient tomb' }, { text: 'Defeat the necromancer' }],
				recommendedLevel: 4
			}]
		}));

		const { extendQuestArc } = await import('./world-enrichment');
		const state = makeState();
		const result = await extendQuestArc(state, 'quest-1', { apiKey: 'test-key' });

		expect(result.success).toBe(true);
		expect(result.stateChanges.questsAdded).toHaveLength(1);
		expect(result.stateChanges.questsAdded![0].name).toBe('The Deeper Threat');
		expect(result.summary).toContain('quest');
	});

	it('fails when quest not found', async () => {
		const { extendQuestArc } = await import('./world-enrichment');
		const state = makeState();
		const result = await extendQuestArc(state, 'quest-missing', { apiKey: 'test-key' });
		expect(result.success).toBe(false);
		expect(result.error).toContain('Quest not found');
	});
});

// ---------------------------------------------------------------------------
// reactToPartyHistory — integration with mocked OpenAI
// ---------------------------------------------------------------------------

describe('reactToPartyHistory', () => {
	beforeEach(async () => {
		const mock = await getMockCompleteChat();
		mock.mockReset();
	});

	it('returns world reactions from recent turns', async () => {
		const mock = await getMockCompleteChat();
		mock.mockResolvedValue(JSON.stringify({
			npcChanges: [{ npcId: 'npc-1', field: 'disposition', oldValue: 20, newValue: 30 }],
			sceneFactsAdded: ['Word of the party\'s deeds spreads through the village.']
		}));

		const { reactToPartyHistory } = await import('./world-enrichment');
		const state = makeState();
		const turns = [
			makeTurn({ turnNumber: 1, action: 'I help the merchant unload goods', resolvedActionSummary: 'Helped merchant' }),
			makeTurn({ turnNumber: 2, action: 'I ask about the trouble', resolvedActionSummary: 'Asked about trouble' })
		];
		const result = await reactToPartyHistory(state, turns, { apiKey: 'test-key' });

		expect(result.success).toBe(true);
		expect(result.stateChanges.npcChanges).toHaveLength(1);
		expect(result.stateChanges.sceneFactsAdded).toHaveLength(1);
		expect(result.summary).toContain('NPC reaction');
	});

	it('fails when no recent turns', async () => {
		const { reactToPartyHistory } = await import('./world-enrichment');
		const state = makeState();
		const result = await reactToPartyHistory(state, [], { apiKey: 'test-key' });
		expect(result.success).toBe(false);
		expect(result.error).toContain('No recent turns');
	});

	it('handles empty world reaction gracefully', async () => {
		const mock = await getMockCompleteChat();
		mock.mockResolvedValue(JSON.stringify({}));
		const { reactToPartyHistory } = await import('./world-enrichment');
		const state = makeState();
		const turns = [makeTurn()];
		const result = await reactToPartyHistory(state, turns, { apiKey: 'test-key' });

		expect(result.success).toBe(true);
		expect(result.summary).toContain('no significant changes');
	});
});
