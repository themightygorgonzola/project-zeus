import { Google } from 'arctic';
import { env } from '$env/dynamic/private';

export function getGoogleProvider(origin?: string) {
	const redirectUri =
		env.GOOGLE_REDIRECT_URI ??
		(origin ? `${origin}/auth/callback/google` : 'http://localhost:5173/auth/callback/google');
	return new Google(
		env.GOOGLE_CLIENT_ID!,
		env.GOOGLE_CLIENT_SECRET!,
		redirectUri
	);
}
