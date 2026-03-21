import { tasks } from '@trigger.dev/sdk';
import { ulid } from 'ulid';
import { completeChat, completeChatJSON, streamChat, type ChatMessageInput } from './openai';
import { notifyRoom } from './party';
import { loadGameState, saveGameState, persistTurn, persistTurnAndSaveState, loadRecentTurns, loadUnconsumedChat, markChatConsumed } from '$lib/game/state';
import type { ChatRecord } from '$lib/game/state';
import { assembleGMContext, assembleNarrativeGMContext, assembleNarratorContext, assembleRoundNarratorContext, assembleStateExtractionContext } from '$lib/game/gm-context';
import { resolveTurn, type ResolvedTurn } from './turn-executor';
import type {
	Condition,
	GameId,
	GameState,
	GMResponse,
	Item,
	Location,
	LocationType,
	MechanicResult,
	NPC,
	NpcRole,
	PendingCheck,
	Quest,
	StateChange,
	TurnRecord
} from '$lib/game/types';
import type { GameEvent } from '$lib/game/events';
import type { PrototypeWorld } from '$lib/worldgen/prototype';
import { canLevelUp, applyLevelUp } from '$lib/game/leveling';
import { createEncounter, resolveEncounter, initEncounterTurnOrder } from '$lib/game/combat';
import { generateCreatureStatBlock, averagePartyLevel, parseCreatureTier } from '$lib/game/creature-templates';
import { skillCheck, abilityCheck, savingThrow } from '$lib/game/mechanics';
import { SKILL_ABILITY_MAP } from '$lib/game/types';

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
	recentChat: ChatRecord[];
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
// Debug capture (persisted to DB when DEBUG_TURNS env is set)
// ---------------------------------------------------------------------------

export interface TurnDebugData {
	/** 'narrator' = engine resolved mechanics, AI narrates. 'full-gm' = AI owns state. 'full-gm-2pass' = two-pass AI. 'clarification' = needs more info. 'awaiting-roll' = pending check. 'mid-round' = mid-round combat shortcut (no AI). */
	mode: 'narrator' | 'full-gm' | 'full-gm-2pass' | 'clarification' | 'awaiting-roll' | 'mid-round';
	model: string;
	/** Exact message array sent to OpenAI (Pass 1, or the only pass), in order. */
	messages: ChatMessageInput[];
	/** Verbatim string returned by the model (Pass 1, or the only pass — before any parsing). */
	rawAiResponse: string;
	/** Parsed GMResponse (full-gm mode only). */
	parsedGmResponse?: GMResponse;
	/** What the turn-executor engine proposed (before AI merge). */
	engineStateChanges: StateChange;
	/** What the AI's JSON proposed (full-gm mode only, before merge). */
	gmStateChanges?: StateChange;
	/** The final merged/applied state changes. */
	mergedStateChanges: StateChange;
	/** Wall-clock ms from first streamChat/completeChat call to response received. */
	latencyMs: number;
	/** Pass 2 (state extraction) messages — two-pass mode only. */
	pass2Messages?: ChatMessageInput[];
	/** Verbatim string returned by the state extraction model (two-pass mode only). */
	rawPass2Response?: string;
	/** Wall-clock ms for Pass 2 only — two-pass mode only. */
	pass2LatencyMs?: number;
	/** The engine's classified intent for this turn (e.g. 'attack', 'move', 'cast-spell', etc.). */
	engineIntent?: string;
	/** If this turn produced a PendingCheck, capture it for debugging. */
	pendingCheck?: PendingCheck;
	/** Whether the engine resolved combat with MechanicResult[] this turn. */
	engineResolvedCombat?: boolean;
	/** Whether the round completed on this turn (round-end narration fired). */
	roundComplete?: boolean;
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
	const recentChat = await loadUnconsumedChat(input.adventureId);

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
		history = assembleGMContext(state, world, recentTurns, input.playerAction, [], recentChat);
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
		history,
		recentChat
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
	const debugTurns = process.env.DEBUG_TURNS !== 'false'; // on by default
	const currentState = await loadGameState(payload.adventureId);
	const resolvedTurn = resolveTurn(payload.playerAction, currentState, payload.actorUserId);
	if (resolvedTurn.status === 'needs-clarification') {
		const clarificationText = resolvedTurn.clarification?.question ?? 'I need a little more detail before I can resolve that action.';
		if (partyHost) {
			await notifyRoom(partyHost, payload.adventureId, {
				type: 'ai:turn:start',
				model: 'server-executor',
				purpose: profile.purpose
			});
			await notifyRoom(partyHost, payload.adventureId, {
				type: 'ai:turn:end',
				text: clarificationText,
				model: 'server-executor'
			});
		}
		const clarificationDebug = debugTurns ? buildClarificationDebug(resolvedTurn.stateChanges) : null;
		await persistResolvedTurnAndState(payload, resolvedTurn, clarificationText, clarificationDebug);
		return { narrativeText: clarificationText, model: 'server-executor' };
	}

	// ---------------------------------------------------------------------------
	// Pending roll intercept (Phase B3): engine requests a skill check before
	// narration can proceed. Persist the pending check, broadcast a roll prompt
	// to the client, and return without calling AI.
	// ---------------------------------------------------------------------------
	if (resolvedTurn.status === 'awaiting-roll' && resolvedTurn.pendingCheck) {
		const check = resolvedTurn.pendingCheck;
		const rollPromptText = check.reason;
		if (partyHost) {
			await notifyRoom(partyHost, payload.adventureId, {
				type: 'ai:turn:start',
				model: 'server-executor',
				purpose: profile.purpose
			});

			// Broadcast the roll-request as a game event so the client can render the UI
			await broadcastGameEvent(partyHost, payload.adventureId, {
				type: 'game:roll-request',
				adventureId: payload.adventureId,
				timestamp: Date.now(),
				pendingCheck: check
			});

			await notifyRoom(partyHost, payload.adventureId, {
				type: 'ai:turn:end',
				text: rollPromptText,
				model: 'server-executor'
			});
		}

		await persistResolvedTurnAndState(payload, resolvedTurn, rollPromptText, debugTurns ? {
			mode: 'awaiting-roll',
			model: 'server-executor',
			messages: [],
			rawAiResponse: '',
			engineStateChanges: resolvedTurn.stateChanges,
			mergedStateChanges: resolvedTurn.stateChanges,
			latencyMs: 0,
			engineIntent: resolvedTurn.intent.primaryIntent,
			pendingCheck: check
		} : null);

		return { narrativeText: rollPromptText, model: 'server-executor' };
	}

	const openaiKey = process.env.OPENAI_API_KEY;

	if (!partyHost) throw new Error('PARTYKIT_HOST env var is not set');
	if (!openaiKey) throw new Error('OPENAI_API_KEY env var is not set');

	// ---------------------------------------------------------------------------
	// Mid-round shortcut (Phase 8e): If this is NOT the final actor in the round,
	// skip AI narration entirely. Broadcast dice results + combat-turn event,
	// save state, and return immediately. The AI fires only when roundComplete===true.
	// Does NOT apply when the encounter just ended (victory/defeat always narrated).
	// ---------------------------------------------------------------------------
	if (resolvedTurn.roundComplete === false && !resolvedTurn.stateChanges.encounterEnded) {
		// Signal turn start so the client shows the thinking indicator briefly
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:start',
			model: 'server-executor',
			purpose: profile.purpose
		});

		// Broadcast dice rolls for client-side animation
		for (const result of resolvedTurn.mechanicResults) {
			await broadcastGameEvent(partyHost, payload.adventureId, {
				type: 'game:dice-roll',
				adventureId: payload.adventureId,
				timestamp: Date.now(),
				characterId: null,
				characterName: null,
				label: result.label,
				result
			});
		}

		// Broadcast combat-turn event so clients know whose action is next
		if (currentState?.activeEncounter) {
			const enc = currentState.activeEncounter;
			const nextCombatant = enc.awaitingActorId
				? enc.combatants.find((c) => c.id === enc.awaitingActorId)
				: null;
			const prevEntry = enc.roundActions?.slice(-1)[0];
			const prevCombatant = prevEntry
				? enc.combatants.find((c) => c.id === prevEntry.combatantId)
				: null;

			// Identify which user should act next (PC → their userId; companion → null, any can act)
			let awaitingUserId: string | null = null;
			if (nextCombatant?.type === 'character') {
				awaitingUserId = currentState.characters.find((c) => c.id === nextCombatant.referenceId)?.userId ?? null;
			}

			await broadcastGameEvent(partyHost, payload.adventureId, {
				type: 'game:combat-turn',
				adventureId: payload.adventureId,
				timestamp: Date.now(),
				previousCombatantId: prevCombatant?.id ?? null,
				nextCombatantId: nextCombatant?.id ?? null,
				nextCombatantName: nextCombatant?.name ?? null,
				nextCombatantType: nextCombatant?.type ?? null,
				awaitingUserId,
				roundComplete: false,
				round: enc.round
			});
		}

		// Persist turn with empty narrative (no AI involvement)
		await persistResolvedTurnAndState(payload, resolvedTurn, '', debugTurns ? {
			mode: 'mid-round',
			model: 'server-executor',
			messages: [],
			rawAiResponse: '',
			engineStateChanges: resolvedTurn.stateChanges,
			mergedStateChanges: resolvedTurn.stateChanges,
			latencyMs: 0,
			engineIntent: resolvedTurn.intent.primaryIntent,
			engineResolvedCombat: resolvedTurn.mechanicResults.length > 0,
			roundComplete: false
		} : null);

		const chatIds = payload.recentChat.map((c) => c.id);
		if (chatIds.length > 0) await markChatConsumed(chatIds, currentState?.nextTurnNumber ?? 0);

		// Clear the client thinking indicator without emitting a GM narrative bubble
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:end',
			text: '',
			model: 'server-executor'
		});

		return { narrativeText: '', model: 'server-executor' };
	}

	// Determine if this is a narrator-mode turn (engine already resolved mechanics)
	const isNarratorMode = resolvedTurn.mechanicResults.length > 0;

	// Build appropriate message context
	let narrativeMessages: ChatMessageInput[];
	if (isNarratorMode && currentState) {
		// Narrator mode: rebuild context with narrator-specific prompt
		const recentTurns = await loadRecentTurns(payload.adventureId);
		let world: PrototypeWorld | null = null;
		try {
			world = await loadWorldFromState(payload.adventureId);
		} catch { /* non-fatal */ }

		if (resolvedTurn.roundComplete === true) {
			// Round just completed — narrate the entire round as a cohesive scene
			const roundActions = currentState.activeEncounter?.roundActions ?? [];
			narrativeMessages = assembleRoundNarratorContext(currentState, world, roundActions, recentTurns, payload.recentChat);
		} else {
			narrativeMessages = assembleNarratorContext(currentState, world, recentTurns, resolvedTurn, payload.recentChat);
		}
	} else if (currentState) {
		// Full GM mode — two-pass: build narrative-only context (no JSON format instructions)
		const recentTurns = await loadRecentTurns(payload.adventureId);
		let world: PrototypeWorld | null = null;
		try {
			world = await loadWorldFromState(payload.adventureId);
		} catch { /* non-fatal */ }
		narrativeMessages = assembleNarrativeGMContext(currentState, world, recentTurns, payload.playerAction, [], payload.recentChat);
	} else {
		// Fallback: use pre-built history (legacy, no game state)
		narrativeMessages = [...payload.history, { role: 'user', content: payload.playerAction } satisfies ChatMessageInput];
	}

	const turnNumber = currentState?.nextTurnNumber ?? 0;
	const modelLabel = isNarratorMode ? `${profile.model}:narrator` : profile.model;

	// Broadcast dice rolls BEFORE narration (for client-side dice animation)
	for (const result of resolvedTurn.mechanicResults) {
		await broadcastGameEvent(partyHost, payload.adventureId, {
			type: 'game:dice-roll',
			adventureId: payload.adventureId,
			timestamp: Date.now(),
			characterId: null,
			characterName: null,
			label: result.label,
			result
		});
	}

	// Notify narrative start (legacy + typed)
	await notifyRoom(partyHost, payload.adventureId, {
		type: 'ai:turn:start',
		model: modelLabel,
		purpose: profile.purpose
	});
	await broadcastGameEvent(partyHost, payload.adventureId, {
		type: 'narrative:start',
		adventureId: payload.adventureId,
		timestamp: Date.now(),
		turnNumber,
		model: modelLabel
	});

	try {
		let rawResponse = '';
		const aiStart = Date.now();

		if (profile.stream) {
			// Both narrator and full-GM modes now stream narrative to the client
			rawResponse = await streamChat(
				{ apiKey: openaiKey, model: profile.model, messages: narrativeMessages },
				async (chunk) => {
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:chunk',
						text: chunk
					});
				}
			);
		} else {
			rawResponse = await completeChat({ apiKey: openaiKey, model: profile.model, messages: narrativeMessages });
		}

		const pass1LatencyMs = Date.now() - aiStart;

		let narrativeText: string;
		let finalStateChanges: StateChange;
		let debugData: TurnDebugData | null = null;

		if (isNarratorMode) {
			// Narrator mode: raw response IS the narrative; engine owns state changes
			narrativeText = rawResponse.trim();
			finalStateChanges = resolvedTurn.stateChanges;
			if (debugTurns) {
				debugData = {
					mode: 'narrator',
					model: profile.model,
					messages: narrativeMessages,
					rawAiResponse: rawResponse,
					engineStateChanges: resolvedTurn.stateChanges,
					mergedStateChanges: finalStateChanges,
					latencyMs: pass1LatencyMs,
					engineIntent: resolvedTurn.intent.primaryIntent,
					engineResolvedCombat: resolvedTurn.mechanicResults.length > 0,
					roundComplete: resolvedTurn.roundComplete ?? undefined
				};
			}
		} else if (currentState) {
			// Full GM mode — Pass 2: state extraction via JSON mode
			narrativeText = rawResponse.trim();
			const pass2Start = Date.now();
			const stateExtractionMessages = assembleStateExtractionContext(
				currentState,
				narrativeText,
				payload.playerAction
			);
			const rawStateJson = await completeChatJSON({
				apiKey: openaiKey,
				model: profile.model,
				messages: stateExtractionMessages
			});
			const pass2LatencyMs = Date.now() - pass2Start;

			// Parse the state extraction response (expects { stateChanges: {...} })
			const stateResponse = parseStateExtractionResponse(rawStateJson);
			const sanitizedGmChanges = sanitizeStateChanges(stateResponse, currentState, narrativeText);
			finalStateChanges = mergeStateChanges(resolvedTurn.stateChanges, sanitizedGmChanges);

			if (debugTurns) {
				debugData = {
					mode: 'full-gm-2pass',
					model: profile.model,
					messages: narrativeMessages,
					rawAiResponse: rawResponse,
					engineStateChanges: resolvedTurn.stateChanges,
					gmStateChanges: stateResponse,
					mergedStateChanges: finalStateChanges,
					latencyMs: pass1LatencyMs + pass2LatencyMs,
					pass2Messages: stateExtractionMessages,
					rawPass2Response: rawStateJson,
					pass2LatencyMs,
					engineIntent: resolvedTurn.intent.primaryIntent
				};
			}
		} else {
			// Legacy fallback (no game state): parse as old-style JSON response
			const gmResponse = parseGMResponse(rawResponse);
			narrativeText = gmResponse.narrativeText;
			finalStateChanges = mergeStateChanges(resolvedTurn.stateChanges, gmResponse.stateChanges);
			if (debugTurns) {
				debugData = {
					mode: 'full-gm',
					model: profile.model,
					messages: narrativeMessages,
					rawAiResponse: rawResponse,
					parsedGmResponse: gmResponse,
					engineStateChanges: resolvedTurn.stateChanges,
					gmStateChanges: gmResponse.stateChanges,
					mergedStateChanges: finalStateChanges,
					latencyMs: pass1LatencyMs,
					engineIntent: resolvedTurn.intent.primaryIntent
				};
			}
		}

		// Legacy narrative end
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:end',
			text: narrativeText,
			model: profile.model
		});

		// Persist the turn and apply state changes
		const finalResolvedTurn: ResolvedTurn = {
			...resolvedTurn,
			stateChanges: finalStateChanges
		};
		await persistResolvedTurnAndState(payload, finalResolvedTurn, narrativeText, debugData);

		// Mark unconsumed chat as consumed by this turn
		const chatIds = payload.recentChat.map((c) => c.id);
		if (chatIds.length > 0) {
			await markChatConsumed(chatIds, turnNumber);
		}

		// Broadcast typed game events AFTER persistence
		await broadcastTurnEvents(partyHost, payload.adventureId, finalResolvedTurn, narrativeText, turnNumber);

		return { narrativeText, model: profile.model };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Unknown AI error';
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:error',
			message
		});
		await broadcastGameEvent(partyHost, payload.adventureId, {
			type: 'narrative:error',
			adventureId: payload.adventureId,
			timestamp: Date.now(),
			turnNumber,
			error: message
		});
		throw cause;
	}
}

// ---------------------------------------------------------------------------
// Roll resolution (Phase B3) — resolve a pending check and narrate the outcome
// ---------------------------------------------------------------------------

/**
 * Resolve a pending skill/ability/save check and resume narration.
 *
 * Called when the player clicks "roll" in the UI after the engine has produced
 * a PendingCheck. The flow is:
 *   1. Load game state and find the character
 *   2. Execute the check using the existing dice engine
 *   3. Store the result as a MechanicResult
 *   4. Narrate the outcome using narrator mode
 *   5. Persist the resolved turn
 */
export async function resolveCheckAndResume(
	adventureId: string,
	actorUserId: string,
	pendingCheck: PendingCheck
): Promise<{ narrativeText: string; model: string }> {
	const partyHost = process.env.PARTYKIT_HOST;
	const openaiKey = process.env.OPENAI_API_KEY;
	const debugTurns = process.env.DEBUG_TURNS !== 'false';

	if (!partyHost) throw new Error('PARTYKIT_HOST env var is not set');
	if (!openaiKey) throw new Error('OPENAI_API_KEY env var is not set');

	const state = await loadGameState(adventureId);
	if (!state) throw new Error('No game state found');

	const actor = state.characters.find((c) => c.id === pendingCheck.characterId);
	if (!actor) throw new Error(`Character ${pendingCheck.characterId} not found`);

	// ── Execute the check using the dice engine ───────────────────────
	let checkResult;
	if (pendingCheck.kind === 'skill' && pendingCheck.skill) {
		const overrideAdv = pendingCheck.advantageState === 'advantage'
			? ('advantage' as const)
			: pendingCheck.advantageState === 'disadvantage'
				? ('disadvantage' as const)
				: undefined;
		checkResult = skillCheck(actor, pendingCheck.skill, pendingCheck.dc ?? 12, overrideAdv);
	} else if (pendingCheck.kind === 'save') {
		const overrideAdv = pendingCheck.advantageState === 'advantage'
			? ('advantage' as const)
			: pendingCheck.advantageState === 'disadvantage'
				? ('disadvantage' as const)
				: undefined;
		checkResult = savingThrow(actor, pendingCheck.ability, pendingCheck.dc ?? 12, overrideAdv);
	} else {
		const overrideAdv = pendingCheck.advantageState === 'advantage'
			? ('advantage' as const)
			: pendingCheck.advantageState === 'disadvantage'
				? ('disadvantage' as const)
				: undefined;
		checkResult = abilityCheck(actor, pendingCheck.ability, pendingCheck.dc ?? 12, overrideAdv);
	}

	// Normalize the check result into a MechanicResult
	const mechanicType: MechanicResult['type'] = pendingCheck.kind === 'save' ? 'saving-throw' : 'skill-check';
	const skillLabel = pendingCheck.skill
		? pendingCheck.skill.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
		: pendingCheck.ability.toUpperCase();

	const mechanicResult: MechanicResult = {
		type: mechanicType,
		label: `${actor.name}: ${skillLabel} check (DC ${pendingCheck.dc ?? 12})`,
		dice: checkResult.roll,
		dc: pendingCheck.dc ?? 12,
		success: checkResult.success
	};

	// Mark the pending check as resolved
	const resolvedCheck: PendingCheck = {
		...pendingCheck,
		result: mechanicResult
	};

	// Build a minimal ResolvedTurn for the narrator
	const resolvedTurn: ResolvedTurn = {
		status: 'ready-for-narration',
		intent: {
			rawAction: pendingCheck.reason,
			primaryIntent: 'examine', // generic — the actual intent was captured in the original turn
			mentionsHealing: false,
			mentionsPotion: false,
			mentionsPoison: false,
			mentionsCamp: false,
			mentionsWait: false,
			targetHint: 'none'
		},
		actorId: actor.id,
		targets: [],
		resourcesConsumed: [],
		resolvedActionSummary: `${mechanicResult.label} → ${checkResult.success ? 'Success' : 'Failure'} (rolled ${checkResult.roll.total})`,
		mechanicResults: [mechanicResult],
		stateChanges: {},
		pendingCheck: resolvedCheck
	};

	const profile = resolveAdventureTurnProfile({
		purpose: 'interactive-chat'
	});

	// ── Broadcast dice roll ──────────────────────────────────────────
	await notifyRoom(partyHost, adventureId, {
		type: 'ai:turn:start',
		model: profile.model + ':narrator',
		purpose: profile.purpose
	});

	await broadcastGameEvent(partyHost, adventureId, {
		type: 'game:dice-roll',
		adventureId,
		timestamp: Date.now(),
		characterId: actor.id,
		characterName: actor.name,
		label: mechanicResult.label,
		result: mechanicResult
	});

	// ── Narrate the outcome ──────────────────────────────────────────
	const recentTurns = await loadRecentTurns(adventureId);
	let world: PrototypeWorld | null = null;
	try {
		world = await loadWorldFromState(adventureId);
	} catch { /* non-fatal */ }

	const narrativeMessages = assembleNarratorContext(state, world, recentTurns, resolvedTurn, []);
	const turnNumber = state.nextTurnNumber;

	await broadcastGameEvent(partyHost, adventureId, {
		type: 'narrative:start',
		adventureId,
		timestamp: Date.now(),
		turnNumber,
		model: profile.model + ':narrator'
	});

	let rawResponse = '';
	try {
		if (profile.stream) {
			rawResponse = await streamChat(
				{ apiKey: openaiKey, model: profile.model, messages: narrativeMessages },
				async (chunk) => {
					await notifyRoom(partyHost, adventureId, {
						type: 'ai:turn:chunk',
						text: chunk
					});
				}
			);
		} else {
			rawResponse = await completeChat({ apiKey: openaiKey, model: profile.model, messages: narrativeMessages });
		}

		const narrativeText = rawResponse.trim();

		await notifyRoom(partyHost, adventureId, {
			type: 'ai:turn:end',
			text: narrativeText,
			model: profile.model
		});

		// Build payload for persistence
		const payload: AdventureTurnPayload = {
			adventureId,
			playerAction: pendingCheck.reason,
			actorUserId,
			history: [],
			recentChat: []
		};

		const debugData: TurnDebugData | null = debugTurns ? {
			mode: 'narrator',
			model: profile.model,
			messages: narrativeMessages,
			rawAiResponse: rawResponse,
			engineStateChanges: resolvedTurn.stateChanges,
			mergedStateChanges: resolvedTurn.stateChanges,
			latencyMs: 0,
			engineIntent: resolvedTurn.intent.primaryIntent,
			pendingCheck,
			engineResolvedCombat: false
		} : null;

		await persistResolvedTurnAndState(payload, resolvedTurn, narrativeText, debugData);
		await broadcastTurnEvents(partyHost, adventureId, resolvedTurn, narrativeText, turnNumber);

		return { narrativeText, model: profile.model };
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Unknown AI error';
		await notifyRoom(partyHost, adventureId, {
			type: 'ai:turn:error',
			message
		});
		throw cause;
	}
}

// ---------------------------------------------------------------------------
// Event broadcasting helpers
// ---------------------------------------------------------------------------

/**
 * Broadcast a typed GameEvent through PartyKit.
 * This sends the event as-is, using the GameEvent shape defined in events.ts.
 */
async function broadcastGameEvent(host: string, roomId: string, event: GameEvent): Promise<void> {
	await notifyRoom(host, roomId, event as unknown as Record<string, unknown>);
}

/**
 * Broadcast structured game events after a turn is fully resolved and persisted.
 */
async function broadcastTurnEvents(
	host: string,
	adventureId: string,
	resolvedTurn: ResolvedTurn,
	narrativeText: string,
	turnNumber: number
): Promise<void> {
	const now = Date.now();

	// State update event (if any state changes were applied)
	const sc = resolvedTurn.stateChanges;
	const hasStateChanges = sc.hpChanges?.length || sc.conditionsApplied?.length ||
		sc.xpAwarded?.length || sc.locationChange || sc.questUpdates?.length ||
		sc.npcChanges?.length || sc.clockAdvance || sc.spellSlotUsed ||
		sc.itemsLost?.length || sc.itemsGained?.length || sc.hitDiceUsed ||
		sc.encounterStarted || sc.encounterEnded;
	if (hasStateChanges) {
		await broadcastGameEvent(host, adventureId, {
			type: 'game:state-update',
			adventureId,
			timestamp: now,
			turnNumber,
			changes: sc
		});
	}

	// Clock advance event
	if (sc.clockAdvance) {
		await broadcastGameEvent(host, adventureId, {
			type: 'game:clock-advance',
			adventureId,
			timestamp: now,
			from: sc.clockAdvance.from,
			to: sc.clockAdvance.to
		});
	}

	// World-building discovery events
	if (sc.npcsAdded) {
		for (const npc of sc.npcsAdded) {
			await broadcastGameEvent(host, adventureId, {
				type: 'game:npc-discovered',
				adventureId,
				timestamp: now,
				npcId: npc.id,
				name: npc.name,
				role: npc.role,
				locationId: npc.locationId
			});
		}
	}

	if (sc.locationsAdded) {
		for (const loc of sc.locationsAdded) {
			await broadcastGameEvent(host, adventureId, {
				type: 'game:location-discovered',
				adventureId,
				timestamp: now,
				locationId: loc.id,
				name: loc.name,
				locationType: loc.type,
				description: loc.description
			});
		}
	}

	if (sc.questsAdded) {
		for (const quest of sc.questsAdded) {
			await broadcastGameEvent(host, adventureId, {
				type: 'game:quest-discovered',
				adventureId,
				timestamp: now,
				questId: quest.id,
				name: quest.name,
				description: quest.description
			});
		}
	}

	// Combat start event
	if (sc.encounterStarted) {
		const enemies = (sc.encounterStarted.creatures ?? []).map(c => c.name);
		await broadcastGameEvent(host, adventureId, {
			type: 'game:combat-start',
			adventureId,
			timestamp: now,
			enemies
		});
	}

	// Combat end event
	if (sc.encounterEnded) {
		const outcome = sc.encounterEnded.outcome ?? 'victory';
		// Map 'flee' EncounterOutcome to 'fled' CombatEndEvent outcome
		const eventOutcome = outcome === 'flee' ? 'fled' : outcome;
		const xpTotal = (sc.xpAwarded ?? []).reduce((sum, a) => sum + a.amount, 0);
		await broadcastGameEvent(host, adventureId, {
			type: 'game:combat-end',
			adventureId,
			timestamp: now,
			outcome: eventOutcome as 'victory' | 'defeat' | 'fled' | 'negotiated',
			xpAwarded: xpTotal
		});
	}

	// Narrative end (typed)
	await broadcastGameEvent(host, adventureId, {
		type: 'narrative:end',
		adventureId,
		timestamp: now,
		turnNumber,
		fullText: narrativeText
	});
}

/**
 * Merge engine-authoritative state changes with GM-proposed state changes.
 * Engine changes take precedence (they are already-applied facts).
 * GM changes that don't conflict are added.
 */
export function mergeStateChanges(engine: StateChange, gm: StateChange): StateChange {
	return {
		hpChanges: [...(engine.hpChanges ?? []), ...(gm.hpChanges ?? [])],
		conditionsApplied: [...(engine.conditionsApplied ?? []), ...(gm.conditionsApplied ?? [])],
		xpAwarded: [...(engine.xpAwarded ?? []), ...(gm.xpAwarded ?? [])],
		locationChange: engine.locationChange ?? gm.locationChange,
		questUpdates: [...(engine.questUpdates ?? []), ...(gm.questUpdates ?? [])],
		npcChanges: [...(engine.npcChanges ?? []), ...(gm.npcChanges ?? [])],
		clockAdvance: engine.clockAdvance ?? gm.clockAdvance,
		spellSlotUsed: engine.spellSlotUsed ?? gm.spellSlotUsed,
		itemsLost: [...(engine.itemsLost ?? []), ...(gm.itemsLost ?? [])],
		itemsGained: [...(engine.itemsGained ?? []), ...(gm.itemsGained ?? [])],
		hitDiceUsed: engine.hitDiceUsed ?? gm.hitDiceUsed,
		featureUsed: engine.featureUsed ?? gm.featureUsed,
		// World-building additions (typically from GM only; engine doesn't create world content)
		npcsAdded: [...(engine.npcsAdded ?? []), ...(gm.npcsAdded ?? [])],
		locationsAdded: [...(engine.locationsAdded ?? []), ...(gm.locationsAdded ?? [])],
		questsAdded: [...(engine.questsAdded ?? []), ...(gm.questsAdded ?? [])],
		sceneFactsAdded: [...(engine.sceneFactsAdded ?? []), ...(gm.sceneFactsAdded ?? [])],
		// Companion promotion
		companionPromoted: engine.companionPromoted ?? gm.companionPromoted,
		// Encounter lifecycle
		encounterStarted: engine.encounterStarted ?? gm.encounterStarted,
		encounterEnded: engine.encounterEnded ?? gm.encounterEnded,
		deathSaveResult: engine.deathSaveResult ?? gm.deathSaveResult,
		deathSaveOutcome: engine.deathSaveOutcome ?? gm.deathSaveOutcome,
		// Combat actions (engine-authoritative if resolved; otherwise from GM)
		combatAction: engine.combatAction ?? gm.combatAction,
		enemyCombatActions: engine.enemyCombatActions ?? gm.enemyCombatActions
	};
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
	const trimmed = raw.trim();

	// Strategy 1: entire response is valid JSON
	const result = tryParseGMJson(trimmed);
	if (result) return result;

	// Strategy 2: markdown code-block wrapping JSON
	if (trimmed.startsWith('```')) {
		const unwrapped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
		const result2 = tryParseGMJson(unwrapped);
		if (result2) return result2;
	}

	// Strategy 3: JSON embedded after a preamble (e.g. "Here's the response: { ... }")
	const firstBrace = trimmed.indexOf('{');
	const lastBrace = trimmed.lastIndexOf('}');
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		const embedded = trimmed.slice(firstBrace, lastBrace + 1);
		const result3 = tryParseGMJson(embedded);
		if (result3) return result3;
	}

	// Fallback: treat the whole response as narrative text
	return {
		narrativeText: raw,
		stateChanges: {}
	};
}

function tryParseGMJson(text: string): GMResponse | null {
	let candidate = text;

	// Fix trailing duplicate braces: `{"narrativeText":"...","stateChanges":{...}}}` → valid with one `}` removed.
	// Repeatedly strip a trailing `}` while parsing fails and the text ends with `}}`.
	let maxStrips = 3;
	while (maxStrips-- > 0) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed.narrativeText === 'string') {
				// Rescue known StateChange keys that the AI placed at the top level
				// instead of inside stateChanges (e.g. npcsAdded as a sibling of narrativeText).
				const sc: Record<string, unknown> = (parsed.stateChanges && typeof parsed.stateChanges === 'object')
					? { ...parsed.stateChanges }
					: {};
				const rescueKeys = [
					'hpChanges', 'conditionsApplied', 'xpAwarded', 'locationChange',
					'questUpdates', 'npcChanges', 'clockAdvance', 'spellSlotUsed',
					'itemsLost', 'itemsGained', 'hitDiceUsed', 'featureUsed',
					'encounterStarted', 'encounterEnded', 'deathSaveResult', 'deathSaveOutcome',
					'npcsAdded', 'locationsAdded', 'questsAdded', 'sceneFactsAdded',
					'companionPromoted', 'combatAction', 'enemyCombatActions'
				];
				for (const key of rescueKeys) {
					if (parsed[key] !== undefined && sc[key] === undefined) {
						sc[key] = parsed[key];
					}
				}
				return {
					narrativeText: parsed.narrativeText,
					stateChanges: sc as StateChange,
					gmNotes: parsed.gmNotes
				};
			}
			break; // Parsed but no narrativeText — stop trying
		} catch {
			// Strip one trailing `}` and retry
			if (candidate.endsWith('}}')) {
				candidate = candidate.slice(0, -1);
			} else {
				break;
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// State extraction response parser (Pass 2 of two-pass architecture)
// ---------------------------------------------------------------------------

/**
 * Parse the JSON returned by the state-extraction AI (Pass 2).
 * The expected shape is: { "stateChanges": { ... } }
 * Falls back gracefully if the AI wraps the response differently.
 */
export function parseStateExtractionResponse(raw: string): StateChange {
	const trimmed = raw.trim();
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object') {
			// Expected shape: { stateChanges: { ... } }
			if (parsed.stateChanges && typeof parsed.stateChanges === 'object') {
				return parsed.stateChanges as StateChange;
			}
			// AI may have returned stateChange keys at top level (no wrapper)
			const stateChangeKeys = [
				'hpChanges', 'conditionsApplied', 'xpAwarded', 'locationChange',
				'questUpdates', 'npcChanges', 'clockAdvance', 'spellSlotUsed',
				'itemsLost', 'itemsGained', 'hitDiceUsed', 'featureUsed',
				'encounterStarted', 'encounterEnded', 'deathSaveResult', 'deathSaveOutcome',
				'npcsAdded', 'locationsAdded', 'questsAdded', 'sceneFactsAdded',
				'companionPromoted', 'combatAction', 'enemyCombatActions'
			];
			const hasAnyKey = stateChangeKeys.some((k) => parsed[k] !== undefined);
			if (hasAnyKey) {
				const sc: Record<string, unknown> = {};
				for (const key of stateChangeKeys) {
					if (parsed[key] !== undefined) sc[key] = parsed[key];
				}
				return sc as StateChange;
			}
			// Parsed but no recognized shape — empty state changes
			return {};
		}
	} catch {
		// JSON parse failed — should be rare with response_format: json_object
		console.error('[parseStateExtractionResponse] Failed to parse JSON:', trimmed.slice(0, 200));
	}
	return {};
}

// ---------------------------------------------------------------------------
// Schema validation — sanitize AI-produced stateChanges before application
// ---------------------------------------------------------------------------

/**
 * Strips a "Name[id]" display token to just the bare id.
 * The AI sometimes copies the full party-section token (e.g. "555[01KM...]") instead
 * of extracting only the bracketed ID portion.
 */
function normalizeCharacterId(raw: string): string {
	const m = raw.match(/\[([^\]]+)\]$/);
	return m ? m[1] : raw;
}

/**
 * Validate and sanitize the AI-produced stateChanges.
 * Strips entries with wrong types, logs warnings for each.
 * This runs AFTER parseGMResponse() and BEFORE mergeStateChanges().
 */
export function sanitizeStateChanges(sc: StateChange, state: GameState, narrativeText?: string): StateChange {
	const clean: StateChange = {};

	// --- hpChanges ---
	if (sc.hpChanges) {
		if (!Array.isArray(sc.hpChanges)) {
			console.warn('[sanitize] hpChanges is not an array — stripped');
		} else {
			clean.hpChanges = sc.hpChanges.filter((hc, i) => {
				if (!hc || typeof hc !== 'object') {
					console.warn(`[sanitize] hpChanges[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof hc.characterId !== 'string' || !hc.characterId) {
					console.warn(`[sanitize] hpChanges[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				hc.characterId = normalizeCharacterId(hc.characterId);
				if (typeof hc.newHp !== 'number' || !isFinite(hc.newHp)) {
					console.warn(`[sanitize] hpChanges[${i}].newHp is not a finite number — stripped`);
					return false;
				}
				// Auto-fill oldHp from current state if missing or wrong type
				if (typeof hc.oldHp !== 'number') {
					const char = state.characters.find((c) => c.id === hc.characterId);
					hc.oldHp = char?.hp ?? 0;
				}
				if (typeof hc.reason !== 'string') {
					hc.reason = '';
				}
				return true;
			});
			if (clean.hpChanges.length === 0) delete clean.hpChanges;
		}
	}

	// --- conditionsApplied ---
	if (sc.conditionsApplied) {
		if (!Array.isArray(sc.conditionsApplied)) {
			console.warn('[sanitize] conditionsApplied is not an array — stripped');
		} else {
			const validConditions = new Set([
				'blinded', 'charmed', 'deafened', 'frightened', 'grappled',
				'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned',
				'prone', 'restrained', 'stunned', 'unconscious', 'exhaustion'
			]);
			clean.conditionsApplied = sc.conditionsApplied.filter((ca, i) => {
				if (!ca || typeof ca !== 'object') {
					console.warn(`[sanitize] conditionsApplied[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof ca.characterId !== 'string' || !ca.characterId) {
					console.warn(`[sanitize] conditionsApplied[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				ca.characterId = normalizeCharacterId(ca.characterId);
				if (!validConditions.has(ca.condition)) {
					console.warn(`[sanitize] conditionsApplied[${i}].condition="${ca.condition}" is not a valid condition — stripped`);
					return false;
				}
				if (typeof ca.applied !== 'boolean') {
					ca.applied = true; // Default to applying the condition
				}
				return true;
			});
			if (clean.conditionsApplied.length === 0) delete clean.conditionsApplied;
		}
	}

	// --- xpAwarded ---
	if (sc.xpAwarded) {
		if (!Array.isArray(sc.xpAwarded)) {
			console.warn('[sanitize] xpAwarded is not an array — stripped');
		} else {
			clean.xpAwarded = sc.xpAwarded.filter((xp, i) => {
				if (!xp || typeof xp !== 'object') {
					console.warn(`[sanitize] xpAwarded[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof xp.characterId !== 'string' || !xp.characterId) {
					console.warn(`[sanitize] xpAwarded[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				xp.characterId = normalizeCharacterId(xp.characterId);
				if (typeof xp.amount !== 'number' || !isFinite(xp.amount) || xp.amount < 0) {
					console.warn(`[sanitize] xpAwarded[${i}].amount=${xp.amount} is not a valid positive number — stripped`);
					return false;
				}
				return true;
			});
			if (clean.xpAwarded.length === 0) delete clean.xpAwarded;
		}
	}

	// --- locationChange ---
	if (sc.locationChange) {
		if (!sc.locationChange || typeof sc.locationChange !== 'object') {
			console.warn('[sanitize] locationChange is not an object — stripped');
		} else if (typeof sc.locationChange.to !== 'string' || !sc.locationChange.to) {
			console.warn('[sanitize] locationChange.to is not a non-empty string — stripped');
		} else {
			clean.locationChange = sc.locationChange;
		}
	}

	// --- questUpdates ---
	if (sc.questUpdates) {
		if (!Array.isArray(sc.questUpdates)) {
			console.warn('[sanitize] questUpdates is not an array — stripped');
		} else {
			clean.questUpdates = sc.questUpdates.filter((qu, i) => {
				if (!qu || typeof qu !== 'object') {
					console.warn(`[sanitize] questUpdates[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof qu.questId !== 'string' || !qu.questId) {
					console.warn(`[sanitize] questUpdates[${i}].questId is not a non-empty string — stripped`);
					return false;
				}
				if (typeof qu.field !== 'string' || !qu.field) {
					console.warn(`[sanitize] questUpdates[${i}].field is not a non-empty string — stripped`);
					return false;
				}
				return true;
			});
			if (clean.questUpdates.length === 0) delete clean.questUpdates;
		}
	}

	// --- npcChanges ---
	if (sc.npcChanges) {
		if (!Array.isArray(sc.npcChanges)) {
			console.warn('[sanitize] npcChanges is not an array — stripped');
		} else {
			clean.npcChanges = sc.npcChanges.filter((nc, i) => {
				if (!nc || typeof nc !== 'object') {
					console.warn(`[sanitize] npcChanges[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof nc.npcId !== 'string' || !nc.npcId) {
					console.warn(`[sanitize] npcChanges[${i}].npcId is not a non-empty string — stripped`);
					return false;
				}
				if (typeof nc.field !== 'string' || !nc.field) {
					console.warn(`[sanitize] npcChanges[${i}].field is not a non-empty string — stripped`);
					return false;
				}
				return true;
			});
			if (clean.npcChanges.length === 0) delete clean.npcChanges;
		}
	}

	// --- itemsGained ---
	if (sc.itemsGained) {
		if (!Array.isArray(sc.itemsGained)) {
			console.warn('[sanitize] itemsGained is not an array — stripped');
		} else {
			clean.itemsGained = sc.itemsGained.filter((ig, i) => {
				if (!ig || typeof ig !== 'object') {
					console.warn(`[sanitize] itemsGained[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof ig.characterId !== 'string' || !ig.characterId) {
					console.warn(`[sanitize] itemsGained[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				ig.characterId = normalizeCharacterId(ig.characterId);
				if (!ig.item || typeof ig.item !== 'object') {
					console.warn(`[sanitize] itemsGained[${i}].item is not an object — stripped`);
					return false;
				}
				const item = ig.item as unknown as Record<string, unknown>;
				// Backfill missing required item fields
				if (typeof item.id !== 'string' || !item.id) item.id = `item-${Date.now()}-${i}`;
				if (typeof item.name !== 'string' || !item.name) {
					console.warn(`[sanitize] itemsGained[${i}].item.name is missing — stripped`);
					return false;
				}
				if (typeof item.category !== 'string') item.category = 'misc';
				if (typeof item.description !== 'string') item.description = item.name as string;
				if (typeof item.value !== 'number') item.value = 0;
				if (typeof item.quantity !== 'number' || item.quantity < 1) item.quantity = 1;
				if (typeof item.weight !== 'number') item.weight = 0;
				if (typeof item.rarity !== 'string') item.rarity = 'common';
				if (typeof item.attunement !== 'boolean') item.attunement = false;
				return true;
			});
			if (clean.itemsGained.length === 0) delete clean.itemsGained;
		}
	}

	// --- itemsLost ---
	if (sc.itemsLost) {
		if (!Array.isArray(sc.itemsLost)) {
			console.warn('[sanitize] itemsLost is not an array — stripped');
		} else {
			clean.itemsLost = sc.itemsLost.filter((il, i) => {
				if (!il || typeof il !== 'object') {
					console.warn(`[sanitize] itemsLost[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof il.characterId !== 'string' || !il.characterId) {
					console.warn(`[sanitize] itemsLost[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				il.characterId = normalizeCharacterId(il.characterId);
				if (typeof il.itemId !== 'string' || !il.itemId) {
					console.warn(`[sanitize] itemsLost[${i}].itemId is not a non-empty string — stripped`);
					return false;
				}
				if (typeof il.quantity !== 'number' || il.quantity < 1) {
					il.quantity = 1;
				}
				return true;
			});
			if (clean.itemsLost.length === 0) delete clean.itemsLost;
		}
	}

	// --- encounterStarted ---
	if (sc.encounterStarted) {
		// Block encounter if one is already active
		if (state?.activeEncounter && state.activeEncounter.status === 'active') {
			console.warn('[sanitize] encounterStarted while encounter already active — stripped');
		} else if (!sc.encounterStarted || typeof sc.encounterStarted !== 'object') {
			console.warn('[sanitize] encounterStarted is not an object — stripped');
		} else {
			const creatures = sc.encounterStarted.creatures;
			if (!Array.isArray(creatures)) {
				console.warn('[sanitize] encounterStarted.creatures is not an array — stripped');
			} else {
				// Validate each creature has minimum required fields
				const validCreatures = creatures.filter((cr, i) => {
					if (!cr || typeof cr !== 'object') return false;
					if (typeof cr.id !== 'string' || !cr.id) {
						cr.id = `npc-creature-${i}`;
					}
					if (typeof cr.name !== 'string' || !cr.name) {
						console.warn(`[sanitize] encounterStarted.creatures[${i}].name is missing — stripped`);
						return false;
					}
					if (typeof cr.role !== 'string') cr.role = 'hostile';
					if (typeof cr.disposition !== 'number') cr.disposition = -100;
					if (typeof cr.description !== 'string') cr.description = cr.name;
					// Default tier to 'normal' if missing or invalid
					const validTiers = new Set(['weak', 'normal', 'tough', 'elite', 'boss']);
					if (typeof cr.tier !== 'string' || !validTiers.has(cr.tier)) {
						cr.tier = 'normal';
					}
					return true;
				});

				// Also reject encounterStarted + encounterEnded in same response (instant combat)
				if (sc.encounterEnded) {
					console.warn('[sanitize] encounterStarted + encounterEnded in same response — encounterEnded stripped (encounters should span multiple turns)');
				}

				// Content-based gating: require explicit combat evidence in the narrative
				// Reconnaissance, scouting, observing, and hearing rumors should NOT start combat
				if (narrativeText && validCreatures.length > 0) {
					const lowerNarr = narrativeText.toLowerCase();
					const hasCombatEvidence =
						/\b(roll for initiative|initiative!|combat begins|attacks?\b|charges? (at|toward|forward)|lunges? (at|toward|forward)|leaps? (at|from|out|toward)|ambush|springs? (upon|from|out)|weapons? drawn|draws? (a |their |his |her )?(sword|blade|weapon|bow|axe|dagger|mace)|battle begins|hostilities begin|fight breaks out|opens? fire|strikes? (at|first)|rushes? (at|toward|forward))\b/.test(lowerNarr);
					if (!hasCombatEvidence) {
						console.warn('[sanitize] encounterStarted without combat evidence in narrative — stripped (narrative lacks explicit hostility)');
						// Don't set clean.encounterStarted — fall through
					} else {
						clean.encounterStarted = { creatures: validCreatures as NPC[] };
					}
				} else if (validCreatures.length > 0) {
					// No narrative available — allow (legacy single-pass mode)
					clean.encounterStarted = { creatures: validCreatures as NPC[] };
				}
			}
		}
	}

	// --- encounterEnded (only if not blocked by instant-combat check above) ---
	if (sc.encounterEnded && !sc.encounterStarted) {
		if (typeof sc.encounterEnded === 'object' && sc.encounterEnded) {
			clean.encounterEnded = sc.encounterEnded;
		}
	}

	// --- npcsAdded ---
	if (sc.npcsAdded) {
		if (!Array.isArray(sc.npcsAdded)) {
			console.warn('[sanitize] npcsAdded is not an array — stripped');
		} else {
			const validRoles = new Set(['merchant', 'quest-giver', 'hostile', 'neutral', 'ally', 'companion', 'boss']);
			clean.npcsAdded = sc.npcsAdded.filter((npc, i) => {
				if (!npc || typeof npc !== 'object') return false;
				if (typeof npc.id !== 'string' || !npc.id) npc.id = `npc-${Date.now()}-${i}`;
				if (typeof npc.name !== 'string' || !npc.name) {
					console.warn(`[sanitize] npcsAdded[${i}].name is missing — stripped`);
					return false;
				}
				if (typeof npc.role !== 'string' || !validRoles.has(npc.role)) {
					npc.role = 'neutral' as NpcRole;
				}
				if (typeof npc.locationId !== 'string') {
					npc.locationId = state.partyLocationId ?? '';
				}
				if (typeof npc.disposition !== 'number') npc.disposition = 0;
				if (typeof npc.description !== 'string') npc.description = npc.name;
				return true;
			});
			if (clean.npcsAdded.length === 0) delete clean.npcsAdded;
		}
	}

	// --- locationsAdded ---
	if (sc.locationsAdded) {
		if (!Array.isArray(sc.locationsAdded)) {
			console.warn('[sanitize] locationsAdded is not an array — stripped');
		} else {
			const validTypes = new Set(['settlement', 'wilderness', 'dungeon', 'interior', 'road']);
			clean.locationsAdded = sc.locationsAdded.filter((loc, i) => {
				if (!loc || typeof loc !== 'object') return false;
				if (typeof loc.id !== 'string' || !loc.id) loc.id = `loc-${Date.now()}-${i}`;
				if (typeof loc.name !== 'string' || !loc.name) {
					console.warn(`[sanitize] locationsAdded[${i}].name is missing — stripped`);
					return false;
				}
				if (typeof loc.type !== 'string' || !validTypes.has(loc.type)) {
					loc.type = 'interior' as LocationType;
				}
				if (typeof loc.description !== 'string') loc.description = loc.name;
				return true;
			});
			if (clean.locationsAdded.length === 0) delete clean.locationsAdded;
		}
	}

	// --- questsAdded ---
	if (sc.questsAdded) {
		if (!Array.isArray(sc.questsAdded)) {
			console.warn('[sanitize] questsAdded is not an array — stripped');
		} else {
			clean.questsAdded = sc.questsAdded.filter((q, i) => {
				if (!q || typeof q !== 'object') return false;
				if (typeof q.id !== 'string' || !q.id) q.id = `quest-${Date.now()}-${i}`;
				if (typeof q.name !== 'string' || !q.name) {
					console.warn(`[sanitize] questsAdded[${i}].name is missing — stripped`);
					return false;
				}
				if (typeof q.description !== 'string') q.description = q.name;
				if (!Array.isArray(q.objectives)) q.objectives = [];
				return true;
			});
			if (clean.questsAdded.length === 0) delete clean.questsAdded;
		}
	}

	// --- sceneFactsAdded ---
	if (sc.sceneFactsAdded) {
		if (!Array.isArray(sc.sceneFactsAdded)) {
			console.warn('[sanitize] sceneFactsAdded is not an array — stripped');
		} else {
			clean.sceneFactsAdded = sc.sceneFactsAdded.filter((f, i) => {
				if (typeof f !== 'string' || !f.trim()) {
					console.warn(`[sanitize] sceneFactsAdded[${i}] is not a non-empty string — stripped`);
					return false;
				}
				return true;
			});
			if (clean.sceneFactsAdded.length === 0) delete clean.sceneFactsAdded;
		}
	}

	// --- Pass-through for remaining well-typed fields ---
	if (sc.clockAdvance) clean.clockAdvance = sc.clockAdvance;
	if (sc.spellSlotUsed) clean.spellSlotUsed = sc.spellSlotUsed;
	if (sc.hitDiceUsed) clean.hitDiceUsed = sc.hitDiceUsed;
	if (sc.featureUsed) clean.featureUsed = sc.featureUsed;
	if (sc.deathSaveResult) clean.deathSaveResult = sc.deathSaveResult;
	if (sc.deathSaveOutcome) clean.deathSaveOutcome = sc.deathSaveOutcome;
	if (sc.companionPromoted) clean.companionPromoted = sc.companionPromoted;

	// --- combatAction ---
	if (sc.combatAction) {
		if (typeof sc.combatAction === 'object' && sc.combatAction &&
			typeof sc.combatAction.targetId === 'string' && sc.combatAction.targetId) {
			const validTypes = new Set(['attack', 'spell', 'other']);
			if (typeof sc.combatAction.type !== 'string' || !validTypes.has(sc.combatAction.type)) {
				sc.combatAction.type = 'attack';
			}
			clean.combatAction = sc.combatAction;
		} else {
			console.warn('[sanitize] combatAction missing targetId — stripped');
		}
	}

	// --- enemyCombatActions ---
	if (sc.enemyCombatActions) {
		if (!Array.isArray(sc.enemyCombatActions)) {
			console.warn('[sanitize] enemyCombatActions is not an array — stripped');
		} else {
			clean.enemyCombatActions = sc.enemyCombatActions.filter((eca, i) => {
				if (!eca || typeof eca !== 'object') return false;
				if (typeof eca.npcId !== 'string' || !eca.npcId) {
					console.warn(`[sanitize] enemyCombatActions[${i}].npcId is missing — stripped`);
					return false;
				}
				if (typeof eca.targetId !== 'string' || !eca.targetId) {
					console.warn(`[sanitize] enemyCombatActions[${i}].targetId is missing — stripped`);
					return false;
				}
				if (typeof eca.attackIndex !== 'number') eca.attackIndex = 0;
				return true;
			});
			if (clean.enemyCombatActions.length === 0) delete clean.enemyCombatActions;
		}
	}

	return clean;
}

/**
 * Build a minimal TurnDebugData for clarification-path turns (no AI call).
 */
function buildClarificationDebug(engineStateChanges: StateChange): TurnDebugData {
	return {
		mode: 'clarification',
		model: 'server-executor',
		messages: [],
		rawAiResponse: '',
		engineStateChanges,
		mergedStateChanges: engineStateChanges,
		latencyMs: 0,
		engineIntent: 'needs-clarification'
	};
}

/**
 * Persist the turn record and apply any state changes the GM returned.
 * Uses atomic batch persistence to keep turn history and state in sync.
 */
async function persistResolvedTurnAndState(
	payload: AdventureTurnPayload,
	resolvedTurn: ResolvedTurn,
	narrativeText: string,
	debugData?: TurnDebugData | null
): Promise<void> {
	const state = await loadGameState(payload.adventureId);
	if (!state) return; // No game state yet — skip persistence (legacy adventure)

	const turnNumber = state.nextTurnNumber;
	state.nextTurnNumber++;

	const isClarification = resolvedTurn.status === 'needs-clarification';
	const isAwaitingRoll = resolvedTurn.status === 'awaiting-roll';

	const turn: TurnRecord = {
		id: ulid(),
		turnNumber,
		actorType: 'player',
		actorId: payload.actorUserId,
		action: payload.playerAction,
		intent: resolvedTurn.intent.primaryIntent,
		status: isClarification ? 'clarification' : isAwaitingRoll ? 'awaiting-roll' : 'completed',
		resolvedActionSummary: resolvedTurn.resolvedActionSummary,
		mechanicResults: resolvedTurn.mechanicResults,
		stateChanges: resolvedTurn.stateChanges,
		narrativeText,
		timestamp: Date.now(),
		pendingCheck: resolvedTurn.pendingCheck
	};

	// Apply structured state changes from the GM
	const enrichmentIntents = applyGMStateChanges(state, resolvedTurn.stateChanges, turnNumber);

	// After a round-complete narration, clear the accumulated round actions so the
	// next round starts fresh. roundComplete===true means the AI just narrated the whole round.
	if (resolvedTurn.roundComplete === true && state.activeEncounter) {
		state.activeEncounter.roundActions = [];
	}

	// Trigger periodic world reaction every 5 turns
	if (turnNumber > 0 && turnNumber % 5 === 0) {
		enrichmentIntents.push({ type: 'react-to-party' });
	}

	// Update lastInteractionTurn for NPCs mentioned by name in the narrative
	if (narrativeText) {
		const narrativeLower = narrativeText.toLowerCase();
		for (const npc of state.npcs) {
			const nameLower = npc.name.toLowerCase();
			const firstName = npc.name.split(/\s+/)[0].toLowerCase();
			if (narrativeLower.includes(nameLower) || (firstName.length >= 3 && narrativeLower.includes(firstName))) {
				npc.lastInteractionTurn = turnNumber;
			}
		}
	}

	// Apply engine-authoritative character updates (from turn-executor)
	if (resolvedTurn.updatedCharacters) {
		state.characters = resolvedTurn.updatedCharacters;
	}

	// Append to in-memory log (kept short — the full history lives in the DB)
	state.turnLog.push(turn);
	if (state.turnLog.length > 50) {
		state.turnLog = state.turnLog.slice(-50);
	}

	// Serialize debug data if present
	const debugJson = debugData ? JSON.stringify(debugData) : null;

	// Atomic persist: turn + state in a single batch
	await persistTurnAndSaveState(payload.adventureId, turn, state, debugJson);

	// Dispatch enrichment background tasks (fire-and-forget after persistence)
	for (const intent of enrichmentIntents) {
		try {
			switch (intent.type) {
				case 'expand-settlement':
					await tasks.trigger('world-expand-settlement', {
						adventureId: payload.adventureId,
						locationId: intent.locationId!
					});
					break;
				case 'extend-quest-arc':
					await tasks.trigger('world-extend-quest-arc', {
						adventureId: payload.adventureId,
						questId: intent.questId!
					});
					break;
				case 'react-to-party':
					await tasks.trigger('world-react-to-party', {
						adventureId: payload.adventureId
					});
					break;
			}
		} catch (err) {
			console.error(`[enrichment] Failed to dispatch ${intent.type}:`, err);
		}
	}
}

// ---------------------------------------------------------------------------
// Enrichment intents — collected by applyGMStateChanges, dispatched by caller
// ---------------------------------------------------------------------------

export interface EnrichmentIntent {
	type: 'expand-settlement' | 'extend-quest-arc' | 'react-to-party';
	locationId?: string;
	questId?: string;
}

/**
 * Apply the GM's proposed state changes to the GameState.
 *
 * Ordering matters: world-building additions (npcsAdded, locationsAdded,
 * questsAdded) are applied FIRST so that subsequent references (locationChange,
 * npcChanges, questUpdates, encounterStarted) can find the newly-created
 * entities.  ID validation logs warnings and skips invalid entries rather
 * than silently corrupting state.
 *
 * Returns an array of EnrichmentIntent describing background enrichment
 * tasks that should be triggered after persistence completes.
 */
function applyGMStateChanges(state: GameState, changes: StateChange, turnNumber: number): EnrichmentIntent[] {
	const enrichmentIntents: EnrichmentIntent[] = [];
	if (!changes) return enrichmentIntents;
	// -----------------------------------------------------------------------
	// Phase A — World-building additions FIRST (so later steps can reference
	//           newly-created NPCs, locations, and quests)
	// -----------------------------------------------------------------------

	// New NPCs (before npcChanges / encounterStarted)
	if (changes.npcsAdded) {
		for (const npcData of changes.npcsAdded) {
			// Skip if NPC ID already exists (idempotent)
			if (state.npcs.some((n) => n.id === npcData.id)) continue;
			const npc: NPC = {
				id: npcData.id,
				name: npcData.name,
				role: npcData.role,
				locationId: npcData.locationId,
				disposition: Math.max(-100, Math.min(100, npcData.disposition)),
				description: npcData.description,
				notes: npcData.notes ?? '',
				alive: true,
				lastInteractionTurn: turnNumber
			};
			state.npcs.push(npc);
		}
	}

	// New locations (before locationChange)
	if (changes.locationsAdded) {
		for (const locData of changes.locationsAdded) {
			if (state.locations.some((l) => l.id === locData.id)) continue;
			const loc: Location = {
				id: locData.id,
				name: locData.name,
				type: locData.type,
				description: locData.description,
				connections: locData.connections ?? [],
				npcs: [],
				features: locData.features ?? [],
				regionRef: null,
				visited: false
			};
			state.locations.push(loc);

			// Wire bidirectional connections
			for (const connId of loc.connections) {
				const connected = state.locations.find((l) => l.id === connId);
				if (connected && !connected.connections.includes(loc.id)) {
					connected.connections.push(loc.id);
				}
			}
		}
	}

	// New quests (before questUpdates)
	if (changes.questsAdded) {
		for (const qData of changes.questsAdded) {
			if (state.quests.some((q) => q.id === qData.id)) continue;
			const quest: Quest = {
				id: qData.id,
				name: qData.name,
				description: qData.description,
				giverNpcId: qData.giverNpcId ?? null,
				status: 'available',
				objectives: qData.objectives.map((o) => ({ id: o.id, text: o.text, done: false })),
				rewards: { xp: 0, gold: 0, items: [], reputationChanges: [] },
				recommendedLevel: qData.recommendedLevel ?? 1,
				encounterTemplates: []
			};
			state.quests.push(quest);
		}
	}

	// -----------------------------------------------------------------------
	// Phase B — Validated mutations (reference entities that now exist)
	// -----------------------------------------------------------------------

	// HP changes (validate characterId)
	if (changes.hpChanges) {
		for (const hc of changes.hpChanges) {
			const char = state.characters.find((c) => c.id === hc.characterId);
			if (char) {
				char.hp = Math.max(0, Math.min(hc.newHp, char.maxHp));
			} else {
				console.warn(`[applyGMStateChanges] hpChange references unknown characterId="${hc.characterId}" — skipped`);
			}
		}
	}

	// Conditions (validate characterId)
	if (changes.conditionsApplied) {
		for (const ca of changes.conditionsApplied) {
			const char = state.characters.find((c) => c.id === ca.characterId);
			if (char) {
				if (ca.applied && !char.conditions.includes(ca.condition)) {
					char.conditions.push(ca.condition);
				} else if (!ca.applied) {
					char.conditions = char.conditions.filter((c) => c !== ca.condition);
				}
			} else {
				console.warn(`[applyGMStateChanges] conditionsApplied references unknown characterId="${ca.characterId}" — skipped`);
			}
		}
	}

	// XP (validate characterId)
	if (changes.xpAwarded) {
		for (const xp of changes.xpAwarded) {
			const char = state.characters.find((c) => c.id === xp.characterId);
			if (char) {
				char.xp += xp.amount;
			} else {
				console.warn(`[applyGMStateChanges] xpAwarded references unknown characterId="${xp.characterId}" — skipped`);
			}
		}
	}

	// Location change (validate that the target location exists — now including
	// locations that were just added above in Phase A)
	if (changes.locationChange) {
		const targetId = changes.locationChange.to;
		let loc = state.locations.find((l) => l.id === targetId);

		// Fuzzy match: AI may have used a display name instead of a location ID
		if (!loc) {
			const normalise = (s: string) => s.toLowerCase().replace(/^loc-/, '').replace(/[-_ ]/g, '');
			const needle = normalise(targetId);
			loc = state.locations.find(
				(l) => normalise(l.id) === needle || normalise(l.name) === needle
			);
		}

		if (loc) {
			state.partyLocationId = loc.id;
			loc.visited = true;

			// Auto-move companion NPCs to the new location so they travel with the party
			for (const npc of state.npcs) {
				if (npc.alive && npc.role === 'companion') {
					npc.locationId = loc.id;
				}
			}

			// Trigger settlement expansion for newly-visited settlements with few NPCs
			if (loc.type === 'settlement') {
				const localNpcCount = state.npcs.filter((n) => n.locationId === loc.id && n.alive).length;
				if (localNpcCount < 3) {
					enrichmentIntents.push({ type: 'expand-settlement', locationId: loc.id });
				}
			}
		} else {
			console.warn(`[applyGMStateChanges] locationChange.to="${targetId}" matches no known location — skipped`);
		}
	}

	// Quest updates (can now reference quests added in Phase A)
	if (changes.questUpdates) {
		for (const qu of changes.questUpdates) {
			const quest = state.quests.find((q) => q.id === qu.questId);
			if (!quest) {
				console.warn(`[applyGMStateChanges] questUpdate references unknown questId="${qu.questId}" — skipped`);
				continue;
			}

			if (qu.field === 'status' && typeof qu.newValue === 'string') {
				quest.status = qu.newValue as typeof quest.status;
				// Quest reward auto-distribution on manual completion
				if (quest.status === 'completed') {
					distributeQuestRewards(state, quest);
				}
			} else if (qu.field === 'objective' && qu.objectiveId) {
				const obj = quest.objectives.find((o) => o.id === qu.objectiveId);
				if (obj) {
					obj.done = !!qu.newValue;
				}
				// Auto-complete quest if all objectives are done
				if (quest.objectives.length > 0 && quest.objectives.every((o) => o.done)) {
					quest.status = 'completed';
					// Distribute quest rewards to all party characters
					distributeQuestRewards(state, quest);
					// Trigger follow-up quest generation
					enrichmentIntents.push({ type: 'extend-quest-arc', questId: quest.id });
				}
			}
		}
	}

	// NPC changes (validate npcId — now includes NPCs added in Phase A)
	if (changes.npcChanges) {
		for (const nc of changes.npcChanges) {
			const npc = state.npcs.find((n) => n.id === nc.npcId);
			if (!npc) {
				console.warn(`[applyGMStateChanges] npcChange references unknown npcId="${nc.npcId}" — skipped`);
				continue;
			}
			// Track interaction timestamp
			npc.lastInteractionTurn = turnNumber;

			if (nc.field === 'disposition' && typeof nc.newValue === 'number') {
				npc.disposition = Math.max(-100, Math.min(100, nc.newValue));
			}
			if (nc.field === 'alive' && typeof nc.newValue === 'boolean') {
				npc.alive = nc.newValue;
			}
			// Companion HP tracking — apply HP changes to the NPC's stat block
			if (nc.field === 'hp' && typeof nc.newValue === 'number' && npc.statBlock) {
				npc.statBlock.hp = Math.max(0, Math.min(nc.newValue, npc.statBlock.maxHp));
			}
			// Interaction notes — record important NPC details
			if (nc.field === 'notes' && typeof nc.newValue === 'string' && nc.newValue.trim()) {
				if (!npc.interactionNotes) npc.interactionNotes = [];
				npc.interactionNotes.push({ turn: turnNumber, note: nc.newValue.trim() });
				// Cap at 10 per NPC (FIFO)
				const MAX_NPC_NOTES = 10;
				if (npc.interactionNotes.length > MAX_NPC_NOTES) {
					npc.interactionNotes = npc.interactionNotes.slice(-MAX_NPC_NOTES);
				}
			}
		}
	}

	// Clock advance
	if (changes.clockAdvance) {
		state.clock = changes.clockAdvance.to;
	}

	// Items gained (validate characterId)
	if (changes.itemsGained) {
		for (const ig of changes.itemsGained) {
			const char = state.characters.find((c) => c.id === ig.characterId);
			if (!char) {
				console.warn(`[applyGMStateChanges] itemsGained references unknown characterId="${ig.characterId}" — skipped`);
				continue;
			}
			// If an item with the same id already exists, increase its quantity instead of duplicating
			const existing = char.inventory.find((i) => i.id === ig.item.id);
			if (existing) {
				existing.quantity = (existing.quantity ?? 1) + (ig.item.quantity ?? 1);
			} else {
				char.inventory.push({ ...ig.item, quantity: ig.item.quantity ?? 1 });
			}
		}
	}

	// Items lost / dropped / consumed (validate characterId + itemId)
	if (changes.itemsLost) {
		for (const il of changes.itemsLost) {
			const char = state.characters.find((c) => c.id === il.characterId);
			if (!char) {
				console.warn(`[applyGMStateChanges] itemsLost references unknown characterId="${il.characterId}" — skipped`);
				continue;
			}
			const idx = char.inventory.findIndex((i) => i.id === il.itemId);
			if (idx === -1) {
				console.warn(`[applyGMStateChanges] itemsLost references unknown itemId="${il.itemId}" for character "${char.name}" — skipped`);
				continue;
			}
			const item = char.inventory[idx];
			const currentQty = item.quantity ?? 1;
			const removeQty = il.quantity ?? 1;
			if (removeQty >= currentQty) {
				// Remove the item entirely
				char.inventory.splice(idx, 1);
			} else {
				item.quantity = currentQty - removeQty;
			}
		}
	}

	// Scene facts — persist to GameState for inclusion in future prompts
	if (changes.sceneFactsAdded && changes.sceneFactsAdded.length > 0) {
		if (!state.sceneFacts) state.sceneFacts = [];
		for (const fact of changes.sceneFactsAdded) {
			if (typeof fact === 'string' && fact.trim() && !state.sceneFacts.includes(fact)) {
				state.sceneFacts.push(fact);

				// Auto-route facts to NPC interactionNotes when the fact mentions the NPC
				const factLower = fact.toLowerCase();
				for (const npc of state.npcs) {
					const nameLower = npc.name.toLowerCase();
					const firstName = npc.name.split(/\s+/)[0].toLowerCase();
					if (factLower.includes(nameLower) || (firstName.length >= 3 && factLower.includes(firstName))) {
						if (!npc.interactionNotes) npc.interactionNotes = [];
						npc.interactionNotes.push({ turn: turnNumber, note: fact });
						npc.lastInteractionTurn = turnNumber;
						// Cap at 10 per NPC (FIFO)
						const MAX_NPC_NOTES = 10;
						if (npc.interactionNotes.length > MAX_NPC_NOTES) {
							npc.interactionNotes = npc.interactionNotes.slice(-MAX_NPC_NOTES);
						}
					}
				}
			}
		}
		// Cap at 50 entries (FIFO eviction of oldest)
		const MAX_SCENE_FACTS = 50;
		if (state.sceneFacts.length > MAX_SCENE_FACTS) {
			state.sceneFacts = state.sceneFacts.slice(-MAX_SCENE_FACTS);
		}
	}

	// Companion promotion — promote an existing NPC to companion role with stat block
	if (changes.companionPromoted) {
		const { npcId, statBlock } = changes.companionPromoted;
		const npc = state.npcs.find((n) => n.id === npcId);
		if (npc) {
			npc.role = 'companion';
			npc.statBlock = { ...statBlock };
			npc.lastInteractionTurn = turnNumber;
			// Companions travel with the party — sync location
			if (state.partyLocationId) {
				npc.locationId = state.partyLocationId;
			}
		} else {
			console.warn(`[applyGMStateChanges] companionPromoted references unknown npcId="${npcId}" — skipped`);
		}
	}

	// Encounter started — generate stat blocks, add NPCs, call createEncounter()
	if (changes.encounterStarted) {
		const creatures = changes.encounterStarted.creatures ?? [];
		const partyLevel = averagePartyLevel(state.characters);

		// Also add the creatures as NPCs if they don't already exist, and attach stat blocks
		for (const cr of creatures) {
			// Generate a stat block from tier + party level
			const tier = parseCreatureTier(cr.tier);
			const statBlock = generateCreatureStatBlock(cr.name, tier, partyLevel);

			if (cr.id && !state.npcs.some((n) => n.id === cr.id)) {
				state.npcs.push({
					id: cr.id,
					name: cr.name,
					role: cr.role ?? 'hostile',
					locationId: state.partyLocationId ?? '',
					disposition: cr.disposition ?? -100,
					description: cr.description ?? cr.name,
					notes: '',
					alive: true,
					statBlock,
					lastInteractionTurn: turnNumber
				});
			} else {
				// Update existing creature NPCs entering combat — attach stat block if missing
				const existing = state.npcs.find((n) => n.id === cr.id);
				if (existing) {
					existing.lastInteractionTurn = turnNumber;
					if (!existing.statBlock) existing.statBlock = statBlock;
				}
			}
		}

		// Gather fully-populated NPC objects for hostile creatures
		const hostileNpcs = creatures
			.map((cr) => state.npcs.find((n) => n.id === cr.id))
			.filter((n): n is NPC => !!n && !!n.statBlock);

		// Also include companion NPCs at the party's location
		const companionNpcs = state.npcs.filter(
			(n) => n.alive && n.role === 'companion' && n.locationId === state.partyLocationId && n.statBlock
		);

		// Use the combat engine to roll initiative and build the encounter
		const allCombatCreatures = [...hostileNpcs, ...companionNpcs];
		const { encounter } = createEncounter(state, allCombatCreatures);
		initEncounterTurnOrder(encounter, state.npcs);
		state.activeEncounter = encounter;
	}

	// Encounter ended — resolve XP and clear the active encounter
	if (changes.encounterEnded && state.activeEncounter) {
		const outcome = changes.encounterEnded.outcome ?? 'victory';

		// Gather NPC references for XP calculation
		const encounterNpcIds = state.activeEncounter.combatants
			.filter((c) => c.type === 'npc')
			.map((c) => c.referenceId);
		const encounterNpcs = state.npcs.filter((n) => encounterNpcIds.includes(n.id));

		// Mark all enemy combatants as defeated on victory
		if (outcome === 'victory') {
			for (const combatant of state.activeEncounter.combatants) {
				if (combatant.type === 'npc') {
					const npc = state.npcs.find((n) => n.id === combatant.referenceId);
					if (npc && npc.role !== 'companion') {
						combatant.defeated = true;
					}
				}
			}
		}

		const partySize = state.characters.length;
		const resolution = resolveEncounter(state.activeEncounter, outcome, encounterNpcs, partySize);

		// Apply XP awards from the resolution
		if (resolution.stateChange.xpAwarded) {
			for (const award of resolution.stateChange.xpAwarded) {
				const char = state.characters.find((c) => c.id === award.characterId);
				if (char) {
					char.xp += award.amount;
				}
			}
			// Surface XP in the turn's state changes so the UI can render it
			if (!changes.xpAwarded) changes.xpAwarded = [];
			changes.xpAwarded.push(...resolution.stateChange.xpAwarded);
		}

		// Clear the active encounter so it's no longer in state
		state.activeEncounter = undefined;
	}

	// Death save results — update character conditions
	if (changes.deathSaveOutcome) {
		const { characterId, outcome } = changes.deathSaveOutcome;
		const char = state.characters.find((c) => c.id === characterId);
		if (char) {
			if (outcome === 'dead') {
				// "Dead" is not a D&D condition — set HP to 0 and add 'unconscious'
				char.hp = 0;
				if (!char.conditions.includes('unconscious')) {
					char.conditions.push('unconscious');
				}
			} else if (outcome === 'stable') {
				char.conditions = char.conditions.filter((c) => c !== 'unconscious');
				if (char.hp === 0) char.hp = 1;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Auto-archive dead NPCs that haven't been referenced in 20+ turns
	// -----------------------------------------------------------------------
	const ARCHIVE_AFTER_TURNS = 20;
	for (const npc of state.npcs) {
		if (
			!npc.alive &&
			!npc.archived &&
			npc.lastInteractionTurn !== undefined &&
			turnNumber - npc.lastInteractionTurn > ARCHIVE_AFTER_TURNS
		) {
			npc.archived = true;
		}
	}

	// -----------------------------------------------------------------------
	// Auto-level-up check — after XP awards, check if any character qualifies
	// -----------------------------------------------------------------------
	for (let ci = 0; ci < state.characters.length; ci++) {
		const char = state.characters[ci];
		const levelCheck = canLevelUp(char);
		if (levelCheck.canLevel) {
			// Auto-apply each available level-up with default choices
			let current = char;
			for (let l = 0; l < levelCheck.levelsAvailable; l++) {
				const result = applyLevelUp(current);
				if (result.success) {
					current = result.character;
				} else {
					break;
				}
			}
			state.characters[ci] = current;
		}
	}

	return enrichmentIntents;
}

// ---------------------------------------------------------------------------
// Quest reward distribution
// ---------------------------------------------------------------------------

/**
 * Distribute a quest's rewards to all living party characters.
 * Awards XP, gold, items, and reputation changes.
 * Only distributes if the quest has non-zero rewards.
 */
function distributeQuestRewards(state: GameState, quest: Quest): void {
	const rewards = quest.rewards;
	if (!rewards) return;

	const livingChars = state.characters.filter((c) => !c.dead);
	if (livingChars.length === 0) return;

	// XP — award to each living character
	if (rewards.xp > 0) {
		for (const char of livingChars) {
			char.xp += rewards.xp;
		}
	}

	// Gold — award to each living character
	if (rewards.gold > 0) {
		for (const char of livingChars) {
			char.gold += rewards.gold;
		}
	}

	// Items — award to the first living character (party leader)
	if (rewards.items && rewards.items.length > 0) {
		const recipient = livingChars[0];
		for (const item of rewards.items) {
			const existing = recipient.inventory.find((i) => i.id === item.id);
			if (existing) {
				existing.quantity = (existing.quantity ?? 1) + (item.quantity ?? 1);
			} else {
				recipient.inventory.push({ ...item, quantity: item.quantity ?? 1 });
			}
		}
	}

	// Reputation changes — adjust NPC dispositions
	if (rewards.reputationChanges && rewards.reputationChanges.length > 0) {
		for (const rep of rewards.reputationChanges) {
			const npc = state.npcs.find((n) => n.id === rep.npcId);
			if (npc) {
				npc.disposition = Math.max(-100, Math.min(100, npc.disposition + rep.delta));
			}
		}
	}
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
