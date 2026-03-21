/**
 * Project Zeus — World-to-Adventure Bridge
 *
 * Transforms the macro-level PrototypeWorld into adventure-scale content:
 * starting locations, local NPCs, quest hooks.
 *
 * Some of these are deterministic (seed-based), others are AI-assisted
 * (called at adventure start or on-demand as the party explores).
 * Results are persisted into GameState.
 */

import { ulid } from 'ulid';
import type { Location, NPC, Quest, QuestObjective, Item, GameState, GameId } from '$lib/game/types';
import type { PrototypeWorld } from '$lib/worldgen/prototype';
import { getArmor, getGear, getWeapon } from '$lib/game/data';

// ---------------------------------------------------------------------------
// Starting Location
// ---------------------------------------------------------------------------

/**
 * Pick a suitable starting settlement from the world and create a Location
 * entity for the game state.
 *
 * Heuristic: prefer a mid-sized settlement (village/town) that isn't a capital.
 * Falls back to the first settlement if nothing else fits.
 */
export function seedStartingLocation(world: PrototypeWorld): Location {
	const candidates = world.politics.settlements
		.filter((s) => s.group === 'village' || s.group === 'town')
		.filter((s) => !s.capital);

	const pick = candidates.length > 0 ? candidates[0] : world.politics.settlements[0];

	const ownerState = world.politics.states.find((s) => s.i === pick.state);
	const culture = world.societies.cultures.find((c) => c.i === pick.culture);

	const description = buildSettlementDescription(pick, ownerState, culture, world);

	return {
		id: ulid(),
		name: pick.name,
		regionRef: pick.i,
		type: 'settlement',
		description,
		connections: [],
		npcs: [],
		features: [
			`A ${pick.group} of about ${Math.round(pick.population * 1000).toLocaleString('en')} people.`,
			ownerState ? `Under the rule of ${ownerState.fullName}.` : '',
			culture ? `The locals follow ${culture.name} customs.` : ''
		].filter(Boolean),
		visited: true
	};
}

function buildSettlementDescription(
	settlement: PrototypeWorld['politics']['settlements'][0],
	state: PrototypeWorld['politics']['states'][0] | undefined,
	culture: PrototypeWorld['societies']['cultures'][0] | undefined,
	world: PrototypeWorld
): string {
	const parts: string[] = [];

	parts.push(`${settlement.name} is a ${settlement.group} nestled in the lands of ${state?.fullName ?? 'an unknown realm'}.`);

	if (culture) {
		parts.push(`Its people follow the traditions of the ${culture.name}.`);
	}

	// Find a nearby river
	const nearbyRiver = world.geography.rivers[0];
	if (nearbyRiver) {
		parts.push(`The ${nearbyRiver.name} flows nearby.`);
	}

	// Mention any relevant religions
	if (state) {
		const religion = world.societies.religions.find((r) => r.i === state.religion);
		if (religion) {
			parts.push(`The ${religion.name} holds sway here.`);
		}
	}

	parts.push(`It is a place where adventurers might find work, supplies, and rumors.`);

	return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Starter NPCs (deterministic, no AI call)
// ---------------------------------------------------------------------------

/**
 * Generate a small set of seed NPCs for the starting location.
 * These are basic archetypes the GM can reference immediately.
 */
export function seedStarterNPCs(
	locationId: GameId,
	world: PrototypeWorld,
	settlement: PrototypeWorld['politics']['settlements'][0]
): NPC[] {
	const culture = world.societies.cultures.find((c) => c.i === settlement.culture);
	const cultureName = culture?.name ?? 'local';

	const npcs: NPC[] = [
		{
			id: ulid(),
			name: generateNpcName(cultureName, 'tavern'),
			role: 'neutral',
			locationId,
			disposition: 20,
			description: `The keeper of the local tavern. Friendly, well-informed, and always happy to share rumors over a drink.`,
			notes: `Knows local gossip. Can point players toward quests. Has a soft spot for adventurers.`,
			alive: true
		},
		{
			id: ulid(),
			name: generateNpcName(cultureName, 'merchant'),
			role: 'merchant',
			locationId,
			disposition: 0,
			description: `A traveling trader who deals in provisions, simple weapons, and the occasional curiosity.`,
			notes: `Carries basic adventuring gear. Prices are fair but firm.`,
			alive: true
		},
		{
			id: ulid(),
			name: generateNpcName(cultureName, 'quest'),
			role: 'quest-giver',
			locationId,
			disposition: 10,
			description: `A worried elder who has been looking for capable souls to handle a growing problem.`,
			notes: `Offers the starter quest. Knows about the local threat but is too old to deal with it personally.`,
			alive: true
		}
	];

	return npcs;
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
// Starter Quest (deterministic template)
// ---------------------------------------------------------------------------

/**
 * Create a simple starter quest tied to the starting location.
 */
export function seedStarterQuest(
	giverNpcId: GameId,
	locationId: GameId,
	world: PrototypeWorld,
	settlement: PrototypeWorld['politics']['settlements'][0]
): Quest {
	const state = world.politics.states.find((s) => s.i === settlement.state);

	// Pick a threat from lore notes if available
	const loreHook = world.lore.notes.length > 0
		? world.lore.notes[0].legend
		: 'Strange creatures have been spotted in the surrounding wilds.';

	return {
		id: ulid(),
		name: `Trouble Near ${settlement.name}`,
		giverNpcId,
		status: 'available',
		description: `The people of ${settlement.name} are worried. ${loreHook} Someone needs to investigate and deal with the threat before it grows worse.`,
		objectives: [
			{ id: ulid(), text: `Speak with the locals to learn more about the threat`, done: false },
			{ id: ulid(), text: `Investigate the source of the disturbance`, done: false },
			{ id: ulid(), text: `Resolve the threat`, done: false }
		],
		rewards: {
			xp: 100,
			gold: state ? 25 : 15,
			items: [],
			reputationChanges: [{ npcId: giverNpcId, delta: 10 }]
		},
		recommendedLevel: 1,
		encounterTemplates: ['soldier']
	};
}

// ---------------------------------------------------------------------------
// Starter Items (class-based equipment packs)
// ---------------------------------------------------------------------------

/**
 * Generate starting equipment for a character based on their class.
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
			description: `A set of ${name.toLowerCase()}.`,
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
 * Initialize the GameState with a starting location, NPCs, and quest
 * derived from the PrototypeWorld. Called when the adventure transitions
 * from lobby → active (after character creation).
 */
export function bootstrapAdventureContent(
	state: GameState,
	world: PrototypeWorld
): GameState {
	// 1. Create starting location
	const startLocation = seedStartingLocation(world);
	state.locations.push(startLocation);
	state.partyLocationId = startLocation.id;

	// 2. Seed NPCs
	const settlement = world.politics.settlements.find((s) => s.i === startLocation.regionRef)
		?? world.politics.settlements[0];
	const npcs = seedStarterNPCs(startLocation.id, world, settlement);
	state.npcs.push(...npcs);

	// Wire NPC IDs into the location
	startLocation.npcs = npcs.map((n) => n.id);

	// 3. Seed starter quest
	const questGiver = npcs.find((n) => n.role === 'quest-giver');
	if (questGiver) {
		const quest = seedStarterQuest(questGiver.id, startLocation.id, world, settlement);
		state.quests.push(quest);
	}

	return state;
}
