import { Discord } from 'arctic';
import { env } from '$env/dynamic/private';

export function getDiscordProvider(origin?: string) {
	const redirectUri =
		env.DISCORD_REDIRECT_URI ??
		(origin ? `${origin}/auth/callback/discord` : 'http://localhost:5173/auth/callback/discord');
	return new Discord(
		env.DISCORD_CLIENT_ID!,
		env.DISCORD_CLIENT_SECRET!,
		redirectUri
	);
}
