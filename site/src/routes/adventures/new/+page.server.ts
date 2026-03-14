import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState } from '$server/db/schema';
import { ulid } from 'ulid';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		if (!locals.user) {
			redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
		}

		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const mode = formData.get('mode')?.toString();

		if (!name || name.length < 1 || name.length > 100) {
			return fail(400, { error: 'Adventure name is required (max 100 characters).' });
		}

		if (mode !== 'solo' && mode !== 'multiplayer') {
			return fail(400, { error: 'Invalid mode.' });
		}

		const now = Date.now();
		const adventureId = ulid();

		const isSolo = mode === 'solo';

		// Create adventure + member + state atomically
		await db.transaction(async (tx) => {
			await tx.insert(adventures).values({
				id: adventureId,
				name,
				ownerId: locals.user!.id,
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
				stateJson: JSON.stringify({ started: isSolo, events: [] }),
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
