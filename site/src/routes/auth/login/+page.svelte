<script lang="ts">
	import GlassPanel from '$components/GlassPanel.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Sign In</title>
</svelte:head>

<div class="auth-page">
	<GlassPanel>
		<div class="auth-container">
			<h1>Sign In</h1>
			<p class="subtitle">
				For now, use a seeded party account while branding and production auth are still in flux.
			</p>

			{#if data.devAuthEnabled}
				<div class="test-accounts">
					{#each data.testUsers as account}
						<form method="POST" action="/auth/dev-login" class="test-card">
							<input type="hidden" name="email" value={account.email} />
							<input type="hidden" name="returnTo" value={data.returnTo} />
							<div class="account-meta">
								<img src={account.avatarUrl} alt="" class="avatar" />
								<div>
									<strong>{account.username}</strong>
									<span>{account.email}</span>
								</div>
							</div>
							<button type="submit" class="provider-btn dev">Enter as {account.username}</button>
						</form>
					{/each}
				</div>

				{#if data.adminUser}
					<div class="divider"><span>Admin</span></div>
					<form method="POST" action="/auth/dev-login" class="admin-card">
						<input type="hidden" name="email" value={data.adminUser.email} />
						<input type="hidden" name="returnTo" value="/admin" />
						<div class="account-meta">
							<img src={data.adminUser.avatarUrl} alt="" class="avatar" />
							<div>
								<strong>{data.adminUser.username}</strong>
								<span class="admin-badge">⚙ Database Admin</span>
							</div>
						</div>
						<button type="submit" class="provider-btn admin">Enter Admin Panel</button>
					</form>
				{/if}
			{/if}

			<div class="divider"><span>Later</span></div>

			<div class="providers muted">
				<a href="/auth/login/google?returnTo={encodeURIComponent(data.returnTo)}" class="provider-btn google disabled" aria-disabled="true">
					Continue with Google
				</a>
				<a href="/auth/login/discord?returnTo={encodeURIComponent(data.returnTo)}" class="provider-btn discord disabled" aria-disabled="true">
					Continue with Discord
				</a>
			</div>
		</div>
	</GlassPanel>
</div>

<style>
	.auth-page {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 70vh;
	}

	.auth-container {
		text-align: center;
		padding: 2rem 3rem;
		min-width: 340px;
		max-width: 720px;
	}

	h1 {
		font-size: 1.8rem;
		margin: 0 0 0.5rem;
	}

	.subtitle {
		color: var(--text-muted);
		margin: 0 0 2rem;
		font-size: 0.95rem;
	}

	.providers {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.test-accounts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.test-card {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem;
		border-radius: 14px;
		border: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.04);
	}

	.account-meta {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		text-align: left;
	}

	.account-meta strong {
		display: block;
		margin-bottom: 0.2rem;
	}

	.account-meta span {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.08);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1.5rem 0 1rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	.provider-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.2s ease;
		cursor: pointer;
		border: 1px solid var(--border);
	}

	.provider-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}

	.provider-btn.google {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text);
	}

	.provider-btn.google:hover {
		background: rgba(255, 255, 255, 0.14);
	}

	.provider-btn.discord {
		background: rgba(88, 101, 242, 0.2);
		color: #bbc3ff;
	}

	.provider-btn.discord:hover {
		background: rgba(88, 101, 242, 0.35);
	}

	.provider-btn.dev {
		width: 100%;
		background: linear-gradient(180deg, rgba(124,156,255,0.22), rgba(124,156,255,0.08));
	}

	.provider-btn.admin {
		width: 100%;
		background: linear-gradient(180deg, rgba(255, 100, 80, 0.28), rgba(255, 100, 80, 0.1));
		color: #ffb3a7;
		border-color: rgba(255, 100, 80, 0.35);
	}

	.admin-card {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1rem 1.25rem;
		border-radius: 14px;
		border: 1px solid rgba(255, 100, 80, 0.3);
		background: rgba(255, 80, 50, 0.06);
		margin-top: 0.5rem;
	}

	.admin-badge {
		font-size: 0.8rem;
		color: #ff9980;
		letter-spacing: 0.02em;
	}

	.providers.muted {
		opacity: 0.55;
	}

	.provider-btn.disabled {
		pointer-events: none;
	}
</style>
