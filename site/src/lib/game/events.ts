/**
 * Project Zeus — Game Event Contract
 *
 * Every event the game layer can emit. The UI subscribes to these through
 * PartyKit or direct callback — it never reaches into game internals.
 *
 * This is the **stability boundary** between the game domain and the
 * rendering layer. The UI team can restyle, restructure, or swap the
 * frontend framework as long as they consume these event shapes.
 */

import type {
	Condition,
	DiceResult,
	GameClock,
	GameId,
	Item,
	MechanicResult,
	PendingCheck,
	PlayerCharacter,
	Quest,
	NPC,
	Location,
	StateChange,
	TurnRecord
} from './types';

// ---------------------------------------------------------------------------
// Base envelope — every event has a discriminated `type` field
// ---------------------------------------------------------------------------

interface BaseGameEvent<T extends string> {
	type: T;
	/** Adventure ID this event belongs to. */
	adventureId: string;
	/** Server-assigned monotonic timestamp. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Narrative events (streaming text from the GM)
// ---------------------------------------------------------------------------

/** GM narration has begun for a new turn. */
export interface NarrativeStartEvent extends BaseGameEvent<'narrative:start'> {
	turnNumber: number;
	model: string;
}

/** A streamed text chunk from the GM. */
export interface NarrativeChunkEvent extends BaseGameEvent<'narrative:chunk'> {
	turnNumber: number;
	text: string;
}

/** GM narration for this turn is complete. */
export interface NarrativeEndEvent extends BaseGameEvent<'narrative:end'> {
	turnNumber: number;
	fullText: string;
}

/** GM narration errored. */
export interface NarrativeErrorEvent extends BaseGameEvent<'narrative:error'> {
	turnNumber: number;
	error: string;
}

// ---------------------------------------------------------------------------
// Game state events
// ---------------------------------------------------------------------------

/** Batch state changes applied after a turn resolution. */
export interface StateUpdateEvent extends BaseGameEvent<'game:state-update'> {
	turnNumber: number;
	changes: StateChange;
}

/** A dice roll was resolved (for client-side dice animation). */
export interface DiceRollEvent extends BaseGameEvent<'game:dice-roll'> {
	characterId: GameId | null;
	characterName: string | null;
	label: string;
	result: MechanicResult;
}

/** Engine requests a roll from the player before narration can proceed (Phase B3). */
export interface RollRequestEvent extends BaseGameEvent<'game:roll-request'> {
	pendingCheck: PendingCheck;
}

/** A full turn record was persisted (sent after the turn is fully resolved). */
export interface TurnCompleteEvent extends BaseGameEvent<'game:turn-complete'> {
	turn: TurnRecord;
}

// ---------------------------------------------------------------------------
// Character events
// ---------------------------------------------------------------------------

/** A player character was created or updated. */
export interface CharacterUpdateEvent extends BaseGameEvent<'game:character-update'> {
	character: PlayerCharacter;
	reason: 'created' | 'level-up' | 'damage' | 'healing' | 'inventory' | 'condition' | 'other';
}

/** A character was knocked unconscious or killed. */
export interface CharacterDownEvent extends BaseGameEvent<'game:character-down'> {
	characterId: GameId;
	characterName: string;
	unconscious: boolean;
	dead: boolean;
}

// ---------------------------------------------------------------------------
// Location events
// ---------------------------------------------------------------------------

/** Party location changed. Includes the new location's description. */
export interface LocationChangeEvent extends BaseGameEvent<'game:location-change'> {
	from: Location | null;
	to: Location;
}

// ---------------------------------------------------------------------------
// NPC events
// ---------------------------------------------------------------------------

/** An NPC interaction began or changed. */
export interface NpcInteractionEvent extends BaseGameEvent<'game:npc-interaction'> {
	npc: NPC;
	interactionType: 'dialogue' | 'trade' | 'confrontation' | 'discovered';
}

// ---------------------------------------------------------------------------
// Quest events
// ---------------------------------------------------------------------------

export interface QuestUpdateEvent extends BaseGameEvent<'game:quest-update'> {
	quest: Quest;
	reason: 'discovered' | 'accepted' | 'objective-complete' | 'completed' | 'failed';
}

// ---------------------------------------------------------------------------
// Combat events
// ---------------------------------------------------------------------------

export interface CombatStartEvent extends BaseGameEvent<'game:combat-start'> {
	enemies: string[];
}

export interface CombatEndEvent extends BaseGameEvent<'game:combat-end'> {
	outcome: 'victory' | 'defeat' | 'fled' | 'negotiated';
	xpAwarded: number;
}

/**
 * Emitted after each actor in a combat round resolves their action.
 * Signals to clients which combatant acts next and whether a human can fill the slot.
 */
export interface CombatTurnEvent extends BaseGameEvent<'game:combat-turn'> {
	/** Combatant whose turn just finished (null at the very start of combat). */
	previousCombatantId: GameId | null;
	/** Combatant whose turn is next (null when the round just ended). */
	nextCombatantId: GameId | null;
	nextCombatantName: string | null;
	/** 'character' = specific PC, 'companion' = any player can fill, 'npc' = auto-resolved */
	nextCombatantType: 'character' | 'companion' | 'npc' | null;
	/** If nextCombatantType === 'character', the userId of the player whose turn it is. */
	awaitingUserId?: string | null;
	/** True when all actors have gone and round-end narration is about to be generated. */
	roundComplete: boolean;
	round: number;
}

// ---------------------------------------------------------------------------
// Clock events
// ---------------------------------------------------------------------------

export interface ClockAdvanceEvent extends BaseGameEvent<'game:clock-advance'> {
	from: GameClock;
	to: GameClock;
}

// ---------------------------------------------------------------------------
// World-building events
// ---------------------------------------------------------------------------

/** New NPC(s) were introduced to the world. */
export interface NpcDiscoveredEvent extends BaseGameEvent<'game:npc-discovered'> {
	npcId: GameId;
	name: string;
	role: string;
	locationId: GameId;
}

/** A new location was revealed or created. */
export interface LocationDiscoveredEvent extends BaseGameEvent<'game:location-discovered'> {
	locationId: GameId;
	name: string;
	locationType: string;
	description: string;
}

/** A new quest was introduced. */
export interface QuestDiscoveredEvent extends BaseGameEvent<'game:quest-discovered'> {
	questId: GameId;
	name: string;
	description: string;
}

// ---------------------------------------------------------------------------
// Enrichment events
// ---------------------------------------------------------------------------

/** Background enrichment task completed. */
export interface EnrichmentCompleteEvent extends BaseGameEvent<'enrichment:complete'> {
	/** Which enrichment task ran. */
	taskType: 'expand-settlement' | 'extend-quest-arc' | 'react-to-party';
	/** Human-readable summary of what was generated. */
	summary: string;
	/** The state changes that were applied. */
	changes: StateChange;
}

// ---------------------------------------------------------------------------
// Inventory events
// ---------------------------------------------------------------------------

/** An item was added to a character's inventory. */
export interface InventoryAcquiredEvent extends BaseGameEvent<'inventory:acquired'> {
	characterId: GameId;
	characterName: string;
	item: Item;
}

/** An item was consumed or removed from a character's inventory. */
export interface InventoryRemovedEvent extends BaseGameEvent<'inventory:removed'> {
	characterId: GameId;
	characterName: string;
	item: Item;
	reason: 'consumed' | 'dropped' | 'given' | 'destroyed';
}

// ---------------------------------------------------------------------------
// Interactive clarification events
// ---------------------------------------------------------------------------

/** Option presented to the player during a clarification request. */
export interface ClarificationOption {
	id: string;
	label: string;
	description?: string;
}

/**
 * Engine requests the player to choose between multiple valid options
 * instead of asking an open-ended text question.
 */
export interface ClarificationRequestEvent extends BaseGameEvent<'game:clarification-request'> {
	/** The question being asked. */
	prompt: string;
	/** The category of clarification (item, target, direction, etc.) */
	category: 'item' | 'target' | 'direction' | 'action' | 'other';
	/** Available options the player can click on. */
	options: ClarificationOption[];
	/** Optional character context. */
	characterId?: GameId;
}

// ---------------------------------------------------------------------------
// World events (structured, not chat-based)
// ---------------------------------------------------------------------------

/** Party location changed — fires as a notification, not chat text. */
export interface WorldLocationUpdateEvent extends BaseGameEvent<'world:location-update'> {
	from: Location | null;
	to: Location;
}

/**
 * Time advanced in the game world.
 * Replaces the old hack of pushing time changes through game:dice-roll.
 */
export interface WorldTimeAdvanceEvent extends BaseGameEvent<'world:time-advance'> {
	from: GameClock;
	to: GameClock;
	/** Human-readable summary like "4 hours pass" */
	summary: string;
}

// ---------------------------------------------------------------------------
// Turn phase events (pipeline progress — client shows status text)
// ---------------------------------------------------------------------------

/** Combat classifier is running (~150ms). Client shows "Reading your action…" */
export interface TurnClassifyingEvent extends BaseGameEvent<'game:turn:classifying'> {}

/** State-extraction pass 2 is running after narration. Client shows "Applying results…" */
export interface TurnExtractingEvent extends BaseGameEvent<'game:turn:extracting'> {}

/** Deterministic rewards computed. Client can briefly flash XP/quest/loot info. */
export interface TurnRewardingEvent extends BaseGameEvent<'game:turn:rewarding'> {
	xpAwarded?: { characterId: string; amount: number }[];
	questsCompleted?: { questId: string; name: string }[];
	objectivesCompleted?: { questId: string; objectiveId: string; text: string }[];
	loot?: { characterId: string; itemName: string }[];
}

/** A combat query is being answered (no turn consumed). */
export interface TurnQueryEvent extends BaseGameEvent<'game:turn:query'> {}

// ---------------------------------------------------------------------------
// Union type — everything the UI might receive
// ---------------------------------------------------------------------------

export type GameEvent =
	| NarrativeStartEvent
	| NarrativeChunkEvent
	| NarrativeEndEvent
	| NarrativeErrorEvent
	| StateUpdateEvent
	| DiceRollEvent
	| RollRequestEvent
	| TurnCompleteEvent
	| CharacterUpdateEvent
	| CharacterDownEvent
	| LocationChangeEvent
	| NpcInteractionEvent
	| QuestUpdateEvent
	| CombatStartEvent
	| CombatEndEvent
	| CombatTurnEvent
	| ClockAdvanceEvent
	| NpcDiscoveredEvent
	| LocationDiscoveredEvent
	| QuestDiscoveredEvent
	| EnrichmentCompleteEvent
	| InventoryAcquiredEvent
	| InventoryRemovedEvent
	| ClarificationRequestEvent
	| WorldLocationUpdateEvent
	| WorldTimeAdvanceEvent
	| TurnClassifyingEvent
	| TurnExtractingEvent
	| TurnRewardingEvent
	| TurnQueryEvent;

/**
 * Type guard for narrowing by event type.
 *
 * Usage:
 *   if (isGameEvent(evt, 'game:dice-roll')) { evt.result … }
 */
export function isGameEvent<T extends GameEvent['type']>(
	evt: GameEvent,
	type: T
): evt is Extract<GameEvent, { type: T }> {
	return evt.type === type;
}
