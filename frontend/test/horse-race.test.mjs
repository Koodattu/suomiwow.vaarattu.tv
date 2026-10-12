import assert from "node:assert/strict";
import test from "node:test";
import { buildEntries, buildVisibleRaces } from "../src/lib/horse-race.ts";

function guild(id, summary = {}, boss = {}) {
  return {
    _id: id, name: id, realm: "Test realm",
    progress: [{
      raidId: 1, difficulty: "mythic", bossesDefeated: 2, totalBosses: 4,
      currentBossPulls: 20, bestPullPercent: 75, guildRank: 10,
      penultimateBoss: { bossId: 3, bossName: "Boss 3", eligible: true, kills: 0, pullCount: 5, bestPercent: 40, ...boss },
      ...summary,
    }],
  };
}

test("second-to-last race separates eligible starters, contenders, and finishers", () => {
  const phase = { displayString: "40% P2" };
  const race = buildEntries([
    guild("too early", {}, { eligible: false }),
    guild("waiting", {}, { pullCount: 0 }),
    guild("progressing", {}, { bestPullPhase: phase }),
    guild("finished", { bossesDefeated: 3 }, { kills: 1 }),
    guild("missing", { penultimateBoss: undefined }),
    guild("heroic", { difficulty: "heroic" }),
  ], 1, "penultimate");
  assert.deepEqual(race.notStarted.map((entry) => entry.id), ["waiting"]);
  assert.deepEqual(race.unfinished.map((entry) => entry.id), ["progressing"]);
  assert.equal(race.unfinished[0].trackProgress, 60);
  assert.equal(race.unfinished[0].progress.bestPullPhase, phase);
  assert.deepEqual(race.finished.map((entry) => entry.id), ["finished"]);
  assert.equal(race.finished[0].bossHealth, 0);
});

test("finishing the raid never changes second-to-last boss finish order", () => {
  const early = guild("early", { bossesDefeated: 4, lastKillTime: "2026-09-09T18:00:00Z", guildRank: 2 }, { kills: 1, firstKillTime: "2026-09-01T18:00:00Z" });
  const late = guild("late", { bossesDefeated: 4, lastKillTime: "2026-09-05T18:00:00Z", guildRank: 1 }, { kills: 1, firstKillTime: "2026-09-02T18:00:00Z" });
  const unknown = guild("unknown", { bossesDefeated: 4, lastKillTime: "2026-08-01T18:00:00Z" }, { kills: 1 });
  assert.deepEqual(buildEntries([late, unknown, early], 1, "penultimate").finished.map((entry) => entry.id), ["early", "late", "unknown"]);
  assert.equal(buildEntries([unknown], 1, "penultimate").finished[0].progress.lastKillTime, undefined);
  assert.deepEqual(buildEntries([early, late], 1, "final").finished.map((entry) => entry.id), ["late", "early"]);
});

test("final race retains its existing eligibility and current-boss progress", () => {
  const race = buildEntries([
    guild("penultimate"),
    guild("waiting", { bossesDefeated: 3, currentBossPulls: 0 }),
    guild("progressing", { bossesDefeated: 3, bestPullPercent: 25 }),
    guild("cleared", { bossesDefeated: 4 }),
  ], 1);
  assert.deepEqual(race.notStarted.map((entry) => entry.id), ["waiting"]);
  assert.deepEqual(race.unfinished.map((entry) => entry.id), ["progressing"]);
  assert.equal(race.unfinished[0].trackProgress, 75);
  assert.deepEqual(race.finished.map((entry) => entry.id), ["cleared"]);
});

test("Show and Hide settings apply to both races, only for the current raid", () => {
  const guilds = [guild("one")];
  assert.deepEqual(buildVisibleRaces(guilds, 1, 1, "show").map((race) => race.target), ["final", "penultimate"]);
  assert.deepEqual(buildVisibleRaces(guilds, 1, 1, "hide"), []);
  assert.deepEqual(buildVisibleRaces(guilds, 1, 2, "show"), []);
  assert.deepEqual(buildVisibleRaces(guilds, null, 1, "show"), []);
  assert.deepEqual(buildVisibleRaces([guild("old payload", { penultimateBoss: undefined })], 1, 1, "show").map((race) => race.target), ["final"]);
});

test("Auto independently starts and ends each boss race", () => {
  assert.deepEqual(buildVisibleRaces([guild("one")], 1, 1, "auto"), []);
  assert.deepEqual(buildVisibleRaces([guild("one"), guild("two")], 1, 1, "auto").map((race) => race.target), ["penultimate"]);
  const finishers = Array.from({ length: 11 }, (_, i) => guild(`guild ${i}`, { bossesDefeated: 3 }, { kills: 1 }));
  assert.deepEqual(buildVisibleRaces(finishers, 1, 1, "auto").map((race) => race.target), ["final"]);
  assert.deepEqual(buildVisibleRaces([...finishers, guild("one"), guild("two"), guild("three")], 1, 1, "auto").map((race) => race.target), ["final", "penultimate"]);
});
