<script lang="ts">
	import type { Adventure } from '$types';

	interface Props {
		adventure: Adventure;
		memberCount?: number;
		isOwner?: boolean;
		onAction?: () => void;
	}

	let { adventure, memberCount = 1, isOwner = false, onAction = () => {} }: Props = $props();

	let modeClass = $derived(adventure.mode === 'solo' ? 'badge-solo' : 'badge-multiplayer');
	let statusClass = $derived(`badge-${adventure.status}`);
	let glowClass = $derived(
		adventure.status === 'active'
			? 'is-active'
			: adventure.status === 'lobby'
				? 'is-lobby'
				: ''
	);

	let href = $derived(
		adventure.status === 'lobby'
			? `/adventures/${adventure.id}/lobby`
			: `/adventures/${adventure.id}`
	);

	let actionLabel = $derived(
		adventure.status === 'lobby'
			? 'Join Lobby'
			: adventure.status === 'active'
				? 'Continue'
				: 'View'
	);

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Management state — owner-only
	let busy = $state(false);
	let confirmingDelete = $state(false);
	let errorMsg = $state('');

	async function handleComplete() {
		if (busy) return;
		busy = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/adventure/${adventure.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'completed' })
			});
			if (!res.ok) throw new Error(await res.text());
			onAction();
		} catch (e) {
			errorMsg = 'Failed to complete adventure.';
		} finally {
			busy = false;
		}
	}

	async function handleDelete() {
		if (busy) return;
		busy = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/adventure/${adventure.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await res.text());
			onAction();
		} catch (e) {
			errorMsg = 'Failed to delete adventure.';
		} finally {
			busy = false;
			confirmingDelete = false;
		}
	}
</script>

<div class="adventure-card-wrapper {glowClass}">
	<a {href} class="adventure-card">
		<div class="card-header">
			<h3>{adventure.name}</h3>
			<div class="badges">
				<span class="badge {modeClass}">{adventure.mode}</span>
				<span class="badge {statusClass}">{adventure.status}</span>
			</div>
		</div>

		<div class="card-meta">
			<span class="meta-item">
				{#if adventure.mode === 'multiplayer'}
					👥 {memberCount} player{memberCount !== 1 ? 's' : ''}
				{:else}
					🗡️ Solo
				{/if}
			</span>
			<span class="meta-item text-muted">{formatDate(adventure.createdAt)}</span>
		</div>

		<div class="card-action">
			<span class="action-label">{actionLabel} →</span>
		</div>
	</a>

	{#if isOwner}
		<div class="card-manage">
			{#if errorMsg}
				<span class="manage-error">{errorMsg}</span>
			{/if}

			{#if confirmingDelete}
				<span class="manage-label">Delete forever?</span>
				<button class="manage-btn manage-btn-danger" onclick={handleDelete} disabled={busy}>
					{busy ? '…' : 'Confirm'}
				</button>
				<button class="manage-btn" onclick={() => { confirmingDelete = false; errorMsg = ''; }} disabled={busy}>
					Cancel
				</button>
			{:else}
				{#if adventure.status !== 'completed'}
					<button class="manage-btn" onclick={handleComplete} disabled={busy} title="Mark as completed">
						{busy ? '…' : '✓ Complete'}
					</button>
				{/if}
				<button
					class="manage-btn manage-btn-delete"
					onclick={() => { confirmingDelete = true; errorMsg = ''; }}
					disabled={busy}
					title="Permanently delete this adventure"
				>
					🗑 Delete
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.adventure-card-wrapper {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
	}

	/* ── Active glow ── */
	.adventure-card-wrapper.is-active {
		border-color: color-mix(in srgb, var(--accent-2) 70%, transparent);
		animation: card-active-pulse 3.5s ease-in-out infinite;
	}

	.adventure-card-wrapper.is-active:hover {
		animation: none;
		border-color: var(--accent-2);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--accent-2) 55%, transparent),
			0 0 28px color-mix(in srgb, var(--accent-2) 35%, transparent),
			0 6px 24px rgba(0, 0, 0, 0.35);
		transform: translateY(-3px);
	}

	/* ── Lobby glow ── */
	.adventure-card-wrapper.is-lobby {
		border-color: color-mix(in srgb, var(--warning) 60%, transparent);
		animation: card-lobby-pulse 3.5s ease-in-out infinite;
	}

	.adventure-card-wrapper.is-lobby:hover {
		animation: none;
		border-color: var(--warning);
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--warning) 50%, transparent),
			0 0 24px color-mix(in srgb, var(--warning) 30%, transparent),
			0 6px 24px rgba(0, 0, 0, 0.35);
		transform: translateY(-3px);
	}

	/* ── Frozen Spire overrides (light bg — use darker glow colors) ── */
	:global([data-theme='frozen-spire']) .adventure-card-wrapper.is-active {
		border-color: rgba(26, 92, 168, 0.55);
		animation: card-active-pulse-fs 3.5s ease-in-out infinite;
	}

	:global([data-theme='frozen-spire']) .adventure-card-wrapper.is-active:hover {
		animation: none;
		border-color: #1a5ca8;
		box-shadow:
			0 0 0 1px rgba(26, 92, 168, 0.4),
			0 0 20px rgba(26, 92, 168, 0.18),
			0 6px 20px rgba(0, 0, 0, 0.1);
	}

	:global([data-theme='frozen-spire']) .adventure-card-wrapper.is-lobby {
		border-color: rgba(180, 100, 0, 0.5);
		animation: card-lobby-pulse-fs 3.5s ease-in-out infinite;
	}

	:global([data-theme='frozen-spire']) .adventure-card-wrapper.is-lobby:hover {
		animation: none;
		border-color: #a05c00;
		box-shadow:
			0 0 0 1px rgba(160, 92, 0, 0.4),
			0 0 18px rgba(160, 92, 0, 0.15);
	}

	.adventure-card-wrapper:hover {
		border-color: var(--card-hover-border);
		transform: translateY(-2px);
		box-shadow: var(--shadow);
	}

	.adventure-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
		text-decoration: none;
		color: var(--text);
		flex: 1;
	}

	.adventure-card:hover {
		text-decoration: none;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.badges {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 0.88rem;
	}

	.card-action {
		margin-top: auto;
	}

	.action-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--accent);
	}

	/* ── Management row ── */
	.card-manage {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 1.25rem;
		border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}

	.manage-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin-right: 0.25rem;
	}

	.manage-error {
		font-size: 0.78rem;
		color: var(--danger);
		flex: 1 1 100%;
		margin-bottom: 0.2rem;
	}

	.manage-btn {
		padding: 0.25rem 0.65rem;
		font-size: 0.78rem;
		font-family: inherit;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
		line-height: 1.4;
	}

	.manage-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text);
		border-color: var(--accent);
	}

	.manage-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.manage-btn-delete:hover:not(:disabled) {
		border-color: var(--danger);
		color: var(--danger);
		background: rgba(255, 100, 100, 0.07);
	}

	.manage-btn-danger {
		border-color: var(--danger);
		color: var(--danger);
		background: rgba(255, 100, 100, 0.07);
	}

	.manage-btn-danger:hover:not(:disabled) {
		background: rgba(255, 100, 100, 0.16);
	}

	/* ── Glow keyframes ── */
	@keyframes :global(card-active-pulse) {
		0%, 100% {
			box-shadow:
				0 0 0 1px color-mix(in srgb, var(--accent-2) 35%, transparent),
				0 0 14px color-mix(in srgb, var(--accent-2) 15%, transparent);
		}
		50% {
			box-shadow:
				0 0 0 1px color-mix(in srgb, var(--accent-2) 55%, transparent),
				0 0 24px color-mix(in srgb, var(--accent-2) 25%, transparent);
		}
	}

	@keyframes :global(card-lobby-pulse) {
		0%, 100% {
			box-shadow:
				0 0 0 1px color-mix(in srgb, var(--warning) 30%, transparent),
				0 0 12px color-mix(in srgb, var(--warning) 12%, transparent);
		}
		50% {
			box-shadow:
				0 0 0 1px color-mix(in srgb, var(--warning) 50%, transparent),
				0 0 20px color-mix(in srgb, var(--warning) 20%, transparent);
		}
	}

	@keyframes :global(card-active-pulse-fs) {
		0%, 100% { box-shadow: 0 0 0 1px rgba(26, 92, 168, 0.25), 0 0 10px rgba(26, 92, 168, 0.08); }
		50%       { box-shadow: 0 0 0 1px rgba(26, 92, 168, 0.45), 0 0 18px rgba(26, 92, 168, 0.15); }
	}

	@keyframes :global(card-lobby-pulse-fs) {
		0%, 100% { box-shadow: 0 0 0 1px rgba(160, 92, 0, 0.22), 0 0 10px rgba(160, 92, 0, 0.07); }
		50%       { box-shadow: 0 0 0 1px rgba(160, 92, 0, 0.42), 0 0 16px rgba(160, 92, 0, 0.13); }
	}
</style>
