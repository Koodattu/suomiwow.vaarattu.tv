import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import {
  CharacterRaidGuildParticipation,
  selectPrimaryCharacterRaidGuilds,
  summarizeCharacterRaidParticipation,
} from "../src/services/character-raid-guild.service";

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
    affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
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
    affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
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
    affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
  },
];

test("unqualified guests have no raid guild, including one visit to each of two guilds", () => {
  const guests = rows.map((row) => ({ ...row, reportCount: 1, mythicReportCount: 1, affiliationQualifiedAt: null }));
  assert.equal(selectPrimaryCharacterRaidGuilds(guests, 46).size, 0);
});

test("sustained Heroic attendance wins over a shorter Mythic affiliation", () => {
  const eligible = rows.filter((row) => row.zoneId === 46).map((row, index) => ({
    ...row, raidNightCount: index === 0 ? 20 : 3, mythicNightCount: index === 0 ? 0 : 3,
  }));
  assert.equal(selectPrimaryCharacterRaidGuilds(eligible, 46).get(CHARACTER_ID)?.name, "Old Guild");
});

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
      affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
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
      affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
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
      affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
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
      affiliationQualifiedAt: new Date("2026-01-01T00:00:00Z"),
      lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(tiedRows, 46).get(CHARACTER_ID), {
    id: OLD_GUILD_ID,
    name: "More Reports",
    realm: "Realm A",
  });
});

test("sums raid report eligibility across guilds while preserving the primary guild", () => {
  const summary = summarizeCharacterRaidParticipation(rows, 46).get(CHARACTER_ID);

  assert.deepEqual(summary, {
    guild: {
      id: LATEST_GUILD_ID,
      name: "Latest Guild",
      realm: "Realm B",
    },
    reportCount: 7,
    mythicReportCount: 3,
  });
});
