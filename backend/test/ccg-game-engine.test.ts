import assert from "node:assert/strict";
import test from "node:test";
import {
  CCG_EXPEDITION_ENCOUNTERS,
  CcgGameCard,
  CcgGameEncounter,
  getCcgGameGradeCost,
  getCcgGameRosterCost,
  resolveCcgGameUtilities,
  simulateCcgEncounter,
} from "../src/utils/ccg-game-engine";

function card(id: string, role: CcgGameCard["role"], performance: number, mechanics: number, classID = 7): CcgGameCard {
  const result: CcgGameCard = {
    id,
    identityId: id,
    name: id,
    role,
    classID,
    specName: role === "healer" ? "Restoration" : role === "tank" ? "Protection" : "Elemental",
    performance,
    mechanics,
    mythicPlus: 50,
    tierGrade: "C",
    utilities: [],
  };
  result.utilities = resolveCcgGameUtilities(result);
  return result;
}

const party = [
  card("tank", "tank", 70, 76, 2),
  card("healer", "healer", 72, 78, 5),
  card("damage-1", "dps", 78, 75, 7),
  card("damage-2", "dps", 76, 73, 8),
  card("damage-3", "dps", 74, 71, 11),
];

const assignments = {
  interruptCardIds: ["damage-1", "damage-2"],
  dispelCardId: "healer",
  soakCardIds: ["tank", "damage-3"],
  heroismPhase: "sunwell-collapse",
  defensivePhase: "sunwell-collapse",
  strategy: "standard" as const,
};

test("the same encounter input and seed produces an identical immutable report", () => {
  const encounter = CCG_EXPEDITION_ENCOUNTERS[2];
  const first = simulateCcgEncounter(encounter, { seed: "weekly-seed", roster: party, assignments });
  const second = simulateCcgEncounter(encounter, { seed: "weekly-seed", roster: party, assignments });
  assert.deepEqual(first, second);
  assert.equal(first.phases.every((phase) => phase.checks.every((check) => check.die >= 1 && check.die <= 20)), true);
  assert.equal(first.phases.every((phase) => phase.checks.every((check) => Math.abs(check.dieModifier) <= 5.3)), true);
});

test("performance and mechanics affect their intended check axes without a combined-score input", () => {
  const encounter: CcgGameEncounter = {
    id: "axis-test",
    name: "Axis Test",
    version: "1",
    baseDurationSeconds: 100,
    phases: [{
      id: "test",
      label: "Test",
      healthShare: 100,
      checks: [
        { id: "damage", type: "damage", label: "Damage", difficulty: 60 },
        { id: "execution", type: "execution", label: "Execution", difficulty: 60 },
      ],
    }],
  };
  const highPerformance = party.map((row) => ({ ...row, performance: 90, mechanics: 40 }));
  const highMechanics = party.map((row) => ({ ...row, performance: 40, mechanics: 90 }));
  const performanceResult = simulateCcgEncounter(encounter, { seed: "axis", roster: highPerformance });
  const mechanicsResult = simulateCcgEncounter(encounter, { seed: "axis", roster: highMechanics });
  const performanceChecks = performanceResult.phases[0].checks;
  const mechanicsChecks = mechanicsResult.phases[0].checks;
  assert.ok(performanceChecks[0].contribution > mechanicsChecks[0].contribution);
  assert.ok(mechanicsChecks[1].contribution > performanceChecks[1].contribution);
  assert.equal("combined" in highPerformance[0], false);
});

test("manual interrupt assignments materially change the same seeded pull", () => {
  const encounter = CCG_EXPEDITION_ENCOUNTERS[1];
  const assigned = simulateCcgEncounter(encounter, { seed: "assignment", roster: party, assignments });
  const unassigned = simulateCcgEncounter(encounter, { seed: "assignment", roster: party, assignments: { ...assignments, interruptCardIds: [] } });
  const assignedCheck = assigned.phases[0].checks.find((check) => check.type === "interrupt")!;
  const unassignedCheck = unassigned.phases[0].checks.find((check) => check.type === "interrupt")!;
  assert.ok(assignedCheck.total > unassignedCheck.total);
});

test("utility tags follow stable class identity rules", () => {
  assert.deepEqual(new Set(resolveCcgGameUtilities(card("shaman", "dps", 50, 50, 7))), new Set(["ranged", "burst", "interrupt", "ranged_interrupt", "dispel", "heroism", "raid_defensive", "crowd_control"]));
  const druid = resolveCcgGameUtilities(card("druid", "healer", 50, 50, 11));
  assert.equal(druid.includes("battle_resurrection"), true);
  assert.equal(druid.includes("mobility"), true);
});

test("grade is a transparent competitive cost and mercenary presentation adds no hidden finish power", () => {
  assert.equal(getCcgGameGradeCost("S"), 7);
  assert.equal(getCcgGameGradeCost("F"), 1);
  assert.equal(getCcgGameRosterCost([{ tierGrade: "S" }, { tierGrade: "F" }, { tierGrade: "C", mercenary: true }]), 12);
});

test("stronger decisions dominate pass rates across many shared seeds", () => {
  const encounter = CCG_EXPEDITION_ENCOUNTERS[2];
  const weakParty = party.map((row) => ({ ...row, performance: 48, mechanics: 48 }));
  let strongPasses = 0;
  let weakPasses = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    strongPasses += simulateCcgEncounter(encounter, { seed: String(seed), roster: party, assignments }).phases.flatMap((phase) => phase.checks).filter((check) => check.passed).length;
    weakPasses += simulateCcgEncounter(encounter, { seed: String(seed), roster: weakParty, assignments: { strategy: "aggressive" } }).phases.flatMap((phase) => phase.checks).filter((check) => check.passed).length;
  }
  assert.ok(strongPasses > weakPasses + 100);
});
