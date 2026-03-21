/**
 * Phase F Unit Tests — Inventory, Equipment & Economy Engine
 *
 * Tests cover:
 *   - AC calculation (all armor types, unarmored defense, shields, magic bonuses)
 *   - Equip/unequip (armor swap, weapon limits, shield handling)
 *   - Consumable usage (healing potions, charge depletion, item removal)
 *   - Add/remove items (stacking, ID generation, quantity management)
 *   - Encumbrance (standard + variant rules)
 *   - Attunement (3-item limit, validation)
 *   - Gold transactions (buy/sell, insufficient gold)
 *   - Utility functions (getEquippedWeapons, getEquippedArmor, etc.)
 *   - Immutability guarantees
 */

import { describe, it, expect } from 'vitest';
import {
	computeAC,
	equipItem,
	unequipItem,
	useConsumable,
	addItemToInventory,
	removeItemFromInventory,
	getCarryCapacity,
	getCurrentLoad,
	isEncumbered,
	getEncumbranceInfo,
	attuneItem,
	unattuneItem,
	buyItem,
	sellItem,
	getEquippedWeapons,
	getEquippedArmor,
	getEquippedShield,
	findItem,
	isWeapon,
	isArmor,
	isConsumable,
	MAX_ATTUNEMENT_SLOTS,
	MAX_EQUIPPED_WEAPONS
} from './inventory';
import type { PlayerCharacter, Item, WeaponItem, ArmorItem, ConsumableItem, MiscItem } from './types';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeCharacter(overrides: Partial<PlayerCharacter> = {}): PlayerCharacter {
	return {
		id: 'test-char-1',
		userId: 'user-1',
		adventureId: 'adv-1',
		name: 'Testus the Bold',
		race: 'human',
		classes: [{ name: 'fighter', level: 5, hitDiceRemaining: 5 }],
		classSpells: [],
		pactSlots: [],
		level: 5,
		abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
		hp: 44,
		maxHp: 44,
		tempHp: 0,
		ac: 18,
		speed: 30,
		size: 'Medium',
		proficiencyBonus: 3,
		skillProficiencies: ['athletics', 'perception', 'intimidation'],
		expertiseSkills: [],
		saveProficiencies: ['str', 'con'],
		languages: ['common'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		classFeatures: [],
		feats: [],
		spellSlots: [],
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception: 14,
		inventory: [],
		gold: 50,
		xp: 6500,
		conditions: [],
		resistances: [],
		exhaustionLevel: 0,
		stable: false,
		dead: false,
		featureUses: {},
		attunedItems: [],
		backstory: '',
		...overrides
	};
}

// --- Item factories ---

function makeWeapon(overrides: Partial<WeaponItem> = {}): WeaponItem {
	return {
		id: 'weapon-longsword',
		name: 'Longsword',
		category: 'weapon',
		description: 'A versatile slashing weapon.',
		value: 15,
		quantity: 1,
		weight: 3,
		rarity: 'common',
		attunement: false,
		weaponName: 'longsword',
		damage: '1d8',
		damageType: 'slashing',
		magicBonus: 0,
		properties: ['versatile'],
		equipped: false,
		...overrides
	};
}

function makeArmor(overrides: Partial<ArmorItem> = {}): ArmorItem {
	return {
		id: 'armor-chain-mail',
		name: 'Chain Mail',
		category: 'armor',
		description: 'Heavy armor made of interlocking metal rings.',
		value: 75,
		quantity: 1,
		weight: 55,
		rarity: 'common',
		attunement: false,
		armorName: 'chain-mail',
		baseAC: 16,
		magicBonus: 0,
		equipped: false,
		maxDexBonus: 0,
		stealthDisadvantage: true,
		...overrides
	};
}

function makeShield(overrides: Partial<ArmorItem> = {}): ArmorItem {
	return makeArmor({
		id: 'armor-shield',
		name: 'Shield',
		armorName: 'shield',
		baseAC: 2,
		weight: 6,
		maxDexBonus: null,
		stealthDisadvantage: false,
		...overrides
	});
}

function makeLeatherArmor(overrides: Partial<ArmorItem> = {}): ArmorItem {
	return makeArmor({
		id: 'armor-leather',
		name: 'Leather Armor',
		armorName: 'leather',
		baseAC: 11,
		weight: 10,
		value: 10,
		maxDexBonus: null,
		stealthDisadvantage: false,
		...overrides
	});
}

function makePotion(overrides: Partial<ConsumableItem> = {}): ConsumableItem {
	return {
		id: 'potion-healing',
		name: 'Potion of Healing',
		category: 'consumable',
		description: 'A vial of red liquid that heals wounds.',
		value: 50,
		quantity: 1,
		weight: 0.5,
		rarity: 'common',
		attunement: false,
		charges: 1,
		maxCharges: 1,
		effectDescription: 'Regain 2d4+2 hit points when you drink this potion.',
		consumableType: 'potion',
		...overrides
	};
}

function makeMiscItem(overrides: Partial<MiscItem> = {}): MiscItem {
	return {
		id: 'misc-rope',
		name: 'Hempen Rope (50 feet)',
		category: 'misc',
		description: 'A sturdy rope.',
		value: 1,
		quantity: 1,
		weight: 10,
		rarity: 'common',
		attunement: false,
		...overrides
	};
}

// ===========================================================================
// computeAC
// ===========================================================================

describe('computeAC', () => {
	describe('no armor', () => {
		it('returns 10 + DEX mod with no equipment', () => {
			const char = makeCharacter({ inventory: [] }); // DEX 14, mod +2
			expect(computeAC(char)).toBe(12);
		});

		it('handles negative DEX modifier', () => {
			const char = makeCharacter({
				abilities: { str: 16, dex: 8, con: 14, int: 10, wis: 12, cha: 8 },
				inventory: []
			});
			expect(computeAC(char)).toBe(9); // 10 + (-1)
		});
	});

	describe('light armor', () => {
		it('leather armor: baseAC + full DEX mod', () => {
			const char = makeCharacter({
				inventory: [makeLeatherArmor({ equipped: true })]
			}); // DEX 14 mod +2, leather baseAC 11
			expect(computeAC(char)).toBe(13); // 11 + 2
		});

		it('studded leather: baseAC + full DEX mod', () => {
			const char = makeCharacter({
				abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 },
				inventory: [makeArmor({ id: 'studded', armorName: 'studded-leather', baseAC: 12, maxDexBonus: null, equipped: true })]
			});
			expect(computeAC(char)).toBe(16); // 12 + 4
		});
	});

	describe('medium armor', () => {
		it('scale mail: caps DEX bonus at +2', () => {
			const char = makeCharacter({
				abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 },
				inventory: [makeArmor({ id: 'scale', armorName: 'scale-mail', baseAC: 14, maxDexBonus: 2, equipped: true })]
			}); // DEX 18 mod +4, capped at 2
			expect(computeAC(char)).toBe(16); // 14 + 2
		});

		it('half plate with DEX +1 — uses DEX (under cap)', () => {
			const char = makeCharacter({
				abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
				inventory: [makeArmor({ id: 'half-plate', armorName: 'half-plate', baseAC: 15, maxDexBonus: 2, equipped: true })]
			});
			expect(computeAC(char)).toBe(16); // 15 + 1
		});
	});

	describe('heavy armor', () => {
		it('chain mail: no DEX contribution', () => {
			const char = makeCharacter({
				abilities: { str: 16, dex: 18, con: 14, int: 10, wis: 12, cha: 8 },
				inventory: [makeArmor({ equipped: true })] // chain mail, maxDexBonus: 0
			});
			expect(computeAC(char)).toBe(16);
		});

		it('plate: AC 18 regardless of DEX', () => {
			const char = makeCharacter({
				abilities: { str: 16, dex: 20, con: 14, int: 10, wis: 12, cha: 8 },
				inventory: [makeArmor({ id: 'plate', armorName: 'plate', baseAC: 18, maxDexBonus: 0, equipped: true })]
			});
			expect(computeAC(char)).toBe(18);
		});
	});

	describe('shield', () => {
		it('adds shield AC bonus to no armor', () => {
			const char = makeCharacter({
				inventory: [makeShield({ equipped: true })]
			}); // 10 + DEX(2) + shield(2)
			expect(computeAC(char)).toBe(14);
		});

		it('chain mail + shield = AC 18', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: true }), // chain mail 16
					makeShield({ equipped: true })  // +2
				]
			});
			expect(computeAC(char)).toBe(18);
		});

		it('leather + shield', () => {
			const char = makeCharacter({
				inventory: [
					makeLeatherArmor({ equipped: true }), // 11 + DEX(2) = 13
					makeShield({ equipped: true })          // +2
				]
			});
			expect(computeAC(char)).toBe(15);
		});
	});

	describe('magic bonuses', () => {
		it('+1 chain mail = 17', () => {
			const char = makeCharacter({
				inventory: [makeArmor({ equipped: true, magicBonus: 1 })]
			});
			expect(computeAC(char)).toBe(17);
		});

		it('+2 plate armor = 20', () => {
			const char = makeCharacter({
				inventory: [makeArmor({ id: 'plate+2', armorName: 'plate', baseAC: 18, maxDexBonus: 0, equipped: true, magicBonus: 2 })]
			});
			expect(computeAC(char)).toBe(20);
		});

		it('+1 shield adds to total', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: true }), // chain mail 16
					makeShield({ equipped: true, magicBonus: 1 }) // 2+1=3
				]
			});
			expect(computeAC(char)).toBe(19);
		});
	});

	describe('unarmored defense', () => {
		it('barbarian: 10 + DEX + CON', () => {
			const char = makeCharacter({
				classes: [{ name: 'barbarian', level: 5, hitDiceRemaining: 5 }],
				abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
				inventory: []
			});
			expect(computeAC(char)).toBe(15); // 10 + 2 + 3
		});

		it('barbarian with shield: 10 + DEX + CON + shield', () => {
			const char = makeCharacter({
				classes: [{ name: 'barbarian', level: 5, hitDiceRemaining: 5 }],
				abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
				inventory: [makeShield({ equipped: true })]
			});
			expect(computeAC(char)).toBe(17); // 10 + 2 + 3 + 2
		});

		it('barbarian wearing armor uses armor AC not unarmored', () => {
			const char = makeCharacter({
				classes: [{ name: 'barbarian', level: 5, hitDiceRemaining: 5 }],
				abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
				inventory: [makeArmor({ equipped: true })] // chain mail 16
			});
			expect(computeAC(char)).toBe(16); // armor overrides
		});

		it('monk: 10 + DEX + WIS (no shield)', () => {
			const char = makeCharacter({
				classes: [{ name: 'monk', level: 5, hitDiceRemaining: 5 }],
				abilities: { str: 10, dex: 18, con: 12, int: 10, wis: 16, cha: 8 },
				inventory: []
			});
			expect(computeAC(char)).toBe(17); // 10 + 4 + 3
		});

		it('monk does NOT benefit from shield with unarmored defense', () => {
			const char = makeCharacter({
				classes: [{ name: 'monk', level: 5, hitDiceRemaining: 5 }],
				abilities: { str: 10, dex: 18, con: 12, int: 10, wis: 16, cha: 8 },
				inventory: [makeShield({ equipped: true })]
			});
			// Monk unarmored defense doesn't stack with shields per RAW
			expect(computeAC(char)).toBe(17); // 10 + 4 + 3, no shield
		});
	});

	describe('unequipped armor is ignored', () => {
		it('only counts equipped armor', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: false }), // unequipped chain mail
					makeLeatherArmor({ equipped: true }) // equipped leather
				]
			});
			expect(computeAC(char)).toBe(13); // 11 + 2 (leather + DEX)
		});
	});
});

// ===========================================================================
// equipItem
// ===========================================================================

describe('equipItem', () => {
	describe('armor', () => {
		it('equips armor and recalculates AC', () => {
			const char = makeCharacter({ inventory: [makeArmor()] });
			const result = equipItem(char, 'armor-chain-mail');

			expect(result.success).toBe(true);
			const equipped = result.character.inventory.find((i) => i.id === 'armor-chain-mail') as ArmorItem;
			expect(equipped.equipped).toBe(true);
			expect(result.character.ac).toBe(16);
		});

		it('swaps out currently equipped armor', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: true }),
					makeLeatherArmor()
				]
			});
			const result = equipItem(char, 'armor-leather');

			expect(result.success).toBe(true);
			expect(result.unequipped).toContain('Chain Mail');
			const chainMail = result.character.inventory.find((i) => i.id === 'armor-chain-mail') as ArmorItem;
			const leather = result.character.inventory.find((i) => i.id === 'armor-leather') as ArmorItem;
			expect(chainMail.equipped).toBe(false);
			expect(leather.equipped).toBe(true);
			// AC should be recalculated to leather: 11 + DEX(2) = 13
			expect(result.character.ac).toBe(13);
		});

		it('equips shield alongside armor', () => {
			const char = makeCharacter({
				inventory: [makeArmor({ equipped: true }), makeShield()]
			});
			const result = equipItem(char, 'armor-shield');

			expect(result.success).toBe(true);
			const shield = result.character.inventory.find((i) => i.id === 'armor-shield') as ArmorItem;
			expect(shield.equipped).toBe(true);
			expect(result.character.ac).toBe(18); // chain mail 16 + shield 2
		});

		it('swaps shield without affecting body armor', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: true }),
					makeShield({ equipped: true }),
					makeShield({ id: 'shield-magic', name: 'Shield +1', magicBonus: 1 })
				]
			});
			const result = equipItem(char, 'shield-magic');

			expect(result.unequipped).toContain('Shield');
			const oldShield = result.character.inventory.find((i) => i.id === 'armor-shield') as ArmorItem;
			expect(oldShield.equipped).toBe(false);
			expect(result.character.ac).toBe(19); // 16 + 2 + 1
		});
	});

	describe('weapons', () => {
		it('equips a weapon', () => {
			const char = makeCharacter({ inventory: [makeWeapon()] });
			const result = equipItem(char, 'weapon-longsword');

			expect(result.success).toBe(true);
			const weapon = result.character.inventory.find((i) => i.id === 'weapon-longsword') as WeaponItem;
			expect(weapon.equipped).toBe(true);
		});

		it('allows 2 weapons equipped simultaneously', () => {
			const char = makeCharacter({
				inventory: [
					makeWeapon({ equipped: true }),
					makeWeapon({ id: 'weapon-dagger', name: 'Dagger', weaponName: 'dagger' })
				]
			});
			const result = equipItem(char, 'weapon-dagger');

			expect(result.success).toBe(true);
			const equipped = result.character.inventory.filter(
				(i) => i.category === 'weapon' && (i as WeaponItem).equipped
			);
			expect(equipped).toHaveLength(2);
		});

		it('unequips oldest weapon when 3rd is equipped', () => {
			const char = makeCharacter({
				inventory: [
					makeWeapon({ equipped: true }),
					makeWeapon({ id: 'weapon-dagger', name: 'Dagger', weaponName: 'dagger', equipped: true }),
					makeWeapon({ id: 'weapon-rapier', name: 'Rapier', weaponName: 'rapier' })
				]
			});
			const result = equipItem(char, 'weapon-rapier');

			expect(result.success).toBe(true);
			expect(result.unequipped).toContain('Longsword');
			const equippedWeapons = result.character.inventory.filter(
				(i) => i.category === 'weapon' && (i as WeaponItem).equipped
			);
			expect(equippedWeapons).toHaveLength(2);
		});

		it('no-op if weapon already equipped', () => {
			const char = makeCharacter({ inventory: [makeWeapon({ equipped: true })] });
			const result = equipItem(char, 'weapon-longsword');
			expect(result.success).toBe(true);
			expect(result.unequipped).toHaveLength(0);
		});
	});

	describe('validation', () => {
		it('fails for non-existent item', () => {
			const char = makeCharacter();
			const result = equipItem(char, 'nonexistent');
			expect(result.success).toBe(false);
			expect(result.reason).toContain('not found');
		});

		it('fails for consumable items', () => {
			const char = makeCharacter({ inventory: [makePotion()] });
			const result = equipItem(char, 'potion-healing');
			expect(result.success).toBe(false);
			expect(result.reason).toContain('Only weapons and armor');
		});

		it('fails for misc items', () => {
			const char = makeCharacter({ inventory: [makeMiscItem()] });
			const result = equipItem(char, 'misc-rope');
			expect(result.success).toBe(false);
		});
	});

	describe('immutability', () => {
		it('does not mutate the input character', () => {
			const char = makeCharacter({ inventory: [makeArmor()] });
			equipItem(char, 'armor-chain-mail');
			const armor = char.inventory.find((i) => i.id === 'armor-chain-mail') as ArmorItem;
			expect(armor.equipped).toBe(false);
		});
	});
});

// ===========================================================================
// unequipItem
// ===========================================================================

describe('unequipItem', () => {
	it('unequips armor and recalculates AC', () => {
		const char = makeCharacter({
			inventory: [makeArmor({ equipped: true })]
		});
		const result = unequipItem(char, 'armor-chain-mail');

		expect(result.success).toBe(true);
		const armor = result.character.inventory.find((i) => i.id === 'armor-chain-mail') as ArmorItem;
		expect(armor.equipped).toBe(false);
		// AC drops to 10 + DEX(2) = 12
		expect(result.character.ac).toBe(12);
	});

	it('unequips weapon', () => {
		const char = makeCharacter({ inventory: [makeWeapon({ equipped: true })] });
		const result = unequipItem(char, 'weapon-longsword');

		expect(result.success).toBe(true);
		const weapon = result.character.inventory.find((i) => i.id === 'weapon-longsword') as WeaponItem;
		expect(weapon.equipped).toBe(false);
	});

	it('no-op for already unequipped item', () => {
		const char = makeCharacter({ inventory: [makeArmor()] });
		const result = unequipItem(char, 'armor-chain-mail');
		expect(result.success).toBe(true);
	});

	it('unequips shield and recalculates AC', () => {
		const char = makeCharacter({
			inventory: [makeArmor({ equipped: true }), makeShield({ equipped: true })]
		});
		const result = unequipItem(char, 'armor-shield');

		expect(result.success).toBe(true);
		expect(result.character.ac).toBe(16); // chain mail only
	});

	it('fails for non-existent item', () => {
		const char = makeCharacter();
		const result = unequipItem(char, 'nonexistent');
		expect(result.success).toBe(false);
	});

	it('fails for non-equipment item', () => {
		const char = makeCharacter({ inventory: [makePotion()] });
		const result = unequipItem(char, 'potion-healing');
		expect(result.success).toBe(false);
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter({ inventory: [makeArmor({ equipped: true })] });
		unequipItem(char, 'armor-chain-mail');
		const armor = char.inventory.find((i) => i.id === 'armor-chain-mail') as ArmorItem;
		expect(armor.equipped).toBe(true);
	});
});

// ===========================================================================
// useConsumable
// ===========================================================================

describe('useConsumable', () => {
	it('uses a potion and applies healing', () => {
		const char = makeCharacter({
			hp: 30,
			maxHp: 44,
			inventory: [makePotion()]
		});
		const result = useConsumable(char, 'potion-healing');

		expect(result.success).toBe(true);
		expect(result.healing).toBeDefined();
		expect(result.healing!).toBeGreaterThan(0);
		expect(result.character.hp).toBeGreaterThan(30);
	});

	it('removes potion from inventory after use', () => {
		const char = makeCharacter({
			hp: 30,
			inventory: [makePotion()]
		});
		const result = useConsumable(char, 'potion-healing');

		expect(result.itemRemoved).toBe(true);
		expect(result.character.inventory.find((i) => i.id === 'potion-healing')).toBeUndefined();
	});

	it('caps healing at maxHp', () => {
		const char = makeCharacter({
			hp: 43,
			maxHp: 44,
			inventory: [makePotion()]
		});
		const result = useConsumable(char, 'potion-healing');

		expect(result.character.hp).toBe(44);
		expect(result.healing).toBe(1);
	});

	it('handles multi-charge consumable', () => {
		const char = makeCharacter({
			inventory: [makePotion({ id: 'wand-1', charges: 5, maxCharges: 7, consumableType: 'other', effectDescription: 'Cast a spell.' })]
		});
		const result = useConsumable(char, 'wand-1');

		expect(result.success).toBe(true);
		expect(result.itemRemoved).toBe(false);
		expect(result.chargesRemaining).toBe(4);
	});

	it('does not remove "other" consumable type at 0 charges — wait, it does for default types', () => {
		// Items with consumableType that are NOT in the remove set ('other') stay
		const char = makeCharacter({
			inventory: [makePotion({ id: 'wand-1', charges: 1, consumableType: 'other', effectDescription: 'Cast a spell.' })]
		});
		const result = useConsumable(char, 'wand-1');

		// 'other' is NOT in the removable set, so it should stay
		expect(result.itemRemoved).toBe(false);
		expect(result.chargesRemaining).toBe(0);
	});

	it('fails for non-existent item', () => {
		const char = makeCharacter();
		const result = useConsumable(char, 'nonexistent');
		expect(result.success).toBe(false);
	});

	it('fails for non-consumable item', () => {
		const char = makeCharacter({ inventory: [makeWeapon()] });
		const result = useConsumable(char, 'weapon-longsword');
		expect(result.success).toBe(false);
	});

	it('fails if no charges remaining', () => {
		const char = makeCharacter({
			inventory: [makePotion({ charges: 0 })]
		});
		const result = useConsumable(char, 'potion-healing');
		expect(result.success).toBe(false);
		expect(result.reason).toContain('No charges');
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter({
			hp: 30,
			inventory: [makePotion()]
		});
		useConsumable(char, 'potion-healing');
		expect(char.hp).toBe(30);
		expect(char.inventory).toHaveLength(1);
	});

	it('heals based on potion description', () => {
		// Greater Healing Potion: 4d4+4
		const char = makeCharacter({
			hp: 10,
			maxHp: 44,
			inventory: [makePotion({
				id: 'greater-potion',
				effectDescription: 'Regain 4d4+4 hit points when you drink this potion.'
			})]
		});
		const result = useConsumable(char, 'greater-potion');
		// Average of 4d4+4 = 4*2.5+4 = 14
		expect(result.healing).toBe(14);
		expect(result.character.hp).toBe(24);
	});
});

// ===========================================================================
// addItemToInventory
// ===========================================================================

describe('addItemToInventory', () => {
	it('adds a new item with generated ID', () => {
		const char = makeCharacter();
		const { id: _id, ...itemWithoutId } = makeWeapon();
		const result = addItemToInventory(char, itemWithoutId);

		expect(result.character.inventory).toHaveLength(1);
		expect(result.itemId).toBeDefined();
		expect(result.stacked).toBe(false);
	});

	it('uses provided ID if given', () => {
		const char = makeCharacter();
		const result = addItemToInventory(char, makeWeapon({ id: 'custom-id' }));

		expect(result.itemId).toBe('custom-id');
	});

	it('stacks items with same name and category', () => {
		const char = makeCharacter({
			inventory: [makeMiscItem({ quantity: 1 })]
		});
		const { id: _id, ...newRope } = makeMiscItem({ quantity: 2 });
		const result = addItemToInventory(char, newRope);

		expect(result.stacked).toBe(true);
		expect(result.character.inventory).toHaveLength(1);
		expect(result.character.inventory[0].quantity).toBe(3);
	});

	it('does not stack items with different names', () => {
		const char = makeCharacter({
			inventory: [makeMiscItem()]
		});
		const result = addItemToInventory(char, makeMiscItem({ id: 'misc-torch', name: 'Torch' }));

		expect(result.stacked).toBe(false);
		expect(result.character.inventory).toHaveLength(2);
	});

	it('does not stack items with different categories', () => {
		const char = makeCharacter({
			inventory: [makeWeapon({ name: 'Longsword' })]
		});
		const result = addItemToInventory(char, makeMiscItem({ name: 'Longsword' }));

		expect(result.stacked).toBe(false);
		expect(result.character.inventory).toHaveLength(2);
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter();
		addItemToInventory(char, makeWeapon());
		expect(char.inventory).toHaveLength(0);
	});
});

// ===========================================================================
// removeItemFromInventory
// ===========================================================================

describe('removeItemFromInventory', () => {
	it('removes a single item', () => {
		const char = makeCharacter({ inventory: [makeWeapon()] });
		const result = removeItemFromInventory(char, 'weapon-longsword');

		expect(result.success).toBe(true);
		expect(result.character.inventory).toHaveLength(0);
		expect(result.removedItem?.name).toBe('Longsword');
		expect(result.quantityRemoved).toBe(1);
	});

	it('reduces quantity instead of removing when > 1', () => {
		const char = makeCharacter({ inventory: [makeMiscItem({ quantity: 5 })] });
		const result = removeItemFromInventory(char, 'misc-rope', 2);

		expect(result.success).toBe(true);
		expect(result.character.inventory[0].quantity).toBe(3);
		expect(result.quantityRemoved).toBe(2);
	});

	it('removes entirely when quantity equals removal', () => {
		const char = makeCharacter({ inventory: [makeMiscItem({ quantity: 3 })] });
		const result = removeItemFromInventory(char, 'misc-rope', 3);

		expect(result.success).toBe(true);
		expect(result.character.inventory).toHaveLength(0);
	});

	it('clamps removal to available quantity', () => {
		const char = makeCharacter({ inventory: [makeMiscItem({ quantity: 2 })] });
		const result = removeItemFromInventory(char, 'misc-rope', 10);

		expect(result.success).toBe(true);
		expect(result.character.inventory).toHaveLength(0);
		expect(result.quantityRemoved).toBe(2);
	});

	it('removes item from attunedItems when fully removed', () => {
		const char = makeCharacter({
			inventory: [makeWeapon({ attunement: true })],
			attunedItems: ['weapon-longsword']
		});
		const result = removeItemFromInventory(char, 'weapon-longsword');

		expect(result.character.attunedItems).not.toContain('weapon-longsword');
	});

	it('fails for non-existent item', () => {
		const char = makeCharacter();
		const result = removeItemFromInventory(char, 'nonexistent');
		expect(result.success).toBe(false);
		expect(result.removedItem).toBeNull();
	});

	it('does not mutate the input character', () => {
		const char = makeCharacter({ inventory: [makeWeapon()] });
		removeItemFromInventory(char, 'weapon-longsword');
		expect(char.inventory).toHaveLength(1);
	});
});

// ===========================================================================
// Encumbrance
// ===========================================================================

describe('encumbrance', () => {
	describe('getCarryCapacity', () => {
		it('returns STR × 15', () => {
			const char = makeCharacter(); // STR 16
			expect(getCarryCapacity(char)).toBe(240);
		});

		it('handles low strength', () => {
			const char = makeCharacter({ abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
			expect(getCarryCapacity(char)).toBe(120);
		});
	});

	describe('getCurrentLoad', () => {
		it('sums weight × quantity for all items', () => {
			const char = makeCharacter({
				inventory: [
					makeMiscItem({ weight: 10, quantity: 2 }),  // 20
					makeWeapon({ weight: 3, quantity: 1 }),      // 3
					makeArmor({ weight: 55, quantity: 1 })       // 55
				]
			});
			expect(getCurrentLoad(char)).toBe(78);
		});

		it('returns 0 for empty inventory', () => {
			const char = makeCharacter();
			expect(getCurrentLoad(char)).toBe(0);
		});
	});

	describe('isEncumbered', () => {
		it('returns false when under capacity', () => {
			const char = makeCharacter({
				inventory: [makeMiscItem({ weight: 10, quantity: 1 })]
			});
			expect(isEncumbered(char)).toBe(false);
		});

		it('returns true when over capacity', () => {
			const char = makeCharacter({
				abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
				inventory: [makeMiscItem({ weight: 50, quantity: 3 })] // 150 > 120
			});
			expect(isEncumbered(char)).toBe(true);
		});
	});

	describe('getEncumbranceInfo', () => {
		it('shows variant thresholds', () => {
			// STR 16: capacity 240, variant encumbered at 80, heavily at 160
			const char = makeCharacter({
				inventory: [makeMiscItem({ weight: 25, quantity: 4 })] // 100 lbs
			});
			const info = getEncumbranceInfo(char);

			expect(info.currentLoad).toBe(100);
			expect(info.capacity).toBe(240);
			expect(info.encumbered).toBe(false);
			expect(info.variantEncumbered).toBe(true); // 100 > 80
			expect(info.variantHeavilyEncumbered).toBe(false); // 100 < 160
		});

		it('shows heavily encumbered', () => {
			const char = makeCharacter({
				inventory: [makeMiscItem({ weight: 50, quantity: 4 })] // 200 lbs
			});
			const info = getEncumbranceInfo(char);

			expect(info.variantHeavilyEncumbered).toBe(true); // 200 > 160
		});

		it('all clear when light load', () => {
			const char = makeCharacter({
				inventory: [makeMiscItem({ weight: 5, quantity: 1 })]
			});
			const info = getEncumbranceInfo(char);

			expect(info.encumbered).toBe(false);
			expect(info.variantEncumbered).toBe(false);
			expect(info.variantHeavilyEncumbered).toBe(false);
		});
	});
});

// ===========================================================================
// Attunement
// ===========================================================================

describe('attunement', () => {
	describe('attuneItem', () => {
		it('attunes to a magic item', () => {
			const char = makeCharacter({
				inventory: [makeWeapon({ attunement: true })]
			});
			const result = attuneItem(char, 'weapon-longsword');

			expect(result.success).toBe(true);
			expect(result.character.attunedItems).toContain('weapon-longsword');
		});

		it('fails if item not in inventory', () => {
			const char = makeCharacter();
			const result = attuneItem(char, 'nonexistent');
			expect(result.success).toBe(false);
		});

		it('fails if item does not require attunement', () => {
			const char = makeCharacter({
				inventory: [makeWeapon({ attunement: false })]
			});
			const result = attuneItem(char, 'weapon-longsword');
			expect(result.success).toBe(false);
			expect(result.reason).toContain('does not require attunement');
		});

		it('fails if already attuned', () => {
			const char = makeCharacter({
				inventory: [makeWeapon({ attunement: true })],
				attunedItems: ['weapon-longsword']
			});
			const result = attuneItem(char, 'weapon-longsword');
			expect(result.success).toBe(false);
			expect(result.reason).toContain('Already attuned');
		});

		it('fails if at attunement limit (3)', () => {
			const char = makeCharacter({
				inventory: [
					makeWeapon({ id: 'w1', attunement: true }),
					makeWeapon({ id: 'w2', attunement: true }),
					makeWeapon({ id: 'w3', attunement: true }),
					makeWeapon({ id: 'w4', attunement: true })
				],
				attunedItems: ['w1', 'w2', 'w3']
			});
			const result = attuneItem(char, 'w4');
			expect(result.success).toBe(false);
			expect(result.reason).toContain('3');
		});

		it('does not mutate the input character', () => {
			const char = makeCharacter({
				inventory: [makeWeapon({ attunement: true })]
			});
			attuneItem(char, 'weapon-longsword');
			expect(char.attunedItems).toHaveLength(0);
		});
	});

	describe('unattuneItem', () => {
		it('removes attunement', () => {
			const char = makeCharacter({
				inventory: [makeWeapon({ attunement: true })],
				attunedItems: ['weapon-longsword']
			});
			const result = unattuneItem(char, 'weapon-longsword');

			expect(result.success).toBe(true);
			expect(result.character.attunedItems).not.toContain('weapon-longsword');
		});

		it('fails if not attuned', () => {
			const char = makeCharacter();
			const result = unattuneItem(char, 'weapon-longsword');
			expect(result.success).toBe(false);
		});

		it('does not mutate the input character', () => {
			const char = makeCharacter({ attunedItems: ['some-item'] });
			unattuneItem(char, 'some-item');
			expect(char.attunedItems).toHaveLength(1);
		});
	});
});

// ===========================================================================
// Gold Transactions
// ===========================================================================

describe('gold transactions', () => {
	describe('buyItem', () => {
		it('buys an item and deducts gold', () => {
			const char = makeCharacter({ gold: 100 });
			const result = buyItem(char, makeWeapon(), 15);

			expect(result.success).toBe(true);
			expect(result.character.gold).toBe(85);
			expect(result.character.inventory).toHaveLength(1);
			expect(result.goldDelta).toBe(-15);
		});

		it('fails with insufficient gold', () => {
			const char = makeCharacter({ gold: 10 });
			const result = buyItem(char, makeArmor(), 75);

			expect(result.success).toBe(false);
			expect(result.reason).toContain('Insufficient gold');
			expect(result.character.gold).toBe(10);
		});

		it('allows buying for 0 gold (free)', () => {
			const char = makeCharacter({ gold: 0 });
			const result = buyItem(char, makeMiscItem(), 0);

			expect(result.success).toBe(true);
			expect(result.character.gold).toBe(0);
			expect(result.character.inventory).toHaveLength(1);
		});

		it('fails with negative cost', () => {
			const char = makeCharacter();
			const result = buyItem(char, makeWeapon(), -5);
			expect(result.success).toBe(false);
		});

		it('returns the item ID', () => {
			const char = makeCharacter();
			const result = buyItem(char, makeWeapon(), 15);
			expect(result.itemId).toBeDefined();
		});

		it('does not mutate the input character', () => {
			const char = makeCharacter({ gold: 100 });
			buyItem(char, makeWeapon(), 15);
			expect(char.gold).toBe(100);
			expect(char.inventory).toHaveLength(0);
		});
	});

	describe('sellItem', () => {
		it('sells an item and gains gold', () => {
			const char = makeCharacter({
				gold: 50,
				inventory: [makeWeapon()]
			});
			const result = sellItem(char, 'weapon-longsword', 7);

			expect(result.success).toBe(true);
			expect(result.character.gold).toBe(57);
			expect(result.character.inventory).toHaveLength(0);
			expect(result.goldDelta).toBe(7);
		});

		it('fails for non-existent item', () => {
			const char = makeCharacter();
			const result = sellItem(char, 'nonexistent', 10);
			expect(result.success).toBe(false);
		});

		it('fails with negative price', () => {
			const char = makeCharacter({ inventory: [makeWeapon()] });
			const result = sellItem(char, 'weapon-longsword', -5);
			expect(result.success).toBe(false);
		});

		it('allows selling for 0 gold', () => {
			const char = makeCharacter({ inventory: [makeWeapon()] });
			const result = sellItem(char, 'weapon-longsword', 0);
			expect(result.success).toBe(true);
			expect(result.character.inventory).toHaveLength(0);
		});

		it('does not mutate the input character', () => {
			const char = makeCharacter({ gold: 50, inventory: [makeWeapon()] });
			sellItem(char, 'weapon-longsword', 10);
			expect(char.gold).toBe(50);
			expect(char.inventory).toHaveLength(1);
		});
	});
});

// ===========================================================================
// Utility functions
// ===========================================================================

describe('utility functions', () => {
	describe('type guards', () => {
		it('isWeapon identifies weapons', () => {
			expect(isWeapon(makeWeapon())).toBe(true);
			expect(isWeapon(makeArmor())).toBe(false);
		});

		it('isArmor identifies armor', () => {
			expect(isArmor(makeArmor())).toBe(true);
			expect(isArmor(makeWeapon())).toBe(false);
		});

		it('isConsumable identifies consumables', () => {
			expect(isConsumable(makePotion())).toBe(true);
			expect(isConsumable(makeWeapon())).toBe(false);
		});
	});

	describe('getEquippedWeapons', () => {
		it('returns only equipped weapons', () => {
			const char = makeCharacter({
				inventory: [
					makeWeapon({ equipped: true }),
					makeWeapon({ id: 'w2', name: 'Dagger', equipped: false }),
					makeArmor({ equipped: true })
				]
			});
			const weapons = getEquippedWeapons(char);
			expect(weapons).toHaveLength(1);
			expect(weapons[0].name).toBe('Longsword');
		});
	});

	describe('getEquippedArmor', () => {
		it('returns equipped non-shield armor', () => {
			const char = makeCharacter({
				inventory: [
					makeArmor({ equipped: true }),
					makeShield({ equipped: true })
				]
			});
			const armor = getEquippedArmor(char);
			expect(armor?.armorName).toBe('chain-mail');
		});

		it('returns undefined when no armor equipped', () => {
			const char = makeCharacter({ inventory: [makeShield({ equipped: true })] });
			expect(getEquippedArmor(char)).toBeUndefined();
		});
	});

	describe('getEquippedShield', () => {
		it('returns equipped shield', () => {
			const char = makeCharacter({ inventory: [makeShield({ equipped: true })] });
			const shield = getEquippedShield(char);
			expect(shield?.armorName).toBe('shield');
		});

		it('returns undefined when no shield equipped', () => {
			const char = makeCharacter({ inventory: [makeArmor({ equipped: true })] });
			expect(getEquippedShield(char)).toBeUndefined();
		});
	});

	describe('findItem', () => {
		it('finds item by ID', () => {
			const char = makeCharacter({ inventory: [makeWeapon()] });
			expect(findItem(char, 'weapon-longsword')?.name).toBe('Longsword');
		});

		it('returns undefined for missing ID', () => {
			const char = makeCharacter();
			expect(findItem(char, 'nope')).toBeUndefined();
		});
	});
});

// ===========================================================================
// Verification scenarios (from plan)
// ===========================================================================

describe('plan verification scenarios', () => {
	it('equip chain mail + shield → verify AC 18', () => {
		const char = makeCharacter({
			inventory: [makeArmor(), makeShield()]
		});
		let result = equipItem(char, 'armor-chain-mail');
		result = equipItem(result.character, 'armor-shield');
		expect(result.character.ac).toBe(18);
	});

	it('swap chain mail to leather → verify AC recalculated', () => {
		const char = makeCharacter({
			inventory: [
				makeArmor({ equipped: true }),
				makeShield({ equipped: true }),
				makeLeatherArmor()
			],
			ac: 18
		});
		const result = equipItem(char, 'armor-leather');

		// Leather 11 + DEX(2) + shield(2) = 15
		expect(result.character.ac).toBe(15);
		expect(result.unequipped).toContain('Chain Mail');
	});

	it('use potion of healing → verify HP change + potion removed', () => {
		const char = makeCharacter({
			hp: 20,
			maxHp: 44,
			inventory: [makePotion()]
		});
		const result = useConsumable(char, 'potion-healing');

		expect(result.success).toBe(true);
		expect(result.character.hp).toBeGreaterThan(20);
		expect(result.itemRemoved).toBe(true);
		expect(result.character.inventory.find((i) => i.id === 'potion-healing')).toBeUndefined();
	});

	it('buy item with insufficient gold → verify rejection', () => {
		const char = makeCharacter({ gold: 10 });
		const result = buyItem(char, makeArmor({ value: 75 }), 75);

		expect(result.success).toBe(false);
		expect(result.character.gold).toBe(10);
		expect(result.character.inventory).toHaveLength(0);
	});

	it('exceed carry capacity → verify encumbered flag', () => {
		// STR 8 → capacity 120 lbs
		const char = makeCharacter({
			abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
			inventory: [
				makeArmor({ weight: 55, quantity: 1 }),     // 55
				makeMiscItem({ weight: 40, quantity: 2 })   // 80
			]
		});

		expect(isEncumbered(char)).toBe(true);
		expect(getCurrentLoad(char)).toBe(135);
		expect(getCarryCapacity(char)).toBe(120);
	});
});

// ===========================================================================
// Integration: full equip/buy/sell/attune workflow
// ===========================================================================

describe('full workflow integration', () => {
	it('buy → equip → attune → sell cycle', () => {
		let char = makeCharacter({ gold: 200 });

		// Buy a magic sword
		const magicSword = makeWeapon({
			name: 'Flame Tongue',
			attunement: true,
			magicBonus: 1,
			value: 100
		});
		const buyResult = buyItem(char, magicSword, 100);
		expect(buyResult.success).toBe(true);
		char = buyResult.character;
		expect(char.gold).toBe(100);

		// Equip it
		const equipResult = equipItem(char, buyResult.itemId!);
		expect(equipResult.success).toBe(true);
		char = equipResult.character;

		// Attune to it
		const attuneResult = attuneItem(char, buyResult.itemId!);
		expect(attuneResult.success).toBe(true);
		char = attuneResult.character;
		expect(char.attunedItems).toHaveLength(1);

		// Un-attune
		const unattuneResult = unattuneItem(char, buyResult.itemId!);
		expect(unattuneResult.success).toBe(true);
		char = unattuneResult.character;
		expect(char.attunedItems).toHaveLength(0);

		// Sell it
		const sellResult = sellItem(char, buyResult.itemId!, 50);
		expect(sellResult.success).toBe(true);
		char = sellResult.character;
		expect(char.gold).toBe(150);
		expect(char.inventory).toHaveLength(0);
	});

	it('buy multiple consumables → use them → verify stacking', () => {
		let char = makeCharacter({ gold: 200, hp: 20, maxHp: 44 });

		// Buy first potion
		const potion1 = makePotion({ quantity: 1 });
		const buy1 = buyItem(char, potion1, 50);
		char = buy1.character;

		// Buy second potion (should stack)
		const potion2 = makePotion({ quantity: 1 });
		const buy2 = buyItem(char, potion2, 50);
		char = buy2.character;

		// Should have 1 stack of 2
		const potions = char.inventory.filter((i) => i.name === 'Potion of Healing');
		expect(potions).toHaveLength(1);
		expect(potions[0].quantity).toBe(2);

		// Use one (should remove since consumable with 1 charge per item)
		const useResult = useConsumable(char, potions[0].id);
		expect(useResult.success).toBe(true);
		expect(useResult.character.hp).toBeGreaterThan(20);
	});
});
