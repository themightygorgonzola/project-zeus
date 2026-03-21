import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectQueue: unknown[][] = [];
const mockValidateCharacterInput = vi.fn();
const mockCreateCharacter = vi.fn();
const mockLoadGameState = vi.fn();
const mockSaveGameState = vi.fn();
const mockCreateInitialGameState = vi.fn();

vi.mock('$server/db/client', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(async () => selectQueue.shift() ?? [])
				}))
			}))
		}))
	}
}));

vi.mock('$server/db/schema', () => ({
	adventureMembers: { adventureId: 'adventureId', userId: 'userId' },
	adventures: { id: 'id' }
}));

vi.mock('drizzle-orm', () => ({
	and: (...parts: unknown[]) => parts,
	eq: (left: unknown, right: unknown) => ({ left, right })
}));

vi.mock('$lib/game/character-creation', () => ({
	validateCharacterInput: mockValidateCharacterInput,
	createCharacter: mockCreateCharacter
}));

vi.mock('$lib/game/state', () => ({
	loadGameState: mockLoadGameState,
	saveGameState: mockSaveGameState,
	createInitialGameState: mockCreateInitialGameState
}));

describe('character route', () => {
	beforeEach(() => {
		selectQueue.length = 0;
		mockValidateCharacterInput.mockReset();
		mockCreateCharacter.mockReset();
		mockLoadGameState.mockReset();
		mockSaveGameState.mockReset();
		mockCreateInitialGameState.mockReset();
	});

	it('GET returns the current user character', async () => {
		selectQueue.push(
			[{ adventureId: 'adv-1', userId: 'user-1' }],
			[{ id: 'adv-1', worldSeed: 'seed-1' }]
		);
		mockLoadGameState.mockResolvedValue({
			characters: [
				{ id: 'pc-1', userId: 'user-1', name: 'Hero' },
				{ id: 'pc-2', userId: 'user-2', name: 'Other' }
			]
		});

		const { GET } = await import('./+server');
		const response = await GET({
			params: { id: 'adv-1' },
			locals: { user: { id: 'user-1' } }
		} as never);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ ok: true, character: { id: 'pc-1', userId: 'user-1', name: 'Hero' } });
		expect(mockLoadGameState).toHaveBeenCalledWith('adv-1');
	});

	it('POST returns validation errors for invalid payloads', async () => {
		selectQueue.push(
			[{ adventureId: 'adv-1', userId: 'user-1' }],
			[{ id: 'adv-1', worldSeed: 'seed-1' }]
		);
		mockValidateCharacterInput.mockReturnValue([
			{ field: 'name', message: 'Name is required.' }
		]);

		const { POST } = await import('./+server');
		const response = await POST({
			params: { id: 'adv-1' },
			locals: { user: { id: 'user-1' } },
			request: new Request('http://test.local', {
				method: 'POST',
				body: JSON.stringify({ name: '' }),
				headers: { 'content-type': 'application/json' }
			})
		} as never);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ ok: false, errors: [{ field: 'name', message: 'Name is required.' }] });
		expect(mockCreateCharacter).not.toHaveBeenCalled();
		expect(mockSaveGameState).not.toHaveBeenCalled();
	});

	it('POST creates and persists a character for the authenticated member', async () => {
		selectQueue.push(
			[{ adventureId: 'adv-1', userId: 'user-1' }],
			[{ id: 'adv-1', worldSeed: 'seed-123' }]
		);
		mockValidateCharacterInput.mockReturnValue([]);
		mockLoadGameState.mockResolvedValue(null);
		mockCreateInitialGameState.mockReturnValue({ characters: [], worldSeed: 'seed-123' });
		mockCreateCharacter.mockReturnValue({ id: 'pc-1', userId: 'user-1', name: 'New Hero', classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }] });
		mockSaveGameState.mockResolvedValue(undefined);

		const input = { name: 'New Hero', class: 'fighter', race: 'human' };
		const { POST } = await import('./+server');
		const response = await POST({
			params: { id: 'adv-1' },
			locals: { user: { id: 'user-1' } },
			request: new Request('http://test.local', {
				method: 'POST',
				body: JSON.stringify(input),
				headers: { 'content-type': 'application/json' }
			})
		} as never);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.character.name).toBe('New Hero');
		expect(mockCreateCharacter).toHaveBeenCalledWith(input, 'user-1', 'adv-1');
		expect(mockCreateInitialGameState).toHaveBeenCalledWith('seed-123');
		expect(mockSaveGameState).toHaveBeenCalledWith('adv-1', {
			characters: [{ id: 'pc-1', userId: 'user-1', name: 'New Hero', classes: [{ name: 'fighter', level: 1, hitDiceRemaining: 1 }] }],
			worldSeed: 'seed-123'
		});
	});
});
