import { tasks } from '@trigger.dev/sdk';
import { ulid } from 'ulid';
import { completeChat, streamChat, type ChatMessageInput } from './openai';
import { notifyRoom } from './party';
import { loadGameState, saveGameState, persistTurn, loadRecentTurns } from '$lib/game/state';
import { assembleGMContext } from '$lib/game/gm-context';
import type {
	GameState,
	GMResponse,
	IntentType,
	MechanicResult,
	StateChange,
	TurnRecord
} from '$lib/game/types';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

// ---------------------------------------------------------------------------
// Public types (unchanged interface for existing callers)
// ---------------------------------------------------------------------------

export type AdventureTurnPurpose = 'interactive-chat' | 'background-turn';
export type AdventureTurnMode = 'inline' | 'background';

export interface AdventureTurnPayload {
	adventureId: string;
	playerAction: string;
	actorUserId: string;
	history: ChatMessageInput[];
}

export interface AdventureTurnProfile {
	purpose: AdventureTurnPurpose;
	mode: AdventureTurnMode;
	model: string;
	stream: boolean;
}

export interface AdventureTurnDispatchInput {
	adventureId: string;
	playerAction: string;
	actorUserId?: string;
	purpose?: AdventureTurnPurpose;
	mode?: AdventureTurnMode | 'auto';
	model?: string;
}

export interface AdventureTurnTaskPayload {
	payload: AdventureTurnPayload;
	profile: AdventureTurnProfile;
}

// ---------------------------------------------------------------------------
// Profile resolution (unchanged)
// ---------------------------------------------------------------------------

export function resolveAdventureTurnProfile({
	purpose = 'interactive-chat',
	mode = 'auto',
	model
}: Pick<AdventureTurnDispatchInput, 'purpose' | 'mode' | 'model'>): AdventureTurnProfile {
	const configuredInteractiveMode = (process.env.AI_INTERACTIVE_MODE as AdventureTurnMode | undefined) ?? 'inline';
	const resolvedMode = mode === 'auto' || !mode
		? (purpose === 'interactive-chat' ? configuredInteractiveMode : 'background')
		: mode;

	const interactiveModel = process.env.OPENAI_MODEL_INTERACTIVE ?? process.env.OPENAI_MODEL ?? 'gpt-4o';
	const backgroundModel = process.env.OPENAI_MODEL_BACKGROUND ?? process.env.OPENAI_MODEL ?? 'gpt-4o';

	return {
		purpose,
		mode: resolvedMode,
		model: model ?? (resolvedMode === 'inline' ? interactiveModel : backgroundModel),
		stream: purpose === 'interactive-chat'
	};
}

// ---------------------------------------------------------------------------
// Payload builder — now game-state-aware
// ---------------------------------------------------------------------------

export async function buildAdventureTurnPayload(
	input: AdventureTurnDispatchInput
): Promise<AdventureTurnPayload> {
	// Load game state and recent turns for conversation history
	const state = await loadGameState(input.adventureId);
	const recentTurns = await loadRecentTurns(input.adventureId);

	// Try to extract world from state for context assembly
	let world: PrototypeWorld | null = null;
	if (state) {
		// World may have been stored in legacy format or separately.
		// The context assembler handles null gracefully.
		try {
			const raw = await loadWorldFromState(input.adventureId);
			if (raw) world = raw;
		} catch {
			// Non-fatal — GM will just have less context
		}
	}

	// Assemble rich context if game state exists, otherwise fall back to basic prompt
	let history: ChatMessageInput[];
	if (state) {
		history = assembleGMContext(state, world, recentTurns, input.playerAction);
		// Remove the last user message — executeAdventureTurn appends it separately
		// (the assembler includes it, so pop it to avoid duplication)
		if (history.length > 0 && history[history.length - 1].role === 'user') {
			history.pop();
		}
	} else {
		// Fallback: basic system prompt (pre-game-layer adventures)
		history = [{
			role: 'system',
			content:
				'You are a Game Master running a text-based fantasy RPG adventure. ' +
				'Respond in character as the GM: describe what happens as a result of ' +
				"the player's action in 2–4 vivid sentences. Advance the story, add " +
				'tension or wonder, and end with an implicit or explicit prompt for ' +
				"the player's next move."
		}];
	}

	return {
		adventureId: input.adventureId,
		playerAction: input.playerAction,
		actorUserId: input.actorUserId ?? '',
		history
	};
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchAdventureTurn(input: AdventureTurnDispatchInput): Promise<{
	mode: AdventureTurnMode;
	model: string;
}> {
	const payload = await buildAdventureTurnPayload(input);
	const profile = resolveAdventureTurnProfile(input);

	if (profile.mode === 'background') {
		await tasks.trigger('adventure-turn', { payload, profile } satisfies AdventureTurnTaskPayload);
		return { mode: profile.mode, model: profile.model };
	}

	await executeAdventureTurn(payload, profile);
	return { mode: profile.mode, model: profile.model };
}

// ---------------------------------------------------------------------------
// Execution — now persists turns and applies structured state changes
// ---------------------------------------------------------------------------

export async function executeAdventureTurn(
	payload: AdventureTurnPayload,
	profile: AdventureTurnProfile
): Promise<{ narrativeText: string; model: string }> {
	const partyHost = process.env.PARTYKIT_HOST;
	const openaiKey = process.env.OPENAI_API_KEY;

	if (!partyHost) throw new Error('PARTYKIT_HOST env var is not set');
	if (!openaiKey) throw new Error('OPENAI_API_KEY env var is not set');

	const messages = [...payload.history, { role: 'user', content: payload.playerAction } satisfies ChatMessageInput];

	await notifyRoom(partyHost, payload.adventureId, {
		type: 'ai:turn:start',
		model: profile.model,
		purpose: profile.purpose
	});

	try {
		let rawResponse = '';

		if (profile.stream) {
			rawResponse = await streamChat(
				{ apiKey: openaiKey, model: profile.model, messages },
				async (chunk) => {
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:chunk',
						text: chunk
					});
				}
			);
		} else {
			rawResponse = await completeChat({ apiKey: openaiKey, model: profile.model, messages });
		}

		// Parse structured response (graceful fallback to raw text)
		const gmResponse = parseGMResponse(rawResponse);

		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:end',
			text: gmResponse.narrativeText,
			model: profile.model
		});

		// Persist the turn and apply state changes
		await persistTurnAndState(payload, gmResponse, profile);

		return { narrativeText: gmResponse.narrativeText, model: profile.model };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Unknown AI error';
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:error',
			message
		});
		throw cause;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the AI response as a structured GMResponse.
 * Falls back gracefully: if the AI returns plain text instead of JSON,
 * we treat the whole thing as narrativeText with no state changes.
 */
function parseGMResponse(raw: string): GMResponse {
	// Try JSON parse first
	try {
		const trimmed = raw.trim();
		// Handle markdown code blocks wrapping JSON
		const jsonStr = trimmed.startsWith('```')
			? trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
			: trimmed;

		const parsed = JSON.parse(jsonStr);
		if (parsed && typeof parsed.narrativeText === 'string') {
			return {
				narrativeText: parsed.narrativeText,
				stateChanges: parsed.stateChanges ?? {},
				gmNotes: parsed.gmNotes
			};
		}
	} catch {
		// Not valid JSON — fall through
	}

	// Fallback: treat the whole response as narrative text
	return {
		narrativeText: raw,
		stateChanges: {}
	};
}

/**
 * Persist the turn record and apply any state changes the GM returned.
 */
async function persistTurnAndState(
	payload: AdventureTurnPayload,
	gmResponse: GMResponse,
	profile: AdventureTurnProfile
): Promise<void> {
	const state = await loadGameState(payload.adventureId);
	if (!state) return; // No game state yet — skip persistence (legacy adventure)

	const turnNumber = state.nextTurnNumber;
	state.nextTurnNumber++;

	const turn: TurnRecord = {
		id: ulid(),
		turnNumber,
		actorType: 'player',
		actorId: payload.actorUserId,
		action: payload.playerAction,
		intent: classifyIntent(payload.playerAction),
		mechanicResults: [],
		stateChanges: gmResponse.stateChanges,
		narrativeText: gmResponse.narrativeText,
		timestamp: Date.now()
	};

	// Apply structured state changes from the GM
	applyGMStateChanges(state, gmResponse.stateChanges);

	// Append to in-memory log (kept short — the full history lives in the DB)
	state.turnLog.push(turn);
	if (state.turnLog.length > 50) {
		state.turnLog = state.turnLog.slice(-50);
	}

	// Persist
	await persistTurn(payload.adventureId, turn);
	await saveGameState(payload.adventureId, state);
}

/**
 * Apply the GM's proposed state changes to the GameState.
 * Validates lightly — the GM is semi-trusted but we clamp values.
 */
function applyGMStateChanges(state: GameState, changes: StateChange): void {
	if (!changes) return;

	// HP changes
	if (changes.hpChanges) {
		for (const hc of changes.hpChanges) {
			const char = state.characters.find((c) => c.id === hc.characterId);
			if (char) {
				char.hp = Math.max(0, Math.min(hc.newHp, char.maxHp));
			}
		}
	}

	// Conditions
	if (changes.conditionsApplied) {
		for (const ca of changes.conditionsApplied) {
			const char = state.characters.find((c) => c.id === ca.characterId);
			if (char) {
				if (ca.applied && !char.conditions.includes(ca.condition)) {
					char.conditions.push(ca.condition);
				} else if (!ca.applied) {
					char.conditions = char.conditions.filter((c) => c !== ca.condition);
				}
			}
		}
	}

	// XP
	if (changes.xpAwarded) {
		for (const xp of changes.xpAwarded) {
			const char = state.characters.find((c) => c.id === xp.characterId);
			if (char) {
				char.xp += xp.amount;
			}
		}
	}

	// Location change
	if (changes.locationChange) {
		state.partyLocationId = changes.locationChange.to;
		const loc = state.locations.find((l) => l.id === changes.locationChange!.to);
		if (loc) loc.visited = true;
	}

	// Quest updates
	if (changes.questUpdates) {
		for (const qu of changes.questUpdates) {
			const quest = state.quests.find((q) => q.id === qu.questId);
			if (quest && qu.field === 'status' && typeof qu.newValue === 'string') {
				quest.status = qu.newValue as typeof quest.status;
			}
		}
	}

	// NPC changes
	if (changes.npcChanges) {
		for (const nc of changes.npcChanges) {
			const npc = state.npcs.find((n) => n.id === nc.npcId);
			if (npc) {
				if (nc.field === 'disposition' && typeof nc.newValue === 'number') {
					npc.disposition = Math.max(-100, Math.min(100, nc.newValue));
				}
				if (nc.field === 'alive' && typeof nc.newValue === 'boolean') {
					npc.alive = nc.newValue;
				}
			}
		}
	}

	// Clock advance
	if (changes.clockAdvance) {
		state.clock = changes.clockAdvance.to;
	}
}

/**
 * Simple intent classifier — keyword-based for now.
 * Can be upgraded to an AI classification call later.
 */
function classifyIntent(action: string): IntentType {
	const lower = action.toLowerCase();

	if (/\b(attack|strike|hit|fight|slash|stab|shoot)\b/.test(lower)) return 'attack';
	if (/\b(go|move|walk|travel|head|enter|leave|climb|swim|run|flee)\b/.test(lower)) return 'move';
	if (/\b(talk|speak|say|ask|tell|greet|persuade|intimidate|negotiate)\b/.test(lower)) return 'talk';
	if (/\b(use|drink|eat|apply|open|activate|read)\b/.test(lower)) return 'use-item';
	if (/\b(cast|spell|magic|invoke|conjure|summon)\b/.test(lower)) return 'cast-spell';
	if (/\b(look|examine|inspect|search|investigate|check)\b/.test(lower)) return 'examine';
	if (/\b(rest|sleep|camp|short rest|long rest)\b/.test(lower)) return 'rest';
	if (/^\(|^\[|^ooc\b|^\/\//.test(lower)) return 'out-of-character';

	return 'free-narration';
}

/**
 * Load the PrototypeWorld from the adventure state (stored in legacy format).
 */
async function loadWorldFromState(adventureId: string): Promise<PrototypeWorld | null> {
	const { db } = await import('$lib/server/db/client');
	const { adventureState } = await import('$lib/server/db/schema');
	const { eq } = await import('drizzle-orm');

	const rows = await db
		.select({ stateJson: adventureState.stateJson })
		.from(adventureState)
		.where(eq(adventureState.adventureId, adventureId))
		.limit(1);

	if (rows.length === 0) return null;

	try {
		const raw = JSON.parse(rows[0].stateJson);
		// Legacy format stored world directly in state
		if (raw.world && typeof raw.world === 'object' && raw.world.engine) {
			return raw.world as PrototypeWorld;
		}
		return null;
	} catch {
		return null;
	}
}
