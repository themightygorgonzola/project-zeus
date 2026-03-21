import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventureMembers } from '$server/db/schema';
import { persistChatMessage } from '$lib/game/state';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/adventure/[id]/chat
 * Body: { text: string, username: string }
 *
 * Persists a player chat message to the database.
 * Called alongside the PartyKit broadcast so messages are durably stored.
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
		text?: string;
		username?: string;
	};
	const text = body.text?.trim();
	if (!text) error(400, 'text is required');

	const username = body.username ?? 'Unknown';

	const record = await persistChatMessage(
		adventureId,
		locals.user.id,
		username,
		text
	);

	return json({ ok: true, id: record.id, mentions: record.mentions });
};
