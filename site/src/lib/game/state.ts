/**
 * Project Zeus — Game State Manager
 *
 * Typed read/write access to game state stored in adventure_state.stateJson.
 * All game-layer code goes through these functions instead of raw JSON casts.
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { adventureState, adventureTurns } from '$lib/server/db/schema';
import type {
	AbilityName,
	AbilityScores,
	ConditionEffectMap,
	GameClock,
	GameId,
	GameState,
	Item,
	ItemRarity,
	NPC,
	PlayerCharacter,
	Quest,
	StateChange,
	TurnRecord
} from '$lib/game/types';
import {
	DEFAULT_CONDITION_EFFECTS,
	GAME_STATE_VERSION
} from '$lib/game/types';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

// ---------------------------------------------------------------------------
// Default / factory helpers
// ---------------------------------------------------------------------------

function cloneConditionEffects(): ConditionEffectMap {
	return JSON.parse(JSON.stringify(DEFAULT_CONDITION_EFFECTS)) as ConditionEffectMap;
}

function toNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeAbilityScores(value: unknown): AbilityScores {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		str: toNumber(obj.str, 10),
		dex: toNumber(obj.dex, 10),
		con: toNumber(obj.con, 10),
		int: toNumber(obj.int, 10),
		wis: toNumber(obj.wis, 10),
		cha: toNumber(obj.cha, 10)
	};
}

function normalizeItem(value: unknown): Item {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const category = typeof obj.category === 'string' ? obj.category : 'misc';
	const base = {
		id: typeof obj.id === 'string' ? obj.id : '',
		name: typeof obj.name === 'string' ? obj.name : 'Unknown Item',
		category,
		description: typeof obj.description === 'string' ? obj.description : '',
		value: toNumber(obj.value, 0),
		quantity: Math.max(1, toNumber(obj.quantity, 1)),
		weight: toNumber(obj.weight, 0),
		rarity: (typeof obj.rarity === 'string' ? obj.rarity : 'common') as ItemRarity,
		attunement: Boolean(obj.attunement)
	} as const;

	if (category === 'weapon') {
		return {
			...base,
			category: 'weapon',
			weaponName: typeof obj.weaponName === 'string' ? obj.weaponName : base.name,
			damage: typeof obj.damage === 'string' ? obj.damage : '1d4',
			damageType: typeof obj.damageType === 'string' ? obj.damageType : 'bludgeoning',
			magicBonus: toNumber(obj.magicBonus, 0),
			properties: toStringArray(obj.properties),
			range: typeof obj.range === 'string' ? obj.range : undefined,
			equipped: typeof obj.equipped === 'boolean' ? obj.equipped : false,
			specialProperties: toStringArray(obj.specialProperties)
		};
	}

	if (category === 'armor') {
		return {
			...base,
			category: 'armor',
			armorName: typeof obj.armorName === 'string' ? obj.armorName : base.name,
			baseAC: toNumber(obj.baseAC, 10),
			magicBonus: toNumber(obj.magicBonus, 0),
			equipped: typeof obj.equipped === 'boolean' ? obj.equipped : false,
			maxDexBonus: obj.maxDexBonus === null ? null : typeof obj.maxDexBonus === 'number' ? obj.maxDexBonus : undefined,
			stealthDisadvantage: typeof obj.stealthDisadvantage === 'boolean' ? obj.stealthDisadvantage : false
		};
	}

	if (category === 'consumable') {
		return {
			...base,
			category: 'consumable',
			charges: Math.max(0, toNumber(obj.charges, base.quantity)),
			maxCharges: typeof obj.maxCharges === 'number' ? obj.maxCharges : undefined,
			effectDescription: typeof obj.effectDescription === 'string' ? obj.effectDescription : base.description,
			consumableType: (typeof obj.consumableType === 'string' ? obj.consumableType : 'other') as 'potion' | 'scroll' | 'food' | 'ammo' | 'other'
		};
	}

	if (category === 'quest') {
		return {
			...base,
			category: 'quest',
			questId: typeof obj.questId === 'string' ? obj.questId : undefined,
			importance: typeof obj.importance === 'string' ? obj.importance as 'minor' | 'major' | 'critical' : undefined
		};
	}

	return {
		...base,
		category: 'misc',
		notes: typeof obj.notes === 'string' ? obj.notes : undefined,
		tags: toStringArray(obj.tags)
	};
}

function normalizeCharacter(value: unknown): PlayerCharacter {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const abilities = normalizeAbilityScores(obj.abilities);
	const wisMod = Math.floor((abilities.wis - 10) / 2);
	const skillProficiencies = Array.isArray(obj.skillProficiencies)
		? obj.skillProficiencies.filter((entry): entry is PlayerCharacter['skillProficiencies'][number] => typeof entry === 'string')
		: [];
	const proficiencyBonus = toNumber(obj.proficiencyBonus, 2);

	return {
		id: typeof obj.id === 'string' ? obj.id : '',
		userId: typeof obj.userId === 'string' ? obj.userId : '',
		adventureId: typeof obj.adventureId === 'string' ? obj.adventureId : '',
		name: typeof obj.name === 'string' ? obj.name : 'Unnamed Hero',
		race: typeof obj.race === 'string' ? obj.race as PlayerCharacter['race'] : 'human',
		class: typeof obj.class === 'string' ? obj.class as PlayerCharacter['class'] : 'fighter',
		subrace: typeof obj.subrace === 'string' ? obj.subrace : undefined,
		subclass: typeof obj.subclass === 'string' ? obj.subclass : undefined,
		background: typeof obj.background === 'string' ? obj.background : undefined,
		alignment: typeof obj.alignment === 'string' ? obj.alignment as PlayerCharacter['alignment'] : undefined,
		level: Math.max(1, toNumber(obj.level, 1)),
		abilities,
		hp: Math.max(0, toNumber(obj.hp, 1)),
		maxHp: Math.max(1, toNumber(obj.maxHp, 1)),
		tempHp: Math.max(0, toNumber(obj.tempHp, 0)),
		ac: Math.max(0, toNumber(obj.ac, 10)),
		speed: Math.max(0, toNumber(obj.speed, 30)),
		size: typeof obj.size === 'string' ? obj.size as PlayerCharacter['size'] : 'Medium',
		proficiencyBonus,
		skillProficiencies,
		saveProficiencies: Array.isArray(obj.saveProficiencies)
			? obj.saveProficiencies.filter((entry): entry is AbilityName => typeof entry === 'string')
			: [],
		languages: toStringArray(obj.languages),
		armorProficiencies: toStringArray(obj.armorProficiencies),
		weaponProficiencies: toStringArray(obj.weaponProficiencies),
		toolProficiencies: toStringArray(obj.toolProficiencies),
		classFeatures: Array.isArray(obj.classFeatures)
			? obj.classFeatures.filter((entry): entry is PlayerCharacter['classFeatures'][number] => !!entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string' && typeof (entry as Record<string, unknown>).level === 'number')
			: [],
		feats: toStringArray(obj.feats),
		spellcastingAbility: typeof obj.spellcastingAbility === 'string' ? obj.spellcastingAbility as AbilityName : undefined,
		spellSlots: Array.isArray(obj.spellSlots)
			? obj.spellSlots.filter((entry): entry is PlayerCharacter['spellSlots'][number] => !!entry && typeof entry === 'object')
				.map((entry) => ({
					level: Math.max(1, toNumber((entry as unknown as Record<string, unknown>).level, 1)),
					current: Math.max(0, toNumber((entry as unknown as Record<string, unknown>).current, 0)),
					max: Math.max(0, toNumber((entry as unknown as Record<string, unknown>).max, 0))
				}))
			: [],
		knownSpells: toStringArray(obj.knownSpells),
		preparedSpells: toStringArray(obj.preparedSpells),
		cantrips: toStringArray(obj.cantrips),
		hitDiceRemaining: Math.max(0, toNumber(obj.hitDiceRemaining, Math.max(1, toNumber(obj.level, 1)))),
		deathSaves: {
			successes: Math.max(0, Math.min(3, toNumber((obj.deathSaves as Record<string, unknown> | undefined)?.successes, 0))),
			failures: Math.max(0, Math.min(3, toNumber((obj.deathSaves as Record<string, unknown> | undefined)?.failures, 0)))
		},
		inspiration: Boolean(obj.inspiration),
		passivePerception: Math.max(0, toNumber(obj.passivePerception, 10 + wisMod + (skillProficiencies.includes('perception') ? proficiencyBonus : 0))),
		inventory: Array.isArray(obj.inventory) ? obj.inventory.map(normalizeItem) : [],
		gold: Math.max(0, toNumber(obj.gold, 0)),
		xp: Math.max(0, toNumber(obj.xp, 0)),
		conditions: Array.isArray(obj.conditions)
			? obj.conditions.filter((entry): entry is PlayerCharacter['conditions'][number] => typeof entry === 'string')
			: [],
		backstory: typeof obj.backstory === 'string' ? obj.backstory : ''
	};
}

function normalizeNpc(value: unknown): NPC {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		id: typeof obj.id === 'string' ? obj.id : '',
		name: typeof obj.name === 'string' ? obj.name : 'Unknown NPC',
		role: typeof obj.role === 'string' ? obj.role as NPC['role'] : 'neutral',
		locationId: typeof obj.locationId === 'string' ? obj.locationId : '',
		disposition: Math.max(-100, Math.min(100, toNumber(obj.disposition, 0))),
		description: typeof obj.description === 'string' ? obj.description : '',
		notes: typeof obj.notes === 'string' ? obj.notes : '',
		alive: typeof obj.alive === 'boolean' ? obj.alive : true,
		statBlock: obj.statBlock && typeof obj.statBlock === 'object' ? obj.statBlock as NPC['statBlock'] : undefined
	};
}

function normalizeQuest(value: unknown): Quest {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const legacyRewardText = typeof obj.rewards === 'string' ? obj.rewards : '';
	const legacyXpReward = toNumber(obj.xpReward, 0);
	const rewardsObject = obj.rewards && typeof obj.rewards === 'object' && !Array.isArray(obj.rewards)
		? obj.rewards as Record<string, unknown>
		: null;

	return {
		id: typeof obj.id === 'string' ? obj.id : '',
		name: typeof obj.name === 'string' ? obj.name : 'Unnamed Quest',
		giverNpcId: typeof obj.giverNpcId === 'string' ? obj.giverNpcId : null,
		status: typeof obj.status === 'string' ? obj.status as Quest['status'] : 'available',
		description: typeof obj.description === 'string' ? obj.description : '',
		objectives: Array.isArray(obj.objectives)
			? obj.objectives.filter((entry): entry is Quest['objectives'][number] => !!entry && typeof entry === 'object')
				.map((entry) => ({
					id: typeof (entry as unknown as Record<string, unknown>).id === 'string' ? (entry as unknown as Record<string, unknown>).id as string : '',
					text: typeof (entry as unknown as Record<string, unknown>).text === 'string' ? (entry as unknown as Record<string, unknown>).text as string : '',
					done: Boolean((entry as unknown as Record<string, unknown>).done)
				}))
			: [],
		rewards: {
			xp: rewardsObject ? toNumber(rewardsObject.xp, legacyXpReward) : legacyXpReward,
			gold: rewardsObject ? toNumber(rewardsObject.gold, 0) : 0,
			items: rewardsObject && Array.isArray(rewardsObject.items) ? rewardsObject.items.map(normalizeItem) : [],
			reputationChanges: rewardsObject && Array.isArray(rewardsObject.reputationChanges)
				? rewardsObject.reputationChanges.filter((entry): entry is Quest['rewards']['reputationChanges'][number] => !!entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).npcId === 'string' && typeof (entry as Record<string, unknown>).delta === 'number')
				: []
		},
		recommendedLevel: Math.max(1, toNumber(obj.recommendedLevel, 1)),
		encounterTemplates: Array.isArray(obj.encounterTemplates)
			? obj.encounterTemplates.filter((entry): entry is Quest['encounterTemplates'][number] => typeof entry === 'string')
			: legacyRewardText ? ['soldier'] : []
	};
}

export function defaultClock(): GameClock {
	return { day: 1, timeOfDay: 'morning', weather: 'clear' };
}

export function createInitialGameState(worldSeed: string): GameState {
	const now = Date.now();
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters: [],
		npcs: [],
		locations: [],
		quests: [],
		activeEncounter: undefined,
		conditionEffects: cloneConditionEffects(),
		partyLocationId: null,
		clock: defaultClock(),
		turnLog: [],
		worldSeed,
		nextTurnNumber: 1,
		createdAt: now,
		updatedAt: now
	};
}

// ---------------------------------------------------------------------------
// Legacy migration: convert old state blobs to the current schema
// ---------------------------------------------------------------------------

interface LegacyStateV0 {
	started?: boolean;
	events?: unknown[];
	world?: PrototypeWorld;
	worldAcceptedAt?: number;
}

function migrateV1toV2(rawState: Record<string, unknown>): GameState {
	const state = createInitialGameState(typeof rawState.worldSeed === 'string' ? rawState.worldSeed : '');
	state.characters = Array.isArray(rawState.characters) ? rawState.characters.map(normalizeCharacter) : [];
	state.npcs = Array.isArray(rawState.npcs) ? rawState.npcs.map(normalizeNpc) : [];
	state.locations = Array.isArray(rawState.locations) ? rawState.locations as GameState['locations'] : [];
	state.quests = Array.isArray(rawState.quests) ? rawState.quests.map(normalizeQuest) : [];
	state.activeEncounter = rawState.activeEncounter && typeof rawState.activeEncounter === 'object'
		? rawState.activeEncounter as GameState['activeEncounter']
		: undefined;
	state.partyLocationId = typeof rawState.partyLocationId === 'string' ? rawState.partyLocationId : null;
	state.clock = rawState.clock && typeof rawState.clock === 'object'
		? {
			day: Math.max(1, toNumber((rawState.clock as Record<string, unknown>).day, 1)),
			timeOfDay: typeof (rawState.clock as Record<string, unknown>).timeOfDay === 'string'
				? (rawState.clock as Record<string, unknown>).timeOfDay as GameClock['timeOfDay']
				: 'morning',
			weather: typeof (rawState.clock as Record<string, unknown>).weather === 'string'
				? (rawState.clock as Record<string, unknown>).weather as string
				: 'clear'
		}
		: defaultClock();
	state.turnLog = Array.isArray(rawState.turnLog) ? rawState.turnLog as TurnRecord[] : [];
	state.nextTurnNumber = Math.max(1, toNumber(rawState.nextTurnNumber, 1));
	state.createdAt = toNumber(rawState.createdAt, Date.now());
	state.updatedAt = toNumber(rawState.updatedAt, state.createdAt);
	state.conditionEffects = cloneConditionEffects();
	state.version = GAME_STATE_VERSION;
	state.stateVersion = GAME_STATE_VERSION;
	return state;
}

/**
 * Migrate any old or unversioned state blob to the current GameState shape.
 */
export function migrateState(raw: unknown): GameState {
	if (!raw || typeof raw !== 'object') {
		return createInitialGameState('');
	}

	const obj = raw as Record<string, unknown>;
	if (obj.stateVersion === GAME_STATE_VERSION || obj.version === GAME_STATE_VERSION) {
		return migrateV1toV2(obj);
	}

	if (Array.isArray(obj.characters) || Array.isArray(obj.npcs) || Array.isArray(obj.locations) || Array.isArray(obj.quests)) {
		return migrateV1toV2(obj);
	}

	const legacy = obj as LegacyStateV0;
	const worldSeed = (legacy.world as PrototypeWorld | undefined)?.seed ?? '';
	const state = createInitialGameState(worldSeed);
	state.createdAt = legacy.worldAcceptedAt ?? Date.now();
	state.updatedAt = state.createdAt;
	return state;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function loadGameState(adventureId: string): Promise<GameState | null> {
	const rows = await db
		.select({ stateJson: adventureState.stateJson })
		.from(adventureState)
		.where(eq(adventureState.adventureId, adventureId))
		.limit(1);

	if (rows.length === 0) return null;

	try {
		const raw = JSON.parse(rows[0].stateJson);
		return migrateState(raw);
	} catch {
		return createInitialGameState('');
	}
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function saveGameState(adventureId: string, state: GameState): Promise<void> {
	const now = Date.now();
	state.version = GAME_STATE_VERSION;
	state.stateVersion = GAME_STATE_VERSION;
	state.updatedAt = now;

	await db
		.update(adventureState)
		.set({
			stateJson: JSON.stringify(state),
			updatedAt: now
		})
		.where(eq(adventureState.adventureId, adventureId));
}

export async function persistTurn(adventureId: string, turn: TurnRecord): Promise<void> {
	await db.insert(adventureTurns).values({
		id: turn.id,
		adventureId,
		turnNumber: turn.turnNumber,
		actorType: turn.actorType,
		actorId: turn.actorId,
		action: turn.action,
		intent: turn.intent,
		mechanicsJson: JSON.stringify(turn.mechanicResults),
		stateChangesJson: JSON.stringify(turn.stateChanges),
		narrativeText: turn.narrativeText,
		createdAt: turn.timestamp
	});
}

export async function loadRecentTurns(adventureId: string, limit = 20): Promise<TurnRecord[]> {
	const rows = await db
		.select()
		.from(adventureTurns)
		.where(eq(adventureTurns.adventureId, adventureId))
		.orderBy(adventureTurns.turnNumber)
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		turnNumber: r.turnNumber,
		actorType: r.actorType as TurnRecord['actorType'],
		actorId: r.actorId,
		action: r.action,
		intent: r.intent as TurnRecord['intent'],
		mechanicResults: JSON.parse(r.mechanicsJson) as TurnRecord['mechanicResults'],
		stateChanges: JSON.parse(r.stateChangesJson) as TurnRecord['stateChanges'],
		narrativeText: r.narrativeText,
		timestamp: r.createdAt
	}));
}

// ---------------------------------------------------------------------------
// Granular state mutators — return the change diff
// ---------------------------------------------------------------------------

export function mutateCharacterHp(
	state: GameState,
	characterId: GameId,
	newHp: number,
	reason: string
): StateChange {
	const char = state.characters.find((c) => c.id === characterId);
	if (!char) return {};

	const oldHp = char.hp;
	char.hp = Math.max(0, Math.min(newHp, char.maxHp));
	return {
		hpChanges: [{ characterId, oldHp, newHp: char.hp, reason }]
	};
}

export function mutateAddItem(
	state: GameState,
	characterId: GameId,
	item: Item
): StateChange {
	const char = state.characters.find((c) => c.id === characterId);
	if (!char) return {};

	const existing = char.inventory.find((i) => i.id === item.id);
	if (existing) {
		existing.quantity += item.quantity;
	} else {
		char.inventory.push({ ...item });
	}

	return {
		itemsGained: [{ characterId, item }]
	};
}

export function mutateRemoveItem(
	state: GameState,
	characterId: GameId,
	itemId: GameId,
	quantity: number
): StateChange {
	const char = state.characters.find((c) => c.id === characterId);
	if (!char) return {};

	const idx = char.inventory.findIndex((i) => i.id === itemId);
	if (idx === -1) return {};

	const item = char.inventory[idx];
	item.quantity -= quantity;
	if (item.quantity <= 0) {
		char.inventory.splice(idx, 1);
	}

	return {
		itemsLost: [{ characterId, itemId, quantity }]
	};
}

export function mutatePartyLocation(
	state: GameState,
	newLocationId: GameId
): StateChange {
	const from = state.partyLocationId;
	state.partyLocationId = newLocationId;

	const loc = state.locations.find((l) => l.id === newLocationId);
	if (loc) loc.visited = true;

	return {
		locationChange: { from, to: newLocationId }
	};
}

export function mutateClockAdvance(
	state: GameState,
	to: GameClock
): StateChange {
	const from = { ...state.clock };
	state.clock = to;
	return {
		clockAdvance: { from, to }
	};
}

export function mergeStateChanges(...changes: StateChange[]): StateChange {
	const merged: StateChange = {};
	for (const c of changes) {
		if (c.hpChanges) (merged.hpChanges ??= []).push(...c.hpChanges);
		if (c.itemsGained) (merged.itemsGained ??= []).push(...c.itemsGained);
		if (c.itemsLost) (merged.itemsLost ??= []).push(...c.itemsLost);
		if (c.locationChange) merged.locationChange = c.locationChange;
		if (c.npcChanges) (merged.npcChanges ??= []).push(...c.npcChanges);
		if (c.questUpdates) (merged.questUpdates ??= []).push(...c.questUpdates);
		if (c.conditionsApplied) (merged.conditionsApplied ??= []).push(...c.conditionsApplied);
		if (c.xpAwarded) (merged.xpAwarded ??= []).push(...c.xpAwarded);
		if (c.clockAdvance) merged.clockAdvance = c.clockAdvance;
		if (c.spellSlotUsed) merged.spellSlotUsed = c.spellSlotUsed;
		if (c.hitDiceUsed) merged.hitDiceUsed = c.hitDiceUsed;
		if (c.deathSaveResult) merged.deathSaveResult = c.deathSaveResult;
		if (c.featureUsed) merged.featureUsed = c.featureUsed;
		if (c.encounterStarted) merged.encounterStarted = c.encounterStarted;
		if (c.encounterEnded) merged.encounterEnded = c.encounterEnded;
	}
	return merged;
}
