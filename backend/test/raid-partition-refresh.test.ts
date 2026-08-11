import assert from "node:assert/strict";
import test from "node:test";

test("raid partition refresh reports updated and failed raids", async () => {
  process.env.RAIDER_IO_API_KEY ||= "test";
  process.env.BLIZZARD_CLIENT_ID ||= "test";
  process.env.BLIZZARD_CLIENT_SECRET ||= "test";

  const [{ default: guildService }, { default: wclService }, { default: Raid }] = await Promise.all([
    import("../src/services/guild.service"),
    import("../src/services/warcraftlogs.service"),
    import("../src/models/Raid"),
  ]);

  const wcl = wclService as any;
  const raidModel = Raid as any;
  const originalGetZone = wcl.getZone;
  const originalUpdateOne = raidModel.updateOne;
  const requestedRaidIds: number[] = [];
  const updates: Array<{ filter: unknown; update: unknown }> = [];

  wcl.getZone = async (raidId: number) => {
    requestedRaidIds.push(raidId);
    return raidId === 10
      ? {
          worldData: {
            zone: {
              partitions: [
                { id: 1, name: "7.0-7.1" },
                { id: 2, name: "7.1.5+" },
              ],
            },
          },
        }
      : { worldData: { zone: { partitions: [] } } };
  };
  raidModel.updateOne = async (filter: unknown, update: unknown) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  };

  try {
    const result = await guildService.refreshRaidPartitions([10, 11, 10]);

    assert.deepEqual(requestedRaidIds, [10, 11]);
    assert.deepEqual(updates, [
      {
        filter: { id: 10 },
        update: {
          $set: {
            partitions: [
              { id: 1, name: "7.0-7.1" },
              { id: 2, name: "7.1.5+" },
            ],
          },
        },
      },
    ]);
    assert.deepEqual(result, {
      requestedRaidIds: [10, 11],
      updatedRaidIds: [10],
      failures: [{ raidId: 11, reason: "Warcraft Logs returned no partitions" }],
    });
  } finally {
    wcl.getZone = originalGetZone;
    raidModel.updateOne = originalUpdateOne;
  }
});
