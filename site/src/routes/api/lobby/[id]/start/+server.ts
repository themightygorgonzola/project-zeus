import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/lobby/[id]/start
 *
 * Idempotent — safe to call in parallel from multiple clients.
 * Sets the adventure to active and initialises state if needed.
 * Called by every lobby member simultaneously when PartyKit broadcasts
 * adventure:started.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const adventureId = params.id;

	// Verify membership
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

	const now = Date.now();

	// Flip to active (idempotent — no-op if already active)
	await db
		.update(adventures)
		.set({ status: 'active', updatedAt: now })
		.where(eq(adventures.id, adventureId));

	// Initialise state if it doesn't exist yet
	const existingState = await db
		.select()
		.from(adventureState)
		.where(eq(adventureState.adventureId, adventureId))
		.limit(1);

	if (existingState.length === 0) {
		await db.insert(adventureState).values({
			adventureId,
			stateJson: JSON.stringify({ started: true, events: [] }),
			updatedAt: now
		});
	} else {
		await db
			.update(adventureState)
			.set({
				stateJson: JSON.stringify({
					...JSON.parse(existingState[0].stateJson),
					started: true
				}),
				updatedAt: now
			})
			.where(eq(adventureState.adventureId, adventureId));
	}

	return json({ ok: true });
};
