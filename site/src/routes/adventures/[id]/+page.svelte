<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import PartySocket from 'partysocket';
	import { PUBLIC_PARTYKIT_HOST } from '$env/static/public';
	import GlassPanel from '$components/GlassPanel.svelte';
	import JournalPanel from '$components/JournalPanel.svelte';
	import CombatPanel from '$components/CombatPanel.svelte';
	import Toast from '$components/Toast.svelte';
	import DiceRoll from '$components/DiceRoll.svelte';
	import {
		toastItemAcquired,
		toastItemRemoved,
		toastLocationUpdate,
		toastTimeAdvance,
		toastQuestUpdate
	} from '$components/toastStore';
	import type { PlayerCharacter, ActiveEncounter, NPC } from '$lib/game';
	import { toWorldSnapshot, type PrototypeWorld } from '$lib/worldgen/prototype';
	import type { TurnRecord } from '$lib/game/types';
	import type { PendingCheck } from '$lib/game/types';
	import type { ChatRecord } from '$lib/game/state';

	let { data } = $props();
	let worldSnapshot = $derived(
		toWorldSnapshot((data.state as { world?: PrototypeWorld } | undefined)?.world)
	);

	let adventureId = $derived(data.adventure.id);
	let currentUserId = $derived(data.currentUserId);
	let isSolo = $derived(data.adventure.mode === 'solo');
	let loadedPartyCharacters = $derived(
		Object.fromEntries(
			(((data.gameState as { characters?: PlayerCharacter[] } | undefined)?.characters ?? []) as PlayerCharacter[])
				.map((character) => [character.userId, character])
		)
	);
	let partyCharacters = $state<Record<string, PlayerCharacter>>({});
	let currentCharacter = $derived(partyCharacters[currentUserId] ?? null);
	let currentUsername = $derived(
		((data.members as Array<{ userId: string; username: string }>)
			.find((m) => m.userId === data.currentUserId))?.username ?? 'Unknown'
	);

	// Game state for panels
	let gameState = $derived(data.gameState as {
		locations?: Array<{ id: string; name: string; type: string; description: string; features: string[]; visited: boolean }>;
		quests?: Array<{ id: string; name: string; description: string; status: string; objectives: Array<{ id: string; text: string; done: boolean }> }>;
		npcs?: Array<{ id: string; name: string; role: string; description: string; alive: boolean }>;
		partyLocationId?: string | null;
		clock?: { day: number; timeOfDay: string; weather: string };
		activeEncounter?: ActiveEncounter;
	} | undefined);

	// Combat: derived encounter + live socket-pushed awaiting ID
	let combatEncounter = $derived(gameState?.activeEncounter ?? null);
	let localAwaitingId = $state<string | null | undefined>(undefined);

	// Reset the local awaiting ID whenever the server-refreshed encounter changes
	$effect(() => {
		if (combatEncounter?.awaitingActorId !== undefined) {
			localAwaitingId = combatEncounter.awaitingActorId;
		}
	});

	let currentLocation = $derived(
		gameState?.locations?.find((l) => l.id === gameState?.partyLocationId) ?? null
	);
	let activeQuests = $derived(
		(gameState?.quests ?? []).filter((q) => q.status === 'active' || q.status === 'available')
	);

	$effect(() => {
		// Merge: server data fills gaps, live PartyKit events take precedence.
		// untrack() reads partyCharacters WITHOUT subscribing to it, so this
		// effect only re-runs when loadedPartyCharacters changes (not on every
		// live update), avoiding an infinite reactive cycle.
		const current = untrack(() => partyCharacters);
		// Server data wins — it is authoritative after persist. Local live
		// updates (e.g. optimistic character creation) only fill gaps for
		// characters not yet returned by the server.
		partyCharacters = { ...current, ...loadedPartyCharacters };
	});

	/* ── GM state ───────────────────────────────────────── */
	let gmAwake = $state(false); // true = GM will process next message

	$effect(() => {
		// Single-player: GM is always awake
		if (isSolo) gmAwake = true;
	});

	/* ── transcript messages ────────────────────────────── */
	type MessageKind = 'party' | 'gm-narration' | 'gm-thinking' | 'mechanic' | 'system' | 'error' | 'roll-request' | 'clarification' | 'dice-roll';

	interface TranscriptMessage {
		id: string;
		kind: MessageKind;
		userId: string;
		username: string;
		text: string;
		ts: number;
		mentions?: string[];
		isPending?: boolean;
		isError?: boolean;
		/** For party messages: can be retro-invoked to wake GM */
		canRetroInvoke?: boolean;
		/** For roll-request messages: the pending check to resolve */
		pendingRollCheck?: PendingCheck;
		/** For clarification messages: clickable options */
		clarificationOptions?: Array<{ id: string; label: string; description?: string }>;
		/** For clarification messages: category like 'target', 'item', 'spell' */
		clarificationCategory?: string;
		/** For dice-roll messages: structured roll data */
		diceRollData?: {
			label: string;
			notation: string;
			rolls: number[];
			total: number;
			dc?: number;
			success?: boolean;
			type: string;
		};
	}

	let messages = $state<TranscriptMessage[]>([]);
	let chatInput = $state('');
	let chatEl = $state<HTMLDivElement | null>(null);
	let socket: PartySocket | null = null;
	let connected = $state(false);
	let gmPendingId = $state<string | null>(null);
	let gmThinking = $state(false);
	let turnPhase = $state<'classifying' | 'narrating' | 'extracting' | 'rewarding' | 'query' | null>(null);
	let lastGmTurnTs = $state(0); // timestamp of last GM message
	let rollingCheck = $state(false); // true while a roll is being resolved

	// Hydrate transcript from server-loaded data
	function hydrateTranscript() {
		const hydrated: TranscriptMessage[] = [];
		const turns = (data.recentTurns ?? []) as TurnRecord[];
		const chats = (data.recentChat ?? []) as ChatRecord[];

		// Merge turns and chats by timestamp.
		// Player messages come ONLY from ChatRecords (canonical source).
		// TurnRecords contribute only GM narration and mechanic results.
		const allItems: Array<{ type: 'turn' | 'chat'; ts: number; data: TurnRecord | ChatRecord }> = [
			...turns.map((t) => ({ type: 'turn' as const, ts: t.timestamp, data: t })),
			...chats.map((c) => ({ type: 'chat' as const, ts: c.createdAt, data: c }))
		];
		allItems.sort((a, b) => a.ts - b.ts);

		for (const item of allItems) {
			if (item.type === 'chat') {
				const chat = item.data as ChatRecord;
				hydrated.push({
					id: chat.id,
					kind: 'party',
					userId: chat.userId,
					username: chat.username,
					text: chat.text,
					ts: chat.createdAt,
					mentions: chat.mentions,
					canRetroInvoke: !chat.consumedByTurn && chat.createdAt > lastGmTurnTs
				});
			} else {
				const turn = item.data as TurnRecord;
				// Pending roll request (awaiting-roll turns render as interactive prompts)
				if (turn.status === 'awaiting-roll' && turn.pendingCheck && !turn.pendingCheck.result) {
					hydrated.push({
						id: `roll-req-${turn.pendingCheck.id}`,
						kind: 'roll-request',
						userId: 'gm',
						username: 'Game Master',
						text: turn.pendingCheck.reason,
						ts: turn.timestamp,
						pendingRollCheck: turn.pendingCheck
					});
				}
				// GM narration
				if (turn.narrativeText) {
					hydrated.push({
						id: turn.id,
						kind: 'gm-narration',
						userId: 'gm',
						username: 'Game Master',
						text: turn.narrativeText,
						ts: turn.timestamp
					});
					lastGmTurnTs = turn.timestamp;
				}
				// Mechanic results
				if (turn.mechanicResults && turn.mechanicResults.length > 0) {
					const mechanicSummary = turn.mechanicResults
						.map((r) => `${r.label}: ${r.dice.total}${r.success != null ? (r.success ? ' ✓' : ' ✗') : ''}`)
						.join(' · ');
					hydrated.push({
						id: `${turn.id}-mech`,
						kind: 'mechanic',
						userId: 'system',
						username: 'System',
						text: mechanicSummary,
						ts: turn.timestamp + 0.5
					});
				}
			}
		}

		messages = hydrated;
	}

	function getUsernameById(userId: string): string {
		const member = (data.members as Array<{ userId: string; username: string }>)
			.find((m) => m.userId === userId);
		return member?.username ?? 'Unknown';
	}

	async function scrollChatToBottom() {
		await tick();
		chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
	}

	function ensurePendingGmMessage() {
		if (gmPendingId) return gmPendingId;

		const pendingId = `gm-pending-${Date.now()}`;
		gmPendingId = pendingId;
		gmThinking = true;
		messages = [...messages, {
			id: pendingId,
			kind: 'gm-thinking',
			userId: 'gm',
			username: 'Game Master',
			text: '',
			ts: Date.now(),
			isPending: true,
		}];

		return pendingId;
	}

	function connectPartyKit() {
		socket = new PartySocket({ host: PUBLIC_PARTYKIT_HOST, room: adventureId });
		socket.addEventListener('open', () => { connected = true; });
		socket.addEventListener('close', () => { connected = false; });
		socket.addEventListener('message', async (e: MessageEvent) => {
			let msg: { type: string; [key: string]: unknown };
			try { msg = JSON.parse(e.data); } catch { return; }

			if (msg.type === 'player:chat') {
				messages = [...messages, {
					id: `${msg.connectionId}-${Date.now()}`,
					kind: 'party',
					userId: String(msg.userId ?? ''),
					username: String(msg.username ?? 'Unknown'),
					text: String(msg.text ?? ''),
					ts: Date.now(),
					canRetroInvoke: true
				}];
				await scrollChatToBottom();
			}

			// Another player created or updated their character
			if (msg.type === 'game:character-created') {
				const char = msg.character as PlayerCharacter;
				if (char && char.userId) {
					partyCharacters = { ...partyCharacters, [char.userId]: char };
				}
				// Reload page data so we get the authoritative server state
				invalidateAll();
			}

			if (msg.type === 'ai:turn:start') {
				turnPhase = 'narrating';
				ensurePendingGmMessage();
				await scrollChatToBottom();
			}

			if (msg.type === 'ai:turn:chunk') {
				const chunk = String(msg.text ?? '');
				if (!chunk) return;

				const pendingId = ensurePendingGmMessage();
				messages = messages.map((m) =>
					m.id === pendingId
						? { ...m, text: `${m.text}${chunk}`, kind: 'gm-narration', isPending: false }
						: m
				);
				await scrollChatToBottom();
			}

			if (msg.type === 'ai:turn:end') {
				gmThinking = false;
				turnPhase = null;
				const text = String(msg.text ?? '');
				const clarification = (msg as any).clarification as { reason: string; question: string; options: string[] } | undefined;

				// Determine message kind & extra fields
				const isClarification = !!clarification && clarification.options?.length > 0;
				const msgKind: MessageKind = isClarification ? 'clarification' : 'gm-narration';
				const extraFields = isClarification ? {
					clarificationOptions: clarification!.options.map((opt, i) => ({ id: `opt-${i}`, label: opt })),
					clarificationCategory: clarification!.reason
				} : {};

				if (gmPendingId) {
					if (text) {
						// Replace the placeholder with the GM response (or clarification card)
						messages = messages.map((m) =>
							m.id === gmPendingId ? { ...m, text, kind: msgKind, isPending: false, ...extraFields } : m
						);
					} else {
						// Mid-round turn: no narrative — silently discard the thinking placeholder
						messages = messages.filter((m) => m.id !== gmPendingId);
					}
					gmPendingId = null;
				} else if (text) {
					messages = [...messages, {
						id: `gm-${Date.now()}`,
						kind: msgKind,
						userId: 'gm',
						username: 'Game Master',
						text,
						ts: Date.now(),
						...extraFields
					}];
				}
				lastGmTurnTs = Date.now();
				// After GM responds in multiplayer, go dormant
				if (!isSolo) gmAwake = false;
				// Mark older party messages as no longer retro-invokable
				messages = messages.map((m) =>
					m.kind === 'party' ? { ...m, canRetroInvoke: false } : m
				);
				await scrollChatToBottom();
				// Refresh server data (inventory, HP, etc.) — ai:turn:end now fires
				// AFTER persistence, so we can invalidate immediately.
				invalidateAll();
			}

			if (msg.type === 'ai:turn:error') {
				gmThinking = false;
				turnPhase = null;
				const message = String(msg.message ?? 'The GM failed to respond.');
				if (gmPendingId) {
					messages = messages.map((m) =>
						m.id === gmPendingId
							? { ...m, text: message, kind: 'error', isPending: false, isError: true }
							: m
					);
					gmPendingId = null;
				} else {
					messages = [...messages, {
						id: `gm-error-${Date.now()}`,
						kind: 'error',
						userId: 'gm',
						username: 'Game Master',
						text: message,
						ts: Date.now(),
						isError: true,
					}];
				}
				await scrollChatToBottom();
			}

			// Typed game events for side panels
			if (msg.type === 'game:state-update' || msg.type === 'game:dice-roll') {
				// Refresh server data so inventory / HP / quests reflect the turn result
				if (msg.type === 'game:state-update') {
					invalidateAll();
				}
				// Mechanic event in transcript — render as DiceRoll card
				if (msg.type === 'game:dice-roll') {
					const label = String(msg.label ?? 'Roll');
					const result = msg.result as { type?: string; label?: string; dice?: { notation?: string; rolls?: number[]; total?: number }; dc?: number; success?: boolean } | undefined;
					const dice = result?.dice;
					messages = [...messages, {
						id: `dice-${Date.now()}`,
						kind: 'dice-roll',
						userId: 'system',
						username: 'System',
						text: `🎲 ${label}: ${dice?.total ?? ''}`,
						ts: Date.now(),
						diceRollData: {
							label,
							notation: dice?.notation ?? '1d20',
							rolls: dice?.rolls ?? [dice?.total ?? 0],
							total: dice?.total ?? 0,
							dc: result?.dc,
							success: result?.success,
							type: result?.type ?? 'other'
						}
					}];
					await scrollChatToBottom();
				}
			}

			// Combat lifecycle events
			if (msg.type === 'game:combat-start') {
				const enemies = (msg.enemies as string[] | undefined)?.join(', ') ?? 'enemies';
				messages = [...messages, {
					id: `combat-start-${Date.now()}`,
					kind: 'system',
					userId: 'system',
					username: 'Combat',
					text: `⚔️ Combat begins! Enemies: ${enemies}`,
					ts: Date.now()
				}];
				await scrollChatToBottom();
				invalidateAll();
			}

			if (msg.type === 'game:combat-end') {
				const outcome = String(msg.outcome ?? 'ended');
				const xpVal = typeof msg.xpAwarded === 'number' ? msg.xpAwarded : null;
				const xpText = xpVal ? ` (+${xpVal} XP awarded)` : '';
				const outcomeLabel: Record<string, string> = {
					victory: '🏆 Victory',
					defeat: '💀 Defeat',
					flee: '🏃 Fled',
					fled: '🏃 Fled',
					negotiated: '🤝 Negotiated'
				};
				messages = [...messages, {
					id: `combat-end-${Date.now()}`,
					kind: 'system',
					userId: 'system',
					username: 'Combat',
					text: `${outcomeLabel[outcome] ?? outcome}${xpText}`,
					ts: Date.now()
				}];
				await scrollChatToBottom();
				invalidateAll();
			}

			if (msg.type === 'game:combat-turn') {
				// Update which combatant is active without waiting for a full server refresh
				const nextId = msg.nextCombatantId ? String(msg.nextCombatantId) : null;
				const nextName = msg.nextCombatantName ? String(msg.nextCombatantName) : null;
				localAwaitingId = nextId;
				// Post a system message only for human turns within an ongoing round
				if (nextName && msg.roundComplete !== true) {
					messages = [...messages, {
						id: `combat-turn-${Date.now()}`,
						kind: 'system',
						userId: 'system',
						username: 'Combat',
						text: `🎯 ${nextName}'s turn`,
						ts: Date.now()
					}];
					await scrollChatToBottom();
				}
				invalidateAll();
			}

			// Roll request from engine (Phase B4)
			if (msg.type === 'game:roll-request') {
				const check = msg.pendingCheck as PendingCheck | undefined;
				if (check) {
					messages = [...messages, {
						id: `roll-req-${check.id}`,
						kind: 'roll-request',
						userId: 'gm',
						username: 'Game Master',
						text: check.reason,
						ts: Date.now(),
						pendingRollCheck: check
					}];
					await scrollChatToBottom();
				}
			}

			// --- Structured UI events (routed to toasts, not chat) ---

			if (msg.type === 'inventory:acquired') {
				const itemName = String((msg as any).item?.name ?? 'Unknown Item');
				toastItemAcquired(itemName);
				invalidateAll();
			}

			if (msg.type === 'inventory:removed') {
				const itemName = String((msg as any).item?.name ?? 'Unknown Item');
				const reason = String((msg as any).reason ?? 'removed');
				toastItemRemoved(itemName, reason);
				invalidateAll();
			}

			if (msg.type === 'world:location-update') {
				const toLocation = (msg as any).to;
				const locationName = String(toLocation?.name ?? 'Unknown Location');
				toastLocationUpdate(locationName);
				// No invalidateAll needed — game:state-update handles the data refresh
			}

			if (msg.type === 'world:time-advance') {
				const summary = String((msg as any).summary ?? 'Time passes');
				toastTimeAdvance(summary);
			}

			if (msg.type === 'game:clarification-request') {
				const payload = msg as any;
				const options = (payload.options ?? []) as Array<{ id: string; label: string; description?: string }>;
				const prompt = String(payload.prompt ?? 'Choose an option:');
				messages = [...messages, {
					id: `clarify-${Date.now()}`,
					kind: 'clarification' as MessageKind,
					userId: 'gm',
					username: 'Game Master',
					text: prompt,
					ts: Date.now(),
					clarificationOptions: options,
					clarificationCategory: String(payload.category ?? 'other')
				}];
				await scrollChatToBottom();
			}

			// --- Combat classifier phase events ---
			if (msg.type === 'game:turn:classifying') {
				turnPhase = 'classifying';
			}
			if (msg.type === 'game:turn:extracting') {
				turnPhase = 'extracting';
			}
			if (msg.type === 'game:turn:rewarding') {
				turnPhase = 'rewarding';
			}
			if (msg.type === 'game:turn:query') {
				turnPhase = 'query';
			}
		});
	}

	function disconnectPartyKit() {
		socket?.close();
		socket = null;
	}

	// Check if message text contains @gm mention
	function hasGmMention(text: string): boolean {
		return /@gm\b/i.test(text);
	}

	/** Invoke the GM with a player action */
	async function invokeGM(playerAction: string) {
		if (!currentCharacter || !socket) return;
		ensurePendingGmMessage();
		await scrollChatToBottom();
		const res = await fetch(`/api/adventure/${adventureId}/turn`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ playerAction }),
		});

		if (!res.ok) {
			const errorText = await res.text();
			messages = messages.map((m) =>
				m.id === gmPendingId
					? { ...m, text: `GM request failed: ${errorText}`, kind: 'error', isPending: false, isError: true }
					: m
			);
			gmPendingId = null;
			gmThinking = false;
		}
	}

	/** Retro-invoke: send a previously posted message to the GM */
	async function retroInvoke(msgId: string) {
		const msg = messages.find((m) => m.id === msgId);
		if (!msg) return;
		gmAwake = true;
		await invokeGM(msg.text);
	}

	/** Handle a clarification option selection — replaces the card and re-invokes the GM */
	async function selectClarification(msgId: string, optionLabel: string) {
		if (gmThinking) return;
		// Replace the clarification card with the chosen option (shown as user message)
		messages = [...messages.filter((m) => m.id !== msgId), {
			id: `local-${Date.now()}`,
			kind: 'party' as MessageKind,
			userId: currentUserId,
			username: currentUsername,
			text: optionLabel,
			ts: Date.now()
		}];
		await scrollChatToBottom();
		// Also broadcast the choice to other players
		socket?.send(JSON.stringify({
			type: 'player:chat',
			userId: currentUserId,
			username: currentUsername,
			text: optionLabel,
		}));
		// Re-invoke GM with the selected option
		await invokeGM(optionLabel);
	}

	/** Resolve a pending roll request — calls dice engine + narrator (Phase B4) */
	async function resolveRoll(msgId: string, check: PendingCheck) {
		if (rollingCheck) return;
		rollingCheck = true;

		// Replace the roll-request message with a "rolling..." indicator
		messages = messages.map((m) =>
			m.id === msgId ? { ...m, text: `🎲 Rolling ${check.reason}…`, pendingRollCheck: undefined } : m
		);

		ensurePendingGmMessage();
		await scrollChatToBottom();

		try {
			const res = await fetch(`/api/adventure/${adventureId}/roll`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pendingCheck: check })
			});

			if (!res.ok) {
				const errorText = await res.text();
				if (gmPendingId) {
					messages = messages.map((m) =>
						m.id === gmPendingId
							? { ...m, text: `Roll failed: ${errorText}`, kind: 'error', isPending: false, isError: true }
							: m
					);
					gmPendingId = null;
				}
			}
			// Success is handled by the streaming ai:turn:chunk / ai:turn:end socket events
		} catch {
			if (gmPendingId) {
				messages = messages.map((m) =>
					m.id === gmPendingId
						? { ...m, text: 'Roll failed: network error', kind: 'error', isPending: false, isError: true }
						: m
				);
				gmPendingId = null;
			}
		} finally {
			rollingCheck = false;
		}
	}

	/** Toggle the GM awake/dormant via card click */
	function wakeGM() {
		if (isSolo) return; // Always awake in solo
		gmAwake = !gmAwake;
	}

	async function sendChat(e: SubmitEvent) {
		e.preventDefault();
		const text = chatInput.trim();
		if (!text || !socket) return;

		// Block GM invocation without a character
		const wantsGM = hasGmMention(text) || gmAwake;
		if (wantsGM && !currentCharacter) {
			messages = [...messages, {
				id: `sys-blocked-${Date.now()}`,
				kind: 'system',
				userId: 'system',
				username: 'System',
				text: 'Create your character before asking the GM to resolve actions.',
				ts: Date.now(),
				isError: true
			}];
			await scrollChatToBottom();
			return;
		}
		chatInput = '';

		// Add to local transcript
		messages = [...messages, {
			id: `local-${Date.now()}`,
			kind: 'party',
			userId: currentUserId,
			username: currentUsername,
			text,
			ts: Date.now(),
			canRetroInvoke: true
		}];
		await scrollChatToBottom();

		// Broadcast to room
		socket.send(JSON.stringify({
			type: 'player:chat',
			userId: currentUserId,
			username: currentUsername,
			text,
		}));

		// Persist to server
		fetch(`/api/adventure/${adventureId}/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, username: currentUsername }),
		}).catch(() => { /* non-fatal */ });

		// If GM is awake (single-player or manually awakened) or @gm is mentioned, invoke GM
		if (wantsGM && currentCharacter) {
			// Strip @gm from the action text sent to the GM
			const playerAction = text.replace(/@gm\b/gi, '').trim() || text;
			await invokeGM(playerAction);
		}
	}

	function handleCharacterCreated(character: PlayerCharacter) {
		partyCharacters = { ...partyCharacters, [character.userId]: character };
		// Broadcast to other players through the existing socket connection
		// (more reliable than server-side notifyRoom which uses HTTPS even in dev)
		socket?.send(JSON.stringify({ type: 'game:character-created', character }));
	}

	// Highlight @mentions in text
	function formatMessageText(text: string): string {
		const escaped = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
		return escaped.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
	}

	let partyPollInterval: ReturnType<typeof setInterval> | null = null;

	function startPartyPoll() {
		// Poll every 5 seconds while any member still has no character.
		// This is a reliable fallback for when the socket relay misses the event.
		partyPollInterval = setInterval(() => {
			const members = data.members as Array<{ userId: string }>;
			const allHaveChars = members.every((m) => partyCharacters[m.userId]);
			if (allHaveChars) {
				stopPartyPoll();
			} else {
				invalidateAll();
			}
		}, 5000);
	}

	function stopPartyPoll() {
		if (partyPollInterval !== null) {
			clearInterval(partyPollInterval);
			partyPollInterval = null;
		}
	}

	onMount(() => {
		hydrateTranscript();
		connectPartyKit();
		scrollChatToBottom();
		startPartyPoll();
	});
	onDestroy(() => { disconnectPartyKit(); stopPartyPoll(); });
</script>

<svelte:head>
	<title>{data.adventure.name}</title>
</svelte:head>

<div class="page-container">
	<div class="adventure-screen">
		<!-- Header -->
		<div class="adventure-header">
			<div>
				<h1>{data.adventure.name}</h1>
				<div class="header-meta">
					<span class="badge badge-{data.adventure.mode}">
						{data.adventure.mode}
					</span>
					<span class="badge badge-active">Active</span>
					{#if gameState?.clock}
						<span class="clock-pill">Day {gameState.clock.day} · {gameState.clock.timeOfDay} · {gameState.clock.weather}</span>
					{/if}
				</div>
			</div>
			<span class="connection-dot" class:live={connected} title={connected ? 'Live' : 'Connecting…'}></span>
		</div>

		<div class="adventure-grid">
			<!-- LEFT SIDEBAR: Party + Location + Quests -->
			<div class="side-column left-sidebar">
				<!-- GM Card -->
				<GlassPanel>
					<button
						class="gm-card"
						class:awake={gmAwake}
						class:thinking={gmThinking}
						onclick={wakeGM}
						disabled={isSolo || gmThinking}
						title={isSolo ? 'GM is always listening in solo mode' : gmAwake ? 'Click to dismiss the GM' : 'Click to wake the GM'}
					>
						<div class="gm-avatar">
							<span class="gm-glyph">🎭</span>
							{#if gmAwake}
								<span class="gm-aura"></span>
							{/if}
						</div>
						<div class="gm-info">
							<span class="gm-name">Game Master</span>
							<span class="gm-status">
								{#if gmThinking}
									{#if turnPhase === 'classifying'}
										Classifying…
									{:else if turnPhase === 'extracting'}
										Updating world…
									{:else if turnPhase === 'rewarding'}
										Rewards…
									{:else if turnPhase === 'query'}
										Answering…
									{:else if turnPhase === 'narrating'}
										Narrating…
									{:else}
										Thinking…
									{/if}
								{:else if gmAwake}
									Listening
								{:else}
									Dormant — click to wake
								{/if}
							</span>
						</div>
					</button>
				</GlassPanel>

				<!-- Combat Panel (shown only during active encounters) -->
				{#if combatEncounter}
					<GlassPanel padding="1rem">
						<CombatPanel
							encounter={combatEncounter}
							characters={Object.values(partyCharacters)}
							npcs={(gameState?.npcs ?? []) as NPC[]}
							{localAwaitingId}
						/>
					</GlassPanel>
				{/if}

				<!-- Party Summary -->
				<GlassPanel>
					<div class="panel-inner">
						<h2>Party</h2>
						<div class="party-list">
							{#each data.members as member}
								<div class="party-member">
									{#if member.avatarUrl}
										<img src={member.avatarUrl} alt="" class="avatar" />
									{:else}
										<div class="avatar avatar-placeholder">
											{member.username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<div class="member-info">
										<span class="member-name">
											{member.username}
											{#if member.userId === data.currentUserId}
												<span class="you-tag">(you)</span>
											{/if}
										</span>
										{#if partyCharacters[member.userId]}
											{@const pc = partyCharacters[member.userId]}
											<span class="member-character">{pc.name}</span>
											<div class="member-hp-bar">
												<div class="hp-fill" style="width: {Math.round((pc.hp / pc.maxHp) * 100)}%"></div>
												<span class="hp-text">{pc.hp}/{pc.maxHp}</span>
											</div>
										{:else}
											<span class="member-no-char text-muted">No character yet</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</GlassPanel>

			</div>

			<!-- CENTER: Transcript + Input -->
			<div class="main-column">
				<GlassPanel>
					<div class="main-chat-panel">
						<div class="chat-header chat-header-main">
							<div>
								<h2>Adventure</h2>
								<p class="text-muted chat-subtitle">
									{#if isSolo}
										Type your action — the GM is always listening.
									{:else}
										Chat with the party. Type <span class="mention-hint">@gm</span> or click the GM card to invoke the Game Master.
									{/if}
								</p>
								{#if !currentCharacter}
									<p class="creation-warning">⚠ Create your character to unlock GM actions.</p>
								{/if}
							</div>
						</div>
						<div class="chat-messages main-chat-messages" bind:this={chatEl}>
							{#if messages.length === 0}
								<p class="chat-empty text-muted">
									No messages yet…<br />
									{#if isSolo}
										<span class="chat-tip">Type your action and the GM will respond.</span>
									{:else}
										<span class="chat-tip">Say something to your party, or type <span class="mention-hint">@gm I look around</span></span>
									{/if}
								</p>
							{/if}
							{#each messages as msg (msg.id)}
								<div
									class="chat-msg msg-{msg.kind}"
									class:own={msg.userId === currentUserId}
									class:pending={msg.isPending}
									class:error={msg.isError}
								>
									<div class="msg-header">
										<span class="chat-name">{msg.username}</span>
										{#if msg.kind === 'party' && msg.canRetroInvoke && !isSolo}
											<button
												class="retro-invoke-btn"
												title="Send this message to the GM"
												onclick={() => retroInvoke(msg.id)}
											>
												👁️
											</button>
										{/if}
									</div>
									{#if msg.isPending}
										<span class="chat-text gm-thinking-anim">
											<span class="thinking-dot"></span>
											<span class="thinking-dot"></span>
											<span class="thinking-dot"></span>
										</span>
									{:else if msg.kind === 'roll-request' && msg.pendingRollCheck}
										<div class="roll-request-card">
											<span class="roll-request-text">{msg.text}</span>
											<button
												class="btn roll-btn"
												onclick={() => resolveRoll(msg.id, msg.pendingRollCheck!)}
												disabled={rollingCheck}
											>
												🎲 Roll
											</button>
										</div>
									{:else if msg.kind === 'clarification' && msg.clarificationOptions?.length}
										<div class="clarification-card">
											<span class="clarification-prompt">{msg.text}</span>
											<div class="clarification-options">
												{#each msg.clarificationOptions as opt (opt.id)}
													<button
														class="btn clarification-btn"
														onclick={() => selectClarification(msg.id, opt.label)}
														disabled={gmThinking}
													>
														{opt.label}
													</button>
												{/each}
											</div>
										</div>
									{:else if msg.kind === 'dice-roll' && msg.diceRollData}
										<DiceRoll roll={msg.diceRollData} />
									{:else}
										<span class="chat-text">{@html formatMessageText(msg.text)}</span>
									{/if}
								</div>
							{/each}
						</div>
						<form class="chat-form main-chat-form" onsubmit={sendChat}>
							<input
								class="chat-input main-chat-input"
								class:gm-input={gmAwake || hasGmMention(chatInput)}
								type="text"
								placeholder={
									isSolo
										? (currentCharacter ? 'Describe your action…' : 'Create your character first')
										: (gmAwake ? 'GM is listening — describe your action…' : 'Type a message… or @gm <action>')
								}
								bind:value={chatInput}
								maxlength={500}
								disabled={gmThinking}
							/>
							<button
								type="submit"
								class="btn chat-send main-chat-send"
								class:btn-gm={gmAwake || hasGmMention(chatInput)}
								class:btn-primary={!gmAwake && !hasGmMention(chatInput)}
								disabled={!chatInput.trim() || gmThinking || ((gmAwake || hasGmMention(chatInput)) && !currentCharacter)}
							>
								{gmAwake || hasGmMention(chatInput) ? '✨' : '↑'}
							</button>
						</form>
					</div>
				</GlassPanel>
			</div>

			<!-- RIGHT SIDEBAR: Journal Panel -->
			<div class="side-column right-sidebar journal-sidebar">
				<JournalPanel
					currentCharacter={currentCharacter}
					partyCharacters={partyCharacters}
					members={data.members}
					currentUserId={currentUserId}
					quests={gameState?.quests ?? []}
					locations={gameState?.locations ?? []}
					currentLocationId={gameState?.partyLocationId}
					npcs={gameState?.npcs ?? []}
					worldSnapshot={worldSnapshot}
					clock={gameState?.clock}
					adventureId={adventureId}
					onCreated={handleCharacterCreated}
				/>
			</div>
		</div>
	</div>
</div>

<!-- Toast notifications (fixed overlay) -->
<Toast />

<style>
	/* ===== Layout ===== */
	.adventure-screen {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.adventure-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.adventure-header h1 {
		margin: 0 0 0.5rem;
	}

	.header-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.clock-pill {
		font-size: 0.82rem;
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.18);
		color: var(--text-muted);
	}

	.adventure-grid {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr) 420px;
		gap: 1.25rem;
		align-items: start;
	}

	.side-column {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.journal-sidebar {
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 2rem);
		overflow: hidden;
	}

	.main-column {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	.panel-inner {
		padding: 0.25rem 0.5rem;
	}

	.panel-inner h2 {
		margin: 0 0 0.85rem;
		font-size: 0.88rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	/* ===== Connection indicator ===== */
	.connection-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
		opacity: 0.35;
		transition: all 0.3s ease;
		flex-shrink: 0;
		margin-top: 0.6rem;
	}

	.connection-dot.live {
		background: var(--accent-2);
		opacity: 1;
		box-shadow: 0 0 5px var(--accent-2);
	}

	/* ===== GM Card ===== */
	.gm-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.85rem 0.95rem;
		border: 1px solid rgba(255, 200, 80, 0.12);
		border-radius: 14px;
		background: rgba(255, 200, 80, 0.04);
		color: inherit;
		cursor: pointer;
		transition: all 0.25s ease;
		font-family: inherit;
		text-align: left;
	}

	.gm-card:hover:not(:disabled) {
		border-color: rgba(255, 200, 80, 0.35);
		background: rgba(255, 200, 80, 0.08);
	}

	.gm-card:disabled {
		cursor: default;
		opacity: 0.85;
	}

	.gm-card.awake {
		border-color: rgba(255, 200, 80, 0.45);
		background: rgba(255, 200, 80, 0.1);
	}

	.gm-card.thinking {
		animation: gm-pulse 1.6s ease-in-out infinite;
	}

	@keyframes gm-pulse {
		0%, 100% { border-color: rgba(255, 200, 80, 0.45); }
		50% { border-color: rgba(255, 200, 80, 0.8); }
	}

	.gm-avatar {
		position: relative;
		font-size: 1.5rem;
		line-height: 1;
	}

	.gm-glyph {
		display: block;
	}

	.gm-aura {
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		background: rgba(255, 200, 80, 0.18);
		animation: aura 2s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes aura {
		0%, 100% { transform: scale(1); opacity: 0.4; }
		50% { transform: scale(1.35); opacity: 0; }
	}

	.gm-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.gm-name {
		font-weight: 700;
		font-size: 0.88rem;
		color: #f5c842;
	}

	.gm-status {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	/* ===== Party list ===== */
	.party-list {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.party-member {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
	}

	.avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.avatar-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(124, 156, 255, 0.2);
		color: var(--accent);
		font-weight: 700;
		font-size: 0.8rem;
	}

	.member-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.member-name {
		font-weight: 600;
		font-size: 0.88rem;
	}

	.member-character {
		font-size: 0.76rem;
		color: var(--accent);
	}

	.member-no-char {
		font-size: 0.74rem;
	}

	.you-tag {
		color: var(--accent);
		font-weight: 400;
		font-size: 0.78rem;
	}

	.member-hp-bar {
		position: relative;
		height: 12px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
		margin-top: 0.15rem;
		min-width: 80px;
	}

	.hp-fill {
		height: 100%;
		border-radius: 6px;
		background: linear-gradient(90deg, #44d688, #44d688);
		transition: width 0.4s ease;
	}

	.hp-text {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.62rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.85);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}

	/* ===== Location panel ===== */
	.location-name {
		display: block;
		font-size: 0.95rem;
		margin-bottom: 0.15rem;
	}

	.location-type {
		font-size: 0.76rem;
		text-transform: capitalize;
		display: block;
		margin-bottom: 0.45rem;
	}

	.location-desc {
		font-size: 0.84rem;
		line-height: 1.55;
		margin: 0 0 0.6rem;
		color: var(--text-muted);
	}

	.feature-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.feature-pill {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.18);
		color: var(--text-muted);
	}

	/* ===== Quest panel ===== */
	.quest-item {
		margin-bottom: 0.85rem;
	}

	.quest-item:last-child {
		margin-bottom: 0;
	}

	.quest-name {
		display: block;
		font-size: 0.88rem;
		margin-bottom: 0.15rem;
	}

	.quest-desc {
		font-size: 0.78rem;
		margin: 0 0 0.4rem;
		line-height: 1.45;
	}

	.quest-objectives {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.objective {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.8rem;
	}

	.objective.done {
		text-decoration: line-through;
		opacity: 0.5;
	}

	.obj-check {
		flex-shrink: 0;
		font-size: 0.72rem;
	}

	/* ===== World panel ===== */
	.world-name {
		display: block;
		font-size: 0.95rem;
		margin-bottom: 0.25rem;
	}

	.world-meta {
		margin: 0 0 0.65rem;
		font-size: 0.82rem;
	}

	.world-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.65rem;
	}

	.world-pills span {
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.74rem;
		background: rgba(124, 156, 255, 0.1);
		border: 1px solid rgba(124, 156, 255, 0.18);
		color: var(--text-muted);
	}

	.world-teaser {
		margin: 0;
		padding-left: 0.75rem;
		border-left: 3px solid var(--accent);
		font-size: 0.84rem;
		color: var(--text-muted);
		font-style: italic;
		line-height: 1.5;
	}

	/* ===== Main chat panel ===== */
	.main-chat-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1rem 1.15rem 1.15rem;
		min-height: 72vh;
	}

	.chat-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}

	.chat-header-main h2 {
		margin: 0 0 0.15rem;
		font-size: 1.1rem;
	}

	.chat-subtitle {
		margin: 0;
		font-size: 0.88rem;
	}

	.mention-hint {
		color: #f5c842;
		font-weight: 600;
	}

	.creation-warning {
		margin-top: 0.35rem;
		font-size: 0.82rem;
		color: #f5c842;
	}

	/* ===== Chat messages ===== */
	.chat-messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 80px;
		scrollbar-width: thin;
	}

	.main-chat-messages {
		min-height: 420px;
		max-height: none;
		padding-right: 0.15rem;
	}

	.chat-empty {
		margin: 0;
		font-size: 0.82rem;
		text-align: center;
		padding: 2rem 0;
	}

	.chat-tip {
		font-size: 0.82rem;
	}

	.chat-msg {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.55rem 0.8rem;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.04);
		transition: background 0.15s;
	}

	.msg-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.chat-name {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.chat-msg.own {
		background: rgba(124, 156, 255, 0.08);
		border: 1px solid rgba(124, 156, 255, 0.13);
	}

	.chat-msg.own .chat-name {
		color: var(--accent-2, var(--accent));
	}

	/* Message kind: party (default handled above) */

	/* Message kind: gm-narration */
	.msg-gm-narration {
		background: rgba(255, 200, 80, 0.06);
		border: 1px solid rgba(255, 200, 80, 0.2);
		border-radius: 12px;
	}

	.msg-gm-narration .chat-name {
		color: #f5c842;
	}

	.msg-gm-narration .chat-text {
		font-style: italic;
		line-height: 1.6;
	}

	/* Message kind: gm-thinking */
	.msg-gm-thinking {
		background: rgba(255, 200, 80, 0.04);
		border: 1px solid rgba(255, 200, 80, 0.12);
		opacity: 0.95;
	}

	.msg-gm-thinking .chat-name {
		color: #f5c842;
	}

	/* Message kind: mechanic */
	.msg-mechanic {
		background: rgba(100, 200, 255, 0.06);
		border: 1px solid rgba(100, 200, 255, 0.2);
		border-radius: 10px;
	}

	.msg-mechanic .chat-name {
		color: #64c8ff;
	}

	.msg-mechanic .chat-text {
		font-family: monospace;
		font-size: 0.88rem;
	}

	/* Message kind: system */
	.msg-system {
		background: rgba(255, 255, 255, 0.02);
		text-align: center;
		padding: 0.35rem 0.65rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}

	.msg-system .chat-name {
		display: none;
	}

	/* Message kind: error */
	.msg-error,
	.chat-msg.error {
		background: rgba(255, 90, 90, 0.08);
		border: 1px solid rgba(255, 90, 90, 0.22);
	}

	.msg-error .chat-name {
		color: #ff5a5a;
	}

	/* Message kind: roll-request (Phase B4) */
	.msg-roll-request {
		background: rgba(160, 120, 255, 0.08);
		border: 1px solid rgba(160, 120, 255, 0.3);
		border-radius: 12px;
	}

	.msg-roll-request .chat-name {
		color: #a078ff;
	}

	.roll-request-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.roll-request-text {
		font-size: 0.94rem;
		font-weight: 500;
		color: #d0c0ff;
		flex: 1;
	}

	.roll-btn {
		background: linear-gradient(135deg, #7c4dff 0%, #a078ff 100%);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.45rem 1rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.15s, box-shadow 0.15s;
		white-space: nowrap;
	}

	.roll-btn:hover:not(:disabled) {
		transform: scale(1.05);
		box-shadow: 0 0 12px rgba(124, 77, 255, 0.4);
	}

	.roll-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Clarification card */
	.clarification-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.clarification-prompt {
		font-size: 0.94rem;
		font-weight: 500;
		color: var(--accent-2, #34d3a2);
	}

	.clarification-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.clarification-btn {
		background: rgba(52, 211, 162, 0.15);
		color: var(--accent-2, #34d3a2);
		border: 1px solid rgba(52, 211, 162, 0.35);
		border-radius: 8px;
		padding: 0.4rem 0.85rem;
		font-size: 0.88rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
	}

	.clarification-btn:hover:not(:disabled) {
		background: rgba(52, 211, 162, 0.3);
		transform: scale(1.03);
		box-shadow: 0 0 10px rgba(52, 211, 162, 0.25);
	}

	.clarification-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Pending state */
	.chat-msg.pending {
		opacity: 0.9;
	}

	/* Retro-invoke button */
	.retro-invoke-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
		opacity: 0;
		transition: opacity 0.15s;
		color: var(--text-muted);
	}

	.chat-msg:hover .retro-invoke-btn {
		opacity: 0.6;
	}

	.retro-invoke-btn:hover {
		opacity: 1 !important;
		background: rgba(255, 200, 80, 0.12);
	}

	/* Thinking animation */
	.gm-thinking-anim {
		display: flex;
		gap: 4px;
		align-items: center;
		padding: 0.2rem 0;
	}

	.thinking-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f5c842;
		opacity: 0.4;
		animation: thinking 1.2s ease-in-out infinite;
	}

	.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
	.thinking-dot:nth-child(3) { animation-delay: 0.4s; }

	@keyframes thinking {
		0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
		40% { opacity: 1; transform: scale(1.15); }
	}

	.chat-text {
		font-size: 0.94rem;
		line-height: 1.55;
		word-break: break-word;
		white-space: pre-wrap;
	}

	/* ===== Chat input ===== */
	.chat-form {
		display: flex;
		gap: 0.4rem;
	}

	.main-chat-form {
		align-items: stretch;
	}

	.chat-input {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--border);
		color: inherit;
		padding: 0.45rem 0.7rem;
		border-radius: 10px;
		font-size: 0.88rem;
		font-family: inherit;
	}

	.main-chat-input {
		padding: 0.85rem 1rem;
		border-radius: 14px;
		font-size: 0.96rem;
	}

	.chat-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.chat-input.gm-input {
		border-color: rgba(245, 200, 66, 0.5);
		background: rgba(245, 200, 66, 0.05);
	}

	.chat-send {
		padding: 0.45rem 0.75rem;
		border-radius: 10px;
		min-width: 2.2rem;
		font-size: 1rem;
	}

	.main-chat-send {
		min-width: 3.2rem;
		border-radius: 14px;
		font-size: 1.1rem;
	}

	.btn-gm {
		background: rgba(245, 200, 66, 0.18);
		color: #f5c842;
		border: 1px solid rgba(245, 200, 66, 0.35);
	}

	/* ===== Mention highlight (rendered via formatMessageText) ===== */
	:global(.mention) {
		color: #f5c842;
		font-weight: 600;
	}

	/* ===== Responsive ===== */
	@media (max-width: 1300px) {
		.adventure-grid {
			grid-template-columns: 200px minmax(0, 1fr) 380px;
		}
	}

	@media (max-width: 1100px) {
		.adventure-grid {
			grid-template-columns: minmax(0, 1fr) 360px;
		}

		.left-sidebar {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.adventure-grid {
			grid-template-columns: 1fr;
		}

		.left-sidebar {
			order: 1;
		}

		.main-column {
			order: 0;
		}

		.main-chat-panel {
			min-height: 56vh;
		}

		.main-chat-messages {
			min-height: 320px;
		}
	}
</style>
