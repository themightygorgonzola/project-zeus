/**
 * Project Zeus — Character Creation Service
 *
 * Pure-logic module for creating and validating player characters.
 * No DB or IO — the caller persists the result.
 */

import { ulid } from 'ulid';
import type {
	AbilityName,
	AbilityScores,
	CharacterCreateInput,
	CharacterFeatureRef,
	ClassLevel,
	ClassName,
	ClassSpellList,
	PlayerCharacter,
	SkillName
} from './types';
import { CLASS_SKILL_OPTIONS } from './types';
import {
	abilityModifier,
	baseAc,
	level1Hp,
	pointBuy,
	proficiencyBonus,
	rollAbilityScores,
	STANDARD_ARRAY
} from './mechanics';
import {
	collectRacialTraits,
	computeRacialBonuses,
	getArmor,
	getBackground,
	getCantripsForClass,
	getCantripsKnown,
	getClass,
	getFeat,
	getFeaturesAtLevel,
	getGear,
	getRace,
	getSpell,
	getSpellsForClass,
	getSpellSlots,
	getSubrace,
	getWeapon
} from './data';

// ---------------------------------------------------------------------------
// Saving throw proficiencies per class (5e PHB)
// ---------------------------------------------------------------------------

const CLASS_SAVE_PROFICIENCIES: Record<ClassName, [AbilityName, AbilityName]> = {
	fighter: ['str', 'con'],
	wizard: ['int', 'wis'],
	rogue: ['dex', 'int'],
	cleric: ['wis', 'cha'],
	ranger: ['str', 'dex'],
	barbarian: ['str', 'con'],
	bard: ['dex', 'cha'],
	paladin: ['wis', 'cha'],
	sorcerer: ['con', 'cha'],
	warlock: ['wis', 'cha'],
	druid: ['int', 'wis'],
	monk: ['str', 'dex']
};

const ALL_ABILITIES: AbilityName[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ALL_SKILLS: SkillName[] = [
	'acrobatics',
	'animal-handling',
	'arcana',
	'athletics',
	'deception',
	'history',
	'insight',
	'intimidation',
	'investigation',
	'medicine',
	'nature',
	'perception',
	'performance',
	'persuasion',
	'religion',
	'sleight-of-hand',
	'stealth',
	'survival'
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
	field: string;
	message: string;
}

/**
 * Validate a character creation input.
 * Returns an empty array if everything is valid.
 */
export function validateCharacterInput(input: CharacterCreateInput): ValidationError[] {
	const errors: ValidationError[] = [];
	const classDef = getClass(input.class);
	const raceDef = getRace(input.race);
	const subraceDef = input.subrace ? getSubrace(input.race, input.subrace) : undefined;
	const backgroundDef = input.background ? getBackground(input.background) : undefined;
	const abilities = previewAbilityScores(input);

	if (!classDef) {
		errors.push({ field: 'class', message: 'Choose a valid class.' });
	}
	if (!raceDef) {
		errors.push({ field: 'race', message: 'Choose a valid race.' });
	}

	if (raceDef?.subraces.length && input.race !== 'human') {
		if (!input.subrace) {
			errors.push({ field: 'subrace', message: `${raceDef.displayName} requires a subrace choice.` });
		} else if (!subraceDef) {
			errors.push({ field: 'subrace', message: 'Choose a valid subrace.' });
		}
	} else if (input.subrace && !subraceDef) {
		errors.push({ field: 'subrace', message: 'Choose a valid subrace.' });
	}

	if (!input.background) {
		errors.push({ field: 'background', message: 'Choose a background.' });
	} else if (!backgroundDef) {
		errors.push({ field: 'background', message: 'Choose a valid background.' });
	}

	if (classDef && classDef.subclassLevel <= 1) {
		if (!input.subclass) {
			errors.push({ field: 'subclass', message: `Choose a ${classDef.subclassLabel.toLowerCase()}.` });
		} else if (input.subclass !== classDef.subclass.name) {
			errors.push({ field: 'subclass', message: 'Choose the supported SRD subclass.' });
		}
	} else if (input.subclass && input.subclass !== classDef?.subclass.name) {
		errors.push({ field: 'subclass', message: 'Choose the supported SRD subclass.' });
	}

	if (!input.name || input.name.trim().length < 2) {
		errors.push({ field: 'name', message: 'Name must be at least 2 characters.' });
	}
	if (input.name && input.name.length > 40) {
		errors.push({ field: 'name', message: 'Name must be 40 characters or fewer.' });
	}

	validateAbilityAssignment(input, errors);
	validateFlexibleBonuses(input, errors);
	validateSkills(input, errors, backgroundDef?.skillProficiencies ?? []);
	validateLanguages(input, errors, backgroundDef?.languageChoices ?? 0);
	validateSpells(input, errors, abilities);
	validateEquipment(input, errors);

	if (input.backstory && input.backstory.length > 2000) {
		errors.push({ field: 'backstory', message: 'Backstory must be 2000 characters or fewer.' });
	}

	return errors;
}

function validateAbilityAssignment(input: CharacterCreateInput, errors: ValidationError[]): void {
	if (!input.abilityAssignment) {
		if (input.statMethod === 'point-buy') {
			errors.push({ field: 'abilityAssignment', message: 'Point-buy requires assigned scores.' });
		}
		return;
	}

	const assigned = Object.values(input.abilityAssignment);
	if (assigned.some((score) => !Number.isFinite(score))) {
		errors.push({ field: 'abilityAssignment', message: 'Ability scores must be numeric.' });
		return;
	}

	if (input.statMethod === 'rolled' && assigned.some((score) => score < 3 || score > 18)) {
		errors.push({ field: 'abilityAssignment', message: 'Rolled scores must be between 3 and 18.' });
	}

	if (input.statMethod === 'standard') {
		const standard = [...STANDARD_ARRAY].sort((a, b) => a - b);
		const values = [...assigned].sort((a, b) => a - b);
		const valid = values.length === standard.length && values.every((value, index) => value === standard[index]);
		if (!valid) {
			errors.push({
				field: 'abilityAssignment',
				message: 'Standard array assignments must use exactly 15, 14, 13, 12, 10, and 8.'
			});
		}
	}

	if (input.statMethod === 'point-buy') {
		const result = pointBuy(input.abilityAssignment);
		if (result.invalidAbilities.length > 0) {
			errors.push({ field: 'abilityAssignment', message: 'Point-buy scores must stay between 8 and 15.' });
		}
		if (result.spent !== 27) {
			errors.push({ field: 'abilityAssignment', message: 'Point-buy must spend exactly 27 points.' });
		}
	}
}

function validateFlexibleBonuses(input: CharacterCreateInput, errors: ValidationError[]): void {
	const abilityChoice = getAbilityChoiceRequirement(input.race, input.subrace);
	const bonusEntries = Object.entries(input.abilityChoiceBonuses ?? {}) as [AbilityName, number][];

	if (abilityChoice.count === 0) {
		if (bonusEntries.length > 0) {
			errors.push({ field: 'abilityChoiceBonuses', message: 'This race does not grant flexible ability bonuses.' });
		}
	} else {
		if (bonusEntries.length !== abilityChoice.count) {
			errors.push({
				field: 'abilityChoiceBonuses',
				message: `Choose exactly ${abilityChoice.count} flexible ability bonuses.`
			});
		}
		if (bonusEntries.some(([, value]) => value !== 1)) {
			errors.push({ field: 'abilityChoiceBonuses', message: 'Flexible racial bonuses must each be +1.' });
		}
		if (bonusEntries.some(([ability]) => abilityChoice.exclude.includes(ability))) {
			errors.push({ field: 'abilityChoiceBonuses', message: 'One or more flexible bonuses target an invalid ability.' });
		}
	}

	const bonusSkillCount = getFlexibleRacialSkillChoiceCount(input.race, input.subrace);
	const bonusSkills = input.bonusSkillChoices ?? [];
	if (bonusSkillCount === 0) {
		if (bonusSkills.length > 0) {
			errors.push({ field: 'bonusSkillChoices', message: 'This race does not grant extra skill picks.' });
		}
	} else {
		if (bonusSkills.length !== bonusSkillCount) {
			errors.push({ field: 'bonusSkillChoices', message: `Choose exactly ${bonusSkillCount} racial bonus skill${bonusSkillCount === 1 ? '' : 's'}.` });
		}
		if (new Set(bonusSkills).size !== bonusSkills.length) {
			errors.push({ field: 'bonusSkillChoices', message: 'Duplicate bonus skill choices are not allowed.' });
		}
		if (bonusSkills.some((skill) => !ALL_SKILLS.includes(skill))) {
			errors.push({ field: 'bonusSkillChoices', message: 'Choose valid skills for racial bonus proficiencies.' });
		}
	}

	if (input.subrace === 'variant-human') {
		if (!input.variantHumanFeat) {
			errors.push({ field: 'variantHumanFeat', message: 'Variant humans must choose a feat.' });
		} else if (!getFeat(input.variantHumanFeat)) {
			errors.push({ field: 'variantHumanFeat', message: 'Choose a valid feat.' });
		}
	}
}

function validateSkills(
	input: CharacterCreateInput,
	errors: ValidationError[],
	backgroundSkills: readonly SkillName[]
): void {
	const classSkills = CLASS_SKILL_OPTIONS[input.class];
	if (!classSkills) return;

	if (input.chosenSkills.length !== classSkills.pick) {
		errors.push({
			field: 'chosenSkills',
			message: `${input.class} must choose exactly ${classSkills.pick} class skills.`
		});
	}

	for (const skill of input.chosenSkills) {
		if (!classSkills.from.includes(skill)) {
			errors.push({ field: 'chosenSkills', message: `${skill} is not a valid class skill choice for ${input.class}.` });
		}
	}

	if (new Set(input.chosenSkills).size !== input.chosenSkills.length) {
		errors.push({ field: 'chosenSkills', message: 'Duplicate class skill choices are not allowed.' });
	}

	const fixedRacialSkills = getFixedRacialSkills(input.race, input.subrace);
	// Only check that player-chosen skills don't overlap with granted skills or each other.
	// Race + background overlap (e.g. half-orc intimidation + soldier intimidation) is legal in 5e.
	const granted = new Set<SkillName>([...backgroundSkills, ...fixedRacialSkills]);
	const playerChosen = [...(input.bonusSkillChoices ?? []), ...input.chosenSkills];
	if (new Set(playerChosen).size !== playerChosen.length || playerChosen.some((s) => granted.has(s))) {
		errors.push({ field: 'chosenSkills', message: 'Your chosen skills must not duplicate each other or skills already granted by your background/race.' });
	}
}

function validateLanguages(
	input: CharacterCreateInput,
	errors: ValidationError[],
	backgroundLanguageChoices: number
): void {
	const requiredLanguages = getExtraLanguageChoiceCount(input.race, input.subrace) + backgroundLanguageChoices;
	const chosenLanguages = input.chosenLanguages ?? [];
	if (requiredLanguages === 0) {
		if (chosenLanguages.length > 0) {
			errors.push({ field: 'chosenLanguages', message: 'No extra language choices are required for this character.' });
		}
		return;
	}

	if (chosenLanguages.length !== requiredLanguages) {
		errors.push({ field: 'chosenLanguages', message: `Choose exactly ${requiredLanguages} extra language${requiredLanguages === 1 ? '' : 's'}.` });
	}

	if (new Set(chosenLanguages.map((language) => language.toLowerCase())).size !== chosenLanguages.length) {
		errors.push({ field: 'chosenLanguages', message: 'Duplicate language choices are not allowed.' });
	}

	const baseLanguages = new Set(
		[
			...(getRace(input.race)?.languages ?? []),
			...(getSubrace(input.race, input.subrace ?? '')?.extraLanguages ?? []),
			...(input.background ? getBackground(input.background)?.languages ?? [] : [])
		].map((language) => language.toLowerCase())
	);
	if (chosenLanguages.some((language) => baseLanguages.has(language.toLowerCase()))) {
		errors.push({ field: 'chosenLanguages', message: 'Choose only languages your character does not already know.' });
	}
}

function validateSpells(
	input: CharacterCreateInput,
	errors: ValidationError[],
	abilities: AbilityScores
): void {
	const classDef = getClass(input.class);
	const spellcasting = classDef?.spellcasting;
	const spellChoices = input.spellChoices ?? {};
	const classCantrips = getCantripsKnown(input.class, 1);
	const flexibleRacialCantrips = getFlexibleRacialCantripChoiceCount(input.race, input.subrace);
	const selectedCantrips = spellChoices.cantrips ?? [];
	const selectedKnownSpells = spellChoices.knownSpells?.length ?? 0;
	const selectedPreparedSpells = spellChoices.preparedSpells?.length ?? 0;

	if (!spellcasting) {
		if (selectedKnownSpells || selectedPreparedSpells) {
			errors.push({ field: 'spellChoices', message: 'This class does not choose spells at level 1.' });
		}
		if (flexibleRacialCantrips === 0 && selectedCantrips.length) {
			errors.push({ field: 'spellChoices', message: 'This class does not choose spells at level 1.' });
			return;
		}
	}

	const classCantripPool = new Set(getCantripsForClass(input.class).map((spell) => spell.name));
	const racialCantripPool = new Set(getFlexibleRacialCantripPool(input.race, input.subrace));
	const combinedCantripPool = new Set([...classCantripPool, ...racialCantripPool]);
	const expectedCantripCount = classCantrips + flexibleRacialCantrips;

	if (expectedCantripCount > 0) {
		if (selectedCantrips.length !== expectedCantripCount) {
			errors.push({ field: 'spellChoices.cantrips', message: `Choose exactly ${expectedCantripCount} cantrip${expectedCantripCount === 1 ? '' : 's'}.` });
		}
		if (new Set(selectedCantrips).size !== selectedCantrips.length) {
			errors.push({ field: 'spellChoices.cantrips', message: 'Duplicate cantrip choices are not allowed.' });
		}
		if (selectedCantrips.some((spell) => !combinedCantripPool.has(normalizeSpellName(spell)))) {
			errors.push({ field: 'spellChoices.cantrips', message: 'One or more chosen cantrips are invalid for this character.' });
		}
	}

	const levelOneSpellPool = getSpellsForClass(input.class, 1)
		.filter((spell) => spell.level === 1)
		.map((spell) => spell.name);
	const pool = new Set(levelOneSpellPool);
	const knownSpells = (spellChoices.knownSpells ?? []).map(normalizeSpellName);
	const preparedSpells = (spellChoices.preparedSpells ?? []).map(normalizeSpellName);

	if (knownSpells.some((spell) => !pool.has(spell))) {
		errors.push({ field: 'spellChoices.knownSpells', message: 'One or more chosen known spells are invalid.' });
	}
	if (preparedSpells.some((spell) => !pool.has(spell))) {
		errors.push({ field: 'spellChoices.preparedSpells', message: 'One or more prepared spells are invalid.' });
	}
	if (new Set(knownSpells).size !== knownSpells.length || new Set(preparedSpells).size !== preparedSpells.length) {
		errors.push({ field: 'spellChoices', message: 'Duplicate spell choices are not allowed.' });
	}

	const firstLevelSlots = getSpellSlots(input.class, 1)[0] ?? 0;
	if (firstLevelSlots <= 0) {
		if (knownSpells.length > 0 || preparedSpells.length > 0) {
			errors.push({ field: 'spellChoices', message: 'This class has no 1st-level spell choices at level 1.' });
		}
		return;
	}

	if (input.class === 'wizard') {
		if (knownSpells.length !== 6) {
			errors.push({ field: 'spellChoices.knownSpells', message: 'Wizards must add exactly 6 1st-level spells to their spellbook.' });
		}
		const preparedAllowance = getPreparedSpellAllowance(input.class, abilities);
		if (preparedSpells.length !== preparedAllowance) {
			errors.push({ field: 'spellChoices.preparedSpells', message: `Wizards must prepare exactly ${preparedAllowance} spell${preparedAllowance === 1 ? '' : 's'}.` });
		}
		if (preparedSpells.some((spell) => !knownSpells.includes(spell))) {
			errors.push({ field: 'spellChoices.preparedSpells', message: 'Prepared wizard spells must come from the chosen spellbook list.' });
		}
		return;
	}

	if (spellcasting?.preparesCasts) {
		const preparedAllowance = getPreparedSpellAllowance(input.class, abilities);
		if (preparedSpells.length !== preparedAllowance) {
			errors.push({ field: 'spellChoices.preparedSpells', message: `Choose exactly ${preparedAllowance} prepared spell${preparedAllowance === 1 ? '' : 's'}.` });
		}
		if (knownSpells.length > 0) {
			errors.push({ field: 'spellChoices.knownSpells', message: 'This class prepares spells and should not submit known spell picks.' });
		}
		return;
	}

	const expectedKnown = classDef?.spellcasting?.spellsKnown[0] ?? 0;
	if (expectedKnown !== knownSpells.length) {
		errors.push({ field: 'spellChoices.knownSpells', message: `Choose exactly ${expectedKnown} known spell${expectedKnown === 1 ? '' : 's'}.` });
	}
	if (preparedSpells.length > 0) {
		errors.push({ field: 'spellChoices.preparedSpells', message: 'This class knows spells and should not submit prepared spell picks.' });
	}
}

function validateEquipment(input: CharacterCreateInput, errors: ValidationError[]): void {
	const classDef = getClass(input.class);
	if (!classDef) return;
	const selections = input.equipmentSelections ?? [];
	if (selections.length > 0 && selections.length !== classDef.equipmentChoices.length) {
		errors.push({ field: 'equipmentSelections', message: 'Choose one option for each class starting equipment row.' });
	}
	selections.forEach((selection, index) => {
		const choice = classDef.equipmentChoices[index];
		if (!choice || selection < 0 || selection >= choice.options.length) {
			errors.push({ field: `equipmentSelections[${index}]`, message: 'One or more starting equipment selections are invalid.' });
		}
	});
}

// ---------------------------------------------------------------------------
// Feature-use map (limited-use features → max uses, recovery)
// ---------------------------------------------------------------------------

/** Known limited-use features and their per-level max use counts / recovery type. */
const FEATURE_USE_DEFS: Record<string, { maxUsesAtLevel: (level: number, chaMod?: number) => number; recoversOn: 'short-rest' | 'long-rest' | 'dawn' }> = {
	'Second Wind':        { maxUsesAtLevel: () => 1, recoversOn: 'short-rest' },
	'Action Surge':       { maxUsesAtLevel: (l) => (l >= 17 ? 2 : 1), recoversOn: 'short-rest' },
	'Indomitable':        { maxUsesAtLevel: (l) => (l >= 17 ? 3 : l >= 13 ? 2 : 1), recoversOn: 'long-rest' },
	'Arcane Recovery':    { maxUsesAtLevel: () => 1, recoversOn: 'short-rest' },
	'Channel Divinity':   { maxUsesAtLevel: (l) => (l >= 18 ? 3 : l >= 6 ? 2 : 1), recoversOn: 'short-rest' },
	'Wild Shape':         { maxUsesAtLevel: () => 2, recoversOn: 'short-rest' },
	'Bardic Inspiration': { maxUsesAtLevel: (_l, chaMod) => Math.max(1, chaMod ?? 0), recoversOn: 'short-rest' },
	'Rage':               { maxUsesAtLevel: (l) => (l >= 20 ? Infinity : l >= 17 ? 6 : l >= 12 ? 5 : l >= 6 ? 4 : l >= 3 ? 3 : 2), recoversOn: 'long-rest' },
	'Lay on Hands':       { maxUsesAtLevel: (l) => l * 5, recoversOn: 'long-rest' },
	'Font of Magic':      { maxUsesAtLevel: (l) => l, recoversOn: 'long-rest' },
	'Sorcery Points':     { maxUsesAtLevel: (l) => l, recoversOn: 'long-rest' },
	'Ki':                 { maxUsesAtLevel: (l) => l, recoversOn: 'short-rest' },
	'Stroke of Luck':     { maxUsesAtLevel: () => 1, recoversOn: 'short-rest' },
	'Sorcerous Restoration': { maxUsesAtLevel: () => 4, recoversOn: 'short-rest' },
	'Signature Spells':   { maxUsesAtLevel: () => 1, recoversOn: 'short-rest' },
	'Relentless Endurance': { maxUsesAtLevel: () => 1, recoversOn: 'long-rest' }
};

/**
 * Build the runtime `featureUses` record from the character's class features.
 */
export function buildFeatureUses(
	classFeatures: { name: string }[],
	level: number,
	abilities?: { cha?: number }
): PlayerCharacter['featureUses'] {
	const chaMod = abilities ? abilityModifier(abilities.cha ?? 10) : 0;
	const result: PlayerCharacter['featureUses'] = {};
	for (const feat of classFeatures) {
		const def = FEATURE_USE_DEFS[feat.name];
		if (def) {
			const max = def.maxUsesAtLevel(level, chaMod);
			result[feat.name] = { current: max, max, recoversOn: def.recoversOn };
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Character Creation
// ---------------------------------------------------------------------------

/**
 * Create a new PlayerCharacter from validated input.
 */
export function createCharacter(
	input: CharacterCreateInput,
	userId: string,
	adventureId: string
): PlayerCharacter {
	const level = 1;
	const classDef = getClass(input.class);
	const raceDef = getRace(input.race);
	const subraceDef = input.subrace ? getSubrace(input.race, input.subrace) : undefined;
	const backgroundDef = input.background ? getBackground(input.background) : undefined;

	const baseAbilities = resolveBaseAbilities(input);
	const abilities = applyRacialBonuses(baseAbilities, input);
	const inventory = resolveStartingEquipment(input, backgroundDef?.equipment ?? []);
	const profBonus = proficiencyBonus(level);
	const maxHp = level1Hp(input.class, abilities.con) + getPerLevelHpBonus(input.race, input.subrace, level);
	const saveProficiencies = [...(CLASS_SAVE_PROFICIENCIES[input.class] ?? ['str', 'con'])];
	const skillProficiencies = Array.from(
		new Set([
			...(backgroundDef?.skillProficiencies ?? []),
			...getFixedRacialSkills(input.race, input.subrace),
			...(input.bonusSkillChoices ?? []),
			...input.chosenSkills
		])
	);
	const speed = raceDef ? raceDef.speed + getSpeedBonus(input.race, input.subrace) : 30;
	const languages = Array.from(
		new Set([
			...(raceDef?.languages ?? ['Common']),
			...(subraceDef?.extraLanguages ?? []),
			...(backgroundDef?.languages ?? []),
			...(input.chosenLanguages ?? [])
		])
	);
	const classFeatures = buildFeatureList(input, level, backgroundDef?.feature);
	const spellSlots = getSpellSlots(input.class, level)
		.map((max, index) => ({ level: index + 1, current: max, max }))
		.filter((slot) => slot.max > 0);
	const spellcastingAbility = classDef?.spellcasting?.ability;
	const cantrips = resolveCantrips(input);
	const knownSpells = resolveKnownSpells(input);
	const preparedSpells = resolvePreparedSpells(input);
	const passivePerception = 10 + abilityModifier(abilities.wis) + (skillProficiencies.includes('perception') ? profBonus : 0);

	// Build multiclass structures
	const subclass = classDef && classDef.subclassLevel <= level ? (input.subclass ?? classDef.subclass.name) : undefined;
	const classes = input.importClasses && input.importClasses.length > 0
		? input.importClasses.map((c) => ({ ...c }))
		: [{ name: input.class, level, subclass, hitDiceRemaining: level }];
	const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);

	// When importing multiclass, build features from each class at their class level
	const importedClassFeatures = (input.importClasses && input.importClasses.length > 0)
		? buildImportedClassFeatures(input.importClasses)
		: [];

	// Merge imported features with primary class features (race/background come from primary)
	const allClassFeatures = importedClassFeatures.length > 0
		? [...classFeatures.filter((f) => f.source === 'race' || f.source === 'background'), ...importedClassFeatures]
		: classFeatures;

	// Build class spell lists
	const classSpells = buildImportedClassSpells(classes, input, spellcastingAbility, cantrips, knownSpells, preparedSpells);
	const pactSlots = classDef?.spellcasting?.style === 'pact'
		? spellSlots.map((s) => ({ ...s }))  // For warlock, initial slots go into pactSlots
		: [];
	const standardSlots = classDef?.spellcasting?.style === 'pact'
		? []  // Warlock doesn't use standard slots at level 1
		: spellSlots;

	return {
		id: ulid(),
		userId,
		adventureId,
		name: input.name.trim(),
		race: input.race,
		classes,
		subrace: input.subrace,
		background: backgroundDef?.name,
		alignment: input.alignment,
		level: totalLevel,
		abilities,
		hp: maxHp,
		maxHp,
		tempHp: 0,
		ac: computeStartingAc(input.class, abilities, inventory),
		speed,
		size: raceDef?.size ?? 'Medium',
		proficiencyBonus: profBonus,
		skillProficiencies,
		expertiseSkills: [],
		saveProficiencies,
		languages,
		armorProficiencies: Array.from(
			new Set([
				...(classDef?.armorProficiencies ?? []),
				...(raceDef?.armorProficiencies ?? []),
				...(subraceDef?.armorProficiencies ?? [])
			])
		),
		weaponProficiencies: Array.from(
			new Set([
				...(classDef?.weaponProficiencies.map(String) ?? []),
				...(raceDef?.weaponProficiencies ?? []),
				...(subraceDef?.weaponProficiencies ?? [])
			])
		),
		toolProficiencies: Array.from(
			new Set([
				...(classDef?.toolProficiencies ?? []),
				...(raceDef?.toolProficiencies ?? []),
				...(subraceDef?.toolProficiencies ?? []),
				...(raceDef?.toolChoice ? [raceDef.toolChoice[0]] : []),
				...(backgroundDef?.toolProficiencies ?? [])
			])
		),
		classFeatures: allClassFeatures,
		feats: input.variantHumanFeat ? [normalizeFeatName(input.variantHumanFeat)] : [],
		spellSlots: standardSlots,
		pactSlots,
		classSpells,
		concentratingOn: null,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		passivePerception,
		inventory,
		gold: 15,
		xp: 0,
		conditions: [],
		resistances: getRacialResistances(input.race, input.subrace),
		exhaustionLevel: 0,
		stable: false,
		dead: false,
		featureUses: buildFeatureUses(allClassFeatures, totalLevel, abilities),
		attunedItems: [],
		backstory: input.backstory?.trim() ?? ''
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLASS_PRIMARY_ABILITY: Record<ClassName, AbilityName[]> = {
	fighter: ['str', 'con', 'dex'],
	wizard: ['int', 'con', 'dex'],
	rogue: ['dex', 'int', 'con'],
	cleric: ['wis', 'con', 'str'],
	ranger: ['dex', 'wis', 'con'],
	barbarian: ['str', 'con', 'dex'],
	bard: ['cha', 'dex', 'con'],
	paladin: ['str', 'cha', 'con'],
	sorcerer: ['cha', 'con', 'dex'],
	warlock: ['cha', 'con', 'dex'],
	druid: ['wis', 'con', 'dex'],
	monk: ['dex', 'wis', 'con']
};

function previewAbilityScores(input: CharacterCreateInput): AbilityScores {
	return applyRacialBonuses(resolveBaseAbilities(input), input);
}

function resolveBaseAbilities(input: CharacterCreateInput): AbilityScores {
	if (input.abilityAssignment) {
		return { ...input.abilityAssignment };
	}
	if (input.statMethod === 'standard' || input.statMethod === 'point-buy') {
		return defaultStandardAssignment(input.class);
	}
	return assignRolledScores(rollAbilityScores(), input.class);
}

function applyRacialBonuses(baseAbilities: AbilityScores, input: CharacterCreateInput): AbilityScores {
	const racialBonuses = computeRacialBonuses(input.race, input.subrace);
	const flexibleBonuses = input.abilityChoiceBonuses ?? {};
	return {
		str: baseAbilities.str + (racialBonuses.str ?? 0) + (flexibleBonuses.str ?? 0),
		dex: baseAbilities.dex + (racialBonuses.dex ?? 0) + (flexibleBonuses.dex ?? 0),
		con: baseAbilities.con + (racialBonuses.con ?? 0) + (flexibleBonuses.con ?? 0),
		int: baseAbilities.int + (racialBonuses.int ?? 0) + (flexibleBonuses.int ?? 0),
		wis: baseAbilities.wis + (racialBonuses.wis ?? 0) + (flexibleBonuses.wis ?? 0),
		cha: baseAbilities.cha + (racialBonuses.cha ?? 0) + (flexibleBonuses.cha ?? 0)
	};
}

function defaultStandardAssignment(className: ClassName): AbilityScores {
	return assignRolledScores([...STANDARD_ARRAY], className);
}

function assignRolledScores(values: number[], className: ClassName): AbilityScores {
	const sorted = [...values].sort((a, b) => b - a);
	const priority = CLASS_PRIMARY_ABILITY[className] ?? ['str', 'dex', 'con', 'int', 'wis', 'cha'];
	const remaining = ALL_ABILITIES.filter((ability) => !priority.includes(ability));
	const order = [...priority, ...remaining].slice(0, 6);
	const scores: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

	for (let index = 0; index < order.length && index < sorted.length; index += 1) {
		scores[order[index]] = sorted[index];
	}

	return scores;
}

function getAbilityChoiceRequirement(raceName: CharacterCreateInput['race'], subraceName?: string) {
	const traits = collectRacialTraits(raceName, subraceName);
	for (const trait of traits) {
		for (const effect of trait.effects) {
			if (effect.tag === 'ability-choice') {
				return { count: effect.count, exclude: effect.exclude ?? [] };
			}
		}
	}
	return { count: 0, exclude: [] as AbilityName[] };
}

function getFlexibleRacialSkillChoiceCount(raceName: CharacterCreateInput['race'], subraceName?: string): number {
	if (raceName === 'half-elf') return 2;
	if (subraceName === 'variant-human') return 1;
	return 0;
}

function getFixedRacialSkills(raceName: CharacterCreateInput['race'], subraceName?: string): SkillName[] {
	const skills: SkillName[] = [];
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'skill-proficiency') {
				if (raceName === 'half-elf') continue;
				if (subraceName === 'variant-human') continue;
				skills.push(effect.skill);
			}
		}
	}
	return Array.from(new Set(skills));
}

function getExtraLanguageChoiceCount(raceName: CharacterCreateInput['race'], subraceName?: string): number {
	let total = 0;
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'extra-language') {
				total += effect.count;
			}
		}
	}
	return total;
}

function getFlexibleRacialCantripChoiceCount(raceName: CharacterCreateInput['race'], subraceName?: string): number {
	return getFlexibleRacialCantripPool(raceName, subraceName).length > 0 ? 1 : 0;
}

function getFlexibleRacialCantripPool(raceName: CharacterCreateInput['race'], subraceName?: string): string[] {
	const pool: string[] = [];
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'extra-cantrip' && effect.cantrip === 'any-wizard') {
				pool.push(...getCantripsForClass('wizard').map((spell) => spell.name));
			}
		}
	}
	return Array.from(new Set(pool));
}

function getFixedRacialCantrips(raceName: CharacterCreateInput['race'], subraceName?: string): string[] {
	const cantrips: string[] = [];
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'cantrip') {
				cantrips.push(effect.cantrip);
			}
		}
	}
	return Array.from(new Set(cantrips));
}

function getPerLevelHpBonus(raceName: CharacterCreateInput['race'], subraceName: string | undefined, level: number): number {
	let bonus = 0;
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'hp-bonus-per-level') {
				bonus += effect.bonus * level;
			}
		}
	}
	return bonus;
}

function getSpeedBonus(raceName: CharacterCreateInput['race'], subraceName?: string): number {
	let bonus = 0;
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'speed-bonus') {
				bonus += effect.bonus;
			}
		}
	}
	return bonus;
}

/**
 * Extract racial damage resistances from race/subrace traits.
 * E.g., Tiefling → ['fire'], Dwarf → ['poison'], Dragonborn → varies by ancestry.
 */
function getRacialResistances(raceName: CharacterCreateInput['race'], subraceName?: string): string[] {
	const resistances: string[] = [];
	for (const trait of collectRacialTraits(raceName, subraceName)) {
		for (const effect of trait.effects) {
			if (effect.tag === 'resistance') {
				resistances.push(effect.damageType);
			}
		}
	}
	return Array.from(new Set(resistances));
}

function getPreparedSpellAllowance(className: ClassName, abilities: AbilityScores): number {
	const classDef = getClass(className);
	const ability = classDef?.spellcasting?.ability;
	if (!ability) return 0;
	return Math.max(1, 1 + abilityModifier(abilities[ability]));
}

function resolveCantrips(input: CharacterCreateInput): string[] {
	return Array.from(new Set([...(input.spellChoices?.cantrips ?? []).map(normalizeSpellName), ...getFixedRacialCantrips(input.race, input.subrace)]));
}

function resolveKnownSpells(input: CharacterCreateInput): string[] {
	return Array.from(new Set((input.spellChoices?.knownSpells ?? []).map(normalizeSpellName)));
}

function resolvePreparedSpells(input: CharacterCreateInput): string[] {
	return Array.from(new Set((input.spellChoices?.preparedSpells ?? []).map(normalizeSpellName)));
}

function buildFeatureList(
	input: CharacterCreateInput,
	level: number,
	backgroundFeature?: { name: string; description: string }
) {
	const classDef = getClass(input.class);
	const includeSubclass = (classDef?.subclassLevel ?? 99) <= level;
	const features = getFeaturesAtLevel(input.class, level, includeSubclass).map((feature) => ({
		name: feature.name,
		level: feature.level,
		source: feature.level >= (classDef?.subclassLevel ?? 99) && includeSubclass ? 'subclass' as const : 'class' as const,
		sourceClass: input.class,
		description: feature.description
	}));
	const racialFeatures = collectRacialTraits(input.race, input.subrace).map((trait) => ({
		name: trait.name,
		level: 1,
		source: 'race' as const,
		description: trait.description
	}));
	const backgroundFeatures = backgroundFeature
		? [{ name: backgroundFeature.name, level: 1, source: 'background' as const, description: backgroundFeature.description }]
		: [];

	return [...racialFeatures, ...backgroundFeatures, ...features];
}

/**
 * Build class/subclass features for all imported classes at their respective levels.
 * Used when creating a character from an imported multiclass sheet.
 */
function buildImportedClassFeatures(
	importClasses: ClassLevel[]
): CharacterFeatureRef[] {
	const allFeatures: CharacterFeatureRef[] = [];
	for (const cl of importClasses) {
		const cDef = getClass(cl.name);
		const includeSubclass = (cDef?.subclassLevel ?? 99) <= cl.level;
		const features = getFeaturesAtLevel(cl.name, cl.level, includeSubclass);
		for (const feature of features) {
			allFeatures.push({
				name: feature.name,
				level: feature.level,
				source: feature.level >= (cDef?.subclassLevel ?? 99) && includeSubclass ? 'subclass' as const : 'class' as const,
				sourceClass: cl.name,
				description: feature.description
			});
		}
	}
	return allFeatures;
}

/**
 * Build classSpells entries for all caster classes.
 * For a standard (non-import) creation, returns a single entry for the primary class.
 * For imported multiclass, returns an entry per caster class.
 */
function buildImportedClassSpells(
	classes: ClassLevel[],
	input: CharacterCreateInput,
	primarySpellcastingAbility: AbilityName | undefined,
	cantrips: string[],
	knownSpells: string[],
	preparedSpells: string[]
): ClassSpellList[] {
	if (input.importClasses && input.importClasses.length > 0) {
		// Imported multiclass: build spell entry per caster class
		const result: ClassSpellList[] = [];
		for (const cl of classes) {
			const cDef = getClass(cl.name);
			if (cDef?.spellcasting?.ability) {
				// For import, primary class gets the creation-input spells; others start empty
				if (cl.name === input.class) {
					result.push({
						className: cl.name,
						spellcastingAbility: cDef.spellcasting.ability,
						cantrips,
						knownSpells,
						preparedSpells
					});
				} else {
					result.push({
						className: cl.name,
						spellcastingAbility: cDef.spellcasting.ability,
						cantrips: [],
						knownSpells: [],
						preparedSpells: []
					});
				}
			}
		}
		return result;
	}
	// Standard single-class creation
	return primarySpellcastingAbility
		? [{ className: input.class, spellcastingAbility: primarySpellcastingAbility, cantrips, knownSpells, preparedSpells }]
		: [];
}

function normalizeSpellName(name: string): string {
	return getSpell(name)?.name ?? name.trim().toLowerCase().replace(/[’']/g, '').replace(/\s+/g, '-');
}

function normalizeFeatName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function resolveStartingEquipment(input: CharacterCreateInput, backgroundEquipment: string[]): PlayerCharacter['inventory'] {
	const classDef = getClass(input.class);
	const selectedRows = (classDef?.equipmentChoices ?? []).map((choice, index) => {
		const selectedIndex = input.equipmentSelections?.[index] ?? 0;
		return choice.options[selectedIndex] ?? choice.options[0] ?? [];
	});
	const labels = [...selectedRows.flat(), ...backgroundEquipment];
	const items = labels.map((label, index) => itemFromLabel(label, index === 0));
	return items;
}

function itemFromLabel(label: string, equipPrimary = false): PlayerCharacter['inventory'][number] {
	const { baseName, quantity } = parseItemLabel(label);

	// Resolve generic placeholder labels to a canonical weapon name.
	// "Martial Weapon" → longsword, "Simple Weapon" → handaxe.
	const GENERIC_WEAPON_FALLBACK: Record<string, string> = {
		'martial weapon': 'longsword',
		'two martial weapons': 'longsword',
		'simple weapon': 'handaxe',
		'simple melee weapon': 'handaxe',
		'simple ranged weapon': 'light crossbow',
	};
	const resolvedBaseName = GENERIC_WEAPON_FALLBACK[baseName.toLowerCase()] ?? baseName;
	const weapon = getWeapon(resolvedBaseName);
	if (weapon) {
		return {
			id: ulid(),
			name: weapon.displayName,
			category: 'weapon',
			weaponName: weapon.name,
			description: weapon.notes ?? `A ${weapon.displayName.toLowerCase()}.`,
			damage: weapon.damage,
			damageType: weapon.damageType,
			magicBonus: 0,
			properties: [...weapon.properties],
			range: weapon.range,
			equipped: equipPrimary,
			specialProperties: weapon.notes ? [weapon.notes] : [],
			value: parseCurrencyValue(weapon.cost),
			quantity,
			weight: weapon.weight,
			rarity: 'common',
			attunement: false
		};
	}

	const armor = getArmor(baseName);
	if (armor) {
		return {
			id: ulid(),
			name: armor.displayName,
			category: 'armor',
			armorName: armor.name,
			description: `A set of ${armor.displayName.toLowerCase()}.`,
			baseAC: armor.baseAC,
			magicBonus: 0,
			equipped: true,
			maxDexBonus: armor.maxDexBonus,
			stealthDisadvantage: armor.stealthDisadvantage,
			value: parseCurrencyValue(armor.cost),
			quantity,
			weight: armor.weight,
			rarity: 'common',
			attunement: false
		};
	}

	const gear = getGear(baseName);
	if (gear) {
		return {
			id: ulid(),
			name: gear.displayName,
			category: 'misc',
			description: gear.description,
			notes: gear.description,
			tags: [gear.category],
			value: parseCurrencyValue(gear.cost),
			quantity,
			weight: gear.weight,
			rarity: 'common',
			attunement: false
		};
	}

	return {
		id: ulid(),
		name: label,
		category: 'misc',
		description: `Starting equipment: ${label}.`,
		notes: undefined,
		tags: ['starting-equipment'],
		value: 0,
		quantity,
		weight: 0,
		rarity: 'common',
		attunement: false
	};
}

function parseItemLabel(label: string): { baseName: string; quantity: number } {
	const trimmed = label.trim();
	const match = trimmed.match(/^(.*)\((\d+)\)$/);
	if (match) {
		const name = match[1].trim().replace(/[’']/g, "'");
		const quantity = Number(match[2]);
		if (!Number.isNaN(quantity)) {
			return { baseName: name, quantity };
		}
	}
	return { baseName: trimmed, quantity: 1 };
}

function parseCurrencyValue(cost: string | undefined): number {
	if (!cost) return 0;
	const match = cost.trim().match(/([0-9.]+)\s*(cp|sp|ep|gp|pp)/i);
	if (!match) return 0;
	const amount = Number(match[1]);
	switch (match[2].toLowerCase()) {
		case 'cp': return amount / 100;
		case 'sp': return amount / 10;
		case 'ep': return amount / 2;
		case 'gp': return amount;
		case 'pp': return amount * 10;
		default: return amount;
	}
}

function computeStartingAc(
	className: ClassName,
	abilities: AbilityScores,
	inventory: PlayerCharacter['inventory']
): number {
	const dexMod = abilityModifier(abilities.dex);
	const equippedArmor = inventory
		.filter(
			(item): item is Extract<PlayerCharacter['inventory'][number], { category: 'armor' }> =>
				item.category === 'armor' && item.equipped
		)
		.sort((a, b) => b.baseAC - a.baseAC);
	const shield = equippedArmor.find((item) => item.armorName === 'shield');
	const armor = equippedArmor.find((item) => item.armorName !== 'shield');

	if (armor) {
		const dexContribution = armor.maxDexBonus == null ? dexMod : Math.min(dexMod, armor.maxDexBonus);
		return armor.baseAC + (armor.armorName === 'chain-mail' || armor.armorName === 'ring-mail' ? 0 : dexContribution) + (shield?.baseAC ?? 0);
	}

	if (className === 'barbarian') {
		return 10 + dexMod + abilityModifier(abilities.con) + (shield?.baseAC ?? 0);
	}
	if (className === 'monk') {
		return 10 + dexMod + abilityModifier(abilities.wis);
	}
	return baseAc(abilities.dex) + (shield?.baseAC ?? 0);
}
