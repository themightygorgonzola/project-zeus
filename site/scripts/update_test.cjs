const fs = require('fs');

const tp = 'src/lib/game/combat.test.ts';
let code = fs.readFileSync(tp, 'utf8');

code = code.replace(/initEncounterTurnOrder\(/g, 'initEncounterTurnOrder(state, ');
code = code.replace(/advanceTurn\(/g, 'advanceTurn(state, ');
code = code.replace(/resolveAttack\(/g, 'resolveAttack(state, ');
code = code.replace(/resolveNpcAttack\(/g, 'resolveNpcAttack(state, ');
code = code.replace(/resolveCombatantDamage\(/g, 'resolveCombatantDamage(state, ');
code = code.replace(/resolveEncounter\(/g, 'resolveEncounter(state, ');
code = code.replace(/combatantTurnBudget\(/g, 'combatantTurnBudget(state, ');
code = code.replace(/allDefeated\(/g, 'allDefeated(state, ');
code = code.replace(/getLivingCombatants\(/g, 'getLivingCombatants(state, ');

fs.writeFileSync(tp, code);
console.log('Update test complete');
