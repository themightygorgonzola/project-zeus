import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createGuestUser } from '$server/auth/guest-users';
import { normalizeReturnTo } from '$server/auth/return-to';
import { createSession, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '$server/auth/sessions';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const formData = await request.formData();
	const returnTo = normalizeReturnTo(formData.get('returnTo')?.toString() ?? null);

	if (locals.user) {
		redirect(302, returnTo);
	}

	const displayName = formData.get('displayName')?.toString() ?? null;
	const guestUser = await createGuestUser(displayName);
	const token = await createSession(guestUser.id);

	cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

	redirect(302, returnTo);
};