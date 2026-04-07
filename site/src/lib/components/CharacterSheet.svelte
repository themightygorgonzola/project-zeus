<script lang="ts">
	import { abilityModifier, getAllCantrips, getAllKnownSpells, getAllPreparedSpells, getTotalHitDiceRemaining } from '$lib/game';
	import type { AbilityName, PlayerCharacter } from '$lib/game';

	interface Props {
		character: PlayerCharacter;
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

	let { character }: Props = $props();

	function format(value?: string) {
		return value ? value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : '—';
	}

	function signed(value: number) {
		return value >= 0 ? `+${value}` : `${value}`;
	}
</script>

<div class="sheet-shell">
	<div class="sheet-header">
		<div>
			<h2>{character.name}</h2>
			<p>{format(character.race)} {format(character.subrace)} · {character.classes.length > 1 ? character.classes.map((cl) => `${format(cl.name)} ${cl.level}`).join(' / ') : format(character.classes[0]?.name ?? 'unknown')} {character.classes[0]?.subclass ? `(${format(character.classes[0].subclass)})` : ''}</p>
			<p class="muted">{character.background ? format(character.background) : 'No background'} · {character.alignment ? format(character.alignment) : 'Unaligned'}</p>
		</div>
		<div class="stats-block">
			<div class="hp-bar">
				<span>HP</span>
				<strong>{character.hp}/{character.maxHp}</strong>
			</div>
			<p class="passive-line">Passive Perception: {character.passivePerception}</p>
			<div class="core-stats">
				<div><span>AC</span><strong>{character.ac}</strong></div>
				<div><span>Proficiency</span><strong>+{character.proficiencyBonus}</strong></div>
				<div><span>Speed</span><strong>{character.speed} ft</strong></div>
				<div><span>Initiative</span><strong>{signed(abilityModifier(character.abilities.dex))}</strong></div>
			</div>
		</div>
	</div>

	<div class="ability-grid">
		{#each abilityOrder as ability}
			<div class="ability-card">
				<span>{abilityLabels[ability]}</span>
				<strong>{character.abilities[ability]}</strong>
				<small>{signed(abilityModifier(character.abilities[ability]))}</small>
			</div>
		{/each}
	</div>

	<div class="meta-grid">
		<section>
			<h3>Combat</h3>
			<ul>
				<li>Hit Dice Remaining: {getTotalHitDiceRemaining(character)}</li>
				<li>Conditions: {character.conditions.length ? character.conditions.map(format).join(', ') : 'None'}</li>
			</ul>
		</section>
		<section>
			<h3>Proficiencies</h3>
			<ul>
				<li>Skills: {character.skillProficiencies.map(format).join(', ') || 'None'}</li>
				<li>Saves: {character.saveProficiencies.map((save) => abilityLabels[save]).join(', ')}</li>
				<li>Armor: {character.armorProficiencies.join(', ') || 'None'}</li>
				<li>Weapons: {character.weaponProficiencies.join(', ') || 'None'}</li>
				<li>Tools: {character.toolProficiencies.join(', ') || 'None'}</li>
				<li>Languages: {character.languages.join(', ') || 'None'}</li>
			</ul>
		</section>
		<section>
			<h3>Spells</h3>
			<ul>
				<li>Cantrips: {getAllCantrips(character).length ? getAllCantrips(character).map(format).join(', ') : 'None'}</li>
				<li>Known: {getAllKnownSpells(character).length ? getAllKnownSpells(character).map(format).join(', ') : 'None'}</li>
				<li>Prepared: {getAllPreparedSpells(character).length ? getAllPreparedSpells(character).map(format).join(', ') : 'None'}</li>
				<li>Slots: {character.spellSlots.length ? character.spellSlots.map((slot) => `L${slot.level} ${slot.current}/${slot.max}`).join(', ') : 'None'}</li>
				{#if character.pactSlots.length}
					<li>Pact Slots: {character.pactSlots.map((slot) => `L${slot.level} ${slot.current}/${slot.max}`).join(', ')}</li>
				{/if}
			</ul>
		</section>
		<section>
			<h3>Features & Gear</h3>
			<ul>
				<li>Feats: {character.feats.length ? character.feats.map(format).join(', ') : 'None'}</li>
				<li>Features: {character.classFeatures.length ? character.classFeatures.map((feature) => feature.name).join(', ') : 'None'}</li>
				<li>Inventory: {character.inventory.length ? character.inventory.map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ') : 'Empty'}</li>
				<li>Gold: {character.gold} gp</li>
			</ul>
		</section>
	</div>

	{#if character.backstory}
		<section class="backstory">
			<h3>Backstory</h3>
			<p>{character.backstory}</p>
		</section>
	{/if}
</div>

<style>
	.sheet-shell {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sheet-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}

	h2,
	h3,
	p,
	ul {
		margin: 0;
	}

	.muted {
		color: var(--text-muted);
	}

	.core-stats,
	.ability-grid,
	.meta-grid {
		display: grid;
		gap: 0.75rem;
	}

	.stats-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 280px;
	}

	.hp-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.hp-bar span { font-size: 0.78rem; color: var(--text-muted); }
	.hp-bar strong { font-size: 1.1rem; }

	.passive-line { font-size: 0.85rem; color: var(--text-muted); }

	.core-stats {
		grid-template-columns: repeat(4, minmax(0, 1fr));
		min-width: 280px;
	}

	.core-stats span { font-size: 0.7rem; }

	.hp-bar,
	.core-stats div,
	.ability-card,
	section {
		padding: 0.85rem;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
	}

	.core-stats span,
	.ability-card span,
	.ability-card small {
		display: block;
	}

	.ability-grid {
		grid-template-columns: repeat(6, minmax(0, 1fr));
	}

	.ability-card {
		text-align: center;
	}

	.ability-card strong {
		font-size: 1.25rem;
	}

	.meta-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	ul {
		padding-left: 1rem;
		color: var(--text-muted);
	}

	.backstory p {
		color: var(--text-muted);
		line-height: 1.6;
	}

	@media (max-width: 768px) {
		.sheet-header,
		.meta-grid {
			grid-template-columns: 1fr;
			display: grid;
		}

		.stats-block {
			min-width: unset;
		}

		.core-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.ability-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
