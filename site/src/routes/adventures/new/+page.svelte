<script lang="ts">
	import GlassPanel from '$components/GlassPanel.svelte';
	import { enhance } from '$app/forms';
	import {
		createWorldSeed,
		generatePrototypeWorld,
		toWorldSnapshot,
		type PrototypeWorld,
		type WorldSnapshot
	} from '$lib/worldgen/prototype';

	let { data, form } = $props();

	let mode = $state<'solo' | 'multiplayer'>('solo');
	let name = $state('');
	let submitting = $state(false);
	let generatedWorldSeed = $state<string | null>(null);
	let generatedWorld = $state<PrototypeWorld | null>(null);
	let currentWorldSeed = $derived(generatedWorldSeed ?? (data.initialWorldSeed as string));
	let currentWorld = $derived(generatedWorld ?? (data.initialWorld as PrototypeWorld));
	let worldSnapshot = $derived(
		generatedWorld ? toWorldSnapshot(generatedWorld) : (data.initialWorldSnapshot as WorldSnapshot | null)
	);

	function rerollWorld() {
		const nextSeed = createWorldSeed();
		generatedWorldSeed = nextSeed;
		generatedWorld = generatePrototypeWorld(nextSeed);
	}
</script>

<svelte:head>
	<title>New Adventure</title>
</svelte:head>

<div class="page-container">
	<div class="form-wrapper">
		<GlassPanel>
			<div class="form-content">
				<h1>New Adventure</h1>
				<p class="text-muted">Name your quest, pick a mode, and lock in a generated world.</p>

				{#if form?.error}
					<div class="error-banner">{form.error}</div>
				{/if}

				<form
					method="POST"
					class="adventure-form"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
						};
					}}
				>
					<input type="hidden" name="worldSeed" value={currentWorldSeed} />
					<input type="hidden" name="worldData" value={JSON.stringify(currentWorld)} />

					<div class="field">
						<label for="name">Adventure Name</label>
						<input
							type="text"
							id="name"
							name="name"
							placeholder="The Fall of Crimson Keep..."
							maxlength="100"
							required
							bind:value={name}
						/>
					</div>

					<fieldset class="field mode-fieldset">
						<legend>Mode</legend>
						<div class="mode-toggle">
							<button type="button" class="mode-option" class:active={mode === 'solo'} onclick={() => (mode = 'solo')}>
								<span class="mode-icon">🗡️</span>
								<span class="mode-label">Solo</span>
								<span class="mode-desc text-muted">Journey alone</span>
							</button>
							<button type="button" class="mode-option" class:active={mode === 'multiplayer'} onclick={() => (mode = 'multiplayer')}>
								<span class="mode-icon">👥</span>
								<span class="mode-label">Multiplayer</span>
								<span class="mode-desc text-muted">Gather your party</span>
							</button>
						</div>
						<input type="hidden" name="mode" value={mode} />
					</fieldset>

					<section class="world-section">
						<div class="world-header-row">
							<div>
								<h2>World Generation</h2>
								<p class="text-muted">Reroll until the map feels right, then create the adventure to save it.</p>
							</div>
							<button type="button" class="btn btn-ghost" onclick={rerollWorld}>↻ Reroll Map</button>
						</div>

						{#if worldSnapshot}
							<div class="world-card">
								<div class="world-card-top">
									<div>
										<strong class="world-title">{worldSnapshot.title}</strong>
										<div class="world-meta text-muted">
											<span>Seed {worldSnapshot.seed}</span>
											{#if worldSnapshot.year}<span>Year {worldSnapshot.year}</span>{/if}
											{#if worldSnapshot.era}<span>{worldSnapshot.era}</span>{/if}
										</div>
									</div>
									<span class="world-engine">Prototype Worldgen</span>
								</div>

								<div class="world-stats">
									{#each worldSnapshot.stats as [label, value]}
										<div class="world-stat">
											<span>{label}</span>
											<strong>{value}</strong>
										</div>
									{/each}
								</div>

								<div class="world-columns">
									<div>
										<h3>Featured States</h3>
										<ul>
											{#each worldSnapshot.states as state}
												<li>{state}</li>
											{/each}
										</ul>
									</div>
									<div>
										<h3>Settlements</h3>
										<ul>
											{#each worldSnapshot.settlements as settlement}
												<li>{settlement}</li>
											{/each}
										</ul>
									</div>
								</div>

								{#if worldSnapshot.teaser}
									<p class="world-teaser">{worldSnapshot.teaser}</p>
								{/if}
							</div>
						{/if}
					</section>

					{#if mode === 'multiplayer'}
						<div class="info-note">
							<span>ℹ️</span>
							<span>After creating, you'll get a lobby link to share with your party.</span>
						</div>
					{/if}

					<button type="submit" class="btn btn-primary btn-lg full-width" disabled={!name.trim() || submitting}>
						{submitting ? 'Creating…' : mode === 'solo' ? 'Start Adventure' : 'Create Lobby'}
					</button>
				</form>
			</div>
		</GlassPanel>
	</div>
</div>

<style>
	.form-wrapper {
		max-width: 860px;
		margin: 2rem auto;
	}

	.form-content {
		padding: 1rem 1.5rem 1.5rem;
	}

	h1 {
		margin: 0 0 0.3rem;
	}

	.form-content > p {
		margin: 0 0 1.5rem;
	}

	.adventure-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.mode-fieldset {
		padding: 0;
		margin: 0;
		border: 0;
	}

	label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	legend {
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.mode-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.mode-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1.25rem 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 2px solid var(--border);
		border-radius: var(--radius);
		cursor: pointer;
		transition: all 0.2s;
		color: var(--text);
	}

	.mode-option:hover {
		border-color: rgba(124, 156, 255, 0.35);
	}

	.mode-option.active {
		border-color: var(--accent);
		background: rgba(124, 156, 255, 0.08);
	}

	.mode-icon {
		font-size: 1.5rem;
	}

	.mode-label {
		font-weight: 600;
		font-size: 1rem;
	}

	.mode-desc {
		font-size: 0.82rem;
	}

	.world-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.world-header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.world-header-row h2 {
		margin: 0 0 0.35rem;
		font-size: 1rem;
	}

	.world-header-row p {
		margin: 0;
		font-size: 0.9rem;
	}

	.world-card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		border-radius: 16px;
		border: 1px solid rgba(124, 156, 255, 0.22);
		background: linear-gradient(180deg, rgba(124, 156, 255, 0.09), rgba(255, 255, 255, 0.03));
	}

	.world-card-top {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.world-title {
		display: block;
		font-size: 1.1rem;
		margin-bottom: 0.35rem;
	}

	.world-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		font-size: 0.85rem;
	}

	.world-engine {
		padding: 0.35rem 0.65rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: rgba(52, 211, 162, 0.14);
		color: var(--accent-2);
	}

	.world-stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.world-stat {
		padding: 0.75rem;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.world-stat span {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		margin-bottom: 0.35rem;
	}

	.world-stat strong {
		font-size: 1.05rem;
	}

	.world-columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.world-columns h3 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}

	.world-columns ul {
		margin: 0;
		padding-left: 1rem;
		color: var(--text-muted);
	}

	.world-columns li + li {
		margin-top: 0.3rem;
	}

	.world-teaser {
		margin: 0;
		padding: 0.85rem 1rem;
		border-left: 3px solid var(--accent);
		background: rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		color: var(--text-muted);
		line-height: 1.5;
	}

	.info-note {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: rgba(124, 156, 255, 0.08);
		border: 1px solid rgba(124, 156, 255, 0.2);
		border-radius: 12px;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.error-banner {
		padding: 0.75rem 1rem;
		background: rgba(255, 109, 138, 0.1);
		border: 1px solid rgba(255, 109, 138, 0.3);
		border-radius: 12px;
		color: var(--danger);
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
	}

	.full-width {
		width: 100%;
	}

	.btn-lg {
		padding: 0.9rem 2rem;
		font-size: 1.05rem;
		border-radius: 16px;
	}

	@media (max-width: 768px) {
		.world-header-row,
		.world-card-top {
			flex-direction: column;
		}

		.world-stats,
		.world-columns {
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (max-width: 560px) {
		.form-wrapper {
			max-width: 100%;
		}

		.mode-toggle,
		.world-stats,
		.world-columns {
			grid-template-columns: 1fr;
		}
	}
</style>
