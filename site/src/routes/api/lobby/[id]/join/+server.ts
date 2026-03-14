import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';
import { broadcastLobbyUpdate } from '$server/realtime/lobby';
import { MAX_LOBBY_SIZE } from '$server/config/constants';

/** POST /api/lobby/[id]/join — join an adventure lobby */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const adventure = await db
		.select()
		.from(adventures)
		.where(eq(adventures.id, params.id))
		.limit(1);

	if (adventure.length === 0) {
		error(404, 'Adventure not found');
	}

	if (adventure[0].status !== 'lobby') {
		error(400, 'Adventure is not accepting new players');
	}

	// Check if already a member
	const existing = await db
		.select()
		.from(adventureMembers)
		.where(
			and(
				eq(adventureMembers.adventureId, params.id),
				eq(adventureMembers.userId, locals.user.id)
			)
		)
		.limit(1);

	if (existing.length > 0) {
		return json({ ok: true, message: 'Already a member' });
	}

	// Enforce lobby size cap
	const currentMembers = await db
		.select()
		.from(adventureMembers)
		.where(eq(adventureMembers.adventureId, params.id));
	if (currentMembers.length >= MAX_LOBBY_SIZE) {
		error(400, `Lobby is full (max ${MAX_LOBBY_SIZE} players)`);
	}

	await db.insert(adventureMembers).values({
		adventureId: params.id,
		userId: locals.user.id,
		role: 'player',
		isReady: false,
		joinedAt: Date.now()
	});

	// Push update to all connected SSE clients
	await broadcastLobbyUpdate(params.id);

	return json({ ok: true, message: 'Joined lobby' });
};
