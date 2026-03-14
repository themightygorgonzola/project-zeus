import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGoogleProvider } from '$server/auth/google';
import { generateState, generateCodeVerifier } from 'arctic';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ cookies }) => {
	const google = getGoogleProvider();
	const state = generateState();
	const codeVerifier = generateCodeVerifier();

	cookies.set('google_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 10 // 10 minutes
	});

	cookies.set('google_code_verifier', codeVerifier, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 10
	});

	const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'profile']);

	redirect(302, url.toString());
};
