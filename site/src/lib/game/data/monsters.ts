/**
 * 5e Encounter Template Data
 *
 * CR-tiered monster scaffolds for AI-generated encounters with bounded math.
 * These are templates, not specific copyrighted stat blocks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonsterTier = 'minion' | 'soldier' | 'elite' | 'boss' | 'legendary';
export type MonsterRole = 'brute' | 'skirmisher' | 'artillery' | 'controller' | 'lurker';

export interface NumericRange {
	min: number;
	max: number;
}

export interface MonsterTemplate {
	name: string;
	displayName: string;
	tier: MonsterTier;
	role: MonsterRole;
	crRange: NumericRange;
	baseStats: {
		hp: NumericRange;
		ac: NumericRange;
		attackBonus: NumericRange;
		damagePerRound: NumericRange;
		saveDC: NumericRange;
		speed: NumericRange;
	};
	traitSlots: number;
	exampleCreatures: string[];
	theme: string;
	behavior: string;
	lootHints: string[];
}

// ---------------------------------------------------------------------------
// XP by CR (5e)
// ---------------------------------------------------------------------------

export const XP_BY_CR: Record<string, number> = {
	'0': 10,
	'1/8': 25,
	'1/4': 50,
	'1/2': 100,
	'1': 200,
	'2': 450,
	'3': 700,
	'4': 1100,
	'5': 1800,
	'6': 2300,
	'7': 2900,
	'8': 3900,
	'9': 5000,
	'10': 5900,
	'11': 7200,
	'12': 8400,
	'13': 10000,
	'14': 11500,
	'15': 13000,
	'16': 15000,
	'17': 18000,
	'18': 20000,
	'19': 22000,
	'20': 25000,
	'21': 33000,
	'22': 41000,
	'23': 50000,
	'24': 62000,
	'25': 75000,
	'26': 90000,
	'27': 105000,
	'28': 120000,
	'29': 135000,
	'30': 155000
};

// ---------------------------------------------------------------------------
// Encounter Templates
// ---------------------------------------------------------------------------

export const MONSTER_TEMPLATES: MonsterTemplate[] = [
	{ name: 'goblin-raider', displayName: 'Goblin Raider', tier: 'minion', role: 'skirmisher', crRange: { min: 0.125, max: 0.25 }, baseStats: { hp: { min: 5, max: 14 }, ac: { min: 12, max: 15 }, attackBonus: { min: 3, max: 5 }, damagePerRound: { min: 4, max: 8 }, saveDC: { min: 11, max: 12 }, speed: { min: 25, max: 35 } }, traitSlots: 1, exampleCreatures: ['Goblin scout', 'Bandit cutpurse', 'Kobold knife-fighter'], theme: 'Cowardly, opportunistic raiders who strike and disengage.', behavior: 'Ambush weaker targets, flee when bloodied, exploit terrain and numbers.', lootHints: ['Small coin purses', 'Crude blades', 'Maps to hideouts'] },
	{ name: 'wolf-pack-hunter', displayName: 'Wolf Pack Hunter', tier: 'minion', role: 'lurker', crRange: { min: 0.125, max: 0.25 }, baseStats: { hp: { min: 6, max: 16 }, ac: { min: 11, max: 14 }, attackBonus: { min: 3, max: 5 }, damagePerRound: { min: 5, max: 9 }, saveDC: { min: 10, max: 12 }, speed: { min: 35, max: 45 } }, traitSlots: 1, exampleCreatures: ['Dire rat alpha', 'Wolf', 'Hyena pack-runner'], theme: 'Fast animals or beasts that isolate prey.', behavior: 'Circle the party, focus prone or isolated characters.', lootHints: ['Pelts', 'Teeth', 'Tracking clues'] },
	{ name: 'skeletal-sentry', displayName: 'Skeletal Sentry', tier: 'minion', role: 'brute', crRange: { min: 0.125, max: 0.25 }, baseStats: { hp: { min: 8, max: 18 }, ac: { min: 12, max: 15 }, attackBonus: { min: 3, max: 4 }, damagePerRound: { min: 4, max: 8 }, saveDC: { min: 10, max: 11 }, speed: { min: 20, max: 30 } }, traitSlots: 1, exampleCreatures: ['Skeleton guard', 'Zombie thrall', 'Animated bones'], theme: 'Undead shock troops held together by grim magic.', behavior: 'Advance relentlessly, ignore fear, absorb punishment.', lootHints: ['Rusty weapons', 'Necrotic trinkets', 'Bone charms'] },
	{ name: 'cult-adept', displayName: 'Cult Adept', tier: 'minion', role: 'controller', crRange: { min: 0.125, max: 0.25 }, baseStats: { hp: { min: 6, max: 12 }, ac: { min: 11, max: 13 }, attackBonus: { min: 2, max: 4 }, damagePerRound: { min: 3, max: 7 }, saveDC: { min: 11, max: 13 }, speed: { min: 25, max: 30 } }, traitSlots: 2, exampleCreatures: ['Initiate of a dark shrine', 'Hedge occultist', 'Fanatic torch-bearer'], theme: 'Low-tier casters using fear, fire, or curses.', behavior: 'Stay behind frontliners, harass clustered targets, protect leaders.', lootHints: ['Ritual chalk', 'Dark scripture', 'Cheap symbols'] },
	{ name: 'swarm-hazard', displayName: 'Swarm Hazard', tier: 'minion', role: 'controller', crRange: { min: 0.125, max: 0.25 }, baseStats: { hp: { min: 10, max: 20 }, ac: { min: 10, max: 13 }, attackBonus: { min: 2, max: 4 }, damagePerRound: { min: 4, max: 8 }, saveDC: { min: 10, max: 12 }, speed: { min: 20, max: 30 } }, traitSlots: 2, exampleCreatures: ['Swarm of bats', 'Spider mass', 'Animated vermin cloud'], theme: 'Area-denial nuisance creatures that overwhelm by contact.', behavior: 'Occupy space, hinder spellcasters and ranged attackers.', lootHints: ['Nest materials', 'Poison sacs', 'Hidden stash nearby'] },

	{ name: 'orc-veteran', displayName: 'Orc Veteran', tier: 'soldier', role: 'brute', crRange: { min: 0.5, max: 2 }, baseStats: { hp: { min: 18, max: 42 }, ac: { min: 12, max: 16 }, attackBonus: { min: 4, max: 6 }, damagePerRound: { min: 9, max: 16 }, saveDC: { min: 12, max: 13 }, speed: { min: 25, max: 35 } }, traitSlots: 2, exampleCreatures: ['Orc raider', 'Mercenary bruiser', 'Hobgoblin infantry'], theme: 'Durable melee enemies built to hold the line.', behavior: 'Rush the closest threat, protect squishier allies, punish weak defenses.', lootHints: ['Military insignia', 'Better steel', 'Battle trophies'] },
	{ name: 'bandit-captain', displayName: 'Bandit Captain', tier: 'soldier', role: 'skirmisher', crRange: { min: 0.5, max: 2 }, baseStats: { hp: { min: 22, max: 45 }, ac: { min: 13, max: 17 }, attackBonus: { min: 4, max: 6 }, damagePerRound: { min: 10, max: 18 }, saveDC: { min: 12, max: 14 }, speed: { min: 30, max: 35 } }, traitSlots: 2, exampleCreatures: ['Bandit leader', 'Corsair duelist', 'Highway marauder'], theme: 'Mobile martial leaders who coordinate lesser allies.', behavior: 'Flank with allies, target wounded PCs, withdraw to rally troops.', lootHints: ['Stolen jewelry', 'Marked warrants', 'Smuggling notes'] },
	{ name: 'wild-shaman', displayName: 'Wild Shaman', tier: 'soldier', role: 'controller', crRange: { min: 0.5, max: 2 }, baseStats: { hp: { min: 16, max: 34 }, ac: { min: 11, max: 14 }, attackBonus: { min: 4, max: 6 }, damagePerRound: { min: 8, max: 15 }, saveDC: { min: 12, max: 14 }, speed: { min: 25, max: 30 } }, traitSlots: 3, exampleCreatures: ['Goblin hexer', 'Bog witch', 'Tribal stormcaller'], theme: 'Battlefield debuffers and primal casters.', behavior: 'Open with control magic, then support bruisers or retreat behind cover.', lootHints: ['Charm fetishes', 'Rare herbs', 'Totemic relics'] },
	{ name: 'stone-guardian', displayName: 'Stone Guardian', tier: 'soldier', role: 'brute', crRange: { min: 0.5, max: 2 }, baseStats: { hp: { min: 28, max: 50 }, ac: { min: 15, max: 18 }, attackBonus: { min: 4, max: 6 }, damagePerRound: { min: 10, max: 18 }, saveDC: { min: 12, max: 14 }, speed: { min: 20, max: 30 } }, traitSlots: 2, exampleCreatures: ['Animated statue', 'Rune sentinel', 'Earthen protector'], theme: 'Construct defenders with sturdy armor and slow movement.', behavior: 'Guard chokepoints, retaliate when bypassed, absorb frontline damage.', lootHints: ['Runestones', 'Enchanted core', 'Hidden key compartment'] },
	{ name: 'grave-hunter', displayName: 'Grave Hunter', tier: 'soldier', role: 'artillery', crRange: { min: 0.5, max: 2 }, baseStats: { hp: { min: 18, max: 32 }, ac: { min: 12, max: 15 }, attackBonus: { min: 4, max: 6 }, damagePerRound: { min: 9, max: 16 }, saveDC: { min: 12, max: 14 }, speed: { min: 25, max: 35 } }, traitSlots: 2, exampleCreatures: ['Necrotic archer', 'Crypt stalker', 'Ghoul thrower'], theme: 'Mid-tier ranged threats with nasty rider effects.', behavior: 'Attack from cover, focus lightly armored targets, reposition aggressively.', lootHints: ['Black-fletched arrows', 'Grave dust', 'Keys from the dead'] },

	{ name: 'ogre-champion', displayName: 'Ogre Champion', tier: 'elite', role: 'brute', crRange: { min: 3, max: 7 }, baseStats: { hp: { min: 55, max: 110 }, ac: { min: 13, max: 17 }, attackBonus: { min: 5, max: 8 }, damagePerRound: { min: 18, max: 35 }, saveDC: { min: 13, max: 16 }, speed: { min: 25, max: 40 } }, traitSlots: 3, exampleCreatures: ['Ogre warlord', 'Troll-like ravager', 'Hill giant bruiser'], theme: 'Heavy melee threats with punishing single-target damage.', behavior: 'Break the frontline, shove targets, smash clustered adventurers.', lootHints: ['Oversized trophies', 'Heavy valuables', 'Plunder sacks'] },
	{ name: 'wyld-sniper', displayName: 'Wyld Sniper', tier: 'elite', role: 'artillery', crRange: { min: 3, max: 7 }, baseStats: { hp: { min: 45, max: 85 }, ac: { min: 14, max: 18 }, attackBonus: { min: 6, max: 8 }, damagePerRound: { min: 18, max: 30 }, saveDC: { min: 14, max: 16 }, speed: { min: 30, max: 40 } }, traitSlots: 3, exampleCreatures: ['Fey marksman', 'Drow sharpshooter', 'Arcane gunner'], theme: 'High-precision ranged enemies with mobility tricks.', behavior: 'Stay mobile, punish exposed targets, disappear between shots.', lootHints: ['Fine bows', 'Poison vials', 'Scouting intel'] },
	{ name: 'necromancer-lieutenant', displayName: 'Necromancer Lieutenant', tier: 'elite', role: 'controller', crRange: { min: 3, max: 7 }, baseStats: { hp: { min: 40, max: 80 }, ac: { min: 13, max: 17 }, attackBonus: { min: 6, max: 8 }, damagePerRound: { min: 16, max: 28 }, saveDC: { min: 14, max: 16 }, speed: { min: 25, max: 30 } }, traitSlots: 4, exampleCreatures: ['Bone mage', 'Death priest', 'Crypt sorcerer'], theme: 'Battlefield controllers backed by undead or curses.', behavior: 'Weaken multiple PCs, summon support, preserve distance.', lootHints: ['Spellbook fragments', 'Soul gems', 'Funerary gold'] },
	{ name: 'temple-exemplar', displayName: 'Temple Exemplar', tier: 'elite', role: 'skirmisher', crRange: { min: 3, max: 7 }, baseStats: { hp: { min: 48, max: 90 }, ac: { min: 15, max: 19 }, attackBonus: { min: 6, max: 8 }, damagePerRound: { min: 16, max: 30 }, saveDC: { min: 14, max: 16 }, speed: { min: 30, max: 40 } }, traitSlots: 3, exampleCreatures: ['Sacred duelist', 'Sunblade guardian', 'Monastery enforcer'], theme: 'Disciplined duelists with mobility and defense.', behavior: 'Challenge the strongest PC, reposition constantly, punish reckless movement.', lootHints: ['Blessed relics', 'Temple seals', 'Ceremonial weapons'] },
	{ name: 'forest-alpha', displayName: 'Forest Alpha', tier: 'elite', role: 'lurker', crRange: { min: 3, max: 7 }, baseStats: { hp: { min: 50, max: 95 }, ac: { min: 13, max: 17 }, attackBonus: { min: 6, max: 8 }, damagePerRound: { min: 18, max: 32 }, saveDC: { min: 13, max: 16 }, speed: { min: 35, max: 50 } }, traitSlots: 3, exampleCreatures: ['Dire bear', 'Primal stalker', 'Displacer-style beast'], theme: 'Ambush predators with burst damage and movement pressure.', behavior: 'Strike from concealment, maul isolated prey, retreat into cover.', lootHints: ['Rare pelts', 'Gland extract', 'Nest treasures'] },

	{ name: 'war-chief', displayName: 'War Chief', tier: 'boss', role: 'brute', crRange: { min: 8, max: 14 }, baseStats: { hp: { min: 120, max: 220 }, ac: { min: 16, max: 20 }, attackBonus: { min: 7, max: 10 }, damagePerRound: { min: 30, max: 55 }, saveDC: { min: 15, max: 18 }, speed: { min: 30, max: 40 } }, traitSlots: 4, exampleCreatures: ['Orc warlord', 'Gnoll pack king', 'Infernal marauder chief'], theme: 'Commanding melee bosses that inspire and punish.', behavior: 'Lead from the front, issue commands, focus the most dangerous hero.', lootHints: ['Banner of command', 'Treasure chest', 'Named weapon'] },
	{ name: 'archmage-rival', displayName: 'Archmage Rival', tier: 'boss', role: 'controller', crRange: { min: 8, max: 14 }, baseStats: { hp: { min: 90, max: 170 }, ac: { min: 15, max: 19 }, attackBonus: { min: 8, max: 10 }, damagePerRound: { min: 28, max: 50 }, saveDC: { min: 16, max: 19 }, speed: { min: 25, max: 35 } }, traitSlots: 5, exampleCreatures: ['Forbidden scholar', 'Battle mage', 'Void seer'], theme: 'High-pressure spellcasting bosses with layered defenses.', behavior: 'Open with control, use minions as buffers, punish grouped targets.', lootHints: ['Spellbooks', 'Arcane foci', 'Planar notes'] },
	{ name: 'dragonkin-tyrant', displayName: 'Dragonkin Tyrant', tier: 'boss', role: 'artillery', crRange: { min: 8, max: 14 }, baseStats: { hp: { min: 130, max: 210 }, ac: { min: 17, max: 21 }, attackBonus: { min: 7, max: 10 }, damagePerRound: { min: 32, max: 58 }, saveDC: { min: 16, max: 19 }, speed: { min: 30, max: 50 } }, traitSlots: 4, exampleCreatures: ['Young dragon analogue', 'Drake tyrant', 'Scaled fire lord'], theme: 'Elemental bosses with area pressure and presence.', behavior: 'Control space, breath over clusters, retreat to advantageous terrain.', lootHints: ['Dragon hoard', 'Rare gems', 'Elemental residue'] },
	{ name: 'death-knight-echo', displayName: 'Death Knight Echo', tier: 'boss', role: 'skirmisher', crRange: { min: 8, max: 14 }, baseStats: { hp: { min: 125, max: 205 }, ac: { min: 17, max: 21 }, attackBonus: { min: 8, max: 10 }, damagePerRound: { min: 30, max: 54 }, saveDC: { min: 15, max: 18 }, speed: { min: 30, max: 40 } }, traitSlots: 4, exampleCreatures: ['Cursed knight', 'Fallen champion', 'Blackguard revenant'], theme: 'Mobile undead duelists with fear and necrotic riders.', behavior: 'Single out leaders, teleport or charge, punish radiant-light parties less effectively.', lootHints: ['Cursed regalia', 'Signet of betrayal', 'Blackened armor'] },
	{ name: 'ancient-warden', displayName: 'Ancient Warden', tier: 'boss', role: 'lurker', crRange: { min: 8, max: 14 }, baseStats: { hp: { min: 115, max: 200 }, ac: { min: 16, max: 20 }, attackBonus: { min: 7, max: 10 }, damagePerRound: { min: 30, max: 52 }, saveDC: { min: 15, max: 18 }, speed: { min: 25, max: 45 } }, traitSlots: 4, exampleCreatures: ['Guardian treant', 'Ancient ruin sentinel', 'Primeval stone beast'], theme: 'Territorial defenders with strong environmental interactions.', behavior: 'Use lair terrain, split the party, prioritize intruders near relics.', lootHints: ['Ancient seeds', 'Ward-stones', 'Forgotten relic cache'] },

	{ name: 'lich-sovereign', displayName: 'Lich Sovereign', tier: 'legendary', role: 'controller', crRange: { min: 15, max: 24 }, baseStats: { hp: { min: 210, max: 320 }, ac: { min: 17, max: 22 }, attackBonus: { min: 9, max: 13 }, damagePerRound: { min: 55, max: 95 }, saveDC: { min: 18, max: 22 }, speed: { min: 25, max: 35 } }, traitSlots: 6, exampleCreatures: ['Lich analogue', 'Deathless archsage', 'Soul emperor'], theme: 'Campaign-ending mastermind with overwhelming spell pressure.', behavior: 'Layer defenses, split the party, punish attrition, force hard choices.', lootHints: ['Phylactery clues', 'Artifact fragments', 'Treasury vaults'] },
	{ name: 'wyrm-apocalypse', displayName: 'Wyrm Apocalypse', tier: 'legendary', role: 'artillery', crRange: { min: 15, max: 24 }, baseStats: { hp: { min: 240, max: 360 }, ac: { min: 18, max: 23 }, attackBonus: { min: 10, max: 13 }, damagePerRound: { min: 60, max: 100 }, saveDC: { min: 19, max: 22 }, speed: { min: 40, max: 80 } }, traitSlots: 6, exampleCreatures: ['Ancient dragon analogue', 'Cataclysm drake', 'Storm serpent'], theme: 'Massive mobile threat with devastating breath or spell-like blasts.', behavior: 'Strafe, reposition vertically, use lair actions and fear.', lootHints: ['Mythic hoard', 'Legendary scales', 'Kingdom-level treasure'] },
	{ name: 'demon-general', displayName: 'Demon General', tier: 'legendary', role: 'brute', crRange: { min: 15, max: 24 }, baseStats: { hp: { min: 230, max: 350 }, ac: { min: 17, max: 22 }, attackBonus: { min: 10, max: 13 }, damagePerRound: { min: 58, max: 96 }, saveDC: { min: 18, max: 21 }, speed: { min: 35, max: 50 } }, traitSlots: 5, exampleCreatures: ['Balor-style fiend', 'Infernal conqueror', 'Abyssal warlord'], theme: 'World-tier melee engine of destruction.', behavior: 'Teleport or charge into the center, spread fear, punish clumping.', lootHints: ['Hell-forged armaments', 'Soul coins', 'Infernal contracts'] },
	{ name: 'fate-weaver', displayName: 'Fate Weaver', tier: 'legendary', role: 'lurker', crRange: { min: 15, max: 24 }, baseStats: { hp: { min: 200, max: 300 }, ac: { min: 18, max: 22 }, attackBonus: { min: 9, max: 12 }, damagePerRound: { min: 50, max: 88 }, saveDC: { min: 18, max: 22 }, speed: { min: 30, max: 50 } }, traitSlots: 6, exampleCreatures: ['Time-bending fey queen', 'Nightmare oracle', 'Void spider empress'], theme: 'Reality-warping elite predator with teleportation and probability tricks.', behavior: 'Vanish, return at the worst moment, isolate one target at a time.', lootHints: ['Prophetic threads', 'Chronal crystals', 'Crown of omens'] },
	{ name: 'godforged-colossus', displayName: 'Godforged Colossus', tier: 'legendary', role: 'brute', crRange: { min: 15, max: 24 }, baseStats: { hp: { min: 260, max: 400 }, ac: { min: 19, max: 24 }, attackBonus: { min: 10, max: 13 }, damagePerRound: { min: 62, max: 105 }, saveDC: { min: 18, max: 22 }, speed: { min: 20, max: 35 } }, traitSlots: 5, exampleCreatures: ['Titanic construct', 'Runic war engine', 'Living fortress core'], theme: 'Siege-scale enemy with enormous durability and battlefield control.', behavior: 'Flatten terrain, block escape, focus objectives as much as heroes.', lootHints: ['Mythic engine parts', 'Ancient alloys', 'Vault key cores'] }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getTemplateForCR(cr: number): MonsterTemplate[] {
	return MONSTER_TEMPLATES.filter((template) => cr >= template.crRange.min && cr <= template.crRange.max);
}

export function getTemplatesByTier(tier: MonsterTier): MonsterTemplate[] {
	return MONSTER_TEMPLATES.filter((template) => template.tier === tier);
}
