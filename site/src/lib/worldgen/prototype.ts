const BIOMES = [
	'Marine',
	'Wetland',
	'Grassland',
	'Temperate Rainforest',
	'Tropical Seasonal Forest',
	'Highland',
	'Tundra',
	'Taiga',
	'Savanna',
	'Desert'
];

const CULTURE_PREFIXES = ['Ar', 'Bel', 'Cae', 'Dor', 'Eld', 'Fen', 'Gal', 'Hal', 'Ith', 'Jor', 'Ka', 'Lor'];
const CULTURE_SUFFIXES = ['mar', 'dun', 'oria', 'eth', 'gard', 'mere', 'os', 'ara', 'holm', 'en', 'yr'];
const STATE_FORMS = ['Kingdom', 'Republic', 'March', 'Dominion', 'League', 'Empire', 'Principality'];
const RELIGION_FORMS = ['Way', 'Faith', 'Church', 'Covenant', 'Circle', 'Cult'];
const SETTLEMENT_FORMS = ['Port', 'Hold', 'Crossing', 'Ford', 'Reach', 'Gate', 'Spire', 'Watch'];
const ROUTE_GROUPS = ['roads', 'trails', 'searoutes'];

export interface PrototypeWorldSummary {
	cultures: number;
	states: number;
	religions: number;
	settlements: number;
	routes: number;
	rivers: number;
	notes: number;
}

export interface PrototypeWorld {
	engine: string;
	version: string;
	seed: string;
	generatedAt: string;
	metadata: {
		info: {
			mapName: string;
			width: number;
			height: number;
			seed: string;
		};
		chronology: {
			year: number;
			era: string;
		};
	};
	summary: PrototypeWorldSummary;
	geography: {
		biomeDistribution: Array<{ id: number; name: string; count: number }>;
		rivers: Array<{ i: number; name: string; type: string; length: number; discharge: number }>;
		routes: Array<{ i: number; group: string; feature: number; pointCount: number }>;
	};
	societies: {
		cultures: Array<{ i: number; name: string; base: number; shield: string; origins: number[] }>;
		religions: Array<{ i: number; name: string; culture: number; type: string; form: string }>;
	};
	politics: {
		states: Array<{
			i: number;
			name: string;
			form: string;
			fullName: string;
			culture: number;
			religion: number;
			area: number;
			expansionism: number;
			neighbors: number[];
			diplomacy: string[];
			pole: [number, number];
		}>;
		settlements: Array<{
			i: number;
			name: string;
			state: number;
			stateName: string;
			culture: number;
			population: number;
			type: string;
			x: number;
			y: number;
			capital: number;
			group: string;
		}>;
		relations: Array<{ from: number; to: number; type: string }>;
	};
	lore: {
		notes: Array<{ id: string; name: string; legend: string }>;
		generatorHints: string[];
	};
}

export interface WorldSnapshot {
	title: string;
	seed: string;
	year: number | null;
	era: string | null;
	stats: Array<[string, number]>;
	states: string[];
	settlements: string[];
	teaser: string | null;
}

function mulberry32(seed: number) {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function hashSeed(seed: string) {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return (h >>> 0) || 1;
}

function pick<T>(rng: () => number, items: T[]) {
	return items[Math.floor(rng() * items.length)];
}

function int(rng: () => number, min: number, max: number) {
	return Math.floor(rng() * (max - min + 1)) + min;
}

function float(rng: () => number, min: number, max: number, decimals = 2) {
	return Number((min + rng() * (max - min)).toFixed(decimals));
}

function makeName(rng: () => number, extra = '') {
	const name = `${pick(rng, CULTURE_PREFIXES)}${pick(rng, CULTURE_SUFFIXES)}`;
	return extra ? `${name} ${extra}` : name;
}

function relation(rng: () => number) {
	const roll = rng();
	if (roll < 0.18) return 'enemy';
	if (roll < 0.38) return 'rival';
	if (roll < 0.62) return 'neutral';
	if (roll < 0.82) return 'trade';
	return 'ally';
}

export function createWorldSeed() {
	return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function generatePrototypeWorld(seed = createWorldSeed()): PrototypeWorld {
	const normalizedSeed = String(seed);
	const rng = mulberry32(hashSeed(normalizedSeed));
	const cultureCount = int(rng, 6, 12);
	const stateCount = int(rng, 5, 10);
	const religionCount = int(rng, 4, 8);
	const settlementCount = int(rng, 18, 36);
	const routeCount = int(rng, 10, 22);
	const riverCount = int(rng, 4, 12);

	const cultures = Array.from({ length: cultureCount }, (_, index) => ({
		i: index + 1,
		name: makeName(rng),
		base: int(rng, 0, 42),
		shield: pick(rng, ['round', 'heater', 'french', 'spanish']),
		origins: [0]
	}));

	const religions = Array.from({ length: religionCount }, (_, index) => ({
		i: index + 1,
		name: `${makeName(rng)} ${pick(rng, RELIGION_FORMS)}`,
		culture: pick(rng, cultures).i,
		type: pick(rng, ['Organized', 'Cult', 'Folk']),
		form: pick(rng, RELIGION_FORMS)
	}));

	const states = Array.from({ length: stateCount }, (_, index) => {
		const culture = pick(rng, cultures);
		const name = makeName(rng);
		const form = pick(rng, STATE_FORMS);
		return {
			i: index + 1,
			name,
			form,
			fullName: `${name} ${form}`,
			culture: culture.i,
			religion: pick(rng, religions).i,
			area: int(rng, 12000, 98000),
			expansionism: float(rng, 0.8, 2.4, 1),
			neighbors: [] as number[],
			diplomacy: [] as string[],
			pole: [float(rng, 0, 3432, 1), float(rng, 0, 1308, 1)] as [number, number]
		};
	});

	for (const state of states) {
		const otherStates = states.filter((candidate) => candidate.i !== state.i);
		const neighborCount = Math.min(otherStates.length, int(rng, 2, Math.min(5, otherStates.length)));
		const shuffled = [...otherStates].sort(() => rng() - 0.5).slice(0, neighborCount);
		state.neighbors = shuffled.map((candidate) => candidate.i);
		state.diplomacy = shuffled.map(() => relation(rng));
	}

	const settlements = Array.from({ length: settlementCount }, (_, index) => {
		const state = pick(rng, states);
		// Derive population first so we can assign the correct size label from it.
		// Population is stored in thousands (0.2 = 200 people, 28 = 28,000 people).
		const population = float(rng, 0.2, 28, 3);
		const group =
			population < 0.5  ? 'hamlet'  :
			population < 2.0  ? 'village' :
			population < 8.0  ? 'town'    : 'city';
		return {
			i: index + 1,
			name: `${makeName(rng)} ${pick(rng, SETTLEMENT_FORMS)}`,
			state: state.i,
			stateName: state.name,
			culture: state.culture,
			population,
			type: pick(rng, ['River', 'Naval', 'Highland', 'Generic']),
			x: float(rng, 0, 3432, 2),
			y: float(rng, 0, 1308, 2),
			capital: 0,
			group
		};
	});

	states.forEach((state) => {
		const capital = settlements
			.filter((settlement) => settlement.state === state.i)
			.sort((a, b) => b.population - a.population)[0];
		if (capital) capital.capital = 1;
	});

	const routes = Array.from({ length: routeCount }, (_, index) => ({
		i: index,
		group: pick(rng, ROUTE_GROUPS),
		feature: int(rng, 1, 20),
		pointCount: int(rng, 4, 18)
	}));

	const rivers = Array.from({ length: riverCount }, (_, index) => ({
		i: index + 1,
		name: makeName(rng),
		type: 'River',
		length: float(rng, 40, 620, 2),
		discharge: int(rng, 30, 800)
	})).sort((a, b) => b.length - a.length);

	const biomeDistribution = BIOMES.map((name, index) => ({
		id: index,
		name,
		count: int(rng, 80, 1100)
	})).sort((a, b) => b.count - a.count);

	const notes = Array.from({ length: int(rng, 6, 14) }, (_, index) => ({
		id: `hook-${index + 1}`,
		name: `${makeName(rng)} Incident`,
		legend: `${pick(rng, states).name} and ${pick(rng, states).name} contest influence around ${pick(rng, settlements).name}.`
	}));

	return {
		engine: 'prototype-worldgen',
		version: '0.1.0',
		seed: normalizedSeed,
		generatedAt: new Date().toISOString(),
		metadata: {
			info: {
				mapName: `${makeName(rng)} Expanse`,
				width: 3432,
				height: 1308,
				seed: normalizedSeed
			},
			chronology: {
				year: int(rng, 900, 2400),
				era: `${makeName(rng)} Era`
			}
		},
		summary: {
			cultures: cultures.length,
			states: states.length,
			religions: religions.length,
			settlements: settlements.length,
			routes: routes.length,
			rivers: rivers.length,
			notes: notes.length
		},
		geography: {
			biomeDistribution,
			rivers,
			routes
		},
		societies: {
			cultures,
			religions
		},
		politics: {
			states,
			settlements,
			relations: states.flatMap((state) =>
				state.neighbors.map((neighborId, index) => ({
					from: state.i,
					to: neighborId,
					type: state.diplomacy[index]
				}))
			)
		},
		lore: {
			notes,
			generatorHints: [
				'Prototype browser-side generator for hosted testing',
				'Use this structure to validate UI, persistence, and relation rendering'
			]
		}
	};
}

export function toWorldSnapshot(world: PrototypeWorld | null | undefined): WorldSnapshot | null {
	if (!world) return null;

	return {
		title: world.metadata?.info?.mapName ?? 'Generated World',
		seed: world.seed,
		year: world.metadata?.chronology?.year ?? null,
		era: world.metadata?.chronology?.era ?? null,
		stats: Object.entries(world.summary ?? {}) as Array<[string, number]>,
		states: (world.politics?.states ?? []).slice(0, 3).map((state) => state.fullName || state.name),
		settlements: (world.politics?.settlements ?? []).slice(0, 4).map((settlement) => settlement.name),
		teaser: world.lore?.notes?.[0]?.legend ?? null
	};
}
