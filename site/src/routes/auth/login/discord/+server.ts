import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDiscordProvider } from '$server/auth/discord';
import { generateState, generateCodeVerifier } from 'arctic';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ cookies }) => {
	const discord = getDiscordProvider();
	const state = generateState();
	const codeVerifier = generateCodeVerifier();

	cookies.set('discord_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 10
	});

	cookies.set('discord_code_verifier', codeVerifier, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 10
	});

	const url = discord.createAuthorizationURL(state, codeVerifier, ['identify']);

	redirect(302, url.toString());
};
