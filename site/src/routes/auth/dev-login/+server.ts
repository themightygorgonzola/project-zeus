import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$server/db/client';
import { users } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '$server/auth/sessions';
import { ensureDevUsers, isDevAuthEnabled } from '$server/auth/dev-users';
import { normalizeReturnTo } from '$server/auth/return-to';

export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!isDevAuthEnabled()) {
		error(404, 'Development auth is disabled');
	}

	await ensureDevUsers();

	const formData = await request.formData();
	const email = formData.get('email')?.toString();
	const returnTo = normalizeReturnTo(formData.get('returnTo')?.toString() ?? null);

	if (!email) {
		error(400, 'Missing test account');
	}

	const matched = await db.select().from(users).where(eq(users.email, email)).limit(1);

	if (matched.length === 0) {
		error(404, 'Test account not found');
	}

	const token = await createSession(matched[0].id);
	cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

	redirect(302, returnTo);
};
