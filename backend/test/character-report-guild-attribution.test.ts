import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import characterService from "../src/services/character.service";
import { planCharacterGuildAttributionRepair } from "../src/services/character-guild-attribution-repair.service";

test("ranking reads replace stale current-guild fields with the dominant raid guild", async (t) => {
  const originalParticipationFind = CharacterRaidParticipation.find;
  t.after(() => {
    (CharacterRaidParticipation as any).find = originalParticipationFind;
  });

  const characterId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  const historicalGuildId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
  (CharacterRaidParticipation as any).find = () => ({
    select: () => ({
      lean: async () => [
        {
          characterId,
          zoneId: 26,
          reportGuildId: historicalGuildId,
          reportGuildName: "Synergia",
          reportGuildRealm: "Outland",
          reportCount: 68,
          mythicReportCount: 43,
          lastSeenAt: new Date("2021-05-23T13:51:01.701Z"),
        },
      ],
    }),
  });

  const [entry] = await (characterService as any).applyRaidGuildsToCharacterRankingEntries(26, [
    {
      characterId,
      name: "Stygia",
      realm: "outland",
      guildName: "CE-Tiimi",
      guildRealm: "Stormreaver",
    },
  ]);

  assert.equal(entry.guildName, "Synergia");
  assert.equal(entry.guildRealm, "Outland");
});

test("report imports update current guild from the character snapshot, not the report owner", async (t) => {
  const originalCharacterFindOneAndUpdate = Character.findOneAndUpdate;
  const originalCharacterFindById = Character.findById;
  const originalCharacterUpdateOne = Character.updateOne;
  const originalAppearanceFindOneAndUpdate = CharacterReportAppearance.findOneAndUpdate;
  const originalIndexesSynced = (characterService as any).characterIdentityIndexesSynced;

  t.after(() => {
    (Character as any).findOneAndUpdate = originalCharacterFindOneAndUpdate;
    (Character as any).findById = originalCharacterFindById;
    (Character as any).updateOne = originalCharacterUpdateOne;
    (CharacterReportAppearance as any).findOneAndUpdate = originalAppearanceFindOneAndUpdate;
    (characterService as any).characterIdentityIndexesSynced = originalIndexesSynced;
  });

  const characterId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  const reportGuildId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
  const characterUpdates: Array<Record<string, any>> = [];
  let appearanceUpdate: Record<string, any> | null = null;

  (characterService as any).characterIdentityIndexesSynced = true;
  (Character as any).findOneAndUpdate = async () => ({
    _id: characterId,
    guildName: null,
    guildRealm: null,
  });
  (Character as any).findById = () => ({
    select: () => ({
      lean: async () => ({
        guildName: null,
        guildRealm: null,
        guildUpdatedAt: null,
        guildHistory: [],
      }),
    }),
  });
  (Character as any).updateOne = async (_filter: Record<string, unknown>, update: Record<string, any>) => {
    characterUpdates.push(update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  (CharacterReportAppearance as any).findOneAndUpdate = async (_filter: Record<string, unknown>, update: Record<string, any>) => {
    appearanceUpdate = update;
    return {};
  };

  await characterService.upsertCharactersFromReportAppearances({
    reportCode: "example-report",
    reportStartTime: new Date("2025-09-02T09:20:02.081Z"),
    reportZoneId: 45,
    reportGuildId,
    reportGuildName: "CE-Tiimi",
    reportGuildRealm: "Stormreaver",
    rankedCharacters: [
      {
        canonicalID: 47_525_254,
        name: "Stygia",
        classID: 7,
        hidden: false,
        server: {
          slug: "outland",
          region: { slug: "EU" },
        },
        guilds: [
          {
            name: "Muisted",
            server: {
              slug: "stormreaver",
              region: { slug: "EU" },
            },
          },
        ],
      },
    ],
  });

  assert.equal((appearanceUpdate as any)?.$set.reportGuildName, "CE-Tiimi");
  assert.deepEqual((appearanceUpdate as any)?.$set.wclGuilds, [
    {
      name: "Muisted",
      realm: "stormreaver",
      region: "EU",
    },
  ]);

  const guildUpdate = characterUpdates.find((update) => Array.isArray(update.$set?.guildHistory));
  assert.ok(guildUpdate);
  assert.equal(guildUpdate.$set.guildName, "Muisted");
  assert.equal(guildUpdate.$set.guildRealm, "stormreaver");
  assert.equal(JSON.stringify(characterUpdates).includes("CE-Tiimi"), false);
});

test("guild attribution repair removes report-owner pollution and restores the latest WCL guild", () => {
  const plan = planCharacterGuildAttributionRepair(
    {
      guildName: "CE-Tiimi",
      guildRealm: "Stormreaver",
      guildUpdatedAt: new Date("2025-09-02T09:20:02.081Z"),
      guildHistory: [
        {
          guildName: "Synergia",
          guildRealm: "Outland",
          firstSeenAt: new Date("2020-05-30T13:56:55.433Z"),
          lastSeenAt: new Date("2024-09-28T15:53:00.705Z"),
        },
        {
          guildName: "CE-Tiimi",
          guildRealm: "Stormreaver",
          firstSeenAt: new Date("2025-09-02T09:20:02.081Z"),
          lastSeenAt: new Date("2025-09-02T09:20:02.081Z"),
        },
        {
          guildName: "Muisted",
          guildRealm: "Stormreaver",
          firstSeenAt: new Date("2025-08-16T07:43:36.968Z"),
          lastSeenAt: new Date("2026-06-09T17:06:09.678Z"),
        },
      ],
    },
    [
      {
        guildName: "Synergia",
        guildRealm: "Outland",
        firstSeenAt: new Date("2020-05-30T13:56:55.433Z"),
        lastSeenAt: new Date("2024-09-28T15:53:00.705Z"),
      },
      {
        guildName: "CE-Tiimi",
        guildRealm: "Stormreaver",
        firstSeenAt: new Date("2025-09-02T09:20:02.081Z"),
        lastSeenAt: new Date("2025-09-02T09:20:02.081Z"),
      },
      {
        guildName: "Muisted",
        guildRealm: "Stormreaver",
        firstSeenAt: new Date("2025-08-16T07:43:36.968Z"),
        lastSeenAt: new Date("2025-08-16T07:53:45.798Z"),
      },
    ],
    [
      {
        guildName: "Muisted",
        guildRealm: "stormreaver",
        firstSeenAt: new Date("2026-06-09T17:06:04.714Z"),
        lastSeenAt: new Date("2026-06-09T17:06:09.678Z"),
      },
    ],
    {
      observedAt: new Date("2026-06-09T17:06:09.678Z"),
      guild: { name: "Muisted", realm: "stormreaver" },
    },
  );

  assert.ok(plan);
  assert.equal(plan.guildName, "Muisted");
  assert.equal(plan.guildRealm, "stormreaver");
  assert.equal(plan.currentGuildChanged, true);
  assert.equal(plan.historyEntriesRemoved, 2);
  assert.deepEqual(
    plan.guildHistory.map((entry) => ({
      guild: `${entry.guildName}-${entry.guildRealm}`,
      firstSeenAt: entry.firstSeenAt.toISOString(),
      lastSeenAt: entry.lastSeenAt.toISOString(),
    })),
    [
      {
        guild: "Muisted-stormreaver",
        firstSeenAt: "2026-06-09T17:06:04.714Z",
        lastSeenAt: "2026-06-09T17:06:09.678Z",
      },
    ],
  );
});

test("guild attribution repair preserves a newer independent current-guild observation", () => {
  const currentObservedAt = new Date("2026-07-20T12:00:00.000Z");
  const plan = planCharacterGuildAttributionRepair(
    {
      guildName: "Current Guild",
      guildRealm: "Kazzak",
      guildUpdatedAt: currentObservedAt,
      guildHistory: [
        {
          guildName: "Current Guild",
          guildRealm: "Kazzak",
          firstSeenAt: currentObservedAt,
          lastSeenAt: currentObservedAt,
        },
      ],
    },
    [],
    [],
    {
      observedAt: new Date("2026-06-01T12:00:00.000Z"),
      guild: null,
    },
  );

  assert.equal(plan, null);
});

test("guild attribution repair does not guess a replacement without a WCL snapshot", () => {
  const reportSeenAt = new Date("2025-09-02T09:20:02.081Z");
  const plan = planCharacterGuildAttributionRepair(
    {
      guildName: "Report Owner",
      guildRealm: "Kazzak",
      guildUpdatedAt: reportSeenAt,
      guildHistory: [
        {
          guildName: "Report Owner",
          guildRealm: "Kazzak",
          firstSeenAt: reportSeenAt,
          lastSeenAt: reportSeenAt,
        },
      ],
    },
    [
      {
        guildName: "Report Owner",
        guildRealm: "Kazzak",
        firstSeenAt: reportSeenAt,
        lastSeenAt: reportSeenAt,
      },
    ],
    [],
    null,
  );

  assert.ok(plan);
  assert.equal(plan.currentGuildChanged, false);
  assert.equal(plan.guildName, "Report Owner");
  assert.deepEqual(plan.guildHistory, []);
});
