<script lang="ts">
	import { enhance } from '$app/forms';

	let { data } = $props();

	type Tab = 'overview' | 'users' | 'adventures' | 'sessions' | 'cleanup';
	let activeTab = $state<Tab>('overview');

	function formatDate(ts: number) {
		return new Date(ts).toLocaleString();
	}

	function isExpired(ts: number) {
		return ts <= Date.now();
	}

	function relativeTime(ts: number) {
		const diff = ts - Date.now();
		const abs = Math.abs(diff);
		const sign = diff < 0 ? '-' : '+';
		const d = Math.floor(abs / 86400000);
		const h = Math.floor((abs % 86400000) / 3600000);
		if (d > 0) return `${sign}${d}d ${h}h`;
		const m = Math.floor((abs % 3600000) / 60000);
		return `${sign}${h}h ${m}m`;
	}
</script>

<svelte:head>
	<title>Admin Panel</title>
</svelte:head>

<div class="admin-shell">
	<!-- Header -->
	<div class="admin-header">
		<div class="admin-title">
			<span class="admin-icon">⚙</span>
			<div>
				<h1>Admin Panel</h1>
				<span class="admin-sub">Logged in as {data.user.username}</span>
			</div>
		</div>
		<a href="/adventures" class="back-link">← Back to App</a>
	</div>

	<!-- Stats row -->
	<div class="stats-row">
		<div class="stat-card">
			<span class="stat-value">{data.stats.totalUsers}</span>
			<span class="stat-label">Total Users</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.testUsers}</span>
			<span class="stat-label">Test Accounts</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.totalAdventures}</span>
			<span class="stat-label">Adventures</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.stats.activeSessions}</span>
			<span class="stat-label">Active Sessions</span>
		</div>
		<div class="stat-card warn">
			<span class="stat-value">{data.stats.expiredSessions}</span>
			<span class="stat-label">Expired Sessions</span>
		</div>
	</div>

	<!-- Tab bar -->
	<div class="tab-bar">
		{#each (['overview', 'users', 'adventures', 'sessions', 'cleanup'] as Tab[]) as tab}
			<button
				class="tab-btn"
				class:active={activeTab === tab}
				onclick={() => (activeTab = tab)}
			>
				{tab.charAt(0).toUpperCase() + tab.slice(1)}
			</button>
		{/each}
	</div>

	<!-- ── OVERVIEW ───────────────────────────────────────────── -->
	{#if activeTab === 'overview'}
		<div class="panel">
			<h2>Recent Adventures</h2>
			<table class="data-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Owner</th>
						<th>Mode</th>
						<th>Status</th>
						<th>Members</th>
						<th>Created</th>
					</tr>
				</thead>
				<tbody>
					{#each data.adventures.slice(-10).reverse() as adv}
						<tr>
							<td class="mono">{adv.name}</td>
							<td>{adv.ownerName}</td>
							<td><span class="badge mode-{adv.mode}">{adv.mode}</span></td>
							<td><span class="badge status-{adv.status}">{adv.status}</span></td>
							<td>{adv.memberCount}</td>
							<td class="muted">{formatDate(adv.createdAt)}</td>
						</tr>
					{/each}
					{#if data.adventures.length === 0}
						<tr><td colspan="6" class="empty">No adventures yet.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

	<!-- ── USERS ──────────────────────────────────────────────── -->
	{:else if activeTab === 'users'}
		<div class="panel">
			<h2>All Users ({data.users.length})</h2>
			<table class="data-table">
				<thead>
					<tr>
						<th>Avatar</th>
						<th>Username</th>
						<th>Email</th>
						<th>Flags</th>
						<th>Created</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as u}
						<tr class:admin-row={u.isAdmin}>
							<td>
								{#if u.avatarUrl}
									<img src={u.avatarUrl} alt="" class="row-avatar" />
								{:else}
									<div class="row-avatar placeholder">?</div>
								{/if}
							</td>
							<td>{u.username}</td>
							<td class="mono muted">{u.email ?? '—'}</td>
							<td>
								{#if u.isAdmin}<span class="badge admin">admin</span>{/if}
								{#if u.isTestUser && !u.isAdmin}<span class="badge test">test</span>{/if}
							</td>
							<td class="muted">{formatDate(u.createdAt)}</td>
							<td>
								{#if !u.isAdmin}
									<form method="POST" action="?/deleteUser" use:enhance>
										<input type="hidden" name="id" value={u.id} />
										<button
											type="submit"
											class="action-btn danger"
											onclick={(e) => {
												if (!confirm(`Delete ${u.username}? This will also delete their adventures and sessions.`))
													e.preventDefault();
											}}
										>Delete</button>
									</form>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
						</tr>
					{/each}
					{#if data.users.length === 0}
						<tr><td colspan="6" class="empty">No users.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

	<!-- ── ADVENTURES ─────────────────────────────────────────── -->
	{:else if activeTab === 'adventures'}
		<div class="panel">
			<h2>All Adventures ({data.adventures.length})</h2>
			<table class="data-table">
				<thead>
					<tr>
						<th>ID</th>
						<th>Name</th>
						<th>Owner</th>
						<th>Mode</th>
						<th>Status</th>
						<th>Members</th>
						<th>Created</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.adventures.slice().reverse() as adv}
						<tr>
							<td class="mono muted id-cell">{adv.id.slice(0, 10)}…</td>
							<td>{adv.name}</td>
							<td>{adv.ownerName}</td>
							<td><span class="badge mode-{adv.mode}">{adv.mode}</span></td>
							<td><span class="badge status-{adv.status}">{adv.status}</span></td>
							<td>{adv.memberCount}</td>
							<td class="muted">{formatDate(adv.createdAt)}</td>
							<td class="action-cell">
								{#if adv.status !== 'lobby'}
									<form method="POST" action="?/resetAdventure" use:enhance>
										<input type="hidden" name="id" value={adv.id} />
										<button type="submit" class="action-btn warn">Reset</button>
									</form>
								{/if}
								<form method="POST" action="?/deleteAdventure" use:enhance>
									<input type="hidden" name="id" value={adv.id} />
									<button
										type="submit"
										class="action-btn danger"
										onclick={(e) => {
											if (!confirm(`Delete adventure "${adv.name}"?`)) e.preventDefault();
										}}
									>Delete</button>
								</form>
							</td>
						</tr>
					{/each}
					{#if data.adventures.length === 0}
						<tr><td colspan="8" class="empty">No adventures yet.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

	<!-- ── SESSIONS ───────────────────────────────────────────── -->
	{:else if activeTab === 'sessions'}
		<div class="panel">
			<h2>All Sessions ({data.sessions.length})</h2>
			<p class="section-hint">
				{data.stats.activeSessions} active · {data.stats.expiredSessions} expired
			</p>
			<table class="data-table">
				<thead>
					<tr>
						<th>Token (prefix)</th>
						<th>User</th>
						<th>Email</th>
						<th>Expires</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sessions as s}
						<tr class:expired-row={isExpired(s.expiresAt)}>
							<td class="mono muted">{s.id.slice(0, 12)}…</td>
							<td>{s.username}</td>
							<td class="mono muted">{s.email ?? '—'}</td>
							<td class:danger-text={isExpired(s.expiresAt)}>
								{relativeTime(s.expiresAt)}
								<span class="muted">&nbsp;({isExpired(s.expiresAt) ? 'expired' : 'valid'})</span>
							</td>
							<td>
								<form method="POST" action="?/invalidateSession" use:enhance>
									<input type="hidden" name="id" value={s.id} />
									<button type="submit" class="action-btn warn">Invalidate</button>
								</form>
							</td>
						</tr>
					{/each}
					{#if data.sessions.length === 0}
						<tr><td colspan="5" class="empty">No sessions.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

	<!-- ── CLEANUP ────────────────────────────────────────────── -->
	{:else if activeTab === 'cleanup'}
		<div class="panel">
			<h2>⚠ Cleanup &amp; Danger Zone</h2>
			<p class="section-hint">These actions are irreversible. Use with care.</p>

			<div class="cleanup-grid">
				<!-- Purge expired sessions -->
				<div class="cleanup-card">
					<h3>Purge Expired Sessions</h3>
					<p>Delete all sessions that have already passed their expiry. Users with expired sessions are already logged out.</p>
					<form method="POST" action="?/purgeExpiredSessions" use:enhance>
						<button type="submit" class="action-btn warn full-width">
							Purge {data.stats.expiredSessions} Expired Sessions
						</button>
					</form>
				</div>

				<!-- Clear all sessions -->
				<div class="cleanup-card danger-card">
					<h3>Clear ALL Sessions</h3>
					<p>Force every user to re-login. Useful after a security concern or major update.</p>
					<form method="POST" action="?/clearAllSessions" use:enhance>
						<button
							type="submit"
							class="action-btn danger full-width"
							onclick={(e) => {
								if (!confirm('Force ALL users to re-login? This deletes every session.'))
									e.preventDefault();
							}}
						>
							Clear All {data.sessions.length} Sessions
						</button>
					</form>
				</div>

				<!-- Delete lobby adventures -->
				<div class="cleanup-card">
					<h3>Delete Lobby Adventures</h3>
					<p>Remove all adventures still stuck in lobby status (not yet started).</p>
					<form method="POST" action="?/deleteAdventuresByStatus" use:enhance>
						<input type="hidden" name="status" value="lobby" />
						<button
							type="submit"
							class="action-btn warn full-width"
							onclick={(e) => {
								const n = data.adventures.filter((a) => a.status === 'lobby').length;
								if (!confirm(`Delete ${n} lobby adventure(s)?`)) e.preventDefault();
							}}
						>
							Delete {data.adventures.filter((a) => a.status === 'lobby').length} Lobby Adventures
						</button>
					</form>
				</div>

				<!-- Delete completed adventures -->
				<div class="cleanup-card">
					<h3>Delete Completed Adventures</h3>
					<p>Clean up finished adventures that are no longer needed.</p>
					<form method="POST" action="?/deleteAdventuresByStatus" use:enhance>
						<input type="hidden" name="status" value="completed" />
						<button
							type="submit"
							class="action-btn warn full-width"
							onclick={(e) => {
								const n = data.adventures.filter((a) => a.status === 'completed').length;
								if (!confirm(`Delete ${n} completed adventure(s)?`)) e.preventDefault();
							}}
						>
							Delete {data.adventures.filter((a) => a.status === 'completed').length} Completed Adventures
						</button>
					</form>
				</div>

				<!-- Delete all test-user data -->
				<div class="cleanup-card danger-card">
					<h3>Delete All Test Data</h3>
					<p>
						Delete all adventures and sessions belonging to test accounts. The test accounts themselves
						are preserved so you can still log in. World data and non-test adventures are untouched.
					</p>
					<form method="POST" action="?/deleteTestData" use:enhance>
						<button
							type="submit"
							class="action-btn danger full-width"
							onclick={(e) => {
								if (!confirm('Delete all adventures and sessions created by test accounts?'))
									e.preventDefault();
							}}
						>
							Delete Test Account Data
						</button>
					</form>
				</div>

				<!-- Delete ALL adventures -->
				<div class="cleanup-card danger-card">
					<h3>Delete ALL Adventures</h3>
					<p>Wipe every single adventure from the database regardless of status or owner.</p>
					<div class="multi-form">
						{#each (['lobby', 'active', 'completed'] as const) as status}
							<form method="POST" action="?/deleteAdventuresByStatus" use:enhance>
								<input type="hidden" name="status" value={status} />
								<button
									type="submit"
									class="action-btn danger"
									onclick={(e) => {
										const n = data.adventures.filter((a) => a.status === status).length;
										if (!confirm(`Delete all ${status} adventures (${n})?`)) e.preventDefault();
									}}
								>
									Delete all {status} ({data.adventures.filter((a) => a.status === status).length})
								</button>
							</form>
						{/each}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.admin-shell {
		width: min(1300px, calc(100vw - 32px));
		margin: 0 auto;
		padding: 2rem 0 4rem;
	}

	/* ── Header ──────────────────────────────────────────── */
	.admin-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.75rem;
	}

	.admin-title {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.admin-icon {
		font-size: 2.5rem;
		opacity: 0.85;
	}

	.admin-title h1 {
		margin: 0;
		font-size: 1.8rem;
	}

	.admin-sub {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.back-link {
		font-size: 0.9rem;
		color: var(--text-muted);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--text);
	}

	/* ── Stats row ───────────────────────────────────────── */
	.stats-row {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.75rem;
		flex-wrap: wrap;
	}

	.stat-card {
		flex: 1;
		min-width: 110px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.stat-card.warn {
		border-color: rgba(255, 211, 107, 0.3);
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 700;
		color: var(--accent);
		line-height: 1;
	}

	.stat-label {
		font-size: 0.78rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* ── Tab bar ─────────────────────────────────────────── */
	.tab-bar {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.5rem;
	}

	.tab-btn {
		padding: 0.6rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		color: var(--text-muted);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		text-transform: capitalize;
	}

	.tab-btn:hover {
		color: var(--text);
	}

	.tab-btn.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	/* ── Panel ───────────────────────────────────────────── */
	.panel {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem 1.75rem;
	}

	.panel h2 {
		margin: 0 0 1rem;
		font-size: 1.15rem;
	}

	.section-hint {
		color: var(--text-muted);
		font-size: 0.875rem;
		margin: -0.5rem 0 1rem;
	}

	/* ── Tables ──────────────────────────────────────────── */
	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.data-table th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.data-table td {
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid rgba(120, 164, 255, 0.07);
		vertical-align: middle;
	}

	.data-table tr:last-child td {
		border-bottom: none;
	}

	.data-table tr:hover td {
		background: rgba(255, 255, 255, 0.025);
	}

	.admin-row td {
		background: rgba(255, 100, 80, 0.04);
	}

	.expired-row td {
		opacity: 0.55;
	}

	.mono {
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.8em;
	}

	.muted {
		color: var(--text-muted);
	}

	.danger-text {
		color: var(--danger);
	}

	.id-cell {
		max-width: 110px;
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem 0;
	}

	/* ── Badges ──────────────────────────────────────────── */
	.badge {
		display: inline-block;
		padding: 0.2em 0.55em;
		border-radius: 6px;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.badge.admin {
		background: rgba(255, 100, 80, 0.18);
		color: #ff9980;
	}

	.badge.test {
		background: rgba(124, 156, 255, 0.15);
		color: var(--accent);
	}

	.badge.status-lobby {
		background: rgba(255, 211, 107, 0.15);
		color: var(--warning);
	}

	.badge.status-active {
		background: rgba(52, 211, 162, 0.15);
		color: var(--accent-2);
	}

	.badge.status-completed {
		background: rgba(157, 178, 209, 0.12);
		color: var(--text-muted);
	}

	.badge.mode-solo {
		background: rgba(124, 156, 255, 0.12);
		color: var(--accent);
	}

	.badge.mode-multiplayer {
		background: rgba(52, 211, 162, 0.12);
		color: var(--accent-2);
	}

	/* ── Avatars ─────────────────────────────────────────── */
	.row-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1px solid var(--border);
		display: block;
	}

	.row-avatar.placeholder {
		background: rgba(255, 255, 255, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	/* ── Action buttons ──────────────────────────────────── */
	.action-btn {
		padding: 0.35rem 0.85rem;
		border-radius: 7px;
		border: 1px solid transparent;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.action-btn.danger {
		background: rgba(255, 109, 138, 0.15);
		border-color: rgba(255, 109, 138, 0.3);
		color: var(--danger);
	}

	.action-btn.danger:hover {
		background: rgba(255, 109, 138, 0.28);
	}

	.action-btn.warn {
		background: rgba(255, 211, 107, 0.12);
		border-color: rgba(255, 211, 107, 0.25);
		color: var(--warning);
	}

	.action-btn.warn:hover {
		background: rgba(255, 211, 107, 0.22);
	}

	.action-btn.full-width {
		width: 100%;
		padding: 0.65rem 1rem;
		font-size: 0.875rem;
		justify-content: center;
	}

	.action-cell {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	/* ── Cleanup grid ────────────────────────────────────── */
	.cleanup-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1.25rem;
	}

	.cleanup-card {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.25rem 1.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.cleanup-card.danger-card {
		border-color: rgba(255, 109, 138, 0.25);
		background: rgba(255, 109, 138, 0.04);
	}

	.cleanup-card h3 {
		margin: 0;
		font-size: 1rem;
	}

	.cleanup-card p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
		line-height: 1.5;
	}

	.multi-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
