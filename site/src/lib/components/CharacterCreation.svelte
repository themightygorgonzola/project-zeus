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
	import { validateCharacterInput } from '$lib/game/character-creation';

	interface Props {
		adventureId: string;
		onCreated?: (character: PlayerCharacter) => void;
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

	let { adventureId, onCreated = () => {} }: Props = $props();
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
		variantHumanFeat: undefined,
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
		const next = Array.from({ length: count }, (_, index) => Number(form.equipmentSelections?.[index] ?? 0));
		form.equipmentSelections = next;
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
				return ['background'];
			case 3:
				return ['abilityAssignment'];
			case 4:
				return ['chosenSkills', 'bonusSkillChoices', 'chosenLanguages'];
			case 5:
				return ['spellChoices', 'spellChoices.cantrips', 'spellChoices.knownSpells', 'spellChoices.preparedSpells', 'equipmentSelections'];
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
		if (event.key === 'Escape') {
			isOpen = false;
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
			onclick={(e) => { if (e.target === e.currentTarget) isOpen = false; }}
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

					<button type="button" class="close-btn" onclick={() => (isOpen = false)} aria-label="Close">âœ•</button>
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
									<span class="option-sub">{race.description}</span>
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
										<span class="badge">d{cls.hitDie}</span>
									</div>
									<span class="option-sub">{cls.primaryAbility.map(a => abilityLabels[a]).join(' / ')}</span>
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
								<button
									type="button"
									class="option-row"
									class:selected={form.background === bg.name}
									onclick={() => setBackground(bg.name)}
								>
									<strong>{bg.displayName}</strong>
									<span class="option-sub">{bg.skillProficiencies.map(formatLabel).join(', ')}</span>
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
									<p class="hint">{backgroundDef.equipment.join(', ')}</p>
								</div>

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
										<div class="equip-group">
											<span class="equip-label">{choice.label}</span>
											<div class="equip-options">
												{#each choice.options as option, optIdx}
													<button
														type="button"
														class="equip-card"
														class:selected={form.equipmentSelections?.[choiceIdx] === optIdx}
														onclick={() => setEquipmentSelection(choiceIdx, String(optIdx))}
													>
														{option.join(' + ')}
													</button>
												{/each}
											</div>
										</div>
									{/each}
									{#if fieldError('equipmentSelections')}
										<p class="field-error">{fieldError('equipmentSelections')}</p>
									{/if}
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
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
	}
	.sidebar-desc { color: var(--text-muted); font-size: 0.92rem; }
	.launch-btn {
		padding: 0.7rem 1rem;
		border-radius: 12px;
		border: 1px solid rgba(124,156,255,0.35);
		background: rgba(124,156,255,0.15);
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
		background: rgba(4,6,14,0.88);
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
		border: 1px solid rgba(255,255,255,0.08);
		background: rgba(14,18,28,0.98);
		box-shadow: 0 32px 80px rgba(0,0,0,0.55);
		overflow: hidden;
	}

	/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.cc-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.65rem 1.1rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
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
		border: 1.5px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.03);
		color: rgba(255,255,255,0.5);
		cursor: pointer;
		transition: all 0.15s;
	}
	.step-node.active {
		background: rgba(124,156,255,0.22);
		border-color: rgba(124,156,255,0.5);
		color: #fff;
	}
	.step-node.done {
		background: rgba(124,156,255,0.12);
		border-color: rgba(124,156,255,0.35);
		color: rgba(124,156,255,0.9);
	}
	.step-node.error {
		border-color: rgba(255,120,120,0.4);
		background: rgba(255,120,120,0.1);
		color: #ffb0b0;
	}
	.step-line {
		width: 1.6rem;
		height: 2px;
		background: rgba(255,255,255,0.08);
		flex-shrink: 0;
	}
	.step-line.filled { background: rgba(124,156,255,0.3); }

	.close-btn {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.04);
		color: rgba(255,255,255,0.7);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	/* â”€â”€ Error strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.error-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		padding: 0.55rem 1.1rem;
		background: rgba(255,96,96,0.08);
		border-bottom: 1px solid rgba(255,96,96,0.15);
		color: #ffb0b0;
		font-size: 0.88rem;
		flex-shrink: 0;
	}
	.err-item { color: rgba(255,180,180,0.8); }

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
		border-right: 1px solid rgba(255,255,255,0.06);
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
		color: rgba(255,255,255,0.85);
		cursor: pointer;
		transition: all 0.12s;
	}
	.option-row:hover { background: rgba(255,255,255,0.04); }
	.option-row.selected {
		background: rgba(124,156,255,0.12);
		border-color: rgba(124,156,255,0.25);
	}
	.option-row strong { font-size: 0.95rem; }
	.option-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
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
		background: rgba(124,156,255,0.12);
		color: var(--accent);
		white-space: nowrap;
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
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.08);
		font-size: 0.78rem;
		color: rgba(255,255,255,0.7);
		white-space: nowrap;
	}
	.tag.accent {
		background: rgba(124,156,255,0.1);
		border-color: rgba(124,156,255,0.2);
		color: var(--accent);
	}

	/* â”€â”€ Traits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.trait-entry {
		padding: 0.55rem 0.75rem;
		border-radius: 12px;
		background: rgba(255,255,255,0.025);
		border: 1px solid rgba(255,255,255,0.06);
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
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.025);
		text-align: left;
		color: rgba(255,255,255,0.85);
		cursor: pointer;
		transition: all 0.12s;
	}
	.choice-card:hover { background: rgba(255,255,255,0.05); }
	.choice-card.selected {
		background: rgba(124,156,255,0.12);
		border-color: rgba(124,156,255,0.28);
	}
	.choice-card.flat {
		cursor: default;
		border: 1px solid rgba(255,255,255,0.08);
		background: rgba(255,255,255,0.02);
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
		color: rgba(255,255,255,0.7);
	}
	.prof-item strong {
		color: rgba(255,255,255,0.9);
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
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
		color: rgba(255,255,255,0.8);
		cursor: pointer;
		font-size: 0.88rem;
		transition: all 0.12s;
	}
	.pill:hover:not(:disabled):not(.locked) { background: rgba(255,255,255,0.08); }
	.pill.selected {
		background: rgba(124,156,255,0.18);
		border-color: rgba(124,156,255,0.35);
		color: var(--accent);
	}
	.pill.accent {
		background: rgba(124,156,255,0.18);
		border-color: rgba(124,156,255,0.35);
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
	.field-error {
		color: #ffb0b0;
		font-size: 0.88rem;
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
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.025);
		color: rgba(255,255,255,0.8);
		cursor: pointer;
		text-align: center;
		transition: all 0.12s;
	}
	.method-btn:hover { background: rgba(255,255,255,0.05); }
	.method-btn.selected {
		background: rgba(124,156,255,0.14);
		border-color: rgba(124,156,255,0.3);
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
		background: rgba(124,156,255,0.08);
		border: 1px solid rgba(124,156,255,0.15);
		font-size: 0.88rem;
	}
	.budget-bar.over {
		background: rgba(255,96,96,0.08);
		border-color: rgba(255,96,96,0.2);
		color: #ffb0b0;
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
		background: rgba(255,255,255,0.025);
		border: 1px solid rgba(255,255,255,0.08);
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
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
		color: rgba(255,255,255,0.7);
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
		color: rgba(124,156,255,0.8);
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
		color: rgba(255,96,96,0.65);
		text-decoration-color: rgba(255,96,96,0.65);
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
		background: rgba(255,255,255,0.06);
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

	/* â”€â”€ Skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	.skill-section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.85rem;
		border-radius: 14px;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
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
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
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
		color: rgba(255,255,255,0.7);
	}
	.equip-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.equip-card {
		padding: 0.5rem 0.85rem;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.025);
		color: rgba(255,255,255,0.8);
		cursor: pointer;
		font-size: 0.88rem;
		text-align: left;
		transition: all 0.12s;
	}
	.equip-card:hover { background: rgba(255,255,255,0.05); }
	.equip-card.selected {
		background: rgba(124,156,255,0.14);
		border-color: rgba(124,156,255,0.3);
		color: var(--accent);
	}

	/* â”€â”€ Flavor section (background characteristics) â”€â”€ */
	.flavor-section {
		padding: 0.75rem;
		border-radius: 14px;
		background: rgba(255,255,255,0.015);
		border: 1px solid rgba(255,255,255,0.05);
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
		border: 1px solid rgba(124,156,255,0.25);
		background: rgba(255,255,255,0.04);
		color: inherit;
		font: inherit;
		font-size: 1.3rem;
		font-weight: 600;
		text-align: center;
	}
	.name-input::placeholder { color: rgba(255,255,255,0.25); font-weight: 400; }

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
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.025);
		color: rgba(255,255,255,0.7);
		cursor: pointer;
		font-size: 0.82rem;
		text-align: center;
		transition: all 0.12s;
	}
	.alignment-cell:hover { background: rgba(255,255,255,0.05); }
	.alignment-cell.selected {
		background: rgba(124,156,255,0.14);
		border-color: rgba(124,156,255,0.3);
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
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
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
		background: rgba(255,255,255,0.025);
		border: 1px solid rgba(255,255,255,0.08);
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
		border-top: 1px solid rgba(255,255,255,0.06);
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
		border: 1px solid rgba(124,156,255,0.35);
		cursor: pointer;
		font-weight: 500;
	}
	.btn.primary {
		background: rgba(124,156,255,0.18);
		color: var(--accent);
	}
	.btn.secondary {
		background: rgba(255,255,255,0.04);
		border-color: rgba(255,255,255,0.12);
		color: inherit;
	}
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* â”€â”€ Responsive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
	@media (max-width: 900px) {
		.split-pane { grid-template-columns: 1fr; }
		.option-list {
			max-height: 200px;
			border-right: none;
			border-bottom: 1px solid rgba(255,255,255,0.06);
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
