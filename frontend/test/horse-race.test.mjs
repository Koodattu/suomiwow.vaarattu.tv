import assert from "node:assert/strict";
import test from "node:test";
import { buildEntries, buildCombinedRace } from "../src/lib/horse-race.ts";

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

test("combined race places each guild once across start, both bosses, pit stop, and finish", () => {
  const race = buildCombinedRace([
    guild("waiting", { currentBossPulls: 0 }, { pullCount: 0 }),
    guild("coiled altar", {}, { bestPercent: 40 }),
    guild("pit stop", { bossesDefeated: 3, currentBossPulls: 0 }, { kills: 1 }),
    guild("ulatek", { bossesDefeated: 3, bestPullPercent: 25 }, { kills: 1 }),
    guild("cleared", { bossesDefeated: 4 }, { kills: 1 }),
    guild("too early", {}, { eligible: false }),
  ], 1, 1, "show");
  assert.deepEqual(race.notStarted.map((entry) => entry.id), ["waiting"]);
  assert.deepEqual(race.penultimate.map((entry) => entry.id), ["coiled altar"]);
  assert.equal(race.penultimate[0].bossHealth, 40);
  assert.deepEqual(race.pitStop.map((entry) => entry.id), ["pit stop"]);
  assert.equal(race.pitStop[0].isFinished, false);
  assert.deepEqual(race.final.map((entry) => entry.id), ["ulatek"]);
  assert.equal(race.final[0].bossHealth, 25);
  assert.deepEqual(race.finished.map((entry) => entry.id), ["cleared"]);
  const ids = Object.values(race).flat().map((entry) => entry.id);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
});

test("a guild advances from the first half through the pit stop to the finish", () => {
  const stages = [
    [guild("one"), "penultimate"],
    [guild("one", { bossesDefeated: 3, currentBossPulls: 0 }, { kills: 1 }), "pitStop"],
    [guild("one", { bossesDefeated: 3, currentBossPulls: 1, bestPullPercent: 99 }, { kills: 1 }), "final"],
    [guild("one", { bossesDefeated: 4 }, { kills: 1 }), "finished"],
  ];
  for (const [entry, stage] of stages) {
    const race = buildCombinedRace([entry], 1, 1, "show");
    assert.equal(race[stage][0].id, "one");
    assert.equal(Object.values(race).flat().length, 1);
  }
});

test("known second-to-last kills wait at the pit even with incomplete aggregate progress", () => {
  const race = buildCombinedRace([guild("one", { bossesDefeated: 2, currentBossPulls: 0 }, { kills: 1 })], 1, 1, "show");
  assert.deepEqual(race.pitStop.map((entry) => entry.id), ["one"]);
  assert.equal(race.finished.length, 0);
});

test("combined finish ranks use final kills and never penultimate kill order", () => {
  const race = buildCombinedRace([
    guild("second", { bossesDefeated: 4, lastKillTime: "2026-09-09T18:00:00Z" }, { kills: 1, firstKillTime: "2026-09-01T18:00:00Z" }),
    guild("first", { bossesDefeated: 4, lastKillTime: "2026-09-05T18:00:00Z" }, { kills: 1, firstKillTime: "2026-09-02T18:00:00Z" }),
  ], 1, 1, "show");
  assert.deepEqual(race.finished.map((entry) => entry.id), ["first", "second"]);
  assert.equal(race.pitStop.length, 0);
});

test("Show and Hide apply to the combined race, only for the current raid", () => {
  const guilds = [guild("one")];
  assert.ok(buildCombinedRace(guilds, 1, 1, "show"));
  assert.equal(buildCombinedRace(guilds, 1, 1, "hide"), null);
  assert.equal(buildCombinedRace(guilds, 1, 2, "show"), null);
  assert.equal(buildCombinedRace(guilds, null, 1, "show"), null);
  const oldPayload = buildCombinedRace([guild("old payload", { penultimateBoss: undefined, bossesDefeated: 3 })], 1, 1, "show");
  assert.equal(oldPayload.penultimate.length, 0);
  assert.equal(oldPayload.final.length, 1);
});

test("Auto counts distinct guilds and keeps the race open while either boss has contenders", () => {
  assert.equal(buildCombinedRace([guild("one", { bossesDefeated: 3 }, { kills: 1 })], 1, 1, "auto"), null);
  assert.ok(buildCombinedRace([guild("one"), guild("two")], 1, 1, "auto"));
  const penultimateFinishers = Array.from({ length: 11 }, (_, i) => guild(`guild ${i}`, { bossesDefeated: 3, currentBossPulls: 0 }, { kills: 1 }));
  assert.ok(buildCombinedRace(penultimateFinishers, 1, 1, "auto"));
  const finishers = Array.from({ length: 11 }, (_, i) => guild(`guild ${i}`, { bossesDefeated: 4 }, { kills: 1 }));
  assert.equal(buildCombinedRace([...finishers, guild("one"), guild("two")], 1, 1, "auto"), null);
  assert.ok(buildCombinedRace([...finishers, guild("one"), guild("two"), guild("three")], 1, 1, "auto"));
});
