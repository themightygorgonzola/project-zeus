import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDiscordProvider } from '$server/auth/discord';
import { db } from '$server/db/client';
import { users } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '$server/auth/sessions';
import { normalizeReturnTo } from '$server/auth/return-to';
import { ulid } from 'ulid';
import type { OAuth2Tokens } from 'arctic';

interface DiscordUser {
	id: string;
	username: string;
	global_name?: string;
	avatar?: string;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const returnTo = normalizeReturnTo(cookies.get('discord_oauth_return_to'));
	const storedState = cookies.get('discord_oauth_state');

	const codeVerifier = cookies.get('discord_code_verifier');

	if (!code || !state || !storedState || state !== storedState || !codeVerifier) {
		error(400, 'Invalid OAuth state');
	}

	const discord = getDiscordProvider(url.origin);
	let tokens: OAuth2Tokens;

	try {
		tokens = await discord.validateAuthorizationCode(code, codeVerifier);
	} catch {
		error(400, 'Failed to validate authorization code');
	}

	// Fetch Discord user profile
	const profileResponse = await fetch('https://discord.com/api/v10/users/@me', {
		headers: { Authorization: `Bearer ${tokens.accessToken()}` }
	});

	if (!profileResponse.ok) {
		error(500, 'Failed to fetch Discord profile');
	}

	const profile: DiscordUser = await profileResponse.json();
	const discordId = profile.id;
	const username = profile.global_name ?? profile.username;
	const avatarUrl = profile.avatar
		? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
		: null;

	// Upsert user
	let existing = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);

	let userId: string;
	if (existing.length > 0) {
		userId = existing[0].id;
		await db.update(users).set({ username, avatarUrl }).where(eq(users.id, userId));
	} else {
		userId = ulid();
		await db.insert(users).values({
			id: userId,
			discordId,
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
	cookies.delete('discord_oauth_state', { path: '/' });
	cookies.delete('discord_code_verifier', { path: '/' });
	cookies.delete('discord_oauth_return_to', { path: '/' });

	redirect(302, returnTo);
};
