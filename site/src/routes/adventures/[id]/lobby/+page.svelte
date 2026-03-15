<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import PartySocket from 'partysocket';
	import { PUBLIC_PARTYKIT_HOST } from '$env/static/public';
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

	/* ── PartyKit real-time connection ───────────────────── */
	let socket: PartySocket | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	const POLL_INTERVAL = 5_000;

	async function fetchLobbyState() {
		try {
			const res = await fetch(`/api/lobby/${adventureId}`);
			if (!res.ok) return;
			const state: LobbyState = await res.json();
			if (state.adventure.status === 'active') {
				goto(`/adventures/${adventureId}`);
				return;
			}
			members = state.members;
			adventureStatus = state.adventure.status;
		} catch { /* network hiccup */ }
	}

	function connectPartyKit() {
		socket = new PartySocket({ host: PUBLIC_PARTYKIT_HOST, room: adventureId });

		socket.addEventListener('open', () => { connected = true; });
		socket.addEventListener('close', () => { connected = false; });

		socket.addEventListener('message', (e: MessageEvent) => {
			let msg: { type: string; [key: string]: unknown };
			try { msg = JSON.parse(e.data); } catch { return; }

			switch (msg.type) {
				case 'player:joined':
				case 'player:left':
					// Re-fetch to get the new member list
					fetchLobbyState();
					break;
				case 'player:ready':
					// Update directly — sender already wrote to Turso before broadcasting
					members = members.map((m) =>
						m.userId === String(msg.userId)
							? { ...m, isReady: Boolean(msg.isReady) }
							: m
					);
					break;
				case 'adventure:started':
					goto(`/adventures/${adventureId}`);
					break;
			}
		});

		// Light fallback — catches adventure-started if WS is slow
		pollTimer = setInterval(fetchLobbyState, POLL_INTERVAL);
	}

	function disconnectPartyKit() {
		socket?.close();
		socket = null;
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	}

	/* ── actions ─────────────────────────────────────────── */
	let readyInflight = $state(false);

	function toggleReady() {
		if (readyInflight) return;
		readyInflight = true;

		// Optimistic flip for self only
		const prevReady = isReady;
		const newReady = !prevReady;
		members = members.map((m) =>
			m.userId === currentUserId ? { ...m, isReady: newReady } : m
		);

		fetch(`/api/lobby/${adventureId}/ready`, { method: 'POST' })
			.then((res) => res.json())
			.then((result) => {
				if (result.started) {
					// Tell all other players immediately, then redirect
					socket?.send(JSON.stringify({ type: 'adventure:started' }));
					goto(`/adventures/${adventureId}`);
				} else {
					// Turso is now updated — safe to broadcast the confirmed isReady
					socket?.send(JSON.stringify({
						type: 'player:ready',
						userId: currentUserId,
						isReady: result.ready,
					}));
				}
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
		connectPartyKit();
	});

	onDestroy(() => {
		disconnectPartyKit();
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

				{#if data.worldSnapshot}
					<div class="world-preview">
						<div class="world-preview-header">
							<div>
								<h2>Selected World</h2>
								<p class="text-muted">This map was locked in during creation and saved with the adventure.</p>
							</div>
							<span class="world-seed">Seed {data.worldSnapshot.seed}</span>
						</div>
						<strong class="world-name">{data.worldSnapshot.title}</strong>
						<div class="world-preview-stats">
							{#each data.worldSnapshot.stats.slice(0, 4) as [label, value]}
								<span>{label}: {value}</span>
							{/each}
						</div>
					</div>
				{/if}

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

	.world-preview {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.95rem 1rem;
		border-radius: 14px;
		border: 1px solid rgba(124, 156, 255, 0.2);
		background: rgba(124, 156, 255, 0.07);
	}

	.world-preview-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}

	.world-preview-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	.world-preview-header p {
		margin: 0;
		font-size: 0.85rem;
	}

	.world-seed {
		font-family: monospace;
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.world-name {
		font-size: 1rem;
	}

	.world-preview-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.world-preview-stats span {
		font-size: 0.82rem;
		color: var(--text-muted);
		padding: 0.3rem 0.55rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.04);
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

	@media (max-width: 560px) {
		.world-preview-header {
			flex-direction: column;
		}
	}
</style>
