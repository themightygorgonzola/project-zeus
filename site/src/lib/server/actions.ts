/**
 * Project Zeus — Server-Side Action Helpers
 *
 * Self-contained action functions the chat executor, API endpoints, or
 * background tasks can call directly without going through the AI pipeline.
 *
 * Each helper: loads state → validates → calls engine → builds TurnRecord
 * → persists atomically → returns ActionResult.
 *
 * These complement the chat-first turn pipeline (turn-executor.ts) by
 * providing a button-friendly path for mechanically unambiguous actions.
 */

import { ulid } from 'ulid';
import type {
	GameId,
	GameState,
	MechanicResult,
	StateChange,
	TurnRecord,
	TimeOfDay,
	Item
} from '$lib/game/types';
import { loadGameState, persistTurnAndSaveState } from '$lib/game/state';
import { shortRest, longRest } from '$lib/game/rest';
import { travelBetween, advanceClock, findLocation, getAvailableExits, type AvailableExit } from '$lib/game/travel';
import { useConsumable, equipItem, findItem } from '$lib/game/inventory';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionResult {
	success: boolean;
	/** Human-readable summary of what happened. */
	narrativeSummary: string;
	/** Engine dice rolls and checks. */
	mechanicResults: MechanicResult[];
	/** Structured description of what changed. */
	stateChanges: StateChange;
	/** Error reason when success=false. */
	error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fail(error: string): ActionResult {
	return { success: false, narrativeSummary: '', mechanicResults: [], stateChanges: {}, error };
}

function findActorByUserId(state: GameState, actorUserId: string) {
	return state.characters.find((c) => c.userId === actorUserId);
}

async function persistAction(
	adventureId: string,
	state: GameState,
	opts: {
		actorUserId: string;
		action: string;
		intent: TurnRecord['intent'];
		summary: string;
		mechanicResults: MechanicResult[];
		stateChanges: StateChange;
	}
): Promise<void> {
	const turnNumber = state.nextTurnNumber;
	state.nextTurnNumber++;

	const turn: TurnRecord = {
		id: ulid(),
		turnNumber,
		actorType: 'player',
		actorId: opts.actorUserId,
		action: opts.action,
		intent: opts.intent,
		status: 'completed',
		resolvedActionSummary: opts.summary,
		mechanicResults: opts.mechanicResults,
		stateChanges: opts.stateChanges,
		narrativeText: opts.summary,
		timestamp: Date.now()
	};

	state.turnLog.push(turn);
	if (state.turnLog.length > 50) {
		state.turnLog = state.turnLog.slice(-50);
	}

	await persistTurnAndSaveState(adventureId, turn, state);
}

// ---------------------------------------------------------------------------
// REST action
// ---------------------------------------------------------------------------

/**
 * Execute a short or long rest for the given player's character.
 * Short rests auto-spend up to half available hit dice.
 * Long rests heal the entire party, restore spell slots, and advance clock.
 */
export async function executeRestAction(
	adventureId: string,
	actorUserId: string,
	restType: 'short' | 'long'
): Promise<ActionResult> {
	const state = await loadGameState(adventureId);
	if (!state) return fail('No game state found');

	const actor = findActorByUserId(state, actorUserId);
	if (!actor) return fail('Character not found');

	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};
	let summary: string;

	if (restType === 'short') {
		const availableDice = actor.classes.reduce((sum, c) => sum + c.hitDiceRemaining, 0);
		const hpDeficit = actor.maxHp - actor.hp;
		const diceToSpend = hpDeficit > 0 ? Math.min(Math.ceil(availableDice / 2), availableDice) : 0;

		const result = shortRest(actor, diceToSpend);
		if (!result.success) return fail(result.reason ?? 'Cannot short rest');

		if (result.totalHealing > 0) {
			mechanicResults.push({
				type: 'healing',
				label: `Short rest healed ${result.totalHealing} HP (spent ${result.hitDiceResults.length} hit dice)`,
				dice: { notation: `${result.hitDiceResults.length} hit dice`, rolls: result.hitDiceResults.map((r) => r.rolled), total: result.totalHealing }
			});
			stateChanges.hpChanges = [{
				characterId: actor.id,
				oldHp: result.previousHp,
				newHp: result.currentHp,
				reason: 'Short rest'
			}];
		}

		if (result.hitDiceResults.length > 0) {
			stateChanges.hitDiceUsed = { characterId: actor.id, amount: result.hitDiceResults.length };
		}

		const clockFrom = { ...state.clock };
		const clockTo = advanceClock(state.clock, 2);
		stateChanges.clockAdvance = { from: clockFrom, to: clockTo };
		state.clock = clockTo;

		// Apply updated character
		const idx = state.characters.findIndex((c) => c.id === actor.id);
		if (idx >= 0) state.characters[idx] = result.character;

		summary = `Short rest${result.hitDiceResults.length > 0 ? ` — healed ${result.totalHealing} HP (${result.hitDiceResults.length} hit dice)` : ' — no healing needed'}`;
	} else {
		// Long rest heals the entire party
		const healingSummaries: string[] = [];
		for (let i = 0; i < state.characters.length; i++) {
			const result = longRest(state.characters[i]);
			if (result.success) {
				state.characters[i] = result.character;
				if (result.hpHealed > 0) {
					healingSummaries.push(`${result.character.name} healed ${result.hpHealed} HP`);
					if (!stateChanges.hpChanges) stateChanges.hpChanges = [];
					stateChanges.hpChanges.push({
						characterId: result.character.id,
						oldHp: result.previousHp,
						newHp: result.currentHp,
						reason: 'Long rest'
					});
				}
			}
		}

		const clockFrom = { ...state.clock };
		const clockTo = advanceClock(state.clock, 8);
		stateChanges.clockAdvance = { from: clockFrom, to: clockTo };
		state.clock = clockTo;

		summary = `Long rest — party fully restored${healingSummaries.length > 0 ? ` (${healingSummaries.join(', ')})` : ''}`;
	}

	await persistAction(adventureId, state, {
		actorUserId,
		action: `${restType} rest`,
		intent: 'rest',
		summary,
		mechanicResults,
		stateChanges
	});

	return { success: true, narrativeSummary: summary, mechanicResults, stateChanges };
}

// ---------------------------------------------------------------------------
// TRAVEL action
// ---------------------------------------------------------------------------

/**
 * Travel the party to a connected destination.
 * Advances the clock and may trigger a random encounter.
 */
export async function executeTravelAction(
	adventureId: string,
	actorUserId: string,
	destinationId: GameId
): Promise<ActionResult> {
	const state = await loadGameState(adventureId);
	if (!state) return fail('No game state found');

	const actor = findActorByUserId(state, actorUserId);
	if (!actor) return fail('Character not found');

	const fromId = state.partyLocationId;
	if (!fromId) return fail('Party has no current location');

	const result = travelBetween(state, fromId, destinationId);
	if (!result.success) return fail(result.reason ?? 'Travel failed');

	// travelBetween mutates state — clock, partyLocationId, location.visited
	const dest = findLocation(state, destinationId);
	const destName = dest?.name ?? destinationId;

	const summary = `Traveled to ${destName} (${result.periodsElapsed} periods elapsed)`;

	await persistAction(adventureId, state, {
		actorUserId,
		action: `travel to ${destName}`,
		intent: 'move',
		summary,
		mechanicResults: [],
		stateChanges: result.stateChanges
	});

	return { success: true, narrativeSummary: summary, mechanicResults: [], stateChanges: result.stateChanges };
}

// ---------------------------------------------------------------------------
// USE-ITEM action
// ---------------------------------------------------------------------------

/**
 * Use a consumable item from the character's inventory.
 */
export async function executeUseItemAction(
	adventureId: string,
	actorUserId: string,
	itemId: GameId
): Promise<ActionResult> {
	const state = await loadGameState(adventureId);
	if (!state) return fail('No game state found');

	const actor = findActorByUserId(state, actorUserId);
	if (!actor) return fail('Character not found');

	const item = findItem(actor, itemId);
	if (!item) return fail('Item not found in inventory');

	const result = useConsumable(actor, itemId);
	if (!result.success) return fail(result.reason ?? 'Cannot use item');

	const mechanicResults: MechanicResult[] = [];
	const stateChanges: StateChange = {};

	if (result.healing !== undefined && result.healing > 0) {
		mechanicResults.push({
			type: 'healing',
			label: `${item.name} healed ${result.healing} HP`,
			dice: { notation: item.name, rolls: [result.healing], total: result.healing }
		});
		stateChanges.hpChanges = [{
			characterId: actor.id,
			oldHp: actor.hp,
			newHp: result.character.hp,
			reason: `Used ${item.name}`
		}];
	}

	if (result.itemRemoved) {
		stateChanges.itemsLost = [{ characterId: actor.id, itemId: item.id, quantity: 1 }];
	}

	// Apply updated character
	const idx = state.characters.findIndex((c) => c.id === actor.id);
	if (idx >= 0) state.characters[idx] = result.character;

	const summary = `Used ${item.name}${result.healing ? ` (healed ${result.healing} HP)` : ''}`;

	await persistAction(adventureId, state, {
		actorUserId,
		action: `use ${item.name}`,
		intent: 'use-item',
		summary,
		mechanicResults,
		stateChanges
	});

	return { success: true, narrativeSummary: summary, mechanicResults, stateChanges };
}

// ---------------------------------------------------------------------------
// WAIT action
// ---------------------------------------------------------------------------

/**
 * Wait / advance the clock without resting.
 * Can wait a specific number of hours or until a time of day.
 */
export async function executeWaitAction(
	adventureId: string,
	actorUserId: string,
	options: { until?: TimeOfDay; hours?: number }
): Promise<ActionResult> {
	const TIME_CYCLE: TimeOfDay[] = ['dawn', 'morning', 'afternoon', 'dusk', 'night'];

	const state = await loadGameState(adventureId);
	if (!state) return fail('No game state found');

	const actor = findActorByUserId(state, actorUserId);
	if (!actor) return fail('Character not found');

	let periods: number;

	if (options.until) {
		const currentIdx = TIME_CYCLE.indexOf(state.clock.timeOfDay);
		const targetIdx = TIME_CYCLE.indexOf(options.until);
		if (currentIdx < 0 || targetIdx < 0) return fail('Invalid time of day');
		periods = targetIdx > currentIdx
			? targetIdx - currentIdx
			: TIME_CYCLE.length - currentIdx + targetIdx;
		if (periods === 0) periods = TIME_CYCLE.length; // wait full cycle
	} else if (options.hours && options.hours > 0) {
		// Rough approximation: each period ≈ 4-5 hours, so 1 hour ≈ 0.2 periods
		// Better: use 5 periods = 1 day (24h), so 1 period ≈ 4.8h
		periods = Math.max(1, Math.round(options.hours / 4.8));
	} else {
		periods = 1; // default: wait one period
	}

	const clockFrom = { ...state.clock };
	const clockTo = advanceClock(state.clock, periods);
	const stateChanges: StateChange = { clockAdvance: { from: clockFrom, to: clockTo } };
	state.clock = clockTo;

	const summary = options.until
		? `Waited until ${options.until} (${periods} periods)`
		: `Waited ${periods} period${periods !== 1 ? 's' : ''}`;

	await persistAction(adventureId, state, {
		actorUserId,
		action: options.until ? `wait until ${options.until}` : `wait ${options.hours ?? 1} hours`,
		intent: 'rest',
		summary,
		mechanicResults: [],
		stateChanges
	});

	return { success: true, narrativeSummary: summary, mechanicResults: [], stateChanges };
}

// ---------------------------------------------------------------------------
// EQUIP action
// ---------------------------------------------------------------------------

/**
 * Equip an item from the character's inventory.
 */
export async function executeEquipAction(
	adventureId: string,
	actorUserId: string,
	itemId: GameId
): Promise<ActionResult> {
	const state = await loadGameState(adventureId);
	if (!state) return fail('No game state found');

	const actor = findActorByUserId(state, actorUserId);
	if (!actor) return fail('Character not found');

	const item = findItem(actor, itemId);
	if (!item) return fail('Item not found in inventory');

	const result = equipItem(actor, itemId);
	if (!result.success) return fail(result.reason ?? 'Cannot equip item');

	const idx = state.characters.findIndex((c) => c.id === actor.id);
	if (idx >= 0) state.characters[idx] = result.character;

	const summary = `Equipped ${item.name}`;

	await persistAction(adventureId, state, {
		actorUserId,
		action: `equip ${item.name}`,
		intent: 'use-item',
		summary,
		mechanicResults: [],
		stateChanges: {}
	});

	return { success: true, narrativeSummary: summary, mechanicResults: [], stateChanges: {} };
}
