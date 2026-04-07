<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		padding?: string;
	}

	let { children, padding = '1.5rem' }: Props = $props();
</script>

<div class="glass-panel" style:padding={padding}>
	{@render children()}
</div>

<style>
	.glass-panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		backdrop-filter: blur(var(--blur-glass));
	}
</style>
