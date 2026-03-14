import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState, users } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';

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

	// If still in lobby, redirect there
	if (adventure[0].status === 'lobby') {
		redirect(302, `/adventures/${params.id}/lobby`);
	}

	// Verify membership
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
		error(403, 'You are not a member of this adventure');
	}

	// Get members
	const members = await db
		.select({
			userId: adventureMembers.userId,
			role: adventureMembers.role,
			username: users.username,
			avatarUrl: users.avatarUrl
		})
		.from(adventureMembers)
		.innerJoin(users, eq(adventureMembers.userId, users.id))
		.where(eq(adventureMembers.adventureId, params.id));

	// Get state
	const state = await db
		.select()
		.from(adventureState)
		.where(eq(adventureState.adventureId, params.id))
		.limit(1);

	let parsedState = {};
	if (state.length > 0) {
		try {
			parsedState = JSON.parse(state[0].stateJson);
		} catch {
			// Corrupted state — fall back to empty
			parsedState = {};
		}
	}

	return {
		adventure: adventure[0],
		members,
		state: parsedState,
		currentUserId: locals.user.id
	};
};
