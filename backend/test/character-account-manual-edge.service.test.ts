import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterAccountGroup from "../src/models/CharacterAccountGroup";
import CharacterAccountManualEdge from "../src/models/CharacterAccountManualEdge";
import CharacterAccountMatch from "../src/models/CharacterAccountMatch";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import characterAccountManualEdgeService from "../src/services/character-account-manual-edge.service";
import characterAchievementService from "../src/services/character-achievement.service";
import cacheService from "../src/services/cache.service";
import { createCharacterAccountPairKey } from "../src/utils/character-account-manual-edge";

test("creates the same account pair key regardless of character order", () => {
  const first = new mongoose.Types.ObjectId().toString();
  const second = new mongoose.Types.ObjectId().toString();
  assert.equal(createCharacterAccountPairKey(first, second), createCharacterAccountPairKey(second, first));
});

test("previews the complete transitive account-group merge", async () => {
  const characterModel = Character as any;
  const groupModel = CharacterAccountGroup as any;
  const edgeModel = CharacterAccountManualEdge as any;
  const originals = {
    characterFindById: characterModel.findById,
    characterFind: characterModel.find,
    groupFind: groupModel.find,
    edgeFindOne: edgeModel.findOne,
  };
  const targetId = new mongoose.Types.ObjectId();
  const existingAltId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();

  try {
    characterModel.findById = () => ({
      select() {
        return this;
      },
      lean: async () => ({ _id: targetId, name: "Main", realm: "kazzak", region: "eu", classID: 1 }),
    });
    characterModel.find = () => ({
      select() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [{ _id: otherId, name: "Other", realm: "stormreaver", region: "eu", classID: 5 }],
    });
    groupModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          characterIds: [targetId, existingAltId],
          members: [
            { characterId: targetId, name: "Main", realm: "kazzak", region: "eu", classID: 1 },
            { characterId: existingAltId, name: "Alt", realm: "draenor", region: "eu", classID: 3 },
          ],
        },
      ],
    });
    edgeModel.findOne = () => ({ lean: async () => null });

    const preview = await characterAccountManualEdgeService.preview(targetId.toString(), {
      name: "Other",
      realm: "stormreaver",
      region: "eu",
    });

    assert.equal(preview.eligible, true);
    assert.equal(preview.impact.alreadyGrouped, false);
    assert.equal(preview.impact.currentGroupCount, 2);
    assert.equal(preview.impact.mergedCharacterCount, 3);
    assert.deepEqual(
      new Set(preview.impact.members.map((member) => member.id)),
      new Set([targetId.toString(), existingAltId.toString(), otherId.toString()]),
    );
  } finally {
    characterModel.findById = originals.characterFindById;
    characterModel.find = originals.characterFind;
    groupModel.find = originals.groupFind;
    edgeModel.findOne = originals.edgeFindOne;
  }
});

test("includes manual edges when rebuilding account groups without achievement matches", async () => {
  const characterModel = Character as any;
  const groupModel = CharacterAccountGroup as any;
  const edgeModel = CharacterAccountManualEdge as any;
  const matchModel = CharacterAccountMatch as any;
  const participationModel = CharacterRaidParticipation as any;
  const cache = cacheService as any;
  const originals = {
    characterFind: characterModel.find,
    groupBulkWrite: groupModel.bulkWrite,
    groupDeleteMany: groupModel.deleteMany,
    edgeFind: edgeModel.find,
    matchFind: matchModel.find,
    participationAggregate: participationModel.aggregate,
    invalidatePattern: cache.invalidatePattern,
  };
  const firstId = new mongoose.Types.ObjectId();
  const secondId = new mongoose.Types.ObjectId();
  let groupOperations: any[] = [];

  try {
    matchModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [],
    });
    edgeModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [{ characterAId: firstId, characterBId: secondId }],
    });
    characterModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [
        { _id: firstId, name: "First", realm: "kazzak", region: "eu", classID: 1, lastMythicSeenAt: new Date("2026-01-01") },
        { _id: secondId, name: "Second", realm: "stormreaver", region: "eu", classID: 5, lastMythicSeenAt: new Date("2026-02-01") },
      ],
    });
    participationModel.aggregate = async () => [];
    groupModel.bulkWrite = async (operations: any[]) => {
      groupOperations = operations;
    };
    groupModel.deleteMany = async () => ({ deletedCount: 0 });
    cache.invalidatePattern = async () => undefined;

    const result = await characterAchievementService.rebuildAccountGroups();

    assert.equal(result.groups, 1);
    assert.equal(result.matchedCharacters, 2);
    assert.equal(result.highConfidenceEdges, 0);
    assert.equal(result.manualEdges, 1);
    assert.equal(groupOperations.length, 1);
    assert.equal(groupOperations[0].updateOne.update.$set.edgeCount, 1);
    assert.equal(groupOperations[0].updateOne.update.$set.characterIds.length, 2);
  } finally {
    characterModel.find = originals.characterFind;
    groupModel.bulkWrite = originals.groupBulkWrite;
    groupModel.deleteMany = originals.groupDeleteMany;
    edgeModel.find = originals.edgeFind;
    matchModel.find = originals.matchFind;
    participationModel.aggregate = originals.participationAggregate;
    cache.invalidatePattern = originals.invalidatePattern;
  }
});
