<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import PartySocket from 'partysocket';
	import { PUBLIC_PARTYKIT_HOST } from '$env/static/public';
	import GlassPanel from '$components/GlassPanel.svelte';
	import { toWorldSnapshot, type PrototypeWorld } from '$lib/worldgen/prototype';

	let { data } = $props();
	let worldSnapshot = $derived(
		toWorldSnapshot((data.state as { world?: PrototypeWorld } | undefined)?.world)
	);

	let adventureId = $derived(data.adventure.id);
	let currentUserId = $derived(data.currentUserId);
	let currentUsername = $derived(
		((data.members as Array<{ userId: string; username: string }>)
			.find((m) => m.userId === data.currentUserId))?.username ?? 'Unknown'
	);

	/* ── chat ────────────────────────────────────────── */
	interface ChatMessage {
		id: string;
		userId: string;
		username: string;
		text: string;
		ts: number;
		isGm?: boolean;
		isPending?: boolean;
	}

	let messages = $state<ChatMessage[]>([]);
	let chatInput = $state('');
	let chatEl = $state<HTMLDivElement | null>(null);
	let socket: PartySocket | null = null;
	let connected = $state(false);
	let gmPendingId = $state<string | null>(null);
	let gmThinking = $state(false);

	function connectPartyKit() {
		socket = new PartySocket({ host: PUBLIC_PARTYKIT_HOST, room: adventureId });
		socket.addEventListener('open', () => { connected = true; });
		socket.addEventListener('close', () => { connected = false; });
		socket.addEventListener('message', async (e: MessageEvent) => {
			let msg: { type: string; [key: string]: unknown };
			try { msg = JSON.parse(e.data); } catch { return; }

			if (msg.type === 'player:chat') {
				messages = [...messages, {
					id: `${msg.connectionId}-${Date.now()}`,
					userId: String(msg.userId ?? ''),
					username: String(msg.username ?? 'Unknown'),
					text: String(msg.text ?? ''),
					ts: Date.now(),
				}];
				await tick();
				chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
			}

			if (msg.type === 'ai:turn:start') {
				gmThinking = true;
				const pendingId = `gm-pending-${Date.now()}`;
				gmPendingId = pendingId;
				messages = [...messages, {
					id: pendingId,
					userId: 'gm',
					username: 'Game Master',
					text: '',
					ts: Date.now(),
					isGm: true,
					isPending: true,
				}];
				await tick();
				chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
			}

			if (msg.type === 'ai:turn:end') {
				gmThinking = false;
				const text = String(msg.text ?? '');
				if (gmPendingId) {
					// Replace the pending placeholder with the real response
					messages = messages.map((m) =>
						m.id === gmPendingId ? { ...m, text, isPending: false } : m
					);
					gmPendingId = null;
				} else {
					messages = [...messages, {
						id: `gm-${Date.now()}`,
						userId: 'gm',
						username: 'Game Master',
						text,
						ts: Date.now(),
						isGm: true,
					}];
				}
				await tick();
				chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
			}
		});
	}

	function disconnectPartyKit() {
		socket?.close();
		socket = null;
	}

	async function sendChat(e: SubmitEvent) {
		e.preventDefault();
		const text = chatInput.trim();
		if (!text || !socket) return;
		chatInput = '';

		// /gm <message> → trigger the AI game master
		if (text.startsWith('/gm ')) {
			const playerAction = text.slice(4).trim();
			if (!playerAction) return;
			// Show the player's action in chat first
			messages = [...messages, {
				id: `local-${Date.now()}`,
				userId: currentUserId,
				username: currentUsername,
				text,
				ts: Date.now(),
			}];
			socket.send(JSON.stringify({
				type: 'player:chat',
				userId: currentUserId,
				username: currentUsername,
				text,
			}));
			await tick();
			chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
			// Trigger the AI turn
			await fetch(`/api/adventure/${adventureId}/turn`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerAction }),
			});
			return;
		}

		// Normal chat message
		messages = [...messages, {
			id: `local-${Date.now()}`,
			userId: currentUserId,
			username: currentUsername,
			text,
			ts: Date.now(),
		}];
		await tick();
		chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
		socket.send(JSON.stringify({
			type: 'player:chat',
			userId: currentUserId,
			username: currentUsername,
			text,
		}));
	}

	onMount(() => { connectPartyKit(); });
	onDestroy(() => { disconnectPartyKit(); });
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
			<!-- Chat panel -->
			<GlassPanel>
				<div class="panel-inner chat-panel">
					<div class="chat-header">
						<h2>Party Chat</h2>
						<span class="connection-dot" class:live={connected} title={connected ? 'Live' : 'Connecting…'}></span>
					</div>
					<div class="chat-messages" bind:this={chatEl}>
						{#if messages.length === 0}
							<p class="chat-empty text-muted">No messages yet…<br/><span style="font-size:0.78rem">Tip: type <code>/gm do something</code> to ask the GM</span></p>
						{/if}
						{#each messages as msg (msg.id)}
							<div class="chat-msg" class:own={msg.userId === currentUserId} class:gm={msg.isGm} class:pending={msg.isPending}>
								<span class="chat-name">{msg.username}</span>
								{#if msg.isPending}
									<span class="chat-text gm-thinking">
										<span class="thinking-dot"></span>
										<span class="thinking-dot"></span>
										<span class="thinking-dot"></span>
									</span>
								{:else}
									<span class="chat-text">{msg.text}</span>
								{/if}
							</div>
						{/each}
					</div>
					<form class="chat-form" onsubmit={sendChat}>
						<input
							class="chat-input"
							class:gm-input={chatInput.startsWith('/gm ')}
							type="text"
							placeholder="Chat… or /gm <action>"
							bind:value={chatInput}
							maxlength={500}
							disabled={gmThinking}
						/>
						<button type="submit" class="btn chat-send" class:btn-primary={!chatInput.startsWith('/gm ')} class:btn-gm={chatInput.startsWith('/gm ')} disabled={!chatInput.trim() || gmThinking}>
							{chatInput.startsWith('/gm ') ? '✨' : '↑'}
						</button>
					</form>
				</div>
			</GlassPanel>			</div>

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

	/* Chat panel */
	.chat-panel {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		max-height: 340px;
	}

	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.connection-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
		opacity: 0.35;
		transition: all 0.3s ease;
		flex-shrink: 0;
	}

	.connection-dot.live {
		background: var(--accent-2);
		opacity: 1;
		box-shadow: 0 0 5px var(--accent-2);
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 80px;
		max-height: 200px;
		scrollbar-width: thin;
	}

	.chat-empty {
		margin: 0;
		font-size: 0.82rem;
		text-align: center;
		padding: 1.5rem 0;
	}

	.chat-msg {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.35rem 0.6rem;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
	}

	.chat-msg.own {
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.15);
	}

	/* GM messages */
	.chat-msg.gm {
		background: rgba(255, 200, 80, 0.07);
		border: 1px solid rgba(255, 200, 80, 0.22);
		border-radius: 12px;
	}

	.chat-msg.gm .chat-name {
		color: #f5c842;
	}

	.chat-msg.gm .chat-text {
		font-style: italic;
		line-height: 1.55;
	}

	/* Thinking animation */
	.gm-thinking {
		display: flex;
		gap: 4px;
		align-items: center;
		padding: 0.2rem 0;
	}

	.thinking-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f5c842;
		opacity: 0.4;
		animation: thinking 1.2s ease-in-out infinite;
	}

	.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
	.thinking-dot:nth-child(3) { animation-delay: 0.4s; }

	@keyframes thinking {
		0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
		40% { opacity: 1; transform: scale(1.15); }
	}

	/* GM input highlight */
	.chat-input.gm-input {
		border-color: rgba(245, 200, 66, 0.5);
		background: rgba(245, 200, 66, 0.05);
	}

	.btn-gm {
		background: rgba(245, 200, 66, 0.18);
		color: #f5c842;
		border: 1px solid rgba(245, 200, 66, 0.35);
	}

	.chat-name {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.chat-msg.own .chat-name {
		color: var(--accent-2, var(--accent));
	}

	.chat-text {
		font-size: 0.88rem;
		line-height: 1.4;
		word-break: break-word;
	}

	.chat-form {
		display: flex;
		gap: 0.4rem;
	}

	.chat-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border);
		color: inherit;
		padding: 0.45rem 0.7rem;
		border-radius: 10px;
		font-size: 0.88rem;
		font-family: inherit;
	}

	.chat-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.chat-send {
		padding: 0.45rem 0.75rem;
		border-radius: 10px;
		min-width: 2.2rem;
		font-size: 1rem;
	}

	@media (max-width: 768px) {
		.adventure-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
