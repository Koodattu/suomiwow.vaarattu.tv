import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterContinuityLink from "../src/models/CharacterContinuityLink";
import CharacterLeaderboard from "../src/models/CharacterLeaderboard";
import CharacterMechanicsLeaderboard from "../src/models/CharacterMechanicsLeaderboard";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import Ranking from "../src/models/Ranking";
import characterService from "../src/services/character.service";
import characterContinuityService from "../src/services/character-continuity.service";
import { buildCharacterContinuityGraph } from "../src/utils/character-continuity";

test("resolves chained continuity links to one root and complete member set", () => {
  const historicalId = new mongoose.Types.ObjectId();
  const intermediateId = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const graph = buildCharacterContinuityGraph([
    { sourceCharacterId: historicalId, targetCharacterId: intermediateId },
    { sourceCharacterId: intermediateId, targetCharacterId: currentId },
  ]);

  assert.equal(graph.resolveRoot(historicalId), currentId.toString());
  assert.equal(graph.resolveRoot(intermediateId), currentId.toString());
  assert.deepEqual(new Set(graph.getMemberIds(currentId)), new Set([historicalId.toString(), intermediateId.toString(), currentId.toString()]));
});

test("rejects cyclic continuity data", () => {
  const firstId = new mongoose.Types.ObjectId();
  const secondId = new mongoose.Types.ObjectId();
  assert.throws(
    () =>
      buildCharacterContinuityGraph([
        { sourceCharacterId: firstId, targetCharacterId: secondId },
        { sourceCharacterId: secondId, targetCharacterId: firstId },
      ]),
    /cycle/,
  );
});

test("resolves a historical route to the current primary while retaining both canonical IDs", async () => {
  const characterModel = Character as any;
  const continuityModel = CharacterContinuityLink as any;
  const originals = {
    characterFind: characterModel.find,
    continuityFind: continuityModel.find,
  };
  const historicalId = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const historical = {
    _id: historicalId,
    name: "Boxxeri",
    realm: "frostwhisper",
    region: "eu",
    classID: 4,
    wclCanonicalCharacterId: 32627510,
    blizzardIdentityOverride: null,
  };
  const current = {
    _id: currentId,
    name: "Tinderboxx",
    realm: "stormreaver",
    region: "eu",
    classID: 4,
    wclCanonicalCharacterId: 76275581,
    blizzardIdentityOverride: null,
  };

  try {
    characterModel.find = (query: Record<string, unknown>) => ({
      select() {
        return this;
      },
      lean: async () => ("wclCanonicalCharacterId" in query ? [current, historical] : [historical, current]),
    });
    continuityModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [{ sourceCharacterId: historicalId, targetCharacterId: currentId }],
    });

    const context = await (characterService as any).resolveContinuityContext([76275581, 32627510], 4, {
      name: "Boxxeri",
      realm: "Frostwhisper",
    });

    assert.equal(context.isCombined, true);
    assert.equal(context.requestedCharacterId, historicalId.toString());
    assert.equal(context.rootCharacter._id.toString(), currentId.toString());
    assert.deepEqual(context.canonicalIds, [76275581, 32627510]);
  } finally {
    characterModel.find = originals.characterFind;
    continuityModel.find = originals.continuityFind;
  }
});

test("previews two WCL canonical identities without rewriting either identity", async () => {
  const characterModel = Character as any;
  const continuityModel = CharacterContinuityLink as any;
  const appearanceModel = CharacterReportAppearance as any;
  const rankingModel = Ranking as any;
  const leaderboardModel = CharacterLeaderboard as any;
  const mechanicsModel = CharacterMechanicsLeaderboard as any;
  const originals = {
    characterFindById: characterModel.findById,
    characterFind: characterModel.find,
    continuityFind: continuityModel.find,
    appearanceAggregate: appearanceModel.aggregate,
    appearanceDistinct: appearanceModel.distinct,
    rankingCountDocuments: rankingModel.countDocuments,
    leaderboardCountDocuments: leaderboardModel.countDocuments,
    mechanicsCountDocuments: mechanicsModel.countDocuments,
  };
  const historicalId = new mongoose.Types.ObjectId();
  const currentId = new mongoose.Types.ObjectId();
  const historical = {
    _id: historicalId,
    name: "Boxxeri",
    realm: "frostwhisper",
    region: "eu",
    classID: 4,
    wclCanonicalCharacterId: 32627510,
  };
  const current = {
    _id: currentId,
    name: "Tinderboxx",
    realm: "stormreaver",
    region: "eu",
    classID: 4,
    wclCanonicalCharacterId: 76275581,
  };

  try {
    characterModel.findById = () => ({
      select() {
        return this;
      },
      lean: async () => current,
    });
    characterModel.find = (query: Record<string, unknown>) => {
      const rows = "name" in query ? [historical] : [historical, current];
      return {
        collation() {
          return this;
        },
        select() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => rows,
      };
    };
    continuityModel.find = () => ({ lean: async () => [] });
    appearanceModel.aggregate = async () => [
      {
        _id: null,
        appearanceCount: 81,
        raids: [29, 31, 33, 35, 37, 39],
        guilds: ["Guild|Realm"],
        firstSeenAt: new Date("2018-03-26T00:00:00.000Z"),
        lastSeenAt: new Date("2025-09-01T00:00:00.000Z"),
      },
    ];
    appearanceModel.distinct = async (_field: string, query: { wclCanonicalCharacterId: { $in: number[] } }) =>
      query.wclCanonicalCharacterId.$in.includes(historical.wclCanonicalCharacterId) ? ["historical-report"] : ["current-report"];
    rankingModel.countDocuments = async () => 11;
    leaderboardModel.countDocuments = async () => 22;
    mechanicsModel.countDocuments = async () => 11;

    const preview = await characterContinuityService.preview(currentId.toString(), {
      name: "Boxxeri",
      realm: "Frostwhisper",
      region: "EU",
    });

    assert.equal(preview.eligible, true);
    assert.equal(preview.source.wclCanonicalCharacterId, 32627510);
    assert.equal(preview.target.wclCanonicalCharacterId, 76275581);
    assert.equal(preview.impact.wclIdentityCount, 2);
    assert.equal(preview.impact.appearanceCount, 81);
    assert.equal(preview.impact.raidCount, 6);
    assert.equal(preview.impact.sharedReportCount, 0);
    assert.equal(preview.impact.rankingCount, 11);
    assert.equal(preview.impact.leaderboardCount, 22);
    assert.equal(preview.impact.mechanicsCount, 11);
  } finally {
    characterModel.findById = originals.characterFindById;
    characterModel.find = originals.characterFind;
    continuityModel.find = originals.continuityFind;
    appearanceModel.aggregate = originals.appearanceAggregate;
    appearanceModel.distinct = originals.appearanceDistinct;
    rankingModel.countDocuments = originals.rankingCountDocuments;
    leaderboardModel.countDocuments = originals.leaderboardCountDocuments;
    mechanicsModel.countDocuments = originals.mechanicsCountDocuments;
  }
});
