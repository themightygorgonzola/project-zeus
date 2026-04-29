/**
 * PATCH /api/adventure/[id]/character/inventory
 *
 * Persist one or more item moves within the current user's character inventory.
 * Each move is atomic: source removal is validated before target insertion.
 * An invalid move (container overfull) causes the whole batch to abort.
 *
 * Body: { moves: Array<{ itemId: string; fromSource: string; toSource: string }> }
 * Response: { ok: true; character: PlayerCharacter } | { ok: false; error: string }
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db/client';
import { adventureMembers, adventures } from '$server/db/schema';
import { loadGameState, saveGameState } from '$lib/game/state';
import { moveItemToContainer } from '$lib/game/item-dimensions';

interface MoveInstruction {
	itemId: string;
	fromSource: string;
	toSource: string;
}

interface PatchBody {
	moves?: MoveInstruction[];
	containerOrder?: string[];
}

async function requireAdventureMember(adventureId: string, userId: string) {
	const [membership, adventure] = await Promise.all([
		db
			.select()
			.from(adventureMembers)
			.where(and(eq(adventureMembers.adventureId, adventureId), eq(adventureMembers.userId, userId)))
			.limit(1),
		db.select().from(adventures).where(eq(adventures.id, adventureId)).limit(1)
	]);

	if (adventure.length === 0) {
		error(404, 'Adventure not found');
	}
	if (membership.length === 0) {
		error(403, 'Not a member');
	}

	return adventure[0];
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const user = locals.user;

	await requireAdventureMember(params.id, user.id);

	// Parse and validate body
	let body: PatchBody;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || (!Array.isArray(body.moves) && !Array.isArray(body.containerOrder))) {
		return json({ ok: false, error: 'Missing moves array or containerOrder array' }, { status: 400 });
	}

	// Validate each move shape (if moves provided)
	for (const move of (body.moves ?? [])) {
		if (
			typeof move.itemId !== 'string' ||
			typeof move.fromSource !== 'string' ||
			typeof move.toSource !== 'string'
		) {
			return json({ ok: false, error: 'Each move requires itemId, fromSource, toSource (strings)' }, { status: 400 });
		}
	}

	// Load current state
	const state = await loadGameState(params.id);
	if (!state) {
		return json({ ok: false, error: 'Adventure state not found' }, { status: 404 });
	}

	const charIdx = state.characters.findIndex((c) => c.userId === user.id);
	if (charIdx === -1) {
		return json({ ok: false, error: 'No character found for this user' }, { status: 404 });
	}

	// Apply moves sequentially — each move operates on the result of the previous
	let character = state.characters[charIdx];
	for (const move of (body.moves ?? [])) {
		const result = moveItemToContainer(character, move.itemId, move.fromSource, move.toSource);
		if (result === null) {
			return json(
				{ ok: false, error: `Move rejected: item "${move.itemId}" from "${move.fromSource}" to "${move.toSource}" failed (container full or item not found)` },
				{ status: 422 }
			);
		}
		character = result;
	}

	// Apply container reorder if provided
	if (Array.isArray(body.containerOrder) && body.containerOrder.length > 0) {
		const order = body.containerOrder.map(String);
		const containers = character.inventory.filter(i => i.category === 'container');
		const nonContainers = character.inventory.filter(i => i.category !== 'container');
		const reordered = order
			.map(id => containers.find(c => c.id === id))
			.filter((c): c is typeof containers[number] => c !== undefined);
		// Append any containers not mentioned in the order (shouldn't normally happen)
		const mentioned = new Set(order);
		const remainder = containers.filter(c => !mentioned.has(c.id));
		character = { ...character, inventory: [...reordered, ...remainder, ...nonContainers] };
	}

	// Persist
	state.characters[charIdx] = character;
	await saveGameState(params.id, state);

	return json({ ok: true, character });
};
