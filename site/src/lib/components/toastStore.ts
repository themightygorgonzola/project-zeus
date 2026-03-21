/**
 * Project Zeus — Toast Notification Store
 *
 * Reactive store for managing transient UI notifications.
 * Toasts are auto-dismissed after a configured duration.
 * Each toast can optionally trigger a navigation action on click.
 */

export type ToastVariant = 'item' | 'location' | 'time' | 'quest' | 'combat' | 'info';

export interface GameToast {
	id: string;
	variant: ToastVariant;
	title: string;
	body: string;
	/** Optional icon character or emoji */
	icon?: string;
	/** Auto-dismiss duration in ms (default 5000) */
	duration?: number;
	/** Callback when toast is clicked */
	onclick?: () => void;
	/** Timestamp of creation */
	createdAt: number;
}

let toasts = $state<GameToast[]>([]);
let nextId = 0;

const DEFAULT_DURATION = 5000;

export function addToast(toast: Omit<GameToast, 'id' | 'createdAt'>): string {
	const id = `toast-${++nextId}-${Date.now()}`;
	const entry: GameToast = {
		...toast,
		id,
		createdAt: Date.now(),
		duration: toast.duration ?? DEFAULT_DURATION
	};

	toasts = [...toasts, entry];

	// Auto-dismiss
	setTimeout(() => {
		dismissToast(id);
	}, entry.duration);

	return id;
}

export function dismissToast(id: string): void {
	toasts = toasts.filter((t) => t.id !== id);
}

export function getToasts(): GameToast[] {
	return toasts;
}

// ---------------------------------------------------------------------------
// Convenience helpers for specific event types
// ---------------------------------------------------------------------------

export function toastItemAcquired(itemName: string, onclick?: () => void): string {
	return addToast({
		variant: 'item',
		title: 'Item Acquired',
		body: itemName,
		icon: '🎒',
		onclick
	});
}

export function toastItemRemoved(itemName: string, reason: string): string {
	return addToast({
		variant: 'item',
		title: `Item ${reason.charAt(0).toUpperCase() + reason.slice(1)}`,
		body: itemName,
		icon: '📦',
		duration: 3500
	});
}

export function toastLocationUpdate(locationName: string, onclick?: () => void): string {
	return addToast({
		variant: 'location',
		title: 'Location',
		body: locationName,
		icon: '📍',
		onclick,
		duration: 4000
	});
}

export function toastTimeAdvance(summary: string): string {
	return addToast({
		variant: 'time',
		title: 'Time Passes',
		body: summary,
		icon: '🕐',
		duration: 3500
	});
}

export function toastQuestUpdate(questName: string, reason: string, onclick?: () => void): string {
	const labels: Record<string, string> = {
		discovered: 'Quest Discovered',
		accepted: 'Quest Accepted',
		'objective-complete': 'Objective Complete',
		completed: 'Quest Completed',
		failed: 'Quest Failed'
	};
	return addToast({
		variant: 'quest',
		title: labels[reason] ?? 'Quest Update',
		body: questName,
		icon: reason === 'completed' ? '✅' : reason === 'failed' ? '❌' : '📜',
		onclick,
		duration: 5000
	});
}
