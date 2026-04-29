/**
 * 5e SRD Background Definitions
 *
 * Standard PHB/SRD backgrounds with proficiencies, equipment,
 * narrative feature text, and suggested characteristics.
 *
 * Sources: 5e SRD (CC-BY-4.0)
 */

import type { SkillName } from '../types';
import type { Language, ToolProficiency } from './races';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackgroundName =
	| 'acolyte'
	| 'charlatan'
	| 'criminal'
	| 'entertainer'
	| 'folk-hero'
	| 'guild-artisan'
	| 'hermit'
	| 'noble'
	| 'outlander'
	| 'sage'
	| 'sailor'
	| 'soldier'
	| 'urchin';

export interface BackgroundFeature {
	name: string;
	description: string;
}

export interface SuggestedCharacteristics {
	personalityTraits: string[];
	ideals: string[];
	bonds: string[];
	flaws: string[];
}

/** One selectable item option inside a background equipment choice. */
export interface BackgroundChoiceOption {
	label: string;
	description?: string;
	/** Item strings added to the character's inventory when this option is selected. */
	items: string[];
}

export type BackgroundChoiceType = 'radio' | 'text' | 'dual-radio';

/**
 * Describes a single interactive equipment choice block shown in the Background
 * detail pane during character creation.
 */
export interface BackgroundEquipmentChoice {
	/** Unique key stored in CharacterCreateInput.backgroundEquipmentChoices. */
	id: string;
	/** Heading shown above the choice block, e.g. "Choose One" | "Describe". */
	sectionLabel: string;
	/** Short instruction text shown below the heading. */
	prompt: string;
	type: BackgroundChoiceType;
	required: boolean;

	// ── radio / dual-radio ─────────────────────────────────────────────────
	options?: BackgroundChoiceOption[];
	/** dual-radio: id key for the second radio group. */
	secondId?: string;
	/** dual-radio: label/question shown above the second radio group. */
	secondPrompt?: string;
	/** dual-radio: options for the second radio group. */
	secondOptions?: BackgroundChoiceOption[];

	// ── text ───────────────────────────────────────────────────────────────
	textMaxWords?: number;
	textMaxChars?: number;
	textPlaceholder?: string;
	optional?: boolean;
	/** Items always added regardless of the text value (text is flavour only). */
	fixedItems?: string[];
	/**
	 * Template string for building an item name from the user's value.
	 * The id placeholder (wrapped in `{}`) is replaced with the selected value.
	 * e.g. "Map of {cityOfOrigin}" → "Map of Thornwall"
	 */
	itemNameTemplate?: string;
	/** If the stored value equals this label, no items are added. */
	skipLabel?: string;
	/** An "Or:" fallback radio option rendered below a text box. */
	orDefaultOption?: { label: string; items: string[] };
}

export interface BackgroundDefinition {
	name: BackgroundName;
	displayName: string;
	description: string;
	skillProficiencies: [SkillName, SkillName];
	toolProficiencies: string[];
	languageChoices?: number;
	languages?: Language[];
	equipment: string[];
	equipmentChoices?: BackgroundEquipmentChoice[];
	feature: BackgroundFeature;
	suggestedCharacteristics: SuggestedCharacteristics;
}

// ---------------------------------------------------------------------------
// Background Data
// ---------------------------------------------------------------------------

export const BACKGROUNDS: BackgroundDefinition[] = [
	{
		name: 'acolyte',
		displayName: 'Acolyte',
		description: 'You have spent your life in the service of a temple to a specific god or pantheon of gods.',
		skillProficiencies: ['insight', 'religion'],
		toolProficiencies: [],
		languageChoices: 2,
		equipment: ['Holy Symbol', 'Incense (5 sticks)', 'Vestments', 'Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'prayerItem',
				sectionLabel: 'Choose One',
				prompt: 'Your faith’s practice uses one of these sacred texts or tools.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Prayer Book', description: 'A bound collection of prayers and scripture.', items: ['Prayer Book'] },
					{ label: 'Prayer Wheel', description: 'A spinning wheel inscribed with sacred mantras.', items: ['Prayer Wheel'] },
				],
			},
		],
		feature: {
			name: 'Shelter of the Faithful',
			description: 'You and your companions can expect free healing and care at a temple or shrine of your faith, though you must provide any material components needed for spells. Those who share your religion will support you, though only modestly.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I idolize a particular hero of my faith.', 'I can find common ground between the fiercest enemies.', 'I see omens in every event.', 'Nothing can shake my optimistic attitude.'],
			ideals: ['Tradition. Ancient traditions of worship and sacrifice must be preserved.', 'Charity. I always try to help those in need.', 'Change. We must help bring about the changes the gods are working in the world.', 'Faith. I trust that my deity will guide my actions.'],
			bonds: ['I would die to recover an ancient relic of my faith.', 'I owe my life to the priest who took me in.', 'Everything I do is for the common people.', 'I seek to preserve a sacred text that my enemies consider heretical.'],
			flaws: ['I judge others harshly, and myself even more severely.', 'I put too much trust in those who wield power within my temple.', 'My piety sometimes leads me to blindly trust those who profess faith.', 'I am inflexible in my thinking.']
		}
	},
	{
		name: 'charlatan',
		displayName: 'Charlatan',
		description: 'You have always had a way with people, and with words. Truth is flexible when survival depends on a convincing lie.',
		skillProficiencies: ['deception', 'sleight-of-hand'],
		toolProficiencies: ['disguise-kit', 'forgery-kit'],
		equipment: ['Fine Clothes', 'Disguise Kit', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'conTool',
				sectionLabel: 'Choose One',
				prompt: 'Every charlatan has a preferred tool of the trade.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Thieves’ Tools (Lockpicks)', description: 'Precision picks for locks and pockets.', items: ['Thieves’ Tools (Lockpicks)'] },
					{ label: 'Loaded Dice Set', description: 'Weighted dice that roll in your favor.', items: ['Loaded Dice Set'] },
					{ label: 'Marked Playing Cards', description: 'A deck only you can truly read.', items: ['Marked Playing Cards'] },
					{ label: 'False Merchant’s Seal Ring', description: 'A signet bearing a fabricated noble crest.', items: ['False Merchant’s Seal Ring'] },
					{ label: 'Snake Oil Vials (x3)', description: 'Three vials of colored water sold as miracle cures.', items: ['Snake Oil Vials (x3)'] },
					{ label: 'Confidence Letter Kit', description: 'Forged letters of credit and sealed blank warrants.', items: ['Confidence Letter Kit'] },
				],
			},
		],
		feature: {
			name: 'False Identity',
			description: 'You have created a second identity that includes documentation, established acquaintances, and disguises that allow you to assume that persona.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I fall in and out of love easily, and am always pursuing someone.', 'I have a joke for every occasion, especially when humor is inappropriate.', 'Flattery is my preferred trick for getting what I want.', 'I keep multiple holy symbols on hand and invoke whichever deity serves the moment.'],
			ideals: ['Independence. I am a free spirit—no one tells me what to do.', 'Fairness. I never target people who can’t afford to lose a few coins.', 'Creativity. I never run the same con twice.', 'Friendship. Material goods come and go; bonds matter more.'],
			bonds: ['I owe everything to my mentor in the trade.', 'Somewhere out there, I have a child who does not know me.', 'I come from a noble family, and one day I will reclaim my lands and title.', 'A powerful person killed someone I loved; some day soon, I will have my revenge.'],
			flaws: ['I can’t resist a pretty face.', 'I’m always in debt. I spend my ill-gotten gains on decadent luxuries faster than I bring them in.', 'I’m convinced that no one could ever fool me the way I fool others.', 'I can’t resist taking a risk if there’s money involved.']
		}
	},
	{
		name: 'criminal',
		displayName: 'Criminal',
		description: 'You are an experienced criminal with a history of breaking the law.',
		skillProficiencies: ['deception', 'stealth'],
		toolProficiencies: ['gaming-set', 'thieves-tools'],
		equipment: ['Crowbar', 'Dark Common Clothes with Hood', 'Belt Pouch'],
		feature: {
			name: 'Criminal Contact',
			description: 'You have a reliable and trustworthy contact who acts as your liaison to a network of other criminals.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I always have a plan for what to do when things go wrong.', 'I am always calm, no matter what the situation.', 'The first thing I do in a new place is note the locations of everything valuable.', 'I would rather make a new friend than a new enemy.'],
			ideals: ['Honor. I don’t steal from others in the trade.', 'Freedom. Chains are meant to be broken.', 'Charity. I steal from the wealthy so I can help people in need.', 'Greed. I will do whatever it takes to become wealthy.'],
			bonds: ['I’m trying to pay off an old debt.', 'My ill-gotten gains go to support my family.', 'Something important was taken from me, and I aim to steal it back.', 'I will become the greatest thief that ever lived.'],
			flaws: ['When I see something valuable, I can’t think about anything but how to steal it.', 'I turn tail and run when things look bad.', 'An innocent person is in prison for a crime that I committed.', 'I can’t resist swindling people who are more powerful than me.']
		}
	},
	{
		name: 'entertainer',
		displayName: 'Entertainer',
		description: 'You thrive in front of an audience. Music, dance, poetry, and storytelling are your tools.',
		skillProficiencies: ['acrobatics', 'performance'],
		toolProficiencies: ['disguise-kit', 'musical-instrument'],
		equipment: ['Belt Pouch'],
		equipmentChoices: [
			{
				id: 'instrument',
				sectionLabel: 'Choose One',
				prompt: 'Choose your primary musical instrument.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Lute', items: ['Lute'] },
					{ label: 'Lyre', items: ['Lyre'] },
					{ label: 'Flute', items: ['Flute'] },
					{ label: 'Hand Drum', items: ['Hand Drum'] },
					{ label: 'Viol', items: ['Viol'] },
					{ label: 'Horn', items: ['Horn'] },
					{ label: 'Bagpipes', items: ['Bagpipes'] },
					{ label: 'Shawm', items: ['Shawm'] },
				],
			},
			{
				id: 'costume',
				sectionLabel: 'Choose One',
				prompt: 'Choose your performance costume.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Jester Motley', items: ['Jester Motley'] },
					{ label: 'Performer’s Stage Robes', items: ['Performer’s Stage Robes'] },
					{ label: 'Court Finery', items: ['Court Finery'] },
					{ label: 'Acrobat Silks', items: ['Acrobat Silks'] },
					{ label: 'Masquerade Costume', items: ['Masquerade Costume'] },
				],
			},
			{
				id: 'admirerFavor',
				sectionLabel: 'Describe',
				prompt: 'Describe the token or favor given to you by an admirer.',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 20,
				textPlaceholder: 'Describe the favor given by an admirer...',
				fixedItems: ['Token from an Admirer'],
			},
		],
		feature: {
			name: 'By Popular Demand',
			description: 'You can always find a place to perform, usually in an inn or tavern, where you receive free lodging and food of a modest standard as long as you perform each night.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I know a story relevant to almost every situation.', 'Whenever I come to a new place, I collect local rumors and spread gossip.', 'I love a good insult, even one directed at me.', 'I’m a hopeless romantic, always searching for that “special someone.”'],
			ideals: ['Beauty. When I perform, I make the world better than it was.', 'Tradition. Stories and legends keep the past alive.', 'Creativity. The world is in need of new ideas and bold action.', 'People. I like seeing the smiles on people’s faces when I perform.'],
			bonds: ['My instrument is my most treasured possession.', 'Someone stole my prized instrument, and someday I’ll get it back.', 'I want to be famous, whatever it takes.', 'I idolize a hero of the old tales and measure my deeds against theirs.'],
			flaws: ['I’ll do anything to win fame and renown.', 'I’m a sucker for a pretty face.', 'A scandal prevents me from ever going home again.', 'I once satirized a noble who still wants my head.']
		}
	},
	{
		name: 'folk-hero',
		displayName: 'Folk Hero',
		description: 'You come from a humble social rank, but you are destined for so much more.',
		skillProficiencies: ['animal-handling', 'survival'],
		toolProficiencies: ['artisan-tools', 'vehicles-land'],
		equipment: ['Shovel', 'Iron Pot', 'Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'artisanTool',
				sectionLabel: 'Choose One',
				prompt: 'What tools did you use in your trade before adventuring?',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Blacksmith’s Tools', items: ['Blacksmith’s Tools'] },
					{ label: 'Carpenter’s Tools', items: ['Carpenter’s Tools'] },
					{ label: 'Mason’s Tools', items: ['Mason’s Tools'] },
					{ label: 'Potter’s Tools', items: ['Potter’s Tools'] },
					{ label: 'Weaver’s Tools', items: ['Weaver’s Tools'] },
					{ label: 'Leatherworker’s Tools', items: ['Leatherworker’s Tools'] },
					{ label: 'Cook’s Utensils', items: ['Cook’s Utensils'] },
					{ label: 'Tinker’s Tools', items: ['Tinker’s Tools'] },
				],
			},
		],
		feature: {
			name: 'Rustic Hospitality',
			description: 'Commoners will shield you from the law or anyone else searching for you, though they will not risk their lives for you.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I judge people by their actions, not their words.', 'If someone is in trouble, I’m always ready to lend help.', 'I have a strong sense of fair play.', 'I’m confident in my own abilities and do what I can to instill confidence in others.'],
			ideals: ['Respect. People deserve to be treated with dignity.', 'Fairness. No one should get preferential treatment before the law.', 'Freedom. Tyrants must not be allowed to oppress the people.', 'Might. If I become strong, I can take what I want.'],
			bonds: ['I have a family, but I have no idea where they are.', 'I worked the land, I love the land, and I will protect the land.', 'A proud noble once gave me a terrible beating, and I will take revenge.', 'My tools are symbols of my past life, and I carry them so I will never forget my roots.'],
			flaws: ['The tyrant who rules my land will stop at nothing to see me killed.', 'I’m convinced of the significance of my destiny, and blind to my shortcomings.', 'The people who knew me when I was young know my shameful secret.', 'I have trouble trusting in my allies.']
		}
	},
	{
		name: 'guild-artisan',
		displayName: 'Guild Artisan',
		description: 'You are a member of an artisan’s guild, skilled in a particular field and associated with other artisans.',
		skillProficiencies: ['insight', 'persuasion'],
		toolProficiencies: ['artisan-tools'],
		languageChoices: 1,
		equipment: ['Traveler’s Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'artisanSpecialization',
				sectionLabel: 'Choose Your Trade',
				prompt: 'Choose your guild and the tools of your craft.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Blacksmiths’ Guild', description: 'Smithing metals and forging iron.', items: ['Blacksmith’s Tools', 'Letter of Introduction from the Blacksmiths’ Guild'] },
					{ label: 'Carpenters’ Guild', description: 'Shaping timber into homes and furniture.', items: ['Carpenter’s Tools', 'Letter of Introduction from the Carpenters’ Guild'] },
					{ label: 'Masons’ Guild', description: 'Working stone for buildings and monuments.', items: ['Mason’s Tools', 'Letter of Introduction from the Masons’ Guild'] },
					{ label: 'Potters’ Guild', description: 'Shaping clay into vessels and tiles.', items: ['Potter’s Tools', 'Letter of Introduction from the Potters’ Guild'] },
					{ label: 'Weavers’ Guild', description: 'Crafting cloth and garments from fiber.', items: ['Weaver’s Tools', 'Letter of Introduction from the Weavers’ Guild'] },
					{ label: 'Leatherworkers’ Guild', description: 'Tanning hides and stitching leather goods.', items: ['Leatherworker’s Tools', 'Letter of Introduction from the Leatherworkers’ Guild'] },
					{ label: 'Cooks’ Guild', description: 'Preparing meals for inns and feasts.', items: ['Cook’s Utensils', 'Letter of Introduction from the Cooks’ Guild'] },
					{ label: 'Tinkers’ Guild', description: 'Building and repairing small mechanical devices.', items: ['Tinker’s Tools', 'Letter of Introduction from the Tinkers’ Guild'] },
				],
			},
		],
		feature: {
			name: 'Guild Membership',
			description: 'Your guild provides lodging and food if necessary and pays for your funeral. You can access guild halls and count on support from your fellow artisans.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I believe that anything worth doing is worth doing right.', 'I am a snob who looks down on those who can’t appreciate fine art.', 'I’m full of witty aphorisms and have a proverb for every occasion.', 'I get bored easily and like to seek excitement.'],
			ideals: ['Community. It is the duty of all civilized people to strengthen the bonds of community.', 'Generosity. My talents were given to me so I could use them to benefit the world.', 'Freedom. Everyone should be free to pursue their own livelihood.', 'Aspirations. I work hard to be the best there is at my craft.'],
			bonds: ['The workshop where I learned my trade is the most important place in the world to me.', 'I created a great work for someone, and then found them unworthy to receive it.', 'I owe my guild a great debt for forging me into the person I am today.', 'I will get revenge on the evil forces that destroyed my place of business and ruined my livelihood.'],
			flaws: ['I’ll do anything to get my hands on something rare or priceless.', 'I’m quick to assume that someone is trying to cheat me.', 'No one must ever learn that I once stole money from guild coffers.', 'I’m never satisfied with what I have—I always want more.']
		}
	},
	{
		name: 'hermit',
		displayName: 'Hermit',
		description: 'You lived in seclusion, either in a sheltered community or entirely alone, for a formative part of your life.',
		skillProficiencies: ['medicine', 'religion'],
		toolProficiencies: ['herbalism-kit'],
		languages: ['Common'],
		languageChoices: 1,
		equipment: ['Scroll Case Stuffed with Notes', 'Winter Blanket', 'Common Clothes', 'Herbalism Kit', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'scrollNotes',
				sectionLabel: 'Describe',
				prompt: 'What fills the pages of your scroll case? Your private research or meditations.',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 20,
				textPlaceholder: 'What fills the pages of your scroll case?',
				fixedItems: [],
			},
		],
		feature: {
			name: 'Discovery',
			description: 'The quiet seclusion of your extended hermitage gave you access to a unique and powerful discovery. The precise nature of your revelation can shape the campaign.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I’ve been isolated for so long that I rarely speak, preferring gestures and grunts.', 'I am utterly serene, even in the face of disaster.', 'I’m oblivious to etiquette and social expectations.', 'I connect everything that happens to me to a grand, cosmic plan.'],
			ideals: ['Greater Good. My gifts are meant to be shared with all, not used for my own benefit.', 'Logic. Emotions must not cloud our sense of what is right and true.', 'Free Thinking. Inquiry and curiosity are the pillars of progress.', 'Self-Knowledge. If you know yourself, there’s nothing left to know.'],
			bonds: ['Nothing is more important than the other members of my hermitage.', 'I entered seclusion to hide from the ones who might still be hunting me.', 'I’m still seeking the enlightenment I pursued in my seclusion.', 'I entered seclusion because I loved someone I could not have.'],
			flaws: ['Now that I’ve returned to the world, I enjoy its delights a little too much.', 'I harbor dark, bloodthirsty thoughts that my isolation failed to quell.', 'I am dogmatic in my thoughts and philosophy.', 'I let my need to win arguments overshadow friendships and harmony.']
		}
	},
	{
		name: 'noble',
		displayName: 'Noble',
		description: 'You understand wealth, power, and privilege. You carry a title and the expectations that come with it.',
		skillProficiencies: ['history', 'persuasion'],
		toolProficiencies: ['gaming-set'],
		languageChoices: 1,
		equipment: ['Fine Clothes', 'Signet Ring', 'Scroll of Pedigree', 'Purse'],
		equipmentChoices: [
			{
				id: 'pedigreeDesc',
				sectionLabel: 'Describe',
				prompt: 'What is your family known for? Describe your lineage in a line or two.',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 20,
				textPlaceholder: 'What is your family known for?',
				orDefaultOption: { label: 'Generalized Pedigree', items: [] },
			},
		],
		feature: {
			name: 'Position of Privilege',
			description: 'People are inclined to think the best of you. You can secure an audience with a local noble if you need to, and common folk make every effort to accommodate you.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['My eloquent flattery makes everyone I talk to feel like the most wonderful person in the world.', 'The common folk love me for my kindness and generosity.', 'No one could doubt by looking at my regal bearing that I am a cut above the unwashed masses.', 'I take great pains to always look my best and follow the latest fashions.'],
			ideals: ['Respect. Respect is due to me because of my station, but all people regardless of station deserve to be treated with dignity.', 'Responsibility. It is my duty to respect the authority of those above me, just as those below me must respect mine.', 'Independence. I must prove that I can handle myself without the coddling of my family.', 'Power. If I can attain more power, no one will tell me what to do.'],
			bonds: ['I will face any challenge to win the approval of my family.', 'My house’s alliance with another noble family must be sustained at all costs.', 'Nothing is more important than the other members of my family.', 'The common folk must see me as a hero of the people.'],
			flaws: ['I secretly believe that everyone is beneath me.', 'I hide a truly scandalous secret that could ruin my family forever.', 'I too often hear veiled insults and threats in every word addressed to me.', 'I have an insatiable desire for carnal pleasures.']
		}
	},
	{
		name: 'outlander',
		displayName: 'Outlander',
		description: 'You grew up in the wilds, far from civilization and the comforts of town and technology.',
		skillProficiencies: ['athletics', 'survival'],
		toolProficiencies: ['musical-instrument'],
		languageChoices: 1,
		equipment: ['Staff', 'Traveler’s Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'huntingTrap',
				sectionLabel: 'Choose One',
				prompt: 'Choose the type of hunting trap you carry.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Bear Trap', description: 'A heavy iron trap for large prey.', items: ['Bear Trap'] },
					{ label: 'Small Snare', description: 'A simple loop snare for small animals.', items: ['Small Snare'] },
					{ label: 'Medium Snare', description: 'A sturdy snare for mid-sized game.', items: ['Medium Snare'] },
					{ label: 'Large Snare', description: 'A reinforced snare for large animals.', items: ['Large Snare'] },
					{ label: 'Pitfall Trap Kit', description: 'Stakes, rope, and cover for digging a pitfall.', items: ['Pitfall Trap Kit'] },
					{ label: 'Net Trap', description: 'A weighted net rigged to drop on prey.', items: ['Net Trap'] },
				],
			},
			{
				id: 'animalTrophy',
				sectionLabel: 'Describe',
				prompt: 'Describe the trophy you carry from a notable kill.',
				type: 'text',
				required: true,
				textMaxWords: 20,
				textPlaceholder: 'Describe the trophy you carry...',
				fixedItems: ['Trophy from an Animal'],
			},
		],
		feature: {
			name: 'Wanderer',
			description: 'You have an excellent memory for maps and geography, and you can always recall the general layout of terrain, settlements, and other features around you. You can also find food and fresh water for yourself and up to five other people each day, provided the land offers berries, small game, water, and so forth.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I’m driven by a wanderlust that led me away from home.', 'I watch over my friends as if they were a litter of newborn pups.', 'I once ran twenty-five miles without stopping to warn my clan of an approaching orc horde. I’d do it again if I had to.', 'I have a lesson for every situation, drawn from observing nature.'],
			ideals: ['Change. Life is like the seasons, in constant change.', 'Greater Good. It is each person’s responsibility to make the most happiness for the whole tribe.', 'Honor. If I dishonor myself, I dishonor my whole clan.', 'Might. The strongest are meant to rule.'],
			bonds: ['My family, clan, or tribe is the most important thing in my life.', 'An injury to the unspoiled wilderness of my home is an injury to me.', 'I suffer awful visions of a coming disaster and will do anything to prevent it.', 'I am the last of my tribe, and it is up to me to ensure their names enter legend.'],
			flaws: ['I am too enamored of ale, wine, and other intoxicants.', 'There’s no room for caution in a life lived to the fullest.', 'I remember every insult I’ve received and nurse a silent resentment toward anyone who’s ever wronged me.', 'Violence is my answer to almost any challenge.']
		}
	},
	{
		name: 'sage',
		displayName: 'Sage',
		description: 'You spent years learning the lore of the multiverse in libraries, universities, or monasteries.',
		skillProficiencies: ['arcana', 'history'],
		toolProficiencies: [],
		languageChoices: 2,
		equipment: ['Bottle of Black Ink', 'Quill', 'Small Knife', 'Letter from a Dead Colleague', 'Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'deadColleagueLetter',
				sectionLabel: 'Describe',
				prompt: 'Who was the colleague, and what question were they researching when they died?',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 20,
				textPlaceholder: 'What question were they researching?',
				fixedItems: [],
			},
		],
		feature: {
			name: 'Researcher',
			description: 'When you attempt to learn or recall a piece of lore, if you do not know it, you often know where and from whom you can obtain it.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I use polysyllabic words that convey the impression of great erudition.', 'I’ve read every book in the world’s greatest libraries—or I like to boast that I have.', 'I’m used to helping out those who aren’t as smart as I am, and I patiently explain anything and everything to others.', 'There’s nothing I like more than a good mystery.'],
			ideals: ['Knowledge. The path to power and self-improvement is through knowledge.', 'Beauty. What is beautiful points us beyond itself toward what is true.', 'Logic. Emotions must not cloud our logical thinking.', 'No Limits. Nothing should fetter the infinite possibility inherent in all existence.'],
			bonds: ['It is my duty to protect my students.', 'I have an ancient text that holds terrible secrets that must not fall into the wrong hands.', 'I work to preserve a library, university, scriptorium, or monastery.', 'I’ve been searching my whole life for the answer to a certain question.'],
			flaws: ['I am easily distracted by the promise of information.', 'Most people scream and run when they see a demon. I stop and take notes on its anatomy.', 'Unlocking an ancient mystery is worth the price of a civilization.', 'I overlook obvious solutions in favor of complicated ones.']
		}
	},
	{
		name: 'sailor',
		displayName: 'Sailor',
		description: 'You sailed on a seagoing vessel for years. You know the language of shipboard life and storms.',
		skillProficiencies: ['athletics', 'perception'],
		toolProficiencies: ['navigator-tools', 'vehicles-water'],
		equipment: ['Belaying Pin', '50 Feet of Silk Rope', 'Lucky Charm', 'Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'luckyCharmDesc',
				sectionLabel: 'Describe',
				prompt: 'What is your lucky charm and why do you keep it?',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 20,
				textPlaceholder: 'What is your lucky charm?',
				fixedItems: [],
			},
		],
		feature: {
			name: 'Ship’s Passage',
			description: 'When you need to, you can secure free passage on a sailing ship for yourself and your companions. You may need to assist the crew during the voyage.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['My friends know they can rely on me, no matter what.', 'I work hard so that I can play hard when the work is done.', 'I enjoy sailing into new ports and making new friends over a flagon of ale.', 'I stretch the truth for the sake of a good story.'],
			ideals: ['Respect. The thing that keeps a ship together is mutual respect between captain and crew.', 'Fairness. We all do the work, so we all share in the rewards.', 'Freedom. The sea is freedom.', 'Mastery. I’m a predator, and the other ships on the sea are my prey.'],
			bonds: ['I’m loyal to my captain first, everything else second.', 'The ship is most important—crewmates and captains come and go.', 'I’ll always remember my first ship.', 'In a harbor town, I have a paramour whose eyes nearly stole me from the sea.'],
			flaws: ['I follow orders, even if I think they’re wrong.', 'Once someone questions my courage, I never back down no matter how dangerous the situation.', 'Once I start drinking, it’s hard for me to stop.', 'I can’t help but pocket loose coins and other trinkets I come across.']
		}
	},
	{
		name: 'soldier',
		displayName: 'Soldier',
		description: 'War has been your life for as long as you care to remember.',
		skillProficiencies: ['athletics', 'intimidation'],
		toolProficiencies: ['gaming-set', 'vehicles-land'],
		equipment: ['Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'signiaRank',
				sectionLabel: 'Choose Your Rank and Discharge',
				prompt: 'What rank did you hold in your military service?',
				type: 'dual-radio',
				required: true,
				itemNameTemplate: '{signiaRank} Insignia ({signiaSeparation})',
				options: [
					{ label: 'Private', items: [] },
					{ label: 'Corporal', items: [] },
					{ label: 'Sergeant', items: [] },
					{ label: 'Lieutenant', items: [] },
					{ label: 'Captain', items: [] },
					{ label: 'Knight', items: [] },
					{ label: 'Marshal', items: [] },
				],
				secondId: 'signiaSeparation',
				secondPrompt: 'What were the circumstances of your discharge?',
				secondOptions: [
					{ label: 'With Full Honors', items: [] },
					{ label: 'With Honors', items: [] },
					{ label: 'Medical Discharge', items: [] },
					{ label: 'Resigned Commission', items: [] },
					{ label: 'Dishonorable Discharge', items: [] },
					{ label: 'Stripped of Rank', items: [] },
				],
			},
			{
				id: 'fallenEnemyTrophy',
				sectionLabel: 'Describe',
				prompt: 'Describe the trophy you took from a fallen enemy.',
				type: 'text',
				required: true,
				textMaxWords: 20,
				textPlaceholder: 'What trophy did you take?',
				fixedItems: ['Trophy from a Fallen Enemy'],
			},
			{
				id: 'diceOrCards',
				sectionLabel: 'Choose One',
				prompt: 'Soldiers gamble. Choose your game of choice.',
				type: 'radio',
				required: true,
				options: [
					{ label: 'Bone Dice', description: 'A set of carved bone dice.', items: ['Bone Dice Set'] },
					{ label: 'Deck of Cards', description: 'A worn deck of playing cards.', items: ['Deck of Cards'] },
				],
			},
		],
		feature: {
			name: 'Military Rank',
			description: 'You have a military rank from your career as a soldier. Soldiers loyal to your former organization still recognize your authority and influence.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I’m always polite and respectful.', 'I’m haunted by memories of war. I can’t get the images of violence out of my mind.', 'I’ve lost too many friends, and I’m slow to make new ones.', 'I can stare down a hell hound without flinching.'],
			ideals: ['Greater Good. Our lot is to lay down our lives in defense of others.', 'Responsibility. I do what I must and obey just authority.', 'Independence. When people follow orders blindly, they embrace a kind of tyranny.', 'Might. In life as in war, the stronger force wins.'],
			bonds: ['I would still lay down my life for the people I served with.', 'Someone saved my life on the battlefield. To this day, I will never leave a friend behind.', 'My honor is my life.', 'I’ll never forget the crushing defeat my company suffered or the enemies who dealt it.'],
			flaws: ['The monstrous enemy we faced in battle still leaves me quivering with fear.', 'I have little respect for anyone who is not a proven warrior.', 'I made a terrible mistake in battle that cost many lives, and I would do anything to keep that mistake secret.', 'My hatred of my enemies is blind and unreasoning.']
		}
	},
	{
		name: 'urchin',
		displayName: 'Urchin',
		description: 'You grew up on the streets alone, orphaned, and poor, with no one to watch over you or provide for you.',
		skillProficiencies: ['sleight-of-hand', 'stealth'],
		toolProficiencies: ['disguise-kit', 'thieves-tools'],
		equipment: ['Small Knife', 'Common Clothes', 'Belt Pouch'],
		equipmentChoices: [
			{
				id: 'cityOfOrigin',
				sectionLabel: 'Choose Your City of Origin',
				prompt: 'Which city did you grow up in? You carry a hand-drawn map of its streets.',
				type: 'radio',
				required: true,
				itemNameTemplate: 'Map of {cityOfOrigin}',
				options: [],
			},
			{
				id: 'mouseName',
				sectionLabel: 'Name Your Mouse',
				prompt: 'Your pet mouse has been your companion on the streets. Give it a name.',
				type: 'text',
				required: true,
				textMaxChars: 20,
				textPlaceholder: 'Give your mouse a name',
				itemNameTemplate: 'Pet Mouse ({mouseName}) in Cage',
			},
			{
				id: 'parentToken',
				sectionLabel: 'Token from Your Parents',
				prompt: 'Do you carry a token to remember your parents by? If so, name the item (e.g. "Worn Pearl", "Cracked Locket", "Faded Portrait").',
				type: 'text',
				required: false,
				optional: true,
				textMaxWords: 6,
				textPlaceholder: 'e.g. Worn Pearl, Cracked Locket...',
				skipLabel: 'No Token',
				itemNameTemplate: '{parentToken}',
				orDefaultOption: { label: 'No Token', items: [] },
			},
		],
		feature: {
			name: 'City Secrets',
			description: 'You know the secret patterns and flow to cities and can find passages through the urban sprawl that others would miss.'
		},
		suggestedCharacteristics: {
			personalityTraits: ['I hide scraps of food and trinkets away in my pockets.', 'I ask a lot of questions.', 'I like to squeeze into small places where no one else can get to me.', 'No one else should have to endure the hardships I’ve been through.'],
			ideals: ['Respect. All people, rich or poor, deserve respect.', 'Community. We have to take care of each other, because no one else is going to do it.', 'Change. The low are lifted up, and the high and mighty are brought down.', 'Retribution. The rich need to be shown what life and death are like in the gutters.'],
			bonds: ['My town or city is my home, and I’ll fight to defend it.', 'I sponsor an orphanage to keep others from enduring what I was forced to endure.', 'I owe my survival to another urchin who taught me to live on the streets.', 'I escaped my life of poverty by robbing an important person, and I’m wanted for it.'],
			flaws: ['If I’m outnumbered, I will run away from a fight.', 'Gold seems like a lot of money to me, and I’ll do just about anything for more of it.', 'I will never fully trust anyone other than myself.', 'I’d rather kill someone in their sleep than fight fair.']
		}
	}
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBackground(name: string): BackgroundDefinition | undefined {
	const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
	return BACKGROUNDS.find((background) => background.name === normalized);
}
