<!--
    ThemePicker.svelte
    ─────────────────────────────────────────────────────────────────────────
    IMPORTANT — CLIENT-ONLY.
    Theme selection is stored exclusively in the browser's own localStorage
    and applied by writing `data-theme` to the local <html> element.
    No value is sent to any server. No database is written. No PartyKit
    message is broadcast. Each player in a multiplayer session chooses their
    own theme independently; changing your theme has zero effect on any other
    player, the DM, or the server.
    ─────────────────────────────────────────────────────────────────────────
-->
<script lang="ts">
    import { themeStore, setTheme, THEMES } from '$stores/themeStore';
    import type { ThemeId } from '$stores/themeStore';

    let open = $state(false);

    function toggle() {
        open = !open;
    }

    function close() {
        open = false;
    }

    function pick(id: ThemeId) {
        // Pure client-side: writes to localStorage + sets data-theme on <html>.
        // Never touches the network or any shared state.
        setTheme(id);
        close();
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') close();
    }

    const originals = THEMES.filter((t) => t.group === 'original');
    const eccentrics = THEMES.filter((t) => t.group === 'eccentric');
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Overlay — clicking outside the popover closes it -->
{#if open}
    <div
        class="tp-overlay"
        role="presentation"
        aria-hidden="true"
        onclick={close}
    ></div>
{/if}

<div class="tp-wrapper">
    <!-- Trigger button -->
    <button
        class="tp-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Open theme picker"
        onclick={toggle}
    >
        <!-- Live preview dot shows the current accent colour via CSS var —
             using var(--accent) instead of a hardcoded hex prevents the
             SSR/hydration flash: the IIFE in app.html sets data-theme before
             first paint, so --accent is already correct at frame zero. -->
        <span
            class="tp-trigger-dot"
            style="background: var(--accent)"
            aria-hidden="true"
        ></span>
        <span class="tp-trigger-label">Theme</span>
        <span class="tp-trigger-chevron" class:open>{open ? '▲' : '▼'}</span>
    </button>

    <!-- Popover -->
    {#if open}
        <div
            class="tp-popover"
            role="listbox"
            aria-label="Select a theme"
        >
            <p class="tp-heading">Choose your theme</p>
            <p class="tp-sub">Your choice is saved locally — it only changes your view.</p>

            <!-- ── Originals ─────────────────────────────────────── -->
            <div class="tp-divider">
                <span class="tp-divider-label">Originals</span>
            </div>
            <div class="tp-grid">
                {#each originals as theme (theme.id)}
                    {@const isActive = $themeStore === theme.id}
                    <button
                        class="tp-swatch"
                        class:active={isActive}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        aria-label="{theme.name} — {theme.description}{isActive ? ' (current)' : ''}"
                        onclick={() => pick(theme.id)}
                    >
                        <!-- Colour preview strip + mode badge -->
                        <span class="tp-dots-row" aria-hidden="true">
                            <span class="tp-dots">
                                <span class="tp-dot" style="background: {theme.swatchBg}; border: 1px solid rgba(128,128,128,0.25)"></span>
                                <span class="tp-dot" style="background: {theme.swatchAccent}"></span>
                                <span class="tp-dot" style="background: {theme.swatchAccent2}"></span>
                            </span>
                            <span
                                class="tp-badge"
                                class:tp-badge--light={theme.colorScheme === 'light'}
                            >{theme.colorScheme.toUpperCase()}</span>
                        </span>

                        <!-- Text -->
                        <span class="tp-name">{theme.name}</span>
                        <span class="tp-desc">{theme.description}</span>

                        <!-- Active checkmark -->
                        {#if isActive}
                            <span class="tp-check" aria-hidden="true">✓</span>
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- ── Eccentrics ────────────────────────────────────────── -->
            <div class="tp-divider">
                <span class="tp-divider-label">Eccentrics</span>
            </div>
            <div class="tp-grid">
                {#each eccentrics as theme (theme.id)}
                    {@const isActive = $themeStore === theme.id}
                    <button
                        class="tp-swatch"
                        class:active={isActive}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        aria-label="{theme.name} — {theme.description}{isActive ? ' (current)' : ''}"
                        onclick={() => pick(theme.id)}
                    >
                        <!-- Colour preview strip + mode badge -->
                        <span class="tp-dots-row" aria-hidden="true">
                            <span class="tp-dots">
                                <span class="tp-dot" style="background: {theme.swatchBg}; border: 1px solid rgba(128,128,128,0.25)"></span>
                                <span class="tp-dot" style="background: {theme.swatchAccent}"></span>
                                <span class="tp-dot" style="background: {theme.swatchAccent2}"></span>
                            </span>
                            <span
                                class="tp-badge"
                                class:tp-badge--light={theme.colorScheme === 'light'}
                            >{theme.colorScheme.toUpperCase()}</span>
                        </span>

                        <!-- Text -->
                        <span class="tp-name">{theme.name}</span>
                        <span class="tp-desc">{theme.description}</span>

                        <!-- Active checkmark -->
                        {#if isActive}
                            <span class="tp-check" aria-hidden="true">✓</span>
                        {/if}
                    </button>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    /* ── Wrapper & overlay ─────────────────────────────────────────── */
    .tp-wrapper {
        position: relative;
    }

    .tp-overlay {
        position: fixed;
        inset: 0;
        z-index: 199;
    }

    /* ── Trigger button ────────────────────────────────────────────── */
    .tp-trigger {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--text-muted);
        font-family: var(--font-ui);
        font-size: 0.82rem;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
        white-space: nowrap;
    }

    .tp-trigger:hover {
        color: var(--text);
        border-color: var(--accent);
    }

    .tp-trigger-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .tp-trigger-label {
        font-size: inherit;
    }

    .tp-trigger-chevron {
        font-size: 0.6rem;
        transition: transform 0.15s;
        margin-left: 0.1rem;
    }

    /* ── Popover ───────────────────────────────────────────────────── */
    .tp-popover {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 200;
        width: 340px;
        max-height: 80vh;
        overflow-y: auto;
        background: var(--bg-alt);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 1rem;
        box-shadow: var(--shadow);
    }

    .tp-heading {
        margin: 0 0 0.2rem;
        font-family: var(--font-display);
        font-size: 1rem;
        font-weight: 600;
        color: var(--text);
    }

    .tp-sub {
        margin: 0 0 0.85rem;
        font-size: 0.75rem;
        color: var(--text-muted);
        line-height: 1.4;
    }

    /* ── Swatch grid ───────────────────────────────────────────────── */
    .tp-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
    }

    .tp-swatch {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
        padding: 0.6rem 0.65rem;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: transparent;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.15s, background 0.15s;
        width: 100%;
    }

    .tp-swatch:hover {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 8%, transparent);
    }

    .tp-swatch.active {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .tp-swatch:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }

    /* ── Colour dots ───────────────────────────────────────────────── */
    .tp-dots {
        display: flex;
        gap: 4px;
    }

    .tp-dot {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    /* ── Text ──────────────────────────────────────────────────────── */
    .tp-name {
        font-family: var(--font-ui);
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text);
        line-height: 1.2;
    }

    .tp-desc {
        font-family: var(--font-ui);
        font-size: 0.7rem;
        color: var(--text-muted);
        line-height: 1.3;
    }

    /* ── Active checkmark ──────────────────────────────────────────── */
    .tp-check {
        position: absolute;
        top: 0.4rem;
        right: 0.5rem;
        font-size: 0.75rem;
        color: var(--accent);
        font-weight: 700;
    }

    /* ── Section divider ───────────────────────────────────────────── */
    .tp-divider {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.75rem 0 0.4rem;
    }

    .tp-divider::before,
    .tp-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
    }

    .tp-divider-label {
        font-family: var(--font-ui);
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
        white-space: nowrap;
    }

    /* ── Dots row (dots + badge inline) ───────────────────────────── */
    .tp-dots-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 0.4rem;
    }

    /* ── Mode badge ─────────────────────────────────────────────────── */
    .tp-badge {
        font-family: var(--font-ui);
        font-size: 0.65rem;
        font-weight: 800;
        font-style: italic;
        letter-spacing: 0.03em;
        color: #fff;
        text-shadow: 0 0 6px rgba(255, 255, 255, 0.80), 0 0 12px rgba(255, 255, 255, 0.40);
        background: rgba(0, 0, 0, 0.65);
        padding: 0.1rem 0.32rem;
        border-radius: 3px;
        line-height: 1.4;
        white-space: nowrap;
        flex-shrink: 0;
        pointer-events: none;
    }

    .tp-badge.tp-badge--light {
        color: #fff;
        text-shadow: 0 0 6px rgba(255, 255, 255, 0.80), 0 0 12px rgba(255, 255, 255, 0.40);
        background: rgba(0, 0, 0, 0.65);
    }

    /* ── Responsive ────────────────────────────────────────────────── */
    @media (max-width: 480px) {
        .tp-popover {
            width: calc(100vw - 2rem);
            right: -0.5rem;
        }

        .tp-trigger-label {
            display: none;
        }
    }
</style>
