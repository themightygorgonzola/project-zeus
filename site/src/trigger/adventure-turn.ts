/**
 * Trigger.dev background task — AI storyteller turn.
 *
 * Triggered when a player submits an action in an adventure.
 * Runs the OpenAI completion, streams chunks back via PartyKit,
 * then persists the final narrative to Turso.
 *
 * Payload:
 *   request — adventure turn payload
 *   profile — resolved execution profile (model/mode/stream)
 */

import { task } from '@trigger.dev/sdk';
import {
	executeAdventureTurn,
	resolveAdventureTurnProfile,
	type AdventureTurnTaskPayload
} from '../lib/server/ai/adventure-turn';

export const adventureTurn = task({
  id: 'adventure-turn',
  run: async ({ payload, profile }: AdventureTurnTaskPayload) => {
    const resolvedProfile = profile ?? resolveAdventureTurnProfile({ purpose: 'background-turn', mode: 'background' });
    const result = await executeAdventureTurn(payload, resolvedProfile);
    return { adventureId: payload.adventureId, ...result };
  }
});
