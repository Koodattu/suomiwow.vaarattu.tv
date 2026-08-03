import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Character from "../src/models/Character";
import CharacterIdentityLink from "../src/models/CharacterIdentityLink";
import CharacterIdentityResolution from "../src/models/CharacterIdentityResolution";
import characterService from "../src/services/character.service";
import characterIdentityResolutionService, { classifyWclIdentityResult } from "../src/services/character-identity-resolution.service";

test("classifies only a visible, canonical, class-matching WCL identity as resolved", () => {
  assert.equal(
    classifyWclIdentityResult(
      { classID: 11, region: "eu" },
      {
        id: 123,
        canonicalID: 456,
        classID: 11,
        hidden: false,
        server: { slug: "kazzak", region: { slug: "eu" } },
      },
    ),
    "resolved",
  );
  assert.equal(classifyWclIdentityResult({ classID: 11, region: "eu" }, null), "not_found");
  assert.equal(classifyWclIdentityResult({ classID: 11, region: "eu" }, { canonicalID: 456, classID: 11, hidden: true }), "hidden");
  assert.equal(classifyWclIdentityResult({ classID: 11, region: "eu" }, { canonicalID: 456, classID: 4 }), "class_mismatch");
  assert.equal(classifyWclIdentityResult({ classID: 11, region: "eu" }, { id: 123, classID: 11 }), "invalid_response");
  assert.equal(
    classifyWclIdentityResult(
      { classID: 11, region: "eu" },
      { canonicalID: 456, classID: 11, server: { slug: "kazzak", region: { slug: "us" } } },
    ),
    "invalid_response",
  );
});

test("identity resolver queries WCL by historical name, realm, and region", () => {
  const query = (characterIdentityResolutionService as any).buildWclQuery();

  assert.match(query, /character\(name: \$characterName, serverSlug: \$serverSlug, serverRegion: \$serverRegion\)/);
  assert.match(query, /canonicalID/);
  assert.match(query, /classID/);
  assert.match(query, /hidden/);
  assert.match(query, /server\s*{/);
});

test("future report-ranking appearances reuse a completed automatic WCL identity resolution", async () => {
  const characterModel = Character as any;
  const manualLinkModel = CharacterIdentityLink as any;
  const resolutionModel = CharacterIdentityResolution as any;
  const originals = {
    characterFind: characterModel.find,
    characterFindById: characterModel.findById,
    manualFindOne: manualLinkModel.findOne,
    resolutionFindOne: resolutionModel.findOne,
  };
  const characterId = new mongoose.Types.ObjectId();

  try {
    manualLinkModel.findOne = () => ({
      select() {
        return this;
      },
      lean: async () => null,
    });
    resolutionModel.findOne = () => ({
      select() {
        return this;
      },
      lean: async () => ({
        targetCharacterId: characterId,
        wclCanonicalCharacterId: 456,
      }),
    });
    characterModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [],
    });
    characterModel.findById = () => ({
      select() {
        return this;
      },
      lean: async () => ({
        _id: characterId,
        wclCanonicalCharacterId: 456,
        name: "Currentname",
        realm: "kazzak",
        region: "eu",
        classID: 11,
      }),
    });

    const resolved = await (characterService as any).findCanonicalCharacterForReportRankingAppearance({
      name: "Historicalname",
      realm: "stormreaver",
      region: "eu",
      classID: 11,
    });

    assert.equal(resolved.characterId.toString(), characterId.toString());
    assert.equal(resolved.wclCanonicalCharacterId, 456);
    assert.equal(resolved.name, "Currentname");
    assert.equal(resolved.realm, "kazzak");
  } finally {
    characterModel.find = originals.characterFind;
    characterModel.findById = originals.characterFindById;
    manualLinkModel.findOne = originals.manualFindOne;
    resolutionModel.findOne = originals.resolutionFindOne;
  }
});
