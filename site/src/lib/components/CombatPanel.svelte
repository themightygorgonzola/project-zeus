<script lang="ts">
	import type { ActiveEncounter, Combatant, PlayerCharacter, NPC } from '$lib/game';

	interface Props {
		encounter: ActiveEncounter;
		/** All PC characters — used to resolve death-save data for combatants of type 'character'. */
		characters: PlayerCharacter[];
		/**
		 * NPC list — used to identify companion-role NPCs so they get a distinct colour.
		 * Optional; if omitted all NPC combatants appear as enemies.
		 */
		npcs?: NPC[];
		/**
		 * Live socket-pushed override for awaitingActorId.
		 * When defined, this takes precedence over encounter.awaitingActorId so
		 * the panel stays in sync between server refreshes.
		 */
		localAwaitingId?: string | null;
	}

	let { encounter, characters, npcs = [], localAwaitingId = undefined }: Props = $props();

	// Effective awaiting combatant ID — socket update wins
	let awaitingId = $derived(
		localAwaitingId !== undefined ? localAwaitingId : (encounter.awaitingActorId ?? null)
	);

	// Combatants sorted by initiative order (highest first)
	let ordered = $derived(
		encounter.initiativeOrder
			.map((id) => encounter.combatants.find((c) => c.id === id))
			.filter((c): c is Combatant => c != null)
	);

	// Whether the encounter is over (status !== 'active')
	let isOver = $derived(encounter.status !== 'active');

	function hpPercent(c: Combatant): number {
		if (c.maxHp <= 0) return 0;
		return Math.max(0, Math.min(100, Math.round((c.currentHp / c.maxHp) * 100)));
	}

	function hpColor(c: Combatant): string {
		const pct = hpPercent(c);
		if (pct > 60) return '#4ade80';
		if (pct > 25) return '#facc15';
		return '#f87171';
	}

	function dotColor(c: Combatant): string {
		if (c.type === 'character') return '#7c9cff';
		// Check if this NPC is a companion
		const npc = npcs.find((n) => n.id === c.referenceId);
		if (npc?.role === 'companion') return '#4ade80';
		return '#f87171';
	}

	function getDeathSaves(c: Combatant): { successes: number; failures: number } | null {
		if (c.type !== 'character') return null;
		const ch = characters.find((ch) => ch.id === c.referenceId);
		return ch?.deathSaves ?? null;
	}

	function isDying(c: Combatant): boolean {
		if (c.type !== 'character') return false;
		const ch = characters.find((ch) => ch.id === c.referenceId);
		return c.currentHp <= 0 && !ch?.stable && !ch?.dead;
	}

	function isStable(c: Combatant): boolean {
		if (c.type !== 'character') return false;
		const ch = characters.find((ch) => ch.id === c.referenceId);
		return !!ch?.stable;
	}

	function isDead(c: Combatant): boolean {
		if (c.type !== 'character') return false;
		const ch = characters.find((ch) => ch.id === c.referenceId);
		return !!ch?.dead;
	}

	const OUTCOME_LABEL: Record<string, string> = {
		victory: '🏆 Victory',
		defeat: '💀 Defeat',
		flee: '🏃 Fled',
		fled: '🏃 Fled',
		negotiated: '🤝 Negotiated'
	};
</script>

<div class="combat-panel">
	<!-- Header -->
	<div class="combat-header">
		<div class="combat-title-row">
			<span class="combat-icon">⚔</span>
			<span class="combat-title">Combat</span>
			{#if isOver}
				<span class="outcome-badge">
					{OUTCOME_LABEL[encounter.outcome ?? encounter.status] ?? encounter.status}
				</span>
			{:else}
				<span class="round-badge">Round {encounter.round}</span>
			{/if}
		</div>
	</div>

	<!-- Initiative tracker -->
	<div class="initiative-list">
		{#each ordered as combatant (combatant.id)}
			{@const dying = isDying(combatant)}
			{@const stable = isStable(combatant)}
			{@const dead = isDead(combatant)}
			{@const ds = getDeathSaves(combatant)}
			{@const isActive = awaitingId === combatant.id && !isOver}

			<div
				class="combatant-row"
				class:active={isActive}
				class:defeated={combatant.defeated || dead}
			>
				<!-- Dot + turn arrow -->
				<div class="combatant-left">
					{#if isActive}
						<span class="turn-arrow">▶</span>
					{:else}
						<span class="type-dot" style="background: {dotColor(combatant)}"></span>
					{/if}
				</div>

				<!-- Main info -->
				<div class="combatant-body">
					<div class="name-row">
						<span class="combatant-name">{combatant.name}</span>
						<span class="ac-badge" title="Armour Class">AC {combatant.ac}</span>
						<span class="init-badge" title="Initiative">{combatant.initiative}</span>
					</div>

					{#if combatant.defeated || dead}
						<span class="status-tag defeated-tag">☠ Defeated</span>
					{:else if stable}
						<span class="status-tag stable-tag">💤 Stable</span>
					{:else if dying}
						<!-- Dying: show death-save pips -->
						<div class="dying-row">
							<span class="dying-label">Dying</span>
							{#if ds}
								<div class="ds-track">
									<div class="ds-group success" title="Successes">
										{#each [0, 1, 2] as i}
											<span class="ds-pip" class:filled={i < ds.successes}>◆</span>
										{/each}
									</div>
									<div class="ds-group failure" title="Failures">
										{#each [0, 1, 2] as i}
											<span class="ds-pip" class:filled={i < ds.failures}>◆</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<!-- Normal HP bar -->
						<div class="hp-row">
							<div class="hp-bar">
								<div
									class="hp-fill"
									style="width: {hpPercent(combatant)}%; background: {hpColor(combatant)}"
								></div>
							</div>
							<span class="hp-numbers">{combatant.currentHp}/{combatant.maxHp}</span>
						</div>
					{/if}

					<!-- Conditions -->
					{#if combatant.conditions.length > 0}
						<div class="conds-row">
							{#each combatant.conditions as cond}
								<span class="cond-tag">{cond}</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.combat-panel {
		display: flex;
		flex-direction: column;
		gap: 0;
		font-size: 0.82rem;
	}

	/* ── Header ── */
	.combat-header {
		padding: 0.25rem 0.5rem 0.6rem;
	}

	.combat-title-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.combat-icon {
		font-size: 0.9rem;
	}

	.combat-title {
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
		flex: 1;
	}

	.round-badge {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: rgba(248, 113, 113, 0.12);
		border: 1px solid rgba(248, 113, 113, 0.25);
		color: #f87171;
		white-space: nowrap;
	}

	.outcome-badge {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: rgba(124, 156, 255, 0.12);
		border: 1px solid rgba(124, 156, 255, 0.25);
		color: var(--accent);
		white-space: nowrap;
	}

	/* ── Initiative list ── */
	.initiative-list {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.combatant-row {
		display: flex;
		align-items: flex-start;
		gap: 0.45rem;
		padding: 0.45rem 0.5rem;
		border-radius: 8px;
		border: 1px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}

	.combatant-row.active {
		background: rgba(248, 113, 113, 0.07);
		border-color: rgba(248, 113, 113, 0.22);
	}

	.combatant-row.defeated {
		opacity: 0.4;
	}

	/* ── Left column (dot / arrow) ── */
	.combatant-left {
		flex-shrink: 0;
		width: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 2px;
	}

	.type-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.turn-arrow {
		font-size: 0.6rem;
		color: #f87171;
		line-height: 1;
		animation: arrow-pulse 0.9s ease-in-out infinite;
	}

	@keyframes arrow-pulse {
		0%, 100% { opacity: 1; transform: translateX(0); }
		50% { opacity: 0.6; transform: translateX(2px); }
	}

	/* ── Body ── */
	.combatant-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.22rem;
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.combatant-name {
		font-weight: 600;
		font-size: 0.84rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.combatant-row.defeated .combatant-name {
		text-decoration: line-through;
	}

	.ac-badge {
		font-size: 0.68rem;
		padding: 0.08rem 0.35rem;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--border);
		color: var(--text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.init-badge {
		font-size: 0.68rem;
		padding: 0.08rem 0.32rem;
		border-radius: 4px;
		background: rgba(124, 156, 255, 0.08);
		border: 1px solid rgba(124, 156, 255, 0.18);
		color: #7c9cff;
		white-space: nowrap;
		flex-shrink: 0;
		font-weight: 700;
	}

	/* ── HP Bar ── */
	.hp-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.hp-bar {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}

	.hp-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.4s ease, background 0.4s ease;
	}

	.hp-numbers {
		font-size: 0.7rem;
		color: var(--text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* ── Status tags ── */
	.status-tag {
		font-size: 0.68rem;
		font-weight: 600;
		padding: 0.08rem 0.4rem;
		border-radius: 4px;
		width: fit-content;
	}

	.defeated-tag {
		background: rgba(248, 113, 113, 0.12);
		color: #f87171;
		border: 1px solid rgba(248, 113, 113, 0.2);
	}

	.stable-tag {
		background: rgba(74, 222, 128, 0.1);
		color: #4ade80;
		border: 1px solid rgba(74, 222, 128, 0.2);
	}

	/* ── Dying / Death saves ── */
	.dying-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.dying-label {
		font-size: 0.68rem;
		color: #f87171;
		font-weight: 600;
	}

	.ds-track {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.ds-group {
		display: flex;
		gap: 0.18rem;
	}

	.ds-group.success .ds-pip {
		color: rgba(74, 222, 128, 0.3);
	}

	.ds-group.success .ds-pip.filled {
		color: #4ade80;
	}

	.ds-group.failure .ds-pip {
		color: rgba(248, 113, 113, 0.3);
	}

	.ds-group.failure .ds-pip.filled {
		color: #f87171;
	}

	.ds-pip {
		font-size: 0.6rem;
		transition: color 0.2s;
	}

	/* ── Conditions ── */
	.conds-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.cond-tag {
		font-size: 0.62rem;
		padding: 0.05rem 0.3rem;
		border-radius: 3px;
		background: rgba(250, 204, 21, 0.1);
		border: 1px solid rgba(250, 204, 21, 0.2);
		color: #facc15;
		text-transform: capitalize;
	}
</style>
