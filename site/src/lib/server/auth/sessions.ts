import { db } from '$server/db/client';
import { sessions, users } from '$server/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import type { User } from '$types';
import { dev } from '$app/environment';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Generate a cryptographically random session token.
 */
function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new session for a user. Returns the session token (to be set as a cookie).
 */
export async function createSession(userId: string): Promise<string> {
	const token = generateToken();
	const expiresAt = Date.now() + SESSION_DURATION_MS;

	await db.insert(sessions).values({
		id: token,
		userId,
		expiresAt
	});

	return token;
}

/**
 * Validate a session token. Returns the user if valid, null otherwise.
 * Automatically extends sessions that are past the halfway mark.
 */
export async function validateSession(
	token: string
): Promise<{ user: User; sessionId: string } | null> {
	const result = await db
		.select({
			session: sessions,
			user: users
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, token), gt(sessions.expiresAt, Date.now())))
		.limit(1);

	if (result.length === 0) return null;

	const { session, user } = result[0];

	// Extend session if past halfway
	const halfLife = SESSION_DURATION_MS / 2;
	if (session.expiresAt - Date.now() < halfLife) {
		await db
			.update(sessions)
			.set({ expiresAt: Date.now() + SESSION_DURATION_MS })
			.where(eq(sessions.id, token));
	}

	return {
		sessionId: session.id,
		user: {
			id: user.id,
			username: user.username,
			avatarUrl: user.avatarUrl,
			googleId: user.googleId,
			discordId: user.discordId,
			email: user.email,
			isTestUser: user.isTestUser,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt
		}
	};
}

/**
 * Delete a session (sign out).
 */
export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, token));
}

/** Cookie name for the session token */
export const SESSION_COOKIE = 'session';

/** Cookie options for the session */
export const SESSION_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: !dev,
	maxAge: SESSION_DURATION_MS / 1000 // seconds
};
