/**
 * Project Zeus — AI World Enrichment
 *
 * Background content pipeline that uses AI to generate typed world content.
 * Each function builds a targeted prompt, calls OpenAI, parses the structured
 * response, and returns validated StateChange objects ready for application.
 *
 * Called from Trigger.dev tasks (see trigger/world-enrichment.ts) after turns
 * or on a schedule. All output goes through the same typed StateChange pipeline
 * used by the live turn executor, so applyGMStateChanges() handles application.
 *
 * Design rules:
 *   - Every function returns an EnrichmentResult (never mutates state directly).
 *   - AI output is validated and clamped to safe ranges.
 *   - IDs use ulid() with typed prefixes (npc-, loc-, quest-).
 *   - Failures are non-fatal: return empty changes + error.
 */

import { ulid } from 'ulid';
import { completeChat, type ChatMessageInput } from './openai';
import type {
	GameState,
	StateChange,
	NPC,
	Location,
	Quest,
	TurnRecord,
	NpcRole,
	LocationType,
	GameId
} from '$lib/game/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichmentOptions {
	apiKey: string;
	model?: string;
}

export interface EnrichmentResult {
	success: boolean;
	stateChanges: StateChange;
	/** Human-readable summary of what was generated. */
	summary: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function systemPrompt(): string {
	return `You are a world-building assistant for a fantasy tabletop RPG.
You generate structured content that fits the existing world.
Always respond with ONLY valid JSON — no markdown, no commentary.
Keep descriptions vivid but concise (1-2 sentences each).
Names should feel consistent with the existing world.

When generating quest objectives, ALWAYS include a "type" field:
- "talk-to": speak with a specific NPC (include linkedEntityId = NPC id, linkedEntityName = NPC name)
- "visit-location": travel to a specific place (include linkedEntityId = location id, linkedEntityName = location name)
- "find-item": acquire a specific item (include linkedEntityName = item name)
- "defeat-encounter": defeat enemies in combat
- "escort": protect someone during travel
- "custom": anything else

When generating quests, ALWAYS include rewards:
{ "xp": number, "gold": number }`;
}

function describeLocation(loc: Location): string {
	return `"${loc.name}" (${loc.type}) — ${loc.description}`;
}

function describeNpc(npc: NPC): string {
	return `"${npc.name}" (${npc.role}) — ${npc.description}`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse an AI JSON response into a partial StateChange.
 * Falls back gracefully on malformed output.
 */
export function parseEnrichmentResponse(raw: string): StateChange {
	try {
		const trimmed = raw.trim();
		const jsonStr = trimmed.startsWith('```')
			? trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
			: trimmed;

		const parsed = JSON.parse(jsonStr);
		const changes: StateChange = {};

		if (Array.isArray(parsed.npcsAdded)) {
			changes.npcsAdded = parsed.npcsAdded
				.filter((n: Record<string, unknown>) => n && typeof n.name === 'string')
				.map((n: Record<string, unknown>) => ({
					id: typeof n.id === 'string' && n.id.startsWith('npc-') ? n.id : `npc-${ulid()}`,
					name: String(n.name),
					role: validateNpcRole(n.role) ?? 'neutral',
					locationId: typeof n.locationId === 'string' ? n.locationId : '',
					disposition: typeof n.disposition === 'number' ? Math.max(-100, Math.min(100, n.disposition)) : 0,
					description: typeof n.description === 'string' ? n.description : '',
					notes: typeof n.notes === 'string' ? n.notes : undefined
				}));
		}

		if (Array.isArray(parsed.locationsAdded)) {
			changes.locationsAdded = parsed.locationsAdded
				.filter((l: Record<string, unknown>) => l && typeof l.name === 'string')
				.map((l: Record<string, unknown>) => ({
					id: typeof l.id === 'string' && l.id.startsWith('loc-') ? l.id : `loc-${ulid()}`,
					name: String(l.name),
					type: validateLocationType(l.type) ?? 'wilderness',
					description: typeof l.description === 'string' ? l.description : '',
					connections: Array.isArray(l.connections) ? l.connections.filter((c: unknown) => typeof c === 'string') : [],
					features: Array.isArray(l.features) ? l.features.filter((f: unknown) => typeof f === 'string') : []
				}));
		}

		if (Array.isArray(parsed.questsAdded)) {
			const validObjTypes = new Set(['talk-to', 'visit-location', 'find-item', 'defeat-encounter', 'escort', 'custom']);
			changes.questsAdded = parsed.questsAdded
				.filter((q: Record<string, unknown>) => q && typeof q.name === 'string')
				.map((q: Record<string, unknown>) => ({
					id: typeof q.id === 'string' && q.id.startsWith('quest-') ? q.id : `quest-${ulid()}`,
					name: String(q.name),
					description: typeof q.description === 'string' ? q.description : '',
					giverNpcId: typeof q.giverNpcId === 'string' ? q.giverNpcId : null,
					objectives: Array.isArray(q.objectives)
						? q.objectives.map((o: Record<string, unknown>) => ({
							id: typeof o?.id === 'string' ? o.id : `obj-${ulid()}`,
							text: typeof o?.text === 'string' ? o.text : String(o),
							type: typeof o?.type === 'string' && validObjTypes.has(o.type) ? o.type : 'custom',
							linkedEntityId: typeof o?.linkedEntityId === 'string' ? o.linkedEntityId : undefined,
							linkedEntityName: typeof o?.linkedEntityName === 'string' ? o.linkedEntityName : undefined
						}))
						: [],
					recommendedLevel: typeof q.recommendedLevel === 'number' ? q.recommendedLevel : 1,
					rewards: q.rewards && typeof q.rewards === 'object'
						? {
							xp: typeof (q.rewards as Record<string, unknown>).xp === 'number' ? (q.rewards as Record<string, unknown>).xp as number : 100,
							gold: typeof (q.rewards as Record<string, unknown>).gold === 'number' ? (q.rewards as Record<string, unknown>).gold as number : 20
						}
						: { xp: 100, gold: 20 }
				}));
		}

		if (Array.isArray(parsed.sceneFactsAdded)) {
			changes.sceneFactsAdded = parsed.sceneFactsAdded.filter((f: unknown) => typeof f === 'string');
		}

		if (Array.isArray(parsed.npcChanges)) {
			changes.npcChanges = parsed.npcChanges
				.filter((c: Record<string, unknown>) => c && typeof c.npcId === 'string')
				.map((c: Record<string, unknown>) => ({
					npcId: String(c.npcId),
					field: typeof c.field === 'string' ? c.field : 'disposition',
					oldValue: c.oldValue ?? null,
					newValue: c.newValue ?? null
				}));
		}

		return changes;
	} catch {
		return {};
	}
}

const VALID_NPC_ROLES: Set<string> = new Set(['merchant', 'quest-giver', 'hostile', 'neutral', 'ally', 'boss']);
const VALID_LOCATION_TYPES: Set<string> = new Set(['settlement', 'wilderness', 'dungeon', 'interior', 'road']);

function validateNpcRole(value: unknown): NpcRole | null {
	return typeof value === 'string' && VALID_NPC_ROLES.has(value) ? value as NpcRole : null;
}

function validateLocationType(value: unknown): LocationType | null {
	return typeof value === 'string' && VALID_LOCATION_TYPES.has(value) ? value as LocationType : null;
}

// ---------------------------------------------------------------------------
// expandSettlement
// ---------------------------------------------------------------------------

/**
 * AI-generate additional NPCs and features for an existing settlement.
 * Produces 2-3 new NPCs and 1-2 scene facts that flesh out the settlement.
 */
export async function expandSettlement(
	state: GameState,
	locationId: GameId,
	options: EnrichmentOptions
): Promise<EnrichmentResult> {
	const location = state.locations.find((l) => l.id === locationId);
	if (!location) return { success: false, stateChanges: {}, summary: '', error: 'Location not found' };

	const existingNpcs = state.npcs.filter((n) => n.locationId === locationId);

	const messages: ChatMessageInput[] = [
		{ role: 'system', content: systemPrompt() },
		{
			role: 'user',
			content: `Expand this settlement with new inhabitants and atmosphere.

SETTLEMENT: ${describeLocation(location)}
FEATURES: ${(location.features ?? []).join('; ') || 'None yet'}
EXISTING NPCS: ${existingNpcs.length > 0 ? existingNpcs.map(describeNpc).join('; ') : 'None yet'}

Generate 2-3 new NPCs and 1-2 scene facts that make this place feel alive.
Each NPC should have a distinct role and personality that creates gameplay opportunity.

Return JSON:
{
  "npcsAdded": [
    { "name": "...", "role": "merchant|quest-giver|neutral|hostile|ally", "locationId": "${locationId}", "disposition": 0, "description": "1-2 sentences", "notes": "GM-only notes about hooks/secrets" }
  ],
  "sceneFactsAdded": ["Atmospheric detail or rumor"]
}`
		}
	];

	try {
		const raw = await completeChat({ apiKey: options.apiKey, model: options.model ?? 'gpt-4o', messages });
		const changes = parseEnrichmentResponse(raw);

		// Ensure all NPCs have the correct locationId
		if (changes.npcsAdded) {
			for (const npc of changes.npcsAdded) {
				npc.locationId = locationId;
			}
		}

		const npcCount = changes.npcsAdded?.length ?? 0;
		const factCount = changes.sceneFactsAdded?.length ?? 0;
		const summary = `Settlement expansion: added ${npcCount} NPC${npcCount !== 1 ? 's' : ''} and ${factCount} scene fact${factCount !== 1 ? 's' : ''} to ${location.name}`;

		return { success: true, stateChanges: changes, summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, stateChanges: {}, summary: '', error: message };
	}
}

// ---------------------------------------------------------------------------
// extendQuestArc
// ---------------------------------------------------------------------------

/**
 * AI-generate a follow-up quest that builds on a completed or in-progress quest.
 */
export async function extendQuestArc(
	state: GameState,
	questId: GameId,
	options: EnrichmentOptions
): Promise<EnrichmentResult> {
	const quest = state.quests.find((q) => q.id === questId);
	if (!quest) return { success: false, stateChanges: {}, summary: '', error: 'Quest not found' };

	const giver = quest.giverNpcId ? state.npcs.find((n) => n.id === quest.giverNpcId) : null;
	const location = state.partyLocationId ? state.locations.find((l) => l.id === state.partyLocationId) : null;

	const messages: ChatMessageInput[] = [
		{ role: 'system', content: systemPrompt() },
		{
			role: 'user',
			content: `Create a follow-up quest that builds on this story.

ORIGINAL QUEST: "${quest.name}" — ${quest.description}
STATUS: ${quest.status}
OBJECTIVES: ${quest.objectives.map((o) => `${o.done ? '[x]' : '[ ]'} ${o.text} (type: ${o.type ?? 'custom'})`).join('; ')}
QUEST GIVER: ${giver ? describeNpc(giver) : 'Unknown'}
PARTY LOCATION: ${location ? describeLocation(location) : 'Unknown'}
PARTY LEVEL: ${state.characters.length > 0 ? state.characters[0].level : 1}

KNOWN LOCATIONS: ${state.locations.slice(0, 8).map((l) => `${l.name}[${l.id}]`).join(', ')}
KNOWN NPCS: ${state.npcs.filter((n) => n.alive).slice(0, 10).map((n) => `${n.name}[${n.id}](${n.role})`).join(', ')}

Generate a follow-up quest that raises the stakes or introduces a new angle.
Include 2-4 objectives with typed objective tracking.
Each objective MUST have: text, type (talk-to|visit-location|find-item|defeat-encounter|escort|custom).
For talk-to/visit-location, include linkedEntityId and linkedEntityName from known NPCs/locations.
Include rewards (xp, gold). Optionally introduce a new NPC connected to the quest.

Return JSON:
{
  "questsAdded": [
    {
      "name": "...", "description": "...", "giverNpcId": "${giver?.id ?? ''}",
      "objectives": [{ "text": "...", "type": "talk-to", "linkedEntityId": "npc-xxx", "linkedEntityName": "Name" }],
      "recommendedLevel": ${(state.characters[0]?.level ?? 1) + 1},
      "rewards": { "xp": ${100 + (state.characters[0]?.level ?? 1) * 50}, "gold": ${20 + (state.characters[0]?.level ?? 1) * 10} }
    }
  ],
  "npcsAdded": [
    { "name": "...", "role": "quest-giver|neutral|hostile|ally", "locationId": "${location?.id ?? ''}", "disposition": 0, "description": "...", "notes": "..." }
  ]
}`
		}
	];

	try {
		const raw = await completeChat({ apiKey: options.apiKey, model: options.model ?? 'gpt-4o', messages });
		const changes = parseEnrichmentResponse(raw);

		const questCount = changes.questsAdded?.length ?? 0;
		const npcCount = changes.npcsAdded?.length ?? 0;
		const summary = `Quest arc extension: added ${questCount} quest${questCount !== 1 ? 's' : ''} and ${npcCount} NPC${npcCount !== 1 ? 's' : ''} following "${quest.name}"`;

		return { success: true, stateChanges: changes, summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, stateChanges: {}, summary: '', error: message };
	}
}

// ---------------------------------------------------------------------------
// reactToPartyHistory
// ---------------------------------------------------------------------------

/**
 * AI-analyze recent party actions and generate world reactions:
 * NPC disposition changes, new rumors/quests, or emerging threats.
 */
export async function reactToPartyHistory(
	state: GameState,
	recentTurns: TurnRecord[],
	options: EnrichmentOptions
): Promise<EnrichmentResult> {
	if (recentTurns.length === 0) {
		return { success: false, stateChanges: {}, summary: '', error: 'No recent turns to react to' };
	}

	const location = state.partyLocationId ? state.locations.find((l) => l.id === state.partyLocationId) : null;
	const localNpcs = location
		? state.npcs.filter((n) => n.locationId === location.id && n.alive)
		: [];

	const turnSummaries = recentTurns
		.slice(-10)
		.map((t) => `[Turn ${t.turnNumber}] ${t.action} → ${t.resolvedActionSummary || t.narrativeText.slice(0, 100)}`)
		.join('\n');

	const messages: ChatMessageInput[] = [
		{ role: 'system', content: systemPrompt() },
		{
			role: 'user',
			content: `Based on recent party actions, determine how the world reacts.

RECENT ACTIONS:
${turnSummaries}

PARTY LOCATION: ${location ? describeLocation(location) : 'Unknown'}
LOCAL NPCS: ${localNpcs.length > 0 ? localNpcs.map(describeNpc).join('; ') : 'None'}
KNOWN LOCATIONS: ${state.locations.slice(0, 8).map((l) => `${l.name}[${l.id}]`).join(', ')}
ACTIVE QUESTS: ${state.quests.filter((q) => q.status === 'active' || q.status === 'available').map((q) => `"${q.name}" (${q.status}) — objectives: ${q.objectives.map((o) => `${o.done ? '[x]' : '[ ]'} ${o.text}`).join('; ')}`).join(' | ') || 'None'}

Consider:
- How do local NPCs feel about the party's actions? (disposition changes)
- Are there new rumors or consequences spreading?
- Should any new minor quests or opportunities emerge?
- Are there emerging threats the party should notice?

Only include changes that logically follow from the party's actions. Be conservative.

Return JSON:
{
  "npcChanges": [
    { "npcId": "...", "field": "disposition", "oldValue": 0, "newValue": 10 }
  ],
  "sceneFactsAdded": ["Rumor or atmospheric consequence"],
  "questsAdded": [],
  "npcsAdded": []
}`
		}
	];

	try {
		const raw = await completeChat({ apiKey: options.apiKey, model: options.model ?? 'gpt-4o', messages });
		const changes = parseEnrichmentResponse(raw);

		const parts: string[] = [];
		if (changes.npcChanges?.length) parts.push(`${changes.npcChanges.length} NPC reaction(s)`);
		if (changes.sceneFactsAdded?.length) parts.push(`${changes.sceneFactsAdded.length} new rumor(s)`);
		if (changes.questsAdded?.length) parts.push(`${changes.questsAdded.length} new quest(s)`);
		if (changes.npcsAdded?.length) parts.push(`${changes.npcsAdded.length} new NPC(s)`);

		const summary = parts.length > 0
			? `World reaction: ${parts.join(', ')}`
			: 'World reaction: no significant changes';

		return { success: true, stateChanges: changes, summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, stateChanges: {}, summary: '', error: message };
	}
}
