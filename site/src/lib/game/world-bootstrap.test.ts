/**
 * World Bootstrap Tests — verify bootstrapAdventureContent seeds
 * locations, nearby settlements, NPCs, and quest graph correctly.
 */

import { describe, expect, it } from 'vitest';
import { bootstrapAdventureContent, seedStartingLocation, seedNearbyLocations, seedQuestGraph } from './world-bridge';
import { createInitialGameState } from './state';
import type { PrototypeWorld } from '$lib/worldgen/prototype';

function makeMinimalWorld(): PrototypeWorld {
	return {
		seed: 'test-seed',
		engine: { version: '1.0', name: 'test' },
		geography: {
			width: 100,
			height: 100,
			cells: [],
			rivers: [{ i: 1, name: 'Test River', type: 'River', length: 100, discharge: 50 }],
			biomes: [],
			biomeDistribution: [],
			routes: []
		},
		politics: {
			states: [
				{
					i: 1,
					name: 'Testland',
					fullName: 'Kingdom of Testland',
					form: 'Kingdom',
					religion: 1,
					culture: 1,
					area: 50000,
					expansionism: 1.5,
					neighbors: [2],
					diplomacy: ['rival'],
					pole: [50, 50] as [number, number]
				},
				{
					i: 2,
					name: 'Rivalon',
					fullName: 'Republic of Rivalon',
					form: 'Republic',
					religion: 2,
					culture: 2,
					area: 40000,
					expansionism: 1.8,
					neighbors: [1],
					diplomacy: ['rival'],
					pole: [80, 80] as [number, number]
				}
			],
			settlements: [
				{ i: 1, name: 'Testville', state: 1, stateName: 'Testland', group: 'town', culture: 1, population: 2.5, type: 'Generic', x: 50, y: 50, capital: 0 },
				{ i: 2, name: 'Nearton', state: 1, stateName: 'Testland', group: 'village', culture: 1, population: 0.8, type: 'River', x: 55, y: 52, capital: 0 },
				{ i: 3, name: 'Farburg', state: 2, stateName: 'Rivalon', group: 'town', culture: 2, population: 3.0, type: 'Generic', x: 70, y: 65, capital: 0 },
				{ i: 4, name: 'Distant Hold', state: 2, stateName: 'Rivalon', group: 'village', culture: 2, population: 1.2, type: 'Highland', x: 85, y: 80, capital: 0 },
				{ i: 5, name: 'Edgeton', state: 1, stateName: 'Testland', group: 'hamlet', culture: 1, population: 0.3, type: 'Generic', x: 60, y: 55, capital: 0 }
			],
			relations: [
				{ from: 1, to: 2, type: 'rival' },
				{ from: 2, to: 1, type: 'rival' }
			],
			provinces: []
		},
		societies: {
			cultures: [
				{ i: 1, name: 'Testfolk', base: 0, origins: [], shield: 'round' },
				{ i: 2, name: 'Rivalkin', base: 1, origins: [], shield: 'heater' }
			],
			religions: [
				{ i: 1, name: 'Testfaith Way', culture: 1, type: 'Organized', form: 'Way' },
				{ i: 2, name: 'Rival Church', culture: 2, type: 'Organized', form: 'Church' }
			]
		},
		metadata: {
			info: { mapName: 'Test Expanse', width: 100, height: 100, seed: 'test-seed' },
			chronology: { year: 1200, era: 'Test Era' }
		},
		summary: { cultures: 2, states: 2, religions: 2, settlements: 5, routes: 0, rivers: 1, notes: 3 },
		lore: {
			notes: [
				{ id: 'hook-1', name: 'The Stirring', legend: 'Strange creatures stir in the deep.' },
				{ id: 'hook-2', name: 'Border Skirmish', legend: 'Testland and Rivalon contest over Nearton.' },
				{ id: 'hook-3', name: 'The Lost Relic', legend: 'An ancient artifact lies hidden near Farburg.' }
			],
			generatorHints: [],
			campaigns: []
		}
	} as unknown as PrototypeWorld;
}

describe('seedStartingLocation', () => {
	it('creates a location from the world', () => {
		const world = makeMinimalWorld();
		const loc = seedStartingLocation(world);
		expect(loc.id).toBeTruthy();
		expect(loc.name).toBeTruthy();
		expect(loc.visited).toBe(true);
		expect(loc.type).toBe('settlement');
	});
});

describe('seedNearbyLocations', () => {
	it('creates nearby settlements connected to start', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		expect(nearby.length).toBeGreaterThanOrEqual(2);
		expect(nearby.length).toBeLessThanOrEqual(4);
		expect(nearby.every(l => l.visited === false)).toBe(true);
		expect(nearby.every(l => l.connections.includes(startLoc.id))).toBe(true);
	});

	it('returns locations sorted by distance (closest first)', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		// First one should be the closest settlement (Nearton at (55,52))
		expect(nearby[0].name).toBe('Nearton');
	});
});

describe('seedQuestGraph', () => {
	it('creates at least 3 quests with typed objectives', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		const settlement = world.politics.settlements.find((s) => s.i === startLoc.regionRef)!;
		const { quests, npcs } = seedQuestGraph(startLoc, nearby, world, settlement);

		expect(quests.length).toBeGreaterThanOrEqual(3);
		expect(npcs.length).toBeGreaterThanOrEqual(3); // quest givers + tavern keeper

		// Every quest should have typed objectives
		for (const q of quests) {
			expect(q.objectives.length).toBeGreaterThan(0);
			for (const obj of q.objectives) {
				expect(obj.type).toBeDefined();
			}
		}
	});

	it('creates a faction conflict quest when rival relations exist', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		const settlement = world.politics.settlements.find((s) => s.i === startLoc.regionRef)!;
		const { quests } = seedQuestGraph(startLoc, nearby, world, settlement);

		const factionQuest = quests.find(q => q.name.includes('Tensions'));
		expect(factionQuest).toBeDefined();
		expect(factionQuest!.objectives.some(o => o.type === 'visit-location')).toBe(true);
	});

	it('creates a religion quest when different faiths exist nearby', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		const settlement = world.politics.settlements.find((s) => s.i === startLoc.regionRef)!;
		const { quests } = seedQuestGraph(startLoc, nearby, world, settlement);

		const religionQuest = quests.find(q => q.name.includes('Faith'));
		expect(religionQuest).toBeDefined();
	});

	it('links quest objectives to real entity IDs', () => {
		const world = makeMinimalWorld();
		const startLoc = seedStartingLocation(world);
		const nearby = seedNearbyLocations(startLoc, world, 4);
		const settlement = world.politics.settlements.find((s) => s.i === startLoc.regionRef)!;
		const { quests, npcs } = seedQuestGraph(startLoc, nearby, world, settlement);

		// Check that talk-to objectives reference real NPC IDs
		const allNpcIds = new Set(npcs.map(n => n.id));
		const allLocIds = new Set([startLoc.id, ...nearby.map(l => l.id)]);

		for (const q of quests) {
			for (const obj of q.objectives) {
				if (obj.type === 'talk-to' && obj.linkedEntityId) {
					expect(allNpcIds.has(obj.linkedEntityId)).toBe(true);
				}
				if (obj.type === 'visit-location' && obj.linkedEntityId) {
					expect(allLocIds.has(obj.linkedEntityId)).toBe(true);
				}
			}
		}
	});
});

describe('bootstrapAdventureContent', () => {
	it('seeds locations, NPCs, and quest graph into a fresh game state', () => {
		const world = makeMinimalWorld();
		const state = createInitialGameState('test-seed');
		expect(state.locations).toHaveLength(0);
		expect(state.npcs).toHaveLength(0);
		expect(state.quests).toHaveLength(0);

		const bootstrapped = bootstrapAdventureContent(state, world);

		// Start location + nearby settlements
		expect(bootstrapped.locations.length).toBeGreaterThanOrEqual(2);
		expect(bootstrapped.npcs.length).toBeGreaterThanOrEqual(3);
		expect(bootstrapped.quests.length).toBeGreaterThanOrEqual(3);
		expect(bootstrapped.partyLocationId).toBe(bootstrapped.locations[0].id);
	});

	it('wires NPC IDs into the starting location', () => {
		const world = makeMinimalWorld();
		const state = createInitialGameState('test-seed');
		const bootstrapped = bootstrapAdventureContent(state, world);

		const loc = bootstrapped.locations[0];
		expect(loc.npcs.length).toBeGreaterThan(0);
		// Every NPC ID in the location should exist in the NPC list
		for (const npcId of loc.npcs) {
			expect(bootstrapped.npcs.find(n => n.id === npcId)).toBeDefined();
		}
	});

	it('nearby locations start unvisited and connected to start', () => {
		const world = makeMinimalWorld();
		const state = createInitialGameState('test-seed');
		const bootstrapped = bootstrapAdventureContent(state, world);

		const startLoc = bootstrapped.locations[0];
		const nearbyLocs = bootstrapped.locations.slice(1);

		expect(nearbyLocs.length).toBeGreaterThan(0);
		for (const loc of nearbyLocs) {
			expect(loc.visited).toBe(false);
			expect(loc.connections).toContain(startLoc.id);
		}
		// Start location has connections to nearby
		expect(startLoc.connections.length).toBe(nearbyLocs.length);
	});
});
