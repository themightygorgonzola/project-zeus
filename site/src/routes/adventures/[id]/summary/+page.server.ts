import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$server/db/client';
import {
	adventures,
	adventureMembers,
	adventureState,
	adventureTurns,
	adventureChat,
	users
} from '$server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { createInitialGameState, migrateState } from '$lib/game/state';
import type { TurnRecord, StateChange } from '$lib/game/types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) {
		redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	// Load adventure row
	const [adv] = await db
		.select()
		.from(adventures)
		.where(eq(adventures.id, params.id))
		.limit(1);

	if (!adv) error(404, 'Adventure not found');

	// Only completed adventures belong here; redirect elsewhere for other statuses
	if (adv.status === 'lobby') redirect(302, `/adventures/${params.id}/lobby`);
	if (adv.status === 'active') redirect(302, `/adventures/${params.id}`);

	// Membership check
	const [membership] = await db
		.select()
		.from(adventureMembers)
		.where(
			and(
				eq(adventureMembers.adventureId, params.id),
				eq(adventureMembers.userId, locals.user.id)
			)
		)
		.limit(1);

	if (!membership) error(403, 'You are not a member of this adventure');

	// Members with usernames
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

	// Game state
	const [stateRow] = await db
		.select()
		.from(adventureState)
		.where(eq(adventureState.adventureId, params.id))
		.limit(1);

	let gameState = createInitialGameState(adv.worldSeed ?? '');
	if (stateRow) {
		try {
			gameState = migrateState(JSON.parse(stateRow.stateJson));
		} catch {
			// Corrupted state — fall back to empty
		}
	}

	// All turns — no limit (completed adventure, frozen data)
	const turnRows = await db
		.select()
		.from(adventureTurns)
		.where(eq(adventureTurns.adventureId, params.id))
		.orderBy(asc(adventureTurns.turnNumber));

	const allTurns: TurnRecord[] = turnRows.map((r) => ({
		id: r.id,
		turnNumber: r.turnNumber,
		actorType: r.actorType as TurnRecord['actorType'],
		actorId: r.actorId,
		action: r.action,
		intent: r.intent as TurnRecord['intent'],
		status: (r.status ?? 'completed') as TurnRecord['status'],
		resolvedActionSummary: r.resolvedSummary ?? '',
		mechanicResults: JSON.parse(r.mechanicsJson) as TurnRecord['mechanicResults'],
		stateChanges: JSON.parse(r.stateChangesJson) as StateChange,
		narrativeText: r.narrativeText,
		timestamp: r.createdAt
	}));

	// All chat — no limit
	const chatRows = await db
		.select()
		.from(adventureChat)
		.where(eq(adventureChat.adventureId, params.id))
		.orderBy(asc(adventureChat.createdAt));

	const allChat = chatRows.map((r) => ({
		id: r.id,
		userId: r.userId,
		username: r.username,
		text: r.text,
		mentions: JSON.parse(r.mentionsJson) as string[],
		retroInvoked: r.retroInvoked,
		consumedByTurn: r.consumedByTurn,
		createdAt: r.createdAt
	}));

	// ── Computed stats ─────────────────────────────────────────────────────────
	const msPlayed = adv.updatedAt - adv.createdAt;
	const hoursPlayed = Math.floor(msPlayed / 3_600_000);
	const minutesPlayed = Math.floor((msPlayed % 3_600_000) / 60_000);

	const enemyRoles = new Set(['hostile', 'boss']);
	const enemiesDefeated = gameState.npcs.filter(
		(n) => !n.alive && enemyRoles.has(n.role)
	).length;
	const bossesDefeated = gameState.npcs.filter(
		(n) => !n.alive && n.role === 'boss'
	).length;
	const alliesLost = gameState.npcs.filter(
		(n) => !n.alive && (n.role === 'ally' || n.role === 'companion')
	).length;

	const questsCompleted = gameState.quests.filter((q) => q.status === 'completed').length;
	const questsFailed = gameState.quests.filter((q) => q.status === 'failed').length;
	const questsActive = gameState.quests.filter(
		(q) => q.status === 'active' || q.status === 'available'
	).length;

	const locationsVisited = gameState.locations.filter((l) => l.visited).length;
	const locationsTotal = gameState.locations.length;

	const totalXp = gameState.characters.reduce((sum, c) => sum + (c.xp ?? 0), 0);
	const totalGold = gameState.characters.reduce((sum, c) => sum + (c.gold ?? 0), 0);

	// Items acquired: sum stateChanges.itemsGained across all turns
	const itemsAcquired = allTurns.reduce((sum, t) => {
		const gained = (t.stateChanges as StateChange)?.itemsGained ?? [];
		return sum + gained.reduce((s, g) => s + (g.item?.quantity ?? 1), 0);
	}, 0);

	const stats = {
		hoursPlayed,
		minutesPlayed,
		totalTurns: allTurns.length,
		totalMessages: allChat.length,
		enemiesDefeated,
		bossesDefeated,
		alliesLost,
		questsCompleted,
		questsFailed,
		questsActive,
		locationsVisited,
		locationsTotal,
		totalXp,
		totalGold,
		daysElapsed: gameState.clock?.day ?? 1,
		itemsAcquired
	};

	return {
		adventure: adv,
		members,
		gameState,
		stats,
		allTurns,
		allChat,
		currentUserId: locals.user.id
	};
};
