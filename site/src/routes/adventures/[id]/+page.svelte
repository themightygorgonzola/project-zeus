<script lang="ts">
	import GlassPanel from '$components/GlassPanel.svelte';
	import { toWorldSnapshot, type PrototypeWorld } from '$lib/worldgen/prototype';

	let { data } = $props();
	let worldSnapshot = $derived(
		toWorldSnapshot((data.state as { world?: PrototypeWorld } | undefined)?.world)
	);
</script>

<svelte:head>
	<title>{data.adventure.name}</title>
</svelte:head>

<div class="page-container">
	<div class="adventure-screen">
		<!-- Header -->
		<div class="adventure-header">
			<div>
				<h1>{data.adventure.name}</h1>
				<div class="header-meta">
					<span class="badge badge-{data.adventure.mode}">
						{data.adventure.mode}
					</span>
					<span class="badge badge-active">Active</span>
					{#if data.adventure.worldSeed}
						<span class="text-muted">Seed: {data.adventure.worldSeed}</span>
					{/if}
				</div>
			</div>
		</div>

		<div class="adventure-grid">
			<!-- Party panel -->
			<div class="side-column">
				<GlassPanel>
					<div class="panel-inner">
						<h2>Party</h2>
						<div class="party-list">
							{#each data.members as member}
								<div class="party-member">
									{#if member.avatarUrl}
										<img src={member.avatarUrl} alt="" class="avatar" />
									{:else}
										<div class="avatar avatar-placeholder">
											{member.username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<div>
										<span class="member-name">
											{member.username}
											{#if member.userId === data.currentUserId}
												<span class="you-tag">(you)</span>
											{/if}
										</span>
										<span class="member-role text-muted">{member.role}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</GlassPanel>

				{#if worldSnapshot}
					<GlassPanel>
						<div class="panel-inner">
							<h2>World Snapshot</h2>
							<strong class="world-name">{worldSnapshot.title}</strong>
							<p class="world-meta text-muted">
								Seed {worldSnapshot.seed}
								{#if worldSnapshot.year} · Year {worldSnapshot.year}{/if}
							</p>
							<div class="world-pills">
								{#each worldSnapshot.stats.slice(0, 4) as [label, value]}
									<span>{label}: {value}</span>
								{/each}
							</div>
						</div>
					</GlassPanel>
				{/if}
			</div>

			<!-- Main narrative area (TBD) -->
			<GlassPanel>
				<div class="narrative-area">
					<div class="tbd-notice">
						<span class="tbd-icon">⚔️</span>
						<h2>The Adventure Begins Here</h2>
						<p class="text-muted">
							This is where the narrative engine, world context, and AI-driven storytelling
							will come to life. Character creation, scene descriptions, dialogue choices,
							dice rolls, and combat — all grounded in the world data from Azgaar.
						</p>
						<div class="tbd-tags">
							<span class="tbd-tag">Narrative Engine</span>
							<span class="tbd-tag">Character Creation</span>
							<span class="tbd-tag">World Context</span>
							<span class="tbd-tag">5e Mechanics</span>
							<span class="tbd-tag">AI Game Master</span>
						</div>

						{#if worldSnapshot}
							<div class="world-proof">
								<h3>Saved World Proof</h3>
								<p class="text-muted">
									The selected world was persisted with this adventure and is already available in
									state as `world` for the narrative layer.
								</p>
								{#if worldSnapshot.teaser}
									<blockquote>{worldSnapshot.teaser}</blockquote>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</GlassPanel>
		</div>
	</div>
</div>

<style>
	.adventure-screen {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.adventure-header h1 {
		margin: 0 0 0.5rem;
	}

	.header-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.adventure-grid {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	.side-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.panel-inner {
		padding: 0.25rem 0.5rem;
	}

	.panel-inner h2 {
		margin: 0 0 1rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.party-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.party-member {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	.avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1px solid var(--border);
	}

	.avatar-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(124, 156, 255, 0.2);
		color: var(--accent);
		font-weight: 700;
		font-size: 0.85rem;
	}

	.member-name {
		display: block;
		font-weight: 600;
		font-size: 0.92rem;
	}

	.you-tag {
		color: var(--accent);
		font-weight: 400;
		font-size: 0.8rem;
	}

	.member-role {
		display: block;
		font-size: 0.78rem;
		text-transform: capitalize;
	}

	.world-name {
		display: block;
		font-size: 1rem;
		margin-bottom: 0.35rem;
	}

	.world-meta {
		margin: 0 0 0.85rem;
		font-size: 0.85rem;
	}

	.world-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.world-pills span {
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		font-size: 0.78rem;
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.18);
		color: var(--text-muted);
	}

	/* Narrative TBD */
	.narrative-area {
		min-height: 400px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tbd-notice {
		text-align: center;
		max-width: 500px;
		padding: 2rem;
	}

	.tbd-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.tbd-notice h2 {
		margin: 0 0 0.75rem;
	}

	.tbd-notice p {
		margin: 0 0 1.5rem;
		line-height: 1.6;
	}

	.tbd-tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.tbd-tag {
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.2);
		color: var(--accent);
	}

	.world-proof {
		margin-top: 1.5rem;
		padding: 1rem;
		border-radius: 16px;
		background: rgba(124, 156, 255, 0.08);
		border: 1px solid rgba(124, 156, 255, 0.18);
		text-align: left;
	}

	.world-proof h3 {
		margin: 0 0 0.5rem;
	}

	.world-proof p {
		margin: 0 0 0.85rem;
	}

	.world-proof blockquote {
		margin: 0;
		padding-left: 0.85rem;
		border-left: 3px solid var(--accent);
		color: var(--text-muted);
	}

	@media (max-width: 768px) {
		.adventure-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
