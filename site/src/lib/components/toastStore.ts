/**
 * Project Zeus — Toast Notification Store
 *
 * Uses a standard Svelte writable store (compatible with SSR / plain .ts files).
 * $state runes are NOT used here because this is a plain TypeScript module.
 */
import { writable } from 'svelte/store';

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

let nextId = 0;
const DEFAULT_DURATION = 5000;

/** Reactive store — subscribe in .svelte files via $toasts */
export const toasts = writable<GameToast[]>([]);

export function addToast(toast: Omit<GameToast, 'id' | 'createdAt'>): string {
const id = `toast-${++nextId}-${Date.now()}`;
const entry: GameToast = {
...toast,
id,
createdAt: Date.now(),
duration: toast.duration ?? DEFAULT_DURATION
};

toasts.update((list) => [...list, entry]);

// Auto-dismiss
setTimeout(() => {
dismissToast(id);
}, entry.duration);

return id;
}

export function dismissToast(id: string): void {
toasts.update((list) => list.filter((t) => t.id !== id));
}

// ---------------------------------------------------------------------------
// Convenience helpers for specific event types
// ---------------------------------------------------------------------------

export function toastItemAcquired(itemName: string, onclick?: () => void): string {
return addToast({ variant: 'item', title: 'Item Acquired', body: itemName, icon: '??', onclick });
}

export function toastItemRemoved(itemName: string, reason: string): string {
return addToast({
variant: 'item',
title: `Item ${reason.charAt(0).toUpperCase() + reason.slice(1)}`,
body: itemName,
icon: '??',
duration: 3500
});
}

export function toastLocationUpdate(locationName: string, onclick?: () => void): string {
return addToast({ variant: 'location', title: 'Location', body: locationName, icon: '??', onclick, duration: 4000 });
}

export function toastTimeAdvance(summary: string): string {
return addToast({ variant: 'time', title: 'Time Passes', body: summary, icon: '??', duration: 3500 });
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
icon: reason === 'completed' ? '?' : reason === 'failed' ? '?' : '??',
onclick,
duration: 5000
});
}
