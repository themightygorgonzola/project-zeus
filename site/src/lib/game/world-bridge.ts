/**
 * Project Zeus — World-to-Adventure Bridge
 *
 * Transforms the macro-level PrototypeWorld into adventure-scale content:
 * starting locations, local NPCs, quest hooks, and a guided-sandbox quest
 * graph seeded from faction conflicts, lore notes, and trade routes.
 *
 * Some of these are deterministic (seed-based), others are AI-assisted
 * (called at adventure start or on-demand as the party explores).
 * Results are persisted into GameState.
 */

import { ulid } from 'ulid';
import type { Location, NPC, Quest, QuestObjective, QuestObjectiveType, Item, GameState, GameId, EncounterTemplateTier } from '$lib/game/types';
import type { PrototypeWorld } from '$lib/worldgen/prototype';
import { getArmor, getGear, getWeapon } from '$lib/game/data';
import { calcSettlementTravelPeriods } from '$lib/game/travel';

// ---------------------------------------------------------------------------
// Starting Location
// ---------------------------------------------------------------------------

/**
 * Pick a suitable starting settlement from the world and create a Location
 * entity for the game state.
 *
 * Preference order: largest city first (most content, most NPCs, most quests).
 * Falls back to largest town if no cities exist, then any settlement.
 */
export function seedStartingLocation(world: PrototypeWorld): Location {
	const byPopDesc = (
		a: PrototypeWorld['politics']['settlements'][0],
		b: PrototypeWorld['politics']['settlements'][0]
	) => b.population - a.population;

	const cities = world.politics.settlements.filter((s) => s.group === 'city').sort(byPopDesc);
	const towns  = world.politics.settlements.filter((s) => s.group === 'town').sort(byPopDesc);
	const pick =
		cities.length > 0 ? cities[0] :
		towns.length  > 0 ? towns[0]  :
		world.politics.settlements.slice().sort(byPopDesc)[0];

	const ownerState = world.politics.states.find((s) => s.i === pick.state);
	const culture = world.societies.cultures.find((c) => c.i === pick.culture);

	return {
		id: ulid(),
		name: pick.name,
		regionRef: pick.i,
		type: 'settlement',
		description: buildSettlementDescription(pick, ownerState, culture, world),
		connections: [],
		npcs: [],
		features: buildSettlementFeatures(pick, ownerState, culture, world),
		visited: true,
		gatePolicy: pick.group === 'city' ? 'guarded-at-night' : pick.group === 'town' ? 'daytime-only' : 'none'
	};
}

function buildSettlementDescription(
	settlement: PrototypeWorld['politics']['settlements'][0],
	state: PrototypeWorld['politics']['states'][0] | undefined,
	culture: PrototypeWorld['societies']['cultures'][0] | undefined,
	world: PrototypeWorld
): string {
	const { name, group, type } = settlement;
	const stateName  = state?.fullName ?? 'unknown lands';
	const cultureName = culture?.name ?? 'the local people';
	const riverName   = world.geography.rivers[0]?.name;
	const religion    = state ? world.societies.religions.find((r) => r.i === state.religion) : null;
	const faithName   = religion?.name;

	// Terrain / approach line — varies with settlement type for sensory variety
	const terrainLine: string = (() => {
		switch (type) {
			case 'River':
				return riverName
					? `The ${riverName} cuts along its edge, busy with flat-bottomed trading barges.`
					: 'A slow river runs alongside it, carrying fishing boats and a well-worn ferry crossing.';
			case 'Naval':
				return 'Stone quays face the harbour mouth, stacked with cargo nets and smelling of salt and tar.';
			case 'Highland':
				return 'The approach road climbs steeply before the buildings appear — the settlement commands a long view of the valley below.';
			default:
				return `The main road from ${stateName} passes directly through its centre.`;
		}
	})();

	switch (group) {
		case 'hamlet':
			return [
				`${name} is a name on a map more than a place — a loose cluster of low-roofed buildings where the track widens briefly before narrowing again.`,
				`A covered well marks the centre. There are no walls, no gates; a few dogs and the smell of woodsmoke are the only greeting.`,
				terrainLine,
				faithName ? `A small ${faithName} shrine stands near the well, its offering bowl worn smooth with years of use.` : ''
			].filter(Boolean).join(' ');

		case 'village':
			return [
				`${name} exists because the road stops here for the night.`,
				`Timber-framed buildings line a main street that widens into a market square, where a well and a handful of regular stalls serve the surrounding farmland.`,
				`A low wooden palisade marks the edge of things — more tradition than defence. The people here are ${cultureName} in custom and regard newcomers with polite caution.`,
				terrainLine,
				faithName ? `The local ${faithName} shrine is the largest building on the square, its door left open through the day.` : ''
			].filter(Boolean).join(' ');

		case 'town':
			return [
				`${name} has the look of a place that grew faster than it planned.`,
				`Stone buildings crowd alongside older timber ones; the market square can hold a proper crowd on guild-day. An earthwork wall rings the trade district, its gates watched but open through daylight hours.`,
				`${cultureName} customs govern trade and hospitality here — contracts mean something, and the tavern keeper knows everyone's business.`,
				terrainLine,
				faithName ? `The ${faithName} hall at the north end of the square doubles as meeting house and minor court.` : '',
				state ? `${state.fullName} authority is visible in the banner above the main gate and the seal on every merchant's licence.` : ''
			].filter(Boolean).join(' ');

		case 'city':
		default:
			return [
				`${name} rises behind stone walls — the outer curtain old and scarred, the inner gates flanked by guards who check papers at their leisure.`,
				`Inside, the city arranges itself in layers: the merchant quarter nearest the gate, packed and loud with calling voices and rolling cart wheels; artisan lanes behind it smelling of smoke and leather and fresh bread; deeper still, the civic buildings of ${stateName} bristle with official seals and armed couriers.`,
				terrainLine,
				faithName ? `The towers of the ${faithName} catch the last light above the roofline, their bells marking the hours the rest of the city lives by.` : '',
				`${cultureName} customs hold here — the old families know it, and newcomers are expected to learn.`
			].filter(Boolean).join(' ');
	}
}

/**
 * Build the features array for a location.
 * Uses architectural and cultural cues — never raw population counts.
 * These features appear in the AI's CURRENT LOCATION prompt and on the map UI.
 */
function buildSettlementFeatures(
	settlement: PrototypeWorld['politics']['settlements'][0],
	state: PrototypeWorld['politics']['states'][0] | undefined,
	culture: PrototypeWorld['societies']['cultures'][0] | undefined,
	world: PrototypeWorld
): string[] {
	const { group, type } = settlement;
	const riverName = world.geography.rivers[0]?.name;
	const religion  = state ? world.societies.religions.find((r) => r.i === state.religion) : null;
	const features: string[] = [];

	// Physical scale cue — what a traveller notices, not a census
	switch (group) {
		case 'hamlet':
			features.push('No walls or defences — buildings cluster around a central well.');
			break;
		case 'village':
			features.push('Market square with a well; weekly stalls serving the surrounding farmland.');
			features.push('Low wooden palisade marks the boundary — more custom than fortification.');
			break;
		case 'town':
			features.push('Earthwork outer wall with watched gates, open through daylight hours.');
			features.push('Market square large enough for guild days and seasonal fairs.');
			break;
		case 'city':
			features.push('Stone curtain walls; outer gate checked by guards, inner gate locked at night.');
			features.push('Multiple merchant, artisan, and civic districts within the walls.');
			break;
	}

	// Terrain / water feature
	switch (type) {
		case 'River':
			features.push(
				riverName
					? `Waterfront district on the ${riverName}; trade barges dock through daylight hours.`
					: 'River-facing docks used by fishing boats and trade traffic.'
			);
			break;
		case 'Naval':
			features.push('Harbour with stone quays; fishing and trade vessels moored regularly.');
			break;
		case 'Highland':
			features.push('Commanding elevated position; steep approach road from the valley below.');
			break;
	}

	// Authority and culture
	if (state)    features.push(`Under ${state.fullName} authority.`);
	if (culture)  features.push(`${culture.name} customs govern trade, contracts, and hospitality.`);
	if (religion) features.push(`${religion.name} faith has a presence here — shrine, hall, or chapel depending on the settlement's means.`);

	return features;
}

// ---------------------------------------------------------------------------
// Nearby Location Pre-seeding
// ---------------------------------------------------------------------------

type SettlementEntry = PrototypeWorld['politics']['settlements'][0];
type StateEntry = PrototypeWorld['politics']['states'][0];

/**
 * Pre-seed 3-5 nearby settlements as game Locations, connected to the starting
 * location. Uses euclidean distance between settlement coordinates.
 * Each location starts unvisited — the party will discover them through travel.
 */
export function seedNearbyLocations(
	startLocation: Location,
	world: PrototypeWorld,
	maxCount = 4
): Location[] {
	const startSettlement = world.politics.settlements.find((s) => s.i === startLocation.regionRef);
	if (!startSettlement) return [];

	// Sort other settlements by distance from start
	const others = world.politics.settlements
		.filter((s) => s.i !== startSettlement.i)
		.map((s) => ({
			settlement: s,
			dist: Math.hypot(s.x - startSettlement.x, s.y - startSettlement.y)
		}))
		.sort((a, b) => a.dist - b.dist)
		.slice(0, maxCount);

	return others.map(({ settlement, dist }) => {
		const ownerState = world.politics.states.find((s) => s.i === settlement.state);
		const culture = world.societies.cultures.find((c) => c.i === settlement.culture);

		const loc: Location = {
			id: ulid(),
			name: settlement.name,
			regionRef: settlement.i,
			type: 'settlement',
			description: buildSettlementDescription(settlement, ownerState, culture, world),
			connections: [startLocation.id], // connected to start
			npcs: [],
			features: buildSettlementFeatures(settlement, ownerState, culture, world),
			visited: false,
			travelPeriods: calcSettlementTravelPeriods(dist),
			gatePolicy: settlement.group === 'city' ? 'guarded-at-night' : settlement.group === 'town' ? 'daytime-only' : 'none'
		};

		return loc;
	});
}

// ---------------------------------------------------------------------------
// Quest Graph Seeding
// ---------------------------------------------------------------------------

/** Helper: build a typed QuestObjective. */
function objective(
	text: string,
	type: QuestObjectiveType,
	linkedEntityId?: GameId,
	linkedEntityName?: string
): QuestObjective {
	return { id: ulid(), text, done: false, type, linkedEntityId, linkedEntityName };
}

/**
 * Seed 3-5 quests derived from PrototypeWorld faction conflicts, lore,
 * trade routes, and religious tensions. Each quest uses typed objectives
 * with linkedEntityId for deterministic auto-tracking.
 *
 * Returns { quests, npcs, extraLocations } — caller adds all three to GameState.
 */
export function seedQuestGraph(
	startLocation: Location,
	nearbyLocations: Location[],
	world: PrototypeWorld,
	startSettlement: SettlementEntry
): { quests: Quest[]; npcs: NPC[]; extraLocations: Location[] } {
	const quests: Quest[] = [];
	const npcs: NPC[] = [];
	const extraLocations: Location[] = [];

	const startState = world.politics.states.find((s) => s.i === startSettlement.state);
	const allLocations = [startLocation, ...nearbyLocations];

	// -----------------------------------------------------------------------
	// Quest 1 — Local Trouble (starter, always present)
	// -----------------------------------------------------------------------
	const questGiver = makeNpc(
		startLocation.id, world, startSettlement, 'quest',
		'quest-giver', 10,
		'A worried elder who has been looking for capable souls to handle a growing problem.',
		'Offers the starter quest. Knows about the local threat but is too old to deal with it personally.'
	);
	npcs.push(questGiver);

	const loreHook = world.lore.notes.length > 0
		? world.lore.notes[0].legend
		: 'Strange creatures have been spotted in the surrounding wilds.';

	// Seed a wilderness location as the investigation target so both the
	// visit-location and defeat-encounter objectives have a linked entity ID.
	// This enables deterministic auto-tracking without relying on AI name-matching.
	const troubleLocationId = ulid();
	const troubleLocation: Location = {
		id: troubleLocationId,
		name: `The Wilds Near ${startSettlement.name}`,
		regionRef: null,
		type: 'wilderness',
		description: `A troubled area near ${startSettlement.name} from which strange disturbances have been reported.`,
		connections: [startLocation.id],
		npcs: [],
		features: [],
		visited: false,
		groundItems: []
	};
	extraLocations.push(troubleLocation);

	quests.push({
		id: ulid(),
		name: `Trouble Near ${startSettlement.name}`,
		giverNpcId: questGiver.id,
		status: 'available',
		description: `The people of ${startSettlement.name} are worried. ${loreHook} Someone needs to investigate and deal with the threat before it grows worse.`,
		objectives: [
			objective(`Speak with ${questGiver.name} to learn about the threat`, 'talk-to', questGiver.id, questGiver.name),
			objective('Investigate the source of the disturbance', 'visit-location', troubleLocationId, troubleLocation.name),
			objective('Defeat the creatures causing the disturbance', 'defeat-encounter', troubleLocationId, troubleLocation.name)
		],
		rewards: { xp: 100, gold: startState ? 25 : 15, items: [], reputationChanges: [{ npcId: questGiver.id, delta: 10 }] },
		recommendedLevel: 1,
		encounterTemplates: ['soldier']
	});

	// -----------------------------------------------------------------------
	// Quest 2 — Faction Conflict (if rival/enemy neighbor exists)
	// -----------------------------------------------------------------------
	const rivalRelation = findRivalRelation(startState, world);
	if (rivalRelation && nearbyLocations.length > 0) {
		const rivalState = world.politics.states.find((s) => s.i === rivalRelation.to);
		const borderLocation = nearbyLocations[0]; // closest nearby settlement

		const scout = makeNpc(
			startLocation.id, world, startSettlement, 'scout',
			'quest-giver', 5,
			`A border scout who watches for ${rivalState?.name ?? 'foreign'} incursions.`,
			`Reports to ${startState?.name ?? 'local'} leadership. Has firsthand knowledge of recent border skirmishes.`
		);
		npcs.push(scout);

		quests.push({
			id: ulid(),
			name: `${rivalState?.name ?? 'Border'} Tensions`,
			giverNpcId: scout.id,
			status: 'available',
			description: `${rivalRelation.type === 'enemy' ? 'Open hostilities' : 'Growing tensions'} between ${startState?.fullName ?? 'the local realm'} and ${rivalState?.fullName ?? 'a rival power'} threaten the border settlements. ${scout.name} needs someone to investigate.`,
			objectives: [
				objective(`Speak with ${scout.name} about the border situation`, 'talk-to', scout.id, scout.name),
				objective(`Travel to ${borderLocation.name} to assess the situation`, 'visit-location', borderLocation.id, borderLocation.name),
				objective('Deal with the hostile patrol', 'defeat-encounter')
			],
			rewards: {
				xp: 150,
				gold: 30,
				items: [],
				reputationChanges: [{ npcId: scout.id, delta: 15 }]
			},
			recommendedLevel: 2,
			encounterTemplates: ['soldier', 'soldier'] as EncounterTemplateTier[]
		});
	}

	// -----------------------------------------------------------------------
	// Quest 3 — Religious/Cultural Tension (if different religion nearby)
	// -----------------------------------------------------------------------
	const religionQuest = buildReligionQuest(startLocation, nearbyLocations, world, startSettlement, startState);
	if (religionQuest) {
		npcs.push(religionQuest.npc);
		quests.push(religionQuest.quest);
	}

	// -----------------------------------------------------------------------
	// Quest 4 — Trade Route Escort / Merchant Problem
	// -----------------------------------------------------------------------
	if (nearbyLocations.length >= 2) {
		const merchantDest = nearbyLocations[1]; // second-closest settlement
		const merchant = makeNpc(
			startLocation.id, world, startSettlement, 'merchant',
			'merchant', 0,
			'A traveling trader who deals in provisions, simple weapons, and the occasional curiosity.',
			`Regularly travels to ${merchantDest.name}. Worried about bandit activity on the road.`
		);
		npcs.push(merchant);

		quests.push({
			id: ulid(),
			name: `Safe Passage to ${merchantDest.name}`,
			giverNpcId: merchant.id,
			status: 'available',
			description: `${merchant.name} needs to deliver goods to ${merchantDest.name} but the roads have become dangerous. The merchant is willing to pay for an escort.`,
			objectives: [
				objective(`Speak with ${merchant.name} about the journey`, 'talk-to', merchant.id, merchant.name),
				objective(`Travel to ${merchantDest.name}`, 'visit-location', merchantDest.id, merchantDest.name),
				objective('Fend off any ambush on the road', 'defeat-encounter')
			],
			rewards: {
				xp: 100,
				gold: 40,
				items: [],
				reputationChanges: [{ npcId: merchant.id, delta: 10 }]
			},
			recommendedLevel: 1,
			encounterTemplates: ['minion', 'minion', 'soldier'] as EncounterTemplateTier[]
		});
	}

	// -----------------------------------------------------------------------
	// Quest 5 — Lore / Ancient Mystery (if enough lore notes)
	// -----------------------------------------------------------------------
	if (world.lore.notes.length >= 3 && nearbyLocations.length >= 3) {
		const ruinsLocation = nearbyLocations[2]; // use a farther settlement
		const loreNote = world.lore.notes[2]; // use a different note than quest 1

		const scholar = makeNpc(
			startLocation.id, world, startSettlement, 'scholar',
			'neutral', 15,
			'A traveling scholar researching ancient legends of this region.',
			`Seeking proof of the "${loreNote.name}". Believes ${ruinsLocation.name} holds clues.`
		);
		npcs.push(scholar);

		quests.push({
			id: ulid(),
			name: loreNote.name,
			giverNpcId: scholar.id,
			status: 'available',
			description: `${scholar.name} is investigating an old legend: ${loreNote.legend} The scholar believes clues can be found near ${ruinsLocation.name}.`,
			objectives: [
				objective(`Speak with ${scholar.name} about the legend`, 'talk-to', scholar.id, scholar.name),
				objective(`Investigate ${ruinsLocation.name} for clues`, 'visit-location', ruinsLocation.id, ruinsLocation.name),
				objective('Recover the ancient artifact', 'find-item', undefined, 'Ancient Artifact')
			],
			rewards: {
				xp: 200,
				gold: 20,
				items: [],
				reputationChanges: [{ npcId: scholar.id, delta: 20 }]
			},
			recommendedLevel: 3,
			encounterTemplates: ['elite'] as EncounterTemplateTier[]
		});
	}

	// Also add a tavern keeper (non-quest NPC for atmosphere)
	const tavernKeeper = makeNpc(
		startLocation.id, world, startSettlement, 'tavern',
		'neutral', 20,
		'The keeper of the local tavern. Friendly, well-informed, and always happy to share rumors over a drink.',
		'Knows local gossip. Can point players toward quests. Has a soft spot for adventurers.'
	);
	npcs.push(tavernKeeper);

	return { quests, npcs, extraLocations };
}

// ---------------------------------------------------------------------------
// Quest Graph Helpers
// ---------------------------------------------------------------------------

/** Find an enemy or rival relation for the starting state. */
function findRivalRelation(
	startState: StateEntry | undefined,
	world: PrototypeWorld
): PrototypeWorld['politics']['relations'][0] | undefined {
	if (!startState) return undefined;
	return world.politics.relations.find(
		(r) => r.from === startState.i && (r.type === 'enemy' || r.type === 'rival')
	);
}

/** Build a religion-tension quest if a nearby settlement has a different faith. */
function buildReligionQuest(
	startLocation: Location,
	nearbyLocations: Location[],
	world: PrototypeWorld,
	startSettlement: SettlementEntry,
	startState: StateEntry | undefined
): { quest: Quest; npc: NPC } | null {
	if (!startState) return null;

	const startReligion = world.societies.religions.find((r) => r.i === startState.religion);
	if (!startReligion) return null;

	// Find a nearby location with a different state religion
	for (const loc of nearbyLocations) {
		const locSettlement = world.politics.settlements.find((s) => s.i === loc.regionRef);
		if (!locSettlement) continue;
		const locState = world.politics.states.find((s) => s.i === locSettlement.state);
		if (!locState || locState.religion === startState.religion) continue;

		const foreignReligion = world.societies.religions.find((r) => r.i === locState.religion);
		if (!foreignReligion) continue;

		const priest = makeNpc(
			startLocation.id, world, startSettlement, 'priest',
			'quest-giver', 5,
			`A ${startReligion.name} priest concerned about the spread of ${foreignReligion.name} influence.`,
			`Devout follower of ${startReligion.name}. Wants to understand — not necessarily oppose — the foreign faith.`
		);

		const quest: Quest = {
			id: ulid(),
			name: `Clash of Faiths`,
			giverNpcId: priest.id,
			status: 'available',
			description: `The ${startReligion.name} and ${foreignReligion.name} have begun to clash in the border regions. ${priest.name} wants someone to investigate the situation in ${loc.name} before it escalates.`,
			objectives: [
				objective(`Speak with ${priest.name} about the religious tensions`, 'talk-to', priest.id, priest.name),
				objective(`Visit ${loc.name} to observe the ${foreignReligion.name} presence`, 'visit-location', loc.id, loc.name),
				objective('Report back on the situation', 'talk-to', priest.id, priest.name)
			],
			rewards: {
				xp: 120,
				gold: 20,
				items: [],
				reputationChanges: [{ npcId: priest.id, delta: 15 }]
			},
			recommendedLevel: 2,
			encounterTemplates: ['soldier'] as EncounterTemplateTier[]
		};

		return { quest, npc: priest };
	}

	return null;
}

// ---------------------------------------------------------------------------
// NPC Factory
// ---------------------------------------------------------------------------

/** Create an NPC from world data with a culture-hashed name. */
function makeNpc(
	locationId: GameId,
	world: PrototypeWorld,
	settlement: SettlementEntry,
	roleKey: string,
	npcRole: NPC['role'],
	disposition: number,
	description: string,
	notes: string
): NPC {
	const culture = world.societies.cultures.find((c) => c.i === settlement.culture);
	const cultureName = culture?.name ?? 'local';

	return {
		id: ulid(),
		name: generateNpcName(cultureName, roleKey),
		role: npcRole,
		locationId,
		disposition,
		description,
		notes,
		alive: true
	};
}

/**
 * Simple name generator based on culture prefix patterns.
 * Good enough for seed NPCs — AI can generate richer names later.
 */
function generateNpcName(cultureName: string, _role: string): string {
	const prefixes = ['Ald', 'Bren', 'Cal', 'Dar', 'Elen', 'Fen', 'Gorm', 'Hild', 'Ira', 'Joss', 'Kael', 'Lorn'];
	const suffixes = ['ric', 'wen', 'mund', 'ith', 'ara', 'ot', 'yn', 'us', 'is', 'en'];

	// Use a hash of the culture name + role to pick deterministically
	let hash = 0;
	const key = cultureName + _role;
	for (let i = 0; i < key.length; i++) {
		hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
	}
	const absHash = Math.abs(hash);

	const prefix = prefixes[absHash % prefixes.length];
	const suffix = suffixes[(absHash >> 4) % suffixes.length];

	return prefix + suffix;
}

// ---------------------------------------------------------------------------
// Starter Items (class-based equipment packs)
// ---------------------------------------------------------------------------

/**
 * Generate starting equipment for a character based on their class.
 * @deprecated Superseded by `ClassDefinition.startingEquipment` + `resolveStartingEquipment()` in character-creation.ts.
 * This function is no longer called; preserved for reference only.
 */
export function starterEquipment(className: string): Item[] {
	const items: Item[] = [];

	const parseCurrencyValue = (cost: string | undefined): number => {
		if (!cost) return 0;
		const match = cost.trim().match(/([0-9.]+)\s*(cp|sp|ep|gp|pp)/i);
		if (!match) return 0;
		const amount = Number(match[1]);
		const denomination = match[2].toLowerCase();
		switch (denomination) {
			case 'cp': return amount / 100;
			case 'sp': return amount / 10;
			case 'ep': return amount / 2;
			case 'gp': return amount;
			case 'pp': return amount * 10;
			default: return amount;
		}
	};

	const weapon = (name: string): Item => {
		const def = getWeapon(name);
		return {
			id: ulid(),
			name,
			category: 'weapon',
			weaponName: def?.name ?? name.toLowerCase().replace(/\s+/g, '-'),
			description: `A standard ${name.toLowerCase()}.`,
			damage: def?.damage ?? '1d4',
			damageType: def?.damageType ?? 'bludgeoning',
			magicBonus: 0,
			properties: def?.properties ?? [],
			range: def?.range,
			equipped: false,
			specialProperties: def?.notes ? [def.notes] : [],
			value: parseCurrencyValue(def?.cost),
			quantity: 1,
			weight: def?.weight ?? 0,
			rarity: 'common',
			attunement: false
		};
	};

	const armor = (name: string): Item => {
		const def = getArmor(name);
		return {
			id: ulid(),
			name,
			category: 'armor',
			armorName: def?.name ?? name.toLowerCase().replace(/\s+/g, '-'),
			description: def?.name === 'shield' ? 'A singular shield, of wood and steel.' : `A suit of ${name.toLowerCase()}.`,
			baseAC: def?.baseAC ?? 10,
			magicBonus: 0,
			equipped: false,
			maxDexBonus: def?.maxDexBonus,
			stealthDisadvantage: def?.stealthDisadvantage,
			value: parseCurrencyValue(def?.cost),
			quantity: 1,
			weight: def?.weight ?? 0,
			rarity: 'common',
			attunement: false
		};
	};

	const misc = (name: string, desc: string): Item => {
		const def = getGear(name);
		return {
			id: ulid(),
			name,
			category: 'misc',
			description: desc,
			notes: def?.description,
			tags: def ? [def.category] : [],
			value: parseCurrencyValue(def?.cost) || 2,
			quantity: 1,
			weight: def?.weight ?? 0,
			rarity: 'common',
			attunement: false
		};
	};

	const potion = (name: string, desc: string, charges = 1): Item => ({
		id: ulid(),
		name,
		category: 'consumable',
		description: desc,
		charges,
		maxCharges: charges,
		effectDescription: 'Restores 2d4+2 hit points when consumed.',
		consumableType: 'potion',
		value: 50,
		quantity: 1,
		weight: 0.5,
		rarity: 'common',
		attunement: false
	});

	switch (className) {
		case 'fighter':
			items.push(weapon('Longsword'));
			items.push(armor('Chain Mail'));
			items.push(armor('Shield'));
			break;
		case 'wizard':
			items.push(weapon('Quarterstaff'));
			items.push(misc('Spellbook', 'A leather-bound tome containing your spells.'));
			items.push(misc('Component Pouch', 'A pouch of material components for casting.'));
			break;
		case 'rogue':
			items.push(weapon('Shortsword'));
			items.push(weapon('Dagger'));
			items.push(armor('Leather Armor'));
			items.push(misc("Thieves' Tools", 'A set of lockpicks and other tools of the trade.'));
			break;
		case 'cleric':
			items.push(weapon('Mace'));
			items.push(armor('Scale Mail'));
			items.push(armor('Shield'));
			items.push(misc('Holy Symbol', 'A sacred symbol of your faith.'));
			break;
		case 'ranger':
			items.push(weapon('Longbow'));
			items.push(weapon('Shortsword'));
			items.push(armor('Leather Armor'));
			break;
		case 'barbarian':
			items.push(weapon('Greataxe'));
			items.push(weapon('Handaxe'));
			break;
		case 'bard':
			items.push(weapon('Rapier'));
			items.push(armor('Leather Armor'));
			items.push(misc('Lute', 'A fine instrument for your performances.'));
			break;
		case 'paladin':
			items.push(weapon('Longsword'));
			items.push(armor('Chain Mail'));
			items.push(armor('Shield'));
			items.push(misc('Holy Symbol', 'A sacred symbol of your oath.'));
			break;
		case 'sorcerer':
			items.push(weapon('Dagger'));
			items.push(misc('Arcane Focus', 'A crystal that channels your innate magic.'));
			break;
		case 'warlock':
			items.push(weapon('Quarterstaff'));
			items.push(armor('Leather Armor'));
			items.push(misc('Arcane Focus', 'A token of your pact.'));
			break;
		case 'druid':
			items.push(weapon('Scimitar'));
			items.push(armor('Leather Armor'));
			items.push(misc('Druidic Focus', 'A totem of the natural world.'));
			break;
		case 'monk':
			items.push(weapon('Shortsword'));
			items.push(weapon('Dart'));
			break;
		default:
			items.push(weapon('Dagger'));
	}

	// Everyone gets some basics
	items.push(misc('Backpack', 'A sturdy adventuring pack.'));
	items.push(misc('Rations (5 days)', 'Dried food and water.'));
	items.push(misc('Torch', 'Provides light for 1 hour.'));
	items.push(potion('Potion of Healing', 'Restores 2d4+2 hit points when drunk.', 1));

	return items;
}

// ---------------------------------------------------------------------------
// Full adventure bootstrap
// ---------------------------------------------------------------------------

/**
 * Initialize the GameState with a starting location, nearby settlements,
 * NPCs, and a quest graph derived from the PrototypeWorld.
 *
 * Called when the adventure transitions from lobby → active (after character
 * creation). Generates 3-5 quests from faction conflicts, lore, trade routes,
 * and religious tensions — all with typed objectives for deterministic tracking.
 */
export function bootstrapAdventureContent(
	state: GameState,
	world: PrototypeWorld
): GameState {
	// 1. Create starting location
	const startLocation = seedStartingLocation(world);
	state.locations.push(startLocation);
	state.partyLocationId = startLocation.id;

	// 2. Pre-seed nearby settlements (unvisited, connected to start)
	const nearbyLocations = seedNearbyLocations(startLocation, world, 4);
	state.locations.push(...nearbyLocations);

	// Wire connections from start location to nearby ones
	startLocation.connections = nearbyLocations.map((l) => l.id);

	// 3. Find the starting settlement for quest generation
	const settlement = world.politics.settlements.find((s) => s.i === startLocation.regionRef)
		?? world.politics.settlements[0];

	// 4. Seed the quest graph (quests + linked NPCs + quest-target locations)
	const { quests, npcs, extraLocations } = seedQuestGraph(startLocation, nearbyLocations, world, settlement);
	state.npcs.push(...npcs);
	state.quests.push(...quests);
	// Push quest-target locations and connect them to the start location
	state.locations.push(...extraLocations);
	for (const loc of extraLocations) {
		if (!startLocation.connections.includes(loc.id)) {
			startLocation.connections.push(loc.id);
		}
	}

	// Wire NPC IDs into the starting location
	const startNpcIds = npcs.filter((n) => n.locationId === startLocation.id).map((n) => n.id);
	startLocation.npcs = startNpcIds;

	return state;
}
