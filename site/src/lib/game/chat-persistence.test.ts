/**
 * Chat Persistence & Transport Tests
 * Tests for: parseMentions, chat persistence flow, transcript hydration,
 * and the streaming buffer fix for GM mode.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// parseMentions — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe('parseMentions', () => {
	let parseMentions: typeof import('./state').parseMentions;

	beforeEach(async () => {
		const mod = await import('./state');
		parseMentions = mod.parseMentions;
	});

	it('extracts @gm mention', () => {
		expect(parseMentions('Hey @gm can you help?')).toEqual(['gm']);
	});

	it('extracts multiple mentions', () => {
		const result = parseMentions('@gm @Elara check this out @Bob');
		expect(result).toContain('gm');
		expect(result).toContain('elara');
		expect(result).toContain('bob');
		expect(result).toHaveLength(3);
	});

	it('returns empty for no mentions', () => {
		expect(parseMentions('Just a normal message')).toEqual([]);
	});

	it('deduplicates repeated mentions', () => {
		expect(parseMentions('@gm @GM @Gm please')).toEqual(['gm']);
	});

	it('handles mentions at boundaries', () => {
		expect(parseMentions('@start middle @end')).toEqual(['start', 'end']);
	});

	it('handles alphanumeric mentions', () => {
		expect(parseMentions('@player123 said something')).toEqual(['player123']);
	});

	it('ignores bare @ symbol', () => {
		expect(parseMentions('email@ or @ alone')).toEqual([]);
	});

	it('handles underscore usernames', () => {
		expect(parseMentions('@dark_knight attacks')).toEqual(['dark_knight']);
	});
});

// ---------------------------------------------------------------------------
// Chat persistence (needs DB mocking)
// ---------------------------------------------------------------------------

const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbBatch = vi.fn();

vi.mock('$lib/server/db/client', () => ({
	db: {
		insert: (...args: unknown[]) => mockDbInsert(...args),
		select: (...args: unknown[]) => mockDbSelect(...args),
		update: (...args: unknown[]) => mockDbUpdate(...args),
		batch: (...args: unknown[]) => mockDbBatch(...args)
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	adventureState: { adventureId: 'adventureId', stateJson: 'stateJson', updatedAt: 'updatedAt' },
	adventureTurns: {
		adventureId: 'adventureId', id: 'id', turnNumber: 'turnNumber',
		actorType: 'actorType', actorId: 'actorId', action: 'action',
		intent: 'intent', status: 'status', resolvedSummary: 'resolvedSummary',
		mechanicsJson: 'mechanicsJson', stateChangesJson: 'stateChangesJson',
		narrativeText: 'narrativeText', createdAt: 'createdAt'
	},
	adventureChat: {
		id: 'id', adventureId: 'adventureId', userId: 'userId',
		username: 'username', text: 'text', mentionsJson: 'mentionsJson',
		retroInvoked: 'retroInvoked', consumedByTurn: 'consumedByTurn',
		createdAt: 'createdAt'
	}
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
	and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
	gt: vi.fn((a, b) => ({ op: 'gt', a, b })),
	desc: vi.fn((col) => ({ op: 'desc', col }))
}));

describe('persistChatMessage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbInsert.mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined)
		});
	});

	it('persists a chat message with parsed mentions', async () => {
		const { persistChatMessage } = await import('./state');
		const record = await persistChatMessage(
			'adv-1',
			'user-1',
			'Gandalf',
			'@gm I cast fireball',
			'chat-id-1'
		);

		expect(record.id).toBe('chat-id-1');
		expect(record.adventureId).toBe('adv-1');
		expect(record.userId).toBe('user-1');
		expect(record.username).toBe('Gandalf');
		expect(record.text).toBe('@gm I cast fireball');
		expect(record.mentions).toEqual(['gm']);
		expect(record.retroInvoked).toBe(false);
		expect(record.consumedByTurn).toBeNull();
		expect(mockDbInsert).toHaveBeenCalled();
	});

	it('generates a ULID when no id is provided', async () => {
		const { persistChatMessage } = await import('./state');
		const record = await persistChatMessage(
			'adv-2',
			'user-2',
			'Frodo',
			'Just walking'
		);

		expect(record.id).toBeTruthy();
		expect(record.id.length).toBeGreaterThan(0);
	});

	it('persists message with no mentions', async () => {
		const { persistChatMessage } = await import('./state');
		const record = await persistChatMessage(
			'adv-1',
			'user-1',
			'Sam',
			'Lovely potatoes',
			'chat-id-2'
		);

		expect(record.mentions).toEqual([]);
	});

	it('persists message with multiple mentions', async () => {
		const { persistChatMessage } = await import('./state');
		const record = await persistChatMessage(
			'adv-1',
			'user-1',
			'Aragorn',
			'@gm @legolas @gimli lets go',
			'chat-id-3'
		);

		expect(record.mentions).toContain('gm');
		expect(record.mentions).toContain('legolas');
		expect(record.mentions).toContain('gimli');
	});
});

describe('loadRecentChat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns chat records in chronological order', async () => {
		const mockRows = [
			{
				id: 'chat-2', adventureId: 'adv-1', userId: 'u1', username: 'A',
				text: 'second', mentionsJson: '[]', retroInvoked: false,
				consumedByTurn: null, createdAt: 2000
			},
			{
				id: 'chat-1', adventureId: 'adv-1', userId: 'u2', username: 'B',
				text: 'first', mentionsJson: '["gm"]', retroInvoked: false,
				consumedByTurn: null, createdAt: 1000
			}
		];

		mockDbSelect.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue(mockRows)
					})
				})
			})
		});

		const { loadRecentChat } = await import('./state');
		const records = await loadRecentChat('adv-1', 50);

		// Should be reversed to chronological (oldest first)
		expect(records[0].id).toBe('chat-1');
		expect(records[1].id).toBe('chat-2');
		expect(records[0].mentions).toEqual(['gm']);
	});
});

describe('loadUnconsumedChat', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns only unconsumed messages', async () => {
		const mockRows = [
			{
				id: 'chat-3', adventureId: 'adv-1', userId: 'u1', username: 'A',
				text: 'pending msg', mentionsJson: '["gm"]', retroInvoked: false,
				consumedByTurn: null, createdAt: 3000
			}
		];

		mockDbSelect.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockResolvedValue(mockRows)
				})
			})
		});

		const { loadUnconsumedChat } = await import('./state');
		const records = await loadUnconsumedChat('adv-1');

		expect(records).toHaveLength(1);
		expect(records[0].text).toBe('pending msg');
		expect(records[0].mentions).toEqual(['gm']);
	});
});

describe('markChatConsumed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbUpdate.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});
	});

	it('marks multiple messages as consumed', async () => {
		const { markChatConsumed } = await import('./state');
		await markChatConsumed(['chat-1', 'chat-2', 'chat-3'], 5);

		expect(mockDbUpdate).toHaveBeenCalledTimes(3);
	});

	it('is a no-op for empty array', async () => {
		const { markChatConsumed } = await import('./state');
		await markChatConsumed([], 5);

		expect(mockDbUpdate).not.toHaveBeenCalled();
	});
});

describe('markChatRetroInvoked', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbUpdate.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});
	});

	it('marks a specific message as retro-invoked', async () => {
		const { markChatRetroInvoked } = await import('./state');
		await markChatRetroInvoked('chat-42');

		expect(mockDbUpdate).toHaveBeenCalledTimes(1);
	});
});
