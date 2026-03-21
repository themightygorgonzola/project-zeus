<script lang="ts">
	/**
	 * DiceRoll.svelte — Animated dice roll result card rendered inline in chat.
	 *
	 * Shows the roll label, individual dice, total, DC comparison, and success/failure.
	 * Animates on mount with a brief "rollout" before revealing the final result.
	 */

	interface DiceRollData {
		label: string;
		notation: string;
		rolls: number[];
		total: number;
		dc?: number;
		success?: boolean;
		type: string;
	}

	let { roll }: { roll: DiceRollData } = $props();

	// Animate: start hidden, reveal after a short cascade
	let revealed = $state(false);
	$effect(() => {
		const timer = setTimeout(() => { revealed = true; }, 350);
		return () => clearTimeout(timer);
	});

	const outcomeLabel = $derived(
		roll.success === true ? 'Success' : roll.success === false ? 'Failure' : null
	);

	const outcomeClass = $derived(
		roll.success === true ? 'success' : roll.success === false ? 'failure' : ''
	);

	const typeIcon = $derived(
		roll.type === 'attack-roll' ? '⚔️' :
		roll.type === 'damage' ? '💥' :
		roll.type === 'healing' ? '💚' :
		roll.type === 'skill-check' ? '🔍' :
		roll.type === 'saving-throw' ? '🛡️' :
		'🎲'
	);
</script>

<div class="dice-roll-card" class:revealed>
	<div class="dice-header">
		<span class="dice-icon">{typeIcon}</span>
		<span class="dice-label">{roll.label}</span>
		{#if roll.dc}
			<span class="dice-dc">DC {roll.dc}</span>
		{/if}
	</div>

	<div class="dice-body">
		<div class="dice-faces">
			{#each roll.rolls as die, i}
				<span class="die" style="--delay: {i * 80}ms">{die}</span>
			{/each}
		</div>

		<div class="dice-total-row">
			<span class="dice-notation">{roll.notation}</span>
			<span class="dice-equals">=</span>
			<span class="dice-total {outcomeClass}">{roll.total}</span>
		</div>

		{#if outcomeLabel}
			<div class="dice-outcome {outcomeClass}">
				{outcomeLabel}
			</div>
		{/if}
	</div>
</div>

<style>
	.dice-roll-card {
		background: rgba(30, 30, 50, 0.85);
		border: 1px solid rgba(124, 156, 255, 0.25);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		max-width: 320px;
		opacity: 0;
		transform: scale(0.92);
		transition: opacity 0.35s ease, transform 0.35s ease;
	}

	.dice-roll-card.revealed {
		opacity: 1;
		transform: scale(1);
	}

	.dice-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.35rem;
	}

	.dice-icon {
		font-size: 1rem;
	}

	.dice-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: #d0d8ff;
		flex: 1;
	}

	.dice-dc {
		font-size: 0.78rem;
		font-weight: 500;
		color: #a0a8cc;
		background: rgba(255, 255, 255, 0.06);
		padding: 0.1rem 0.45rem;
		border-radius: 6px;
	}

	.dice-body {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.dice-faces {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.die {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: linear-gradient(135deg, #2a2a4a 0%, #1a1a3a 100%);
		border: 1px solid rgba(124, 156, 255, 0.3);
		border-radius: 5px;
		font-size: 0.95rem;
		font-weight: 700;
		color: #e0e4ff;
		opacity: 0;
		animation: dieReveal 0.3s ease forwards;
		animation-delay: var(--delay, 0ms);
	}

	.dice-total-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.dice-notation {
		font-size: 0.78rem;
		color: #888;
	}

	.dice-equals {
		font-size: 0.82rem;
		color: #666;
	}

	.dice-total {
		font-size: 1.2rem;
		font-weight: 700;
		color: #d0d8ff;
	}

	.dice-total.success {
		color: var(--accent-2, #34d3a2);
	}

	.dice-total.failure {
		color: var(--danger, #ff6b6b);
	}

	.dice-outcome {
		font-size: 0.82rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.dice-outcome.success {
		color: var(--accent-2, #34d3a2);
	}

	.dice-outcome.failure {
		color: var(--danger, #ff6b6b);
	}

	@keyframes dieReveal {
		0% {
			opacity: 0;
			transform: rotateX(90deg) scale(0.5);
		}
		60% {
			opacity: 1;
			transform: rotateX(-10deg) scale(1.08);
		}
		100% {
			opacity: 1;
			transform: rotateX(0) scale(1);
		}
	}
</style>
