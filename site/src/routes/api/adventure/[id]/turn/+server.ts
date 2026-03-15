import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventureMembers } from '$server/db/schema';
import { dispatchAdventureTurn, type AdventureTurnDispatchInput } from '$server/ai/adventure-turn';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/adventure/[id]/turn
 * Body: { playerAction: string }
 *
 * Verifies membership then triggers the Trigger.dev adventure-turn task.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const { id: adventureId } = params;

	const membership = await db
		.select()
		.from(adventureMembers)
		.where(
			and(
				eq(adventureMembers.adventureId, adventureId),
				eq(adventureMembers.userId, locals.user.id)
			)
		)
		.limit(1);

	if (membership.length === 0) error(403, 'Not a member');

	const body = (await request.json().catch(() => ({}))) as {
		playerAction?: string;
		purpose?: AdventureTurnDispatchInput['purpose'];
		mode?: AdventureTurnDispatchInput['mode'] | 'auto';
		model?: string;
	};
	const playerAction = body.playerAction?.trim();
	if (!playerAction) error(400, 'playerAction is required');

	const result = await dispatchAdventureTurn({
		adventureId,
		playerAction,
		purpose: body.purpose,
		mode: body.mode,
		model: body.model
	});

	return json({ ok: true, ...result });
};
