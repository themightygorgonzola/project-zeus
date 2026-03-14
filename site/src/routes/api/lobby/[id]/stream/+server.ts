/**
 * SSE stream for a lobby.
 *
 * GET /api/lobby/[id]/stream
 *
 * Opens a long-lived text/event-stream connection.  The server pushes:
 *   - "lobby-update"       full LobbyState whenever something changes
 *   - "adventure-started"  everyone should redirect to the adventure
 *   - ": heartbeat"        keep-alive comment every 15 s
 *
 * The stream auto-cleans-up when the client disconnects (via AbortSignal).
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eventBus } from '$server/realtime/event-bus';
import { getLobbyState } from '$server/realtime/lobby';
import { db } from '$server/db/client';
import { adventureMembers } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';

const HEARTBEAT_MS = 15_000;

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const adventureId = params.id;

	// Verify the caller is a member of this adventure
	const membership = await db
		.select()
		.from(adventureMembers)
		.where(
			and(
				eq(adventureMembers.adventureId, adventureId),
				eq(adventureMembers.userId, locals.user.id)
			)
		)
		.limit(1);
	if (membership.length === 0) {
		error(403, 'Not a member of this adventure');
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			/* ── helper: write an SSE frame ────────────────────── */
			const send = (event: string, data: unknown) => {
				try {
					const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(frame));
				} catch {
					// stream already closed
				}
			};

			/* ── 1. send the current state immediately ─────────── */
			getLobbyState(adventureId).then((state) => {
				if (state) {
					if (state.adventure.status === 'active') {
						send('adventure-started', { adventureId });
					} else {
						send('lobby-update', state);
					}
				}
			});

			/* ── 2. subscribe to future events ─────────────────── */
			const unsubscribe = eventBus.subscribe(adventureId, (event, data) => {
				send(event, data);
			});

			/* ── 3. heartbeat to keep connection alive ─────────── */
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': heartbeat\n\n'));
				} catch {
					cleanup();
				}
			}, HEARTBEAT_MS);

			/* ── 4. cleanup on disconnect ──────────────────────── */
			const cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};

			// The request's AbortSignal fires when the client disconnects
			request.signal.addEventListener('abort', cleanup, { once: true });
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // disable nginx buffering if proxied
		}
	});
};
