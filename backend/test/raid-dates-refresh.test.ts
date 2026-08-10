import assert from "node:assert/strict";
import test from "node:test";
import { CURRENT_RAID_IDS, RECENT_RAID_DATE_REFRESH_IDS, TRACKED_RAIDS } from "../src/config/guilds";

test("manual raid date refresh targets current raids and two newest non-current raids", () => {
  const expectedRecentRaidIds = TRACKED_RAIDS.filter((raidId) => !CURRENT_RAID_IDS.includes(raidId)).slice(0, 2);

  assert.deepEqual(RECENT_RAID_DATE_REFRESH_IDS, [...CURRENT_RAID_IDS, ...expectedRecentRaidIds]);
});

test("raid date refresh updates matched raids without clearing missing source dates", async () => {
  process.env.RAIDER_IO_API_KEY ||= "test";
  process.env.BLIZZARD_CLIENT_ID ||= "test";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test";

  const [{ default: guildService }, { default: raiderIOService }, { default: Raid }] = await Promise.all([
    import("../src/services/guild.service"),
    import("../src/services/raiderio.service"),
    import("../src/models/Raid"),
  ]);

  const raidModel = Raid as any;
  const rioService = raiderIOService as any;
  const originalFind = raidModel.find;
  const originalUpdateOne = raidModel.updateOne;
  const originalFetchAllRaidDates = rioService.fetchAllRaidDates;
  const originalFindRaidMatch = rioService.findRaidMatch;
  const updates: Array<{ filter: unknown; update: any }> = [];

  raidModel.find = () => ({
    select: async () => [
      { id: 46, name: "March on Quel'Danas", slug: "march-on-queldanas", rioSlug: "tier-mn-1" },
      { id: 50, name: "Sporefall", slug: "sporefall", rioSlug: "sporefall" },
    ],
  });
  raidModel.updateOne = async (filter: unknown, update: unknown) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  rioService.fetchAllRaidDates = async () =>
    new Map([
      [
        "tier-mn-1",
        {
          slug: "tier-mn-1",
          starts: { eu: "2026-03-18T04:00:00.000Z" },
          ends: { eu: "2026-12-17T04:00:00.000Z" },
        },
      ],
    ]);
  rioService.findRaidMatch = () => undefined;

  try {
    const result = await guildService.refreshRaidDates([46, 50, 46]);

    assert.deepEqual(result, {
      requested: 2,
      found: 2,
      matched: 1,
      updatedRaidIds: [46],
    });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].filter, { id: 46 });
    assert.deepEqual(updates[0].update.$set, {
      rioSlug: "tier-mn-1",
      "starts.eu": new Date("2026-03-18T04:00:00.000Z"),
      "ends.eu": new Date("2026-12-17T04:00:00.000Z"),
    });
  } finally {
    raidModel.find = originalFind;
    raidModel.updateOne = originalUpdateOne;
    rioService.fetchAllRaidDates = originalFetchAllRaidDates;
    rioService.findRaidMatch = originalFindRaidMatch;
  }
});
