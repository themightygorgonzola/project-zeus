/**
 * Creature Stat Template System (Phase 8a)
 *
 * Generates appropriately-scaled CreatureStatBlock values from a creature name,
 * tier, and party level.  The AI chooses a tier when it starts an encounter;
 * this module turns that tier into concrete CR-appropriate 5e-style stats.
 *
 * Tiers map to a CR that is a fraction/multiple of the party's average level:
 *   weak   → CR ≈ partyLevel × 0.25   (fodder, minions)
 *   normal → CR ≈ partyLevel × 0.50   (typical foe)
 *   tough  → CR ≈ partyLevel × 0.75   (veteran, lieutenant)
 *   elite  → CR ≈ partyLevel × 1.00   (serious threat)
 *   boss   → CR ≈ partyLevel × 1.50   (encounter centrepiece)
 */

import type {
	AbilityScores,
	CreatureAttack,
	CreatureStatBlock,
	CreatureSavingThrow,
	CreatureSkillBonus,
	CreatureTrait,
	CreatureAction
} from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tier the AI selects for each creature in an encounter. */
export type CreatureTier = 'weak' | 'normal' | 'tough' | 'elite' | 'boss';

export const CREATURE_TIERS: readonly CreatureTier[] = ['weak', 'normal', 'tough', 'elite', 'boss'] as const;

// ---------------------------------------------------------------------------
// Tier → CR multiplier
// ---------------------------------------------------------------------------

const TIER_CR_MULTIPLIER: Record<CreatureTier, number> = {
	weak: 0.25,
	normal: 0.50,
	tough: 0.75,
	elite: 1.00,
	boss: 1.50
};

// ---------------------------------------------------------------------------
// CR-indexed stat benchmarks (based on 5e DMG target numbers)
// Each CR maps to:  hp, ac, toHit, dpr (damage per round), saveDC, speed
// We support fractional CRs 0.125, 0.25, 0.5, then integers 1-20.
// ---------------------------------------------------------------------------

interface CRBenchmark {
	hp: number;
	ac: number;
	toHit: number;
	dpr: number;
	saveDC: number;
}

/** Stat benchmarks keyed by CR. Values are approximate 5e DMG expectations. */
const CR_BENCHMARKS: Record<number, CRBenchmark> = {
	0:     { hp: 6,   ac: 10, toHit: 2, dpr: 2,  saveDC: 10 },
	0.125: { hp: 10,  ac: 11, toHit: 3, dpr: 3,  saveDC: 11 },
	0.25:  { hp: 14,  ac: 11, toHit: 3, dpr: 5,  saveDC: 11 },
	0.5:   { hp: 20,  ac: 12, toHit: 3, dpr: 7,  saveDC: 11 },
	1:     { hp: 30,  ac: 13, toHit: 4, dpr: 10, saveDC: 12 },
	2:     { hp: 45,  ac: 13, toHit: 4, dpr: 15, saveDC: 12 },
	3:     { hp: 60,  ac: 13, toHit: 5, dpr: 20, saveDC: 13 },
	4:     { hp: 78,  ac: 14, toHit: 5, dpr: 25, saveDC: 13 },
	5:     { hp: 95,  ac: 15, toHit: 6, dpr: 30, saveDC: 14 },
	6:     { hp: 110, ac: 15, toHit: 6, dpr: 35, saveDC: 14 },
	7:     { hp: 125, ac: 15, toHit: 6, dpr: 40, saveDC: 15 },
	8:     { hp: 140, ac: 16, toHit: 7, dpr: 45, saveDC: 15 },
	9:     { hp: 155, ac: 16, toHit: 7, dpr: 50, saveDC: 16 },
	10:    { hp: 170, ac: 17, toHit: 7, dpr: 55, saveDC: 16 },
	11:    { hp: 188, ac: 17, toHit: 8, dpr: 60, saveDC: 17 },
	12:    { hp: 205, ac: 17, toHit: 8, dpr: 65, saveDC: 17 },
	13:    { hp: 220, ac: 18, toHit: 8, dpr: 70, saveDC: 18 },
	14:    { hp: 240, ac: 18, toHit: 8, dpr: 75, saveDC: 18 },
	15:    { hp: 255, ac: 18, toHit: 8, dpr: 80, saveDC: 19 },
	16:    { hp: 270, ac: 18, toHit: 9, dpr: 85, saveDC: 19 },
	17:    { hp: 290, ac: 19, toHit: 10, dpr: 90, saveDC: 20 },
	18:    { hp: 310, ac: 19, toHit: 10, dpr: 95, saveDC: 20 },
	19:    { hp: 330, ac: 19, toHit: 10, dpr: 100, saveDC: 21 },
	20:    { hp: 350, ac: 19, toHit: 10, dpr: 105, saveDC: 21 }
};

// ---------------------------------------------------------------------------
// Creature‐name → attack flavour keyword table
// ---------------------------------------------------------------------------

interface AttackFlavour {
	name: string;
	damageType: string;
	range?: string;
}

const CREATURE_KEYWORDS: Array<{ pattern: RegExp; attacks: AttackFlavour[] }> = [
	// Beasts / animals
	{ pattern: /wolf|dog|hound|worg/i, attacks: [{ name: 'Bite', damageType: 'piercing' }] },
	{ pattern: /bear|ursine/i, attacks: [{ name: 'Claw', damageType: 'slashing' }, { name: 'Bite', damageType: 'piercing' }] },
	{ pattern: /spider|arachnid/i, attacks: [{ name: 'Bite', damageType: 'piercing', range: '5 ft.' }, { name: 'Web', damageType: 'bludgeoning', range: '30 ft.' }] },
	{ pattern: /snake|serpent|naga/i, attacks: [{ name: 'Bite', damageType: 'piercing' }] },
	{ pattern: /rat|vermin/i, attacks: [{ name: 'Bite', damageType: 'piercing' }] },
	{ pattern: /hawk|eagle|bird|roc|griffon/i, attacks: [{ name: 'Talons', damageType: 'slashing' }, { name: 'Beak', damageType: 'piercing' }] },
	{ pattern: /boar|tusked/i, attacks: [{ name: 'Tusk', damageType: 'slashing' }] },

	// Undead (before humanoids so "Skeleton Guard" matches skeleton, not guard)
	{ pattern: /skeleton|skeletal/i, attacks: [{ name: 'Rusty Shortsword', damageType: 'piercing' }, { name: 'Shortbow', damageType: 'piercing', range: '80/320 ft.' }] },
	{ pattern: /zombie/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },
	{ pattern: /ghost|wraith|specter|spectre/i, attacks: [{ name: 'Withering Touch', damageType: 'necrotic' }] },
	{ pattern: /vampire/i, attacks: [{ name: 'Claws', damageType: 'slashing' }, { name: 'Bite', damageType: 'piercing' }] },
	{ pattern: /lich/i, attacks: [{ name: 'Paralyzing Touch', damageType: 'necrotic' }, { name: 'Ray of Frost', damageType: 'cold', range: '60 ft.' }] },

	// Humanoids
	{ pattern: /bandit|brigand|thug|outlaw|pirate|raider/i, attacks: [{ name: 'Shortsword', damageType: 'piercing' }, { name: 'Light Crossbow', damageType: 'piercing', range: '80/320 ft.' }] },
	{ pattern: /goblin|hobgoblin|bugbear/i, attacks: [{ name: 'Scimitar', damageType: 'slashing' }, { name: 'Shortbow', damageType: 'piercing', range: '80/320 ft.' }] },
	{ pattern: /orc|half-orc/i, attacks: [{ name: 'Greataxe', damageType: 'slashing' }] },
	{ pattern: /kobold/i, attacks: [{ name: 'Dagger', damageType: 'piercing' }, { name: 'Sling', damageType: 'bludgeoning', range: '30/120 ft.' }] },
	{ pattern: /guard|soldier|knight|warrior|veteran/i, attacks: [{ name: 'Longsword', damageType: 'slashing' }, { name: 'Shield Bash', damageType: 'bludgeoning' }] },
	{ pattern: /assassin|rogue|thief/i, attacks: [{ name: 'Shortsword', damageType: 'piercing' }, { name: 'Hand Crossbow', damageType: 'piercing', range: '30/120 ft.' }] },
	{ pattern: /mage|wizard|sorcerer|warlock|witch/i, attacks: [{ name: 'Arcane Blast', damageType: 'force', range: '120 ft.' }] },
	{ pattern: /priest|cleric|cultist|acolyte/i, attacks: [{ name: 'Mace', damageType: 'bludgeoning' }, { name: 'Sacred Flame', damageType: 'radiant', range: '60 ft.' }] },
	{ pattern: /archer|ranger|hunter/i, attacks: [{ name: 'Longbow', damageType: 'piercing', range: '150/600 ft.' }, { name: 'Shortsword', damageType: 'piercing' }] },

	// Fiends
	{ pattern: /demon|fiend|devil/i, attacks: [{ name: 'Claws', damageType: 'slashing' }, { name: 'Hellfire', damageType: 'fire', range: '60 ft.' }] },
	{ pattern: /imp/i, attacks: [{ name: 'Sting', damageType: 'piercing' }] },

	// Dragons
	{ pattern: /dragon|drake|wyrm|wyvern/i, attacks: [{ name: 'Bite', damageType: 'piercing' }, { name: 'Claw', damageType: 'slashing' }, { name: 'Breath Weapon', damageType: 'fire', range: '30 ft. cone' }] },

	// Constructs
	{ pattern: /golem|construct|automaton|statue/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },

	// Elementals
	{ pattern: /fire.*elemental|flame/i, attacks: [{ name: 'Burning Touch', damageType: 'fire' }] },
	{ pattern: /water.*elemental|wave/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },
	{ pattern: /earth.*elemental|stone/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },
	{ pattern: /air.*elemental|wind/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },

	// Giants
	{ pattern: /giant|ogre|troll|ettin/i, attacks: [{ name: 'Greatclub', damageType: 'bludgeoning' }, { name: 'Rock', damageType: 'bludgeoning', range: '60/240 ft.' }] },

	// Aberrations
	{ pattern: /aberration|beholder|mind.*flayer|illithid/i, attacks: [{ name: 'Tentacle', damageType: 'psychic' }] },

	// Oozes
	{ pattern: /ooze|slime|jelly|pudding/i, attacks: [{ name: 'Pseudopod', damageType: 'acid' }] },

	// Plants
	{ pattern: /treant|plant|vine|twig.*blight/i, attacks: [{ name: 'Slam', damageType: 'bludgeoning' }] },

	// Appearance / adjective descriptors (lower priority — matched when class keywords above don't)
	{ pattern: /robed|caster|spell|mystic/i, attacks: [{ name: 'Arcane Blast', damageType: 'force', range: '120 ft.' }] },
	{ pattern: /stout|armored|shielded|bulky/i, attacks: [{ name: 'Longsword', damageType: 'slashing' }, { name: 'Shield Bash', damageType: 'bludgeoning' }] },
	{ pattern: /agile|swift|nimble|lithe/i, attacks: [{ name: 'Shortsword', damageType: 'piercing' }, { name: 'Shortbow', damageType: 'piercing', range: '80/320 ft.' }] },

	// Race-based fallbacks (very low priority — only if nothing else matches)
	{ pattern: /\belf\b|elven/i, attacks: [{ name: 'Longbow', damageType: 'piercing', range: '150/600 ft.' }, { name: 'Shortsword', damageType: 'piercing' }] },
	{ pattern: /\bdwarf\b|dwarven/i, attacks: [{ name: 'Warhammer', damageType: 'bludgeoning' }, { name: 'Handaxe', damageType: 'slashing', range: '20/60 ft.' }] },
	{ pattern: /\bhuman\b|mercenary|sellsword/i, attacks: [{ name: 'Longsword', damageType: 'slashing' }, { name: 'Light Crossbow', damageType: 'piercing', range: '80/320 ft.' }] },
	{ pattern: /\bhalfling\b/i, attacks: [{ name: 'Shortsword', damageType: 'piercing' }, { name: 'Sling', damageType: 'bludgeoning', range: '30/120 ft.' }] },
	{ pattern: /\bgnome\b/i, attacks: [{ name: 'Dagger', damageType: 'piercing' }, { name: 'Light Crossbow', damageType: 'piercing', range: '80/320 ft.' }] },
	{ pattern: /\btiefling\b/i, attacks: [{ name: 'Scimitar', damageType: 'slashing' }, { name: 'Hellish Rebuke', damageType: 'fire', range: '60 ft.' }] },
	{ pattern: /\bdragonborn\b/i, attacks: [{ name: 'Greataxe', damageType: 'slashing' }, { name: 'Breath Weapon', damageType: 'fire', range: '15 ft. cone' }] },

	// Generic unknown beast fallback — catches any creature not matched above (e.g. "Corrupted Beast", "Shadowed Monster")
	// Gives claw + bite as universal wild-animal attacks so stat blocks are never empty
	{ pattern: /\bbeast\b|\bmonster\b|\bcreature\b|\bfiend\b|\bentity\b/i, attacks: [{ name: 'Claw', damageType: 'slashing' }, { name: 'Bite', damageType: 'piercing' }] },
];

/** Default attacks when no keyword matches. */
const DEFAULT_ATTACKS: AttackFlavour[] = [
	{ name: 'Strike', damageType: 'bludgeoning' },
	{ name: 'Slam', damageType: 'bludgeoning' }
];

// ---------------------------------------------------------------------------
// Speed by keyword
// ---------------------------------------------------------------------------

function inferSpeed(name: string): number {
	const lower = name.toLowerCase();
	if (/wolf|hound|worg|horse|cheetah|hawk|eagle|griffon/i.test(lower)) return 50;
	if (/spider|snake|rat|imp|rogue|assassin|thief/i.test(lower)) return 40;
	if (/golem|construct|zombie|ooze|slime|treant|giant|ogre/i.test(lower)) return 20;
	if (/ghost|wraith|specter|spectre/i.test(lower)) return 0; // fly speed only
	return 30;
}

// ---------------------------------------------------------------------------
// Ability score generation
// ---------------------------------------------------------------------------

/**
 * Generate ability scores appropriate for a creature at a given CR.
 * Higher-CR creatures get higher scores. The creature name influences
 * which abilities are primary (e.g. ogre → STR, mage → INT).
 */
function generateAbilities(name: string, cr: number): AbilityScores {
	// Base: 10 + CR/2, capped at 20 for most scores, 30 for extreme CRs
	const baseBoost = Math.min(Math.floor(cr / 2), 10);
	const base = 10 + baseBoost;

	const abilities: AbilityScores = {
		str: base, dex: base, con: base,
		int: base, wis: base, cha: base
	};

	// Primary stat boost based on creature name keywords
	const lower = name.toLowerCase();
	if (/ogre|giant|troll|orc|bear|golem|construct|dragon|treant/i.test(lower)) {
		abilities.str += 4;
		abilities.con += 2;
		abilities.dex = Math.max(8, abilities.dex - 2);
	} else if (/rogue|thief|assassin|spider|goblin|kobold|imp|hawk|eagle/i.test(lower)) {
		abilities.dex += 4;
		abilities.con += 0;
		abilities.str = Math.max(8, abilities.str - 2);
	} else if (/mage|wizard|sorcerer|warlock|lich|beholder|illithid|mind.*flayer/i.test(lower)) {
		abilities.int += 4;
		abilities.wis += 2;
		abilities.str = Math.max(8, abilities.str - 2);
	} else if (/priest|cleric|druid|shaman|spirit|ghost|wraith/i.test(lower)) {
		abilities.wis += 4;
		abilities.cha += 2;
	} else if (/vampire|demon|devil|fiend|dragon|bard/i.test(lower)) {
		abilities.cha += 4;
		abilities.str += 2;
	} else if (/wolf|snake|rat|bandit|guard|soldier|skeleton|zombie/i.test(lower)) {
		abilities.str += 2;
		abilities.dex += 2;
	} else if (/\bbeast\b|\bmonster\b|\bcreature\b|\bentity\b/i.test(lower)) {
		// Generic unknown creature — assume physically powerful
		abilities.str += 3;
		abilities.con += 2;
		abilities.dex = Math.max(8, abilities.dex - 1);
	}

	// Clamp all scores to [1, 30]
	for (const key of Object.keys(abilities) as (keyof AbilityScores)[]) {
		abilities[key] = Math.max(1, Math.min(30, abilities[key]));
	}

	return abilities;
}

/**
 * Standard 5e ability modifier.
 */
function abilityMod(score: number): number {
	return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// Damage dice from DPR target
// ---------------------------------------------------------------------------

/**
 * Produce a dice notation string that averages close to the target DPR.
 * E.g. target 10 → "2d8+1" (avg 10).
 */
function dprToDice(targetDpr: number): string {
	if (targetDpr <= 1) return '1';
	if (targetDpr <= 3) return '1d4';
	if (targetDpr <= 5) return '1d6+1';
	if (targetDpr <= 7) return '1d8+2';
	if (targetDpr <= 10) return '2d6+2';
	if (targetDpr <= 15) return '2d8+4';
	if (targetDpr <= 20) return '3d8+4';
	if (targetDpr <= 25) return '3d10+5';
	if (targetDpr <= 30) return '4d8+6';
	if (targetDpr <= 40) return '4d10+8';
	if (targetDpr <= 50) return '5d10+10';
	if (targetDpr <= 65) return '6d10+12';
	if (targetDpr <= 80) return '8d10+12';
	if (targetDpr <= 100) return '10d10+15';
	return '12d10+18';
}

// ---------------------------------------------------------------------------
// Keyword-based resistances / immunities
// ---------------------------------------------------------------------------

function inferResistances(name: string): string[] {
	const lower = name.toLowerCase();
	if (/fire.*elemental|flame|magma/i.test(lower)) return ['fire'];
	if (/ice|frost|cold/i.test(lower)) return ['cold'];
	if (/ghost|wraith|specter|spectre/i.test(lower)) return ['acid', 'cold', 'fire', 'lightning', 'thunder'];
	if (/golem|construct/i.test(lower)) return ['bludgeoning', 'piercing', 'slashing'];
	if (/demon|devil|fiend/i.test(lower)) return ['cold', 'fire', 'lightning'];
	if (/dragon|drake|wyrm/i.test(lower)) return ['fire'];
	return [];
}

function inferImmunities(name: string): string[] {
	const lower = name.toLowerCase();
	if (/skeleton|skeletal|zombie|ghost|wraith|lich|specter|spectre/i.test(lower)) return ['poison'];
	if (/golem|construct/i.test(lower)) return ['poison', 'psychic'];
	if (/ooze|slime|jelly/i.test(lower)) return ['poison'];
	if (/fire.*elemental|flame/i.test(lower)) return ['fire', 'poison'];
	return [];
}

function inferVulnerabilities(name: string): string[] {
	const lower = name.toLowerCase();
	if (/skeleton|skeletal/i.test(lower)) return ['bludgeoning'];
	if (/treant|plant|vine|twig.*blight/i.test(lower)) return ['fire'];
	if (/ice|frost/i.test(lower)) return ['fire'];
	if (/fire.*elemental|flame/i.test(lower)) return ['cold'];
	return [];
}

// ---------------------------------------------------------------------------
// CR snapping
// ---------------------------------------------------------------------------

/** All CR stops we have benchmarks for, in ascending order. */
const CR_STOPS = Object.keys(CR_BENCHMARKS).map(Number).sort((a, b) => a - b);

/**
 * Snap a raw CR value to the nearest standard CR stop.
 * Clamps to [0, 20].
 */
export function snapCR(rawCR: number): number {
	const clamped = Math.max(0, Math.min(20, rawCR));
	let best = CR_STOPS[0];
	let bestDist = Math.abs(clamped - best);
	for (const stop of CR_STOPS) {
		const dist = Math.abs(clamped - stop);
		if (dist < bestDist) {
			best = stop;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Look up the benchmark stats for a snapped CR.
 */
function getBenchmark(cr: number): CRBenchmark {
	return CR_BENCHMARKS[cr] ?? CR_BENCHMARKS[0];
}

// ---------------------------------------------------------------------------
// Attack matching
// ---------------------------------------------------------------------------

/**
 * Find the attack flavour for a given creature name.
 * Falls back to generic Strike/Slam if no keyword matches.
 */
function getAttackFlavours(name: string): AttackFlavour[] {
	for (const entry of CREATURE_KEYWORDS) {
		if (entry.pattern.test(name)) {
			return entry.attacks;
		}
	}
	return DEFAULT_ATTACKS;
}

// ---------------------------------------------------------------------------
// Core public function
// ---------------------------------------------------------------------------

/**
 * Generate a complete CreatureStatBlock for an encounter creature.
 *
 * @param name       Creature display name — used for keyword matching.
 * @param tier       Difficulty tier chosen by the state-extraction AI.
 * @param partyLevel Average level of the player party (≥ 1).
 * @returns          A fully-populated CreatureStatBlock.
 */
export function generateCreatureStatBlock(
	name: string,
	tier: CreatureTier,
	partyLevel: number
): CreatureStatBlock {
	// 1. Compute CR
	const level = Math.max(1, partyLevel);
	const rawCR = level * TIER_CR_MULTIPLIER[tier];
	const cr = snapCR(rawCR);

	// 2. Look up benchmark stats for that CR
	const bench = getBenchmark(cr);

	// 3. Ability scores
	const abilities = generateAbilities(name, cr);

	// 4. Speed
	const speed = inferSpeed(name);

	// 5. Build attacks from keyword table + benchmark damage
	const flavours = getAttackFlavours(name);
	const attackCount = flavours.length;
	const dprPerAttack = Math.max(1, Math.floor(bench.dpr / attackCount));
	const attacks: CreatureAttack[] = flavours.map(f => ({
		name: f.name,
		toHit: bench.toHit,
		damage: dprToDice(dprPerAttack),
		damageType: f.damageType,
		...(f.range ? { range: f.range } : {})
	}));

	// 6. Saving throws — proficient in CON, plus highest-ability saves
	const savingThrows: CreatureSavingThrow[] = [
		{ ability: 'con', bonus: abilityMod(abilities.con) + Math.ceil(cr / 4) }
	];
	// Add proficiency in best mental save for elite/boss
	if (tier === 'elite' || tier === 'boss') {
		const wisBonus = abilityMod(abilities.wis) + Math.ceil(cr / 4);
		savingThrows.push({ ability: 'wis', bonus: wisBonus });
	}

	// 7. Skills — Perception always, plus flavour skills
	const percBonus = abilityMod(abilities.wis) + Math.ceil(cr / 4);
	const skills: CreatureSkillBonus[] = [
		{ skill: 'perception', bonus: percBonus }
	];

	// 8. Resistances, immunities, vulnerabilities
	const resistances = inferResistances(name);
	const immunities = inferImmunities(name);
	const vulnerabilities = inferVulnerabilities(name);

	// 9. Traits
	const traits: CreatureTrait[] = [];
	if (tier === 'boss') {
		traits.push({
			name: 'Legendary Resistance',
			description: 'If this creature fails a saving throw, it can choose to succeed instead (3/day).'
		});
	}

	// 10. Actions (same as attacks wrapped as actions)
	const actions: CreatureAction[] = attacks.map(atk => ({
		name: atk.name,
		description: `Melee${atk.range ? ' or Ranged' : ''} Weapon Attack: +${atk.toHit} to hit, ${atk.range ?? '5 ft.'} reach, one target. Hit: ${atk.damage} ${atk.damageType} damage.`,
		attack: atk
	}));

	// 11. Legendary actions for bosses
	const legendaryActions: CreatureAction[] = [];
	if (tier === 'boss') {
		legendaryActions.push({
			name: 'Attack',
			description: 'The creature makes one attack.'
		});
		legendaryActions.push({
			name: 'Move',
			description: 'The creature moves up to half its speed without provoking opportunity attacks.'
		});
	}

	// 12. Final stat block
	const hp = bench.hp;
	return {
		hp,
		maxHp: hp,
		ac: bench.ac,
		abilities,
		speed,
		cr,
		attacks,
		savingThrows,
		skills,
		resistances,
		immunities,
		vulnerabilities,
		traits,
		actions,
		legendaryActions
	};
}

// ---------------------------------------------------------------------------
// Utility — calculate average party level
// ---------------------------------------------------------------------------

/**
 * Compute the average level of a group of characters.
 * Returns 1 if the array is empty.
 */
export function averagePartyLevel(characters: Array<{ level: number }>): number {
	if (characters.length === 0) return 1;
	const total = characters.reduce((sum, c) => sum + c.level, 0);
	return Math.max(1, Math.round(total / characters.length));
}

/**
 * Validate that a string is a known CreatureTier.
 * Returns the tier if valid, or 'normal' as a safe default.
 */
export function parseCreatureTier(value: unknown): CreatureTier {
	if (typeof value === 'string' && CREATURE_TIERS.includes(value as CreatureTier)) {
		return value as CreatureTier;
	}
	return 'normal';
}

/**
 * Returns true when a stat block is "flat" — all ability scores are absent or
 * all equal to 10 (the all-10s default indicating the AI generated no
 * meaningful stats). Used to detect NPCs that need archetype-scaled values.
 */
export function isStatBlockFlat(sb?: CreatureStatBlock): boolean {
	if (!sb?.abilities) return true;
	const { str, dex, con, int, wis, cha } = sb.abilities;
	return [str, dex, con, int, wis, cha].every(s => !s || s === 10);
}
