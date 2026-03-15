import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState } from '$server/db/schema';
import { createWorldSeed, generatePrototypeWorld, toWorldSnapshot } from '$lib/worldgen/prototype';
import { ulid } from 'ulid';

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
				stateJson: JSON.stringify({
					started: isSolo,
					events: [],
					world,
					worldAcceptedAt: now
				}),
				updatedAt: now
			});
		});

		// Route based on mode
		if (isSolo) {
			redirect(303, `/adventures/${adventureId}`);
		} else {
			redirect(303, `/adventures/${adventureId}/lobby`);
		}
	}
};
