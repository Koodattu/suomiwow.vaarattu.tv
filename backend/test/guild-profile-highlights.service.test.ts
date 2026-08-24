import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import guildProfileHighlightsService from "../src/services/guild-profile-highlights.service";

const participation = (name: string, firstSeenAt: string, raidCount: number) => ({
  identityKey: `fallback:eu:outland:${name.toLowerCase()}:1`,
  characterId: null,
  name,
  realm: "outland",
  region: "eu",
  classID: 1,
  reportCount: raidCount,
  raidIds: new Set(Array.from({ length: raidCount }, (_, index) => index + 1)),
  firstSeenAt: new Date(firstSeenAt),
  lastSeenAt: new Date(firstSeenAt),
});

test("mainstays prioritize raid tenure over an earlier one-tier appearance", () => {
  const candidates = new Map([
    ["old-one-off", participation("OldOneOff", "2016-10-19T19:41:15.340Z", 1)],
    ["longest-tenure", participation("LongestTenure", "2016-12-07T20:23:51.168Z", 18)],
    ["thirteen-tiers", participation("ThirteenTiers", "2020-01-01T00:00:00.000Z", 13)],
    ["twelve-tiers", participation("TwelveTiers", "2020-01-01T00:00:00.000Z", 12)],
    ["eleven-tiers", participation("ElevenTiers", "2020-01-01T00:00:00.000Z", 11)],
    ["ten-tiers", participation("TenTiers", "2020-01-01T00:00:00.000Z", 10)],
    ["nine-tiers", participation("NineTiers", "2020-01-01T00:00:00.000Z", 9)],
  ]);

  const mainstays = (guildProfileHighlightsService as any).buildMainstaysForGuild(candidates, new Map());

  assert.equal(mainstays.length, 6);
  assert.equal(mainstays[0].name, "LongestTenure");
  assert.equal(mainstays.some((member: { name: string }) => member.name === "OldOneOff"), false);
});

test("top performers pair their score with the best performance tier", () => {
  const characterId = new mongoose.Types.ObjectId();
  const lowerTierRow = {
    characterId,
    wclCanonicalCharacterId: 1,
    zoneId: 42,
    name: "Performer",
    realm: "outland",
    region: "eu",
    classID: 1,
    role: "dps",
    metric: "dps",
    score: 82,
    parseScore: 84,
    survivalScore: 80,
    pulls: 60,
    deaths: 3,
    earlyDeaths: 1,
  };
  const bestTierRow = {
    ...lowerTierRow,
    zoneId: 44,
    score: 96,
    parseScore: 98,
    survivalScore: 94,
    pulls: 70,
  };
  const member = {
    identityKey: `character:${characterId}`,
    characterIds: new Set([characterId.toString()]),
    raidIds: new Set([42, 44]),
    reportCount: 12,
    firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2025-06-01T00:00:00.000Z"),
    primary: {
      characterId,
      name: "Performer",
      realm: "outland",
      region: "eu",
      classID: 1,
      reportCount: 12,
    },
    performanceByRaid: new Map([
      [42, lowerTierRow],
      [44, bestTierRow],
    ]),
    participationKeys: new Set(),
    bestRow: bestTierRow,
  };

  const performer = (guildProfileHighlightsService as any).toTopPerformer(
    member,
    new Map([
      [42, "Liberation of Undermine"],
      [44, "Manaforge Omega"],
    ]),
  );

  assert.equal(performer.score, 96);
  assert.equal(performer.parseScore, 98);
  assert.equal(performer.survivalScore, 94);
  assert.equal(performer.zoneId, 44);
  assert.equal(performer.raidName, "Manaforge Omega");
});
