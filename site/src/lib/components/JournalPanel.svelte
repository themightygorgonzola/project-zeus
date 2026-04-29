<script lang="ts">
	import { abilityModifier, getAllCantrips, getAllKnownSpells, getAllPreparedSpells, getTotalHitDiceRemaining, getFeat } from '$lib/game';
	import { CLASS_HIT_DIE } from '$lib/game/types';
	import type { AbilityName, PlayerCharacter, SpellSlotPool, WeaponItem, ArmorItem, ContainerItem } from '$lib/game/types';
	import { getAllInventoryItems } from '$lib/game/inventory';
	import { getEnhancedEncumbranceInfo, getContainerLoad, canAddToContainer, moveItemToContainer, CONTAINER_DEFAULTS } from '$lib/game/item-dimensions';
	import CharacterCreation from '$lib/components/CharacterCreation.svelte';

	// ── Prop shapes ────────────────────────────────────────────────────────
	interface WSS { title: string; year?: number | null; teaser?: string | null; stats: Array<[string, number | string]>; }
	interface QuestObjective { id: string; text: string; done: boolean; }
	interface Quest {
		id: string;
		name: string;
		description: string;
		status: string;
		objectives: QuestObjective[];
		giverNpcId?: string;
		deadline?: { day: number; description: string };
		rewards?: { xp?: number; gold?: number; items?: Array<{ name: string }> };
		completionMethod?: string;
	}
	interface Location { id: string; name: string; type: string; description: string; features: string[]; visited: boolean; }
	interface NPC { id: string; name: string; role: string; description: string; alive: boolean; locationId?: string; archived?: boolean; statBlock?: { hp: number; maxHp: number; ac?: number }; }
	interface GameClock { day: number; timeOfDay: string; weather: string; }
	interface Member { userId: string; username: string; avatarUrl?: string | null; }

	interface Props {
		currentCharacter: PlayerCharacter | null;
		partyCharacters: Record<string, PlayerCharacter>;
		members: Member[];
		currentUserId: string;
		quests: Quest[];
		locations: Location[];
		currentLocationId: string | null | undefined;
		npcs: NPC[];
		worldSnapshot: WSS | null | undefined;
		clock: GameClock | null | undefined;
		adventureId: string;
		onCreated?: (character: PlayerCharacter) => void;
		onInventoryMove?: (updated: PlayerCharacter) => void;
		worldCities?: string[];
		questNotification?: boolean;
	}

	let {
		currentCharacter,
		partyCharacters,
		members,
		currentUserId,
		quests,
		locations,
		currentLocationId,
		npcs,
		worldSnapshot,
		clock,
		adventureId,
		onCreated,
		onInventoryMove,
		worldCities,
		questNotification = $bindable(false),
	}: Props = $props();

	type Tab = 'status' | 'party' | 'quests' | 'inventory' | 'world';
	let activeTab = $state<Tab>('status');

	const tabs: { id: Tab; label: string; icon: string }[] = [
		{ id: 'status',    label: 'Status',    icon: '⚔️' },
		{ id: 'party',     label: 'Party',     icon: '👥' },
		{ id: 'quests',    label: 'Quests',    icon: '📜' },
		{ id: 'inventory', label: 'Inventory', icon: '🎒' },
		{ id: 'world',     label: 'World',     icon: '🌍' },
	];

	const abilityOrder: AbilityName[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
	const abilityLabels: Record<AbilityName, string> = {
		str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA'
	};
	const abilityColors: Record<AbilityName, string> = {
		str: '#ff7b7b', dex: '#7be8a0', con: '#f5a97f', int: '#7bc4f5', wis: '#c3a0f5', cha: '#f5c842'
	};

	function signed(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

	function fmt(value?: string) {
		if (!value) return '—';
		return value.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
	}

	function hpPercent(pc: PlayerCharacter) {
		return Math.max(0, Math.min(100, Math.round((pc.hp / pc.maxHp) * 100)));
	}

	function hpColor(pc: PlayerCharacter) {
		const pct = hpPercent(pc);
		if (pct > 60) return '#4ade80';
		if (pct > 25) return '#f5c842';
		return '#f87171';
	}

	function conditionColor(cond: string): string {
		const danger = ['poisoned', 'paralyzed', 'petrified', 'unconscious', 'dying', 'dead', 'exhaustion'];
		const warn   = ['frightened', 'charmed', 'stunned', 'restrained', 'incapacitated'];
		if (danger.some(d => cond.includes(d))) return '#f87171';
		if (warn.some(w => cond.includes(w))) return '#f5c842';
		return '#94a3b8';
	}

	let currentLocation = $derived(
		currentLocationId ? locations.find(l => l.id === currentLocationId) ?? null : null
	);
	let localNpcs = $derived(
		currentLocationId ? npcs.filter(n => n.locationId === currentLocationId) : npcs.slice(0, 5)
	);

	let companions = $derived(
		npcs.filter(n => n.alive && !n.archived && (n.role === 'companion' || n.role === 'ally'))
	);

	let activeQuests = $derived(quests.filter(q => q.status === 'active'));
	let completedQuests = $derived(quests.filter(q => q.status === 'completed'));

	let expandedQuestId = $state<string | null>(null);

	/** Returns completed objectives + the single next uncompleted step; hides all future steps. */
	function visibleObjectives(quest: Quest): QuestObjective[] {
		const result: QuestObjective[] = [];
		let foundNextUndone = false;
		for (const obj of quest.objectives) {
			if (obj.done) {
				result.push(obj);
			} else if (!foundNextUndone) {
				result.push(obj);
				foundNextUndone = true;
			}
			// future objectives beyond the next step are intentionally hidden
		}
		return result;
	}

	function classLine(pc: PlayerCharacter): string {
		if (pc.classes.length === 1) {
			const c = pc.classes[0];
			return `${fmt(c.name)}${c.subclass ? ` (${fmt(c.subclass)})` : ''}`;
		}
		return pc.classes.map(c => fmt(c.name)).join(' / ');
	}

	const SIMPLE_WEAPON_NAMES = new Set(['club','dagger','greatclub','handaxe','javelin','light-hammer','mace','quarterstaff','sickle','spear','dart','light-crossbow','shortbow','sling','unarmed']);
	const MARTIAL_WEAPON_NAMES = new Set(['battleaxe','flail','glaive','greataxe','greatsword','halberd','lance','longsword','maul','morningstar','pike','rapier','scimitar','shortsword','trident','war-pick','warhammer','whip','blowgun','hand-crossbow','heavy-crossbow','longbow','net']);

	function dedupedWeaponProfs(profs: string[]): string[] {
		const hasSimple = profs.includes('simple');
		const hasMartial = profs.includes('martial');
		return profs.filter(p => {
			if (hasSimple && SIMPLE_WEAPON_NAMES.has(p)) return false;
			if (hasMartial && MARTIAL_WEAPON_NAMES.has(p)) return false;
			return true;
		});
	}

	function hasNonPactSlots(pc: PlayerCharacter): boolean {
		return pc.spellSlots.some(s => s.max > 0);
	}

	function slotDots(slot: SpellSlotPool) {
		return Array.from({ length: slot.max }, (_, i) => i < slot.current);
	}

	// ── Inventory helpers ────────────────────────────────────────────────────
	let collapsedSections = $state(new Set<string>());
	let expandedContainerId = $state<string | null>(null);

	// Drag-and-drop state
	let dragState = $state<{ itemId: string; fromSource: string } | null>(null);
	let dropTargetId = $state<string | null>(null);
	let dropInvalid = $state(false);
	let invalidTargetId = $state<string | null>(null);

	// Popover state (inventory info buttons)
	let showWuSuPopover = $state(false);
	let showEncPopover = $state(false);

	// Ref to the scrollable tab-content element for drag-scroll
	let invScrollEl = $state<HTMLElement | null>(null);

	// Debounced PATCH timer
	let patchTimer: ReturnType<typeof setTimeout> | null = null;

	function persistInventoryMove(itemId: string, fromSource: string, toSource: string) {
		if (patchTimer) clearTimeout(patchTimer);
		patchTimer = setTimeout(async () => {
			try {
				await fetch(`/api/adventure/${adventureId}/character/inventory`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ moves: [{ itemId, fromSource, toSource }] })
				});
			} catch {
				// Optimistic UI already applied — silent failure acceptable here
			}
		}, 500);
	}

	function handleDragStart(e: DragEvent, itemId: string, fromSource: string) {
		dragState = { itemId, fromSource };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', itemId);
		}
	}

	function handleDragEnd() {
		dragState = null;
		dropTargetId = null;
		dropInvalid = false;
		invalidTargetId = null;
	}

	// ── Context menu (right-click fallback for drag-drop) ────────────────────
	let contextMenu = $state<{ x: number; y: number; itemId: string; fromSource: string } | null>(null);

	function handleItemContextMenu(e: MouseEvent, itemId: string, fromSource: string) {
		e.preventDefault();
		e.stopPropagation();
		contextMenu = { x: e.clientX, y: e.clientY, itemId, fromSource };
	}

	function closeContextMenu() {
		contextMenu = null;
	}

	// ── Quick equip / unequip ───────────────────────────────────────────────
	function quickEquip(itemId: string, fromSource: string) {
		if (!currentCharacter) return;
		const result = moveItemToContainer(currentCharacter, itemId, fromSource, 'equipped');
		if (result) {
			onInventoryMove?.(result);
			persistInventoryMove(itemId, fromSource, 'equipped');
		}
	}

	function quickUnequip(itemId: string) {
		if (!currentCharacter) return;
		const result = moveItemToContainer(currentCharacter, itemId, 'equipped', 'loose');
		if (result) {
			onInventoryMove?.(result);
			persistInventoryMove(itemId, 'equipped', 'loose');
		}
	}

	// ── Coin counter: sum coin items across all containers ───────────────────
	function countCoinItems(inventory: PlayerCharacter['inventory']): { gp: number; sp: number; cp: number } {
		let gp = 0, sp = 0, cp = 0;
		function scan(items: typeof inventory) {
			for (const item of items) {
				const n = item.name.toLowerCase();
				if (/gold/.test(n) || /\bgp\b/.test(n)) gp += item.quantity;
				else if (/silver/.test(n) || /\bsp\b/.test(n)) sp += item.quantity;
				else if (/copper/.test(n) || /\bcp\b/.test(n)) cp += item.quantity;
				if (item.category === 'container') {
					scan((item as ContainerItem).contents as typeof inventory);
				}
			}
		}
		scan(inventory);
		return { gp, sp, cp };
	}

	function moveViaContextMenu(toSource: string) {
		if (!contextMenu || !currentCharacter) { contextMenu = null; return; }
		const { itemId, fromSource } = contextMenu;
		contextMenu = null;
		if (fromSource === toSource) return;
		const result = moveItemToContainer(currentCharacter, itemId, fromSource, toSource);
		if (result) {
			onInventoryMove?.(result);
			persistInventoryMove(itemId, fromSource, toSource);
		} else {
			invalidTargetId = toSource;
			setTimeout(() => { invalidTargetId = null; }, 400);
		}
	}

	$effect(() => {
		if (!contextMenu) return;
		function dismiss(e: MouseEvent) {
			// Give the menu's own onclick handlers a chance to fire first
			if ((e.target as Element)?.closest?.('.ctx-menu')) return;
			contextMenu = null;
		}
		window.addEventListener('mousedown', dismiss, { capture: true });
		return () => window.removeEventListener('mousedown', dismiss, { capture: true });
	});

	function handleDragOver(e: DragEvent, targetId: string, container?: ContainerItem) {
		e.preventDefault();
		dropTargetId = targetId;
		// Auto-scroll the panel when cursor is near the top/bottom edge during drag
		if (invScrollEl) {
			const rect = invScrollEl.getBoundingClientRect();
			const ZONE = 80;
			if (e.clientY - rect.top < ZONE) invScrollEl.scrollBy(0, -12);
			else if (rect.bottom - e.clientY < ZONE) invScrollEl.scrollBy(0, 12);
		}
		if (container && dragState && currentCharacter) {
			// Find the dragged item to check capacity
			const allItems = getAllInventoryItems(currentCharacter);
			const draggedItem = allItems.find(i => i.id === dragState!.itemId);
			if (draggedItem) {
				const check = canAddToContainer(container, draggedItem);
				dropInvalid = !check.ok;
			} else {
				dropInvalid = false;
			}
		} else {
			dropInvalid = false;
		}
	}

	function handleDragLeave(e: DragEvent) {
		// Ignore spurious leave events fired when the cursor moves over a child element
		const rect = (e.currentTarget as Element).getBoundingClientRect();
		if (
			e.clientX >= rect.left && e.clientX <= rect.right &&
			e.clientY >= rect.top  && e.clientY <= rect.bottom
		) {
			return;
		}
		dropTargetId = null;
		dropInvalid = false;
	}

	function handleDrop(e: DragEvent, toSource: string, container?: ContainerItem) {
		e.preventDefault();
		if (!dragState || !currentCharacter) { handleDragEnd(); return; }

		const { itemId, fromSource } = dragState;
		if (fromSource === toSource) { handleDragEnd(); return; }

		// Check container capacity before optimistic update
		if (container && dragState) {
			const allItems = getAllInventoryItems(currentCharacter);
			const draggedItem = allItems.find(i => i.id === dragState!.itemId);
			if (draggedItem && !canAddToContainer(container, draggedItem).ok) {
				// Show shake animation and abort
				invalidTargetId = toSource;
				setTimeout(() => { invalidTargetId = null; }, 400);
				handleDragEnd();
				return;
			}
		}

		const result = moveItemToContainer(currentCharacter, itemId, fromSource, toSource);
		if (result === null) {
			invalidTargetId = toSource;
			setTimeout(() => { invalidTargetId = null; }, 400);
		} else {
			// Optimistic update — fire event to parent to update currentCharacter
			onInventoryMove?.(result);
			persistInventoryMove(itemId, fromSource, toSource);
		}
		handleDragEnd();
	}

	// ── Container reorder ────────────────────────────────────────────────────
	// Stores the user-defined container display order (container IDs).
	// When null, containers are sorted by capacity (large → small) by default.
	let containerOrderIds = $state<string[] | null>(null);

	// Derive the ordered container list from the current character
	let orderedContainers = $derived.by((): ContainerItem[] => {
		if (!currentCharacter) return [];
		const containers = currentCharacter.inventory.filter(i => i.category === 'container') as ContainerItem[];
		if (containerOrderIds) {
			const sorted = containerOrderIds
				.map(id => containers.find(c => c.id === id))
				.filter((c): c is ContainerItem => c !== undefined);
			// Append any containers not yet tracked (e.g. newly acquired)
			const tracked = new Set(containerOrderIds);
			const untracked = containers.filter(c => !tracked.has(c.id));
			return [...sorted, ...untracked];
		}
		// Default: large → small by maxWU
		return [...containers].sort((a, b) => b.capacity.maxWU - a.capacity.maxWU);
	});

	// Reset order tracking when character changes (new character or page reload)
	let _lastCharId = $state<string | null>(null);
	$effect(() => {
		if (currentCharacter && currentCharacter.id !== _lastCharId) {
			_lastCharId = currentCharacter.id;
			containerOrderIds = null; // reset to default capacity sort for new character
		}
	});

	let containerReorderTimer: ReturnType<typeof setTimeout> | null = null;

	function persistContainerReorder(ids: string[]) {
		if (containerReorderTimer) clearTimeout(containerReorderTimer);
		containerReorderTimer = setTimeout(async () => {
			try {
				await fetch(`/api/adventure/${adventureId}/character/inventory`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ containerOrder: ids })
				});
			} catch {
				// Silent — UI already updated optimistically
			}
		}, 500);
	}

	function moveContainerUp(containerId: string) {
		if (!currentCharacter) return;
		const ids = orderedContainers.map(c => c.id);
		const idx = ids.indexOf(containerId);
		if (idx <= 0) return;
		[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
		containerOrderIds = ids;
		persistContainerReorder(ids);
		// Optimistic update to parent
		if (onInventoryMove) {
			const containers = currentCharacter.inventory.filter(i => i.category === 'container') as ContainerItem[];
			const nonContainers = currentCharacter.inventory.filter(i => i.category !== 'container');
			const reordered = ids
				.map(id => containers.find(c => c.id === id))
				.filter((c): c is ContainerItem => c !== undefined);
			const mentioned = new Set(ids);
			const remainder = containers.filter(c => !mentioned.has(c.id));
			onInventoryMove({ ...currentCharacter, inventory: [...reordered, ...remainder, ...nonContainers] });
		}
	}

	function moveContainerDown(containerId: string) {
		if (!currentCharacter) return;
		const ids = orderedContainers.map(c => c.id);
		const idx = ids.indexOf(containerId);
		if (idx < 0 || idx >= ids.length - 1) return;
		[ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
		containerOrderIds = ids;
		persistContainerReorder(ids);
		// Optimistic update to parent
		if (onInventoryMove) {
			const containers = currentCharacter.inventory.filter(i => i.category === 'container') as ContainerItem[];
			const nonContainers = currentCharacter.inventory.filter(i => i.category !== 'container');
			const reordered = ids
				.map(id => containers.find(c => c.id === id))
				.filter((c): c is ContainerItem => c !== undefined);
			const mentioned = new Set(ids);
			const remainder = containers.filter(c => !mentioned.has(c.id));
			onInventoryMove({ ...currentCharacter, inventory: [...reordered, ...remainder, ...nonContainers] });
		}
	}


	function toggleSection(key: string) {
		const next = new Set(collapsedSections);
		if (next.has(key)) next.delete(key); else next.add(key);
		collapsedSections = next;
	}

	function cleanItemName(name: string): string {
		return name.replace(/\s*\(\d+\)\s*$/, '').trim();
	}

	function isAutoDesc(desc: string): boolean {
		return /^Starting equipment:/i.test(desc.trim());
	}

	function weaponBaseNoun(name: string): string {
		const words = cleanItemName(name).split(/\s+/);
		return words[words.length - 1];
	}

	function groupWeaponsByNoun(weapons: WeaponItem[]): Map<string, WeaponItem[]> {
		const map = new Map<string, WeaponItem[]>();
		for (const w of weapons) {
			const noun = weaponBaseNoun(w.name);
			if (!map.has(noun)) map.set(noun, []);
			map.get(noun)!.push(w);
		}
		return map;
	}

	// ── Tooltip data ─────────────────────────────────────────────────────────
	const SKILL_TOOLTIPS: Record<string, string> = {
		'acrobatics':      'You have proficiency in the skill of Acrobatics — the art of nimble-footedness. You can tumble, balance on narrow surfaces, perform aerial maneuvers, and escape grapples with ease.',
		'animal-handling': 'You have proficiency in the skill of Animal Handling — the art of reading and calming creatures. You soothe startled animals, intuit their intentions, and guide mounts under pressure.',
		'arcana':          'You have proficiency in the skill of Arcana — the art of arcane knowledge. You recall lore about spells, magical traditions, eldritch symbols, and the nature of the planes and their inhabitants.',
		'athletics':       'You have proficiency in the skill of Athletics — the art of raw physical exertion. You climb, swim, jump, and wrestle with skill, resisting being shoved, tripped, or restrained.',
		'deception':       'You have proficiency in the skill of Deception — the art of misdirection. You mislead others through words, actions, and omissions to hide the truth and maintain false identities.',
		'history':         'You have proficiency in the skill of History — the art of remembering the past. You recall details of historical events, ancient kingdoms, legendary figures, and lost civilizations.',
		'insight':         'You have proficiency in the skill of Insight — the art of reading people. You detect hidden emotions, sense true intentions, and tell when someone is concealing something.',
		'intimidation':    'You have proficiency in the skill of Intimidation — the art of projecting menace. You influence others through overt threats, hostile posturing, and sheer force of presence.',
		'investigation':   'You have proficiency in the skill of Investigation — the art of searching thoroughly in confined areas, like a closet, bedroom, or treasure room. You find hidden clues, deduce facts from evidence, and uncover what others miss.',
		'medicine':        'You have proficiency in the skill of Medicine — the art of tending to the wounded. You can stabilize dying allies, diagnose illnesses, and determine causes of harm or death.',
		'nature':          'You have proficiency in the skill of Nature — the art of understanding the wild. You identify flora and fauna, predict weather, and recall knowledge of terrain and natural cycles.',
		'perception':      'You have proficiency in the skill of Perception — the art of awareness. Through sight, hearing, and other senses, you notice hidden threats, spot subtle details, and detect danger before others do.',
		'performance':     'You have proficiency in the skill of Performance — the art of entertaining others. You sing, play instruments, tell stories, dance, or act with enough skill to captivate an audience.',
		'persuasion':      'You have proficiency in the skill of Persuasion — the art of honest influence. Through tact, charm, and reasoned appeals, you sway others toward your view without threats or deception.',
		'religion':        'You have proficiency in the skill of Religion — the art of sacred knowledge. You recall lore about deities, holy rites, religious hierarchies, divine symbols, and the practices of cults.',
		'sleight-of-hand': 'You have proficiency in the skill of Sleight of Hand — the art of nimble fingerwork. You pickpocket, plant items on others undetected, and perform other feats of subtle manual dexterity.',
		'stealth':         'You have proficiency in the skill of Stealth — the art of moving unseen and unheard. You hide from enemies, creep through shadows, and pass unnoticed through dangerous territory.',
		'survival':        'You have proficiency in the skill of Survival — the art of enduring the wild. You follow tracks, forage for food, navigate harsh terrain, and keep yourself alive where civilization ends.',
	};

	const PROF_DISPLAY: Record<string, string> = {
		// Armor
		'light':              'Light Armor',
		'medium':             'Medium Armor',
		'heavy':              'Heavy Armor',
		'shields':            'Shields',
		// Weapons (broad)
		'unarmed':            'Unarmed Strikes',
		'simple':             'Simple Weapons',
		'martial':            'Martial Weapons',
		// Individual simple weapons
		'club':               'Club',
		'dagger':             'Dagger',
		'greatclub':          'Greatclub',
		'handaxe':            'Handaxe',
		'javelin':            'Javelin',
		'light-hammer':       'Light Hammer',
		'mace':               'Mace',
		'quarterstaff':       'Quarterstaff',
		'sickle':             'Sickle',
		'spear':              'Spear',
		'dart':               'Dart',
		'light-crossbow':     'Light Crossbow',
		'shortbow':           'Shortbow',
		'sling':              'Sling',
		// Individual martial weapons
		'battleaxe':          'Battleaxe',
		'flail':              'Flail',
		'glaive':             'Glaive',
		'greataxe':           'Greataxe',
		'greatsword':         'Greatsword',
		'halberd':            'Halberd',
		'lance':              'Lance',
		'longsword':          'Longsword',
		'maul':               'Maul',
		'morningstar':        'Morningstar',
		'pike':               'Pike',
		'rapier':             'Rapier',
		'scimitar':           'Scimitar',
		'shortsword':         'Shortsword',
		'trident':            'Trident',
		'war-pick':           'War Pick',
		'warhammer':          'Warhammer',
		'whip':               'Whip',
		'blowgun':            'Blowgun',
		'hand-crossbow':      'Hand Crossbow',
		'heavy-crossbow':     'Heavy Crossbow',
		'longbow':            'Longbow',
		'net':                'Net',
		// Tools
		'thieves-tools':      "Thieves' Tools",
		'disguise-kit':       'Disguise Kit',
		'forgery-kit':        'Forgery Kit',
		'herbalism-kit':      'Herbalism Kit',
		'artisan-tools':      "Artisan's Tools",
		'gaming-set':         'Gaming Set',
		'navigator-tools':    "Navigator's Tools",
		'poisoners-kit':      "Poisoner's Kit",
		'musical-instrument': 'Musical Instruments',
		// Vehicles
		'vehicles-land':      'Land Vehicles',
		'vehicles-water':     'Water Vessels',
	};

	const PROF_TOOLTIPS: Record<string, string> = {
		'light':   'You have mastered wearing, moving, and fighting in Light Armor — including Padded, Leather, and Studded Leather. You can wear it without disadvantage to Stealth or ability checks, and apply your full Dexterity modifier to your AC.',
		'medium':  'You have mastered wearing, moving, and fighting in Medium Armor — including Hide, Chain Shirt, Scale Mail, Breastplate, and Half Plate. You suffer no penalties while wearing it, though some types impose Stealth disadvantage.',
		'heavy':   'You have mastered wearing, moving, and fighting in Heavy Armor — including Ring Mail, Chain Mail, Splint, and Plate. Without proficiency, heavy armor imposes severe penalties. With it, you move and fight freely.',
		'shields': 'You are proficient with Shields. A shield grants +2 Armor Class. Without proficiency, wearing a shield imposes disadvantage on attack rolls and ability checks that use Strength or Dexterity.',
		'unarmed': 'You are proficient with Unarmed Strikes — punches, kicks, headbutts, and other brawling attacks. Your unarmed strikes add your Strength modifier to attack and damage rolls, dealing 1 + Strength modifier in bludgeoning damage.',
		'simple':  'You are proficient with Simple Weapons — the straightforward arms most adventurers can wield: clubs, daggers, handaxes, quarterstaffs, javelins, and light crossbows, among others. You add your full ability modifier to attack and damage rolls.',
		'martial': 'You are proficient with Martial Weapons — the advanced arms of trained warriors: longswords, battleaxes, rapiers, halberds, and heavy crossbows, among others. Without proficiency, martial weapons impose disadvantage on attack rolls.',
		"thieves' tools":       "You have proficiency with Thieves' Tools — picks, tension rods, and other instruments of subtle craft. You can pick locks and disarm traps that would stop an unpracticed hand.",
		'herbalism kit':        'You have proficiency with an Herbalism Kit. You can identify plants and herbs, prepare antitoxins, and craft basic healing poultices and salves.',
		"alchemist's supplies": "You have proficiency with Alchemist's Supplies. You can identify alchemical substances and craft items such as acid, alchemist's fire, and antitoxins.",
		"navigator's tools":    "You have proficiency with Navigator's Tools — compass, sextant, and charts. You can plot a course at sea or through unmarked wilderness without getting lost.",
		'navigator-tools':      "You have proficiency with Navigator's Tools — compass, sextant, and charts. You can plot a course at sea or through unmarked wilderness without getting lost.",
		'disguise kit':         'You have proficiency with a Disguise Kit. Using clothing, makeup, and props, you can convincingly alter your appearance to impersonate others or conceal your identity.',
		'disguise-kit':         'You have proficiency with a Disguise Kit. Using clothing, makeup, and props, you can convincingly alter your appearance to impersonate others or conceal your identity.',
		'forgery kit':          'You have proficiency with a Forgery Kit. You can create convincing duplicates of handwritten documents, forge official seals, and replicate signatures.',
		'forgery-kit':          'You have proficiency with a Forgery Kit. You can create convincing duplicates of handwritten documents, forge official seals, and replicate signatures.',
		"poisoner's kit":       "You have proficiency with a Poisoner's Kit. You can safely identify, prepare, and apply poisons without accidental self-harm.",
		'poisoners-kit':        "You have proficiency with a Poisoner's Kit. You can safely identify, prepare, and apply poisons without accidental self-harm.",
		'gaming set':           'You have proficiency with a Gaming Set. You understand the rules and strategies of one or more games of skill or chance, letting you compete without disadvantage.',
		'gaming-set':           'You have proficiency with a Gaming Set — dice, cards, or other competitive play. You understand the rules and strategies, letting you compete without disadvantage.',
		'herbalism-kit':        'You have proficiency with an Herbalism Kit. You can identify plants and herbs, prepare antitoxins, and craft basic healing poultices and salves.',
		'artisan-tools':        "You have proficiency with Artisan's Tools appropriate to your craft. You can create, repair, and appraise items related to your trade, and your knowledge lends advantage to related ability checks.",
		'thieves-tools':        "You have proficiency with Thieves' Tools — picks, tension rods, and other instruments of subtle craft. You can pick locks and disarm traps that would stop an unpracticed hand.",
		'musical-instrument':   'You have proficiency with one or more Musical Instruments. You can play with enough skill to earn coin, entertain an audience, and use the instrument as a bardic focus if applicable.',
		'vehicles-land':        'You have proficiency with Land Vehicles. You can pilot horses, wagons, chariots, and other ground-based conveyances confidently, even in difficult conditions or under pressure.',
		'vehicles-water':       'You have proficiency with Water Vessels. You can pilot and navigate sailing ships, galleys, rowboats, and other watercraft, reading currents and tides with ease.',
		'hand-crossbow':        'You have specific proficiency with the Hand Crossbow — a compact one-handed ranged weapon favored by rogues, on top of any broader weapon proficiency.',
		'longsword':            'You have specific proficiency with the Longsword — a versatile martial blade, on top of any broader weapon proficiency.',
		'rapier':               'You have specific proficiency with the Rapier — a light, finesse-based martial weapon ideal for dexterous combatants.',
		'shortsword':           'You have specific proficiency with the Shortsword — a light, finesse martial weapon favored by quick-strike fighters and rogues.',
	};

	const LANG_TOOLTIPS: Record<string, string> = {
		'common':        'You have a fluent understanding of Common — the shared trade tongue of humans and most civilized peoples. Nearly all merchants, guards, and travelers across the realm speak it.',
		'elvish':        'You have a fluent understanding of the language of Elvenkind — melodic and precise, spoken in ancient forests, fey courts, and starlit halls where elves dwell.',
		'dwarvish':      'You have a fluent understanding of the language of Dwarvenkind — gruff and resonant, forged over millennia in mountain holds and great stone fortresses beneath the earth.',
		'giant':         'You have a fluent understanding of the language of Giant-kind — a booming, domineering tongue spoken by giants, ogres, and trolls who claim authority through size and brute power.',
		'gnomish':       'You have a fluent understanding of the language of Gnomekind — rapid and invention-laden, dense with technical terms and wordplay, favored by underground tinkerers and eccentric scholars.',
		'halfling':      'You have a fluent understanding of the language of Halfling-kind — warm and quiet, spoken in comfortable burrows and tight-knit communities. It carries familiarity and understated humor.',
		'orc':           'You have a fluent understanding of the language of Orckind — harsh and guttural, a war-tongue spoken by orcs and the violent humanoids who march alongside them.',
		'orcish':        'You have a fluent understanding of the language of Orckind — harsh and guttural, a war-tongue spoken by orcs and the violent humanoids who march alongside them.',
		'abyssal':       'You have a fluent understanding of Abyssal — the discordant tongue of demons and chaotic evil entities from the Abyss. It is the language of fiends and those who summon them.',
		'celestial':     'You have a fluent understanding of Celestial — the radiant language of angels, archons, and divine servants of the Upper Planes. It carries resonances of sacred law, light, and holy purpose.',
		'draconic':      'You have a fluent understanding of Draconic — one of the oldest languages in existence, spoken by dragons, dragonborn, and kobolds. Its cadence carries intrinsic arcane resonance and ancient authority.',
		'deep speech':   'You have a fluent understanding of Deep Speech — the alien tongue of mind flayers, beholders, and aberrations from the Far Realm. Most mortals struggle to even pronounce it correctly.',
		'infernal':      'You have a fluent understanding of Infernal — the cold, precise language of devils and the denizens of the Nine Hells. It is the tongue of binding contracts, layered curses, and calculated evil.',
		'primordial':    'You have a fluent understanding of Primordial — the primal tongue of elementals and genies, divided into four dialects: Aquan (water), Auran (air), Ignan (fire), and Terran (earth).',
		'sylvan':        'You have a fluent understanding of Sylvan — the lyrical tongue of fey creatures, druids, and forest spirits. It weaves naturally into the ancient magic of woodlands and moonlit glades.',
		'undercommon':   'You have a fluent understanding of Undercommon — the lingua franca of the Underdark, used by drow, deep gnomes, and subterranean creatures to communicate across their many disparate species.',
		"thieves' cant": "You have a fluent understanding of Thieves' Cant — a secret argot woven by rogues and criminals into ordinary speech. To untrained ears it sounds mundane; those who know it hear the hidden layer of meaning.",
		'thieves cant':  "You have a fluent understanding of Thieves' Cant — a secret argot woven by rogues and criminals into ordinary speech. To untrained ears it sounds mundane; those who know it hear the hidden layer of meaning.",
	};

	function skillTooltip(skill: string): string {
		return SKILL_TOOLTIPS[skill.toLowerCase()] ?? `You have proficiency in the skill of ${fmt(skill)}.`;
	}

	function profDisplay(prof: string): string {
		return PROF_DISPLAY[prof.toLowerCase()] ?? fmt(prof);
	}

	function profTooltip(prof: string): string {
		return PROF_TOOLTIPS[prof.toLowerCase()] ?? `You have proficiency with ${fmt(prof)}.`;
	}

	function langTooltip(lang: string): string {
		return LANG_TOOLTIPS[lang.toLowerCase()] ?? `You have a fluent understanding of the language of ${lang} — spoken by those who share its tongue.`;
	}

	// ── Core-stat info popovers ──────────────────────────────────────────────
	let statInfoKey = $state<string | null>(null);

	interface StatInfo {
		title: string;
		what: string;
		impact: string;
		math: string;
		changes: string;
	}

	const STAT_INFO: Record<string, StatInfo> = {
		ac: {
			title: 'Armor Class (AC)',
			what:    'AC is the number an attacker must meet or beat on their attack roll to hit you. Higher AC means fewer hits land.',
			impact:  'Every melee and ranged attack roll is compared against your AC. If the roll equals or exceeds it, the attack connects. If not, it misses entirely.',
			math:    'Base AC = 10 + your DEX modifier (unarmored). Wearing armor replaces this formula:\n• Light Armor (e.g. Leather): Armor base + full DEX mod.\n• Medium Armor (e.g. Chain Shirt): Armor base + DEX mod (max +2).\n• Heavy Armor (e.g. Plate): Fixed armor value — DEX mod is ignored.\nShields always add +2 on top of whatever formula you use.',
			changes: 'Equipping heavier armor usually raises your AC base but caps or removes your DEX bonus. A high-DEX character in Light Armor may actually match or beat a heavily armored fighter. Spells like Mage Armor (13 + DEX) or Shield of Faith (+2 AC) can boost your AC temporarily.',
		},
		speed: {
			title: 'Speed',
			what:    'Speed is how many feet you can move on your turn during combat. Outside of combat it describes your general travel pace.',
			impact:  'Each combat turn you can spend this movement freely — walking, dashing, or spreading it across different moves. Difficult terrain costs double movement per foot. You can split movement before and after actions.',
			math:    'Most races have a base speed of 30 ft. Some races naturally move faster or slower — Dwarves, for example, always move 25 ft regardless of armor, while certain fleet-footed lineages reach 35 ft or more. Your class rarely changes base speed except through specific class features such as a Monk\'s Unarmored Movement.',
			changes: 'Heavy Armor may reduce speed by 10 ft if your STR score is below the armor\'s requirement. The Haste spell doubles your speed. Difficult terrain, difficult conditions, grapples, or the Restrained condition can reduce your effective movement.',
		},
		initiative: {
			title: 'Initiative',
			what:    'Initiative determines your place in the turn order when combat begins. It is rolled once at the start of each encounter.',
			impact:  'At the start of combat everyone rolls a d20 and adds their Initiative modifier. Higher results act earlier. Going first lets you deal damage, cast buffs, or create advantages before enemies can react.',
			math:    'Initiative modifier = your DEX modifier. A DEX of 12 gives +1; DEX 16 gives +3. Some class features and feats — such as the Alert feat or the Bard\'s Jack of All Trades — can add bonuses on top.',
			changes: 'Boosting DEX raises Initiative directly. The Alert feat gives +5 Initiative and prevents being surprised. Some magic items (Boots of Speed, certain rings) can also improve Initiative. Disadvantage on Initiative rolls can come from conditions like Exhaustion.',
		},
		proficiency: {
			title: 'Proficiency Bonus',
			what:    'Your Proficiency Bonus is a flat bonus added whenever you do something you are trained in — an attack with a weapon you\'re proficient with, a skill check you\'re proficient in, a saving throw your class grants.',
			impact:  'It scales with your total character level, not class level. It applies to: attack rolls (proficient weapons), skill checks (proficient skills and tools), saving throws (proficient saves), spell attack rolls, and spell save DCs.',
			math:    'Determined entirely by total character level:\n• Levels 1–4: +2\n• Levels 5–8: +3\n• Levels 9–12: +4\n• Levels 13–16: +5\n• Levels 17–20: +6\nNot affected by ability scores or items — it simply grows as you level up.',
			changes: 'Some features let you double your Proficiency Bonus (called Expertise) on specific skills. Bardic Expertise and the Rogue\'s Expertise feature do this. No items permanently raise the base bonus, though some spells and features let you add it where you normally wouldn\'t.',
		},
		perception: {
			title: 'Passive Perception',
			what:    'Passive Perception is a standing awareness score used when you aren\'t actively searching. The DM uses it automatically — no roll needed — to determine whether you notice hidden creatures, traps, or clues.',
			impact:  'If a hidden threat\'s Stealth check result is equal to or below your Passive Perception, you spot it automatically. It is your passive "alert level" at all times, even when distracted or asleep (with disadvantage).',
			math:    'Passive Perception = 10 + your WIS modifier + Perception proficiency bonus (if proficient).\nExample: WIS 12 (+1) with Perception proficiency (+2) = 13. Expertise in Perception doubles the proficiency portion.',
			changes: 'Raising WIS improves it directly. Gaining Perception proficiency adds your full Proficiency Bonus. Expertise doubles it. The Observant feat adds +5. The Darkvision or Keen Mind features can also affect related checks.',
		},

		// ── Ability scores ──────────────────────────────────────────────────
		str: {
			title: 'Strength (STR)',
			what:    'Strength measures raw physical power — how hard you hit, how much you can carry, and how forcefully you can move things or people.',
			impact:  'Governs melee attack and damage rolls with most weapons (unless Finesse), Athletics checks (climbing, jumping, swimming, grappling), carrying capacity, and STR saving throws. When encumbered, a low STR limits how much gear you can bear without penalty.',
			math:    'Your STR modifier = (STR score − 10) ÷ 2, rounded down.\n• Score 8 → modifier −1\n• Score 10–11 → modifier +0\n• Score 16–17 → modifier +3\n• Score 20 → modifier +5\nMelee attack roll: d20 + STR modifier + Proficiency Bonus (if proficient).',
			changes: 'Ability Score Improvements at levels 4, 8, 12, 16, and 19 let you raise STR by +2, or two stats by +1. The Enhance Ability spell (Bull\'s Strength) grants Advantage on STR checks. Gauntlets of Ogre Power set STR to 19. The Belt of Giant Strength sets it higher. The Bane spell or Exhaustion conditions can effectively penalize STR-based actions.',
		},
		dex: {
			title: 'Dexterity (DEX)',
			what:    'Dexterity measures agility, reflexes, and balance — how fast you react, how precisely you move, and how effectively you avoid harm.',
			impact:  'Governs AC (unarmored and Light/Medium Armor), Initiative, Ranged attack and damage rolls, Finesse weapon attacks, Dexterity saving throws (dodging area effects), and skills: Acrobatics, Sleight of Hand, and Stealth.',
			math:    'Your DEX modifier = (DEX score − 10) ÷ 2, rounded down.\n• Unarmored AC = 10 + DEX modifier\n• Light Armor AC = Armor base + full DEX modifier\n• Medium Armor AC = Armor base + DEX modifier (max +2)\n• Heavy Armor AC = Fixed value — DEX modifier ignored entirely',
			changes: 'Ability Score Improvements raise DEX directly. The Cat\'s Grace (Enhance Ability) spell grants Advantage on DEX checks and halves fall damage. The Cloak of Protection adds +1 to AC and DEX saves. Restrained or Paralyzed conditions impose Disadvantage on DEX saves. Wearing Heavy Armor negates your DEX bonus to AC.',
		},
		con: {
			title: 'Constitution (CON)',
			what:    'Constitution represents your toughness, stamina, and vital force — the difference between shaking off a blow and being knocked out.',
			impact:  'Governs your Hit Point maximum (every level you gain HP equal to your Hit Die roll + CON modifier), CON saving throws (maintaining concentration on spells, resisting poison and exhaustion), and the number of hours you can work or travel before needing rest.',
			math:    'HP at level-up = Hit Die result + CON modifier (minimum 1).\nExample: Fighter (d10) with CON 16 (+3) gains 10+3 = up to 13 HP per level.\nEach point of CON modifier change retroactively adjusts your HP maximum for every level you\'ve gained.',
			changes: 'Raising CON via Ability Score Improvements is one of the most impactful upgrades for survivability. The Amulet of Health sets CON to 19. Enhance Ability (Bear\'s Endurance) grants temp HP and Advantage on CON checks. The Poisoned or Diseased conditions often impose Disadvantage on CON saves.',
		},
		int: {
			title: 'Intelligence (INT)',
			what:    'Intelligence measures memory, reasoning, and the ability to learn and apply knowledge — both academic and arcane.',
			impact:  'Governs Arcana, History, Investigation, Nature, and Religion skill checks. For Wizards, INT is the spellcasting ability — determining spell attack bonus and spell save DC. INT saving throws resist effects that alter or charm the mind through logic or memory.',
			math:    'Wizard Spell Attack = d20 + INT modifier + Proficiency Bonus.\nWizard Spell Save DC = 8 + INT modifier + Proficiency Bonus.\nExample: INT 16 (+3), Proficiency +3 → Save DC 14.',
			changes: 'Ability Score Improvements raise INT. The Headband of Intellect sets INT to 19. Enhance Ability (Fox\'s Cunning) grants Advantage on INT checks. A low INT score hurts Wizards more than any other class. The Feeblemind spell can devastate INT (and CHA) temporarily.',
		},
		wis: {
			title: 'Wisdom (WIS)',
			what:    'Wisdom reflects perception, intuition, and attunement to the world around you — the ability to read people, sense danger, and understand nature.',
			impact:  'Governs Insight, Medicine, Perception, Survival, and Animal Handling checks. For Clerics, Druids, and Rangers it is the spellcasting ability. WIS saving throws resist mind-affecting spells (fear, confusion, charm). Passive Perception is directly derived from WIS.',
			math:    'Cleric/Druid Spell Save DC = 8 + WIS modifier + Proficiency Bonus.\nPassive Perception = 10 + WIS modifier (+ Proficiency Bonus if Perception proficient).\nExample: WIS 14 (+2), proficient in Perception (+3) → Passive Perception 15.',
			changes: 'Ability Score Improvements raise WIS directly. Certain rare enchanted items can raise your WIS score as well. The Enhance Ability (Owl\'s Wisdom) spell grants Advantage on WIS checks. The Confused condition imposes Disadvantage on WIS saves. Low WIS is particularly punishing for Clerics and Druids relying on it to fuel spells.',
		},
		cha: {
			title: 'Charisma (CHA)',
			what:    'Charisma measures force of personality, persuasive power, and the ability to influence others through presence, words, and sheer will.',
			impact:  'Governs Deception, Intimidation, Performance, and Persuasion checks. For Bards, Paladins, Sorcerers, and Warlocks it is the spellcasting ability. CHA saving throws resist effects that reshape personality or impose magical compulsion.',
			math:    'Sorcerer/Warlock/Bard Spell Save DC = 8 + CHA modifier + Proficiency Bonus.\nExample: CHA 18 (+4), Proficiency +4 → Save DC 16 — making spells very hard to resist.',
			changes: 'Ability Score Improvements raise CHA. Certain rare enchanted items can raise your CHA score directly. Enhance Ability (Eagle\'s Splendor) grants Advantage on CHA checks. The Charm Person spell effectively neutralizes a target\'s resistance to your CHA. Low CHA makes social encounters harder but rarely affects combat directly unless you\'re a CHA-based spellcaster.',
		},
	};

	function toggleStatInfo(key: string) {
		statInfoKey = statInfoKey === key ? null : key;
	}
</script>

<div class="journal-shell">
	<!-- Tab bar -->
	<div class="tab-bar" role="tablist">
		{#each tabs as tab}
			<button
				role="tab"
				class="tab-btn"
				class:active={activeTab === tab.id}
				onclick={() => {
					activeTab = tab.id;
					if (tab.id === 'quests') questNotification = false;
				}}
				aria-selected={activeTab === tab.id}
			>
				<span class="tab-icon">{tab.icon}</span>
				<span class="tab-label">{tab.label}</span>
				{#if tab.id === 'quests' && questNotification}
					<span class="tab-badge" aria-label="New quest"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Tab content -->
	<div class="tab-content" bind:this={invScrollEl}>

		<!-- ─── STATUS ─── -->
		{#if activeTab === 'status'}
			{#if !currentCharacter}
				<CharacterCreation {adventureId} {onCreated} {worldCities} />
			{:else}
				{@const pc = currentCharacter}
				<div class="status-tab">
					<!-- Identity -->
					<div class="char-identity">
						<div class="char-name-line">
							<span class="char-name">{pc.name}</span>
							<span class="char-level-badge">Lv {pc.level}</span>
						</div>
						<span class="char-meta char-meta-class">{fmt(pc.race)}{pc.subrace ? ` ${fmt(pc.subrace)}` : ''} · {classLine(pc)}</span>
						<span class="char-meta muted">{pc.background ? fmt(pc.background) : ''}{pc.alignment ? ` · ${fmt(pc.alignment)}` : ''}</span>
					</div>

					<!-- HP bar (large) -->
					<div class="hp-section">
						<div class="hp-label-row">
							<span class="hp-label">HP</span>
							<span class="hp-numbers">
								<strong style="color: {hpColor(pc)}">{pc.hp}</strong>
								<span class="hp-sep">/ {pc.maxHp}</span>
								{#if pc.tempHp > 0}<span class="temp-hp">+{pc.tempHp} temp</span>{/if}
							</span>
						</div>
						<div class="hp-bar-track">
							<div class="hp-bar-fill" style="width:{hpPercent(pc)}%; background:{hpColor(pc)}"></div>
						</div>
						{#if pc.dead}
							<span class="condition-pill" style="background: rgba(248,113,113,0.18); color:#f87171">☠ Dead</span>
						{:else if pc.stable}
							<span class="condition-pill" style="background: rgba(245,200,66,0.18); color:#f5c842">💛 Stable (0 HP)</span>
						{/if}
					</div>

					<!-- Core stats row -->
					<div class="core-row">
						{#each ([ ['ac', 'Armor Class (AC)', String(pc.ac), ''] , ['speed', 'Speed', String(pc.speed), 'ft'], ['initiative', 'Initiative', signed(abilityModifier(pc.abilities.dex)), ''], ['proficiency', 'Proficiency', `+${pc.proficiencyBonus}`, ''], ['perception', 'Passive Perception', String(pc.passivePerception), ''] ] as [string,string,string,string][]) as [key, label, val, unit]}
							<div class="core-stat" class:stat-info-open={statInfoKey === key}>
								<button class="stat-info-btn" onclick={(e) => { e.stopPropagation(); toggleStatInfo(key); }} aria-label="Explain {label}">?</button>
								<span class="core-label">{label}</span>
								<strong class="core-value">{val}{#if unit}<small>{unit}</small>{/if}</strong>
							</div>
						{/each}
					</div>

					<!-- Core-stat info popover -->
					{#if statInfoKey && STAT_INFO[statInfoKey]}
						{@const info = STAT_INFO[statInfoKey]}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="stat-popover-backdrop" role="presentation" onclick={() => statInfoKey = null}>
							<div class="stat-popover" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
								<div class="stat-popover-header">
									<span class="stat-popover-title">{info.title}</span>
									<button class="stat-popover-close" onclick={() => statInfoKey = null} aria-label="Close">✕</button>
								</div>
								<div class="stat-popover-body">
									<div class="stat-popover-section">
										<span class="stat-popover-label">What it is</span>
										<p>{info.what}</p>
									</div>
									<div class="stat-popover-section">
										<span class="stat-popover-label">What it affects</span>
										<p>{info.impact}</p>
									</div>
									<div class="stat-popover-section">
										<span class="stat-popover-label">How it's calculated</span>
										<p style="white-space: pre-line">{info.math}</p>
									</div>
									<div class="stat-popover-section">
										<span class="stat-popover-label">How to change it</span>
										<p>{info.changes}</p>
									</div>
								</div>
							</div>
						</div>
					{/if}

					<!-- Ability scores grid (2×3) -->
					<div class="ability-grid">
						{#each abilityOrder as ability}
							<div class="ability-cell" style="--ab-color: {abilityColors[ability]}" class:stat-info-open={statInfoKey === ability}>
								<button class="stat-info-btn" onclick={(e) => { e.stopPropagation(); toggleStatInfo(ability); }} aria-label="Explain {abilityLabels[ability]}">?</button>
								<span class="ab-label">{abilityLabels[ability]}</span>
								<strong class="ab-score">{pc.abilities[ability]}</strong>
								<span class="ab-mod">{signed(abilityModifier(pc.abilities[ability]))}</span>
							</div>
						{/each}
					</div>

					<!-- Saves row -->
					<div class="section-block">
						<span class="section-title">Saving Throws</span>
						<div class="saves-row">
							{#each abilityOrder as ability}
								<span class="save-chip" class:proficient={pc.saveProficiencies.includes(ability)}>
									{abilityLabels[ability]}
								</span>
							{/each}
						</div>
					</div>

					<!-- Conditions -->
					{#if pc.conditions.length > 0}
						<div class="section-block">
							<span class="section-title">Conditions</span>
							<div class="pill-row">
								{#each pc.conditions as cond}
									<span class="condition-pill" style="background: rgba(0,0,0,0.3); border-color:{conditionColor(cond)}; color:{conditionColor(cond)}">
										{fmt(cond)}
									</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Hit Dice -->
					<div class="section-block">
						<span class="section-title">Hit Dice ({getTotalHitDiceRemaining(pc)} remaining)</span>
						<div class="pill-row">
							{#each pc.classes as cl}
								<span class="info-pill">{cl.hitDiceRemaining} × d{CLASS_HIT_DIE[cl.name]}</span>
							{/each}
						</div>
					</div>

					<!-- Spell Slots -->
					{#if hasNonPactSlots(pc)}
						<div class="section-block">
							<span class="section-title">Spell Slots</span>
							<div class="spell-slots">
								{#each pc.spellSlots.filter(s => s.max > 0) as slot}
									<div class="slot-row">
										<span class="slot-level">L{slot.level}</span>
										<div class="slot-dots">
											{#each slotDots(slot) as filled}
												<span class="slot-dot" class:filled></span>
											{/each}
										</div>
										<span class="slot-count">{slot.current}/{slot.max}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if pc.pactSlots.length > 0 && pc.pactSlots.some(s => s.max > 0)}
						<div class="section-block">
							<span class="section-title">Pact Magic</span>
							<div class="spell-slots">
								{#each pc.pactSlots.filter(s => s.max > 0) as slot}
									<div class="slot-row">
										<span class="slot-level">L{slot.level}</span>
										<div class="slot-dots">
											{#each slotDots(slot) as filled}
												<span class="slot-dot pact" class:filled></span>
											{/each}
										</div>
										<span class="slot-count">{slot.current}/{slot.max}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if pc.concentratingOn}
						<div class="concentration-banner">
							<span>🌀 Concentrating on <strong>{fmt(pc.concentratingOn)}</strong></span>
						</div>
					{/if}

					<!-- Feats -->
					{#if pc.feats && pc.feats.length > 0}
						<div class="section-block">
							<span class="section-title">Feats</span>
							<div class="skill-list">
								{#each pc.feats as featName}
									{@const featDef = getFeat(featName)}
									<span class="skill-chip feat-chip" title={featDef ? featDef.description : fmt(featName)}>
										✦ {featDef ? featDef.displayName : fmt(featName)}
									</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Skills (proficient) -->
					<div class="section-block">
						<span class="section-title">Skills</span>
						<div class="skill-list">
							{#each pc.skillProficiencies as skill}
								<span class="skill-chip" class:expertise={pc.expertiseSkills?.includes(skill)} title={skillTooltip(skill)}>
									{pc.expertiseSkills?.includes(skill) ? '◆' : '•'}
									{fmt(skill)}
								</span>
							{/each}
							{#if pc.skillProficiencies.length === 0}
								<span class="muted-sm">None</span>
							{/if}
						</div>
					</div>

					<!-- Proficiencies: Armor -->
					{#if (pc.armorProficiencies?.length ?? 0) > 0}
						<div class="section-block">
							<span class="section-title">Armor Proficiencies</span>
							<div class="pill-row">
								{#each pc.armorProficiencies as prof}
									<span class="info-pill" title={profTooltip(prof)}>{profDisplay(prof)}</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Proficiencies: Weapons -->
					{#if dedupedWeaponProfs(pc.weaponProficiencies ?? []).length > 0}
						<div class="section-block">
							<span class="section-title">Weapon Proficiencies</span>
							<div class="pill-row">
								{#each dedupedWeaponProfs(pc.weaponProficiencies ?? []) as prof}
									<span class="info-pill" title={profTooltip(prof)}>{profDisplay(prof)}</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Proficiencies: Tools & Vehicles -->
					{#if (pc.toolProficiencies?.length ?? 0) > 0}
						<div class="section-block">
							<span class="section-title">Tools &amp; Vehicles</span>
							<div class="pill-row">
								{#each pc.toolProficiencies as prof}
									<span class="info-pill" title={profTooltip(prof)}>{profDisplay(prof)}</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Known Languages -->
					{#if pc.languages && pc.languages.length > 0}
						<div class="section-block">
							<span class="section-title">Known Languages</span>
							<div class="pill-row">
								{#each pc.languages as lang}
									<span class="lang-chip" title={langTooltip(lang)}>{lang}</span>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Quick inventory link -->
					<button class="tab-link-btn" onclick={() => activeTab = 'inventory'}>
						🎒 View Inventory ({pc.inventory.length} items · {countCoinItems(pc.inventory).gp} gp)
					</button>
				</div>
			{/if}

		<!-- ─── PARTY ─── -->
{:else if activeTab === 'party'}
<div class="party-tab">
{#each members as member}
{@const pc = partyCharacters[member.userId] ?? null}
<div class="party-card">
<div class="party-card-header">
{#if member.avatarUrl}
<img src={member.avatarUrl} alt="" class="party-avatar" />
{:else}
<div class="party-avatar party-avatar-placeholder">
{member.username.charAt(0).toUpperCase()}
</div>
{/if}
<div class="party-identity">
<span class="party-username">
{member.username}
{#if member.userId === currentUserId}
<span class="you-tag">(you)</span>
{/if}
</span>
{#if pc}
<span class="party-char-line">{pc.name} · {classLine(pc)}</span>
<span class="party-race-line muted-sm">{fmt(pc.race)}{pc.subrace ? ` ${fmt(pc.subrace)}` : ''}</span>
{:else}
<span class="muted-sm">No character yet</span>
{/if}
</div>
{#if pc}
<div class="party-ac-badge">{pc.ac}<small>AC</small></div>
{/if}
</div>
{#if pc}
<div class="party-hp-section">
<div class="hp-bar-track">
<div class="hp-bar-fill" style="width:{hpPercent(pc)}%; background:{hpColor(pc)}"></div>
</div>
<span class="party-hp-text" style="color:{hpColor(pc)}">{pc.hp}/{pc.maxHp} HP</span>
</div>
{#if pc.conditions.length > 0}
<div class="pill-row mt-xs">
{#each pc.conditions as cond}
<span class="condition-pill sm" style="border-color:{conditionColor(cond)}; color:{conditionColor(cond)}">{fmt(cond)}</span>
{/each}
</div>
{/if}
<div class="mini-abilities">
{#each abilityOrder as ability}
<div class="mini-ab">
<span class="mini-ab-label">{abilityLabels[ability]}</span>
<span class="mini-ab-mod">{signed(abilityModifier(pc.abilities[ability]))}</span>
</div>
{/each}
</div>
{/if}
</div>
{/each}
{#if companions.length > 0}
<div class="companion-section-label">Companions</div>
{#each companions as npc (npc.id)}
<div class="party-card companion-card">
<div class="party-card-header">
<div class="party-avatar party-avatar-placeholder companion-av">
{npc.name.charAt(0).toUpperCase()}
</div>
<div class="party-identity">
<span class="party-username">{npc.name}</span>
<span class="party-char-line companion-role-line">{npc.role}</span>
</div>
{#if npc.statBlock?.ac}
<div class="party-ac-badge">{npc.statBlock.ac}<small>AC</small></div>
{/if}
</div>
{#if npc.statBlock?.maxHp}
{@const pct = Math.max(0, Math.round((npc.statBlock.hp / npc.statBlock.maxHp) * 100))}
{@const col = pct > 60 ? '#4ade80' : pct > 25 ? '#f5c842' : '#f87171'}
<div class="party-hp-section">
<div class="hp-bar-track">
<div class="hp-bar-fill" style="width:{pct}%; background:{col}"></div>
</div>
<span class="party-hp-text" style="color:{col}">{npc.statBlock.hp}/{npc.statBlock.maxHp} HP</span>
</div>
{/if}
</div>
{/each}
{/if}
</div>

		<!-- ─── QUESTS ─── -->
		{:else if activeTab === 'quests'}
			<div class="quests-tab">
				{#if activeQuests.length === 0 && completedQuests.length === 0}
					<div class="empty-state">
						<p class="empty-title">No quests yet</p>
						<p class="empty-sub">Talk to the GM to receive quests.</p>
					</div>
				{/if}

				{#if activeQuests.length > 0}
					<div class="quest-section-label">Active ({activeQuests.length})</div>
					{#each activeQuests as quest}
						{@const isExpanded = expandedQuestId === quest.id}
						{@const giver = quest.giverNpcId ? npcs.find(n => n.id === quest.giverNpcId) : null}
						{@const objsVisible = visibleObjectives(quest)}
						<div class="quest-card" class:expanded={isExpanded}>
							<button class="quest-toggle" onclick={() => expandedQuestId = isExpanded ? null : quest.id}>
								<span class="quest-name">{quest.name}</span>
								<div class="quest-header-right">
									<span class="quest-status-badge status-{quest.status}">{quest.status}</span>
									<span class="quest-caret">{isExpanded ? '▼' : '▶'}</span>
								</div>
							</button>
							{#if isExpanded}
								<div class="quest-body">
									<p class="quest-desc">{quest.description}</p>
									{#if giver}
										<span class="quest-meta">Quest Giver: <strong>{giver.name}</strong></span>
									{/if}
									{#if quest.deadline}
										<span class="quest-deadline">⏳ Deadline: Day {quest.deadline.day} — {quest.deadline.description}</span>
									{/if}
									{#if quest.rewards && (quest.rewards.xp || quest.rewards.gold || (quest.rewards.items?.length ?? 0) > 0)}
										<div class="quest-rewards">
											<span class="quest-rewards-label">Rewards:</span>
											{#if quest.rewards.xp}<span class="reward-chip">✦ {quest.rewards.xp} XP</span>{/if}
											{#if quest.rewards.gold}<span class="reward-chip">🪙 {quest.rewards.gold} gp</span>{/if}
											{#each quest.rewards.items ?? [] as rewardItem}<span class="reward-chip">{rewardItem.name}</span>{/each}
										</div>
									{/if}
									{#if objsVisible.length > 0}
										<div class="objectives-list">
											{#each objsVisible as obj}
												<div class="objective-row" class:done={obj.done}>
													<span class="obj-icon">{obj.done ? '✓' : '○'}</span>
													<span>{obj.text}</span>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}

				{#if completedQuests.length > 0}
					<div class="quest-section-label completed-label">Completed ({completedQuests.length})</div>
					{#each completedQuests as quest}
						{@const isExpanded = expandedQuestId === quest.id}
						<div class="quest-card completed" class:expanded={isExpanded}>
							<button class="quest-toggle" onclick={() => expandedQuestId = isExpanded ? null : quest.id}>
								<span class="quest-name">{quest.name}</span>
								<div class="quest-header-right">
									<span class="quest-status-badge status-completed">completed</span>
									<span class="quest-caret">{isExpanded ? '▼' : '▶'}</span>
								</div>
							</button>
							{#if isExpanded}
								<div class="quest-body">
									<p class="quest-desc">{quest.description}</p>
									{#if quest.completionMethod}
										<span class="quest-meta">Completed via: <strong>{fmt(quest.completionMethod)}</strong></span>
									{/if}
									{#if quest.objectives.length > 0}
										<div class="objectives-list">
											{#each quest.objectives as obj}
												<div class="objective-row done">
													<span class="obj-icon">✓</span>
													<span>{obj.text}</span>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>

		<!-- ─── INVENTORY ─── -->
		{:else if activeTab === 'inventory'}
			<div class="inventory-tab">
				{#if !currentCharacter}
					<div class="empty-state">
						<p class="empty-title">No character</p>
						<p class="empty-sub">Create your character to see inventory.</p>
					</div>
				{:else}
					{@const pc = currentCharacter}
					{@const enc = getEnhancedEncumbranceInfo(pc)}
					{@const coins = countCoinItems(pc.inventory)}

					<!-- ── Currency boxes ── -->
					<div class="currency-row">
						<div class="currency-box gold">
							<span class="currency-icon">🟡</span>
							<span class="currency-val">{coins.gp}</span>
							<span class="currency-denom">gp</span>
						</div>
						<div class="currency-box silver">
							<span class="currency-icon">⚪</span>
							<span class="currency-val">{coins.sp}</span>
							<span class="currency-denom">sp</span>
						</div>
						<div class="currency-box copper">
							<span class="currency-icon">🟠</span>
							<span class="currency-val">{coins.cp}</span>
							<span class="currency-denom">cp</span>
						</div>
					</div>

					<!-- ── Encumbrance bar ── -->
					<div class="enc-section">
						<div class="enc-header">
							<span class="enc-label">
								Carry Load: <strong>{enc.wuTotal.toFixed(1)} WU</strong>
								<span class="enc-capacity">/ {enc.capacity} WU</span>
								{#if enc.badge === 'overloaded'}
									<span class="enc-status over">Overloaded</span>
								{:else if enc.badge === 'burdened'}
									<span class="enc-status heavy">Burdened</span>
								{:else if enc.badge === 'loaded'}
									<span class="enc-status enc">Loaded</span>
								{/if}
							</span>
							<button
								class="info-btn"
								onclick={() => showEncPopover = !showEncPopover}
								aria-label="Encumbrance info"
							>?</button>
						</div>
						{#if showEncPopover}
							<div class="info-popover enc-popover" role="tooltip">
								<button class="popover-close" onclick={() => showEncPopover = false}>✕</button>
								<strong>Encumbrance Thresholds</strong>
								<ul>
									<li><span class="enc-dot normal">●</span> <strong>Unloaded</strong> (0–{enc.loadedThreshold} WU): No penalty.</li>
									<li><span class="enc-dot yellow">●</span> <strong>Loaded</strong> ({enc.loadedThreshold}–{enc.burdenedThreshold} WU): No speed penalty — but you feel the weight.</li>
									<li><span class="enc-dot orange">●</span> <strong>Burdened</strong> ({enc.burdenedThreshold}–{enc.capacity} WU): Speed −10 ft; disadvantage on STR, DEX &amp; CON checks.</li>
									<li><span class="enc-dot red">●</span> <strong>Overloaded</strong> (&gt;{enc.capacity} WU): Speed −20 ft; GM may impose further penalties.</li>
								</ul>
								<p class="popover-note">Capacity = STR × 30 WU. Worn/equipped items count at 25% WU. 1 WU = 1 lb.</p>
							</div>
						{/if}
						<div class="enc-bar-wrap">
							<!-- Green zone: 0 → Loaded (STR×15) = 50% of capacity -->
							<div class="enc-zone enc-zone-green" style="width:{(enc.loadedThreshold / enc.capacity) * 100}%"></div>
							<!-- Yellow zone: Loaded → Burdened (STR×25) = 33% of capacity -->
							<div class="enc-zone enc-zone-yellow" style="width:{((enc.burdenedThreshold - enc.loadedThreshold) / enc.capacity) * 100}%"></div>
							<!-- Orange zone: Burdened → Overloaded (STR×30) = 17% of capacity -->
							<div class="enc-zone enc-zone-orange" style="width:{((enc.capacity - enc.burdenedThreshold) / enc.capacity) * 100}%"></div>
							<!-- Fill indicator -->
							<div
								class="enc-bar-fill"
								class:enc-fill-green={!enc.isEncumbered}
								class:enc-fill-yellow={enc.isEncumbered && !enc.isHeavilyEncumbered}
								class:enc-fill-orange={enc.isHeavilyEncumbered && !enc.isOverCapacity}
								class:enc-fill-red={enc.isOverCapacity}
								style="width:{Math.min(100, enc.pct)}%"
							></div>
						</div>
						<div class="enc-footer">
							<button class="wu-su-btn" onclick={() => showWuSuPopover = !showWuSuPopover}>WU &amp; SU ?</button>
							{#if showWuSuPopover}
								<div class="info-popover wu-su-popover" role="tooltip">
									<button class="popover-close" onclick={() => showWuSuPopover = false}>✕</button>
									<strong>Weight Units &amp; Space Units</strong>
									<p><strong>WU (Weight Unit)</strong> = 1 lb. Measures physical load on your body and controls encumbrance.</p>
									<p><strong>SU (Space Unit)</strong> = geometric volume. Measures how much room an item takes up based on its shape. Coins stack flat (0.01 SU each). A bedroll is bulky (5 SU) despite being light.</p>
									<p>Containers show both WU and SU bars. SU does not affect the main encumbrance bar — only WU does. Some containers provide storage discounts: coins in a purse barely take up space; arrows in a quiver pack efficiently.</p>
									<p class="popover-note">Carry capacity = STR × 30 WU. Worn/equipped items count at 25% WU.</p>
								</div>
							{/if}
						</div>
					</div>

					<!-- ── Zone 1: EQUIPPED ── -->
					{@const equippedItems = pc.inventory.filter(i =>
						('equipped' in i && (i as WeaponItem | ArmorItem).equipped === true)
					)}
					<div
						class="inv-zone equipped-zone"
						class:drop-target={dropTargetId === 'equipped'}
						class:invalid-drop-target={invalidTargetId === 'equipped'}
						ondragover={(e) => handleDragOver(e, 'equipped')}
						ondragleave={handleDragLeave}
						ondrop={(e) => handleDrop(e, 'equipped')}
						role="region"
						aria-label="Equipped items"
					>
						<div class="zone-header">
							<span class="zone-title">⚔️ Equipped</span>
							<span class="zone-note muted-sm">No WU/SU limit — contributes to total carry</span>
						</div>
						{#if equippedItems.length === 0}
							<p class="muted-sm zone-empty">Nothing equipped. Drag weapons or armor here.</p>
						{:else}
							{#each equippedItems as item}
								<div
									class="inv-item"
									draggable="true"
									ondragstart={(e) => handleDragStart(e, item.id, 'equipped')}
									ondragend={handleDragEnd}
									oncontextmenu={(e) => handleItemContextMenu(e, item.id, 'equipped')}
									class:dragging={dragState?.itemId === item.id}
									role="listitem"
								>
									<span class="drag-handle" aria-hidden="true">⠿</span>
									<div class="inv-item-body">
										<div class="inv-item-header">
											<span class="inv-name">{cleanItemName(item.name)}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
											<span class="inv-badges">
												{#if item.isStartingEquipment}<span class="se-badge" title="Starting Equipment">SE</span>{/if}
												{#if item.rarity && item.rarity !== 'common'}<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>{/if}
												<span class="wu-su-chip">{(item.weight * item.quantity).toFixed(1)} WU</span>
												<button class="equip-btn unequip-btn" onclick={(ev) => { ev.stopPropagation(); quickUnequip(item.id); }}>Unequip</button>
											</span>
										</div>
										{#if 'damage' in item && item.damage}<span class="inv-meta">{item.damage}</span>{/if}
										{#if 'baseAC' in item && item.baseAC}<span class="inv-meta">AC {item.baseAC}</span>{/if}
										{#if item.description && !isAutoDesc(item.description)}<p class="inv-desc">{item.description}</p>{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>

					<!-- ── Zone 2: CONTAINERS ── -->
					{@const containerItems = orderedContainers}
					{#if containerItems.length > 0}
						<div class="zone-label">Containers</div>
						{#each containerItems as container, containerIdx}
							{@const load = getContainerLoad(container)}
							{@const contDefaults = CONTAINER_DEFAULTS[container.containerType] ?? CONTAINER_DEFAULTS['other']}
							<div
								class="container-panel"
								class:drop-target={dropTargetId === container.id && !dropInvalid}
								class:invalid-drop-target={invalidTargetId === container.id || (dropTargetId === container.id && dropInvalid)}
								ondragover={(e) => handleDragOver(e, container.id, container)}
								ondragleave={handleDragLeave}
								ondrop={(e) => handleDrop(e, container.id, container)}
								role="region"
								aria-label="{container.name} container"
							>
								<div class="container-header">
									<button
										class="container-toggle"
										onclick={() => expandedContainerId = expandedContainerId === container.id ? null : container.id}
										aria-expanded={expandedContainerId === container.id}
									>
										<span class="container-icon">📦</span>
										<span class="container-name">{cleanItemName(container.name)}</span>
										<span class="container-load-text muted-sm">
											{load.wuUsed.toFixed(1)}/{load.wuMax} WU · {load.suUsed.toFixed(1)}/{load.suMax} SU
										</span>
										<span class="inv-section-caret">{expandedContainerId === container.id ? '▾' : '▸'}</span>
									</button>
									<div class="container-header-actions">
										<button
											class="reorder-btn"
											onclick={() => moveContainerUp(container.id)}
											disabled={containerIdx === 0}
											aria-label="Move {container.name} up"
											title="Move up"
										>↑</button>
										<button
											class="reorder-btn"
											onclick={() => moveContainerDown(container.id)}
											disabled={containerIdx === containerItems.length - 1}
											aria-label="Move {container.name} down"
											title="Move down"
										>↓</button>
									</div>
								</div>

								<!-- Container load bars -->
								<div class="container-load-bars">
									<div class="load-bar-row">
										<span class="load-bar-label">WU</span>
										<div class="load-bar-track">
											<div
												class="load-bar-fill"
												class:load-warn={load.wuPct > 75}
												class:load-full={load.wuPct >= 100}
												style="width:{load.wuPct}%"
											></div>
										</div>
										<span class="load-bar-pct">{load.wuPct.toFixed(0)}%</span>
									</div>
									<div class="load-bar-row">
										<span class="load-bar-label">SU</span>
										<div class="load-bar-track">
											<div
												class="load-bar-fill"
												class:load-warn={load.suPct > 75}
												class:load-full={load.suPct >= 100}
												style="width:{load.suPct}%"
											></div>
										</div>
										<span class="load-bar-pct">{load.suPct.toFixed(0)}%</span>
									</div>
								</div>



								<!-- Container contents -->
								{#if expandedContainerId === container.id}
									<div class="container-body">
										{#if container.contents.length === 0}
											<p class="muted-sm zone-empty">Empty. Drag items here.</p>
										{:else}
											{#each container.contents as item}
												{#if item.category === 'container'}
													{@const sub = item as ContainerItem}
													{@const subLoad = getContainerLoad(sub)}
													<!-- Nested container — drag it OUT by dragging from parent, or expand to manage its contents -->
													<div
														class="sub-container-panel"
														class:drop-target={dropTargetId === sub.id && !dropInvalid}
														class:invalid-drop-target={invalidTargetId === sub.id || (dropTargetId === sub.id && dropInvalid)}
														ondragover={(e) => handleDragOver(e, sub.id, sub)}
														ondragleave={handleDragLeave}
														ondrop={(e) => handleDrop(e, sub.id, sub)}
														role="region"
														aria-label="{sub.name} (nested in {container.name})"
													>
														<div class="sub-container-header">
															<button
																class="sub-container-toggle"
																draggable="true"
																ondragstart={(e) => handleDragStart(e, sub.id, container.id)}
																ondragend={handleDragEnd}
																onclick={() => expandedContainerId = expandedContainerId === sub.id ? null : sub.id}
																aria-expanded={expandedContainerId === sub.id}
															>
																<span class="container-icon">📦</span>
																<span class="container-name">{cleanItemName(sub.name)}</span>
																<span class="container-load-text muted-sm">
																	{subLoad.wuUsed.toFixed(1)}/{subLoad.wuMax} WU · {subLoad.suUsed.toFixed(1)}/{subLoad.suMax} SU
																</span>
																<span class="inv-section-caret">{expandedContainerId === sub.id ? '▾' : '▸'}</span>
															</button>
														</div>
														{#if expandedContainerId === sub.id}
															<div class="sub-container-body">
																{#if sub.contents.length === 0}
																	<p class="muted-sm zone-empty">Empty. Drag items here.</p>
																{:else}
																	{#each sub.contents as subItem}
																		<div
																			class="inv-item inv-item-nested"
																			draggable="true"
																			ondragstart={(e) => handleDragStart(e, subItem.id, sub.id)}
																			ondragend={handleDragEnd}
																			oncontextmenu={(e) => handleItemContextMenu(e, subItem.id, sub.id)}
																			class:dragging={dragState?.itemId === subItem.id}
																			role="listitem"
																		>
																			<span class="drag-handle" aria-hidden="true">⠿</span>
																			<div class="inv-item-body">
																				<div class="inv-item-header">
																					<span class="inv-name">{cleanItemName(subItem.name)}{subItem.quantity > 1 ? ` ×${subItem.quantity}` : ''}</span>
																					<span class="inv-badges">
																						{#if 'rarity' in subItem && subItem.rarity && subItem.rarity !== 'common'}<span class="rarity-badge rarity-{subItem.rarity}">{subItem.rarity}</span>{/if}
																						<span class="wu-su-chip">{(subItem.weight * subItem.quantity).toFixed(1)} WU</span>
																					</span>
																				</div>
																				{#if 'description' in subItem && subItem.description && !isAutoDesc(subItem.description as string)}<p class="inv-desc">{subItem.description}</p>{/if}
																			</div>
																		</div>
																	{/each}
																{/if}
															</div>
														{/if}
													</div>
												{:else}
													<div
														class="inv-item inv-item-sub"
														draggable="true"
														ondragstart={(e) => handleDragStart(e, item.id, container.id)}
														ondragend={handleDragEnd}
														oncontextmenu={(e) => handleItemContextMenu(e, item.id, container.id)}
														class:dragging={dragState?.itemId === item.id}
														role="listitem"
													>
														<span class="drag-handle" aria-hidden="true">⠿</span>
														<div class="inv-item-body">
															<div class="inv-item-header">
																<span class="inv-name">{cleanItemName(item.name)}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
																<span class="inv-badges">
																	{#if item.isStartingEquipment}<span class="se-badge" title="Starting Equipment">SE</span>{/if}
																	{#if item.rarity && item.rarity !== 'common'}<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>{/if}
																	<span class="wu-su-chip">{(item.weight * item.quantity).toFixed(1)} WU</span>
																	{#if item.category === 'weapon' || item.category === 'armor'}
																		<button class="equip-btn" onclick={(ev) => { ev.stopPropagation(); quickEquip(item.id, container.id); }}>Equip</button>
																	{/if}
																</span>
															</div>
															{#if item.description && !isAutoDesc(item.description)}<p class="inv-desc">{item.description}</p>{/if}
														</div>
													</div>
												{/if}
											{/each}
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					{/if}

					<!-- ── Zone 3: LOOSE INVENTORY ── -->
					{@const containerContentIds = new Set(containerItems.flatMap(c => c.contents.map(i => i.id)))}
					{@const equippedIds = new Set(equippedItems.map(i => i.id))}
					{@const looseItems = pc.inventory.filter(i =>
						i.category !== 'container' &&
						!equippedIds.has(i.id) &&
						!containerContentIds.has(i.id) &&
						!('equipped' in i && (i as WeaponItem | ArmorItem).equipped === true)
					)}
					<div
						class="inv-zone loose-zone"
						class:drop-target={dropTargetId === 'loose'}
						class:invalid-drop-target={invalidTargetId === 'loose'}
						ondragover={(e) => handleDragOver(e, 'loose')}
						ondragleave={handleDragLeave}
						ondrop={(e) => handleDrop(e, 'loose')}
						role="region"
						aria-label="Loose items"
					>
						<button class="zone-header zone-toggle" onclick={() => toggleSection('loose')}>
							<span class="zone-title">Loose Inventory</span>
							<span class="zone-note muted-sm">{looseItems.length} item{looseItems.length !== 1 ? 's' : ''}</span>
							<span class="inv-section-caret">{collapsedSections.has('loose') ? '▼' : '▲'}</span>
						</button>
						{#if !collapsedSections.has('loose')}
							{#if looseItems.length === 0}
								<p class="muted-sm zone-empty">No loose items. Drag items here to unpack.</p>
							{:else}
								{#each looseItems as item}
									<div
										class="inv-item"
										draggable="true"
										ondragstart={(e) => handleDragStart(e, item.id, 'loose')}
										ondragend={handleDragEnd}
										oncontextmenu={(e) => handleItemContextMenu(e, item.id, 'loose')}
										class:dragging={dragState?.itemId === item.id}
										role="listitem"
									>
										<span class="drag-handle" aria-hidden="true">⠿</span>
										<div class="inv-item-body">
											<div class="inv-item-header">
												<span class="inv-name">{cleanItemName(item.name)}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
												<span class="inv-badges">
													{#if item.isStartingEquipment}<span class="se-badge" title="Starting Equipment">SE</span>{/if}
													{#if item.rarity && item.rarity !== 'common'}<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>{/if}
													<span class="wu-su-chip">{(item.weight * item.quantity).toFixed(1)} WU</span>
													{#if item.category === 'weapon' || item.category === 'armor'}
														<button class="equip-btn" onclick={(ev) => { ev.stopPropagation(); quickEquip(item.id, 'loose'); }}>Equip</button>
													{/if}
												</span>
											</div>
											{#if 'damage' in item && item.damage}<span class="inv-meta">{item.damage}</span>{/if}
											{#if 'baseAC' in item && item.baseAC}<span class="inv-meta">AC {item.baseAC}</span>{/if}
											{#if 'charges' in item && item.charges !== undefined}<span class="inv-meta">{item.charges} charge{item.charges !== 1 ? 's' : ''}</span>{/if}
											{#if item.description && !isAutoDesc(item.description)}<p class="inv-desc">{item.description}</p>{/if}
										</div>
									</div>
								{/each}
							{/if}
						{/if}
					</div>

					{#if pc.inventory.length === 0}
						<p class="muted-sm" style="padding: 0.5rem 0">No items yet.</p>
					{/if}
				{/if}
			</div>

		<!-- ─── WORLD ─── -->
		{:else if activeTab === 'world'}
			<div class="world-tab">
				<!-- Clock -->
				{#if clock}
					<div class="world-clock">
						<span class="clock-icon">🕐</span>
						<span>Day {clock.day} · <strong>{clock.timeOfDay}</strong> · {clock.weather}</span>
					</div>
				{/if}

				<!-- Current location -->
				{#if currentLocation}
					<div class="world-section">
						<div class="world-section-label">📍 Location</div>
						<strong class="world-loc-name">{currentLocation.name}</strong>
						<span class="world-loc-type muted-sm">{fmt(currentLocation.type)}</span>
						<p class="world-loc-desc">{currentLocation.description}</p>
						{#if currentLocation.features.length > 0}
							<div class="pill-row">
								{#each currentLocation.features as feat}
									<span class="info-pill sm">{feat}</span>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- NPCs at this location -->
				{#if localNpcs.length > 0}
					<div class="world-section">
						<div class="world-section-label">🧑‍🤝‍🧑 Present</div>
						<div class="npc-list">
							{#each localNpcs as npc}
								<div class="npc-row" class:dead={!npc.alive}>
									<span class="npc-name">{npc.name}</span>
									<span class="npc-role muted-sm">{fmt(npc.role)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- World info -->
				{#if worldSnapshot}
					<div class="world-section">
						<div class="world-section-label">🌍 World</div>
						<strong class="world-title">{worldSnapshot.title}</strong>
						{#if worldSnapshot.year}<span class="muted-sm">Year {worldSnapshot.year}</span>{/if}
						{#if worldSnapshot.teaser}
							<blockquote class="world-teaser">{worldSnapshot.teaser}</blockquote>
						{/if}
						{#if worldSnapshot.stats.length > 0}
							<div class="world-stats-grid">
								{#each worldSnapshot.stats.slice(0, 6) as [label, value]}
									<div class="world-stat">
										<span class="world-stat-label">{label}</span>
										<span class="world-stat-value">{value}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				{#if !currentLocation && !worldSnapshot && !clock}
					<div class="empty-state">
						<p class="empty-title">World not yet loaded</p>
						<p class="empty-sub">World data appears once the adventure begins.</p>
					</div>
				{/if}
			</div>
		{/if}

	{#if contextMenu && currentCharacter}
		{@const pc = currentCharacter}
		{@const allItems = getAllInventoryItems(pc)}
		{@const ctxItem = allItems.find(i => i.id === contextMenu!.itemId)}
		<div
			class="ctx-menu"
			style="left:{contextMenu.x}px; top:{contextMenu.y}px"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="menu"
			tabindex="-1"
		>
			<div class="ctx-menu-title">Move to:</div>
			{#if contextMenu.fromSource !== 'equipped' && (ctxItem?.category === 'weapon' || ctxItem?.category === 'armor')}
				<button class="ctx-menu-item" onclick={() => moveViaContextMenu('equipped')}>⚔️ Equipped</button>
			{/if}
			{#if contextMenu.fromSource !== 'loose'}
				<button class="ctx-menu-item" onclick={() => moveViaContextMenu('loose')}>🎽 Loose</button>
			{/if}
			{#each orderedContainers as cont}
				{@const canAdd = ctxItem ? canAddToContainer(cont, ctxItem).ok : true}
				{#if contextMenu.fromSource !== cont.id}
					<button
						class="ctx-menu-item"
						class:ctx-menu-disabled={!canAdd}
						onclick={() => { if (canAdd) moveViaContextMenu(cont.id); }}
						disabled={!canAdd}
					>
						📦 {cleanItemName(cont.name)}
						{#if !canAdd}<span class="ctx-full">(full)</span>{/if}
					</button>
				{/if}
			{/each}
			<button class="ctx-menu-item ctx-cancel" onclick={closeContextMenu}>✕ Cancel</button>
		</div>
	{/if}
	</div>
</div>

<style>
	/* ── Shell ── */
	.journal-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--surface, rgba(255,255,255,0.03));
		border: 1px solid var(--border, rgba(255,255,255,0.09));
		border-radius: 18px;
		overflow: hidden;
	}

	/* ── Tab bar ── */
	.tab-bar {
		display: flex;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		background: rgba(0,0,0,0.2);
		flex-shrink: 0;
	}

	.tab-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding: 0.6rem 0.25rem;
		border: none;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.7rem;
		font-family: inherit;
		transition: color 0.15s, background 0.15s;
		border-bottom: 2px solid transparent;
	}

	.tab-btn:hover {
		color: var(--text);
		background: rgba(255,255,255,0.04);
	}

	.tab-btn.active {
		color: var(--accent, #7c9cff);
		border-bottom-color: var(--accent, #7c9cff);
		background: rgba(124,156,255,0.06);
	}

	.tab-btn { position: relative; }
	.tab-badge {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #f87171;
		border: 1px solid rgba(0,0,0,0.4);
		animation: badge-pulse 1.5s ease-in-out infinite;
	}
	@keyframes badge-pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.7; transform: scale(1.15); }
	}

	.tab-icon { font-size: 1rem; }
	.tab-label { font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; font-size: 0.63rem; }

	/* ── Content area ── */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1rem 2.5rem;
		scrollbar-width: thin;
	}

	/* ── Shared building blocks ── */
	.muted-sm { font-size: 0.78rem; color: var(--text-muted); }
	.you-tag { font-size: 0.72rem; color: var(--text-muted); margin-left: 0.25rem; }
	.mt-xs { margin-top: 0.4rem; }

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 2.5rem 1rem;
		gap: 0.5rem;
	}
	.empty-title { font-weight: 700; font-size: 1rem; margin: 0; }
	.empty-sub { color: var(--text-muted); font-size: 0.85rem; margin: 0; }

	.create-char-btn { margin-top: 0.75rem; padding: 0.55rem 1.4rem; }

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.9rem;
	}
	.section-title {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		font-weight: 700;
	}

	.pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.info-pill {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: rgba(124,156,255,0.1);
		border: 1px solid rgba(124,156,255,0.2);
		color: var(--accent, #7c9cff);
	}
	.info-pill.sm { font-size: 0.68rem; padding: 0.1rem 0.4rem; }

	.condition-pill {
		font-size: 0.72rem;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid;
	}
	.condition-pill.sm { font-size: 0.66rem; }

	/* ── Status tab ── */
	.status-tab { display: flex; flex-direction: column; gap: 0; }

	.char-identity {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-bottom: 0.9rem;
	}
	.char-name-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.char-name { font-size: 1.15rem; font-weight: 700; }
	.char-level-badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: rgba(124,156,255,0.15);
		color: var(--accent, #7c9cff);
		letter-spacing: 0.04em;
	}
	.char-meta { font-size: 0.82rem; }
	.char-meta-class { font-size: 0.9rem; font-weight: 500; }

	/* HP */
	.hp-section { margin-bottom: 0.85rem; }
	.hp-label-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.3rem; }
	.hp-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); font-weight: 700; }
	.hp-numbers { font-size: 1rem; }
	.hp-sep { color: var(--text-muted); font-size: 0.85rem; }
	.temp-hp { margin-left: 0.5rem; font-size: 0.75rem; color: #7bc4f5; }
	.hp-bar-track {
		height: 8px;
		background: rgba(255,255,255,0.07);
		border-radius: 999px;
		overflow: hidden;
	}
	.hp-bar-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s ease, background 0.4s ease;
	}

	/* Core row */
	.core-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
		flex-wrap: wrap;
	}
	.core-stat {
		flex: 1;
		min-width: 52px;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem 0.25rem;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 12px;
		gap: 0.1rem;
	}
	.core-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); text-align: center; white-space: normal; line-height: 1.2; }
	.core-value { font-size: 1.1rem; font-weight: 700; }
	.core-value small { font-size: 0.62rem; color: var(--text-muted); margin-left: 1px; }

	.core-stat { position: relative; }
	.stat-info-btn {
		position: absolute;
		bottom: 0.2rem; right: 0.25rem;
		width: 0.9rem; height: 0.9rem;
		border-radius: 50%;
		border: 1px solid rgba(60,100,220,0.4);
		background: rgba(40,70,180,0.25);
		color: #7b9ef0;
		font-size: 0.52rem;
		font-weight: 700;
		cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		line-height: 1;
		padding: 0;
		opacity: 0.55;
		transition: opacity 0.15s, background 0.15s;
	}
	.stat-info-btn:hover, .stat-info-open .stat-info-btn { opacity: 1; background: rgba(40,70,180,0.5); }

	.stat-popover-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(0,0,0,0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.stat-popover {
		background: var(--surface, #1a1d2e);
		border: 1px solid rgba(124,156,255,0.25);
		border-radius: 14px;
		max-width: 380px;
		width: 100%;
		max-height: 80vh;
		overflow-y: auto;
		box-shadow: 0 8px 40px rgba(0,0,0,0.6);
	}
	.stat-popover-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.8rem 1rem 0.6rem;
		border-bottom: 1px solid rgba(255,255,255,0.07);
		position: sticky; top: 0;
		background: var(--surface, #1a1d2e);
		border-radius: 14px 14px 0 0;
	}
	.stat-popover-title { font-size: 0.95rem; font-weight: 700; color: var(--accent, #7c9cff); }
	.stat-popover-close {
		background: none; border: none; cursor: pointer;
		color: var(--text-muted); font-size: 0.85rem;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
		transition: color 0.15s;
	}
	.stat-popover-close:hover { color: var(--text); }
	.stat-popover-body {
		padding: 0.75rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.stat-popover-section { display: flex; flex-direction: column; gap: 0.2rem; }
	.stat-popover-label {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-weight: 700;
		color: var(--accent, #7c9cff);
		opacity: 0.8;
	}
	.stat-popover-section p {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
		line-height: 1.55;
	}

	/* Ability grid 3×2 */
	.ability-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.45rem;
		margin-bottom: 0.15rem;
	}
	.ability-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.55rem 0.25rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.07);
		border-top: 2px solid var(--ab-color, rgba(255,255,255,0.2));
		border-radius: 10px;
		gap: 0.05rem;
		position: relative;
	}
	.ab-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
	.ab-score { font-size: 1.25rem; font-weight: 700; line-height: 1.1; }
	.ab-mod { font-size: 0.75rem; color: var(--ab-color); font-weight: 600; }

	/* Saves */
	.saves-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }
	.save-chip {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.1);
		color: var(--text-muted);
	}
	.save-chip.proficient {
		background: rgba(124,156,255,0.12);
		border-color: rgba(124,156,255,0.3);
		color: var(--accent, #7c9cff);
		font-weight: 700;
	}

	/* Skills */
	.skill-list { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.skill-chip {
		font-size: 0.72rem;
		padding: 0.12rem 0.42rem;
		border-radius: 999px;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.09);
		color: var(--text-muted);
		cursor: help;
	}
	.skill-chip.expertise {
		background: rgba(245,200,66,0.1);
		border-color: rgba(245,200,66,0.3);
		color: #f5c842;
	}
	.feat-chip {
		background: rgba(200,160,255,0.07);
		border-color: rgba(200,160,255,0.25);
		color: #c8a0ff;
	}

	/* Spell slots */
	.spell-slots { display: flex; flex-direction: column; gap: 0.35rem; }
	.slot-row { display: flex; align-items: center; gap: 0.5rem; }
	.slot-level { font-size: 0.7rem; color: var(--text-muted); min-width: 1.5rem; }
	.slot-dots { display: flex; gap: 0.3rem; flex: 1; }
	.slot-dot {
		width: 10px; height: 10px;
		border-radius: 50%;
		border: 1px solid rgba(124,156,255,0.35);
		background: transparent;
	}
	.slot-dot.filled { background: var(--accent, #7c9cff); border-color: var(--accent, #7c9cff); }
	.slot-dot.pact { border-color: rgba(195,160,245,0.4); }
	.slot-dot.pact.filled { background: #c3a0f5; border-color: #c3a0f5; }
	.slot-count { font-size: 0.7rem; color: var(--text-muted); min-width: 2rem; text-align: right; }

	.concentration-banner {
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: rgba(124,156,255,0.08);
		border: 1px solid rgba(124,156,255,0.2);
		border-radius: 10px;
		font-size: 0.82rem;
	}

	.tab-link-btn {
		margin-top: 0.9rem;
		background: none;
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 10px;
		padding: 0.55rem 0.85rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s, color 0.15s;
		width: 100%;
	}
	.tab-link-btn:hover { background: rgba(255,255,255,0.05); color: var(--text); }

	/* ── Party tab ── */
	.party-tab { display: flex; flex-direction: column; gap: 0.85rem; }
	.party-card {
		padding: 0.85rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.party-card-header { display: flex; align-items: flex-start; gap: 0.6rem; }
	.party-avatar {
		width: 36px; height: 36px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}
	.party-avatar-placeholder {
		display: flex; align-items: center; justify-content: center;
		background: rgba(124,156,255,0.2);
		color: var(--accent, #7c9cff);
		font-weight: 700;
		font-size: 0.9rem;
	}
	.party-identity { flex: 1; display: flex; flex-direction: column; gap: 0.1rem; }
	.party-username { font-weight: 600; font-size: 0.9rem; }
	.party-char-line { font-size: 0.78rem; color: var(--text-muted); }
	.party-ac-badge {
		display: flex; flex-direction: column; align-items: center;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 8px;
		padding: 0.3rem 0.5rem;
		font-weight: 700;
		font-size: 1rem;
		flex-shrink: 0;
	}
	.party-ac-badge small { font-size: 0.55rem; color: var(--text-muted); text-transform: uppercase; }
	.party-hp-section { display: flex; align-items: center; gap: 0.6rem; }
	.party-hp-section .hp-bar-track { flex: 1; height: 6px; }
	.party-hp-text { font-size: 0.75rem; font-weight: 600; flex-shrink: 0; }
	.mini-abilities {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.25rem;
	}
	.mini-ab {
		display: flex; flex-direction: column; align-items: center;
		padding: 0.25rem 0.1rem;
		background: rgba(255,255,255,0.03);
		border-radius: 6px;
	}
	.mini-ab-label { font-size: 0.55rem; color: var(--text-muted); text-transform: uppercase; }
	.mini-ab-mod { font-size: 0.72rem; font-weight: 600; }

	.companion-section-label {
		font-size: 0.63rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent-2, #34d3a2);
		margin: 0.75rem 0 0.4rem;
	}
	.companion-card { border-color: rgba(52, 211, 162, 0.15); }
	.companion-av {
		background: rgba(52, 211, 162, 0.15);
		color: var(--accent-2, #34d3a2);
	}
	.companion-role-line { text-transform: capitalize; color: var(--accent-2, #34d3a2); }

	/* ── Quests tab ── */
	.quests-tab { display: flex; flex-direction: column; gap: 0.65rem; }
	.quest-section-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		font-weight: 700;
		padding: 0.25rem 0;
	}
	.completed-label { margin-top: 0.5rem; }
	.quest-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 12px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.quest-card.completed { opacity: 0.6; }
	.quest-card.expanded { border-color: rgba(124,156,255,0.22); }
	.quest-toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 0.85rem;
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		color: inherit;
		transition: background 0.12s;
	}
	.quest-toggle:hover { background: rgba(255,255,255,0.04); }
	.quest-header-right { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
	.quest-caret { font-size: 0.6rem; color: var(--text-muted); }
	.quest-name { font-weight: 600; font-size: 0.9rem; }
	.quest-body {
		padding: 0.55rem 0.85rem 0.85rem;
		border-top: 1px solid rgba(255,255,255,0.06);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.quest-meta { font-size: 0.78rem; color: var(--text-muted); }
	.quest-deadline { font-size: 0.75rem; color: #f5c842; }
	.quest-rewards { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
	.quest-rewards-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 700; margin-right: 0.1rem; }
	.reward-chip {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: rgba(245,200,66,0.1);
		border: 1px solid rgba(245,200,66,0.2);
		color: #f5c842;
	}
	.quest-status-badge {
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		text-transform: uppercase;
		font-weight: 700;
		flex-shrink: 0;
	}
	.status-active { background: rgba(74,222,128,0.15); color: #4ade80; }
	.status-available { background: rgba(124,156,255,0.15); color: var(--accent, #7c9cff); }
	.status-completed { background: rgba(148,163,184,0.15); color: #94a3b8; }
	.quest-desc { font-size: 0.8rem; color: var(--text-muted); margin: 0; line-height: 1.5; }
	.objectives-list { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.15rem; }
	.objective-row {
		display: flex; align-items: flex-start; gap: 0.5rem;
		font-size: 0.8rem; color: var(--text-muted);
	}
	.objective-row.done { color: var(--text); opacity: 0.6; text-decoration: line-through; }
	.obj-icon { flex-shrink: 0; color: #4ade80; }
	.objective-row:not(.done) .obj-icon { color: var(--text-muted); }

	/* ── Inventory tab ── */
	.inventory-tab { display: flex; flex-direction: column; gap: 0.55rem; }

	/* Currency boxes */
	.currency-row {
		display: flex; gap: 0.5rem; margin-bottom: 0.15rem;
	}
	.currency-box {
		flex: 1; display: flex; align-items: center; gap: 0.35rem;
		padding: 0.5rem 0.7rem;
		border-radius: 10px;
		font-size: 0.88rem;
		border: 1px solid transparent;
	}
	.currency-box.gold { background: rgba(245,200,66,0.10); border-color: rgba(245,200,66,0.25); }
	.currency-box.silver { background: rgba(200,200,210,0.09); border-color: rgba(200,200,210,0.20); }
	.currency-box.copper { background: rgba(205,127,50,0.10); border-color: rgba(205,127,50,0.25); }
	.currency-icon { font-size: 1rem; line-height: 1; }
	.currency-val { font-weight: 700; font-size: 0.95rem; }
	.currency-denom { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }

	/* Encumbrance bar */
	.enc-section {
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 10px;
		padding: 0.6rem 0.75rem;
		display: flex; flex-direction: column; gap: 0.4rem;
		position: relative;
	}
	.enc-header { display: flex; justify-content: space-between; align-items: center; }
	.enc-label { font-size: 0.82rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
	.enc-capacity { color: var(--text-muted); font-size: 0.78rem; }
	.enc-status { font-size: 0.68rem; padding: 0.08rem 0.4rem; border-radius: 999px; font-weight: 700; }
	.enc-status.enc { background: rgba(250,204,21,0.15); color: #facc15; border: 1px solid rgba(250,204,21,0.3); }
	.enc-status.heavy { background: rgba(251,146,60,0.15); color: #fb923c; border: 1px solid rgba(251,146,60,0.3); }
	.enc-status.over { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
	.enc-bar-wrap {
		height: 8px; border-radius: 999px; overflow: hidden;
		display: flex; background: rgba(255,255,255,0.06);
		position: relative;
	}
	.enc-zone { height: 100%; opacity: 0.08; }
	.enc-zone-green { background: #4ade80; }
	.enc-zone-yellow { background: #facc15; }
	.enc-zone-orange { background: #fb923c; }
	.enc-bar-fill {
		position: absolute; top: 0; left: 0; height: 100%;
		border-radius: 999px;
		transition: width 0.35s ease, background-color 0.3s ease;
	}
	.enc-fill-green { background: #4ade80; }
	.enc-fill-yellow { background: #facc15; }
	.enc-fill-orange { background: #fb923c; }
	.enc-fill-red { background: #ef4444; }
	.enc-footer { display: flex; align-items: center; }
	.wu-su-btn {
		background: none; border: none; cursor: pointer;
		font-size: 0.7rem; color: var(--text-muted);
		text-decoration: underline; padding: 0;
	}
	.wu-su-btn:hover { color: var(--text-primary); }

	/* Info buttons and popovers */
	.info-btn {
		width: 18px; height: 18px; border-radius: 50%;
		background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
		color: var(--text-muted); font-size: 0.65rem; font-weight: 700;
		cursor: pointer; display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
	}
	.info-btn:hover { background: rgba(255,255,255,0.14); color: var(--text-primary); }
	.info-popover {
		position: absolute; z-index: 20;
		right: 0.5rem; top: calc(100% + 4px);
		width: min(280px, calc(100vw - 2rem));
		background: var(--surface-elevated, rgba(20,20,30,0.97));
		border: 1px solid rgba(255,255,255,0.13);
		border-radius: 12px; padding: 0.85rem 1rem;
		font-size: 0.8rem; line-height: 1.5;
		box-shadow: 0 8px 30px rgba(0,0,0,0.4);
	}
	.info-popover strong { display: block; margin-bottom: 0.4rem; font-size: 0.85rem; }
	.info-popover ul { padding-left: 0.9rem; margin: 0.3rem 0; }
	.info-popover li { margin-bottom: 0.2rem; }
	.info-popover p { margin: 0.3rem 0; }
	.popover-note { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.4rem !important; }
	.popover-close {
		position: absolute; top: 0.4rem; right: 0.5rem;
		background: none; border: none; cursor: pointer;
		color: var(--text-muted); font-size: 0.75rem; padding: 0.1rem 0.25rem;
	}
	.enc-dot { font-size: 0.6rem; margin-right: 0.25rem; }
	.enc-dot.normal { color: #4ade80; }
	.enc-dot.yellow { color: #facc15; }
	.enc-dot.orange { color: #fb923c; }
	.enc-dot.red { color: #ef4444; }

	/* Zones */
	.inv-zone {
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 12px;
		padding: 0.5rem 0.65rem;
		display: flex; flex-direction: column; gap: 0.3rem;
		transition: border-color 0.15s;
	}
	.zone-header {
		display: flex; align-items: center; gap: 0.5rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		margin-bottom: 0.15rem;
	}
	.zone-toggle {
		width: 100%; background: none; border: none; cursor: pointer;
		color: inherit; text-align: left; padding: 0;
	}
	.zone-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }
	.zone-note { font-size: 0.68rem; margin-left: auto; }
	.zone-empty { font-size: 0.78rem; padding: 0.4rem 0; }
	.zone-label {
		font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.07em; color: var(--text-muted);
		padding: 0.25rem 0 0;
	}
	.equipped-zone { background: rgba(99,179,237,0.03); }
	.loose-zone { background: rgba(255,255,255,0.01); }

	/* Drop target highlights */
	.drop-target { border-color: rgba(99,179,237,0.5) !important; background: rgba(99,179,237,0.06) !important; }
	.invalid-drop-target {
		border-color: rgba(239,68,68,0.6) !important;
		background: rgba(239,68,68,0.06) !important;
		animation: shake 0.35s ease;
	}
	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-5px); }
		40% { transform: translateX(5px); }
		60% { transform: translateX(-4px); }
		80% { transform: translateX(4px); }
	}

	/* Drag handle */
	.drag-handle {
		cursor: grab; color: var(--text-muted); font-size: 0.9rem;
		flex-shrink: 0; padding: 0 0.2rem;
		user-select: none;
	}
	.drag-handle:active { cursor: grabbing; }
	.dragging { opacity: 0.35; }

	/* Individual inventory items */
	.inv-section-caret { font-size: 0.6rem; color: var(--text-muted); flex-shrink: 0; }
	.inv-item {
		padding: 0.45rem 0.55rem;
		background: rgba(255,255,255,0.025);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 10px;
		display: flex; align-items: flex-start; gap: 0.35rem;
		cursor: grab;
	}
	.inv-item:active { cursor: grabbing; }
	.inv-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.18rem; }
	.inv-item-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.inv-name { font-size: 0.88rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.inv-meta { font-size: 0.75rem; color: var(--text-muted); }
	.inv-desc { font-size: 0.75rem; color: var(--text-muted); margin: 0; line-height: 1.4; }
	.inv-badges { display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0; }
	.se-badge {
		font-size: 0.58rem; padding: 0.06rem 0.3rem;
		border-radius: 4px; font-weight: 700; text-transform: uppercase;
		background: rgba(245,200,66,0.15); border: 1px solid rgba(245,200,66,0.3); color: #f5c842;
		cursor: help; flex-shrink: 0;
	}
	.rarity-badge {
		font-size: 0.62rem;
		padding: 0.08rem 0.38rem;
		border-radius: 999px;
		font-weight: 700;
		text-transform: uppercase;
		flex-shrink: 0;
	}
	.rarity-uncommon  { background: rgba(74,222,128,0.12); color: #4ade80; }
	.rarity-rare      { background: rgba(99,179,237,0.15); color: #63b3ed; }
	.rarity-very-rare { background: rgba(195,160,245,0.15); color: #c3a0f5; }
	.rarity-legendary { background: rgba(245,200,66,0.15); color: #f5c842; }

	/* WU/SU chip */
	.wu-su-chip {
		font-size: 0.6rem; padding: 0.05rem 0.3rem;
		border-radius: 4px; font-weight: 600;
		background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
		color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
	}

	.equip-btn {
		font-size: 0.6rem; padding: 0.05rem 0.35rem;
		border-radius: 4px; font-weight: 600;
		background: transparent; border: 1px solid var(--accent, #7c6ff7);
		color: var(--accent, #7c6ff7); cursor: pointer; white-space: nowrap; flex-shrink: 0;
		line-height: 1.4;
	}
	.equip-btn:hover { background: var(--accent, #7c6ff7); color: #fff; }
	.unequip-btn { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.5); }
	.unequip-btn:hover { background: rgba(255,255,255,0.15); color: #fff; border-color: rgba(255,255,255,0.5); }

	/* Container panels */
	.container-panel {
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 12px;
		background: rgba(255,255,255,0.015);
		overflow: hidden;
		position: relative;
		transition: border-color 0.15s;
	}
	.container-header {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.45rem 0.65rem;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.container-header-actions {
		display: flex; align-items: center; gap: 0.15rem; flex-shrink: 0;
	}
	.reorder-btn {
		background: none; border: none; cursor: pointer; color: var(--text-muted);
		font-size: 0.6rem; padding: 0.1rem 0.25rem; border-radius: 3px;
		line-height: 1; transition: color 0.15s, background 0.15s;
	}
	.reorder-btn:hover:not(:disabled) { color: var(--text-base); background: rgba(255,255,255,0.08); }
	.reorder-btn:disabled { opacity: 0.25; cursor: default; }
	.container-toggle {
		display: flex; align-items: center; gap: 0.4rem;
		flex: 1; background: none; border: none; cursor: pointer;
		color: inherit; text-align: left; padding: 0;
		min-width: 0;
	}
	.container-icon { font-size: 0.9rem; flex-shrink: 0; }
	.container-name { font-size: 0.85rem; font-weight: 600; }
	.container-load-text { font-size: 0.68rem; margin-left: auto; white-space: nowrap; flex-shrink: 0; }

	/* Container mini load bars */
	.container-load-bars {
		display: flex; flex-direction: column; gap: 3px;
		padding: 0.35rem 0.65rem;
		border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.load-bar-row { display: flex; align-items: center; gap: 0.4rem; }
	.load-bar-label { font-size: 0.6rem; font-weight: 700; color: var(--text-muted); width: 1.4rem; flex-shrink: 0; }
	.load-bar-track {
		flex: 1; height: 5px; border-radius: 999px;
		background: rgba(255,255,255,0.06); overflow: hidden;
	}
	.load-bar-fill {
		height: 100%; border-radius: 999px;
		background: #4ade80;
		transition: width 0.3s ease, background-color 0.3s ease;
	}
	.load-bar-fill.load-warn { background: #facc15; }
	.load-bar-fill.load-full { background: #ef4444; }
	.load-bar-pct { font-size: 0.6rem; color: var(--text-muted); width: 2.3rem; flex-shrink: 0; text-align: right; }

	/* Container popover */
	.container-popover { top: auto; bottom: calc(100% + 4px); }
	.container-body {
		display: flex; flex-direction: column; gap: 0.3rem;
		padding: 0.45rem 0.65rem;
	}
	.inv-item-sub {
		padding: 0.35rem 0.5rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.05);
		border-radius: 8px;
		display: flex; align-items: flex-start; gap: 0.3rem;
		cursor: grab;
	}

	/* Nested (sub) container inside a container */
	.sub-container-panel {
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 8px;
		background: rgba(255,255,255,0.025);
		overflow: hidden;
		margin: 0.1rem 0;
	}
	.sub-container-panel.drop-target { border-color: rgba(100,200,255,0.5); background: rgba(100,200,255,0.06); }
	.sub-container-panel.invalid-drop-target { border-color: rgba(255,80,80,0.5); }
	.sub-container-header { display: flex; align-items: center; }
	.sub-container-toggle {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; padding: 0.35rem 0.6rem;
		background: none; border: none; color: inherit; cursor: pointer; text-align: left;
		font-size: 0.78rem;
	}
	.sub-container-toggle:hover { background: rgba(255,255,255,0.04); }
	.sub-container-body {
		display: flex; flex-direction: column; gap: 0.25rem;
		padding: 0.3rem 0.6rem;
	}
	.inv-item-nested {
		padding: 0.3rem 0.5rem;
		background: rgba(255,255,255,0.015);
		border: 1px solid rgba(255,255,255,0.04);
		border-radius: 6px;
		display: flex; align-items: flex-start; gap: 0.3rem;
		cursor: grab;
	}

	/* inv-section-header kept for any existing non-inventory usage */
	.inv-section-header {
		display: flex; justify-content: space-between; align-items: center;
		width: 100%;
		background: none; border: none; cursor: pointer;
		padding: 0.5rem 0 0.15rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		margin-top: 0.3rem;
		color: inherit;
	}
	.inv-section-label-text {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		font-weight: 700;
	}
	.weapon-group { padding: 0.4rem 0.7rem; gap: 0; overflow: hidden; }
	.weapon-group-header {
		display: flex; justify-content: space-between; align-items: center;
		width: 100%; background: none; border: none; cursor: pointer;
		padding: 0.1rem 0; color: inherit;
	}
	.weapon-group-caret { font-size: 0.6rem; color: var(--text-muted); flex-shrink: 0; }
	.weapon-group-items { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.4rem; }

	/* ── World tab ── */
	.world-tab { display: flex; flex-direction: column; gap: 0.8rem; }
	.world-clock {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.55rem 0.8rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px;
		font-size: 0.85rem;
	}
	.clock-icon { font-size: 1rem; }
	.world-section { display: flex; flex-direction: column; gap: 0.35rem; }
	.world-section-label {
		font-size: 0.67rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		font-weight: 700;
	}
	.world-loc-name { font-size: 1rem; font-weight: 700; }
	.world-loc-type { display: block; margin-top: -0.1rem; }
	.world-loc-desc { font-size: 0.82rem; color: var(--text-muted); margin: 0.15rem 0 0; line-height: 1.5; }
	.world-title { font-size: 1rem; font-weight: 700; }
	.world-teaser {
		font-size: 0.8rem;
		font-style: italic;
		color: var(--text-muted);
		margin: 0.25rem 0 0;
		padding-left: 0.75rem;
		border-left: 2px solid rgba(255,255,255,0.12);
		line-height: 1.5;
	}
	.world-stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.4rem;
		margin-top: 0.35rem;
	}
	.world-stat {
		padding: 0.45rem 0.6rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
	}
	.world-stat-label { font-size: 0.62rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
	.world-stat-value { font-size: 0.82rem; font-weight: 600; }
	.npc-list { display: flex; flex-direction: column; gap: 0.35rem; }
	.npc-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.35rem 0.6rem;
		background: rgba(255,255,255,0.02);
		border-radius: 8px;
		font-size: 0.82rem;
	}
	.npc-row.dead .npc-name { text-decoration: line-through; opacity: 0.5; }
	.npc-name { font-weight: 600; }

	/* Language chips */
	.lang-chip {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: rgba(52, 211, 162, 0.08);
		border: 1px solid rgba(52, 211, 162, 0.2);
		color: var(--accent-2, #34d3a2);
		cursor: help;
	}
	.info-pill[title] { cursor: help; }
	/* Context menu */
	.ctx-menu {
		position: fixed;
		background: #1a1d2e;
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 0.5rem;
		padding: 0.25rem;
		min-width: 160px;
		z-index: 9999;
		box-shadow: 0 4px 20px rgba(0,0,0,0.5);
	}
	.ctx-menu-title {
		font-size: 0.68rem;
		color: rgba(255,255,255,0.4);
		padding: 0.2rem 0.5rem 0.3rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.ctx-menu-item {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: rgba(255,255,255,0.85);
		padding: 0.3rem 0.5rem;
		border-radius: 0.3rem;
		cursor: pointer;
		font-size: 0.8rem;
		font-family: inherit;
		white-space: nowrap;
	}
	.ctx-menu-item:hover:not(:disabled) {
		background: rgba(255,255,255,0.1);
	}
	.ctx-menu-item:disabled, .ctx-menu-disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.ctx-full {
		font-size: 0.68rem;
		color: #f87171;
		margin-left: 0.25rem;
	}
	.ctx-cancel {
		border-top: 1px solid rgba(255,255,255,0.1);
		margin-top: 0.15rem;
		color: rgba(255,255,255,0.45);
	}

</style>