import type { LayoutServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
	}

	if (!locals.user.isAdmin) {
		error(403, 'Admin access required');
	}

	return { user: locals.user };
};
