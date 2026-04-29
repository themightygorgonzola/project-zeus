/**
 * 5e SRD Equipment Definitions
 *
 * Weapons, armor, packs, tools, and common adventuring gear.
 *
 * Sources: 5e SRD (CC-BY-4.0)
 */

import type { DamageType } from './races';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EquipmentRarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary';
export type WeaponCategory = 'simple-melee' | 'simple-ranged' | 'martial-melee' | 'martial-ranged';
export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';
export type WeaponProperty =
	| 'ammunition'
	| 'finesse'
	| 'heavy'
	| 'light'
	| 'loading'
	| 'range'
	| 'reach'
	| 'special'
	| 'thrown'
	| 'two-handed'
	| 'versatile';

export interface WeaponDefinition {
	name: string;
	displayName: string;
	category: WeaponCategory;
	damage: string;
	damageType: DamageType;
	weight: number;
	cost: string;
	properties: WeaponProperty[];
	range?: string;
	versatileDamage?: string;
	notes?: string;
}

export interface ArmorDefinition {
	name: string;
	displayName: string;
	type: ArmorCategory;
	baseAC: number;
	weight: number;
	cost: string;
	strengthRequirement?: number;
	maxDexBonus?: number | null;
	stealthDisadvantage?: boolean;
}

export interface GearDefinition {
	name: string;
	displayName: string;
	category: 'gear' | 'tool' | 'focus' | 'pack' | 'ammunition';
	cost: string;
	weight: number;
	description: string;
	contents?: string[];
}

// ---------------------------------------------------------------------------
// Weapon Data
// ---------------------------------------------------------------------------

export const WEAPONS: WeaponDefinition[] = [
	{ name: 'club', displayName: 'Club', category: 'simple-melee', damage: '1d4', damageType: 'bludgeoning', weight: 2, cost: '1 sp', properties: ['light'] },
	{ name: 'dagger', displayName: 'Dagger', category: 'simple-melee', damage: '1d4', damageType: 'piercing', weight: 1, cost: '2 gp', properties: ['finesse', 'light', 'thrown', 'range'], range: '20/60' },
	{ name: 'greatclub', displayName: 'Greatclub', category: 'simple-melee', damage: '1d8', damageType: 'bludgeoning', weight: 10, cost: '2 sp', properties: ['two-handed'] },
	{ name: 'handaxe', displayName: 'Handaxe', category: 'simple-melee', damage: '1d6', damageType: 'slashing', weight: 2, cost: '5 gp', properties: ['light', 'thrown', 'range'], range: '20/60' },
	{ name: 'javelin', displayName: 'Javelin', category: 'simple-melee', damage: '1d6', damageType: 'piercing', weight: 2, cost: '5 sp', properties: ['thrown', 'range'], range: '30/120' },
	{ name: 'light-hammer', displayName: 'Light Hammer', category: 'simple-melee', damage: '1d4', damageType: 'bludgeoning', weight: 2, cost: '2 gp', properties: ['light', 'thrown', 'range'], range: '20/60' },
	{ name: 'mace', displayName: 'Mace', category: 'simple-melee', damage: '1d6', damageType: 'bludgeoning', weight: 4, cost: '5 gp', properties: [] },
	{ name: 'quarterstaff', displayName: 'Quarterstaff', category: 'simple-melee', damage: '1d6', damageType: 'bludgeoning', weight: 4, cost: '2 sp', properties: ['versatile'], versatileDamage: '1d8' },
	{ name: 'sickle', displayName: 'Sickle', category: 'simple-melee', damage: '1d4', damageType: 'slashing', weight: 2, cost: '1 gp', properties: ['light'] },
	{ name: 'spear', displayName: 'Spear', category: 'simple-melee', damage: '1d6', damageType: 'piercing', weight: 3, cost: '1 gp', properties: ['thrown', 'range', 'versatile'], range: '20/60', versatileDamage: '1d8' },
	{ name: 'light-crossbow', displayName: 'Light Crossbow', category: 'simple-ranged', damage: '1d8', damageType: 'piercing', weight: 5, cost: '25 gp', properties: ['ammunition', 'loading', 'range', 'two-handed'], range: '80/320' },
	{ name: 'dart', displayName: 'Dart', category: 'simple-ranged', damage: '1d4', damageType: 'piercing', weight: 0.25, cost: '5 cp', properties: ['finesse', 'thrown', 'range'], range: '20/60' },
	{ name: 'shortbow', displayName: 'Shortbow', category: 'simple-ranged', damage: '1d6', damageType: 'piercing', weight: 2, cost: '25 gp', properties: ['ammunition', 'range', 'two-handed'], range: '80/320' },
	{ name: 'sling', displayName: 'Sling', category: 'simple-ranged', damage: '1d4', damageType: 'bludgeoning', weight: 0, cost: '1 sp', properties: ['ammunition', 'range'], range: '30/120' },
	{ name: 'battleaxe', displayName: 'Battleaxe', category: 'martial-melee', damage: '1d8', damageType: 'slashing', weight: 4, cost: '10 gp', properties: ['versatile'], versatileDamage: '1d10' },
	{ name: 'flail', displayName: 'Flail', category: 'martial-melee', damage: '1d8', damageType: 'bludgeoning', weight: 2, cost: '10 gp', properties: [] },
	{ name: 'glaive', displayName: 'Glaive', category: 'martial-melee', damage: '1d10', damageType: 'slashing', weight: 6, cost: '20 gp', properties: ['heavy', 'reach', 'two-handed'] },
	{ name: 'greataxe', displayName: 'Greataxe', category: 'martial-melee', damage: '1d12', damageType: 'slashing', weight: 7, cost: '30 gp', properties: ['heavy', 'two-handed'] },
	{ name: 'greatsword', displayName: 'Greatsword', category: 'martial-melee', damage: '2d6', damageType: 'slashing', weight: 6, cost: '50 gp', properties: ['heavy', 'two-handed'] },
	{ name: 'halberd', displayName: 'Halberd', category: 'martial-melee', damage: '1d10', damageType: 'slashing', weight: 6, cost: '20 gp', properties: ['heavy', 'reach', 'two-handed'] },
	{ name: 'lance', displayName: 'Lance', category: 'martial-melee', damage: '1d12', damageType: 'piercing', weight: 6, cost: '10 gp', properties: ['reach', 'special'], notes: 'Disadvantage when used against a target within 5 feet. Requires two hands when not mounted.' },
	{ name: 'longsword', displayName: 'Longsword', category: 'martial-melee', damage: '1d8', damageType: 'slashing', weight: 3, cost: '15 gp', properties: ['versatile'], versatileDamage: '1d10' },
	{ name: 'maul', displayName: 'Maul', category: 'martial-melee', damage: '2d6', damageType: 'bludgeoning', weight: 10, cost: '10 gp', properties: ['heavy', 'two-handed'] },
	{ name: 'morningstar', displayName: 'Morningstar', category: 'martial-melee', damage: '1d8', damageType: 'piercing', weight: 4, cost: '15 gp', properties: [] },
	{ name: 'pike', displayName: 'Pike', category: 'martial-melee', damage: '1d10', damageType: 'piercing', weight: 18, cost: '5 gp', properties: ['heavy', 'reach', 'two-handed'] },
	{ name: 'rapier', displayName: 'Rapier', category: 'martial-melee', damage: '1d8', damageType: 'piercing', weight: 2, cost: '25 gp', properties: ['finesse'] },
	{ name: 'scimitar', displayName: 'Scimitar', category: 'martial-melee', damage: '1d6', damageType: 'slashing', weight: 3, cost: '25 gp', properties: ['finesse', 'light'] },
	{ name: 'shortsword', displayName: 'Shortsword', category: 'martial-melee', damage: '1d6', damageType: 'piercing', weight: 2, cost: '10 gp', properties: ['finesse', 'light'] },
	{ name: 'trident', displayName: 'Trident', category: 'martial-melee', damage: '1d6', damageType: 'piercing', weight: 4, cost: '5 gp', properties: ['thrown', 'range', 'versatile'], range: '20/60', versatileDamage: '1d8' },
	{ name: 'war-pick', displayName: 'War Pick', category: 'martial-melee', damage: '1d8', damageType: 'piercing', weight: 2, cost: '5 gp', properties: [] },
	{ name: 'warhammer', displayName: 'Warhammer', category: 'martial-melee', damage: '1d8', damageType: 'bludgeoning', weight: 2, cost: '15 gp', properties: ['versatile'], versatileDamage: '1d10' },
	{ name: 'whip', displayName: 'Whip', category: 'martial-melee', damage: '1d4', damageType: 'slashing', weight: 3, cost: '2 gp', properties: ['finesse', 'reach'] },
	{ name: 'blowgun', displayName: 'Blowgun', category: 'martial-ranged', damage: '1', damageType: 'piercing', weight: 1, cost: '10 gp', properties: ['ammunition', 'loading', 'range'], range: '25/100' },
	{ name: 'hand-crossbow', displayName: 'Hand Crossbow', category: 'martial-ranged', damage: '1d6', damageType: 'piercing', weight: 3, cost: '75 gp', properties: ['ammunition', 'light', 'loading', 'range'], range: '30/120' },
	{ name: 'heavy-crossbow', displayName: 'Heavy Crossbow', category: 'martial-ranged', damage: '1d10', damageType: 'piercing', weight: 18, cost: '50 gp', properties: ['ammunition', 'heavy', 'loading', 'range', 'two-handed'], range: '100/400' },
	{ name: 'longbow', displayName: 'Longbow', category: 'martial-ranged', damage: '1d8', damageType: 'piercing', weight: 2, cost: '50 gp', properties: ['ammunition', 'heavy', 'range', 'two-handed'], range: '150/600' },
	{ name: 'net', displayName: 'Net', category: 'martial-ranged', damage: '0', damageType: 'bludgeoning', weight: 3, cost: '1 gp', properties: ['special', 'thrown', 'range'], range: '5/15', notes: 'A Large or smaller creature hit by a net is restrained until freed.' }
];

// ---------------------------------------------------------------------------
// Armor Data
// ---------------------------------------------------------------------------

export const ARMOR: ArmorDefinition[] = [
	{ name: 'padded', displayName: 'Padded Armor', type: 'light', baseAC: 11, weight: 8, cost: '5 gp', maxDexBonus: null, stealthDisadvantage: true },
	{ name: 'leather', displayName: 'Leather Armor', type: 'light', baseAC: 11, weight: 10, cost: '10 gp', maxDexBonus: null },
	{ name: 'studded-leather', displayName: 'Studded Leather Armor', type: 'light', baseAC: 12, weight: 13, cost: '45 gp', maxDexBonus: null },
	{ name: 'hide', displayName: 'Hide Armor', type: 'medium', baseAC: 12, weight: 12, cost: '10 gp', maxDexBonus: 2 },
	{ name: 'chain-shirt', displayName: 'Chain Shirt', type: 'medium', baseAC: 13, weight: 20, cost: '50 gp', maxDexBonus: 2 },
	{ name: 'scale-mail', displayName: 'Scale Mail', type: 'medium', baseAC: 14, weight: 45, cost: '50 gp', maxDexBonus: 2, stealthDisadvantage: true },
	{ name: 'breastplate', displayName: 'Breastplate', type: 'medium', baseAC: 14, weight: 20, cost: '400 gp', maxDexBonus: 2 },
	{ name: 'half-plate', displayName: 'Half Plate', type: 'medium', baseAC: 15, weight: 40, cost: '750 gp', maxDexBonus: 2, stealthDisadvantage: true },
	{ name: 'ring-mail', displayName: 'Ring Mail', type: 'heavy', baseAC: 14, weight: 40, cost: '30 gp', stealthDisadvantage: true, maxDexBonus: 0 },
	{ name: 'chain-mail', displayName: 'Chain Mail', type: 'heavy', baseAC: 16, weight: 55, cost: '75 gp', strengthRequirement: 13, stealthDisadvantage: true, maxDexBonus: 0 },
	{ name: 'splint', displayName: 'Splint Armor', type: 'heavy', baseAC: 17, weight: 60, cost: '200 gp', strengthRequirement: 15, stealthDisadvantage: true, maxDexBonus: 0 },
	{ name: 'plate', displayName: 'Plate Armor', type: 'heavy', baseAC: 18, weight: 65, cost: '1500 gp', strengthRequirement: 15, stealthDisadvantage: true, maxDexBonus: 0 },
	{ name: 'shield', displayName: 'Shield', type: 'shield', baseAC: 2, weight: 6, cost: '10 gp', maxDexBonus: null }
];

// ---------------------------------------------------------------------------
// Gear / Tools / Packs
// ---------------------------------------------------------------------------

export const GEAR: GearDefinition[] = [
	{ name: 'arrows-20', displayName: 'Arrows (20)', category: 'ammunition', cost: '1 gp', weight: 1, description: 'A bundle of twenty arrows for bows.' },
	{ name: 'bolts-20', displayName: 'Bolts (20)', category: 'ammunition', cost: '1 gp', weight: 1.5, description: 'A case of twenty crossbow bolts.' },
	{ name: 'component-pouch', displayName: 'Component Pouch', category: 'focus', cost: '25 gp', weight: 2, description: 'A small watertight leather belt pouch with spell components.' },
	{ name: 'arcane-focus', displayName: 'Arcane Focus', category: 'focus', cost: '10 gp', weight: 1, description: 'Crystal, orb, rod, staff, wand, or similar focus used for arcane spellcasting.' },
	{ name: 'holy-symbol', displayName: 'Holy Symbol', category: 'focus', cost: '5 gp', weight: 1, description: 'Amulet, emblem, or reliquary used as a divine spellcasting focus.' },
	{ name: 'druidic-focus', displayName: 'Druidic Focus', category: 'focus', cost: '1 gp', weight: 0, description: 'A sprig of mistletoe, totem, yew wand, staff, or similar focus for druid spells.' },
	{ name: 'thieves-tools', displayName: 'Thieves’ Tools', category: 'tool', cost: '25 gp', weight: 1, description: 'Tool set used to pick locks and disable traps.' },
	{ name: 'herbalism-kit', displayName: 'Herbalism Kit', category: 'tool', cost: '5 gp', weight: 3, description: 'A kit used to create remedies and potions.' },
	{ name: 'navigator-tools', displayName: 'Navigator’s Tools', category: 'tool', cost: '25 gp', weight: 2, description: 'Instruments used for sea navigation.' },
	{ name: 'disguise-kit', displayName: 'Disguise Kit', category: 'tool', cost: '25 gp', weight: 3, description: 'Cosmetics, hair dye, and small props for disguise work.' },
	{ name: 'forgery-kit', displayName: 'Forgery Kit', category: 'tool', cost: '15 gp', weight: 5, description: 'Inks, papers, and implements for creating convincing fakes.' },
	{ name: 'gaming-set', displayName: 'Gaming Set', category: 'tool', cost: '1 gp', weight: 0, description: 'Dice, cards, or other gaming set.' },
	{ name: 'musical-instrument', displayName: 'Musical Instrument', category: 'tool', cost: '5 gp', weight: 3, description: 'A lute, flute, horn, drum, or similar instrument.' },
	{ name: 'artisan-tools', displayName: 'Artisan’s Tools', category: 'tool', cost: '5 gp', weight: 5, description: 'A set of tools appropriate to a craft profession.' },
	{ name: 'rope-hempen-50', displayName: 'Hempen Rope (50 feet)', category: 'gear', cost: '1 gp', weight: 10, description: 'A sturdy rope suitable for climbing and hauling.' },
	{ name: 'torch', displayName: 'Torch', category: 'gear', cost: '1 cp', weight: 1, description: 'Burns for 1 hour, providing bright light in a 20-foot radius.' },
	{ name: 'rations-1-day', displayName: 'Rations (1 day)', category: 'gear', cost: '5 sp', weight: 2, description: 'Dry preserved food suitable for travel.' },
	{ name: 'waterskin', displayName: 'Waterskin', category: 'gear', cost: '2 sp', weight: 5, description: 'A leather or treated hide container for water.' },
	{ name: 'bedroll', displayName: 'Bedroll', category: 'gear', cost: '1 gp', weight: 7, description: 'A simple sleeping roll for camping.' },
	{ name: 'crowbar', displayName: 'Crowbar', category: 'gear', cost: '2 gp', weight: 5, description: 'Useful for prying open crates, doors, and chests.' },
	{ name: 'grappling-hook', displayName: 'Grappling Hook', category: 'gear', cost: '2 gp', weight: 4, description: 'Thrown hook for climbing or snagging.' },
	{ name: 'lantern-bullseye', displayName: 'Bullseye Lantern', category: 'gear', cost: '10 gp', weight: 2, description: 'Sheds bright light in a 60-foot cone and dim light 60 feet beyond.' },
	{ name: 'oil-flask', displayName: 'Oil (Flask)', category: 'gear', cost: '1 sp', weight: 1, description: 'Flammable oil used for lanterns or improvised hazards.' },
	{ name: 'mess-kit', displayName: 'Mess Kit', category: 'gear', cost: '2 sp', weight: 1, description: 'Plate, bowl, cup, and utensils for meals on the road.' },
	{ name: 'tinderbox', displayName: 'Tinderbox', category: 'gear', cost: '5 sp', weight: 1, description: 'Flint, fire steel, and tinder for starting fires.' },
	{ name: 'healers-kit', displayName: 'Healer’s Kit', category: 'gear', cost: '5 gp', weight: 3, description: 'Bandages, salves, and splints. Has ten uses for stabilizing creatures.' },
	{ name: 'priest-pack', displayName: 'Priest’s Pack', category: 'pack', cost: '19 gp', weight: 24, description: 'A kit for clergy and divine adventurers.', contents: ['Backpack', 'Blanket', '10 Candles', 'Tinderbox', 'Alms Box', '2 Blocks of Incense', 'Censer', 'Vestments', '2 Days of Rations', 'Waterskin'] },
	{ name: 'explorers-pack', displayName: 'Explorer’s Pack', category: 'pack', cost: '10 gp', weight: 59, description: 'A rugged pack for wilderness travel.', contents: ['Backpack', 'Bedroll', 'Mess Kit', 'Tinderbox', '10 Torches', '10 Days of Rations', 'Waterskin', 'Hempen Rope (50 feet)'] },
	{ name: 'dungeoneers-pack', displayName: 'Dungeoneer’s Pack', category: 'pack', cost: '12 gp', weight: 61.5, description: 'A pack stocked for cramped, dangerous expeditions.', contents: ['Backpack', 'Crowbar', 'Hammer', '10 Pitons', '10 Torches', 'Tinderbox', '10 Days of Rations', 'Waterskin', 'Hempen Rope (50 feet)'] },
	{ name: 'burglars-pack', displayName: 'Burglar’s Pack', category: 'pack', cost: '16 gp', weight: 47.5, description: 'A stealth-oriented pack for infiltration.', contents: ['Backpack', '1,000 Ball Bearings', '10 Feet of String', 'Bell', '5 Candles', 'Crowbar', 'Hammer', '10 Pitons', 'Hooded Lantern', '2 Flasks of Oil', '5 Days of Rations', 'Tinderbox', 'Waterskin', 'Hempen Rope (50 feet)'] },
	{ name: 'scholars-pack', displayName: 'Scholar’s Pack', category: 'pack', cost: '40 gp', weight: 10, description: 'A pack suited to lorekeepers and researchers.', contents: ['Backpack', 'Book of Lore', 'Bottle of Ink', 'Ink Pen', '10 Sheets of Parchment', 'Little Bag of Sand', 'Small Knife'] },
	{ name: 'diplomats-pack', displayName: 'Diplomat’s Pack', category: 'pack', cost: '39 gp', weight: 36, description: 'Travel gear suitable for social envoys.', contents: ['Chest', '2 Cases for Maps and Scrolls', 'Fine Clothes', 'Bottle of Ink', 'Ink Pen', 'Lamp', '2 Flasks of Oil', '5 Sheets of Paper', 'Vial of Perfume', 'Sealing Wax', 'Soap'] },
	{ name: 'entertainers-pack', displayName: 'Entertainer’s Pack', category: 'pack', cost: '40 gp', weight: 38, description: 'A performer’s road kit.', contents: ['Backpack', 'Bedroll', '2 Costumes', '5 Candles', '5 Days of Rations', 'Waterskin', 'Disguise Kit'] }
];
// ---------------------------------------------------------------------------
// Musical Instruments (SRD)
// ---------------------------------------------------------------------------

/** Display names of the standard SRD musical instruments a character may choose from. */
export const INSTRUMENTS: string[] = [
	'Bagpipes', 'Drum', 'Dulcimer', 'Flute', 'Lute', 'Lyre', 'Horn', 'Pan Flute', 'Shawm', 'Viol'
];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize curly/smart apostrophes to straight ASCII ' for comparison. */
function normApost(s: string): string {
	return s.trim().toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'");
}

export function getWeapon(name: string): WeaponDefinition | undefined {
	const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
	return WEAPONS.find((weapon) => weapon.name === normalized || normApost(weapon.displayName) === normApost(name));
}

export function getArmor(name: string): ArmorDefinition | undefined {
	const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
	return ARMOR.find((armor) => armor.name === normalized || normApost(armor.displayName) === normApost(name));
}

export function getGear(name: string): GearDefinition | undefined {
	const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
	return GEAR.find((gear) => gear.name === normalized || normApost(gear.displayName) === normApost(name));
}
