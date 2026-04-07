<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { user } = data;

	// Derive account type from available OAuth IDs
	const accountType: string = user.googleId
		? 'Google'
		: user.discordId
			? 'Discord'
			: user.isTestUser
				? 'Guest'
				: 'Adventurer';

	// Format the createdAt Unix timestamp (milliseconds)
	const memberSince = new Date(user.createdAt).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
</script>

<svelte:head>
	<title>Project Nornyx | Profile</title>
</svelte:head>

<div class="profile-page">

	<!-- ── Identity Card ─────────────────────────────────── -->
	<section class="identity-card">
		<div class="avatar-wrap">
			{#if user.avatarUrl}
				<img src={user.avatarUrl} alt="Avatar for {user.username}" class="avatar" />
			{:else}
				<div class="avatar avatar-placeholder">
					{user.username.charAt(0).toUpperCase()}
				</div>
			{/if}
		</div>

		<div class="identity-body">
			<h1 class="profile-username">{user.username}</h1>
			<div class="profile-badges">
				<span class="badge badge-account">{accountType}</span>
				{#if user.isAdmin}
					<span class="badge badge-admin">Admin</span>
				{/if}
				{#if user.isTestUser}
					<span class="badge badge-test">Test User</span>
				{/if}
			</div>
			{#if user.email}
				<p class="profile-email">{user.email}</p>
			{/if}
			<p class="profile-since">Adventurer since {memberSince}</p>
		</div>
	</section>

	<!-- ── Quick Actions ─────────────────────────────────── -->
	<section class="actions-section">
		<h2 class="section-label">Your Adventures</h2>
		<div class="action-grid">
			<a href="/adventures" class="action-card">
				<span class="action-icon">⚔️</span>
				<div class="action-body">
					<h3>My Adventures</h3>
					<p>View all your active and past campaigns.</p>
				</div>
				<span class="action-chevron">→</span>
			</a>
			<a href="/adventures/new" class="action-card">
				<span class="action-icon">✨</span>
				<div class="action-body">
					<h3>Start New Adventure</h3>
					<p>Generate a new world and begin a fresh campaign.</p>
				</div>
				<span class="action-chevron">→</span>
			</a>
		</div>
	</section>

	<!-- ── Account Actions ───────────────────────────────── -->
	<section class="account-section">
		<h2 class="section-label">Account</h2>
		<div class="account-card">
			<div class="account-row">
				<div class="account-row-label">
					<span class="account-row-icon">🔐</span>
					<span>Sign out of Project Nornyx</span>
				</div>
				<form method="POST" action="/auth/logout">
					<button type="submit" class="btn btn-ghost btn-sm">Sign Out</button>
				</form>
			</div>
		</div>
	</section>

</div>

<style>
	.profile-page {
		width: min(800px, calc(100vw - 32px));
		margin: 0 auto;
		padding: 3rem 0 5rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	/* ── Identity card ─────────────────────────────── */
	.identity-card {
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
	}

	.avatar-wrap {
		flex-shrink: 0;
	}

	.avatar {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		border: 2px solid var(--border);
		display: block;
	}

	.avatar-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		color: var(--accent);
		font-size: 2rem;
		font-weight: 700;
		border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.identity-body {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.profile-username {
		font-family: 'Cinzel Decorative', serif;
		font-size: clamp(1.3rem, 3vw, 1.9rem);
		font-weight: 700;
		margin: 0;
		color: var(--text);
		line-height: 1.2;
	}

	.profile-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.1rem;
	}

	.badge {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1.4;
	}

	.badge-account {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.badge-admin {
		background: color-mix(in srgb, var(--danger) 15%, transparent);
		color: var(--danger);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
	}

	.badge-test {
		background: color-mix(in srgb, var(--text-muted) 12%, transparent);
		color: var(--text-muted);
		border: 1px solid var(--border);
	}

	.profile-email {
		font-size: 0.88rem;
		color: var(--text-muted);
		margin: 0;
	}

	.profile-since {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
	}

	/* ── Sections ──────────────────────────────────── */
	.section-label {
		font-family: var(--font-display);
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		margin: 0 0 0.75rem;
	}

	/* ── Action cards ──────────────────────────────── */
	.action-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem;
	}

	.action-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: var(--text);
		transition: border-color 0.15s, background 0.15s;
		backdrop-filter: blur(var(--blur-glass));
	}

	.action-card:hover {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 6%, transparent);
		text-decoration: none;
	}

	.action-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.action-body {
		flex: 1;
	}

	.action-body h3 {
		margin: 0 0 0.2rem;
		font-size: 0.95rem;
		font-weight: 700;
	}

	.action-body p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.action-chevron {
		font-size: 1.1rem;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	/* ── Account card ──────────────────────────────── */
	.account-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		backdrop-filter: blur(var(--blur-glass));
		overflow: hidden;
	}

	.account-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		gap: 1rem;
	}

	.account-row-label {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.account-row-icon {
		font-size: 1rem;
	}

	.btn-sm {
		padding: 0.4rem 0.85rem;
		font-size: 0.85rem;
	}

	/* ── Responsive ────────────────────────────────── */
	@media (max-width: 560px) {
		.identity-card {
			flex-direction: column;
			align-items: flex-start;
			gap: 1.25rem;
		}

		.profile-page {
			padding: 2rem 0 4rem;
		}
	}
</style>
