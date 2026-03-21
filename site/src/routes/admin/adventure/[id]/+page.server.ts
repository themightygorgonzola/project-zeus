import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$server/db/client';
import {
	adventures,
	adventureMembers,
	adventureTurns,
	adventureState,
	adventureChat,
	users
} from '$server/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { TurnDebugData } from '$lib/server/ai/adventure-turn';

// ── Shapes exposed to the page ────────────────────────────────────────────

export interface TurnRow {
	id: string;
	turnNumber: number;
	actorType: string;
	actorId: string;
	actorName: string;
	action: string;
	intent: string;
	status: string;
	resolvedSummary: string;
	narrativeText: string;
	mechanics: unknown[];
	stateChanges: unknown;
	debug: TurnDebugData | null;
	createdAt: number;
}

export interface ChatRow {
	id: string;
	userId: string;
	username: string;
	text: string;
	createdAt: number;
	consumedByTurn: number | null;
}

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	// Load adventure
	const [adv] = await db.select().from(adventures).where(eq(adventures.id, id)).limit(1);
	if (!adv) error(404, 'Adventure not found');

	// Load members with usernames
	const memberRows = await db
		.select({
			userId: adventureMembers.userId,
			role: adventureMembers.role,
			isReady: adventureMembers.isReady,
			joinedAt: adventureMembers.joinedAt,
			username: users.username,
			avatarUrl: users.avatarUrl
		})
		.from(adventureMembers)
		.innerJoin(users, eq(adventureMembers.userId, users.id))
		.where(eq(adventureMembers.adventureId, id));

	// Build userId → username lookup
	const userMap: Record<string, string> = {};
	for (const m of memberRows) userMap[m.userId] = m.username;

	// Load all turns (ordered ascending by turnNumber)
	const rawTurns = await db
		.select()
		.from(adventureTurns)
		.where(eq(adventureTurns.adventureId, id))
		.orderBy(adventureTurns.turnNumber);

	const turns: TurnRow[] = rawTurns.map((t) => {
		let mechanics: unknown[] = [];
		let stateChanges: unknown = {};
		let debug: TurnDebugData | null = null;

		try { mechanics = JSON.parse(t.mechanicsJson); } catch { /* ignore */ }
		try { stateChanges = JSON.parse(t.stateChangesJson); } catch { /* ignore */ }
		try {
			if (t.debugJson) debug = JSON.parse(t.debugJson) as TurnDebugData;
		} catch { /* ignore */ }

		return {
			id: t.id,
			turnNumber: t.turnNumber,
			actorType: t.actorType,
			actorId: t.actorId,
			actorName: userMap[t.actorId] ?? t.actorId,
			action: t.action,
			intent: t.intent,
			status: t.status,
			resolvedSummary: t.resolvedSummary,
			narrativeText: t.narrativeText,
			mechanics,
			stateChanges,
			debug,
			createdAt: t.createdAt
		};
	});

	// Load current game state blob
	const stateRows = await db
		.select({ stateJson: adventureState.stateJson, updatedAt: adventureState.updatedAt })
		.from(adventureState)
		.where(eq(adventureState.adventureId, id))
		.limit(1);

	let currentState: unknown = null;
	let stateUpdatedAt: number | null = null;
	if (stateRows.length > 0) {
		try { currentState = JSON.parse(stateRows[0].stateJson); } catch { /* ignore */ }
		stateUpdatedAt = stateRows[0].updatedAt;
	}

	// Load recent chat (last 100 messages)
	const chatRows = await db
		.select()
		.from(adventureChat)
		.where(eq(adventureChat.adventureId, id))
		.orderBy(desc(adventureChat.createdAt))
		.limit(100);

	const chatLog: ChatRow[] = chatRows.reverse().map((c) => ({
		id: c.id,
		userId: c.userId,
		username: c.username,
		text: c.text,
		createdAt: c.createdAt,
		consumedByTurn: c.consumedByTurn ?? null
	}));

	return {
		adventure: adv,
		members: memberRows,
		turns,
		currentState,
		stateUpdatedAt,
		chatLog
	};
};
