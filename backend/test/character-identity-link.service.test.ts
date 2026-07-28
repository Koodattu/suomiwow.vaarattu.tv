import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterIdentityLink from "../src/models/CharacterIdentityLink";
import CharacterReportAppearance from "../src/models/CharacterReportAppearance";
import characterIdentityLinkService from "../src/services/character-identity-link.service";
import characterService from "../src/services/character.service";
import { createCharacterIdentityAliasKey, createReportRankingSourceIdentityKey } from "../src/utils/character-identity-link";

test("normalizes equivalent character identity aliases into one key", () => {
  assert.equal(
    createCharacterIdentityAliasKey({ name: " Fluidyy ", realm: "Storm-Reaver", region: "EU", classID: 4 }),
    createCharacterIdentityAliasKey({ name: "fluidyy", realm: "storm reaver", region: "eu", classID: 4 }),
  );
});

test("recreates the report-ranking fallback key used after an alias is removed", () => {
  assert.equal(
    createReportRankingSourceIdentityKey({ name: "Fluidyy", realm: "Storm Reaver", region: "EU", classID: 4 }),
    "reportRankings:eu:stormreaver:fluidyy:4",
  );
});

test("uses one identity key for realm display names and authoritative slugs", () => {
  assert.equal(
    createCharacterIdentityAliasKey({ name: "Raíjin", realm: "Blade's Edge", region: "EU", classID: 7 }),
    createCharacterIdentityAliasKey({ name: "Raíjin", realm: "blades-edge", region: "eu", classID: 7 }),
  );
});

test("matches report ranking display realms to ranked character slugs", () => {
  const getMatchKey = (characterService as any).getReportRankingMatchKey.bind(characterService);

  assert.equal(
    getMatchKey({ name: "Raíjin", realm: "Blade's Edge", region: "EU" }),
    getMatchKey({ name: "Raíjin", realm: "blades-edge", region: "eu" }),
  );
  assert.equal(
    getMatchKey({ name: "Example", realm: "Azjol-Nerub", region: "EU" }),
    getMatchKey({ name: "Example", realm: "azjolnerub", region: "eu" }),
  );
});

test("previews an unresolved historical identity without mutating report data", async () => {
  const characterModel = Character as any;
  const appearanceModel = CharacterReportAppearance as any;
  const linkModel = CharacterIdentityLink as any;
  const originals = {
    characterFindById: characterModel.findById,
    appearanceAggregate: appearanceModel.aggregate,
    appearanceDistinct: appearanceModel.distinct,
    appearanceCountDocuments: appearanceModel.countDocuments,
    linkFindOne: linkModel.findOne,
  };
  const targetId = new mongoose.Types.ObjectId();

  try {
    characterModel.findById = () => ({
      select() {
        return this;
      },
      lean: async () => ({
        _id: targetId,
        name: "Fluidy",
        realm: "kazzak",
        region: "eu",
        classID: 4,
        wclCanonicalCharacterId: 272115,
      }),
    });
    appearanceModel.aggregate = () => ({
      collation: async () => [
        {
          _id: null,
          appearanceCount: 33,
          unresolvedAppearanceCount: 33,
          conflictingAppearanceCount: 0,
          raids: [10, 11, 12],
          guilds: ["Exploding Labrats|stormreaver"],
          firstSeenAt: new Date("2016-12-14T15:58:27.427Z"),
          lastSeenAt: new Date("2017-03-20T16:25:08.531Z"),
        },
      ],
    });
    appearanceModel.distinct = () => ({ collation: async () => ["report-a", "report-b"] });
    appearanceModel.countDocuments = async () => 0;
    linkModel.findOne = () => ({ lean: async () => null });

    const preview = await characterIdentityLinkService.preview(targetId.toString(), {
      name: "Fluidyy",
      realm: "stormreaver",
      region: "EU",
      classID: 4,
    });

    assert.equal(preview.eligible, true);
    assert.deepEqual(preview.blockers, []);
    assert.equal(preview.impact.appearanceCount, 33);
    assert.equal(preview.impact.raidCount, 3);
    assert.equal(preview.target.wclCanonicalCharacterId, 272115);
  } finally {
    characterModel.findById = originals.characterFindById;
    appearanceModel.aggregate = originals.appearanceAggregate;
    appearanceModel.distinct = originals.appearanceDistinct;
    appearanceModel.countDocuments = originals.appearanceCountDocuments;
    linkModel.findOne = originals.linkFindOne;
  }
});

test("resolves future report-ranking appearances through a manual identity link", async () => {
  const characterModel = Character as any;
  const linkModel = CharacterIdentityLink as any;
  const originals = {
    characterFindById: characterModel.findById,
    linkFindOne: linkModel.findOne,
  };
  const targetId = new mongoose.Types.ObjectId();
  const linkId = new mongoose.Types.ObjectId();

  try {
    linkModel.findOne = () => ({
      select() {
        return this;
      },
      lean: async () => ({ _id: linkId, targetCharacterId: targetId }),
    });
    characterModel.findById = () => ({
      select() {
        return this;
      },
      lean: async () => ({
        _id: targetId,
        classID: 4,
        wclCanonicalCharacterId: 272115,
      }),
    });

    const resolved = await (characterService as any).findCanonicalCharacterForReportRankingAppearance({
      name: "Fluidyy",
      realm: "stormreaver",
      region: "eu",
      classID: 4,
    });

    assert.equal(resolved.characterId.toString(), targetId.toString());
    assert.equal(resolved.wclCanonicalCharacterId, 272115);
    assert.equal(resolved.manualIdentityLinkId.toString(), linkId.toString());
  } finally {
    characterModel.findById = originals.characterFindById;
    linkModel.findOne = originals.linkFindOne;
  }
});
