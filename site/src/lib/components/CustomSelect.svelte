<script lang="ts">
	interface SelectOption {
		value: string;
		label: string;
		description?: string;
	}

	interface Props {
		options: SelectOption[];
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		onChange?: (value: string) => void;
	}

	let {
		options,
		value = undefined,
		placeholder = 'Select…',
		disabled = false,
		onChange = () => {}
	}: Props = $props();

	let open = $state(false);
	let root: HTMLDivElement | null = $state(null);
	let searchTerm = $state('');

	let selected = $derived(options.find((option) => option.value === value));
	let showSearch = $derived(options.length >= 9);
	let filteredOptions = $derived.by(() => {
		const query = searchTerm.trim().toLowerCase();
		if (!query) {
			return options;
		}

		return options.filter((option) => {
			const haystack = `${option.label} ${option.description ?? ''}`.toLowerCase();
			return haystack.includes(query);
		});
	});

	function choose(nextValue: string) {
		onChange(nextValue);
		searchTerm = '';
		open = false;
	}

	function toggle() {
		if (disabled) return;
		if (!open) {
			searchTerm = '';
		}
		open = !open;
	}

	function clickOutside(node: HTMLDivElement) {
		function handle(event: MouseEvent) {
			if (!node.contains(event.target as Node)) {
				searchTerm = '';
				open = false;
			}
		}

		document.addEventListener('mousedown', handle);
		return {
			destroy() {
				document.removeEventListener('mousedown', handle);
			}
		};
	}
</script>

<div class="select-root" bind:this={root} use:clickOutside>
	<button
		type="button"
		class="select-trigger"
		class:open
		disabled={disabled}
		onclick={toggle}
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<span class:selected-label={Boolean(selected)}>{selected?.label ?? placeholder}</span>
		<span class="chevron">▾</span>
	</button>

	{#if open}
		<div class="select-menu" role="listbox">
			{#if showSearch}
				<div class="search-shell">
					<input bind:value={searchTerm} class="search-input" type="text" placeholder="Search options…" />
				</div>
			{/if}

			{#if filteredOptions.length}
				{#each filteredOptions as option}
					<button
						type="button"
						class="select-option"
						class:selected={option.value === value}
						onclick={() => choose(option.value)}
						role="option"
						aria-selected={option.value === value}
					>
						<span>{option.label}</span>
						{#if option.description}
							<small>{option.description}</small>
						{/if}
					</button>
				{/each}
			{:else}
				<div class="empty-state">No matching options.</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.select-root {
		position: relative;
	}

	.select-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		min-height: 2.9rem;
		padding: 0.65rem 0.8rem;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(22, 26, 38, 0.96);
		color: rgba(255, 255, 255, 0.78);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}

	.select-trigger.open {
		border-color: rgba(124, 156, 255, 0.35);
		box-shadow: 0 0 0 1px rgba(124, 156, 255, 0.16);
	}

	.selected-label {
		color: var(--text-color, rgba(255, 255, 255, 0.92));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-trigger:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.select-menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		left: 0;
		right: 0;
		z-index: 80;
		max-height: min(24rem, 48vh);
		overflow-y: auto;
		padding: 0.45rem;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(14, 18, 28, 0.98);
		box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
	}

	.search-shell {
		position: sticky;
		top: -0.45rem;
		z-index: 1;
		padding: 0 0 0.45rem;
		background: rgba(14, 18, 28, 0.98);
	}

	.search-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.05);
		color: rgba(255, 255, 255, 0.92);
		font: inherit;
	}

	.select-option {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.12rem;
		padding: 0.55rem 0.7rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: rgba(255, 255, 255, 0.88);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.select-option:hover,
	.select-option.selected {
		background: rgba(124, 156, 255, 0.14);
	}

	.select-option small {
		color: var(--text-muted);
		font-size: 0.76rem;
		line-height: 1.3;
	}

	.empty-state {
		padding: 0.75rem;
		color: var(--text-muted);
		text-align: center;
	}
</style>
