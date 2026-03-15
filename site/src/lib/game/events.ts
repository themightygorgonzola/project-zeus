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

// ---------------------------------------------------------------------------
// Clock events
// ---------------------------------------------------------------------------

export interface ClockAdvanceEvent extends BaseGameEvent<'game:clock-advance'> {
	from: GameClock;
	to: GameClock;
}

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
	| TurnCompleteEvent
	| CharacterUpdateEvent
	| CharacterDownEvent
	| LocationChangeEvent
	| NpcInteractionEvent
	| QuestUpdateEvent
	| CombatStartEvent
	| CombatEndEvent
	| ClockAdvanceEvent;

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
