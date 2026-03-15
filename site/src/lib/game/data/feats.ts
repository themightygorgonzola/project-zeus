/**
 * 5e SRD Feat Definitions
 *
 * Core SRD feat catalog with lightweight prerequisite and effect tagging.
 *
 * Sources: 5e SRD (CC-BY-4.0)
 */

import type { AbilityName, SkillName } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeatPrerequisite {
	ability?: { name: AbilityName; minimum: number };
	race?: string;
	proficiency?: string;
	spellcasting?: boolean;
	custom?: string;
}

export type FeatEffect =
	| { tag: 'ability-increase'; ability: AbilityName; amount: number }
	| { tag: 'skill-proficiency'; skill: SkillName }
	| { tag: 'tool-proficiency'; tool: string }
	| { tag: 'weapon-proficiency'; weapon: string }
	| { tag: 'armor-proficiency'; armor: string }
	| { tag: 'spell-grant'; spell: string }
	| { tag: 'cantrip-grant'; spell: string }
	| { tag: 'hp-increase'; amount: number }
	| { tag: 'custom'; description: string };

export interface FeatDefinition {
	name: string;
	displayName: string;
	prerequisites: FeatPrerequisite[];
	description: string;
	effects: FeatEffect[];
}

// ---------------------------------------------------------------------------
// Feat Data
// ---------------------------------------------------------------------------

export const FEATS: FeatDefinition[] = [
	{ name: 'actor', displayName: 'Actor', prerequisites: [], description: 'Increase Charisma by 1. Gain advantage on Deception and Performance checks made to pass yourself off as a different person, and mimic speech and sounds after hearing them for 1 minute.', effects: [{ tag: 'ability-increase', ability: 'cha', amount: 1 }, { tag: 'custom', description: 'Advantage on impersonation-related Deception and Performance checks; can mimic speech and sounds.' }] },
	{ name: 'alert', displayName: 'Alert', prerequisites: [], description: 'Always on the lookout for danger. Gain +5 to initiative, you can’t be surprised while conscious, and unseen attackers don’t gain advantage against you merely from being unseen.', effects: [{ tag: 'custom', description: '+5 initiative; cannot be surprised while conscious; unseen attackers do not gain advantage solely for being unseen.' }] },
	{ name: 'athlete', displayName: 'Athlete', prerequisites: [], description: 'Increase Strength or Dexterity by 1. Standing from prone uses only 5 feet of movement, climbing no longer costs extra movement, and you can make running long or high jumps with less lead-in.', effects: [{ tag: 'custom', description: 'Increase Strength or Dexterity by 1; improved climbing, jumping, and standing from prone.' }] },
	{ name: 'charger', displayName: 'Charger', prerequisites: [], description: 'When you use your action to Dash, you can use a bonus action to make one melee weapon attack or shove a creature. If you move at least 10 feet before the attack, gain +5 damage or push 10 feet on a shove.', effects: [{ tag: 'custom', description: 'Dash into attack or shove as bonus action; gain +5 melee damage or shove 10 feet after 10-foot run-up.' }] },
	{ name: 'crossbow-expert', displayName: 'Crossbow Expert', prerequisites: [], description: 'Ignore the loading property of crossbows you are proficient with, do not suffer disadvantage with ranged attacks in melee, and gain a bonus-action hand crossbow attack when using the Attack action with a one-handed weapon.', effects: [{ tag: 'custom', description: 'Ignore loading on proficient crossbows; no melee disadvantage on ranged attacks; gain hand crossbow bonus attack after one-handed Attack action.' }] },
	{ name: 'defensive-duelist', displayName: 'Defensive Duelist', prerequisites: [{ proficiency: 'finesse weapon' }], description: 'When wielding a finesse weapon with which you are proficient and another creature hits you with a melee attack, use your reaction to add your proficiency bonus to your AC for that attack.', effects: [{ tag: 'custom', description: 'Reaction: add proficiency bonus to AC against one melee attack while wielding a finesse weapon.' }] },
	{ name: 'dual-wielder', displayName: 'Dual Wielder', prerequisites: [], description: 'Gain +1 AC while wielding a separate melee weapon in each hand, can use two-weapon fighting with non-light one-handed weapons, and may draw or stow two one-handed weapons when otherwise able to draw or stow one.', effects: [{ tag: 'custom', description: '+1 AC while dual wielding; two-weapon fighting with non-light one-handed weapons; draw or stow two weapons at once.' }] },
	{ name: 'dungeon-delver', displayName: 'Dungeon Delver', prerequisites: [], description: 'Alert to hidden traps and secret doors. Gain advantage on Perception and Investigation checks to detect secret doors and traps, resistance to trap damage, advantage on saves against traps, and travel at normal pace while searching for traps.', effects: [{ tag: 'custom', description: 'Advantage on trap and secret door detection, advantage on saves against traps, resistance to trap damage, normal pace while searching for traps.' }] },
	{ name: 'durable', displayName: 'Durable', prerequisites: [], description: 'Increase Constitution by 1. When you roll a Hit Die to regain hit points, the minimum number of hit points you regain equals twice your Constitution modifier.', effects: [{ tag: 'ability-increase', ability: 'con', amount: 1 }, { tag: 'custom', description: 'Hit Dice healing minimum equals twice Constitution modifier.' }] },
	{ name: 'elemental-adept', displayName: 'Elemental Adept', prerequisites: [{ spellcasting: true }], description: 'Choose acid, cold, fire, lightning, or thunder. Spells you cast ignore resistance to the chosen type, and damage dice of 1 on spells of that type count as 2.', effects: [{ tag: 'custom', description: 'Choose acid, cold, fire, lightning, or thunder; your spells ignore resistance to that type and treat 1s on damage dice as 2s.' }] },
	{ name: 'grappler', displayName: 'Grappler', prerequisites: [{ ability: { name: 'str', minimum: 13 } }], description: 'Gain advantage on attack rolls against a creature you are grappling, and you can use your action to try to pin a creature grappled by you.', effects: [{ tag: 'custom', description: 'Advantage on attacks against creatures you grapple; can pin a grappled creature with an action.' }] },
	{ name: 'great-weapon-master', displayName: 'Great Weapon Master', prerequisites: [], description: 'On your turn, when you score a critical hit or reduce a creature to 0 hit points with a melee weapon, make one melee weapon attack as a bonus action. Before making a melee attack with a heavy weapon you are proficient with, you can take -5 to hit for +10 damage.', effects: [{ tag: 'custom', description: 'Bonus attack on crit/kill with melee weapon; heavy weapon attacks may take -5 to hit for +10 damage.' }] },
	{ name: 'healer', displayName: 'Healer', prerequisites: [], description: 'A healer’s kit has expanded utility. As an action, expend one use of a healer’s kit to stabilize a creature and restore 1 hit point, or to restore additional hit points once per creature per short or long rest.', effects: [{ tag: 'custom', description: 'Improves healer’s kit; stabilize and heal with it once per rest per creature.' }] },
	{ name: 'heavily-armored', displayName: 'Heavily Armored', prerequisites: [{ proficiency: 'medium armor' }], description: 'Increase Strength by 1 and gain proficiency with heavy armor.', effects: [{ tag: 'ability-increase', ability: 'str', amount: 1 }, { tag: 'armor-proficiency', armor: 'heavy' }] },
	{ name: 'heavy-armor-master', displayName: 'Heavy Armor Master', prerequisites: [{ proficiency: 'heavy armor' }], description: 'Increase Strength by 1 and reduce nonmagical bludgeoning, piercing, and slashing damage you take while wearing heavy armor by 3.', effects: [{ tag: 'ability-increase', ability: 'str', amount: 1 }, { tag: 'custom', description: 'Reduce nonmagical bludgeoning, piercing, and slashing damage by 3 while wearing heavy armor.' }] },
	{ name: 'inspiring-leader', displayName: 'Inspiring Leader', prerequisites: [{ ability: { name: 'cha', minimum: 13 } }], description: 'Spend 10 minutes inspiring up to six friendly creatures, granting temporary hit points equal to your level + your Charisma modifier.', effects: [{ tag: 'custom', description: 'After 10 minutes, grant temp HP equal to your level + Charisma modifier to up to six creatures.' }] },
	{ name: 'keen-mind', displayName: 'Keen Mind', prerequisites: [], description: 'Increase Intelligence by 1. Always know which way is north, know the number of hours left before sunrise or sunset, and can accurately recall anything seen or heard within the past month.', effects: [{ tag: 'ability-increase', ability: 'int', amount: 1 }, { tag: 'custom', description: 'Always know north, time until sunrise/sunset, and recall anything seen or heard within the past month.' }] },
	{ name: 'lightly-armored', displayName: 'Lightly Armored', prerequisites: [], description: 'Increase Strength or Dexterity by 1 and gain proficiency with light armor.', effects: [{ tag: 'custom', description: 'Increase Strength or Dexterity by 1 and gain proficiency with light armor.' }, { tag: 'armor-proficiency', armor: 'light' }] },
	{ name: 'linguist', displayName: 'Linguist', prerequisites: [], description: 'Increase Intelligence by 1, learn three languages of your choice, and create written ciphers others cannot decode without magic or repeated effort.', effects: [{ tag: 'ability-increase', ability: 'int', amount: 1 }, { tag: 'custom', description: 'Learn three languages and create hard-to-decipher ciphers.' }] },
	{ name: 'lucky', displayName: 'Lucky', prerequisites: [], description: 'Gain 3 luck points per long rest. Spend them to roll an additional d20 on an attack roll, ability check, or saving throw, or when an attack roll is made against you.', effects: [{ tag: 'custom', description: 'Gain 3 luck points per long rest to influence d20 rolls.' }] },
	{ name: 'mage-slayer', displayName: 'Mage Slayer', prerequisites: [], description: 'When a creature within 5 feet casts a spell, use your reaction to make a melee weapon attack against it. Creatures damaged by you have disadvantage on concentration saves, and you have advantage on saves against spells cast by creatures within 5 feet.', effects: [{ tag: 'custom', description: 'Reaction attack against nearby casters, disadvantage on their concentration saves if damaged by you, advantage on saves versus their spells.' }] },
	{ name: 'magic-initiate', displayName: 'Magic Initiate', prerequisites: [], description: 'Choose a class’s spell list. Learn two cantrips and one 1st-level spell from that list; cast the 1st-level spell once per long rest.', effects: [{ tag: 'custom', description: 'Choose a class spell list; learn two cantrips and one 1st-level spell castable once per long rest.' }] },
	{ name: 'martial-adept', displayName: 'Martial Adept', prerequisites: [], description: 'Learn two maneuvers from the Battle Master archetype and gain one superiority die (d6), which is expended when used and regained on a short or long rest.', effects: [{ tag: 'custom', description: 'Learn two Battle Master maneuvers and gain one d6 superiority die per short or long rest.' }] },
	{ name: 'medium-armor-master', displayName: 'Medium Armor Master', prerequisites: [{ proficiency: 'medium armor' }], description: 'Wearing medium armor does not impose disadvantage on Stealth, and you can add up to 3 Dexterity modifier to AC instead of 2.', effects: [{ tag: 'custom', description: 'No Stealth disadvantage in medium armor; add up to +3 Dexterity to AC in medium armor.' }] },
	{ name: 'mobile', displayName: 'Mobile', prerequisites: [], description: 'Speed increases by 10 feet, dashing ignores difficult terrain, and after making a melee attack against a creature, you do not provoke opportunity attacks from it for the rest of the turn.', effects: [{ tag: 'custom', description: '+10 speed; difficult terrain does not slow you when dashing; no opportunity attacks from creatures you attacked in melee this turn.' }] },
	{ name: 'moderately-armored', displayName: 'Moderately Armored', prerequisites: [{ proficiency: 'light armor' }], description: 'Increase Strength or Dexterity by 1 and gain proficiency with medium armor and shields.', effects: [{ tag: 'custom', description: 'Increase Strength or Dexterity by 1 and gain proficiency with medium armor and shields.' }, { tag: 'armor-proficiency', armor: 'medium' }, { tag: 'armor-proficiency', armor: 'shield' }] },
	{ name: 'mounted-combatant', displayName: 'Mounted Combatant', prerequisites: [], description: 'Gain advantage on melee attacks against unmounted creatures smaller than your mount, redirect attacks targeting your mount to you, and your mount gains improved protection on Dexterity saves.', effects: [{ tag: 'custom', description: 'Mounted combat benefits: attack advantage vs smaller unmounted targets, redirect attacks from your mount, and protect mount on Dexterity saves.' }] },
	{ name: 'observant', displayName: 'Observant', prerequisites: [], description: 'Increase Intelligence or Wisdom by 1, read lips, and gain +5 to passive Perception and passive Investigation.', effects: [{ tag: 'custom', description: 'Increase Intelligence or Wisdom by 1, read lips, and gain +5 passive Perception and Investigation.' }] },
	{ name: 'polearm-master', displayName: 'Polearm Master', prerequisites: [], description: 'When wielding a glaive, halberd, quarterstaff, or spear, gain a bonus-action butt-end attack and opportunity attacks when creatures enter your reach.', effects: [{ tag: 'custom', description: 'Bonus-action butt strike and reach-triggered opportunity attacks with glaive, halberd, quarterstaff, or spear.' }] },
	{ name: 'resilient', displayName: 'Resilient', prerequisites: [], description: 'Increase one ability score by 1 and gain proficiency in saving throws using that ability.', effects: [{ tag: 'custom', description: 'Increase one ability score by 1 and gain saving throw proficiency in that ability.' }] },
	{ name: 'ritual-caster', displayName: 'Ritual Caster', prerequisites: [{ ability: { name: 'int', minimum: 13 } }], description: 'Choose a class with ritual spellcasting. Gain a ritual book with two 1st-level ritual spells from that class, and you can add more ritual spells found during play.', effects: [{ tag: 'custom', description: 'Gain a ritual book with two 1st-level ritual spells from a chosen class and can add more rituals later.' }] },
	{ name: 'savage-attacker', displayName: 'Savage Attacker', prerequisites: [], description: 'Once per turn when you roll damage for a melee weapon attack, reroll the weapon’s damage dice and use either total.', effects: [{ tag: 'custom', description: 'Once per turn reroll melee weapon damage dice and choose either result.' }] },
	{ name: 'sentinel', displayName: 'Sentinel', prerequisites: [], description: 'Opportunity attacks reduce a target’s speed to 0 on a hit, disengaging foes still provoke, and you may react when a nearby creature attacks an ally.', effects: [{ tag: 'custom', description: 'Opportunity attacks stop movement on a hit, ignore Disengage, and allow reaction attacks against creatures attacking nearby allies.' }] },
	{ name: 'sharpshooter', displayName: 'Sharpshooter', prerequisites: [], description: 'Ranged attacks ignore long-range disadvantage, ignore half and three-quarters cover, and can take -5 to hit for +10 damage.', effects: [{ tag: 'custom', description: 'Ignore long-range disadvantage and partial cover with ranged attacks; may take -5 to hit for +10 damage.' }] },
	{ name: 'shield-master', displayName: 'Shield Master', prerequisites: [], description: 'While wielding a shield, use a bonus action to shove after attacking, add shield AC to Dexterity saves against effects targeting only you, and potentially take no damage on a successful Dexterity save.', effects: [{ tag: 'custom', description: 'Shield shove bonus action, improved Dexterity saves with shield, and Evasion-like shield protection.' }] },
	{ name: 'skilled', displayName: 'Skilled', prerequisites: [], description: 'Gain proficiency in any combination of three skills or tools of your choice.', effects: [{ tag: 'custom', description: 'Gain proficiency in any three skills or tools.' }] },
	{ name: 'skulker', displayName: 'Skulker', prerequisites: [], description: 'Hide when lightly obscured, missing a ranged attack while hidden does not reveal you, and dim light does not impose disadvantage on Perception relying on sight.', effects: [{ tag: 'custom', description: 'Better hiding in light obscurement, missed ranged attacks from hiding do not reveal you, and no dim-light disadvantage on sight-based Perception.' }] },
	{ name: 'spell-sniper', displayName: 'Spell Sniper', prerequisites: [{ spellcasting: true }], description: 'Learn one attack cantrip, double the range of spells requiring attack rolls, and ignore half and three-quarters cover with those spell attacks.', effects: [{ tag: 'custom', description: 'Learn an attack cantrip, double the range of spell attacks, and ignore partial cover with them.' }] },
	{ name: 'tavern-brawler', displayName: 'Tavern Brawler', prerequisites: [], description: 'Increase Strength or Constitution by 1, gain proficiency with improvised weapons, improve unarmed strike damage, and bonus-action grapple after hitting with an improvised weapon or unarmed strike.', effects: [{ tag: 'custom', description: 'Increase Strength or Constitution by 1, gain improvised weapon proficiency, improve unarmed damage, and bonus-action grapple after qualifying hits.' }] },
	{ name: 'tough', displayName: 'Tough', prerequisites: [], description: 'Your hit point maximum increases by an amount equal to twice your level when you gain this feat. Whenever you gain a level thereafter, your maximum hit points increase by an additional 2 hit points.', effects: [{ tag: 'hp-increase', amount: 2 }, { tag: 'custom', description: '+2 maximum hit points per level, including retroactively.' }] },
	{ name: 'war-caster', displayName: 'War Caster', prerequisites: [{ spellcasting: true }], description: 'You have advantage on Constitution saves to maintain concentration, can perform somatic components while wielding weapons or shields, and may cast a spell instead of making an opportunity attack.', effects: [{ tag: 'custom', description: 'Advantage on concentration saves, can perform somatic components with hands occupied, and may cast a spell for an opportunity attack.' }] },
	{ name: 'weapon-master', displayName: 'Weapon Master', prerequisites: [], description: 'Increase Strength or Dexterity by 1 and gain proficiency with four weapons of your choice.', effects: [{ tag: 'custom', description: 'Increase Strength or Dexterity by 1 and gain proficiency with four chosen weapons.' }] }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getFeat(name: string): FeatDefinition | undefined {
	const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
	return FEATS.find((feat) => feat.name === normalized || feat.displayName.toLowerCase() === name.trim().toLowerCase());
}
