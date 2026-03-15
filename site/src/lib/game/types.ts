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
	| 'chaotic-evil'
	| 'unaligned';

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
	| 'exhaustion';

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
	}
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'quest' | 'misc';
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
	rarity: ItemRarity;
	attunement: boolean;
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
}

export type Item = WeaponItem | ArmorItem | ConsumableItem | QuestItem | MiscItem;

// ---------------------------------------------------------------------------
// Character progression helpers
// ---------------------------------------------------------------------------

export interface CharacterFeatureRef {
	name: string;
	level: number;
	source?: 'class' | 'subclass' | 'race' | 'background' | 'feat' | 'other';
	description?: string;
}

export interface SpellSlotPool {
	level: number;
	current: number;
	max: number;
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
	class: ClassName;
	subrace?: string;
	subclass?: string;
	background?: string;
	alignment?: Alignment;
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
	/** Saving-throw proficiency list (typically two abilities from class). */
	saveProficiencies: AbilityName[];
	languages: string[];
	armorProficiencies: string[];
	weaponProficiencies: string[];
	toolProficiencies: string[];
	classFeatures: CharacterFeatureRef[];
	feats: string[];
	spellcastingAbility?: AbilityName;
	spellSlots: SpellSlotPool[];
	knownSpells: string[];
	preparedSpells: string[];
	cantrips: string[];
	hitDiceRemaining: number;
	deathSaves: DeathSaves;
	inspiration: boolean;
	passivePerception: number;

	inventory: Item[];
	gold: number;
	xp: number;

	conditions: Condition[];
	/** Free-form backstory / notes. */
	backstory: string;
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export type NpcRole = 'merchant' | 'quest-giver' | 'hostile' | 'neutral' | 'ally' | 'boss';

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
	alive: boolean;
	statBlock?: CreatureStatBlock;
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
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestStatus = 'available' | 'active' | 'completed' | 'failed';

export interface QuestObjective {
	id: GameId;
	text: string;
	done: boolean;
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
	| 'cast-spell'
	| 'examine'
	| 'rest'
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
	dice: DiceResult;
	dc?: number;
	success?: boolean;
}

export type EncounterOutcome = 'victory' | 'defeat' | 'flee' | 'negotiated';

export interface StateChange {
	hpChanges?: Array<{ characterId: GameId; oldHp: number; newHp: number; reason: string }>;
	itemsGained?: Array<{ characterId: GameId; item: Item }>;
	itemsLost?: Array<{ characterId: GameId; itemId: GameId; quantity: number }>;
	locationChange?: { from: GameId | null; to: GameId };
	npcChanges?: Array<{ npcId: GameId; field: string; oldValue: unknown; newValue: unknown }>;
	questUpdates?: Array<{ questId: GameId; field: string; oldValue: unknown; newValue: unknown; objectiveId?: GameId }>;
	conditionsApplied?: Array<{ characterId: GameId; condition: Condition; applied: boolean }>;
	xpAwarded?: Array<{ characterId: GameId; amount: number }>;
	clockAdvance?: { from: GameClock; to: GameClock };
	spellSlotUsed?: { characterId: GameId; level: number; spellName: string };
	hitDiceUsed?: { characterId: GameId; amount: number };
	deathSaveResult?: { characterId: GameId; result: 'success' | 'failure' | 'critical-success' | 'critical-failure' };
	featureUsed?: { characterId: GameId; feature: string };
	encounterStarted?: { creatures: NPC[] };
	encounterEnded?: { outcome: EncounterOutcome };
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
	/** Dice rolls and checks resolved this turn. */
	mechanicResults: MechanicResult[];
	/** Structured description of what changed. */
	stateChanges: StateChange;
	/** The GM's narrative prose. */
	narrativeText: string;
	timestamp: number;
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
	concentration: boolean;
	defeated: boolean;
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
}

// ---------------------------------------------------------------------------
// Game State — the top-level mutable document
// ---------------------------------------------------------------------------

/** Version tag so we can migrate old state blobs forward. */
export const GAME_STATE_VERSION = 2;

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
	/** Variant human feat selection. */
	variantHumanFeat?: string;
	backstory?: string;
}
