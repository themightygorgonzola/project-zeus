/**
 * item-dimensions.ts — SU (Space Unit) lookup table, container defaults,
 * and pure utility functions for the dual WU/SU carry system.
 *
 * WU (Weight Unit) = 1 lb exactly (maps 1:1 to existing BaseItem.weight).
 * SU (Space Unit)  = geometric volume proxy — captures shape/bulk independently
 *                    of weight. Coins are 0.01 SU apiece; a bedroll is 5 SU.
 *
 * Pure functions: no Svelte, no DB, no side effects.
 */

import type { Item, ContainerItem, ContainerType, PlayerCharacter, ItemCategory, EnhancedEncumbranceInfo, ContainerDiscount } from './types';

// ---------------------------------------------------------------------------
// SU lookup table — canonical SU values indexed by normalised item name
// ---------------------------------------------------------------------------

/**
 * Normalise an item name for lookup: lowercase, strip leading/trailing spaces,
 * collapse internal whitespace. Used for both table keys and runtime lookups.
 */
function normKey(name: string): string {
	return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Build a two-way lookup including singular/plural variants. */
function entries(su: number, ...names: string[]): Array<[string, number]> {
	return names.map((n) => [normKey(n), su]);
}

export const ITEM_SU_TABLE: Record<string, number> = Object.fromEntries([
	// Currency (each coin)
	...entries(0.01, 'gold coin', 'silver coin', 'copper coin', 'platinum coin', 'electrum coin',
		'gold piece', 'silver piece', 'copper piece', 'platinum piece', 'electrum piece',
		'gp', 'sp', 'cp', 'pp', 'ep'),

	// Ammunition
	...entries(0.05, 'arrow', 'arrows', 'bolt', 'bolts', 'blowgun needle', 'blowgun needles',
		'arrows (20)', 'bolts (20)', 'arrow (20)', 'bolt (20)'),
	...entries(0.10, 'dart', 'darts'),
	...entries(0.20, 'sling bullet', 'sling bullets'),

	// Light / thrown weapons and daggers
	...entries(0.5, 'dagger', 'handaxe', 'light hammer', 'sickle', 'club'),
	...entries(0.3, 'shuriken'),
	...entries(0.8, 'shortsword', 'scimitar', 'rapier', 'hand crossbow'),

	// One-handed weapons
	...entries(1.5, 'longsword', 'battleaxe', 'flail', 'mace', 'morningstar', 'trident',
		'war pick', 'warhammer', 'whip'),
	...entries(1.0, 'light crossbow'),

	// Two-handed / versatile heavy weapons
	...entries(3.0, 'greatclub', 'maul', 'heavy crossbow'),
	...entries(2.5, 'greatsword', 'greataxe'),
	...entries(2.0, 'lance', 'javelin', 'spear', 'quarterstaff', 'shortbow'),
	...entries(3.0, 'longbow', 'net'),
	...entries(4.0, 'glaive', 'halberd', 'pike', 'lance'),

	// Shields & armor
	...entries(5.0, 'shield', 'buckler'),
	...entries(2.0, 'padded armor'),
	...entries(3.0, 'leather armor', 'leather'),
	...entries(4.0, 'studded leather armor', 'studded leather'),
	...entries(4.5, 'hide armor', 'hide'),
	...entries(5.0, 'chain shirt'),
	...entries(6.0, 'scale mail', 'breastplate', 'ring mail'),
	...entries(7.0, 'half plate', 'half plate armor'),
	...entries(8.0, 'chain mail', 'splint', 'splint mail'),
	...entries(9.0, 'plate', 'plate armor', 'plate mail'),

	// Potions & consumables
	...entries(0.5, 'healing potion', 'potion of healing', 'potion', 'antitoxin', 'oil (flask)'),
	...entries(0.2, 'scroll', 'spell scroll'),
	...entries(0.1, 'vial', 'ink (1 oz. bottle)', 'perfume (vial)'),

	// Adventuring gear
	...entries(1.0, 'torch', 'tinderbox', 'rations (1 day)', 'rations', 'piton', 'pitons',
		'candle', 'chalk (1 piece)', 'coin purse', 'pouch'),
	...entries(0.5, 'parchment (one sheet)', 'parchment', 'needle', 'thread'),
	...entries(1.5, 'crowbar', 'hammer', 'mess kit', 'mirror (steel)', 'waterskin',
		'flask of oil', 'flask', 'lantern (bullseye)', 'lantern (hooded)'),
	...entries(2.0, 'lantern', 'hourglass', 'hunting trap', 'iron pot', 'spyglass'),
	...entries(2.5, 'shovel', 'sledgehammer', 'pickaxe', 'block and tackle'),
	...entries(3.0, 'iron spike', 'grappling hook', 'manacles'),
	...entries(3.5, 'crowbar (large)', 'spade'),

	// Containers & bags
	...entries(5.0, 'backpack', 'sack', 'bag'),
	...entries(1.0, 'belt pouch', 'belt-pouch', 'pouch (belt)', 'coin purse', 'coin-purse'),

	// Rope
	...entries(6.0, 'rope (50 feet)', 'hempen rope (50 feet)', 'hemp rope (50 ft)', 'hemp rope'),
	...entries(4.0, 'silk rope (50 feet)', 'silk rope (50 ft)', 'silk rope'),
	...entries(4.5, 'rope (50 ft.)'),

	// Bedroll / camping
	...entries(5.0, 'bedroll', 'tent (two-person)', 'tent'),
	...entries(3.0, 'blanket', 'winter blanket'),

	// Light sources
	...entries(2.0, 'lamp', 'oil (1 pint bottle)'),

	// Tool kits and instruments
	...entries(3.0, 'thieves\' tools', 'healer\'s kit', "herbalism kit", 'disguise kit',
		'forgery kit', 'musical instrument', 'lute', 'flute', 'drum', 'horn', 'lyre',
		'viol', 'pan flute'),
	...entries(4.0, 'woodcarver\'s tools', 'smith\'s tools', 'carpenter\'s tools',
		'mason\'s tools', 'cobbler\'s tools', 'leatherworker\'s tools', 'weaver\'s tools'),
	...entries(2.0, 'alchemist\'s supplies', 'component pouch'),
	...entries(1.5, 'calligrapher\'s supplies', 'painter\'s supplies'),
	...entries(0.5, 'playing cards', 'dice set'),

	// Books / maps
	...entries(1.0, 'book', 'spellbook'),
	...entries(0.3, 'map', 'chart'),
]);

// ---------------------------------------------------------------------------
// Fallback formula
// ---------------------------------------------------------------------------

/** Default SU when no table entry exists: 70% of weight, minimum 0.5 SU. */
function suFallback(weight: number): number {
	return Math.max(0.5, weight * 0.7);
}

/** Resolve the SU for an item. Uses lookup first, falls back to formula. */
export function getItemSU(item: Item): number {
	// Prefer the stored spaceTaken if it was persisted
	if ((item.spaceTaken ?? 0) > 0) return item.spaceTaken!;
	const key = normKey(item.name);
	return ITEM_SU_TABLE[key] ?? suFallback(item.weight);
}

// ---------------------------------------------------------------------------
// Container defaults
// ---------------------------------------------------------------------------

export interface ContainerDefaults {
	maxWU: number;
	maxSU: number;
	discounts: ContainerDiscount[];
}

export const CONTAINER_DEFAULTS: Record<ContainerType, ContainerDefaults> = {
	backpack: {
		maxWU: 60,
		maxSU: 120,
		discounts: [{ wuMultiplier: 0.95, suMultiplier: 0.9 }]
	},
	sack: {
		maxWU: 30,
		maxSU: 60,
		discounts: []
	},
	bag: {
		maxWU: 40,
		maxSU: 80,
		discounts: []
	},
	pouch: {
		maxWU: 3,
		maxSU: 6,
		discounts: []
	},
	'belt-pouch': {
		maxWU: 3,
		maxSU: 5,
		discounts: []
	},
	'coin-purse': {
		maxWU: 5,
		maxSU: 20,
		discounts: [
			{ nameMatch: 'coin', wuMultiplier: 0.5, suMultiplier: 0.1 },
			{ nameMatch: ' piece', wuMultiplier: 0.5, suMultiplier: 0.1 }
		]
	},
	quiver: {
		// A quiver is purpose-built for arrows and bolts – they stack vertically
		// and are body-supported, so WU and SU are heavily discounted inside one.
		// 100 arrows (5×20 bundles = 7.5 raw WU) → only 0.75 effective WU at ×0.1.
		maxWU: 10,
		maxSU: 20,
		discounts: [
			{ category: 'ammunition', wuMultiplier: 0.1, suMultiplier: 0.05 },
			{ nameMatch: 'arrow',     wuMultiplier: 0.1, suMultiplier: 0.05 },
			{ nameMatch: 'bolt',      wuMultiplier: 0.1, suMultiplier: 0.05 }
		]
	},
	'scroll-case': {
		maxWU: 1,
		maxSU: 8,
		discounts: [
			{ nameMatch: 'scroll', wuMultiplier: 1.0, suMultiplier: 0.5 }
		]
	},
	'component-pouch': {
		maxWU: 2,
		maxSU: 8,
		discounts: []
	},
	belt: {
		maxWU: 5,
		maxSU: 10,
		discounts: []
	},
	saddlebag: {
		maxWU: 60,
		maxSU: 120,
		discounts: [{ wuMultiplier: 0.9, suMultiplier: 0.85 }]
	},
	chest: {
		maxWU: 150,
		maxSU: 300,
		discounts: []
	},
	case: {
		maxWU: 5,
		maxSU: 15,
		discounts: []
	},
	other: {
		maxWU: 20,
		maxSU: 40,
		discounts: []
	}
};

// ---------------------------------------------------------------------------
// Discount application
// ---------------------------------------------------------------------------

function findDiscount(
	item: Item,
	discounts: ContainerDiscount[]
): ContainerDiscount | undefined {
	return discounts.find((d) => {
		if (d.category && d.category !== item.category) return false;
		if (d.nameMatch && !item.name.toLowerCase().includes(d.nameMatch.toLowerCase())) return false;
		return true;
	});
}

/** Effective WU for this item when stored in the given container. */
export function getEffectiveWU(item: Item, container?: ContainerItem): number {
	const raw = item.weight * item.quantity;
	if (!container) return raw;
	const disc = findDiscount(item, container.capacity.discounts ?? []);
	return disc ? raw * disc.wuMultiplier : raw;
}

/** Effective SU for this item when stored in the given container. */
export function getEffectiveSU(item: Item, container?: ContainerItem): number {
	const rawSU = getItemSU(item);
	const raw = rawSU * item.quantity;
	if (!container) return raw;
	const disc = findDiscount(item, container.capacity.discounts ?? []);
	return disc ? raw * disc.suMultiplier : raw;
}

// ---------------------------------------------------------------------------
// Container load calculation
// ---------------------------------------------------------------------------

export interface ContainerLoad {
	wuUsed: number;
	suUsed: number;
	wuMax: number;
	suMax: number;
	wuPct: number;
	suPct: number;
}

export function getContainerLoad(container: ContainerItem): ContainerLoad {
	const wuMax = container.capacity.maxWU;
	const suMax = container.capacity.maxSU;
	let wuUsed = 0;
	let suUsed = 0;
	for (const item of container.contents) {
		wuUsed += getEffectiveWU(item, container);
		suUsed += getEffectiveSU(item, container);
	}
	return {
		wuUsed,
		suUsed,
		wuMax,
		suMax,
		wuPct: wuMax > 0 ? Math.min(100, (wuUsed / wuMax) * 100) : 0,
		suPct: suMax > 0 ? Math.min(100, (suUsed / suMax) * 100) : 0
	};
}

// ---------------------------------------------------------------------------
// canAddToContainer
// ---------------------------------------------------------------------------

export interface CanAddResult {
	ok: boolean;
	wuExceeded: boolean;
	suExceeded: boolean;
	wuWouldBe: number;
	suWouldBe: number;
}

export function canAddToContainer(
	container: ContainerItem,
	item: Item
): CanAddResult {
	const { wuUsed, suUsed, wuMax, suMax } = getContainerLoad(container);
	const addWU = getEffectiveWU(item, container);
	const addSU = getEffectiveSU(item, container);
	const wuWouldBe = wuUsed + addWU;
	const suWouldBe = suUsed + addSU;
	const wuExceeded = wuWouldBe > wuMax;
	const suExceeded = suWouldBe > suMax;
	return {
		ok: !wuExceeded && !suExceeded,
		wuExceeded,
		suExceeded,
		wuWouldBe,
		suWouldBe
	};
}

// ---------------------------------------------------------------------------
// Atomic moveItemToContainer
// ---------------------------------------------------------------------------

type MoveSource = 'equipped' | 'loose' | string; // string = containerId

/**
 * Atomically move an item identified by itemId from one location to another.
 *
 * Sources:
 *   - 'loose': top-level inventory (not a container, not in a container)
 *   - 'equipped': top-level inventory with equipped flag set
 *   - any string: treated as a containerId to look inside
 *
 * Targets:
 *   - 'loose': place into top-level inventory
 *   - any string: place into that containerId's contents
 *
 * Returns the updated character, or null if the operation failed.
 * Hard-blocks if target is a container and canAddToContainer returns false.
 * Equipped zone has NO capacity gate — only total encumbrance applies.
 */
export function moveItemToContainer(
	char: PlayerCharacter,
	itemId: string,
	fromSource: MoveSource,
	toSource: MoveSource
): PlayerCharacter | null {
	let item: Item | null = null;
	let inv = [...char.inventory];

	// ── Helper: find a container by ID at top-level or 1-level deep, then apply updater ──
	function updateContainerById(
		id: string,
		updater: (c: ContainerItem) => ContainerItem
	): boolean {
		// Top-level
		const topIdx = inv.findIndex(i => i.id === id && i.category === 'container');
		if (topIdx !== -1) {
			inv[topIdx] = updater(inv[topIdx] as ContainerItem);
			return true;
		}
		// One level deep (nested container)
		for (let pi = 0; pi < inv.length; pi++) {
			if (inv[pi].category !== 'container') continue;
			const parent = inv[pi] as ContainerItem;
			const nestedIdx = parent.contents.findIndex(i => i.id === id && i.category === 'container');
			if (nestedIdx === -1) continue;
			const updatedContents = [...parent.contents];
			updatedContents[nestedIdx] = updater(parent.contents[nestedIdx] as ContainerItem);
			inv[pi] = { ...parent, contents: updatedContents };
			return true;
		}
		return false;
	}

	// 1. Find + remove item from source
	if (fromSource === 'loose' || fromSource === 'equipped') {
		// Allow moving containers too (removed category !== 'container' restriction)
		const idx = inv.findIndex(i => i.id === itemId);
		if (idx === -1) return null;
		item = inv[idx];
		inv = [...inv.slice(0, idx), ...inv.slice(idx + 1)];
	} else {
		// fromSource is a containerId (top-level or nested)
		let found = false;
		const ok = updateContainerById(fromSource, (cont) => {
			const innerIdx = cont.contents.findIndex(i => i.id === itemId);
			if (innerIdx === -1) return cont; // not in this container
			item = cont.contents[innerIdx];
			found = true;
			const newContents = [...cont.contents.slice(0, innerIdx), ...cont.contents.slice(innerIdx + 1)];
			return { ...cont, contents: newContents };
		});
		if (!ok || !found || !item) return null;
	}

	if (!item) return null;

	// 2. Unequip item if moving away from equipped zone
	if (fromSource === 'equipped') {
		if ('equipped' in item && (item as { equipped?: boolean }).equipped) {
			item = { ...item, equipped: false } as Item;
		}
	}

	// 3. Place item into target
	if (toSource === 'loose') {
		inv = [...inv, item];
	} else if (toSource === 'equipped') {
		// Equip: mark item equipped and add to top-level inventory
		const equippedItem = { ...item, equipped: true } as Item;
		inv = [...inv, equippedItem];
	} else {
		// Placing into a container (top-level or nested)
		let placed = false;
		const ok = updateContainerById(toSource, (targetCont) => {
			// Size check: a container cannot go into an equal-or-smaller container
			if (item!.category === 'container') {
				const itemMaxWU = (item as ContainerItem).capacity.maxWU;
				if (itemMaxWU >= targetCont.capacity.maxWU) return targetCont; // blocked
			}
			const check = canAddToContainer(targetCont, item!);
			if (!check.ok) return targetCont; // capacity exceeded
			placed = true;
			return { ...targetCont, contents: [...targetCont.contents, item!] };
		});
		if (!ok || !placed) return null;
	}

	return { ...char, inventory: inv };
}

// ---------------------------------------------------------------------------
// Character total WU (NOT just STR×15 capacity — this is what's being carried)
// ---------------------------------------------------------------------------

/** Sum of weight × quantity for every item at every level of the inventory tree.
 * Equipped/worn items count at 25% WU — they are body-supported and feel lighter. */
export function getCharacterTotalWU(char: PlayerCharacter): number {
	function sumContents(items: Item[]): number {
		let s = 0;
		for (const inner of items) {
			s += inner.weight * inner.quantity;
			if (inner.category === 'container') {
				s += sumContents((inner as ContainerItem).contents);
			}
		}
		return s;
	}

	let total = 0;
	for (const item of char.inventory) {
		// Worn/equipped items are body-supported — count at 25% WU
		const wuMult = ('equipped' in item && (item as { equipped?: boolean }).equipped === true) ? 0.25 : 1;
		total += item.weight * item.quantity * wuMult;
		if (item.category === 'container') {
			total += sumContents((item as ContainerItem).contents);
		}
	}
	return total;
}

// ---------------------------------------------------------------------------
// Enhanced encumbrance info
// ---------------------------------------------------------------------------

export function getEnhancedEncumbranceInfo(char: PlayerCharacter): EnhancedEncumbranceInfo {
	const wuTotal = getCharacterTotalWU(char);
	const str = char.abilities.str;
	const capacity = str * 30;
	const loadedThreshold = str * 15;
	const burdenedThreshold = str * 25;

	// SU total: sum all items (no discount applied for top-level total — containers count their raw contents)
	let suTotal = 0;
	for (const item of char.inventory) {
		suTotal += getItemSU(item) * item.quantity;
		if (item.category === 'container') {
			for (const inner of (item as ContainerItem).contents) {
				suTotal += getItemSU(inner) * inner.quantity;
			}
		}
	}

	// pct: relative to capacity, can exceed 100 in the over-capacity red zone
	const pct = capacity > 0 ? (wuTotal / capacity) * 100 : 0;

	const isEncumbered = wuTotal > loadedThreshold;
	const isHeavilyEncumbered = wuTotal > burdenedThreshold;
	const isOverCapacity = wuTotal > capacity;
	const badge: 'unloaded' | 'loaded' | 'burdened' | 'overloaded' =
		isOverCapacity ? 'overloaded' :
		isHeavilyEncumbered ? 'burdened' :
		isEncumbered ? 'loaded' :
		'unloaded';

	return {
		wuTotal,
		suTotal,
		capacity,
		loadedThreshold,
		burdenedThreshold,
		pct,
		badge,
		isEncumbered,
		isHeavilyEncumbered,
		isOverCapacity
	};
}

// ---------------------------------------------------------------------------
// SU fallback for items created without spaceTaken
// ---------------------------------------------------------------------------

/**
 * Compute the spaceTaken value for a new item at creation time.
 * Use the lookup table first; fall back to the weight-based formula.
 */
export function computeSpaceTaken(name: string, weight: number): number {
	const key = normKey(name);
	return ITEM_SU_TABLE[key] ?? suFallback(weight);
}
