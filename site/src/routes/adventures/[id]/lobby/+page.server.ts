import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, users } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';
import { broadcastLobbyUpdate } from '$server/realtime/lobby';
import { MAX_LOBBY_SIZE } from '$server/config/constants';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) {
		redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const adventure = await db
		.select()
		.from(adventures)
		.where(eq(adventures.id, params.id))
		.limit(1);

	if (adventure.length === 0) {
		error(404, 'Adventure not found');
	}

	// If adventure already started, redirect to main screen
	if (adventure[0].status === 'active') {
		redirect(302, `/adventures/${params.id}`);
	}

	// Check membership — auto join if in lobby mode
	const membership = await db
		.select()
		.from(adventureMembers)
		.where(
			and(
				eq(adventureMembers.adventureId, params.id),
				eq(adventureMembers.userId, locals.user.id)
			)
		)
		.limit(1);

	if (membership.length === 0) {
		// Auto-join as player if lobby is still open
		if (adventure[0].status === 'lobby') {
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

			// Notify existing SSE clients about the new member
			await broadcastLobbyUpdate(params.id);
		} else {
			error(403, 'This adventure is not accepting new players');
		}
	}

	// Fetch all members
	const members = await db
		.select({
			adventureId: adventureMembers.adventureId,
			userId: adventureMembers.userId,
			role: adventureMembers.role,
			isReady: adventureMembers.isReady,
			joinedAt: adventureMembers.joinedAt,
			username: users.username,
			avatarUrl: users.avatarUrl
		})
		.from(adventureMembers)
		.innerJoin(users, eq(adventureMembers.userId, users.id))
		.where(eq(adventureMembers.adventureId, params.id));

	return {
		adventure: adventure[0],
		members,
		currentUserId: locals.user.id
	};
};
