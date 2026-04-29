/**
 * Trigger.dev background tasks — World Enrichment
 *
 * These tasks run asynchronously after turns or on a schedule to
 * flesh out the game world with AI-generated typed content.
 *
 * Each task: loads state → calls enrichment function → applies changes → saves.
 * All output goes through the same StateChange → applyGMStateChanges pipeline
 * used by the live turn executor.
 */

import { task } from '@trigger.dev/sdk';
import { loadGameState, saveGameState, loadRecentTurns } from '$lib/game/state';
import { expandSettlement, extendQuestArc, reactToPartyHistory, type EnrichmentOptions } from '../lib/server/ai/world-enrichment';
import { notifyRoom } from '../lib/server/ai/party';
import type { GameId, StateChange, NPC, Location, Quest } from '$lib/game/types';
import { generateCreatureStatBlock, isStatBlockFlat, averagePartyLevel, type CreatureTier } from '$lib/game/creature-templates';
import type { EnrichmentCompleteEvent, NpcDiscoveredEvent, LocationDiscoveredEvent, QuestDiscoveredEvent } from '$lib/game/events';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface WorldEnrichmentPayload {
	adventureId: string;
	options?: Partial<EnrichmentOptions>;
}

function getEnrichmentOptions(opts?: Partial<EnrichmentOptions>): EnrichmentOptions {
	const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
	if (!apiKey) throw new Error('OPENAI_API_KEY is required for world enrichment');
	return {
		apiKey,
		model: opts?.model ?? process.env.OPENAI_MODEL_BACKGROUND ?? 'gpt-4o'
	};
}

function getPartykitHost(): string | null {
	return process.env.PARTYKIT_HOST ?? null;
}

/**
 * Broadcast per-entity discovery events and a summary enrichment:complete
 * event through the PartyKit real-time layer so connected clients see
 * the new world content appear immediately.
 */
async function broadcastEnrichmentEvents(
	adventureId: string,
	taskType: EnrichmentCompleteEvent['taskType'],
	summary: string,
	changes: StateChange
): Promise<void> {
	const host = getPartykitHost();
	if (!host) return; // No PartyKit host configured — skip silently

	const now = Date.now();

	// Per-entity discovery events so UI can animate new additions
	if (changes.npcsAdded) {
		for (const npc of changes.npcsAdded) {
			const evt: NpcDiscoveredEvent = {
				type: 'game:npc-discovered',
				adventureId,
				timestamp: now,
				npcId: npc.id,
				name: npc.name,
				role: npc.role,
				locationId: npc.locationId
			};
			await notifyRoom(host, adventureId, evt as unknown as Record<string, unknown>);
		}
	}

	if (changes.locationsAdded) {
		for (const loc of changes.locationsAdded) {
			const evt: LocationDiscoveredEvent = {
				type: 'game:location-discovered',
				adventureId,
				timestamp: now,
				locationId: loc.id,
				name: loc.name,
				locationType: loc.type,
				description: loc.description
			};
			await notifyRoom(host, adventureId, evt as unknown as Record<string, unknown>);
		}
	}

	if (changes.questsAdded) {
		for (const q of changes.questsAdded) {
			const evt: QuestDiscoveredEvent = {
				type: 'game:quest-discovered',
				adventureId,
				timestamp: now,
				questId: q.id,
				name: q.name,
				description: q.description
			};
			await notifyRoom(host, adventureId, evt as unknown as Record<string, unknown>);
		}
	}

	// Summary event
	const summary_evt: EnrichmentCompleteEvent = {
		type: 'enrichment:complete',
		adventureId,
		timestamp: now,
		taskType,
		summary,
		changes
	};
	await notifyRoom(host, adventureId, summary_evt as unknown as Record<string, unknown>);
}

/**
 * Apply enrichment state changes to game state.
 * Mirrors the applyGMStateChanges logic from adventure-turn.ts but
 * operates on the subset of changes world enrichment can produce.
 */
function applyEnrichmentChanges(state: { npcs: NPC[]; locations: Location[]; quests: Quest[] }, changes: StateChange, partyLevel = 3): void {
	if (changes.npcsAdded) {
		for (const npcData of changes.npcsAdded) {
			if (state.npcs.some((n) => n.id === npcData.id)) continue;
			const newNpc: NPC = {
				id: npcData.id,
				name: npcData.name,
				role: npcData.role,
				locationId: npcData.locationId,
				disposition: Math.max(-100, Math.min(100, npcData.disposition)),
				description: npcData.description,
				notes: npcData.notes ?? '',
				alive: true
			};
			// Fill flat stat blocks for hostile/boss NPCs with archetype-scaled values
			if ((newNpc.role === 'hostile' || newNpc.role === 'boss') && isStatBlockFlat(npcData.statBlock)) {
				const tier: CreatureTier = newNpc.role === 'boss' ? 'boss' : 'normal';
				newNpc.statBlock = generateCreatureStatBlock(newNpc.name, tier, partyLevel);
			} else if (npcData.statBlock) {
				newNpc.statBlock = npcData.statBlock;
			}
			state.npcs.push(newNpc);
		}
	}

	if (changes.locationsAdded) {
		for (const locData of changes.locationsAdded) {
			if (state.locations.some((l) => l.id === locData.id)) continue;
			const loc: Location = {
				id: locData.id,
				name: locData.name,
				type: locData.type,
				description: locData.description,
				connections: locData.connections ?? [],
				npcs: [],
				features: locData.features ?? [],
				regionRef: null,
				visited: false
			};
			state.locations.push(loc);
			for (const connId of loc.connections) {
				const connected = state.locations.find((l) => l.id === connId);
				if (connected && !connected.connections.includes(loc.id)) {
					connected.connections.push(loc.id);
				}
			}
		}
	}

	if (changes.questsAdded) {
		for (const qData of changes.questsAdded) {
			if (state.quests.some((q) => q.id === qData.id)) continue;
			state.quests.push({
				id: qData.id,
				name: qData.name,
				description: qData.description,
				giverNpcId: qData.giverNpcId ?? null,
				status: 'available',
				objectives: qData.objectives.map((o) => ({ id: o.id, text: o.text, done: false })),
				rewards: { xp: 0, gold: 0, items: [], reputationChanges: [] },
				recommendedLevel: qData.recommendedLevel ?? 1,
				encounterTemplates: [],
				failureConsequence: qData.failureConsequence,
				deadline: qData.deadline,
				followUpQuestIds: qData.followUpQuestIds,
				prerequisiteQuestIds: qData.prerequisiteQuestIds
			});
		}
	}

	if (changes.npcChanges) {
		for (const nc of changes.npcChanges) {
			const npc = state.npcs.find((n) => n.id === nc.npcId);
			if (npc && nc.field === 'disposition' && typeof nc.newValue === 'number') {
				npc.disposition = Math.max(-100, Math.min(100, nc.newValue));
			}
			if (npc && nc.field === 'alive' && typeof nc.newValue === 'boolean') {
				npc.alive = nc.newValue;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Expand a settlement with additional NPCs and features.
 * Best triggered after party first visits a new settlement.
 */
export const expandSettlementTask = task({
	id: 'world-expand-settlement',
	run: async ({ adventureId, locationId, options }: WorldEnrichmentPayload & { locationId: GameId }) => {
		const state = await loadGameState(adventureId);
		if (!state) return { success: false, error: 'No game state' };

		const enrichmentOptions = getEnrichmentOptions(options);
		const result = await expandSettlement(state, locationId, enrichmentOptions);
		if (!result.success) return result;

		applyEnrichmentChanges(state, result.stateChanges, averagePartyLevel(state.characters));
		state.updatedAt = Date.now();
		await saveGameState(adventureId, state);

		await broadcastEnrichmentEvents(adventureId, 'expand-settlement', result.summary, result.stateChanges);

		return { success: true, summary: result.summary };
	}
});

/**
 * Generate a follow-up quest based on a completed or active quest.
 * Best triggered when a quest is completed or significantly advanced.
 */
export const extendQuestArcTask = task({
	id: 'world-extend-quest-arc',
	run: async ({ adventureId, questId, options }: WorldEnrichmentPayload & { questId: GameId }) => {
		const state = await loadGameState(adventureId);
		if (!state) return { success: false, error: 'No game state' };

		const enrichmentOptions = getEnrichmentOptions(options);
		const result = await extendQuestArc(state, questId, enrichmentOptions);
		if (!result.success) return result;

		applyEnrichmentChanges(state, result.stateChanges, averagePartyLevel(state.characters));

		// Phase 5 quest chain wiring: link newly generated quests back to the
		// source quest's followUpQuestIds so the chain is browsable both ways.
		if (result.stateChanges.questsAdded && result.stateChanges.questsAdded.length > 0) {
			const sourceQuest = state.quests.find((q) => q.id === questId);
			if (sourceQuest) {
				const newIds = result.stateChanges.questsAdded.map((q) => q.id);
				if (!sourceQuest.followUpQuestIds) sourceQuest.followUpQuestIds = [];
				for (const newId of newIds) {
					if (!sourceQuest.followUpQuestIds.includes(newId)) {
						sourceQuest.followUpQuestIds.push(newId);
					}
				}
			}
		}

		state.updatedAt = Date.now();
		await saveGameState(adventureId, state);

		await broadcastEnrichmentEvents(adventureId, 'extend-quest-arc', result.summary, result.stateChanges);

		return { success: true, summary: result.summary };
	}
});

/**
 * Analyze recent party actions and generate world reactions.
 * Best triggered periodically (e.g. every 5-10 turns) or after major events.
 */
export const reactToPartyHistoryTask = task({
	id: 'world-react-to-party',
	run: async ({ adventureId, options }: WorldEnrichmentPayload) => {
		const state = await loadGameState(adventureId);
		if (!state) return { success: false, error: 'No game state' };

		const recentTurns = await loadRecentTurns(adventureId);
		const enrichmentOptions = getEnrichmentOptions(options);
		const result = await reactToPartyHistory(state, recentTurns, enrichmentOptions);
		if (!result.success) return result;

		applyEnrichmentChanges(state, result.stateChanges, averagePartyLevel(state.characters));
		state.updatedAt = Date.now();
		await saveGameState(adventureId, state);

		await broadcastEnrichmentEvents(adventureId, 'react-to-party', result.summary, result.stateChanges);

		return { success: true, summary: result.summary };
	}
});
