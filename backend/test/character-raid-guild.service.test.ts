import assert from "node:assert/strict";
import test from "node:test";
import { CharacterRaidGuildParticipation, selectPrimaryCharacterRaidGuilds } from "../src/services/character-raid-guild.service";

const CHARACTER_ID = "507f1f77bcf86cd799439011";

const rows: CharacterRaidGuildParticipation[] = [
  {
    characterId: CHARACTER_ID,
    zoneId: 46,
    reportGuildName: "Old Guild",
    reportGuildRealm: "Realm A",
    reportCount: 5,
    lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
  },
  {
    characterId: CHARACTER_ID,
    zoneId: 46,
    reportGuildName: "Latest Guild",
    reportGuildRealm: "Realm B",
    reportCount: 2,
    lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  {
    characterId: CHARACTER_ID,
    zoneId: 50,
    reportGuildName: "Latest Guild",
    reportGuildRealm: "Realm B",
    reportCount: 9,
    lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
  },
];

test("selects the guild with the most reports in the selected raid", () => {
  assert.deepEqual(selectPrimaryCharacterRaidGuilds(rows, 46).get(CHARACTER_ID), {
    name: "Old Guild",
    realm: "Realm A",
  });

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(rows, 50).get(CHARACTER_ID), {
    name: "Latest Guild",
    realm: "Realm B",
  });
});

test("uses the most recently seen guild to break equal report-count ties", () => {
  const tiedRows: CharacterRaidGuildParticipation[] = [
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildName: "Earlier Guild",
      reportGuildRealm: "Realm A",
      reportCount: 3,
      lastSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    {
      characterId: CHARACTER_ID,
      zoneId: 46,
      reportGuildName: "Later Guild",
      reportGuildRealm: "Realm B",
      reportCount: 3,
      lastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  assert.deepEqual(selectPrimaryCharacterRaidGuilds(tiedRows, 46).get(CHARACTER_ID), {
    name: "Later Guild",
    realm: "Realm B",
  });
});
