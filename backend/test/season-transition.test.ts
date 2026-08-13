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

test("Season 2 raid support is staged without changing current raid defaults", () => {
  assert.equal(TRACKED_RAIDS[0], 53);
  assert.equal(PRIMARY_RAID_ID, 46);
  assert.deepEqual(CURRENT_RAID_IDS, [46, 50]);
  assert.equal(RAID_RIO_SLUG_OVERRIDES[53], "the-venomous-abyss");
  assert.deepEqual(RAID_RIO_PROGRESS_SLUG_OVERRIDES[53], ["the-tidebound-grotto", "the-venomous-abyss"]);
  assert.equal(RAID_RIO_RANKING_DISABLED_IDS.has(53), true);
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

test("Raider.IO split raid progress is aggregated into one nine-boss WCL tier", async () => {
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

  assert.equal(result.length, 1);
  assert.deepEqual(
    {
      raidTierSlug: result[0].raidTierSlug,
      summary: result[0].summary,
      totalBosses: result[0].totalBosses,
      normalBossesKilled: result[0].normalBossesKilled,
      heroicBossesKilled: result[0].heroicBossesKilled,
      mythicBossesKilled: result[0].mythicBossesKilled,
    },
    {
      raidTierSlug: "the-venomous-abyss",
      summary: "2/9 M",
      totalBosses: 9,
      normalBossesKilled: 6,
      heroicBossesKilled: 4,
      mythicBossesKilled: 2,
    },
  );
});

test("a temporarily missing Raider.IO split keeps the combined nine-boss denominator", async () => {
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

  assert.equal(result.raidTierSlug, "the-venomous-abyss");
  assert.equal(result.summary, "1/9 H");
  assert.equal(result.totalBosses, 9);
  assert.equal(result.heroicBossesKilled, 1);
});
