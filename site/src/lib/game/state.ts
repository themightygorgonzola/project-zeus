/**
 * Project Zeus — Game State Manager
 *
 * Typed read/write access to game state stored in adventure_state.stateJson.
 * All game-layer code goes through these functions instead of raw JSON casts.
 */

import { desc, eq, and, gt } from 'drizzle-orm';
import { db } from '$lib/server/db/client';
import { adventureState, adventureTurns, adventureChat } from '$lib/server/db/schema';
import { ulid } from 'ulid';
import type {
	AbilityName,
	AbilityScores,
	ClassLevel,
	ClassSpellList,
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

const VALID_RECOVERY = new Set(['short-rest', 'long-rest', 'dawn']);
function normalizeFeatureUses(raw: unknown): PlayerCharacter['featureUses'] {
	if (!raw || typeof raw !== 'object') return {};
	const result: PlayerCharacter['featureUses'] = {};
	for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
		if (val && typeof val === 'object') {
			const entry = val as Record<string, unknown>;
			const max = Math.max(0, toNumber(entry.max, 0));
			const current = Math.max(0, Math.min(max, toNumber(entry.current, max)));
			const recoversOn = typeof entry.recoversOn === 'string' && VALID_RECOVERY.has(entry.recoversOn)
				? entry.recoversOn as 'short-rest' | 'long-rest' | 'dawn'
				: 'long-rest';
			result[key] = { current, max, recoversOn };
		}
	}
	return result;
}

function normalizeCharacter(value: unknown): PlayerCharacter {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const abilities = normalizeAbilityScores(obj.abilities);
	const wisMod = Math.floor((abilities.wis - 10) / 2);
	const legacyClassName = typeof obj.class === 'string'
		? obj.class as PlayerCharacter['classes'][0]['name']
		: 'fighter';
	const legacyLevel = Math.max(1, toNumber(obj.level, 1));
	const skillProficiencies = Array.isArray(obj.skillProficiencies)
		? obj.skillProficiencies.filter((entry): entry is PlayerCharacter['skillProficiencies'][number] => typeof entry === 'string')
		: [];
	const proficiencyBonus = toNumber(obj.proficiencyBonus, 2);

	// Normalize multiclass classes array
	const classes: ClassLevel[] = Array.isArray(obj.classes)
		? (obj.classes as unknown[])
			.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
			.map((entry) => ({
				name: (typeof entry.name === 'string' ? entry.name : 'fighter') as PlayerCharacter['classes'][0]['name'],
				level: Math.max(1, toNumber(entry.level, 1)),
				subclass: typeof entry.subclass === 'string' ? entry.subclass : undefined,
				hitDiceRemaining: Math.max(0, toNumber(entry.hitDiceRemaining, Math.max(1, toNumber(entry.level, 1))))
			}))
		: [];
	if (classes.length === 0 && typeof obj.class === 'string') {
		classes.push({
			name: legacyClassName,
			level: legacyLevel,
			subclass: typeof obj.subclass === 'string' ? obj.subclass : undefined,
			hitDiceRemaining: Math.max(0, toNumber(obj.hitDiceRemaining, legacyLevel))
		});
	}
	// Ensure at least one class entry
	if (classes.length === 0) {
		classes.push({ name: 'fighter', level: 1, hitDiceRemaining: 1 });
	}
	const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);

	// Normalize per-class spell lists
	const classSpells: ClassSpellList[] = Array.isArray(obj.classSpells)
		? (obj.classSpells as unknown[])
			.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
			.map((entry) => ({
				className: (typeof entry.className === 'string' ? entry.className : 'wizard') as ClassSpellList['className'],
				spellcastingAbility: (typeof entry.spellcastingAbility === 'string' ? entry.spellcastingAbility : 'int') as AbilityName,
				cantrips: toStringArray(entry.cantrips),
				knownSpells: toStringArray(entry.knownSpells),
				preparedSpells: toStringArray(entry.preparedSpells)
			}))
		: [];
	if (
		classSpells.length === 0 &&
		typeof obj.class === 'string' &&
		(
			Array.isArray(obj.cantrips) ||
			Array.isArray(obj.knownSpells) ||
			Array.isArray(obj.preparedSpells) ||
			typeof obj.spellcastingAbility === 'string'
		)
	) {
		classSpells.push({
			className: legacyClassName,
			spellcastingAbility: (typeof obj.spellcastingAbility === 'string' ? obj.spellcastingAbility : 'int') as AbilityName,
			cantrips: toStringArray(obj.cantrips),
			knownSpells: toStringArray(obj.knownSpells),
			preparedSpells: toStringArray(obj.preparedSpells)
		});
	}

	const standardSpellSlots = Array.isArray(obj.spellSlots)
		? obj.spellSlots.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
			.map((entry) => ({
				level: Math.max(1, toNumber(entry.level, 1)),
				current: Math.max(0, toNumber(entry.current, 0)),
				max: Math.max(0, toNumber(entry.max, 0))
			}))
		: [];
	const pactSlots = Array.isArray(obj.pactSlots)
		? (obj.pactSlots as unknown[])
			.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
			.map((entry) => ({
				level: Math.max(1, toNumber(entry.level, 1)),
				current: Math.max(0, toNumber(entry.current, 0)),
				max: Math.max(0, toNumber(entry.max, 0))
			}))
		: [];
	const migratedPactSlots = pactSlots.length === 0 && legacyClassName === 'warlock'
		? standardSpellSlots.map((slot) => ({ ...slot }))
		: pactSlots;
	const migratedStandardSlots = pactSlots.length === 0 && legacyClassName === 'warlock'
		? []
		: standardSpellSlots;
	const classFeatures = Array.isArray(obj.classFeatures)
		? obj.classFeatures
			.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && typeof entry.name === 'string' && typeof entry.level === 'number')
			.map((entry) => ({
				name: entry.name as string,
				level: entry.level as number,
				source: typeof entry.source === 'string'
					? entry.source as PlayerCharacter['classFeatures'][number]['source']
					: undefined,
				sourceClass:
					typeof entry.sourceClass === 'string'
						? entry.sourceClass as PlayerCharacter['classes'][0]['name']
						: (entry.source === 'class' || entry.source === 'subclass') && typeof obj.class === 'string'
							? legacyClassName
							: undefined,
				description: typeof entry.description === 'string' ? entry.description : undefined,
				maxUses: typeof entry.maxUses === 'number' ? entry.maxUses : undefined,
				currentUses: typeof entry.currentUses === 'number' ? entry.currentUses : undefined,
				recoversOn:
					typeof entry.recoversOn === 'string' && VALID_RECOVERY.has(entry.recoversOn)
						? entry.recoversOn as 'short-rest' | 'long-rest' | 'dawn'
						: undefined
			}))
		: [];

	return {
		id: typeof obj.id === 'string' ? obj.id : '',
		userId: typeof obj.userId === 'string' ? obj.userId : '',
		adventureId: typeof obj.adventureId === 'string' ? obj.adventureId : '',
		name: typeof obj.name === 'string' ? obj.name : 'Unnamed Hero',
		race: typeof obj.race === 'string' ? obj.race as PlayerCharacter['race'] : 'human',
		classes,
		subrace: typeof obj.subrace === 'string' ? obj.subrace : undefined,
		background: typeof obj.background === 'string' ? obj.background : undefined,
		alignment: typeof obj.alignment === 'string' ? obj.alignment as PlayerCharacter['alignment'] : undefined,
		level: totalLevel,
		abilities,
		hp: Math.max(0, toNumber(obj.hp, 1)),
		maxHp: Math.max(1, toNumber(obj.maxHp, 1)),
		tempHp: Math.max(0, toNumber(obj.tempHp, 0)),
		ac: Math.max(0, toNumber(obj.ac, 10)),
		speed: Math.max(0, toNumber(obj.speed, 30)),
		size: typeof obj.size === 'string' ? obj.size as PlayerCharacter['size'] : 'Medium',
		proficiencyBonus,
		skillProficiencies,
		expertiseSkills: Array.isArray(obj.expertiseSkills)
			? obj.expertiseSkills.filter((entry): entry is PlayerCharacter['expertiseSkills'][number] => typeof entry === 'string')
			: [],
		saveProficiencies: Array.isArray(obj.saveProficiencies)
			? obj.saveProficiencies.filter((entry): entry is AbilityName => typeof entry === 'string')
			: [],
		languages: toStringArray(obj.languages),
		armorProficiencies: toStringArray(obj.armorProficiencies),
		weaponProficiencies: toStringArray(obj.weaponProficiencies),
		toolProficiencies: toStringArray(obj.toolProficiencies),
		classFeatures,
		feats: toStringArray(obj.feats),
		spellSlots: migratedStandardSlots,
		pactSlots: migratedPactSlots,
		classSpells,
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
		resistances: Array.isArray(obj.resistances)
			? obj.resistances.filter((entry): entry is string => typeof entry === 'string')
			: [],
		exhaustionLevel: Math.max(0, Math.min(6, toNumber(obj.exhaustionLevel, 0))),
		stable: typeof obj.stable === 'boolean' ? obj.stable : false,
		dead: typeof obj.dead === 'boolean' ? obj.dead : false,
		concentratingOn: typeof obj.concentratingOn === 'string' ? obj.concentratingOn : null,
		featureUses: normalizeFeatureUses(obj.featureUses),
		attunedItems: Array.isArray(obj.attunedItems)
			? obj.attunedItems.filter((entry): entry is string => typeof entry === 'string')
			: [],
		backstory: typeof obj.backstory === 'string' ? obj.backstory : ''
	};
}

function normalizeNpc(value: unknown): NPC {
	const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const base: NPC = {
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
	if (typeof obj.lastInteractionTurn === 'number') base.lastInteractionTurn = obj.lastInteractionTurn;
	if (Array.isArray(obj.interactionNotes)) {
		base.interactionNotes = obj.interactionNotes
			.filter((n: unknown) => n && typeof n === 'object' && typeof (n as Record<string, unknown>).turn === 'number' && typeof (n as Record<string, unknown>).note === 'string')
			.map((n: unknown) => ({ turn: (n as Record<string, unknown>).turn as number, note: (n as Record<string, unknown>).note as string }));
	}
	if (typeof obj.archived === 'boolean') base.archived = obj.archived;
	return base;
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
		sceneFacts: [],
		createdAt: now,
		updatedAt: now
	};
}

export function buildOpeningPreamble(state: GameState): string {
	const location = state.locations.find((loc) => loc.id === state.partyLocationId) ?? state.locations[0];
	if (!location) {
		return 'Your adventure begins. The world waits to see what you do first.';
	}

	const localNpcs = state.npcs
		.filter((npc) => npc.alive !== false && npc.locationId === location.id && npc.role !== 'hostile')
		.map((npc) => npc.name);
	const quest = state.quests.find((q) => q.status === 'available' || q.status === 'active');
	const firstObjective = quest?.objectives.find((o) => !o.done)?.text ?? quest?.objectives[0]?.text;
	const feature = location.features[0];
	const timeBeat = `It is day ${state.clock.day}, ${state.clock.timeOfDay}, under ${state.clock.weather} skies.`;

	const parts = [
		`You begin in ${location.name}, ${location.description}`,
		feature ? `A notable detail stands out immediately: ${feature}.` : '',
		localNpcs.length > 0
			? `${localNpcs.join(', ')} ${localNpcs.length === 1 ? 'is' : 'are'} nearby, close enough to approach.`
			: '',
		quest
			? `A clear lead is already in front of you: ${quest.name}. ${firstObjective ? `The first step is simple — ${firstObjective}.` : quest.description}`
			: '',
		timeBeat,
		'What do you do first?'
	].filter(Boolean);

	return parts.join('\n\n');
}

export function createOpeningGmTurn(state: GameState): TurnRecord | null {
	if (state.locations.length === 0) return null;

	const now = Date.now();
	const turn: TurnRecord = {
		id: ulid(),
		turnNumber: state.nextTurnNumber,
		actorType: 'gm',
		actorId: 'gm',
		action: '',
		intent: 'free-narration',
		status: 'completed',
		resolvedActionSummary: 'Opening scene established',
		mechanicResults: [],
		stateChanges: {},
		narrativeText: buildOpeningPreamble(state),
		timestamp: now
	};

	state.nextTurnNumber += 1;
	state.turnLog.push(turn);
	if (state.turnLog.length > 50) {
		state.turnLog = state.turnLog.slice(-50);
	}

	return turn;
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
	state.sceneFacts = Array.isArray(rawState.sceneFacts) ? rawState.sceneFacts.filter((f: unknown) => typeof f === 'string') : [];
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

export async function persistTurn(adventureId: string, turn: TurnRecord, debugJson?: string | null): Promise<void> {
	await db.insert(adventureTurns).values({
		id: turn.id,
		adventureId,
		turnNumber: turn.turnNumber,
		actorType: turn.actorType,
		actorId: turn.actorId,
		action: turn.action,
		intent: turn.intent,
		status: turn.status,
		resolvedSummary: turn.resolvedActionSummary,
		mechanicsJson: JSON.stringify(turn.mechanicResults),
		stateChangesJson: JSON.stringify(turn.stateChanges),
		narrativeText: turn.narrativeText,
		debugJson: debugJson ?? null,
		createdAt: turn.timestamp
	});
}

/**
 * Atomically persist a turn record and save updated game state in a single batch.
 * This ensures turn and state are never out of sync — either both succeed or neither does.
 */
export async function persistTurnAndSaveState(
	adventureId: string,
	turn: TurnRecord,
	state: GameState,
	debugJson?: string | null
): Promise<void> {
	const now = Date.now();
	state.version = GAME_STATE_VERSION;
	state.stateVersion = GAME_STATE_VERSION;
	state.updatedAt = now;

	await db.batch([
		db.insert(adventureTurns).values({
			id: turn.id,
			adventureId,
			turnNumber: turn.turnNumber,
			actorType: turn.actorType,
			actorId: turn.actorId,
			action: turn.action,
			intent: turn.intent,
			status: turn.status,
			resolvedSummary: turn.resolvedActionSummary,
			mechanicsJson: JSON.stringify(turn.mechanicResults),
			stateChangesJson: JSON.stringify(turn.stateChanges),
			narrativeText: turn.narrativeText,
			debugJson: debugJson ?? null,
			createdAt: turn.timestamp
		}),
		db.update(adventureState)
			.set({
				stateJson: JSON.stringify(state),
				updatedAt: now
			})
			.where(eq(adventureState.adventureId, adventureId))
	]);
}

/**
 * Load the most recent N turns for an adventure, in chronological order.
 * Orders by turnNumber DESC to get the latest, then reverses for chronological output.
 */
export async function loadRecentTurns(adventureId: string, limit = 20): Promise<TurnRecord[]> {
	const rows = await db
		.select()
		.from(adventureTurns)
		.where(eq(adventureTurns.adventureId, adventureId))
		.orderBy(desc(adventureTurns.turnNumber))
		.limit(limit);

	// Reverse to chronological order (oldest first)
	rows.reverse();

	return rows.map((r) => ({
		id: r.id,
		turnNumber: r.turnNumber,
		actorType: r.actorType as TurnRecord['actorType'],
		actorId: r.actorId,
		action: r.action,
		intent: r.intent as TurnRecord['intent'],
		status: (r.status ?? 'completed') as TurnRecord['status'],
		resolvedActionSummary: r.resolvedSummary ?? '',
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
	const pushUnique = <T>(target: T[], values: T[], keyFn: (value: T) => string) => {
		const seen = new Set(target.map(keyFn));
		for (const value of values) {
			const key = keyFn(value);
			if (seen.has(key)) continue;
			seen.add(key);
			target.push(value);
		}
	};

	const merged: StateChange = {};
	for (const c of changes) {
		if (c.hpChanges) pushUnique((merged.hpChanges ??= []), c.hpChanges, (hc) => `${hc.characterId}|${hc.oldHp}|${hc.newHp}|${hc.reason ?? ''}`);
		if (c.itemsGained) pushUnique((merged.itemsGained ??= []), c.itemsGained, (ig) => `${ig.characterId}|${ig.item.id}`);
		if (c.itemsLost) pushUnique((merged.itemsLost ??= []), c.itemsLost, (il) => `${il.characterId}|${il.itemId}|${il.quantity ?? 1}`);
		if (c.itemsDropped) pushUnique((merged.itemsDropped ??= []), c.itemsDropped, (dr) => `${dr.characterId}|${dr.itemId}|${dr.locationId ?? ''}`);
		if (c.itemsPickedUp) pushUnique((merged.itemsPickedUp ??= []), c.itemsPickedUp, (pu) => `${pu.characterId}|${pu.itemId}|${pu.locationId ?? ''}`);
		if (c.locationItemsAdded) pushUnique((merged.locationItemsAdded ??= []), c.locationItemsAdded, (la) => `${la.locationId}|${la.item.id}`);
		if (c.locationChange) merged.locationChange = c.locationChange;
		if (c.npcChanges) pushUnique((merged.npcChanges ??= []), c.npcChanges, (nc) => `${nc.npcId}|${nc.field}`);
		if (c.questUpdates) pushUnique((merged.questUpdates ??= []), c.questUpdates, (qu) => `${qu.questId}|${qu.field}|${qu.objectiveId ?? ''}`);
		if (c.conditionsApplied) pushUnique((merged.conditionsApplied ??= []), c.conditionsApplied, (ca) => `${ca.characterId}|${ca.condition}|${ca.applied}`);
		if (c.xpAwarded) pushUnique((merged.xpAwarded ??= []), c.xpAwarded, (xp) => `${xp.characterId}|${xp.amount}`);
		if (c.clockAdvance) merged.clockAdvance = c.clockAdvance;
		if (c.spellSlotUsed) merged.spellSlotUsed = c.spellSlotUsed;
		if (c.hitDiceUsed) merged.hitDiceUsed = c.hitDiceUsed;
		if (c.deathSaveResult) merged.deathSaveResult = c.deathSaveResult;
		if (c.featureUsed) merged.featureUsed = c.featureUsed;
		if (c.encounterStarted) merged.encounterStarted = c.encounterStarted;
		if (c.encounterEnded) merged.encounterEnded = c.encounterEnded;
		if (c.deathSaveOutcome) merged.deathSaveOutcome = c.deathSaveOutcome;
		if (c.npcsAdded) pushUnique((merged.npcsAdded ??= []), c.npcsAdded, (npc) => npc.id);
		if (c.locationsAdded) pushUnique((merged.locationsAdded ??= []), c.locationsAdded, (loc) => loc.id);
		if (c.questsAdded) pushUnique((merged.questsAdded ??= []), c.questsAdded, (quest) => quest.id);
		if (c.sceneFactsAdded) pushUnique((merged.sceneFactsAdded ??= []), c.sceneFactsAdded, (fact) => fact);
		if (c.companionPromoted) merged.companionPromoted = c.companionPromoted;
	}
	return merged;
}

// ---------------------------------------------------------------------------
// Chat message persistence (durable player/party chat)
// ---------------------------------------------------------------------------

/** A persisted player chat message. */
export interface ChatRecord {
	id: string;
	adventureId: string;
	userId: string;
	username: string;
	text: string;
	mentions: string[];
	retroInvoked: boolean;
	consumedByTurn: number | null;
	createdAt: number;
}

/** Parse @mentions from a chat message text. Returns unique lowercase mention targets. */
export function parseMentions(text: string): string[] {
	const regex = /@(\w+)/g;
	const mentions = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		mentions.add(match[1].toLowerCase());
	}
	return [...mentions];
}

/** Persist a player chat message to the database. */
export async function persistChatMessage(
	adventureId: string,
	userId: string,
	username: string,
	text: string,
	id?: string
): Promise<ChatRecord> {
	const { ulid } = await import('ulid');
	const msgId = id ?? ulid();
	const mentions = parseMentions(text);
	const now = Date.now();

	await db.insert(adventureChat).values({
		id: msgId,
		adventureId,
		userId,
		username,
		text,
		mentionsJson: JSON.stringify(mentions),
		retroInvoked: false,
		consumedByTurn: null,
		createdAt: now
	});

	return {
		id: msgId,
		adventureId,
		userId,
		username,
		text,
		mentions,
		retroInvoked: false,
		consumedByTurn: null,
		createdAt: now
	};
}

/** Load recent chat messages for an adventure, in chronological order. */
export async function loadRecentChat(adventureId: string, limit = 50): Promise<ChatRecord[]> {
	const rows = await db
		.select()
		.from(adventureChat)
		.where(eq(adventureChat.adventureId, adventureId))
		.orderBy(desc(adventureChat.createdAt))
		.limit(limit);

	rows.reverse(); // chronological

	return rows.map((r) => ({
		id: r.id,
		adventureId: r.adventureId,
		userId: r.userId,
		username: r.username,
		text: r.text,
		mentions: JSON.parse(r.mentionsJson) as string[],
		retroInvoked: r.retroInvoked,
		consumedByTurn: r.consumedByTurn,
		createdAt: r.createdAt
	}));
}

/**
 * Load unconsumed chat messages since the last GM turn (for building GM context).
 * These are messages that haven't been included in a GM turn yet.
 */
export async function loadUnconsumedChat(adventureId: string): Promise<ChatRecord[]> {
	const rows = await db
		.select()
		.from(adventureChat)
		.where(
			and(
				eq(adventureChat.adventureId, adventureId),
				eq(adventureChat.consumedByTurn, null as unknown as number)
			)
		)
		.orderBy(adventureChat.createdAt);

	return rows.map((r) => ({
		id: r.id,
		adventureId: r.adventureId,
		userId: r.userId,
		username: r.username,
		text: r.text,
		mentions: JSON.parse(r.mentionsJson) as string[],
		retroInvoked: r.retroInvoked,
		consumedByTurn: r.consumedByTurn,
		createdAt: r.createdAt
	}));
}

/**
 * Mark chat messages as consumed by a specific GM turn.
 * Called after a GM turn successfully completes to associate messages with that turn.
 */
export async function markChatConsumed(chatIds: string[], turnNumber: number): Promise<void> {
	if (chatIds.length === 0) return;

	for (const chatId of chatIds) {
		await db
			.update(adventureChat)
			.set({ consumedByTurn: turnNumber })
			.where(eq(adventureChat.id, chatId));
	}
}

/**
 * Mark a chat message as retro-invoked (player chose to include it in a GM invocation).
 */
export async function markChatRetroInvoked(chatId: string): Promise<void> {
	await db
		.update(adventureChat)
		.set({ retroInvoked: true })
		.where(eq(adventureChat.id, chatId));
}
