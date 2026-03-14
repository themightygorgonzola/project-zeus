import type { PageServerLoad } from './$types';
import { createGuestName } from '$server/auth/guest-users';
import { ensureDevUsers, isDevAuthEnabled } from '$server/auth/dev-users';
import { isLobbyReturnTo, normalizeReturnTo } from '$server/auth/return-to';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals, url }) => {
	const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
	const allowGuestJoin = isLobbyReturnTo(returnTo);

	if (locals.user) {
		redirect(302, returnTo);
	}

	const devAuthEnabled = isDevAuthEnabled();
	const allDevUsers = devAuthEnabled ? await ensureDevUsers() : [];
	const testUsers = allDevUsers.filter((u) => !u.isAdmin);
	const adminUser = allDevUsers.find((u) => u.isAdmin) ?? null;

	return {
		devAuthEnabled,
		testUsers,
		adminUser,
		allowGuestJoin,
		defaultGuestName: allowGuestJoin ? createGuestName() : null,
		returnTo
	};
};
