/**
 * 5e SRD Race Definitions
 *
 * Every playable race + subrace from the 5e SRD with full mechanical data.
 * Ability bonuses, speed, size, darkvision, traits, proficiencies, languages.
 *
 * Sources: 5e SRD (CC-BY-4.0)
 */

import type { AbilityName, SkillName, RaceName } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Size = 'Small' | 'Medium';
export type CreatureType = 'humanoid';
export type DamageType =
	| 'acid' | 'cold' | 'fire' | 'lightning' | 'poison'
	| 'thunder' | 'necrotic' | 'radiant' | 'force'
	| 'bludgeoning' | 'piercing' | 'slashing' | 'psychic';

export type WeaponProficiency =
	// Simple melee
	| 'club' | 'dagger' | 'greatclub' | 'handaxe' | 'javelin'
	| 'light-hammer' | 'mace' | 'quarterstaff' | 'sickle' | 'spear'
	// Simple ranged
	| 'dart' | 'light-crossbow' | 'shortbow' | 'sling'
	// Martial melee
	| 'battleaxe' | 'flail' | 'glaive' | 'greataxe' | 'greatsword'
	| 'halberd' | 'lance' | 'longsword' | 'maul' | 'morningstar'
	| 'pike' | 'rapier' | 'scimitar' | 'shortsword' | 'trident'
	| 'war-pick' | 'warhammer' | 'whip'
	// Martial ranged
	| 'blowgun' | 'hand-crossbow' | 'heavy-crossbow' | 'longbow' | 'net'
	// Special
	| 'unarmed';

export type ArmorProficiency = 'light' | 'medium' | 'heavy' | 'shields';

export type ToolProficiency =
	| 'smiths-tools' | 'brewers-supplies' | 'masons-tools'
	| 'artisans-tools' | 'thieves-tools' | 'tinkers-tools';

export type Language =
	| 'Common' | 'Dwarvish' | 'Elvish' | 'Giant' | 'Gnomish'
	| 'Goblin' | 'Halfling' | 'Orc' | 'Abyssal' | 'Celestial'
	| 'Draconic' | 'Deep Speech' | 'Infernal' | 'Primordial'
	| 'Sylvan' | 'Undercommon';

/** A mechanical effect tag for a racial trait. */
export type TraitEffect =
	| { tag: 'advantage-on-saves'; against: string }
	| { tag: 'resistance'; damageType: DamageType }
	| { tag: 'darkvision'; range: number }
	| { tag: 'skill-proficiency'; skill: SkillName }
	| { tag: 'cantrip'; cantrip: string; ability: AbilityName }
	| { tag: 'extra-language'; count: number }
	| { tag: 'speed-bonus'; bonus: number }
	| { tag: 'hp-bonus-per-level'; bonus: number }
	| { tag: 'armor-ac-bonus'; bonus: number }
	| { tag: 'breath-weapon'; damageType: DamageType; shape: 'line' | 'cone'; size: string }
	| { tag: 'relentless-endurance' }
	| { tag: 'savage-attacks' }
	| { tag: 'lucky' }
	| { tag: 'brave' }
	| { tag: 'nimble' }
	| { tag: 'naturally-stealthy' }
	| { tag: 'stout-resilience' }
	| { tag: 'mask-of-the-wild' }
	| { tag: 'trance' }
	| { tag: 'stonecunning' }
	| { tag: 'gnome-cunning' }
	| { tag: 'artificers-lore' }
	| { tag: 'tinker' }
	| { tag: 'speak-with-small-beasts' }
	| { tag: 'hellish-rebuke'; level: number }
	| { tag: 'infernal-legacy-darkness' }
	| { tag: 'feat'; count: number }
	| { tag: 'ability-choice'; count: number; exclude?: AbilityName[] }
	| { tag: 'menacing' }
	| { tag: 'fey-ancestry' }
	| { tag: 'extra-cantrip'; cantrip: string; ability: AbilityName }
	| { tag: 'custom'; description: string };

export interface RacialTrait {
	name: string;
	description: string;
	effects: TraitEffect[];
}

export interface SubraceDefinition {
	name: string;
	displayName: string;
	abilityBonuses: Partial<Record<AbilityName, number>>;
	traits: RacialTrait[];
	/** Extra proficiencies granted by the subrace. */
	weaponProficiencies?: WeaponProficiency[];
	armorProficiencies?: ArmorProficiency[];
	toolProficiencies?: ToolProficiency[];
	extraLanguages?: Language[];
}

export interface RaceDefinition {
	name: RaceName;
	displayName: string;
	description: string;
	shortDescription: string;
	/** Base ability score increases (applied BEFORE subrace bonuses). */
	abilityBonuses: Partial<Record<AbilityName, number>>;
	speed: number;
	size: Size;
	darkvision: number; // 0 = none
	creatureType: CreatureType;
	languages: Language[];
	traits: RacialTrait[];
	/** Subraces. If empty array, the race has no subrace choice. */
	subraces: SubraceDefinition[];
	weaponProficiencies?: WeaponProficiency[];
	armorProficiencies?: ArmorProficiency[];
	toolProficiencies?: ToolProficiency[];
	/** If true, the player picks a tool proficiency from a list. */
	toolChoice?: ToolProficiency[];
}

// ---------------------------------------------------------------------------
// Race Data
// ---------------------------------------------------------------------------

export const RACES: RaceDefinition[] = [
	// ── Human ───────────────────────────────────────────────
	{
		name: 'human',
		displayName: 'Human',
		description: 'Humans range from five to six and a half feet, with skin spanning deep ebony, warm brown, olive, tawny, and pale rose, and hair in every shade from silver-white to jet black. They fill towering kingdoms, merchant republics, frontier settlements, and wandering tribes, and occupy nearly every role from scholar and priest to warlord, artisan, and merchant.',
		shortDescription: 'The most widespread race — ambitious, resilient, and relentless.',
		abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
		speed: 30,
		size: 'Medium',
		darkvision: 0,
		creatureType: 'humanoid',
		languages: ['Common'],
		traits: [
			{
				name: 'Extra Language',
				description: 'You can speak, read, and write one extra language of your choice.',
				effects: [{ tag: 'extra-language', count: 1 }]
			}
		],
		subraces: [
			{
				name: 'variant-human',
				displayName: 'Variant Human',
				abilityBonuses: {}, // +1 to two abilities of choice (override base +1 all)
				traits: [
					{
						name: 'Ability Score Increase',
						description: 'Two different ability scores of your choice increase by 1 (replaces the standard +1 to all).',
						effects: [{ tag: 'ability-choice', count: 2 }]
					},
					{
						name: 'Skills',
						description: 'You gain proficiency in one skill of your choice.',
						effects: [{ tag: 'skill-proficiency', skill: 'perception' }] // placeholder — UI lets user pick
					},
					{
						name: 'Feat',
						description: 'You gain one feat of your choice.',
						effects: [{ tag: 'feat', count: 1 }]
					}
				]
			}
		]
	},

	// ── Elf ─────────────────────────────────────────────────
	{
		name: 'elf',
		displayName: 'Elf',
		description: 'Elves stand five to nearly six feet with slender frames, sharply pointed ears, and ageless faces of uncanny perfection. Skin runs from deep bronze and copper through olive to moonlit pale; hair shades toward silver, ivory, honey-gold, auburn, or frost-blue. They inhabit ancient forest citadels, arcane towers, and noble courts, living centuries as rangers, scholars, artisans, and quiet-spoken guardians.',
		shortDescription: 'Graceful and ancient, touched by magic and otherworldly beauty.',
		abilityBonuses: { dex: 2 },
		speed: 30,
		size: 'Medium',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Elvish'],
		traits: [
			{
				name: 'Keen Senses',
				description: 'You have proficiency in the Perception skill.',
				effects: [{ tag: 'skill-proficiency', skill: 'perception' }]
			},
			{
				name: 'Fey Ancestry',
				description: 'You have advantage on saving throws against being charmed, and magic can\'t put you to sleep.',
				effects: [{ tag: 'fey-ancestry' }, { tag: 'advantage-on-saves', against: 'charmed' }]
			},
			{
				name: 'Trance',
				description: 'Elves don\'t need to sleep. Instead, they meditate deeply for 4 hours a day.',
				effects: [{ tag: 'trance' }]
			}
		],
		weaponProficiencies: [],
		subraces: [
			{
				name: 'high-elf',
				displayName: 'High Elf',
				abilityBonuses: { int: 1 },
				traits: [
					{
						name: 'Elf Weapon Training',
						description: 'You have proficiency with the longsword, shortsword, shortbow, and longbow.',
						effects: []
					},
					{
						name: 'Cantrip',
						description: 'You know one cantrip of your choice from the wizard spell list.',
						effects: [{ tag: 'extra-cantrip', cantrip: 'any-wizard', ability: 'int' }]
					},
					{
						name: 'Extra Language',
						description: 'You can speak, read, and write one extra language of your choice.',
						effects: [{ tag: 'extra-language', count: 1 }]
					}
				],
				weaponProficiencies: ['longsword', 'shortsword', 'shortbow', 'longbow']
			},
			{
				name: 'wood-elf',
				displayName: 'Wood Elf',
				abilityBonuses: { wis: 1 },
				traits: [
					{
						name: 'Elf Weapon Training',
						description: 'You have proficiency with the longsword, shortsword, shortbow, and longbow.',
						effects: []
					},
					{
						name: 'Fleet of Foot',
						description: 'Your base walking speed increases to 35 feet.',
						effects: [{ tag: 'speed-bonus', bonus: 5 }]
					},
					{
						name: 'Mask of the Wild',
						description: 'You can attempt to hide even when you are only lightly obscured by foliage, heavy rain, falling snow, mist, and other natural phenomena.',
						effects: [{ tag: 'mask-of-the-wild' }]
					}
				],
				weaponProficiencies: ['longsword', 'shortsword', 'shortbow', 'longbow']
			},
			{
				name: 'dark-elf',
				displayName: 'Dark Elf (Drow)',
				abilityBonuses: { cha: 1 },
				traits: [
					{
						name: 'Superior Darkvision',
						description: 'Your darkvision has a radius of 120 feet.',
						effects: [{ tag: 'darkvision', range: 120 }]
					},
					{
						name: 'Sunlight Sensitivity',
						description: 'You have disadvantage on attack rolls and Perception checks that rely on sight when you, the target, or whatever you are trying to perceive is in direct sunlight.',
						effects: [{ tag: 'custom', description: 'Disadvantage on attacks and Perception in sunlight' }]
					},
					{
						name: 'Drow Magic',
						description: 'You know the dancing lights cantrip. At 3rd level you can cast faerie fire once per long rest. At 5th level you can cast darkness once per long rest.',
						effects: [
							{ tag: 'cantrip', cantrip: 'dancing-lights', ability: 'cha' },
							{ tag: 'hellish-rebuke', level: 3 }, // reusing tag for "spell at level"
							{ tag: 'infernal-legacy-darkness' }
						]
					},
					{
						name: 'Drow Weapon Training',
						description: 'You have proficiency with rapiers, shortswords, and hand crossbows.',
						effects: []
					}
				],
				weaponProficiencies: ['rapier', 'shortsword', 'hand-crossbow']
			}
		]
	},

	// ── Half-Elf ────────────────────────────────────────────
	{
		name: 'half-elf',
		displayName: 'Half-Elf',
		description: 'Half-elves stand five and a half to six feet, blending sharper elven features with softer human faces, and almost always have striking eyes of grey, green, or violet. Skin spans the full human range; hair tends to earthy browns with occasional elven silver or pale gold. Natural diplomats, bards, scouts, and intelligence brokers, they belong fully to neither world.',
		shortDescription: 'Charismatic and versatile, bridging the elven and human worlds.',
		abilityBonuses: { cha: 2 },
		speed: 30,
		size: 'Medium',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Elvish'],
		traits: [
			{
				name: 'Ability Score Increase',
				description: 'Two other ability scores of your choice each increase by 1 (in addition to CHA +2).',
				effects: [{ tag: 'ability-choice', count: 2, exclude: ['cha'] }]
			},
			{
				name: 'Fey Ancestry',
				description: 'You have advantage on saving throws against being charmed, and magic can\'t put you to sleep.',
				effects: [{ tag: 'fey-ancestry' }, { tag: 'advantage-on-saves', against: 'charmed' }]
			},
			{
				name: 'Skill Versatility',
				description: 'You gain proficiency in two skills of your choice.',
				effects: [
					{ tag: 'skill-proficiency', skill: 'perception' }, // placeholder — UI picks
					{ tag: 'skill-proficiency', skill: 'persuasion' }  // placeholder — UI picks
				]
			},
			{
				name: 'Extra Language',
				description: 'You can speak, read, and write one extra language of your choice.',
				effects: [{ tag: 'extra-language', count: 1 }]
			}
		],
		subraces: []
	},

	// ── Half-Orc ────────────────────────────────────────────
	{
		name: 'half-orc',
		displayName: 'Half-Orc',
		description: 'Half-orcs stand six to seven feet with broad, heavily muscled frames that command immediate attention. Skin runs grey-green to slate-blue and ashen brown; coarse hair — typically dark or raven-black — frames heavy brows and prominent lower tusks. They drift toward frontier outposts, warbands, city guard posts, and mercenary companies, earning respect through sheer relentless presence.',
		shortDescription: 'Fierce and powerful, combining orcish strength with human drive.',
		abilityBonuses: { str: 2, con: 1 },
		speed: 30,
		size: 'Medium',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Orc'],
		traits: [
			{
				name: 'Menacing',
				description: 'You gain proficiency in the Intimidation skill.',
				effects: [{ tag: 'menacing' }, { tag: 'skill-proficiency', skill: 'intimidation' }]
			},
			{
				name: 'Relentless Endurance',
				description: 'When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. You can\'t use this feature again until you finish a long rest.',
				effects: [{ tag: 'relentless-endurance' }]
			},
			{
				name: 'Savage Attacks',
				description: 'When you score a critical hit with a melee weapon attack, you can roll one of the weapon\'s damage dice one additional time and add it to the extra damage of the critical hit.',
				effects: [{ tag: 'savage-attacks' }]
			}
		],
		subraces: []
	},

	// ── Dragonborn ──────────────────────────────────────────
	{
		name: 'dragonborn',
		displayName: 'Dragonborn',
		description: 'Dragonborn stand six to six and a half feet, powerfully built and covered in fine scales whose colour mirrors their bloodline — ember-red, bone-white, deep cobalt, burnished gold, or verdigris green. Eyes tend to amber, violet, or silver. Honour-bound clans operate as knightly orders, mercenary companies, and fortress-holds, placing ancestral legacy and martial excellence above wealth or comfort.',
		shortDescription: 'Proud dragon-kin with elemental breath and unshakeable clan honor.',
		abilityBonuses: { str: 2, cha: 1 },
		speed: 30,
		size: 'Medium',
		darkvision: 0,
		creatureType: 'humanoid',
		languages: ['Common', 'Draconic'],
		traits: [
			{
				name: 'Breath Weapon',
				description: 'You can use your action to exhale destructive energy. Your draconic ancestry determines the size, shape, and damage type of the exhalation. DC = 8 + CON mod + proficiency bonus, 2d6 damage (scales at 6th, 11th, 16th level).',
				effects: [{ tag: 'breath-weapon', damageType: 'fire', shape: 'cone', size: '15 ft' }]
			},
			{
				name: 'Damage Resistance',
				description: 'You have resistance to the damage type associated with your draconic ancestry.',
				effects: [{ tag: 'resistance', damageType: 'fire' }] // default — actual type chosen at creation
			}
		],
		subraces: [
			// Draconic ancestry — ordered for 2-column Chromatic/Metallic grid (paired by damage type)
			// Grid order: Fire (top) → Lightning → Cold → Acid → Poison (bottom)
			// Chromatic spectrum: Red → Orange → Blue → White → Black → Green
			// Metallic value:     Gold → Brass → Bronze → Silver → Copper → Lead
			{ name: 'red',    displayName: 'Red (Fire)',         abilityBonuses: {}, traits: [{ name: 'Fire Breath',      description: '15 ft. cone, fire damage.',           effects: [{ tag: 'breath-weapon', damageType: 'fire',      shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'fire'      }] }] },
			{ name: 'gold',   displayName: 'Gold (Fire)',        abilityBonuses: {}, traits: [{ name: 'Fire Breath',      description: '15 ft. cone, fire damage.',           effects: [{ tag: 'breath-weapon', damageType: 'fire',      shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'fire'      }] }] },
			{ name: 'orange', displayName: 'Orange (Fire)',      abilityBonuses: {}, traits: [{ name: 'Fire Breath',      description: '5 by 30 ft. line, fire damage.',      effects: [{ tag: 'breath-weapon', damageType: 'fire',      shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'fire'      }] }] },
			{ name: 'brass',  displayName: 'Brass (Fire)',       abilityBonuses: {}, traits: [{ name: 'Fire Breath',      description: '5 by 30 ft. line, fire damage.',      effects: [{ tag: 'breath-weapon', damageType: 'fire',      shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'fire'      }] }] },
			{ name: 'blue',   displayName: 'Blue (Lightning)',   abilityBonuses: {}, traits: [{ name: 'Lightning Breath', description: '5 by 30 ft. line, lightning damage.', effects: [{ tag: 'breath-weapon', damageType: 'lightning', shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'lightning' }] }] },
			{ name: 'bronze', displayName: 'Bronze (Lightning)', abilityBonuses: {}, traits: [{ name: 'Lightning Breath', description: '5 by 30 ft. line, lightning damage.', effects: [{ tag: 'breath-weapon', damageType: 'lightning', shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'lightning' }] }] },
			{ name: 'white',  displayName: 'White (Cold)',       abilityBonuses: {}, traits: [{ name: 'Cold Breath',      description: '15 ft. cone, cold damage.',           effects: [{ tag: 'breath-weapon', damageType: 'cold',      shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'cold'      }] }] },
			{ name: 'silver', displayName: 'Silver (Cold)',      abilityBonuses: {}, traits: [{ name: 'Cold Breath',      description: '15 ft. cone, cold damage.',           effects: [{ tag: 'breath-weapon', damageType: 'cold',      shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'cold'      }] }] },
			{ name: 'black',  displayName: 'Black (Acid)',       abilityBonuses: {}, traits: [{ name: 'Acid Breath',      description: '5 by 30 ft. line, acid damage.',      effects: [{ tag: 'breath-weapon', damageType: 'acid',      shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'acid'      }] }] },
			{ name: 'copper', displayName: 'Copper (Acid)',      abilityBonuses: {}, traits: [{ name: 'Acid Breath',      description: '5 by 30 ft. line, acid damage.',      effects: [{ tag: 'breath-weapon', damageType: 'acid',      shape: 'line', size: '5x30 ft' }, { tag: 'resistance', damageType: 'acid'      }] }] },
			{ name: 'green',  displayName: 'Green (Poison)',     abilityBonuses: {}, traits: [{ name: 'Poison Breath',    description: '15 ft. cone, poison damage.',         effects: [{ tag: 'breath-weapon', damageType: 'poison',    shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'poison'    }] }] },
			{ name: 'lead',   displayName: 'Lead (Poison)',      abilityBonuses: {}, traits: [{ name: 'Poison Breath',    description: '15 ft. cone, poison damage.',         effects: [{ tag: 'breath-weapon', damageType: 'poison',    shape: 'cone', size: '15 ft'   }, { tag: 'resistance', damageType: 'poison'    }] }] }
		]
	},

	// ── Tiefling ────────────────────────────────────────────
	{
		name: 'tiefling',
		displayName: 'Tiefling',
		description: 'Tieflings stand five to six feet with lithe builds set apart by curving horns, slender tails, and eyes that glow amber, silver, red, or white — no pupils, no whites. Skin runs dusky lavender, deep crimson, charcoal grey, or pale ash; hair tends to jet black, dark crimson, or midnight purple. Many become lone wanderers — mages, rogues, and brokers surviving by wit alone.',
		shortDescription: 'Infernal-touched and striking, marked by heritage and iron will.',
		abilityBonuses: { cha: 2, int: 1 },
		speed: 30,
		size: 'Medium',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Infernal'],
		traits: [
			{
				name: 'Hellish Resistance',
				description: 'You have resistance to fire damage.',
				effects: [{ tag: 'resistance', damageType: 'fire' }]
			},
			{
				name: 'Infernal Legacy',
				description: 'You know the thaumaturgy cantrip. At 3rd level you can cast hellish rebuke as a 2nd-level spell once per long rest. At 5th level you can cast darkness once per long rest. Charisma is your spellcasting ability for these spells.',
				effects: [
					{ tag: 'cantrip', cantrip: 'thaumaturgy', ability: 'cha' },
					{ tag: 'hellish-rebuke', level: 3 },
					{ tag: 'infernal-legacy-darkness' }
				]
			}
		],
		subraces: []
	},

	// ── Dwarf ───────────────────────────────────────────────
	{
		name: 'dwarf',
		displayName: 'Dwarf',
		description: 'Dwarves stand four to five feet but weigh as much as a tall human, built dense with muscle and thick bone. Skin runs ruddy tan to deep clay brown; hair and beards span charcoal, reddish-brown, and bright ginger, worn in heavy braids adorned with clan-marks. Mountain holds, deep mine-cities, and fortress-smithies are home — places that produce the finest weaponcraft and stonework in any world.',
		shortDescription: 'Hardy mountain folk prized as warriors, miners, and craftsmen.',
		abilityBonuses: { con: 2 },
		speed: 25,
		size: 'Medium',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Dwarvish'],
		traits: [
			{
				name: 'Dwarven Resilience',
				description: 'You have advantage on saving throws against poison, and you have resistance against poison damage.',
				effects: [
					{ tag: 'advantage-on-saves', against: 'poison' },
					{ tag: 'resistance', damageType: 'poison' }
				]
			},
			{
				name: 'Stonecunning',
				description: 'Whenever you make an Intelligence (History) check related to the origin of stonework, you are considered proficient in the History skill and add double your proficiency bonus.',
				effects: [{ tag: 'stonecunning' }]
			}
		],
		weaponProficiencies: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'],
		toolChoice: ['smiths-tools', 'brewers-supplies', 'masons-tools'],
		subraces: [
			{
				name: 'hill-dwarf',
				displayName: 'Hill Dwarf',
				abilityBonuses: { wis: 1 },
				traits: [
					{
						name: 'Dwarven Toughness',
						description: 'Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.',
						effects: [{ tag: 'hp-bonus-per-level', bonus: 1 }]
					}
				]
			},
			{
				name: 'mountain-dwarf',
				displayName: 'Mountain Dwarf',
				abilityBonuses: { str: 2 },
				traits: [
					{
						name: 'Dwarven Armor Training',
						description: 'You have proficiency with light and medium armor.',
						effects: []
					}
				],
				armorProficiencies: ['light', 'medium']
			}
		]
	},

	// ── Halfling ────────────────────────────────────────────
	{
		name: 'halfling',
		displayName: 'Halfling',
		description: 'Halflings stand two and a half to three and a half feet with round, cheerful faces and large bare feet that rarely make a sound. Skin runs tawny to light brown; hair tends to curly chestnut, auburn, or sandy blonde. They build snug farmsteads, river-town markets, and woodland burrow-homes, living as farmers, cooks, river-traders, and surprisingly light-fingered opportunists.',
		shortDescription: 'Small, nimble, and quietly brave — at home anywhere.',
		abilityBonuses: { dex: 2 },
		speed: 25,
		size: 'Small',
		darkvision: 0,
		creatureType: 'humanoid',
		languages: ['Common', 'Halfling'],
		traits: [
			{
				name: 'Lucky',
				description: 'When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.',
				effects: [{ tag: 'lucky' }]
			},
			{
				name: 'Brave',
				description: 'You have advantage on saving throws against being frightened.',
				effects: [{ tag: 'brave' }, { tag: 'advantage-on-saves', against: 'frightened' }]
			},
			{
				name: 'Halfling Nimbleness',
				description: 'You can move through the space of any creature that is of a size larger than yours.',
				effects: [{ tag: 'nimble' }]
			}
		],
		subraces: [
			{
				name: 'lightfoot',
				displayName: 'Lightfoot Halfling',
				abilityBonuses: { cha: 1 },
				traits: [
					{
						name: 'Naturally Stealthy',
						description: 'You can attempt to hide even when you are obscured only by a creature that is at least one size larger than you.',
						effects: [{ tag: 'naturally-stealthy' }]
					}
				]
			},
			{
				name: 'stout',
				displayName: 'Stout Halfling',
				abilityBonuses: { con: 1 },
				traits: [
					{
						name: 'Stout Resilience',
						description: 'You have advantage on saving throws against poison, and you have resistance against poison damage.',
						effects: [
							{ tag: 'stout-resilience' },
							{ tag: 'advantage-on-saves', against: 'poison' },
							{ tag: 'resistance', damageType: 'poison' }
						]
					}
				]
			}
		]
	},

	// ── Gnome ───────────────────────────────────────────────
	{
		name: 'gnome',
		displayName: 'Gnome',
		description: 'Gnomes stand three to three and a half feet with oversized expressive eyes and faces that are rarely still. Skin runs pale cream to warm tan and slate-brown; hair grows in wild tufts of white, sandy-orange, or blue-grey. Forest gnomes hollow cozy burrow-dens in old woodland; rock gnomes build cluttered workshop-warrens of gears and fumes. Most become tinkers, illusionists, alchemists, or compulsively cheerful sages.',
		shortDescription: 'Curious and inventive, brimming with energy and endless cleverness.',
		abilityBonuses: { int: 2 },
		speed: 25,
		size: 'Small',
		darkvision: 60,
		creatureType: 'humanoid',
		languages: ['Common', 'Gnomish'],
		traits: [
			{
				name: 'Gnome Cunning',
				description: 'You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.',
				effects: [{ tag: 'gnome-cunning' }]
			}
		],
		subraces: [
			{
				name: 'rock-gnome',
				displayName: 'Rock Gnome',
				abilityBonuses: { con: 1 },
				traits: [
					{
						name: 'Artificer\'s Lore',
						description: 'Whenever you make an Intelligence (History) check related to magic items, alchemical objects, or technological devices, you can add twice your proficiency bonus.',
						effects: [{ tag: 'artificers-lore' }]
					},
					{
						name: 'Tinker',
						description: 'You have proficiency with artisan\'s tools (tinker\'s tools). Using those tools, you can spend 1 hour and 10 gp worth of materials to construct a Tiny clockwork device.',
						effects: [{ tag: 'tinker' }]
					}
				],
				toolProficiencies: ['tinkers-tools']
			},
			{
				name: 'forest-gnome',
				displayName: 'Forest Gnome',
				abilityBonuses: { dex: 1 },
				traits: [
					{
						name: 'Natural Illusionist',
						description: 'You know the minor illusion cantrip. Intelligence is your spellcasting ability for it.',
						effects: [{ tag: 'cantrip', cantrip: 'minor-illusion', ability: 'int' }]
					},
					{
						name: 'Speak with Small Beasts',
						description: 'Through sounds and gestures, you can communicate simple ideas with Small or smaller beasts.',
						effects: [{ tag: 'speak-with-small-beasts' }]
					}
				]
			}
		]
	}
];

// ---------------------------------------------------------------------------
// Standard Array
// ---------------------------------------------------------------------------

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

// ---------------------------------------------------------------------------
// Point Buy costs
// ---------------------------------------------------------------------------

export const POINT_BUY_COSTS: Record<number, number> = {
	8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9
};
export const POINT_BUY_BUDGET = 27;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getRace(name: RaceName): RaceDefinition | undefined {
	return RACES.find((r) => r.name === name);
}

export function getSubrace(raceName: RaceName, subraceName: string): SubraceDefinition | undefined {
	return getRace(raceName)?.subraces.find((s) => s.name === subraceName);
}

/**
 * Compute merged ability bonuses for a race + subrace combination.
 * For Variant Human: base bonuses are zeroed, subrace handles the +1/+1 choice.
 */
export function computeRacialBonuses(
	raceName: RaceName,
	subraceName?: string
): Partial<Record<AbilityName, number>> {
	const race = getRace(raceName);
	if (!race) return {};

	// Variant Human replaces the standard +1 all
	const isVariant = subraceName === 'variant-human';
	const base = isVariant ? {} : { ...race.abilityBonuses };

	if (subraceName) {
		const sub = getSubrace(raceName, subraceName);
		if (sub) {
			for (const [k, v] of Object.entries(sub.abilityBonuses)) {
				const key = k as AbilityName;
				base[key] = (base[key] ?? 0) + v;
			}
		}
	}

	return base;
}

/**
 * Collect all racial trait effects (base race + subrace) for quick lookups.
 */
export function collectRacialTraits(raceName: RaceName, subraceName?: string): RacialTrait[] {
	const race = getRace(raceName);
	if (!race) return [];
	let traits = [...race.traits];
	if (subraceName) {
		const sub = getSubrace(raceName, subraceName);
		if (sub) {
			// Dragonborn: the base race has a placeholder "Damage Resistance" → fire trait.
			// Each subrace provides the real resistance for that ancestry, so strip the
			// placeholder before appending subrace traits to avoid double resistances.
			if (raceName === 'dragonborn' && sub.traits.some(t => t.effects.some(e => e.tag === 'resistance'))) {
				traits = traits.filter(t => t.name !== 'Damage Resistance');
			}
			traits.push(...sub.traits);
		}
	}
	return traits;
}
