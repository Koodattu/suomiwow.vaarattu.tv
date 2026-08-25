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

test("account mainstays display the most-seen guild character identity", () => {
  const accountId = new mongoose.Types.ObjectId();
  const evokerId = new mongoose.Types.ObjectId();
  const shamanId = new mongoose.Types.ObjectId();
  const evoker = {
    ...participation("Alexstrussy", "2024-04-24T00:00:00.000Z", 2),
    identityKey: `character:${evokerId}`,
    characterId: evokerId,
    realm: "kazzak",
    classID: 13,
    reportCount: 40,
  };
  const shaman = {
    ...participation("Totemrini", "2024-04-24T00:00:00.000Z", 2),
    identityKey: `character:${shamanId}`,
    characterId: shamanId,
    realm: "kazzak",
    classID: 9,
    reportCount: 60,
  };
  const account = {
    id: accountId,
    idString: accountId.toString(),
    slug: "alexstrussy-account",
    displayName: "Alexstrussy",
  };

  const mainstays = (guildProfileHighlightsService as any).buildMainstaysForGuild(
    new Map([
      [evoker.identityKey, evoker],
      [shaman.identityKey, shaman],
    ]),
    new Map([
      [evokerId.toString(), account],
      [shamanId.toString(), account],
    ]),
  );

  assert.equal(mainstays.length, 1);
  assert.equal(mainstays[0].kind, "account");
  assert.equal(mainstays[0].accountDisplayName, "Alexstrussy");
  assert.equal(mainstays[0].characterId.toString(), shamanId.toString());
  assert.equal(mainstays[0].name, "Totemrini");
  assert.equal(mainstays[0].classID, 9);
});

test("top performers pair their score with the best performance tier", () => {
  const characterId = new mongoose.Types.ObjectId();
  const lowerTierRow = {
    characterId,
    wclCanonicalCharacterId: 1,
    zoneId: 42,
    name: "Platudr",
    realm: "stormreaver",
    region: "eu",
    classID: 2,
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
      name: "Platud",
      realm: "kazzak",
      region: "eu",
      classID: 12,
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
  assert.equal(performer.kind, "character");
  assert.equal(performer.characterId.toString(), characterId.toString());
  assert.equal(performer.name, "Platudr");
  assert.equal(performer.realm, "stormreaver");
  assert.equal(performer.classID, 2);
  assert.equal(performer.accountGroupId, null);
});

test("top performers keep qualifying characters separate", () => {
  const druidId = new mongoose.Types.ObjectId();
  const demonHunterId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId().toString();
  const createRow = (characterId: mongoose.Types.ObjectId, name: string, classID: number, score: number) => ({
    characterId,
    wclCanonicalCharacterId: classID,
    zoneId: 44,
    name,
    realm: "kazzak",
    region: "eu",
    classID,
    role: "dps",
    metric: "dps",
    score,
    parseScore: score,
    survivalScore: score,
    pulls: 120,
    deaths: 3,
    earlyDeaths: 1,
  });

  const performersByGuild = (guildProfileHighlightsService as any).buildTopPerformersByGuild(
    [createRow(druidId, "Platudr", 2, 91), createRow(demonHunterId, "Platud", 12, 85)],
    new Map([
      [`${druidId}:44`, [{ guildId }]],
      [`${demonHunterId}:44`, [{ guildId }]],
    ]),
    new Map([[44, "Manaforge Omega"]]),
  );
  const performers = performersByGuild.get(guildId);

  assert.equal(performers.length, 2);
  assert.deepEqual(
    performers.map((performer: { name: string; classID: number; kind: string }) => ({
      name: performer.name,
      classID: performer.classID,
      kind: performer.kind,
    })),
    [
      { name: "Platudr", classID: 2, kind: "character" },
      { name: "Platud", classID: 12, kind: "character" },
    ],
  );
});
