const fs = require('fs');

const tp = 'src/lib/game/combat.ts';
let code = fs.readFileSync(tp, 'utf8');

// 1. Add getCombatantState
const addGetCombatantState = `
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface CombatantState {
	currentHp: number;
	maxHp: number;
	tempHp: number;
	ac: number;
	conditions: Condition[];
	resistances: string[];
	immunities: string[];
	vulnerabilities: string[];
	defeated: boolean;
	concentration: boolean;
}

export function getCombatantState(state: GameState, combatant: Combatant): CombatantState {
	if (combatant.type === 'character') {
		const pc = state.characters.find(c => c.id === combatant.referenceId);
		if (!pc) return { currentHp: 0, maxHp: 0, tempHp: 0, ac: 10, conditions: [], resistances: [], immunities: [], vulnerabilities: [], defeated: true, concentration: false };
		return {
			currentHp: pc.hp,
			maxHp: pc.maxHp,
			tempHp: pc.tempHp,
			ac: pc.ac,
			conditions: pc.conditions || [],
			resistances: pc.resistances || [],
			immunities: [],
			vulnerabilities: [],
			defeated: pc.hp <= 0,
			concentration: false
		};
	} else {
		const npc = state.npcs.find(n => n.id === combatant.referenceId);
		if (!npc || !npc.statBlock) return { currentHp: 0, maxHp: 0, tempHp: 0, ac: 10, conditions: [], resistances: [], immunities: [], vulnerabilities: [], defeated: true, concentration: false };
		const sb = npc.statBlock;
		return {
			currentHp: sb.hp,
			maxHp: sb.maxHp,
			tempHp: 0,
			ac: sb.ac,
			conditions: [],
			resistances: sb.resistances || [],
			immunities: sb.immunities || [],
			vulnerabilities: sb.vulnerabilities || [],
			defeated: !npc.alive || sb.hp <= 0,
			concentration: false
		};
	}
}

export function updateCombatantHp(state: GameState, combatant: Combatant, hp: number, tempHp: number, defeated: boolean) {
	if (combatant.type === 'character') {
		const pc = state.characters.find(c => c.id === combatant.referenceId);
		if (pc) {
			pc.hp = hp;
			pc.tempHp = tempHp;
		}
	} else {
		const npc = state.npcs.find(n => n.id === combatant.referenceId);
		if (npc && npc.statBlock) {
			npc.statBlock.hp = hp;
			if (defeated) npc.alive = false;
		}
	}
}
`;

if (!code.includes('export function getCombatantState')) {
	code = code.replace('// ---------------------------------------------------------------------------', addGetCombatantState + '\n// ---------------------------------------------------------------------------');
}

// Update functions to have state correctly
code = code.replace(
	/export function initEncounterTurnOrder\([\s\S]*?npcs: NPC\[\]\n\): GameId \| null \{[\s\S]*?return null;\n\}/m,
	`export function initEncounterTurnOrder(state: GameState, encounter: ActiveEncounter, npcs: NPC[]): GameId | null {
	for (const combatantId of encounter.initiativeOrder) {
		const combatant = encounter.combatants.find(c => c.id === combatantId);
		if (!combatant) continue;
		const cState = getCombatantState(state, combatant);
		if (cState.defeated) continue;

		if (combatant.type === 'character') {
			encounter.awaitingActorId = combatantId;
			return combatantId;
		}

		const npc = npcs.find(n => n.id === combatant.referenceId);
		if (npc && npc.role === 'companion') {
			encounter.awaitingActorId = combatantId;
			return combatantId;
		}
	}
	encounter.awaitingActorId = null;
	return null;
}`
);

// update advanceTurn
code = code.replace(
	/let checked = 0;[\s\S]*?return null;/,
	`let checked = 0;
	while (checked < count) {
		encounter.turnIndex++;
		if (encounter.turnIndex >= count) {
			encounter.turnIndex = 0;
			encounter.round++;
		}
		checked++;

		const current = getCurrentCombatant(encounter);
		if (current) {
			const cState = getCombatantState(state, current);
			if (!cState.defeated) {
				return current;
			}
		}
	}

	return null;`
);

// update resolveAttack signature
code = code.replace(
	/export function resolveAttack\(\n\s*attacker: PlayerCharacter,\n\s*target: Combatant,\n\s*weapon: WeaponItem,\n\s*encounter: ActiveEncounter,\n\s*overrideAdv\?: AdvantageState\n\): CombatAttackResult \{/,
	`export function resolveAttack(
	state: GameState,
	attacker: PlayerCharacter,
	target: Combatant,
	weapon: WeaponItem,
	encounter: ActiveEncounter,
	overrideAdv?: AdvantageState
): CombatAttackResult {
	const targetState = getCombatantState(state, target);`
);

// replace target.conditions with targetState.conditions
code = code.replace(/getTargetConditionAdvantage\(target.conditions\)/g, 'getTargetConditionAdvantage(targetState.conditions)');

// replace getTargetDefenses with targetState
code = code.replace(
	/const \{ resistances, immunities, vulnerabilities \} = getTargetDefenses\(target, encounter\);/,
	`const { resistances, immunities, vulnerabilities } = targetState;`
);

// replace applyDamage parameters
code = code.replace(
	/applyDamage\(\n\s*\{ hp: target\.currentHp, maxHp: target\.maxHp, tempHp: target\.tempHp \},/g,
	`applyDamage(
			{ hp: targetState.currentHp, maxHp: targetState.maxHp, tempHp: targetState.tempHp },`
);

// replace damage application
code = code.replace(
	/\/\/ Update the combatant in-place[\s\S]*?if \(damageResult\.currentHp <= 0\) \{[\s\S]*?target\.defeated = true;[\s\S]*?targetDefeated = true;[\s\S]*?\}/m,
	`if (damageResult.currentHp <= 0) targetDefeated = true;
		updateCombatantHp(state, target, damageResult.currentHp, Math.max(0, targetState.tempHp - damageResult.tempHpAbsorbed), targetDefeated);`
);

// resolveNpcAttack
code = code.replace(
	/export function resolveNpcAttack\([\s\S]*?attackerConditions: Condition\[\] = \[\]\n\): CombatAttackResult \{/m,
	`export function resolveNpcAttack(
	state: GameState,
	npc: NPC,
	attackIndex: number,
	target: Combatant,
	encounter: ActiveEncounter,
	attackerConditions: Condition[] = []
): CombatAttackResult {
	const targetState = getCombatantState(state, target);`
);

code = code.replace(
	/target\.ac/g,
	`targetState.ac`
);

code = code.replace(
	/target\.currentHp = damageResult\.currentHp;[\s\S]*?if \(damageResult\.currentHp <= 0\) \{[\s\S]*?target\.defeated = true;[\s\S]*?targetDefeated = true;[\s\S]*?\}/m,
	`if (damageResult.currentHp <= 0) targetDefeated = true;
		updateCombatantHp(state, target, damageResult.currentHp, Math.max(0, targetState.tempHp - damageResult.tempHpAbsorbed), targetDefeated);`
);

code = code.replace(
	/export function resolveCombatantDamage\([\s\S]*?vulnerabilities: string\[\] = \[\]\n\): DamageApplicationResult \| null \{/m,
	`export function resolveCombatantDamage(
	state: GameState,
	encounter: ActiveEncounter,
	targetId: GameId,
	amount: number,
	damageType?: string,
	resistances: string[] = [],
	immunities: string[] = [],
	vulnerabilities: string[] = []
): DamageApplicationResult | null {`
);

code = code.replace(
	/const target = encounter\.combatants\.find\(c => c\.id === targetId\);\n\s*if \(!target \|\| target\.defeated\) return null;\n\n\s*const result = applyDamage\(\n\s*\{ hp: target\.currentHp, maxHp: target\.maxHp, tempHp: target\.tempHp \},/m,
	`const target = encounter.combatants.find(c => c.id === targetId);
	if (!target) return null;
	const targetState = getCombatantState(state, target);
	if (targetState.defeated) return null;

	const result = applyDamage(
		{ hp: targetState.currentHp, maxHp: targetState.maxHp, tempHp: targetState.tempHp },`
);

code = code.replace(
	/target\.currentHp = result\.currentHp;[\s\S]*?if \(result\.currentHp <= 0\) \{[\s\S]*?target\.defeated = true;[\s\S]*?\}/m,
	`let targetDefeated = result.currentHp <= 0;
	updateCombatantHp(state, target, result.currentHp, Math.max(0, targetState.tempHp - result.tempHpAbsorbed), targetDefeated);`
);


code = code.replace(
	/export function resolveEncounter\([\s\S]*?partySize: number\n\): EncounterResolutionResult \{/m,
	`export function resolveEncounter(
	state: GameState,
	encounter: ActiveEncounter,
	outcome: EncounterOutcome,
	creatures: NPC[],
	partySize: number
): EncounterResolutionResult {`
);

code = code.replace(
	/if \(combatant\.type === 'npc' && combatant\.defeated\)/g,
	`if (combatant.type === 'npc' && getCombatantState(state, combatant).defeated)`
);

code = code.replace(
	/if \(combatant\.type === 'character' && !combatant\.defeated\)/g,
	`if (combatant.type === 'character' && !getCombatantState(state, combatant).defeated)`
);


code = code.replace(
	/export function combatantTurnBudget\(\n\s*combatant: Combatant,\n\s*baseSpeed: number\n\): TurnBudget \{/m,
	`export function combatantTurnBudget(
	state: GameState,
	combatant: Combatant,
	baseSpeed: number
): TurnBudget {`
);

code = code.replace(/combatant\.conditions/g, `getCombatantState(state, combatant).conditions`);


code = code.replace(
	/export function allDefeated\(encounter: ActiveEncounter, type: CombatantType\): boolean \{/m,
	`export function allDefeated(state: GameState, encounter: ActiveEncounter, type: CombatantType): boolean {`
);

code = code.replace(
	/\.every\(c => c\.defeated\);/g,
	`.every(c => getCombatantState(state, c).defeated);`
);


code = code.replace(
	/export function getLivingCombatants\(encounter: ActiveEncounter, type\?: CombatantType\): Combatant\[\] \{/m,
	`export function getLivingCombatants(state: GameState, encounter: ActiveEncounter, type?: CombatantType): Combatant[] {`
);

code = code.replace(
	/!c\.defeated && \(type === undefined \|\| c\.type === type\)/g,
	`!getCombatantState(state, c).defeated && (type === undefined || c.type === type)`
);

// remove getTargetDefenses completely
code = code.replace(/\/\*\*[\s\S]*?function getTargetDefenses[\s\S]*?vulnerabilities\. \*\/\nfunction getTargetDefenses\([\s\S]*?vulnerabilities: target\.vulnerabilities\n\t\};\n\}/m, '');

fs.writeFileSync(tp, code);
console.log('Update complete');
