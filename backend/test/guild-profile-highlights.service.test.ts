import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import Fight from "../src/models/Fight";
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
    new Map([
      [`${guildId}:${druidId}:44`, 40],
      [`${guildId}:${demonHunterId}:44`, 40],
    ]),
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

test("top performers require 40 pulls with the specific guild and raid before selecting their best score", () => {
  const characterId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId().toString();
  const otherGuildId = new mongoose.Types.ObjectId().toString();
  const row = {
    characterId,
    wclCanonicalCharacterId: 1,
    zoneId: 42,
    name: "Raider",
    realm: "kazzak",
    region: "eu",
    classID: 1,
    role: "dps",
    metric: "dps",
    score: 80,
    parseScore: 80,
    survivalScore: 80,
    pulls: 40,
    deaths: 2,
    earlyDeaths: 1,
  };
  const targets = new Map([
    [`${characterId}:42`, [{ guildId }, { guildId: otherGuildId }]],
    [`${characterId}:44`, [{ guildId }, { guildId: otherGuildId }]],
  ]);
  const raidNames = new Map([[42, "Liberation of Undermine"], [44, "Manaforge Omega"]]);
  const rows = [row, { ...row, zoneId: 44, score: 99, pulls: 200 }];
  const counts = new Map([
    [`${guildId}:${characterId}:42`, 40],
    [`${guildId}:${characterId}:44`, 39],
    [`${otherGuildId}:${characterId}:44`, 161],
  ]);

  const result = (guildProfileHighlightsService as any).buildTopPerformersByGuild(rows, targets, raidNames, counts);
  const performer = result.get(guildId)[0];
  assert.equal(performer.score, 80);
  assert.equal(performer.zoneId, 42);
  assert.equal(performer.performanceRaidCount, 1);
  assert.equal(performer.pulls, 40);
  assert.equal(result.get(otherGuildId)[0].zoneId, 44);

  counts.set(`${guildId}:${characterId}:42`, 39);
  const belowThreshold = (guildProfileHighlightsService as any).buildTopPerformersByGuild(rows, targets, raidNames, counts);
  assert.equal(belowThreshold.has(guildId), false);

  const missingCounts = (guildProfileHighlightsService as any).buildTopPerformersByGuild(rows, targets, raidNames, new Map());
  assert.equal(missingCounts.size, 0);
});

test("guild raid pulls count roster participants once per fight and keep guilds and raids separate", () => {
  const characterId = new mongoose.Types.ObjectId();
  const benchedId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId();
  const otherGuildId = new mongoose.Types.ObjectId();
  const appearance = {
    characterId,
    reportCode: "report",
    reportGuildId: guildId,
    characterName: "Raider",
    characterRealm: "twisting-nether",
  };
  const appearances = [appearance, { ...appearance }, { ...appearance, characterId: benchedId, characterName: "Benched" }];
  const fight = {
    reportCode: "report",
    guildId,
    zoneId: 42,
    combatants: [{ name: "RAIDER", server: "Twisting Nether" }, { name: "Raider", server: "twisting-nether" }],
  };
  const counts = new Map<string, number>();
  const addPull = (value: typeof fight, roster = appearances) => (guildProfileHighlightsService as any).addGuildRaidPulls(value, roster, counts);

  addPull(fight);
  addPull(fight);
  addPull({ ...fight, zoneId: 44 });
  addPull({ ...fight, guildId: otherGuildId }, [{ ...appearance, reportGuildId: otherGuildId }]);
  addPull({ ...fight, guildId: otherGuildId });
  addPull({ ...fight, reportCode: "different-report" });
  addPull({ ...fight, combatants: [{ name: "Raider", server: "kazzak" }] });
  addPull({ ...fight, combatants: [] });

  assert.deepEqual(Array.from(counts), [
    [`${guildId}:${characterId}:42`, 2],
    [`${guildId}:${characterId}:44`, 1],
    [`${otherGuildId}:${characterId}:42`, 1],
  ]);

  addPull({ ...fight, combatants: [{ name: "Raider", server: "" }] }, [
    appearance,
    { ...appearance, characterId: benchedId, characterRealm: "kazzak" },
  ]);
  assert.equal(counts.get(`${guildId}:${characterId}:42`), 2);
});

test("guild raid pull lookup keeps overlapping reports together without losing participants", async (t) => {
  const characterId = new mongoose.Types.ObjectId();
  const secondCharacterId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId();
  const reports = Array.from({ length: 101 }, (_, index) => `report-${String(index).padStart(3, "0")}`);
  const appearanceRows = reports.flatMap((reportCode) => [
    { reportCode, reportGuildId: guildId, characterId, characterName: "First", characterRealm: "kazzak" },
    { reportCode, reportGuildId: guildId, characterId: secondCharacterId, characterName: "Second", characterRealm: "kazzak" },
  ]);
  const cursorQuery = (rows: unknown[]) => ({
    select() { return this; },
    sort() { return this; },
    lean() { return this; },
    async *cursor() { yield* rows; },
  });
  t.mock.method(CharacterReportAppearance, "distinct", async () => [guildId]);
  t.mock.method(CharacterReportAppearance, "find", (query: any) => {
    assert.equal(query.hidden, false);
    assert.deepEqual(query.characterId.$in, [characterId, secondCharacterId]);
    return { select() { return this; }, lean: async () => appearanceRows };
  });
  const batches: string[][] = [];
  t.mock.method(Fight, "find", (query: any) => {
    assert.equal(query.difficulty, 5);
    assert.deepEqual(query.encounterID, { $gt: 0 });
    assert.deepEqual(query.duration, { $gt: 0 });
    assert.equal(query.zoneId.$in.includes(44), true);
    batches.push(query.reportCode.$in);
    return cursorQuery(query.reportCode.$in.map((reportCode: string, index: number) => ({
      reportCode, fightId: 1, encounterID: 1, difficulty: 5, isKill: false,
      timestamp: new Date(1_000_000 + index * 300_000), duration: 120_000,
      guildId,
      zoneId: 44,
      combatants: [{ name: "First", server: "kazzak" }, { name: "Second", server: "kazzak" }],
    })));
  });

  const counts = await (guildProfileHighlightsService as any).loadGuildRaidPulls([characterId, secondCharacterId]);
  assert.deepEqual(batches.map((batch) => batch.length), [101]);
  assert.deepEqual(batches.flat(), reports);
  assert.equal(counts.get(`${guildId}:${characterId}:44`), 101);
  assert.equal(counts.get(`${guildId}:${secondCharacterId}:44`), 101);
});

test("guild eligibility counts one physical pull while retaining both reports' participant evidence", async t => {
  const characterId = new mongoose.Types.ObjectId(), guildId = new mongoose.Types.ObjectId();
  const base = { reportCode: "A", fightId: 1, guildId, zoneId: 44, encounterID: 1, difficulty: 5, isKill: false,
    timestamp: new Date(1_000_000), duration: 120_000, bossPercentage: 50, combatantInfoRosterComplete: true,
    combatants: Array.from({ length: 20 }, (_, i) => ({ name: i ? `P${i}` : "First", server: "kazzak" })) };
  const appearances = ["A", "B"].map(reportCode => ({ reportCode, reportGuildId: guildId, characterId,
    characterName: "First", characterRealm: "kazzak" }));
  t.mock.method(CharacterReportAppearance, "distinct", async () => [guildId]);
  t.mock.method(CharacterReportAppearance, "find", () => ({ select() { return this; }, lean: async () => appearances }) as any);
  t.mock.method(Fight, "find", () => ({ select() { return this; }, sort() { return this; }, lean() { return this; },
    async *cursor() { yield base; yield { ...base, reportCode: "B", timestamp: new Date(1_002_500), duration: 120_125 }; } }) as any);
  const counts = await (guildProfileHighlightsService as any).loadGuildRaidPulls([characterId]);
  assert.equal(counts.get(`${guildId}:${characterId}:44`), 1);
});
