import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { adventures, adventureMembers, adventureState, adventureTurns } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';
import { createInitialGameState, createOpeningGmTurn, loadGameState, migrateState, persistTurnAndSaveState } from '$lib/game/state';
import { bootstrapAdventureContent } from '$lib/game/world-bridge';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

/**
 * POST /api/lobby/[id]/start
 *
 * Idempotent — safe to call in parallel from multiple clients.
 * Sets the adventure to active, initialises state if needed,
 * and bootstraps world content (location, NPCs, quest) if not already done.
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

	// Load adventure to get worldSeed
	const adventureRows = await db
		.select()
		.from(adventures)
		.where(eq(adventures.id, adventureId))
		.limit(1);

	if (adventureRows.length === 0) error(404, 'Adventure not found');

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
		// Create initial game state with world bootstrap
		const worldSeed = adventureRows[0].worldSeed ?? '';
		let gameState = createInitialGameState(worldSeed);

		// Try to bootstrap world content from the world seed
		try {
			const stateJson = JSON.stringify({ started: true, events: [] });
			// Check if there's a world stored (from adventure creation)
			// For multiplayer, the world was stored in worldSeed as JSON
			if (worldSeed) {
				const parsed = JSON.parse(worldSeed);
				if (parsed && typeof parsed === 'object' && parsed.engine) {
					gameState = bootstrapAdventureContent(gameState, parsed as PrototypeWorld);
				}
			}
		} catch {
			// Non-fatal: worldSeed might be a simple string, not JSON
		}

		await db.insert(adventureState).values({
			adventureId,
			stateJson: JSON.stringify(gameState),
			updatedAt: now
		});
	} else {
		// State exists — check if bootstrap is needed (no locations = not bootstrapped)
		try {
			const parsed = JSON.parse(existingState[0].stateJson);
			const gameState = migrateState(parsed);

			// Bootstrap if no locations exist yet and we have a world
			if (gameState.locations.length === 0) {
				let world: PrototypeWorld | null = null;
				// Try world from state blob (legacy format)
				if (parsed.world && typeof parsed.world === 'object' && parsed.world.engine) {
					world = parsed.world as PrototypeWorld;
				}
				// Try world from worldSeed
				if (!world && adventureRows[0].worldSeed) {
					try {
						const seedParsed = JSON.parse(adventureRows[0].worldSeed);
						if (seedParsed && typeof seedParsed === 'object' && seedParsed.engine) {
							world = seedParsed as PrototypeWorld;
						}
					} catch { /* not JSON */ }
				}

				if (world) {
					const bootstrapped = bootstrapAdventureContent(gameState, world);
					await db
						.update(adventureState)
						.set({
							stateJson: JSON.stringify({ ...parsed, ...bootstrapped, started: true }),
							updatedAt: now
						})
						.where(eq(adventureState.adventureId, adventureId));
				} else {
					await db
						.update(adventureState)
						.set({
							stateJson: JSON.stringify({ ...parsed, started: true }),
							updatedAt: now
						})
						.where(eq(adventureState.adventureId, adventureId));
				}
			} else {
				await db
					.update(adventureState)
					.set({
						stateJson: JSON.stringify({ ...parsed, started: true }),
						updatedAt: now
					})
					.where(eq(adventureState.adventureId, adventureId));
			}
		} catch {
			await db
				.update(adventureState)
				.set({
					stateJson: JSON.stringify({ started: true }),
					updatedAt: now
				})
				.where(eq(adventureState.adventureId, adventureId));
		}
	}

	const existingTurns = await db
		.select({ id: adventureTurns.id })
		.from(adventureTurns)
		.where(eq(adventureTurns.adventureId, adventureId))
		.limit(1);

	if (existingTurns.length === 0) {
		const latestState = await loadGameState(adventureId);
		if (latestState) {
			const openingTurn = createOpeningGmTurn(latestState);
			if (openingTurn) {
				await persistTurnAndSaveState(adventureId, openingTurn, latestState);
			}
		}
	}

	return json({ ok: true });
};
