<script lang="ts">
	import AdventureCard from '$components/AdventureCard.svelte';
	import GlassPanel from '$components/GlassPanel.svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	function handleAdventureAction() {
		invalidateAll();
	}

	const activeAdventures = $derived(data.adventures.filter((a) => a.status !== 'completed'));
	const completedAdventures = $derived(data.adventures.filter((a) => a.status === 'completed'));
</script>

<svelte:head>
	<title>Your Adventures</title>
</svelte:head>

<div class="page-container">
	<header class="page-header">
		<div>
			<h1>Your Adventures</h1>
			<p class="text-muted">Continue a journey or forge a new path</p>
		</div>
		<a href="/adventures/new" class="btn btn-primary">+ New Adventure</a>
	</header>

	{#if data.adventures.length === 0}
		<GlassPanel>
			<div class="empty-state">
				<span class="empty-icon">🗺️</span>
				<h2>No adventures yet</h2>
				<p class="text-muted">Your journey begins with a single step. Create your first adventure to get started.</p>
				<a href="/adventures/new" class="btn btn-primary" style="margin-top: 1rem;">Create Adventure</a>
			</div>
		</GlassPanel>
	{:else}
		<!-- ── Active adventures ── -->
		{#if activeAdventures.length > 0}
			<div class="adventures-grid">
				{#each activeAdventures as adventure}
					<AdventureCard
						{adventure}
						memberCount={adventure.memberCount}
						isOwner={adventure.ownerId === data.user?.id}
						onAction={handleAdventureAction}
					/>
				{/each}
			</div>
		{:else}
			<p class="none-active text-muted">No active adventures. <a href="/adventures/new">Start one?</a></p>
		{/if}

		<!-- ── Completed divider ── -->
		{#if completedAdventures.length > 0}
			<div class="section-divider">
				<span class="divider-label">Completed</span>
			</div>
			<div class="adventures-grid adventures-grid-completed">
				{#each completedAdventures as adventure}
					<AdventureCard
						{adventure}
						memberCount={adventure.memberCount}
						isOwner={adventure.ownerId === data.user?.id}
						onAction={handleAdventureAction}
					/>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 2rem;
		gap: 1rem;
	}

	.page-header h1 {
		margin: 0 0 0.3rem;
	}

	.page-header p {
		margin: 0;
	}

	.adventures-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1.25rem;
	}

	.none-active {
		font-size: 0.9rem;
		margin: 0 0 0.5rem;
	}

	/* ── Section divider ── */
	.section-divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 2.25rem 0 1.5rem;
	}

	.section-divider::before,
	.section-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	.divider-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-muted);
		white-space: nowrap;
		padding: 0 0.25rem;
	}

	/* Completed cards — slightly muted until hovered */
	.adventures-grid-completed {
		opacity: 0.72;
		filter: saturate(0.55);
		transition: opacity 0.25s, filter 0.25s;
	}

	.adventures-grid-completed:hover {
		opacity: 1;
		filter: saturate(1);
	}

	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
	}

	.empty-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.empty-state h2 {
		margin: 0 0 0.5rem;
	}

	.empty-state p {
		margin: 0;
		max-width: 400px;
		margin-inline: auto;
	}

	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
		}
	}
</style>
