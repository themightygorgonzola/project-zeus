<script lang="ts">
	import type { TurnRow, ChatRow } from './+page.server';

	let { data } = $props();

	// ── Turn expansion state ──────────────────────────────────────────────────
	let expandedTurn = $state<string | null>(null);
	let turnTab = $state<Record<string, 'prompt' | 'engine' | 'ai' | 'applied' | 'meta'>>({});

	function toggleTurn(id: string) {
		expandedTurn = expandedTurn === id ? null : id;
		if (!turnTab[id]) turnTab[id] = 'prompt';
	}

	function getTurnTab(id: string) {
		return turnTab[id] ?? 'prompt';
	}

	function setTurnTab(id: string, tab: 'prompt' | 'engine' | 'ai' | 'applied' | 'meta') {
		turnTab[id] = tab;
	}

	// ── State viewer expansion ────────────────────────────────────────────────
	let stateExpanded = $state<Record<string, boolean>>({
		characters: true,
		npcs: false,
		locations: false,
		quests: false,
		clock: true,
		turnLog: false
	});

	// ── Formatters ───────────────────────────────────────────────────────────
	function fmt(ts: number) {
		return new Date(ts).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function fmtDate(ts: number) {
		return new Date(ts).toLocaleString();
	}

	function intentColor(intent: string) {
		const map: Record<string, string> = {
			'equip-item': '#7bc4f5',
			'unequip-item': '#7bc4f5',
			'drop-item': '#f5a97f',
			'use-item': '#c3a0f5',
			'cast-spell': '#c3a0f5',
			'attack': '#f87171',
			'move': '#7be8a0',
			'rest': '#7be8a0',
			'explore': '#7be8a0',
			'dialogue': '#f5c842',
			'social': '#f5c842',
			'inspect': '#94a3b8',
			'unknown': '#475569'
		};
		return map[intent] ?? '#94a3b8';
	}

	function statusColor(status: string) {
		if (status === 'completed') return '#4ade80';
		if (status === 'clarification') return '#f5c842';
		return '#94a3b8';
	}

	function prettyJson(val: unknown, indent = 0): string {
		return JSON.stringify(val, null, 2);
	}

	function stateSection(key: string): unknown {
		if (!data.currentState || typeof data.currentState !== 'object') return null;
		return (data.currentState as Record<string, unknown>)[key];
	}

	// ── Computed ──────────────────────────────────────────────────────────────
	let gs = $derived(data.currentState as Record<string, unknown> | null);
	let characters = $derived(Array.isArray(gs?.characters) ? gs!.characters as unknown[] : []);
	let charMap = $derived(
		Object.fromEntries(
			(characters as Array<{ id: string; name: string; userId?: string }>)
				.map(c => [c.userId ?? c.id, c.name])
		)
	);

	let hasAiData = (turn: TurnRow) => turn.debug !== null;
	let hasPrompt = (turn: TurnRow) => (turn.debug?.messages?.length ?? 0) > 0;

	// ── Copy summary ─────────────────────────────────────────────────────────
	let copyState = $state<Record<string, 'idle' | 'copied'>>({});

	function copyTurnSummary(turn: TurnRow) {
		const lines: string[] = [];

		lines.push(`=== TURN #${turn.turnNumber} — ${turn.intent} ===`);
		lines.push(`Action:  ${turn.action}`);
		lines.push(`Status:  ${turn.status}  |  Mode: ${turn.debug?.mode ?? '—'}  |  Model: ${turn.debug?.model ?? '—'}`);
		lines.push('');

		// Prompt messages
		if (turn.debug?.messages?.length) {
			lines.push('=== PROMPT MESSAGES ===');
			for (const msg of turn.debug.messages) {
				lines.push(`--- [${msg.role}] ---`);
				lines.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2));
			}
			lines.push('');
		}

		// Raw AI response
		if (turn.debug?.rawAiResponse) {
			lines.push('=== RAW AI RESPONSE ===');
			lines.push(turn.debug.rawAiResponse);
			lines.push('');
		}

		// Applied state changes
		const applied = turn.debug?.mergedStateChanges ?? turn.stateChanges;
		lines.push('=== APPLIED STATE CHANGES ===');
		lines.push(JSON.stringify(applied, null, 2));

		// Narrative
		if (turn.narrativeText) {
			lines.push('');
			lines.push('=== NARRATIVE ===');
			lines.push(turn.narrativeText);
		}

		navigator.clipboard.writeText(lines.join('\n')).then(() => {
			copyState[turn.id] = 'copied';
			setTimeout(() => { copyState[turn.id] = 'idle'; }, 2000);
		});
	}

	// ── Copy whole adventure export ───────────────────────────────────────────
	let adventureCopyState = $state<'idle' | 'copied'>('idle');

	function copyAdventureSummary() {
		// Strip turnLog from finalState (it's already in `turns`)
		let finalState: Record<string, unknown> | null = null;
		if (data.currentState && typeof data.currentState === 'object') {
			const { turnLog: _tl, ...rest } = data.currentState as Record<string, unknown>;
			void _tl;
			finalState = rest;
		}

		const exportDoc = {
			_schema: 'zeus-adventure-export-v1',
			exportedAt: new Date().toISOString(),
			adventure: {
				id: data.adventure.id,
				name: data.adventure.name,
				status: data.adventure.status,
				mode: data.adventure.mode,
				createdAt: new Date(data.adventure.createdAt).toISOString()
			},
			members: data.members.map((m) => ({
				userId: m.userId,
				username: m.username,
				role: m.role
			})),
			finalState,
			turns: data.turns.map((t) => ({
				turnNumber: t.turnNumber,
				actor: t.actorName,
				actorType: t.actorType,
				intent: t.intent,
				status: t.status,
				mode: t.debug?.mode ?? null,
				model: t.debug?.model ?? null,
				latencyMs: t.debug?.latencyMs ?? null,
				action: t.action,
				resolvedSummary: t.resolvedSummary,
				mechanics: t.mechanics,
				promptMessages: t.debug?.messages ?? [],
				rawAiResponse: t.debug?.rawAiResponse ?? null,
				gmProposedChanges: t.debug?.gmStateChanges ?? t.debug?.parsedGmResponse?.stateChanges ?? null,
				appliedStateChanges: t.debug?.mergedStateChanges ?? t.stateChanges,
				narrativeText: t.narrativeText,
				createdAt: new Date(t.createdAt).toISOString()
			}))
		};

		navigator.clipboard.writeText(JSON.stringify(exportDoc, null, 2)).then(() => {
			adventureCopyState = 'copied';
			setTimeout(() => { adventureCopyState = 'idle'; }, 2500);
		});
	}
</script>

<svelte:head>
	<title>Debug: {data.adventure.name}</title>
</svelte:head>

<div class="debug-shell">
	<!-- ── HEADER ─────────────────────────────────────────────────────────── -->
	<div class="debug-header">
		<div class="debug-header-left">
			<a href="/admin" class="back-link">← Admin</a>
			<h1 class="debug-title">{data.adventure.name}</h1>
			<span class="badge status-{data.adventure.status}">{data.adventure.status}</span>
			<span class="badge mode-{data.adventure.mode}">{data.adventure.mode}</span>
		</div>
		<div class="header-actions">
			<button
				class="export-btn"
				class:copied={adventureCopyState === 'copied'}
				onclick={copyAdventureSummary}
				title="Copy full adventure export (all turns, prompts, responses, final state) as JSON"
			>
				{adventureCopyState === 'copied' ? '✅ Copied!' : '📦 Copy Adventure JSON'}
			</button>
			<a href="/adventures/{data.adventure.id}" class="play-link" target="_blank" rel="noreferrer">
				Open Adventure ↗
			</a>
		</div>
	</div>

	<!-- ── THREE-COLUMN LAYOUT ────────────────────────────────────────────── -->
	<div class="debug-grid">

		<!-- LEFT SIDEBAR -->
		<aside class="debug-sidebar left-sidebar">
			<section class="sidebar-section">
				<div class="sidebar-section-title">Adventure</div>
				<div class="meta-row"><span class="meta-label">ID</span><code class="mono">{data.adventure.id.slice(0, 12)}…</code></div>
				<div class="meta-row"><span class="meta-label">Owner</span><span>{data.members.find(m => m.userId === data.adventure.ownerId)?.username ?? data.adventure.ownerId}</span></div>
				<div class="meta-row"><span class="meta-label">World seed</span><code class="mono">{data.adventure.worldSeed ? data.adventure.worldSeed.slice(0, 14) + '…' : '—'}</code></div>
				<div class="meta-row"><span class="meta-label">Created</span><span class="muted-sm">{fmtDate(data.adventure.createdAt)}</span></div>
			</section>

			<section class="sidebar-section">
				<div class="sidebar-section-title">Stats</div>
				<div class="stat-pairs">
					<div class="stat-pair">
						<span class="sp-value">{data.turns.length}</span>
						<span class="sp-label">Turns in DB</span>
					</div>
					<div class="stat-pair">
						<span class="sp-value">{(gs?.nextTurnNumber as number | undefined) ?? '—'}</span>
						<span class="sp-label">Next turn #</span>
					</div>
					<div class="stat-pair">
						<span class="sp-value">{characters.length}</span>
						<span class="sp-label">Characters</span>
					</div>
					<div class="stat-pair">
						<span class="sp-value">{data.chatLog.length}</span>
						<span class="sp-label">Chat msgs</span>
					</div>
					<div class="stat-pair">
						<span class="sp-value">{data.turns.filter(t => t.debug).length}</span>
						<span class="sp-label">With debug</span>
					</div>
					<div class="stat-pair">
						<span class="sp-value">{(gs?.stateVersion as number | undefined) ?? '—'}</span>
						<span class="sp-label">State ver</span>
					</div>
				</div>
			</section>

			<section class="sidebar-section">
				<div class="sidebar-section-title">Members ({data.members.length})</div>
				{#each data.members as m}
					<div class="member-row">
						<span class="member-name">{m.username}</span>
						{#if charMap[m.userId]}
							<span class="member-char">{charMap[m.userId]}</span>
						{:else}
							<span class="muted-sm">No char</span>
						{/if}
					</div>
				{/each}
			</section>

			{#if data.stateUpdatedAt}
				<div class="muted-sm state-updated">State updated {fmtDate(data.stateUpdatedAt)}</div>
			{/if}
		</aside>

		<!-- CENTER: TURN LIST -->
		<main class="debug-center">
			<div class="center-header">
				<h2>Turn Log <span class="count-badge">{data.turns.length}</span></h2>
			</div>

			{#if data.turns.length === 0}
				<div class="empty-state">
					<p>No turns recorded yet.</p>
					<p class="muted-sm">Turns appear here once a player sends an action with @gm.</p>
				</div>
			{/if}

			<div class="turn-list">
				{#each data.turns.slice().reverse() as turn (turn.id)}
					<!-- Turn header row (always visible) -->
					<div
						class="turn-row"
						class:expanded={expandedTurn === turn.id}
						class:clarification={turn.status === 'clarification'}
					>
						<button class="turn-header" onclick={() => toggleTurn(turn.id)}>
							<span class="turn-num">#{turn.turnNumber}</span>
							<span class="intent-pill" style="background: {intentColor(turn.intent)}22; color: {intentColor(turn.intent)}; border-color: {intentColor(turn.intent)}44">{turn.intent}</span>
							<span class="status-dot" style="background: {statusColor(turn.status)}" title={turn.status}></span>
							<span class="turn-action-preview">{turn.action.length > 90 ? turn.action.slice(0, 90) + '…' : turn.action}</span>
							<span class="turn-meta-right">
								<span class="actor-name">{turn.actorName}</span>
								<span class="turn-time muted-sm">{fmt(turn.createdAt)}</span>
								{#if !hasAiData(turn)}
									<span class="no-debug-pill" title="No debug data (legacy turn or DEBUG_TURNS=false)">no debug</span>
								{/if}
								<span class="expand-icon">{expandedTurn === turn.id ? '▲' : '▼'}</span>
							</span>
						</button>

						{#if expandedTurn === turn.id}
							<div class="turn-detail">
								<!-- Sub-tab bar -->
								<div class="subtab-bar">
									{#each (['prompt', 'engine', 'ai', 'applied', 'meta'] as const) as t}
										<button
											class="subtab-btn"
											class:active={getTurnTab(turn.id) === t}
											onclick={() => setTurnTab(turn.id, t)}
											disabled={t === 'prompt' && !hasPrompt(turn)}
										>
											{t === 'prompt' ? '📨 Prompt' :
											 t === 'engine' ? '⚙️ Engine' :
											 t === 'ai' ? '🤖 AI Response' :
											 t === 'applied' ? '✅ Applied' : '📊 Meta'}
										</button>
									{/each}
									<button
										class="subtab-btn copy-btn"
										class:copied={copyState[turn.id] === 'copied'}
										onclick={() => copyTurnSummary(turn)}
										title="Copy prompt + AI response + applied changes to clipboard"
									>
										{copyState[turn.id] === 'copied' ? '✅ Copied!' : '📋 Copy'}
									</button>
								</div>

								<!-- PROMPT tab -->
								{#if getTurnTab(turn.id) === 'prompt'}
									{#if !hasPrompt(turn)}
										<div class="no-data-notice">
											{#if turn.debug === null}
												No debug data — this turn was recorded before debug capture was enabled,
												or <code>DEBUG_TURNS=false</code> was set.
											{:else}
												No messages (clarification turn — no AI call was made).
											{/if}
										</div>
									{:else}
										<div class="prompt-messages">
											{#each turn.debug!.messages as msg, i}
												<div class="prompt-msg role-{msg.role}">
													<div class="prompt-msg-header">
														<span class="role-badge role-{msg.role}">{msg.role}</span>
														<span class="msg-idx muted-sm">#{i + 1}</span>
													</div>
													<pre class="prompt-text">{typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}</pre>
												</div>
											{/each}
										</div>
									{/if}
								{/if}

								<!-- ENGINE tab -->
								{#if getTurnTab(turn.id) === 'engine'}
									<div class="detail-section">
										<div class="detail-label">Resolved Action Summary</div>
										<p class="resolved-summary">{turn.resolvedSummary || '(empty)'}</p>
									</div>

									{#if (turn.mechanics as unknown[]).length > 0}
										<div class="detail-section">
											<div class="detail-label">Mechanic Results ({(turn.mechanics as unknown[]).length})</div>
											{#each turn.mechanics as mech, i}
												<div class="mech-card">
													<pre class="json-block">{prettyJson(mech)}</pre>
												</div>
											{/each}
										</div>
									{:else}
										<div class="detail-section">
											<div class="detail-label">Mechanic Results</div>
											<p class="muted-sm">None (full-GM mode — engine yielded to AI)</p>
										</div>
									{/if}

									<div class="detail-section">
										<div class="detail-label">Engine State Changes (proposed)</div>
										{#if turn.debug?.engineStateChanges}
											<pre class="json-block">{prettyJson(turn.debug.engineStateChanges)}</pre>
										{:else}
											<pre class="json-block">{prettyJson(turn.stateChanges)}</pre>
										{/if}
									</div>
								{/if}

								<!-- AI RESPONSE tab -->
								{#if getTurnTab(turn.id) === 'ai'}
									{#if !hasAiData(turn) || turn.debug?.mode === 'clarification'}
										<div class="no-data-notice">
											{#if turn.debug?.mode === 'clarification'}
												No AI call — the turn-executor requested clarification before sending to the model.
											{:else}
												No debug data available for this turn.
											{/if}
										</div>
									{:else}
										<div class="detail-section">
											<div class="detail-label">Mode</div>
											<span class="mode-badge mode-{turn.debug!.mode}">{turn.debug!.mode}</span>
										</div>

										<div class="detail-section">
											<div class="detail-label">Raw AI Response</div>
											<pre class="json-block raw-response">{turn.debug!.rawAiResponse || '(empty)'}</pre>
										</div>

										{#if turn.debug?.mode === 'full-gm'}
											<div class="detail-section">
												<div class="detail-label">Parsed GM State Changes (what the AI proposed)</div>
												{#if turn.debug.gmStateChanges}
													<pre class="json-block">{prettyJson(turn.debug.gmStateChanges)}</pre>
												{:else}
													<pre class="json-block">{prettyJson(turn.debug.parsedGmResponse?.stateChanges ?? {})}</pre>
												{/if}
											</div>
										{/if}
									{/if}
								{/if}

								<!-- APPLIED tab -->
								{#if getTurnTab(turn.id) === 'applied'}
									<div class="detail-section">
										<div class="detail-label">Narrative Text</div>
										<blockquote class="narrative-text">{turn.narrativeText || '(empty)'}</blockquote>
									</div>

									<div class="detail-section">
										<div class="detail-label">Applied State Changes (merged)</div>
										{#if turn.debug?.mergedStateChanges}
											<pre class="json-block">{prettyJson(turn.debug.mergedStateChanges)}</pre>
										{:else}
											<pre class="json-block">{prettyJson(turn.stateChanges)}</pre>
										{/if}
									</div>
								{/if}

								<!-- META tab -->
								{#if getTurnTab(turn.id) === 'meta'}
									<div class="meta-grid">
										<div class="meta-item">
											<span class="meta-item-label">Model</span>
											<code>{turn.debug?.model ?? '—'}</code>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Mode</span>
											<span class="mode-badge mode-{turn.debug?.mode ?? 'unknown'}">{turn.debug?.mode ?? '—'}</span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Latency</span>
											<span>{turn.debug?.latencyMs != null ? `${turn.debug.latencyMs} ms` : '—'}</span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Actor</span>
											<span>{turn.actorName} <code class="muted-sm">({turn.actorId})</code></span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Turn #</span>
											<span>{turn.turnNumber}</span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Recorded</span>
											<span class="muted-sm">{fmtDate(turn.createdAt)}</span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Prompt msgs</span>
											<span>{turn.debug?.messages?.length ?? '—'}</span>
										</div>
										<div class="meta-item">
											<span class="meta-item-label">Status</span>
											<span style="color: {statusColor(turn.status)}">{turn.status}</span>
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</main>

		<!-- RIGHT SIDEBAR: State viewer + Chat -->
		<aside class="debug-sidebar right-sidebar">
			<!-- Game State viewer -->
			<section class="sidebar-section">
				<div class="sidebar-section-title">Current Game State</div>
				{#if !data.currentState}
					<p class="muted-sm">No state stored.</p>
				{:else}
					{@const state = data.currentState as Record<string, unknown>}
					<!-- Scalar summary row -->
					<div class="state-scalars">
						{#each Object.entries(state).filter(([, v]) => typeof v !== 'object' || v === null) as [k, v]}
							<div class="scalar-row">
								<span class="scalar-key">{k}</span>
								<code class="scalar-val">{JSON.stringify(v)}</code>
							</div>
						{/each}
					</div>

					<!-- Expandable sections for object/array values -->
					{#each Object.entries(state).filter(([, v]) => typeof v === 'object' && v !== null) as [key, val]}
						<div class="state-section">
							<button
								class="state-section-toggle"
								onclick={() => stateExpanded[key] = !stateExpanded[key]}
							>
								<span class="state-key">{key}</span>
								<span class="state-count muted-sm">
									{#if Array.isArray(val)}({(val as unknown[]).length}){/if}
								</span>
								<span class="state-toggle-icon">{stateExpanded[key] ? '▲' : '▼'}</span>
							</button>
							{#if stateExpanded[key]}
								<pre class="json-block state-json">{prettyJson(val)}</pre>
							{/if}
						</div>
					{/each}
				{/if}
			</section>

			<!-- Chat log -->
			<section class="sidebar-section">
				<div class="sidebar-section-title">Chat Log ({data.chatLog.length})</div>
				<div class="chat-log">
					{#each data.chatLog as msg}
						<div class="chat-msg" class:consumed={msg.consumedByTurn !== null}>
							<div class="chat-msg-header">
								<span class="chat-username">{msg.username}</span>
								<span class="chat-time muted-sm">{fmt(msg.createdAt)}</span>
								{#if msg.consumedByTurn !== null}
									<span class="consumed-tag" title="Included in turn #{msg.consumedByTurn}">→T{msg.consumedByTurn}</span>
								{/if}
							</div>
							<p class="chat-text">{msg.text}</p>
						</div>
					{/each}
					{#if data.chatLog.length === 0}
						<p class="muted-sm">No chat messages.</p>
					{/if}
				</div>
			</section>
		</aside>
	</div>
</div>

<style>
	/* ── Layout ─────────────────────────────────────────── */
	.debug-shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: var(--bg, #0f111a);
		color: var(--text, #e2e8f0);
		font-family: var(--font, system-ui, sans-serif);
		padding: 1.25rem;
		gap: 1rem;
	}

	.debug-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(255,255,255,0.08);
	}

	.debug-header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.debug-title {
		font-size: 1.15rem;
		font-weight: 700;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.back-link, .play-link {
		font-size: 0.82rem;
		color: var(--accent, #7c9cff);
		text-decoration: none;
	}
	.back-link:hover, .play-link:hover { text-decoration: underline; }

	.export-btn {
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.32rem 0.8rem;
		border-radius: 8px;
		border: 1px solid rgba(251,191,36,0.3);
		background: rgba(251,191,36,0.06);
		color: #fbbf24;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.export-btn:hover { background: rgba(251,191,36,0.13); }
	.export-btn.copied { border-color: rgba(74,222,128,0.35); color: #4ade80; background: rgba(74,222,128,0.08); }

	.debug-grid {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 280px;
		gap: 1rem;
		align-items: start;
	}

	/* ── Sidebars ────────────────────────────────────────── */
	.debug-sidebar {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 80px);
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.sidebar-section {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 12px;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.sidebar-section-title {
		font-size: 0.67rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		color: var(--text-muted, #94a3b8);
		margin-bottom: 0.2rem;
	}

	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
		gap: 0.5rem;
	}
	.meta-label { color: var(--text-muted, #94a3b8); font-size: 0.75rem; }

	.stat-pairs {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}
	.stat-pair {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.45rem;
		background: rgba(255,255,255,0.03);
		border-radius: 8px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.sp-value { font-size: 1.15rem; font-weight: 700; }
	.sp-label { font-size: 0.6rem; color: var(--text-muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; }

	.member-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.member-name { font-weight: 600; }
	.member-char { font-size: 0.75rem; color: var(--accent, #7c9cff); }

	.state-updated { font-size: 0.7rem; text-align: center; color: var(--text-muted, #94a3b8); padding: 0.25rem 0; }

	/* ── Center: turn list ───────────────────────────────── */
	.debug-center { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }

	.center-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid rgba(255,255,255,0.07);
	}
	.center-header h2 { font-size: 1rem; font-weight: 700; margin: 0; }

	.count-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: rgba(124,156,255,0.15);
		color: var(--accent, #7c9cff);
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted, #94a3b8);
	}

	.turn-list { display: flex; flex-direction: column; gap: 0.4rem; }

	.turn-row {
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 12px;
		overflow: hidden;
		transition: border-color 0.15s;
	}
	.turn-row.expanded { border-color: rgba(124,156,255,0.3); }
	.turn-row.clarification { border-left: 3px solid #f5c842; }

	.turn-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 0.85rem;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font-family: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.12s;
	}
	.turn-header:hover { background: rgba(255,255,255,0.04); }

	.turn-num {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-muted, #94a3b8);
		min-width: 2rem;
		flex-shrink: 0;
	}

	.intent-pill {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		border: 1px solid;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}

	.status-dot {
		width: 7px; height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.turn-action-preview {
		flex: 1;
		font-size: 0.83rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.turn-meta-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.actor-name { font-size: 0.72rem; color: var(--text-muted, #94a3b8); }
	.turn-time { font-size: 0.7rem; }
	.expand-icon { font-size: 0.65rem; color: var(--text-muted, #94a3b8); }

	.no-debug-pill {
		font-size: 0.62rem;
		padding: 0.08rem 0.35rem;
		border-radius: 999px;
		background: rgba(148,163,184,0.1);
		border: 1px solid rgba(148,163,184,0.2);
		color: #94a3b8;
	}

	/* ── Turn detail panel ───────────────────────────────── */
	.turn-detail {
		border-top: 1px solid rgba(255,255,255,0.07);
		padding: 0.75rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.subtab-bar {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.subtab-btn {
		font-size: 0.73rem;
		font-weight: 600;
		padding: 0.3rem 0.7rem;
		border-radius: 8px;
		border: 1px solid rgba(255,255,255,0.1);
		background: rgba(255,255,255,0.03);
		color: var(--text-muted, #94a3b8);
		cursor: pointer;
		font-family: inherit;
		transition: background 0.12s, color 0.12s;
	}
	.subtab-btn:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--text, #e2e8f0); }
	.subtab-btn.active { background: rgba(124,156,255,0.12); border-color: rgba(124,156,255,0.3); color: var(--accent, #7c9cff); }
	.subtab-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.subtab-btn.copy-btn { margin-left: auto; border-color: rgba(251,191,36,0.25); color: #fbbf24; }
	.subtab-btn.copy-btn:hover { background: rgba(251,191,36,0.1); }
	.subtab-btn.copy-btn.copied { border-color: rgba(74,222,128,0.35); color: #4ade80; background: rgba(74,222,128,0.08); }

	/* Prompt messages */
	.prompt-messages { display: flex; flex-direction: column; gap: 0.6rem; }

	.prompt-msg {
		border-radius: 8px;
		border: 1px solid rgba(255,255,255,0.07);
		overflow: hidden;
	}
	.prompt-msg.role-system { border-color: rgba(245,200,66,0.25); }
	.prompt-msg.role-user   { border-color: rgba(124,156,255,0.25); }
	.prompt-msg.role-assistant { border-color: rgba(74,222,128,0.25); }

	.prompt-msg-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.65rem;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		background: rgba(255,255,255,0.03);
	}

	.role-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.role-badge.role-system    { background: rgba(245,200,66,0.15); color: #f5c842; }
	.role-badge.role-user      { background: rgba(124,156,255,0.15); color: var(--accent, #7c9cff); }
	.role-badge.role-assistant { background: rgba(74,222,128,0.15); color: #4ade80; }

	.msg-idx { font-size: 0.68rem; }

	.prompt-text {
		margin: 0;
		padding: 0.65rem;
		font-size: 0.78rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		max-height: 400px;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	/* Detail sections */
	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.detail-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-weight: 700;
		color: var(--text-muted, #94a3b8);
	}
	.resolved-summary {
		font-size: 0.88rem;
		margin: 0;
		font-weight: 600;
	}

	.mech-card {
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 8px;
		overflow: hidden;
	}

	.json-block {
		margin: 0;
		padding: 0.65rem;
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-all;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		background: rgba(0,0,0,0.25);
		border-radius: 8px;
		max-height: 480px;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.raw-response {
		border: 1px solid rgba(245,200,66,0.2);
		background: rgba(245,200,66,0.04);
	}

	.narrative-text {
		margin: 0;
		padding: 0.75rem;
		font-size: 0.88rem;
		line-height: 1.65;
		border-left: 3px solid rgba(74,222,128,0.4);
		background: rgba(74,222,128,0.05);
		border-radius: 0 8px 8px 0;
		font-style: italic;
	}

	.no-data-notice {
		padding: 1rem;
		background: rgba(245,200,66,0.06);
		border: 1px solid rgba(245,200,66,0.15);
		border-radius: 8px;
		font-size: 0.82rem;
		color: var(--text-muted, #94a3b8);
		line-height: 1.5;
	}

	.meta-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}
	.meta-item {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem 0.65rem;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 8px;
	}
	.meta-item-label {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted, #94a3b8);
	}
	.meta-item code { font-size: 0.78rem; font-family: monospace; }

	/* Mode badges */
	.mode-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.mode-badge.mode-narrator    { background: rgba(124,156,255,0.15); color: var(--accent, #7c9cff); }
	.mode-badge.mode-full-gm     { background: rgba(245,200,66,0.15); color: #f5c842; }
	.mode-badge.mode-clarification { background: rgba(148,163,184,0.12); color: #94a3b8; }

	/* ── Right sidebar: state viewer ─────────────────────── */
	.state-scalars {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.35rem;
	}
	.scalar-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.75rem;
		gap: 0.5rem;
	}
	.scalar-key { color: var(--text-muted, #94a3b8); flex-shrink: 0; }
	.scalar-val { font-size: 0.72rem; font-family: monospace; }

	.state-section { border-bottom: 1px solid rgba(255,255,255,0.05); }
	.state-section-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font-family: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		padding: 0.4rem 0;
		text-align: left;
	}
	.state-section-toggle:hover { color: var(--text, #e2e8f0); }
	.state-key { font-weight: 600; flex: 1; }
	.state-count { font-size: 0.7rem; }
	.state-toggle-icon { font-size: 0.6rem; color: var(--text-muted, #94a3b8); }
	.state-json {
		font-size: 0.7rem;
		max-height: 300px;
		margin-bottom: 0.35rem;
	}

	/* ── Chat log ────────────────────────────────────────── */
	.chat-log { display: flex; flex-direction: column; gap: 0.45rem; max-height: 400px; overflow-y: auto; scrollbar-width: thin; }
	.chat-msg {
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		background: rgba(255,255,255,0.02);
		border: 1px solid rgba(255,255,255,0.06);
		font-size: 0.78rem;
	}
	.chat-msg.consumed { opacity: 0.6; }
	.chat-msg-header { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; }
	.chat-username { font-weight: 600; font-size: 0.75rem; }
	.chat-time { }
	.consumed-tag {
		font-size: 0.62rem;
		padding: 0.06rem 0.35rem;
		border-radius: 999px;
		background: rgba(74,222,128,0.12);
		color: #4ade80;
		margin-left: auto;
	}
	.chat-text { margin: 0; line-height: 1.45; }

	/* ── Shared ──────────────────────────────────────────── */
	.muted-sm { font-size: 0.75rem; color: var(--text-muted, #94a3b8); }
	code.muted-sm { font-family: monospace; }
	.mono { font-family: monospace; }

	.badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		text-transform: uppercase;
	}
	.status-lobby     { background: rgba(148,163,184,0.15); color: #94a3b8; }
	.status-active    { background: rgba(74,222,128,0.15); color: #4ade80; }
	.status-completed { background: rgba(124,156,255,0.15); color: var(--accent, #7c9cff); }
	.mode-solo  { background: rgba(245,200,66,0.15); color: #f5c842; }
	.mode-party { background: rgba(124,156,255,0.15); color: var(--accent, #7c9cff); }

	/* ── Responsive ──────────────────────────────────────── */
	@media (max-width: 1200px) {
		.debug-grid { grid-template-columns: 200px minmax(0, 1fr); }
		.right-sidebar { display: none; }
	}
	@media (max-width: 768px) {
		.debug-grid { grid-template-columns: 1fr; }
		.left-sidebar { position: static; max-height: none; }
	}
</style>
