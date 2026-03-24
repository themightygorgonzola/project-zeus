<script lang="ts">
	import { abilityModifier, getAllCantrips, getAllKnownSpells, getAllPreparedSpells, getTotalHitDiceRemaining } from '$lib/game';
	import { CLASS_HIT_DIE } from '$lib/game/types';
	import type { AbilityName, PlayerCharacter, SpellSlotPool, WeaponItem, ArmorItem } from '$lib/game/types';
	import CharacterCreation from '$lib/components/CharacterCreation.svelte';

	// ── Prop shapes ────────────────────────────────────────────────────────
	interface WSS { title: string; year?: number | null; teaser?: string | null; stats: Array<[string, number | string]>; }
	interface QuestObjective { id: string; text: string; done: boolean; }
	interface Quest { id: string; name: string; description: string; status: string; objectives: QuestObjective[]; }
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

	let activeQuests = $derived(quests.filter(q => q.status === 'active' || q.status === 'available'));
	let completedQuests = $derived(quests.filter(q => q.status === 'completed'));

	function classLine(pc: PlayerCharacter): string {
		if (pc.classes.length === 1) {
			const c = pc.classes[0];
			return `${fmt(c.name)} ${c.level}${c.subclass ? ` (${fmt(c.subclass)})` : ''}`;
		}
		return pc.classes.map(c => `${fmt(c.name)} ${c.level}`).join(' / ');
	}

	function hasNonPactSlots(pc: PlayerCharacter): boolean {
		return pc.spellSlots.some(s => s.max > 0);
	}

	function slotDots(slot: SpellSlotPool) {
		return Array.from({ length: slot.max }, (_, i) => i < slot.current);
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
				onclick={() => activeTab = tab.id}
				aria-selected={activeTab === tab.id}
			>
				<span class="tab-icon">{tab.icon}</span>
				<span class="tab-label">{tab.label}</span>
			</button>
		{/each}
	</div>

	<!-- Tab content -->
	<div class="tab-content">

		<!-- ─── STATUS ─── -->
		{#if activeTab === 'status'}
			{#if !currentCharacter}
				<CharacterCreation {adventureId} {onCreated} />
			{:else}
				{@const pc = currentCharacter}
				<div class="status-tab">
					<!-- Identity -->
					<div class="char-identity">
						<div class="char-name-line">
							<span class="char-name">{pc.name}</span>
							<span class="char-level-badge">Lv {pc.level}</span>
						</div>
						<span class="char-meta">{fmt(pc.race)}{pc.subrace ? ` ${fmt(pc.subrace)}` : ''} · {classLine(pc)}</span>
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
						<div class="core-stat">
							<span class="core-label">AC</span>
							<strong class="core-value">{pc.ac}</strong>
						</div>
						<div class="core-stat">
							<span class="core-label">Speed</span>
							<strong class="core-value">{pc.speed}<small>ft</small></strong>
						</div>
						<div class="core-stat">
							<span class="core-label">Init</span>
							<strong class="core-value">{signed(abilityModifier(pc.abilities.dex))}</strong>
						</div>
						<div class="core-stat">
							<span class="core-label">Prof</span>
							<strong class="core-value">+{pc.proficiencyBonus}</strong>
						</div>
						<div class="core-stat">
							<span class="core-label">Passive Perc</span>
							<strong class="core-value">{pc.passivePerception}</strong>
						</div>
					</div>

					<!-- Ability scores grid (2×3) -->
					<div class="ability-grid">
						{#each abilityOrder as ability}
							<div class="ability-cell" style="--ab-color: {abilityColors[ability]}">
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
								<span class="info-pill">d{CLASS_HIT_DIE[cl.name]} ×{cl.hitDiceRemaining}</span>
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

					<!-- Skills (proficient) -->
					<div class="section-block">
						<span class="section-title">Proficient Skills</span>
						<div class="skill-list">
							{#each pc.skillProficiencies as skill}
								<span class="skill-chip" class:expertise={pc.expertiseSkills?.includes(skill)}>
									{pc.expertiseSkills?.includes(skill) ? '◆' : '•'}
									{fmt(skill)}
								</span>
							{/each}
							{#if pc.skillProficiencies.length === 0}
								<span class="muted-sm">None</span>
							{/if}
						</div>
					</div>

					<!-- Quick inventory link -->
					<button class="tab-link-btn" onclick={() => activeTab = 'inventory'}>
						🎒 View Inventory ({pc.inventory.length} items · {pc.gold} gp)
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
						<div class="quest-card">
							<div class="quest-header">
								<span class="quest-name">{quest.name}</span>
								<span class="quest-status-badge status-{quest.status}">{quest.status}</span>
							</div>
							<p class="quest-desc">{quest.description}</p>
							<div class="objectives-list">
								{#each quest.objectives as obj}
									<div class="objective-row" class:done={obj.done}>
										<span class="obj-icon">{obj.done ? '✓' : '○'}</span>
										<span>{obj.text}</span>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}

				{#if completedQuests.length > 0}
					<div class="quest-section-label completed-label">Completed ({completedQuests.length})</div>
					{#each completedQuests as quest}
						<div class="quest-card completed">
							<div class="quest-header">
								<span class="quest-name">{quest.name}</span>
							</div>
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
					<div class="gold-banner">
						<span>🪙</span>
						<strong>{pc.gold} gold pieces</strong>
					</div>

					{#if pc.inventory.length === 0}
						<p class="muted-sm" style="padding: 0.5rem 0">No items yet.</p>
					{:else}
						<!-- Group by category -->
						{@const weapons = pc.inventory.filter(i => i.category === 'weapon') as WeaponItem[]}
						{@const armor = pc.inventory.filter(i => i.category === 'armor') as ArmorItem[]}
						{@const consumables = pc.inventory.filter(i => i.category === 'consumable')}
						{@const misc = pc.inventory.filter(i => i.category !== 'weapon' && i.category !== 'armor' && i.category !== 'consumable')}

						{#if weapons.length > 0}
							<div class="inv-section-label">Weapons</div>
							{#each weapons as item}
								<div class="inv-item">
									<div class="inv-item-header">
										<span class="inv-name">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
										{#if item.rarity && item.rarity !== 'common'}
											<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>
										{/if}
									</div>
								{#if item.damage}<span class="inv-meta">{item.damage}</span>{/if}
									{#if item.description}<p class="inv-desc">{item.description}</p>{/if}
								</div>
							{/each}
						{/if}

						{#if armor.length > 0}
							<div class="inv-section-label">Armor & Shields</div>
							{#each armor as item}
								<div class="inv-item">
									<div class="inv-item-header">
										<span class="inv-name">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
										{#if item.rarity && item.rarity !== 'common'}
											<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>
										{/if}
									</div>
								{#if item.baseAC}<span class="inv-meta">AC {item.baseAC}</span>{/if}
									{#if item.description}<p class="inv-desc">{item.description}</p>{/if}
								</div>
							{/each}
						{/if}

						{#if consumables.length > 0}
							<div class="inv-section-label">Consumables</div>
							{#each consumables as item}
								<div class="inv-item">
									<div class="inv-item-header">
										<span class="inv-name">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
										{#if item.rarity && item.rarity !== 'common'}
											<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>
										{/if}
									</div>
									{#if item.description}<p class="inv-desc">{item.description}</p>{/if}
								</div>
							{/each}
						{/if}

						{#if misc.length > 0}
							<div class="inv-section-label">Other</div>
							{#each misc as item}
								<div class="inv-item">
									<div class="inv-item-header">
										<span class="inv-name">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
										{#if item.rarity && item.rarity !== 'common'}
											<span class="rarity-badge rarity-{item.rarity}">{item.rarity}</span>
										{/if}
									</div>
									{#if item.description}<p class="inv-desc">{item.description}</p>{/if}
								</div>
							{/each}
						{/if}
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

	.tab-icon { font-size: 1rem; }
	.tab-label { font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; font-size: 0.63rem; }

	/* ── Content area ── */
	.tab-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
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
	.core-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
	.core-value { font-size: 1.1rem; font-weight: 700; }
	.core-value small { font-size: 0.62rem; color: var(--text-muted); margin-left: 1px; }

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
	}
	.skill-chip.expertise {
		background: rgba(245,200,66,0.1);
		border-color: rgba(245,200,66,0.3);
		color: #f5c842;
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
	.party-race-line { }
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
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.quest-card.completed { opacity: 0.5; }
	.quest-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.quest-name { font-weight: 600; font-size: 0.9rem; }
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
	.quest-desc { font-size: 0.8rem; color: var(--text-muted); margin: 0; line-height: 1.5; }
	.objectives-list { display: flex; flex-direction: column; gap: 0.3rem; }
	.objective-row {
		display: flex; align-items: flex-start; gap: 0.5rem;
		font-size: 0.8rem; color: var(--text-muted);
	}
	.objective-row.done { color: var(--text); opacity: 0.6; text-decoration: line-through; }
	.obj-icon { flex-shrink: 0; color: #4ade80; }
	.objective-row:not(.done) .obj-icon { color: var(--text-muted); }

	/* ── Inventory tab ── */
	.inventory-tab { display: flex; flex-direction: column; gap: 0.5rem; }
	.gold-banner {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.6rem 0.85rem;
		background: rgba(245,200,66,0.08);
		border: 1px solid rgba(245,200,66,0.2);
		border-radius: 10px;
		font-size: 0.9rem;
		margin-bottom: 0.35rem;
	}
	.inv-section-label {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		font-weight: 700;
		margin-top: 0.6rem;
		padding-bottom: 0.15rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
	}
	.inv-item {
		padding: 0.6rem 0.7rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.inv-item-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.inv-name { font-size: 0.88rem; font-weight: 600; }
	.inv-meta { font-size: 0.75rem; color: var(--text-muted); }
	.inv-desc { font-size: 0.75rem; color: var(--text-muted); margin: 0; line-height: 1.4; }
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
	.npc-role { }
</style>
