import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState } from '$server/db/schema';
import { createWorldSeed, generatePrototypeWorld, toWorldSnapshot } from '$lib/worldgen/prototype';
import { ulid } from 'ulid';
import { createInitialGameState, createOpeningGmTurn, persistTurnAndSaveState } from '$lib/game/state';
import { bootstrapAdventureContent } from '$lib/game/world-bridge';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const initialWorldSeed = createWorldSeed();
	const initialWorld = generatePrototypeWorld(initialWorldSeed);

	return {
		initialWorld,
		initialWorldSeed,
		initialWorldSnapshot: toWorldSnapshot(initialWorld)
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		if (!locals.user) {
			redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
		}

		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const mode = formData.get('mode')?.toString();
		const worldSeed = formData.get('worldSeed')?.toString().trim();
		const worldDataRaw = formData.get('worldData')?.toString();

		if (!name || name.length < 1 || name.length > 100) {
			return fail(400, { error: 'Adventure name is required (max 100 characters).' });
		}

		if (mode !== 'solo' && mode !== 'multiplayer') {
			return fail(400, { error: 'Invalid mode.' });
		}

		if (!worldDataRaw) {
			return fail(400, { error: 'Generate a world before creating the adventure.' });
		}

		let world: unknown;
		try {
			world = JSON.parse(worldDataRaw);
		} catch {
			return fail(400, { error: 'Selected world data was invalid. Please reroll and try again.' });
		}

		if (!world || typeof world !== 'object') {
			return fail(400, { error: 'Selected world data was invalid. Please reroll and try again.' });
		}

		const now = Date.now();
		const adventureId = ulid();
		const savedWorldSeed = worldSeed || ((world as { seed?: string }).seed ?? String(now));

		const isSolo = mode === 'solo';
		const initialState = buildInitialState(isSolo, world as PrototypeWorld, savedWorldSeed);

		// Create adventure + member + state atomically
		await db.transaction(async (tx) => {
			await tx.insert(adventures).values({
				id: adventureId,
				name,
				ownerId: locals.user!.id,
				worldSeed: savedWorldSeed,
				mode,
				status: isSolo ? 'active' : 'lobby',
				createdAt: now,
				updatedAt: now
			});

			await tx.insert(adventureMembers).values({
				adventureId,
				userId: locals.user!.id,
				role: 'owner',
				isReady: isSolo,
				joinedAt: now
			});

			await tx.insert(adventureState).values({
				adventureId,
				stateJson: JSON.stringify(initialState),
				updatedAt: now
			});
		});

		if (isSolo) {
			const openingTurn = createOpeningGmTurn(initialState);
			if (openingTurn) {
				await persistTurnAndSaveState(adventureId, openingTurn, initialState);
			}
		}

		// Route based on mode
		if (isSolo) {
			redirect(303, `/adventures/${adventureId}`);
		} else {
			redirect(303, `/adventures/${adventureId}/lobby`);
		}
	}
};

/**
 * Build the initial state blob for a new adventure.
 * For solo adventures, immediately bootstraps adventure content (location, NPCs, quest).
 * For multiplayer, the bootstrap happens after character creation when the game goes active.
 * The PrototypeWorld is stored alongside the GameState for context assembly.
 */
function buildInitialState(isSolo: boolean, world: PrototypeWorld, worldSeed: string) {
	const gameState = createInitialGameState(worldSeed);

	if (isSolo) {
		bootstrapAdventureContent(gameState, world);
	}

	// Store both the new GameState and the world (for GM context + legacy compat)
	return {
		...gameState,
		world,
		worldAcceptedAt: Date.now()
	};
}
