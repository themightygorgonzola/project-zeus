/**
 * 5e SRD Class Definitions
 *
 * All 12 PHB classes with the SRD subclass, per-level features,
 * spellcasting tables, proficiencies, and ASI schedule.
 *
 * Sources: 5e SRD (CC-BY-4.0)
 */

import type { AbilityName, SkillName, ClassName, ClassLevel } from '../types';
import type { ArmorProficiency, WeaponProficiency, ToolProficiency } from './races';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpellcastingStyle = 'none' | 'full' | 'half' | 'third' | 'pact';

export interface SpellcastingConfig {
	style: SpellcastingStyle;
	ability: AbilityName;
	/** Cantrips known at each class level (index 0 = level 1). */
	cantripsKnown: number[];
	/** Spell slots per spell level per class level.  slots[classLevel-1][spellLevel-1] */
	slotsPerLevel: number[][];
	/** For known-casters: spells known at each class level (index 0 = level 1). null = prepared caster. */
	spellsKnown: (number | null)[];
	/** Whether the caster prepares spells (vs knowing a fixed list). */
	preparesCasts: boolean;
	/** Ritual casting allowed? */
	ritual: boolean;
}

export interface ClassFeature {
	name: string;
	level: number;
	description: string;
	/** Tags for mechanical look-ups: 'asi', 'subclass', 'extra-attack', etc. */
	tags: string[];
}

export interface SubclassDefinition {
	name: string;
	displayName: string;
	description: string;
	features: ClassFeature[];
}

export interface StartingEquipmentChoice {
	label: string;
	options: string[][];  // each option is an array of item names
}

export interface ClassDefinition {
	name: ClassName;
	displayName: string;
	description: string;
	hitDie: number;
	primaryAbility: AbilityName[];
	saveProficiencies: AbilityName[];
	armorProficiencies: ArmorProficiency[];
	weaponProficiencies: (WeaponProficiency | 'simple' | 'martial')[];
	toolProficiencies: ToolProficiency[];
	skillPickCount: number;
	skillOptions: SkillName[];
	/** All class features across levels 1–20. */
	features: ClassFeature[];
	/** SRD subclass for this class. */
	subclass: SubclassDefinition;
	/** Level at which the subclass is chosen. */
	subclassLevel: number;
	/** Label for the subclass archetype (e.g. "Martial Archetype"). */
	subclassLabel: string;
	spellcasting: SpellcastingConfig | null;
	equipmentChoices: StartingEquipmentChoice[];
	/** Guaranteed items received at character creation, regardless of player equipment choices. */
	startingEquipment: string[];
	/** Multiclass prerequisites: ability scores that must be ≥ 13. */
	multiclassPrereqs: AbilityName[];
	/** Proficiencies gained when multiclassing INTO this class. */
	multiclassGrants: {
		armor: ArmorProficiency[];
		weapons: (WeaponProficiency | 'simple' | 'martial')[];
		tools: ToolProficiency[];
		skills: number; // pick N from class skill list
	};
}

// ---------------------------------------------------------------------------
// Spell Slot Tables (SRD)
// ---------------------------------------------------------------------------

/** Full caster slots per level: rows = class levels 1–20, columns = spell levels 1–9 */
export const FULL_CASTER_SLOTS: number[][] = [
	[2,0,0,0,0,0,0,0,0], // 1
	[3,0,0,0,0,0,0,0,0], // 2
	[4,2,0,0,0,0,0,0,0], // 3
	[4,3,0,0,0,0,0,0,0], // 4
	[4,3,2,0,0,0,0,0,0], // 5
	[4,3,3,0,0,0,0,0,0], // 6
	[4,3,3,1,0,0,0,0,0], // 7
	[4,3,3,2,0,0,0,0,0], // 8
	[4,3,3,3,1,0,0,0,0], // 9
	[4,3,3,3,2,0,0,0,0], // 10
	[4,3,3,3,2,1,0,0,0], // 11
	[4,3,3,3,2,1,0,0,0], // 12
	[4,3,3,3,2,1,1,0,0], // 13
	[4,3,3,3,2,1,1,0,0], // 14
	[4,3,3,3,2,1,1,1,0], // 15
	[4,3,3,3,2,1,1,1,0], // 16
	[4,3,3,3,2,1,1,1,1], // 17
	[4,3,3,3,3,1,1,1,1], // 18
	[4,3,3,3,3,2,1,1,1], // 19
	[4,3,3,3,3,2,2,1,1], // 20
];

/** Half caster (paladin/ranger) slots per level */
const HALF_CASTER_SLOTS: number[][] = [
	[0,0,0,0,0,0,0,0,0], // 1 — no slots
	[2,0,0,0,0,0,0,0,0], // 2
	[3,0,0,0,0,0,0,0,0], // 3
	[3,0,0,0,0,0,0,0,0], // 4
	[4,2,0,0,0,0,0,0,0], // 5
	[4,2,0,0,0,0,0,0,0], // 6
	[4,3,0,0,0,0,0,0,0], // 7
	[4,3,0,0,0,0,0,0,0], // 8
	[4,3,2,0,0,0,0,0,0], // 9
	[4,3,2,0,0,0,0,0,0], // 10
	[4,3,3,0,0,0,0,0,0], // 11
	[4,3,3,0,0,0,0,0,0], // 12
	[4,3,3,1,0,0,0,0,0], // 13
	[4,3,3,1,0,0,0,0,0], // 14
	[4,3,3,2,0,0,0,0,0], // 15
	[4,3,3,2,0,0,0,0,0], // 16
	[4,3,3,3,1,0,0,0,0], // 17
	[4,3,3,3,1,0,0,0,0], // 18
	[4,3,3,3,2,0,0,0,0], // 19
	[4,3,3,3,2,0,0,0,0], // 20
];

/** Third caster (Eldritch Knight / Arcane Trickster would use this) */
const THIRD_CASTER_SLOTS: number[][] = [
	[0,0,0,0,0,0,0,0,0], // 1
	[0,0,0,0,0,0,0,0,0], // 2
	[2,0,0,0,0,0,0,0,0], // 3
	[3,0,0,0,0,0,0,0,0], // 4
	[3,0,0,0,0,0,0,0,0], // 5
	[3,0,0,0,0,0,0,0,0], // 6
	[4,2,0,0,0,0,0,0,0], // 7
	[4,2,0,0,0,0,0,0,0], // 8
	[4,2,0,0,0,0,0,0,0], // 9
	[4,3,0,0,0,0,0,0,0], // 10
	[4,3,0,0,0,0,0,0,0], // 11
	[4,3,0,0,0,0,0,0,0], // 12
	[4,3,2,0,0,0,0,0,0], // 13
	[4,3,2,0,0,0,0,0,0], // 14
	[4,3,2,0,0,0,0,0,0], // 15
	[4,3,3,0,0,0,0,0,0], // 16
	[4,3,3,0,0,0,0,0,0], // 17
	[4,3,3,0,0,0,0,0,0], // 18
	[4,3,3,1,0,0,0,0,0], // 19
	[4,3,3,1,0,0,0,0,0], // 20
];

/** Warlock Pact Magic slots (all slots are the same level) */
export const PACT_SLOTS: number[][] = [
	[1,0,0,0,0,0,0,0,0], // 1  — 1 slot, 1st level
	[2,0,0,0,0,0,0,0,0], // 2  — 2 slots, 1st level
	[0,2,0,0,0,0,0,0,0], // 3  — 2 slots, 2nd level
	[0,2,0,0,0,0,0,0,0], // 4
	[0,0,2,0,0,0,0,0,0], // 5  — 2 slots, 3rd level
	[0,0,2,0,0,0,0,0,0], // 6
	[0,0,0,2,0,0,0,0,0], // 7  — 2 slots, 4th level
	[0,0,0,2,0,0,0,0,0], // 8
	[0,0,0,0,2,0,0,0,0], // 9  — 2 slots, 5th level
	[0,0,0,0,2,0,0,0,0], // 10
	[0,0,0,0,3,0,0,0,0], // 11 — 3 slots, 5th level
	[0,0,0,0,3,0,0,0,0], // 12
	[0,0,0,0,3,0,0,0,0], // 13
	[0,0,0,0,3,0,0,0,0], // 14
	[0,0,0,0,3,0,0,0,0], // 15
	[0,0,0,0,3,0,0,0,0], // 16
	[0,0,0,0,4,0,0,0,0], // 17 — 4 slots, 5th level
	[0,0,0,0,4,0,0,0,0], // 18
	[0,0,0,0,4,0,0,0,0], // 19
	[0,0,0,0,4,0,0,0,0], // 20
];

const NO_SLOTS: number[][] = Array.from({ length: 20 }, () => [0,0,0,0,0,0,0,0,0]);

// ---------------------------------------------------------------------------
// Cantrips Known Tables
// ---------------------------------------------------------------------------

const WIZARD_CANTRIPS     = [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5];
const CLERIC_CANTRIPS     = [3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5];
const DRUID_CANTRIPS      = [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4];
const BARD_CANTRIPS       = [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4];
const SORCERER_CANTRIPS   = [4,4,4,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6];
const WARLOCK_CANTRIPS    = [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4];
const NO_CANTRIPS         = Array(20).fill(0);

// ---------------------------------------------------------------------------
// Spells Known Tables (for known-casters)
// ---------------------------------------------------------------------------

const BARD_SPELLS_KNOWN     = [4,5,6,7,8,9,10,11,12,14,15,15,16,18,19,19,20,22,22,22];
const SORCERER_SPELLS_KNOWN = [2,3,4,5,6,7,8,9,10,11,12,12,13,13,14,14,15,15,15,15];
const WARLOCK_SPELLS_KNOWN  = [2,3,4,5,6,7,8,9,10,10,11,11,12,12,13,13,14,14,15,15];
const RANGER_SPELLS_KNOWN   = [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11];

// ---------------------------------------------------------------------------
// Helper: ASI / Feat levels
// ---------------------------------------------------------------------------

const STANDARD_ASI_LEVELS = [4, 8, 12, 16, 19];
const FIGHTER_ASI_LEVELS = [4, 6, 8, 12, 14, 16, 19];
const ROGUE_ASI_LEVELS = [4, 8, 10, 12, 16, 19];

function asiFeatures(levels: number[]): ClassFeature[] {
	return levels.map((l) => ({
		name: 'Ability Score Improvement',
		level: l,
		description: 'Increase one ability score by 2, or two ability scores by 1, or gain a feat.',
		tags: ['asi']
	}));
}

// ---------------------------------------------------------------------------
// Class Data
// ---------------------------------------------------------------------------

export const CLASSES: ClassDefinition[] = [
	// ━━ FIGHTER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'fighter',
		displayName: 'Fighter',
		description: 'A master of martial combat, skilled with a variety of weapons and armor.',
		hitDie: 10,
		primaryAbility: ['str'],
		saveProficiencies: ['str', 'con'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'],
		subclassLevel: 3,
		subclassLabel: 'Martial Archetype',
		spellcasting: null,
		features: [
			{ name: 'Fighting Style', level: 1, description: 'You adopt a particular style of fighting as your specialty.', tags: ['fighting-style'] },
			{ name: 'Second Wind', level: 1, description: 'You have a limited well of stamina. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level. Once used, you must finish a short or long rest.', tags: ['short-rest-recovery'] },
			{ name: 'Action Surge', level: 2, description: 'You can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action. You must finish a short or long rest before using again. Two uses at 17th level.', tags: ['short-rest-recovery'] },
			{ name: 'Extra Attack', level: 5, description: 'You can attack twice, instead of once, when you take the Attack action on your turn.', tags: ['extra-attack'] },
			{ name: 'Extra Attack (2)', level: 11, description: 'You can attack three times when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Extra Attack (3)', level: 20, description: 'You can attack four times when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Indomitable', level: 9, description: 'You can reroll a saving throw that you fail. You must use the new roll. Usable 1/long rest (2 at 13th, 3 at 17th).', tags: ['long-rest-recovery'] },
			...asiFeatures(FIGHTER_ASI_LEVELS)
		],
		subclass: {
			name: 'champion',
			displayName: 'Champion',
			description: 'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
			features: [
				{ name: 'Improved Critical', level: 3, description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.', tags: ['improved-critical'] },
				{ name: 'Remarkable Athlete', level: 7, description: 'You can add half your proficiency bonus (rounded up) to any STR, DEX, or CON check that doesn\'t already use your proficiency bonus. Running long jump distance increases by your STR modifier in feet.', tags: [] },
				{ name: 'Additional Fighting Style', level: 10, description: 'You choose a second Fighting Style option.', tags: ['fighting-style'] },
				{ name: 'Superior Critical', level: 15, description: 'Your weapon attacks score a critical hit on a roll of 18–20.', tags: ['improved-critical'] },
				{ name: 'Survivor', level: 18, description: 'At the start of each of your turns, you regain hit points equal to 5 + your CON modifier if you have no more than half of your hit points left. You don\'t gain this benefit if you have 0 hit points.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Armor', options: [['Chain Mail'], ['Leather Armor', 'Longbow', 'Arrows (20)']] },
			{ label: 'Weapons', options: [['Martial Weapon', 'Shield'], ['Two Martial Weapons']] },
			{ label: 'Ranged', options: [['Light Crossbow', 'Bolts (20)'], ['Two Handaxes']] },
			{ label: 'Pack', options: [['Dungeoneer\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: [],
		multiclassPrereqs: ['str'],
		multiclassGrants: { armor: ['light', 'medium', 'shields'], weapons: ['simple', 'martial'], tools: [], skills: 0 }
	},

	// ━━ WIZARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'wizard',
		displayName: 'Wizard',
		description: 'A scholarly magic-user capable of manipulating the structures of reality.',
		hitDie: 6,
		primaryAbility: ['int'],
		saveProficiencies: ['int', 'wis'],
		armorProficiencies: [],
		weaponProficiencies: ['dagger', 'dart', 'sling', 'quarterstaff', 'light-crossbow'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
		subclassLevel: 2,
		subclassLabel: 'Arcane Tradition',
		spellcasting: {
			style: 'full',
			ability: 'int',
			cantripsKnown: WIZARD_CANTRIPS,
			slotsPerLevel: FULL_CASTER_SLOTS,
			spellsKnown: Array(20).fill(null), // prepared caster
			preparesCasts: true,
			ritual: true
		},
		features: [
			{ name: 'Arcane Recovery', level: 1, description: 'Once per day during a short rest, you can recover spell slots with a combined level ≤ half your wizard level (rounded up), none of which can be 6th level or higher.', tags: ['short-rest-recovery'] },
			{ name: 'Spell Mastery', level: 18, description: 'Choose a 1st-level and a 2nd-level wizard spell. You can cast them at their lowest level without expending a spell slot.', tags: [] },
			{ name: 'Signature Spells', level: 20, description: 'Choose two 3rd-level wizard spells. You always have them prepared, and you can cast each once at 3rd level without expending a slot per short/long rest.', tags: ['short-rest-recovery'] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'evocation',
			displayName: 'School of Evocation',
			description: 'You focus your study on magic that creates powerful elemental effects.',
			features: [
				{ name: 'Evocation Savant', level: 2, description: 'The gold and time to copy an evocation spell into your spellbook is halved.', tags: [] },
				{ name: 'Sculpt Spells', level: 2, description: 'When you cast an evocation spell that affects other creatures you can see, you can choose a number of them equal to 1 + the spell\'s level. Those creatures automatically succeed on their save and take no damage.', tags: [] },
				{ name: 'Potent Cantrip', level: 6, description: 'When a creature succeeds on a saving throw against your cantrip, the creature takes half damage (if any) but suffers no additional effect.', tags: [] },
				{ name: 'Empowered Evocation', level: 10, description: 'You can add your INT modifier to one damage roll of any wizard evocation spell you cast.', tags: [] },
				{ name: 'Overchannel', level: 14, description: 'When you cast a wizard spell of 1st through 5th level that deals damage, you can deal maximum damage with that spell. Each use after the first per long rest causes 2d12 necrotic damage per spell level to you.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Quarterstaff'], ['Dagger']] },
			{ label: 'Focus', options: [['Component Pouch'], ['Arcane Focus']] },
			{ label: 'Pack', options: [['Scholar\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: [],
		multiclassPrereqs: ['int'],
		multiclassGrants: { armor: [], weapons: [], tools: [], skills: 0 }
	},

	// ━━ ROGUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'rogue',
		displayName: 'Rogue',
		description: 'A scoundrel who uses stealth and trickery to overcome obstacles and enemies.',
		hitDie: 8,
		primaryAbility: ['dex'],
		saveProficiencies: ['dex', 'int'],
		armorProficiencies: ['light'],
		weaponProficiencies: ['simple', 'hand-crossbow', 'longsword', 'rapier', 'shortsword'],
		toolProficiencies: ['thieves-tools'],
		skillPickCount: 4,
		skillOptions: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'],
		subclassLevel: 3,
		subclassLabel: 'Roguish Archetype',
		spellcasting: null,
		features: [
			{ name: 'Expertise', level: 1, description: 'Choose two of your skill proficiencies (or one skill and thieves\' tools). Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies. At 6th level, choose two more.', tags: ['expertise'] },
			{ name: 'Sneak Attack', level: 1, description: 'Once per turn, you can deal extra 1d6 damage to one creature you hit with an attack if you have advantage or an ally within 5 ft of the target. Scales: 1d6 per odd rogue level.', tags: ['sneak-attack'] },
			{ name: 'Thieves\' Cant', level: 1, description: 'You know a secret mix of dialect, jargon, and code that allows you to hide messages in seemingly normal conversation.', tags: [] },
			{ name: 'Cunning Action', level: 2, description: 'You can use a bonus action to Dash, Disengage, or Hide on each of your turns.', tags: [] },
			{ name: 'Uncanny Dodge', level: 5, description: 'When an attacker you can see hits you, you can use your reaction to halve the attack\'s damage against you.', tags: [] },
			{ name: 'Evasion', level: 7, description: 'When you are subjected to a DEX save for half damage, you take no damage on a success and half damage on a failure.', tags: ['evasion'] },
			{ name: 'Reliable Talent', level: 11, description: 'Whenever you make an ability check that includes your proficiency bonus, you can treat a d20 roll of 9 or lower as a 10.', tags: [] },
			{ name: 'Blindsense', level: 14, description: 'If you can hear, you are aware of the location of any hidden or invisible creature within 10 feet of you.', tags: [] },
			{ name: 'Slippery Mind', level: 15, description: 'You gain proficiency in Wisdom saving throws.', tags: [] },
			{ name: 'Elusive', level: 18, description: 'No attack roll has advantage against you while you aren\'t incapacitated.', tags: [] },
			{ name: 'Stroke of Luck', level: 20, description: 'If your attack misses, you can turn the miss into a hit. If you fail an ability check, you can treat the d20 roll as a 20. Once per short or long rest.', tags: ['short-rest-recovery'] },
			...asiFeatures(ROGUE_ASI_LEVELS)
		],
		subclass: {
			name: 'thief',
			displayName: 'Thief',
			description: 'You hone your skills in the larcenous arts.',
			features: [
				{ name: 'Fast Hands', level: 3, description: 'You can use Cunning Action to make a Sleight of Hand check, use thieves\' tools to disarm a trap or pick a lock, or take the Use an Object action.', tags: [] },
				{ name: 'Second-Story Work', level: 3, description: 'Climbing no longer costs extra movement. Running jump distance increases by your DEX modifier in feet.', tags: [] },
				{ name: 'Supreme Sneak', level: 9, description: 'You have advantage on a Stealth check if you move no more than half your speed on the same turn.', tags: [] },
				{ name: 'Use Magic Device', level: 13, description: 'You can use magic items regardless of class, race, or level requirements.', tags: [] },
				{ name: 'Thief\'s Reflexes', level: 17, description: 'You can take two turns during the first round of any combat. Your second turn is at your initiative minus 10.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Rapier'], ['Shortsword']] },
			{ label: 'Ranged', options: [['Shortbow', 'Arrows (20)'], ['Shortsword']] },
			{ label: 'Pack', options: [['Burglar\'s Pack'], ['Dungeoneer\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Leather Armor', 'Two Daggers', "Thieves' Tools"],
		multiclassPrereqs: ['dex'],
		multiclassGrants: { armor: ['light'], weapons: [], tools: ['thieves-tools'], skills: 1 }
	},

	// ━━ CLERIC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'cleric',
		displayName: 'Cleric',
		description: 'A priestly champion who wields divine magic in service of a higher power.',
		hitDie: 8,
		primaryAbility: ['wis'],
		saveProficiencies: ['wis', 'cha'],
		armorProficiencies: ['light', 'medium', 'shields'],
		weaponProficiencies: ['simple'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
		subclassLevel: 1,
		subclassLabel: 'Divine Domain',
		spellcasting: {
			style: 'full',
			ability: 'wis',
			cantripsKnown: CLERIC_CANTRIPS,
			slotsPerLevel: FULL_CASTER_SLOTS,
			spellsKnown: Array(20).fill(null),
			preparesCasts: true,
			ritual: true
		},
		features: [
			{ name: 'Channel Divinity', level: 2, description: 'You can channel divine energy. Turn Undead: each undead within 30 ft must make a WIS save or be turned for 1 minute. Additional uses at 6th (2/rest) and 18th (3/rest).', tags: ['short-rest-recovery'] },
			{ name: 'Destroy Undead', level: 5, description: 'When an undead fails its save against your Turn Undead, the creature is instantly destroyed if its CR is at or below a certain threshold. CR 1/2 at 5th, CR 1 at 8th, CR 2 at 11th, CR 3 at 14th, CR 4 at 17th.', tags: [] },
			{ name: 'Divine Intervention', level: 10, description: 'You can call on your deity to intervene. Roll a d100; if the number is ≤ your cleric level, the DM chooses the nature of the intervention. Auto-succeeds at 20th level.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'life',
			displayName: 'Life Domain',
			description: 'The Life domain focuses on the vibrant positive energy that sustains all life.',
			features: [
				{ name: 'Bonus Proficiency', level: 1, description: 'You gain proficiency with heavy armor.', tags: ['heavy-armor'] },
				{ name: 'Disciple of Life', level: 1, description: 'Your healing spells are more effective. Whenever you use a spell of 1st level or higher to restore hit points, the creature regains additional hit points equal to 2 + the spell\'s level.', tags: [] },
				{ name: 'Channel Divinity: Preserve Life', level: 2, description: 'You use your Channel Divinity to restore hit points to creatures within 30 ft, distributing up to 5× your cleric level in HP. No creature can be healed above half its max HP.', tags: [] },
				{ name: 'Blessed Healer', level: 6, description: 'When you cast a spell that restores hit points to another creature, you regain 2 + the spell\'s level in HP.', tags: [] },
				{ name: 'Divine Strike', level: 8, description: 'You can infuse your weapon strikes with divine energy. Once per turn, deal an extra 1d8 radiant damage (2d8 at 14th level).', tags: [] },
				{ name: 'Supreme Healing', level: 17, description: 'When you would normally roll dice to restore hit points with a spell, you instead use the highest number possible for each die.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Mace'], ['Warhammer']] },
			{ label: 'Armor', options: [['Scale Mail'], ['Leather Armor'], ['Chain Mail']] },
			{ label: 'Ranged', options: [['Light Crossbow', 'Bolts (20)'], ['Simple Weapon']] },
			{ label: 'Pack', options: [['Priest\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Shield', 'Holy Symbol'],
		multiclassPrereqs: ['wis'],
		multiclassGrants: { armor: ['light', 'medium', 'shields'], weapons: [], tools: [], skills: 0 }
	},

	// ━━ RANGER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'ranger',
		displayName: 'Ranger',
		description: 'A warrior who uses martial prowess and nature magic to combat threats on the edges of civilization.',
		hitDie: 10,
		primaryAbility: ['dex', 'wis'],
		saveProficiencies: ['str', 'dex'],
		armorProficiencies: ['light', 'medium', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		skillPickCount: 3,
		skillOptions: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
		subclassLevel: 3,
		subclassLabel: 'Ranger Archetype',
		spellcasting: {
			style: 'half',
			ability: 'wis',
			cantripsKnown: NO_CANTRIPS,
			slotsPerLevel: HALF_CASTER_SLOTS,
			spellsKnown: RANGER_SPELLS_KNOWN,
			preparesCasts: false,
			ritual: false
		},
		features: [
			{ name: 'Favored Enemy', level: 1, description: 'You have advantage on Survival checks to track your favored enemies, and on INT checks to recall information about them. You learn one language spoken by them. Choose again at 6th and 14th level.', tags: [] },
			{ name: 'Natural Explorer', level: 1, description: 'You are particularly familiar with one type of natural environment. Benefits for travel and exploration in that terrain. Choose again at 6th and 10th level.', tags: [] },
			{ name: 'Fighting Style', level: 2, description: 'You adopt a particular style of fighting as your specialty.', tags: ['fighting-style'] },
			{ name: 'Primeval Awareness', level: 3, description: 'You can expend a spell slot to sense whether certain creature types are within 1 mile (6 miles in favored terrain).', tags: [] },
			{ name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Land\'s Stride', level: 8, description: 'Moving through nonmagical difficult terrain costs no extra movement. You can pass through nonmagical plants without slowing. Advantage on saves against magically created plants.', tags: [] },
			{ name: 'Hide in Plain Sight', level: 10, description: 'You can spend 1 minute creating camouflage. You gain +10 to Stealth checks while camouflaged and remaining still.', tags: [] },
			{ name: 'Vanish', level: 14, description: 'You can use the Hide action as a bonus action. You also can\'t be tracked by nonmagical means unless you choose to leave a trail.', tags: [] },
			{ name: 'Feral Senses', level: 18, description: 'You don\'t have disadvantage on attack rolls against creatures you can\'t see. You\'re aware of the location of any invisible creature within 30 feet if not hidden.', tags: [] },
			{ name: 'Foe Slayer', level: 20, description: 'Once on each of your turns, you can add your WIS modifier to the attack roll or damage roll of an attack against one of your favored enemies.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'hunter',
			displayName: 'Hunter',
			description: 'Emulating the Hunter archetype means accepting your place as a bulwark between civilization and the terrors of the wilderness.',
			features: [
				{ name: 'Hunter\'s Prey', level: 3, description: 'Choose: Colossus Slayer (1d8 extra to injured targets), Giant Killer (reaction attack when Large+ creature misses), or Horde Breaker (attack a second adjacent creature).', tags: [] },
				{ name: 'Defensive Tactics', level: 7, description: 'Choose: Escape the Horde, Multiattack Defense, or Steel Will.', tags: [] },
				{ name: 'Multiattack', level: 11, description: 'Choose: Volley (ranged attack each creature in 10 ft radius) or Whirlwind Attack (melee attack each creature within reach).', tags: [] },
				{ name: 'Superior Hunter\'s Defense', level: 15, description: 'Choose: Evasion, Stand Against the Tide, or Uncanny Dodge.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Armor', options: [['Scale Mail'], ['Leather Armor']] },
			{ label: 'Weapons', options: [['Two Shortswords'], ['Two Simple Melee Weapons']] },
			{ label: 'Pack', options: [['Dungeoneer\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Longbow', 'Arrows (20)'],
		multiclassPrereqs: ['dex', 'wis'],
		multiclassGrants: { armor: ['light', 'medium', 'shields'], weapons: ['simple', 'martial'], tools: [], skills: 1 }
	},

	// ━━ BARBARIAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'barbarian',
		displayName: 'Barbarian',
		description: 'A fierce warrior of primitive background who can enter a battle rage.',
		hitDie: 12,
		primaryAbility: ['str'],
		saveProficiencies: ['str', 'con'],
		armorProficiencies: ['light', 'medium', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
		subclassLevel: 3,
		subclassLabel: 'Primal Path',
		spellcasting: null,
		features: [
			{ name: 'Rage', level: 1, description: 'In battle, you can enter a rage as a bonus action. While raging: advantage on STR checks/saves, bonus rage damage on melee STR attacks, resistance to bludgeoning/piercing/slashing. Rages per long rest: 2 at 1st (scales up).', tags: ['long-rest-recovery', 'rage'] },
			{ name: 'Unarmored Defense', level: 1, description: 'While not wearing armor, your AC equals 10 + DEX modifier + CON modifier. You can use a shield and still gain this benefit.', tags: ['unarmored-defense'] },
			{ name: 'Reckless Attack', level: 2, description: 'When you make your first attack on your turn, you can decide to attack recklessly. You have advantage on melee STR attack rolls this turn, but attack rolls against you have advantage until your next turn.', tags: [] },
			{ name: 'Danger Sense', level: 2, description: 'You have advantage on DEX saving throws against effects you can see (such as traps and spells), as long as you are not blinded, deafened, or incapacitated.', tags: [] },
			{ name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Fast Movement', level: 5, description: 'Your speed increases by 10 feet while you aren\'t wearing heavy armor.', tags: [] },
			{ name: 'Feral Instinct', level: 7, description: 'You have advantage on initiative rolls. If you are surprised and aren\'t incapacitated, you can act normally if you enter a rage before doing anything else.', tags: [] },
			{ name: 'Brutal Critical', level: 9, description: 'You can roll one additional weapon damage die when determining extra damage for a critical hit (2 dice at 13th, 3 at 17th).', tags: [] },
			{ name: 'Relentless Rage', level: 11, description: 'If you drop to 0 HP while raging and don\'t die outright, you can make a DC 10 CON save to drop to 1 HP instead. DC increases by 5 each subsequent time until a rest.', tags: [] },
			{ name: 'Persistent Rage', level: 15, description: 'Your rage ends early only if you fall unconscious or choose to end it.', tags: [] },
			{ name: 'Indomitable Might', level: 18, description: 'If your total for a Strength check is less than your Strength score, you can use that score in place of the total.', tags: [] },
			{ name: 'Primal Champion', level: 20, description: 'Your Strength and Constitution scores increase by 4. Your maximum for those scores is now 24.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'berserker',
			displayName: 'Path of the Berserker',
			description: 'For some barbarians, rage is a means to an end — that end being violence.',
			features: [
				{ name: 'Frenzy', level: 3, description: 'You can go into a frenzy when you rage. You can make a single melee weapon attack as a bonus action on each turn. When your rage ends, you suffer one level of exhaustion.', tags: [] },
				{ name: 'Mindless Rage', level: 6, description: 'You can\'t be charmed or frightened while raging. If already affected, the effect is suspended for the duration of the rage.', tags: [] },
				{ name: 'Intimidating Presence', level: 10, description: 'You can use your action to frighten someone within 30 feet. Target WIS save DC = 8 + proficiency + CHA mod. Frightened until end of your next turn.', tags: [] },
				{ name: 'Retaliation', level: 14, description: 'When you take damage from a creature within 5 feet of you, you can use your reaction to make a melee weapon attack against that creature.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Greataxe'], ['Martial Melee Weapon']] },
			{ label: 'Secondary', options: [['Two Handaxes'], ['Simple Weapon']] },
			{ label: 'Pack', options: [['Explorer\'s Pack']] }
		],
		startingEquipment: ['Four Javelins'],
		multiclassPrereqs: ['str'],
		multiclassGrants: { armor: ['shields'], weapons: ['simple', 'martial'], tools: [], skills: 0 }
	},

	// ━━ BARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'bard',
		displayName: 'Bard',
		description: 'An inspiring magician whose power echoes the music of creation.',
		hitDie: 8,
		primaryAbility: ['cha'],
		saveProficiencies: ['dex', 'cha'],
		armorProficiencies: ['light'],
		weaponProficiencies: ['simple', 'hand-crossbow', 'longsword', 'rapier', 'shortsword'],
		toolProficiencies: [],
		skillPickCount: 3,
		skillOptions: ['acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival'],
		subclassLevel: 3,
		subclassLabel: 'Bard College',
		spellcasting: {
			style: 'full',
			ability: 'cha',
			cantripsKnown: BARD_CANTRIPS,
			slotsPerLevel: FULL_CASTER_SLOTS,
			spellsKnown: BARD_SPELLS_KNOWN,
			preparesCasts: false,
			ritual: true
		},
		features: [
			{ name: 'Bardic Inspiration', level: 1, description: 'You can inspire others through stirring words or music. A creature (other than you) within 60 feet gains a Bardic Inspiration die (d6 → d8 at 5th, d10 at 10th, d12 at 15th). CHA mod uses per long rest (recharges on short rest at 5th level).', tags: ['short-rest-recovery'] },
			{ name: 'Jack of All Trades', level: 2, description: 'You can add half your proficiency bonus, rounded down, to any ability check that doesn\'t already include your proficiency bonus.', tags: [] },
			{ name: 'Song of Rest', level: 2, description: 'During a short rest, you or any friendly creatures who regain HP by spending Hit Dice regain an extra 1d6 HP (1d8 at 9th, 1d10 at 13th, 1d12 at 17th).', tags: [] },
			{ name: 'Expertise', level: 3, description: 'Choose two of your skill proficiencies. Your proficiency bonus is doubled for checks using them. Two more at 10th level.', tags: ['expertise'] },
			{ name: 'Font of Inspiration', level: 5, description: 'You regain all of your expended uses of Bardic Inspiration when you finish a short or long rest.', tags: [] },
			{ name: 'Countercharm', level: 6, description: 'You can use musical performance to counter mind-influencing effects. You and allies within 30 feet have advantage on saves against being frightened or charmed while you are performing.', tags: [] },
			{ name: 'Magical Secrets', level: 10, description: 'Choose two spells from any class\'s spell list. They count as bard spells for you and count against your spells known. Additional at 14th and 18th.', tags: [] },
			{ name: 'Superior Inspiration', level: 20, description: 'When you roll initiative and have no uses of Bardic Inspiration left, you regain one use.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'lore',
			displayName: 'College of Lore',
			description: 'Bards of the College of Lore know something about most things, collecting bits of knowledge.',
			features: [
				{ name: 'Bonus Proficiencies', level: 3, description: 'You gain proficiency in three skills of your choice.', tags: [] },
				{ name: 'Cutting Words', level: 3, description: 'When a creature within 60 feet makes an attack roll, ability check, or damage roll, you can use a reaction to expend a Bardic Inspiration die and subtract the number rolled from the creature\'s roll.', tags: [] },
				{ name: 'Additional Magical Secrets', level: 6, description: 'You learn two spells of your choice from any class. A spell you choose must be of a level you can cast.', tags: [] },
				{ name: 'Peerless Skill', level: 14, description: 'When you make an ability check, you can expend one use of Bardic Inspiration to add the die to the check.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Rapier'], ['Longsword'], ['Simple Weapon']] },
			{ label: 'Pack', options: [['Diplomat\'s Pack'], ['Entertainer\'s Pack']] },
			{ label: 'Instrument', options: [['Lute'], ['Musical Instrument']] }
		],
		startingEquipment: ['Leather Armor'],
		multiclassPrereqs: ['cha'],
		multiclassGrants: { armor: ['light'], weapons: [], tools: [], skills: 1 }
	},

	// ━━ PALADIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'paladin',
		displayName: 'Paladin',
		description: 'A holy warrior bound to a sacred oath.',
		hitDie: 10,
		primaryAbility: ['str', 'cha'],
		saveProficiencies: ['wis', 'cha'],
		armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
		weaponProficiencies: ['simple', 'martial'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
		subclassLevel: 3,
		subclassLabel: 'Sacred Oath',
		spellcasting: {
			style: 'half',
			ability: 'cha',
			cantripsKnown: NO_CANTRIPS,
			slotsPerLevel: HALF_CASTER_SLOTS,
			spellsKnown: Array(20).fill(null),
			preparesCasts: true,
			ritual: false
		},
		features: [
			{ name: 'Divine Sense', level: 1, description: 'You can detect the presence of any celestial, fiend, or undead within 60 feet. 1 + CHA mod uses per long rest.', tags: ['long-rest-recovery'] },
			{ name: 'Lay on Hands', level: 1, description: 'You have a pool of healing power equal to 5 × your paladin level. You can restore HP or cure disease/poison (5 HP per condition).', tags: ['long-rest-recovery'] },
			{ name: 'Fighting Style', level: 2, description: 'You adopt a particular style of fighting as your specialty.', tags: ['fighting-style'] },
			{ name: 'Divine Smite', level: 2, description: 'When you hit a creature with a melee weapon attack, you can expend a spell slot to deal 2d8 radiant damage (+1d8 per slot level above 1st, max 5d8). +1d8 vs undead/fiends.', tags: [] },
			{ name: 'Divine Health', level: 3, description: 'The divine magic flowing through you makes you immune to disease.', tags: [] },
			{ name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Aura of Protection', level: 6, description: 'Whenever you or a friendly creature within 10 feet makes a saving throw, the creature gains a bonus equal to your CHA modifier (min +1). Extends to 30 feet at 18th level.', tags: [] },
			{ name: 'Aura of Courage', level: 10, description: 'You and friendly creatures within 10 feet can\'t be frightened while you are conscious. Extends to 30 feet at 18th level.', tags: [] },
			{ name: 'Improved Divine Smite', level: 11, description: 'Whenever you hit a creature with a melee weapon, the creature takes an extra 1d8 radiant damage.', tags: [] },
			{ name: 'Cleansing Touch', level: 14, description: 'You can use your action to end one spell on yourself or on one willing creature you touch. CHA mod uses per long rest.', tags: ['long-rest-recovery'] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'devotion',
			displayName: 'Oath of Devotion',
			description: 'The Oath of Devotion binds a paladin to the loftiest ideals of justice, virtue, and order.',
			features: [
				{ name: 'Sacred Weapon', level: 3, description: 'As an action, imbue one weapon with positive energy for 1 minute: add CHA mod to attack rolls, the weapon emits light. Channel Divinity.', tags: [] },
				{ name: 'Turn the Unholy', level: 3, description: 'Each fiend or undead within 30 feet must make a WIS save or be turned for 1 minute. Channel Divinity.', tags: [] },
				{ name: 'Aura of Devotion', level: 7, description: 'You and friendly creatures within 10 feet can\'t be charmed while you are conscious. Extends to 30 feet at 18th level.', tags: [] },
				{ name: 'Purity of Spirit', level: 15, description: 'You are always under the effects of protection from evil and good.', tags: [] },
				{ name: 'Holy Nimbus', level: 20, description: 'As an action, you emanate an aura of sunlight. For 1 minute: 10 radiant damage to enemies within 30 feet at start of their turn, advantage on saves against fiend/undead spells and abilities.', tags: ['long-rest-recovery'] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapons', options: [['Martial Weapon', 'Shield'], ['Two Martial Weapons']] },
			{ label: 'Melee', options: [['Five Javelins'], ['Simple Melee Weapon']] },
			{ label: 'Pack', options: [['Priest\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Chain Mail', 'Holy Symbol'],
		multiclassPrereqs: ['str', 'cha'],
		multiclassGrants: { armor: ['light', 'medium', 'shields'], weapons: ['simple', 'martial'], tools: [], skills: 0 }
	},

	// ━━ SORCERER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'sorcerer',
		displayName: 'Sorcerer',
		description: 'A spellcaster who draws on inherent magic from a gift or bloodline.',
		hitDie: 6,
		primaryAbility: ['cha'],
		saveProficiencies: ['con', 'cha'],
		armorProficiencies: [],
		weaponProficiencies: ['dagger', 'dart', 'sling', 'quarterstaff', 'light-crossbow'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
		subclassLevel: 1,
		subclassLabel: 'Sorcerous Origin',
		spellcasting: {
			style: 'full',
			ability: 'cha',
			cantripsKnown: SORCERER_CANTRIPS,
			slotsPerLevel: FULL_CASTER_SLOTS,
			spellsKnown: SORCERER_SPELLS_KNOWN,
			preparesCasts: false,
			ritual: false
		},
		features: [
			{ name: 'Font of Magic', level: 2, description: 'You have sorcery points equal to your sorcerer level. You can create spell slots by spending points (and vice versa). Regain all on long rest.', tags: ['long-rest-recovery', 'sorcery-points'] },
			{ name: 'Metamagic', level: 3, description: 'You gain the ability to twist your spells to suit your needs. You learn two Metamagic options of your choice. You learn an additional one at 10th and 17th level. You can use only one Metamagic option on a spell unless otherwise noted.', tags: [] },
			{ name: 'Sorcerous Restoration', level: 20, description: 'You regain 4 expended sorcery points whenever you finish a short rest.', tags: ['short-rest-recovery'] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'draconic',
			displayName: 'Draconic Bloodline',
			description: 'Your innate magic comes from draconic magic that was mingled with your blood or that of your ancestors.',
			features: [
				{ name: 'Dragon Ancestor', level: 1, description: 'Choose a type of dragon. You can speak, read, and write Draconic. Double proficiency bonus on CHA checks when interacting with dragons.', tags: [] },
				{ name: 'Draconic Resilience', level: 1, description: 'Your hit point maximum increases by 1 at 1st level and again whenever you gain a sorcerer level. When not wearing armor, your AC equals 13 + DEX modifier.', tags: ['unarmored-defense'] },
				{ name: 'Elemental Affinity', level: 6, description: 'When you cast a spell that deals damage of the type associated with your draconic ancestry, you can add your CHA modifier to one damage roll. You can also spend 1 sorcery point to gain resistance to that damage type for 1 hour.', tags: [] },
				{ name: 'Dragon Wings', level: 14, description: 'You can sprout spectral dragon wings from your back, gaining a flying speed equal to your current speed.', tags: [] },
				{ name: 'Draconic Presence', level: 18, description: 'As an action, spend 5 sorcery points to exude an aura of awe or fear (your choice) in a 60-foot radius. Creatures make WIS save or are charmed/frightened for 1 minute.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Light Crossbow', 'Bolts (20)'], ['Simple Weapon']] },
			{ label: 'Focus', options: [['Component Pouch'], ['Arcane Focus']] },
			{ label: 'Pack', options: [['Dungeoneer\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Two Daggers'],
		multiclassPrereqs: ['cha'],
		multiclassGrants: { armor: [], weapons: [], tools: [], skills: 0 }
	},

	// ━━ WARLOCK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'warlock',
		displayName: 'Warlock',
		description: 'A wielder of magic that is derived from a bargain with an extraplanar entity.',
		hitDie: 8,
		primaryAbility: ['cha'],
		saveProficiencies: ['wis', 'cha'],
		armorProficiencies: ['light'],
		weaponProficiencies: ['simple'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
		subclassLevel: 1,
		subclassLabel: 'Otherworldly Patron',
		spellcasting: {
			style: 'pact',
			ability: 'cha',
			cantripsKnown: WARLOCK_CANTRIPS,
			slotsPerLevel: PACT_SLOTS,
			spellsKnown: WARLOCK_SPELLS_KNOWN,
			preparesCasts: false,
			ritual: false
		},
		features: [
			{ name: 'Eldritch Invocations', level: 2, description: 'You gain two eldritch invocations of your choice. You learn additional invocations at higher levels. When you gain a level, you can replace one invocation with another you qualify for.', tags: [] },
			{ name: 'Pact Boon', level: 3, description: 'Choose: Pact of the Chain (familiar), Pact of the Blade (weapon), or Pact of the Tome (cantrips).', tags: [] },
			{ name: 'Mystic Arcanum (6th)', level: 11, description: 'Choose one 6th-level warlock spell. You can cast it once per long rest without expending a slot. Additional arcana: 7th at 13th, 8th at 15th, 9th at 17th.', tags: ['long-rest-recovery'] },
			{ name: 'Eldritch Master', level: 20, description: 'You can spend 1 minute entreating your patron for aid to regain all expended Pact Magic spell slots. Once per long rest.', tags: ['long-rest-recovery'] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'fiend',
			displayName: 'The Fiend',
			description: 'You have made a pact with a fiend from the lower planes of existence.',
			features: [
				{ name: 'Dark One\'s Blessing', level: 1, description: 'When you reduce a hostile creature to 0 HP, you gain temporary hit points equal to your CHA modifier + your warlock level (minimum of 1).', tags: [] },
				{ name: 'Dark One\'s Own Luck', level: 6, description: 'When you make an ability check or a saving throw, you can add a d10 to your roll. You can do so after seeing the initial roll but before any of the roll\'s effects occur. Once per short or long rest.', tags: ['short-rest-recovery'] },
				{ name: 'Fiendish Resilience', level: 10, description: 'You can choose one damage type when you finish a short or long rest. You gain resistance to that damage type until you choose a different one with this feature.', tags: [] },
				{ name: 'Hurl Through Hell', level: 14, description: 'When you hit a creature with an attack, you can send it through the lower planes. The creature disappears and hurtles through a nightscape. It takes 10d10 psychic damage if not a fiend. Once per long rest.', tags: ['long-rest-recovery'] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Light Crossbow', 'Bolts (20)'], ['Simple Weapon']] },
			{ label: 'Focus', options: [['Component Pouch'], ['Arcane Focus']] },
			{ label: 'Pack', options: [['Scholar\'s Pack'], ['Dungeoneer\'s Pack']] }
		],
		startingEquipment: ['Leather Armor', 'Two Daggers'],
		multiclassPrereqs: ['cha'],
		multiclassGrants: { armor: ['light'], weapons: ['simple'], tools: [], skills: 0 }
	},

	// ━━ DRUID ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'druid',
		displayName: 'Druid',
		description: 'A priest of the Old Faith, wielding the powers of nature and adopting animal forms.',
		hitDie: 8,
		primaryAbility: ['wis'],
		saveProficiencies: ['int', 'wis'],
		armorProficiencies: ['light', 'medium', 'shields'],
		weaponProficiencies: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['arcana', 'animal-handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'],
		subclassLevel: 2,
		subclassLabel: 'Druid Circle',
		spellcasting: {
			style: 'full',
			ability: 'wis',
			cantripsKnown: DRUID_CANTRIPS,
			slotsPerLevel: FULL_CASTER_SLOTS,
			spellsKnown: Array(20).fill(null),
			preparesCasts: true,
			ritual: true
		},
		features: [
			{ name: 'Druidic', level: 1, description: 'You know Druidic, the secret language of druids. You can leave hidden messages and automatically spot such messages.', tags: [] },
			{ name: 'Wild Shape', level: 2, description: 'You can use your action to magically assume the shape of a beast that you have seen. You can use this feature twice per short or long rest. Max CR: 1/4 at 2nd (no fly/swim), 1/2 at 4th (no fly), 1 at 8th.', tags: ['short-rest-recovery', 'wild-shape'] },
			{ name: 'Timeless Body', level: 18, description: 'The primal magic you wield causes you to age more slowly. For every 10 years that pass, your body ages only 1 year.', tags: [] },
			{ name: 'Beast Spells', level: 18, description: 'You can cast many of your druid spells in any shape you assume using Wild Shape. You can perform the somatic and verbal components of a druid spell while in a beast shape.', tags: [] },
			{ name: 'Archdruid', level: 20, description: 'You can use your Wild Shape an unlimited number of times. You can ignore the verbal and somatic components of your druid spells, as well as any material components that lack a cost.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'land',
			displayName: 'Circle of the Land',
			description: 'The Circle of the Land is made up of mystics and sages who safeguard ancient knowledge.',
			features: [
				{ name: 'Bonus Cantrip', level: 2, description: 'You learn one additional druid cantrip of your choice.', tags: [] },
				{ name: 'Natural Recovery', level: 2, description: 'During a short rest, you can recover spell slots with a combined level ≤ half your druid level (rounded up). None of the slots can be 6th level or higher.', tags: ['short-rest-recovery'] },
				{ name: 'Circle Spells', level: 3, description: 'Your mystical connection to the land grants you access to certain spells based on the land where you became a druid. These spells are always prepared and don\'t count against your prepared spells.', tags: [] },
				{ name: 'Land\'s Stride', level: 6, description: 'Moving through nonmagical difficult terrain costs you no extra movement. You can pass through nonmagical plants without slowing.', tags: [] },
				{ name: 'Nature\'s Ward', level: 10, description: 'You can\'t be charmed or frightened by elementals or fey, and you are immune to poison and disease.', tags: [] },
				{ name: 'Nature\'s Sanctuary', level: 14, description: 'Creatures of the natural world sense your connection to nature and become hesitant to attack you. A beast or plant creature must make a WIS save before attacking you.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Wooden Shield'], ['Simple Weapon']] },
			{ label: 'Melee', options: [['Scimitar'], ['Simple Melee Weapon']] },
			{ label: 'Pack', options: [['Explorer\'s Pack']] }
		],
		startingEquipment: ['Leather Armor', 'Druidic Focus'],
		multiclassPrereqs: ['wis'],
		multiclassGrants: { armor: ['light', 'medium'], weapons: [], tools: [], skills: 0 }
	},

	// ━━ MONK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	{
		name: 'monk',
		displayName: 'Monk',
		description: 'A master of martial arts, harnessing the power of the body in pursuit of physical and spiritual perfection.',
		hitDie: 8,
		primaryAbility: ['dex', 'wis'],
		saveProficiencies: ['str', 'dex'],
		armorProficiencies: [],
		weaponProficiencies: ['simple', 'shortsword'],
		toolProficiencies: [],
		skillPickCount: 2,
		skillOptions: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
		subclassLevel: 3,
		subclassLabel: 'Monastic Tradition',
		spellcasting: null,
		features: [
			{ name: 'Unarmored Defense', level: 1, description: 'While wearing no armor and not wielding a shield, your AC equals 10 + DEX modifier + WIS modifier.', tags: ['unarmored-defense'] },
			{ name: 'Martial Arts', level: 1, description: 'Your practice of martial arts gives you mastery of combat styles that use unarmed strikes and monk weapons. Martial arts die: d4 at 1st (d6 at 5th, d8 at 11th, d10 at 17th). You can use DEX instead of STR for monk weapons and unarmed strikes. When you use the Attack action with an unarmed strike or monk weapon, you can make one unarmed strike as a bonus action.', tags: [] },
			{ name: 'Ki', level: 2, description: 'You have ki points equal to your monk level. You can spend ki to fuel ki features: Flurry of Blows (2 unarmed strikes as bonus action), Patient Defense (Dodge as bonus action), Step of the Wind (Disengage or Dash as bonus action, jump distance doubled). Regain all ki on short or long rest.', tags: ['short-rest-recovery', 'ki'] },
			{ name: 'Unarmored Movement', level: 2, description: 'Your speed increases by 10 feet while not wearing armor or wielding a shield. Bonus increases at higher levels (+15 at 6th, +20 at 10th, +25 at 14th, +30 at 18th).', tags: [] },
			{ name: 'Deflect Missiles', level: 3, description: 'You can use your reaction to deflect or catch a missile when hit by a ranged weapon attack. Reduce damage by 1d10 + DEX mod + monk level. If reduced to 0, you can catch the missile and throw it back (1 ki point, monk weapon attack).', tags: [] },
			{ name: 'Slow Fall', level: 4, description: 'You can use your reaction to reduce falling damage by an amount equal to five times your monk level.', tags: [] },
			{ name: 'Extra Attack', level: 5, description: 'You can attack twice when you take the Attack action.', tags: ['extra-attack'] },
			{ name: 'Stunning Strike', level: 5, description: 'When you hit a creature with a melee weapon attack, you can spend 1 ki point to attempt to stun the target. CON save or stunned until the end of your next turn.', tags: [] },
			{ name: 'Ki-Empowered Strikes', level: 6, description: 'Your unarmed strikes count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.', tags: [] },
			{ name: 'Evasion', level: 7, description: 'When you are subjected to a DEX save for half damage, you take no damage on a success and half damage on a failure.', tags: ['evasion'] },
			{ name: 'Stillness of Mind', level: 7, description: 'You can use your action to end one effect on yourself that is causing you to be charmed or frightened.', tags: [] },
			{ name: 'Purity of Body', level: 10, description: 'Your mastery of the ki flowing through you makes you immune to disease and poison.', tags: [] },
			{ name: 'Tongue of the Sun and Moon', level: 13, description: 'You learn to touch the ki of other minds so that you understand all spoken languages. Moreover, any creature that can understand a language can understand what you say.', tags: [] },
			{ name: 'Diamond Soul', level: 14, description: 'You gain proficiency in all saving throws. When you fail a saving throw, you can spend 1 ki point to reroll it and take the second result.', tags: [] },
			{ name: 'Timeless Body', level: 15, description: 'Your ki sustains you. You no longer need food or water. You suffer none of the frailty of old age and can\'t be aged magically.', tags: [] },
			{ name: 'Empty Body', level: 18, description: 'You can spend 4 ki points to become invisible for 1 minute. Also, you can spend 8 ki points to cast the astral projection spell (self only).', tags: [] },
			{ name: 'Perfect Self', level: 20, description: 'When you roll initiative and have no ki points remaining, you regain 4 ki points.', tags: [] },
			...asiFeatures(STANDARD_ASI_LEVELS)
		],
		subclass: {
			name: 'open-hand',
			displayName: 'Way of the Open Hand',
			description: 'Monks of the Way of the Open Hand are the ultimate masters of martial arts combat.',
			features: [
				{ name: 'Open Hand Technique', level: 3, description: 'When you hit a creature with Flurry of Blows, you can impose one of these effects: knocked prone (DEX save), pushed 15 feet (STR save), or can\'t take reactions until end of your next turn.', tags: [] },
				{ name: 'Wholeness of Body', level: 6, description: 'You can heal yourself. As an action, you regain hit points equal to three times your monk level. Once per long rest.', tags: ['long-rest-recovery'] },
				{ name: 'Tranquility', level: 11, description: 'At the end of a long rest, you gain the effect of a sanctuary spell that lasts until the start of your next long rest. The save DC = 8 + WIS modifier + proficiency bonus.', tags: [] },
				{ name: 'Quivering Palm', level: 17, description: 'When you hit a creature with an unarmed strike, you can spend 3 ki points to start imperceptible vibrations in its body, lasting for a number of days equal to your monk level. As an action, you can end the vibrations: the creature must make a CON save or be reduced to 0 hit points. On a success, it takes 10d10 necrotic damage.', tags: [] }
			]
		},
		equipmentChoices: [
			{ label: 'Weapon', options: [['Shortsword'], ['Simple Weapon']] },
			{ label: 'Pack', options: [['Dungeoneer\'s Pack'], ['Explorer\'s Pack']] }
		],
		startingEquipment: ['Dart (10)'],
		multiclassPrereqs: ['dex', 'wis'],
		multiclassGrants: { armor: [], weapons: ['simple'], tools: [], skills: 0 }
	}
];

// ---------------------------------------------------------------------------
// XP Thresholds for Leveling
// ---------------------------------------------------------------------------

/** XP required to reach each level (index 0 = level 1 = 0 XP). */
export const XP_THRESHOLDS: number[] = [
	0,      // 1
	300,    // 2
	900,    // 3
	2700,   // 4
	6500,   // 5
	14000,  // 6
	23000,  // 7
	34000,  // 8
	48000,  // 9
	64000,  // 10
	85000,  // 11
	100000, // 12
	120000, // 13
	140000, // 14
	165000, // 15
	195000, // 16
	225000, // 17
	265000, // 18
	305000, // 19
	355000  // 20
];

/** Proficiency bonus by level (index 0 = level 1). */
export const PROFICIENCY_BONUS: number[] = [
	2,2,2,2, 3,3,3,3, 4,4,4,4, 5,5,5,5, 6,6,6,6
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getClass(name: ClassName): ClassDefinition | undefined {
	return CLASSES.find((c) => c.name === name);
}

export function getSubclass(className: ClassName): SubclassDefinition | undefined {
	return getClass(className)?.subclass;
}

/**
 * Get all class features available at a given level (including subclass features).
 */
export function getFeaturesAtLevel(className: ClassName, level: number, includeSubclass = true): ClassFeature[] {
	const cls = getClass(className);
	if (!cls) return [];
	const features = cls.features.filter((f) => f.level <= level);
	if (includeSubclass && level >= cls.subclassLevel) {
		features.push(...cls.subclass.features.filter((f) => f.level <= level));
	}
	return features;
}

/**
 * Get spell slots for a class at a given level.
 * Returns an array of 9 numbers [1st, 2nd, ..., 9th] slot counts.
 */
export function getSpellSlots(className: ClassName, level: number): number[] {
	const cls = getClass(className);
	if (!cls?.spellcasting) return [0,0,0,0,0,0,0,0,0];
	return cls.spellcasting.slotsPerLevel[level - 1] ?? [0,0,0,0,0,0,0,0,0];
}

/**
 * Get the number of cantrips known for a class at a given level.
 */
export function getCantripsKnown(className: ClassName, level: number): number {
	const cls = getClass(className);
	if (!cls?.spellcasting) return 0;
	return cls.spellcasting.cantripsKnown[level - 1] ?? 0;
}

/**
 * Check if a level is an ASI level for a given class.
 */
export function isASILevel(className: ClassName, level: number): boolean {
	const cls = getClass(className);
	if (!cls) return false;
	return cls.features.some((f) => f.level === level && f.tags.includes('asi'));
}

// ---------------------------------------------------------------------------
// Multiclass Spell Slot Computation
// ---------------------------------------------------------------------------

/**
 * Compute multiclass spell slots from the effective caster level.
 *
 * Per 5e multiclass rules:
 *  - Full casters (wizard, cleric, druid, bard, sorcerer): contribute full level
 *  - Half casters (paladin, ranger): contribute floor(level / 2)
 *  - Third casters (EK fighter, AT rogue via subclass): contribute floor(level / 3)
 *  - Pact casters (warlock): do NOT contribute to multiclass slots
 *
 * Result is looked up in the full-caster spell slot table.
 * Returns an array of 9 slot counts [1st..9th] or empty for non-casters.
 */
export function getMulticlassSpellSlots(classes: ClassLevel[]): number[] {
	let effectiveLevel = 0;
	for (const entry of classes) {
		const cls = getClass(entry.name);
		if (!cls?.spellcasting) continue;
		switch (cls.spellcasting.style) {
			case 'full':
				effectiveLevel += entry.level;
				break;
			case 'half':
				effectiveLevel += Math.floor(entry.level / 2);
				break;
			case 'third':
				effectiveLevel += Math.floor(entry.level / 3);
				break;
			// 'pact' and 'none' do not contribute
		}
	}
	if (effectiveLevel <= 0) return [];
	effectiveLevel = Math.min(effectiveLevel, 20);
	return [...(FULL_CASTER_SLOTS[effectiveLevel - 1] ?? [])];
}

/**
 * Get Warlock pact magic slots for a given warlock level.
 *
 * Returns { count, slotLevel } or null if the character has no warlock levels.
 * All pact slots are the same spell level, refreshing on short rest.
 */
export function getPactSlotInfo(warlockLevel: number): { count: number; slotLevel: number } | null {
	if (warlockLevel <= 0 || warlockLevel > 20) return null;
	const row = PACT_SLOTS[warlockLevel - 1];
	if (!row) return null;
	// Find the highest index with a non-zero value — that's the slot level
	let slotLevel = 0;
	let count = 0;
	for (let i = 0; i < row.length; i++) {
		if (row[i] > 0) {
			slotLevel = i + 1;
			count = row[i];
		}
	}
	if (count === 0) return null;
	return { count, slotLevel };
}
