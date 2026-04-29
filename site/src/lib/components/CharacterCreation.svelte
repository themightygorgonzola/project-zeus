<script lang="ts">
	import { onMount } from 'svelte';
	import { abilityModifier, computeRacialBonuses, pointBuy, STANDARD_ARRAY } from '$lib/game';
	import type {
		AbilityName,
		AbilityScores,
		CharacterCreateInput,
		PlayerCharacter,
		SkillName
	} from '$lib/game';
	import {
		BACKGROUNDS,
		CLASSES,
		FEATS,
		collectRacialTraits,
		getBackground,
		getCantripsForClass,
		getClass,
		getRace,
		getSpellsForClass,
		getSubrace,
		RACES
	} from '$lib/game';
	import type { WeaponDefinition, ArmorDefinition, GearDefinition } from '$lib/game';
	import { WEAPONS, INSTRUMENTS, getArmor, getGear, getWeapon } from '$lib/game';
	import type { BackgroundChoiceOption } from '$lib/game/data/backgrounds';
	import { validateCharacterInput } from '$lib/game/character-creation';

	interface Props {
		adventureId: string;
		onCreated?: (character: PlayerCharacter) => void;
		worldCities?: string[];
	}

	const abilityOrder: AbilityName[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
	const abilityLabels: Record<AbilityName, string> = {
		str: 'STR',
		dex: 'DEX',
		con: 'CON',
		int: 'INT',
		wis: 'WIS',
		cha: 'CHA'
	};
	const allSkills: SkillName[] = [
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
	const allLanguages: string[] = [
		'Common',
		'Dwarvish',
		'Elvish',
		'Giant',
		'Gnomish',
		'Goblin',
		'Halfling',
		'Orc',
		'Abyssal',
		'Celestial',
		'Draconic',
		'Deep Speech',
		'Infernal',
		'Primordial',
		'Sylvan',
		'Undercommon'
	];
	const alignments = [
		{ value: 'lawful-good', label: 'Lawful Good' },
		{ value: 'neutral-good', label: 'Neutral Good' },
		{ value: 'chaotic-good', label: 'Chaotic Good' },
		{ value: 'lawful-neutral', label: 'Lawful Neutral' },
		{ value: 'true-neutral', label: 'True Neutral' },
		{ value: 'chaotic-neutral', label: 'Chaotic Neutral' },
		{ value: 'lawful-evil', label: 'Lawful Evil' },
		{ value: 'neutral-evil', label: 'Neutral Evil' },
		{ value: 'chaotic-evil', label: 'Chaotic Evil' }
	] as const;
	const steps = [
		{ id: 'ancestry', label: 'Ancestry' },
		{ id: 'calling', label: 'Class' },
		{ id: 'background', label: 'Background' },
		{ id: 'abilities', label: 'Abilities' },
		{ id: 'skills', label: 'Skills' },
		{ id: 'loadout', label: 'Magic & Gear' },
		{ id: 'identity', label: 'Identity' }
	] as const;

	let { adventureId, onCreated = () => {}, worldCities = [] }: Props = $props();
	let isOpen = $state(true);
	let currentStep = $state(0);
	let submitting = $state(false);
	let submitError = $state('');
	let errors = $state<Record<string, string[]>>({});
	let rolledSeed = $state(0);
	let savedStandard = $state<Partial<Record<AbilityName, number>>>({});
	let savedPointBuy = $state<AbilityScores>({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
	let savedRolled   = $state<AbilityScores>({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
	let rolledDice    = $state<Record<AbilityName, number[]>>({ str: [], dex: [], con: [], int: [], wis: [], cha: [] });
	type StandardDragSrc = { value: number; from: 'pool' } | { value: number; from: 'slot'; ability: AbilityName };
	let standardSlots  = $state<Partial<Record<AbilityName, number>>>({});
	let dragSource     = $state<StandardDragSrc | null>(null);
	let dragOverTarget = $state<AbilityName | 'pool' | null>(null);

	let form = $state<CharacterCreateInput>({
		name: '',
		race: 'human',
		subrace: undefined,
		class: 'fighter',
		subclass: undefined,
		background: 'soldier',
		alignment: 'neutral-good',
		statMethod: 'standard',
		abilityAssignment: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
		abilityChoiceBonuses: {},
		bonusSkillChoices: [],
		chosenLanguages: [],
		chosenSkills: [],
		spellChoices: { cantrips: [], knownSpells: [], preparedSpells: [] },
		equipmentSelections: [],
		equipmentSubSelections: {},
		variantHumanFeat: undefined,
		backgroundEquipmentChoices: {},
		expertiseChoices: [],
		backstory: ''
	});

	let raceDef = $derived(getRace(form.race));
	let subraceDef = $derived(form.subrace ? getSubrace(form.race, form.subrace) : undefined);
	let effectiveDarkvision = $derived(
		(subraceDef?.traits.flatMap(t => t.effects).find(e => e.tag === 'darkvision') as { tag: 'darkvision'; range: number } | undefined)?.range
		?? raceDef?.darkvision
		?? 0
	);
	let classDef = $derived(getClass(form.class));
	let backgroundDef = $derived(form.background ? getBackground(form.background) : undefined);
	let raceTraits = $derived(collectRacialTraits(form.race, form.subrace));
	let racialBonuses = $derived(computeRacialBonuses(form.race, form.subrace));
	let fixedRacialSkills = $derived(getFixedRacialSkills());
	let backgroundSkills = $derived((backgroundDef?.skillProficiencies ?? []) as SkillName[]);
	let classSkillOptions = $derived((classDef?.skillOptions ?? []) as SkillName[]);
	let classSkillPickCount = $derived(classDef?.skillPickCount ?? 0);
	let bonusSkillChoicesRequired = $derived(getBonusSkillChoicesRequired());
	let flexibleAbilityChoices = $derived(getFlexibleAbilityChoices());
	let flexibleCantripChoices = $derived(getFlexibleCantripChoices());
	let classCantripChoices = $derived(classDef ? getCantripsForClass(form.class).map((spell) => spell.name) : []);
	let cantripChoices = $derived(Array.from(new Set([...classCantripChoices, ...flexibleCantripChoices])));
	let expectedCantripCount = $derived((classDef?.spellcasting?.cantripsKnown[0] ?? 0) + (flexibleCantripChoices.length > 0 ? 1 : 0));
	let knownSpellChoices = $derived(getSpellsForClass(form.class, 1).filter((spell) => spell.level === 1).map((spell) => spell.name));
	let firstLevelSlotCount = $derived(classDef?.spellcasting?.slotsPerLevel[0]?.[0] ?? 0);
	let knownSpellCount = $derived(
		firstLevelSlotCount > 0
			? (classDef?.spellcasting?.preparesCasts ? (form.class === 'wizard' ? 6 : 0) : (classDef?.spellcasting?.spellsKnown[0] ?? 0))
			: 0
	);
	let previewAbilities = $derived(buildPreviewAbilities());
	let preparedSpellCount = $derived(
		firstLevelSlotCount > 0 && classDef?.spellcasting?.preparesCasts
			? Math.max(1, 1 + abilityModifier(previewAbilities[classDef.spellcasting.ability]))
			: 0
	);
	let pointBuySummary = $derived(form.abilityAssignment ? pointBuy(form.abilityAssignment) : { spent: 0, remaining: 27, valid: false, invalidAbilities: [] });
	let expertiseCount = $derived(
		classDef?.features.some((f) => f.level === 1 && f.tags.includes('expertise')) ? 2 : 0
	);
	let expertisePool = $derived(
		Array.from(new Set([...backgroundSkills, ...fixedRacialSkills, ...(form.bonusSkillChoices ?? []), ...form.chosenSkills])) as SkillName[]
	);
	let standardPool = $derived.by(() => {
		const used = new Set(Object.values(standardSlots).filter((v): v is number => v !== undefined));
		return STANDARD_ARRAY.filter(v => !used.has(v));
	});
	let extraLanguageChoices = $derived(countExtraLanguageChoices());
	let baseLanguages = $derived([
		...(raceDef?.languages ?? []),
		...(subraceDef?.extraLanguages ?? []),
		...(backgroundDef?.languages ?? [])
	] as string[]);
	let availableLanguageChoices = $derived(allLanguages.filter((language) => !baseLanguages.includes(language)));
	let classSkillChoicesAvailable = $derived(
		classSkillOptions.filter((skill) => !backgroundSkills.includes(skill) && !fixedRacialSkills.includes(skill) && !((form.bonusSkillChoices ?? []) as SkillName[]).includes(skill))
	);
	let bonusSkillChoicesAvailable = $derived(
		allSkills.filter((skill) => !backgroundSkills.includes(skill) && !fixedRacialSkills.includes(skill) && !form.chosenSkills.includes(skill))
	);
	let currentStepErrors = $derived(getStepErrors(currentStep));

	// ── Background equipment choice helpers ──────────────────────────────
	/** Overrides for choice option lists populated at runtime (e.g. Urchin city from world). */
	let bgChoiceOptions = $derived.by(() => {
		const map: Record<string, BackgroundChoiceOption[]> = {};
		if (backgroundDef?.equipmentChoices && worldCities.length > 0) {
			for (const c of backgroundDef.equipmentChoices) {
				if (c.id === 'cityOfOrigin') {
					map[c.id] = worldCities.map((name) => ({ label: name, items: [] }));
				}
			}
		}
		return map;
	});

	onMount(() => {
		initializeDefaults();
	});

	$effect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});

	function initializeDefaults() {
		syncRaceState(form.race, form.subrace);
		syncClassState(form.class);
		syncBackgroundState(form.background);
		syncLanguageState();
		syncSkillState();
		syncSpellState();
		syncEquipmentState();
	}

	function buildPreviewAbilities(): AbilityScores {
		const base = form.abilityAssignment ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		const racial = computeRacialBonuses(form.race, form.subrace);
		const flexible = form.abilityChoiceBonuses ?? {};
		return {
			str: base.str + (racial.str ?? 0) + (flexible.str ?? 0),
			dex: base.dex + (racial.dex ?? 0) + (flexible.dex ?? 0),
			con: base.con + (racial.con ?? 0) + (flexible.con ?? 0),
			int: base.int + (racial.int ?? 0) + (flexible.int ?? 0),
			wis: base.wis + (racial.wis ?? 0) + (flexible.wis ?? 0),
			cha: base.cha + (racial.cha ?? 0) + (flexible.cha ?? 0)
		};
	}

	function getFixedRacialSkills(): SkillName[] {
		const skills: SkillName[] = [];
		for (const trait of raceTraits) {
			for (const effect of trait.effects) {
				if (effect.tag === 'skill-proficiency') {
					if (form.race === 'half-elf') continue;
					if (form.subrace === 'variant-human') continue;
					skills.push(effect.skill);
				}
			}
		}
		return unique(skills);
	}

	function countExtraLanguageChoices(): number {
		let total = backgroundDef?.languageChoices ?? 0;
		for (const trait of raceTraits) {
			for (const effect of trait.effects) {
				if (effect.tag === 'extra-language') {
					total += effect.count;
				}
			}
		}
		return total;
	}

	function getBonusSkillChoicesRequired(): number {
		if (form.race === 'half-elf') return 2;
		if (form.subrace === 'variant-human') return 1;
		return 0;
	}

	function getFlexibleAbilityChoices(): AbilityName[] {
		if (form.race === 'half-elf') {
			return abilityOrder.filter((ability) => ability !== 'cha');
		}
		if (form.subrace === 'variant-human') {
			return abilityOrder;
		}
		return [];
	}

	function getFlexibleCantripChoices(): string[] {
		for (const trait of raceTraits) {
			for (const effect of trait.effects) {
				if (effect.tag === 'extra-cantrip' && effect.cantrip === 'any-wizard') {
					return getCantripsForClass('wizard').map((spell) => spell.name);
				}
			}
		}
		return [];
	}

	function unique<T>(values: T[]): T[] {
		return Array.from(new Set(values));
	}

	function formatLabel(value: string | undefined): string {
		if (!value) return '—';
		return value
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	const BOON_LABELS: Record<string, string> = {
		'vehicles-land':      'Land Vehicles',
		'vehicles-water':     'Water Vessels',
		'navigator-tools':    "Navigator's Tools",
		'thieves-tools':      "Thieves' Tools",
		'herbalism-kit':      'Herbalism Kit',
		'artisan-tools':      "Artisan's Tools",
		'forgery-kit':        'Forgery Kit',
		'disguise-kit':       'Disguise Kit',
		'gaming-set':         'Gaming Set (of choice)',
		'musical-instrument': 'Musical Instrument (of choice)',
	};
	function formatBoon(value: string): string {
		return BOON_LABELS[value] ?? formatLabel(value);
	}

	function sortEquipment(items: string[]): string[] {
		const clothing = items.find(e => /\bclothes\b|\bvestments\b|\bcostume\b|\brobes?\b|\bapparel\b/i.test(e));
		const pouch    = items.find(e => /\bpouch\b|\bpurse\b/i.test(e));
		const rest     = items.filter(e => e !== clothing && e !== pouch);
		return [...(clothing ? [clothing] : []), ...(pouch ? [pouch] : []), ...rest];
	}

	function setBgChoice(id: string, value: string) {
		form.backgroundEquipmentChoices = { ...(form.backgroundEquipmentChoices ?? {}), [id]: value };
	}

	function bgChoice(id: string): string {
		return form.backgroundEquipmentChoices?.[id] ?? '';
	}

	function setRace(race: CharacterCreateInput['race']) {
		syncRaceState(race, race === 'human' ? undefined : getRace(race)?.subraces[0]?.name);
		syncSkillState();
		syncLanguageState();
		syncSpellState();
		clearStepErrors(getStepFields(4));
		clearStepErrors(getStepFields(5));
	}

	function setSubrace(subrace: string | undefined) {
		syncRaceState(form.race, subrace);
		syncSkillState();
		syncLanguageState();
		syncSpellState();
		clearStepErrors(getStepFields(0));
		clearStepErrors(getStepFields(4));
		clearStepErrors(getStepFields(5));
	}

	function syncRaceState(race: CharacterCreateInput['race'], subrace: string | undefined) {
		form.race = race;
		form.subrace = subrace;

		const abilityChoices = race === 'half-elf'
			? { str: 1, dex: 1 }
			: subrace === 'variant-human'
				? { str: 1, con: 1 }
				: {};
		form.abilityChoiceBonuses = sanitizeFlexibleBonuses(abilityChoices, race, subrace);

		if (subrace === 'variant-human') {
			form.variantHumanFeat = form.variantHumanFeat ?? FEATS[0]?.name;
		} else {
			form.variantHumanFeat = undefined;
		}
	}

	function sanitizeFlexibleBonuses(
		bonuses: Partial<Record<AbilityName, number>>,
		race: CharacterCreateInput['race'],
		subrace: string | undefined
	): Partial<Record<AbilityName, number>> {
		const allowed = race === 'half-elf'
			? abilityOrder.filter((ability) => ability !== 'cha')
			: subrace === 'variant-human'
				? abilityOrder
				: [];
		const max = race === 'half-elf' || subrace === 'variant-human' ? 2 : 0;
		const entries = Object.entries(bonuses)
			.filter(([ability, value]) => allowed.includes(ability as AbilityName) && value === 1)
			.slice(0, max) as [AbilityName, number][];
		return Object.fromEntries(entries);
	}

	function setClass(className: CharacterCreateInput['class']) {
		syncClassState(className);
		syncSkillState();
		syncSpellState();
		syncEquipmentState();
		clearStepErrors(getStepFields(4));
		clearStepErrors(getStepFields(5));
	}

	function syncClassState(className: CharacterCreateInput['class']) {
		form.class = className;
		const nextClass = getClass(className);
		form.subclass = nextClass && nextClass.subclassLevel <= 1 ? nextClass.subclass.name : undefined;
	}

	function setBackground(background: string | undefined) {
		syncBackgroundState(background);
		syncSkillState();
		syncLanguageState();
		clearStepErrors(getStepFields(4));
	}

	function syncBackgroundState(background: string | undefined) {
		form.background = background;
	}

	function syncSkillState() {
		const nextClass = getClass(form.class);
		const nextBackground = form.background ? getBackground(form.background) : undefined;
		const nextBackgroundSkills = nextBackground?.skillProficiencies ?? [];
		const nextFixedRacialSkills = getFixedRacialSkills();
		const nextClassSkillOptions = nextClass?.skillOptions ?? [];
		const nextClassSkillPickCount = nextClass?.skillPickCount ?? 0;
		const blocked = new Set<SkillName>([...nextBackgroundSkills, ...nextFixedRacialSkills]);
		const chosen = unique(form.chosenSkills).filter((skill) => nextClassSkillOptions.includes(skill) && !blocked.has(skill));
		const bonus = unique(form.bonusSkillChoices ?? []).filter((skill) => !blocked.has(skill) && !chosen.includes(skill));

		while (chosen.length < nextClassSkillPickCount) {
			const next = nextClassSkillOptions.find((skill) => !blocked.has(skill) && !chosen.includes(skill) && !bonus.includes(skill));
			if (!next) break;
			chosen.push(next);
		}

		while (bonus.length < getBonusSkillChoicesRequired()) {
			const next = allSkills.find((skill) => !blocked.has(skill) && !chosen.includes(skill) && !bonus.includes(skill));
			if (!next) break;
			bonus.push(next);
		}

		form.chosenSkills = chosen.slice(0, nextClassSkillPickCount);
		form.bonusSkillChoices = bonus.slice(0, getBonusSkillChoicesRequired());
	}

	function syncLanguageState() {
		const nextBackground = form.background ? getBackground(form.background) : undefined;
		const nextBaseLanguages = [
			...(getRace(form.race)?.languages ?? []),
			...(getSubrace(form.race, form.subrace ?? '')?.extraLanguages ?? []),
			...(nextBackground?.languages ?? [])
		] as string[];
		const nextLanguageOptions = allLanguages.filter((language) => !nextBaseLanguages.includes(language));
		const requiredChoices = countExtraLanguageChoices();
		const next = unique(form.chosenLanguages ?? []).filter((language) => !nextBaseLanguages.includes(language));
		while (next.length < requiredChoices) {
			const candidate = nextLanguageOptions.find((language) => !next.includes(language));
			if (!candidate) break;
			next.push(candidate);
		}
		form.chosenLanguages = next.slice(0, requiredChoices);
	}

	function syncSpellState() {
		const nextClass = getClass(form.class);
		const nextFlexibleCantrips = getFlexibleCantripChoices();
		const nextCantripChoices = Array.from(new Set([...(nextClass ? getCantripsForClass(form.class).map((spell) => spell.name) : []), ...nextFlexibleCantrips]));
		const nextKnownSpellChoices = getSpellsForClass(form.class, 1).filter((spell) => spell.level === 1).map((spell) => spell.name);
		const nextFirstLevelSlotCount = nextClass?.spellcasting?.slotsPerLevel[0]?.[0] ?? 0;
		const nextKnownSpellCount = nextFirstLevelSlotCount > 0
			? (nextClass?.spellcasting?.preparesCasts ? (form.class === 'wizard' ? 6 : 0) : (nextClass?.spellcasting?.spellsKnown[0] ?? 0))
			: 0;
		const nextExpectedCantripCount = (nextClass?.spellcasting?.cantripsKnown[0] ?? 0) + (nextFlexibleCantrips.length > 0 ? 1 : 0);
		const cantrips = unique(form.spellChoices?.cantrips ?? []).filter((spell) => nextCantripChoices.includes(spell));
		const known = unique(form.spellChoices?.knownSpells ?? []).filter((spell) => nextKnownSpellChoices.includes(spell));
		const preparedSource = form.class === 'wizard' ? known : nextKnownSpellChoices;
		const prepared = unique(form.spellChoices?.preparedSpells ?? []).filter((spell) => preparedSource.includes(spell));
		const nextPreparedSpellCount = nextFirstLevelSlotCount > 0 && nextClass?.spellcasting?.preparesCasts
			? Math.max(1, 1 + abilityModifier(previewAbilities[nextClass.spellcasting.ability]))
			: 0;

		form.spellChoices = {
			cantrips: cantrips.slice(0, nextExpectedCantripCount),
			knownSpells: known.slice(0, nextKnownSpellCount),
			preparedSpells: prepared.slice(0, nextPreparedSpellCount)
		};
	}

	function syncEquipmentState() {
		const count = getClass(form.class)?.equipmentChoices.length ?? 0;
		// Always start unselected so the player consciously picks each choice
		const next = Array.from({ length: count }, () => -1);
		form.equipmentSelections = next;
		form.equipmentSubSelections = {};
		subPickDirections = {};
		openChoiceIdx = null;
	}

	function setStatMethod(method: CharacterCreateInput['statMethod']) {
		// Save the departing method's assignment before switching
		if (form.abilityAssignment) {
			if (form.statMethod === 'standard') savedStandard = { ...standardSlots };
			else if (form.statMethod === 'point-buy') savedPointBuy = { ...form.abilityAssignment };
			else if (form.statMethod === 'rolled') savedRolled = { ...form.abilityAssignment };
		}
		form.statMethod = method;
		if (method === 'standard') {
			syncStandardSlots();
			syncStandardAssignment();
		}
		if (method === 'point-buy') {
			form.abilityAssignment = { ...savedPointBuy };
			syncSpellState();
		}
		if (method === 'rolled') {
			if (rolledSeed === 0) {
				rerollStats();
			} else {
				form.abilityAssignment = { ...savedRolled };
				syncSpellState();
			}
		}
	}

	function syncStandardSlots() {
		standardSlots = { ...savedStandard } as Partial<Record<AbilityName, number>>;
	}
	function syncStandardAssignment() {
		const base: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		form.abilityAssignment = { ...base, ...(standardSlots as AbilityScores) };
		syncSpellState();
	}
	function startDrag(src: StandardDragSrc) { dragSource = src; }
	function endDrag() { dragSource = null; dragOverTarget = null; }
	function dropOnSlot(target: AbilityName) {
		const src = dragSource;
		if (!src) return;
		const next = { ...standardSlots };
		const prev = next[target];
		if (src.from === 'slot') {
			if (prev !== undefined) next[src.ability] = prev;
			else delete next[src.ability];
		}
		next[target] = src.value;
		standardSlots = next;
		syncStandardAssignment();
		dragSource = null;
		dragOverTarget = null;
	}
	function dropOnPool() {
		const src = dragSource;
		if (!src || src.from !== 'slot') return;
		const next = { ...standardSlots };
		delete next[src.ability];
		standardSlots = next;
		syncStandardAssignment();
		dragSource = null;
		dragOverTarget = null;
	}

	function applyOptimalSpec() {
		if (!classDef) return;
		const sorted = [...STANDARD_ARRAY].sort((a, b) => b - a);
		const priorities: AbilityName[] = [];
		for (const ab of classDef.primaryAbility) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		for (const ab of classDef.saveProficiencies) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		for (const ab of abilityOrder) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		const next: Partial<Record<AbilityName, number>> = {};
		for (let i = 0; i < priorities.length; i++) {
			next[priorities[i]] = sorted[i];
		}
		standardSlots = next;
		savedStandard = { ...next };
		syncStandardAssignment();
	}

	function applyRandomSpec() {
		const values = [...STANDARD_ARRAY];
		for (let i = values.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[values[i], values[j]] = [values[j], values[i]];
		}
		const next: Partial<Record<AbilityName, number>> = {};
		for (let i = 0; i < abilityOrder.length; i++) {
			next[abilityOrder[i]] = values[i];
		}
		standardSlots = next;
		savedStandard = { ...next };
		syncStandardAssignment();
	}

	function applyOptimalPointBuy() {
		if (!classDef) return;
		const sorted = [...STANDARD_ARRAY].sort((a, b) => b - a);
		const priorities: AbilityName[] = [];
		for (const ab of classDef.primaryAbility) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		for (const ab of classDef.saveProficiencies) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		for (const ab of abilityOrder) {
			if (!priorities.includes(ab)) priorities.push(ab);
		}
		const result: AbilityScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
		for (let i = 0; i < priorities.length; i++) {
			result[priorities[i]] = sorted[i];
		}
		form.abilityAssignment = result;
		savedPointBuy = { ...result };
		syncSpellState();
	}

	function applyRandomPointBuy() {
		const values = [...STANDARD_ARRAY];
		for (let i = values.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[values[i], values[j]] = [values[j], values[i]];
		}
		const result: AbilityScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
		for (let i = 0; i < abilityOrder.length; i++) {
			result[abilityOrder[i]] = values[i];
		}
		form.abilityAssignment = result;
		savedPointBuy = { ...result };
		syncSpellState();
	}

	function updateAbility(ability: AbilityName, value: string) {
		const next = Number(value);
		if (!form.abilityAssignment || Number.isNaN(next)) return;
		const min = form.statMethod === 'rolled' ? 3 : 8;
		const max = form.statMethod === 'rolled' ? 18 : 15;
		form.abilityAssignment = { ...form.abilityAssignment, [ability]: Math.min(max, Math.max(min, next)) };
		syncSpellState();
	}

	function rerollStats() {
		const rollResults = Array.from({ length: 6 }, () => roll4d6DropLowest()).sort((a, b) => b.total - a.total);
		const priority = getClass(form.class)?.primaryAbility ?? abilityOrder;
		const ordered = [...priority, ...abilityOrder.filter((ability) => !priority.includes(ability))].slice(0, 6);
		const assignment: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
		const dmap: Record<AbilityName, number[]> = { str: [], dex: [], con: [], int: [], wis: [], cha: [] };
		ordered.forEach((ability, index) => {
			assignment[ability] = rollResults[index].total;
			dmap[ability] = rollResults[index].dice;
		});
		rolledSeed += 1;
		rolledDice = dmap;
		savedRolled = { ...assignment };
		form.abilityAssignment = assignment;
		syncSpellState();
	}

	function roll4d6DropLowest(): { total: number; dice: number[] } {
		const dice = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => a - b);
		return { total: dice[1] + dice[2] + dice[3], dice };
	}

	function toggleSkill(skill: SkillName, field: 'chosenSkills' | 'bonusSkillChoices', max: number) {
		const list = [...(form[field] ?? [])] as SkillName[];
		const assign = (next: SkillName[]) => {
			if (field === 'chosenSkills') {
				form.chosenSkills = next;
				return;
			}
			form.bonusSkillChoices = next;
		};
		if (list.includes(skill)) {
			assign(list.filter((entry) => entry !== skill));
			return;
		}
		if (list.length >= max) return;
		assign([...list, skill]);
	}

	function toggleLanguage(language: string) {
		const list = [...(form.chosenLanguages ?? [])];
		if (list.includes(language)) {
			form.chosenLanguages = list.filter((entry) => entry !== language);
			return;
		}
		if (list.length >= extraLanguageChoices) return;
		form.chosenLanguages = [...list, language];
	}

	function toggleSpell(field: 'cantrips' | 'knownSpells' | 'preparedSpells', spell: string, max: number) {
		const list = [...(form.spellChoices?.[field] ?? [])];
		if (list.includes(spell)) {
			form.spellChoices = { ...form.spellChoices, [field]: list.filter((entry) => entry !== spell) };
			return;
		}
		if (list.length >= max) return;
		form.spellChoices = { ...form.spellChoices, [field]: [...list, spell] };
	}

	function toggleExpertise(skill: SkillName) {
		const list = [...(form.expertiseChoices ?? [])];
		if (list.includes(skill)) {
			form.expertiseChoices = list.filter((e) => e !== skill);
			return;
		}
		if (list.length >= expertiseCount) return;
		form.expertiseChoices = [...list, skill];
	}

	function toggleFlexibleAbility(ability: AbilityName) {
		const next = { ...(form.abilityChoiceBonuses ?? {}) };
		if (next[ability]) {
			delete next[ability];
			form.abilityChoiceBonuses = next;
			return;
		}
		const max = form.race === 'half-elf' || form.subrace === 'variant-human' ? 2 : 0;
		if (Object.keys(next).length >= max) return;
		next[ability] = 1;
		form.abilityChoiceBonuses = next;
	}

	function setEquipmentSelection(index: number, value: string) {
		const next = [...(form.equipmentSelections ?? [])];
		next[index] = Number(value);
		form.equipmentSelections = next;
	}

	// ── Equipment panel state ─────────────────────────────────────────────
	/** Which choice row's detail panel is currently open (only one at a time). */
	let openChoiceIdx = $state<number | null>(null);
	/** Per-weapon direction state for the 0→1→2→1→0 cycle. Key: `"{ci}-{itemName}"`. */
	let subPickDirections = $state<Record<string, 'up' | 'down'>>({});

	const WEAPON_PLACEHOLDER_SET = new Set([
		'martial weapon', 'two martial weapons', 'martial melee weapon',
		'simple weapon', 'simple melee', 'two simple melee', 'simple melee weapon',
		'simple ranged weapon'
	]);

	function isPanelOpen(ci: number): boolean {
		return openChoiceIdx === ci;
	}

	function selectEquipmentOption(ci: number, optIdx: number) {
		const prevOptIdx = form.equipmentSelections?.[ci] ?? -1;
		// Always open the panel for this choice row when a tab is clicked
		openChoiceIdx = ci;
		// Clear sub-picks (and direction state) when switching to a different option on the same row
		if (optIdx !== prevOptIdx) {
			setSubPick(ci, []);
			// Clear direction state for this choice so the next pick starts fresh
			const prefix = `${ci}-`;
			subPickDirections = Object.fromEntries(
				Object.entries(subPickDirections).filter(([k]) => !k.startsWith(prefix))
			);
		}
		setEquipmentSelection(ci, String(optIdx));
	}

	function closePanelManually(ci: number) {
		// Toggle: if this panel is already open, close it; clicking a tab re-opens it
		if (openChoiceIdx === ci) openChoiceIdx = null;
	}

	function getWeaponPlaceholderInOption(option: string[]): string | null {
		return option.find(s => WEAPON_PLACEHOLDER_SET.has(s.toLowerCase())) ?? null;
	}

	function isInstrumentPlaceholder(label: string): boolean {
		return label.toLowerCase() === 'musical instrument';
	}

	function getInstrumentPlaceholderInOption(option: string[]): string | null {
		return option.find(s => isInstrumentPlaceholder(s)) ?? null;
	}

	function parsePlaceholderCount(placeholder: string): number {
		const low = placeholder.toLowerCase();
		if (low.startsWith('two ')) return 2;
		if (low.startsWith('three ')) return 3;
		if (low.startsWith('four ')) return 4;
		if (low.startsWith('five ')) return 5;
		return 1;
	}

	function damageMaxValue(damage: string): number {
		const m = damage.match(/(\d+)d(\d+)/);
		return m ? parseInt(m[1]) * parseInt(m[2]) : 0;
	}

	const DAMAGE_TYPE_ORDER: Record<string, number> = { bludgeoning: 0, piercing: 1, slashing: 2 };

	function sortWeapons(weapons: WeaponDefinition[]): WeaponDefinition[] {
		return [...weapons].sort((a, b) => {
			// 1. STR weapons first, then DEX
			const aStat = weaponPrimaryStat(a) === 'STR' ? 0 : 1;
			const bStat = weaponPrimaryStat(b) === 'STR' ? 0 : 1;
			if (aStat !== bStat) return aStat - bStat;
			// 2. Highest max damage first
			const aDmg = damageMaxValue(a.damage);
			const bDmg = damageMaxValue(b.damage);
			if (aDmg !== bDmg) return bDmg - aDmg;
			// 3. Damage type alphabetically (bludgeoning → piercing → slashing)
			const aType = DAMAGE_TYPE_ORDER[a.damageType] ?? 99;
			const bType = DAMAGE_TYPE_ORDER[b.damageType] ?? 99;
			return aType - bType;
		});
	}

	function getWeaponsForPlaceholder(placeholder: string): WeaponDefinition[] {
		const low = placeholder.toLowerCase();
		let list: WeaponDefinition[];
		if (low.includes('martial')) list = WEAPONS.filter(w => w.category.startsWith('martial'));
		else if (low.includes('ranged')) list = WEAPONS.filter(w => w.category.endsWith('-ranged'));
		else list = WEAPONS.filter(w => w.category.startsWith('simple'));
		return sortWeapons(list);
	}

	function weaponPrimaryStat(w: WeaponDefinition): 'STR' | 'DEX' {
		if (w.properties.includes('finesse') || w.category.endsWith('-ranged')) return 'DEX';
		return 'STR';
	}

	function getArmorInOption(option: string[]): ArmorDefinition | null {
		for (const item of option) {
			const armor = getArmor(item);
			if (armor && armor.type !== 'shield') return armor;
		}
		return null;
	}

	function hasShieldInOption(option: string[]): boolean {
		return option.some(item => getArmor(item)?.type === 'shield');
	}

	function getPackInOption(option: string[]): GearDefinition | null {
		for (const item of option) {
			const gear = getGear(item);
			if (gear?.contents?.length) return gear;
		}
		return null;
	}

	function computeArmorAC(armor: ArmorDefinition): { formula: string; total: number } {
		const dexMod = abilityModifier(previewAbilities.dex);
		if (armor.maxDexBonus === 0) {
			return { formula: `${armor.baseAC} (no DEX)`, total: armor.baseAC };
		}
		if (armor.maxDexBonus === null) {
			const total = armor.baseAC + dexMod;
			const sign = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;
			return { formula: `${armor.baseAC} ${sign} DEX`, total };
		}
		const appliedDex = Math.min(dexMod, armor.maxDexBonus);
		const total = armor.baseAC + appliedDex;
		const sign = appliedDex >= 0 ? `+${appliedDex}` : `${appliedDex}`;
		return { formula: `${armor.baseAC} ${sign} DEX (max +${armor.maxDexBonus})`, total };
	}

	function getSubPicks(ci: number): string[] {
		return form.equipmentSubSelections?.[`sub-${ci}`] ?? [];
	}

	function setSubPick(ci: number, picks: string[]) {
		form.equipmentSubSelections = {
			...(form.equipmentSubSelections ?? {}),
			[`sub-${ci}`]: picks
		};
	}

	/**
	 * Weapon selection with FIFO eviction.
	 *
	 * Clicking an already-picked weapon cycles it: 0→1→max→(max-1)→…→0→repeat.
	 * Clicking a NEW weapon when the budget is full evicts the oldest pick (front
	 * of the array) and appends the new weapon. This means:
	 *   - 1×Longsword, click Flail  (budget=2, has room)  → 1×Longsword, 1×Flail
	 *   - 2×Longsword, click Flail  (budget full)          → 1×Longsword, 1×Flail
	 *   - 1×Longsword, 1×Flail, click Blowgun (budget full)→ 1×Flail, 1×Blowgun
	 */
	function toggleSubPick(ci: number, itemName: string, maxCount: number) {
		const picks = [...getSubPicks(ci)];
		const count = picks.filter(n => n === itemName).length;
		const key = `${ci}-${itemName}`;
		let dir = subPickDirections[key] ?? 'up';

		if (count > 0) {
			// Weapon already picked — run the up/down cycle
			if (dir === 'up') {
				// Going up: add another if room
				if (picks.length < maxCount) {
					picks.push(itemName);
					const newCount = count + 1;
					if (newCount >= maxCount) dir = 'down';
				} else {
					// Budget full with other weapons — evict oldest, add again (net no-change for this weapon)
					// Instead just start going down (remove one)
					picks.splice(picks.indexOf(itemName), 1);
					const newCount = count - 1;
					dir = newCount <= 0 ? 'up' : 'down';
				}
			} else {
				// Going down: remove one
				picks.splice(picks.indexOf(itemName), 1);
				const newCount = count - 1;
				if (newCount <= 0) dir = 'up';
			}
		} else {
			// Weapon not currently picked
			if (picks.length < maxCount) {
				// Room available — just add
				picks.push(itemName);
				const newCount = 1;
				dir = newCount >= maxCount ? 'down' : 'up';
			} else {
				// Budget full — FIFO evict: remove the oldest pick (index 0), add new weapon
				picks.shift();
				picks.push(itemName);
				// After eviction we now hold 1 of this weapon; set dir based on whether budget is now full
				dir = picks.filter(n => n === itemName).length >= maxCount ? 'down' : 'up';
			}
		}

		subPickDirections = { ...subPickDirections, [key]: dir };
		setSubPick(ci, picks);
	}

	function isWeaponTwoHanded(w: WeaponDefinition): boolean {
		return w.properties.includes('two-handed');
	}

	function getWeaponDisplayTags(w: WeaponDefinition): string[] {
		const tags: string[] = [];
		if (w.properties.includes('two-handed')) tags.push('Two-Handed');
		else if (w.properties.includes('versatile')) tags.push('Versatile');
		else tags.push('One-Handed');
		if (w.category.endsWith('-ranged')) tags.push('Ranged');
		if (w.properties.includes('heavy')) tags.push('Heavy');
		if (w.properties.includes('light')) tags.push('Light');
		if (w.properties.includes('reach')) tags.push('Reach');
		if (w.properties.includes('finesse')) tags.push('Finesse');
		if (w.properties.includes('thrown') && !w.category.endsWith('-ranged')) tags.push('Thrown');
		if (w.properties.includes('loading')) tags.push('Loading');
		if (w.properties.includes('ammunition')) tags.push('Ammo');
		return tags;
	}

	const WEAPON_TAG_TOOLTIPS: Record<string, string> = {
		'One-Handed':  'Requires one hand to wield. Can be paired with a second one-handed weapon, a shield, or another item.',
		'Two-Handed':  'Requires both hands to wield. Cannot be used alongside a shield.',
		'Versatile':   'Can be used one-handed or two-handed. Gains higher damage when gripped with both hands.',
		'Ranged':      'Makes attacks at range using Dexterity for attack and damage rolls.',
		'Heavy':       'Large and unwieldy. Small creatures have disadvantage on attack rolls with heavy weapons.',
		'Light':       'Small and easy to handle. Ideal for two-weapon fighting alongside another light weapon.',
		'Reach':       'Extends your melee reach to 10 feet instead of the usual 5 feet.',
		'Finesse':     'You may use either Strength or Dexterity (whichever is higher) for attack and damage rolls.',
		'Thrown':      'Can be thrown as a ranged attack. Uses the same ability modifier as melee attacks.',
		'Loading':     'Requires an action to reload between shots. Limits you to one attack per action.',
		'Ammo':        'Requires ammunition (arrows, bolts, etc.) to make ranged attacks.',
	};

	function getTagClass(tag: string): string {
		switch (tag) {
			case 'One-Handed': return 'tag-one-handed';
			case 'Two-Handed': return 'tag-two-handed';
			case 'Ranged':     return 'tag-ranged';
			case 'Reach':      return 'tag-reach';
			case 'Finesse':    return 'tag-finesse';
			case 'Versatile':  return 'tag-versatile';
			case 'Heavy':      return 'tag-heavy';
			default:           return '';
		}
	}

	/** Returns "Special:" descriptor text for a weapon if it has notable notes or versatile damage. */
	function getWeaponSpecialText(w: WeaponDefinition): string | null {
		const parts: string[] = [];
		if (w.versatileDamage) parts.push(`Deals ${w.versatileDamage} damage when wielded with two hands.`);
		if (w.notes) parts.push(w.notes);
		return parts.length ? parts.join(' ') : null;
	}

	/** Finds actual WeaponDefinition entries referenced in an option (handles "Two Shortswords" etc.). */
	function getConcreteWeaponsInOption(option: string[]): WeaponDefinition[] {
		const result: WeaponDefinition[] = [];
		for (const item of option) {
			if (WEAPON_PLACEHOLDER_SET.has(item.toLowerCase())) continue;
			if (isInstrumentPlaceholder(item)) continue;
			let w = getWeapon(item);
			if (!w) {
				const low = item.toLowerCase();
				for (const prefix of ['two ', 'three ', 'four ', 'five ']) {
					if (low.startsWith(prefix)) {
						const rest = item.slice(prefix.length);
						const sing = rest.endsWith('s') ? rest.slice(0, -1) : rest;
						w = getWeapon(rest) ?? getWeapon(sing);
						if (w) break;
					}
				}
			}
			if (w && !result.find(r => r.name === w!.name)) result.push(w);
		}
		return result;
	}

	/** How many of a given weapon are in this option (e.g. "Two Shortswords" → 2). */
	function concreteWeaponCount(weapon: WeaponDefinition, option: string[]): number {
		let total = 0;
		for (const item of option) {
			if (getWeapon(item)?.name === weapon.name) { total += 1; continue; }
			for (const [prefix, qty] of [['two ', 2], ['three ', 3], ['four ', 4], ['five ', 5]] as [string, number][]) {
				if (item.toLowerCase().startsWith(prefix)) {
					const rest = item.slice(prefix.length);
					const sing = rest.endsWith('s') ? rest.slice(0, -1) : rest;
					if ((getWeapon(rest) ?? getWeapon(sing))?.name === weapon.name) { total += qty; break; }
				}
			}
		}
		return Math.max(total, 1);
	}

	function subPicksContainTwoHanded(ci: number): boolean {
		return getSubPicks(ci).some(name => {
			const w = getWeapon(name);
			return w ? w.properties.includes('two-handed') : false;
		});
	}

	function portal(node: HTMLElement) {
		const target = document.body;
		target.appendChild(node);

		return {
			destroy() {
				if (node.parentNode === target) {
					target.removeChild(node);
				}
			}
		};
	}

	function setErrors(nextErrors: Array<{ field: string; message: string }>) {
		const mapped: Record<string, string[]> = {};
		for (const entry of nextErrors) {
			mapped[entry.field] = [...(mapped[entry.field] ?? []), entry.message];
		}
		errors = mapped;
		const firstStep = findFirstErrorStep(mapped);
		if (firstStep >= 0) {
			currentStep = firstStep;
		}
	}

	function clearStepErrors(fields: string[]) {
		const next = { ...errors };
		for (const field of fields) {
			delete next[field];
		}
		errors = next;
		submitError = '';
	}

	function getStepFields(step: number): string[] {
		switch (step) {
			case 0:
				return ['race', 'subrace', 'abilityChoiceBonuses', 'variantHumanFeat'];
			case 1:
				return ['class', 'subclass'];
			case 2:
				return ['background', 'bgChoices'];
			case 3:
				return ['abilityAssignment'];
			case 4:
				return ['chosenSkills', 'bonusSkillChoices', 'chosenLanguages'];
			case 5:
				return ['expertiseChoices', 'spellChoices', 'spellChoices.cantrips', 'spellChoices.knownSpells', 'spellChoices.preparedSpells', 'equipmentSelections'];
			case 6:
				return ['name', 'alignment', 'backstory'];
			default:
				return [];
		}
	}

	function getStepErrors(step: number): string[] {
		const stepFields = getStepFields(step);
		return stepFields.flatMap((field) => errors[field] ?? []);
	}

	function stepHasErrors(step: number): boolean {
		return getStepErrors(step).length > 0;
	}

	function findFirstErrorStep(nextErrors: Record<string, string[]>): number {
		for (let index = 0; index < steps.length; index += 1) {
			const fields = getStepFields(index);
			if (fields.some((field) => (nextErrors[field]?.length ?? 0) > 0)) {
				return index;
			}
		}
		return -1;
	}

	function fieldError(...fields: string[]): string | null {
		for (const field of fields) {
			const message = errors[field]?.[0];
			if (message) return message;
		}
		return null;
	}

	function validateStep(step: number): boolean {
		const issues: Array<{ field: string; message: string }> = [];

		if (step === 0) {
			const race = getRace(form.race);
			if (!race) {
				issues.push({ field: 'race', message: 'Choose a valid race.' });
			}
			if (race && race.subraces.length > 0 && form.race !== 'human' && !form.subrace) {
				issues.push({ field: 'subrace', message: 'Choose a subrace.' });
			}
			if ((form.race === 'half-elf' || form.subrace === 'variant-human') && Object.keys(form.abilityChoiceBonuses ?? {}).length !== 2) {
				issues.push({ field: 'abilityChoiceBonuses', message: 'Choose two flexible +1 ability bonuses.' });
			}
			if (form.subrace === 'variant-human' && !form.variantHumanFeat) {
				issues.push({ field: 'variantHumanFeat', message: 'Variant humans need a feat.' });
			}
		}

		if (step === 1) {
			if (!classDef) {
				issues.push({ field: 'class', message: 'Choose a class.' });
			}
			if (classDef && classDef.subclassLevel <= 1 && !form.subclass) {
				issues.push({ field: 'subclass', message: 'Choose a subclass.' });
			}
		}

		if (step === 2 && !backgroundDef) {
			issues.push({ field: 'background', message: 'Choose a background.' });
		}

		if (step === 2 && backgroundDef) {
			for (const choice of (backgroundDef.equipmentChoices ?? [])) {
				if (!choice.required) continue;
				const ids: string[] = choice.type === 'dual-radio' && choice.secondId
					? [choice.id, choice.secondId]
					: [choice.id];
				for (const id of ids) {
					if (!form.backgroundEquipmentChoices?.[id]) {
						issues.push({ field: 'bgChoices', message: `${choice.prompt}` });
					}
				}
				if (choice.type === 'text' && choice.textMaxWords) {
					const wc = (form.backgroundEquipmentChoices?.[choice.id] ?? '').trim().split(/\s+/).filter(Boolean).length;
					if (wc > choice.textMaxWords) {
						issues.push({ field: 'bgChoices', message: `Keep the description to ${choice.textMaxWords} words or fewer.` });
					}
				}
			}
		}

		if (step === 3) {
			if (!form.abilityAssignment) {
				issues.push({ field: 'abilityAssignment', message: 'Assign your ability scores.' });
			} else if (form.statMethod === 'standard' && standardPool.length > 0) {
				issues.push({ field: 'abilityAssignment', message: `Assign all 6 values. Unplaced: ${standardPool.join(', ')}.` });
			} else if (form.statMethod === 'point-buy' && !pointBuySummary.valid) {
				issues.push({ field: 'abilityAssignment', message: 'Point buy: spend exactly 27 points. Scores must be 8—15 before racial bonuses.' });
			}
		}

		if (step === 4) {
			if (form.chosenSkills.length !== classSkillPickCount) {
				issues.push({ field: 'chosenSkills', message: `Choose ${classSkillPickCount} class skills.` });
			}
			// Only check that player-chosen skills don't overlap with granted skills or each other.
			// Race + background overlap (e.g. half-orc intimidation + soldier intimidation) is legal in 5e.
			const granted = new Set<SkillName>([...backgroundSkills, ...fixedRacialSkills]);
			const playerChosen = [...(form.bonusSkillChoices ?? []), ...form.chosenSkills];
			if (new Set(playerChosen).size !== playerChosen.length || playerChosen.some((s) => granted.has(s))) {
				issues.push({ field: 'chosenSkills', message: 'Your chosen skills must not duplicate each other or skills already granted by your background/race.' });
			}
			if ((form.chosenLanguages ?? []).length !== extraLanguageChoices) {
				issues.push({ field: 'chosenLanguages', message: `Choose ${extraLanguageChoices} extra language${extraLanguageChoices === 1 ? '' : 's'}.` });
			}
		}

		if (step === 5) {
			if (expertiseCount > 0 && (form.expertiseChoices ?? []).length !== expertiseCount) {
				issues.push({ field: 'expertiseChoices', message: `Choose ${expertiseCount} skills for expertise.` });
			}
			if (expectedCantripCount > 0 && (form.spellChoices?.cantrips?.length ?? 0) !== expectedCantripCount) {
				issues.push({ field: 'spellChoices.cantrips', message: `Choose ${expectedCantripCount} cantrip${expectedCantripCount === 1 ? '' : 's'}.` });
			}
			if (knownSpellCount > 0 && (form.spellChoices?.knownSpells?.length ?? 0) !== knownSpellCount) {
				issues.push({ field: 'spellChoices.knownSpells', message: `Choose ${knownSpellCount} level-1 spell${knownSpellCount === 1 ? '' : 's'}.` });
			}
			if (preparedSpellCount > 0 && (form.spellChoices?.preparedSpells?.length ?? 0) !== preparedSpellCount) {
				issues.push({ field: 'spellChoices.preparedSpells', message: `Choose ${preparedSpellCount} prepared spell${preparedSpellCount === 1 ? '' : 's'}.` });
			}
		}

		if (step === 6) {
			if (!form.name || form.name.trim().length < 2) {
				issues.push({ field: 'name', message: 'Choose a name with at least 2 characters.' });
			}
		}

		clearStepErrors(getStepFields(step));
		if (issues.length > 0) {
			setErrors(issues);
			return false;
		}
		return true;
	}

	function nextStep() {
		if (!validateStep(currentStep)) return;
		currentStep = Math.min(currentStep + 1, steps.length - 1);
	}

	function previousStep() {
		currentStep = Math.max(currentStep - 1, 0);
	}

	function goToStep(index: number) {
		if (index <= currentStep) {
			currentStep = index;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		// Character creation must be completed — do not allow closing via keyboard
		if (event.key === 'Escape') {
			event.preventDefault();
		}
	}

	async function submitCharacter() {
		if (!validateStep(currentStep)) return;
		submitError = '';
		const localErrors = validateCharacterInput(form);
		if (localErrors.length > 0) {
			setErrors(localErrors);
			submitError = 'Please fix the highlighted choices.';
			return;
		}

		submitting = true;
		const response = await fetch(`/api/adventure/${adventureId}/character`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});
		const payload = await response.json().catch(() => null);
		submitting = false;

		if (!response.ok) {
			if (payload?.errors) {
				setErrors(payload.errors as Array<{ field: string; message: string }>);
				submitError = 'Please fix the highlighted choices.';
			} else {
				submitError = 'Character creation failed.';
			}
			return;
		}

		isOpen = false;
		onCreated(payload.character as PlayerCharacter);
	}
</script>

<div class="sidebar-card">
	<h3>Create Your Character</h3>
	<p class="sidebar-desc">Build your level 1 adventurer before stepping into the world.</p>
	<button type="button" class="launch-btn" onclick={() => (isOpen = true)}>
		{isOpen ? 'Creator Open' : 'Open Character Creator'}
	</button>
</div>

{#if isOpen}
	<div use:portal class="modal-portal-root">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="cc-backdrop"
			role="presentation"
			onkeydown={handleKeydown}
			onclick={(e) => { void e; /* backdrop click blocked — character creation must be completed */ }}
		>
			<div class="cc-shell" role="dialog" aria-modal="true" aria-labelledby="cc-title">
				<!-- â”€â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
				<header class="cc-header">
					<div class="header-left">
						<span class="eyebrow">Level 1 adventurer</span>
						<h2 id="cc-title">{steps[currentStep].label}</h2>
					</div>

					<nav class="step-rail" aria-label="Creation steps">
						{#each steps as step, i}
							<button
								type="button"
								class="step-node"
								class:active={i === currentStep}
								class:done={i < currentStep}
								class:error={stepHasErrors(i)}
								onclick={() => goToStep(i)}
								aria-current={i === currentStep ? 'step' : undefined}
								title={step.label}
							>
								{i + 1}
							</button>
							{#if i < steps.length - 1}
								<div class="step-line" class:filled={i < currentStep}></div>
							{/if}
						{/each}
					</nav>

					<!-- Close disabled: character creation must be completed before returning to play -->
					<button type="button" class="close-btn" disabled title="Complete character creation to continue" aria-label="Cannot close — character creation required">âœ•</button>
				</header>

				<!-- â”€â”€â”€ Error strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
				{#if currentStepErrors.length > 0 || submitError}
					<div class="error-strip" role="alert">
						<strong>{submitError || 'Fix the issues below'}</strong>
						{#each currentStepErrors as msg}
							<span class="err-item">• {msg}</span>
						{/each}
					</div>
				{/if}

				<!-- â”€â”€â”€ Body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
				<div class="cc-body">

				<!-- â•â• STEP 0 · ANCESTRY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{#if currentStep === 0}
					<div class="split-pane">
						<aside class="option-list">
							<div class="list-header">Choose your race</div>
							{#each RACES as race}
								<button
									type="button"
									class="option-row"
									class:selected={form.race === race.name}
									onclick={() => setRace(race.name as any)}
								>
									<strong>{race.displayName}</strong>
									<span class="option-sub">{race.shortDescription}</span>
								</button>
							{/each}
						</aside>

						<div class="detail-pane">
							{#if raceDef}
								<h3 class="detail-title">{raceDef.displayName}</h3>
								<p class="detail-desc">{raceDef.description}</p>

								<div class="tag-row">
									<span class="tag">Speed {raceDef.speed} ft.</span>
									<span class="tag">Size: {raceDef.size}</span>
									{#if effectiveDarkvision > 0}
										<span class="tag">Darkvision {effectiveDarkvision} ft.</span>
									{/if}
									<span class="tag">Languages: {[...raceDef.languages, ...(subraceDef?.extraLanguages ?? [])].join(', ')}</span>
								</div>

								<!-- Subraces -->
								{#if raceDef.subraces.length > 0}
									<div class="detail-section">
										<h4>Subrace</h4>
										{#if raceDef.name === 'dragonborn'}
											<div class="subrace-dragon-grid">
												<div class="dragon-col-header">Chromatic</div>
												<div class="dragon-col-header">Metallic</div>
												{#each [['red','gold'],['orange','brass'],['_sep_',''],['blue','bronze'],['_sep_',''],['white','silver'],['_sep_',''],['black','copper'],['_sep_',''],['green','lead']] as pair}
													{#if pair[0] === '_sep_'}
														<div class="dragon-sep"></div>
													{:else}
														{#each pair as srName}
															{#if srName}
																{@const sr = raceDef.subraces.find(s => s.name === srName)}
																{#if sr}
																	{@const breathEff = sr.traits[0]?.effects.find(e => e.tag === 'breath-weapon') as any}
																	<button type="button" class="choice-card" class:selected={form.subrace === sr.name} onclick={() => setSubrace(sr.name)}>
																		<strong>{sr.displayName}</strong>
																		<small>{sr.traits[0]?.name}{breathEff ? ' — ' + breathEff.shape[0].toUpperCase() + breathEff.shape.slice(1) : ''}</small>
																	</button>
																{/if}
															{:else}
																<div class="dragon-empty"></div>
															{/if}
														{/each}
													{/if}
												{/each}
											</div>
										{:else}
											<div class="card-list">
												{#if raceDef.name === 'human'}
													<button type="button" class="choice-card" class:selected={!form.subrace} onclick={() => setSubrace(undefined)}>
														<strong>Standard Human</strong>
														<small>+1 to all ability scores</small>
													</button>
												{/if}
												{#each raceDef.subraces as sr}
													<button type="button" class="choice-card" class:selected={form.subrace === sr.name} onclick={() => setSubrace(sr.name)}>
														<strong>{sr.displayName}</strong>
														<small>{sr.traits.map(t => t.name).join(', ')}</small>
													</button>
												{/each}
											</div>
										{/if}
										{#if fieldError('subrace')}
											<p class="field-error">{fieldError('subrace')}</p>
										{/if}
									</div>
								{/if}

								<!-- Ability bonuses -->
								{#if Object.values(racialBonuses).some(v => v !== 0)}
									<div class="detail-section">
										<h4>Ability Bonuses</h4>
										<div class="tag-row">
											{#each abilityOrder as ab}
												{#if racialBonuses[ab]}
													<span class="tag accent">{abilityLabels[ab]} +{racialBonuses[ab]}</span>
												{/if}
											{/each}
										</div>
									</div>
								{/if}

								<!-- Traits -->
								{#if raceTraits.length > 0}
									<div class="detail-section">
										<h4>Racial Traits</h4>
										{#each raceTraits as trait}
											<div class="trait-entry">
												<strong>{trait.name}</strong>
												<p>{trait.description}</p>
											</div>
										{/each}
									</div>
								{/if}

								<!-- Flexible racial bonuses (half-elf / variant human) -->
								{#if flexibleAbilityChoices.length > 0}
									<div class="detail-section">
										<h4>Flexible Ability Bonuses</h4>
										<p class="hint">Choose two abilities that receive a +1 bonus.</p>
										<div class="pill-row">
											{#each flexibleAbilityChoices as ab}
												<button type="button" class="pill" class:selected={Boolean(form.abilityChoiceBonuses?.[ab])} onclick={() => toggleFlexibleAbility(ab)}>
													{abilityLabels[ab]}
												</button>
											{/each}
										</div>
										{#if fieldError('abilityChoiceBonuses')}
											<p class="field-error">{fieldError('abilityChoiceBonuses')}</p>
										{/if}
									</div>
								{/if}

								<!-- Variant Human feat -->
								{#if form.subrace === 'variant-human'}
									<div class="detail-section">
										<h4>Feat</h4>
										<div class="card-list">
											{#each FEATS as feat}
												<button type="button" class="choice-card" class:selected={form.variantHumanFeat === feat.name} onclick={() => (form.variantHumanFeat = feat.name)}>
													<strong>{feat.displayName}</strong>
													{#if feat.description}
														<small>{feat.description}</small>
													{/if}
												</button>
											{/each}
										</div>
										{#if fieldError('variantHumanFeat')}
											<p class="field-error">{fieldError('variantHumanFeat')}</p>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 1 · CLASS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 1}
					<div class="split-pane">
						<aside class="option-list">
							<div class="list-header">Choose your class</div>
							{#each CLASSES as cls}
								<button
									type="button"
									class="option-row"
									class:selected={form.class === cls.name}
									onclick={() => setClass(cls.name as any)}
								>
									<div class="row-top">
										<strong>{cls.displayName}</strong>
										<span class="hit-die-label">Hit die: <span class="badge">d{cls.hitDie}</span></span>
									</div>
									<span class="option-sub">Main: {cls.primaryAbility.map(a => abilityLabels[a]).join(' / ')}</span>
									<span class="option-sub-stats">Saves: {cls.saveProficiencies.map(a => abilityLabels[a]).join(', ')}</span>
								</button>
							{/each}
						</aside>

						<div class="detail-pane">
							{#if classDef}
								<h3 class="detail-title">{classDef.displayName}</h3>
								<p class="detail-desc">{classDef.description}</p>

								<div class="tag-row">
									<span class="tag accent">d{classDef.hitDie} Hit Die</span>
									{#each classDef.primaryAbility as ab}
										<span class="tag">{abilityLabels[ab]} primary</span>
									{/each}
									{#each classDef.saveProficiencies as ab}
										<span class="tag">{abilityLabels[ab]} save</span>
									{/each}
								</div>

								<div class="detail-section">
									<h4>Proficiencies</h4>
									<div class="prof-grid">
										{#if classDef.armorProficiencies.length > 0}
											<div class="prof-item"><strong>Armor</strong> {classDef.armorProficiencies.map(formatLabel).join(', ')}</div>
										{/if}
										{#if classDef.weaponProficiencies.length > 0}
											<div class="prof-item"><strong>Weapons</strong> {classDef.weaponProficiencies.map(formatLabel).join(', ')}</div>
										{/if}
										{#if classDef.toolProficiencies.length > 0}
											<div class="prof-item"><strong>Tools</strong> {classDef.toolProficiencies.map(formatLabel).join(', ')}</div>
										{/if}
									</div>
								</div>

								{#if classDef.spellcasting && classDef.spellcasting.style !== 'none'}
									<div class="detail-section">
										<h4>Spellcasting</h4>
										<div class="tag-row">
											<span class="tag accent">{formatLabel(classDef.spellcasting.style)} caster</span>
											<span class="tag">{abilityLabels[classDef.spellcasting.ability]} casting ability</span>
											{#if classDef.spellcasting.cantripsKnown[0] > 0}
												<span class="tag">{classDef.spellcasting.cantripsKnown[0]} cantrips at lv1</span>
											{/if}
											{#if classDef.spellcasting.preparesCasts}
												<span class="tag">Prepares spells</span>
											{:else if classDef.spellcasting.spellsKnown[0]}
												<span class="tag">{classDef.spellcasting.spellsKnown[0]} spells known at lv1</span>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Level 1 features -->
								{@const lv1Features = classDef.features.filter(f => f.level === 1)}
								{#if lv1Features.length > 0}
									<div class="detail-section">
										<h4>Level 1 Features</h4>
										{#each lv1Features as feat}
											<div class="trait-entry">
												<strong>{feat.name}</strong>
												<p>{feat.description}</p>
											</div>
										{/each}
									</div>
								{/if}

								<div class="detail-section">
									<h4>Subclass</h4>
									<div class="choice-card flat">
										<strong>{classDef.subclass.displayName}</strong>
										<small>{classDef.subclass.description.length > 120 ? classDef.subclass.description.slice(0, 120) + '…' : classDef.subclass.description}</small>
										<span class="hint">Chosen at level {classDef.subclassLevel}</span>
									</div>
								</div>

								{#if fieldError('class', 'subclass')}
									<p class="field-error">{fieldError('class', 'subclass')}</p>
								{/if}
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 2 · BACKGROUND â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 2}
					<div class="split-pane">
						<aside class="option-list">
							<div class="list-header">Choose your background</div>
							{#each BACKGROUNDS as bg}
								{@const boonParts = [
									...bg.toolProficiencies.map(formatBoon),
									...(bg.languages ?? []).map(l => `${l} (language)`),
									...(bg.languageChoices ? [`+${bg.languageChoices} Language${bg.languageChoices > 1 ? 's' : ''} of Choice`] : [])
								]}
								<button
									type="button"
									class="option-row bg-option-row"
									class:selected={form.background === bg.name}
									onclick={() => setBackground(bg.name)}
								>
									<strong>{bg.displayName}</strong>
									<span class="option-sub">Skills: {bg.skillProficiencies.map(formatLabel).join(' & ')}</span>
									{#if boonParts.length > 0}
										<span class="option-sub bg-additions">Additions: {boonParts.join(', ')}</span>
									{/if}
								</button>
							{/each}
						</aside>

						<div class="detail-pane">
							{#if backgroundDef}
								<h3 class="detail-title">{backgroundDef.displayName}</h3>
								<p class="detail-desc">{backgroundDef.description}</p>

								<div class="tag-row">
									{#each backgroundDef.skillProficiencies as sk}
										<span class="tag accent">{formatLabel(sk)}</span>
									{/each}
									{#each backgroundDef.toolProficiencies as tp}
										<span class="tag">{formatLabel(tp)}</span>
									{/each}
									{#if backgroundDef.languageChoices}
										<span class="tag">{backgroundDef.languageChoices} language choice{backgroundDef.languageChoices > 1 ? 's' : ''}</span>
									{/if}
								</div>

								<div class="detail-section">
									<h4>Equipment</h4>
									{#each [sortEquipment(backgroundDef.equipment)] as _ordered}
										{#if _ordered.length > 5}
											<div class="equip-columns">
												<ul class="equip-list">
													{#each _ordered.slice(0, Math.ceil(_ordered.length / 2)) as item}<li>{item}</li>{/each}
												</ul>
												<ul class="equip-list">
													{#each _ordered.slice(Math.ceil(_ordered.length / 2)) as item}<li>{item}</li>{/each}
												</ul>
											</div>
										{:else}
											<ul class="equip-list">
												{#each _ordered as item}<li>{item}</li>{/each}
											</ul>
										{/if}
									{/each}
								</div>

								<!-- ── Background equipment choices ──────────────────── -->
								{#if backgroundDef.equipmentChoices?.length}
									{#each backgroundDef.equipmentChoices as choice}
										<div class="detail-section bg-choice-section">
											<h4>{choice.sectionLabel}</h4>
											<p class="hint">{choice.prompt}</p>

											<!-- RADIO -->
											{#if choice.type === 'radio'}
												{@const opts = bgChoiceOptions[choice.id] ?? choice.options ?? []}
												{#if opts.length === 0}
													<p class="hint muted">No options available — a world must be loaded.</p>
												{:else}
													<div class="bg-choice-options">
														{#each opts as opt}
															<label class="bg-choice-pill" class:selected={bgChoice(choice.id) === opt.label}>
																<input type="radio" name={choice.id} value={opt.label}
																	checked={bgChoice(choice.id) === opt.label}
																	onchange={() => setBgChoice(choice.id, opt.label)} />
																<span class="choice-label">{opt.label}</span>
																{#if opt.description}<span class="choice-desc">{opt.description}</span>{/if}
															</label>
														{/each}
													</div>
												{/if}
											{/if}

											<!-- DUAL-RADIO -->
											{#if choice.type === 'dual-radio'}
												<div class="bg-choice-options">
													{#each choice.options ?? [] as opt}
														<label class="bg-choice-pill" class:selected={bgChoice(choice.id) === opt.label}>
															<input type="radio" name={choice.id} value={opt.label}
																checked={bgChoice(choice.id) === opt.label}
																onchange={() => setBgChoice(choice.id, opt.label)} />
															<span class="choice-label">{opt.label}</span>
														</label>
													{/each}
												</div>
												{#if choice.secondId}
													<p class="hint" style="margin-top:0.6rem">{choice.secondPrompt}</p>
													<div class="bg-choice-options">
														{#each choice.secondOptions ?? [] as opt}
															{#each [choice.secondId] as sid}
																<label class="bg-choice-pill" class:selected={bgChoice(sid) === opt.label}>
																	<input type="radio" name={sid} value={opt.label}
																		checked={bgChoice(sid) === opt.label}
																		onchange={() => setBgChoice(sid, opt.label)} />
																	<span class="choice-label">{opt.label}</span>
																</label>
															{/each}
														{/each}
													</div>
												{/if}
											{/if}

											<!-- TEXT -->
											{#if choice.type === 'text'}
												{#each [bgChoice(choice.id)] as textVal}
													<textarea class="bg-text-input" class:optional-input={choice.optional}
														maxlength={choice.textMaxChars ?? undefined}
														placeholder={choice.textPlaceholder ?? (choice.optional ? '(optional)' : '')}
														value={textVal}
														oninput={(e) => setBgChoice(choice.id, (e.target as HTMLTextAreaElement).value)}
													></textarea>
													{#if choice.textMaxWords}
														{@const wc = textVal.trim().split(/\s+/).filter(Boolean).length}
														<span class="char-counter" class:over={wc > choice.textMaxWords}>{wc}/{choice.textMaxWords} words</span>
													{/if}
												{/each}
												{#if choice.orDefaultOption}
													<div class="bg-choice-or-row">
														<span class="hint-small">Or:</span>
														<label class="bg-choice-pill" class:selected={bgChoice(choice.id) === choice.orDefaultOption.label}>
															<input type="radio" name={choice.id} value={choice.orDefaultOption.label}
																checked={bgChoice(choice.id) === choice.orDefaultOption.label}
																onchange={() => setBgChoice(choice.id, choice.orDefaultOption!.label)} />
															<span class="choice-label">{choice.orDefaultOption.label}</span>
														</label>
													</div>
												{/if}
											{/if}

											{#if choice.required && !bgChoice(choice.id)}
												<p class="field-error-inline">Required</p>
											{/if}
										</div>
									{/each}
								{/if}

								<div class="detail-section">
									<h4>Feature: {backgroundDef.feature.name}</h4>
									<p>{backgroundDef.feature.description}</p>
								</div>

								<!-- Suggested characteristics (flavor only) -->
								<div class="detail-section flavor-section">
									<h4>Suggested Characteristics</h4>
									<div class="flavor-grid">
										<div class="flavor-col">
											<h5>Personality Traits</h5>
											{#each backgroundDef.suggestedCharacteristics.personalityTraits.slice(0, 3) as t}
												<p class="flavor-item">"{t}"</p>
											{/each}
										</div>
										<div class="flavor-col">
											<h5>Ideals</h5>
											{#each backgroundDef.suggestedCharacteristics.ideals.slice(0, 3) as t}
												<p class="flavor-item">"{t}"</p>
											{/each}
										</div>
										<div class="flavor-col">
											<h5>Bonds</h5>
											{#each backgroundDef.suggestedCharacteristics.bonds.slice(0, 3) as t}
												<p class="flavor-item">"{t}"</p>
											{/each}
										</div>
										<div class="flavor-col">
											<h5>Flaws</h5>
											{#each backgroundDef.suggestedCharacteristics.flaws.slice(0, 3) as t}
												<p class="flavor-item">"{t}"</p>
											{/each}
										</div>
									</div>
								</div>

								{#if fieldError('background')}
									<p class="field-error">{fieldError('background')}</p>
								{/if}
								{#if fieldError('bgChoices')}
									<p class="field-error">{fieldError('bgChoices')}</p>
								{/if}
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 3 · ABILITIES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 3}
					<div class="scroll-pane">
						<div class="pane-content">
							<h3 class="section-title">Ability Scores</h3>
							<p class="section-desc">Choose a method and assign your base ability scores. Racial and flexible bonuses are applied automatically.</p>

							<div class="method-row">
								<button type="button" class="method-btn" class:selected={form.statMethod === 'standard'} onclick={() => setStatMethod('standard')}>
									<strong>Standard Array</strong>
									<small>{STANDARD_ARRAY.join(', ')}</small>
								</button>
								<button type="button" class="method-btn" class:selected={form.statMethod === 'point-buy'} onclick={() => setStatMethod('point-buy')}>
									<strong>Point Buy</strong>
									<small>27 points to spend</small>
								</button>
								<button type="button" class="method-btn" class:selected={form.statMethod === 'rolled'} onclick={() => setStatMethod('rolled')}>
									<strong>Rolled</strong>
									<small>4d6 drop lowest</small>
								</button>
							</div>

							{#if form.statMethod === 'rolled'}
								<div class="reroll-row">
									<button type="button" class="pill accent" onclick={rerollStats}>Reroll</button>
									<span class="hint">Roll #{rolledSeed}</span>
								</div>
							{/if}

							{#if form.statMethod === 'point-buy'}
								<div class="budget-bar" class:over={!pointBuySummary.valid && pointBuySummary.remaining < 0}>
									<span>Points spent: <strong>{pointBuySummary.spent}</strong> / 27</span>
									<span>Remaining: <strong>{pointBuySummary.remaining}</strong></span>
								</div>
								<p class="hint">Each score: 8 (0 pts) to 15 (9 pts) — total budget: 27 pts</p>
								<div class="spec-btn-row">
									<button
										type="button"
										class="spec-btn"
										title="Distributes 15–8 across your stats in the optimal order for your chosen class — primary ability gets the highest score, saves next. Spends exactly 27 points. You can still adjust afterwards."
										onclick={applyOptimalPointBuy}
										disabled={!classDef}
									>Optimal Class Spec</button>
									<button
										type="button"
										class="spec-btn"
										title="Randomly shuffles the values 15, 14, 13, 12, 10, 8 across your stats for an unpredictable build. Spends exactly 27 points."
										onclick={applyRandomPointBuy}
									>Randomized Spec</button>
								</div>
							{/if}

							<div class="ability-grid-builder" class:rolled={form.statMethod === 'rolled'}>
							{#each abilityOrder as ability}
								{@const base = form.abilityAssignment?.[ability] ?? 10}
								{@const racial = racialBonuses[ability] ?? 0}
								{@const flex = form.abilityChoiceBonuses?.[ability] ?? 0}
								{@const total = previewAbilities[ability]}
								{@const mod = abilityModifier(total)}
								<div class="ability-builder-card" class:rolled-card={form.statMethod === 'rolled'}>
									<div class="ab-left">
										<span class="ab-label">{abilityLabels[ability]}</span>
										{#if form.statMethod === 'point-buy'}
											<div class="ab-control">
												<button type="button" class="ab-btn" onclick={() => updateAbility(ability, String(base - 1))}>-</button>
												<span class="ab-value">{base}</span>
												<button type="button" class="ab-btn" onclick={() => updateAbility(ability, String(base + 1))}>+</button>
											</div>
										{:else if form.statMethod === 'standard'}
											<div class="ab-drop-slot"
												class:occupied={standardSlots[ability] !== undefined}
												class:drag-over={dragOverTarget === ability}
												ondragover={(e) => { e.preventDefault(); dragOverTarget = ability; }}
												ondragleave={() => { if (dragOverTarget === ability) dragOverTarget = null; }}
												ondrop={() => dropOnSlot(ability)}>
												{#if standardSlots[ability] !== undefined}
													<div class="pool-chip in-slot"
														draggable="true"
														ondragstart={() => startDrag({ value: standardSlots[ability]!, from: 'slot', ability })}
														ondragend={endDrag}>
														{standardSlots[ability]}
													</div>
												{:else}
													<span class="drop-hint">drop here</span>
												{/if}
											</div>
										{/if}
										<div class="ab-breakdown">
											{#if racial !== 0}<span class="ab-bonus">+{racial} racial</span>{/if}
											{#if flex !== 0}<span class="ab-bonus">+{flex} flex</span>{/if}
										</div>
										<div class="ab-total">
											<strong>{total}</strong>
											<span class="ab-mod">({mod >= 0 ? '+' : ''}{mod})</span>
										</div>
									</div>
									{#if form.statMethod === 'rolled' && rolledDice[ability].length > 0}
										{@const d = rolledDice[ability]}
										<div class="dice-display">
											<span class="dice-rolled">{d[3]} · {d[2]} · {d[1]} · <s>{d[0]}</s></span>
											<span class="dice-calc">kept: {d[1]}+{d[2]}+{d[3]} = {d[1]+d[2]+d[3]}</span>
										</div>
									{/if}
									</div>
								{/each}
							</div>

							{#if form.statMethod === 'standard'}
								<div class="standard-pool"
									class:drag-over-pool={dragOverTarget === 'pool'}
									ondragover={(e) => { e.preventDefault(); dragOverTarget = 'pool'; }}
									ondragleave={() => { if (dragOverTarget === 'pool') dragOverTarget = null; }}
									ondrop={() => dropOnPool()}>
									{#each standardPool as val (val)}
										<div class="pool-chip"
											draggable="true"
											ondragstart={() => startDrag({ value: val, from: 'pool' })}
											ondragend={endDrag}>
											{val}
										</div>
									{/each}
									{#if standardPool.length === 0}
										<span class="pool-empty">All values assigned</span>
									{/if}
								</div>
								<div class="spec-btn-row">
									<button
										type="button"
										class="spec-btn"
										title="Assigns the standard array values in an order optimized for your chosen class — primary stat gets the highest value, save proficiencies next. You can still drag to adjust afterwards."
										onclick={applyOptimalSpec}
										disabled={!classDef}
									>Optimal Class Spec</button>
									<button
										type="button"
										class="spec-btn"
										title="Randomly shuffles all six standard array values across your ability scores for a wildcard build."
										onclick={applyRandomSpec}
									>Randomized Spec</button>
								</div>
								<p class="standard-hint">Assign the values {STANDARD_ARRAY.join(', ')} to your abilities in any order.</p>
							{/if}
							{#if fieldError('abilityAssignment')}
								<p class="field-error">{fieldError('abilityAssignment')}</p>
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 4 · SKILLS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 4}
					<div class="scroll-pane">
						<div class="pane-content">
							<h3 class="section-title">Skills &amp; Languages</h3>

							<!-- Granted skills (locked) -->
							{#if backgroundSkills.length > 0 || fixedRacialSkills.length > 0}
								<div class="skill-section">
									<h4>Already Proficient</h4>
									<p class="hint">Granted by your background and race — these are locked in.</p>
									<div class="pill-row">
										{#each backgroundSkills as sk}
											<span class="pill locked">{formatLabel(sk)}</span>
										{/each}
										{#each fixedRacialSkills as sk}
											<span class="pill locked">{formatLabel(sk)}</span>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Class skills -->
							<div class="skill-section">
								<h4>Class Skills <span class="counter">{form.chosenSkills.length}/{classSkillPickCount}</span></h4>
								<p class="hint">Choose {classSkillPickCount} from your class list.</p>
								<div class="pill-row">
									{#each classSkillOptions as sk}
										<button
											type="button"
											class="pill"
											class:selected={form.chosenSkills.includes(sk)}
											disabled={!form.chosenSkills.includes(sk) && !classSkillChoicesAvailable.includes(sk)}
											onclick={() => toggleSkill(sk, 'chosenSkills', classSkillPickCount)}
										>
											{formatLabel(sk)}
										</button>
									{/each}
								</div>
								{#if fieldError('chosenSkills')}
									<p class="field-error">{fieldError('chosenSkills')}</p>
								{/if}
							</div>

							<!-- Bonus racial skills -->
							{#if bonusSkillChoicesRequired > 0}
								<div class="skill-section">
									<h4>Bonus Racial Skills <span class="counter">{(form.bonusSkillChoices ?? []).length}/{bonusSkillChoicesRequired}</span></h4>
									<p class="hint">Choose {bonusSkillChoicesRequired} additional skill{bonusSkillChoicesRequired === 1 ? '' : 's'}.</p>
									<div class="pill-row">
										{#each allSkills as sk}
											<button
												type="button"
												class="pill"
												class:selected={(form.bonusSkillChoices ?? []).includes(sk)}
												disabled={!(form.bonusSkillChoices ?? []).includes(sk) && !bonusSkillChoicesAvailable.includes(sk)}
												onclick={() => toggleSkill(sk, 'bonusSkillChoices', bonusSkillChoicesRequired)}
											>
												{formatLabel(sk)}
											</button>
										{/each}
									</div>
									{#if fieldError('bonusSkillChoices')}
										<p class="field-error">{fieldError('bonusSkillChoices')}</p>
									{/if}
								</div>
							{/if}

							<!-- Extra languages -->
							{#if extraLanguageChoices > 0}
								<div class="skill-section">
									<h4>Extra Languages <span class="counter">{(form.chosenLanguages ?? []).length}/{extraLanguageChoices}</span></h4>
									<div class="tag-row tight">
										<span class="hint">Already speak:</span>
										{#each baseLanguages as lang}
											<span class="pill locked small">{lang}</span>
										{/each}
									</div>
									<p class="hint">Choose {extraLanguageChoices} additional language{extraLanguageChoices === 1 ? '' : 's'}.</p>
									<div class="pill-row">
										{#each availableLanguageChoices as lang}
											<button
												type="button"
												class="pill"
												class:selected={(form.chosenLanguages ?? []).includes(lang)}
												onclick={() => toggleLanguage(lang)}
											>
												{lang}
											</button>
										{/each}
									</div>
									{#if fieldError('chosenLanguages')}
										<p class="field-error">{fieldError('chosenLanguages')}</p>
									{/if}
								</div>
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 5 · MAGIC & GEAR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 5}
					<div class="scroll-pane">
						<div class="pane-content">
							<h3 class="section-title">Magic &amp; Starting Equipment</h3>

							<!-- Expertise selection (Rogue and future expertise classes) -->
							{#if expertiseCount > 0}
								<div class="gear-section">
									<h4>Expertise</h4>
									<div class="spell-group">
										<div class="spell-group-header">
											<span>Choose {expertiseCount} skills to double your proficiency bonus</span>
											<span class="counter">{(form.expertiseChoices ?? []).length}/{expertiseCount}</span>
										</div>
										<div class="pill-row">
											{#each expertisePool as skill}
												<button type="button" class="pill" class:selected={(form.expertiseChoices ?? []).includes(skill)} onclick={() => toggleExpertise(skill)}>
													{formatLabel(skill)}
												</button>
											{/each}
										</div>
										{#if fieldError('expertiseChoices')}
											<p class="field-error">{fieldError('expertiseChoices')}</p>
										{/if}
									</div>
								</div>
							{/if}

							<!-- Spell sections -->
							{#if expectedCantripCount > 0 || knownSpellCount > 0 || preparedSpellCount > 0}
								<div class="gear-section">
									<h4>Spell Choices</h4>

									{#if expectedCantripCount > 0}
										<div class="spell-group">
											<div class="spell-group-header">
												<span>Cantrips</span>
												<span class="counter">{(form.spellChoices?.cantrips ?? []).length}/{expectedCantripCount}</span>
											</div>
											<div class="pill-row">
												{#each cantripChoices as spell}
													<button type="button" class="pill" class:selected={(form.spellChoices?.cantrips ?? []).includes(spell)} onclick={() => toggleSpell('cantrips', spell, expectedCantripCount)}>
														{formatLabel(spell)}
													</button>
												{/each}
											</div>
											{#if fieldError('spellChoices.cantrips')}
												<p class="field-error">{fieldError('spellChoices.cantrips')}</p>
											{/if}
										</div>
									{/if}

									{#if knownSpellCount > 0}
										<div class="spell-group">
											<div class="spell-group-header">
												<span>Level 1 Spells Known</span>
												<span class="counter">{(form.spellChoices?.knownSpells ?? []).length}/{knownSpellCount}</span>
											</div>
											<div class="pill-row">
												{#each knownSpellChoices as spell}
													<button type="button" class="pill" class:selected={(form.spellChoices?.knownSpells ?? []).includes(spell)} onclick={() => toggleSpell('knownSpells', spell, knownSpellCount)}>
														{formatLabel(spell)}
													</button>
												{/each}
											</div>
											{#if fieldError('spellChoices.knownSpells')}
												<p class="field-error">{fieldError('spellChoices.knownSpells')}</p>
											{/if}
										</div>
									{/if}

									{#if preparedSpellCount > 0}
										<div class="spell-group">
											<div class="spell-group-header">
												<span>Prepared Spells</span>
												<span class="counter">{(form.spellChoices?.preparedSpells ?? []).length}/{preparedSpellCount}</span>
											</div>
											<div class="pill-row">
												{#each (form.class === 'wizard' ? (form.spellChoices?.knownSpells ?? []) : knownSpellChoices) as spell}
													<button type="button" class="pill" class:selected={(form.spellChoices?.preparedSpells ?? []).includes(spell)} onclick={() => toggleSpell('preparedSpells', spell, preparedSpellCount)}>
														{formatLabel(spell)}
													</button>
												{/each}
											</div>
											{#if fieldError('spellChoices.preparedSpells')}
												<p class="field-error">{fieldError('spellChoices.preparedSpells')}</p>
											{/if}
										</div>
									{/if}
								</div>
							{:else}
								<p class="hint">Your class has no spellcasting at level 1.</p>
							{/if}

							<!-- Equipment choices -->
							{#if classDef?.equipmentChoices.length}
								<div class="gear-section">
									<h4>Starting Equipment</h4>
									{#each classDef.equipmentChoices as choice, choiceIdx}
										{@const selectedOptIdx = form.equipmentSelections?.[choiceIdx] ?? -1}
										{@const selectedOption = selectedOptIdx >= 0 ? (choice.options[selectedOptIdx] ?? []) : []}
										{@const rowOpen = isPanelOpen(choiceIdx)}
										{@const armorEntry = getArmorInOption(selectedOption)}
										{@const shieldPresent = hasShieldInOption(selectedOption)}
										{@const packEntry = getPackInOption(selectedOption)}
										{@const weaponPH = getWeaponPlaceholderInOption(selectedOption)}
										{@const instPH = getInstrumentPlaceholderInOption(selectedOption)}
										{@const pickCount = weaponPH ? parsePlaceholderCount(weaponPH) : 1}
										{@const subPicks = getSubPicks(choiceIdx)}
										{@const concreteWeapons = getConcreteWeaponsInOption(selectedOption)}
										<div class="equip-group">
											<span class="equip-label">{choice.label}</span>
											<div class="equip-options">
												{#each choice.options as option, optIdx}
													{@const isSelected = selectedOptIdx === optIdx}
													{@const optPH = getWeaponPlaceholderInOption(option)}
													{@const optPC = optPH ? parsePlaceholderCount(optPH) : 1}
													<button
														type="button"
														class="equip-card"
														class:selected={isSelected}
														onclick={() => selectEquipmentOption(choiceIdx, optIdx)}
													>
														{option.join(' + ')}
														{#if isSelected && optPC > 1}
															<span class="pick-count-badge">{subPicks.length}/{optPC}</span>
														{/if}
													</button>
												{/each}
											</div>
											{#if rowOpen}
												{#if armorEntry}
													{@const acData = computeArmorAC(armorEntry)}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-row">
																<strong>{armorEntry.displayName}</strong>
																<span class="armor-type-tag">{armorEntry.type}</span>
																<span class="ac-formula">AC {acData.total} ({acData.formula})</span>
															</span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
													</div>
												{/if}
												{#if shieldPresent}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-row">
																<strong>Shield</strong>
																<span class="armor-type-tag">Shield</span>
																<span class="ac-formula">+2 AC bonus · Cannot be used with two-handed weapons.</span>
															</span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
													</div>
												{/if}
												{#if packEntry}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-title"><strong>{packEntry.displayName}</strong></span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
														<ul class="equip-pack-contents">
															{#each packEntry.contents ?? [] as item}
																<li>{item}</li>
															{/each}
														</ul>
													</div>
												{/if}
												{#if concreteWeapons.length > 0 && !weaponPH && !instPH}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-title"><strong>Weapons Included</strong></span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
														<div class="equip-weapon-list">
															<div class="weapon-header-row">
																<span class="wcol-name">Weapon</span>
																<span class="wcol-damage">Damage</span>
																<span class="wcol-stat">Stat</span>
																<span class="wcol-tags">Properties</span>
															</div>
															{#each concreteWeapons as weapon}
																{@const primary = weaponPrimaryStat(weapon)}
																{@const wCount = concreteWeaponCount(weapon, selectedOption)}
																{@const specialText = getWeaponSpecialText(weapon)}
																<div class="equip-weapon-row readonly">
																	<span class="wcol-name">
																		{weapon.displayName}
																		{#if wCount > 1}<span class="weapon-sel-badge weapon-sel-double">×{wCount}</span>{/if}
																	</span>
																	<span class="wcol-damage">
																		{#if weapon.damage === '0'}<span class="damage-none">—</span>
																		{:else}{weapon.damage} <span class="damage-type">{weapon.damageType}</span>{/if}
																	</span>
																	<span class="wcol-stat">{primary}</span>
																	<span class="wcol-tags">
																		{#each getWeaponDisplayTags(weapon) as tag}
																			<span class="weapon-tag {getTagClass(tag)}" title={WEAPON_TAG_TOOLTIPS[tag]}>{tag}</span>
																		{/each}
																	</span>
																	{#if specialText}
																		<span class="weapon-special"><em>Special:</em> {specialText}</span>
																	{/if}
																</div>
															{/each}
														</div>
													</div>
												{/if}
												{#if weaponPH}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-title">
																<strong>{weaponPH}</strong>
																{#if pickCount > 1}
																	<span class="pick-count-badge">{subPicks.length}/{pickCount}</span>
																{/if}
															</span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
														<div class="equip-weapon-list">
															<div class="weapon-header-row">
																<span class="wcol-name">Weapon</span>
																<span class="wcol-damage">Damage</span>
																<span class="wcol-stat">Stat</span>
																<span class="wcol-tags">Properties</span>
															</div>
															{#each getWeaponsForPlaceholder(weaponPH) as weapon}
																{@const primary = weaponPrimaryStat(weapon)}
																{@const selCount = subPicks.filter(n => n === weapon.displayName).length}
																{@const specialText = getWeaponSpecialText(weapon)}
																<button
																	type="button"
																	class="equip-weapon-row"
																	class:selected={selCount > 0}
																	onclick={() => toggleSubPick(choiceIdx, weapon.displayName, pickCount)}
																>
																	<span class="wcol-name">
																		{weapon.displayName}
																		{#if selCount > 0}
																			<span class="weapon-sel-badge" class:weapon-sel-double={selCount > 1}>
																				{#if selCount > 1}×{selCount}{:else}✓{/if}
																			</span>
																		{/if}
																	</span>
																	<span class="wcol-damage">
																		{#if weapon.damage === '0'}<span class="damage-none">—</span>
																		{:else}{weapon.damage} <span class="damage-type">{weapon.damageType}</span>{/if}
																	</span>
																	<span class="wcol-stat">{primary}</span>
																	<span class="wcol-tags">
																		{#each getWeaponDisplayTags(weapon) as tag}
																			<span class="weapon-tag {getTagClass(tag)}" title={WEAPON_TAG_TOOLTIPS[tag]}>{tag}</span>
																		{/each}
																	</span>
																	{#if specialText}
																		<span class="weapon-special"><em>Special:</em> {specialText}</span>
																	{/if}
																</button>
															{/each}
														</div>
													</div>
												{/if}
												{#if instPH}
													<div class="equip-detail-panel">
														<div class="equip-detail-header">
															<span class="equip-detail-title"><strong>Choose an Instrument</strong></span>
															<button type="button" class="equip-detail-caret" onclick={() => closePanelManually(choiceIdx)} aria-label="Close panel">▲</button>
														</div>
														<div class="equip-weapon-list equip-instrument-list">
															<div class="weapon-header-row">
																<span class="wcol-name">Instrument</span>
																<span class="wcol-damage"></span>
																<span class="wcol-stat">Stat</span>
																<span class="wcol-tags">Type</span>
															</div>
															{#each INSTRUMENTS as instrument}
																{@const iChosen = subPicks[0] === instrument}
																<button
																	type="button"
																	class="equip-weapon-row"
																	class:selected={iChosen}
																	onclick={() => setSubPick(choiceIdx, [instrument])}
																>
																	<span class="wcol-name">
																		{instrument}
																		{#if iChosen}<span class="weapon-sel-badge">✓</span>{/if}
																	</span>
																	<span class="wcol-damage"><span class="damage-none">—</span></span>
																	<span class="wcol-stat">CHA</span>
																	<span class="wcol-tags"><span class="weapon-tag">Instrument</span></span>
																</button>
															{/each}
														</div>
													</div>
												{/if}
											{/if}
										</div>
									{/each}
									{#if fieldError('equipmentSelections')}
										<p class="field-error">{fieldError('equipmentSelections')}</p>
									{/if}
								</div>
							{/if}

							<!-- Guaranteed items automatically granted to this class -->
							{#if classDef?.startingEquipment && classDef.startingEquipment.length > 0}
								<div class="gear-section">
									<h4>Guaranteed Equipment</h4>
									<p class="equip-guaranteed-note">Every {classDef.displayName} starts with these automatically.</p>
									<div class="equip-options">
										{#each classDef.startingEquipment as item}
											<span class="pill selected">{item}</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>

				<!-- â•â• STEP 6 · IDENTITY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• -->
				{:else if currentStep === 6}
					<div class="scroll-pane">
						<div class="pane-content identity-pane">
							<h3 class="section-title">Name Your Adventurer</h3>
							<p class="section-desc">The final touch. Give your character a name, alignment, and a sentence or two of backstory.</p>

							<div class="identity-name">
								<input
									class="name-input"
									type="text"
									bind:value={form.name}
									maxlength="40"
									placeholder="Aria Stormborn"
								/>
							</div>

							<div class="alignment-grid">
								{#each alignments as al}
									<button type="button" class="alignment-cell" class:selected={form.alignment === al.value} onclick={() => (form.alignment = al.value as any)}>{al.label}</button>
								{/each}
							</div>

							<label class="backstory-label">
								<span>Backstory <span class="hint">(optional)</span></span>
								<textarea bind:value={form.backstory} rows="3" placeholder="A few lines about where this adventurer came from."></textarea>
							</label>

							{#if fieldError('name', 'alignment', 'backstory')}
								<p class="field-error">{fieldError('name', 'alignment', 'backstory')}</p>
							{/if}

							<!-- Character summary -->
							<div class="summary-card">
								<div class="summary-header">
									<h4>{form.name || 'Unnamed Adventurer'}</h4>
									<span class="hint">{raceDef?.displayName}{form.subrace ? ` (${subraceDef?.displayName ?? formatLabel(form.subrace)})` : ''} · {classDef?.displayName} · {backgroundDef?.displayName ?? '—'}</span>
								</div>
								<div class="summary-stats">
									{#each abilityOrder as ab}
										<div class="summary-stat">
											<span class="stat-label">{abilityLabels[ab]}</span>
											<strong>{previewAbilities[ab]}</strong>
											<span class="stat-mod">{abilityModifier(previewAbilities[ab]) >= 0 ? '+' : ''}{abilityModifier(previewAbilities[ab])}</span>
										</div>
									{/each}
								</div>
								<div class="summary-details">
									<span>Skills: {[...backgroundSkills, ...fixedRacialSkills, ...form.chosenSkills, ...(form.bonusSkillChoices ?? [])].map(formatLabel).join(', ') || '—'}</span>
									<span>Languages: {[...baseLanguages, ...(form.chosenLanguages ?? [])].join(', ')}</span>
								</div>
							</div>
						</div>
					</div>
				{/if}
				</div>

				<!-- â”€â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
				<footer class="cc-footer">
					<div class="footer-left">
						<span class="footer-step">{currentStep + 1}/{steps.length}</span>
						<span class="footer-label">{steps[currentStep].label}</span>
					</div>
					<div class="footer-actions">
						{#if currentStep > 0}
							<button type="button" class="btn secondary" onclick={previousStep}>Back</button>
						{/if}
						{#if currentStep < steps.length - 1}
							<button type="button" class="btn primary" onclick={nextStep}>Continue</button>
						{:else}
							<button type="button" class="btn primary" onclick={submitCharacter} disabled={submitting}>
								{submitting ? 'Creating…' : 'Create Character'}
							</button>
						{/if}
					</div>
				</footer>
			</div>
		</div>
	</div>
{/if}

<style>
	/* â”€â”€ Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	h2, h3, h4, h5, p, strong, small, span { margin: 0; }
	button { font: inherit; }

	/* â”€â”€ Sidebar card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.sidebar-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.sidebar-desc { color: var(--text-muted); font-size: 0.92rem; }
	.launch-btn {
		padding: 0.7rem 1rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		cursor: pointer;
	}

	/* â”€â”€ Backdrop / Shell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.cc-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: var(--cc-backdrop);
		backdrop-filter: blur(16px);
	}
	.cc-shell {
		width: 100%;
		height: 100%;
		max-width: 1440px;
		max-height: calc(100vh - 1rem);
		display: flex;
		flex-direction: column;
		border-radius: 20px;
		border: 1px solid var(--border);
		background: var(--bg);
		box-shadow: 0 32px 80px rgba(0,0,0,0.55);
		overflow: hidden;
	}

	/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.cc-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.65rem 1.1rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.header-left {
		min-width: 0;
		flex-shrink: 0;
	}
	.header-left h2 {
		font-size: 1.15rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.eyebrow {
		font-size: 0.65rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.step-rail {
		display: flex;
		align-items: center;
		gap: 0;
		flex: 1;
		justify-content: center;
	}
	.step-node {
		width: 1.85rem;
		height: 1.85rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 600;
		border: 1.5px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}
	.step-node.active {
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		border-color: color-mix(in srgb, var(--accent) 50%, transparent);
		color: var(--accent);
	}
	.step-node.done {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.step-node.error {
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
	}
	.step-line {
		width: 1.6rem;
		height: 2px;
		background: var(--border);
		flex-shrink: 0;
	}
	.step-line.filled { background: color-mix(in srgb, var(--accent) 40%, transparent); }

	.close-btn {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--bg-alt);
		color: var(--text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.close-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* â”€â”€ Error strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.error-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		padding: 0.55rem 1.1rem;
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
		font-size: 0.88rem;
		flex-shrink: 0;
	}
	.err-item { color: var(--danger); }

	/* â”€â”€ Body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.cc-body {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
	}

	/* â”€â”€ Split pane (ancestry, class, background) â”€â”€â”€ */
	.split-pane {
		display: grid;
		grid-template-columns: 320px 1fr;
		width: 100%;
		min-height: 0;
	}
	.option-list {
		overflow-y: auto;
		border-right: 1px solid var(--border);
		padding: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.list-header {
		padding: 0.5rem 0.65rem 0.35rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.option-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border-radius: 12px;
		border: 1px solid transparent;
		background: transparent;
		text-align: left;
		color: var(--text);
		cursor: pointer;
		transition: all 0.12s;
	}
	.option-row:hover { background: var(--bg-alt); }
	.option-row.selected {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.option-row strong { font-size: 0.95rem; }
	.bg-option-row {
		gap: 0.25rem;
		padding: 0.75rem 0.85rem;
	}
	.bg-option-row .option-sub {
		-webkit-line-clamp: unset;
		overflow: visible;
		white-space: normal;
	}
	.bg-additions {
		opacity: 0.72;
	}
	.option-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.option-sub-stats {
		font-size: 0.72rem;
		color: var(--text-muted);
		opacity: 0.8;
	}
	.row-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.badge {
		font-size: 0.72rem;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--accent);
		white-space: nowrap;
	}
	.hit-die-label {
		font-size: 0.72rem;
		color: var(--text-muted);
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	/* â”€â”€ Detail pane â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.detail-pane {
		overflow-y: auto;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.detail-title { font-size: 1.4rem; font-weight: 600; }
	.detail-desc { color: var(--text-muted); line-height: 1.55; }
	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.equip-columns {
		display: flex;
		gap: 0.5rem 1.5rem;
		align-items: flex-start;
	}
	.equip-columns .equip-list { flex: 1; }
	.equip-list {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.equip-list li {
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.4;
	}
	.detail-section h4 {
		font-size: 0.85rem;
		color: var(--accent);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* â”€â”€ Tags / chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.tag-row.tight { gap: 0.3rem; }
	.tag {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-alt);
		border: 1px solid var(--border);
		font-size: 0.78rem;
		color: var(--text);
		white-space: nowrap;
	}
	.tag.accent {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border-color: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent);
	}

	/* â”€â”€ Traits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.trait-entry {
		padding: 0.55rem 0.75rem;
		border-radius: 12px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.trait-entry strong { font-size: 0.88rem; }
	.trait-entry p {
		font-size: 0.84rem;
		color: var(--text-muted);
		line-height: 1.45;
		margin-top: 0.15rem;
	}

	/* â”€â”€ Choice cards (subraces, feats, equipment) â”€â”€ */
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.choice-card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		text-align: left;
		color: var(--text);
		cursor: pointer;
		transition: all 0.12s;
	}
	.choice-card:hover { background: var(--bg-alt); }
	.choice-card.selected {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.choice-card.flat {
		cursor: default;
		border: 1px solid var(--border);
		background: var(--surface);
	}
	.choice-card small { font-size: 0.8rem; color: var(--text-muted); }

	/* ── Dragonborn 2-column subrace grid ───────────────────── */
	.subrace-dragon-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}
	.dragon-col-header {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		text-align: center;
		padding: 0.2rem 0;
	}
	.dragon-empty { /* grid placeholder — keeps column alignment */ }
	.dragon-sep {
		grid-column: 1 / -1;
		border-top: 1px solid var(--border);
		margin: 0.15rem 0;
		opacity: 0.5;
	}

	/* â”€â”€ Proficiency grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.prof-grid {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.prof-item {
		font-size: 0.88rem;
		color: var(--text);
	}
	.prof-item strong {
		color: var(--text);
		margin-right: 0.3rem;
	}

	/* â”€â”€ Pill buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.pill {
		padding: 0.38rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-alt);
		color: var(--text);
		cursor: pointer;
		font-size: 0.88rem;
		transition: all 0.12s;
	}
	.pill:hover:not(:disabled):not(.locked) { background: var(--surface); }
	.pill.selected {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.pill.accent {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.pill:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pill.locked {
		opacity: 0.55;
		cursor: default;
		border-style: dashed;
	}
	.pill.locked.small { font-size: 0.78rem; padding: 0.25rem 0.55rem; }

	/* â”€â”€ Scroll pane (full-width steps) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.scroll-pane {
		width: 100%;
		height: 100%;
		overflow-y: auto;
	}
	.pane-content {
		max-width: 860px;
		margin: 0 auto;
		padding: 1.5rem 1.75rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.section-title { font-size: 1.3rem; font-weight: 600; }
	.section-desc { color: var(--text-muted); line-height: 1.5; }

	/* â”€â”€ Hints / errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.hint { color: var(--text-muted); font-size: 0.84rem; }
	.hint.muted { opacity: 0.65; }
	.field-error {
		color: var(--danger);
		font-size: 0.88rem;
	}

	/* ── Background equipment choices ───────────────────────────── */
	.bg-choice-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}
	.bg-choice-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.2rem;
	}
	.bg-choice-pill {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.3rem 0.65rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		cursor: pointer;
		background: var(--bg-alt);
		transition: background 0.12s, border-color 0.12s;
	}
	.bg-choice-pill.selected {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
		background: color-mix(in srgb, var(--accent) 13%, transparent);
	}
	.bg-choice-pill input[type='radio'] { display: none; }
	.choice-label { font-size: 0.82rem; color: var(--text); }
	.choice-desc { font-size: 0.72rem; color: var(--text-muted); font-style: italic; }
	.bg-text-input {
		width: 100%;
		min-height: 3.2rem;
		resize: vertical;
		background: var(--bg-alt);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		font-size: 0.82rem;
		color: var(--text);
		font-family: inherit;
		margin-top: 0.2rem;
	}
	.bg-text-input.optional-input { opacity: 0.72; }
	.bg-choice-or-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.hint-small { font-size: 0.78rem; color: var(--text-muted); }
	.char-counter {
		font-size: 0.7rem;
		color: var(--text-muted);
		text-align: right;
	}
	.char-counter.over { color: var(--danger, #e44); }
	.field-error-inline {
		font-size: 0.75rem;
		color: var(--danger, #e44);
		margin-top: 0.15rem;
	}
	.counter {
		font-weight: 600;
		font-size: 0.82rem;
		color: var(--accent);
		margin-left: 0.4rem;
	}

	/* â”€â”€ Ability Builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.method-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.65rem;
	}
	.method-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.65rem 0.75rem;
		border-radius: 14px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: center;
		transition: all 0.12s;
	}
	.method-btn:hover { background: var(--bg-alt); }
	.method-btn.selected {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.method-btn small { font-size: 0.78rem; color: var(--text-muted); }

	.reroll-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.budget-bar {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0.85rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
		font-size: 0.88rem;
	}
	.budget-bar.over {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border-color: color-mix(in srgb, var(--danger) 20%, transparent);
		color: var(--danger);
	}

	.ability-grid-builder {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.65rem;
	}
	.ability-builder-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.65rem 0.35rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.ab-label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.ab-control {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.ab-btn {
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--bg-alt);
		color: var(--text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
	}
	.ab-btn:disabled { opacity: 0.3; cursor: not-allowed; }
	.ab-value {
		width: 2.8rem;
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
	}
	.ab-breakdown {
		display: flex;
		gap: 0.25rem;
		min-height: 1rem;
	}
	.ab-bonus {
		font-size: 0.7rem;
		color: var(--accent);
	}
	.ab-total { text-align: center; }
	.ab-total strong { font-size: 1.25rem; }
	.ab-mod { font-size: 0.8rem; color: var(--text-muted); margin-left: 0.15rem; }
	.ab-left {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}
	.ability-grid-builder.rolled { grid-template-columns: repeat(3, 1fr); }
	.ability-builder-card.rolled-card {
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		padding: 0.85rem 0.9rem;
		min-height: 5rem;
		gap: 0.5rem;
	}
	.dice-display {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
		flex: 1;
	}
	.dice-rolled {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-family: monospace;
		letter-spacing: 0.03em;
	}
	.dice-rolled s {
		color: var(--danger);
		text-decoration-color: var(--danger);
	}
	.dice-calc { font-size: 0.78rem; color: var(--accent); }

	/* ── Standard array drag-and-drop ──────────────────────────── */
	.standard-pool {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		border-radius: 14px;
		border: 1px dashed var(--border);
		min-height: 3.2rem;
		align-items: center;
		transition: background 0.12s, border-color 0.12s;
	}
	.standard-pool.drag-over-pool {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.pool-chip {
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--bg-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1rem;
		cursor: grab;
		user-select: none;
		transition: background 0.1s, transform 0.1s;
	}
	.pool-chip:active { cursor: grabbing; transform: scale(1.08); }
	.pool-chip.in-slot { background: color-mix(in srgb, var(--accent) 18%, transparent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
	.pool-empty { color: var(--text-muted); font-size: 0.8rem; font-style: italic; }
	.ab-drop-slot {
		width: 100%;
		min-height: 2.6rem;
		border-radius: 10px;
		border: 1px dashed var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.12s, background 0.12s;
	}
	.ab-drop-slot.drag-over { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
	.drop-hint { font-size: 0.72rem; color: var(--text-muted); font-style: italic; }
	.standard-hint { font-size: 1rem; color: var(--text-muted); text-align: center; margin-top: 0.25rem; }
	.spec-btn-row {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 0.6rem;
	}
	.spec-btn {
		font-size: 0.75rem;
		padding: 0.3rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}
	.spec-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 50%, transparent);
	}
	.spec-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* â”€â”€ Skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.skill-section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.85rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.skill-section h4 {
		display: flex;
		align-items: center;
	}

	/* â”€â”€ Spell / Gear sections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.gear-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.equip-guaranteed-note {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
	}
	.spell-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.spell-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.88rem;
		font-weight: 600;
	}

	.equip-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.equip-label {
		font-size: 0.84rem;
		font-weight: 600;
		color: var(--text);
	}
	.equip-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.equip-card {
		padding: 0.5rem 0.85rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		font-size: 0.88rem;
		text-align: left;
		transition: all 0.12s;
	}
	.equip-card:hover { background: var(--bg-alt); }
	.equip-card.selected {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--accent);
	}

	/* ── Equipment detail panels ────────────────────────────────────────── */
	.equip-detail-panel {
		margin-top: 0.35rem;
		padding: 0.55rem 0.7rem;
		border-radius: 10px;
		background: var(--bg-alt);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.equip-detail-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.equip-detail-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.83rem;
		color: var(--text);
	}
	.equip-detail-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.83rem;
		color: var(--text);
	}
	.armor-type-tag {
		padding: 0.1rem 0.4rem;
		border-radius: 6px;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		font-size: 0.73rem;
		text-transform: capitalize;
	}
	.ac-formula {
		color: var(--text-muted);
		font-size: 0.79rem;
	}
	.equip-detail-caret {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.78rem;
		padding: 0 0.2rem;
		line-height: 1;
		flex-shrink: 0;
		margin-top: 0.05rem;
	}
	.equip-detail-caret:hover { color: var(--text); }
	.equip-pack-contents {
		margin: 0;
		padding: 0 0 0 1rem;
		list-style: disc;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.equip-pack-contents li {
		font-size: 0.79rem;
		color: var(--text-muted);
	}

	/* ── Weapon / instrument list ── */
	.equip-weapon-list {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 0.35rem;
	}
	.weapon-header-row,
	.equip-weapon-row {
		display: grid;
		grid-template-columns: 2fr 1.4fr 0.5fr 2.4fr;
		gap: 0.45rem;
		align-items: center;
	}
	.weapon-header-row {
		padding: 0.18rem 0.55rem;
		font-size: 0.69rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.equip-weapon-row {
		padding: 0.28rem 0.55rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, border-color 0.1s, opacity 0.15s;
		font-size: 0.82rem;
		width: 100%;
	}
	.equip-weapon-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
	.equip-weapon-row.selected {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.equip-weapon-row.selected .damage-type { color: color-mix(in srgb, var(--accent) 65%, white); }
	.equip-weapon-row.readonly {
		cursor: default;
		pointer-events: none;
		border-color: transparent;
		background: transparent;
	}
	.equip-instrument-list .weapon-header-row,
	.equip-instrument-list .equip-weapon-row {
		grid-template-columns: 2fr 0.6fr 0.5fr 1.5fr;
	}

	/* Weapon selection badge */
	.weapon-sel-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.18rem;
		border-radius: 50%;
		background: var(--accent);
		color: #fff;
		font-size: 0.66rem;
		font-weight: 700;
		margin-left: 0.25rem;
		vertical-align: middle;
		line-height: 1;
	}
	.weapon-sel-badge.weapon-sel-double {
		border-radius: 8px;
		padding: 0 0.3rem;
		box-shadow: 0 0 7px color-mix(in srgb, var(--accent) 80%, transparent),
		            0 0 2px var(--accent);
	}

	/* Weapon tag pills */
	.weapon-tag {
		display: inline-block;
		padding: 0.07rem 0.32rem;
		border-radius: 5px;
		background: color-mix(in srgb, var(--bg-alt, var(--surface)) 80%, transparent);
		border: 1px solid var(--border);
		font-size: 0.68rem;
		color: var(--text-muted);
		white-space: nowrap;
		margin-right: 0.18rem;
	}
	/* Tag color coding */
	.tag-one-handed  { background: #ffffff; border-color: #cccccc; color: #111111; }
	.tag-two-handed  { background: color-mix(in srgb, #e05555 15%, transparent); border-color: color-mix(in srgb, #e05555 40%, transparent); color: #e05555; }
	.tag-ranged      { background: color-mix(in srgb, #4caf50 15%, transparent); border-color: color-mix(in srgb, #4caf50 40%, transparent); color: #4caf50; }
	.tag-reach       { background: color-mix(in srgb, #2196f3 15%, transparent); border-color: color-mix(in srgb, #2196f3 40%, transparent); color: #2196f3; }
	.tag-finesse     { background: color-mix(in srgb, #ab47bc 15%, transparent); border-color: color-mix(in srgb, #ab47bc 40%, transparent); color: #ab47bc; }
	.tag-versatile   { background: color-mix(in srgb, #ffb300 15%, transparent); border-color: color-mix(in srgb, #ffb300 40%, transparent); color: #ffb300; }
	.tag-heavy       { background: color-mix(in srgb, #fb8c00 15%, transparent); border-color: color-mix(in srgb, #fb8c00 40%, transparent); color: #fb8c00; }
	.damage-type { color: var(--text-muted); font-size: 0.78rem; }
	.damage-none { color: var(--text-muted); font-style: italic; }
	/* Special: descriptor text — spans full weapon-row grid width */
	.weapon-special {
		grid-column: 1 / -1;
		font-size: 0.72rem;
		color: var(--text-muted);
		line-height: 1.4;
		padding-top: 0.18rem;
		border-top: 1px solid var(--border);
		margin-top: 0.12rem;
	}
	.weapon-special em { font-style: italic; color: var(--text); }
	.wcol-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.wcol-damage { font-size: 0.79rem; }
	.wcol-stat { font-size: 0.77rem; color: var(--text-muted); }
	.wcol-tags { display: flex; flex-wrap: wrap; gap: 0.12rem; align-items: center; }

	.pick-count-badge {
		display: inline-block;
		padding: 0.05rem 0.38rem;
		border-radius: 6px;
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		color: var(--accent);
		font-size: 0.72rem;
		font-weight: 700;
		vertical-align: middle;
		margin-left: 0.25rem;
	}

	/* â”€â”€ Flavor section (background characteristics) â”€â”€ */
	.flavor-section {
		padding: 0.75rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.flavor-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}
	.flavor-col { display: flex; flex-direction: column; gap: 0.3rem; }
	.flavor-col h5 {
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}
	.flavor-item {
		font-size: 0.8rem;
		color: var(--text-muted);
		line-height: 1.4;
		font-style: italic;
	}

	/* â”€â”€ Identity step â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.identity-pane { align-items: center; text-align: center; }
	.identity-name { width: 100%; max-width: 400px; }
	.name-input {
		width: 100%;
		padding: 0.85rem 1rem;
		border-radius: 14px;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		background: var(--bg-alt);
		color: inherit;
		font: inherit;
		font-size: 1.3rem;
		font-weight: 600;
		text-align: center;
	}
	.name-input::placeholder { color: var(--text-muted); font-weight: 400; }

	.alignment-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.4rem;
		width: 100%;
		max-width: 480px;
	}
	.alignment-cell {
		padding: 0.45rem 0.5rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
		font-size: 0.82rem;
		text-align: center;
		transition: all 0.12s;
	}
	.alignment-cell:hover { background: var(--bg-alt); }
	.alignment-cell.selected {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--accent);
	}

	.backstory-label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
		max-width: 480px;
		text-align: left;
	}
	.backstory-label textarea {
		padding: 0.65rem 0.8rem;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--bg-alt);
		color: inherit;
		font: inherit;
		resize: vertical;
	}

	/* â”€â”€ Summary card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.summary-card {
		width: 100%;
		max-width: 540px;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1rem 1.1rem;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		text-align: left;
	}
	.summary-header h4 { font-size: 1.1rem; }
	.summary-header .hint { font-size: 0.84rem; }
	.summary-stats {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.5rem;
	}
	.summary-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.1rem;
	}
	.stat-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.stat-mod { font-size: 0.78rem; color: var(--text-muted); }
	.summary-details {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.84rem;
		color: var(--text-muted);
	}

	/* â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.cc-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 1.1rem;
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}
	.footer-left {
		display: flex;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.84rem;
	}
	.footer-step { font-weight: 600; color: var(--accent); }
	.footer-actions {
		display: flex;
		gap: 0.5rem;
	}
	.btn {
		padding: 0.6rem 1.1rem;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		cursor: pointer;
		font-weight: 500;
	}
	.btn.primary {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}
	.btn.secondary {
		background: var(--bg-alt);
		border-color: var(--border);
		color: inherit;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* â”€â”€ Responsive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	@media (max-width: 900px) {
		.split-pane { grid-template-columns: 1fr; }
		.option-list {
			max-height: 200px;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		.ability-grid-builder { grid-template-columns: repeat(3, 1fr); }
		.summary-stats { grid-template-columns: repeat(3, 1fr); }
		.method-row { grid-template-columns: 1fr; }
		.flavor-grid { grid-template-columns: 1fr; }
		.cc-header { flex-wrap: wrap; }
		.step-rail { order: 3; width: 100%; justify-content: center; }
		.pane-content { padding: 1rem; }
	}
</style>
