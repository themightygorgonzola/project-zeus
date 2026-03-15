import type { Handle } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { validateSession, SESSION_COOKIE } from '$server/auth/sessions';
import { dbClient } from '$server/db/client';
import { bootstrapDatabase } from '$server/db/bootstrap';
import { apiLimiter, authLimiter } from '$server/security/rate-limit';

// Warm the libsql WebSocket connection at startup so the first real
// request doesn't pay the TCP + TLS handshake cost.
dbClient.execute('SELECT 1').catch(() => {});

// Ensure all tables (including adventure_turns) exist before any request lands.
bootstrapDatabase().catch((e) => console.error('[bootstrap] DB init failed:', e));

function getClientIP(event: Parameters<Handle>[0]['event']): string {
	return (
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		event.getClientAddress()
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const ip = getClientIP(event);

	// ── Rate limiting ────────────────────────────────────
	if (pathname.startsWith('/auth/')) {
		const { allowed, remaining, resetAt } = authLimiter.check(ip);
		if (!allowed) {
			return json(
				{ error: 'Too many requests — slow down' },
				{
					status: 429,
					headers: {
						'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
						'X-RateLimit-Remaining': '0'
					}
				}
			);
		}
	} else if (pathname.startsWith('/api/') && event.request.method === 'POST') {
		const { allowed, remaining, resetAt } = apiLimiter.check(ip);
		if (!allowed) {
			return json(
				{ error: 'Too many requests — slow down' },
				{
					status: 429,
					headers: {
						'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
						'X-RateLimit-Remaining': '0'
					}
				}
			);
		}
	}

	// ── Session validation ───────────────────────────────
	const token = event.cookies.get(SESSION_COOKIE);

	if (token) {
		const result = await validateSession(token);
		if (result) {
			event.locals.user = result.user;
			event.locals.sessionId = result.sessionId;
		} else {
			// Expired or invalid session — clear the cookie
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
			event.locals.user = null;
			event.locals.sessionId = null;
		}
	} else {
		event.locals.user = null;
		event.locals.sessionId = null;
	}

	return resolve(event);
};
