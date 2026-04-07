import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import {
	adventures,
	adventureMembers,
	adventureState,
	adventureChat,
	adventureTurns
} from '$server/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * PATCH /api/adventure/[id]
 * Body: { status: 'completed' }
 *
 * Owner-only. Marks an adventure as completed.
 */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const { id: adventureId } = params;

	// Verify caller is the adventure owner
	const [adv] = await db
		.select({ id: adventures.id, ownerId: adventures.ownerId })
		.from(adventures)
		.where(and(eq(adventures.id, adventureId), eq(adventures.ownerId, locals.user.id)))
		.limit(1);

	if (!adv) error(404, 'Adventure not found or not owner');

	const body = (await request.json().catch(() => ({}))) as { status?: string };
	if (body.status !== 'completed') error(400, 'Only status: completed is accepted');

	await db
		.update(adventures)
		.set({ status: 'completed', updatedAt: Date.now() })
		.where(eq(adventures.id, adventureId));

	return json({ ok: true });
};

/**
 * DELETE /api/adventure/[id]
 *
 * Owner-only. Permanently deletes an adventure and all its data.
 * Child rows are deleted in FK dependency order before the parent row.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const { id: adventureId } = params;

	// Verify caller is the adventure owner before touching any data
	const [adv] = await db
		.select({ id: adventures.id, ownerId: adventures.ownerId })
		.from(adventures)
		.where(and(eq(adventures.id, adventureId), eq(adventures.ownerId, locals.user.id)))
		.limit(1);

	if (!adv) error(404, 'Adventure not found or not owner');

	// Cascade delete in FK dependency order
	await db.delete(adventureChat).where(eq(adventureChat.adventureId, adventureId));
	await db.delete(adventureTurns).where(eq(adventureTurns.adventureId, adventureId));
	await db.delete(adventureState).where(eq(adventureState.adventureId, adventureId));
	await db.delete(adventureMembers).where(eq(adventureMembers.adventureId, adventureId));
	await db.delete(adventures).where(eq(adventures.id, adventureId));

	return json({ ok: true });
};
