import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tasks } from '@trigger.dev/sdk';
import { db } from '$server/db/client';
import { adventureMembers } from '$server/db/schema';
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

	const body = await request.json().catch(() => ({})) as { playerAction?: string };
	const playerAction = body.playerAction?.trim();
	if (!playerAction) error(400, 'playerAction is required');

	await tasks.trigger('adventure-turn', {
		adventureId,
		playerAction,
		history: [
			{
				role: 'system',
				content:
					'You are a Game Master running a text-based fantasy RPG adventure. ' +
					'Respond in character as the GM: describe what happens as a result of ' +
					"the player's action in 2–4 vivid sentences. Advance the story, add " +
					'tension or wonder, and end with an implicit or explicit prompt for ' +
					"the player's next move.",
			},
		],
	});

	return json({ ok: true });
};
