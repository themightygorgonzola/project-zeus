import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGoogleProvider } from '$server/auth/google';
import { db } from '$server/db/client';
import { users } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '$server/auth/sessions';
import { ulid } from 'ulid';
import { decodeIdToken } from 'arctic';
import type { OAuth2Tokens } from 'arctic';

interface GoogleClaims {
	sub: string;
	name?: string;
	picture?: string;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('google_oauth_state');
	const codeVerifier = cookies.get('google_code_verifier');

	if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
		error(400, 'Invalid OAuth state');
	}

	const google = getGoogleProvider(url.origin);
	let tokens: OAuth2Tokens;

	try {
		tokens = await google.validateAuthorizationCode(code, codeVerifier);
	} catch {
		error(400, 'Failed to validate authorization code');
	}

	const claims = decodeIdToken(tokens.idToken()) as GoogleClaims;
	const googleId = claims.sub;
	const username = claims.name ?? 'Adventurer';
	const avatarUrl = claims.picture ?? null;

	// Upsert user
	let existing = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

	let userId: string;
	if (existing.length > 0) {
		userId = existing[0].id;
		// Update profile info
		await db
			.update(users)
			.set({ username, avatarUrl })
			.where(eq(users.id, userId));
	} else {
		userId = ulid();
		await db.insert(users).values({
			id: userId,
			googleId,
			email: null,
			username,
			avatarUrl,
			isTestUser: false,
			isAdmin: false,
			createdAt: Date.now()
		});
	}

	// Create session
	const token = await createSession(userId);

	cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
	cookies.delete('google_oauth_state', { path: '/' });
	cookies.delete('google_code_verifier', { path: '/' });

	redirect(302, '/adventures');
};
