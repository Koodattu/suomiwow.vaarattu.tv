import assert from "node:assert/strict";
import test from "node:test";

process.env.RAIDER_IO_API_KEY ||= "test";
process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";

async function dependencies() {
  const [guild, blizzard, Guild, Raid, Fight, Vod, achievements, wcl, backfill] = await Promise.all([
    import("../src/services/guild.service"), import("../src/services/blizzard.service"),
    import("../src/models/Guild"), import("../src/models/Raid"), import("../src/models/Fight"),
    import("../src/models/FightVodLink"), import("../src/models/Achievement"),
    import("../src/services/warcraftlogs.service"), import("../src/services/fight-vod.service"),
  ]);
  return { guild: guild.default as any, blizzard: blizzard.default as any, Guild: Guild.default as any,
    Raid: Raid.default as any, Fight: Fight.default as any, Vod: Vod.default as any, achievements,
    wcl: wcl.default as any, backfill: backfill.default as any };
}

test("guild detail includes main and lair kill/best-pull videos without changing progression", async t => {
  const { guild, Guild, Fight, Vod } = await dependencies();
  const boss = (id: number) => ({ bossId: id, kills: 1, firstKillReportCode: "report", firstKillFightId: id, pullHistory: [1] });
  const main = { raidId: 53, difficulty: "mythic", bossesDefeated: 8, totalBosses: 8, bosses: [boss(3492)] };
  const lairs = [
    { raidId: 53, difficulty: "mythic", lairEncounterId: 3379, bosses: [boss(3379)] },
    { raidId: 53, difficulty: "heroic", lairEncounterId: 3513, bosses: [{ bossId: 3513, kills: 0, bestPullReportCode: "report", bestPullFightId: 3513 }] },
  ];
  const query: any = { collation: () => query, select: () => query, lean: async () => ({ progress: [main], lairProgress: lairs }) };
  t.mock.method(Guild, "findOne", () => query);
  t.mock.method(guild, "getWorldRankHistory", async () => []);
  t.mock.method(Fight, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Vod, "find", (filter: any) => {
    assert.deepEqual(filter.$or.map((f: any) => f.fightId), [3492, 3379, 3513]);
    assert.equal(filter.status, "resolved");
    assert.deepEqual(filter.availabilityStatus, { $ne: "unavailable" });
    return { select: () => ({ sort: () => ({ lean: async () => [3492, 3379, 3513].map(id => ({ reportCode: "report", fightId: id, channelName: "streamer", vodUrl: `https://example.com/${id}` })) }) }) };
  });
  const result = await guild.getGuildBossProgressForRaidByRealmName("realm", "guild", 53);
  assert.equal(result.progress[0].bossesDefeated, 8);
  assert.equal(result.progress[0].totalBosses, 8);
  for (const progress of [...result.progress, ...result.lairProgress]) {
    assert.equal(progress.bosses[0].bestVodLinks.length, 1);
    assert.equal(progress.bosses[0].pullHistory, undefined);
  }
});

test("targeted backfill includes lairs and skips other encounters and raids", async t => {
  const { backfill } = await dependencies();
  const visited: number[] = [];
  t.mock.method(backfill, "getRecentBestPullFights", async (_id: unknown, _raid: unknown, boss: any) => {
    visited.push(boss.bossId); return [{}];
  });
  const guild = { progress: [{ raidId: 53, difficulty: "mythic", bosses: [{ bossId: 3492 }] }], lairProgress: [
    { raidId: 53, difficulty: "mythic", bosses: [{ bossId: 3379 }, { bossId: 3513 }] },
    { raidId: 99, difficulty: "mythic", bosses: [{ bossId: 3513 }] },
  ] };
  const candidates = await backfill.getBackfillCandidates(guild, new Date(), { raidId: 53, bossIds: [3379, 3513] });
  assert.deepEqual(visited, [3379, 3513]);
  assert.equal(candidates.length, 2);
});

for (const stale of [true, false]) test(`missing icons refresh achievements only when stale (${stale})`, async t => {
  const { blizzard, Raid, achievements } = await dependencies();
  let refreshed = false;
  const writes: any[] = [];
  const { default: cache } = await import("../src/services/cache.service");
  const invalidate = t.mock.method(cache, "invalidate", async () => {});
  t.mock.method(Raid, "find", async (filter: any) => {
    assert.deepEqual(filter, { id: { $in: [53] } });
    return [{ id: 53, name: "Raid", bosses: [{ id: 3513, name: "Kith'ix" }] }];
  });
  t.mock.method(achievements.AchievementUpdateLog, "findOne", async () => ({ lastFullUpdate: new Date(stale ? 0 : Date.now()) }) as any);
  t.mock.method(blizzard, "updateAchievements", async () => { refreshed = true; });
  t.mock.method(achievements.BossIcon, "deleteOne", async () => ({}) as any);
  t.mock.method(blizzard, "getBossIconUrl", async () => {
    assert.equal(refreshed, stale); return "8214194.jpg";
  });
  t.mock.method(Raid, "updateOne", async (...args: any[]) => { writes.push(args); });
  await blizzard.retryMissingBossIcons([53]);
  assert.equal(writes[0][1].$set["bosses.$.iconUrl"], "8214194.jpg");
  assert.deepEqual(invalidate.mock.calls.map(call => call.arguments[0]), [cache.getRaidBossesKey(53), `${cache.getRaidBossesKey(53)}:with-lairs`]);
});

test("refreshing raid encounters retries missing icons for newly added bosses", async t => {
  const { guild, blizzard, Raid, wcl } = await dependencies();
  t.mock.method(wcl, "getZone", async () => ({ worldData: { zone: { partitions: [{ id: 1, name: "Current" }], encounters: [{ id: 3379, name: "Nymrissa" }, { id: 3513, name: "Kith'ix" }] } } }));
  t.mock.method(Raid, "findOne", () => ({ lean: async () => ({ bosses: [{ id: 3379, name: "Nymrissa", iconUrl: "old.jpg" }] }) }));
  let updated = false;
  t.mock.method(Raid, "updateOne", async (_filter: any, update: any) => {
    assert.equal(update.$set.bosses[0].iconUrl, "old.jpg");
    assert.equal(update.$set.bosses[1].id, 3513);
    updated = true;
  });
  const retry = t.mock.method(blizzard, "retryMissingBossIcons", async (ids: number[]) => {
    assert.equal(updated, true); assert.deepEqual(ids, [53]);
  });
  const result = await guild.refreshRaidPartitions([53]);
  assert.deepEqual(result.failures, []);
  assert.equal(retry.mock.callCount(), 1);
});
