/**
 * Encounter Classifier — LLM-powered encounter start validation and surprise
 * detection. Replaces the regex-based combat evidence check in the sanitizer.
 *
 * When the AI proposes an encounterStarted, this classifier:
 *  1. Confirms whether the narrative actually describes combat beginning
 *  2. Detects surprise / ambush scenarios
 *  3. Returns pre-combat damage to apply before initiative
 *
 * Runs on gpt-4o-mini (~200 tokens, ~100-150ms) — only called when
 * encounterStarted is present in the state changes.
 */

import { completeChatJSON } from './openai';
import { roll } from '$lib/game/mechanics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncounterClassification {
	/** Whether the narrative genuinely describes combat starting. */
	shouldStartEncounter: boolean;
	/** Whether one side is surprised (ambush, sneak attack, etc.). */
	isSurprise: boolean;
	/** Which side is surprised. */
	surprisedSide?: 'party' | 'enemies';
	/** Pre-combat damage described in the narrative (ambush hits, etc.). */
	preRoundDamage: PreRoundDamage[];
}

export interface PreRoundDamage {
	/** Who is dealing the damage (attacker description). */
	attackerDescription: string;
	/** Who is taking the damage (target description). */
	targetDescription: string;
	/** Dice expression for the damage (e.g. "1d8+3"). */
	damage: string;
	/** Damage type (e.g. "piercing", "slashing"). */
	damageType: string;
}

// ---------------------------------------------------------------------------
// Classifier Prompt
// ---------------------------------------------------------------------------

const ENCOUNTER_CLASSIFIER_SYSTEM = `You are a combat encounter classifier for a D&D 5e RPG engine, returning JSON.

Given a narrative text that accompanies an encounter start proposal, classify:
1. Does the narrative genuinely describe combat beginning (hostilities, attacks, ambush)?
   - Observation, scouting, hearing rumors, seeing enemies at a distance = NOT combat
   - Actual aggression, weapons drawn, creatures attacking = YES combat
2. Is there a surprise round? (ambush, sneak attack, unexpected attack)
3. Which side is surprised?
4. Did any pre-combat attacks land in the narrative? If so, describe them.

For pre-combat damage, use appropriate D&D damage dice:
- Light weapons/claws: "1d6+2"
- Medium weapons/bites: "1d8+3"  
- Heavy weapons/large creatures: "2d6+3"
- Arrows/bolts: "1d8+2"
- Simple traps/falling rocks: "2d6"

Return JSON:
{
  "shouldStartEncounter": true/false,
  "isSurprise": true/false,
  "surprisedSide": "party" | "enemies" | null,
  "preRoundDamage": [
    { "attackerDescription": "...", "targetDescription": "...", "damage": "1d8+3", "damageType": "piercing" }
  ]
}

Rules:
- If the narrative describes creatures being spotted but not yet attacking, shouldStartEncounter can be true but isSurprise is false and preRoundDamage is empty.
- Only include preRoundDamage for attacks that the narrative explicitly describes as landing/hitting.
- When the party initiates a surprise attack that "lands" in the narrative, surprisedSide is "enemies".
- When creatures ambush the party, surprisedSide is "party".
- If neither side is surprised, set isSurprise to false and surprisedSide to null.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an encounter start using a focused LLM call.
 * Only called when the AI proposes encounterStarted — not on every turn.
 */
export async function classifyEncounterStart(
	narrativeText: string,
	creatureNames: string[],
	apiKey: string,
	model = 'gpt-4o-mini'
): Promise<EncounterClassification> {
	const userContent = `Narrative text:
"${narrativeText}"

Proposed encounter creatures: ${creatureNames.join(', ')}

Classify this encounter start.`;

	try {
		const rawJson = await completeChatJSON({
			apiKey,
			model,
			messages: [
				{ role: 'system', content: ENCOUNTER_CLASSIFIER_SYSTEM },
				{ role: 'user', content: userContent }
			]
		});

		const parsed = JSON.parse(rawJson);

		const result: EncounterClassification = {
			shouldStartEncounter: parsed.shouldStartEncounter !== false,
			isSurprise: parsed.isSurprise === true,
			preRoundDamage: []
		};

		if (parsed.surprisedSide === 'party' || parsed.surprisedSide === 'enemies') {
			result.surprisedSide = parsed.surprisedSide;
		}

		if (Array.isArray(parsed.preRoundDamage)) {
			result.preRoundDamage = parsed.preRoundDamage
				.filter((d: unknown) => d && typeof d === 'object')
				.map((d: Record<string, unknown>) => ({
					attackerDescription: String(d.attackerDescription ?? 'unknown'),
					targetDescription: String(d.targetDescription ?? 'unknown'),
					damage: String(d.damage ?? '1d6'),
					damageType: String(d.damageType ?? 'piercing')
				}));
		}

		return result;
	} catch (err) {
		console.error('[classifyEncounterStart] Failed, defaulting to allow encounter:', err);
		// On failure, allow the encounter (trust the AI's proposal) but no surprise
		return {
			shouldStartEncounter: true,
			isSurprise: false,
			preRoundDamage: []
		};
	}
}

// ---------------------------------------------------------------------------
// Surprise Damage Resolution
// ---------------------------------------------------------------------------

export interface ResolvedSurpriseDamage {
	targetId: string;
	targetName: string;
	attackerDescription: string;
	damageRoll: number;
	damageType: string;
	diceExpression: string;
}

/**
 * Resolve pre-combat surprise damage by matching narrative target descriptions
 * to actual combatants and rolling damage dice.
 *
 * @param preRoundDamage - Damage entries from the encounter classifier
 * @param combatantMap - Map of combatant names (lowered) → { id, name, type }
 * @returns Array of resolved damage to apply to combatant HP
 */
export function resolveSurpriseDamage(
	preRoundDamage: PreRoundDamage[],
	combatantMap: Map<string, { id: string; name: string; type: 'pc' | 'npc' }>
): ResolvedSurpriseDamage[] {
	const results: ResolvedSurpriseDamage[] = [];

	for (const dmg of preRoundDamage) {
		const targetDesc = dmg.targetDescription.toLowerCase();

		// Try to match by name (fuzzy: check if any combatant name is contained)
		let matched: { id: string; name: string; type: 'pc' | 'npc' } | undefined;
		for (const [key, val] of combatantMap) {
			if (targetDesc.includes(key) || key.includes(targetDesc)) {
				matched = val;
				break;
			}
		}

		if (!matched) {
			console.warn(`[resolveSurpriseDamage] Could not match target "${dmg.targetDescription}" to any combatant — skipped`);
			continue;
		}

		// Roll the damage dice
		try {
			const diceResult = roll(dmg.damage);
			const totalDamage = diceResult.total;

			if (totalDamage > 0) {
				results.push({
					targetId: matched.id,
					targetName: matched.name,
					attackerDescription: dmg.attackerDescription,
					damageRoll: totalDamage,
					damageType: dmg.damageType,
					diceExpression: dmg.damage
				});
			}
		} catch (err) {
			console.warn(`[resolveSurpriseDamage] Invalid damage notation "${dmg.damage}" — skipped`);
		}
	}

	return results;
}
