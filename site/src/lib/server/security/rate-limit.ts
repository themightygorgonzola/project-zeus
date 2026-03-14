/**
 * Sliding-window rate limiter (in-memory).
 *
 * Works per-instance, which is sufficient for Vercel serverless:
 * each cold start gets a clean window, preventing sustained abuse
 * from a single IP inside a function invocation lifetime.
 *
 * For global rate limiting across instances, you'd put this behind
 * a shared store (Upstash Redis, Turso, etc.).
 */

interface WindowEntry {
	count: number;
	resetAt: number;
}

export class RateLimiter {
	private windows = new Map<string, WindowEntry>();
	private maxRequests: number;
	private windowMs: number;

	constructor(opts: { maxRequests: number; windowMs: number }) {
		this.maxRequests = opts.maxRequests;
		this.windowMs = opts.windowMs;
	}

	/**
	 * Check if a request from `key` (usually IP) is allowed.
	 * Returns `{ allowed, remaining, resetAt }`.
	 */
	check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
		const now = Date.now();
		let entry = this.windows.get(key);

		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + this.windowMs };
			this.windows.set(key, entry);
		}

		entry.count++;

		// Periodic cleanup: every 100 checks, purge stale entries
		if (Math.random() < 0.01) {
			for (const [k, v] of this.windows) {
				if (now >= v.resetAt) this.windows.delete(k);
			}
		}

		return {
			allowed: entry.count <= this.maxRequests,
			remaining: Math.max(0, this.maxRequests - entry.count),
			resetAt: entry.resetAt
		};
	}
}

/** General endpoint limiter: 60 requests per 60 seconds per IP */
export const apiLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60_000 });

/** Auth endpoint limiter: 10 requests per 60 seconds per IP */
export const authLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });
