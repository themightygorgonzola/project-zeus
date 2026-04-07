<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import Nav from '$components/Nav.svelte';
	import { initTheme } from '$stores/themeStore';

	let { data, children } = $props();

	// Restore the user's saved theme from localStorage and wire up the store.
	// Called in onMount so it only runs in the browser — never on the server.
	// Each player's theme is stored locally in their own browser; it does not
	// affect anyone else in a shared session.
	onMount(() => {
		initTheme();
	});
</script>

<Nav user={data.user} />

<main>
	{@render children()}
</main>
