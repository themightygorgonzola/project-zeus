export function normalizeReturnTo(returnTo: string | null | undefined) {
	if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
		return '/adventures';
	}

	return returnTo;
}

export function isLobbyReturnTo(returnTo: string) {
	return /^\/adventures\/[^/]+\/lobby(?:$|[/?#])/.test(returnTo);
}