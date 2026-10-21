import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_RAID_IDS,
  PRIMARY_RAID_ID,
  RAID_RIO_PROGRESS_SLUG_OVERRIDES,
  RAID_RIO_RANKING_DISABLED_IDS,
  RAID_RIO_SLUG_OVERRIDES,
  TRACKED_RAIDS,
} from "../src/config/guilds";

process.env.RAIDER_IO_API_KEY ||= "test";
process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";

test("Season 2 raid support uses the new raid as the current default", () => {
  assert.equal(TRACKED_RAIDS[0], 53);
  assert.equal(PRIMARY_RAID_ID, 53);
  assert.deepEqual(CURRENT_RAID_IDS, [53]);
  assert.equal(RAID_RIO_SLUG_OVERRIDES[53], "the-venomous-abyss");
  assert.equal(RAID_RIO_PROGRESS_SLUG_OVERRIDES[53], undefined);
  assert.equal(RAID_RIO_RANKING_DISABLED_IDS.has(53), false);
});

test("Raider.IO world ranks stay tied to their raid difficulty", async () => {
  const { default: guildService } = await import("../src/services/guild.service");
  const rankings = {
    heroic: { world: 395, region: 177, realm: 22 },
    mythic: { world: 81, region: 42, realm: 7 },
  };

  assert.equal((guildService as any).getRaiderIOWorldRankForDifficulty(rankings, "heroic"), 395);
  assert.equal((guildService as any).getRaiderIOWorldRankForDifficulty(rankings, "mythic"), 81);
  assert.equal((guildService as any).getRaiderIOWorldRankForDifficulty({ heroic: { world: 0 } }, "heroic"), undefined);
});

test("configured WCL raid IDs missing from worldData.zones are queried directly", async () => {
  const { getWclZoneSyncTargets } = await import("../src/services/guild.service");
  const listedZones = [{ id: 46, name: "VS / DR / MQD" }, { id: 50, name: "Sporefall" }];

  assert.deepEqual(getWclZoneSyncTargets(listedZones, [53, 50, 46]), [
    ...listedZones,
    { id: 53, name: "tracked raid 53" },
  ]);
  assert.deepEqual(getWclZoneSyncTargets([...listedZones, { id: 53, name: "The Venomous Abyss" }], [53]), [
    ...listedZones,
    { id: 53, name: "The Venomous Abyss" },
  ]);
});

test("Raider.IO lair progress stays separate from the eight-boss main raid", async () => {
  const { default: guildService } = await import("../src/services/guild.service");
  const raid = {
    id: 53,
    name: "The Venomous Abyss",
    slug: "the-venomous-abyss",
    rioSlug: "the-venomous-abyss",
    bosses: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, name: `Boss ${index + 1}`, slug: `boss-${index + 1}` })),
  };
  const progression = {
    "the-tidebound-grotto": {
      summary: "0/1 M",
      total_bosses: 1,
      normal_bosses_killed: 1,
      heroic_bosses_killed: 1,
      mythic_bosses_killed: 0,
    },
    "the-venomous-abyss": {
      summary: "2/8 M",
      total_bosses: 8,
      normal_bosses_killed: 5,
      heroic_bosses_killed: 3,
      mythic_bosses_killed: 2,
    },
  };

  const result = (guildService as any).normalizeRaiderIOOfficialProgress(progression, [raid]);

  assert.equal(result.length, 2);
  const main = result.find((entry: any) => entry.raidTierSlug === "the-venomous-abyss");
  assert.deepEqual(
    {
      raidTierSlug: main.raidTierSlug,
      summary: main.summary,
      totalBosses: main.totalBosses,
      normalBossesKilled: main.normalBossesKilled,
      heroicBossesKilled: main.heroicBossesKilled,
      mythicBossesKilled: main.mythicBossesKilled,
    },
    {
      raidTierSlug: "the-venomous-abyss",
      summary: "2/8 M",
      totalBosses: 8,
      normalBossesKilled: 5,
      heroicBossesKilled: 3,
      mythicBossesKilled: 2,
    },
  );
});

test("lair-only Raider.IO data does not create main-raid progress", async () => {
  const { default: guildService } = await import("../src/services/guild.service");
  const raid = {
    id: 53,
    name: "The Venomous Abyss",
    slug: "the-venomous-abyss",
    rioSlug: "the-venomous-abyss",
    bosses: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, name: `Boss ${index + 1}`, slug: `boss-${index + 1}` })),
  };

  const [result] = (guildService as any).normalizeRaiderIOOfficialProgress(
    {
      "the-tidebound-grotto": {
        summary: "1/1 H",
        total_bosses: 1,
        normal_bosses_killed: 1,
        heroic_bosses_killed: 1,
        mythic_bosses_killed: 0,
      },
    },
    [raid],
  );

  assert.equal(result.raidTierSlug, "the-tidebound-grotto");
  assert.equal(result.summary, "1/1 H");
  assert.equal(result.totalBosses, 1);
  assert.equal(result.heroicBossesKilled, 1);
});
