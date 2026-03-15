import { tasks } from '@trigger.dev/sdk';
import { completeChat, streamChat, type ChatMessageInput } from './openai';
import { notifyRoom } from './party';

export type AdventureTurnPurpose = 'interactive-chat' | 'background-turn';
export type AdventureTurnMode = 'inline' | 'background';

export interface AdventureTurnPayload {
	adventureId: string;
	playerAction: string;
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
	purpose?: AdventureTurnPurpose;
	mode?: AdventureTurnMode | 'auto';
	model?: string;
}

export interface AdventureTurnTaskPayload {
	payload: AdventureTurnPayload;
	profile: AdventureTurnProfile;
}

const DEFAULT_SYSTEM_PROMPT =
	'You are a Game Master running a text-based fantasy RPG adventure. ' +
	'Respond in character as the GM: describe what happens as a result of ' +
	"the player's action in 2–4 vivid sentences. Advance the story, add " +
	'tension or wonder, and end with an implicit or explicit prompt for ' +
	"the player's next move.";

export function buildAdventureTurnPayload({
	adventureId,
	playerAction
}: AdventureTurnDispatchInput): AdventureTurnPayload {
	return {
		adventureId,
		playerAction,
		history: [
			{
				role: 'system',
				content: DEFAULT_SYSTEM_PROMPT
			}
		]
	};
}

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

export async function dispatchAdventureTurn(input: AdventureTurnDispatchInput): Promise<{
	mode: AdventureTurnMode;
	model: string;
}> {
	const payload = buildAdventureTurnPayload(input);
	const profile = resolveAdventureTurnProfile(input);

	if (profile.mode === 'background') {
		await tasks.trigger('adventure-turn', { payload, profile } satisfies AdventureTurnTaskPayload);
		return { mode: profile.mode, model: profile.model };
	}

	await executeAdventureTurn(payload, profile);
	return { mode: profile.mode, model: profile.model };
}

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
		let narrativeText = '';

		if (profile.stream) {
			narrativeText = await streamChat(
				{ apiKey: openaiKey, model: profile.model, messages },
				async (chunk) => {
					await notifyRoom(partyHost, payload.adventureId, {
						type: 'ai:turn:chunk',
						text: chunk
					});
				}
			);
		} else {
			narrativeText = await completeChat({ apiKey: openaiKey, model: profile.model, messages });
		}

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
		throw cause;
	}
}
