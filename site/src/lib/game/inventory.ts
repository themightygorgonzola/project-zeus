/**
 * Project Zeus — Inventory, Equipment & Economy Engine
 *
 * Equip/unequip, AC recalculation, encumbrance, consumables,
 * attunement, gold transactions, and item management.
 *
 * All functions are pure — they return new state rather than mutating input.
 */

import type {
	PlayerCharacter,
	Item,
	WeaponItem,
	ArmorItem,
	ConsumableItem,
	ContainerItem,
	GameId
} from './types';
import { hasClass } from './types';
import { abilityModifier } from './mechanics';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum items a character can attune to (5e rule). */
export const MAX_ATTUNEMENT_SLOTS = 3;

/** Maximum weapons that can be equipped simultaneously. */
export const MAX_EQUIPPED_WEAPONS = 2;

/** Carry capacity multiplier: STR score × this value = lbs capacity. */
export const CARRY_CAPACITY_MULTIPLIER = 15;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isWeapon(item: Item): item is WeaponItem {
	return item.category === 'weapon';
}

export function isArmor(item: Item): item is ArmorItem {
	return item.category === 'armor';
}

export function isConsumable(item: Item): item is ConsumableItem {
	return item.category === 'consumable';
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EquipResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
	/** Items that were unequipped to make room. */
	unequipped: string[];
}

export interface UnequipResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
}

export interface UseConsumableResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
	/** Healing applied, if the consumable was a healing potion. */
	healing?: number;
	/** Whether the item was removed from inventory (charges depleted). */
	itemRemoved: boolean;
	/** Charges remaining after use (-1 if item removed). */
	chargesRemaining: number;
}

export interface AddItemResult {
	character: PlayerCharacter;
	/** The ID of the item added (new or existing if stacked). */
	itemId: GameId;
	/** Whether we stacked onto an existing item. */
	stacked: boolean;
}

export interface RemoveItemResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
	/** The item removed (or null if not found). */
	removedItem: Item | null;
	/** Quantity actually removed. */
	quantityRemoved: number;
}

export interface GoldTransactionResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
	/** Gold change (positive = gained, negative = spent). */
	goldDelta: number;
}

export interface AttuneResult {
	success: boolean;
	reason?: string;
	character: PlayerCharacter;
}

export interface EncumbranceInfo {
	/** Current carried weight in lbs. */
	currentLoad: number;
	/** Maximum carry capacity in lbs. */
	capacity: number;
	/** True if over standard carry capacity. */
	encumbered: boolean;
	/** Variant: 5× STR threshold (speed -10). */
	variantEncumbered: boolean;
	/** Variant: 10× STR threshold (speed -20, disadvantage on physical checks). */
	variantHeavilyEncumbered: boolean;
}

// ---------------------------------------------------------------------------
// AC Calculation
// ---------------------------------------------------------------------------

/**
 * Centralized AC calculation that reads equipped armor/shield from inventory.
 *
 * Handles:
 * - No armor: 10 + DEX mod
 * - Light armor: baseAC + DEX mod
 * - Medium armor: baseAC + min(DEX mod, maxDexBonus ?? 2)
 * - Heavy armor: baseAC (no DEX)
 * - Shield: +2 (from shield baseAC)
 * - Barbarian unarmored defense: 10 + DEX + CON
 * - Monk unarmored defense: 10 + DEX + WIS
 *
 * Magic bonuses on armor/shield are added.
 */
export function computeAC(character: PlayerCharacter): number {
	const dexMod = abilityModifier(character.abilities.dex);

	const equippedArmor = character.inventory
		.filter((item): item is ArmorItem => item.category === 'armor' && item.equipped === true)
		.sort((a, b) => b.baseAC - a.baseAC);

	const shield = equippedArmor.find((item) => item.armorName === 'shield');
	const armor = equippedArmor.find((item) => item.armorName !== 'shield');

	const shieldBonus = shield ? (shield.baseAC + (shield.magicBonus ?? 0)) : 0;

	if (armor) {
		const magicBonus = armor.magicBonus ?? 0;
		// Heavy armor (maxDexBonus === 0): no DEX contribution
		if (armor.maxDexBonus === 0) {
			return armor.baseAC + magicBonus + shieldBonus;
		}
		// Medium/Light armor: DEX capped by maxDexBonus if set
		const dexContrib = armor.maxDexBonus != null
			? Math.min(dexMod, armor.maxDexBonus)
			: dexMod;
		return armor.baseAC + dexContrib + magicBonus + shieldBonus;
	}

	// No armor — class-specific unarmored defense
	if (hasClass(character, 'barbarian')) {
		return 10 + dexMod + abilityModifier(character.abilities.con) + shieldBonus;
	}
	if (hasClass(character, 'monk')) {
		// Monks cannot benefit from shields with Unarmored Defense
		return 10 + dexMod + abilityModifier(character.abilities.wis);
	}

	// Default: 10 + DEX
	return 10 + dexMod + shieldBonus;
}

// ---------------------------------------------------------------------------
// Equip / Unequip
// ---------------------------------------------------------------------------

/**
 * Equip an item by ID.
 *
 * For armor: un-equips any currently equipped armor of the same slot
 * (shield vs non-shield) first. Recalculates AC.
 *
 * For weapons: allows up to 2 equipped weapons. If 2 are already equipped
 * and neither is the target, returns failure.
 */
export function equipItem(character: PlayerCharacter, itemId: GameId): EquipResult {
	const item = character.inventory.find((i) => i.id === itemId);
	if (!item) {
		return { success: false, reason: 'Item not found in inventory.', character, unequipped: [] };
	}

	if (item.category !== 'weapon' && item.category !== 'armor') {
		return { success: false, reason: 'Only weapons and armor can be equipped.', character, unequipped: [] };
	}

	// Clone inventory for immutability
	const newInventory = character.inventory.map((i) => ({ ...i }));
	const target = newInventory.find((i) => i.id === itemId)!;
	const unequipped: string[] = [];

	if (isArmor(item)) {
		const armorItem = target as ArmorItem;
		const isShield = armorItem.armorName === 'shield';

		// Un-equip any currently equipped armor in the same slot
		for (const inv of newInventory) {
			if (inv.category === 'armor' && inv.id !== itemId) {
				const existing = inv as ArmorItem;
				if (existing.equipped && (isShield ? existing.armorName === 'shield' : existing.armorName !== 'shield')) {
					(existing as ArmorItem).equipped = false;
					unequipped.push(existing.name);
				}
			}
		}
		armorItem.equipped = true;
	} else if (isWeapon(item)) {
		const weaponItem = target as WeaponItem;
		if (weaponItem.equipped) {
			return { success: true, character, unequipped: [] }; // already equipped
		}

		const equippedWeapons = newInventory.filter(
			(i): i is WeaponItem => i.category === 'weapon' && i.equipped === true && i.id !== itemId
		);

		if (equippedWeapons.length >= MAX_EQUIPPED_WEAPONS) {
			// Un-equip the first weapon to make room
			const toRemove = equippedWeapons[0];
			(newInventory.find((i) => i.id === toRemove.id) as WeaponItem).equipped = false;
			unequipped.push(toRemove.name);
		}
		weaponItem.equipped = true;
	}

	const updated: PlayerCharacter = { ...character, inventory: newInventory };
	// Recalculate AC if armor was changed
	if (isArmor(item)) {
		updated.ac = computeAC(updated);
	}

	return { success: true, character: updated, unequipped };
}

/**
 * Unequip an item by ID. Recalculates AC if armor.
 */
export function unequipItem(character: PlayerCharacter, itemId: GameId): UnequipResult {
	const item = character.inventory.find((i) => i.id === itemId);
	if (!item) {
		return { success: false, reason: 'Item not found in inventory.', character };
	}

	if (item.category === 'weapon') {
		if (!(item as WeaponItem).equipped) {
			return { success: true, character }; // already unequipped
		}
	} else if (item.category === 'armor') {
		if (!(item as ArmorItem).equipped) {
			return { success: true, character }; // already unequipped
		}
	} else {
		return { success: false, reason: 'Only weapons and armor can be unequipped.', character };
	}

	const newInventory = character.inventory.map((i) => {
		if (i.id === itemId) {
			if (i.category === 'weapon') return { ...i, equipped: false } as WeaponItem;
			if (i.category === 'armor') return { ...i, equipped: false } as ArmorItem;
		}
		return { ...i };
	});

	const updated: PlayerCharacter = { ...character, inventory: newInventory };
	if (item.category === 'armor') {
		updated.ac = computeAC(updated);
	}

	return { success: true, character: updated };
}

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------

/**
 * Use a consumable item.
 *
 * Decrements charges. If charges reach 0 and it's a potion/food/ammo,
 * removes the item from inventory. For healing potions, applies healing.
 */
export function useConsumable(character: PlayerCharacter, itemId: GameId): UseConsumableResult {
	const item = character.inventory.find((i) => i.id === itemId);
	if (!item) {
		return { success: false, reason: 'Item not found.', character, itemRemoved: false, chargesRemaining: -1 };
	}
	if (!isConsumable(item)) {
		return { success: false, reason: 'Item is not a consumable.', character, itemRemoved: false, chargesRemaining: -1 };
	}
	if (item.charges <= 0) {
		return { success: false, reason: 'No charges remaining.', character, itemRemoved: false, chargesRemaining: 0 };
	}

	let newInventory = character.inventory.map((i) => ({ ...i }));
	const target = newInventory.find((i) => i.id === itemId) as ConsumableItem;
	target.charges -= 1;

	let healing: number | undefined;
	let itemRemoved = false;

	// Detect healing potion from effectDescription
	const healingMatch = target.effectDescription?.match(/(\d+)d(\d+)\s*\+?\s*(\d+)?.*(?:heal|restore|regain)/i)
		?? target.effectDescription?.match(/(?:heal|restore|regain).*?(\d+)d(\d+)\s*\+?\s*(\d+)?/i);
	if (healingMatch) {
		// For deterministic tests, use fixed average healing rather than rolling
		const numDice = parseInt(healingMatch[1], 10);
		const dieSides = parseInt(healingMatch[2], 10);
		const bonus = parseInt(healingMatch[3] ?? '0', 10);
		// Average healing for potions
		healing = Math.floor(numDice * (dieSides + 1) / 2) + bonus;
	}

	// Remove if charges depleted and it's a single-use type
	const removeTypes = new Set<string | undefined>(['potion', 'food', 'ammo', 'scroll', undefined]);
	if (target.charges <= 0 && removeTypes.has(target.consumableType)) {
		newInventory = newInventory.filter((i) => i.id !== itemId);
		itemRemoved = true;
	}

	let updatedChar: PlayerCharacter = { ...character, inventory: newInventory };

	// Apply healing if detected
	if (healing !== undefined && healing > 0) {
		const newHp = Math.min(updatedChar.hp + healing, updatedChar.maxHp);
		healing = newHp - updatedChar.hp;
		updatedChar = { ...updatedChar, hp: newHp };
	}

	return {
		success: true,
		character: updatedChar,
		healing,
		itemRemoved,
		chargesRemaining: itemRemoved ? -1 : target.charges
	};
}

// ---------------------------------------------------------------------------
// Add / Remove Items
// ---------------------------------------------------------------------------

/**
 * Add an item to inventory. Handles stacking (same name + category)
 * and ID generation for new items.
 */
export function addItemToInventory(
	character: PlayerCharacter,
	item: Omit<Item, 'id'> & { id?: GameId }
): AddItemResult {
	const newInventory = character.inventory.map((i) => ({ ...i }));

	// Try to stack with existing item of same name and category
	// Containers are never stacked — each is a distinct object with its own contents.
	if (item.category === 'container') {
		const newItem = { ...item, id: item.id || ulid() } as Item;
		return {
			character: { ...character, inventory: [...newInventory, newItem] },
			itemId: newItem.id,
			stacked: false
		};
	}

	const existing = newInventory.find(
		(i) => i.name === item.name && i.category === item.category
	);

	if (existing) {
		existing.quantity += item.quantity;
		return {
			character: { ...character, inventory: newInventory },
			itemId: existing.id,
			stacked: true
		};
	}

	// New item — assign an ID if needed
	const newItem = { ...item, id: item.id || ulid() } as Item;
	newInventory.push(newItem);

	return {
		character: { ...character, inventory: newInventory },
		itemId: newItem.id,
		stacked: false
	};
}

/**
 * Remove an item (or quantity) from inventory.
 */
export function removeItemFromInventory(
	character: PlayerCharacter,
	itemId: GameId,
	quantity: number = 1
): RemoveItemResult {
	const item = character.inventory.find((i) => i.id === itemId);
	if (!item) {
		return { success: false, reason: 'Item not found.', character, removedItem: null, quantityRemoved: 0 };
	}

	const qtyToRemove = Math.min(quantity, item.quantity);
	let newInventory: Item[];

	if (item.quantity <= qtyToRemove) {
		// Remove entirely
		newInventory = character.inventory.filter((i) => i.id !== itemId).map((i) => ({ ...i }));
	} else {
		// Reduce quantity
		newInventory = character.inventory.map((i) => {
			if (i.id === itemId) return { ...i, quantity: i.quantity - qtyToRemove };
			return { ...i };
		});
	}

	// Also remove from attunedItems if attuned and fully removed
	let attunedItems = character.attunedItems;
	if (item.quantity <= qtyToRemove && attunedItems.includes(itemId)) {
		attunedItems = attunedItems.filter((id) => id !== itemId);
	}

	return {
		success: true,
		character: { ...character, inventory: newInventory, attunedItems },
		removedItem: { ...item },
		quantityRemoved: qtyToRemove
	};
}

// ---------------------------------------------------------------------------
// Encumbrance
// ---------------------------------------------------------------------------

/**
 * Calculate carry capacity: STR × 15 lbs.
 */
export function getCarryCapacity(character: PlayerCharacter): number {
	return character.abilities.str * CARRY_CAPACITY_MULTIPLIER;
}

/**
 * Calculate current carried weight.
 */
export function getCurrentLoad(character: PlayerCharacter): number {
	return character.inventory.reduce((sum, item) => sum + (item.weight * item.quantity), 0);
}

/**
 * Check if the character is encumbered under standard rules.
 */
export function isEncumbered(character: PlayerCharacter): boolean {
	return getCurrentLoad(character) > getCarryCapacity(character);
}

/**
 * Full encumbrance info with variant encumbrance thresholds.
 */
export function getEncumbranceInfo(character: PlayerCharacter): EncumbranceInfo {
	const currentLoad = getCurrentLoad(character);
	const capacity = getCarryCapacity(character);
	const str = character.abilities.str;

	return {
		currentLoad,
		capacity,
		encumbered: currentLoad > capacity,
		variantEncumbered: currentLoad > str * 5,
		variantHeavilyEncumbered: currentLoad > str * 10
	};
}

// ---------------------------------------------------------------------------
// Attunement
// ---------------------------------------------------------------------------

/**
 * Attune to an item. Requires the item to have `attunement: true`
 * and the character to have fewer than 3 attuned items.
 */
export function attuneItem(character: PlayerCharacter, itemId: GameId): AttuneResult {
	const item = character.inventory.find((i) => i.id === itemId);
	if (!item) {
		return { success: false, reason: 'Item not found in inventory.', character };
	}
	if (!item.attunement) {
		return { success: false, reason: 'This item does not require attunement.', character };
	}
	if (character.attunedItems.includes(itemId)) {
		return { success: false, reason: 'Already attuned to this item.', character };
	}
	if (character.attunedItems.length >= MAX_ATTUNEMENT_SLOTS) {
		return { success: false, reason: `Cannot attune to more than ${MAX_ATTUNEMENT_SLOTS} items.`, character };
	}

	return {
		success: true,
		character: {
			...character,
			attunedItems: [...character.attunedItems, itemId]
		}
	};
}

/**
 * End attunement to an item.
 */
export function unattuneItem(character: PlayerCharacter, itemId: GameId): AttuneResult {
	if (!character.attunedItems.includes(itemId)) {
		return { success: false, reason: 'Not attuned to this item.', character };
	}

	return {
		success: true,
		character: {
			...character,
			attunedItems: character.attunedItems.filter((id) => id !== itemId)
		}
	};
}

// ---------------------------------------------------------------------------
// Gold Transactions
// ---------------------------------------------------------------------------

/**
 * Buy an item: deduct gold, add item to inventory.
 */
export function buyItem(
	character: PlayerCharacter,
	item: Omit<Item, 'id'> & { id?: GameId },
	cost: number
): GoldTransactionResult & { itemId?: GameId } {
	if (cost < 0) {
		return { success: false, reason: 'Cost cannot be negative.', character, goldDelta: 0 };
	}
	if (character.gold < cost) {
		return { success: false, reason: `Insufficient gold. Have ${character.gold} gp, need ${cost} gp.`, character, goldDelta: 0 };
	}

	const withGold: PlayerCharacter = { ...character, gold: character.gold - cost };
	const addResult = addItemToInventory(withGold, item);

	return {
		success: true,
		character: addResult.character,
		goldDelta: -cost,
		itemId: addResult.itemId
	};
}

/**
 * Sell an item: remove from inventory, gain gold.
 */
export function sellItem(
	character: PlayerCharacter,
	itemId: GameId,
	price: number
): GoldTransactionResult {
	if (price < 0) {
		return { success: false, reason: 'Price cannot be negative.', character, goldDelta: 0 };
	}

	const removeResult = removeItemFromInventory(character, itemId, 1);
	if (!removeResult.success) {
		return { success: false, reason: removeResult.reason, character, goldDelta: 0 };
	}

	return {
		success: true,
		character: { ...removeResult.character, gold: removeResult.character.gold + price },
		goldDelta: price
	};
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get all equipped weapons.
 */
export function getEquippedWeapons(character: PlayerCharacter): WeaponItem[] {
	return character.inventory.filter(
		(i): i is WeaponItem => i.category === 'weapon' && i.equipped === true
	);
}

/**
 * Get equipped armor (non-shield).
 */
export function getEquippedArmor(character: PlayerCharacter): ArmorItem | undefined {
	return character.inventory.find(
		(i): i is ArmorItem => i.category === 'armor' && i.equipped === true && i.armorName !== 'shield'
	);
}

/**
 * Get equipped shield.
 */
export function getEquippedShield(character: PlayerCharacter): ArmorItem | undefined {
	return character.inventory.find(
		(i): i is ArmorItem => i.category === 'armor' && i.equipped === true && i.armorName === 'shield'
	);
}

/**
 * Find an item by ID in a character's inventory.
 */
export function findItem(character: PlayerCharacter, itemId: GameId): Item | undefined {
	return character.inventory.find((i) => i.id === itemId);
}

// ---------------------------------------------------------------------------
// Container helpers
// ---------------------------------------------------------------------------

/** Type guard: returns true and narrows to ContainerItem when item is a container. */
export function isContainer(item: Item): item is ContainerItem {
	return item.category === 'container';
}

/**
 * Add an item into a container's contents list.
 * Returns a new character with the updated container; does not remove the item from
 * the top-level inventory (callers should do that separately if needed).
 */
export function addItemToContainer(
	character: PlayerCharacter,
	containerId: GameId,
	item: Item
): { success: true; character: PlayerCharacter } | { success: false; reason: string; character: PlayerCharacter } {
	const idx = character.inventory.findIndex((i) => i.id === containerId);
	if (idx === -1) return { success: false, reason: 'Container not found.', character };
	const container = character.inventory[idx];
	if (!isContainer(container)) return { success: false, reason: 'Item is not a container.', character };

	const { maxSlots } = container.capacity;
	if (maxSlots !== undefined && container.contents.length >= maxSlots) {
		return { success: false, reason: 'Container is full.', character };
	}

	const updatedContainer: ContainerItem = {
		...container,
		contents: [...container.contents, item]
	};
	const newInventory = character.inventory.map((i) => (i.id === containerId ? updatedContainer : i));
	return { success: true, character: { ...character, inventory: newInventory } };
}

/**
 * Remove an item by ID from a container's contents list.
 */
export function removeItemFromContainer(
	character: PlayerCharacter,
	containerId: GameId,
	itemId: GameId
): { success: true; character: PlayerCharacter; item: Item } | { success: false; reason: string; character: PlayerCharacter } {
	const container = character.inventory.find((i) => i.id === containerId);
	if (!container || !isContainer(container)) {
		return { success: false, reason: 'Container not found.', character };
	}
	const target = container.contents.find((i) => i.id === itemId);
	if (!target) return { success: false, reason: 'Item not found in container.', character };

	const updatedContainer: ContainerItem = {
		...container,
		contents: container.contents.filter((i) => i.id !== itemId)
	};
	const newInventory = character.inventory.map((i) => (i.id === containerId ? updatedContainer : i));
	return { success: true, character: { ...character, inventory: newInventory }, item: target };
}

/**
 * Returns all items across the top-level inventory and inside any containers.
 * Useful for searching or displaying a flattened item list.
 */
export function getAllInventoryItems(character: PlayerCharacter): Item[] {
	const result: Item[] = [];
	function pushItems(items: Item[]) {
		for (const item of items) {
			result.push(item);
			if (isContainer(item)) pushItems(item.contents);
		}
	}
	for (const item of character.inventory) {
		result.push(item);
		if (isContainer(item)) pushItems(item.contents);
	}
	return result;
}
