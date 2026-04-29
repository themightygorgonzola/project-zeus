/**
 * Project Zeus — Game Layer
 *
 * Public API surface for the game domain. Import from '$lib/game' to
 * access types, mechanics, state management, and context assembly.
 *
 * The game layer is pure TypeScript with no UI framework dependencies.
 * It sits between the UI (Svelte) and the infrastructure (DB, AI, PartyKit).
 */

// Types
export type {
	ActiveEncounter,
	Alignment,
	AbilityName,
	AbilityScores,
	ArmorItem,
	CharacterCreateInput,
	CharacterSpellChoices,
	CharacterFeatureRef,
	CharacterSize,
	ClassLevel,
	ClassName,
	ClassSpellList,
	Combatant,
	CombatantType,
	Condition,
	ConditionEffect,
	ConditionEffectMap,
	ConsumableItem,
	ContainerCapacity,
	ContainerDiscount,
	ContainerItem,
	ContainerType,
	CreatureAction,
	CreatureAttack,
	CreatureSavingThrow,
	CreatureSkillBonus,
	CreatureStatBlock,
	CreatureTrait,
	DeathSaves,
	DiceResult,
	EnhancedEncumbranceInfo,
	EncounterOutcome,
	EncounterTemplateTier,
	GameClock,
	GameId,
	GameState,
	GMResponse,
	IntentType,
	Item,
	ItemCategory,
	ItemRarity,
	Location,
	LocationType,
	MechanicResult,
	MiscItem,
	NPC,
	NpcRole,
	PlayerCharacter,
	Quest,
	QuestObjective,
	QuestItem,
	QuestRewardReputationChange,
	QuestRewards,
	QuestStatus,
	RaceName,
	SkillName,
	SpellSlotPool,
	StateChange,
	TimeOfDay,
	TurnActorType,
	TurnRecord,
	WeaponItem
} from './types';

export {
	DEFAULT_CONDITION_EFFECTS,
	GAME_STATE_VERSION,
	CLASS_HIT_DIE,
	CLASS_SKILL_OPTIONS,
	SKILL_ABILITY_MAP,
	getPrimaryClass,
	getPrimarySubclass,
	hasClass,
	getClassEntry,
	getClassLevelNum,
	getAllKnownSpells,
	getAllPreparedSpells,
	getAllCantrips,
	getPrimarySpellcastingAbility,
	getTotalHitDiceRemaining,
	getHitDiceForClass,
	getClassSpellEntry
} from './types';

// Mechanics
export type { AdvantageState, RollType, RollModifiers, ContestedCheckResult, DeathSaveResult, DeathSaveRollResult } from './mechanics';
export {
	roll,
	rollDie,
	rollDice,
	rollD20,
	rollAbilityScores,
	abilityModifier,
	proficiencyBonus,
	resolveRollModifiers,
	skillCheck,
	abilityCheck,
	savingThrow,
	attackRoll,
	contestedCheck,
	toolCheck,
	passiveScore,
	applyDamage,
	applyDamageTypeModifiers,
	applyHealing,
	rollDeathSave,
	levelUpHpIncrease,
	level1Hp,
	baseAc,
	pointBuy,
	STANDARD_ARRAY
} from './mechanics';

// Events
export type {
	GameEvent,
	NarrativeStartEvent,
	NarrativeChunkEvent,
	NarrativeEndEvent,
	NarrativeErrorEvent,
	StateUpdateEvent,
	DiceRollEvent,
	TurnCompleteEvent,
	CharacterUpdateEvent,
	CharacterDownEvent,
	LocationChangeEvent,
	NpcInteractionEvent,
	QuestUpdateEvent,
	CombatStartEvent,
	CombatEndEvent,
	ClockAdvanceEvent
} from './events';

export { isGameEvent } from './events';

// 5e data layer
export * from './data';

// Combat engine
export type {
	TurnBudget,
	InitiativeEntry,
	CombatAttackResult,
	EncounterResolutionResult
} from './combat';

export {
	rollInitiative,
	createEncounter,
	getCurrentCombatant,
	advanceTurn,
	resolveAttack,
	resolveNpcAttack,
	resolveCombatantDamage,
	resolveEncounter,
	freshTurnBudget,
	combatantTurnBudget,
	allDefeated,
	getLivingCombatants,
	findCombatant
} from './combat';

// Conditions, Death Saves & Exhaustion
export type {
	DeathSaveOutcome,
	AppliedDeathSaveResult,
	UnconsciousDamageResult,
	ExhaustionEffects
} from './conditions';

export {
	applyCondition,
	removeCondition,
	hasCondition,
	performDeathSave,
	checkDeathSaveOutcome,
	damageWhileUnconscious,
	resetDeathSaves,
	getExhaustionEffects,
	addExhaustion,
	removeExhaustion,
	resolveRollModifiersWithExhaustion,
	effectiveMaxHp,
	effectiveSpeed
} from './conditions';

// Spellcasting Engine
export type {
	CanCastResult,
	SpellCastResult,
	ConcentrationCheckResult,
	RitualCastResult
} from './spellcasting';

export {
	getSpellSaveDC,
	getSpellSaveDCForClass,
	getSpellAttackBonus,
	getSpellAttackBonusForClass,
	canCastSpell,
	expendSpellSlot,
	castSpell,
	concentrationCheck,
	dropConcentration,
	cantripDamageAtLevel,
	cantripDiceMultiplier,
	ritualCast,
	resolveSpellUpcast
} from './spellcasting';

// Rest & Recovery
export type {
	HitDieResult,
	ShortRestResult,
	LongRestResult,
	ShortRestPreview,
	LongRestPreview
} from './rest';

export {
	canShortRest,
	canLongRest,
	shortRest,
	longRest,
	previewShortRest,
	previewLongRest,
	useFeature
} from './rest';

// Inventory, Equipment & Economy
export type {
	EquipResult,
	UnequipResult,
	UseConsumableResult,
	AddItemResult,
	RemoveItemResult,
	GoldTransactionResult,
	AttuneResult,
	EncumbranceInfo
} from './inventory';

export {
	MAX_ATTUNEMENT_SLOTS,
	MAX_EQUIPPED_WEAPONS,
	CARRY_CAPACITY_MULTIPLIER,
	isWeapon,
	isArmor,
	isConsumable,
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
	findItem
} from './inventory';

// Character Progression (Level Up)
export type {
	CanLevelUpResult,
	ASIChoice,
	FeatChoice,
	LevelUpChoices,
	LevelUpResult,
	DerivedStats,
	FeatValidationResult,
	ClassEntry,
	MulticlassInfo,
	MulticlassPrereqResult
} from './leveling';

export {
	MAX_ABILITY_SCORE,
	ASI_POINT_BUDGET,
	MAX_LEVEL,
	canLevelUp,
	xpForLevel,
	awardXP,
	validateASI,
	validateFeatPrerequisites,
	applyFeatEffects,
	getSpellsKnown,
	getMaxPreparedSpells,
	getMaxSpellLevel,
	buildSpellSlots,
	getSpellProgression,
	recalculateDerivedStats,
	applyDerivedStats,
	getNewFeatures,
	applyLevelUp,
	applyMultipleLevelUps,
	checkMulticlassPrereqs,
	computeMulticlassCasterLevel,
	buildMulticlassInfo
} from './leveling';

// Character Creation
export { buildFeatureUses } from './character-creation';

// Travel, Encounters & Environment
export type {
	WeatherType,
	Season,
	TravelResult,
	RandomEncounterResult,
	AvailableExit,
	DiscoverLocationResult
} from './travel';

export {
	TIME_CYCLE,
	PERIODS_PER_DAY,
	WEATHER_TYPES,
	ENCOUNTER_CHANCE,
	TRAVEL_TIME,
	STORM_TRAVEL_MULTIPLIER,
	BIOME_WEATHER,
	LEVEL_TO_ENCOUNTER_TIER,
	getSeason,
	advanceClock,
	advanceClockOnState,
	generateWeather,
	applyWeather,
	getTravelTime,
	findLocation,
	areConnected,
	getAvailableExits,
	getCurrentLocation,
	getEncounterTierForLevel,
	getAveragePartyLevel,
	rollRandomEncounter,
	travelBetween,
	discoverLocation,
	createLocation,
	buildLocationGraph,
	generateLocationName,
	generateLocationDescription
} from './travel';

// Item dimensions & inventory management
export {
	ITEM_SU_TABLE,
	CONTAINER_DEFAULTS,
	getItemSU,
	getEffectiveWU,
	getEffectiveSU,
	getContainerLoad,
	canAddToContainer,
	moveItemToContainer,
	getCharacterTotalWU,
	getEnhancedEncumbranceInfo,
	computeSpaceTaken
} from './item-dimensions';
export type { ContainerDefaults, ContainerLoad, CanAddResult } from './item-dimensions';
