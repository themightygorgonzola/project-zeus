<script lang="ts">
	import GlassPanel from '$components/GlassPanel.svelte';
	import type { PlayerCharacter, NPC, Quest, Location, TurnRecord } from '$lib/game/types';

	let { data } = $props();

	const { adventure, members, gameState, stats, allTurns, allChat, currentUserId } = data;

	// ── Transcript hydration ──────────────────────────────────────────────────
	type MsgKind = 'party' | 'gm-narration' | 'mechanic' | 'system' | 'dice-roll' | 'error';

	interface TranscriptMsg {
		id: string;
		kind: MsgKind;
		username: string;
		text: string;
		ts: number;
	}

	function buildTranscript(): TranscriptMsg[] {
		const items: Array<{ ts: number; src: 'turn' | 'chat'; data: TurnRecord | typeof allChat[0] }> = [
			...allTurns.map((t: TurnRecord) => ({ ts: t.timestamp, src: 'turn' as const, data: t })),
			...allChat.map((c: typeof allChat[0]) => ({ ts: c.createdAt, src: 'chat' as const, data: c }))
		];
		items.sort((a, b) => a.ts - b.ts);

		const out: TranscriptMsg[] = [];
		for (const item of items) {
			if (item.src === 'chat') {
				const c = item.data as typeof allChat[0];
				out.push({ id: c.id, kind: 'party', username: c.username, text: c.text, ts: c.createdAt });
			} else {
				const t = item.data as TurnRecord;
				if (t.narrativeText) {
					out.push({ id: `${t.id}-gm`, kind: 'gm-narration', username: 'Game Master', text: t.narrativeText, ts: t.timestamp });
				}
				if (t.mechanicResults && (t.mechanicResults as Array<{ label: string; dice?: { total: number } }>).length > 0) {
					const summary = (t.mechanicResults as Array<{ label: string; dice?: { total: number }; success?: boolean }>)
						.map((r) => `${r.label}: ${r.dice?.total ?? ''}${r.success != null ? (r.success ? ' ✓' : ' ✗') : ''}`)
						.join(' · ');
					out.push({ id: `${t.id}-mech`, kind: 'mechanic', username: 'System', text: summary, ts: t.timestamp + 0.5 });
				}
			}
		}
		return out;
	}

	const transcript = buildTranscript();

	// Transcript collapse/expand
	const TRANSCRIPT_PREVIEW = 20;
	let transcriptExpanded = $state(false);
	let visibleMessages = $derived(transcriptExpanded ? transcript : transcript.slice(-TRANSCRIPT_PREVIEW));

	// ── Helpers ───────────────────────────────────────────────────────────────
	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}

	function capitalize(s: string): string {
		return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
	}

	function classLabel(pc: PlayerCharacter): string {
		if (!pc.classes || pc.classes.length === 0) return `Level ${pc.level}`;
		return pc.classes.map((c) => `${capitalize(c.name)} ${c.level}`).join(' / ');
	}

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
	}

	// NPCs sorted: bosses first, then hostile, then others
	const npcRoleOrder: Record<string, number> = { boss: 0, hostile: 1, ally: 2, companion: 3, 'quest-giver': 4, merchant: 5, neutral: 6 };
	const sortedNpcs = [...(gameState.npcs ?? [])].sort(
		(a: NPC, b: NPC) => (npcRoleOrder[a.role] ?? 9) - (npcRoleOrder[b.role] ?? 9)
	);

	const questsCompleted = (gameState.quests ?? []).filter((q: Quest) => q.status === 'completed');
	const questsFailed = (gameState.quests ?? []).filter((q: Quest) => q.status === 'failed');
	const questsUnresolved = (gameState.quests ?? []).filter(
		(q: Quest) => q.status === 'active' || q.status === 'available'
	);

	const characters: PlayerCharacter[] = gameState.characters ?? [];
	const locations: Location[] = gameState.locations ?? [];
</script>

<svelte:head>
	<title>{adventure.name} — Chronicle</title>
</svelte:head>

<div class="summary-page">

	<!-- ── Hero Banner ────────────────────────────────────────────────────── -->
	<div class="hero-banner">
		<div class="hero-inner">
			<a href="/adventures" class="back-link">← My Adventures</a>
			<div class="hero-badges">
				<span class="badge badge-completed">Completed</span>
				<span class="badge badge-{adventure.mode}">{adventure.mode}</span>
			</div>
			<h1 class="hero-title">{adventure.name}</h1>
			<p class="hero-meta">
				Completed {formatDate(adventure.updatedAt)}
				· Day {stats.daysElapsed} reached
				{#if adventure.worldSeed}· World: {adventure.worldSeed}{/if}
			</p>
		</div>
	</div>

	<!-- ── Stats Bar ──────────────────────────────────────────────────────── -->
	<div class="stats-bar">
		<div class="stat-pill">
			<span class="stat-icon">⏱</span>
			<span class="stat-value">{stats.hoursPlayed}h {stats.minutesPlayed}m</span>
			<span class="stat-label">Time Played</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">🎲</span>
			<span class="stat-value">{stats.totalTurns}</span>
			<span class="stat-label">Turns</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">💬</span>
			<span class="stat-value">{stats.totalMessages}</span>
			<span class="stat-label">Messages</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">⚔️</span>
			<span class="stat-value">{stats.enemiesDefeated}</span>
			<span class="stat-label">Enemies Defeated</span>
		</div>
		{#if stats.bossesDefeated > 0}
			<div class="stat-pill stat-pill-accent">
				<span class="stat-icon">👑</span>
				<span class="stat-value">{stats.bossesDefeated}</span>
				<span class="stat-label">Bosses Slain</span>
			</div>
		{/if}
		<div class="stat-pill">
			<span class="stat-icon">📜</span>
			<span class="stat-value">{stats.questsCompleted}</span>
			<span class="stat-label">Quests Done</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">🗺️</span>
			<span class="stat-value">{stats.locationsVisited}/{stats.locationsTotal}</span>
			<span class="stat-label">Locations</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">🌟</span>
			<span class="stat-value">{stats.totalXp.toLocaleString()}</span>
			<span class="stat-label">Total XP</span>
		</div>
		<div class="stat-pill">
			<span class="stat-icon">💰</span>
			<span class="stat-value">{stats.totalGold} gp</span>
			<span class="stat-label">Gold</span>
		</div>
		{#if stats.itemsAcquired > 0}
			<div class="stat-pill">
				<span class="stat-icon">🎒</span>
				<span class="stat-value">{stats.itemsAcquired}</span>
				<span class="stat-label">Items Found</span>
			</div>
		{/if}
		{#if stats.alliesLost > 0}
			<div class="stat-pill stat-pill-danger">
				<span class="stat-icon">💀</span>
				<span class="stat-value">{stats.alliesLost}</span>
				<span class="stat-label">Allies Lost</span>
			</div>
		{/if}
	</div>

	<div class="content-grid">

		<!-- ── Party ──────────────────────────────────────────────────────── -->
		{#if characters.length > 0}
			<section class="section-full">
				<h2 class="section-heading">The Party</h2>
				<div class="party-grid">
					{#each characters as pc (pc.id)}
						{@const member = members.find((m: { userId: string }) => m.userId === pc.userId)}
						<GlassPanel padding="1.25rem">
							<div class="pc-card">
								<div class="pc-header">
									<div class="pc-avatar" style="background: color-mix(in srgb, var(--accent) 20%, var(--surface));">
										<span class="pc-initials">{initials(pc.name)}</span>
									</div>
									<div class="pc-identity">
										<h3 class="pc-name">{pc.name}</h3>
										<p class="pc-sub">{capitalize(pc.race)} · {classLabel(pc)}</p>
										{#if member}
											<p class="pc-player text-muted">Played by {member.username}</p>
										{/if}
									</div>
								</div>

								<div class="pc-stats-row">
									<div class="pc-stat">
										<span class="pc-stat-val">{pc.xp?.toLocaleString() ?? 0}</span>
										<span class="pc-stat-lbl">XP</span>
									</div>
									<div class="pc-stat">
										<span class="pc-stat-val">{pc.hp}/{pc.maxHp}</span>
										<span class="pc-stat-lbl">HP</span>
									</div>
									<div class="pc-stat">
										<span class="pc-stat-val">{pc.ac}</span>
										<span class="pc-stat-lbl">AC</span>
									</div>
									<div class="pc-stat">
										<span class="pc-stat-val">{pc.gold ?? 0} gp</span>
										<span class="pc-stat-lbl">Gold</span>
									</div>
								</div>

								{#if pc.dead}
									<p class="pc-status-dead">⚰️ Fallen in battle</p>
								{:else if pc.hp === 0 && pc.stable}
									<p class="pc-status-stable">💤 Stabilized</p>
								{/if}

								{#if pc.backstory}
									<details class="pc-backstory-details">
										<summary class="pc-backstory-summary">Backstory</summary>
										<p class="pc-backstory-text">{pc.backstory}</p>
									</details>
								{/if}

								{#if pc.inventory && pc.inventory.length > 0}
									<div class="pc-inventory">
										<p class="pc-inv-label">Carried ({pc.inventory.length} items)</p>
										<ul class="pc-inv-list">
											{#each pc.inventory.slice(0, 5) as item (item.id)}
												<li class="pc-inv-item">
													<span class="inv-name">{item.name}</span>
													{#if item.quantity > 1}<span class="inv-qty text-muted">×{item.quantity}</span>{/if}
												</li>
											{/each}
											{#if pc.inventory.length > 5}
												<li class="pc-inv-more text-muted">+{pc.inventory.length - 5} more…</li>
											{/if}
										</ul>
									</div>
								{/if}
							</div>
						</GlassPanel>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ── Quests ─────────────────────────────────────────────────────── -->
		{#if gameState.quests && gameState.quests.length > 0}
			<section class="section-full">
				<h2 class="section-heading">Quest Chronicle</h2>
				<div class="quests-grid">
					{#if questsCompleted.length > 0}
						<GlassPanel padding="1.25rem">
							<h3 class="quest-group-heading quest-completed">✓ Completed</h3>
							{#each questsCompleted as q (q.id)}
								<div class="quest-entry">
									<div class="quest-title-row">
										<span class="quest-name">{q.name}</span>
										{#if q.rewards}
											<span class="quest-reward text-muted">
												{#if q.rewards.xp} +{q.rewards.xp} XP{/if}
												{#if q.rewards.gold} · {q.rewards.gold} gp{/if}
											</span>
										{/if}
									</div>
									{#if q.objectives && q.objectives.length > 0}
										<ul class="quest-objectives">
											{#each q.objectives as obj (obj.id)}
												<li class="{obj.done ? 'obj-done' : 'obj-undone'}">
													<span class="obj-tick">{obj.done ? '✓' : '○'}</span>
													{obj.text}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/each}
						</GlassPanel>
					{/if}

					{#if questsFailed.length > 0}
						<GlassPanel padding="1.25rem">
							<h3 class="quest-group-heading quest-failed">✗ Failed</h3>
							{#each questsFailed as q (q.id)}
								<div class="quest-entry">
									<span class="quest-name">{q.name}</span>
									{#if q.objectives && q.objectives.length > 0}
										<ul class="quest-objectives">
											{#each q.objectives as obj (obj.id)}
												<li class="obj-undone">
													<span class="obj-tick">○</span>{obj.text}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/each}
						</GlassPanel>
					{/if}

					{#if questsUnresolved.length > 0}
						<GlassPanel padding="1.25rem">
							<h3 class="quest-group-heading quest-unresolved">◌ Unresolved</h3>
							{#each questsUnresolved as q (q.id)}
								<div class="quest-entry">
									<span class="quest-name">{q.name}</span>
								</div>
							{/each}
						</GlassPanel>
					{/if}
				</div>
			</section>
		{/if}

		<!-- ── World & NPCs ───────────────────────────────────────────────── -->
		<section class="section-full">
			<h2 class="section-heading">World & Encounters</h2>
			<div class="world-grid">

				{#if locations.length > 0}
					<GlassPanel padding="1.25rem">
						<h3 class="panel-sub-heading">🗺 Locations Discovered</h3>
						<ul class="location-list">
							{#each locations as loc (loc.id)}
								<li class="location-item {loc.visited ? 'loc-visited' : 'loc-unvisited'}">
									<span class="loc-dot"></span>
									<span class="loc-name">{loc.name}</span>
									<span class="loc-type text-muted">{loc.type}</span>
								</li>
							{/each}
						</ul>
					</GlassPanel>
				{/if}

				{#if sortedNpcs.length > 0}
					<GlassPanel padding="1.25rem">
						<h3 class="panel-sub-heading">👥 NPCs Encountered</h3>
						<div class="npc-table">
							{#each sortedNpcs as npc (npc.id)}
								<div class="npc-row">
									<span class="npc-name {npc.alive ? '' : 'npc-dead'}">{npc.name}</span>
									<span class="npc-role text-muted">{capitalize(npc.role)}</span>
									<span class="npc-status {npc.alive ? 'npc-alive' : 'npc-defeated'}">
										{npc.alive ? 'Alive' : (npc.role === 'hostile' || npc.role === 'boss') ? 'Defeated' : 'Gone'}
									</span>
								</div>
							{/each}
						</div>
					</GlassPanel>
				{/if}

			</div>
		</section>

		<!-- ── Full Transcript ────────────────────────────────────────────── -->
		<section class="section-full">
			<h2 class="section-heading">The Story</h2>
			<GlassPanel padding="1.25rem">
				{#if transcript.length > TRANSCRIPT_PREVIEW && !transcriptExpanded}
					<div class="transcript-collapsed-note">
						<span class="text-muted">Showing last {TRANSCRIPT_PREVIEW} of {transcript.length} messages</span>
						<button class="expand-btn" onclick={() => transcriptExpanded = true}>
							Show full story ({transcript.length} messages)
						</button>
					</div>
				{/if}

				<div class="transcript-scroll">
					{#each visibleMessages as msg (msg.id)}
						<div class="msg msg-{msg.kind}">
							{#if msg.kind === 'gm-narration'}
								<p class="msg-text msg-gm-text">{msg.text}</p>
							{:else if msg.kind === 'mechanic'}
								<p class="msg-text msg-mechanic-text">⚙ {msg.text}</p>
							{:else if msg.kind === 'system'}
								<p class="msg-text msg-system-text">{msg.text}</p>
							{:else}
								<div class="msg-row">
									<span class="msg-author">{msg.username}</span>
									<p class="msg-text">{msg.text}</p>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				{#if transcriptExpanded && transcript.length > TRANSCRIPT_PREVIEW}
					<button class="expand-btn" onclick={() => transcriptExpanded = false}>
						Collapse story
					</button>
				{/if}
			</GlassPanel>
		</section>

	</div><!-- /content-grid -->
</div><!-- /summary-page -->

<style>
	/* ── Page shell ──────────────────────────────────────────────────── */
	.summary-page {
		width: min(1200px, calc(100vw - 32px));
		margin: 0 auto;
		padding: 0 0 4rem;
	}

	/* ── Hero ────────────────────────────────────────────────────────── */
	.hero-banner {
		padding: 2.5rem 0 2rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 2rem;
	}

	.hero-inner {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.back-link {
		font-size: 0.85rem;
		color: var(--text-muted);
		text-decoration: none;
		align-self: flex-start;
	}

	.back-link:hover { color: var(--accent); text-decoration: none; }

	.hero-badges {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.hero-title {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		font-family: var(--font-display);
		font-weight: 700;
		line-height: 1.2;
		padding-bottom: 0.1em;
	}

	.hero-meta {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	/* ── Stats bar ───────────────────────────────────────────────────── */
	.stats-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		margin-bottom: 2.5rem;
	}

	.stat-pill {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.65rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-width: 80px;
		text-align: center;
	}

	.stat-pill-accent { border-color: var(--accent); }
	.stat-pill-danger { border-color: var(--danger); }

	.stat-icon { font-size: 1.2rem; }
	.stat-value { font-size: 1.1rem; font-weight: 700; color: var(--text); }
	.stat-label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }

	/* ── Content grid ────────────────────────────────────────────────── */
	.content-grid {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
	}

	.section-full { display: flex; flex-direction: column; gap: 1rem; }

	.section-heading {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-muted);
	}

	/* ── Party ───────────────────────────────────────────────────────── */
	.party-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.pc-card { display: flex; flex-direction: column; gap: 0.85rem; }

	.pc-header { display: flex; align-items: flex-start; gap: 0.85rem; }

	.pc-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border: 2px solid var(--accent);
	}

	.pc-initials {
		font-size: 1rem;
		font-weight: 700;
		color: var(--accent);
		font-family: var(--font-display);
	}

	.pc-name { margin: 0; font-size: 1rem; font-weight: 700; }
	.pc-sub { margin: 0; font-size: 0.82rem; color: var(--text-muted); }
	.pc-player { margin: 0; font-size: 0.75rem; color: var(--text-muted); }
	.pc-identity { flex: 1; }

	.pc-stats-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.4rem;
		text-align: center;
	}

	.pc-stat {
		background: rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		padding: 0.35rem 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.pc-stat-val { font-size: 0.88rem; font-weight: 700; }
	.pc-stat-lbl { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; }

	.pc-status-dead { margin: 0; font-size: 0.82rem; color: var(--danger); }
	.pc-status-stable { margin: 0; font-size: 0.82rem; color: var(--text-muted); }

	.pc-backstory-details { border-top: 1px solid var(--border); padding-top: 0.65rem; }
	.pc-backstory-summary {
		font-size: 0.8rem;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
		list-style: none;
	}
	.pc-backstory-summary::-webkit-details-marker { display: none; }
	.pc-backstory-summary::before { content: '▶ '; font-size: 0.65rem; }
	details[open] .pc-backstory-summary::before { content: '▼ '; }

	.pc-backstory-text {
		margin: 0.5rem 0 0;
		font-size: 0.82rem;
		color: var(--text-muted);
		line-height: 1.55;
		font-style: italic;
	}

	.pc-inventory { border-top: 1px solid var(--border); padding-top: 0.65rem; }
	.pc-inv-label { margin: 0 0 0.35rem; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
	.pc-inv-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.2rem; }
	.pc-inv-item { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }
	.inv-name { color: var(--text); }
	.inv-qty { font-size: 0.75rem; }
	.pc-inv-more { font-size: 0.75rem; font-style: italic; }

	/* ── Quests ──────────────────────────────────────────────────────── */
	.quests-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.quest-group-heading {
		margin: 0 0 1rem;
		font-size: 0.88rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.quest-completed { color: var(--accent-2); }
	.quest-failed { color: var(--danger); }
	.quest-unresolved { color: var(--text-muted); }

	.quest-entry {
		padding: 0.65rem 0;
		border-bottom: 1px solid var(--border);
	}
	.quest-entry:last-child { border-bottom: none; }

	.quest-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
	.quest-name { font-size: 0.9rem; font-weight: 600; }
	.quest-reward { font-size: 0.75rem; white-space: nowrap; }

	.quest-objectives {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.quest-objectives li { display: flex; align-items: flex-start; gap: 0.4rem; font-size: 0.8rem; line-height: 1.4; }
	.obj-tick { flex-shrink: 0; }
	.obj-done { color: var(--text-muted); text-decoration: line-through; }
	.obj-undone { color: var(--text); }

	/* ── World / NPCs ────────────────────────────────────────────────── */
	.world-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
		align-items: start;
	}

	.panel-sub-heading {
		margin: 0 0 0.85rem;
		font-size: 0.88rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.location-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }

	.location-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.location-item:last-child { border-bottom: none; }

	.loc-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.loc-visited .loc-dot { background: var(--accent); }
	.loc-unvisited .loc-dot { background: var(--border); }
	.loc-unvisited .loc-name { color: var(--text-muted); }

	.loc-name { flex: 1; font-weight: 500; }
	.loc-type { font-size: 0.72rem; }

	.npc-table { display: flex; flex-direction: column; gap: 0.1rem; }

	.npc-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.65rem;
		align-items: center;
		padding: 0.3rem 0;
		border-bottom: 1px solid rgba(255,255,255,0.05);
		font-size: 0.83rem;
	}
	.npc-row:last-child { border-bottom: none; }

	.npc-name { font-weight: 500; }
	.npc-dead { text-decoration: line-through; color: var(--text-muted); }
	.npc-role { font-size: 0.75rem; }
	.npc-alive { color: var(--accent-2); font-size: 0.75rem; }
	.npc-defeated { color: var(--danger); font-size: 0.75rem; }

	/* ── Transcript ──────────────────────────────────────────────────── */
	.transcript-collapsed-note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0 0.85rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.85rem;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}

	.expand-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.3rem 0.75rem;
		font-size: 0.8rem;
		font-family: inherit;
		color: var(--accent);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
		margin-top: 0.75rem;
	}
	.expand-btn:hover { background: rgba(255,255,255,0.05); border-color: var(--accent); }

	.transcript-scroll {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		max-height: 600px;
		overflow-y: auto;
		scrollbar-width: thin;
		padding-right: 0.25rem;
	}

	.msg { padding: 0.5rem 0.65rem; border-radius: 10px; font-size: 0.88rem; line-height: 1.55; }

	.msg-gm-narration {
		background: rgba(255,255,255,0.03);
		border-left: 3px solid var(--accent);
	}

	.msg-mechanic {
		background: rgba(255,255,255,0.02);
		border-left: 3px solid var(--accent-2);
	}

	.msg-system {
		background: rgba(255,255,255,0.02);
		text-align: center;
		color: var(--text-muted);
		font-size: 0.8rem;
	}

	.msg-party {
		background: rgba(255,255,255,0.025);
	}

	.msg-text { margin: 0; }
	.msg-gm-text { color: var(--gm-accent, var(--text)); font-style: italic; }
	.msg-mechanic-text { color: var(--mechanic-accent, var(--text-muted)); font-size: 0.82rem; }
	.msg-system-text { color: var(--text-muted); font-size: 0.8rem; }

	.msg-row { display: flex; flex-direction: column; gap: 0.2rem; }
	.msg-author { font-size: 0.75rem; font-weight: 700; color: var(--accent); }

	/* ── Responsive ──────────────────────────────────────────────────── */
	@media (max-width: 640px) {
		.stats-bar { gap: 0.45rem; }
		.stat-pill { min-width: 68px; padding: 0.5rem 0.65rem; }
		.stat-value { font-size: 0.95rem; }
		.party-grid, .quests-grid, .world-grid { grid-template-columns: 1fr; }
	}
</style>
