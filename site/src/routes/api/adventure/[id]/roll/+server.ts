import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventureMembers } from '$server/db/schema';
import { resolveCheckAndResume } from '$server/ai/adventure-turn';
import type { PendingCheck } from '$lib/game/types';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/adventure/[id]/roll
 * Body: { pendingCheck: PendingCheck }
 *
 * Resolves a pending skill/ability/save check, runs the dice engine,
 * then triggers narrator-mode AI to narrate the outcome.
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
		pendingCheck?: PendingCheck;
	};

	if (!body.pendingCheck) error(400, 'pendingCheck is required');

	const result = await resolveCheckAndResume(
		adventureId,
		locals.user.id,
		body.pendingCheck
	);

	return json({ ok: true, narrativeText: result.narrativeText, model: result.model });
};
