import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Guild from "../src/models/Guild";
import Fight from "../src/models/Fight";
import TierList from "../src/models/TierList";
import tierListService from "../src/services/tierlist.service";

function bosses(count: number, pulls: number, seconds: number) {
  return Array.from({ length: count }, (_, index) => ({
    bossId: index + 1,
    kills: 1,
    firstKillReportCode: `report-${index}`,
    pullCount: pulls,
    timeSpent: seconds,
  }));
}

function guild(name: string, mythicBosses = bosses(8, 50, 10000), heroicBosses = bosses(8, 5, 1000)) {
  return {
    guildId: name,
    guildName: name,
    raidId: 46,
    heroicBosses,
    mythicBosses,
    heroicBossesDefeated: heroicBosses.filter(b => b.kills > 0).length,
    mythicBossesDefeated: mythicBosses.filter(b => b.kills > 0).length,
    heroicTotalBosses: 8,
    mythicTotalBosses: 8,
    heroicWorldRank: null,
    mythicWorldRank: null,
    heroicGuildRank: null,
    mythicGuildRank: null,
  };
}

function score(target: ReturnType<typeof guild>, pool: ReturnType<typeof guild>[]) {
  return (tierListService as any).calculateGuildRaidScores(target, pool) as {
    efficiencyScore: number;
    heroicEfficiencyScore: number;
    mythicEfficiencyScore: number;
    speedScore: number;
    overallScore: number;
  };
}

test("one logged first-boss kill cannot outrank full clears on efficiency", () => {
  const gifu = guild("Gifu", bosses(1, 1, 485.913));
  const cleared = [guild("Clear A"), guild("Clear B", bosses(8, 60, 12000)), guild("Clear C", bosses(8, 70, 14000))];
  const pool = [gifu, ...cleared];

  assert.ok(score(gifu, pool).mythicEfficiencyScore <= 24, "1/8 Mythic must stay within its progress credit");
  for (const other of cleared) {
    assert.ok(score(gifu, pool).efficiencyScore < score(other, pool).efficiencyScore);
  }
});

test("equal effort earns neutral comparison credit, with fixed difficulty weights", () => {
  const pool = [guild("A"), guild("B"), guild("C")];
  // Neutral comparisons: 25% progress + 50% * 0.5 time + 25% * 0.5 pulls.
  assert.equal(score(pool[0], pool).efficiencyScore, 625);
  const heroicOnly = guild("Heroic", [], bosses(8, 5, 1000));
  const mythicOnly = guild("Mythic", bosses(8, 50, 10000), []);
  const noLogs = guild("No logs", [], []);
  assert.equal(score(heroicOnly, [...pool, heroicOnly]).efficiencyScore, 125);
  assert.equal(score(mythicOnly, [...pool, mythicOnly]).efficiencyScore, 500);
  assert.equal(score(noLogs, [...pool, noLogs]).efficiencyScore, 0);
});

test("fewer than three usable guilds receive neutral comparison credit", () => {
  const fast = guild("Fast", bosses(8, 1, 10));
  const slow = guild("Slow", bosses(8, 100, 100000));
  assert.equal(score(fast, [fast]).mythicEfficiencyScore, 625);
  assert.equal(score(fast, [fast, slow]).mythicEfficiencyScore, 625);
  assert.equal(score(slow, [fast, slow]).mythicEfficiencyScore, 625);
});

test("less effort on the same bosses improves efficiency", () => {
  const pool = [guild("Fast", bosses(8, 25, 5000)), guild("Median"), guild("Slow", bosses(8, 100, 20000))];
  assert.equal(score(pool[0], pool).mythicEfficiencyScore, 750);
  assert.equal(score(pool[1], pool).mythicEfficiencyScore, 625);
  assert.equal(score(pool[2], pool).mythicEfficiencyScore, 500);
});

test("boss difficulty and fight duration do not distort comparisons between bosses", () => {
  const pool = [guild("Fast", bosses(8, 25, 5000)), guild("Median"), guild("Slow", bosses(8, 100, 20000))];
  const scaled = pool.map(g => ({
    ...g,
    mythicBosses: g.mythicBosses.map(b => b.bossId === 8 ? { ...b, pullCount: b.pullCount * 100, timeSpent: b.timeSpent * 1000 } : b),
  }));
  for (let i = 0; i < pool.length; i++) {
    assert.equal(score(scaled[i], scaled).efficiencyScore, score(pool[i], pool).efficiencyScore);
  }
});

test("one extreme log cannot set the scoring scale for everybody", () => {
  const normal = [guild("A"), guild("B"), guild("C")];
  const tiny = guild("Tiny logs", bosses(8, 1, 0.001));
  const huge = guild("Huge logs", bosses(8, 1000000, 100000000));
  assert.equal(score(normal[0], [...normal, tiny]).mythicEfficiencyScore, 625);
  assert.equal(score(normal[0], [...normal, huge]).mythicEfficiencyScore, 625);
});

test("samples from a different boss cannot change a guild's efficiency", () => {
  const pool = [guild("A", bosses(1, 10, 1000)), guild("B", bosses(1, 20, 2000)), guild("C", bosses(1, 30, 3000))];
  const otherBoss = guild("Other boss", [{ ...bosses(1, 1, 1)[0], bossId: 2 }]);
  assert.equal(score(pool[0], [...pool, otherBoss]).mythicEfficiencyScore, score(pool[0], pool).mythicEfficiencyScore);
});

test("unverified kills and invalid effort cannot earn credit or affect benchmarks", () => {
  const invalid = bosses(8, 1, 1).map((boss, i) => {
    const changes = [
      { kills: 0 }, { firstKillReportCode: "" }, { pullCount: 0 }, { timeSpent: 0 },
      { pullCount: -1 }, { timeSpent: -1 }, { timeSpent: Number.NaN }, { timeSpent: Number.POSITIVE_INFINITY },
    ];
    return { ...boss, ...changes[i] };
  });
  const bad = guild("Invalid", invalid, []);
  const valid = [guild("A"), guild("B"), guild("C")];
  assert.equal(score(bad, [...valid, bad]).efficiencyScore, 0);
  assert.equal(score(valid[0], [...valid, bad]).efficiencyScore, score(valid[0], valid).efficiencyScore);

  const partial = guild("Partial coverage", [bosses(1, 10, 1000)[0], ...invalid.slice(1)]);
  assert.ok(score(partial, [...valid, partial]).mythicEfficiencyScore <= 24);
});

test("raid 53 lairs cannot earn main-raid efficiency credit", () => {
  const main = { ...bosses(1, 1, 485.913)[0], bossId: 3470 };
  const lair = { ...bosses(1, 1, 1)[0], bossId: 3379 };
  const target = { ...guild("Main", [main]), raidId: 53 };
  const mixed = { ...target, mythicBosses: [main, lair] };
  const lairOnly = { ...target, mythicBosses: [lair] };
  assert.equal(score(mixed, [mixed]).mythicEfficiencyScore, score(target, [target]).mythicEfficiencyScore);
  assert.equal(score(lairOnly, [lairOnly]).mythicEfficiencyScore, 0);
});

test("materialized raid and overall lists use boss comparisons and respect exclusions", async () => {
  const inputs = [guild("Gifu", bosses(1, 1, 485.913)), guild("Clear A"), guild("Clear B"), guild("Clear C"), guild("Excluded"), guild("No fights")];
  const documents = inputs.map((input, index) => ({
    _id: new mongoose.Types.ObjectId(),
    name: input.guildName,
    realm: "Test realm",
    excludedRaidIds: index === 4 ? [46] : [],
    progress: ["heroic", "mythic"].map(difficulty => ({
      raidId: 46,
      raidName: "Test raid",
      difficulty,
      totalBosses: 8,
      bossesDefeated: difficulty === "heroic" ? input.heroicBossesDefeated : input.mythicBossesDefeated,
      bosses: difficulty === "heroic" ? input.heroicBosses : input.mythicBosses,
    })),
  }));
  const originals = { find: Guild.find, aggregate: Fight.aggregate, deleteMany: TierList.deleteMany, save: TierList.prototype.save };
  let saved: any;
  try {
    (Guild as any).find = () => ({ select: async () => documents });
    (Fight as any).aggregate = async () => documents.slice(0, 5).map(g => ({ _id: { guildId: g._id, zoneId: 46 } }));
    (TierList as any).deleteMany = async () => ({});
    (TierList.prototype as any).save = async function () { saved = this.toObject(); return this; };
    await tierListService.calculateTierLists();

    const raid = saved.raids.find((r: any) => r.raidId === 46);
    assert.equal(raid.guilds.length, 4);
    assert.equal(saved.overall.length, 4);
    for (const input of inputs.slice(0, 4)) {
      const expected = score(input, inputs.slice(0, 4));
      const entry = raid.guilds.find((g: any) => g.guildName === input.guildName);
      assert.equal(entry.efficiencyScore, expected.efficiencyScore);
      assert.equal(entry.speedScore, expected.speedScore);
      assert.equal(entry.overallScore, expected.overallScore);
      assert.equal(saved.overall.find((g: any) => g.guildName === input.guildName).efficiencyScore, entry.efficiencyScore);
    }
  } finally {
    Guild.find = originals.find;
    Fight.aggregate = originals.aggregate;
    TierList.deleteMany = originals.deleteMany;
    TierList.prototype.save = originals.save;
  }
});

test("Sporefall never contributes to guild tier scores, eligibility, or available raids", async () => {
  const mainProgress = {
    raidId: 46, raidName: "Main raid", difficulty: "mythic", totalBosses: 8,
    bossesDefeated: 8, bosses: bosses(8, 50, 10000),
  };
  const sporefallProgress = {
    raidId: 50, raidName: "Sporefall", difficulty: "heroic", totalBosses: 1,
    bossesDefeated: 1, bosses: bosses(1, 1, 100),
  };
  const documents = [
    { _id: new mongoose.Types.ObjectId(), name: "Both raids", realm: "Test", progress: [mainProgress, sporefallProgress] },
    { _id: new mongoose.Types.ObjectId(), name: "Sporefall only", realm: "Test", progress: [sporefallProgress] },
  ];
  const originals = { find: Guild.find, aggregate: Fight.aggregate, deleteMany: TierList.deleteMany, save: TierList.prototype.save, findOne: TierList.findOne };
  let saved: any;
  let fightQuery: any;
  try {
    (Guild as any).find = () => ({ select: async () => documents });
    (Fight as any).aggregate = async (pipeline: any) => {
      fightQuery = pipeline;
      return documents.flatMap(g => g.progress.map(p => ({ _id: { guildId: g._id, zoneId: p.raidId } })));
    };
    (TierList as any).deleteMany = async () => ({});
    (TierList.prototype as any).save = async function () { saved = this.toObject(); return this; };
    (TierList as any).findOne = () => ({ sort: () => ({ lean: async () => saved }) });

    await tierListService.calculateTierLists();

    assert.deepEqual(saved.raids.map((r: any) => r.raidId), [46]);
    assert.deepEqual(saved.overall.map((g: any) => g.guildName), ["Both raids"]);
    // One Mythic full clear with neutral comparison credit; Heroic has no eligible data.
    assert.equal(saved.overall[0].efficiencyScore, 500);
    assert.equal(saved.overall[0].speedScore, 200);
    assert.equal(saved.overall[0].overallScore, 350);
    assert.ok(fightQuery[0].$match.$or.every((entry: any) => entry.zoneId !== 50));
    assert.deepEqual(await tierListService.getAvailableRaids(), [{ raidId: 46, raidName: "Main raid" }]);
    assert.equal(await tierListService.getTierListForRaid(50), null);
    assert.deepEqual((await tierListService.getTierList()).raids.map((r: any) => r.raidId), [46]);
    assert.equal((await tierListService.getOverallTierList())?.guilds[0].overallScore, 350);
  } finally {
    Guild.find = originals.find;
    Fight.aggregate = originals.aggregate;
    TierList.deleteMany = originals.deleteMany;
    TierList.prototype.save = originals.save;
    TierList.findOne = originals.findOne;
  }
});
