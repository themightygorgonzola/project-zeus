import { tasks } from '@trigger.dev/sdk';
import { ulid } from 'ulid';
import { completeChat, completeChatJSON, streamChat, type ChatMessageInput } from './openai';
import { notifyRoom } from './party';
import { loadGameState, saveGameState, persistTurn, persistTurnAndSaveState, loadRecentTurns, loadUnconsumedChat, markChatConsumed } from '$lib/game/state';
import type { ChatRecord } from '$lib/game/state';
import { assembleGMContext, assembleNarrativeGMContext, assembleNarratorContext, assembleRoundNarratorContext, assembleStateExtractionContext } from '$lib/game/gm-context';
import { resolveTurn, parseTurnIntent, type ResolvedTurn } from './turn-executor';
import { classifyCombatIntent, buildClassifierInput } from './combat-classifier';
import { classifyEncounterStart, resolveSurpriseDamage, type EncounterClassification } from './encounter-classifier';
import type {
	CombatIntent,
	Condition,
	GameId,
	GameState,
	GMResponse,
	IntentType,
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
import { createEncounter, resolveEncounter, allDefeated, initEncounterTurnOrder, syncCombatantsFromState } from '$lib/game/combat';
import { generateCreatureStatBlock, averagePartyLevel, parseCreatureTier, isStatBlockFlat, type CreatureTier } from '$lib/game/creature-templates';
import { skillCheck, abilityCheck, savingThrow } from '$lib/game/mechanics';
import { SKILL_ABILITY_MAP } from '$lib/game/types';
import { advanceClockOnState, IDLE_TURNS_PER_PERIOD } from '$lib/game/travel';

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
	mode: 'narrator' | 'narrator+victory-extraction' | 'full-gm' | 'full-gm-2pass' | 'clarification' | 'awaiting-roll' | 'mid-round';
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

	// -----------------------------------------------------------------------
	// Combat classifier: when there's an active encounter, use a dedicated
	// LLM call to classify the player's intent into a structured CombatIntent.
	// This replaces the fragile regex + AI-fallback approach entirely during combat.
	// -----------------------------------------------------------------------
	let combatIntent: CombatIntent | undefined;
	let intentOverride: IntentType | undefined;
	const inActiveCombat = currentState?.activeEncounter?.status === 'active';

	if (inActiveCombat && currentState) {
		const openaiKey = process.env.OPENAI_API_KEY;
		if (openaiKey) {
			// Emit classifying phase event
			if (partyHost) {
				await broadcastGameEvent(partyHost, payload.adventureId, {
					type: 'game:turn:classifying',
					adventureId: payload.adventureId,
					timestamp: Date.now()
				});
			}
			const classifierInput = buildClassifierInput(payload.playerAction, currentState, payload.actorUserId);
			combatIntent = await classifyCombatIntent(classifierInput, openaiKey, 'gpt-4o-mini');

			// Query path: free action, does not consume a turn. Stream a lightweight
			// response and return immediately without advancing initiative.
			if (combatIntent.type === 'query') {
				if (partyHost) {
					await broadcastGameEvent(partyHost, payload.adventureId, {
						type: 'game:turn:query',
						adventureId: payload.adventureId,
						timestamp: Date.now()
					});
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:start',
						model: profile.model,
						purpose: profile.purpose
					});
				}

				// Build a lightweight context: just the active encounter + question
				const enc = currentState.activeEncounter!;
				const combatantList = enc.combatants
					.filter(c => !c.defeated)
					.map(c => `${c.name} (HP ${c.currentHp}/${c.maxHp}, AC ${c.ac})`)
					.join(', ');
				const queryMessages: ChatMessageInput[] = [
					{
						role: 'system',
						content: `You are a D&D 5e GM answering a quick question during combat. Be concise (1-3 sentences). Active combatants: ${combatantList}. Current turn: ${enc.awaitingActorId ? enc.combatants.find(c => c.id === enc.awaitingActorId)?.name ?? 'unknown' : 'unknown'}.`
					},
					{ role: 'user', content: payload.playerAction }
				];

				let queryResponse = '';
				if (profile.stream && partyHost) {
					queryResponse = await streamChat(
						{ apiKey: openaiKey, model: profile.model, messages: queryMessages },
						async (chunk) => {
							await notifyRoom(partyHost, payload.adventureId, {
								type: 'ai:turn:chunk',
								text: chunk
							});
						}
					);
				} else {
					queryResponse = await completeChat({ apiKey: openaiKey, model: profile.model, messages: queryMessages });
				}

				if (partyHost) {
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:end',
						text: queryResponse,
						model: profile.model
					});
				}

				// Persist as a non-advancing turn (no state changes, no initiative step)
				const queryResolvedTurn: ResolvedTurn = {
					status: 'ready-for-narration',
					intent: parseTurnIntent(payload.playerAction, 'free-narration'),
					actorId: payload.actorUserId,
					targets: [],
					resourcesConsumed: [],
					resolvedActionSummary: 'Query during combat (free action)',
					mechanicResults: [],
					stateChanges: {}
				};
				await persistResolvedTurnAndState(payload, queryResolvedTurn, queryResponse, currentState);

				return { narrativeText: queryResponse, model: profile.model };
			}

			// Low confidence: ask for clarification
			if (combatIntent.confidence === 'low') {
				const clarifyText = `I'm not sure what you're trying to do. Could you rephrase your action? (e.g. "I attack the goblin with my sword" or "I cast Fire Bolt at the skeleton")`;
				if (partyHost) {
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:start',
						model: 'server-executor',
						purpose: profile.purpose
					});
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:end',
						text: clarifyText,
						model: 'server-executor'
					});
				}
				const clarifyResolvedTurn: ResolvedTurn = {
					status: 'needs-clarification',
					intent: parseTurnIntent(payload.playerAction, 'free-narration'),
					actorId: payload.actorUserId,
					targets: [],
					resourcesConsumed: [],
					resolvedActionSummary: 'Low confidence combat intent — clarification requested',
					mechanicResults: [],
					stateChanges: {}
				};
				await persistResolvedTurnAndState(payload, clarifyResolvedTurn, clarifyText, currentState);
				return { narrativeText: clarifyText, model: 'server-executor' };
			}
		}
	}

	const resolvedTurn = resolveTurn(payload.playerAction, currentState, payload.actorUserId, intentOverride, combatIntent);
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
				model: 'server-executor',
				clarification: resolvedTurn.clarification
			});
		}
		const clarificationDebug = debugTurns ? buildClarificationDebug(resolvedTurn.stateChanges) : null;
		await persistResolvedTurnAndState(payload, resolvedTurn, clarificationText, currentState, clarificationDebug);
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

		await persistResolvedTurnAndState(payload, resolvedTurn, rollPromptText, currentState, debugTurns ? {
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
		await persistResolvedTurnAndState(payload, resolvedTurn, '', currentState, debugTurns ? {
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
			narrativeMessages = assembleRoundNarratorContext(currentState, world, roundActions, recentTurns, payload.recentChat, resolvedTurn.stateChanges.encounterEnded);
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

			// Victory narration: run a pass 2 state extraction to capture quest
			// updates, NPC disposition changes, and other GM-level effects that
			// the narrator alone cannot emit (it returns plain prose, not JSON).
			if (resolvedTurn.stateChanges.encounterEnded?.outcome === 'victory' && currentState) {
				await broadcastGameEvent(partyHost, payload.adventureId, {
					type: 'game:turn:extracting',
					adventureId: payload.adventureId,
					timestamp: Date.now()
				});
				const pass2Start = Date.now();
				const stateExtractionMessages = assembleStateExtractionContext(
					currentState,
					narrativeText,
					payload.playerAction,
					true // combatVictory — injects quest-completion check and strips combat XP
				);
				const rawStateJson = await completeChatJSON({
					apiKey: openaiKey,
					model: profile.model,
					messages: stateExtractionMessages
				});
				const pass2LatencyMs = Date.now() - pass2Start;
				const stateResponse = parseStateExtractionResponse(rawStateJson);
				const sanitizedGmChanges = sanitizeStateChanges(stateResponse, currentState, narrativeText);
				// Strip xpAwarded from AI proposals — the engine's resolveEncounter already
				// computed authoritative combat XP. Allowing the AI to also award XP here
				// causes double-awarding (e.g. 50 engine XP + 100 AI XP = 150 total).
				delete sanitizedGmChanges.xpAwarded;
				finalStateChanges = mergeStateChanges(resolvedTurn.stateChanges, sanitizedGmChanges);

				if (debugTurns) {
					debugData = {
						mode: 'narrator+victory-extraction',
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
						engineIntent: resolvedTurn.intent.primaryIntent,
						engineResolvedCombat: resolvedTurn.mechanicResults.length > 0,
						roundComplete: resolvedTurn.roundComplete ?? undefined
					};
				}
			} else if (debugTurns) {
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
			await broadcastGameEvent(partyHost, payload.adventureId, {
				type: 'game:turn:extracting',
				adventureId: payload.adventureId,
				timestamp: Date.now()
			});
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

		// -----------------------------------------------------------------
		// Encounter Classification (LLM-based)
		// If the AI proposed an encounter start, validate it and detect
		// surprise/ambush scenarios for pre-combat damage resolution.
		// -----------------------------------------------------------------
		let encounterClassification: EncounterClassification | null = null;
		if (finalStateChanges.encounterStarted?.creatures?.length && narrativeText) {
			const creatureNames = finalStateChanges.encounterStarted.creatures.map(
				(c: { name: string }) => c.name
			);
			try {
				encounterClassification = await classifyEncounterStart(
					narrativeText,
					creatureNames,
					openaiKey,
					'gpt-4o-mini'
				);

				if (!encounterClassification.shouldStartEncounter) {
					console.warn('[encounterClassifier] LLM says narrative does not describe combat — stripping encounterStarted');
					delete finalStateChanges.encounterStarted;
				} else if (encounterClassification.isSurprise) {
					console.log(`[encounterClassifier] Surprise detected! ${encounterClassification.surprisedSide} is surprised, ${encounterClassification.preRoundDamage.length} pre-round damage entries`);
				}
			} catch (err) {
				console.error('[encounterClassifier] Classification failed, allowing encounter:', err);
				// On error, trust the AI's proposal (no surprise detection)
			}
		}

		// Guard: strip any still-empty encounterStarted that survived the merge.
		// This catches engine travel templates that the AI failed to populate.
		if (finalStateChanges.encounterStarted && !finalStateChanges.encounterStarted.creatures?.length) {
			console.warn('[encounterMerge] encounterStarted.creatures is empty after merge — stripped (AI did not populate travel template)');
			delete finalStateChanges.encounterStarted;
		}

		// Idle turn clock advance: every IDLE_TURNS_PER_PERIOD consecutive turns without
		// travel or combat advances the clock one period (time passes during exploration).
		if (currentState) {
			if (finalStateChanges.clockAdvance) {
				// Travel or combat already moved time — reset idle counter
				currentState.idleTurnCount = 0;
			} else {
				currentState.idleTurnCount = (currentState.idleTurnCount ?? 0) + 1;
				if (currentState.idleTurnCount >= IDLE_TURNS_PER_PERIOD) {
					const idleClock = advanceClockOnState(currentState, 1);
					currentState.idleTurnCount = 0;
					finalStateChanges = { ...finalStateChanges, clockAdvance: idleClock.clockAdvance };
				}
			}
		}

		// Persist the turn and apply state changes
		const finalResolvedTurn: ResolvedTurn = {
			...resolvedTurn,
			stateChanges: finalStateChanges
		};
		await persistResolvedTurnAndState(payload, finalResolvedTurn, narrativeText, currentState, debugData, encounterClassification);

		// Mark unconsumed chat as consumed by this turn
		const chatIds = payload.recentChat.map((c) => c.id);
		if (chatIds.length > 0) {
			await markChatConsumed(chatIds, turnNumber);
		}

		// Broadcast typed game events AFTER persistence
		if (currentState) await broadcastTurnEvents(partyHost, payload.adventureId, finalResolvedTurn, narrativeText, turnNumber, currentState);

		// ai:turn:end fires AFTER persistence + broadcast so the client can
		// safely invalidateAll() immediately without a setTimeout race.
		await notifyRoom(partyHost, payload.adventureId, {
			type: 'ai:turn:end',
			text: narrativeText,
			model: profile.model
		});

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

		await persistResolvedTurnAndState(payload, resolvedTurn, narrativeText, state, debugData);
		await broadcastTurnEvents(partyHost, adventureId, resolvedTurn, narrativeText, turnNumber, state);

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
	turnNumber: number,
	state: GameState
): Promise<void> {
	const now = Date.now();

	// State update event (if any state changes were applied)
	const sc = resolvedTurn.stateChanges;
	const hasStateChanges = sc.hpChanges?.length || sc.conditionsApplied?.length ||
		sc.xpAwarded?.length || sc.goldChange?.length || sc.locationChange || sc.questUpdates?.length ||
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

	// Quest status update events
	if (sc.questUpdates) {
		for (const qu of sc.questUpdates) {
			if (qu.field !== 'status') continue;
			const newVal = qu.newValue as string;
			const reason = newVal === 'active' ? 'accepted'
				: newVal === 'completed' ? 'completed'
				: newVal === 'failed' ? 'failed'
				: null;
			if (!reason) continue;
			const quest = state.quests.find(q => q.id === qu.questId);
			if (!quest) continue;
			await broadcastGameEvent(host, adventureId, {
				type: 'game:quest-update',
				adventureId,
				timestamp: now,
				quest,
				reason
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
function mergeUniqueByKey<T>(engine: T[] | undefined, gm: T[] | undefined, keyFn: (value: T) => string): T[] | undefined {
	const merged: T[] = [];
	const seen = new Set<string>();
	for (const value of engine ?? []) {
		const key = keyFn(value);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(value);
	}
	for (const value of gm ?? []) {
		const key = keyFn(value);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(value);
	}
	return merged.length > 0 ? merged : undefined;
}

export function mergeStateChanges(engine: StateChange, gm: StateChange): StateChange {
	return {
		hpChanges: mergeUniqueByKey(engine.hpChanges, gm.hpChanges, (hc) => `${hc.characterId}|${hc.oldHp}|${hc.newHp}|${hc.reason ?? ''}`),
		conditionsApplied: mergeUniqueByKey(engine.conditionsApplied, gm.conditionsApplied, (ca) => `${ca.characterId}|${ca.condition}|${ca.applied}`),
		xpAwarded: mergeUniqueByKey(engine.xpAwarded, gm.xpAwarded, (xp) => `${xp.characterId}|${xp.amount}|${xp.reason ?? ''}`),
		goldChange: (() => {
			// Strip GM gold entries whose (characterId, delta) matches an engine quest-reward
			// distribution. Prevents double-payment when the AI narrates an NPC paying out
			// a quest reward in the same turn the engine calls distributeQuestRewards.
			const engineQuestRewardKeys = new Set(
				(engine.goldChange ?? [])
					.filter(gc => gc.reason?.startsWith('Quest reward:'))
					.map(gc => `${gc.characterId}|${gc.delta}`)
			);
			const gmGoldFiltered = (gm.goldChange ?? []).filter(
				gc => !engineQuestRewardKeys.has(`${gc.characterId}|${gc.delta}`)
			);
			return mergeUniqueByKey(engine.goldChange, gmGoldFiltered, (gc) => `${gc.characterId}|${gc.delta}|${gc.reason ?? ''}`);
		})(),
		locationChange: engine.locationChange ?? gm.locationChange,
		questUpdates: mergeUniqueByKey(engine.questUpdates, gm.questUpdates, (qu) => `${qu.questId}|${qu.field}|${qu.objectiveId ?? ''}`),
		npcChanges: mergeUniqueByKey(engine.npcChanges, gm.npcChanges, (nc) => `${nc.npcId}|${nc.field}`),
		clockAdvance: engine.clockAdvance ?? gm.clockAdvance,
		spellSlotUsed: engine.spellSlotUsed ?? gm.spellSlotUsed,
		itemsLost: mergeUniqueByKey(engine.itemsLost, gm.itemsLost, (il) => `${il.characterId}|${il.itemId}|${il.quantity ?? 1}`),
		itemsGained: mergeUniqueByKey(engine.itemsGained, gm.itemsGained, (ig) => `${ig.characterId}|${ig.item.id}`),
		itemsDropped: mergeUniqueByKey(engine.itemsDropped, gm.itemsDropped, (dr) => `${dr.characterId}|${dr.itemId}|${dr.locationId ?? ''}`),
		itemsPickedUp: mergeUniqueByKey(engine.itemsPickedUp, gm.itemsPickedUp, (pu) => `${pu.characterId}|${pu.itemId}|${pu.locationId ?? ''}`),
		locationItemsAdded: mergeUniqueByKey(engine.locationItemsAdded, gm.locationItemsAdded, (la) => `${la.locationId}|${la.item.id}`),
		hitDiceUsed: engine.hitDiceUsed ?? gm.hitDiceUsed,
		featureUsed: engine.featureUsed ?? gm.featureUsed,
		// World-building additions (typically from GM only; engine doesn't create world content)
		npcsAdded: mergeUniqueByKey(engine.npcsAdded, gm.npcsAdded, (npc) => npc.id),
		locationsAdded: mergeUniqueByKey(engine.locationsAdded, gm.locationsAdded, (loc) => loc.id),
		questsAdded: mergeUniqueByKey(engine.questsAdded, gm.questsAdded, (quest) => quest.id),
		sceneFactsAdded: mergeUniqueByKey(engine.sceneFactsAdded, gm.sceneFactsAdded, (fact) => fact),
		// Companion promotion
		companionPromoted: engine.companionPromoted ?? gm.companionPromoted,
		// Encounter lifecycle
		// If the engine set an empty-template encounter (travel trigger), let the GM's
		// populated creatures fill it. Without this, AI-supplied creatures are discarded.
		encounterStarted: (() => {
			const eng = engine.encounterStarted;
			const gm_ = gm.encounterStarted;
			if (eng && !eng.creatures?.length && gm_?.creatures?.length) return gm_;
			return eng ?? gm_;
		})(),
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
					'hpChanges', 'conditionsApplied', 'xpAwarded', 'goldChange', 'locationChange',
					'questUpdates', 'npcChanges', 'clockAdvance', 'spellSlotUsed',
					'itemsLost', 'itemsGained', 'itemsDropped', 'itemsPickedUp', 'locationItemsAdded',
					'hitDiceUsed', 'featureUsed',
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
				'hpChanges', 'conditionsApplied', 'xpAwarded', 'goldChange', 'locationChange',
				'questUpdates', 'npcChanges', 'clockAdvance', 'spellSlotUsed',
				'itemsLost', 'itemsGained', 'itemsDropped', 'itemsPickedUp', 'locationItemsAdded',
				'hitDiceUsed', 'featureUsed',
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

type RefCandidate = { id: string; name?: string };

function collectRefCandidates(values: unknown[] | undefined): RefCandidate[] {
	if (!Array.isArray(values)) return [];
	return values
		.filter((value): value is { id: string; name?: string } => !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string')
		.map((value) => ({
			id: value.id,
			name: typeof value.name === 'string' ? value.name : undefined
		}));
}

function extractProtocolId(raw: string): string {
	const trimmed = raw.trim();
	const labeledId = trimmed.match(/\[(?:[^:\]]+\s+)?id:\s*([^\]]+)\]/i);
	if (labeledId) return labeledId[1].trim();
	const inlineId = trimmed.match(/\b(?:[a-z]+)?id\s*[:=]\s*([A-Za-z0-9_-]+)/i);
	if (inlineId) return inlineId[1].trim();
	const legacyBracket = trimmed.match(/\[([^\]]+)\]$/);
	if (legacyBracket) return legacyBracket[1].trim();
	return trimmed;
}

function normalizeLookupValue(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/\[(?:[^:\]]+\s+)?id:\s*[^\]]+\]/gi, ' ')
		.replace(/\[name:\s*([^\]]+)\]/gi, '$1')
		.replace(/[\[\]\(\){}|,:"'`]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function resolveEntityId(
	raw: string,
	entities: RefCandidate[],
	label: string,
	allowNameFallback = true
): string {
	const normalized = extractProtocolId(raw);
	if (entities.find((entity) => entity.id === normalized)) return normalized;
	if (!allowNameFallback) return normalized;

	const normalizedRaw = normalizeLookupValue(raw);
	const normalizedToken = normalizeLookupValue(normalized);
	const matches = entities.filter((entity) => {
		if (!entity.name) return false;
		const entityName = normalizeLookupValue(entity.name);
		return entityName === normalizedRaw || entityName === normalizedToken;
	});

	if (matches.length === 1) {
		console.warn(`[sanitize] resolved ${label} name/token "${raw}" → id "${matches[0].id}"`);
		return matches[0].id;
	}
	if (matches.length > 1) {
		console.warn(`[sanitize] ${label}="${raw}" matched multiple entities by name — left unresolved`);
	}
	return normalized;
}

function resolveObjectiveId(raw: string, objectives: Array<{ id: string; text: string }>, label: string): string {
	const normalized = extractProtocolId(raw);
	if (objectives.find((objective) => objective.id === normalized)) return normalized;

	const normalizedRaw = normalizeLookupValue(raw);
	const normalizedToken = normalizeLookupValue(normalized);
	const matches = objectives.filter((objective) => {
		const text = normalizeLookupValue(objective.text);
		return text === normalizedRaw || text === normalizedToken;
	});

	if (matches.length === 1) {
		console.warn(`[sanitize] resolved ${label} text/token "${raw}" → objectiveId "${matches[0].id}"`);
		return matches[0].id;
	}
	if (matches.length > 1) {
		console.warn(`[sanitize] ${label}="${raw}" matched multiple objectives by text — left unresolved`);
	}
	return normalized;
}

// ---------------------------------------------------------------------------
// Canonical weapon and armor stat maps (used during sanitizeStateChanges)
// ---------------------------------------------------------------------------
function normalizeWeaponKey(s: string): string {
	return s.toLowerCase().replace(/[-_\s]+/g, '');
}

const CANONICAL_WEAPONS: Record<string, { damage: string; damageType: string; properties: string[] }> = {
	dagger:        { damage: '1d4',  damageType: 'piercing',    properties: ['finesse', 'thrown', 'light'] },
	longsword:     { damage: '1d8',  damageType: 'slashing',    properties: ['versatile'] },
	shortsword:    { damage: '1d6',  damageType: 'piercing',    properties: ['finesse', 'light'] },
	greatsword:    { damage: '2d6',  damageType: 'slashing',    properties: ['heavy', 'two-handed'] },
	greataxe:      { damage: '1d12', damageType: 'slashing',    properties: ['heavy', 'two-handed'] },
	handaxe:       { damage: '1d6',  damageType: 'slashing',    properties: ['thrown', 'light'] },
	mace:          { damage: '1d6',  damageType: 'bludgeoning', properties: [] },
	quarterstaff:  { damage: '1d6',  damageType: 'bludgeoning', properties: ['versatile'] },
	rapier:        { damage: '1d8',  damageType: 'piercing',    properties: ['finesse'] },
	spear:         { damage: '1d6',  damageType: 'piercing',    properties: ['thrown', 'versatile'] },
	battleaxe:     { damage: '1d8',  damageType: 'slashing',    properties: ['versatile'] },
	warhammer:     { damage: '1d8',  damageType: 'bludgeoning', properties: ['versatile'] },
	flail:         { damage: '1d8',  damageType: 'bludgeoning', properties: [] },
	glaive:        { damage: '1d10', damageType: 'slashing',    properties: ['heavy', 'reach', 'two-handed'] },
	halberd:       { damage: '1d10', damageType: 'slashing',    properties: ['heavy', 'reach', 'two-handed'] },
};

const CANONICAL_ARMOR: Record<string, { baseAC: number }> = {
	leather:        { baseAC: 11 },
	studdedleather: { baseAC: 12 },
	chainshirt:     { baseAC: 13 },
	scalemail:      { baseAC: 14 },
	breastplate:    { baseAC: 14 },
	halfplate:      { baseAC: 15 },
	ringmail:       { baseAC: 14 },
	chainmail:      { baseAC: 16 },
	splint:         { baseAC: 17 },
	platearmor:     { baseAC: 18 },
	plate:          { baseAC: 18 },
};

/**
 * Validate and sanitize the AI-produced stateChanges.
 * Strips entries with wrong types, logs warnings for each.
 * This runs AFTER parseGMResponse() and BEFORE mergeStateChanges().
 */
export function sanitizeStateChanges(sc: StateChange, state: GameState, narrativeText?: string): StateChange {
	const clean: StateChange = {};
	const locationRefs = [
		...state.locations.map((location) => ({ id: location.id, name: location.name })),
		...collectRefCandidates(sc.locationsAdded)
	];
	const npcRefs = [
		...state.npcs.map((npc) => ({ id: npc.id, name: npc.name })),
		...collectRefCandidates(sc.npcsAdded)
	];
	const questRefs = [
		...state.quests.map((quest) => ({ id: quest.id, name: quest.name })),
		...collectRefCandidates(sc.questsAdded)
	];

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
				// Resolve against characters first, then fall back to encounter combatants + NPCs
				const combatants = state.activeEncounter?.combatants ?? [];
				const allTargets: RefCandidate[] = [...state.characters, ...state.npcs, ...combatants];
				hc.characterId = resolveEntityId(hc.characterId, allTargets, `hpChanges[${i}].characterId`);
				if (typeof hc.newHp !== 'number' || !isFinite(hc.newHp)) {
					console.warn(`[sanitize] hpChanges[${i}].newHp is not a finite number — stripped`);
					return false;
				}
				// Auto-fill oldHp from current state if missing or wrong type
				if (typeof hc.oldHp !== 'number') {
					const char = state.characters.find((c) => c.id === hc.characterId);
					const combatant = combatants.find((c) => c.id === hc.characterId);
					hc.oldHp = char?.hp ?? combatant?.currentHp ?? 0;
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
				// Resolve against characters first, then NPCs
				const charResolved = resolveEntityId(ca.characterId, state.characters, `conditionsApplied[${i}].characterId`);
				if (state.characters.find(c => c.id === charResolved)) {
					ca.characterId = charResolved;
				} else {
					ca.characterId = resolveEntityId(ca.characterId, state.npcs, `conditionsApplied[${i}].characterId`);
				}
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
				xp.characterId = resolveEntityId(xp.characterId, state.characters, `xpAwarded[${i}].characterId`);
				if (typeof xp.amount !== 'number' || !isFinite(xp.amount) || xp.amount < 0) {
					console.warn(`[sanitize] xpAwarded[${i}].amount=${xp.amount} is not a valid positive number — stripped`);
					return false;
				}
				return true;
			});
			if (clean.xpAwarded.length === 0) delete clean.xpAwarded;
		}
	}

	// --- goldChange ---
	if (sc.goldChange) {
		if (!Array.isArray(sc.goldChange)) {
			console.warn('[sanitize] goldChange is not an array — stripped');
		} else {
			clean.goldChange = sc.goldChange.filter((gc, i) => {
				if (!gc || typeof gc !== 'object') {
					console.warn(`[sanitize] goldChange[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof gc.characterId !== 'string' || !gc.characterId) {
					console.warn(`[sanitize] goldChange[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				gc.characterId = resolveEntityId(gc.characterId, state.characters, `goldChange[${i}].characterId`);
				if (typeof gc.delta !== 'number' || !isFinite(gc.delta)) {
					console.warn(`[sanitize] goldChange[${i}].delta=${gc.delta} is not a valid number — stripped`);
					return false;
				}
				if (typeof gc.reason !== 'string' || !gc.reason.trim()) {
					console.warn(`[sanitize] goldChange[${i}].reason is missing — stripped`);
					return false;
				}
				return true;
			});
			if (clean.goldChange.length === 0) delete clean.goldChange;
		}
	}

	// --- locationChange ---
	if (sc.locationChange) {
		if (!sc.locationChange || typeof sc.locationChange !== 'object') {
			console.warn('[sanitize] locationChange is not an object — stripped');
		} else if (typeof sc.locationChange.to !== 'string' || !sc.locationChange.to) {
			console.warn('[sanitize] locationChange.to is not a non-empty string — stripped');
		} else {
			sc.locationChange.to = resolveEntityId(sc.locationChange.to, locationRefs, 'locationChange.to');
			if (typeof sc.locationChange.from === 'string' && sc.locationChange.from) {
				sc.locationChange.from = resolveEntityId(sc.locationChange.from, locationRefs, 'locationChange.from');
			} else if (sc.locationChange.from !== undefined && sc.locationChange.from !== null) {
				console.warn('[sanitize] locationChange.from must be a string or null when provided — stripped');
				(sc.locationChange as { from?: string | null }).from = undefined;
			}
			// Guard: reject self-referencing location changes (from === to after normalization)
			const normalizeLocId = (s: string | undefined | null) => s?.toLowerCase().replace(/^loc-/, '').replace(/[-_ ]/g, '');
			if (normalizeLocId(sc.locationChange.to) === normalizeLocId(sc.locationChange.from ?? state.partyLocationId)) {
				console.warn(`[sanitize] locationChange.to resolves to same location as current — stripped`);
			} else {
				clean.locationChange = sc.locationChange;
			}
		}
	}

	// --- questUpdates ---
	if (sc.questUpdates) {
		if (!Array.isArray(sc.questUpdates)) {
			console.warn('[sanitize] questUpdates is not an array — stripped');
		} else {
			const validQuestFields = new Set(['status', 'objective']);
			const validQuestStatuses = new Set(['available', 'active', 'completed', 'failed']);
			clean.questUpdates = sc.questUpdates.filter((qu, i) => {
				if (!qu || typeof qu !== 'object') {
					console.warn(`[sanitize] questUpdates[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof qu.questId !== 'string' || !qu.questId) {
					console.warn(`[sanitize] questUpdates[${i}].questId is not a non-empty string — stripped`);
					return false;
				}
				qu.questId = resolveEntityId(qu.questId, questRefs, `questUpdates[${i}].questId`);
				if (typeof qu.field !== 'string' || !qu.field) {
					console.warn(`[sanitize] questUpdates[${i}].field is not a non-empty string — stripped`);
					return false;
				}
				if (!validQuestFields.has(qu.field)) {
					console.warn(`[sanitize] questUpdates[${i}].field="${qu.field}" is invalid — stripped`);
					return false;
				}
				const existingQuest = state.quests.find((q) => q.id === qu.questId);
				const objectiveDefs = existingQuest?.objectives ?? sc.questsAdded?.find((q) => q.id === qu.questId)?.objectives ?? [];
				if (qu.field === 'status') {
					if (typeof qu.newValue !== 'string' || !validQuestStatuses.has(qu.newValue)) {
						console.warn(`[sanitize] questUpdates[${i}].newValue="${String(qu.newValue)}" is not a valid quest status — stripped`);
						return false;
					}
					if (qu.oldValue !== undefined && typeof qu.oldValue !== 'string') {
						console.warn(`[sanitize] questUpdates[${i}].oldValue must be a string when field="status" — stripped`);
						return false;
					}
				}
				if (qu.field === 'objective') {
					if (typeof qu.objectiveId !== 'string' || !qu.objectiveId) {
						console.warn(`[sanitize] questUpdates[${i}].objectiveId is not a non-empty string — stripped`);
						return false;
					}
					qu.objectiveId = resolveObjectiveId(qu.objectiveId, objectiveDefs, `questUpdates[${i}].objectiveId`);
					if (!objectiveDefs.find((objective) => objective.id === qu.objectiveId)) {
						console.warn(`[sanitize] questUpdates[${i}].objectiveId="${qu.objectiveId}" is unknown for quest "${qu.questId}" — stripped`);
						return false;
					}
					if (qu.oldValue !== undefined && typeof qu.oldValue !== 'boolean') {
						console.warn(`[sanitize] questUpdates[${i}].oldValue must be a boolean when field="objective" — stripped`);
						return false;
					}
					qu.newValue = !!qu.newValue;
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
			const validNpcFields = new Set(['disposition', 'alive', 'hp', 'notes']);
			clean.npcChanges = sc.npcChanges.filter((nc, i) => {
				if (!nc || typeof nc !== 'object') {
					console.warn(`[sanitize] npcChanges[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof nc.npcId !== 'string' || !nc.npcId) {
					console.warn(`[sanitize] npcChanges[${i}].npcId is not a non-empty string — stripped`);
					return false;
				}
				nc.npcId = resolveEntityId(nc.npcId, npcRefs, `npcChanges[${i}].npcId`);
				if (typeof nc.field !== 'string' || !nc.field) {
					console.warn(`[sanitize] npcChanges[${i}].field is not a non-empty string — stripped`);
					return false;
				}
				if (!validNpcFields.has(nc.field)) {
					console.warn(`[sanitize] npcChanges[${i}].field="${nc.field}" is invalid — stripped`);
					return false;
				}
				if (nc.field === 'disposition' && (typeof nc.newValue !== 'number' || !isFinite(nc.newValue))) {
					console.warn(`[sanitize] npcChanges[${i}].newValue for disposition is invalid — stripped`);
					return false;
				}
				if (nc.field === 'disposition' && nc.oldValue !== undefined && (typeof nc.oldValue !== 'number' || !isFinite(nc.oldValue))) {
					console.warn(`[sanitize] npcChanges[${i}].oldValue for disposition must be a finite number — stripped`);
					return false;
				}
				if (nc.field === 'alive' && typeof nc.newValue !== 'boolean') {
					console.warn(`[sanitize] npcChanges[${i}].newValue for alive must be boolean — stripped`);
					return false;
				}
				if (nc.field === 'alive' && nc.oldValue !== undefined && typeof nc.oldValue !== 'boolean') {
					console.warn(`[sanitize] npcChanges[${i}].oldValue for alive must be boolean — stripped`);
					return false;
				}
				if (nc.field === 'hp' && (typeof nc.newValue !== 'number' || !isFinite(nc.newValue))) {
					console.warn(`[sanitize] npcChanges[${i}].newValue for hp must be a finite number — stripped`);
					return false;
				}
				if (nc.field === 'hp' && nc.oldValue !== undefined && (typeof nc.oldValue !== 'number' || !isFinite(nc.oldValue))) {
					console.warn(`[sanitize] npcChanges[${i}].oldValue for hp must be a finite number — stripped`);
					return false;
				}
				if (nc.field === 'notes') {
					if (typeof nc.newValue !== 'string' || !nc.newValue.trim()) {
						console.warn(`[sanitize] npcChanges[${i}].newValue for notes must be a non-empty string — stripped`);
						return false;
					}
					if (nc.oldValue !== undefined) {
						console.warn(`[sanitize] npcChanges[${i}].oldValue is not used for notes — removed`);
						delete nc.oldValue;
					}
					nc.newValue = nc.newValue.trim();
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
				ig.characterId = resolveEntityId(ig.characterId, state.characters, `itemsGained[${i}].characterId`);
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
				// Consumables must have at least 1 charge — the AI frequently omits or zeros this.
				if (item.category === 'consumable') {
					if (typeof item.charges !== 'number' || (item.charges as number) < 1) item.charges = 1;
					if (typeof item.maxCharges !== 'number' || (item.maxCharges as number) < 1) item.maxCharges = item.charges as number;
				}
				// Ammunition must have an ammoFor array — the AI may omit it entirely.
				if (item.category === 'ammunition') {
					if (!Array.isArray(item.ammoFor)) item.ammoFor = [];
				}
				// Normalize canonical weapon stats (damage, damageType, properties)
				if (item.category === 'weapon' && typeof item.weaponName === 'string') {
					const exactKey = normalizeWeaponKey(item.weaponName as string);
					// Fuzzy fallback: if exact key misses, try each word from last to first.
					// Handles prefixed names like "Finely-crafted Dagger" → "dagger".
					const canonical = CANONICAL_WEAPONS[exactKey] ?? (() => {
						const words = (item.weaponName as string).toLowerCase().split(/[\s\-_,]+/).reverse();
						for (const w of words) { if (CANONICAL_WEAPONS[w]) return CANONICAL_WEAPONS[w]; }
						return undefined;
					})();
					if (canonical) {
						if (item.damage !== canonical.damage) {
							console.warn(`[sanitize] weapon "${item.weaponName as string}" damage normalized ${String(item.damage)} → ${canonical.damage}`);
							item.damage = canonical.damage;
						}
						if (item.damageType !== canonical.damageType) item.damageType = canonical.damageType;
						if (!Array.isArray(item.properties) || (item.properties as string[]).length === 0) {
							item.properties = canonical.properties;
						}
					}
				}
				// Normalize canonical armor baseAC
				if (item.category === 'armor') {
					const exactArmorKey = normalizeWeaponKey(item.name as string);
					// Fuzzy fallback for prefixed names like "Lightweight Leather Armor" → "leather".
					const canonical = CANONICAL_ARMOR[exactArmorKey] ?? (() => {
						const words = (item.name as string).toLowerCase().split(/[\s\-_,]+/).reverse();
						for (const w of words) { if (CANONICAL_ARMOR[w]) return CANONICAL_ARMOR[w]; }
						return undefined;
					})();
					if (canonical && item.baseAC !== canonical.baseAC) {
						console.warn(`[sanitize] armor "${item.name as string}" baseAC normalized ${String(item.baseAC)} → ${canonical.baseAC}`);
						item.baseAC = canonical.baseAC;
					}
				}
				// B4: Dedup — skip if an item with the same name or weaponName already exists in inventory.
				const targetChar = state.characters.find((c) => c.id === ig.characterId);
				if (targetChar) {
					const normName = (s: string) => s.trim().toLowerCase();
					const itemName = normName(item.name as string);
					const itemWeaponName =
						item.category === 'weapon' && typeof item.weaponName === 'string'
							? normName(item.weaponName as string)
							: null;
					const isDuplicate = targetChar.inventory.some((inv) => {
						if (normName(inv.name) === itemName) return true;
						if (itemWeaponName !== null) {
							const wi = inv as unknown as Record<string, unknown>;
							if (typeof wi.weaponName === 'string' && normName(wi.weaponName) === itemWeaponName)
								return true;
						}
						return false;
					});
					if (isDuplicate) {
						console.warn(
							`[sanitize] itemsGained[${i}] "${item.name as string}" already exists in character ${ig.characterId}'s inventory — stripped (B4 dedup)`
						);
						return false;
					}
				}
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
				il.characterId = resolveEntityId(il.characterId, state.characters, `itemsLost[${i}].characterId`);
				if (typeof il.itemId !== 'string' || !il.itemId) {
					console.warn(`[sanitize] itemsLost[${i}].itemId is not a non-empty string — stripped`);
					return false;
				}
				const char = state.characters.find((c) => c.id === il.characterId);
				if (char) {
					il.itemId = resolveEntityId(il.itemId, char.inventory.map((item) => ({ id: item.id, name: item.name })), `itemsLost[${i}].itemId`);
					// Guard: strip if item is not actually in the character's inventory
					if (!char.inventory.some(inv => inv.id === il.itemId)) {
						console.warn(`[sanitize] itemsLost references unknown itemId="${il.itemId}" (not in ${char.name}'s inventory) — stripped`);
						return false;
					}
				}
				if (typeof il.quantity !== 'number' || il.quantity < 1) {
					il.quantity = 1;
				}
				return true;
			});
			if (clean.itemsLost.length === 0) delete clean.itemsLost;
		}
	}

	// --- itemsDropped ---
	if (sc.itemsDropped) {
		if (!Array.isArray(sc.itemsDropped)) {
			console.warn('[sanitize] itemsDropped is not an array — stripped');
		} else {
			clean.itemsDropped = sc.itemsDropped.filter((dr, i) => {
				if (!dr || typeof dr !== 'object') {
					console.warn(`[sanitize] itemsDropped[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof dr.characterId !== 'string' || !dr.characterId) {
					console.warn(`[sanitize] itemsDropped[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				dr.characterId = resolveEntityId(dr.characterId, state.characters, `itemsDropped[${i}].characterId`);
				if (typeof dr.itemId !== 'string' || !dr.itemId) {
					console.warn(`[sanitize] itemsDropped[${i}].itemId is not a non-empty string — stripped`);
					return false;
				}
				const char = state.characters.find((c) => c.id === dr.characterId);
				if (char) {
					dr.itemId = resolveEntityId(dr.itemId, char.inventory.map((item) => ({ id: item.id, name: item.name })), `itemsDropped[${i}].itemId`);
				}
				if (typeof dr.locationId === 'string' && dr.locationId) {
					dr.locationId = resolveEntityId(dr.locationId, locationRefs, `itemsDropped[${i}].locationId`);
				}
				return true;
			});
			if (clean.itemsDropped.length === 0) delete clean.itemsDropped;
		}
	}

	// --- itemsPickedUp ---
	if (sc.itemsPickedUp) {
		if (!Array.isArray(sc.itemsPickedUp)) {
			console.warn('[sanitize] itemsPickedUp is not an array — stripped');
		} else {
			clean.itemsPickedUp = sc.itemsPickedUp.filter((pu, i) => {
				if (!pu || typeof pu !== 'object') {
					console.warn(`[sanitize] itemsPickedUp[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof pu.characterId !== 'string' || !pu.characterId) {
					console.warn(`[sanitize] itemsPickedUp[${i}].characterId is not a non-empty string — stripped`);
					return false;
				}
				pu.characterId = resolveEntityId(pu.characterId, state.characters, `itemsPickedUp[${i}].characterId`);
				if (typeof pu.itemId !== 'string' || !pu.itemId) {
					console.warn(`[sanitize] itemsPickedUp[${i}].itemId is not a non-empty string — stripped`);
					return false;
				}
				if (typeof pu.locationId === 'string' && pu.locationId) {
					pu.locationId = resolveEntityId(pu.locationId, locationRefs, `itemsPickedUp[${i}].locationId`);
				}
				const targetLocId = pu.locationId ?? state.partyLocationId;
				const targetLoc = state.locations.find((location) => location.id === targetLocId);
				if (targetLoc?.groundItems) {
					pu.itemId = resolveEntityId(pu.itemId, targetLoc.groundItems.map((item) => ({ id: item.id, name: item.name })), `itemsPickedUp[${i}].itemId`);
				}
				return true;
			});
			if (clean.itemsPickedUp.length === 0) delete clean.itemsPickedUp;
		}
	}

	// --- locationItemsAdded ---
	if (sc.locationItemsAdded) {
		if (!Array.isArray(sc.locationItemsAdded)) {
			console.warn('[sanitize] locationItemsAdded is not an array — stripped');
		} else {
			clean.locationItemsAdded = sc.locationItemsAdded.filter((la, i) => {
				if (!la || typeof la !== 'object') {
					console.warn(`[sanitize] locationItemsAdded[${i}] is not an object — stripped`);
					return false;
				}
				if (typeof la.locationId !== 'string' || !la.locationId) {
					console.warn(`[sanitize] locationItemsAdded[${i}].locationId is not a non-empty string — stripped`);
					return false;
				}
				la.locationId = resolveEntityId(la.locationId, locationRefs, `locationItemsAdded[${i}].locationId`);
				if (!la.item || typeof la.item !== 'object') {
					console.warn(`[sanitize] locationItemsAdded[${i}].item is not an object — stripped`);
					return false;
				}
				const item = la.item as unknown as Record<string, unknown>;
				if (typeof item.id !== 'string' || !item.id) item.id = `item-loc-${Date.now()}-${i}`;
				if (typeof item.name !== 'string' || !item.name) {
					console.warn(`[sanitize] locationItemsAdded[${i}].item.name is missing — stripped`);
					return false;
				}
				if (typeof item.category !== 'string') item.category = 'misc';
				if (typeof item.description !== 'string') item.description = item.name as string;
				if (typeof item.value !== 'number') item.value = 0;
				if (typeof item.quantity !== 'number' || (item.quantity as number) < 1) item.quantity = 1;
				if (typeof item.weight !== 'number') item.weight = 0;
				if (typeof item.rarity !== 'string') item.rarity = 'common';
				if (typeof item.attunement !== 'boolean') item.attunement = false;
				return true;
			});
			if (clean.locationItemsAdded.length === 0) delete clean.locationItemsAdded;
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
					// Guard: reject quest-givers, merchants, allies, and companions from hostile
					// encounters. Prevents the AI from recycling a friendly NPC's id as a combatant
					// (e.g., reusing Captain Arlen's id as an enemy commander).
					const existingNpc = state.npcs.find(n => n.id === cr.id);
					if (existingNpc && (
						existingNpc.role === 'quest-giver' ||
						existingNpc.role === 'merchant' ||
						existingNpc.role === 'ally' ||
						existingNpc.role === 'companion' ||
						existingNpc.disposition >= 0
					)) {
						console.warn(`[sanitize] encounterStarted.creatures[${i}] id="${cr.id}" matches friendly NPC "${existingNpc.name}" (role: ${existingNpc.role}) — stripped to protect quest-giver`);
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

				// If both encounterStarted AND encounterEnded in same response,
				// strip encounterEnded — encounterStarted takes priority.
				if (sc.encounterEnded) {
					console.warn('[sanitize] encounterStarted + encounterEnded in same response — encounterEnded stripped (encounters should span multiple turns)');
				}

				// Guard: empty creatures array is never valid — an encounter with no combatants
				// breaks the entire encounter system downstream.
				if (validCreatures.length === 0) {
					console.warn('[sanitize] encounterStarted.creatures is empty (0 valid entries) — stripped');
					// fall through: neither branch below sets clean.encounterStarted
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

	// --- encounterEnded (only if no encounterStarted in same response) ---
	if (sc.encounterEnded && !sc.encounterStarted) {
		if (typeof sc.encounterEnded === 'object' && sc.encounterEnded) {
			const proposedOutcome = sc.encounterEnded.outcome ?? 'victory';
			if (proposedOutcome === 'victory' && state.activeEncounter) {
				// Reject premature victory: if any NPC combatant still has HP > 0 and is not
				// marked defeated, the AI is declaring victory too early. Strip the field and
				// let the auto-close logic in persistResolvedTurnAndState handle it once HP
				// changes are actually applied.
				const hasLivingEnemies = state.activeEncounter.combatants.some(
					(c) => c.type === 'npc' && !c.defeated && (c.currentHp ?? 1) > 0
				);
				if (hasLivingEnemies) {
					console.warn(
						'[sanitize] encounterEnded: victory rejected — living NPC combatants still present; auto-close will handle it'
					);
				} else {
					clean.encounterEnded = sc.encounterEnded;
				}
			} else {
				clean.encounterEnded = sc.encounterEnded;
			}
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
				if (typeof npc.id !== 'string' || !npc.id || /^npc-<|<unique>|<.*>/.test(npc.id)) npc.id = `npc-${ulid()}`;
				if (typeof npc.name !== 'string' || !npc.name) {
					console.warn(`[sanitize] npcsAdded[${i}].name is missing — stripped`);
					return false;
				}
				if (typeof npc.role !== 'string' || !validRoles.has(npc.role)) {
					npc.role = 'neutral' as NpcRole;
				}
				if (typeof npc.locationId !== 'string') {
					npc.locationId = state.partyLocationId ?? '';
				} else if (npc.locationId) {
					npc.locationId = resolveEntityId(npc.locationId, locationRefs, `npcsAdded[${i}].locationId`);
				}
				if (typeof npc.disposition !== 'number') npc.disposition = 0;
				if (typeof npc.description !== 'string') npc.description = npc.name;
				// Reject duplicate: same name (case-insensitive) at the same location
				if (state.npcs.some(n =>
					n.alive !== false &&
					n.name.toLowerCase() === npc.name.toLowerCase() &&
					n.locationId === npc.locationId
				)) {
					console.warn(`[sanitize] npcsAdded[${i}] NPC "${npc.name}" already exists at location "${npc.locationId}" — stripped`);
					return false;
				}
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
				if (!Array.isArray(loc.connections)) {
					loc.connections = [];
				} else {
					loc.connections = loc.connections
						.filter((connectionId): connectionId is string => typeof connectionId === 'string' && !!connectionId)
						.map((connectionId) => resolveEntityId(connectionId, locationRefs, `locationsAdded[${i}].connections[]`));
				}
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
				// Sanitize status — only 'available' and 'active' are permitted on new quests
				if (q.status !== undefined && q.status !== 'available' && q.status !== 'active') {
					console.warn(`[sanitize] questsAdded[${i}] "${q.name}" has invalid status="${q.status}" — forcing available`);
					q.status = 'available';
				}
				if (typeof q.giverNpcId === 'string' && q.giverNpcId) {
					q.giverNpcId = resolveEntityId(q.giverNpcId, npcRefs, `questsAdded[${i}].giverNpcId`);
					// Validate resolved giverNpcId exists (or is being added in this same response)
					if (!state.npcs.some(n => n.id === q.giverNpcId) && !sc.npcsAdded?.some(n => n.id === q.giverNpcId)) {
						console.warn(`[sanitize] questsAdded[${i}] "${q.name}" giverNpcId="${q.giverNpcId}" not found in state — set to null`);
						q.giverNpcId = null;
					}
				}
					if (!Array.isArray(q.objectives)) q.objectives = [];
				// Enforce at least one objective — zero-objective quests can never auto-complete
				if (q.objectives.length === 0) {
					console.warn(`[sanitize] questsAdded[${i}] "${q.name}" has no objectives — injecting default`);
					q.objectives.push({ id: `obj-${q.id}-1`, text: `Complete: ${q.name}` });
				}
				// Duplicate quest guard: reject if same giver already has a quest with high
				// name/description word-overlap (prevents near-identical quests from same NPC).
				if (q.giverNpcId) {
					const STOP_WORDS = new Set(['the','a','an','of','in','for','to','and','or','from','with']);
					const sigWords = (str: string): string[] =>
						str.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
					const qWords = new Set(sigWords(`${q.name} ${q.description ?? ''}`));
					const isDuplicate = state.quests.some(existing =>
						existing.giverNpcId === q.giverNpcId &&
						sigWords(`${existing.name} ${existing.description ?? ''}`).filter(w => qWords.has(w)).length >= 2
					);
					if (isDuplicate) {
						console.warn(`[sanitize] questsAdded[${i}] "${q.name}" duplicates existing quest from same giver — stripped`);
						return false;
					}
				}
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
	if (sc.companionPromoted) {
		// Normalize: accept a single object { npcId } or an array [{ npcId }, ...]
		const rawPromoted = Array.isArray(sc.companionPromoted) ? sc.companionPromoted : [sc.companionPromoted];
		const validPromoted: Array<{ npcId: string; statBlock?: unknown }> = [];
		for (let pi = 0; pi < rawPromoted.length; pi++) {
			const entry = rawPromoted[pi];
			if (typeof entry === 'object' && entry && typeof entry.npcId === 'string' && entry.npcId) {
				entry.npcId = resolveEntityId(entry.npcId, npcRefs, `companionPromoted[${pi}].npcId`);
				// If statBlock is missing or not a valid object, null it for auto-generation in the applier
				if (!entry.statBlock || typeof entry.statBlock !== 'object') {
					entry.statBlock = null;
					console.log(`[sanitize] companionPromoted[${pi}] without statBlock — will auto-generate in applier`);
				}
				validPromoted.push(entry);
			} else {
				console.warn(`[sanitize] companionPromoted[${pi}] missing npcId — stripped`);
			}
		}
		if (validPromoted.length > 0) {
			clean.companionPromoted = validPromoted as typeof clean.companionPromoted;
		}
	}

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

	if (clean.encounterStarted?.creatures) {
		clean.encounterStarted.creatures = clean.encounterStarted.creatures.map((cr) => {
			if (typeof cr.locationId === 'string' && cr.locationId) {
				cr.locationId = resolveEntityId(cr.locationId, locationRefs, `encounterStarted.creatures[${cr.id}].locationId`, false);
			}
			return cr;
		});
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
	currentState: GameState | null,
	debugData?: TurnDebugData | null,
	encounterClassification?: EncounterClassification | null
): Promise<void> {
	const state = currentState ?? await loadGameState(payload.adventureId);
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

	// Apply engine-authoritative character updates (from turn-executor) BEFORE
	// applyGMStateChanges so that XP awards, condition changes, and encounter
	// resolution written into state.characters by applyGMStateChanges are not
	// overwritten by the pre-capture snapshot from resolveTurn.
	if (resolvedTurn.updatedCharacters) {
		state.characters = resolvedTurn.updatedCharacters;
	}

	// Apply structured state changes from the GM
	const enrichmentIntents = applyGMStateChanges(state, resolvedTurn.stateChanges, turnNumber);

	// ---------------------------------------------------------------------------
	// Surprise Damage Resolution
	// If the encounter classifier detected a surprise/ambush with pre-combat
	// damage, resolve it now against the newly created combatants.
	// ---------------------------------------------------------------------------
	if (encounterClassification?.isSurprise && encounterClassification.preRoundDamage.length > 0 && state.activeEncounter) {
		// Build a combatant map for fuzzy name matching
		const combatantMap = new Map<string, { id: string; name: string; type: 'pc' | 'npc' }>();
		for (const c of state.activeEncounter.combatants) {
			const combatantType: 'pc' | 'npc' = c.type === 'character' ? 'pc' : 'npc';
			combatantMap.set(c.name.toLowerCase(), { id: c.id, name: c.name, type: combatantType });
		}
		// Also add character names for PC matching
		for (const ch of state.characters) {
			combatantMap.set(ch.name.toLowerCase(), { id: ch.id, name: ch.name, type: 'pc' });
		}

		const surpriseDamage = resolveSurpriseDamage(encounterClassification.preRoundDamage, combatantMap);
		for (const dmg of surpriseDamage) {
			// Apply to combatant
			const combatant = state.activeEncounter.combatants.find((c) =>
				c.id === dmg.targetId || c.referenceId === dmg.targetId
			);
			if (combatant) {
				combatant.currentHp = Math.max(0, combatant.currentHp - dmg.damageRoll);
				if (combatant.currentHp === 0) combatant.defeated = true;
				console.log(`[surprise] ${dmg.attackerDescription} dealt ${dmg.damageRoll} ${dmg.damageType} to ${dmg.targetName} (${dmg.diceExpression})`);
			}
			// Also apply to the authoritative source (character HP or NPC statBlock)
			const character = state.characters.find((c) => c.id === dmg.targetId);
			if (character) {
				character.hp = Math.max(0, character.hp - dmg.damageRoll);
			} else {
				const npc = state.npcs.find((n) => n.id === dmg.targetId);
				if (npc?.statBlock) {
					npc.statBlock.hp = Math.max(0, npc.statBlock.hp - dmg.damageRoll);
					if (npc.statBlock.hp === 0) npc.alive = false;
				}
			}

			// Record as a mechanic result for the turn log
			turn.mechanicResults.push({
				type: 'damage',
				label: `Surprise: ${dmg.attackerDescription} → ${dmg.targetName}`,
				dice: { notation: dmg.diceExpression, rolls: [], total: dmg.damageRoll },
				success: true
			});
		}
	}

	// After a round-complete narration, clear the accumulated round actions so the
	// next round starts fresh. roundComplete===true means the AI just narrated the whole round.
	if (resolvedTurn.roundComplete === true && state.activeEncounter) {
		state.activeEncounter.roundActions = [];
	}

	// Sync combatant snapshots from the authoritative character/NPC data so that
	// currentHp, conditions, defeated flags are consistent before we save.
	if (state.activeEncounter) {
		syncCombatantsFromState(state, state.activeEncounter);
	}

	// Auto-close encounter if all enemies are defeated but the GM forgot to emit encounterEnded.
	// Handles full-gm-2pass turns where the AI narrated a victory without including encounterEnded
	// in the state-extraction JSON. Must run AFTER syncCombatantsFromState (so defeated flags are fresh)
	// and AFTER applyGMStateChanges (so a GM-supplied encounterEnded is not double-processed).
	if (state.activeEncounter && !resolvedTurn.stateChanges.encounterEnded) {
		if (allDefeated(state, state.activeEncounter, 'npc')) {
			console.log('[autoClose] All enemies defeated — auto-closing encounter as victory');

			// Mirror the victory path in applyGMStateChanges: mark all non-companion enemy NPCs
			// as dead and record each change so the turn log has an accurate audit trail.
			for (const combatant of state.activeEncounter.combatants) {
				if (combatant.type === 'npc') {
					const npc = state.npcs.find((n) => n.id === combatant.referenceId);
					if (npc && npc.role !== 'companion') {
						combatant.defeated = true;
						if (npc.alive !== false) {
							npc.alive = false;
							if (npc.statBlock) npc.statBlock.hp = 0;
							if (npc.conditions?.length) npc.conditions = [];
							if (!resolvedTurn.stateChanges.npcChanges) resolvedTurn.stateChanges.npcChanges = [];
							resolvedTurn.stateChanges.npcChanges.push({ npcId: npc.id, field: 'alive', oldValue: true, newValue: false });
						}
					}
				}
			}

			// Compute XP awards via the encounter resolver
			const encounterNpcIds = state.activeEncounter.combatants
				.filter((c) => c.type === 'npc')
				.map((c) => c.referenceId);
			const encounterNpcs = state.npcs.filter((n) => encounterNpcIds.includes(n.id));
			const partySize = state.characters.length;
			const resolution = resolveEncounter(state, state.activeEncounter, 'victory', encounterNpcs, partySize);

			// Apply XP to characters and surface awards in the turn record
			if (resolution.stateChange.xpAwarded) {
				for (const award of resolution.stateChange.xpAwarded) {
					const char = state.characters.find((c) => c.id === award.characterId);
					if (char) char.xp += award.amount;
				}
				if (!resolvedTurn.stateChanges.xpAwarded) resolvedTurn.stateChanges.xpAwarded = [];
				resolvedTurn.stateChanges.xpAwarded.push(...resolution.stateChange.xpAwarded);
			}

			// Emit encounterEnded so it appears in the persisted turn record
			resolvedTurn.stateChanges.encounterEnded = { outcome: 'victory' };

			// Auto-advance clock: 1 period per 3 rounds, minimum 1
			const combatRounds = state.activeEncounter.round ?? 1;
			const combatPeriods = Math.max(1, Math.floor(combatRounds / 3));
			const combatClock = advanceClockOnState(state, combatPeriods);
			if (!resolvedTurn.stateChanges.clockAdvance) resolvedTurn.stateChanges.clockAdvance = combatClock.clockAdvance;

			// Rage ends when combat ends — clear raging condition from all characters
			for (const char of state.characters) {
				char.conditions = char.conditions.filter(c => c !== 'raging');
			}
			state.activeEncounter = undefined;
		}
	}

	// Trigger periodic world reaction every 5 turns
	if (turnNumber > 0 && turnNumber % 5 === 0) {
		enrichmentIntents.push({ type: 'react-to-party' });
	}

	// Update lastInteractionTurn for NPCs mentioned by name in the narrative.
	// Scoped to NPCs at the party's current location — prevents distant NPCs
	// that are merely referenced in lore or backstory from getting their
	// interaction timestamp bumped incorrectly (fixes BUG-13).
	if (narrativeText) {
		const narrativeLower = narrativeText.toLowerCase();
		// Collect NPCs already updated this turn via state changes (don't double-touch).
		const alreadyUpdatedThisTurn = new Set<string>(
			state.npcs.filter((n) => n.lastInteractionTurn === turnNumber).map((n) => n.id)
		);
		for (const npc of state.npcs) {
			if (alreadyUpdatedThisTurn.has(npc.id)) continue;
			// Only update NPCs physically present at the party's location.
			if (npc.locationId !== state.partyLocationId) continue;
			const nameLower = npc.name.toLowerCase();
			const firstName = npc.name.split(/\s+/)[0].toLowerCase();
			if (narrativeLower.includes(nameLower) || (firstName.length >= 3 && narrativeLower.includes(firstName))) {
				npc.lastInteractionTurn = turnNumber;
			}
		}
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
			// Fill flat stat blocks for hostile/boss NPCs so encounter combatants get meaningful stats
			if ((npc.role === 'hostile' || npc.role === 'boss') && isStatBlockFlat(npcData.statBlock)) {
				const tier: CreatureTier = npc.role === 'boss' ? 'boss' : 'normal';
				npc.statBlock = generateCreatureStatBlock(npc.name, tier, averagePartyLevel(state.characters));
			} else if (npcData.statBlock) {
				npc.statBlock = npcData.statBlock;
			}
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
				groundItems: locData.groundItems ?? [],
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
			const enrichedRewards = (qData as Record<string, unknown>).rewards as { xp?: number; gold?: number } | undefined;
			const quest: Quest = {
				id: qData.id,
				name: qData.name,
				description: qData.description,
				giverNpcId: qData.giverNpcId ?? null,
				status: (qData as Record<string, unknown>).status === 'active' ? 'active' : 'available',
				objectives: qData.objectives.map((o) => ({
					id: o.id,
					text: o.text,
					done: false,
					type: (o as Record<string, unknown>).type as Quest['objectives'][0]['type'],
					linkedEntityId: (o as Record<string, unknown>).linkedEntityId as string | undefined,
					linkedEntityName: (o as Record<string, unknown>).linkedEntityName as string | undefined
				})),
				rewards: {
					xp: enrichedRewards?.xp ?? 0,
					gold: enrichedRewards?.gold ?? 0,
					items: [],
					reputationChanges: qData.giverNpcId ? [{ npcId: qData.giverNpcId, delta: 10 }] : []
				},
				recommendedLevel: qData.recommendedLevel ?? 1,
				encounterTemplates: [],
				failureConsequence: qData.failureConsequence,
				deadline: qData.deadline,
				followUpQuestIds: qData.followUpQuestIds,
				prerequisiteQuestIds: qData.prerequisiteQuestIds
			};
			// BUG-02/15 guard: if the AI emitted empty rewards ({xp:0,gold:0}), apply a
			// level-appropriate XP floor so distributeQuestRewards always has something to
			// distribute when the quest completes.
			if (quest.rewards.xp === 0 && quest.rewards.gold === 0) {
				quest.rewards.xp = Math.max(50, (quest.recommendedLevel ?? 1) * 100);
				console.warn(`[questsAdded] "${quest.name}" had empty rewards (xp=0,gold=0) — auto-set xp=${quest.rewards.xp}`);
			}
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
				// Auto-clear unconscious when character is restored to positive HP.
				if (char.hp > 0 && char.conditions.includes('unconscious')) {
					char.conditions = char.conditions.filter(c => c !== 'unconscious');
				}
			} else {
				// May be an encounter combatant (NPC). Update combatant HP directly.
				const combatant = state.activeEncounter?.combatants.find((c) => c.id === hc.characterId);
				if (combatant) {
					combatant.currentHp = Math.max(0, Math.min(hc.newHp, combatant.maxHp));
					const defeated = combatant.currentHp === 0;
					if (defeated) combatant.defeated = true;
					// Write through to NPC statBlock so getCombatantState() sees
					// the updated HP on the next turn (it reads npc.statBlock.hp).
					const npc = state.npcs.find((n) => n.id === combatant.referenceId || n.id === combatant.id);
					if (npc) {
						if (npc.statBlock) npc.statBlock.hp = combatant.currentHp;
						if (defeated) {
							npc.alive = false;
							if (npc.conditions?.length) npc.conditions = [];
						}
					}
				} else {
					console.warn(`[applyGMStateChanges] hpChange references unknown characterId="${hc.characterId}" — skipped`);
				}
			}
		}
	}

	// Conditions (validate characterId — applies to both PCs and NPCs)
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
				const npc = state.npcs.find((n) => n.id === ca.characterId);
				if (npc) {
					if (!npc.conditions) npc.conditions = [];
					if (ca.applied && !npc.conditions.includes(ca.condition)) {
						npc.conditions.push(ca.condition);
					} else if (!ca.applied) {
						npc.conditions = npc.conditions.filter((c) => c !== ca.condition);
					}
				} else {
					console.warn(`[applyGMStateChanges] conditionsApplied references unknown characterId="${ca.characterId}" — skipped`);
				}
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

	// Gold changes (validate characterId, clamp to ≥0)
	if (changes.goldChange) {
		for (const gc of changes.goldChange) {
			const char = state.characters.find((c) => c.id === gc.characterId);
			if (char) {
				char.gold = Math.max(0, char.gold + gc.delta);
			} else {
				console.warn(`[applyGMStateChanges] goldChange references unknown characterId="${gc.characterId}" — skipped`);
			}
		}
	}

	// Location change (validate that the target location exists — now including
	// locations that were just added above in Phase A)
	if (changes.locationChange) {
		if (changes.locationChange.from !== undefined && changes.locationChange.from !== state.partyLocationId) {
			console.warn(`[applyGMStateChanges] locationChange.from="${changes.locationChange.from}" does not match current partyLocationId="${state.partyLocationId}" — skipped`);
		} else {
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

			// Auto-advance clock: travel takes 1 time period
			const travelClock = advanceClockOnState(state, 1);
			if (!changes.clockAdvance) changes.clockAdvance = travelClock.clockAdvance;

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
				if (qu.oldValue !== undefined && qu.oldValue !== quest.status) {
					console.warn(`[applyGMStateChanges] questUpdate oldValue mismatch for questId="${qu.questId}" field="status" — skipped`);
					continue;
				}
				const previousStatus = quest.status;
				quest.status = qu.newValue as typeof quest.status;

				// Store how the quest was resolved
				if (qu.completionMethod) {
					quest.completionMethod = qu.completionMethod;
				}

				// Quest reward auto-distribution on manual completion
				if (previousStatus !== 'completed' && quest.status === 'completed') {
					distributeQuestRewards(state, quest, changes);
					// Activate follow-up quests
					if (quest.followUpQuestIds) {
						for (const fid of quest.followUpQuestIds) {
							const followUp = state.quests.find((q) => q.id === fid);
							if (followUp && followUp.status === 'available') {
								// Already available; eligibility is correct
							} else if (followUp && followUp.status !== 'active' && followUp.status !== 'completed') {
								followUp.status = 'available';
							}
						}
					}
				}

				// Emit failure scene fact so world state reflects consequence
				if (previousStatus !== 'failed' && quest.status === 'failed') {
					if (quest.failureConsequence) {
						if (!changes.sceneFactsAdded) changes.sceneFactsAdded = [];
						changes.sceneFactsAdded.push(`Quest "${quest.name}" failed: ${quest.failureConsequence}`);
					}
				}
			} else if (qu.field === 'objective' && qu.objectiveId) {
				const obj = quest.objectives.find((o) => o.id === qu.objectiveId);
				if (!obj) {
					continue;
				}
				if (qu.oldValue !== undefined && qu.oldValue !== obj.done) {
					console.warn(`[applyGMStateChanges] questUpdate oldValue mismatch for questId="${qu.questId}" objectiveId="${qu.objectiveId}" — skipped`);
					continue;
				}
				if (obj) {
					obj.done = !!qu.newValue;
				}
				// Auto-complete quest if all objectives are done
				if (quest.status !== 'completed' && quest.objectives.length > 0 && quest.objectives.every((o) => o.done)) {
					quest.status = 'completed';
					// Distribute quest rewards to all party characters
					distributeQuestRewards(state, quest, changes);
					// Activate follow-up quests
					if (quest.followUpQuestIds) {
						for (const fid of quest.followUpQuestIds) {
							const followUp = state.quests.find((q) => q.id === fid);
							if (followUp && followUp.status !== 'active' && followUp.status !== 'completed') {
								followUp.status = 'available';
							}
						}
					}
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
			if (nc.field === 'disposition' && nc.oldValue !== undefined && npc.disposition !== nc.oldValue) {
				console.warn(`[applyGMStateChanges] npcChange oldValue mismatch for npcId="${nc.npcId}" field="disposition" — skipped`);
				continue;
			}
			if (nc.field === 'alive' && nc.oldValue !== undefined && npc.alive !== nc.oldValue) {
				console.warn(`[applyGMStateChanges] npcChange oldValue mismatch for npcId="${nc.npcId}" field="alive" — skipped`);
				continue;
			}
			if (nc.field === 'hp' && nc.oldValue !== undefined && npc.statBlock && npc.statBlock.hp !== nc.oldValue) {
				console.warn(`[applyGMStateChanges] npcChange oldValue mismatch for npcId="${nc.npcId}" field="hp" — skipped`);
				continue;
			}
			// Track interaction timestamp
			npc.lastInteractionTurn = turnNumber;

			if (nc.field === 'disposition' && typeof nc.newValue === 'number') {
				npc.disposition = Math.max(-100, Math.min(100, nc.newValue));
			}
			if (nc.field === 'alive' && typeof nc.newValue === 'boolean') {
				npc.alive = nc.newValue;
				// When killing an NPC, also zero out statBlock.hp and clear conditions.
				if (!nc.newValue) {
					if (npc.statBlock) npc.statBlock.hp = 0;
					npc.conditions = [];
				}
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

	// Feature uses (Rage, Channel Divinity, Bardic Inspiration, etc.)
	if (changes.featureUsed) {
		const char = state.characters.find(c => c.id === changes.featureUsed!.characterId);
		if (char?.featureUses) {
			const entry = char.featureUses[changes.featureUsed.feature];
			if (entry && entry.current > 0) entry.current--;
		}
		// When Rage activates, enter the raging condition so downstream mechanics fire
		// (rage damage bonus in resolveAttack, resistance in turn-executor).
		if (changes.featureUsed.feature === 'Rage' && char && !char.conditions.includes('raging')) {
			char.conditions.push('raging');
		}
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

	// Items dropped — move item from inventory to location ground (preserves original id + stats)
	if (changes.itemsDropped) {
		for (const dr of changes.itemsDropped) {
			const char = state.characters.find((c) => c.id === dr.characterId);
			if (!char) {
				console.warn(`[applyGMStateChanges] itemsDropped references unknown characterId="${dr.characterId}" — skipped`);
				continue;
			}
			const idx = char.inventory.findIndex((i) => i.id === dr.itemId);
			if (idx === -1) {
				console.warn(`[applyGMStateChanges] itemsDropped references unknown itemId="${dr.itemId}" for character "${char.name}" — skipped`);
				continue;
			}
			const item = char.inventory.splice(idx, 1)[0];
			const targetLocId = dr.locationId ?? state.partyLocationId;
			const targetLoc = state.locations.find((l) => l.id === targetLocId);
			if (targetLoc) {
				if (!targetLoc.groundItems) targetLoc.groundItems = [];
				targetLoc.groundItems.push(item);
			} else {
				console.warn(`[applyGMStateChanges] itemsDropped: locationId="${targetLocId}" not found — item lost`);
			}
		}
	}

	// Items picked up — move item from location ground to character inventory (restores original id + stats)
	if (changes.itemsPickedUp) {
		for (const pu of changes.itemsPickedUp) {
			const char = state.characters.find((c) => c.id === pu.characterId);
			if (!char) {
				console.warn(`[applyGMStateChanges] itemsPickedUp references unknown characterId="${pu.characterId}" — skipped`);
				continue;
			}
			const targetLocId = pu.locationId ?? state.partyLocationId;
			const targetLoc = state.locations.find((l) => l.id === targetLocId);
			if (!targetLoc || !targetLoc.groundItems) {
				console.warn(`[applyGMStateChanges] itemsPickedUp: no ground items at locationId="${targetLocId}" — skipped`);
				continue;
			}
			const groundIdx = targetLoc.groundItems.findIndex((i) => i.id === pu.itemId);
			if (groundIdx === -1) {
				console.warn(`[applyGMStateChanges] itemsPickedUp: itemId="${pu.itemId}" not found on ground at "${targetLoc.name}" — skipped`);
				continue;
			}
			const item = targetLoc.groundItems.splice(groundIdx, 1)[0];
			const existing = char.inventory.find((i) => i.id === item.id);
			if (existing) {
				existing.quantity = (existing.quantity ?? 1) + (item.quantity ?? 1);
			} else {
				char.inventory.push(item);
			}
		}
	}

	// Location items added — place items at an existing location (mid-game loot seeding)
	if (changes.locationItemsAdded) {
		for (const la of changes.locationItemsAdded) {
			const loc = state.locations.find((l) => l.id === la.locationId);
			if (!loc) {
				console.warn(`[applyGMStateChanges] locationItemsAdded references unknown locationId="${la.locationId}" — skipped`);
				continue;
			}
			if (!loc.groundItems) loc.groundItems = [];
			loc.groundItems.push(la.item);
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

	// Companion promotion — promote existing NPCs to companion role with stat blocks
	if (changes.companionPromoted) {
		for (const promoted of changes.companionPromoted) {
			const { npcId, statBlock } = promoted;
			const npc = state.npcs.find((n) => n.id === npcId);
			if (npc) {
				npc.role = 'companion';
				// If the AI provided a valid stat block, use it; otherwise auto-generate at 'weak' tier
				if (statBlock && typeof statBlock === 'object' && typeof statBlock.hp === 'number' && statBlock.hp > 0) {
					npc.statBlock = { ...statBlock };
				} else {
					const partyLevel = averagePartyLevel(state.characters);
					// Use name + description for keyword matching (e.g. "cleric" → Mace + Sacred Flame)
					const nameHint = npc.description ? `${npc.name} ${npc.description}` : npc.name;
					npc.statBlock = generateCreatureStatBlock(nameHint, 'weak', partyLevel);
					console.log(`[applyGMStateChanges] companionPromoted auto-generated 'weak' stat block for "${npc.name}" (party level ${partyLevel})`);
				}
				npc.lastInteractionTurn = turnNumber;
				// Companions travel with the party — sync location
				if (state.partyLocationId) {
					npc.locationId = state.partyLocationId;
				}
			} else {
				console.warn(`[applyGMStateChanges] companionPromoted references unknown npcId="${npcId}" — skipped`);
			}
		}
	}

	// Encounter started — generate stat blocks, add NPCs, call createEncounter()
	if (changes.encounterStarted) {
		const creatures = changes.encounterStarted.creatures ?? [];
		const partyLevel = averagePartyLevel(state.characters);

		// Also add the creatures as NPCs if they don't already exist, and attach stat blocks
		for (const cr of creatures) {
			const creatureLocationId = cr.locationId ?? state.partyLocationId ?? '';
			// Generate a stat block from tier + party level
			const tier = parseCreatureTier(cr.tier);
			const statBlock = generateCreatureStatBlock(cr.name, tier, partyLevel);

			if (cr.id && !state.npcs.some((n) => n.id === cr.id)) {
				state.npcs.push({
					id: cr.id,
					name: cr.name,
					role: cr.role ?? 'hostile',
					locationId: creatureLocationId,
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
					existing.locationId = creatureLocationId;
					if (!existing.statBlock) existing.statBlock = statBlock;
				}
			}
		}

		// Gather fully-populated NPC objects for hostile creatures
		// Exclude NPCs that are already dead (e.g. killed by npcChanges in the same turn)
		const hostileNpcs = creatures
			.map((cr) => state.npcs.find((n) => n.id === cr.id))
			.filter((n): n is NPC => !!n && !!n.statBlock && n.alive !== false);

		// Also include companion NPCs at the party's location (role === 'companion' only).
		// Allies (role === 'ally') must be explicitly listed in encounterStarted.creatures to join.
		const companionNpcs = state.npcs.filter(
			(n) => n.alive && n.role === 'companion' && n.locationId === state.partyLocationId && n.statBlock
		);

		// Use the combat engine to roll initiative and build the encounter.
		// Guard: skip creation if there are no combatants — an empty encounter
		// would leave state.activeEncounter set with no enemies to fight.
		const allCombatCreatures = [...hostileNpcs, ...companionNpcs];
		if (allCombatCreatures.length === 0) {
			console.warn('[applyGMStateChanges] encounterStarted produced no valid combatants — encounter creation skipped');
		} else {
			const { encounter } = createEncounter(state, allCombatCreatures);
			initEncounterTurnOrder(state, encounter, state.npcs);
			state.activeEncounter = encounter;
		}
	}

	// Encounter ended — resolve XP and clear the active encounter
	if (changes.encounterEnded && state.activeEncounter) {
		const outcome = changes.encounterEnded.outcome ?? 'victory';

		// Gather NPC references for XP calculation
		const encounterNpcIds = state.activeEncounter.combatants
			.filter((c) => c.type === 'npc')
			.map((c) => c.referenceId);
		const encounterNpcs = state.npcs.filter((n) => encounterNpcIds.includes(n.id));

		// Mark all enemy combatants as defeated on victory and record NPC deaths
		if (outcome === 'victory') {
			for (const combatant of state.activeEncounter.combatants) {
				if (combatant.type === 'npc') {
					const npc = state.npcs.find((n) => n.id === combatant.referenceId);
					if (npc && npc.role !== 'companion') {
						combatant.defeated = true;
						// Mark NPC as dead and surface in turn record for audit trail
						if (npc.alive !== false) {
							npc.alive = false;
							if (npc.statBlock) npc.statBlock.hp = 0;
							if (npc.conditions?.length) npc.conditions = [];
							if (!changes.npcChanges) changes.npcChanges = [];
							changes.npcChanges.push({ npcId: npc.id, field: 'alive', oldValue: true, newValue: false });
						}
					}
				}
			}
		}

		const partySize = state.characters.length;
		const resolution = resolveEncounter(state, state.activeEncounter, outcome, encounterNpcs, partySize);

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
		// Auto-advance clock: combat takes time (1 period per 3 rounds, minimum 1)
		const combatRounds = state.activeEncounter?.round ?? 1;
		const combatPeriods = Math.max(1, Math.floor(combatRounds / 3));
		const combatClock = advanceClockOnState(state, combatPeriods);
		if (!changes.clockAdvance) changes.clockAdvance = combatClock.clockAdvance;

		// Rage ends when combat ends — clear raging condition from all characters
		for (const char of state.characters) {
			char.conditions = char.conditions.filter(c => c !== 'raging');
		}
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
	// Auto-generate stat blocks for companions/allies that lack them
	// -----------------------------------------------------------------------
	// This is a defensive sweep: any NPC with role 'companion' (auto-joins combat)
	// should always have a stat block. If one is missing (e.g. role was set via
	// npcChanges instead of companionPromoted), generate at 'weak' tier.
	{
		const partyLevel = averagePartyLevel(state.characters);
		for (const npc of state.npcs) {
			if (npc.alive && !npc.archived && npc.role === 'companion' && !npc.statBlock) {
				// Use name + description for keyword matching (e.g. "ranger" → Longbow + Shortsword)
				const nameHint = npc.description ? `${npc.name} ${npc.description}` : npc.name;
				npc.statBlock = generateCreatureStatBlock(nameHint, 'weak', partyLevel);
				console.log(`[applyGMStateChanges] auto-generated 'weak' stat block for companion "${npc.name}" (party level ${partyLevel})`);
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

	// -----------------------------------------------------------------------
	// Deterministic objective tracking — auto-complete objectives based on
	// observable game state, regardless of whether the AI emitted questUpdates.
	// -----------------------------------------------------------------------
	for (const quest of state.quests) {
		if (quest.status !== 'active' && quest.status !== 'available') continue;
		let anyObjectiveChanged = false;

		for (const obj of quest.objectives) {
			if (obj.done) continue;
			if (!obj.type || !obj.linkedEntityId) continue;

			let completed = false;
			switch (obj.type) {
				case 'talk-to': {
					const npc = state.npcs.find(n => n.id === obj.linkedEntityId);
					if (npc && npc.alive !== false && npc.lastInteractionTurn === turnNumber) {
						completed = true;
					}
					break;
				}
				case 'visit-location': {
					const loc = state.locations.find(l => l.id === obj.linkedEntityId);
					if (loc && loc.visited) {
						completed = true;
					}
					break;
				}
				case 'find-item': {
					const itemName = obj.linkedEntityName?.toLowerCase() ?? obj.linkedEntityId.toLowerCase();
					for (const pc of state.characters) {
						if (pc.inventory?.some(item => item.name.toLowerCase().includes(itemName))) {
							completed = true;
							break;
						}
					}
					break;
				}
				case 'defeat-encounter':
					// Handled by linkedObjectiveIds on encounter victory — no extra check needed
					break;
				case 'escort':
				case 'custom':
					// These require AI or manual tracking — skip
					break;
			}

			if (completed) {
				obj.done = true;
				anyObjectiveChanged = true;
			}
		}

		// If objectives changed, check for quest auto-completion
		if (anyObjectiveChanged && quest.objectives.length > 0 && quest.objectives.every(o => o.done)) {
			// At this point quest.status is narrowed to 'active' | 'available' by the loop guard above
			quest.status = 'completed';
			distributeQuestRewards(state, quest, changes);
			// Activate follow-up quests
			if (quest.followUpQuestIds) {
				for (const fid of quest.followUpQuestIds) {
					const followUp = state.quests.find((q) => q.id === fid);
					if (followUp && followUp.status !== 'active' && followUp.status !== 'completed') {
						followUp.status = 'available';
					}
				}
			}
			enrichmentIntents.push({ type: 'extend-quest-arc', questId: quest.id });
		}

		// Auto-activate available quests when the player interacts with the giver
		if (quest.status === 'available' && quest.giverNpcId) {
			const giver = state.npcs.find(n => n.id === quest.giverNpcId);
			if (giver && giver.lastInteractionTurn !== undefined && giver.lastInteractionTurn >= 0) {
				quest.status = 'active';
			}
		}
	}

	// -----------------------------------------------------------------------
	// Deadline enforcement — auto-fail active quests whose deadline has passed.
	// Runs after all other changes so the clock is up-to-date for this turn.
	// -----------------------------------------------------------------------
	for (const quest of state.quests) {
		if (quest.status !== 'active') continue;
		if (!quest.deadline) continue;
		if (state.clock.day <= quest.deadline.day) continue;

		quest.status = 'failed';
		quest.completionMethod = 'expired';

		// Emit a scene fact so consequences persist in world memory
		const consequenceFact = quest.failureConsequence
			? `Quest "${quest.name}" expired (Day ${quest.deadline.day}): ${quest.failureConsequence}`
			: `Quest "${quest.name}" expired without completion (deadline was Day ${quest.deadline.day})`;
		if (!changes.sceneFactsAdded) changes.sceneFactsAdded = [];
		changes.sceneFactsAdded.push(consequenceFact);
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
function distributeQuestRewards(state: GameState, quest: Quest, changes?: StateChange): void {
	const rewards = quest.rewards;
	if (!rewards) return;

	const livingChars = state.characters.filter((c) => !c.dead);
	if (livingChars.length === 0) return;

	// XP — award to each living character
	if (rewards.xp > 0) {
		for (const char of livingChars) {
			char.xp += rewards.xp;
			// Surface quest XP in the turn record for audit trail
			if (changes) {
				if (!changes.xpAwarded) changes.xpAwarded = [];
				changes.xpAwarded.push({ characterId: char.id, amount: rewards.xp, reason: `Quest: ${quest.name}` });
			}
		}
	}

	// Gold — award to each living character
	if (rewards.gold > 0) {
		for (const char of livingChars) {
			char.gold += rewards.gold;
			// Surface quest gold in the turn record for audit trail
			if (changes) {
				if (!changes.goldChange) changes.goldChange = [];
				changes.goldChange.push({ characterId: char.id, delta: rewards.gold, reason: `Quest reward: ${quest.name}` });
			}
		}
	}

	// Items — place at party's current location so the player narrates finding them
	// and explicitly picks them up (preserves item tracking rather than injecting silently)
	if (rewards.items && rewards.items.length > 0) {
		const currentLoc = state.locations.find((l) => l.id === state.partyLocationId);
		if (currentLoc) {
			if (!currentLoc.groundItems) currentLoc.groundItems = [];
			for (const item of rewards.items) {
				currentLoc.groundItems.push({ ...item, quantity: item.quantity ?? 1 });
			}
		} else {
			// Fallback: inject into party leader's inventory if no location found
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
