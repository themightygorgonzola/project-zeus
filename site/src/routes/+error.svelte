<script lang="ts">
	import { page } from '$app/state';

	const STATUS_INFO: Record<number, { icon: string; title: string; body: string; action: { label: string; href: string } }> = {
		404: {
			icon: '🗺',
			title: 'Lost in the Wilds',
			body: "That path leads nowhere. The page you're looking for doesn't exist or may have been moved.",
			action: { label: 'Back to Adventures', href: '/adventures' }
		},
		403: {
			icon: '⛔',
			title: 'Entry Forbidden',
			body: "You don't have permission to enter this place. If you think that's a mistake, try signing in with a different account.",
			action: { label: 'Go Home', href: '/' }
		},
		401: {
			icon: '🔒',
			title: 'You Must Sign In',
			body: 'This area requires you to be signed in before you can proceed.',
			action: { label: 'Sign In', href: '/auth/login' }
		},
		500: {
			icon: '💥',
			title: 'Something Went Wrong',
			body: "An unexpected error struck from the shadows. It's been noted — try again in a moment.",
			action: { label: 'Go Home', href: '/' }
		}
	};

	const status = $derived(page.status);
	const info = $derived(
		STATUS_INFO[status] ?? {
			icon: '⚠',
			title: `Unexpected Error (${status})`,
			body: page.error?.message ?? 'An unrecognised error occurred.',
			action: { label: 'Go Home', href: '/' }
		}
	);
</script>

<svelte:head>
	<title>{info.title} · Adventure Awaits</title>
</svelte:head>

<div class="error-page">
	<div class="error-card">
		<div class="error-icon">{info.icon}</div>
		<div class="status-chip">{status}</div>
		<h1>{info.title}</h1>
		<p class="error-body">{info.body}</p>

		{#if status !== 500 && page.error?.message && page.error.message !== info.body}
			<p class="error-detail">{page.error.message}</p>
		{/if}

		<div class="error-actions">
			<a href={info.action.href} class="btn btn-primary">{info.action.label}</a>
			<a href="/adventures" class="btn btn-ghost">My Adventures</a>
		</div>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: calc(100vh - 60px);
		padding: 2rem;
	}

	.error-card {
		text-align: center;
		max-width: 480px;
		width: 100%;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 3rem 2.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.error-icon {
		font-size: 4rem;
		line-height: 1;
		margin-bottom: 0.5rem;
	}

	.status-chip {
		display: inline-block;
		padding: 0.2em 0.75em;
		border-radius: 999px;
		background: rgba(124, 156, 255, 0.12);
		border: 1px solid rgba(124, 156, 255, 0.25);
		color: var(--accent);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	h1 {
		margin: 0;
		font-size: 1.75rem;
	}

	.error-body {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.6;
		font-size: 0.95rem;
	}

	.error-detail {
		margin: 0;
		font-size: 0.82rem;
		font-family: 'JetBrains Mono', monospace;
		color: var(--danger);
		background: rgba(255, 109, 138, 0.08);
		border: 1px solid rgba(255, 109, 138, 0.2);
		border-radius: 8px;
		padding: 0.5rem 0.9rem;
		word-break: break-word;
	}

	.error-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: center;
		margin-top: 0.5rem;
	}
</style>
