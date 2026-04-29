/**
 * Project Zeus — Game Domain Types
 *
 * This is the single source of truth for all game-layer data structures.
 * Everything the GM, the mechanics engine, the state manager, and the UI
 * need to agree on lives here.
 *
 * Design rules:
 *   - Pure TypeScript, no framework imports.
 *   - No database or IO references — this is a vocabulary, not a service.
 *   - Prefer narrow union literals over open strings.
 *   - Keep optional fields explicit so serialisation round-trips cleanly.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** All game-layer IDs are opaque strings (ULIDs in practice). */
export type GameId = string;

// ---------------------------------------------------------------------------
// Ability Scores & Skills (5e-compatible)
// ---------------------------------------------------------------------------

export type AbilityName = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface AbilityScores {
	str: number;
	dex: number;
	con: number;
	int: number;
	wis: number;
	cha: number;
}

/**
 * 5e skills mapped to their governing ability.
 * The key is the skill id used throughout the game layer.
 */
export type SkillName =
	| 'acrobatics'
	| 'animal-handling'
	| 'arcana'
	| 'athletics'
	| 'deception'
	| 'history'
	| 'insight'
	| 'intimidation'
	| 'investigation'
	| 'medicine'
	| 'nature'
	| 'perception'
	| 'performance'
	| 'persuasion'
	| 'religion'
	| 'sleight-of-hand'
	| 'stealth'
	| 'survival';

export const SKILL_ABILITY_MAP: Record<SkillName, AbilityName> = {
	'acrobatics': 'dex',
	'animal-handling': 'wis',
	'arcana': 'int',
	'athletics': 'str',
	'deception': 'cha',
	'history': 'int',
	'insight': 'wis',
	'intimidation': 'cha',
	'investigation': 'int',
	'medicine': 'wis',
	'nature': 'int',
	'perception': 'wis',
	'performance': 'cha',
	'persuasion': 'cha',
	'religion': 'int',
	'sleight-of-hand': 'dex',
	'stealth': 'dex',
	'survival': 'wis'
};

// ---------------------------------------------------------------------------
// Race & Class
// ---------------------------------------------------------------------------

export type RaceName =
	| 'human'
	| 'elf'
	| 'dwarf'
	| 'halfling'
	| 'half-orc'
	| 'gnome'
	| 'tiefling'
	| 'dragonborn'
	| 'half-elf';

export type ClassName =
	| 'fighter'
	| 'wizard'
	| 'rogue'
	| 'cleric'
	| 'ranger'
	| 'barbarian'
	| 'bard'
	| 'paladin'
	| 'sorcerer'
	| 'warlock'
	| 'druid'
	| 'monk';

/** Hit die size per class. */
export const CLASS_HIT_DIE: Record<ClassName, number> = {
	fighter: 10,
	wizard: 6,
	rogue: 8,
	cleric: 8,
	ranger: 10,
	barbarian: 12,
	bard: 8,
	paladin: 10,
	sorcerer: 6,
	warlock: 8,
	druid: 8,
	monk: 8
};

/** Skill proficiencies granted by class at creation (pick N from the list). */
export const CLASS_SKILL_OPTIONS: Record<ClassName, { pick: number; from: SkillName[] }> = {
	fighter: { pick: 2, from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
	wizard: { pick: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
	rogue: { pick: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'] },
	cleric: { pick: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
	ranger: { pick: 3, from: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
	barbarian: { pick: 2, from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
	bard: { pick: 3, from: ['acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival'] },
	paladin: { pick: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] },
	sorcerer: { pick: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] },
	warlock: { pick: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
	druid: { pick: 2, from: ['arcana', 'animal-handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] },
	monk: { pick: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] }
};

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type CharacterSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';

export type Alignment =
	| 'lawful-good'
	| 'neutral-good'
	| 'chaotic-good'
	| 'lawful-neutral'
	| 'true-neutral'
	| 'chaotic-neutral'
	| 'lawful-evil'
	| 'neutral-evil'
	| 'chaotic-evil';

export type Condition =
	| 'blinded'
	| 'charmed'
	| 'deafened'
	| 'frightened'
	| 'grappled'
	| 'incapacitated'
	| 'invisible'
	| 'paralyzed'
	| 'petrified'
	| 'poisoned'
	| 'prone'
	| 'restrained'
	| 'stunned'
	| 'unconscious'
	| 'exhaustion'
	| 'raging';

export interface ConditionEffect {
	advantageOn: string[];
	disadvantageOn: string[];
	cantDo: string[];
	autoFailSaves: AbilityName[];
	speedMultiplier: number;
	notes: string[];
}

export type ConditionEffectMap = Record<Condition, ConditionEffect>;

export const DEFAULT_CONDITION_EFFECTS: ConditionEffectMap = {
	blinded: {
		advantageOn: [],
		disadvantageOn: ['attack-rolls', 'sight-based-ability-checks'],
		cantDo: ['see'],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: ['Attack rolls against the creature have advantage.']
	},
	charmed: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['attack-charmer', 'target-charmer-with-harmful-abilities'],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: ['The charmer has advantage on social checks against the creature.']
	},
	deafened: {
		advantageOn: [],
		disadvantageOn: ['hearing-based-ability-checks'],
		cantDo: ['hear'],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: []
	},
	frightened: {
		advantageOn: [],
		disadvantageOn: ['ability-checks-while-source-visible', 'attack-rolls-while-source-visible'],
		cantDo: ['willingly-move-closer-to-source'],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: []
	},
	grappled: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 0,
		notes: ['Speed becomes 0 and the creature cannot benefit from bonuses to speed.']
	},
	incapacitated: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['take-actions', 'take-reactions'],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: []
	},
	invisible: {
		advantageOn: ['attack-rolls'],
		disadvantageOn: [],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: ['Attack rolls against the creature have disadvantage.', 'The creature is heavily obscured for hiding purposes.']
	},
	paralyzed: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['move', 'speak'],
		autoFailSaves: ['str', 'dex'],
		speedMultiplier: 0,
		notes: ['The creature is incapacitated.', 'Attack rolls against the creature have advantage.', 'Hits from within 5 feet are critical hits.']
	},
	petrified: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['move', 'speak'],
		autoFailSaves: ['str', 'dex'],
		speedMultiplier: 0,
		notes: ['The creature is incapacitated.', 'It has resistance to all damage.', 'It is immune to poison and disease.']
	},
	poisoned: {
		advantageOn: [],
		disadvantageOn: ['attack-rolls', 'ability-checks'],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: []
	},
	prone: {
		advantageOn: [],
		disadvantageOn: ['attack-rolls'],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: ['Movement to stand costs extra.', 'Melee attacks against the creature have advantage.', 'Ranged attacks against it have disadvantage.']
	},
	restrained: {
		advantageOn: [],
		disadvantageOn: ['attack-rolls'],
		cantDo: [],
		autoFailSaves: ['dex'],
		speedMultiplier: 0,
		notes: ['Attack rolls against the creature have advantage.']
	},
	stunned: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['move', 'speak'],
		autoFailSaves: ['str', 'dex'],
		speedMultiplier: 0,
		notes: ['The creature is incapacitated.', 'Attack rolls against the creature have advantage.']
	},
	unconscious: {
		advantageOn: [],
		disadvantageOn: [],
		cantDo: ['move', 'speak', 'take-actions', 'take-reactions'],
		autoFailSaves: ['str', 'dex'],
		speedMultiplier: 0,
		notes: ['The creature is unaware of its surroundings.', 'Attack rolls against the creature have advantage.', 'Hits from within 5 feet are critical hits.']
	},
	exhaustion: {
		advantageOn: [],
		disadvantageOn: ['ability-checks'],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 0.5,
		notes: ['Higher exhaustion levels stack additional penalties.']
	},
	raging: {
		advantageOn: ['strength-checks', 'strength-saving-throws'],
		disadvantageOn: [],
		cantDo: [],
		autoFailSaves: [],
		speedMultiplier: 1,
		notes: ['Resistance to bludgeoning, piercing, and slashing damage.', 'Bonus damage on melee weapon attacks.']
	}
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc' | 'ammunition' | 'container';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary';

export interface BaseItem {
	id: GameId;
	name: string;
	category: ItemCategory;
	description: string;
	/** Gold-piece value */
	value: number;
	/** How many the holder has. */
	quantity: number;
	weight: number;
	/**
	 * Space Units — geometric volume proxy for this item.
	 * 1 SU ≈ the space of a typical handheld object.
	 * Coins are 0.01 SU each; a greatsword is 5 SU.
	 * Derived from ITEM_SU_TABLE or fallback formula (weight * 0.7, min 0.5).
	 * Optional at creation time — normalizeItem fills it in at load.
	 */
	spaceTaken?: number;
	rarity: ItemRarity;
	attunement: boolean;
	/** True when this item was crafted or assembled in-world rather than found/purchased. */
	crafted?: boolean;
	/** Brief description of source materials (e.g. 'carved from dragon bone', 'brewed from goblin herbs'). */
	craftedFrom?: string;
	/** Free-form notes on the item's origin or special crafted properties. */
	craftingNotes?: string;
	/** True when this item was part of the character's starting equipment at creation. */
	isStartingEquipment?: boolean;
}

export interface WeaponItem extends BaseItem {
	category: 'weapon';
	weaponName: string;
	damage: string;
	damageType: string;
	magicBonus: number;
	properties: string[];
	range?: string;
	equipped?: boolean;
	specialProperties?: string[];
}

export interface ArmorItem extends BaseItem {
	category: 'armor';
	armorName: string;
	baseAC: number;
	magicBonus: number;
	equipped: boolean;
	maxDexBonus?: number | null;
	stealthDisadvantage?: boolean;
}

export interface ConsumableItem extends BaseItem {
	category: 'consumable';
	charges: number;
	maxCharges?: number;
	effectDescription: string;
	consumableType?: 'potion' | 'scroll' | 'food' | 'ammo' | 'other';
}

export interface QuestItem extends BaseItem {
	category: 'quest';
	questId?: GameId;
	importance?: 'minor' | 'major' | 'critical';
}

export interface MiscItem extends BaseItem {
	category: 'misc';
	notes?: string;
	tags?: string[];
	/** True when this misc item (e.g. clothing) is currently worn/equipped. */
	equipped?: boolean;
}

export interface AmmunitionItem extends BaseItem {
	category: 'ammunition';
	/** Weapon IDs (from WEAPONS table) this ammo can be fired from, e.g. ['longbow', 'shortbow'] */
	ammoFor: string[];
	/** Damage if treated as an improvised thrown weapon — sequestered, not read by combat resolution. */
	improvisedDamage?: string;
	improvisedDamageType?: string;
}

export type ContainerType =
	| 'backpack'
	| 'chest'
	| 'bag'
	| 'pouch'
	| 'sack'
	| 'case'
	| 'saddlebag'
	| 'belt-pouch'
	| 'coin-purse'
	| 'quiver'
	| 'belt'
	| 'component-pouch'
	| 'scroll-case'
	| 'other';

/**
 * Per-container discount rule. Applied when computing effective WU or SU
 * for items stored inside this container.
 */
export interface ContainerDiscount {
	/** Apply only to items of this category. Omit to apply to all. */
	category?: ItemCategory;
	/** Apply only when item name contains this substring (case-insensitive). */
	nameMatch?: string;
	/** Effective WU multiplier. 0.5 = half weight credit. 1.0 = no discount. */
	wuMultiplier: number;
	/** Effective SU multiplier. 0.1 = very compact storage. 1.0 = no discount. */
	suMultiplier: number;
}

export interface ContainerCapacity {
	/** Maximum Weight Units the container can hold. 1 WU = 1 lb. */
	maxWU: number;
	/** Maximum Space Units the container can hold. */
	maxSU: number;
	/** Optional per-item-type discounts for this container's storage. */
	discounts?: ContainerDiscount[];
	/** @deprecated Use maxWU instead. Kept for migration from old saves. */
	maxWeight?: number;
	/** @deprecated Use maxSU math instead. */
	maxSlots?: number;
}

/** Extended encumbrance info including variant thresholds and SU totals. */
export interface EnhancedEncumbranceInfo {
	/** Current carried WU (= total lbs from all inventory). Worn/equipped items count at 25%. */
	wuTotal: number;
	/** Total SU across entire inventory. */
	suTotal: number;
	/** STR × 30 — maximum carry capacity (Overloaded threshold). */
	capacity: number;
	/** STR × 15 — threshold for Loaded (no speed penalty). */
	loadedThreshold: number;
	/** STR × 25 — threshold for Burdened (speed −10 ft, disadvantage on STR/DEX/CON). */
	burdenedThreshold: number;
	/** Percentage used (wuTotal / capacity), can exceed 100. */
	pct: number;
	/** Current load status badge. */
	badge: 'unloaded' | 'loaded' | 'burdened' | 'overloaded';
	/** True when wuTotal > loadedThreshold. */
	isEncumbered: boolean;
	/** True when wuTotal > burdenedThreshold. */
	isHeavilyEncumbered: boolean;
	/** True when wuTotal > capacity. */
	isOverCapacity: boolean;
}

export interface ContainerItem extends BaseItem {
	category: 'container';
	containerType: ContainerType;
	capacity: ContainerCapacity;
	/** Items stored inside this container. */
	contents: Item[];
}

export type Item = WeaponItem | ArmorItem | ConsumableItem | QuestItem | MiscItem | AmmunitionItem | ContainerItem;

// ---------------------------------------------------------------------------
// Character progression helpers
// ---------------------------------------------------------------------------

export interface CharacterFeatureRef {
	name: string;
	/** Machine-readable identifier for the feature (e.g. 'relentless-endurance'). */
	tag?: string;
	level: number;
	source?: 'class' | 'subclass' | 'race' | 'background' | 'feat' | 'other';
	/** Which class granted this feature (for multiclass tracking). */
	sourceClass?: ClassName;
	description?: string;
	/** Maximum uses before a rest, if limited. */
	maxUses?: number;
	/** Current remaining uses. */
	currentUses?: number;
	/** When this feature's uses recover. */
	recoversOn?: 'short-rest' | 'long-rest' | 'dawn';
}

export interface SpellSlotPool {
	level: number;
	current: number;
	max: number;
}

// ---------------------------------------------------------------------------
// Multiclass structures
// ---------------------------------------------------------------------------

/** Per-class level entry. The canonical source of truth for class progression. */
export interface ClassLevel {
	name: ClassName;
	level: number;
	subclass?: string;
	/** Hit dice remaining for this class's die size. */
	hitDiceRemaining: number;
}

/** Spells owned by a specific class, with that class's casting ability. */
export interface ClassSpellList {
	className: ClassName;
	spellcastingAbility: AbilityName;
	cantrips: string[];
	/** For known-casters (bard, sorcerer, warlock, ranger): fixed spell list. */
	knownSpells: string[];
	/** For prepared-casters (cleric, druid, wizard, paladin): currently prepared spells. */
	preparedSpells: string[];
}

export interface DeathSaves {
	successes: number;
	failures: number;
}

// ---------------------------------------------------------------------------
// Player Characters
// ---------------------------------------------------------------------------

export interface PlayerCharacter {
	id: GameId;
	/** FK → adventure_members.userId */
	userId: string;
	/** FK → adventures.id */
	adventureId: string;

	name: string;
	race: RaceName;
	/** All class levels. Primary class is classes[0]. Source of truth for per-class data. */
	classes: ClassLevel[];
	subrace?: string;
	background?: string;
	alignment?: Alignment;
	/** Total character level. Always = sum of classes[].level. */
	level: number;

	abilities: AbilityScores;
	hp: number;
	maxHp: number;
	/** Temporary hit points (lost first, don't stack). */
	tempHp: number;
	ac: number;
	speed: number;
	size: CharacterSize;
	proficiencyBonus: number;
	/** Skill proficiency list. */
	skillProficiencies: SkillName[];
	/** Skills with expertise (double proficiency bonus). */
	expertiseSkills: SkillName[];
	/** Saving-throw proficiency list (typically two abilities from class). */
	saveProficiencies: AbilityName[];
	languages: string[];
	armorProficiencies: string[];
	weaponProficiencies: string[];
	toolProficiencies: string[];
	classFeatures: CharacterFeatureRef[];
	feats: string[];
	/** Standard (non-pact) spell slots. For multiclass, computed from effective caster level. */
	spellSlots: SpellSlotPool[];
	/** Warlock pact magic slots (separate pool, refreshes on short rest). */
	pactSlots: SpellSlotPool[];
	/** Per-class spell ownership. */
	classSpells: ClassSpellList[];
	/** The spell the character is currently concentrating on, or null. */
	concentratingOn: string | null;
	deathSaves: DeathSaves;
	inspiration: boolean;
	passivePerception: number;

	inventory: Item[];
	gold: number;
	silver?: number;
	copper?: number;
	xp: number;

	conditions: Condition[];
	/** Damage type resistances from race, class, or items (e.g. 'fire', 'poison'). */
	resistances: string[];
	/** 0 = none, 1-6 per the 5e exhaustion table. Level 6 = death. */
	exhaustionLevel: number;
	/** True when stabilized at 0 HP (3 death save successes). */
	stable: boolean;
	/** True when the character has died (3 death save failures, massive damage, or exhaustion 6). */
	dead: boolean;
	/** Runtime tracker for limited-use features (keyed by feature name). */
	featureUses: Record<string, { current: number; max: number; recoversOn: 'short-rest' | 'long-rest' | 'dawn' }>;
	/** Item IDs the character is attuned to (max 3 in 5e). */
	attunedItems: GameId[];
	/** Free-form backstory / notes. */
	backstory: string;
}

// ---------------------------------------------------------------------------
// Multiclass convenience helpers
// ---------------------------------------------------------------------------

/** Returns the primary (first) class name, or 'fighter' as fallback. */
export function getPrimaryClass(pc: PlayerCharacter): ClassName {
	return pc.classes[0]?.name ?? 'fighter';
}

/** Returns the primary class's subclass, if any. */
export function getPrimarySubclass(pc: PlayerCharacter): string | undefined {
	return pc.classes[0]?.subclass;
}

/** Whether the character has at least one level in the given class. */
export function hasClass(pc: PlayerCharacter, className: ClassName): boolean {
	return pc.classes.some((c) => c.name === className);
}

/** Returns the ClassLevel entry for a given class, or undefined if not present. */
export function getClassEntry(pc: PlayerCharacter, className: ClassName): ClassLevel | undefined {
	return pc.classes.find((c) => c.name === className);
}

/** Returns the level in a specific class, or 0 if no levels. */
export function getClassLevelNum(pc: PlayerCharacter, className: ClassName): number {
	return pc.classes.find((c) => c.name === className)?.level ?? 0;
}

/** All known spells across all class spell lists (de-duplicated). */
export function getAllKnownSpells(pc: PlayerCharacter): string[] {
	const all = pc.classSpells.flatMap((cs) => cs.knownSpells);
	return [...new Set(all)];
}

/** All prepared spells across all class spell lists (de-duplicated). */
export function getAllPreparedSpells(pc: PlayerCharacter): string[] {
	const all = pc.classSpells.flatMap((cs) => cs.preparedSpells);
	return [...new Set(all)];
}

/** All cantrips across all class spell lists (de-duplicated). */
export function getAllCantrips(pc: PlayerCharacter): string[] {
	const all = pc.classSpells.flatMap((cs) => cs.cantrips);
	return [...new Set(all)];
}

/** Returns the primary class's spellcasting ability, or undefined for non-casters. */
export function getPrimarySpellcastingAbility(pc: PlayerCharacter): AbilityName | undefined {
	return pc.classSpells[0]?.spellcastingAbility;
}

/** Total hit dice remaining across all classes. */
export function getTotalHitDiceRemaining(pc: PlayerCharacter): number {
	return pc.classes.reduce((sum, c) => sum + c.hitDiceRemaining, 0);
}

/** Hit dice remaining for a specific class. */
export function getHitDiceForClass(pc: PlayerCharacter, className: ClassName): number {
	return pc.classes.find((c) => c.name === className)?.hitDiceRemaining ?? 0;
}

/**
 * Build a ClassSpellList for a class if it has spellcasting.
 * Returns null for non-casters.
 */
export function getClassSpellEntry(pc: PlayerCharacter, className: ClassName): ClassSpellList | undefined {
	return pc.classSpells.find((cs) => cs.className === className);
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export type NpcRole = 'merchant' | 'quest-giver' | 'hostile' | 'neutral' | 'ally' | 'companion' | 'boss';

export interface CreatureAttack {
	name: string;
	toHit: number;
	damage: string;
	damageType: string;
	range?: string;
	notes?: string;
}

export interface CreatureTrait {
	name: string;
	description: string;
}

export interface CreatureAction {
	name: string;
	description: string;
	recharge?: string;
	attack?: CreatureAttack;
}

export interface CreatureSavingThrow {
	ability: AbilityName;
	bonus: number;
}

export interface CreatureSkillBonus {
	skill: SkillName;
	bonus: number;
}

export interface CreatureStatBlock {
	hp: number;
	maxHp: number;
	ac: number;
	abilities: AbilityScores;
	speed: number;
	cr: number;
	attacks: CreatureAttack[];
	savingThrows: CreatureSavingThrow[];
	skills: CreatureSkillBonus[];
	resistances: string[];
	immunities: string[];
	vulnerabilities: string[];
	traits: CreatureTrait[];
	actions: CreatureAction[];
	legendaryActions: CreatureAction[];
}

export interface NpcInteractionNote {
	turn: number;
	note: string;
}

export interface NPC {
	id: GameId;
	name: string;
	role: NpcRole;
	locationId: GameId;
	/** -100 (hostile) to 100 (adoring). Starts at 0 for neutral. */
	disposition: number;
	description: string;
	/** GM-only notes — backstory, secrets, agenda. */
	notes: string;
	/** Nicknames/informal names the player may use. Shown in AI context to prevent duplicate NPC creation. */
	aliases?: string[];
	alive: boolean;
	statBlock?: CreatureStatBlock;
	/** Turn number of the most recent interaction (state change, narrative mention, or creation). */
	lastInteractionTurn?: number;
	/** Timestamped interaction history — auto-routed from scene facts + explicit GM notes. */
	interactionNotes?: NpcInteractionNote[];
	/** When true, NPC is excluded from prompt context but preserved in state for history. */
	archived?: boolean;
	/** Active 5e conditions on this NPC. Defaults to [] on construction. Persisted for multi-turn tracking. */
	conditions?: Condition[];
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export type LocationType = 'settlement' | 'wilderness' | 'dungeon' | 'interior' | 'road';

export interface Location {
	id: GameId;
	name: string;
	/** Links back to the worldgen settlement / region index, if any. */
	regionRef: number | null;
	type: LocationType;
	description: string;
	/** IDs of directly reachable locations. */
	connections: GameId[];
	/** NPC IDs present here. */
	npcs: GameId[];
	/** Free-form hazard / feature descriptions. */
	features: string[];
	visited: boolean;
	/** Items lying on the ground at this location (dropped, looted, placed). */
	groundItems?: Item[];
	/** Pre-computed travel time in periods; set at world-seed time for distance-measured routes. */
	travelPeriods?: number;
	/** Gate access policy — governs entry restrictions by time of day. */
	gatePolicy?: 'none' | 'daytime-only' | 'guarded-at-night';
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestStatus = 'available' | 'active' | 'completed' | 'failed';

export type QuestObjectiveType = 'talk-to' | 'visit-location' | 'defeat-encounter' | 'find-item' | 'escort' | 'custom';

export interface QuestObjective {
	id: GameId;
	text: string;
	done: boolean;
	/** Machine-readable objective type for deterministic auto-tracking. */
	type?: QuestObjectiveType;
	/** Entity ID this objective is linked to (NPC id, location id, item name). */
	linkedEntityId?: GameId;
	/** Human-readable name of the linked entity (for AI context). */
	linkedEntityName?: string;
}

export interface QuestRewardReputationChange {
	npcId: GameId;
	delta: number;
}

export interface QuestRewards {
	xp: number;
	gold: number;
	items: Item[];
	reputationChanges: QuestRewardReputationChange[];
}

export type EncounterTemplateTier = 'minion' | 'soldier' | 'elite' | 'boss' | 'legendary';

export type QuestCompletionMethod = 'combat' | 'diplomacy' | 'stealth' | 'bribery' | 'deception' | 'custom' | 'expired';

export interface Quest {
	id: GameId;
	name: string;
	giverNpcId: GameId | null;
	status: QuestStatus;
	description: string;
	objectives: QuestObjective[];
	rewards: QuestRewards;
	recommendedLevel: number;
	encounterTemplates: EncounterTemplateTier[];
	/** How the quest was resolved. Populated when status transitions to 'completed' or 'failed'. */
	completionMethod?: QuestCompletionMethod;
	/** Optional in-world deadline. Quest auto-fails when state.clock.day > deadline.day. */
	deadline?: { day: number; description: string };
	/**
	 * Stakes reminder shown to the AI every turn for active quests.
	 * Describes real-world consequences if the quest is not completed.
	 */
	failureConsequence?: string;
	/** IDs of quests that become 'available' when this quest transitions to 'completed'. */
	followUpQuestIds?: GameId[];
	/** IDs of quests that must be 'completed' before this quest can become 'active'. */
	prerequisiteQuestIds?: GameId[];
}

// ---------------------------------------------------------------------------
// Game Clock
// ---------------------------------------------------------------------------

export type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';

export interface GameClock {
	day: number;
	timeOfDay: TimeOfDay;
	weather: string;
}

// ---------------------------------------------------------------------------
// Turn Records
// ---------------------------------------------------------------------------

export type TurnActorType = 'player' | 'gm';

export type IntentType =
	| 'move'
	| 'attack'
	| 'talk'
	| 'use-item'
	| 'equip-item'
	| 'drop-item'
	| 'cast-spell'
	| 'examine'
	| 'rest'
	| 'death-save'
	| 'free-narration'
	| 'out-of-character'
	| 'unknown';

export interface DiceResult {
	notation: string;
	rolls: number[];
	total: number;
}

export interface MechanicResult {
	type: 'skill-check' | 'attack-roll' | 'saving-throw' | 'damage' | 'healing' | 'other';
	label: string;
	/** Dice result. Optional for informational (type: 'other') results with no associated roll. */
	dice?: DiceResult;
	dc?: number;
	success?: boolean;
}

// ---------------------------------------------------------------------------
// Pending Check / Roll Request  (Phase B — tabletop adjudication)
// ---------------------------------------------------------------------------

/**
 * The kind of dice check the engine can request a player to resolve.
 * Maps directly to existing mechanics.ts primitives.
 */
export type CheckKind = 'skill' | 'save' | 'tool' | 'contested' | 'ability' | 'attack';

/**
 * A typed request for a pending dice check.
 *
 * Created by `resolveTurn()` when the engine determines that a non-trivial
 * action requires a roll before the narrative can proceed.  Persisted
 * durably so the UI can render a "Make a Perception check" prompt and
 * wait for the player to click-to-roll.
 *
 * After the player resolves, the engine converts this into a
 * `MechanicResult` and the turn pipeline resumes with narrator mode.
 */
export interface PendingCheck {
	/** Unique id for this check (ULID). */
	id: GameId;

	/** What kind of check this is. */
	kind: CheckKind;

	/** Which character must resolve this check. */
	characterId: GameId;

	/** The ability score used (e.g. 'wis' for Perception). */
	ability: AbilityName;

	/** Skill name if this is a skill check (e.g. 'perception'). */
	skill?: SkillName;

	/** DC to beat, if known to the engine. */
	dc?: number;

	/** Whether the check has advantage, disadvantage, or neither. */
	advantageState: 'advantage' | 'disadvantage' | 'normal';

	/** Human-readable reason shown in the UI and fed to the narrator.
	 *  e.g. "Make a Perception check to notice the hidden trap."
	 */
	reason: string;

	/** If this check is part of a combat encounter (vs exploration/dialogue). */
	combatBound: boolean;

	/** Optional opposing actor (for contested checks). */
	opposingActorId?: GameId;

	/** The resolved result, once the player rolls. Undefined while pending. */
	result?: MechanicResult;
}

export type EncounterOutcome = 'victory' | 'defeat' | 'flee' | 'negotiated';

export interface StateChange {
	hpChanges?: Array<{ characterId: GameId; oldHp: number; newHp: number; reason: string }>;
	itemsGained?: Array<{ characterId: GameId; item: Item }>;
	itemsLost?: Array<{ characterId: GameId; itemId: GameId; quantity: number }>;
	/** Drop an item from a character's inventory onto the ground at a location (preserving the original item). */
	itemsDropped?: Array<{ characterId: GameId; itemId: GameId; locationId?: GameId }>;
	/** Pick up an item from the ground (by its original id) into a character's inventory. */
	itemsPickedUp?: Array<{ characterId: GameId; itemId: GameId; locationId?: GameId }>;
	/** Place items at an existing location (GM-seeded loot, unlocked chest, enemy drops). */
	locationItemsAdded?: Array<{ locationId: GameId; item: Item }>;
	locationChange?: { from: GameId | null; to: GameId };
	npcChanges?: Array<{ npcId: GameId; field: string; oldValue: unknown; newValue: unknown }>;
	questUpdates?: Array<{
		questId: GameId;
		field: string;
		oldValue: unknown;
		newValue: unknown;
		objectiveId?: GameId;
		/** How the quest was resolved — included when field==='status' and newValue is 'completed' or 'failed'. */
		completionMethod?: QuestCompletionMethod;
	}>;
	conditionsApplied?: Array<{ characterId: GameId; condition: Condition; applied: boolean }>;
	xpAwarded?: Array<{ characterId: GameId; amount: number; reason?: string }>;
	/** Direct gold transfer to one or more characters (payments, found coins, sales proceeds). */
	goldChange?: Array<{ characterId: GameId; delta: number; reason: string }>;
	clockAdvance?: { from: GameClock; to: GameClock };
	spellSlotUsed?: { characterId: GameId; level: number; spellName: string };
	hitDiceUsed?: { characterId: GameId; amount: number };
	deathSaveResult?: { characterId: GameId; result: 'success' | 'failure' | 'critical-success' | 'critical-failure' };
	deathSaveOutcome?: { characterId: GameId; outcome: 'stable' | 'dead' };
	featureUsed?: { characterId: GameId; feature: string };
	encounterStarted?: { creatures: (NPC & { tier?: string })[] };
	encounterEnded?: { outcome: EncounterOutcome };

	/** @deprecated Audit-trail only — the engine resolves combat authoritatively via MechanicResult[].
	 *  Retained for backward-compatible deserialization of old TurnRecords. Not consumed by gameplay code. */
	combatAction?: { targetId: GameId; type: 'attack' | 'spell' | 'other' };
	/** @deprecated Audit-trail only — the engine resolves enemy actions via PendingCombatAction[].
	 *  Retained for backward-compatible deserialization of old TurnRecords. Not consumed by gameplay code. */
	enemyCombatActions?: Array<{ npcId: GameId; targetId: GameId; attackIndex?: number }>;

	/** Promote one or more existing NPCs to companion status (travels + fights with the party). */
	companionPromoted?: Array<{ npcId: GameId; statBlock?: CreatureStatBlock | null }>;

	// --- World-building additions (Step 7) ---
	/** NPCs the GM introduced into the world this turn. */
	npcsAdded?: Array<{
		id: GameId;
		name: string;
		role: NpcRole;
		locationId: GameId;
		disposition: number;
		description: string;
		notes?: string;
		/** Optional stat block — filled by engine if absent/flat for hostile/boss NPCs. */
		statBlock?: CreatureStatBlock;
	}>;
	/** Locations the GM created or revealed this turn. */
	locationsAdded?: Array<{
		id: GameId;
		name: string;
		type: LocationType;
		description: string;
		connections?: GameId[];
		features?: string[];
		/** Pre-seed items at this location (treasure room, chest, loot pile). */
		groundItems?: Item[];
	}>;
	/** Quests the GM introduced this turn. */
	questsAdded?: Array<{
		id: GameId;
		name: string;
		description: string;
		giverNpcId?: GameId | null;
		objectives: Array<{ id: GameId; text: string }>;
		recommendedLevel?: number;
		/** What goes wrong in the world if this quest is not completed. */
		failureConsequence?: string;
		/** Optional in-world deadline for this quest. */
		deadline?: { day: number; description: string };
		/** Quest IDs unlocked when this quest completes (requires those quests to already exist). */
		followUpQuestIds?: GameId[];
		/** Quest IDs that must be 'completed' before this quest becomes 'active'. */
		prerequisiteQuestIds?: GameId[];
		/** Optional initial status. Only 'available' and 'active' are permitted on new quests. */
		status?: 'available' | 'active';
	}>;
	/** Free-form scene facts the GM established (non-mechanical). */
	sceneFactsAdded?: string[];
}

export interface TurnRecord {
	id: GameId;
	turnNumber: number;
	actorType: TurnActorType;
	actorId: string;
	/** Raw text the player typed, or empty for GM-initiated turns. */
	action: string;
	/** Parsed intent classification. */
	intent: IntentType;
	/**
	 * 'completed'    — fully resolved turn.
	 * 'clarification' — engine needs the player to clarify intent.
	 * 'awaiting-roll' — engine produced a PendingCheck; waiting for dice.
	 */
	status: 'completed' | 'clarification' | 'awaiting-roll';
	/** Canonical summary of the engine resolution, e.g. "Cast Cure Wounds (level 1 slot) on self". */
	resolvedActionSummary: string;
	/** Dice rolls and checks resolved this turn. */
	mechanicResults: MechanicResult[];
	/** Structured description of what changed. */
	stateChanges: StateChange;
	/** The GM's narrative prose. */
	narrativeText: string;
	timestamp: number;
	/** If status === 'awaiting-roll', the pending check metadata. */
	pendingCheck?: PendingCheck;
}

// ---------------------------------------------------------------------------
// Encounter state
// ---------------------------------------------------------------------------

export type CombatantType = 'character' | 'npc';

export interface Combatant {
	id: GameId;
	referenceId: GameId;
	type: CombatantType;
	name: string;
	initiative: number;
	currentHp: number;
	maxHp: number;
	tempHp: number;
	ac: number;
	conditions: Condition[];
	resistances: string[];
	immunities: string[];
	vulnerabilities: string[];
	concentration: boolean;
	defeated: boolean;
}

/**
 * A single actor's resolved action within a combat round.
 * Accumulated in encounter.roundActions until the round is narrated.
 */
export interface PendingCombatAction {
	/** The combatant who acted. */
	combatantId: GameId;
	/** Which human player submitted this action (undefined = auto-resolved by engine for NPCs). */
	actorUserId?: string;
	/** The raw text the player typed, or a generated description for engine-auto actions. */
	rawAction: string;
	/** Resolved dice/mechanic results from this action. */
	mechanicResults: MechanicResult[];
	/** HP + condition changes caused by this action (merged into final state at round end). */
	stateChanges: StateChange;
	timestamp: number;
}

export interface ActiveEncounter {
	id: GameId;
	round: number;
	turnIndex: number;
	initiativeOrder: GameId[];
	combatants: Combatant[];
	status: 'active' | EncounterOutcome;
	startedAt: number;
	endedAt?: number;
	outcome?: EncounterOutcome;
	/**
	 * The combatant ID whose action is currently being solicited.
	 * Set after each actor resolves so the next human knows it's their cue.
	 * Null when all actors have gone and the round is being narrated.
	 */
	awaitingActorId?: GameId | null;
	/**
	 * Accumulates all resolved actions this round. Cleared after round-end narration.
	 */
	roundActions?: PendingCombatAction[];
	/**
	 * Quest objective IDs that are structurally linked to this encounter.
	 * Set at encounter creation by matching creature names against quest objective text.
	 * On victory, resolveEncounter auto-completes these — no AI inference needed.
	 */
	linkedObjectiveIds?: string[];
}

// ---------------------------------------------------------------------------
// Combat Intent — structured output from the per-turn LLM classifier
// ---------------------------------------------------------------------------

export type CombatIntentType =
	| 'attack'
	| 'cast-spell'
	| 'use-item'
	| 'move'
	| 'dodge'
	| 'disengage'
	| 'flee'
	| 'talk'
	| 'query';

/**
 * Structured intent produced by the dedicated combat classifier LLM.
 * Replaces regex-based intent classification during active combat.
 * Resolves intent, target, weapon, and spell in a single call.
 */
export interface CombatIntent {
	type: CombatIntentType;
	/** Combatant reference ID resolved by the classifier from the encounter list. */
	targetId?: string;
	/** What the player said about the target, for narration context. */
	targetDescription?: string;
	/** Inventory item ID resolved for the weapon to use. */
	weaponItemId?: string;
	/** Spell name resolved from the actor's prepared/known spells. */
	spellName?: string;
	/** Fuzzy item description for use-item intent. */
	itemHint?: string;
	/** High = proceed, low = ask for clarification. */
	confidence: 'high' | 'low';
}

// ---------------------------------------------------------------------------
// Game State — the top-level mutable document
// ---------------------------------------------------------------------------

/** Version tag so we can migrate old state blobs forward. */
export const GAME_STATE_VERSION = 3;

export interface GameState {
	version: typeof GAME_STATE_VERSION;
	stateVersion: typeof GAME_STATE_VERSION;
	characters: PlayerCharacter[];
	npcs: NPC[];
	locations: Location[];
	quests: Quest[];
	activeEncounter?: ActiveEncounter;
	conditionEffects: ConditionEffectMap;
	partyLocationId: GameId | null;
	clock: GameClock;
	turnLog: TurnRecord[];
	/** Reference to the accepted PrototypeWorld (stored separately). */
	worldSeed: string;
	/** Monotonically increasing counter for turn numbering. */
	nextTurnNumber: number;
	/** Consecutive non-travel/non-combat turns elapsed; auto-advances clock every IDLE_TURNS_PER_PERIOD. */
	idleTurnCount?: number;
	/** Accumulated scene facts the GM established — surfaced in future prompts. */
	sceneFacts: string[];
	/** When the game state was first created. */
	createdAt: number;
	/** Last mutation timestamp. */
	updatedAt: number;
}

// ---------------------------------------------------------------------------
// GM Structured Response
// ---------------------------------------------------------------------------

/**
 * The shape the AI is asked to return from a turn resolution.
 * narrativeText is the prose shown to players.
 * stateChanges is the structured mutation the server applies.
 */
export interface GMResponse {
	narrativeText: string;
	stateChanges: StateChange;
	/** Optional GM-internal reasoning / notes (not shown to players). */
	gmNotes?: string;
}

// ---------------------------------------------------------------------------
// Character Creation Input
// ---------------------------------------------------------------------------

export interface CharacterSpellChoices {
	cantrips?: string[];
	knownSpells?: string[];
	preparedSpells?: string[];
}

export interface CharacterCreateInput {
	name: string;
	race: RaceName;
	subrace?: string;
	class: ClassName;
	subclass?: string;
	background?: string;
	alignment?: Alignment;
	/** 'rolled' uses 4d6-drop-lowest; 'standard' uses the standard array. */
	statMethod: 'rolled' | 'standard' | 'point-buy';
	/** Assigned scores after rolling, standard array, or point-buy. */
	abilityAssignment?: AbilityScores;
	/** Flexible +1/+1 racial bonuses such as Half-Elf or Variant Human. */
	abilityChoiceBonuses?: Partial<AbilityScores>;
	/** Bonus race-granted skill picks such as Half-Elf or Variant Human. */
	bonusSkillChoices?: SkillName[];
	/** Extra languages granted by race/background choices. */
	chosenLanguages?: string[];
	/** Which skills the player chose from their class options. */
	chosenSkills: SkillName[];
	/** Starting cantrips / known spells / prepared spells for level 1 casters. */
	spellChoices?: CharacterSpellChoices;
	/** Selected option index for each class equipment choice row. */
	equipmentSelections?: number[];
	/** Sub-selections for weapon-category / instrument placeholders.
	 *  Key = "sub-{choiceIndex}", value = ordered array of chosen item display names.
	 *  e.g. { "sub-1": ["Longsword", "Greatsword"] } for "Two Martial Weapons". */
	equipmentSubSelections?: Record<string, string[]>;
	/** Per-background interactive choices: key = BackgroundEquipmentChoice.id, value = selected label or text. */
	backgroundEquipmentChoices?: Record<string, string>;
	/** Variant human feat selection. */
	variantHumanFeat?: string;
	/** Expertise skill choices for classes with the Expertise feature (e.g. Rogue level 1). */
	expertiseChoices?: SkillName[];
	backstory?: string;
	/** Optional: import a multiclass character with predefined class levels. */
	importClasses?: ClassLevel[];
}
