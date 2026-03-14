<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import GlassPanel from '$components/GlassPanel.svelte';
	import LobbyPlayer from '$components/LobbyPlayer.svelte';
	import type { LobbyState, LobbyMember } from '$types';

	let { data } = $props();

	let members = $state<LobbyMember[]>([]);
	let adventureStatus = $state('lobby');
	let allReady = $derived(members.length > 0 && members.every((m) => m.isReady));
	let connected = $state(false);
	let initializedFromData = $state(false);

	let adventureId = $derived(data.adventure.id);
	let currentUserId = $derived(data.currentUserId);
	let adventureName = $derived(data.adventure.name);

	/* ── initialise from server-rendered data ────────────── */
	$effect(() => {
		if (!initializedFromData) {
			members = [...(data.members as LobbyMember[])];
			adventureStatus = data.adventure.status;
			initializedFromData = true;
		}
	});

	const lobbyUrl = $derived(typeof window !== 'undefined'
		? `${window.location.origin}/adventures/${adventureId}/lobby`
		: '');

	let copied = $state(false);

	/* ── SSE real-time connection ────────────────────────── */
	let eventSource: EventSource | null = null;

	function connectSSE() {
		if (eventSource) return;

		eventSource = new EventSource(`/api/lobby/${adventureId}/stream`);

		eventSource.addEventListener('lobby-update', (e: MessageEvent) => {
			const state: LobbyState = JSON.parse(e.data);
			members = state.members;
			adventureStatus = state.adventure.status;
			connected = true;
		});

		eventSource.addEventListener('adventure-started', (e: MessageEvent) => {
			const { adventureId: id } = JSON.parse(e.data);
			goto(`/adventures/${id}`);
		});

		eventSource.addEventListener('open', () => {
			connected = true;
		});

		eventSource.onerror = () => {
			connected = false;
			// EventSource auto-reconnects; no manual retry needed.
			// The browser will re-establish the connection automatically.
		};
	}

	function disconnectSSE() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	/* ── actions ─────────────────────────────────────────── */
	let readyInflight = $state(false);

	function toggleReady() {
		// Ignore rapid double-clicks — wait for the in-flight POST to resolve.
		// SSE will deliver the authoritative state and clear the lock.
		if (readyInflight) return;
		readyInflight = true;

		// Flip instantly — fire POST in background, SSE brings authoritative state
		const prevReady = isReady;
		members = members.map((m) =>
			m.userId === currentUserId ? { ...m, isReady: !prevReady } : m
		);

		fetch(`/api/lobby/${adventureId}/ready`, { method: 'POST' })
			.then((res) => res.json())
			.then((result) => {
				if (result.started) goto(`/adventures/${adventureId}`);
				// SSE will deliver the confirmed lobby-update or adventure-started
			})
			.catch(() => {
				// Network error — revert the optimistic flip
				members = members.map((m) =>
					m.userId === currentUserId ? { ...m, isReady: prevReady } : m
				);
			})
			.finally(() => {
				readyInflight = false;
			});
	}

	function copyLink() {
		navigator.clipboard.writeText(lobbyUrl);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	/* ── lifecycle ───────────────────────────────────────── */
	onMount(() => {
		connectSSE();
	});

	onDestroy(() => {
		disconnectSSE();
	});

	const currentMember = $derived(members.find((m) => m.userId === currentUserId));
	const isReady = $derived(currentMember?.isReady ?? false);
</script>

<svelte:head>
	<title>Lobby — {adventureName}</title>
</svelte:head>

<div class="page-container">
	<div class="lobby-wrapper">
		<GlassPanel>
			<div class="lobby-content">
				<div class="lobby-header">
					<h1>{adventureName}</h1>
					<span class="badge badge-lobby">Lobby</span>
					<span class="connection-dot" class:live={connected} title={connected ? 'Live' : 'Reconnecting…'}></span>
				</div>

				<p class="text-muted">Waiting for all adventurers to ready up…</p>

				<!-- Invite link -->
				<div class="invite-section">
					<label class="invite-label" for="invite-link">Invite Link</label>
					<div class="invite-row">
						<input id="invite-link" type="text" readonly value={lobbyUrl} class="invite-input" />
						<button type="button" class="btn btn-ghost" onclick={copyLink}>
							{copied ? '✓ Copied' : 'Copy'}
						</button>
					</div>
				</div>

				<!-- Players -->
				<div class="players-section">
					<h2>Adventurers ({members.length})</h2>
					<div class="players-list">
						{#each members as member (member.userId)}
							<LobbyPlayer {member} isCurrentUser={member.userId === currentUserId} />
						{/each}
					</div>
				</div>

				<!-- Ready button -->
				<div class="actions">
					<button
						class="btn btn-lg full-width"
						class:btn-primary={!isReady}
						class:btn-danger={isReady}
						onclick={toggleReady}
						disabled={readyInflight}
					>
						{isReady ? 'Cancel Ready' : 'Ready Up ⚔️'}
					</button>

					{#if allReady}
						<p class="all-ready-msg text-accent text-center">
							All adventurers are ready! Starting…
						</p>
					{/if}
				</div>
			</div>
		</GlassPanel>
	</div>
</div>

<style>
	.lobby-wrapper {
		max-width: 600px;
		margin: 2rem auto;
	}

	.lobby-content {
		padding: 1rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.lobby-header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.lobby-header h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	/* Connection indicator */
	.connection-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-muted);
		opacity: 0.4;
		transition: all 0.3s ease;
		flex-shrink: 0;
		margin-left: auto;
	}

	.connection-dot.live {
		background: var(--accent-2);
		opacity: 1;
		box-shadow: 0 0 6px var(--accent-2);
	}

	.lobby-content > p {
		margin: -0.75rem 0 0;
	}

	/* Invite */
	.invite-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.invite-label {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.invite-row {
		display: flex;
		gap: 0.5rem;
	}

	.invite-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border);
		color: var(--text-muted);
		padding: 0.6rem 0.85rem;
		border-radius: 10px;
		font-size: 0.88rem;
		font-family: monospace;
	}

	/* Players */
	.players-section h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
	}

	.players-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	/* Actions */
	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.full-width {
		width: 100%;
	}

	.btn-lg {
		padding: 0.9rem 2rem;
		font-size: 1.05rem;
		border-radius: 16px;
	}

	.all-ready-msg {
		margin: 0;
		font-weight: 600;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>
