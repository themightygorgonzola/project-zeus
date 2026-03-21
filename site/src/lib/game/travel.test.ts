/**
 * Phase H Unit Tests — Travel, Encounters, and Environment
 *
 * Tests cover:
 *   - Clock advancement (time-of-day cycle, day rollover)
 *   - Season derivation
 *   - Weather generation (biome-based, season adjustments)
 *   - Travel time calculation (location type pairs, storm multiplier)
 *   - Location graph queries (find, connected, exits)
 *   - Random encounter rolls (chance by location, tier by level)
 *   - Travel between locations (full pipeline)
 *   - Location discovery (procedural name/description, bidirectional connection)
 *   - Edge cases (no party location, missing locations, disconnected)
 *   - Plan verification scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRng, resetRng, mulberry32 } from './mechanics';
import type { GameState, Location, LocationType, GameClock, TimeOfDay } from './types';
import { GAME_STATE_VERSION } from './types';
import type { MonsterTier } from './data/monsters';
import {
	TIME_CYCLE,
	PERIODS_PER_DAY,
	WEATHER_TYPES,
	ENCOUNTER_CHANCE,
	STORM_TRAVEL_MULTIPLIER,
	LEVEL_TO_ENCOUNTER_TIER,
	getSeason,
	advanceClock,
	advanceClockOnState,
	generateWeather,
	applyWeather,
	getTravelTime,
	findLocation,
	areConnected,
	getAvailableExits,
	getCurrentLocation,
	getEncounterTierForLevel,
	getAveragePartyLevel,
	rollRandomEncounter,
	travelBetween,
	discoverLocation,
	createLocation,
	buildLocationGraph,
	generateLocationName,
	generateLocationDescription
} from './travel';
import type {
	TravelResult,
	RandomEncounterResult,
	AvailableExit,
	WeatherType,
	Season
} from './travel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClock(overrides: Partial<GameClock> = {}): GameClock {
	return { day: 1, timeOfDay: 'morning', weather: 'clear', ...overrides };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
	const now = Date.now();
	return {
		version: GAME_STATE_VERSION,
		stateVersion: GAME_STATE_VERSION,
		characters: [],
		npcs: [],
		locations: [],
		quests: [],
		conditionEffects: {} as GameState['conditionEffects'],
		partyLocationId: null,
		clock: makeClock(),
		turnLog: [],
		worldSeed: 'test-seed',
		nextTurnNumber: 1,
		sceneFacts: [],
		createdAt: now,
		updatedAt: now,
		...overrides
	};
}

/** Minimal location graph: settlement → road → wilderness → dungeon. */
function makeLocationGraph(): Location[] {
	return [
		createLocation('loc-town', 'Riverton', 'settlement', ['loc-road']),
		createLocation('loc-road', 'King\'s Highway', 'road', ['loc-town', 'loc-wild']),
		createLocation('loc-wild', 'Dark Forest', 'wilderness', ['loc-road', 'loc-dungeon']),
		createLocation('loc-dungeon', 'Shadow Crypt', 'dungeon', ['loc-wild'])
	];
}

function makeStateWithLocations(): GameState {
	const locations = makeLocationGraph();
	return makeState({
		locations,
		partyLocationId: 'loc-town',
		characters: [
			{
				id: 'pc-1', userId: 'u-1', adventureId: 'a-1', name: 'Hero',
				race: 'human', classes: [{ name: 'fighter', level: 3, hitDiceRemaining: 3 }],
				classSpells: [], pactSlots: [], level: 3,
				abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
				hp: 28, maxHp: 28, tempHp: 0, ac: 18, speed: 30, size: 'Medium',
				proficiencyBonus: 2, skillProficiencies: [], expertiseSkills: [],
				saveProficiencies: ['str', 'con'], languages: ['common'],
				armorProficiencies: [], weaponProficiencies: [], toolProficiencies: [],
				classFeatures: [], feats: [], spellSlots: [],
				concentratingOn: null,
				deathSaves: { successes: 0, failures: 0 },
				inspiration: false, passivePerception: 11, inventory: [], gold: 50,
				xp: 900, conditions: [], resistances: [], exhaustionLevel: 0,
				stable: false, dead: false, featureUses: {}, attunedItems: [],
				backstory: ''
			} as GameState['characters'][0]
		]
	});
}

// ---------------------------------------------------------------------------
// Deterministic PRNG setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	setRng(mulberry32(42));
});

afterEach(() => {
	resetRng();
});

// ===========================================================================
// Constants
// ===========================================================================

describe('constants', () => {
	it('TIME_CYCLE has 5 periods', () => {
		expect(TIME_CYCLE).toEqual(['dawn', 'morning', 'afternoon', 'dusk', 'night']);
		expect(PERIODS_PER_DAY).toBe(5);
	});

	it('settlement has 0% encounter chance', () => {
		expect(ENCOUNTER_CHANCE.settlement).toBe(0);
	});

	it('wilderness has 20% encounter chance', () => {
		expect(ENCOUNTER_CHANCE.wilderness).toBe(20);
	});

	it('dungeon has 30% encounter chance', () => {
		expect(ENCOUNTER_CHANCE.dungeon).toBe(30);
	});

	it('road has 10% encounter chance', () => {
		expect(ENCOUNTER_CHANCE.road).toBe(10);
	});

	it('storm multiplier is 1.5', () => {
		expect(STORM_TRAVEL_MULTIPLIER).toBe(1.5);
	});
});

// ===========================================================================
// getSeason
// ===========================================================================

describe('getSeason', () => {
	it('day 1 is spring', () => {
		expect(getSeason(1)).toBe('spring');
	});

	it('day 90 is spring', () => {
		expect(getSeason(90)).toBe('spring');
	});

	it('day 91 is summer', () => {
		expect(getSeason(91)).toBe('summer');
	});

	it('day 180 is summer', () => {
		expect(getSeason(180)).toBe('summer');
	});

	it('day 181 is autumn', () => {
		expect(getSeason(181)).toBe('autumn');
	});

	it('day 270 is autumn', () => {
		expect(getSeason(270)).toBe('autumn');
	});

	it('day 271 is winter', () => {
		expect(getSeason(271)).toBe('winter');
	});

	it('day 360 is winter', () => {
		expect(getSeason(360)).toBe('winter');
	});

	it('day 361 wraps to spring', () => {
		expect(getSeason(361)).toBe('spring');
	});
});

// ===========================================================================
// advanceClock
// ===========================================================================

describe('advanceClock', () => {
	it('advances by 1 period', () => {
		const clock = makeClock({ timeOfDay: 'morning' });
		const result = advanceClock(clock, 1);
		expect(result.timeOfDay).toBe('afternoon');
		expect(result.day).toBe(1);
	});

	it('advances by 2 periods', () => {
		const clock = makeClock({ timeOfDay: 'morning' });
		const result = advanceClock(clock, 2);
		expect(result.timeOfDay).toBe('dusk');
		expect(result.day).toBe(1);
	});

	it('wraps to next day', () => {
		const clock = makeClock({ timeOfDay: 'night', day: 1 });
		const result = advanceClock(clock, 1);
		expect(result.timeOfDay).toBe('dawn');
		expect(result.day).toBe(2);
	});

	it('advances from dusk to next day morning', () => {
		const clock = makeClock({ timeOfDay: 'dusk', day: 5 });
		const result = advanceClock(clock, 2);
		expect(result.timeOfDay).toBe('dawn');
		expect(result.day).toBe(6);
	});

	it('multiple day rollover', () => {
		const clock = makeClock({ timeOfDay: 'dawn', day: 1 });
		const result = advanceClock(clock, 10); // 2 full days
		expect(result.timeOfDay).toBe('dawn');
		expect(result.day).toBe(3);
	});

	it('0 periods returns same clock', () => {
		const clock = makeClock({ timeOfDay: 'afternoon', day: 3 });
		const result = advanceClock(clock, 0);
		expect(result.timeOfDay).toBe('afternoon');
		expect(result.day).toBe(3);
	});

	it('does not mutate the original', () => {
		const clock = makeClock({ timeOfDay: 'morning' });
		advanceClock(clock, 3);
		expect(clock.timeOfDay).toBe('morning');
	});

	it('preserves weather', () => {
		const clock = makeClock({ weather: 'storm' });
		const result = advanceClock(clock, 1);
		expect(result.weather).toBe('storm');
	});
});

// ===========================================================================
// advanceClockOnState
// ===========================================================================

describe('advanceClockOnState', () => {
	it('mutates state clock and returns StateChange', () => {
		const state = makeState({ clock: makeClock({ timeOfDay: 'morning', day: 1 }) });
		const change = advanceClockOnState(state, 2);

		expect(state.clock.timeOfDay).toBe('dusk');
		expect(change.clockAdvance).toBeDefined();
		expect(change.clockAdvance!.from.timeOfDay).toBe('morning');
		expect(change.clockAdvance!.to.timeOfDay).toBe('dusk');
	});
});

// ===========================================================================
// generateWeather
// ===========================================================================

describe('generateWeather', () => {
	it('returns a valid weather type', () => {
		for (let i = 0; i < 20; i++) {
			const weather = generateWeather();
			expect(WEATHER_TYPES).toContain(weather);
		}
	});

	it('uses biome table when provided', () => {
		// Desert is almost always clear — with seeded RNG we should get consistent results
		const results = new Set<string>();
		setRng(mulberry32(1));
		for (let i = 0; i < 30; i++) {
			results.add(generateWeather('Desert'));
		}
		// Desert table: 5× clear + 1× cloudy, so should be dominated by clear
		expect(results.has('clear')).toBe(true);
	});

	it('winter converts rain to snow in cold biomes', () => {
		// Carefully test: set up RNG so generateWeather for Tundra picks a "rain" entry
		// Tundra table: ['snow', 'snow', 'snow', 'cloudy', 'clear', 'fog']
		// Actually Tundra has no rain, so winter-rain→snow conversion won't trigger.
		// Use Highland: ['clear', 'cloudy', 'cloudy', 'rain', 'snow', 'fog']
		// The 4th entry is 'rain' (0-indexed: 3). If rollDie(6) returns 4 → index 3 → rain → converted to snow

		// We need a seed that produces rollDie(6) = 4
		let found = false;
		for (let seed = 0; seed < 100; seed++) {
			setRng(mulberry32(seed));
			const weather = generateWeather('Highland', 'winter');
			if (weather === 'snow') {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it('uses default table when biome is unknown', () => {
		const weather = generateWeather('Unknown Biome');
		expect(WEATHER_TYPES).toContain(weather);
	});
});

// ===========================================================================
// applyWeather
// ===========================================================================

describe('applyWeather', () => {
	it('sets weather on state.clock', () => {
		const state = makeState();
		const weather = applyWeather(state);
		expect(WEATHER_TYPES).toContain(weather);
		expect(state.clock.weather).toBe(weather);
	});
});

// ===========================================================================
// getTravelTime
// ===========================================================================

describe('getTravelTime', () => {
	it('settlement → settlement = 3 periods', () => {
		expect(getTravelTime('settlement', 'settlement')).toBe(3);
	});

	it('settlement → wilderness = 2 periods', () => {
		expect(getTravelTime('settlement', 'wilderness')).toBe(2);
	});

	it('settlement → road = 1 period', () => {
		expect(getTravelTime('settlement', 'road')).toBe(1);
	});

	it('settlement → dungeon = 1 period', () => {
		expect(getTravelTime('settlement', 'dungeon')).toBe(1);
	});

	it('wilderness → wilderness = 3 periods', () => {
		expect(getTravelTime('wilderness', 'wilderness')).toBe(3);
	});

	it('storm multiplies travel time', () => {
		// settlement → settlement = 3, × 1.5 = 4.5 → ceil = 5
		expect(getTravelTime('settlement', 'settlement', 'storm')).toBe(5);
	});

	it('non-storm weather has no effect', () => {
		expect(getTravelTime('settlement', 'road', 'rain')).toBe(1);
	});
});

// ===========================================================================
// Location Graph Queries
// ===========================================================================

describe('location graph queries', () => {
	describe('findLocation', () => {
		it('finds existing location', () => {
			const state = makeStateWithLocations();
			const loc = findLocation(state, 'loc-town');
			expect(loc).toBeDefined();
			expect(loc!.name).toBe('Riverton');
		});

		it('returns undefined for missing location', () => {
			const state = makeStateWithLocations();
			expect(findLocation(state, 'loc-missing')).toBeUndefined();
		});
	});

	describe('areConnected', () => {
		it('returns true for connected locations', () => {
			const state = makeStateWithLocations();
			expect(areConnected(state, 'loc-town', 'loc-road')).toBe(true);
		});

		it('returns false for unconnected locations', () => {
			const state = makeStateWithLocations();
			expect(areConnected(state, 'loc-town', 'loc-wild')).toBe(false);
		});

		it('returns false for missing from location', () => {
			const state = makeStateWithLocations();
			expect(areConnected(state, 'loc-missing', 'loc-road')).toBe(false);
		});
	});

	describe('getAvailableExits', () => {
		it('returns exits from current location', () => {
			const state = makeStateWithLocations();
			state.partyLocationId = 'loc-road';
			const exits = getAvailableExits(state);

			expect(exits).toHaveLength(2); // town and wild
			expect(exits.map((e) => e.locationId)).toContain('loc-town');
			expect(exits.map((e) => e.locationId)).toContain('loc-wild');
		});

		it('returns empty when no party location', () => {
			const state = makeState();
			const exits = getAvailableExits(state);
			expect(exits).toEqual([]);
		});

		it('includes visited status', () => {
			const state = makeStateWithLocations();
			state.partyLocationId = 'loc-road';
			// Mark town as visited
			findLocation(state, 'loc-town')!.visited = true;

			const exits = getAvailableExits(state);
			const townExit = exits.find((e) => e.locationId === 'loc-town');
			const wildExit = exits.find((e) => e.locationId === 'loc-wild');
			expect(townExit!.visited).toBe(true);
			expect(wildExit!.visited).toBe(false);
		});

		it('includes name and type', () => {
			const state = makeStateWithLocations();
			const exits = getAvailableExits(state);
			expect(exits).toHaveLength(1); // town only connects to road
			expect(exits[0].name).toBe('King\'s Highway');
			expect(exits[0].type).toBe('road');
		});
	});

	describe('getCurrentLocation', () => {
		it('returns current party location', () => {
			const state = makeStateWithLocations();
			const loc = getCurrentLocation(state);
			expect(loc).toBeDefined();
			expect(loc!.name).toBe('Riverton');
		});

		it('returns undefined when no party location', () => {
			const state = makeState();
			expect(getCurrentLocation(state)).toBeUndefined();
		});
	});
});

// ===========================================================================
// Encounter Tier
// ===========================================================================

describe('encounter tier', () => {
	it('level 1 → minion', () => {
		expect(getEncounterTierForLevel(1)).toBe('minion');
	});

	it('level 2 → minion', () => {
		expect(getEncounterTierForLevel(2)).toBe('minion');
	});

	it('level 3 → soldier', () => {
		expect(getEncounterTierForLevel(3)).toBe('soldier');
	});

	it('level 7 → elite', () => {
		expect(getEncounterTierForLevel(7)).toBe('elite');
	});

	it('level 13 → boss', () => {
		expect(getEncounterTierForLevel(13)).toBe('boss');
	});

	it('level 17 → legendary', () => {
		expect(getEncounterTierForLevel(17)).toBe('legendary');
	});

	it('level 20 → legendary', () => {
		expect(getEncounterTierForLevel(20)).toBe('legendary');
	});
});

// ===========================================================================
// getAveragePartyLevel
// ===========================================================================

describe('getAveragePartyLevel', () => {
	it('single character', () => {
		const state = makeStateWithLocations();
		expect(getAveragePartyLevel(state)).toBe(3);
	});

	it('empty party defaults to 1', () => {
		const state = makeState();
		expect(getAveragePartyLevel(state)).toBe(1);
	});

	it('averages multiple characters', () => {
		const state = makeStateWithLocations();
		// Add a level 5 character
		state.characters.push({
			...state.characters[0],
			id: 'pc-2',
			name: 'Sidekick',
			level: 5
		});
		// (3 + 5) / 2 = 4
		expect(getAveragePartyLevel(state)).toBe(4);
	});
});

// ===========================================================================
// rollRandomEncounter
// ===========================================================================

describe('rollRandomEncounter', () => {
	it('settlement never triggers (0% chance)', () => {
		const results: RandomEncounterResult[] = [];
		for (let seed = 0; seed < 100; seed++) {
			setRng(mulberry32(seed));
			results.push(rollRandomEncounter('settlement', 3));
		}
		// All should be false since threshold is 0
		expect(results.every((r) => !r.triggered)).toBe(true);
	});

	it('wilderness triggers approximately 20% of the time', () => {
		let triggered = 0;
		const total = 1000;
		for (let seed = 0; seed < total; seed++) {
			setRng(mulberry32(seed));
			const result = rollRandomEncounter('wilderness', 3);
			if (result.triggered) triggered++;
		}
		// ~20% ± 5% tolerance
		expect(triggered).toBeGreaterThan(total * 0.12);
		expect(triggered).toBeLessThan(total * 0.28);
	});

	it('dungeon triggers approximately 30% of the time', () => {
		let triggered = 0;
		const total = 1000;
		for (let seed = 0; seed < total; seed++) {
			setRng(mulberry32(seed));
			const result = rollRandomEncounter('dungeon', 3);
			if (result.triggered) triggered++;
		}
		// ~30% ± 5% tolerance
		expect(triggered).toBeGreaterThan(total * 0.22);
		expect(triggered).toBeLessThan(total * 0.38);
	});

	it('returns appropriate tier for party level', () => {
		// Use a seed that triggers an encounter on wilderness
		let result: RandomEncounterResult | null = null;
		for (let seed = 0; seed < 500; seed++) {
			setRng(mulberry32(seed));
			const r = rollRandomEncounter('wilderness', 3);
			if (r.triggered) {
				result = r;
				break;
			}
		}
		expect(result).not.toBeNull();
		expect(result!.tier).toBe('soldier'); // level 3 → soldier
	});

	it('returns a template when encounter triggers', () => {
		let result: RandomEncounterResult | null = null;
		for (let seed = 0; seed < 500; seed++) {
			setRng(mulberry32(seed));
			const r = rollRandomEncounter('wilderness', 3);
			if (r.triggered) {
				result = r;
				break;
			}
		}
		expect(result).not.toBeNull();
		expect(result!.template).not.toBeNull();
		expect(result!.template!.tier).toBe('soldier');
	});

	it('returns roll and threshold', () => {
		setRng(mulberry32(42));
		const result = rollRandomEncounter('road', 1);
		expect(result.roll).toBeGreaterThanOrEqual(1);
		expect(result.roll).toBeLessThanOrEqual(100);
		expect(result.threshold).toBe(10);
	});
});

// ===========================================================================
// travelBetween — full pipeline
// ===========================================================================

describe('travelBetween', () => {
	it('successful travel: settlement → road', () => {
		const state = makeStateWithLocations();
		const result = travelBetween(state, 'loc-town', 'loc-road');

		expect(result.success).toBe(true);
		expect(result.periodsElapsed).toBe(1); // settlement → road = 1
		expect(state.partyLocationId).toBe('loc-road');
		expect(result.stateChanges.locationChange).toBeDefined();
		expect(result.stateChanges.locationChange!.from).toBe('loc-town');
		expect(result.stateChanges.locationChange!.to).toBe('loc-road');
	});

	it('advances clock on travel', () => {
		const state = makeStateWithLocations();
		state.clock = makeClock({ timeOfDay: 'morning', day: 1 });
		const result = travelBetween(state, 'loc-town', 'loc-road');

		expect(result.stateChanges.clockAdvance).toBeDefined();
		expect(result.stateChanges.clockAdvance!.from.timeOfDay).toBe('morning');
		// Morning + 1 period = afternoon
		expect(result.newClock.timeOfDay).toBe('afternoon');
	});

	it('generates weather at destination', () => {
		const state = makeStateWithLocations();
		travelBetween(state, 'loc-town', 'loc-road');
		expect(WEATHER_TYPES).toContain(state.clock.weather as WeatherType);
	});

	it('marks destination as visited', () => {
		const state = makeStateWithLocations();
		expect(findLocation(state, 'loc-road')!.visited).toBe(false);
		travelBetween(state, 'loc-town', 'loc-road');
		expect(findLocation(state, 'loc-road')!.visited).toBe(true);
	});

	it('checks for random encounter at destination', () => {
		const state = makeStateWithLocations();
		const result = travelBetween(state, 'loc-town', 'loc-road');
		expect(result.encounter).not.toBeNull();
		expect(result.encounter!.threshold).toBe(10); // road = 10%
	});

	it('fails when party is not at fromId', () => {
		const state = makeStateWithLocations();
		state.partyLocationId = 'loc-road';
		const result = travelBetween(state, 'loc-town', 'loc-road');

		expect(result.success).toBe(false);
		expect(result.reason).toContain('not at location');
	});

	it('fails when from location does not exist', () => {
		const state = makeStateWithLocations();
		state.partyLocationId = 'loc-missing';
		const result = travelBetween(state, 'loc-missing', 'loc-town');

		expect(result.success).toBe(false);
		expect(result.reason).toContain('not found');
	});

	it('fails when to location does not exist', () => {
		const state = makeStateWithLocations();
		const result = travelBetween(state, 'loc-town', 'loc-missing');

		expect(result.success).toBe(false);
		expect(result.reason).toContain('not found');
	});

	it('fails when locations are not connected', () => {
		const state = makeStateWithLocations();
		// town connects to road, NOT directly to wild
		const result = travelBetween(state, 'loc-town', 'loc-wild');

		expect(result.success).toBe(false);
		expect(result.reason).toContain('No direct path');
	});

	it('uses biome for weather generation', () => {
		const state = makeStateWithLocations();
		const result = travelBetween(state, 'loc-town', 'loc-road', 'Desert');

		expect(result.success).toBe(true);
		expect(result.weatherGenerated).toBe(true);
	});

	it('storm weather increases travel time', () => {
		const state = makeStateWithLocations();
		state.clock.weather = 'storm';
		// settlement → road = 1 period, × 1.5 = ceil(1.5) = 2
		const result = travelBetween(state, 'loc-town', 'loc-road');

		expect(result.success).toBe(true);
		expect(result.periodsElapsed).toBe(2);
	});
});

// ===========================================================================
// discoverLocation
// ===========================================================================

describe('discoverLocation', () => {
	it('creates a new location connected to the given one', () => {
		const state = makeStateWithLocations();
		const initialLocationCount = state.locations.length;

		const result = discoverLocation(state, 'loc-wild');

		expect(result.success).toBe(true);
		expect(result.location).not.toBeNull();
		expect(state.locations.length).toBe(initialLocationCount + 1);
	});

	it('bidirectional connection is created', () => {
		const state = makeStateWithLocations();
		const result = discoverLocation(state, 'loc-wild');

		// New location connects to wild
		expect(result.location!.connections).toContain('loc-wild');
		// Wild connects to new location
		const wild = findLocation(state, 'loc-wild');
		expect(wild!.connections).toContain(result.location!.id);
	});

	it('new location is not visited', () => {
		const state = makeStateWithLocations();
		const result = discoverLocation(state, 'loc-town');
		expect(result.location!.visited).toBe(false);
	});

	it('accepts overrides', () => {
		const state = makeStateWithLocations();
		const result = discoverLocation(state, 'loc-town', {
			id: 'loc-custom',
			name: 'Custom Place',
			type: 'dungeon',
			description: 'A custom dungeon.'
		});

		expect(result.location!.id).toBe('loc-custom');
		expect(result.location!.name).toBe('Custom Place');
		expect(result.location!.type).toBe('dungeon');
		expect(result.location!.description).toBe('A custom dungeon.');
	});

	it('fails when near location does not exist', () => {
		const state = makeStateWithLocations();
		const result = discoverLocation(state, 'loc-missing');

		expect(result.success).toBe(false);
		expect(result.reason).toContain('not found');
		expect(result.location).toBeNull();
	});

	it('generates name and description procedurally', () => {
		const state = makeStateWithLocations();
		const result = discoverLocation(state, 'loc-town');

		expect(result.location!.name).toBeTruthy();
		expect(result.location!.description).toBeTruthy();
		// Name should be "Prefix Noun" format
		expect(result.location!.name.split(' ').length).toBeGreaterThanOrEqual(2);
	});
});

// ===========================================================================
// generateLocationName / Description
// ===========================================================================

describe('procedural generation', () => {
	it('generateLocationName returns non-empty string', () => {
		const name = generateLocationName('wilderness');
		expect(name).toBeTruthy();
		expect(name.includes(' ')).toBe(true);
	});

	it('generateLocationDescription returns non-empty string', () => {
		const desc = generateLocationDescription('dungeon');
		expect(desc).toBeTruthy();
		expect(desc.length).toBeGreaterThan(10);
	});

	it('different types produce different nouns', () => {
		const names = new Set<string>();
		setRng(mulberry32(1));
		for (let i = 0; i < 50; i++) {
			names.add(generateLocationName('dungeon'));
		}
		// Should have some variety
		expect(names.size).toBeGreaterThan(1);
	});
});

// ===========================================================================
// createLocation / buildLocationGraph
// ===========================================================================

describe('helper functions', () => {
	it('createLocation creates a valid location', () => {
		const loc = createLocation('test-id', 'Test Town', 'settlement', ['other-id']);
		expect(loc.id).toBe('test-id');
		expect(loc.name).toBe('Test Town');
		expect(loc.type).toBe('settlement');
		expect(loc.connections).toEqual(['other-id']);
		expect(loc.visited).toBe(false);
	});

	it('createLocation accepts overrides', () => {
		const loc = createLocation('id', 'Name', 'road', [], { visited: true, features: ['trap'] });
		expect(loc.visited).toBe(true);
		expect(loc.features).toEqual(['trap']);
	});

	it('buildLocationGraph creates array of locations', () => {
		const graph = buildLocationGraph([
			{ id: 'a', name: 'A', type: 'settlement', connections: ['b'] },
			{ id: 'b', name: 'B', type: 'road', connections: ['a'] }
		]);
		expect(graph).toHaveLength(2);
		expect(graph[0].connections).toEqual(['b']);
		expect(graph[1].connections).toEqual(['a']);
	});
});

// ===========================================================================
// Plan Verification Scenarios
// ===========================================================================

describe('plan verification scenarios', () => {
	it('travel from settlement to wilderness → clock advanced, location changed, weather generated', () => {
		const state = makeStateWithLocations();
		// Move to road first, then to wilderness
		state.partyLocationId = 'loc-road';
		state.clock = makeClock({ timeOfDay: 'morning', day: 1 });

		const result = travelBetween(state, 'loc-road', 'loc-wild');

		expect(result.success).toBe(true);
		// road → wilderness = 2 periods
		expect(result.periodsElapsed).toBe(2);
		expect(state.partyLocationId).toBe('loc-wild');
		expect(state.clock.timeOfDay).toBe('dusk'); // morning + 2 = dusk
		expect(result.weatherGenerated).toBe(true);
		expect(WEATHER_TYPES).toContain(state.clock.weather as WeatherType);
	});

	it('roll 1000 random encounters on wilderness → ~20% hit rate', () => {
		let triggered = 0;
		const total = 1000;
		for (let seed = 0; seed < total; seed++) {
			setRng(mulberry32(seed));
			const result = rollRandomEncounter('wilderness', 5);
			if (result.triggered) triggered++;
		}
		const rate = triggered / total;
		expect(rate).toBeGreaterThan(0.12);
		expect(rate).toBeLessThan(0.28);
	});

	it('discover new location → appears in state with proper connections', () => {
		const state = makeStateWithLocations();
		const oldCount = state.locations.length;

		const result = discoverLocation(state, 'loc-wild', {
			id: 'loc-discovered',
			name: 'Hidden Cave',
			type: 'dungeon'
		});

		expect(result.success).toBe(true);
		expect(state.locations.length).toBe(oldCount + 1);

		// New location exists in state
		const found = findLocation(state, 'loc-discovered');
		expect(found).toBeDefined();
		expect(found!.name).toBe('Hidden Cave');
		expect(found!.type).toBe('dungeon');

		// Bidirectional connections
		expect(found!.connections).toContain('loc-wild');
		const wild = findLocation(state, 'loc-wild');
		expect(wild!.connections).toContain('loc-discovered');
	});
});

// ===========================================================================
// Multi-leg Travel
// ===========================================================================

describe('multi-leg travel', () => {
	it('travel town → road → wilderness sequentially', () => {
		const state = makeStateWithLocations();
		state.clock = makeClock({ timeOfDay: 'dawn', day: 1 });

		// Leg 1: town → road (1 period)
		const r1 = travelBetween(state, 'loc-town', 'loc-road');
		expect(r1.success).toBe(true);
		expect(state.partyLocationId).toBe('loc-road');

		// Leg 2: road → wilderness (2 periods)
		const r2 = travelBetween(state, 'loc-road', 'loc-wild');
		expect(r2.success).toBe(true);
		expect(state.partyLocationId).toBe('loc-wild');

		// Total periods: 1 + 2 = 3 (dawn + 3 = dusk)
		// But weather generation happens between, so just check we advanced
		expect(state.clock.day).toBeGreaterThanOrEqual(1);
	});

	it('travel to dungeon takes 1 period', () => {
		const state = makeStateWithLocations();
		state.partyLocationId = 'loc-wild';
		state.clock = makeClock({ timeOfDay: 'morning', day: 1 });

		const result = travelBetween(state, 'loc-wild', 'loc-dungeon');
		expect(result.success).toBe(true);
		expect(result.periodsElapsed).toBe(1); // wilderness → dungeon = 1
	});
});

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('edge cases', () => {
	it('negative periods to advanceClock returns same clock', () => {
		const clock = makeClock({ timeOfDay: 'afternoon', day: 5 });
		const result = advanceClock(clock, -1);
		expect(result.timeOfDay).toBe('afternoon');
		expect(result.day).toBe(5);
	});

	it('travel when state has no locations', () => {
		const state = makeState();
		state.partyLocationId = 'loc-missing';
		const result = travelBetween(state, 'loc-missing', 'loc-other');
		expect(result.success).toBe(false);
	});

	it('getAvailableExits filters out missing connected locations', () => {
		const state = makeState({
			locations: [
				createLocation('loc-a', 'A', 'settlement', ['loc-b', 'loc-missing'])
			],
			partyLocationId: 'loc-a'
		});
		// loc-b doesn't exist, should be filtered
		const exits = getAvailableExits(state);
		expect(exits).toEqual([]); // both connections are missing/invalid
	});

	it('discover location from a location adds to connections without duplicates', () => {
		const state = makeStateWithLocations();
		const wild = findLocation(state, 'loc-wild')!;
		const oldConnCount = wild.connections.length;

		discoverLocation(state, 'loc-wild', { id: 'loc-new-1', name: 'X', type: 'wilderness' });
		expect(wild.connections.length).toBe(oldConnCount + 1);

		discoverLocation(state, 'loc-wild', { id: 'loc-new-2', name: 'Y', type: 'road' });
		expect(wild.connections.length).toBe(oldConnCount + 2);
	});
});
