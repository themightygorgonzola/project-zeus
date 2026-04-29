/**
 * Project Zeus — Travel, Encounters, and Environment Engine
 *
 * Location graph traversal, passage of time, weather generation,
 * random encounter rolls, location discovery, and exit queries.
 *
 * All functions are pure (or use the shared seedable PRNG).
 * No DB or IO dependencies — only game types and the dice engine.
 */

import type {
	GameClock,
	GameId,
	GameState,
	Location,
	LocationType,
	StateChange,
	TimeOfDay
} from './types';
import { rollDie } from './mechanics';
import type { MonsterTier } from './data/monsters';
import { getTemplatesByTier } from './data/monsters';
import type { MonsterTemplate } from './data/monsters';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered time-of-day cycle. */
export const TIME_CYCLE: TimeOfDay[] = ['dawn', 'morning', 'afternoon', 'dusk', 'night'];

/** Number of time periods in a full day. */
export const PERIODS_PER_DAY = TIME_CYCLE.length;

/** Weather types */
export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export const WEATHER_TYPES: WeatherType[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

/** Random encounter chance by location type (percentage 0–100). */
export const ENCOUNTER_CHANCE: Record<LocationType, number> = {
	settlement: 0,
	road: 10,
	wilderness: 20,
	dungeon: 30,
	interior: 5
};

/**
 * Travel time in periods between location type pairs.
 * Key format: "from→to".
 *
 * 5 periods = 1 full day (dawn → morning → afternoon → dusk → night).
 * These are fallback values — Location.travelPeriods overrides these for
 * seeded settlement routes where real map distance is known.
 */
export const TRAVEL_TIME: Record<string, number> = {
	// settlement ↔ settlement: fallback for AI-invented locations (~1 day)
	'settlement→settlement': 5,
	// settlement ↔ wilderness: edge of town to the tree line (a couple hours)
	'settlement→wilderness': 1,
	'wilderness→settlement': 1,
	// settlement ↔ road: road within the settlement (instant)
	'settlement→road': 0,
	'road→settlement': 0,
	// road ↔ wilderness: stepping off the road
	'road→wilderness': 1,
	'wilderness→road': 1,
	// road ↔ road: following a road
	'road→road': 1,
	// wilderness ↔ wilderness: cross-country travel (half a day)
	'wilderness→wilderness': 2,
	// dungeon transitions = 1 period
	'dungeon→dungeon': 1,
	'settlement→dungeon': 1,
	'road→dungeon': 1,
	'wilderness→dungeon': 1,
	'dungeon→settlement': 1,
	'dungeon→road': 1,
	'dungeon→wilderness': 1,
	// interior transitions: stepping indoors is instant; wilderness requires travel
	'interior→interior': 0,
	'settlement→interior': 0,
	'interior→settlement': 0,
	'road→interior': 0,
	'interior→road': 0,
	'wilderness→interior': 1,
	'interior→wilderness': 1,
	'dungeon→interior': 1,
	'interior→dungeon': 1
};

/** Default travel time when no specific pair is defined. */
const DEFAULT_TRAVEL_PERIODS = 2;

/** Storm travel time multiplier. */
export const STORM_TRAVEL_MULTIPLIER = 1.5;

/**
 * Number of consecutive idle turns (no travel or combat) that elapse before
 * the in-game clock automatically advances one period.
 * Represents time passing during conversation, shopping, and local exploration.
 */
export const IDLE_TURNS_PER_PERIOD = 4;

/**
 * Pre-compute settlement-to-settlement travel periods from worldgen coordinate distance.
 * Called by world-bridge at world-seed time to store distance-accurate travel costs.
 *
 * Coordinate space is roughly 0–3432 × 0–1308 units.
 */
export function calcSettlementTravelPeriods(distUnits: number): number {
	if (distUnits <  150) return  2; // nearby — a few hours
	if (distUnits <  400) return  5; // ~1 day
	if (distUnits <  900) return 10; // ~2 days
	if (distUnits < 1800) return 15; // ~3 days
	return 20;                       // remote — 4+ days
}
export const BIOME_WEATHER: Record<string, readonly WeatherType[]> = {
	// Each entry is a flat distribution — pick randomly from the array.
	// Repeated entries increase probability of that weather.
	'Marine': ['clear', 'cloudy', 'rain', 'rain', 'storm', 'fog'],
	'Wetland': ['cloudy', 'rain', 'rain', 'rain', 'fog', 'storm'],
	'Grassland': ['clear', 'clear', 'clear', 'cloudy', 'rain', 'storm'],
	'Temperate Rainforest': ['rain', 'rain', 'rain', 'cloudy', 'fog', 'storm'],
	'Tropical Seasonal Forest': ['clear', 'clear', 'rain', 'rain', 'storm', 'cloudy'],
	'Highland': ['clear', 'cloudy', 'cloudy', 'rain', 'snow', 'fog'],
	'Tundra': ['snow', 'snow', 'snow', 'cloudy', 'clear', 'fog'],
	'Taiga': ['snow', 'snow', 'cloudy', 'clear', 'fog', 'rain'],
	'Savanna': ['clear', 'clear', 'clear', 'clear', 'cloudy', 'rain'],
	'Desert': ['clear', 'clear', 'clear', 'clear', 'clear', 'cloudy']
};

/** Default weather table when biome is unknown. */
const DEFAULT_WEATHER_TABLE: readonly WeatherType[] = ['clear', 'clear', 'cloudy', 'rain', 'storm', 'fog'];

/** Season derived from day count: 90 day seasons. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Encounter template tier by average party level.
 * Returns the appropriate monster tier for random encounters.
 */
export const LEVEL_TO_ENCOUNTER_TIER: Array<{ maxLevel: number; tier: MonsterTier }> = [
	{ maxLevel: 2, tier: 'minion' },
	{ maxLevel: 6, tier: 'soldier' },
	{ maxLevel: 12, tier: 'elite' },
	{ maxLevel: 16, tier: 'boss' },
	{ maxLevel: 20, tier: 'legendary' }
];

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface TravelResult {
	success: boolean;
	reason?: string;
	/** The state changes produced by the travel. */
	stateChanges: StateChange;
	/** How many time periods the travel consumed. */
	periodsElapsed: number;
	/** The new clock state after travel. */
	newClock: GameClock;
	/** Whether weather was generated. */
	weatherGenerated: boolean;
	/** Random encounter result, if any. */
	encounter: RandomEncounterResult | null;
	/** True if the destination gate was sealed and entry was blocked (no movement occurred). */
	gateSealed?: boolean;
	/** True if guards challenged entry at the gate (travel succeeded, roleplay required). */
	gateChallenge?: boolean;
}

export interface RandomEncounterResult {
	triggered: boolean;
	/** The d100 roll that determined the encounter. */
	roll: number;
	/** The chance threshold. */
	threshold: number;
	/** Template selected for the encounter (if triggered). */
	template: MonsterTemplate | null;
	/** The tier chosen. */
	tier: MonsterTier | null;
}

export interface AvailableExit {
	locationId: GameId;
	name: string;
	type: LocationType;
	visited: boolean;
	description: string;
}

export interface DiscoverLocationResult {
	success: boolean;
	reason?: string;
	/** The newly created location. */
	location: Location | null;
	/** The state with the new location added. */
	state: GameState;
}

// ---------------------------------------------------------------------------
// Clock Functions
// ---------------------------------------------------------------------------

/**
 * Get the season from the current day.
 * Day 1-90 = spring, 91-180 = summer, 181-270 = autumn, 271-360 = winter.
 * Wraps after 360 days.
 */
export function getSeason(day: number): Season {
	const dayInYear = ((day - 1) % 360);
	if (dayInYear < 90) return 'spring';
	if (dayInYear < 180) return 'summer';
	if (dayInYear < 270) return 'autumn';
	return 'winter';
}

/**
 * Advance a clock by N time periods.
 * Returns a new GameClock without mutating the input.
 */
export function advanceClock(clock: GameClock, periods: number): GameClock {
	if (periods <= 0) return { ...clock };

	const currentIndex = TIME_CYCLE.indexOf(clock.timeOfDay);
	const totalIndex = currentIndex + periods;
	const newDay = clock.day + Math.floor(totalIndex / PERIODS_PER_DAY);
	const newTimeIndex = totalIndex % PERIODS_PER_DAY;

	return {
		day: newDay,
		timeOfDay: TIME_CYCLE[newTimeIndex],
		weather: clock.weather // weather updated separately
	};
}

/**
 * Advance the clock on a GameState, returning the StateChange.
 * Mutates the state in place (same pattern as state.ts mutators).
 */
export function advanceClockOnState(state: GameState, periods: number): StateChange {
	const from = { ...state.clock };
	const to = advanceClock(state.clock, periods);
	state.clock = to;
	return {
		clockAdvance: { from, to }
	};
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/**
 * Generate weather based on biome and season.
 * Uses the shared PRNG (rollDie).
 */
export function generateWeather(biome?: string, season?: Season): WeatherType {
	const table = biome && BIOME_WEATHER[biome]
		? BIOME_WEATHER[biome]
		: DEFAULT_WEATHER_TABLE;

	// Pick from the table using rollDie
	const index = rollDie(table.length) - 1; // 0-based index

	let weather = table[index];

	// Season adjustments: winter pushes toward snow in cold biomes
	if (season === 'winter' && weather === 'rain') {
		const isColdBiome = biome === 'Tundra' || biome === 'Taiga' || biome === 'Highland';
		if (isColdBiome) {
			weather = 'snow';
		}
	}

	return weather;
}

/**
 * Apply generated weather to a GameState clock.
 * Returns the weather string. Mutates state.clock.weather.
 */
export function applyWeather(state: GameState, biome?: string): WeatherType {
	const season = getSeason(state.clock.day);
	const weather = generateWeather(biome, season);
	state.clock.weather = weather;
	return weather;
}

// ---------------------------------------------------------------------------
// Travel Time Calculation
// ---------------------------------------------------------------------------

/**
 * Get the travel time in periods between two location types.
 */
export function getTravelTime(fromType: LocationType, toType: LocationType, weather?: string): number {
	const key = `${fromType}→${toType}`;
	let periods = TRAVEL_TIME[key] ?? DEFAULT_TRAVEL_PERIODS;

	// Storm multiplier
	if (weather === 'storm') {
		periods = Math.ceil(periods * STORM_TRAVEL_MULTIPLIER);
	}

	return periods;
}

// ---------------------------------------------------------------------------
// Location Graph Queries
// ---------------------------------------------------------------------------

/**
 * Find a location by ID.
 */
export function findLocation(state: GameState, locationId: GameId): Location | undefined {
	return state.locations.find((l) => l.id === locationId);
}

/**
 * Check whether two locations are directly connected.
 */
export function areConnected(state: GameState, fromId: GameId, toId: GameId): boolean {
	const from = findLocation(state, fromId);
	if (!from) return false;
	return from.connections.includes(toId);
}

/**
 * Get available exits from the party's current location.
 * Pure read function for context assembly.
 */
export function getAvailableExits(state: GameState): AvailableExit[] {
	if (!state.partyLocationId) return [];

	const current = findLocation(state, state.partyLocationId);
	if (!current) return [];

	return current.connections
		.map((connId) => {
			const loc = findLocation(state, connId);
			if (!loc) return null;
			return {
				locationId: loc.id,
				name: loc.name,
				type: loc.type,
				visited: loc.visited,
				description: loc.description
			};
		})
		.filter((exit): exit is AvailableExit => exit !== null);
}

/**
 * Get the party's current location.
 */
export function getCurrentLocation(state: GameState): Location | undefined {
	if (!state.partyLocationId) return undefined;
	return findLocation(state, state.partyLocationId);
}

// ---------------------------------------------------------------------------
// Random Encounters
// ---------------------------------------------------------------------------

/**
 * Get the encounter tier appropriate for the party's average level.
 */
export function getEncounterTierForLevel(averageLevel: number): MonsterTier {
	for (const entry of LEVEL_TO_ENCOUNTER_TIER) {
		if (averageLevel <= entry.maxLevel) return entry.tier;
	}
	return 'legendary';
}

/**
 * Get the average level of the party.
 */
export function getAveragePartyLevel(state: GameState): number {
	if (state.characters.length === 0) return 1;
	const total = state.characters.reduce((sum, c) => sum + c.level, 0);
	return Math.max(1, Math.round(total / state.characters.length));
}

/**
 * Roll for a random encounter.
 * Uses the shared PRNG (rollDie to simulate d100).
 */
export function rollRandomEncounter(
	locationType: LocationType,
	averagePartyLevel: number
): RandomEncounterResult {
	const threshold = ENCOUNTER_CHANCE[locationType];

	// Roll d100
	const encounterRoll = rollDie(100);

	if (encounterRoll > threshold) {
		return {
			triggered: false,
			roll: encounterRoll,
			threshold,
			template: null,
			tier: null
		};
	}

	// Encounter triggered — pick a template
	const tier = getEncounterTierForLevel(averagePartyLevel);
	const templates = getTemplatesByTier(tier);

	if (templates.length === 0) {
		return {
			triggered: true,
			roll: encounterRoll,
			threshold,
			template: null,
			tier
		};
	}

	// Pick a random template from the tier
	const templateIndex = rollDie(templates.length) - 1;
	const template = templates[templateIndex];

	return {
		triggered: true,
		roll: encounterRoll,
		threshold,
		template,
		tier
	};
}

// ---------------------------------------------------------------------------
// Travel Between Locations
// ---------------------------------------------------------------------------

/**
 * Travel between two connected locations.
 * Validates connection, calculates travel time, advances clock,
 * generates weather, checks for random encounters, moves party.
 *
 * This function MUTATES the state (same pattern as state.ts mutators).
 */
export function travelBetween(
	state: GameState,
	fromId: GameId,
	toId: GameId,
	biome?: string
): TravelResult {
	// Validate party is at fromId
	if (state.partyLocationId !== fromId) {
		return {
			success: false,
			reason: `Party is not at location ${fromId}.`,
			stateChanges: {},
			periodsElapsed: 0,
			newClock: { ...state.clock },
			weatherGenerated: false,
			encounter: null
		};
	}

	// Validate locations exist
	const from = findLocation(state, fromId);
	const to = findLocation(state, toId);

	if (!from) {
		return {
			success: false,
			reason: `Origin location ${fromId} not found.`,
			stateChanges: {},
			periodsElapsed: 0,
			newClock: { ...state.clock },
			weatherGenerated: false,
			encounter: null
		};
	}

	if (!to) {
		return {
			success: false,
			reason: `Destination location ${toId} not found.`,
			stateChanges: {},
			periodsElapsed: 0,
			newClock: { ...state.clock },
			weatherGenerated: false,
			encounter: null
		};
	}

	// Validate connection
	if (!from.connections.includes(toId)) {
		return {
			success: false,
			reason: `No direct path from "${from.name}" to "${to.name}".`,
			stateChanges: {},
			periodsElapsed: 0,
			newClock: { ...state.clock },
			weatherGenerated: false,
			encounter: null
		};
	}

	// Gate policy: enforce access restrictions by time of day
	if (to.gatePolicy === 'daytime-only') {
		if (state.clock.timeOfDay === 'dusk' || state.clock.timeOfDay === 'night') {
			return {
				success: false,
				reason: `The gates of ${to.name} are sealed at dusk and will not reopen until dawn.`,
				stateChanges: {},
				periodsElapsed: 0,
				newClock: { ...state.clock },
				weatherGenerated: false,
				encounter: null,
				gateSealed: true
			};
		}
	}
	const gateChallenge = to.gatePolicy === 'guarded-at-night' && state.clock.timeOfDay === 'night';

	// Calculate travel time: prefer pre-computed distance-based value if available
	const basePeriods = to.travelPeriods !== undefined
		? to.travelPeriods
		: (TRAVEL_TIME[`${from.type}→${to.type}`] ?? DEFAULT_TRAVEL_PERIODS);
	const periods = state.clock.weather === 'storm'
		? Math.ceil(basePeriods * STORM_TRAVEL_MULTIPLIER)
		: basePeriods;

	// Advance clock
	const clockFrom = { ...state.clock };
	state.clock = advanceClock(state.clock, periods);

	// Generate weather at destination
	const season = getSeason(state.clock.day);
	const weather = generateWeather(biome, season);
	state.clock.weather = weather;

	const clockTo = { ...state.clock };

	// Move party
	const locationFrom = state.partyLocationId;
	state.partyLocationId = toId;

	// Mark destination as visited
	to.visited = true;

	// Check for random encounter (based on destination type)
	const avgLevel = getAveragePartyLevel(state);
	const encounter = rollRandomEncounter(to.type, avgLevel);

	// Build combined state change
	const stateChanges: StateChange = {
		clockAdvance: { from: clockFrom, to: clockTo },
		locationChange: { from: locationFrom, to: toId }
	};

	return {
		success: true,
		stateChanges,
		periodsElapsed: periods,
		newClock: clockTo,
		weatherGenerated: true,
		encounter,
		gateChallenge
	};
}

// ---------------------------------------------------------------------------
// Location Discovery
// ---------------------------------------------------------------------------

/** Name fragments for procedural location names. */
const LOCATION_NAME_PREFIXES = [
	'Hidden', 'Ancient', 'Lost', 'Shadow', 'Misty', 'Dark', 'Fallen', 'Wild',
	'Iron', 'Stone', 'Silver', 'Golden', 'Crystal', 'Thunder', 'Storm', 'Frost'
];

const LOCATION_NAME_NOUNS: Record<LocationType, string[]> = {
	settlement: ['Haven', 'Crossing', 'Hamlet', 'Camp', 'Outpost', 'Rest', 'Hold', 'Village'],
	wilderness: ['Glade', 'Hollow', 'Ridge', 'Marsh', 'Woods', 'Valley', 'Thicket', 'Wastes'],
	dungeon: ['Crypt', 'Ruins', 'Cavern', 'Lair', 'Tomb', 'Vault', 'Keep', 'Depths'],
	road: ['Trail', 'Pass', 'Bridge', 'Ford', 'Crossroads', 'Way', 'Path', 'Route'],
	interior: ['Chamber', 'Hall', 'Room', 'Gallery', 'Sanctum', 'Tower', 'Library', 'Study']
};

const LOCATION_DESCRIPTIONS: Record<LocationType, string[]> = {
	settlement: [
		'A small cluster of buildings emerges from the landscape.',
		'Smoke rises from chimneys of a handful of modest structures.',
		'A traveler\'s waypoint with basic amenities and weary locals.'
	],
	wilderness: [
		'Untamed terrain stretches in all directions, with little sign of civilization.',
		'The wild landscape teems with both beauty and hidden danger.',
		'Nature reigns here, indifferent to the affairs of mortals.'
	],
	dungeon: [
		'A dark entrance yawns before you, exuding an ancient chill.',
		'Crumbling stonework marks the entrance to forgotten depths.',
		'The air grows stale and a faint echo hints at vast spaces below.'
	],
	road: [
		'A worn path cuts through the terrain, marked by the passage of many feet.',
		'The road stretches ahead, offering safer passage between points of interest.',
		'Wheel ruts and bootprints mark this well-traveled route.'
	],
	interior: [
		'An enclosed space with walls that tell stories of their own.',
		'The interior is dimly lit, with furnishings suggesting prior habitation.',
		'A sheltered area separated from the outside world.'
	]
};

/**
 * Generate a procedural location name.
 */
export function generateLocationName(type: LocationType): string {
	const prefixIndex = rollDie(LOCATION_NAME_PREFIXES.length) - 1;
	const nouns = LOCATION_NAME_NOUNS[type];
	const nounIndex = rollDie(nouns.length) - 1;
	return `${LOCATION_NAME_PREFIXES[prefixIndex]} ${nouns[nounIndex]}`;
}

/**
 * Generate a procedural location description.
 */
export function generateLocationDescription(type: LocationType): string {
	const descs = LOCATION_DESCRIPTIONS[type];
	const index = rollDie(descs.length) - 1;
	return descs[index];
}

/**
 * Discover a new location connected to an existing one.
 * Creates a new Location, adds bidirectional connections, appends to state.
 *
 * Mutates the state.
 */
export function discoverLocation(
	state: GameState,
	nearLocationId: GameId,
	overrides?: Partial<Location>
): DiscoverLocationResult {
	const nearLocation = findLocation(state, nearLocationId);
	if (!nearLocation) {
		return {
			success: false,
			reason: `Location ${nearLocationId} not found.`,
			location: null,
			state
		};
	}

	// Determine new location type — varied by what's nearby
	const typePool: LocationType[] = ['wilderness', 'wilderness', 'road', 'settlement', 'dungeon'];
	const typeIndex = rollDie(typePool.length) - 1;
	const type = overrides?.type ?? typePool[typeIndex];

	// Generate name and description
	const name = overrides?.name ?? generateLocationName(type);
	const description = overrides?.description ?? generateLocationDescription(type);

	// Create ID
	const id = overrides?.id ?? `loc-${Date.now()}-${rollDie(10000)}`;

	const newLocation: Location = {
		id,
		name,
		regionRef: overrides?.regionRef ?? null,
		type,
		description,
		connections: [nearLocationId],
		npcs: overrides?.npcs ?? [],
		features: overrides?.features ?? [],
		visited: false
	};

	// Add bidirectional connection
	nearLocation.connections.push(id);

	// Add to state
	state.locations.push(newLocation);

	return {
		success: true,
		location: newLocation,
		state
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple location for testing or initialization.
 */
export function createLocation(
	id: GameId,
	name: string,
	type: LocationType,
	connections: GameId[] = [],
	overrides?: Partial<Location>
): Location {
	return {
		id,
		name,
		regionRef: null,
		type,
		description: `A ${type} called ${name}.`,
		connections,
		npcs: [],
		features: [],
		visited: false,
		...overrides
	};
}

/**
 * Build a simple location graph for testing.
 * Returns the locations array.
 */
export function buildLocationGraph(
	locations: Array<{ id: GameId; name: string; type: LocationType; connections: GameId[] }>
): Location[] {
	return locations.map((l) => createLocation(l.id, l.name, l.type, l.connections));
}
