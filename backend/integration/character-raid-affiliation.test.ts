import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import CharacterLeaderboard from "../src/models/CharacterLeaderboard";
import Ranking from "../src/models/Ranking";
import Report from "../src/models/Report";
import service from "../src/services/character.service";
import backfill from "../src/services/character-ranking-backfill.service";
import cache from "../src/services/cache.service";
import Character from "../src/models/Character";
import SeasonScore from "../src/models/CharacterMythicPlusSeasonScore";
import DungeonRun from "../src/models/CharacterMythicPlusDungeonRun";
import mythicPlus from "../src/services/mythic-plus.service";

// Deliberately isolated from deployment credentials and all application databases.
const database = `raid_affiliation_test_${process.pid}`;
const guild = new mongoose.Types.ObjectId();
const guest = new mongoose.Types.ObjectId();
const member = new mongoose.Types.ObjectId();
const normal = new mongoose.Types.ObjectId();
const heroic = new mongoose.Types.ObjectId();
const zoneId = 53;
const encounterId = 3379;

before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27138/${database}?directConnection=true`, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000,
  });
  for (const model of [CharacterRaidParticipation, CharacterReportAppearance, CharacterLeaderboard, Ranking, Report]) {
    await model.createCollection();
  }
});

test("two same-night uploads cannot publish stored Mythic+ scores or expose a guest profile", async () => {
  const season = "season-mn-2";
  const guestId = new mongoose.Types.ObjectId();
  const qualifiedId = new mongoose.Types.ObjectId();
  const realm = "tarren-mill";
  const now = new Date();
  for (const [index, characterId] of [guestId, qualifiedId].entries()) {
    const name = index === 0 ? "Yootoo" : "Yootooregular";
    const identity = { wclCanonicalCharacterId: 101 + index, classID: 3, name, realm, region: "EU" };
    await Character.collection.insertOne({ ...identity, _id: characterId, lastReportSeenAt: now });
    await CharacterRaidParticipation.collection.insertOne({
      characterId, wclCanonicalCharacterId: identity.wclCanonicalCharacterId, classID: 3,
      characterName: name, characterRealm: realm, characterRegion: "EU", zoneId,
      reportGuildId: guild, reportGuildName: "Tracked guild", reportGuildRealm: realm,
      reportCount: 2, mythicReportCount: 2, raidNightCount: index + 1,
      affiliationQualifiedAt: index === 0 ? null : now, firstSeenAt: now, lastSeenAt: now,
    });
    await SeasonScore.collection.insertOne({
      ...identity, characterId, season, scores: { all: 4151 - index }, identityStatus: "current",
    });
    await DungeonRun.collection.insertOne({
      ...identity, characterId, season, raiderIoDungeonId: 123, bucket: "all", mythicLevel: 20 - index,
      score: 500 - index, identityStatus: "current",
    });
  }
  for (const options of [{}, { dungeonId: 123 }, { search: "Yootoo" }]) {
    const result = await mythicPlus.getLeaderboard({ season, ...options });
    assert.equal(result.pagination.totalRankedItems, 1, JSON.stringify(options));
    assert.deepEqual(result.data.map(row => row.character.id), [String(qualifiedId)]);
  }
  assert.deepEqual(await mythicPlus.getCharacterProfileMythicPlus(guestId), { seasons: [] });
  const jobs = await mythicPlus.enqueueProfileJobs({ characterIds: [String(guestId), String(qualifiedId)] });
  assert.equal(jobs.candidates, 1);
  for (const results of [
    await service.searchCharacters("Yootoo"), await service.searchCurrentCharacters("Yootoo", 1),
  ]) assert.deepEqual(results.map(row => row.name), ["Yootooregular"]);
  assert.deepEqual(await service.searchExactHistoricalCharacters("Yootoo"), []);
  assert.equal(await service.getCharacterProfileByRealmName(realm, "Yootoo", 3), null);
  assert.equal(await service.getCharacterRaidReportsByRealmName(realm, "Yootoo", zoneId, String(guild), 3), null);
});
after(async () => {
  if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("real rebuild deduplicates nights, excludes Normal-only actors, and gates every ranking path", async (t) => {
  t.mock.method(cache, "invalidatePattern", async () => 0);
  t.mock.method(cache, "invalidate", async () => undefined);
  const reports = [
    { code: "ONE", startTime: Date.parse("2026-09-01T18:00:00Z") },
    { code: "SPLIT", startTime: Date.parse("2026-09-02T00:00:00Z") },
    { code: "TWO", startTime: Date.parse("2026-09-03T18:00:00Z") },
  ];
  await Report.collection.insertMany(reports.map((report) => ({
    ...report, guildId: guild, zoneId, fightSequence: [
      { fightId: 1, encounterID: encounterId, difficulty: 5 },
      { fightId: 2, encounterID: encounterId, difficulty: 3 },
      { fightId: 3, encounterID: encounterId, difficulty: 4 },
    ],
  })));
  for (const report of reports) {
    for (const characterId of [member, guest, normal, heroic]) {
      if (characterId.equals(guest) && report.code === "TWO") continue;
      await CharacterReportAppearance.collection.insertOne({
        characterId, wclCanonicalCharacterId: characterId.equals(member) ? 1 : characterId.equals(guest) ? 2 : characterId.equals(normal) ? 3 : 4,
        reportCode: report.code, reportStartTime: new Date(report.startTime), reportZoneId: zoneId,
        reportGuildId: guild, reportGuildName: "Tuju", reportGuildRealm: "Kazzak",
        characterName: characterId.equals(member) ? "Member" : "Guest", characterRealm: "eversong", characterRegion: "EU", classID: 4,
        rankingFightIds: characterId.equals(normal) ? [2] : characterId.equals(heroic) ? [3] : [1],
        wclGuilds: [{ name: characterId.equals(member) || characterId.equals(heroic) ? "Tuju" : "Other", realm: "kazzak" }],
      });
    }
  }
  await service.rebuildCharacterRaidParticipations({ reconcileIdentities: false });
  const memberEvidence = await CharacterRaidParticipation.findOne({ characterId: member }).lean();
  const guestEvidence = await CharacterRaidParticipation.findOne({ characterId: guest }).lean();
  assert.equal(memberEvidence?.raidNightCount, 2);
  assert.equal(memberEvidence?.reportCount, 3);
  assert.ok(memberEvidence?.affiliationQualifiedAt);
  assert.equal(guestEvidence?.raidNightCount, 1);
  assert.equal(guestEvidence?.affiliationQualifiedAt, null);
  assert.equal(await CharacterRaidParticipation.countDocuments({ characterId: normal }), 0);
  const heroicEvidence = await CharacterRaidParticipation.findOne({ characterId: heroic }).lean();
  assert.ok(heroicEvidence?.affiliationQualifiedAt);
  assert.equal(heroicEvidence?.mythicReportCount, 0, "Heroic actors in mixed reports are not Mythic participants");
  assert.equal(heroicEvidence?.mythicNightCount, 0);
  assert.equal(await CharacterRaidParticipation.collection.countDocuments({ attendanceEvidence: { $exists: true } }), 0);

  await Ranking.collection.insertMany([member, guest].map((characterId, index) => ({
    characterId, wclCanonicalCharacterId: index + 1, name: index === 0 ? "Member" : "Guest",
    realm: "eversong", region: "EU", classID: 4, zoneId, difficulty: 5, partition: 1, metric: "dps",
    encounter: { id: encounterId, name: "Nymrissa" }, role: "dps", specName: "assassination",
    bestAmount: 100 + index * 100, rankPercent: 90, totalKills: 1, allStars: { points: 100 + index * 100, possiblePoints: 120 },
  })));
  await service.buildCharacterLeaderboards();
  assert.ok(await CharacterLeaderboard.countDocuments({ characterId: member }));
  assert.equal(await CharacterLeaderboard.countDocuments({ characterId: guest }), 0);

  // Simulate a pre-fix materialized row with a higher score than the member.
  const memberRows = await CharacterLeaderboard.find({ characterId: member }).lean();
  await CharacterLeaderboard.collection.insertMany(memberRows.map(({ _id, ...entry }) => ({
    ...entry, characterId: guest, name: "Guest", score: 1000,
  })));
  for (const options of [
    {}, { encounterId }, { specName: "assassination" }, { guildName: "Tuju" }, { characterName: "Member" },
  ]) {
    const response = await service.getCharacterRankings({ zoneId, limit: 1, ...options });
    assert.equal(response.pagination.totalRankedItems, 1);
    assert.equal(response.pagination.totalItems, 1);
    assert.equal(response.data[0]?.character.name, "Member");
    assert.equal(response.data[0]?.rank, 1);
  }
  const guestSearch = await service.getCharacterRankings({ zoneId, characterName: "Guest" });
  assert.equal(guestSearch.pagination.totalItems, 0);

  assert.equal(await (backfill as any).rebuildLeaderboardForCharacterZone(guest, zoneId), 0);
  assert.equal(await CharacterLeaderboard.countDocuments({ characterId: guest }), 0);
  assert.ok(await (backfill as any).rebuildLeaderboardForCharacterZone(member, zoneId));
});
