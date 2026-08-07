import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import CcgCard from "../src/models/CcgCard";
import CcgSet from "../src/models/CcgSet";
import ccgPublisherService from "../src/services/ccg-publisher.service";

function queryResult<T>(value: T) {
  return {
    sort() { return this; },
    select() { return this; },
    lean: async () => value,
  };
}

test("snapshot preview exposes live guilds, profile identity, and conditional availability candidates", async () => {
  const setId = new mongoose.Types.ObjectId();
  const characterId = new mongoose.Types.ObjectId();
  const archivedCharacterId = new mongoose.Types.ObjectId();
  const guildId = new mongoose.Types.ObjectId();
  const setModel = CcgSet as any;
  const cardModel = CcgCard as any;
  const publisher = ccgPublisherService as any;
  const originals = {
    setFind: setModel.find,
    cardFind: cardModel.find,
    cardAggregate: cardModel.aggregate,
    loadSnapshotPopulation: publisher.loadSnapshotPopulation,
    loadContinuityMedia: publisher.loadContinuityMedia,
    loadMythicPlusScoresByCharacter: publisher.loadMythicPlusScoresByCharacter,
  };

  try {
    const enabledSet = {
      _id: setId,
      zoneId: 24,
      slug: "nyalotha",
      raidName: "Ny'alotha",
      state: "legacy",
    };
    setModel.find = () => ({ sort: async () => [enabledSet] });
    cardModel.find = () => queryResult([]);
    cardModel.aggregate = async () => [
      {
        setId,
        characterId,
        name: "Shenzinile",
        realm: "tarren-mill",
        region: "EU",
        classID: 2,
        guildName: "Taikaolennot",
        guildRealm: "Outland",
        availabilityStatus: "verification_pending",
        availabilityFirstNotFoundAt: new Date("2026-08-01T10:00:00.000Z"),
        availabilityLastNotFoundAt: new Date("2026-08-01T10:00:00.000Z"),
        availabilityChangedAt: new Date("2026-08-01T10:00:00.000Z"),
        publishedAt: new Date("2026-07-01T10:00:00.000Z"),
      },
      {
        setId,
        characterId: archivedCharacterId,
        name: "Archived",
        realm: "draenor",
        region: "EU",
        classID: 8,
        guildName: null,
        guildRealm: null,
        availabilityStatus: "archived",
        availabilityFirstNotFoundAt: new Date("2026-07-01T10:00:00.000Z"),
        availabilityLastNotFoundAt: new Date("2026-07-02T10:00:00.000Z"),
        availabilityChangedAt: new Date("2026-07-02T10:00:00.000Z"),
        publishedAt: new Date("2026-07-02T10:00:00.000Z"),
      },
    ];
    publisher.loadSnapshotPopulation = async () => ({
      configured: { mythicPlusSeason: "season-1" },
      set: enabledSet,
      entries: [{
        entry: {
          characterId,
          name: "Shenzinile",
          realm: "tarren-mill",
          region: "EU",
          classID: 2,
          specName: "Retribution",
          bestSpecName: "Retribution",
          role: "dps",
          metric: "dps",
        },
        tierGrade: "S",
      }],
      participationByCharacter: new Map([[String(characterId), {
        guild: { id: guildId, name: "Current Guild", realm: "Tarren Mill" },
        reportCount: 10,
        mythicReportCount: 10,
      }]]),
      continuity: {
        memberIdsByRootId: new Map([[String(characterId), [characterId]]]),
        rootIdByMemberId: new Map([[String(characterId), String(characterId)]]),
        allMemberIds: [characterId],
      },
    });
    publisher.loadContinuityMedia = async () => new Map([[String(characterId), {
      characterId,
      status: "available",
      renderAssetId: new mongoose.Types.ObjectId(),
      attemptCount: 0,
    }]]);
    publisher.loadMythicPlusScoresByCharacter = async () => new Map();

    const preview = await publisher.previewNextSnapshots();
    assert.deepEqual(preview.sets[0].characters[0], {
      characterId: String(characterId),
      name: "Shenzinile",
      realm: "tarren-mill",
      region: "EU",
      classID: 2,
      guildName: "Current Guild",
      guildRealm: "Tarren Mill",
      disposition: "new_character",
      previousTierGrade: null,
      nextTierGrade: "S",
      mediaStatus: "available",
      attemptCount: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastError: null,
    });
    assert.equal(preview.availability.archiveCandidates, 1);
    assert.equal(preview.availability.returnCandidates, 1);
    assert.deepEqual(
      preview.availability.characters.map((character: any) => [character.name, character.disposition]),
      [["Shenzinile", "archive_if_not_found"], ["Archived", "return_if_available"]],
    );
  } finally {
    setModel.find = originals.setFind;
    cardModel.find = originals.cardFind;
    cardModel.aggregate = originals.cardAggregate;
    publisher.loadSnapshotPopulation = originals.loadSnapshotPopulation;
    publisher.loadContinuityMedia = originals.loadContinuityMedia;
    publisher.loadMythicPlusScoresByCharacter = originals.loadMythicPlusScoresByCharacter;
  }
});
