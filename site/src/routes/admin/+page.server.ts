import type { PageServerLoad, Actions } from './$types';
import { db } from '$server/db/client';
import { users, sessions, adventures, adventureMembers, adventureState, adventureTurns, adventureChat } from '$server/db/schema';
import { eq, lt, inArray } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const [allUsers, allAdventures, allSessions, allTurnRows, allStateRows] = await Promise.all([
		db.select().from(users).orderBy(users.createdAt),
		db.select().from(adventures).orderBy(adventures.createdAt),
		db
			.select({
				id: sessions.id,
				userId: sessions.userId,
				expiresAt: sessions.expiresAt,
				username: users.username,
				email: users.email
			})
			.from(sessions)
			.innerJoin(users, eq(sessions.userId, users.id))
			.orderBy(sessions.expiresAt),
		db.select({ adventureId: adventureTurns.adventureId }).from(adventureTurns).catch(() => []),
		db.select({ adventureId: adventureState.adventureId, stateJson: adventureState.stateJson }).from(adventureState).catch(() => [])
	]);

	const memberCounts = await db
		.select({ adventureId: adventureMembers.adventureId })
		.from(adventureMembers);

	const memberCountMap: Record<string, number> = {};
	for (const row of memberCounts) {
		memberCountMap[row.adventureId] = (memberCountMap[row.adventureId] ?? 0) + 1;
	}

	const ownerMap: Record<string, string> = {};
	for (const u of allUsers) {
		ownerMap[u.id] = u.username;
	}

	// Turn counts per adventure
	const turnCountMap: Record<string, number> = {};
	for (const row of allTurnRows) {
		turnCountMap[row.adventureId] = (turnCountMap[row.adventureId] ?? 0) + 1;
	}

	// Parse game state blobs for debug info
	const stateDebugMap: Record<string, {
		characterCount: number;
		npcCount: number;
		questCount: number;
		partyLocationId: string;
		stateVersion: number;
		nextTurnNumber: number;
	}> = {};
	for (const row of allStateRows) {
		try {
			const gs = JSON.parse(row.stateJson ?? '{}');
			stateDebugMap[row.adventureId] = {
				characterCount: Object.keys(gs.characters ?? {}).length,
				npcCount: Object.keys(gs.npcs ?? {}).length,
				questCount: Object.keys(gs.quests ?? {}).length,
				partyLocationId: gs.partyLocationId ?? '—',
				stateVersion: gs.stateVersion ?? gs.version ?? 0,
				nextTurnNumber: gs.nextTurnNumber ?? 0
			};
		} catch {
			// unparseable state blob — skip
		}
	}

	return {
		users: allUsers,
		adventures: allAdventures.map((a) => ({
			...a,
			ownerName: ownerMap[a.ownerId] ?? a.ownerId,
			memberCount: memberCountMap[a.id] ?? 0
		})),
		sessions: allSessions,
		stats: {
			totalUsers: allUsers.length,
			testUsers: allUsers.filter((u) => u.isTestUser && !u.isAdmin).length,
			totalAdventures: allAdventures.length,
			activeSessions: allSessions.filter((s) => s.expiresAt > Date.now()).length,
			expiredSessions: allSessions.filter((s) => s.expiresAt <= Date.now()).length
		},
		adventureDebug: allAdventures.map((a) => ({
			id: a.id,
			name: a.name,
			ownerName: ownerMap[a.ownerId] ?? a.ownerId,
			status: a.status,
			turnsInDb: turnCountMap[a.id] ?? 0,
			...(stateDebugMap[a.id] ?? {
				characterCount: 0,
				npcCount: 0,
				questCount: 0,
				partyLocationId: '—',
				stateVersion: 0,
				nextTurnNumber: 0
			})
		}))
	};
};

// ─── Helper: delete an adventure and all its dependent rows ───────────────────
async function deleteAdventureCascade(adventureId: string) {
	await db.delete(adventureTurns).where(eq(adventureTurns.adventureId, adventureId)).catch(() => {});
	await db.delete(adventureChat).where(eq(adventureChat.adventureId, adventureId)).catch(() => {});
	await db.delete(adventureState).where(eq(adventureState.adventureId, adventureId));
	await db.delete(adventureMembers).where(eq(adventureMembers.adventureId, adventureId));
	await db.delete(adventures).where(eq(adventures.id, adventureId));
}

// ─── Helper: delete a user and all their dependent rows ───────────────────────
async function deleteUserCascade(userId: string) {
	// Delete adventures they own (cascading)
	const owned = await db
		.select({ id: adventures.id })
		.from(adventures)
		.where(eq(adventures.ownerId, userId));
	for (const adv of owned) {
		await deleteAdventureCascade(adv.id);
	}
	// Remove them from adventures they joined as a member
	await db.delete(adventureMembers).where(eq(adventureMembers.userId, userId));
	// Delete their sessions
	await db.delete(sessions).where(eq(sessions.userId, userId));
	// Delete the user
	await db.delete(users).where(eq(users.id, userId));
}

export const actions: Actions = {
	// ── Delete a single adventure ──────────────────────────────
	deleteAdventure: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteAdventureCascade(id);
		return { success: true, action: 'deleteAdventure', id };
	},

	// ── Delete a single user ───────────────────────────────────
	deleteUser: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteUserCascade(id);
		return { success: true, action: 'deleteUser', id };
	},

	// ── Invalidate a single session ────────────────────────────
	invalidateSession: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing id' });
		await db.delete(sessions).where(eq(sessions.id, id));
		return { success: true, action: 'invalidateSession', id };
	},

	// ── Purge all expired sessions ─────────────────────────────
	purgeExpiredSessions: async () => {
		await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
		return { success: true, action: 'purgeExpiredSessions' };
	},

	// ── Invalidate ALL sessions (force everyone to re-login) ───
	clearAllSessions: async () => {
		await db.delete(sessions);
		return { success: true, action: 'clearAllSessions' };
	},

	// ── Delete all adventures in a given status ────────────────
	deleteAdventuresByStatus: async ({ request }) => {
		const form = await request.formData();
		const status = form.get('status')?.toString() as 'lobby' | 'active' | 'completed' | undefined;
		if (!status) return fail(400, { error: 'Missing status' });
		const targets = await db
			.select({ id: adventures.id })
			.from(adventures)
			.where(eq(adventures.status, status));
		for (const adv of targets) {
			await deleteAdventureCascade(adv.id);
		}
		return { success: true, action: 'deleteAdventuresByStatus', status, count: targets.length };
	},

	// ── Delete all test-user data (adventures + sessions, keep accounts) ──
	deleteTestData: async () => {
		const testAccounts = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.isTestUser, true));
		const testIds = testAccounts.map((u) => u.id);

		if (testIds.length > 0) {
			// Adventures owned by test users
			const testAdventures = await db
				.select({ id: adventures.id })
				.from(adventures)
				.where(inArray(adventures.ownerId, testIds));
			for (const adv of testAdventures) {
				await deleteAdventureCascade(adv.id);
			}
			// Sessions
			await db.delete(sessions).where(inArray(sessions.userId, testIds));
		}
		return { success: true, action: 'deleteTestData' };
	},

	// ── Reset an adventure back to lobby status ──────────────────
	resetAdventure: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing id' });
		await db
			.update(adventures)
			.set({ status: 'lobby', updatedAt: Date.now() })
			.where(eq(adventures.id, id));
		await db
			.update(adventureMembers)
			.set({ isReady: false })
			.where(eq(adventureMembers.adventureId, id));
		return { success: true, action: 'resetAdventure', id };
	}
};
