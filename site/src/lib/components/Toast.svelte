<!--
  Project Zeus — Toast Notification Component

  Renders a stack of transient notifications in the bottom-right corner.
  Each toast auto-dismisses and can be clicked to navigate.
-->
<script lang="ts">
	import { toasts, dismissToast, type GameToast } from './toastStore';

	const variantColors: Record<string, string> = {
		item: 'var(--accent-2)',
		location: 'var(--accent)',
		time: 'var(--warning)',
		quest: '#c084fc',
		combat: 'var(--danger)',
		info: 'var(--text-muted)'
	};

	function handleClick(toast: GameToast) {
		if (toast.onclick) toast.onclick();
		dismissToast(toast.id);
	}
</script>

{#if $toasts.length > 0}
	<div class="toast-stack" role="status" aria-live="polite">
		{#each $toasts as toast (toast.id)}
			<div
				class="toast-card"
				style="--toast-accent: {variantColors[toast.variant] ?? variantColors.info}"
				onclick={() => handleClick(toast)}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && handleClick(toast)}
			>
				{#if toast.icon}
					<span class="toast-icon">{toast.icon}</span>
				{/if}
				<div class="toast-content">
					<span class="toast-title">{toast.title}</span>
					<span class="toast-body">{toast.body}</span>
				</div>
				<button
					class="toast-dismiss"
					onclick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
					aria-label="Dismiss"
				>×</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-stack {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		display: flex;
		flex-direction: column-reverse;
		gap: 0.5rem;
		z-index: 1000;
		pointer-events: none;
		max-width: 340px;
	}

	.toast-card {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--toast-accent);
		border-left: 3px solid var(--toast-accent);
		border-radius: 12px;
		background: rgba(15, 28, 48, 0.95);
		backdrop-filter: blur(12px);
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
		cursor: pointer;
		animation: toast-slide-in 0.3s ease-out;
		width: 100%;
		text-align: left;
		font-family: inherit;
		color: var(--text);
	}

	.toast-card:hover {
		background: rgba(20, 36, 60, 0.97);
		border-color: var(--toast-accent);
	}

	.toast-icon {
		font-size: 1.4rem;
		flex-shrink: 0;
	}

	.toast-content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	.toast-title {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--toast-accent);
	}

	.toast-body {
		font-size: 0.88rem;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.toast-dismiss {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
		font-family: inherit;
	}

	.toast-dismiss:hover {
		color: var(--text);
	}

	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateX(80px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateX(0) scale(1);
		}
	}
</style>
