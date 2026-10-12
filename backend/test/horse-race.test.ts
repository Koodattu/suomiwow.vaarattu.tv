import assert from "node:assert/strict";
import test from "node:test";
import { getPenultimateBossSummary } from "../src/utils/horse-race";

const raidBosses = [1, 2, 3, 4].map((id) => ({ id, name: `Boss ${id}` }));
const boss = (bossId: number, kills = 0, pullCount = 0) => ({ bossId, kills, pullCount, bestPercent: 100 });

// The live WCL metadata appends Nymrissa after Ula'tek; this is not progression order.
const venomousAbyssBosses = [
  { id: 3470, name: "Nek'zali the Soulcoiler" },
  { id: 3445, name: "Entombed Sentinels" },
  { id: 3455, name: "Vashnik the Malignant" },
  { id: 3497, name: "The Lost Explorers" },
  { id: 3420, name: "Sszorak" },
  { id: 3421, name: "The Twin Fangs" },
  { id: 3429, name: "The Coiled Altar" },
  { id: 3492, name: "Ula'tek" },
  { id: 3379, name: "Nymrissa Wavecaller" },
];

test("raid 53 tracks The Coiled Altar even with Nymrissa appended after Ula'tek", () => {
  const result = getPenultimateBossSummary(53, venomousAbyssBosses, [
    { ...boss(3429, 0, 53), bestPercent: 50.12 },
    { ...boss(3492, 0, 11), bestPercent: 90.97 },
  ]);
  assert.equal(result?.bossId, 3429);
  assert.equal(result?.bossName, "The Coiled Altar");
  assert.equal(result?.eligible, true);
  assert.equal(result?.pullCount, 53);
  assert.equal(result?.bestPercent, 50.12);
});

test("raid 53 starters require all seven earlier kills, including Nymrissa but excluding Ula'tek", () => {
  const earlierKills = venomousAbyssBosses.filter((entry) => entry.id !== 3429 && entry.id !== 3492).map((entry) => boss(entry.id, 1));
  const waiting = getPenultimateBossSummary(53, venomousAbyssBosses, earlierKills);
  assert.equal(waiting?.eligible, true);
  assert.equal(waiting?.pullCount, 0);
  assert.equal(waiting?.kills, 0);
  assert.equal(getPenultimateBossSummary(53, venomousAbyssBosses, earlierKills.filter((entry) => entry.bossId !== 3379))?.eligible, false);
});

test("guilds progressing Ula'tek have already finished the Coiled Altar race", () => {
  const firstKillTime = new Date("2026-09-28T18:00:00Z");
  const result = getPenultimateBossSummary(53, venomousAbyssBosses, [
    { ...boss(3429, 1, 70), firstKillTime },
    { ...boss(3492, 0, 147), bestPercent: 2.09 },
  ]);
  assert.equal(result?.bossId, 3429);
  assert.equal(result?.kills, 1);
  assert.equal(result?.firstKillTime, firstKillTime);
});

test("raid 53 never falls back to the wrong target when The Coiled Altar metadata is missing", () => {
  assert.equal(getPenultimateBossSummary(53, venomousAbyssBosses.filter((entry) => entry.id !== 3429), []), undefined);
});

test("selects the second-to-last encounter by raid order and matches guild data by ID", () => {
  const phase = { phaseId: 2, phaseName: "Phase Two", bossHealth: 35, fightCompletion: 35, displayString: "35% P2" };
  const result = getPenultimateBossSummary(1, raidBosses, [boss(4, 0, 9), { ...boss(3, 0, 12), bestPercent: 35, bestPullPhase: phase }]);
  assert.deepEqual(result, { bossId: 3, bossName: "Boss 3", eligible: true, kills: 0, pullCount: 12, bestPercent: 35, bestPullPhase: phase, firstKillTime: undefined });
});

test("uses the target's first kill even when the final boss was killed later", () => {
  const firstKillTime = new Date("2026-09-01T18:00:00Z");
  const result = getPenultimateBossSummary(1, raidBosses, [
    { ...boss(4, 1, 90), firstKillTime: new Date("2026-09-05T18:00:00Z") },
    { ...boss(3, 1, 40), firstKillTime },
  ]);
  assert.equal(result?.eligible, true);
  assert.equal(result?.kills, 1);
  assert.equal(result?.firstKillTime, firstKillTime);
});

test("guilds with all preceding bosses killed wait at the start without target pulls", () => {
  const result = getPenultimateBossSummary(1, raidBosses, [boss(2, 1), boss(1, 1)]);
  assert.equal(result?.eligible, true);
  assert.equal(result?.pullCount, 0);
  assert.equal(result?.bestPercent, 100);
  assert.equal(result?.kills, 0);
  assert.equal(result?.firstKillTime, undefined);
});

test("missing or unrelated boss data does not invent eligibility or a kill", () => {
  assert.equal(getPenultimateBossSummary(1, raidBosses, [])?.eligible, false);
  assert.equal(getPenultimateBossSummary(1, raidBosses, [boss(1, 1), boss(4, 1)])?.eligible, false);
  const unknownKillTime = getPenultimateBossSummary(1, raidBosses, [boss(3, 1)]);
  assert.equal(unknownKillTime?.eligible, true);
  assert.equal(unknownKillTime?.firstKillTime, undefined);
});

test("raids with fewer than two bosses have no second-to-last race", () => {
  assert.equal(getPenultimateBossSummary(1, [], []), undefined);
  assert.equal(getPenultimateBossSummary(1, raidBosses.slice(0, 1), []), undefined);
  assert.equal(getPenultimateBossSummary(1, raidBosses.slice(0, 2), [])?.bossId, 1);
});
