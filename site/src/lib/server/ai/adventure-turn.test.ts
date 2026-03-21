import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NPC, ActiveEncounter } from '$lib/game/types';

const mockLoadGameState = vi.fn();
const mockLoadRecentTurns = vi.fn();
const mockLoadUnconsumedChat = vi.fn();
const mockMarkChatConsumed = vi.fn();
const mockAssembleGMContext = vi.fn();
const mockAssembleNarrativeGMContext = vi.fn();
const mockAssembleNarratorContext = vi.fn();
const mockAssembleStateExtractionContext = vi.fn();
const mockTasksTrigger = vi.fn();
const mockCompleteChat = vi.fn();
const mockCompleteChatJSON = vi.fn();
const mockStreamChat = vi.fn();
const mockNotifyRoom = vi.fn();
const mockSaveGameState = vi.fn();
const mockPersistTurn = vi.fn();
const mockPersistTurnAndSaveState = vi.fn();

const mockAssembleRoundNarratorContext = vi.fn();

vi.mock('@trigger.dev/sdk', () => ({
	tasks: {
		trigger: mockTasksTrigger
	}
}));

vi.mock('./openai', () => ({
	completeChat: mockCompleteChat,
	completeChatJSON: mockCompleteChatJSON,
	streamChat: mockStreamChat
}));

vi.mock('./party', () => ({
	notifyRoom: mockNotifyRoom
}));

vi.mock('$lib/game/state', () => ({
	loadGameState: mockLoadGameState,
	loadRecentTurns: mockLoadRecentTurns,
	loadUnconsumedChat: mockLoadUnconsumedChat,
	markChatConsumed: mockMarkChatConsumed,
	saveGameState: mockSaveGameState,
	persistTurn: mockPersistTurn,
	persistTurnAndSaveState: mockPersistTurnAndSaveState
}));

vi.mock('$lib/game/gm-context', () => ({
	assembleGMContext: mockAssembleGMContext,
	assembleNarrativeGMContext: mockAssembleNarrativeGMContext,
	assembleNarratorContext: mockAssembleNarratorContext,
	assembleRoundNarratorContext: mockAssembleRoundNarratorContext,
	assembleStateExtractionContext: mockAssembleStateExtractionContext
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all mocks and set sensible defaults for two-pass architecture. */
function resetAllMocks() {
	mockLoadGameState.mockReset();
	mockLoadRecentTurns.mockReset();
	mockLoadUnconsumedChat.mockReset();
	mockMarkChatConsumed.mockReset();
	mockAssembleGMContext.mockReset();
	mockAssembleNarrativeGMContext.mockReset();
	mockAssembleNarratorContext.mockReset();
	mockAssembleRoundNarratorContext.mockReset();
	mockAssembleStateExtractionContext.mockReset();
	mockTasksTrigger.mockReset();
	mockCompleteChat.mockReset();
	mockCompleteChatJSON.mockReset();
	mockStreamChat.mockReset();
	mockNotifyRoom.mockReset();
	mockSaveGameState.mockReset();
	mockPersistTurn.mockReset();
	mockPersistTurnAndSaveState.mockReset();

	// Defaults for two-pass architecture (full-GM mode)
	mockLoadRecentTurns.mockResolvedValue([]);
	mockAssembleNarrativeGMContext.mockReturnValue([
		{ role: 'system', content: 'Narrative prompt' },
		{ role: 'user', content: 'test action' }
	]);
	mockAssembleStateExtractionContext.mockReturnValue([
		{ role: 'system', content: 'State extraction prompt' },
		{ role: 'user', content: 'narrative + action' }
	]);
	mockCompleteChatJSON.mockResolvedValue(JSON.stringify({ stateChanges: {} }));
}

/**
 * Helper: set up both Pass 1 (narrative prose) and Pass 2 (state JSON) mocks
 * for a full-GM two-pass test. Pass 1 uses completeChat/streamChat, Pass 2
 * uses completeChatJSON.
 */
function mockTwoPassResponse(narrativeText: string, stateChanges: Record<string, unknown> = {}) {
	mockCompleteChat.mockResolvedValue(narrativeText);
	mockCompleteChatJSON.mockResolvedValue(JSON.stringify({ stateChanges }));
}

describe('adventure-turn payload builder', () => {
	beforeEach(() => resetAllMocks());

	it('builds rich history from game state and removes the final user message', async () => {
		mockLoadGameState.mockResolvedValue({ characters: [{ id: 'pc-1', name: 'Hero' }] });
		mockLoadRecentTurns.mockResolvedValue([{ id: 'turn-1' }]);
		mockLoadUnconsumedChat.mockResolvedValue([]);
		mockAssembleGMContext.mockReturnValue([
			{ role: 'system', content: 'system prompt' },
			{ role: 'assistant', content: 'Earlier GM reply' },
			{ role: 'user', content: 'Current player action' }
		]);

		const { buildAdventureTurnPayload } = await import('./adventure-turn');
		const payload = await buildAdventureTurnPayload({
			adventureId: 'adv-1',
			playerAction: 'Cast fireball',
			actorUserId: 'user-1'
		});

		expect(payload).toEqual({
			adventureId: 'adv-1',
			playerAction: 'Cast fireball',
			actorUserId: 'user-1',
			history: [
				{ role: 'system', content: 'system prompt' },
				{ role: 'assistant', content: 'Earlier GM reply' }
			],
			recentChat: []
		});
		expect(mockAssembleGMContext).toHaveBeenCalled();
	});

	it('falls back to a basic system prompt when no game state exists', async () => {
		mockLoadGameState.mockResolvedValue(null);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockLoadUnconsumedChat.mockResolvedValue([]);

		const { buildAdventureTurnPayload } = await import('./adventure-turn');
		const payload = await buildAdventureTurnPayload({
			adventureId: 'adv-2',
			playerAction: 'Look around'
		});

		expect(payload.adventureId).toBe('adv-2');
		expect(payload.actorUserId).toBe('');
		expect(payload.history).toHaveLength(1);
		expect(payload.history[0].role).toBe('system');
		expect(payload.history[0].content).toContain('You are a Game Master');
	});
});

describe('adventure-turn profile resolution', () => {
	it('defaults interactive requests to inline mode and streaming', async () => {
		const { resolveAdventureTurnProfile } = await import('./adventure-turn');
		const profile = resolveAdventureTurnProfile({ purpose: 'interactive-chat', mode: 'inline' });
		expect(profile.mode).toBe('inline');
		expect(profile.stream).toBe(true);
	});

	it('uses background mode for background turns', async () => {
		const { resolveAdventureTurnProfile } = await import('./adventure-turn');
		const profile = resolveAdventureTurnProfile({ purpose: 'background-turn', mode: 'background', model: 'gpt-test' });
		expect(profile).toEqual({
			purpose: 'background-turn',
			mode: 'background',
			model: 'gpt-test',
			stream: false
		});
	});
});

describe('adventure-turn execution', () => {
	it('short-circuits to clarification when a turn is mechanically ambiguous', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		mockLoadGameState.mockResolvedValue({
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Aelar',
					race: 'human',
					classes: [{ name: 'cleric', level: 5, hitDiceRemaining: 5 }],
					classSpells: [{ className: 'cleric', spellcastingAbility: 'wis', cantrips: [], knownSpells: [], preparedSpells: ['cure-wounds'] }],
					pactSlots: [],
					level: 5,
					abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
					hp: 30,
					maxHp: 30,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 3,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['wis', 'cha'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [{ level: 1, current: 4, max: 4 }],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 14,
					inventory: [
						{ id: 'i1', name: 'Potion of Healing', category: 'consumable', description: '', value: 50, quantity: 1, weight: 0.5, rarity: 'common', attunement: false, charges: 1, effectDescription: 'heal' },
						{ id: 'i2', name: 'Greater Potion of Healing', category: 'consumable', description: '', value: 150, quantity: 1, weight: 0.5, rarity: 'uncommon', attunement: false, charges: 1, effectDescription: 'heal more' }
					],
					gold: 0,
					xp: 0,
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
			quests: [],
			partyLocationId: null,
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		const result = await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I heal Bran.',
				actorUserId: 'user-1',
				history: [],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-test', stream: true }
		);

		expect(result.model).toBe('server-executor');
		expect(result.narrativeText).toContain('multiple healing options');
		expect(mockCompleteChat).not.toHaveBeenCalled();
		expect(mockStreamChat).not.toHaveBeenCalled();
		expect(mockNotifyRoom).toHaveBeenCalledTimes(2);
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
		// Verify the turn is marked as a clarification
		const savedTurn = mockPersistTurnAndSaveState.mock.calls[0][1];
		expect(savedTurn.status).toBe('clarification');
	});
});

// ===========================================================================
// Narrator mode (Step 3 + 9) — engine-resolved turns use narrator prompt
// ===========================================================================

describe('adventure-turn narrator mode', () => {
	beforeEach(() => resetAllMocks());

	function makeStateWithPotionUser() {
		return {
			nextTurnNumber: 3,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Aelar',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 15,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
					inventory: [
						{ id: 'i1', name: 'Potion of Healing', category: 'consumable', description: '', value: 50, quantity: 1, weight: 0.5, rarity: 'common', attunement: false, charges: 1, effectDescription: 'Regain 2d4+2 hit points (heal)' }
					],
					gold: 0,
					xp: 0,
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
			locations: [{ id: 'loc-1', name: 'Forest', type: 'wilderness', description: 'Dense trees.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }
		};
	}

	it('uses narrator context for engine-resolved action (use-item) and treats response as plain prose', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockAssembleNarratorContext.mockReturnValue([
			{ role: 'system', content: 'You are the Narrator...' },
			{ role: 'user', content: 'The player said: "I drink the potion"...' }
		]);
		// AI returns plain prose (no JSON) in narrator mode
		mockCompleteChat.mockResolvedValue('You uncork the vial and drink. Warmth spreads through your limbs as wounds knit closed.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		const result = await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drink the potion',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'old gm context' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Should call assembleNarratorContext (NOT use payload.history)
		expect(mockAssembleNarratorContext).toHaveBeenCalled();
		// The AI should receive the narrator messages
		expect(mockCompleteChat).toHaveBeenCalledWith(expect.objectContaining({
			messages: [
				{ role: 'system', content: 'You are the Narrator...' },
				{ role: 'user', content: 'The player said: "I drink the potion"...' }
			]
		}));
		// Response is plain prose — no JSON parsing artifacts
		expect(result.narrativeText).toBe('You uncork the vial and drink. Warmth spreads through your limbs as wounds knit closed.');
	});

	it('broadcasts dice-roll events BEFORE narration', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockAssembleNarratorContext.mockReturnValue([
			{ role: 'system', content: 'narrator' },
			{ role: 'user', content: 'action' }
		]);
		mockCompleteChat.mockResolvedValue('Narration text.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drink the potion',
				actorUserId: 'user-1',
				history: [],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// notifyRoom calls should include dice-roll event(s) before ai:turn:start
		const calls = mockNotifyRoom.mock.calls.map((c: unknown[]) => (c[2] as Record<string, unknown>).type);
		const diceIdx = calls.indexOf('game:dice-roll');
		const turnStartIdx = calls.indexOf('ai:turn:start');
		expect(diceIdx).toBeGreaterThanOrEqual(0);
		expect(turnStartIdx).toBeGreaterThan(diceIdx);
	});

	it('broadcasts typed narrative:start and narrative:end events', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockAssembleNarratorContext.mockReturnValue([
			{ role: 'system', content: 'narrator' },
			{ role: 'user', content: 'action' }
		]);
		mockCompleteChat.mockResolvedValue('A vivid tale.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drink the potion',
				actorUserId: 'user-1',
				history: [],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const calls = mockNotifyRoom.mock.calls;
		const eventTypes = calls.map((c: unknown[]) => (c[2] as Record<string, unknown>).type);
		expect(eventTypes).toContain('narrative:start');
		expect(eventTypes).toContain('narrative:end');

		// narrative:end should include the full text
		const endCall = calls.find((c: unknown[]) => (c[2] as Record<string, unknown>).type === 'narrative:end');
		expect((endCall![2] as Record<string, unknown>).fullText).toBe('A vivid tale.');
	});

	it('broadcasts state-update event after persistence', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockAssembleNarratorContext.mockReturnValue([
			{ role: 'system', content: 'narrator' },
			{ role: 'user', content: 'action' }
		]);
		mockCompleteChat.mockResolvedValue('Healed.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drink the potion',
				actorUserId: 'user-1',
				history: [],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const calls = mockNotifyRoom.mock.calls;
		const stateUpdateCall = calls.find((c: unknown[]) => (c[2] as Record<string, unknown>).type === 'game:state-update');
		expect(stateUpdateCall).toBeDefined();
		const body = stateUpdateCall![2] as Record<string, unknown>;
		expect(body.turnNumber).toBe(3);
		expect(body.changes).toBeDefined();
	});

	it('uses full GM mode for unresolved intents (attack)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You swing your sword at the goblin!', { xpAwarded: [{ characterId: 'pc-1', amount: 25 }] });

		const { executeAdventureTurn } = await import('./adventure-turn');
		const result = await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I attack the goblin',
				actorUserId: 'user-1',
				history: [
					{ role: 'system', content: 'GM system prompt' }
				],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Should NOT call assembleNarratorContext (attack is unresolved by engine)
		expect(mockAssembleNarratorContext).not.toHaveBeenCalled();
		// In two-pass, assembleNarrativeGMContext provides messages to completeChat
		expect(mockAssembleNarrativeGMContext).toHaveBeenCalled();
		// Should return the narrative from Pass 1
		expect(result.narrativeText).toBe('You swing your sword at the goblin!');
	});

	it('broadcasts narrative:error on AI failure', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateWithPotionUser();
		state.characters[0].inventory = []; // no inventory → attack intent (unresolved)
		mockLoadGameState.mockResolvedValue(state);
		mockCompleteChat.mockRejectedValue(new Error('API timeout'));

		const { executeAdventureTurn } = await import('./adventure-turn');
		await expect(executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look around',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		)).rejects.toThrow('API timeout');

		const calls = mockNotifyRoom.mock.calls;
		const errorTypes = calls.map((c: unknown[]) => (c[2] as Record<string, unknown>).type);
		expect(errorTypes).toContain('ai:turn:error');
		expect(errorTypes).toContain('narrative:error');
	});
});

// ===========================================================================
// mergeStateChanges
// ===========================================================================

describe('mergeStateChanges', () => {
	beforeEach(() => resetAllMocks());
	it('combines engine and GM state changes', async () => {
		const { mergeStateChanges } = await import('./adventure-turn');
		const engine = {
			hpChanges: [{ characterId: 'pc-1', oldHp: 20, newHp: 29, reason: 'Potion' }],
			itemsLost: [{ characterId: 'pc-1', itemId: 'i1', quantity: 1 }]
		};
		const gm = {
			xpAwarded: [{ characterId: 'pc-1', amount: 10 }],
			hpChanges: [{ characterId: 'pc-2', oldHp: 30, newHp: 25, reason: 'trap' }]
		};
		const merged = mergeStateChanges(engine, gm);
		expect(merged.hpChanges).toHaveLength(2);
		expect(merged.itemsLost).toHaveLength(1);
		expect(merged.xpAwarded).toHaveLength(1);
	});

	it('engine location takes precedence over GM location', async () => {
		const { mergeStateChanges } = await import('./adventure-turn');
		const engine = { locationChange: { from: 'loc-1', to: 'loc-2' } };
		const gm = { locationChange: { from: 'loc-1', to: 'loc-3' } };
		const merged = mergeStateChanges(engine, gm);
		expect(merged.locationChange!.to).toBe('loc-2');
	});

	it('falls back to GM location when engine has none', async () => {
		const { mergeStateChanges } = await import('./adventure-turn');
		const engine = {};
		const gm = { locationChange: { from: 'loc-1', to: 'loc-3' } };
		const merged = mergeStateChanges(engine, gm);
		expect(merged.locationChange!.to).toBe('loc-3');
	});

	it('merges world-building additions from GM', async () => {
		const { mergeStateChanges } = await import('./adventure-turn');
		const engine = {};
		const gm = {
			npcsAdded: [{ id: 'npc-1', name: 'Barkeep', role: 'merchant' as const, locationId: 'loc-1', disposition: 10, description: 'A gruff barkeep' }],
			locationsAdded: [{ id: 'loc-new', name: 'Back Alley', type: 'interior' as const, description: 'A dark alley', connections: ['loc-1'] }],
			questsAdded: [{ id: 'quest-1', name: 'Find the Ring', description: 'Find it', objectives: [{ id: 'obj-1', text: 'Search the alley' }] }],
			sceneFactsAdded: ['The tavern smells of ale']
		};
		const merged = mergeStateChanges(engine, gm);
		expect(merged.npcsAdded).toHaveLength(1);
		expect(merged.locationsAdded).toHaveLength(1);
		expect(merged.questsAdded).toHaveLength(1);
		expect(merged.sceneFactsAdded).toHaveLength(1);
		expect(merged.npcsAdded![0].name).toBe('Barkeep');
	});
});

// ===========================================================================
// World-building state application (Step 7)
// ===========================================================================

describe('adventure-turn world-building', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('applies npcsAdded to game state from GM response', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A merchant waves you over from his colorful stall.', {
				npcsAdded: [{
					id: 'npc-merchant-1',
					name: 'Gareth the Trader',
					role: 'merchant',
					locationId: 'loc-1',
					disposition: 20,
					description: 'A jovial half-elf with twinkling eyes'
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look around the square',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Check that persistTurnAndSaveState was called with the NPC added
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.npcs).toHaveLength(1);
		expect(savedState.npcs[0].name).toBe('Gareth the Trader');
		expect(savedState.npcs[0].role).toBe('merchant');
		expect(savedState.npcs[0].alive).toBe(true);
	});

	it('applies locationsAdded with bidirectional connections', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You notice a narrow alley between two buildings.', {
				locationsAdded: [{
					id: 'loc-alley-1',
					name: 'Narrow Alley',
					type: 'interior',
					description: 'A shadowy passage between buildings.',
					connections: ['loc-1'],
					features: ['dimly lit', 'trash-strewn']
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I examine the buildings',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// New location should be added
		const newLoc = savedState.locations.find((l: { id: string }) => l.id === 'loc-alley-1');
		expect(newLoc).toBeDefined();
		expect(newLoc.name).toBe('Narrow Alley');
		expect(newLoc.visited).toBe(false);
		expect(newLoc.features).toEqual(['dimly lit', 'trash-strewn']);

		// Bidirectional connection: Town Square should now connect to the alley
		const townSquare = savedState.locations.find((l: { id: string }) => l.id === 'loc-1');
		expect(townSquare.connections).toContain('loc-alley-1');
	});

	it('applies questsAdded to game state', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The old woman tells you about a missing amulet.', {
				questsAdded: [{
					id: 'quest-amulet',
					name: 'The Lost Amulet',
					description: 'Find the missing amulet of the village elder.',
					giverNpcId: null,
					objectives: [
						{ id: 'obj-find', text: 'Search the old ruins for the amulet' },
						{ id: 'obj-return', text: 'Return the amulet to the elder' }
					],
					recommendedLevel: 3
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I talk to the old woman',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.quests).toHaveLength(1);
		expect(savedState.quests[0].name).toBe('The Lost Amulet');
		expect(savedState.quests[0].status).toBe('available');
		expect(savedState.quests[0].objectives).toHaveLength(2);
		expect(savedState.quests[0].objectives[0].done).toBe(false);
	});

	it('broadcasts npc-discovered and location-discovered events', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You discover a hidden path and meet a stranger.', {
				npcsAdded: [{ id: 'npc-str', name: 'Stranger', role: 'neutral', locationId: 'loc-1', disposition: 0, description: 'Hooded figure' }],
				locationsAdded: [{ id: 'loc-path', name: 'Hidden Path', type: 'road', description: 'A hidden path', connections: ['loc-1'] }],
				questsAdded: [{ id: 'quest-path', name: 'Follow the Path', description: 'See where it leads.', objectives: [{ id: 'obj-1', text: 'Follow it' }] }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I search around the area',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const calls = mockNotifyRoom.mock.calls;
		const eventTypes = calls.map((c: unknown[]) => (c[2] as Record<string, unknown>).type);
		expect(eventTypes).toContain('game:npc-discovered');
		expect(eventTypes).toContain('game:location-discovered');
		expect(eventTypes).toContain('game:quest-discovered');
	});

	it('skips duplicate NPC IDs (idempotent)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs.push({
			id: 'npc-existing',
			name: 'Existing NPC',
			role: 'neutral',
			locationId: 'loc-1',
			disposition: 0,
			description: 'Already here',
			notes: '',
			alive: true
		});
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You see the familiar face.', {
				npcsAdded: [{ id: 'npc-existing', name: 'Duplicate NPC', role: 'merchant', locationId: 'loc-1', disposition: 50, description: 'Should not overwrite' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look around',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.npcs).toHaveLength(1);
		expect(savedState.npcs[0].name).toBe('Existing NPC'); // Not overwritten
	});

	it('marks completed turns with status and resolvedActionSummary', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You search the area thoroughly.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look around the room',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedTurn = mockPersistTurnAndSaveState.mock.calls[0][1];
		expect(savedTurn.status).toBe('completed');
		expect(savedTurn.resolvedActionSummary).toBeDefined();
		expect(typeof savedTurn.resolvedActionSummary).toBe('string');
	});

	it('uses atomic persistTurnAndSaveState instead of separate calls', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The market is busy.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I walk through the market',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Atomic: persistTurnAndSaveState called, NOT separate persistTurn + saveGameState
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
		expect(mockPersistTurnAndSaveState.mock.calls[0][0]).toBe('adv-1');
		// Turn is 2nd arg, state is 3rd
		expect(mockPersistTurnAndSaveState.mock.calls[0][1]).toHaveProperty('turnNumber');
		expect(mockPersistTurnAndSaveState.mock.calls[0][2]).toHaveProperty('nextTurnNumber');
	});
});

// ===========================================================================
// Streaming buffer fix (Slice A) — GM mode must NOT stream raw JSON to clients
// ===========================================================================

describe('adventure-turn streaming buffer fix', () => {
	beforeEach(() => resetAllMocks());

	function makeGMState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1',
				name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [],
				level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [],
				spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 },
				inspiration: false, passivePerception: 11,
				inventory: [], gold: 10, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Tavern', type: 'interior', description: 'A warm tavern.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('does NOT broadcast raw JSON chunks in full GM streaming mode', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeGMState();
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);

		// In two-pass, streamChat returns plain prose (not JSON)
		mockStreamChat.mockImplementation(async (_opts: unknown, onChunk: (chunk: string) => Promise<void>) => {
			await onChunk('The tavern ');
			await onChunk('keeper greets ');
			await onChunk('you warmly.');
			return 'The tavern keeper greets you warmly.';
		});
		mockCompleteChatJSON.mockResolvedValue(JSON.stringify({ stateChanges: {} }));

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look around the tavern',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: true }
		);

		// In two-pass architecture, narrative IS prose so chunks ARE streamed
		const chunkCalls = mockNotifyRoom.mock.calls.filter(
			(c: unknown[]) => (c[2] as Record<string, unknown>).type === 'ai:turn:chunk'
		);
		// Chunks should be sent (prose, not JSON)
		expect(chunkCalls.length).toBeGreaterThan(0);

		// But we SHOULD see the parsed narrative in ai:turn:end
		const endCalls = mockNotifyRoom.mock.calls.filter(
			(c: unknown[]) => (c[2] as Record<string, unknown>).type === 'ai:turn:end'
		);
		expect(endCalls).toHaveLength(1);
		expect((endCalls[0][2] as Record<string, unknown>).text).toBe('The tavern keeper greets you warmly.');
	});

	it('DOES stream chunks in narrator mode (plain text response)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeGMState();
		// Give the character a potion so the turn-executor resolves mechanically (narrator mode)
		(state.characters[0].inventory as unknown[]).push({
			id: 'i1', name: 'Potion of Healing', category: 'consumable',
			description: '', value: 50, quantity: 1, weight: 0.5,
			rarity: 'common', attunement: false, charges: 1,
			effectDescription: 'Regain 2d4+2 hit points (heal)'
		});
		state.characters[0].hp = 5; // Damaged so potion is useful
		mockLoadGameState.mockResolvedValue(state);
		mockLoadRecentTurns.mockResolvedValue([]);
		mockAssembleNarratorContext.mockReturnValue([
			{ role: 'system', content: 'You are the Narrator...' },
			{ role: 'user', content: 'action' }
		]);

		const chunks: string[] = [];
		mockStreamChat.mockImplementation(async (_opts: unknown, onChunk: (chunk: string) => Promise<void>) => {
			const textChunks = ['You uncork ', 'the vial ', 'and drink deeply.'];
			for (const chunk of textChunks) {
				chunks.push(chunk);
				await onChunk(chunk);
			}
			return textChunks.join('');
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drink the potion',
				actorUserId: 'user-1',
				history: [],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: true }
		);

		// Narrator mode SHOULD stream chunks through
		const chunkCalls = mockNotifyRoom.mock.calls.filter(
			(c: unknown[]) => (c[2] as Record<string, unknown>).type === 'ai:turn:chunk'
		);
		expect(chunkCalls.length).toBeGreaterThan(0);
	});
});

// ===========================================================================
// Phase 0 — Ordering fix: additions before mutations
// ===========================================================================

describe('Phase 0: applyGMStateChanges ordering — additions before mutations', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('moves party to a location created in the same turn (locationsAdded + locationChange)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You follow the alley and emerge into a hidden courtyard.', {
				locationsAdded: [{
					id: 'loc-courtyard',
					name: 'Hidden Courtyard',
					type: 'settlement',
					description: 'A secluded courtyard behind the buildings.',
					connections: ['loc-1']
				}],
				locationChange: { from: 'loc-1', to: 'loc-courtyard' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I follow the narrow alley',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// The party should have moved to the new location
		expect(savedState.partyLocationId).toBe('loc-courtyard');
		// The new location should be marked as visited
		const courtyard = savedState.locations.find((l: { id: string }) => l.id === 'loc-courtyard');
		expect(courtyard).toBeDefined();
		expect(courtyard.visited).toBe(true);
	});

	it('modifies an NPC created in the same turn (npcsAdded + npcChanges)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A hostile bandit appears and you immediately anger him.', {
				npcsAdded: [{
					id: 'npc-bandit',
					name: 'Scar the Bandit',
					role: 'hostile',
					locationId: 'loc-1',
					disposition: -20,
					description: 'A scarred rogue with a menacing grin'
				}],
				npcChanges: [{
					npcId: 'npc-bandit',
					field: 'disposition',
					newValue: -80
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I insult the stranger',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bandit = savedState.npcs.find((n: NPC) => n.id === 'npc-bandit');
		expect(bandit).toBeDefined();
		// Disposition should be the UPDATED value, not the initial one
		expect(bandit.disposition).toBe(-80);
	});

	it('updates a quest created in the same turn (questsAdded + questUpdates)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The elder asks for help and you immediately find the first clue.', {
				questsAdded: [{
					id: 'quest-elder',
					name: 'Elder\'s Request',
					description: 'Help the village elder.',
					objectives: [
						{ id: 'obj-clue', text: 'Find the first clue' },
						{ id: 'obj-solve', text: 'Solve the mystery' }
					]
				}],
				questUpdates: [
					{ questId: 'quest-elder', field: 'status', newValue: 'active' },
					{ questId: 'quest-elder', field: 'objective', objectiveId: 'obj-clue', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I talk to the village elder',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const quest = savedState.quests.find((q: { id: string }) => q.id === 'quest-elder');
		expect(quest).toBeDefined();
		expect(quest.status).toBe('active');
		expect(quest.objectives[0].done).toBe(true);
		expect(quest.objectives[1].done).toBe(false);
	});
});

// ===========================================================================
// Phase 0 — ID validation: unknown references are skipped with warnings
// ===========================================================================

describe('Phase 0: applyGMStateChanges ID validation', () => {
	beforeEach(() => {
		resetAllMocks();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
					inventory: [
						{ id: 'sword-1', name: 'Iron Sword', category: 'weapon', description: 'A sturdy blade', value: 15, quantity: 1, weight: 3, rarity: 'common', attunement: false }
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
					backstory: ''
				}
			],
			npcs: [
				{ id: 'npc-1', name: 'Guard', role: 'neutral', locationId: 'loc-1', disposition: 0, description: 'A bored guard', notes: '', alive: true }
			] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [
				{
					id: 'quest-1', name: 'Find the Key', description: 'Find the key', status: 'active',
					objectives: [{ id: 'obj-1', text: 'Search the chest', done: false }],
					giverNpcId: null, rewards: { xp: 100, gold: 50, items: [], reputationChanges: [] },
					recommendedLevel: 1, encounterTemplates: []
				}
			],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('skips hpChange with unknown characterId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Something happens.', {
				hpChanges: [{ characterId: 'pc-nonexistent', newHp: 10 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I do something',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Existing character HP should be untouched
		expect(savedState.characters[0].hp).toBe(28);
		// Warning should have been logged
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('hpChange references unknown characterId="pc-nonexistent"')
		);
	});

	it('skips npcChange with unknown npcId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Something happens.', {
				npcChanges: [{ npcId: 'npc-phantom', field: 'alive', newValue: false }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I do something',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Existing NPC should be unchanged
		expect(savedState.npcs[0].alive).toBe(true);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('npcChange references unknown npcId="npc-phantom"')
		);
	});

	it('skips locationChange to unknown location and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You try to go somewhere that doesn\'t exist.', {
				locationChange: { from: 'loc-1', to: 'loc-nowhere' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I teleport',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Party should remain at Town Square
		expect(savedState.partyLocationId).toBe('loc-1');
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('locationChange.to="loc-nowhere" matches no known location')
		);
	});

	it('skips questUpdate with unknown questId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Something happens.', {
				questUpdates: [{ questId: 'quest-phantom', field: 'status', newValue: 'completed' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I do something',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Existing quest should be unchanged
		expect(savedState.quests[0].status).toBe('active');
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('questUpdate references unknown questId="quest-phantom"')
		);
	});

	it('skips itemsLost with unknown characterId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Something is lost.', {
				itemsLost: [{ characterId: 'pc-nonexistent', itemId: 'sword-1' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drop my sword',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// The real character's inventory should be unchanged
		expect(savedState.characters[0].inventory).toHaveLength(1);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('itemsLost references unknown characterId="pc-nonexistent"')
		);
	});

	it('skips itemsLost with unknown itemId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You try to discard something you don\'t have.', {
				itemsLost: [{ characterId: 'pc-1', itemId: 'phantom-item' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I drop the thing',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// The sword should still be in inventory
		expect(savedState.characters[0].inventory).toHaveLength(1);
		expect(savedState.characters[0].inventory[0].id).toBe('sword-1');
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('itemsLost references unknown itemId="phantom-item"')
		);
	});

	it('skips xpAwarded with unknown characterId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Experience is gained.', {
				xpAwarded: [{ characterId: 'pc-nonexistent', amount: 100 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I do something',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Real character should have 0 xp still
		expect(savedState.characters[0].xp).toBe(0);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('xpAwarded references unknown characterId="pc-nonexistent"')
		);
	});

	it('skips conditionsApplied with unknown characterId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A condition is applied.', {
				conditionsApplied: [{ characterId: 'pc-ghost', condition: 'poisoned', applied: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I breathe the gas',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.characters[0].conditions).toEqual([]);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('conditionsApplied references unknown characterId="pc-ghost"')
		);
	});

	it('skips itemsGained with unknown characterId and warns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You find treasure.', {
				itemsGained: [{
					characterId: 'pc-nonexistent',
					item: { id: 'gem-1', name: 'Ruby', category: 'treasure', description: 'A red gem', value: 100, quantity: 1, weight: 0.1, rarity: 'uncommon', attunement: false }
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I look for treasure',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Real character should not have the gem
		expect(savedState.characters[0].inventory).toHaveLength(1); // only the original sword
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('itemsGained references unknown characterId="pc-nonexistent"')
		);
	});
});

// ===========================================================================
// Phase 0 — Scene facts: persistence, dedup, FIFO cap
// ===========================================================================

describe('Phase 0: scene facts persistence', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: [] as string[]
		};
	}

	it('accumulates sceneFactsAdded into state.sceneFacts', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The tavern keeper tells you important news.', {
				sceneFactsAdded: [
					'The tavern keeper mentioned a dragon to the north',
					'The bridge is closed for repairs'
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I talk to the barkeep',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.sceneFacts).toEqual([
			'The tavern keeper mentioned a dragon to the north',
			'The bridge is closed for repairs'
		]);
	});

	it('deduplicates scene facts', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.sceneFacts = ['The tavern keeper mentioned a dragon to the north'];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You hear the same story again.', {
				sceneFactsAdded: [
					'The tavern keeper mentioned a dragon to the north',
					'A new fact arrives'
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I ask about the dragon again',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.sceneFacts).toEqual([
			'The tavern keeper mentioned a dragon to the north',
			'A new fact arrives'
		]);
	});

	it('applies FIFO cap at 50 scene facts', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// Pre-fill with 49 facts
		state.sceneFacts = Array.from({ length: 49 }, (_, i) => `Fact number ${i + 1}`);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('More facts emerge.', {
				sceneFactsAdded: [
					'Fact number 50',
					'Fact number 51',
					'Fact number 52'
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I learn more',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.sceneFacts).toHaveLength(50);
		// Oldest facts should have been evicted (FIFO)
		expect(savedState.sceneFacts[0]).toBe('Fact number 3');
		expect(savedState.sceneFacts[49]).toBe('Fact number 52');
	});
});

// ===========================================================================
// Phase 2: Companion System — applyGMStateChanges
// ===========================================================================

describe('Phase 2: companionPromoted state change', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	function makeStatBlock() {
		return {
			hp: 30,
			maxHp: 35,
			ac: 15,
			abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
			speed: 30,
			cr: 2,
			attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }],
			savingThrows: [],
			skills: [],
			resistances: [],
			immunities: [],
			vulnerabilities: [],
			traits: [],
			actions: [],
			legendaryActions: []
		};
	}

	it('promotes an existing NPC to companion role with a stat block', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-bjorik',
			name: 'Bjorik',
			role: 'ally',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A burly warrior',
			notes: '',
			alive: true
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bjorik pledges his axe to your cause.', {
				companionPromoted: {
					npcId: 'npc-bjorik',
					statBlock: makeStatBlock()
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I recruit Bjorik',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-bjorik');
		expect(bjorik).toBeDefined();
		expect(bjorik.role).toBe('companion');
		expect(bjorik.statBlock).toBeDefined();
		expect(bjorik.statBlock.hp).toBe(30);
		expect(bjorik.statBlock.maxHp).toBe(35);
		expect(bjorik.statBlock.ac).toBe(15);
		expect(bjorik.statBlock.attacks).toHaveLength(1);
	});

	it('moves promoted companion to party location', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-far',
			name: 'Distant Warrior',
			role: 'neutral',
			locationId: 'loc-somewhere-else',
			disposition: 40,
			description: 'A warrior from afar',
			notes: '',
			alive: true
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The warrior agrees to join you.', {
				companionPromoted: {
					npcId: 'npc-far',
					statBlock: makeStatBlock()
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I recruit the warrior',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const npc = savedState.npcs.find((n: NPC) => n.id === 'npc-far');
		expect(npc.role).toBe('companion');
		expect(npc.locationId).toBe('loc-1'); // Moved to party location
	});

	it('skips companionPromoted for unknown NPC ID', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockTwoPassResponse('Nothing happens.', {
				companionPromoted: {
					npcId: 'npc-nonexistent',
					statBlock: makeStatBlock()
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I recruit ghost',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('companionPromoted references unknown npcId')
		);
		warnSpy.mockRestore();
	});

	it('can promote an NPC created via npcsAdded in the same turn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A ranger emerges and joins your quest.', {
				npcsAdded: [{
					id: 'npc-ranger',
					name: 'Elara',
					role: 'ally',
					locationId: 'loc-1',
					disposition: 50,
					description: 'An elven ranger'
				}],
				companionPromoted: {
					npcId: 'npc-ranger',
					statBlock: makeStatBlock()
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I talk to the ranger',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const ranger = savedState.npcs.find((n: NPC) => n.id === 'npc-ranger');
		expect(ranger).toBeDefined();
		expect(ranger.role).toBe('companion');
		expect(ranger.statBlock).toBeDefined();
	});
});

describe('Phase 2: auto-move companions on locationChange', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: ['loc-2'], npcs: [], regionRef: null, visited: true },
				{ id: 'loc-2', name: 'Dark Forest', type: 'wilderness', description: 'Dense woods.', features: [], connections: ['loc-1'], npcs: [], regionRef: null, visited: false }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('moves companion NPCs when party changes location', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 30, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2,
				attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }],
				savingThrows: [], skills: [], resistances: [], immunities: [],
				vulnerabilities: [], traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You venture into the dark forest.', {
				locationChange: { from: 'loc-1', to: 'loc-2' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I travel to the forest',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.partyLocationId).toBe('loc-2');
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-comp');
		expect(bjorik.locationId).toBe('loc-2'); // Auto-moved
	});

	it('does NOT auto-move non-companion NPCs on locationChange', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [
			{
				id: 'npc-merchant',
				name: 'Shopkeeper',
				role: 'merchant',
				locationId: 'loc-1',
				disposition: 30,
				description: 'A friendly shopkeeper',
				notes: '',
				alive: true
			},
			{
				id: 'npc-ally',
				name: 'Local Guard',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 40,
				description: 'Town guard',
				notes: '',
				alive: true
			}
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You head into the woods.', {
				locationChange: { from: 'loc-1', to: 'loc-2' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I go to the forest',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Merchant should stay at loc-1
		expect(savedState.npcs.find((n: NPC) => n.id === 'npc-merchant').locationId).toBe('loc-1');
		// Ally should stay at loc-1 (only 'companion' role auto-moves)
		expect(savedState.npcs.find((n: NPC) => n.id === 'npc-ally').locationId).toBe('loc-1');
	});

	it('does NOT auto-move dead companions on locationChange', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-dead-comp',
			name: 'Fallen Companion',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A fallen warrior',
			notes: '',
			alive: false
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You leave the fallen behind.', {
				locationChange: { from: 'loc-1', to: 'loc-2' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I travel to forest',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Dead companion should stay where they fell
		expect(savedState.npcs.find((n: NPC) => n.id === 'npc-dead-comp').locationId).toBe('loc-1');
	});

	it('moves multiple companions simultaneously on locationChange', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [
			{
				id: 'npc-comp1', name: 'Companion A', role: 'companion',
				locationId: 'loc-1', disposition: 50, description: 'A', notes: '', alive: true
			},
			{
				id: 'npc-comp2', name: 'Companion B', role: 'companion',
				locationId: 'loc-1', disposition: 40, description: 'B', notes: '', alive: true
			}
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The party marches on.', {
				locationChange: { from: 'loc-1', to: 'loc-2' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'We travel to the forest',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		expect(savedState.npcs.find((n: NPC) => n.id === 'npc-comp1').locationId).toBe('loc-2');
		expect(savedState.npcs.find((n: NPC) => n.id === 'npc-comp2').locationId).toBe('loc-2');
	});
});

describe('Phase 2: companions in encounterStarted', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [] as string[], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('includes companion NPC as combatant when encounter starts', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 30, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2,
				attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }],
				savingThrows: [], skills: [],
				resistances: ['fire'], immunities: ['poison'],
				vulnerabilities: [], traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bandits attack!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-bandit-1',
						name: 'Bandit',
						role: 'hostile',
						locationId: 'loc-1',
						disposition: -100,
						description: 'A dangerous bandit'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'I draw my sword',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		expect(enc).toBeDefined();
		expect(enc.status).toBe('active');

		// Should have: pc-1 (character), npc-comp (companion), npc-bandit-1 (hostile)
		expect(enc.combatants).toHaveLength(3);

		// Check companion combatant uses stat block values
		const compCombatant = enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'npc-comp');
		expect(compCombatant).toBeDefined();
		expect(compCombatant.name).toBe('Bjorik');
		expect(compCombatant.type).toBe('npc');
		expect(compCombatant.currentHp).toBe(30);
		expect(compCombatant.maxHp).toBe(35);
		expect(compCombatant.ac).toBe(15);
		expect(compCombatant.resistances).toContain('fire');
		expect(compCombatant.immunities).toContain('poison');

		// Check party character is still there
		const pcCombatant = enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'pc-1');
		expect(pcCombatant).toBeDefined();
		expect(pcCombatant.type).toBe('character');

		// Check hostile creature is there
		const banditCombatant = enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'npc-bandit-1');
		expect(banditCombatant).toBeDefined();
		expect(banditCombatant.type).toBe('npc');
	});

	it('does NOT include companion without stat block as combatant', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-nostat',
			name: 'Guide',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 50,
			description: 'A guide with no combat stats',
			notes: '',
			alive: true
			// No statBlock
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Wolves attack!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-wolf-1', name: 'Wolf', role: 'hostile',
						locationId: 'loc-1', disposition: -100, description: 'A snarling wolf'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Defend!',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		// Only PC + wolf, no companion without stat block
		expect(enc.combatants).toHaveLength(2);
		expect(enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'npc-nostat')).toBeUndefined();
	});

	it('does NOT include dead companion as combatant', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-dead',
			name: 'Fallen Companion',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'Dead',
			notes: '',
			alive: false,
			statBlock: {
				hp: 0, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A goblin leaps from the shadows and attacks! Roll for initiative!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-goblin', name: 'Goblin', role: 'hostile',
						locationId: 'loc-1', disposition: -100, description: 'A goblin'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Fight!',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		expect(enc.combatants).toHaveLength(2); // Just PC + goblin
		expect(enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'npc-dead')).toBeUndefined();
	});

	it('does NOT include companion at a different location as combatant', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.locations.push({
			id: 'loc-2', name: 'Forest', type: 'wilderness', description: 'Woods.',
			features: [], connections: ['loc-1'] as string[], npcs: [], regionRef: null, visited: false
		});
		state.npcs = [{
			id: 'npc-away',
			name: 'Away Companion',
			role: 'companion',
			locationId: 'loc-2', // Different location
			disposition: 60,
			description: 'Far away',
			notes: '',
			alive: true,
			statBlock: {
				hp: 30, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Skeletons rise from the ground and attack! Roll for initiative!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-skeleton', name: 'Skeleton', role: 'hostile',
						locationId: 'loc-1', disposition: -100, description: 'Undead'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Fight!',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		expect(enc.combatants).toHaveLength(2); // Just PC + skeleton
	});
});

describe('Phase 2: companion HP tracking via npcChanges', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
					classSpells: [],
					pactSlots: [],
					level: 3,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 28,
					maxHp: 28,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 2,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
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
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('applies HP damage to companion stat block via npcChanges field=hp', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 30, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2,
				attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }],
				savingThrows: [], skills: [], resistances: [], immunities: [],
				vulnerabilities: [], traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bjorik takes a hit!', {
				npcChanges: [{
					npcId: 'npc-comp',
					field: 'hp',
					oldValue: 30,
					newValue: 22
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'We fight on',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-comp');
		expect(bjorik.statBlock.hp).toBe(22);
	});

	it('clamps companion HP to 0 (no negative HP)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 5, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bjorik falls!', {
				npcChanges: [{
					npcId: 'npc-comp',
					field: 'hp',
					oldValue: 5,
					newValue: -10
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Continue fighting',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-comp');
		expect(bjorik.statBlock.hp).toBe(0); // Clamped to 0
	});

	it('clamps companion HP to maxHp (no over-healing)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 30, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bjorik is healed!', {
				npcChanges: [{
					npcId: 'npc-comp',
					field: 'hp',
					oldValue: 30,
					newValue: 50
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Heal Bjorik',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-comp');
		expect(bjorik.statBlock.hp).toBe(35); // Clamped to maxHp
	});

	it('ignores HP change for NPC without stat block', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-nostat',
			name: 'Guide',
			role: 'ally',
			locationId: 'loc-1',
			disposition: 50,
			description: 'A guide',
			notes: '',
			alive: true
			// No statBlock
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The guide is hurt.', {
				npcChanges: [{
					npcId: 'npc-nostat',
					field: 'hp',
					oldValue: 10,
					newValue: 5
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'Check on guide',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const guide = savedState.npcs.find((n: NPC) => n.id === 'npc-nostat');
		// No stat block, so HP change silently has no effect; NPC still intact
		expect(guide.statBlock).toBeUndefined();
		expect(guide.alive).toBe(true);
	});

	it('can combine HP change and alive=false in the same turn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-comp',
			name: 'Bjorik',
			role: 'companion',
			locationId: 'loc-1',
			disposition: 60,
			description: 'A warrior',
			notes: '',
			alive: true,
			statBlock: {
				hp: 5, maxHp: 35, ac: 15,
				abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
				speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Bjorik falls in battle, slain by the dragon.', {
				npcChanges: [
					{ npcId: 'npc-comp', field: 'hp', oldValue: 5, newValue: 0 },
					{ npcId: 'npc-comp', field: 'alive', oldValue: true, newValue: false }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{
				adventureId: 'adv-1',
				playerAction: 'The dragon attacks',
				actorUserId: 'user-1',
				history: [{ role: 'system', content: 'GM prompt' }],
				recentChat: []
			},
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bjorik = savedState.npcs.find((n: NPC) => n.id === 'npc-comp');
		expect(bjorik.statBlock.hp).toBe(0);
		expect(bjorik.alive).toBe(false);
	});
});

// ===========================================================================
// Phase 3 — NPC Memory & Lifecycle (adventure-turn side)
// ===========================================================================

describe('Phase 3: lastInteractionTurn tracking', () => {
	beforeEach(() => {
		vi.resetModules();
		resetAllMocks();
	});

	function makeBaseState() {
		return {
			nextTurnNumber: 5,
			turnLog: [],
			characters: [
				{
					id: 'pc-1', userId: 'user-1', adventureId: 'adv-1',
					name: 'Hero', race: 'human',
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
					stable: false, dead: false, featureUses: {}, attunedItems: [],
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('npcsAdded sets lastInteractionTurn to current turn number', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 7;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A merchant appears.', {
				npcsAdded: [{
					id: 'npc-m', name: 'Trader', role: 'merchant',
					locationId: 'loc-1', disposition: 20,
					description: 'A trader'
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Look', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const trader = saved.npcs.find((n: NPC) => n.id === 'npc-m');
		expect(trader.lastInteractionTurn).toBe(7);
	});

	it('npcChanges sets lastInteractionTurn on modified NPC', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 10;
		state.npcs = [{
			id: 'npc-a', name: 'Aldric', role: 'ally', locationId: 'loc-1',
			disposition: 30, description: 'A knight', notes: '', alive: true,
			lastInteractionTurn: 2
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Aldric nods.', {
				npcChanges: [{ npcId: 'npc-a', field: 'disposition', oldValue: 30, newValue: 50 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Talk', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const aldric = saved.npcs.find((n: NPC) => n.id === 'npc-a');
		expect(aldric.lastInteractionTurn).toBe(10);
		expect(aldric.disposition).toBe(50);
	});

	it('companionPromoted sets lastInteractionTurn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 4;
		state.npcs = [{
			id: 'npc-k', name: 'Kira', role: 'ally', locationId: 'loc-1',
			disposition: 60, description: 'A ranger', notes: '', alive: true,
			lastInteractionTurn: 1
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Kira joins the party permanently.', {
				companionPromoted: {
					npcId: 'npc-k',
					statBlock: {
						hp: 25, maxHp: 25, ac: 14,
						abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 14, cha: 10 },
						speed: 30, cr: 2, attacks: [], savingThrows: [], skills: [],
						resistances: [], immunities: [], vulnerabilities: [],
						traits: [], actions: [], legendaryActions: []
					}
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Recruit Kira', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const kira = saved.npcs.find((n: NPC) => n.id === 'npc-k');
		expect(kira.lastInteractionTurn).toBe(4);
		expect(kira.role).toBe('companion');
	});

	it('encounterStarted sets lastInteractionTurn on new creature NPCs', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 8;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Goblins attack!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-gob1', name: 'Goblin Scout',
						role: 'hostile', disposition: -100,
						description: 'A sneaky goblin'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Walk into cave', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const goblin = saved.npcs.find((n: NPC) => n.id === 'npc-gob1');
		expect(goblin).toBeDefined();
		expect(goblin.lastInteractionTurn).toBe(8);
	});

	it('encounterStarted updates lastInteractionTurn on existing creature NPCs', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 12;
		state.npcs = [{
			id: 'npc-bandit', name: 'Bandit Leader', role: 'hostile', locationId: 'loc-1',
			disposition: -80, description: 'A scarred bandit', notes: '', alive: true,
			lastInteractionTurn: 3
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The bandit leader attacks again!', {
				encounterStarted: {
					creatures: [{
						id: 'npc-bandit', name: 'Bandit Leader',
						role: 'hostile', disposition: -80,
						description: 'A scarred bandit'
					}]
				}
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Fight', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const bandit = saved.npcs.find((n: NPC) => n.id === 'npc-bandit');
		expect(bandit.lastInteractionTurn).toBe(12);
	});

	it('narrative text mentioning NPC full name updates lastInteractionTurn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 6;
		state.npcs = [{
			id: 'npc-sage', name: 'Elder Sage', role: 'quest-giver', locationId: 'loc-1',
			disposition: 40, description: 'An old sage', notes: '', alive: true,
			lastInteractionTurn: 1
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You recall the words of Elder Sage about the prophecy.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Think about the prophecy', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const sage = saved.npcs.find((n: NPC) => n.id === 'npc-sage');
		expect(sage.lastInteractionTurn).toBe(6);
	});

	it('narrative text mentioning NPC first name (>=3 chars) updates lastInteractionTurn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 9;
		state.npcs = [{
			id: 'npc-gar', name: 'Gareth the Brave', role: 'ally', locationId: 'loc-1',
			disposition: 50, description: 'A brave warrior', notes: '', alive: true,
			lastInteractionTurn: 2
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You see Gareth fighting in the distance.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const gareth = saved.npcs.find((n: NPC) => n.id === 'npc-gar');
		expect(gareth.lastInteractionTurn).toBe(9);
	});
});

describe('Phase 3: interactionNotes tracking', () => {
	beforeEach(() => {
		vi.resetModules();
		resetAllMocks();
	});

	function makeBaseState() {
		return {
			nextTurnNumber: 5,
			turnLog: [],
			characters: [
				{
					id: 'pc-1', userId: 'user-1', adventureId: 'adv-1',
					name: 'Hero', race: 'human',
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
					stable: false, dead: false, featureUses: {}, attunedItems: [],
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('npcChanges field "notes" creates interactionNote entry', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 3;
		state.npcs = [{
			id: 'npc-x', name: 'Xara', role: 'merchant', locationId: 'loc-1',
			disposition: 20, description: 'A merchant', notes: '', alive: true
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Xara offers a deal.', {
				npcChanges: [{
					npcId: 'npc-x', field: 'notes',
					oldValue: '', newValue: 'Offered 50gp discount on enchanted sword'
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Haggle', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const xara = saved.npcs.find((n: NPC) => n.id === 'npc-x');
		expect(xara.interactionNotes).toHaveLength(1);
		expect(xara.interactionNotes[0].turn).toBe(3);
		expect(xara.interactionNotes[0].note).toBe('Offered 50gp discount on enchanted sword');
	});

	it('npcChanges "notes" caps at 10 per NPC (FIFO)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 15;
		// Pre-fill with 10 existing notes
		const existingNotes = Array.from({ length: 10 }, (_, i) => ({
			turn: i + 1,
			note: `Old note ${i + 1}`
		}));
		state.npcs = [{
			id: 'npc-y', name: 'Yoren', role: 'ally', locationId: 'loc-1',
			disposition: 40, description: 'A soldier', notes: '', alive: true,
			interactionNotes: existingNotes
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Yoren shares a secret.', {
				npcChanges: [{
					npcId: 'npc-y', field: 'notes',
					oldValue: '', newValue: 'Revealed location of hidden treasure'
				}]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Ask Yoren', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const yoren = saved.npcs.find((n: NPC) => n.id === 'npc-y');
		expect(yoren.interactionNotes).toHaveLength(10);
		// First note evicted, last note is the new one
		expect(yoren.interactionNotes[0].note).toBe('Old note 2');
		expect(yoren.interactionNotes[9].note).toBe('Revealed location of hidden treasure');
		expect(yoren.interactionNotes[9].turn).toBe(15);
	});

	it('sceneFactsAdded auto-routes to NPC interactionNotes when fact mentions NPC', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 6;
		state.npcs = [{
			id: 'npc-z', name: 'Zara the Wise', role: 'quest-giver', locationId: 'loc-1',
			disposition: 50, description: 'A sage', notes: '', alive: true
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The sage speaks prophecy.', {
				sceneFactsAdded: ['Zara revealed the location of the Silver Key']
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Ask about the key', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const zara = saved.npcs.find((n: NPC) => n.id === 'npc-z');
		expect(zara.interactionNotes).toHaveLength(1);
		expect(zara.interactionNotes[0].note).toBe('Zara revealed the location of the Silver Key');
		expect(zara.interactionNotes[0].turn).toBe(6);
		expect(zara.lastInteractionTurn).toBe(6);
	});

	it('sceneFactsAdded does not route to NPCs not mentioned in the fact', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 4;
		state.npcs = [
			{
				id: 'npc-a1', name: 'Aldric', role: 'ally', locationId: 'loc-1',
				disposition: 30, description: 'A knight', notes: '', alive: true
			},
			{
				id: 'npc-b1', name: 'Benna', role: 'merchant', locationId: 'loc-1',
				disposition: 20, description: 'A merchant', notes: '', alive: true
			}
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The party learns something.', {
				sceneFactsAdded: ['Aldric knows the password to the gate']
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Ask about gate', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const aldric = saved.npcs.find((n: NPC) => n.id === 'npc-a1');
		const benna = saved.npcs.find((n: NPC) => n.id === 'npc-b1');
		// Aldric mentioned → gets the note
		expect(aldric.interactionNotes).toHaveLength(1);
		// Benna not mentioned → no notes
		expect(benna.interactionNotes ?? []).toHaveLength(0);
	});

	it('multiple NPCs receive the same scene fact if both are mentioned', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 2;
		state.npcs = [
			{
				id: 'npc-c1', name: 'Cael', role: 'ally', locationId: 'loc-1',
				disposition: 30, description: 'A rogue', notes: '', alive: true
			},
			{
				id: 'npc-d1', name: 'Dara', role: 'ally', locationId: 'loc-1',
				disposition: 40, description: 'A mage', notes: '', alive: true
			}
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Cael and Dara argue.', {
				sceneFactsAdded: ['Cael and Dara agreed to a truce']
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Mediate', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const cael = saved.npcs.find((n: NPC) => n.id === 'npc-c1');
		const dara = saved.npcs.find((n: NPC) => n.id === 'npc-d1');
		expect(cael.interactionNotes).toHaveLength(1);
		expect(dara.interactionNotes).toHaveLength(1);
		expect(cael.interactionNotes[0].note).toBe('Cael and Dara agreed to a truce');
		expect(dara.interactionNotes[0].note).toBe('Cael and Dara agreed to a truce');
	});
});

describe('Phase 3: NPC archival', () => {
	beforeEach(() => {
		vi.resetModules();
		resetAllMocks();
	});

	function makeBaseState() {
		return {
			nextTurnNumber: 30,
			turnLog: [],
			characters: [
				{
					id: 'pc-1', userId: 'user-1', adventureId: 'adv-1',
					name: 'Hero', race: 'human',
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
					stable: false, dead: false, featureUses: {}, attunedItems: [],
					backstory: ''
				}
			],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Town Square', type: 'settlement', description: 'A bustling square.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('archives dead NPC when 20+ turns have passed since last interaction', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 30;
		state.npcs = [{
			id: 'npc-dead', name: 'FallenGuard', role: 'neutral', locationId: 'loc-1',
			disposition: 0, description: 'A dead guard', notes: '', alive: false,
			lastInteractionTurn: 5 // 30 - 5 = 25 > 20
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The square is quiet.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const guard = saved.npcs.find((n: NPC) => n.id === 'npc-dead');
		expect(guard.archived).toBe(true);
	});

	it('does NOT archive living NPC even after 20+ turns', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 30;
		state.npcs = [{
			id: 'npc-alive', name: 'OldMerchant', role: 'merchant', locationId: 'loc-1',
			disposition: 10, description: 'A merchant', notes: '', alive: true,
			lastInteractionTurn: 3 // 30 - 3 = 27 > 20 but alive
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Things are calm.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Wait', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const merchant = saved.npcs.find((n: NPC) => n.id === 'npc-alive');
		expect(merchant.archived).toBeUndefined();
	});

	it('does NOT archive dead NPC with recent interaction (within 20 turns)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 25;
		state.npcs = [{
			id: 'npc-recent-dead', name: 'RecentlySlain', role: 'hostile', locationId: 'loc-1',
			disposition: -100, description: 'A recently slain foe', notes: '', alive: false,
			lastInteractionTurn: 15 // 25 - 15 = 10 < 20
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The area is peaceful now.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Rest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const slain = saved.npcs.find((n: NPC) => n.id === 'npc-recent-dead');
		expect(slain.archived).toBeUndefined();
	});

	it('does NOT archive dead NPC without lastInteractionTurn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 50;
		state.npcs = [{
			id: 'npc-no-track', name: 'AncientCorpse', role: 'neutral', locationId: 'loc-1',
			disposition: 0, description: 'An old corpse', notes: '', alive: false
			// No lastInteractionTurn
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Nothing happens.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Wait', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const corpse = saved.npcs.find((n: NPC) => n.id === 'npc-no-track');
		expect(corpse.archived).toBeUndefined();
	});

	it('already archived NPC stays archived (idempotent)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.nextTurnNumber = 40;
		state.npcs = [{
			id: 'npc-already', name: 'AlreadyArchived', role: 'hostile', locationId: 'loc-1',
			disposition: -100, description: 'An archived foe', notes: '', alive: false,
			lastInteractionTurn: 5,
			archived: true
		}];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Silence.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Wait', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const npc = saved.npcs.find((n: NPC) => n.id === 'npc-already');
		expect(npc.archived).toBe(true);
	});
});

// ===========================================================================
// Phase 4 — World Enrichment Wiring
//
// Verifies that game-state changes correctly trigger background enrichment
// tasks and that the cadence-based react-to-party fires on schedule.
// ===========================================================================

describe('Phase 4: enrichment intent — settlement expansion', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 3,
			turnLog: [],
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
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-town', name: 'Millhaven', type: 'settlement', description: 'A sleepy fishing town.', features: ['Wooden docks'], connections: ['loc-forest'], npcs: [], regionRef: null, visited: false },
				{ id: 'loc-forest', name: 'Darkwood', type: 'wilderness', description: 'Dense ancient forest.', features: [], connections: ['loc-town'], npcs: [], regionRef: null, visited: false }
			],
			quests: [],
			partyLocationId: 'loc-forest',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('dispatches expand-settlement when party visits a settlement with fewer than 3 NPCs', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// 1 NPC in town — below threshold of 3
		state.npcs = [
			{ id: 'npc-fisher', name: 'Old Fisher', role: 'neutral', locationId: 'loc-town', disposition: 10, description: 'An elderly fisherman.', notes: '', alive: true }
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You arrive at the quiet fishing town of Millhaven.', {
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I head to town', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-town'
		});
	});

	it('dispatches expand-settlement for a settlement with 0 NPCs', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// No NPCs at all
		state.npcs = [];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The town seems eerily deserted.', {
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Walk to Millhaven', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-town'
		});
	});

	it('does NOT dispatch expand-settlement for settlement with 3+ alive NPCs', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [
			{ id: 'npc-1', name: 'Fisher', role: 'neutral', locationId: 'loc-town', disposition: 10, description: 'A fisherman.', notes: '', alive: true },
			{ id: 'npc-2', name: 'Baker', role: 'merchant', locationId: 'loc-town', disposition: 20, description: 'The baker.', notes: '', alive: true },
			{ id: 'npc-3', name: 'Guard', role: 'neutral', locationId: 'loc-town', disposition: 0, description: 'A guard.', notes: '', alive: true }
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The town is lively.', {
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Enter Millhaven', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Should NOT have triggered expand-settlement
		const expandCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-expand-settlement'
		);
		expect(expandCalls).toHaveLength(0);
	});

	it('does NOT dispatch expand-settlement for non-settlement locations', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.partyLocationId = 'loc-town';
		state.npcs = [];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You leave town and enter the dark forest.', {
				locationChange: { from: 'loc-town', to: 'loc-forest' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Head into the forest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const expandCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-expand-settlement'
		);
		expect(expandCalls).toHaveLength(0);
	});

	it('only counts alive NPCs — dead NPCs do not prevent expansion trigger', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [
			{ id: 'npc-1', name: 'Living Guard', role: 'neutral', locationId: 'loc-town', disposition: 10, description: 'A guard.', notes: '', alive: true },
			{ id: 'npc-2', name: 'Dead Merchant', role: 'merchant', locationId: 'loc-town', disposition: 20, description: 'A slain merchant.', notes: '', alive: false },
			{ id: 'npc-3', name: 'Dead Thief', role: 'hostile', locationId: 'loc-town', disposition: -50, description: 'A slain thief.', notes: '', alive: false }
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The town has suffered losses.', {
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Return to Millhaven', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Only 1 alive NPC — should trigger expansion
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-town'
		});
	});

	it('only counts NPCs at the destination location', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// 5 alive NPCs but all at loc-forest, none at loc-town
		state.npcs = [
			{ id: 'npc-1', name: 'A', role: 'neutral', locationId: 'loc-forest', disposition: 0, description: '', notes: '', alive: true },
			{ id: 'npc-2', name: 'B', role: 'neutral', locationId: 'loc-forest', disposition: 0, description: '', notes: '', alive: true },
			{ id: 'npc-3', name: 'C', role: 'neutral', locationId: 'loc-forest', disposition: 0, description: '', notes: '', alive: true },
			{ id: 'npc-4', name: 'D', role: 'neutral', locationId: 'loc-forest', disposition: 0, description: '', notes: '', alive: true },
			{ id: 'npc-5', name: 'E', role: 'neutral', locationId: 'loc-forest', disposition: 0, description: '', notes: '', alive: true }
		];
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You reach the empty town.', {
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Go to town', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// 0 NPCs at loc-town — should trigger expansion
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-town'
		});
	});

	it('still triggers expansion when GM adds NPCs in the same response as locationChange', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [];  // Start with zero NPCs
		mockLoadGameState.mockResolvedValue(state);
		// GM adds 3 NPCs AND moves to town in the same turn
		mockTwoPassResponse('You arrive at the bustling settlement.', {
				npcsAdded: [
					{ id: 'npc-a', name: 'Baker', role: 'merchant', locationId: 'loc-town', disposition: 15, description: 'The town baker.' },
					{ id: 'npc-b', name: 'Smith', role: 'merchant', locationId: 'loc-town', disposition: 10, description: 'The blacksmith.' },
					{ id: 'npc-c', name: 'Mayor', role: 'quest-giver', locationId: 'loc-town', disposition: 20, description: 'The town mayor.' }
				],
				locationChange: { from: 'loc-forest', to: 'loc-town' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Travel to Millhaven', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Enrichment still fires — background expansion adds variety even if
		// the GM already introduced some NPCs.  The enrichment task will
		// deduplicate on the server side and only add genuinely new content.
		const expandCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-expand-settlement'
		);
		expect(expandCalls).toHaveLength(1);
		expect(expandCalls[0][1]).toEqual({
			adventureId: 'adv-1',
			locationId: 'loc-town'
		});
	});
});

describe('Phase 4: enrichment intent — quest arc extension', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			nextTurnNumber: 6,
			turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
				classSpells: [], pactSlots: [], level: 5,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 40, maxHp: 40, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 3, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 11, inventory: [], gold: 100, xp: 300,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [
				{ id: 'npc-elder', name: 'Elder Maren', role: 'quest-giver', locationId: 'loc-1',
				  disposition: 30, description: 'The village elder.', notes: '', alive: true }
			],
			locations: [
				{ id: 'loc-1', name: 'Village', type: 'settlement', description: 'A quiet village.',
				  features: [], connections: [], npcs: ['npc-elder'], regionRef: null, visited: true }
			],
			quests: [{
				id: 'quest-wolves',
				name: 'Wolves at the Gate',
				description: 'Drive off the wolf pack threatening the village.',
				giverNpcId: 'npc-elder',
				status: 'active',
				objectives: [
					{ id: 'obj-track', text: 'Track the wolf pack', done: true },
					{ id: 'obj-defeat', text: 'Defeat the alpha wolf', done: false }
				],
				rewards: { xp: 200, gold: 50, items: [], reputationChanges: [] },
				recommendedLevel: 3,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-1',
			clock: { day: 3, timeOfDay: 'afternoon', weather: 'overcast' },
			sceneFacts: []
		};
	}

	it('dispatches extend-quest-arc when last objective is completed (auto-complete)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('With a mighty blow, you fell the alpha wolf! The pack scatters into the forest.', {
				questUpdates: [
					{ questId: 'quest-wolves', field: 'objective', objectiveId: 'obj-defeat', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I strike the alpha wolf', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-extend-quest-arc', {
			adventureId: 'adv-1',
			questId: 'quest-wolves'
		});
		// Verify the quest was indeed auto-completed
		const saved = mockPersistTurnAndSaveState.mock.calls[0][2];
		const quest = saved.quests.find((q: { id: string }) => q.id === 'quest-wolves');
		expect(quest.status).toBe('completed');
	});

	it('does NOT dispatch extend-quest-arc when only some objectives are done', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// Reset: both objectives start undone
		state.quests[0].objectives[0].done = false;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You find the wolf tracks leading deeper into the forest.', {
				questUpdates: [
					{ questId: 'quest-wolves', field: 'objective', objectiveId: 'obj-track', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I search for tracks', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const extendCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-extend-quest-arc'
		);
		expect(extendCalls).toHaveLength(0);
	});

	it('does NOT dispatch extend-quest-arc when GM sets status to completed directly (no auto-complete)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// Only one objective done — so it's not ALL done
		state.quests[0].objectives[0].done = false;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The elder declares the quest complete.', {
				questUpdates: [
					{ questId: 'quest-wolves', field: 'status', newValue: 'completed' }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Talk to the elder', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Status set directly — NOT objective-based auto-complete — so no follow-up
		const extendCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-extend-quest-arc'
		);
		expect(extendCalls).toHaveLength(0);
	});

	it('dispatches extend-quest-arc for a quest that gets all objectives done at once', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		// Both objectives start undone
		state.quests[0].objectives[0].done = false;
		state.quests[0].objectives[1].done = false;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('In one decisive action you track and slay the alpha wolf!', {
				questUpdates: [
					{ questId: 'quest-wolves', field: 'objective', objectiveId: 'obj-track', newValue: true },
					{ questId: 'quest-wolves', field: 'objective', objectiveId: 'obj-defeat', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I charge at the wolves', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-extend-quest-arc', {
			adventureId: 'adv-1',
			questId: 'quest-wolves'
		});
	});
});

describe('Phase 4: enrichment intent — react-to-party cadence', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState(turnNumber: number) {
		return {
			nextTurnNumber: turnNumber,
			turnLog: [],
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
			npcs: [],
			locations: [
				{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'A campsite.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
	}

	it('dispatches react-to-party on turn 5', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(5);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You rest by the campfire.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Rest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-react-to-party', {
			adventureId: 'adv-1'
		});
	});

	it('dispatches react-to-party on turn 10', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(10);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Another quiet evening.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Set up camp', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-react-to-party', {
			adventureId: 'adv-1'
		});
	});

	it('dispatches react-to-party on turn 25 (every multiple of 5)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(25);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Time passes.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Wait', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).toHaveBeenCalledWith('world-react-to-party', {
			adventureId: 'adv-1'
		});
	});

	it('does NOT dispatch react-to-party on turn 3 (not multiple of 5)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(3);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You continue.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Move forward', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const reactCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-react-to-party'
		);
		expect(reactCalls).toHaveLength(0);
	});

	it('does NOT dispatch react-to-party on turn 7', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(7);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Nothing special.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const reactCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-react-to-party'
		);
		expect(reactCalls).toHaveLength(0);
	});

	it('does NOT dispatch react-to-party on turn 0', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState(0);
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The adventure begins.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const reactCalls = mockTasksTrigger.mock.calls.filter(
			(c: unknown[]) => c[0] === 'world-react-to-party'
		);
		expect(reactCalls).toHaveLength(0);
	});
});

describe('Phase 4: multiple enrichment intents in a single turn', () => {
	beforeEach(() => resetAllMocks());

	it('dispatches both expand-settlement AND extend-quest-arc when both trigger in same turn', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 6,
			turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
				classSpells: [], pactSlots: [], level: 5,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 40, maxHp: 40, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 3, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 11, inventory: [], gold: 100, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-dungeon', name: 'Wolf Den', type: 'dungeon', description: 'A dark cave.', features: [], connections: ['loc-village'], npcs: [], regionRef: null, visited: true },
				{ id: 'loc-village', name: 'Hearthhome', type: 'settlement', description: 'A warm village.', features: ['A stone well'], connections: ['loc-dungeon'], npcs: [], regionRef: null, visited: false }
			],
			quests: [{
				id: 'quest-den',
				name: 'Clear the Wolf Den',
				description: 'Wipe out the wolves threatening the village.',
				giverNpcId: null,
				status: 'active',
				objectives: [
					{ id: 'obj-clear', text: 'Defeat all wolves', done: false }
				],
				rewards: { xp: 150, gold: 30, items: [], reputationChanges: [] },
				recommendedLevel: 3,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-dungeon',
			clock: { day: 2, timeOfDay: 'evening', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		// GM response: complete objective AND move to village
		mockTwoPassResponse('With the last wolf slain, you journey back to the village in triumph.', {
				questUpdates: [
					{ questId: 'quest-den', field: 'objective', objectiveId: 'obj-clear', newValue: true }
				],
				locationChange: { from: 'loc-dungeon', to: 'loc-village' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I defeat the last wolf and head home', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Both enrichment tasks should have been dispatched
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-village'
		});
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-extend-quest-arc', {
			adventureId: 'adv-1',
			questId: 'quest-den'
		});
	});

	it('dispatches all three intent types on turn 5 with location change and quest completion', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 5,  // Multiple of 5 → react-to-party
			turnLog: [],
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
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-wild', name: 'Wilds', type: 'wilderness', description: 'Open plains.', features: [], connections: ['loc-city'], npcs: [], regionRef: null, visited: true },
				{ id: 'loc-city', name: 'Stonegate', type: 'settlement', description: 'A fortified city.', features: [], connections: ['loc-wild'], npcs: [], regionRef: null, visited: false }
			],
			quests: [{
				id: 'quest-deliver',
				name: 'Deliver the Message',
				description: 'Carry the sealed letter to Stonegate.',
				giverNpcId: null,
				status: 'active',
				objectives: [{ id: 'obj-arrive', text: 'Reach Stonegate', done: false }],
				rewards: { xp: 100, gold: 20, items: [], reputationChanges: [] },
				recommendedLevel: 1,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-wild',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You arrive at the city gates and hand over the letter.', {
				locationChange: { from: 'loc-wild', to: 'loc-city' },
				questUpdates: [
					{ questId: 'quest-deliver', field: 'objective', objectiveId: 'obj-arrive', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I enter the city and deliver the message', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// All three types should fire:
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-expand-settlement', {
			adventureId: 'adv-1',
			locationId: 'loc-city'
		});
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-extend-quest-arc', {
			adventureId: 'adv-1',
			questId: 'quest-deliver'
		});
		expect(mockTasksTrigger).toHaveBeenCalledWith('world-react-to-party', {
			adventureId: 'adv-1'
		});
	});

	it('no enrichment dispatched when state changes are empty', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 3,  // Not a multiple of 5
			turnLog: [],
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
			npcs: [],
			locations: [
				{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'A campsite.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You rest quietly.');

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Rest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(mockTasksTrigger).not.toHaveBeenCalled();
	});

	it('enrichment dispatch failure does not break turn persistence', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 5,
			turnLog: [],
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
			npcs: [],
			locations: [
				{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'A campsite.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Quiet night.');
		// Make task dispatch fail
		mockTasksTrigger.mockRejectedValue(new Error('Trigger.dev is down'));

		const { executeAdventureTurn } = await import('./adventure-turn');
		// Should NOT throw — errors are caught silently
		await expect(
			executeAdventureTurn(
				{ adventureId: 'adv-1', playerAction: 'Rest', actorUserId: 'user-1',
				  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
				{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
			)
		).resolves.toBeDefined();

		// Turn was persisted despite dispatch failure
		expect(mockPersistTurnAndSaveState).toHaveBeenCalledOnce();
	});
});

describe('Phase 4: enrichment intent — data quality (context passed to triggers)', () => {
	beforeEach(() => resetAllMocks());

	it('passes correct adventureId and locationId to expand-settlement', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 1,
			turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-specific', name: 'Hero', race: 'human',
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
			npcs: [],
			locations: [
				{ id: 'loc-origin', name: 'Road', type: 'wilderness', description: 'A dirt road.', features: [], connections: ['loc-harbor'], npcs: [], regionRef: null, visited: true },
				{ id: 'loc-harbor', name: 'Harbortown', type: 'settlement', description: 'A port settlement.', features: ['Ship docks', 'Fish market'], connections: ['loc-origin'], npcs: [], regionRef: null, visited: false }
			],
			quests: [],
			partyLocationId: 'loc-origin',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You arrive at the bustling harbor.', {
				locationChange: { from: 'loc-origin', to: 'loc-harbor' }
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-specific', playerAction: 'Head to harbor', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Verify EXACT payload shape — no extra fields, correct IDs
		const expandCall = mockTasksTrigger.mock.calls.find(
			(c: unknown[]) => c[0] === 'world-expand-settlement'
		);
		expect(expandCall).toBeDefined();
		expect(expandCall![1]).toEqual({
			adventureId: 'adv-specific',
			locationId: 'loc-harbor'
		});
	});

	it('passes correct adventureId and questId to extend-quest-arc', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 8,
			turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-quest-test', name: 'Hero', race: 'human',
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
			npcs: [],
			locations: [
				{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'Campsite.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [{
				id: 'quest-relic',
				name: 'The Lost Relic',
				description: 'Find the ancient relic.',
				giverNpcId: null,
				status: 'active',
				objectives: [{ id: 'obj-find', text: 'Find the relic', done: false }],
				rewards: { xp: 250, gold: 75, items: [], reputationChanges: [] },
				recommendedLevel: 3,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-1',
			clock: { day: 5, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You uncover the ancient relic!', {
				questUpdates: [
					{ questId: 'quest-relic', field: 'objective', objectiveId: 'obj-find', newValue: true }
				]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-quest-test', playerAction: 'I uncover the relic', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const extendCall = mockTasksTrigger.mock.calls.find(
			(c: unknown[]) => c[0] === 'world-extend-quest-arc'
		);
		expect(extendCall).toBeDefined();
		expect(extendCall![1]).toEqual({
			adventureId: 'adv-quest-test',
			questId: 'quest-relic'
		});
	});
});

// ===========================================================================
// Phase 5: sanitizeStateChanges — schema validation of AI-produced stateChanges
// ===========================================================================

describe('Phase 5: sanitizeStateChanges — hpChanges validation', () => {
	beforeEach(() => resetAllMocks());

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 5, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
				classSpells: [], pactSlots: [], level: 3,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 25, maxHp: 28, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 11, inventory: [], gold: 50, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [], locations: [], quests: [], partyLocationId: null,
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips hpChanges with non-string characterId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 123 as unknown as string, oldHp: 25, newHp: 20, reason: 'ouch' }]
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});

	it('strips hpChanges with empty characterId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: '', oldHp: 25, newHp: 20, reason: 'ouch' }]
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});

	it('strips hpChanges with non-number newHp', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 'pc-1', oldHp: 25, newHp: 'full' as any, reason: 'healed' }]
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});

	it('strips hpChanges with NaN newHp', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 'pc-1', oldHp: 25, newHp: NaN, reason: 'broken' }]
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});

	it('strips hpChanges with Infinity newHp', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 'pc-1', oldHp: 25, newHp: Infinity, reason: 'godmode' }]
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});

	it('auto-fills oldHp from current state when missing', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 'pc-1', newHp: 20, reason: 'ouch' } as any]
		}, state as any);
		expect(result.hpChanges).toHaveLength(1);
		expect(result.hpChanges![0].oldHp).toBe(25); // current HP from state
	});

	it('auto-fills empty reason as empty string', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: 'pc-1', oldHp: 25, newHp: 20 } as any]
		}, state as any);
		expect(result.hpChanges).toHaveLength(1);
		expect(result.hpChanges![0].reason).toBe('');
	});

	it('keeps valid hpChanges entries and strips invalid ones', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: [
				{ characterId: 'pc-1', oldHp: 25, newHp: 20, reason: 'hit' },
				{ characterId: '', oldHp: 10, newHp: 5, reason: 'bad' },
				{ characterId: 'pc-2', oldHp: 10, newHp: 8, reason: 'trap' }
			]
		}, state as any);
		expect(result.hpChanges).toHaveLength(2);
		expect(result.hpChanges![0].characterId).toBe('pc-1');
		expect(result.hpChanges![1].characterId).toBe('pc-2');
	});

	it('strips entire hpChanges when it is not an array', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeMinimalState();
		const result = sanitizeStateChanges({
			hpChanges: 'not-an-array' as any
		}, state as any);
		expect(result.hpChanges).toBeUndefined();
	});
});

describe('Phase 5: sanitizeStateChanges — xpAwarded validation', () => {
	beforeEach(() => {
		mockLoadGameState.mockReset();
		mockPersistTurnAndSaveState.mockReset();
	});

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 5, turnLog: [],
			characters: [{ id: 'pc-1', userId: 'u1', adventureId: 'a1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }], classSpells: [], pactSlots: [],
				level: 1, abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium', proficiencyBonus: 2,
				skillProficiencies: [], expertiseSkills: [], saveProficiencies: ['str', 'con'],
				languages: ['common'], armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false, passivePerception: 11,
				inventory: [], gold: 0, xp: 0, conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: '' }],
			npcs: [], locations: [], quests: [], partyLocationId: null,
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips xpAwarded with negative amount', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			xpAwarded: [{ characterId: 'pc-1', amount: -50 }]
		}, makeMinimalState() as any);
		expect(result.xpAwarded).toBeUndefined();
	});

	it('strips xpAwarded with non-number amount', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			xpAwarded: [{ characterId: 'pc-1', amount: 'lots' as any }]
		}, makeMinimalState() as any);
		expect(result.xpAwarded).toBeUndefined();
	});

	it('strips xpAwarded with empty characterId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			xpAwarded: [{ characterId: '', amount: 50 }]
		}, makeMinimalState() as any);
		expect(result.xpAwarded).toBeUndefined();
	});

	it('keeps valid xpAwarded entries', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			xpAwarded: [{ characterId: 'pc-1', amount: 100 }]
		}, makeMinimalState() as any);
		expect(result.xpAwarded).toHaveLength(1);
		expect(result.xpAwarded![0].amount).toBe(100);
	});
});

describe('Phase 5: sanitizeStateChanges — conditionsApplied validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [{ id: 'pc-1' }], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips invalid condition names', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			conditionsApplied: [{ characterId: 'pc-1', condition: 'cursed' as any, applied: true }]
		}, makeMinimalState() as any);
		expect(result.conditionsApplied).toBeUndefined();
	});

	it('keeps valid 5e conditions', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			conditionsApplied: [{ characterId: 'pc-1', condition: 'poisoned', applied: true }]
		}, makeMinimalState() as any);
		expect(result.conditionsApplied).toHaveLength(1);
	});

	it('defaults applied to true when missing', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			conditionsApplied: [{ characterId: 'pc-1', condition: 'blinded' } as any]
		}, makeMinimalState() as any);
		expect(result.conditionsApplied).toHaveLength(1);
		expect(result.conditionsApplied![0].applied).toBe(true);
	});
});

describe('Phase 5: sanitizeStateChanges — locationChange validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips locationChange with empty to', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			locationChange: { from: 'loc-1', to: '' }
		}, makeMinimalState() as any);
		expect(result.locationChange).toBeUndefined();
	});

	it('strips locationChange with non-string to', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			locationChange: { from: 'loc-1', to: 123 as any }
		}, makeMinimalState() as any);
		expect(result.locationChange).toBeUndefined();
	});

	it('keeps valid locationChange', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			locationChange: { from: 'loc-1', to: 'loc-2' }
		}, makeMinimalState() as any);
		expect(result.locationChange).toEqual({ from: 'loc-1', to: 'loc-2' });
	});
});

describe('Phase 5: sanitizeStateChanges — itemsGained backfill and validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [{ id: 'pc-1' }], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('backfills missing weight, rarity, attunement on items', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsGained: [{
				characterId: 'pc-1',
				item: { id: 'item-1', name: 'Old Coins', category: 'misc', description: 'Some coins', value: 5, quantity: 3 } as any
			}]
		}, makeMinimalState() as any);
		expect(result.itemsGained).toHaveLength(1);
		const item = result.itemsGained![0].item as any;
		expect(item.weight).toBe(0);
		expect(item.rarity).toBe('common');
		expect(item.attunement).toBe(false);
	});

	it('strips items with no name', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsGained: [{
				characterId: 'pc-1',
				item: { id: 'item-1', category: 'misc' } as any
			}]
		}, makeMinimalState() as any);
		expect(result.itemsGained).toBeUndefined();
	});

	it('strips itemsGained with missing characterId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsGained: [{ item: { id: 'i1', name: 'Sword' } } as any]
		}, makeMinimalState() as any);
		expect(result.itemsGained).toBeUndefined();
	});

	it('strips itemsGained with missing item object', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsGained: [{ characterId: 'pc-1' } as any]
		}, makeMinimalState() as any);
		expect(result.itemsGained).toBeUndefined();
	});

	it('backfills missing category as misc', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsGained: [{
				characterId: 'pc-1',
				item: { id: 'i1', name: 'Widget' } as any
			}]
		}, makeMinimalState() as any);
		expect(result.itemsGained).toHaveLength(1);
		expect((result.itemsGained![0].item as any).category).toBe('misc');
	});
});

describe('Phase 5: sanitizeStateChanges — itemsLost validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [{ id: 'pc-1' }], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips itemsLost with empty itemId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsLost: [{ characterId: 'pc-1', itemId: '', quantity: 1 }]
		}, makeMinimalState() as any);
		expect(result.itemsLost).toBeUndefined();
	});

	it('defaults quantity to 1 when missing or invalid', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			itemsLost: [{ characterId: 'pc-1', itemId: 'i1', quantity: -5 }]
		}, makeMinimalState() as any);
		expect(result.itemsLost).toHaveLength(1);
		expect(result.itemsLost![0].quantity).toBe(1);
	});
});

describe('Phase 5: sanitizeStateChanges — encounterStarted + encounterEnded instant combat', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips encounterEnded when encounterStarted is in the same response', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			encounterStarted: {
				creatures: [{ id: 'npc-rat', name: 'Giant Rat', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'A big rat' }] as NPC[]
			},
			encounterEnded: { outcome: 'victory' as const }
		}, makeMinimalState() as any);
		expect(result.encounterStarted).toBeDefined();
		expect(result.encounterStarted!.creatures).toHaveLength(1);
		expect(result.encounterEnded).toBeUndefined();
	});

	it('keeps encounterEnded when encounterStarted is NOT present', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			encounterEnded: { outcome: 'victory' as const }
		}, makeMinimalState() as any);
		expect(result.encounterEnded).toBeDefined();
		expect(result.encounterEnded!.outcome).toBe('victory');
	});

	it('backfills missing creature fields', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			encounterStarted: {
				creatures: [{ name: 'Goblin' }] as any
			}
		}, makeMinimalState() as any);
		expect(result.encounterStarted!.creatures).toHaveLength(1);
		const cr = result.encounterStarted!.creatures[0] as any;
		expect(cr.role).toBe('hostile');
		expect(cr.disposition).toBe(-100);
	});
});

describe('Phase 5: sanitizeStateChanges — npcsAdded validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: 'loc-town', clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips NPC with no name', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcsAdded: [{ id: 'npc-1', role: 'neutral', locationId: 'loc-1', disposition: 0, description: 'mystery' } as any]
		}, makeMinimalState() as any);
		expect(result.npcsAdded).toBeUndefined();
	});

	it('defaults invalid NPC role to neutral', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcsAdded: [{ id: 'npc-1', name: 'Bob', role: 'shopkeeper' as any, locationId: 'loc-1', disposition: 0, description: 'a guy' }]
		}, makeMinimalState() as any);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.npcsAdded![0].role).toBe('neutral');
	});

	it('defaults missing locationId to partyLocationId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcsAdded: [{ id: 'npc-1', name: 'Bob', role: 'neutral', disposition: 0, description: 'a guy' } as any]
		}, makeMinimalState() as any);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.npcsAdded![0].locationId).toBe('loc-town');
	});
});

describe('Phase 5: sanitizeStateChanges — locationsAdded validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips location with no name', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			locationsAdded: [{ id: 'loc-1', type: 'dungeon', description: 'dark place' } as any]
		}, makeMinimalState() as any);
		expect(result.locationsAdded).toBeUndefined();
	});

	it('defaults invalid location type to interior', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			locationsAdded: [{ id: 'loc-1', name: 'Dark Room', type: 'building' as any, description: 'inside' }]
		}, makeMinimalState() as any);
		expect(result.locationsAdded).toHaveLength(1);
		expect(result.locationsAdded![0].type).toBe('interior');
	});
});

describe('Phase 5: sanitizeStateChanges — questsAdded validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips quest with no name', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			questsAdded: [{ id: 'q-1', description: 'do stuff', objectives: [] } as any]
		}, makeMinimalState() as any);
		expect(result.questsAdded).toBeUndefined();
	});

	it('defaults missing objectives to empty array', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			questsAdded: [{ id: 'q-1', name: 'Find the Gem', description: 'find it' } as any]
		}, makeMinimalState() as any);
		expect(result.questsAdded).toHaveLength(1);
		expect(result.questsAdded![0].objectives).toEqual([]);
	});
});

describe('Phase 5: sanitizeStateChanges — sceneFactsAdded validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips non-string scene fact entries', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			sceneFactsAdded: ['valid fact', 42 as any, '', null as any, 'another fact']
		}, makeMinimalState() as any);
		expect(result.sceneFactsAdded).toHaveLength(2);
		expect(result.sceneFactsAdded).toEqual(['valid fact', 'another fact']);
	});

	it('strips sceneFactsAdded when it is not an array', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			sceneFactsAdded: 'single fact' as any
		}, makeMinimalState() as any);
		expect(result.sceneFactsAdded).toBeUndefined();
	});
});

describe('Phase 5: sanitizeStateChanges — npcChanges and questUpdates validation', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('strips npcChanges with no npcId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcChanges: [{ field: 'disposition', oldValue: 0, newValue: 50 } as any]
		}, makeMinimalState() as any);
		expect(result.npcChanges).toBeUndefined();
	});

	it('strips npcChanges with no field', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcChanges: [{ npcId: 'npc-1', oldValue: 0, newValue: 50 } as any]
		}, makeMinimalState() as any);
		expect(result.npcChanges).toBeUndefined();
	});

	it('strips questUpdates with no questId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			questUpdates: [{ field: 'status', oldValue: 'active', newValue: 'completed' } as any]
		}, makeMinimalState() as any);
		expect(result.questUpdates).toBeUndefined();
	});

	it('keeps valid npcChanges and questUpdates', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			npcChanges: [{ npcId: 'npc-1', field: 'disposition', oldValue: 0, newValue: 50 }],
			questUpdates: [{ questId: 'q-1', field: 'status', oldValue: 'active', newValue: 'completed' }]
		}, makeMinimalState() as any);
		expect(result.npcChanges).toHaveLength(1);
		expect(result.questUpdates).toHaveLength(1);
	});
});

describe('Phase 5: sanitizeStateChanges — pass-through and combined', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalState() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [{ id: 'pc-1', hp: 20 }], npcs: [], locations: [], quests: [],
			partyLocationId: 'loc-1', clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('passes through clockAdvance, spellSlotUsed, companionPromoted unchanged', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const clockAdv = { from: { day: 1, timeOfDay: 'morning' as const, weather: 'clear' }, to: { day: 1, timeOfDay: 'afternoon' as const, weather: 'cloudy' } };
		const result = sanitizeStateChanges({
			clockAdvance: clockAdv,
			spellSlotUsed: { characterId: 'pc-1', level: 1, spellName: 'cure-wounds' },
			companionPromoted: { npcId: 'npc-1', statBlock: {} as any }
		}, makeMinimalState() as any);
		expect(result.clockAdvance).toBe(clockAdv);
		expect(result.spellSlotUsed).toBeDefined();
		expect(result.companionPromoted).toBeDefined();
	});

	it('returns empty object when all entries are invalid', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges({
			hpChanges: [{ characterId: '', newHp: 'bad' as any }] as any,
			xpAwarded: [{ characterId: '', amount: -10 }],
			itemsGained: [{ characterId: '' } as any],
			sceneFactsAdded: [42 as any, null as any]
		}, makeMinimalState() as any);
		expect(result.hpChanges).toBeUndefined();
		expect(result.xpAwarded).toBeUndefined();
		expect(result.itemsGained).toBeUndefined();
		expect(result.sceneFactsAdded).toBeUndefined();
	});
});

// ===========================================================================
// Phase 5: sanitizeStateChanges integration — wired into executeAdventureTurn
// ===========================================================================

describe('Phase 5: sanitizeStateChanges integration — malformed AI response cleaned before state application', () => {
	beforeEach(() => resetAllMocks());

	it('strips malformed hpChanges from AI before applying to state — character HP unchanged', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 5, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
				classSpells: [], pactSlots: [], level: 3,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 25, maxHp: 28, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 11, inventory: [], gold: 50, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [], locations: [],
			quests: [], partyLocationId: null,
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		// AI returns hpChanges with an NPC id instead of character id (story.json issue #7)
		mockTwoPassResponse('The rogue strikes but misses.', {
				hpChanges: [{ characterId: 'npc-rogue-3', oldHp: 15, newHp: 0, reason: 'killed' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I attack the rogue', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// The character's HP should be unaffected since the hpChange references a valid-looking but
		// non-character ID. The sanitizer KEEPS the entry (it has valid string ID and number newHp)
		// but applyGMStateChanges will skip it with a warning because it doesn't match any character.
		expect(state.characters[0].hp).toBe(25);
	});

	it('strips instant combat (encounterStarted + encounterEnded) — encounter starts but does not immediately end', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 3, turnLog: [],
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
				passivePerception: 11, inventory: [], gold: 0, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Warehouse', type: 'interior', description: 'Dirty.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		// AI returns instant combat — encounterStarted AND encounterEnded in same turn (story.json issue #5)
		mockTwoPassResponse('A giant rat lunges at you from the shadows and attacks you! You dispatch it in one blow!', {
				encounterStarted: {
					creatures: [{ id: 'npc-rat-1', name: 'Giant Rat', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'A big rat' }]
				},
				encounterEnded: { outcome: 'victory' },
				xpAwarded: [{ characterId: 'pc-1', amount: 10 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I attack the rat', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Encounter should have STARTED but not ended (instant combat is stripped)
		expect((state as any).activeEncounter).toBeDefined();
		expect((state as any).activeEncounter!.status).toBe('active');
		// XP should still be awarded though (valid entry)
		expect(state.characters[0].xp).toBe(10);
	});
});

// ===========================================================================
// Phase 5: Quest reward auto-distribution
// ===========================================================================

describe('Phase 5: quest reward auto-distribution', () => {
	beforeEach(() => resetAllMocks());

	function makeQuestState(questRewards: any = { xp: 100, gold: 50, items: [], reputationChanges: [] }) {
		return {
			nextTurnNumber: 10, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 11, inventory: [], gold: 10, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}, {
				id: 'pc-2', userId: 'user-2', adventureId: 'adv-1', name: 'Ally', race: 'elf',
				classes: [{ name: 'wizard', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 14, cha: 10 },
				hp: 8, maxHp: 8, tempHp: 0, ac: 12, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['int', 'wis'], languages: ['common', 'elvish'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 5, xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [
				{ id: 'npc-giver', name: 'Quest Giver', role: 'quest-giver', locationId: 'loc-1', disposition: 30, description: 'A quest giver', notes: '', alive: true }
			],
			locations: [{ id: 'loc-1', name: 'Town', type: 'settlement', description: 'A town.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [{
				id: 'quest-main',
				name: 'Main Quest',
				description: 'The main quest.',
				giverNpcId: 'npc-giver',
				status: 'active',
				objectives: [{ id: 'obj-1', text: 'Do the thing', done: false }],
				rewards: questRewards,
				recommendedLevel: 1,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-1',
			clock: { day: 5, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	it('distributes XP to all living characters on objective-based quest completion', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({ xp: 200, gold: 0, items: [], reputationChanges: [] });
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You complete the task!', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I finish the quest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].xp).toBe(200);
		expect(state.characters[1].xp).toBe(200);
		expect(state.quests[0].status).toBe('completed');
	});

	it('distributes gold to all living characters on quest completion', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({ xp: 0, gold: 75, items: [], reputationChanges: [] });
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The quest is done.', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'complete quest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].gold).toBe(85); // 10 + 75
		expect(state.characters[1].gold).toBe(80); // 5 + 75
	});

	it('distributes reward items to first living character', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const rewardItem = {
			id: 'item-reward-sword', name: 'Enchanted Sword', category: 'weapon',
			description: 'A magical sword', value: 200, quantity: 1, weight: 3,
			rarity: 'rare', attunement: true, weaponName: 'longsword',
			damage: '1d8+1', damageType: 'slashing', magicBonus: 1, properties: ['versatile']
		};
		const state = makeQuestState({ xp: 50, gold: 25, items: [rewardItem], reputationChanges: [] });
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Victory!', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'finish', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// First character gets the item
		expect(state.characters[0].inventory).toHaveLength(1);
		expect((state.characters[0].inventory as any[])[0].name).toBe('Enchanted Sword');
		// Second character does NOT get the item
		expect(state.characters[1].inventory).toHaveLength(0);
	});

	it('applies reputation changes from quest rewards', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({
			xp: 0, gold: 0, items: [],
			reputationChanges: [{ npcId: 'npc-giver', delta: 25 }]
		});
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Quest done.', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'done', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.npcs[0].disposition).toBe(55); // 30 + 25
	});

	it('distributes quest rewards on manual status=completed (not just objective-based)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({ xp: 150, gold: 30, items: [], reputationChanges: [] });
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The GM declares the quest complete.', {
				questUpdates: [{ questId: 'quest-main', field: 'status', oldValue: 'active', newValue: 'completed' }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'check quest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].xp).toBe(150);
		expect(state.characters[1].xp).toBe(150);
		expect(state.characters[0].gold).toBe(40); // 10 + 30
	});

	it('does not distribute rewards when quest has zero rewards', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({ xp: 0, gold: 0, items: [], reputationChanges: [] });
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Quest done but no rewards.', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'done', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].xp).toBe(0);
		expect(state.characters[0].gold).toBe(10); // unchanged
	});

	it('skips dead characters when distributing rewards', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({ xp: 100, gold: 50, items: [], reputationChanges: [] });
		state.characters[1].dead = true; // Second character is dead
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Quest complete despite losses.', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'finish', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].xp).toBe(100);
		expect(state.characters[0].gold).toBe(60); // 10 + 50
		expect(state.characters[1].xp).toBe(0); // dead — no reward
		expect(state.characters[1].gold).toBe(5); // dead — no reward
	});

	it('clamps reputation to [-100, 100] on quest reward', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeQuestState({
			xp: 0, gold: 0, items: [],
			reputationChanges: [{ npcId: 'npc-giver', delta: 200 }] // Would exceed 100
		});
		state.npcs[0].disposition = 50;
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Done.', {
				questUpdates: [{ questId: 'quest-main', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'done', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.npcs[0].disposition).toBe(100); // clamped
	});
});

// ===========================================================================
// Phase 5: Auto-level-up check
// ===========================================================================

describe('Phase 5: auto-level-up check', () => {
	beforeEach(() => resetAllMocks());

	it('auto-levels a character when XP award pushes them past the threshold', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 10, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: ['athletics', 'perception'],
				expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
				weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 50,
				xp: 250, // just below 300 (level 2 threshold)
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'Campsite.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], partyLocationId: 'loc-1',
			clock: { day: 5, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		// AI awards 100 XP (total 350, enough for level 2 at 300)
		mockTwoPassResponse('Great victory!', {
				xpAwarded: [{ characterId: 'pc-1', amount: 100 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'do something heroic', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].level).toBe(2);
		expect(state.characters[0].xp).toBe(350);
		// Max HP should have increased
		expect(state.characters[0].maxHp).toBeGreaterThan(12);
	});

	it('auto-levels multiple times for massive XP award', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 20, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: ['athletics', 'perception'],
				expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
				weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 50,
				xp: 0, // Starting from 0
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Arena', type: 'interior', description: 'Arena.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], partyLocationId: 'loc-1',
			clock: { day: 10, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		// Award 3000 XP — enough for level 4 (threshold = 2700)
		mockTwoPassResponse('Legendary victory grants massive experience!', {
				xpAwarded: [{ characterId: 'pc-1', amount: 3000 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'epic defeat', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Should be level 4 (thresholds: L2=300, L3=900, L4=2700, L5=6500)
		expect(state.characters[0].level).toBe(4);
		expect(state.characters[0].xp).toBe(3000);
	});

	it('does not level up when XP is insufficient', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 5, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: ['athletics', 'perception'],
				expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
				weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 50,
				xp: 0,
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Camp', type: 'wilderness', description: 'Camp.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], partyLocationId: 'loc-1',
			clock: { day: 5, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A minor skirmish.', {
				xpAwarded: [{ characterId: 'pc-1', amount: 10 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'fight', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].level).toBe(1);
		expect(state.characters[0].xp).toBe(10);
		expect(state.characters[0].maxHp).toBe(12); // unchanged
	});

	it('auto-levels character after quest reward XP distribution', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 15, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }],
				classSpells: [], pactSlots: [], level: 1,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 12, maxHp: 12, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: ['athletics', 'perception'],
				expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
				weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 10,
				xp: 200, // needs 300 for level 2
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Town', type: 'settlement', description: 'Town.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [{
				id: 'quest-1',
				name: 'Simple Quest',
				description: 'A simple quest.',
				giverNpcId: null,
				status: 'active',
				objectives: [{ id: 'obj-1', text: 'Do it', done: false }],
				rewards: { xp: 150, gold: 0, items: [], reputationChanges: [] },
				recommendedLevel: 1,
				encounterTemplates: []
			}],
			partyLocationId: 'loc-1',
			clock: { day: 5, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Quest complete!', {
				questUpdates: [{ questId: 'quest-1', field: 'objective', objectiveId: 'obj-1', newValue: true }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'finish quest', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// XP: 200 + 150 (quest reward) = 350 → level 2 at 300
		expect(state.characters[0].xp).toBe(350);
		expect(state.characters[0].level).toBe(2);
		expect(state.characters[0].maxHp).toBeGreaterThan(12);
	});

	it('levels up increases proficiency bonus at level 5', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = {
			nextTurnNumber: 30, turnLog: [],
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 4, hitDiceRemaining: 4 }],
				classSpells: [], pactSlots: [], level: 4,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 36, maxHp: 36, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: ['athletics', 'perception'],
				expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
				weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
				classFeatures: [
					{ name: 'Fighting Style', level: 1, source: 'class' },
					{ name: 'Second Wind', level: 1, source: 'class' },
					{ name: 'Action Surge', level: 2, source: 'class' }
				], feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 12, inventory: [], gold: 50,
				xp: 6000, // needs 6500 for level 5
				conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [],
			locations: [{ id: 'loc-1', name: 'Arena', type: 'interior', description: 'Arena.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], partyLocationId: 'loc-1',
			clock: { day: 30, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A worthy battle!', {
				xpAwarded: [{ characterId: 'pc-1', amount: 1000 }]
			});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'epic fight', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		expect(state.characters[0].level).toBe(5);
		expect(state.characters[0].proficiencyBonus).toBe(3); // +3 at level 5
	});
});

// ---------------------------------------------------------------------------
// Phase 6+7: parseStateExtractionResponse
// ---------------------------------------------------------------------------

describe('Phase 7: parseStateExtractionResponse', () => {
	it('extracts stateChanges from wrapper object', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse(JSON.stringify({
			stateChanges: {
				hpChanges: [{ characterId: 'pc-1', oldHp: 20, newHp: 15, reason: 'goblin attack' }],
				sceneFactsAdded: ['Goblin attacked the party']
			}
		}));
		expect(result.hpChanges).toHaveLength(1);
		expect(result.hpChanges![0].newHp).toBe(15);
		expect(result.sceneFactsAdded).toEqual(['Goblin attacked the party']);
	});

	it('handles flat state-change keys at top level (no wrapper)', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse(JSON.stringify({
			locationChange: { from: 'loc-1', to: 'loc-2' },
			xpAwarded: [{ characterId: 'pc-1', amount: 50 }]
		}));
		expect(result.locationChange).toEqual({ from: 'loc-1', to: 'loc-2' });
		expect(result.xpAwarded).toEqual([{ characterId: 'pc-1', amount: 50 }]);
	});

	it('returns empty object for empty stateChanges wrapper', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse(JSON.stringify({ stateChanges: {} }));
		expect(result).toEqual({});
	});

	it('returns empty object when no recognized keys exist', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse(JSON.stringify({ someRandomKey: 'value' }));
		expect(result).toEqual({});
	});

	it('returns empty object for malformed JSON', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse('not valid json {{{');
		expect(result).toEqual({});
	});

	it('returns empty object for empty string', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse('');
		expect(result).toEqual({});
	});

	it('handles stateChanges with all recognized key types', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse(JSON.stringify({
			stateChanges: {
				hpChanges: [{ characterId: 'pc-1', oldHp: 20, newHp: 10, reason: 'fireball' }],
				itemsGained: [{ characterId: 'pc-1', item: { id: 'item-1', name: 'Potion', category: 'consumable' } }],
				npcsAdded: [{ id: 'npc-new', name: 'Merchant', role: 'merchant', locationId: 'loc-1' }],
				encounterEnded: { outcome: 'victory' }
			}
		}));
		expect(result.hpChanges).toHaveLength(1);
		expect(result.itemsGained).toHaveLength(1);
		expect(result.npcsAdded).toHaveLength(1);
		expect(result.encounterEnded).toEqual({ outcome: 'victory' });
	});

	it('handles whitespace around JSON', async () => {
		const { parseStateExtractionResponse } = await import('./adventure-turn');
		const result = parseStateExtractionResponse('  \n  ' + JSON.stringify({
			stateChanges: { xpAwarded: [{ characterId: 'pc-1', amount: 100 }] }
		}) + '  \n  ');
		expect(result.xpAwarded).toEqual([{ characterId: 'pc-1', amount: 100 }]);
	});
});

// ---------------------------------------------------------------------------
// Phase 7: Two-pass architecture integration
// ---------------------------------------------------------------------------

describe('Phase 7: two-pass execution', () => {
	beforeEach(() => {
		resetAllMocks();
	});

	it('uses completeChatJSON (not completeChat) for Pass 2 state extraction', async () => {
		mockLoadGameState.mockResolvedValue({
			version: 6, stateVersion: 6,
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }], classSpells: [], pactSlots: [],
				level: 1, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
				hp: 10, maxHp: 10, tempHp: 0, ac: 10, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: [], languages: ['common'], armorProficiencies: [],
				weaponProficiencies: [], toolProficiencies: [], classFeatures: [],
				feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 10, inventory: [], gold: 0, xp: 0, conditions: [],
				resistances: [], exhaustionLevel: 0, stable: false, dead: false,
				featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [], locations: [{ id: 'loc-1', name: 'Town', type: 'settlement', description: 'A town.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], conditionEffects: {},
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			turnLog: [], worldSeed: 'seed', nextTurnNumber: 1,
			sceneFacts: [], createdAt: Date.now(), updatedAt: Date.now()
		});
		mockTwoPassResponse('The hero looks around.', { sceneFactsAdded: ['The town is quiet'] });

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Pass 2 should call completeChatJSON
		expect(mockCompleteChatJSON).toHaveBeenCalledTimes(1);
		// completeChat is called for Pass 1 narrative (non-streaming mode)
		expect(mockCompleteChat).toHaveBeenCalledTimes(1);
	});

	it('debug data shows full-gm-2pass mode in persisted turn', async () => {
		mockLoadGameState.mockResolvedValue({
			version: 6, stateVersion: 6,
			characters: [{
				id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero', race: 'human',
				classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }], classSpells: [], pactSlots: [],
				level: 1, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
				hp: 10, maxHp: 10, tempHp: 0, ac: 10, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: [], languages: ['common'], armorProficiencies: [],
				weaponProficiencies: [], toolProficiencies: [], classFeatures: [],
				feats: [], spellSlots: [], concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 }, inspiration: false,
				passivePerception: 10, inventory: [], gold: 0, xp: 0, conditions: [],
				resistances: [], exhaustionLevel: 0, stable: false, dead: false,
				featureUses: {}, attunedItems: [], backstory: ''
			}],
			npcs: [], locations: [{ id: 'loc-1', name: 'Town', type: 'settlement', description: 'A town.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], conditionEffects: {},
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			turnLog: [], worldSeed: 'seed', nextTurnNumber: 1,
			sceneFacts: [], createdAt: Date.now(), updatedAt: Date.now()
		});
		mockTwoPassResponse('The hero looks around.', {});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I look around', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Debug data is passed to persistTurnAndSaveState as the 4th arg (JSON string)
		const debugJson = mockPersistTurnAndSaveState.mock.calls[0]?.[3];
		expect(debugJson).toBeDefined();
		const debugData = JSON.parse(debugJson);
		expect(debugData.mode).toBe('full-gm-2pass');
		expect(debugData.rawPass2Response).toBeDefined();
		expect(debugData.pass2LatencyMs).toBeGreaterThanOrEqual(0);
	});
});

// ---------------------------------------------------------------------------
// Phase 8a/8b: Creature Templates + Encounter Pipeline
// ---------------------------------------------------------------------------

describe('Phase 8a/8b: encounter pipeline with creature templates', () => {
	beforeEach(() => resetAllMocks());

	function makeBaseState() {
		return {
			version: 3,
			stateVersion: 3,
			nextTurnNumber: 1,
			turnLog: [],
			characters: [
				{
					id: 'pc-1',
					userId: 'user-1',
					adventureId: 'adv-1',
					name: 'Hero',
					race: 'human',
					classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
					classSpells: [],
					pactSlots: [],
					level: 5,
					abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
					hp: 44,
					maxHp: 44,
					tempHp: 0,
					ac: 16,
					speed: 30,
					size: 'Medium',
					proficiencyBonus: 3,
					skillProficiencies: [],
					expertiseSkills: [],
					saveProficiencies: ['str', 'con'],
					languages: ['common'],
					armorProficiencies: [],
					weaponProficiencies: [],
					toolProficiencies: [],
					classFeatures: [],
					feats: [],
					spellSlots: [],
					concentratingOn: null,
					deathSaves: { successes: 0, failures: 0 },
					inspiration: false,
					passivePerception: 11,
					inventory: [],
					gold: 100,
					xp: 0,
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
			npcs: [] as NPC[],
			locations: [
				{ id: 'loc-1', name: 'Forest Clearing', type: 'wilderness', description: 'A clearing.', features: [], connections: [], npcs: [], regionRef: null, visited: true }
			],
			quests: [],
			conditionEffects: {},
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: [],
			activeEncounter: undefined as ActiveEncounter | undefined,
			worldSeed: 'test-seed',
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
	}

	it('generates stat blocks for hostile creatures with tier from AI', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Two wolves leap from the bushes!', {
			encounterStarted: {
				creatures: [
					{ id: 'npc-wolf-1', name: 'Dire Wolf', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'A snarling dire wolf', tier: 'tough' },
					{ id: 'npc-wolf-2', name: 'Wolf', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'A hungry wolf', tier: 'weak' }
				]
			}
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I draw my sword', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		expect(enc).toBeDefined();
		expect(enc.status).toBe('active');
		expect(enc.round).toBe(1);

		// Should have PC + 2 wolves
		expect(enc.combatants.length).toBe(3);

		// Each NPC should have stat block attached
		const wolf1Npc = savedState.npcs.find((n: NPC) => n.id === 'npc-wolf-1');
		expect(wolf1Npc).toBeDefined();
		expect(wolf1Npc.statBlock).toBeDefined();
		expect(wolf1Npc.statBlock.hp).toBeGreaterThan(0);
		expect(wolf1Npc.statBlock.ac).toBeGreaterThanOrEqual(10);
		expect(wolf1Npc.statBlock.attacks.length).toBeGreaterThan(0);

		const wolf2Npc = savedState.npcs.find((n: NPC) => n.id === 'npc-wolf-2');
		expect(wolf2Npc).toBeDefined();
		expect(wolf2Npc.statBlock).toBeDefined();

		// Tough wolf should have higher CR than weak wolf
		expect(wolf1Npc.statBlock.cr).toBeGreaterThan(wolf2Npc.statBlock.cr);
	});

	it('hostile creature combatants use generated stat block values', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A bandit attacks!', {
			encounterStarted: {
				creatures: [{
					id: 'npc-bandit-1', name: 'Bandit', role: 'hostile',
					locationId: 'loc-1', disposition: -100, description: 'A scruffy bandit', tier: 'normal'
				}]
			}
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Fight!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		const banditCombatant = enc.combatants.find((c: { referenceId: string }) => c.referenceId === 'npc-bandit-1');
		expect(banditCombatant).toBeDefined();

		// Stats should NOT be hardcoded 20/20/12 anymore
		const npc = savedState.npcs.find((n: NPC) => n.id === 'npc-bandit-1');
		expect(banditCombatant.maxHp).toBe(npc.statBlock.maxHp);
		expect(banditCombatant.ac).toBe(npc.statBlock.ac);
		expect(banditCombatant.currentHp).toBe(npc.statBlock.hp);
	});

	it('initiative is rolled (not all zeros)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Goblins attack!', {
			encounterStarted: {
				creatures: [
					{ id: 'npc-gob-1', name: 'Goblin', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'A', tier: 'weak' },
					{ id: 'npc-gob-2', name: 'Goblin', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'B', tier: 'weak' },
					{ id: 'npc-gob-3', name: 'Goblin', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'C', tier: 'weak' }
				]
			}
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Fight!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const enc = savedState.activeEncounter;
		expect(enc.combatants.length).toBe(4); // PC + 3 goblins

		// At least some initiatives should be non-zero (RNG dependent, but virtually guaranteed)
		const initiatives = enc.combatants.map((c: { initiative: number }) => c.initiative);
		const allZero = initiatives.every((i: number) => i === 0);
		expect(allZero).toBe(false);
	});

	it('tier defaults to normal when missing from AI response', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('A giant rat charges at you from the darkness!', {
			encounterStarted: {
				creatures: [{
					id: 'npc-rat-1', name: 'Giant Rat', role: 'hostile',
					locationId: 'loc-1', disposition: -100, description: 'A big rat'
					// No tier field — should default to 'normal'
				}]
			}
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Fight!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		const ratNpc = savedState.npcs.find((n: NPC) => n.id === 'npc-rat-1');
		expect(ratNpc.statBlock).toBeDefined();
		// 'normal' tier at party level 5 → CR ≈ 2.5, snapped to CR 2 or 3
		expect(ratNpc.statBlock.cr).toBeGreaterThanOrEqual(2);
		expect(ratNpc.statBlock.cr).toBeLessThanOrEqual(3);
	});

	it('encounter end calculates XP and clears activeEncounter', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';

		// Set up state with an active encounter
		const state = makeBaseState();
		// Manually create a pre-existing encounter with a defeated NPC
		state.npcs = [{
			id: 'npc-goblin',
			name: 'Goblin',
			role: 'hostile' as const,
			locationId: 'loc-1',
			disposition: -100,
			description: 'A goblin',
			notes: '',
			alive: true,
			statBlock: {
				hp: 7, maxHp: 7, ac: 15,
				abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
				speed: 30, cr: 0.25,
				attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2', damageType: 'slashing' }],
				savingThrows: [], skills: [],
				resistances: [], immunities: [],
				vulnerabilities: [], traits: [], actions: [], legendaryActions: []
			}
		}];
		state.activeEncounter = {
			id: 'enc-test',
			round: 3,
			turnIndex: 0,
			initiativeOrder: ['pc-1', 'npc-goblin'],
			combatants: [
				{
					id: 'pc-1', referenceId: 'pc-1', type: 'character' as const,
					name: 'Hero', initiative: 15, currentHp: 30, maxHp: 44,
					tempHp: 0, ac: 16, conditions: [], resistances: [],
					immunities: [], vulnerabilities: [], concentration: false, defeated: false
				},
				{
					id: 'npc-goblin', referenceId: 'npc-goblin', type: 'npc' as const,
					name: 'Goblin', initiative: 10, currentHp: 0, maxHp: 7,
					tempHp: 0, ac: 15, conditions: [], resistances: [],
					immunities: [], vulnerabilities: [], concentration: false, defeated: true
				}
			],
			status: 'active',
			startedAt: Date.now() - 60000
		};

		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The goblin falls! Victory!', {
			encounterEnded: { outcome: 'victory' }
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I strike the goblin', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const savedState = mockPersistTurnAndSaveState.mock.calls[0][2];
		// Active encounter should be cleared
		expect(savedState.activeEncounter).toBeUndefined();

		// Character should have received XP (CR 0.25 = 50 XP, split among 1 PC = 50)
		expect(savedState.characters[0].xp).toBe(50);
	});

	it('broadcasts game:combat-start event on encounter start', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('Wolves attack!', {
			encounterStarted: {
				creatures: [
					{ id: 'npc-w1', name: 'Dire Wolf', role: 'hostile', locationId: 'loc-1', disposition: -100, description: 'Wolf', tier: 'normal' }
				]
			}
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Fight!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Check that notifyRoom was called with a combat-start event
		// notifyRoom(host, roomId, eventBody) — event is call[2]
		const combatStartCalls = mockNotifyRoom.mock.calls.filter(
			(call: unknown[]) => (call[2] as Record<string, unknown>).type === 'game:combat-start'
		);
		expect(combatStartCalls.length).toBe(1);
		const event = combatStartCalls[0][2];
		expect(event.enemies).toContain('Dire Wolf');
	});

	it('broadcasts game:combat-end event on encounter end', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-rat', name: 'Rat', role: 'hostile' as const,
			locationId: 'loc-1', disposition: -100, description: 'A rat',
			notes: '', alive: true,
			statBlock: {
				hp: 4, maxHp: 4, ac: 10,
				abilities: { str: 2, dex: 11, con: 9, int: 2, wis: 10, cha: 4 },
				speed: 20, cr: 0,
				attacks: [{ name: 'Bite', toHit: 0, damage: '1', damageType: 'piercing' }],
				savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		state.activeEncounter = {
			id: 'enc-123', round: 2, turnIndex: 0,
			initiativeOrder: ['pc-1', 'npc-rat'],
			combatants: [
				{ id: 'pc-1', referenceId: 'pc-1', type: 'character' as const, name: 'Hero', initiative: 12, currentHp: 40, maxHp: 44, tempHp: 0, ac: 16, conditions: [], resistances: [], immunities: [], vulnerabilities: [], concentration: false, defeated: false },
				{ id: 'npc-rat', referenceId: 'npc-rat', type: 'npc' as const, name: 'Rat', initiative: 5, currentHp: 0, maxHp: 4, tempHp: 0, ac: 10, conditions: [], resistances: [], immunities: [], vulnerabilities: [], concentration: false, defeated: false }
			],
			status: 'active', startedAt: Date.now() - 30000
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('The rat is slain!', {
			encounterEnded: { outcome: 'victory' }
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Strike!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const combatEndCalls = mockNotifyRoom.mock.calls.filter(
			(call: unknown[]) => (call[2] as Record<string, unknown>).type === 'game:combat-end'
		);
		expect(combatEndCalls.length).toBe(1);
		const event = combatEndCalls[0][2];
		expect(event.outcome).toBe('victory');
		expect(event.xpAwarded).toBeGreaterThanOrEqual(0);
	});

	it('flee outcome maps to fled in combat-end event', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeBaseState();
		state.npcs = [{
			id: 'npc-orc', name: 'Orc', role: 'hostile' as const,
			locationId: 'loc-1', disposition: -100, description: 'An orc',
			notes: '', alive: true,
			statBlock: {
				hp: 15, maxHp: 15, ac: 13,
				abilities: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
				speed: 30, cr: 0.5,
				attacks: [{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }],
				savingThrows: [], skills: [],
				resistances: [], immunities: [], vulnerabilities: [],
				traits: [], actions: [], legendaryActions: []
			}
		}];
		state.activeEncounter = {
			id: 'enc-flee', round: 1, turnIndex: 0,
			initiativeOrder: ['pc-1', 'npc-orc'],
			combatants: [
				{ id: 'pc-1', referenceId: 'pc-1', type: 'character' as const, name: 'Hero', initiative: 14, currentHp: 10, maxHp: 44, tempHp: 0, ac: 16, conditions: [], resistances: [], immunities: [], vulnerabilities: [], concentration: false, defeated: false },
				{ id: 'npc-orc', referenceId: 'npc-orc', type: 'npc' as const, name: 'Orc', initiative: 8, currentHp: 15, maxHp: 15, tempHp: 0, ac: 13, conditions: [], resistances: [], immunities: [], vulnerabilities: [], concentration: false, defeated: false }
			],
			status: 'active', startedAt: Date.now() - 30000
		};
		mockLoadGameState.mockResolvedValue(state);
		mockTwoPassResponse('You flee!', {
			encounterEnded: { outcome: 'flee' }
		});

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'Run!', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const combatEndCalls = mockNotifyRoom.mock.calls.filter(
			(call: unknown[]) => (call[2] as Record<string, unknown>).type === 'game:combat-end'
		);
		expect(combatEndCalls.length).toBe(1);
		expect(combatEndCalls[0][2].outcome).toBe('fled');

		// No XP for fleeing
		expect(combatEndCalls[0][2].xpAwarded).toBe(0);
	});

	it('sanitizer defaults tier to normal for invalid values', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = makeBaseState();
		const result = sanitizeStateChanges({
			encounterStarted: {
				creatures: [{
					id: 'npc-x', name: 'Monster', role: 'hostile',
					locationId: 'loc-1', disposition: -100, description: 'A monster',
					tier: 'legendary' // invalid tier
				}]
			}
		} as unknown as Record<string, unknown>, state as any);
		// The creature should be kept but tier defaulted to 'normal'
		expect(result.encounterStarted).toBeDefined();
		const creature = result.encounterStarted!.creatures[0] as unknown as Record<string, unknown>;
		expect(creature.tier).toBe('normal');
	});
});

// ---------------------------------------------------------------------------
// Phase 8j: Event broadcasting — mid-round shortcut path
// ---------------------------------------------------------------------------

describe('Phase 8j: mid-round shortcut broadcasts dice-roll and combat-turn', () => {
	beforeEach(() => resetAllMocks());

	/** Create a 2-PC + 1-NPC state with an active encounter where pc-1 is awaiting. */
	function makeStateTwoPC() {
		const pc1 = {
			id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Hero',
			race: 'human', classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
			classSpells: [], pactSlots: [], level: 5,
			abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
			hp: 44, maxHp: 44, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
			proficiencyBonus: 3, skillProficiencies: [], expertiseSkills: [],
			saveProficiencies: ['str', 'con'], languages: ['common'],
			armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
			classFeatures: [], feats: [], spellSlots: [], concentratingOn: null,
			deathSaves: { successes: 0, failures: 0 }, inspiration: false,
			passivePerception: 11, inventory: [], gold: 100, xp: 0, conditions: [],
			resistances: [], exhaustionLevel: 0, stable: false, dead: false,
			featureUses: {}, attunedItems: [], backstory: ''
		};
		const pc2 = {
			...pc1, id: 'pc-2', userId: 'user-2', name: 'Sidekick',
			hp: 40, maxHp: 40, ac: 14
		};
		const goblin: NPC = {
			id: 'npc-goblin', name: 'Goblin', role: 'hostile',
			locationId: 'loc-1', disposition: -100, description: 'A goblin',
			notes: '', alive: true,
			statBlock: {
				hp: 120, maxHp: 120, ac: 15,
				abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
				speed: 30, cr: 5,
				attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2', damageType: 'slashing' }],
				savingThrows: [], skills: [],
				resistances: [], immunities: [],
				vulnerabilities: [], traits: [], actions: [], legendaryActions: []
			}
		};

		return {
			version: 3, stateVersion: 3, nextTurnNumber: 1, turnLog: [],
			characters: [pc1, pc2],
			npcs: [goblin],
			locations: [{ id: 'loc-1', name: 'Forest Clearing', type: 'wilderness', description: 'A clearing.', features: [], connections: [], npcs: [], regionRef: null, visited: true }],
			quests: [], conditionEffects: {},
			partyLocationId: 'loc-1',
			clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
			sceneFacts: [], worldSeed: 'test-seed',
			createdAt: Date.now(), updatedAt: Date.now(),
			activeEncounter: {
				id: 'enc-1',
				round: 1,
				turnIndex: 0,
				initiativeOrder: ['pc-1', 'pc-2', 'npc-goblin'],
				awaitingActorId: 'pc-1',
				roundActions: [],
				combatants: [
					{
						id: 'pc-1', referenceId: 'pc-1', type: 'character' as const,
						name: 'Hero', initiative: 18, currentHp: 44, maxHp: 44,
						tempHp: 0, ac: 16, conditions: [], resistances: [],
						immunities: [], vulnerabilities: [], concentration: false, defeated: false
					},
					{
						id: 'pc-2', referenceId: 'pc-2', type: 'character' as const,
						name: 'Sidekick', initiative: 12, currentHp: 40, maxHp: 40,
						tempHp: 0, ac: 14, conditions: [], resistances: [],
						immunities: [], vulnerabilities: [], concentration: false, defeated: false
					},
					{
						id: 'npc-goblin', referenceId: 'npc-goblin', type: 'npc' as const,
						name: 'Goblin', initiative: 8, currentHp: 120, maxHp: 120,
						tempHp: 0, ac: 15, conditions: [], resistances: [],
						immunities: [], vulnerabilities: [], concentration: false, defeated: false
					}
				],
				status: 'active',
				startedAt: Date.now() - 60000
			}
		};
	}

	it('mid-round attack broadcasts game:dice-roll with label and result fields (Phase 8j)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateTwoPC();
		mockLoadGameState.mockResolvedValue(state);

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I attack the goblin', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Mid-round path fires when roundComplete === false
		const diceRollCalls = mockNotifyRoom.mock.calls.filter(
			(call: unknown[]) => (call[2] as Record<string, unknown>).type === 'game:dice-roll'
		);
		// At least one roll (attack roll) was broadcast
		expect(diceRollCalls.length).toBeGreaterThanOrEqual(1);
		const firstRoll = diceRollCalls[0][2] as Record<string, unknown>;
		expect(firstRoll).toHaveProperty('label');
		expect(firstRoll).toHaveProperty('result');
	});

	it('mid-round attack broadcasts game:combat-turn pointing to next combatant (Phase 8j)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateTwoPC();
		mockLoadGameState.mockResolvedValue(state);

		const { executeAdventureTurn } = await import('./adventure-turn');
		await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I attack the goblin', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		const combatTurnCalls = mockNotifyRoom.mock.calls.filter(
			(call: unknown[]) => (call[2] as Record<string, unknown>).type === 'game:combat-turn'
		);
		expect(combatTurnCalls.length).toBe(1);
		const event = combatTurnCalls[0][2] as Record<string, unknown>;
		// Round is not yet complete — another combatant is still waiting
		expect(event.roundComplete).toBe(false);
		// Next combatant should be pc-2 (Sidekick), the next human turn
		expect(event.nextCombatantId).toBe('pc-2');
		expect(event.nextCombatantName).toBe('Sidekick');
	});

	it('mid-round turn returns empty narrative (no AI call) (Phase 8j)', async () => {
		process.env.PARTYKIT_HOST = 'party.local';
		process.env.OPENAI_API_KEY = 'sk-test';
		const state = makeStateTwoPC();
		mockLoadGameState.mockResolvedValue(state);

		const { executeAdventureTurn } = await import('./adventure-turn');
		const result = await executeAdventureTurn(
			{ adventureId: 'adv-1', playerAction: 'I attack the goblin', actorUserId: 'user-1',
			  history: [{ role: 'system', content: 'GM prompt' }], recentChat: [] },
			{ purpose: 'interactive-chat', mode: 'inline', model: 'gpt-4o', stream: false }
		);

		// Mid-round shortcut returns no narrative
		expect(result.narrativeText).toBe('');
		// AI should NOT be called
		expect(mockCompleteChat).not.toHaveBeenCalled();
		expect(mockCompleteChatJSON).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Phase A: combat-start hardening — content-based gating
// ---------------------------------------------------------------------------

describe('Phase A: sanitizeStateChanges — encounterStarted content gating', () => {
	beforeEach(() => { mockPersistTurnAndSaveState.mockReset(); });

	function makeMinimalStateForSanitize() {
		return {
			version: 3, stateVersion: 3, worldSeed: 'test', createdAt: Date.now(), updatedAt: Date.now(),
			nextTurnNumber: 1, turnLog: [], characters: [], npcs: [], locations: [], quests: [],
			partyLocationId: null, clock: { day: 1, timeOfDay: 'morning', weather: 'clear' }, sceneFacts: []
		};
	}

	const creaturePayload = {
		encounterStarted: {
			creatures: [{
				id: 'npc-wolf', name: 'Dire Wolf', role: 'hostile',
				locationId: 'loc-1', disposition: -100, description: 'A large wolf'
			}] as NPC[]
		}
	};

	it('allows encounterStarted when narrative contains explicit combat evidence', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'The wolves snarl and charge at you! Roll for initiative!';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeDefined();
		expect(result.encounterStarted!.creatures).toHaveLength(1);
	});

	it('strips encounterStarted when narrative is pure reconnaissance', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'You peer through the undergrowth and spot a pack of wolves resting by the stream.';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeUndefined();
	});

	it('strips encounterStarted when narrative describes scouting', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'From your vantage point, you can see goblin sentries patrolling the perimeter of the camp.';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeUndefined();
	});

	it('allows encounterStarted with "attacks you" in narrative', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'A dire wolf leaps from the shadows and attacks you with savage fury!';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeDefined();
	});

	it('allows encounterStarted with "ambush" in narrative', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'As you round the corner, bandits spring an ambush from the rooftops!';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeDefined();
	});

	it('allows encounterStarted with "draws a sword" in narrative', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'The guard sneers and draws a sword, stepping forward menacingly.';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeDefined();
	});

	it('allows encounterStarted with "combat begins" in narrative', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const narrative = 'The orcs roar and combat begins as they rush across the field!';
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any, narrative);
		expect(result.encounterStarted).toBeDefined();
	});

	it('allows encounterStarted with no narrative (legacy single-pass mode)', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const result = sanitizeStateChanges(creaturePayload, makeMinimalStateForSanitize() as any);
		expect(result.encounterStarted).toBeDefined();
	});

	it('strips encounterStarted when an encounter is already active', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const state = {
			...makeMinimalStateForSanitize(),
			activeEncounter: {
				status: 'active',
				combatants: [],
				round: 1,
				turnIndex: 0,
				roundActions: []
			}
		};
		const narrative = 'More goblins pour in! Roll for initiative!';
		const result = sanitizeStateChanges(creaturePayload, state as any, narrative);
		expect(result.encounterStarted).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Phase D: combatAction/enemyCombatActions sanitizer backward compat
// ---------------------------------------------------------------------------

describe('Phase D: combatAction/enemyCombatActions backward compat', () => {
	beforeEach(() => resetAllMocks());

	it('sanitizer still passes valid combatAction through for old data', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const sc = {
			combatAction: { targetId: 'comb-1', type: 'attack' as const }
		};
		const state = {
			characters: [],
			npcs: [],
			locations: [],
			quests: [],
			partyLocationId: null,
			sceneFacts: [],
			journal: []
		};
		const result = sanitizeStateChanges(sc, state as any, 'attacks the goblin');
		expect(result.combatAction).toEqual({ targetId: 'comb-1', type: 'attack' });
	});

	it('sanitizer strips combatAction missing targetId', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const sc = {
			combatAction: { type: 'attack' } as any
		};
		const state = {
			characters: [],
			npcs: [],
			locations: [],
			quests: [],
			partyLocationId: null,
			sceneFacts: [],
			journal: []
		};
		const result = sanitizeStateChanges(sc, state as any, 'attacks');
		expect(result.combatAction).toBeUndefined();
	});

	it('sanitizer still passes valid enemyCombatActions through for old data', async () => {
		const { sanitizeStateChanges } = await import('./adventure-turn');
		const sc = {
			enemyCombatActions: [
				{ npcId: 'npc-1', targetId: 'pc-1', attackIndex: 0 }
			]
		};
		const state = {
			characters: [],
			npcs: [],
			locations: [],
			quests: [],
			partyLocationId: null,
			sceneFacts: [],
			journal: []
		};
		const result = sanitizeStateChanges(sc, state as any, 'combat');
		expect(result.enemyCombatActions).toHaveLength(1);
		expect(result.enemyCombatActions![0].npcId).toBe('npc-1');
	});
});

// ---------------------------------------------------------------------------
// Phase D: TurnDebugData expanded fields
// ---------------------------------------------------------------------------

describe('Phase D: TurnDebugData expanded mode union', () => {
	it('mid-round is a valid TurnDebugData mode', async () => {
		// Import the type system to ensure 'mid-round' compiles
		const debugData: import('./adventure-turn').TurnDebugData = {
			mode: 'mid-round',
			model: 'server-executor',
			messages: [],
			rawAiResponse: '',
			engineStateChanges: {},
			mergedStateChanges: {},
			latencyMs: 0,
			engineIntent: 'attack',
			engineResolvedCombat: true,
			roundComplete: false
		};
		expect(debugData.mode).toBe('mid-round');
		expect(debugData.engineIntent).toBe('attack');
		expect(debugData.engineResolvedCombat).toBe(true);
		expect(debugData.roundComplete).toBe(false);
	});

	it('awaiting-roll mode includes pendingCheck in debug data', () => {
		const debugData: import('./adventure-turn').TurnDebugData = {
			mode: 'awaiting-roll',
			model: 'server-executor',
			messages: [],
			rawAiResponse: '',
			engineStateChanges: {},
			mergedStateChanges: {},
			latencyMs: 0,
			engineIntent: 'default',
			pendingCheck: {
				id: 'chk-1',
				kind: 'skill',
				characterId: 'char-1',
				ability: 'wis',
				skill: 'perception',
				dc: 12,
				advantageState: 'normal',
				reason: 'Listening for footsteps',
				combatBound: false
			}
		};
		expect(debugData.pendingCheck?.skill).toBe('perception');
		expect(debugData.pendingCheck?.dc).toBe(12);
	});
});