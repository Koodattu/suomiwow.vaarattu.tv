import assert from "node:assert/strict";
import test from "node:test";
import { getPenultimateBossSummary } from "../src/utils/horse-race";

const raidBosses = [1, 2, 3, 4].map((id) => ({ id, name: `Boss ${id}` }));
const boss = (bossId: number, kills = 0, pullCount = 0) => ({ bossId, kills, pullCount, bestPercent: 100 });

test("selects the second-to-last encounter by raid order and matches guild data by ID", () => {
  const phase = { phaseId: 2, phaseName: "Phase Two", bossHealth: 35, fightCompletion: 35, displayString: "35% P2" };
  const result = getPenultimateBossSummary(raidBosses, [boss(4, 0, 9), { ...boss(3, 0, 12), bestPercent: 35, bestPullPhase: phase }]);
  assert.deepEqual(result, { bossId: 3, bossName: "Boss 3", eligible: true, kills: 0, pullCount: 12, bestPercent: 35, bestPullPhase: phase, firstKillTime: undefined });
});

test("uses the target's first kill even when the final boss was killed later", () => {
  const firstKillTime = new Date("2026-09-01T18:00:00Z");
  const result = getPenultimateBossSummary(raidBosses, [
    { ...boss(4, 1, 90), firstKillTime: new Date("2026-09-05T18:00:00Z") },
    { ...boss(3, 1, 40), firstKillTime },
  ]);
  assert.equal(result?.eligible, true);
  assert.equal(result?.kills, 1);
  assert.equal(result?.firstKillTime, firstKillTime);
});

test("guilds with all preceding bosses killed wait at the start without target pulls", () => {
  const result = getPenultimateBossSummary(raidBosses, [boss(2, 1), boss(1, 1)]);
  assert.equal(result?.eligible, true);
  assert.equal(result?.pullCount, 0);
  assert.equal(result?.bestPercent, 100);
  assert.equal(result?.kills, 0);
  assert.equal(result?.firstKillTime, undefined);
});

test("missing or unrelated boss data does not invent eligibility or a kill", () => {
  assert.equal(getPenultimateBossSummary(raidBosses, [])?.eligible, false);
  assert.equal(getPenultimateBossSummary(raidBosses, [boss(1, 1), boss(4, 1)])?.eligible, false);
  const unknownKillTime = getPenultimateBossSummary(raidBosses, [boss(3, 1)]);
  assert.equal(unknownKillTime?.eligible, true);
  assert.equal(unknownKillTime?.firstKillTime, undefined);
});

test("raids with fewer than two bosses have no second-to-last race", () => {
  assert.equal(getPenultimateBossSummary([], []), undefined);
  assert.equal(getPenultimateBossSummary(raidBosses.slice(0, 1), []), undefined);
  assert.equal(getPenultimateBossSummary(raidBosses.slice(0, 2), [])?.bossId, 1);
});
