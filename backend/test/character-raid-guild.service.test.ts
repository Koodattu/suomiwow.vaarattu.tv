import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { CharacterRaidGuildParticipation, selectPrimaryCharacterRaidGuilds } from "../src/services/character-raid-guild.service";

const CHARACTER_ID = "507f1f77bcf86cd799439011";
const OLD_GUILD_ID = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
const LATEST_GUILD_ID = new mongoose.Types.ObjectId("507f1f77bcf86cd799439013");

const rows: CharacterRaidGuildParticipation[] = [
  {
    characterId: CHARACTER_ID,
    zoneId: 46,
    reportGuildId: OLD_GUILD_ID,
    reportGuildName: "Old Guild",
    reportGuildRealm: "Realm A",
    reportCount: 5,
    mythicReportCount: 1,
    lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    characterId: CHARACTER_ID,
    zoneId: 46,
    reportGuildId: LATEST_GUILD_ID,
    reportGuildName: "Latest Guild",
    reportGuildRealm: "Realm B",
    reportCount: 2,
    mythicReportCount: 2,
    lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  {
    characterId: CHARACTER_ID,
    zoneId: 50,
    reportGuildId: LATEST_GUILD_ID,
    reportGuildName: "Latest Guild",
    reportGuildRealm: "Realm B",
    reportCount: 9,
    mythicReportCount: 4,
    lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
  },
];

test("selects the guild with the most Mythic reports in the selected raid", () => {
  assert.deepEqual(selectPrimaryCharacterRaidGuilds(rows, 46).get(CHARACTER_ID), {
    id: LATEST_GUILD_ID,
    name: "Latest Guild",
    realm: "Realm B",
  });

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(rows, 50).get(CHARACTER_ID), {
    id: LATEST_GUILD_ID,
    name: "Latest Guild",
    realm: "Realm B",
  });
});

test("uses the most recently seen guild to break equal report-count ties", () => {
  const tiedRows: CharacterRaidGuildParticipation[] = [
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildId: OLD_GUILD_ID,
      reportGuildName: "Earlier Guild",
      reportGuildRealm: "Realm A",
      reportCount: 3,
      mythicReportCount: 3,
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildId: LATEST_GUILD_ID,
      reportGuildName: "Later Guild",
      reportGuildRealm: "Realm B",
      reportCount: 3,
      mythicReportCount: 3,
      lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(tiedRows, 46).get(CHARACTER_ID), {
    id: LATEST_GUILD_ID,
    name: "Later Guild",
    realm: "Realm B",
  });
});

test("uses total qualifying reports before recency when Mythic counts tie", () => {
  const tiedRows: CharacterRaidGuildParticipation[] = [
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildId: OLD_GUILD_ID,
      reportGuildName: "More Reports",
      reportGuildRealm: "Realm A",
      reportCount: 6,
      mythicReportCount: 2,
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildId: LATEST_GUILD_ID,
      reportGuildName: "More Recent",
      reportGuildRealm: "Realm B",
      reportCount: 4,
      mythicReportCount: 2,
      lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(tiedRows, 46).get(CHARACTER_ID), {
    id: OLD_GUILD_ID,
    name: "More Reports",
    realm: "Realm A",
  });
});
