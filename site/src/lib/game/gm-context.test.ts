/**
 * GM Context Unit Tests — Multiclass-aware context assembly.
 *
 * Tests cover:
 *   - formatCharacterBrief renders multiclass class stacks
 *   - formatCharacterBrief includes per-class spell info (DC/attack)
 *   - formatCharacterBrief includes slot and pact slot summaries
 *   - assembleGMContext produces well-formed messages
 *   - buildWorldBrief truncation and structure
 */

import { describe, it, expect } from 'vitest';
import { assembleGMContext, assembleNarratorContext, assembleRoundNarratorContext, buildWorldBrief, formatMechanicSummaryForNarrator, assembleNarrativeGMContext, buildStateExtractionPrompt, assembleStateExtractionContext, MAX_HISTORY_TURNS, MAX_NARRATOR_HISTORY_TURNS } from './gm-context';
import type { GameState, PlayerCharacter, TurnRecord, Location, Quest, NPC, PendingCombatAction, Combatant, ActiveEncounter, MechanicResult } from './types';
import { DEFAULT_CONDITION_EFFECTS, GAME_STATE_VERSION } from './types';
import type { ResolvedTurn } from '$lib/server/ai/turn-executor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLoc(): Location {
	return {
		id: 'loc-1',
		name: 'Town Square',
		type: 'settlement',
		description: 'A bustling square.',
		features: [],
		connections: [],
		npcs: [],
		regionRef: null,
		visited: true
	};
}

function makeMinimalState(characters: PlayerCharacter[] = []): GameState {
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters,
		npcs: [],
		locations: [makeLoc()],
		quests: [],
		conditionEffects: DEFAULT_CONDITION_EFFECTS,
		partyLocationId: 'loc-1',
		clock: { day: 1, timeOfDay: 'morning', weather: 'clear' },
		turnLog: [],
		worldSeed: 'seed-42',
		nextTurnNumber: 1,
		sceneFacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

function makeSingleClassFighter(): PlayerCharacter {
	return {
		id: 'char-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Conan',
		race: 'human',
		classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
		classSpells: [],
		pactSlots: [],
		level: 5,
		abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
		hp: 44,
		maxHp: 44,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 3,
		skillProficiencies: ['athletics', 'perception'],
		expertiseSkills: [],
		saveProficiencies: ['str', 'con'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		classFeatures: [{ name: 'Second Wind', level: 1, source: 'class', sourceClass: 'fighter' }],
		feats: [],
		spellSlots: [],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 14,
		inventory: [
			{ id: 'w1', name: 'Longsword', category: 'weapon', weaponName: 'longsword', description: '', damage: '1d8', damageType: 'slashing', magicBonus: 0, properties: [], value: 15, quantity: 1, weight: 3, rarity: 'common', attunement: false, equipped: true }
		],
		gold: 50,
		xp: 6500,
		conditions: [],
		resistances: [],
		exhaustionLevel: 0,
		stable: false,
		dead: false,
		featureUses: { 'Second Wind': { current: 1, max: 1, recoversOn: 'short-rest' } },
		attunedItems: [],
		backstory: ''
	};
}

function makeMulticlassWizardCleric(): PlayerCharacter {
	return {
		...makeSingleClassFighter(),
		id: 'char-2',
		name: 'Elminster',
		classes: [
			{ name: 'wizard', level: 5, hitDiceRemaining: 5 },
			{ name: 'cleric', level: 3, hitDiceRemaining: 3 }
		],
		classSpells: [
			{
				className: 'wizard',
				spellcastingAbility: 'int',
				cantrips: ['fire-bolt', 'mage-hand'],
				knownSpells: ['magic-missile', 'shield'],
				preparedSpells: ['magic-missile', 'shield']
			},
			{
				className: 'cleric',
				spellcastingAbility: 'wis',
				cantrips: ['sacred-flame'],
				knownSpells: [],
				preparedSpells: ['cure-wounds', 'bless']
			}
		],
		pactSlots: [],
		level: 8,
		abilities: { str: 10, dex: 14, con: 14, int: 18, wis: 16, cha: 8 },
		proficiencyBonus: 3,
		spellSlots: [
			{ level: 1, current: 4, max: 4 },
			{ level: 2, current: 3, max: 3 },
			{ level: 3, current: 2, max: 2 }
		],
		inventory: []
	};
}

function makePaladinWarlock(): PlayerCharacter {
	return {
		...makeSingleClassFighter(),
		id: 'char-3',
		name: 'Hexblade Pally',
		classes: [
			{ name: 'paladin', level: 6, hitDiceRemaining: 6 },
			{ name: 'warlock', level: 3, hitDiceRemaining: 3 }
		],
		classSpells: [
			{
				className: 'paladin',
				spellcastingAbility: 'cha',
				cantrips: [],
				knownSpells: [],
				preparedSpells: ['cure-wounds', 'bless']
			},
			{
				className: 'warlock',
				spellcastingAbility: 'cha',
				cantrips: ['eldritch-blast'],
				knownSpells: ['hex', 'armor-of-agathys'],
				preparedSpells: []
			}
		],
		pactSlots: [{ level: 2, current: 2, max: 2 }],
		level: 9,
		abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 18 },
		proficiencyBonus: 4,
		spellSlots: [
			{ level: 1, current: 4, max: 4 },
			{ level: 2, current: 2, max: 2 }
		],
		inventory: []
	};
}

// ===========================================================================
// Character Brief in GM context
// ===========================================================================

describe('GM context — formatCharacterBrief (via assembleGMContext)', () => {
	it('renders single-class fighter with no spell info', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack the goblin');
		const system = messages.find((m) => m.role === 'system');
		expect(system).toBeDefined();
		expect(system!.content).toContain('Conan');
		expect(system!.content).toContain('Lv5');
		expect(system!.content).toContain('fighter');
		expect(system!.content).toContain('44/44 HP');
		expect(system!.content).toContain('AC 18');
		// No spell info for non-caster
		expect(system!.content).not.toContain('Spells:');
	});

	it('renders multiclass wizard/cleric with class stack', () => {
		const state = makeMinimalState([makeMulticlassWizardCleric()]);
		const messages = assembleGMContext(state, null, [], 'I cast fireball');
		const system = messages.find((m) => m.role === 'system')!;
		// Should show wizard 5/cleric 3 class stack
		expect(system.content).toContain('wizard 5');
		expect(system.content).toContain('cleric 3');
		expect(system.content).toContain('Lv8');
	});

	it('includes per-class spell DC and attack bonus for dual casters', () => {
		const state = makeMinimalState([makeMulticlassWizardCleric()]);
		const messages = assembleGMContext(state, null, [], 'I cast fireball');
		const system = messages.find((m) => m.role === 'system')!;
		// Should include wizard and cleric spell info
		expect(system.content).toContain('wizard(DC');
		expect(system.content).toContain('cleric(DC');
	});

	it('includes slot summary in brief', () => {
		const state = makeMinimalState([makeMulticlassWizardCleric()]);
		const messages = assembleGMContext(state, null, [], 'I cast fireball');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Slots:');
		expect(system.content).toContain('L1:');
	});

	it('includes pact slot summary for warlock multiclass', () => {
		const state = makeMinimalState([makePaladinWarlock()]);
		const messages = assembleGMContext(state, null, [], 'I smite');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Pact:');
		expect(system.content).toContain('L2:2/2');
	});

	it('does not include pact info for non-warlock characters', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('Pact:');
	});
});

// ===========================================================================
// assembleGMContext structure
// ===========================================================================

describe('assembleGMContext — message structure', () => {
	it('produces system + user messages for a fresh turn', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'Hello world');
		expect(messages[0].role).toBe('system');
		expect(messages[messages.length - 1].role).toBe('user');
		expect(messages[messages.length - 1].content).toContain('Hello world');
	});

	it('includes conversation history as user/assistant pairs', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [{
			id: 'turn-1',
			turnNumber: 1,
			actorType: 'player',
			actorId: 'user-1',
			action: 'I open the door',
			intent: 'examine',
			status: 'completed',
			resolvedActionSummary: '',
			narrativeText: 'The door creaks open to reveal a dark hallway.',
			mechanicResults: [],
			stateChanges: {},
			timestamp: Date.now()
		}];
		const messages = assembleGMContext(state, null, turns, 'I go inside');
		// system, then history user, history assistant, then current user
		expect(messages.length).toBe(4);
		expect(messages[1].role).toBe('user');
		expect(messages[1].content).toContain('I open the door');
		expect(messages[2].role).toBe('assistant');
		expect(messages[2].content).toContain('dark hallway');
	});

	it('includes location and quest info in system prompt', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [{
			id: 'q-1',
			name: 'Goblin Slayer',
			description: 'Kill the goblins',
			status: 'active',
			objectives: [{ id: 'obj-1', text: 'Find the cave', done: false }],
			giverNpcId: null,
			rewards: { xp: 100, gold: 50, items: [], reputationChanges: [] },
			recommendedLevel: 1,
			encounterTemplates: ['minion']
		}];
		const messages = assembleGMContext(state, null, [], 'What now?');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Town Square');
		expect(system.content).toContain('Goblin Slayer');
	});

	it('includes mechanic results in current action', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack', [
			{ type: 'attack-roll', label: 'Attack Roll', dice: { notation: '1d20+5', rolls: [15], total: 20 }, dc: 14, success: true }
		]);
		const lastMsg = messages[messages.length - 1];
		expect(lastMsg.content).toContain('[Mechanics:');
		expect(lastMsg.content).toContain('Attack Roll');
	});
});

// ===========================================================================
// Decision rubric (Step 6) and world-building format (Step 7)
// ===========================================================================

describe('GM context — decision rubric and world-building format', () => {
	it('includes discretion rules in system prompt', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('DISCRETION RULES');
		expect(system.content).toContain('YOU MAY freely');
		expect(system.content).toContain('YOU MUST NOT');
		expect(system.content).toContain('WHEN AMBIGUOUS');
	});

	it('rubric allows broad interpretation but forbids silent resource spending', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Infer the nearest enemy');
		expect(system.content).toContain('Silently choose between multiple materially different resource expenditures');
		expect(system.content).toContain('action economy');
	});

	it('response format includes npcsAdded, locationsAdded, questsAdded', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I talk to the NPC');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('npcsAdded');
		expect(system.content).toContain('locationsAdded');
		expect(system.content).toContain('questsAdded');
		expect(system.content).toContain('sceneFactsAdded');
	});

	it('response format instructs unique ID prefixes for new entities', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I explore');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('npc-');
		expect(system.content).toContain('loc-');
		expect(system.content).toContain('quest-');
	});

	it('narrator prompt does NOT include discretion rules or JSON format', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, [], rt);
		const system = messages[0].content;
		expect(system).not.toContain('DISCRETION RULES');
		expect(system).not.toContain('npcsAdded');
		expect(system).not.toContain('JSON RESPONSE FORMAT');
	});
});

// ===========================================================================
// Narrator context (Step 3 – AI role separation)
// ===========================================================================

function makeResolvedTurn(overrides: Partial<ResolvedTurn> = {}): ResolvedTurn {
	return {
		status: 'ready-for-narration',
		intent: {
			rawAction: 'I drink the healing potion',
			primaryIntent: 'use-item',
			mentionsHealing: true,
			mentionsPotion: true,
			mentionsPoison: false,
			mentionsCamp: false,
			mentionsWait: false,
			targetHint: 'none'
		},
		actorId: 'char-1',
		targets: [{ id: 'i1', type: 'item', name: 'Potion of Healing' }],
		resourcesConsumed: [{ type: 'item', label: 'Potion of Healing', amount: 1 }],
		resolvedActionSummary: 'Used Potion of Healing on self',
		mechanicResults: [
			{
				type: 'healing',
				label: 'Potion of Healing',
				dice: { notation: '2d4+2', rolls: [3, 4], total: 9 },
				success: true
			}
		],
		stateChanges: {
			hpChanges: [{ characterId: 'char-1', oldHp: 20, newHp: 29, reason: 'Potion of Healing' }],
			itemsLost: [{ characterId: 'char-1', itemId: 'i1', quantity: 1 }]
		},
		...overrides
	};
}

describe('formatMechanicSummaryForNarrator', () => {
	it('includes intent, action, and mechanic results', () => {
		const rt = makeResolvedTurn();
		const summary = formatMechanicSummaryForNarrator(rt);
		expect(summary).toContain('RESOLVED ACTION');
		expect(summary).toContain('I drink the healing potion');
		expect(summary).toContain('INTENT: use-item');
		expect(summary).toContain('HEALING: Potion of Healing');
		expect(summary).toContain('2d4+2');
		expect(summary).toContain('(succeeded)');
	});

	it('includes HP changes', () => {
		const rt = makeResolvedTurn();
		const summary = formatMechanicSummaryForNarrator(rt);
		expect(summary).toContain('HP CHANGES');
		expect(summary).toContain('20 → 29 HP');
	});

	it('includes clock advance when present', () => {
		const rt = makeResolvedTurn({
			stateChanges: {
				clockAdvance: {
					from: { day: 1, timeOfDay: 'morning', weather: 'clear' },
					to: { day: 1, timeOfDay: 'afternoon', weather: 'clear' }
				}
			}
		});
		const summary = formatMechanicSummaryForNarrator(rt);
		expect(summary).toContain('TIME:');
		expect(summary).toContain('morning');
		expect(summary).toContain('afternoon');
	});

	it('includes spell slot usage when present', () => {
		const rt = makeResolvedTurn({
			stateChanges: {
				spellSlotUsed: { characterId: 'char-1', level: 1, spellName: 'cure-wounds' }
			},
			intent: { rawAction: 'I cast cure wounds', primaryIntent: 'cast-spell', mentionsHealing: true, mentionsPotion: false, mentionsPoison: false, mentionsCamp: false, mentionsWait: false, targetHint: 'none' }
		});
		const summary = formatMechanicSummaryForNarrator(rt);
		expect(summary).toContain('SPELL SLOT');
		expect(summary).toContain('level 1');
		expect(summary).toContain('cure-wounds');
	});

	it('includes items consumed count', () => {
		const rt = makeResolvedTurn({
			stateChanges: {
				itemsLost: [
					{ characterId: 'char-1', itemId: 'i1', quantity: 1 },
					{ characterId: 'char-1', itemId: 'i2', quantity: 1 }
				]
			}
		});
		const summary = formatMechanicSummaryForNarrator(rt);
		expect(summary).toContain('ITEMS CONSUMED: 2 item(s)');
	});
});

describe('assembleNarratorContext', () => {
	it('produces system + history + user messages', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, [], rt);
		expect(messages.length).toBeGreaterThanOrEqual(2);
		expect(messages[0].role).toBe('system');
		expect(messages[messages.length - 1].role).toBe('user');
	});

	it('system prompt tells AI to narrate (not produce JSON)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, [], rt);
		const system = messages[0].content;
		expect(system).toContain('Narrator');
		expect(system).toContain('ALREADY resolved');
		expect(system).toContain('FACTS');
		expect(system).toContain('Do NOT return JSON');
		// Should NOT include JSON RESPONSE FORMAT
		expect(system).not.toContain('JSON RESPONSE FORMAT');
		expect(system).not.toContain('narrativeText');
	});

	it('system prompt includes party and location info', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, [], rt);
		const system = messages[0].content;
		expect(system).toContain('Conan');
		expect(system).toContain('Town Square');
	});

	it('user message contains the mechanic summary facts', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, [], rt);
		const user = messages[messages.length - 1].content;
		expect(user).toContain('I drink the healing potion');
		expect(user).toContain('MECHANIC RESULTS');
		expect(user).toContain('HEALING: Potion of Healing');
		expect(user).toContain('Narrate what happens');
	});

	it('includes conversation history from recent turns', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [{
			id: 'turn-1',
			turnNumber: 1,
			actorType: 'player',
			actorId: 'user-1',
			action: 'I search the room',
			intent: 'examine',
			status: 'completed',
			resolvedActionSummary: '',
			narrativeText: 'You find a dusty chest.',
			mechanicResults: [],
			stateChanges: {},
			timestamp: Date.now()
		}];
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, turns, rt);
		// system, history-user, history-assistant, current-user
		expect(messages.length).toBe(4);
		expect(messages[1].content).toContain('I search the room');
		expect(messages[2].content).toContain('dusty chest');
	});
});

// ===========================================================================
// Phase 0 — Scene facts surfaced in system prompt
// ===========================================================================

describe('GM context — ESTABLISHED FACTS in system prompt', () => {
	it('includes scene facts in the system prompt when present', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.sceneFacts = [
			'The bridge is closed for repairs',
			'Bjorik agreed to join for 5gp/day'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('ESTABLISHED FACTS');
		expect(system.content).toContain('The bridge is closed for repairs');
		expect(system.content).toContain('Bjorik agreed to join for 5gp/day');
	});

	it('does NOT include ESTABLISHED FACTS section when sceneFacts is empty', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.sceneFacts = [];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('ESTABLISHED FACTS');
	});

	it('shows at most the last 20 facts', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.sceneFacts = Array.from({ length: 30 }, (_, i) => `Fact ${i + 1}`);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// First 10 should NOT appear (only last 20 shown)
		expect(system.content).not.toContain('Fact 1\n');
		expect(system.content).not.toContain('Fact 10\n');
		// Last 20 should appear
		expect(system.content).toContain('Fact 11');
		expect(system.content).toContain('Fact 30');
	});
});

// ===========================================================================
// Phase 1 — Prompt Grounding Overhaul
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared NPC + Location helpers for Phase 1 tests
// ---------------------------------------------------------------------------

function makeNpc(overrides: Partial<NPC> = {}): NPC {
	return {
		id: 'npc-1',
		name: 'Gareth the Trader',
		role: 'merchant',
		locationId: 'loc-1',
		disposition: 20,
		description: 'A jovial half-elf',
		notes: '',
		alive: true,
		...overrides
	};
}

function makeLoc2(overrides: Partial<Location> = {}): Location {
	return {
		id: 'loc-2',
		name: 'Dark Forest',
		type: 'wilderness',
		description: 'A dense forest.',
		features: ['ancient trees', 'misty paths'],
		connections: ['loc-1'],
		npcs: [],
		regionRef: null,
		visited: false,
		...overrides
	};
}

// ===========================================================================
// Item 4 — KNOWN NPCs section
// ===========================================================================

describe('Phase 1: KNOWN NPCs section', () => {
	it('shows NPCs at remote locations grouped by location', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-1', name: 'Guard', role: 'neutral', locationId: 'loc-2' }),
			makeNpc({ id: 'npc-2', name: 'Merchant', role: 'merchant', locationId: 'loc-2' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('KNOWN NPCs (away from party)');
		expect(system.content).toContain('At Dark Forest:');
		expect(system.content).toContain('Guard[npc-1]');
		expect(system.content).toContain('Merchant[npc-2]');
	});

	it('does NOT show dead NPCs in KNOWN NPCs', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-dead', name: 'Dead Bandit', locationId: 'loc-2', alive: false }),
			makeNpc({ id: 'npc-alive', name: 'Live Bandit', locationId: 'loc-2', alive: true })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Live Bandit');
		expect(system.content).not.toContain('Dead Bandit');
	});

	it('does NOT show NPCs at current location in KNOWN NPCs section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-local', name: 'Local Guard', locationId: 'loc-1' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Should appear in CURRENT LOCATION's "NPCs present" instead
		expect(system.content).toContain('Local Guard');
		// But NOT in KNOWN NPCs section
		const knownNpcsIdx = system.content.indexOf('KNOWN NPCs (away from party)');
		// If no remote NPCs exist, the section should not appear at all
		expect(knownNpcsIdx).toBe(-1);
	});

	it('shows local NPCs in CURRENT LOCATION with ID tags and disposition', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-local', name: 'Barkeep', role: 'merchant', locationId: 'loc-1', disposition: 50 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Barkeep[npc-local]');
		expect(system.content).toContain('merchant');
		expect(system.content).toContain('friendly');
	});

	it('sorts known NPCs by role priority (allies first, hostile last)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-hostile', name: 'Bandit', role: 'hostile', locationId: 'loc-2', disposition: -50 }),
			makeNpc({ id: 'npc-ally', name: 'Ranger', role: 'ally', locationId: 'loc-2', disposition: 60 }),
			makeNpc({ id: 'npc-merchant', name: 'Trader', role: 'merchant', locationId: 'loc-2', disposition: 10 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const allyIdx = system.content.indexOf('Ranger[npc-ally]');
		const merchantIdx = system.content.indexOf('Trader[npc-merchant]');
		const hostileIdx = system.content.indexOf('Bandit[npc-hostile]');
		// Ally should appear before merchant, merchant before hostile
		expect(allyIdx).toBeLessThan(merchantIdx);
		expect(merchantIdx).toBeLessThan(hostileIdx);
	});

	it('caps known NPCs at 25', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		// Create 30 NPCs
		for (let i = 0; i < 30; i++) {
			state.npcs.push(makeNpc({ id: `npc-${i}`, name: `NPC ${i}`, locationId: 'loc-2' }));
		}
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Count how many are listed
		const matches = system.content.match(/NPC \d+\[npc-/g);
		expect(matches).not.toBeNull();
		expect(matches!.length).toBeLessThanOrEqual(25);
	});

	it('does NOT show KNOWN NPCs section when no remote NPCs exist', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		// Only local NPCs at current location
		state.npcs = [makeNpc({ locationId: 'loc-1' })];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('KNOWN NPCs (away from party)');
	});

	it('includes disposition labels for known NPCs', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-adore', name: 'Fan', locationId: 'loc-2', disposition: 80 }),
			makeNpc({ id: 'npc-hate', name: 'Enemy', locationId: 'loc-2', disposition: -80 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('adoring');
		expect(system.content).toContain('hateful');
	});

	it('shows disposition labels across the full range', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const loc3 = { ...makeLoc2(), id: 'loc-3', name: 'Place 3' };
		const loc4 = { ...makeLoc2(), id: 'loc-4', name: 'Place 4' };
		const loc5 = { ...makeLoc2(), id: 'loc-5', name: 'Place 5' };
		const loc6 = { ...makeLoc2(), id: 'loc-6', name: 'Place 6' };
		const loc7 = { ...makeLoc2(), id: 'loc-7', name: 'Place 7' };
		state.locations.push(makeLoc2(), loc3, loc4, loc5, loc6, loc7);
		state.npcs = [
			makeNpc({ id: 'npc-a', name: 'Adoring', locationId: 'loc-2', disposition: 90 }),
			makeNpc({ id: 'npc-b', name: 'Friendly', locationId: 'loc-3', disposition: 50 }),
			makeNpc({ id: 'npc-c', name: 'Warm', locationId: 'loc-4', disposition: 15 }),
			makeNpc({ id: 'npc-d', name: 'Neutral', locationId: 'loc-5', disposition: 0 }),
			makeNpc({ id: 'npc-e', name: 'Unfriendly', locationId: 'loc-6', disposition: -30 }),
			makeNpc({ id: 'npc-f', name: 'Hostile', locationId: 'loc-7', disposition: -60 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('adoring');
		expect(system.content).toContain('friendly');
		expect(system.content).toContain('warm');
		expect(system.content).toContain('neutral');
		expect(system.content).toContain('unfriendly');
		expect(system.content).toContain('hostile');
	});

	it('groups NPCs from multiple remote locations separately', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(
			makeLoc2(),
			{ ...makeLoc2(), id: 'loc-3', name: 'Mountain Pass' }
		);
		state.npcs = [
			makeNpc({ id: 'npc-forest', name: 'Druid', locationId: 'loc-2' }),
			makeNpc({ id: 'npc-mountain', name: 'Hermit', locationId: 'loc-3' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('At Dark Forest:');
		expect(system.content).toContain('At Mountain Pass:');
		expect(system.content).toContain('Druid[npc-forest]');
		expect(system.content).toContain('Hermit[npc-mountain]');
	});
});

// ===========================================================================
// Item 5 — COMPANIONS section
// ===========================================================================

describe('Phase 1: COMPANIONS section', () => {
	it('shows ally NPCs at party location as companions', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-bjorik', name: 'Bjorik', role: 'ally', locationId: 'loc-1', disposition: 60 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== COMPANIONS ===');
		expect(system.content).toContain('Bjorik[npc-bjorik]');
		expect(system.content).toContain('participate in combat');
	});

	it('does NOT show COMPANIONS section when no allies are at party location', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		// Ally is at a different location
		state.npcs = [
			makeNpc({ id: 'npc-away', name: 'Distant Ally', role: 'ally', locationId: 'loc-2' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('=== COMPANIONS ===');
	});

	it('includes stat block summary for companions with statBlock', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-bjorik',
				name: 'Bjorik',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 60,
				statBlock: {
					hp: 30,
					maxHp: 35,
					ac: 15,
					abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
					speed: 30,
					cr: 2,
					attacks: [
						{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }
					],
					savingThrows: [],
					skills: [],
					resistances: [],
					immunities: [],
					vulnerabilities: [],
					traits: [],
					actions: [],
					legendaryActions: []
				}
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('30/35 HP');
		expect(system.content).toContain('AC 15');
		expect(system.content).toContain('Greataxe +5');
		expect(system.content).toContain('1d12+3 slashing');
	});

	it('shows companion without stat block gracefully', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-guide', name: 'Guide', role: 'ally', locationId: 'loc-1' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== COMPANIONS ===');
		expect(system.content).toContain('Guide[npc-guide]');
		// Should not crash or show undefined
		expect(system.content).not.toContain('undefined');
	});

	it('does NOT show dead allies in companions', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-dead-ally', name: 'Fallen Hero', role: 'ally', locationId: 'loc-1', alive: false })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('=== COMPANIONS ===');
		expect(system.content).not.toContain('Fallen Hero');
	});

	it('does NOT show non-ally roles (merchant, hostile, etc.) as companions', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-merc', name: 'Merchant', role: 'merchant', locationId: 'loc-1' }),
			makeNpc({ id: 'npc-thug', name: 'Thug', role: 'hostile', locationId: 'loc-1' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('=== COMPANIONS ===');
	});

	it('COMPANIONS section appears after PARTY section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-ally', name: 'Friend', role: 'ally', locationId: 'loc-1' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const partyIdx = system.content.indexOf('=== PARTY ===');
		const companionIdx = system.content.indexOf('=== COMPANIONS ===');
		expect(partyIdx).toBeGreaterThan(-1);
		expect(companionIdx).toBeGreaterThan(-1);
		expect(companionIdx).toBeGreaterThan(partyIdx);
	});
});

// ===========================================================================
// Item 6 — KNOWN LOCATIONS section
// ===========================================================================

describe('Phase 1: KNOWN LOCATIONS section', () => {
	it('shows non-current locations with visited/unvisited tags', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(
			makeLoc2({ visited: true }),
			{ ...makeLoc2(), id: 'loc-3', name: 'Dungeon', type: 'dungeon', visited: false }
		);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== KNOWN LOCATIONS ===');
		expect(system.content).toContain('Dark Forest[loc-2]');
		expect(system.content).toContain('[visited]');
		expect(system.content).toContain('Dungeon[loc-3]');
		expect(system.content).toContain('[unvisited]');
	});

	it('shows connection names for each known location', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		// loc-1 is "Town Square", loc-2 connects to loc-1
		state.locations[0].connections = ['loc-2'];
		state.locations.push(makeLoc2({ connections: ['loc-1'] }));
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const knownLocSection = system.content.substring(
			system.content.indexOf('=== KNOWN LOCATIONS ==='),
			system.content.indexOf('===', system.content.indexOf('=== KNOWN LOCATIONS ===') + 1 + 22)
		);
		expect(knownLocSection).toContain('connects to: Town Square');
	});

	it('does NOT show current location in KNOWN LOCATIONS', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Current location "Town Square" should only appear in CURRENT LOCATION, not KNOWN LOCATIONS
		const knownLocsIdx = system.content.indexOf('=== KNOWN LOCATIONS ===');
		expect(knownLocsIdx).toBeGreaterThan(-1);
		// Extract just the KNOWN LOCATIONS section
		const afterKnown = system.content.substring(knownLocsIdx);
		const nextSection = afterKnown.indexOf('\n===', 5);
		const knownSection = nextSection > 0 ? afterKnown.substring(0, nextSection) : afterKnown;
		// "loc-1" should NOT appear as a known location entry
		expect(knownSection).not.toContain('Town Square[loc-1]');
	});

	it('does NOT show KNOWN LOCATIONS section when only current location exists', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('=== KNOWN LOCATIONS ===');
	});

	it('caps known locations at 15', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		for (let i = 2; i <= 20; i++) {
			state.locations.push({ ...makeLoc2(), id: `loc-${i}`, name: `Place ${i}` });
		}
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const matches = system.content.match(/Place \d+\[loc-/g);
		expect(matches).not.toBeNull();
		expect(matches!.length).toBeLessThanOrEqual(15);
	});

	it('includes location type in the known locations listing', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(
			makeLoc2({ type: 'dungeon' }),
			{ ...makeLoc2(), id: 'loc-3', name: 'Highway', type: 'road' }
		);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('(dungeon)');
		expect(system.content).toContain('(road)');
	});

	it('KNOWN LOCATIONS section appears between CURRENT LOCATION and KNOWN NPCs/PARTY', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const currentLocIdx = system.content.indexOf('=== CURRENT LOCATION ===');
		const knownLocIdx = system.content.indexOf('=== KNOWN LOCATIONS ===');
		const partyIdx = system.content.indexOf('=== PARTY ===');
		expect(currentLocIdx).toBeGreaterThan(-1);
		expect(knownLocIdx).toBeGreaterThan(-1);
		expect(partyIdx).toBeGreaterThan(-1);
		expect(knownLocIdx).toBeGreaterThan(currentLocIdx);
		expect(knownLocIdx).toBeLessThan(partyIdx);
	});
});

// ===========================================================================
// Item 7 — Quests: available + completed + failed
// ===========================================================================

describe('Phase 1: QUESTS section (all statuses)', () => {
	function makeQuest(overrides: Partial<Quest> = {}): Quest {
		return {
			id: 'quest-1',
			name: 'Main Quest',
			description: 'The main quest',
			status: 'active',
			objectives: [{ id: 'obj-1', text: 'Do the thing', done: false }],
			giverNpcId: null,
			rewards: { xp: 100, gold: 50, items: [], reputationChanges: [] },
			recommendedLevel: 1,
			encounterTemplates: [],
			...overrides
		};
	}

	it('shows active quests', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest({ status: 'active' })];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== QUESTS ===');
		expect(system.content).toContain('[active]');
		expect(system.content).toContain('Main Quest');
	});

	it('shows available quests with [available] tag', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest({ id: 'quest-avail', name: 'Side Quest', status: 'available' })];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== QUESTS ===');
		expect(system.content).toContain('[available]');
		expect(system.content).toContain('Side Quest');
	});

	it('shows completed quests with [completed] tag', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest({ id: 'quest-done', name: 'Old Quest', status: 'completed' })];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('[completed]');
		expect(system.content).toContain('Old Quest');
	});

	it('shows failed quests with [failed] tag', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest({ id: 'quest-fail', name: 'Failed Quest', status: 'failed' })];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('[failed]');
		expect(system.content).toContain('Failed Quest');
	});

	it('shows all quest statuses together', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [
			makeQuest({ id: 'q1', name: 'Active Quest', status: 'active' }),
			makeQuest({ id: 'q2', name: 'Available Quest', status: 'available' }),
			makeQuest({ id: 'q3', name: 'Done Quest', status: 'completed' }),
			makeQuest({ id: 'q4', name: 'Bad Quest', status: 'failed' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('[active]');
		expect(system.content).toContain('[available]');
		expect(system.content).toContain('[completed]');
		expect(system.content).toContain('[failed]');
	});

	it('does NOT show QUESTS section when no quests exist', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('=== QUESTS ===');
	});

	it('shows quest objectives with done/not-done checkboxes', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest({
			objectives: [
				{ id: 'obj-1', text: 'Find the key', done: true },
				{ id: 'obj-2', text: 'Open the door', done: false }
			]
		})];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('[x] Find the key');
		expect(system.content).toContain('[ ] Open the door');
	});

	it('section is named QUESTS (not ACTIVE QUESTS)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [makeQuest()];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== QUESTS ===');
		expect(system.content).not.toContain('=== ACTIVE QUESTS ===');
	});
});

// ===========================================================================
// Item 8 — Hardened response format instructions
// ===========================================================================

describe('Phase 1: hardened response format', () => {
	it('includes CRITICAL RULES section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('CRITICAL RULES');
	});

	it('instructs to track NPCs via npcsAdded', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('npcsAdded');
		expect(system.content).toContain('Do not introduce named NPCs only in narrative');
	});

	it('instructs to track items via itemsGained/itemsLost', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('itemsGained/itemsLost');
		expect(system.content).toContain('Do not mention acquiring or losing items only in narrative');
	});

	it('instructs to include companion combat actions', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('companion NPC');
		expect(system.content).toContain('npcChanges');
	});

	it('instructs not to start and end encounters in same response', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Do NOT start and end an encounter in the same response');
	});

	it('instructs to create separate creature entries for each enemy', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('separate creatures entries for EACH enemy');
	});

	it('instructs to only reference existing IDs', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Only reference NPC IDs, quest IDs, location IDs, and item IDs that exist');
	});

	it('instructs to record scene facts for important details', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('sceneFactsAdded');
		expect(system.content).toContain('persist across turns');
	});

	it('characterId instruction references PARTY section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('exact ID shown in brackets');
		expect(system.content).toContain('PARTY section');
	});

	it('hpChanges uses characterId label hint in the schema', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('"characterId": "exact-id-from-PARTY-brackets"');
	});
});

// ===========================================================================
// Item 9 — NPC interaction summaries
// ===========================================================================

describe('Phase 1: NPC interaction summaries via sceneFacts', () => {
	it('shows scene facts mentioning NPC name in KNOWN NPCs listing', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-bjorik', name: 'Bjorik', role: 'ally', locationId: 'loc-2', disposition: 30 })
		];
		state.sceneFacts = [
			'Bjorik agreed to join for 5gp/day',
			'The bridge is closed for repairs',
			'Bjorik helped fight the wolves'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Both Bjorik-related facts should appear as his interaction summary
		expect(system.content).toContain('Bjorik agreed to join for 5gp/day');
		expect(system.content).toContain('Bjorik helped fight the wolves');
		// Unrelated fact should NOT appear in the NPC line
		// (it appears in ESTABLISHED FACTS, not here)
	});

	it('shows scene facts mentioning NPC name in COMPANIONS listing', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-kael', name: 'Kael', role: 'ally', locationId: 'loc-1', disposition: 40 })
		];
		state.sceneFacts = [
			'Kael is searching for her lost brother',
			'Kael prefers ranged attacks'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Kael is searching for her lost brother');
		expect(system.content).toContain('Kael prefers ranged attacks');
	});

	it('matches first name for multi-word NPC names', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-gareth', name: 'Gareth the Bold', role: 'merchant', locationId: 'loc-2' })
		];
		state.sceneFacts = [
			'Gareth sells rare potions at a discount'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Gareth sells rare potions at a discount');
	});

	it('shows at most 3 recent facts per NPC', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-bob', name: 'Bob', role: 'neutral', locationId: 'loc-2' })
		];
		state.sceneFacts = [
			'Bob told a joke on turn 1',
			'Bob gave directions on turn 2',
			'Bob sold a potion on turn 3',
			'Bob lent a horse on turn 4',
			'Bob joined for dinner on turn 5'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Extract the NPC line from KNOWN NPCs section (not ESTABLISHED FACTS)
		const bobLine = system.content.split('\n').find((l) => l.includes('Bob[npc-bob]'))!;
		expect(bobLine).toBeDefined();
		// Only the last 3 should appear in the NPC interaction summary
		expect(bobLine).not.toContain('Bob told a joke on turn 1');
		expect(bobLine).not.toContain('Bob gave directions on turn 2');
		expect(bobLine).toContain('Bob sold a potion on turn 3');
		expect(bobLine).toContain('Bob lent a horse on turn 4');
		expect(bobLine).toContain('Bob joined for dinner on turn 5');
	});

	it('shows no interaction summary when no scene facts mention the NPC', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-unknown', name: 'Stranger', role: 'neutral', locationId: 'loc-2' })
		];
		state.sceneFacts = ['The weather turned cold'];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// The NPC should appear but without a " — " interaction summary
		expect(system.content).toContain('Stranger[npc-unknown]');
		const strangerLine = system.content.split('\n').find((l) => l.includes('Stranger[npc-unknown]'))!;
		expect(strangerLine).not.toContain(' — ');
	});

	it('does not match very short first names (< 3 chars) to avoid false positives', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-li', name: 'Li the Wise', role: 'ally', locationId: 'loc-2' })
		];
		state.sceneFacts = [
			'The light faded quickly',
			'Li the Wise gave advice'
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const npcLine = system.content.split('\n').find((l) => l.includes('Li the Wise[npc-li]'))!;
		// "The light faded quickly" should NOT match because "li" is too short (<3 chars)
		// but "Li the Wise gave advice" should match on full name
		expect(npcLine).toContain('Li the Wise gave advice');
		expect(npcLine).not.toContain('The light faded quickly');
	});

	it('handles empty sceneFacts gracefully', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-1', name: 'Guard', locationId: 'loc-2' })
		];
		state.sceneFacts = [];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Guard[npc-1]');
	});
});

// ===========================================================================
// Phase 1 — Section ordering
// ===========================================================================

describe('Phase 1: prompt section ordering', () => {
	it('sections appear in the correct order', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-remote', name: 'Remote NPC', locationId: 'loc-2' }),
			makeNpc({ id: 'npc-ally', name: 'Ally NPC', role: 'ally', locationId: 'loc-1' })
		];
		state.quests = [{
			id: 'q-1', name: 'Test Quest', description: 'Test', status: 'active',
			objectives: [{ id: 'obj-1', text: 'Do it', done: false }],
			giverNpcId: null, rewards: { xp: 0, gold: 0, items: [], reputationChanges: [] },
			recommendedLevel: 1, encounterTemplates: []
		}];
		state.sceneFacts = ['A fact'];

		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const c = system.content;

		const discretionIdx = c.indexOf('=== DISCRETION RULES ===');
		const currentLocIdx = c.indexOf('=== CURRENT LOCATION ===');
		const knownLocIdx = c.indexOf('=== KNOWN LOCATIONS ===');
		const knownNpcsIdx = c.indexOf('=== KNOWN NPCs');
		const partyIdx = c.indexOf('=== PARTY ===');
		const companionIdx = c.indexOf('=== COMPANIONS ===');
		const questsIdx = c.indexOf('=== QUESTS ===');
		const timeIdx = c.indexOf('=== TIME ===');
		const factsIdx = c.indexOf('=== ESTABLISHED FACTS ===');
		const formatIdx = c.indexOf('=== RESPONSE FORMAT ===');
		const rulesIdx = c.indexOf('=== CRITICAL RULES ===');

		// All should exist
		expect(discretionIdx).toBeGreaterThan(-1);
		expect(currentLocIdx).toBeGreaterThan(-1);
		expect(knownLocIdx).toBeGreaterThan(-1);
		expect(knownNpcsIdx).toBeGreaterThan(-1);
		expect(partyIdx).toBeGreaterThan(-1);
		expect(companionIdx).toBeGreaterThan(-1);
		expect(questsIdx).toBeGreaterThan(-1);
		expect(timeIdx).toBeGreaterThan(-1);
		expect(factsIdx).toBeGreaterThan(-1);
		expect(formatIdx).toBeGreaterThan(-1);
		expect(rulesIdx).toBeGreaterThan(-1);

		// Correct ordering
		expect(discretionIdx).toBeLessThan(currentLocIdx);
		expect(currentLocIdx).toBeLessThan(knownLocIdx);
		expect(knownLocIdx).toBeLessThan(knownNpcsIdx);
		expect(knownNpcsIdx).toBeLessThan(partyIdx);
		expect(partyIdx).toBeLessThan(companionIdx);
		expect(companionIdx).toBeLessThan(questsIdx);
		expect(questsIdx).toBeLessThan(timeIdx);
		expect(timeIdx).toBeLessThan(factsIdx);
		expect(factsIdx).toBeLessThan(formatIdx);
		expect(formatIdx).toBeLessThan(rulesIdx);
	});
});

// ===========================================================================
// Phase 2 — Companion System (gm-context side)
// ===========================================================================

describe('Phase 2: companion role in gm-context', () => {
	it('shows companion NPCs in COMPANIONS section alongside allies', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-comp', name: 'Bjorik', role: 'companion', locationId: 'loc-1', disposition: 60 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('=== COMPANIONS ===');
		expect(system.content).toContain('Bjorik[npc-comp]');
	});

	it('shows COMPANIONS section for both ally and companion roles at party location', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-ally', name: 'Kael', role: 'ally', locationId: 'loc-1' }),
			makeNpc({ id: 'npc-comp', name: 'Bjorik', role: 'companion', locationId: 'loc-1' })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Kael[npc-ally]');
		expect(system.content).toContain('Bjorik[npc-comp]');
	});

	it('companion role gets same priority as ally in KNOWN NPCs sorting', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({ id: 'npc-merc', name: 'Trader', role: 'merchant', locationId: 'loc-2', disposition: 10 }),
			makeNpc({ id: 'npc-comp', name: 'CompanionAway', role: 'companion', locationId: 'loc-2', disposition: 50 })
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const compIdx = system.content.indexOf('CompanionAway[npc-comp]');
		const traderIdx = system.content.indexOf('Trader[npc-merc]');
		// Companion should appear before merchant (same priority as ally)
		expect(compIdx).toBeLessThan(traderIdx);
	});

	it('companion stat block is displayed in COMPANIONS section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-comp',
				name: 'Bjorik',
				role: 'companion',
				locationId: 'loc-1',
				disposition: 60,
				statBlock: {
					hp: 25,
					maxHp: 35,
					ac: 16,
					abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
					speed: 30,
					cr: 2,
					attacks: [
						{ name: 'Greataxe', toHit: 5, damage: '1d12+3', damageType: 'slashing' }
					],
					savingThrows: [],
					skills: [],
					resistances: [],
					immunities: [],
					vulnerabilities: [],
					traits: [],
					actions: [],
					legendaryActions: []
				}
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('25/35 HP');
		expect(system.content).toContain('AC 16');
		expect(system.content).toContain('Greataxe +5');
	});

	it('includes "companion" in the npcsAdded role list in response format', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('ally|companion|boss');
	});

	it('includes "hp" in npcChanges field list in response format', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('disposition|alive|hp');
	});

	it('includes companionPromoted in response format', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('companionPromoted');
		expect(system.content).toContain('statBlock');
	});

	it('mentions companion recruitment instruction in CRITICAL RULES', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('companionPromoted');
		expect(system.content).toContain('auto-travel with the party');
	});

	it('mentions companion HP tracking in CRITICAL RULES', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('field: "hp"');
	});
});

// ===========================================================================
// Phase 3 — NPC Memory & Lifecycle (gm-context side)
// ===========================================================================

describe('Phase 3: interactionNotes in gm-context', () => {
	it('shows interactionNotes in COMPANIONS section instead of scene fact cross-ref', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-comp',
				name: 'Bjorik',
				role: 'companion',
				locationId: 'loc-1',
				disposition: 60,
				interactionNotes: [
					{ turn: 1, note: 'Hired Bjorik for 5gp/day' },
					{ turn: 3, note: 'Bjorik saved the party from wolves' }
				]
			})
		];
		// Also add a scene fact that mentions Bjorik — interactionNotes should take priority in NPC summary
		state.sceneFacts = ['Bjorik was found at the tavern'];
		const messages = assembleGMContext(state, null, [], 'action');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Hired Bjorik for 5gp/day');
		expect(system.content).toContain('Bjorik saved the party from wolves');
		// The companion summary line should NOT include the scene fact text (interactionNotes takes priority)
		const companionSection = system.content.split('=== COMPANIONS ===')[1]?.split('===')[0] ?? '';
		expect(companionSection).not.toContain('found at the tavern');
	});

	it('shows interactionNotes in KNOWN NPCs section for remote NPCs', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({
				id: 'npc-remote',
				name: 'Elder Sage',
				role: 'quest-giver',
				locationId: 'loc-2',
				disposition: 40,
				interactionNotes: [
					{ turn: 5, note: 'Elder Sage gave party the map to the dungeon' }
				]
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Elder Sage gave party the map to the dungeon');
	});

	it('shows at most 3 most recent interactionNotes', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-ally',
				name: 'Kael',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 50,
				interactionNotes: [
					{ turn: 1, note: 'Met Kael at the tavern' },
					{ turn: 2, note: 'Kael offered to help' },
					{ turn: 3, note: 'Kael fought bandits' },
					{ turn: 4, note: 'Kael was wounded' }
				]
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Should show last 3 only
		expect(system.content).not.toContain('Met Kael at the tavern');
		expect(system.content).toContain('Kael offered to help');
		expect(system.content).toContain('Kael fought bandits');
		expect(system.content).toContain('Kael was wounded');
	});

	it('falls back to scene fact cross-reference when interactionNotes is empty', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-ally',
				name: 'Kael',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 50
				// No interactionNotes
			})
		];
		state.sceneFacts = ['Kael offered a quest to the party'];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Kael offered a quest to the party');
	});
});

describe('Phase 3: NPC archival in gm-context', () => {
	it('excludes archived NPCs from COMPANIONS section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-archived',
				name: 'ArchCompanion',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 50,
				alive: true,
				archived: true
			}),
			makeNpc({
				id: 'npc-active',
				name: 'ActiveCompanion',
				role: 'ally',
				locationId: 'loc-1',
				disposition: 50
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('ArchCompanion');
		expect(system.content).toContain('ActiveCompanion');
	});

	it('excludes archived NPCs from KNOWN NPCs section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({
				id: 'npc-arch-remote',
				name: 'ArchivedTrader',
				role: 'merchant',
				locationId: 'loc-2',
				disposition: 10,
				archived: true
			}),
			makeNpc({
				id: 'npc-active-remote',
				name: 'ActiveTrader',
				role: 'merchant',
				locationId: 'loc-2',
				disposition: 20
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('ArchivedTrader');
		expect(system.content).toContain('ActiveTrader');
	});

	it('excludes archived NPCs from local NPCs present at current location', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({
				id: 'npc-arch-local',
				name: 'ArchivedLocal',
				role: 'neutral',
				locationId: 'loc-1',
				disposition: 0,
				archived: true
			}),
			makeNpc({
				id: 'npc-active-local',
				name: 'ActiveLocal',
				role: 'neutral',
				locationId: 'loc-1',
				disposition: 0
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).not.toContain('ArchivedLocal');
		expect(system.content).toContain('ActiveLocal');
	});
});

describe('Phase 3: lastInteractionTurn sort in gm-context', () => {
	it('sorts KNOWN NPCs by lastInteractionTurn (more recent first) within same role', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({
				id: 'npc-old',
				name: 'OldContact',
				role: 'merchant',
				locationId: 'loc-2',
				disposition: 30,
				lastInteractionTurn: 2
			}),
			makeNpc({
				id: 'npc-recent',
				name: 'RecentContact',
				role: 'merchant',
				locationId: 'loc-2',
				disposition: 10,
				lastInteractionTurn: 10
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const recentIdx = system.content.indexOf('RecentContact[npc-recent]');
		const oldIdx = system.content.indexOf('OldContact[npc-old]');
		// Recent contact should be listed first despite lower disposition
		expect(recentIdx).toBeLessThan(oldIdx);
	});

	it('NPC without lastInteractionTurn sorts after those with it', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.locations.push(makeLoc2());
		state.npcs = [
			makeNpc({
				id: 'npc-notrack',
				name: 'UntrackedNpc',
				role: 'neutral',
				locationId: 'loc-2',
				disposition: 90
				// No lastInteractionTurn
			}),
			makeNpc({
				id: 'npc-tracked',
				name: 'TrackedNpc',
				role: 'neutral',
				locationId: 'loc-2',
				disposition: 0,
				lastInteractionTurn: 5
			})
		];
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		const trackedIdx = system.content.indexOf('TrackedNpc[npc-tracked]');
		const untrackedIdx = system.content.indexOf('UntrackedNpc[npc-notrack]');
		// Tracked NPC should appear before untracked despite lower disposition
		expect(trackedIdx).toBeLessThan(untrackedIdx);
	});
});

describe('Phase 3: notes field in response format', () => {
	it('includes "notes" in npcChanges field list in response format', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('disposition|alive|hp|notes');
	});

	it('mentions notes field usage in CRITICAL RULES', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('field: "notes"');
		expect(system.content).toContain('deals struck');
	});
});

// ---------------------------------------------------------------------------
// Phase 6+7: Two-pass architecture — new exported functions
// ---------------------------------------------------------------------------

describe('Phase 7: buildStateExtractionPrompt', () => {
	it('mentions JSON in the prompt (required for response_format: json_object)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt.toLowerCase()).toContain('json');
	});

	it('identifies itself as Game State Tracker, not Game Master', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('Game State Tracker');
		expect(prompt).not.toContain('You are the Game Master');
	});

	it('does NOT contain narrative prose instructions', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).not.toContain('second-person perspective');
		expect(prompt).not.toContain('vivid and concise');
		expect(prompt).not.toContain('invites the next player action');
	});

	it('includes character IDs from state for reference', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('char-1');
		expect(prompt).toContain('Conan');
	});

	it('includes location IDs from state for reference', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('loc-1');
		expect(prompt).toContain('Town Square');
	});

	it('includes the JSON response format schema', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('stateChanges');
		expect(prompt).toContain('hpChanges');
		expect(prompt).toContain('locationChange');
		expect(prompt).toContain('itemsGained');
		expect(prompt).toContain('encounterStarted');
		expect(prompt).toContain('encounterEnded');
		expect(prompt).toContain('sceneFactsAdded');
	});

	it('includes extraction rules for all state-change categories', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('EXTRACTION RULES');
		expect(prompt).toContain('HP changes');
		expect(prompt).toContain('Items gained or lost');
		expect(prompt).toContain('Movement to a new location');
		expect(prompt).toContain('New NPCs');
		expect(prompt).toContain('Quest progress');
		expect(prompt).toContain('XP');
	});

	it('includes quest IDs when quests exist', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.quests = [
			{
				id: 'quest-1',
				name: 'Kill the Dragon',
				description: 'Slay the red dragon.',
				status: 'active',
				giverNpcId: null,
				objectives: [{ id: 'obj-1', text: 'Find the lair', done: false }],
				recommendedLevel: 5,
				rewards: { xp: 0, gold: 0, items: [], reputationChanges: [] },
				encounterTemplates: []
			} as Quest
		];
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('quest-1');
		expect(prompt).toContain('obj-1');
	});

	it('includes NPC IDs when NPCs exist', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-merchant', name: 'Shopkeeper Bob', role: 'merchant', locationId: 'loc-1', disposition: 50 })
		];
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('npc-merchant');
		expect(prompt).toContain('Shopkeeper Bob');
	});

	it('includes active encounter info when present', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.activeEncounter = {
			id: 'enc-1',
			status: 'active',
			round: 3,
			turnIndex: 0,
			initiativeOrder: ['npc-goblin'],
			startedAt: Date.now(),
			combatants: [
				{ name: 'Goblin', type: 'npc', currentHp: 5, maxHp: 7, ac: 15, defeated: false } as any
			]
		};
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('ACTIVE ENCOUNTER');
		expect(prompt).toContain('Goblin');
		expect(prompt).toContain('Round 3');
	});

	// Phase D: combatAction/enemyCombatActions removed from extraction prompts (engine-authoritative)
	it('does NOT include combatAction schema in extraction prompt (Phase D — engine-authoritative)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		// combatAction should no longer appear as a schema field
		expect(prompt).not.toMatch(/"combatAction"/);
	});

	it('does NOT include enemyCombatActions schema in extraction prompt (Phase D — engine-authoritative)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).not.toMatch(/"enemyCombatActions"/);
	});

	it('includes tier field with valid values in encounterStarted schema (Phase 8i)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('tier');
		// tier enum must contain both extremes
		expect(prompt).toContain('weak');
		expect(prompt).toContain('boss');
	});

	it('combat extraction rules say engine resolves authoritatively (Phase D)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('engine resolves all attacks');
		expect(prompt).toContain('authoritatively');
	});
});

describe('Phase 7: assembleStateExtractionContext', () => {
	it('returns exactly 2 messages: system + user', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleStateExtractionContext(state, 'You attack the goblin.', 'I attack');
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[1].role).toBe('user');
	});

	it('system message contains the state extraction prompt', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleStateExtractionContext(state, 'The narrative text.', 'player action');
		expect(messages[0].content).toContain('Game State Tracker');
		expect(messages[0].content.toLowerCase()).toContain('json');
	});

	it('user message contains the player action and narrative', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleStateExtractionContext(state, 'You swing your sword.', 'I attack the bandit');
		expect(messages[1].content).toContain('I attack the bandit');
		expect(messages[1].content).toContain('You swing your sword.');
		expect(messages[1].content).toContain('PLAYER ACTION');
		expect(messages[1].content).toContain('NARRATIVE RESULT');
	});

	it('does NOT include conversation history', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleStateExtractionContext(state, 'The narrative.', 'action');
		// Should be exactly 2 messages — no history turns
		expect(messages).toHaveLength(2);
	});
});

describe('Phase 7: assembleNarrativeGMContext', () => {
	it('system prompt is narrative-only (no JSON instructions)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('ONLY narrative prose');
		expect(system.content).toContain('Do NOT return JSON');
		// Should not contain the JSON response format block
		expect(system.content).not.toContain('"narrativeText"');
		expect(system.content).not.toContain('=== RESPONSE FORMAT ===');
	});

	it('system prompt still contains full game context', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		state.npcs = [
			makeNpc({ id: 'npc-1', name: 'Gandalf', role: 'ally', locationId: 'loc-1', disposition: 80 })
		];
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		// Should still have world/party/NPC context
		expect(system.content).toContain('Conan');
		expect(system.content).toContain('PARTY');
		expect(system.content).toContain('Gandalf');
		expect(system.content).toContain('CURRENT LOCATION');
	});

	it('includes player action as the last user message', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I open the chest');
		const lastMsg = messages[messages.length - 1];
		expect(lastMsg.role).toBe('user');
		expect(lastMsg.content).toBe('I open the chest');
	});

	it('includes mechanic results appended to player action', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const mechanicResults: MechanicResult[] = [
			{ type: 'skill-check', label: 'Strength Check', dice: { notation: '1d20+4', total: 18, rolls: [14] }, dc: 15, success: true }
		];
		const messages = assembleNarrativeGMContext(state, null, [], 'I force open the gate', mechanicResults);
		const lastMsg = messages[messages.length - 1];
		expect(lastMsg.content).toContain('[Mechanics:');
		expect(lastMsg.content).toContain('Strength Check');
		expect(lastMsg.content).toContain('18');
	});

	it('includes conversation history as plain prose (not JSON)', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [
			{
				id: 'turn-1',
				turnNumber: 1,
				actorType: 'player',
				actorId: 'user-1',
				action: 'I enter the tavern',
				intent: 'free-narration',
				status: 'completed',
				resolvedActionSummary: 'Entered the tavern',
				narrativeText: 'You push open the wooden door and step inside.',
				stateChanges: { locationChange: { from: null, to: 'loc-tavern' } },
				mechanicResults: [],
				timestamp: Date.now()
			}
		];
		const messages = assembleNarrativeGMContext(state, null, turns, 'I order a drink');
		// Find the assistant message (history)
		const assistantMsgs = messages.filter((m) => m.role === 'assistant');
		expect(assistantMsgs).toHaveLength(1);
		// Should be plain prose, not JSON
		expect(assistantMsgs[0].content).toBe('You push open the wooden door and step inside.');
		// Should NOT contain JSON wrapper
		expect(assistantMsgs[0].content).not.toContain('"narrativeText"');
		expect(assistantMsgs[0].content).not.toContain('"stateChanges"');
	});

	it('includes party chat when provided', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const chatRecords = [
			{ id: 'msg-1', adventureId: 'adv-1', userId: 'user-1', username: 'Player1', text: 'Should we attack?', mentions: [], retroInvoked: false, consumedByTurn: null, createdAt: Date.now() }
		];
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around', [], chatRecords);
		const chatMsg = messages.find((m) => m.content.includes('Party chat'));
		expect(chatMsg).toBeDefined();
		expect(chatMsg!.content).toContain('Player1');
		expect(chatMsg!.content).toContain('Should we attack?');
	});

	it('history turns show JSON in legacy assembleGMContext but prose in narrative context', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [
			{
				id: 'turn-1',
				turnNumber: 1,
				actorType: 'player',
				actorId: 'user-1',
				action: 'I talk to the guard',
				intent: 'free-narration',
				status: 'completed',
				resolvedActionSummary: 'Talked to the guard',
				narrativeText: 'The guard nods at you.',
				stateChanges: { sceneFactsAdded: ['Guard is friendly'] },
				mechanicResults: [],
				timestamp: Date.now()
			}
		];
		// Legacy: should wrap in JSON
		const legacyMsgs = assembleGMContext(state, null, turns, 'next action');
		const legacyAssistant = legacyMsgs.filter((m) => m.role === 'assistant');
		expect(legacyAssistant[0].content).toContain('"narrativeText"');
		expect(legacyAssistant[0].content).toContain('"stateChanges"');

		// Narrative: should be plain prose
		const narrativeMsgs = assembleNarrativeGMContext(state, null, turns, 'next action');
		const narrativeAssistant = narrativeMsgs.filter((m) => m.role === 'assistant');
		expect(narrativeAssistant[0].content).toBe('The guard nods at you.');
		expect(narrativeAssistant[0].content).not.toContain('"narrativeText"');
	});
});

// ===========================================================================
// Phase 8e — assembleRoundNarratorContext
// ===========================================================================

describe('assembleRoundNarratorContext (Phase 8e)', () => {
	function makeCombatState(): GameState {
		const fighter: PlayerCharacter = {
			id: 'pc-1', userId: 'user-1', adventureId: 'adv-1', name: 'Aria',
			race: 'human', level: 3,
			classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
			classSpells: [], pactSlots: [],
			abilitiessee: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
			hp: 24, maxHp: 24, tempHp: 0, ac: 16, speed: 30, size: 'Medium',
			proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
			saveProficiencies: ['str', 'con'], languages: ['common'],
			armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
			weaponProficiencies: ['simple', 'martial'], toolProficiencies: [],
			classFeatures: [], feats: [], spellSlots: [],
			concentratingOn: null,
			deathSaves: { successes: 0, failures: 0 }, inspiration: false,
			passivePerception: 10, inventory: [], gold: 0, xp: 0, conditions: [],
			resistances: [], exhaustionLevel: 0, stable: false, dead: false,
			featureUses: {}, attunedItems: [], backstory: ''
		} as unknown as PlayerCharacter;

		const enemy: NPC = makeNpc({ id: 'npc-goblin-1', name: 'Goblin', role: 'hostile' });

		const combatant1: Combatant = {
			id: 'cmb-pc-1', referenceId: 'pc-1', type: 'character', name: 'Aria',
			initiative: 12, currentHp: 24, maxHp: 24, tempHp: 0, ac: 16,
			conditions: [], resistances: [], immunities: [], vulnerabilities: [],
			concentration: false, defeated: false
		};
		const combatant2: Combatant = {
			id: 'cmb-npc-1', referenceId: 'npc-goblin-1', type: 'npc', name: 'Goblin',
			initiative: 8, currentHp: 7, maxHp: 7, tempHp: 0, ac: 13,
			conditions: [], resistances: [], immunities: [], vulnerabilities: [],
			concentration: false, defeated: false
		};
		const encounter: ActiveEncounter = {
			id: 'enc-1', round: 2, turnIndex: 0,
			initiativeOrder: ['cmb-pc-1', 'cmb-npc-1'],
			combatants: [combatant1, combatant2],
			status: 'active', startedAt: Date.now()
		};

		const state = makeMinimalState([fighter]);
		state.npcs = [enemy];
		state.activeEncounter = encounter;
		return state;
	}

	function makeRoundAction(overrides: Partial<PendingCombatAction> = {}): PendingCombatAction {
		const attackDice = { notation: '1d20+3', rolls: [15], total: 18 };
		const dmgDice = { notation: '1d8+3', rolls: [5], total: 8 };
		return {
			combatantId: 'cmb-pc-1',
			actorUserId: 'user-1',
			rawAction: 'I attack the goblin',
			mechanicResults: [
				{ type: 'attack-roll', label: 'Aria attacks Goblin with Longsword', dice: attackDice, success: true } as MechanicResult,
				{ type: 'damage', label: 'Aria deals 8 slashing damage to Goblin', dice: dmgDice, success: true } as MechanicResult
			],
			stateChanges: {
				hpChanges: [{ characterId: 'npc-goblin-1', oldHp: 7, newHp: 0, reason: 'Aria sword attack' }]
			},
			timestamp: Date.now(),
			...overrides
		};
	}

	it('returns an array with system + user messages', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);

		expect(messages.length).toBeGreaterThanOrEqual(2);
		expect(messages[0].role).toBe('system');
		const userMsg = messages.find((m) => m.role === 'user');
		expect(userMsg).toBeDefined();
	});

	it('user message includes round number from activeEncounter', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('round 2');
	});

	it('user message contains actor names and raw actions', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('Aria');
		expect(userMsg.content).toContain('I attack the goblin');
	});

	it('user message contains mechanic result labels', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('ATTACK-ROLL');
		expect(userMsg.content).toContain('Aria attacks Goblin');
	});

	it('user message contains HP change facts', () => {
		const state = makeCombatState();
		const action = makeRoundAction();
		const messages = assembleRoundNarratorContext(state, null, [action], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('HP:');
		expect(userMsg.content).toContain('7 →');
	});

	it('handles empty roundActions without crashing', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('No actions');
	});

	it('includes multiple actors when roundActions has multiple entries', () => {
		const state = makeCombatState();
		const pcAction = makeRoundAction();
		const npcAction = makeRoundAction({
			combatantId: 'cmb-npc-1',
			actorUserId: undefined,
			rawAction: 'Goblin attacks Aria',
			mechanicResults: [
				{ type: 'attack-roll', label: 'Goblin attacks Aria with Scimitar', dice: { notation: '1d20+4', rolls: [11], total: 15 }, success: false } as MechanicResult
			],
			stateChanges: {}
		});
		const messages = assembleRoundNarratorContext(state, null, [pcAction, npcAction], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('Aria');
		expect(userMsg.content).toContain('Goblin');
	});

	it('system prompt instructs narrator role', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);
		expect(messages[0].content).toContain('Narrator');
	});

	it('user message ends with narration request', () => {
		const state = makeCombatState();
		const messages = assembleRoundNarratorContext(state, null, [makeRoundAction()], []);
		const userMsg = messages.find((m) => m.role === 'user')!;
		expect(userMsg.content).toContain('Narrate');
	});
});

// ---------------------------------------------------------------------------
// Phase A: Tabletop adjudication prompt enhancements
// ---------------------------------------------------------------------------

describe('Phase A: tabletop adjudication prompt identity', () => {
	it('narrative prompt identifies GM as tabletop adjudicator', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('tabletop');
		expect(system.content).toContain('adjudicat');
	});

	it('narrative prompt includes TABLETOP ADJUDICATION section', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('TABLETOP ADJUDICATION');
	});

	it('narrative prompt explains calling for checks', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I look around');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('CALLING FOR CHECKS');
		expect(system.content).toContain('Perception check');
		expect(system.content).toContain('Stealth check');
	});

	it('narrative prompt explains combat start rules', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I attack the goblin');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('STARTING COMBAT');
		expect(system.content).toContain('Roll for initiative');
		expect(system.content).toContain('Scouting');
		expect(system.content).toContain('NEVER start combat');
	});

	it('narrative prompt explains during-combat procedure', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I attack');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('DURING COMBAT');
		expect(system.content).toContain('turns');
	});

	it('narrative prompt explains dialogue and social encounter rules', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I talk to the merchant');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('DIALOGUE');
		expect(system.content).toContain('persuade');
		expect(system.content).toContain('deceive');
		expect(system.content).toContain('intimidate');
	});

	it('narrative prompt forbids starting combat from scouting', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I scout ahead');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Start combat from scouting');
	});

	it('narrative prompt forbids silently deciding contested outcomes', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleNarrativeGMContext(state, null, [], 'I try to persuade');
		const system = messages.find((m) => m.role === 'system')!;
		expect(system.content).toContain('Silently decide the outcome of a contested');
	});
});

describe('Phase A: history window reduction', () => {
	it('MAX_HISTORY_TURNS is 8 for narrative contexts', () => {
		expect(MAX_HISTORY_TURNS).toBe(8);
	});

	it('MAX_NARRATOR_HISTORY_TURNS is 12 for narrator contexts', () => {
		expect(MAX_NARRATOR_HISTORY_TURNS).toBe(12);
	});

	it('narrative context caps history at MAX_HISTORY_TURNS', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [];
		for (let i = 0; i < 20; i++) {
			turns.push({
				id: `turn-${i}`,
				turnNumber: i + 1,
				action: `Action ${i}`,
				actorType: 'player',
				actorId: 'user-1',
				intent: 'free-narration',
				resolvedActionSummary: `Action ${i}`,
				narrativeText: `Narrative ${i}`,
				mechanicResults: [],
				stateChanges: {},
				status: 'completed',
				timestamp: Date.now()
			});
		}
		const messages = assembleNarrativeGMContext(state, null, turns, 'I look around');
		// System + 8 turns * 2 (user+assistant) + current user = 1 + 16 + 1 = 18
		// But let's just count that early turns are excluded
		const userMessages = messages.filter((m) => m.role === 'user');
		const assistantMessages = messages.filter((m) => m.role === 'assistant');
		// Should have at most MAX_HISTORY_TURNS user messages from history + 1 current
		expect(assistantMessages.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS);
		expect(assistantMessages.length).toBe(MAX_HISTORY_TURNS);
		// First history message should be Action 12 (turns 12-19 = last 8)
		expect(assistantMessages[0].content).toContain('Narrative 12');
	});

	it('narrator context uses longer MAX_NARRATOR_HISTORY_TURNS', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const turns: TurnRecord[] = [];
		for (let i = 0; i < 20; i++) {
			turns.push({
				id: `turn-${i}`,
				turnNumber: i + 1,
				action: `Action ${i}`,
				actorType: 'player',
				actorId: 'user-1',
				intent: 'free-narration',
				resolvedActionSummary: `Action ${i}`,
				narrativeText: `Narrative ${i}`,
				mechanicResults: [],
				stateChanges: {},
				status: 'completed',
				timestamp: Date.now()
			});
		}
		const rt = makeResolvedTurn();
		const messages = assembleNarratorContext(state, null, turns, rt);
		const assistantMessages = messages.filter((m) => m.role === 'assistant');
		expect(assistantMessages.length).toBe(MAX_NARRATOR_HISTORY_TURNS);
		// First history message should be Narrative 8 (turns 8-19 = last 12)
		expect(assistantMessages[0].content).toContain('Narrative 8');
	});
});

describe('Phase A: state extraction prompt — combat-start guidance', () => {
	it('extraction prompt reinforces that encounterStarted requires explicit hostility', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const prompt = buildStateExtractionPrompt(state);
		expect(prompt).toContain('encounterStarted');
		expect(prompt).toContain('EXPLICIT attack');
		expect(prompt).toContain('ambush');
	});
});

describe('Phase D: combatAction/enemyCombatActions narrowed in full-GM prompt', () => {
	it('full-GM prompt does NOT include combatAction schema field', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack', [], []);
		const system = messages.find((m) => m.role === 'system');
		expect(system?.content).not.toMatch(/"combatAction"/);
	});

	it('full-GM prompt does NOT include enemyCombatActions schema field', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack', [], []);
		const system = messages.find((m) => m.role === 'system');
		expect(system?.content).not.toMatch(/"enemyCombatActions"/);
	});

	it('full-GM prompt mentions engine resolves combat authoritatively', () => {
		const state = makeMinimalState([makeSingleClassFighter()]);
		const messages = assembleGMContext(state, null, [], 'I attack', [], []);
		const system = messages.find((m) => m.role === 'system');
		expect(system?.content).toContain('engine resolves all attacks');
	});
});
