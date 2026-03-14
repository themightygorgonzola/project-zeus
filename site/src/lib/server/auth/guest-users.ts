import { db } from '$server/db/client';
import { users } from '$server/db/schema';
import { ulid } from 'ulid';

const GUEST_NAME_MAX_LENGTH = 32;

export function createGuestName() {
	return `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
}

function sanitizeGuestName(displayName: string | null | undefined) {
	const normalized = (displayName ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, GUEST_NAME_MAX_LENGTH);

	return normalized || createGuestName();
}

export async function createGuestUser(displayName: string | null | undefined) {
	const id = ulid();
	const username = sanitizeGuestName(displayName);

	await db.insert(users).values({
		id,
		googleId: null,
		discordId: null,
		email: null,
		username,
		avatarUrl: null,
		isTestUser: false,
		isAdmin: false,
		createdAt: Date.now()
	});

	return { id, username };
}