import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db/client';
import { adventureMembers, adventures } from '$server/db/schema';
import type { CharacterCreateInput } from '$lib/game';
import { createCharacter, validateCharacterInput } from '$lib/game/character-creation';
import { createInitialGameState, loadGameState, saveGameState } from '$lib/game/state';

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

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const user = locals.user;

	await requireAdventureMember(params.id, user.id);
	const state = await loadGameState(params.id);
	const character = state?.characters.find((entry) => entry.userId === user.id) ?? null;

	return json({ ok: true, character });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const user = locals.user;

	const adventure = await requireAdventureMember(params.id, user.id);
	const input = (await request.json().catch(() => ({}))) as CharacterCreateInput;
	const validationErrors = validateCharacterInput(input);
	if (validationErrors.length > 0) {
		return json({ ok: false, errors: validationErrors }, { status: 400 });
	}

	const state = (await loadGameState(params.id)) ?? createInitialGameState(adventure.worldSeed ?? '');
	const character = createCharacter(input, user.id, params.id);
	const existingIndex = state.characters.findIndex((entry) => entry.userId === user.id);
	if (existingIndex >= 0) {
		state.characters[existingIndex] = character;
	} else {
		state.characters.push(character);
	}

	await saveGameState(params.id, state);
	return json({ ok: true, character });
};
