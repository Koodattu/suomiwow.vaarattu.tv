import assert from "node:assert/strict";
import test from "node:test";
import Guild from "../src/models/Guild";
import Raid from "../src/models/Raid";
import service from "../src/services/compare.service";
import { RAID_ENCOUNTERS } from "../src/config/raid-encounters";

test("comparison includes lair metrics without changing main raid totals, and uses the guild's main-page rank", async t => {
  const mainIds = RAID_ENCOUNTERS[53].main;
  const metadata = [...mainIds, 3379, 3513].map(id => ({ id, name: String(id), iconUrl: `${id}.jpg` }));
  t.mock.method(Raid, "findOne", (() => ({ lean: async () => ({ id: 53, name: "Raid", bosses: metadata }) })) as any);
  t.mock.method(Guild, "aggregate", (async (pipeline: any[]) => {
    // Admission is tied to activity on the selected difficulty, never absence of Mythic.
    const match = pipeline[0].$match;
    assert.equal(match.excludedRaidIds.$ne, 53);
    for (const [i, field] of ["progress", "lairProgress"].entries()) {
      const selected = match.$or[i][field].$elemMatch;
      assert.equal(selected.difficulty, "heroic");
      assert.equal(selected.raidId, 53);
      assert.deepEqual(selected.$or, [{ bossesDefeated: { $gt: 0 } }, { "bosses.pullCount": { $gt: 0 } }]);
    }
    return [{ _id: "both", name: "Both difficulties", rankedProgress: { difficulty: "mythic", guildRank: 1 },
      selectedProgress: { raidId: 53, difficulty: "heroic", bossesDefeated: 8, totalBosses: 8, totalTimeSpent: 600, rioWorldRank: 25,
        bosses: mainIds.map(bossId => ({ bossId, pullCount: 2, kills: 1 })) },
      selectedLairs: [{ bosses: [{ bossId: 3379, pullCount: 3, kills: 1, timeSpent: 90 }] }, { bosses: [{ bossId: 3513, pullCount: 9, kills: 0, timeSpent: 180 }] }],
    }, { _id: "lair-only", name: "Lair only", selectedLairs: [{ bosses: [{ bossId: 3513, pullCount: 4, kills: 0 }] }] }];
  }) as any);
  const result = await service.getRaidCompare(53, "heroic");
  assert(result);
  assert.deepEqual(result.raid.bosses.map(b => b.id), [...mainIds, 3379, 3513]);
  const guild = result.guilds[0];
  assert.equal(guild.guildRank, 1);
  assert.equal(guild.worldRank, 25);
  assert.equal(guild.bossesDefeated, 8);
  assert.equal(guild.totalBosses, 8);
  assert.equal(guild.totalPulls, 16);
  assert.equal(guild.totalTimeSpent, 600);
  assert.equal(guild.bosses.find(b => b.bossId === 3379)?.pulls, 3);
  assert.equal(guild.bosses.find(b => b.bossId === 3513)?.pulls, 9);
  assert.equal(result.guilds[1].totalBosses, 8);
  assert.equal(result.guilds[1].totalPulls, 0);
  assert.equal(result.guilds[1].bosses.find(b => b.bossId === 3513)?.pulls, 4);
});

test("ordinary raids keep their encounter list and totals", async t => {
  t.mock.method(Raid, "findOne", (() => ({ lean: async () => ({ id: 10, name: "Older raid", bosses: [{ id: 1, name: "Boss" }] }) })) as any);
  t.mock.method(Guild, "aggregate", (async () => [{ _id: "guild", name: "Guild", rankedProgress: { guildRank: 2 }, selectedProgress: {
    raidId: 10, bossesDefeated: 1, totalBosses: 1, worldRank: 50, bosses: [{ bossId: 1, pullCount: 7, kills: 1 }],
  } }]) as any);
  const result = await service.getRaidCompare(10);
  assert.equal(result?.raid.bosses.length, 1);
  assert.equal(result?.guilds[0].totalPulls, 7);
  assert.equal(result?.guilds[0].worldRank, 50);
});
