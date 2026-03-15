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
	ClassName,
	Combatant,
	CombatantType,
	Condition,
	ConditionEffect,
	ConditionEffectMap,
	ConsumableItem,
	CreatureAction,
	CreatureAttack,
	CreatureSavingThrow,
	CreatureSkillBonus,
	CreatureStatBlock,
	CreatureTrait,
	DeathSaves,
	DiceResult,
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
	SKILL_ABILITY_MAP
} from './types';

// Mechanics
export {
	roll,
	rollDie,
	rollDice,
	rollAbilityScores,
	abilityModifier,
	proficiencyBonus,
	skillCheck,
	abilityCheck,
	savingThrow,
	attackRoll,
	applyDamage,
	applyHealing,
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
