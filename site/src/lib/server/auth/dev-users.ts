import { env } from '$env/dynamic/private';
import { db } from '$server/db/client';
import { users } from '$server/db/schema';
import { bootstrapDatabase } from '$server/db/bootstrap';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

export interface DevTestUser {
	key: string;
	email: string;
	username: string;
	avatarUrl: string;
	isAdmin?: boolean;
}

export const DEV_TEST_USERS: DevTestUser[] = [
	{
		key: 'gm',
		email: 'gm@local.party',
		username: 'Guildmaster Rowan',
		avatarUrl: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Rowan'
	},
	{
		key: 'fighter',
		email: 'fighter@local.party',
		username: 'Mira Steelbloom',
		avatarUrl: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Mira'
	},
	{
		key: 'rogue',
		email: 'rogue@local.party',
		username: 'Kestrel Vale',
		avatarUrl: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Kestrel'
	},
	{
		key: 'cleric',
		email: 'cleric@local.party',
		username: 'Sister Ilya',
		avatarUrl: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Ilya'
	},
	{
		key: 'admin',
		email: 'admin@local.party',
		username: 'The Admin',
		avatarUrl: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Admin&backgroundColor=ff0000',
		isAdmin: true
	}
];

export function isDevAuthEnabled() {
	return (env.ENABLE_DEV_AUTH ?? 'true').toLowerCase() === 'true';
}

export async function ensureDevUsers() {
	if (!isDevAuthEnabled()) {
		return [];
	}

	await bootstrapDatabase();

	for (const profile of DEV_TEST_USERS) {
		const existing = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);

		if (existing.length === 0) {
			await db.insert(users).values({
				id: ulid(),
				googleId: null,
				discordId: null,
				email: profile.email,
				username: profile.username,
				avatarUrl: profile.avatarUrl,
				isTestUser: true,
				isAdmin: profile.isAdmin ?? false,
				createdAt: Date.now()
			});
		} else {
			await db
				.update(users)
				.set({
					username: profile.username,
					avatarUrl: profile.avatarUrl,
					isTestUser: true,
					isAdmin: profile.isAdmin ?? false
				})
				.where(eq(users.id, existing[0].id));
		}
	}

	const seededUsers = await Promise.all(
		DEV_TEST_USERS.map(async (profile) => {
			const row = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
			return row[0];
		})
	);

	return seededUsers.filter(Boolean);
}
