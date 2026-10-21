import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Guild from "../src/models/Guild";
import Fight from "../src/models/Fight";

process.env.RAIDER_IO_API_KEY ||= "local-test";
process.env.BLIZZARD_CLIENT_ID ||= "local-test";
process.env.BLIZZARD_CLIENT_SECRET ||= "local-test";

test("adding a Kith'ix kill to the production clone changes only lair progress", async () => {
  const uri = process.env.RAID_SCOPE_TEST_URI;
  assert(uri?.startsWith("mongodb://127.0.0.1:27028/"), "Use only the disposable local raid-scope database on port 27028");
  await mongoose.connect(uri, { autoIndex: false, maxPoolSize: 2 });
  const reportCode = "RAIDSCOPELOCAL01";
  try {
    assert.equal(await Fight.countDocuments({ reportCode }), 0, "Do not overwrite a pre-existing fixture");
    const guild = await Guild.findOne({ "progress": { $elemMatch: { raidId: 53, difficulty: "mythic", bossesDefeated: { $gte: 3 } } } });
    assert(guild, "Production clone must include a progressed guild");
    const { default: service } = await import("../src/services/guild.service");
    const options = { createEvents: false, recalculateSchedule: false, queueVodLinks: false };
    await service.calculateGuildStatistics(guild, 53, options);
    const main = () => guild.progress.filter(p => p.raidId === 53).map(p => ({
      difficulty: p.difficulty, killed: p.bossesDefeated, total: p.totalBosses,
      time: p.totalTimeSpent, combat: p.totalCombatTimeSpent, progression: p.progressRaidTimeSpent,
      raidTime: p.totalRaidTimeSpent, worldRank: p.worldRank,
      bosses: p.bosses.map(b => ({ id: b.bossId, kills: b.kills, pulls: b.pullCount, percent: b.bestPercent, firstKill: b.firstKillTime })),
    }));
    const before = main();
    await Fight.create({ reportCode, fightId: 1, guildId: guild._id, zoneId: 53, encounterID: 3513, encounterName: "Kith'ix",
      difficulty: 5, isKill: true, bossPercentage: 0, fightPercentage: 0, reportStartTime: Date.parse("2026-10-20T20:00:00Z"),
      reportEndTime: Date.parse("2026-10-20T20:01:00Z"), fightStartTime: 0, fightEndTime: 60_000, duration: 60_000,
      timestamp: new Date("2026-10-20T20:00:00Z") });
    await service.calculateGuildStatistics(guild, 53, options);
    assert.deepEqual(main(), before);
    assert(main().every(p => p.total === 8 && p.bosses.every(b => b.id !== 3379 && b.id !== 3513)));
    assert.equal(guild.lairProgress.find(p => p.lairEncounterId === 3513 && p.difficulty === "mythic")?.bossesDefeated, 1);
  } finally {
    await Fight.deleteMany({ reportCode });
    await mongoose.disconnect();
  }
});
