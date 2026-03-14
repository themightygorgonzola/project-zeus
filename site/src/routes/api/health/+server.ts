import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dbClient } from '$server/db/client';

/**
 * GET /api/health
 *
 * Returns 200 with DB connectivity status. Useful for uptime monitoring
 * and post-deploy verification.
 */
export const GET: RequestHandler = async () => {
	const start = Date.now();
	let dbOk = false;

	try {
		await dbClient.execute('SELECT 1');
		dbOk = true;
	} catch {
		// DB unreachable
	}

	const payload = {
		status: dbOk ? 'ok' : 'degraded',
		db: dbOk ? 'connected' : 'unreachable',
		latencyMs: Date.now() - start,
		timestamp: new Date().toISOString()
	};

	if (!dbOk) {
		return json(payload, { status: 503 });
	}

	return json(payload);
};
