/**
 * Project Zeus — Theme Store
 *
 * Manages the active UI theme via a Svelte writable store.
 * The chosen theme is persisted to localStorage and applied to the DOM
 * by setting `data-theme="<id>"` on `<html>`, which activates the
 * corresponding CSS variable block in app.css.
 *
 * Usage:
 *   import { initTheme, setTheme, themeStore, THEMES } from '$stores/themeStore';
 *
 *   // In +layout.svelte onMount — call once per page lifecycle:
 *   onMount(() => initTheme());
 *
 *   // To switch themes anywhere:
 *   setTheme('dark-academia');
 *
 *   // To read the current theme reactively:
 *   $themeStore  // e.g. 'arcane-celestial'
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// ─── Theme Catalog ───────────────────────────────────────────────────────────

export type ThemeId =
	| 'arcane-celestial'
	| 'dark-academia'
	| 'void-astral'
	| 'silver-scroll'
	| 'forge-iron'
	| 'morning-mist'
	| 'midnight-court'
	| 'clean-slate'
	| 'blood-oath'
	| 'vellum-quill'
	| 'sakura-court'
	| 'frozen-spire';

export interface ThemeMeta {
	/** Matches the data-theme CSS attribute value */
	id: ThemeId;
	/** Human-readable display name */
	name: string;
	/** Short flavour description */
	description: string;
	/** Which picker section this theme belongs to */
	group: 'original' | 'eccentric';
	/** Whether this is a light or dark theme — used for the [LIGHT]/[DARK] badge */
	colorScheme: 'light' | 'dark';
	/** Representative swatch colours for the picker UI */
	swatchBg: string;
	swatchAccent: string;
	swatchAccent2: string;
}

export const THEMES: ThemeMeta[] = [
	// ── Originals — Dark ──────────────────────────────────────────────────────
	{
		id: 'arcane-celestial',
		name: 'Arcane Celestial',
		description: 'Magic in the cosmos',
		group: 'original',
		colorScheme: 'dark',
		swatchBg: '#07111f',
		swatchAccent: '#7c9cff',
		swatchAccent2: '#34d3a2'
	},
	{
		id: 'void-astral',
		name: 'Void Astral',
		description: 'An entity older than the gods',
		group: 'original',
		colorScheme: 'dark',
		swatchBg: '#020408',
		swatchAccent: '#818cf8',
		swatchAccent2: '#4ade80'
	},
	{
		id: 'midnight-court',
		name: 'Midnight Court',
		description: 'Regal purple bardic drama',
		group: 'original',
		colorScheme: 'dark',
		swatchBg: '#0d0814',
		swatchAccent: '#c084fc',
		swatchAccent2: '#f59e0b'
	},
	{
		id: 'blood-oath',
		name: 'Blood Oath',
		description: 'Pacts sealed in the war council chamber',
		group: 'original',
		colorScheme: 'dark',
		swatchBg: '#110204',
		swatchAccent: '#b8960a',
		swatchAccent2: '#8b1a1a'
	},
	// ── Originals — Light ─────────────────────────────────────────────────────
	{
		id: 'silver-scroll',
		name: 'Silver Scroll',
		description: 'A well-lit map room',
		group: 'original',
		colorScheme: 'light',
		swatchBg: '#f5f4f0',
		swatchAccent: '#3b5bdb',
		swatchAccent2: '#0ca678'
	},
	{
		id: 'vellum-quill',
		name: 'Vellum & Quill',
		description: 'Aged parchment in the manuscript reading room',
		group: 'original',
		colorScheme: 'light',
		swatchBg: '#f0e6cc',
		swatchAccent: '#4a2c0e',
		swatchAccent2: '#8b2020'
	},
	// ── Eccentrics — Dark ─────────────────────────────────────────────────────
	{
		id: 'dark-academia',
		name: 'Dusty Trail',
		description: 'Frontier justice under a setting sun',
		group: 'eccentric',
		colorScheme: 'dark',
		swatchBg: '#1c0e06',
		swatchAccent: '#d4763a',
		swatchAccent2: '#b5a040'
	},
	{
		id: 'morning-mist',
		name: 'Grove Circle',
		description: 'Ancient roots, living bark, and the old magic in the stones',
		group: 'eccentric',
		colorScheme: 'dark',
		swatchBg: '#0a1a08',
		swatchAccent: '#7ab648',
		swatchAccent2: '#c17f24'
	},
	{
		id: 'clean-slate',
		name: 'Forged Steel',
		description: 'Hammered, tempered, unyielding.',
		group: 'eccentric',
		colorScheme: 'dark',
		swatchBg: '#0e0e10',
		swatchAccent: '#c0c8d8',
		swatchAccent2: '#5b8fcc'
	},
	{
		id: 'forge-iron',
		name: 'Ashen Gate',
		description: 'Where the walls crack and the light comes from below',
		group: 'eccentric',
		colorScheme: 'dark',
		swatchBg: '#0d0402',
		swatchAccent: '#ff4500',
		swatchAccent2: '#ffaa00'
	},
	// ── Eccentrics — Light ────────────────────────────────────────────────────
	{
		id: 'sakura-court',
		name: 'Sakura Court',
		description: 'Cherry blossoms, delicate and fleeting',
		group: 'eccentric',
		colorScheme: 'light',
		swatchBg: '#f7eef0',
		swatchAccent: '#c05878',
		swatchAccent2: '#c8a840'
	},
	{
		id: 'frozen-spire',
		name: 'Frozen Spire',
		description: 'An ice-locked mage tower, cold and crystalline',
		group: 'eccentric',
		colorScheme: 'light',
		swatchBg: '#e8f0f8',
		swatchAccent: '#1a5ca8',
		swatchAccent2: '#c8ddf0'
	}
];

// ─── Internal Helpers ────────────────────────────────────────────────────────

const STORAGE_KEY = 'nornyx-theme';
const DEFAULT_THEME: ThemeId = 'arcane-celestial';

/** Validates that a value from untrusted storage is a known theme ID. */
function isValidThemeId(value: unknown): value is ThemeId {
	return typeof value === 'string' && THEMES.some((t) => t.id === value);
}

/** Writes the data-theme attribute to <html>. No-op outside the browser. */
function applyToDom(id: ThemeId): void {
	if (browser) {
		document.documentElement.dataset.theme = id;
	}
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** Reads the persisted theme synchronously at module load — eliminates dot flicker on refresh. */
function getInitialTheme(): ThemeId {
	if (!browser) return DEFAULT_THEME;
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return isValidThemeId(saved) ? saved : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

/** Reactive store — the currently active theme ID. */
export const themeStore = writable<ThemeId>(getInitialTheme());

// ─── Init ────────────────────────────────────────────────────────────────────

let initialized = false;

/**
 * Restore the user's saved theme from localStorage and wire up the store so
 * future changes automatically propagate to the DOM and localStorage.
 *
 * Must be called from `onMount` in +layout.svelte (browser-only context).
 * Subsequent calls are no-ops, so hot-reload and double-mount are safe.
 */
export function initTheme(): void {
	if (!browser || initialized) return;
	initialized = true;

	// Wire up the subscriber — from this point on, every store update writes
	// to the DOM and localStorage. The callback fires once immediately with
	// the already-correct initial value from getInitialTheme().
	themeStore.subscribe((id) => {
		applyToDom(id);
		localStorage.setItem(STORAGE_KEY, id);
	});
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Switch to a different theme. Works from any component or file.
 * The store subscriber handles DOM updates and persistence automatically.
 */
export function setTheme(id: ThemeId): void {
	themeStore.set(id);
}
