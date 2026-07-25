import assert from "node:assert/strict";
import test from "node:test";

test("Community character resolution uses the current Blizzard guild for an existing database character", async () => {
  process.env.BLIZZARD_CLIENT_ID ??= "test-client";
  process.env.BLIZZARD_CLIENT_SECRET ??= "test-secret";

  const [
    { default: ccgCommunityService },
    { default: blizzardService },
    { default: CcgCard },
    { default: Character },
    { default: Guild },
  ] = await Promise.all([
    import("../src/services/ccg-community.service"),
    import("../src/services/blizzard.service"),
    import("../src/models/CcgCard"),
    import("../src/models/Character"),
    import("../src/models/Guild"),
  ]);

  const service = ccgCommunityService as any;
  const blizzard = blizzardService as any;
  const cardModel = CcgCard as any;
  const characterModel = Character as any;
  const guildModel = Guild as any;
  const originals = {
    getCharacterProfile: blizzard.getCharacterProfile,
    getCharacterMedia: blizzard.getCharacterMedia,
    cardFindOne: cardModel.findOne,
    characterFindOne: characterModel.findOne,
    guildFindOne: guildModel.findOne,
  };
  const linkedCharacterId = "507f1f77bcf86cd799439011";
  const currentGuildId = "507f1f77bcf86cd799439012";
  let profileLookupCount = 0;
  let guildQuery: Record<string, unknown> | undefined;

  try {
    blizzard.getCharacterProfile = async () => {
      profileLookupCount += 1;
      return {
        id: 123,
        name: "Testcharacter",
        realm: { name: "Stormreaver", slug: "stormreaver" },
        character_class: { id: 8, name: "Mage" },
        active_spec: { id: 63, name: "Fire" },
        guild: { name: "Current Guild", realm: { name: "Twisting Nether", slug: "twisting-nether" } },
        level: 80,
      };
    };
    blizzard.getCharacterMedia = async () => ({
      avatarUrl: "https://example.com/avatar.jpg",
      insetUrl: null,
      mainRawUrl: "https://example.com/render.png",
    });
    characterModel.findOne = () => ({
      collation() { return this; },
      lean: async () => ({
        _id: linkedCharacterId,
        name: "Testcharacter",
        realm: "Stormreaver",
        region: "eu",
        guildName: "Stale Guild",
        guildRealm: "Stormreaver",
      }),
    });
    guildModel.findOne = (query: Record<string, unknown>) => {
      guildQuery = query;
      return {
        collation() { return this; },
        select() { return this; },
        lean: async () => ({ _id: currentGuildId }),
      };
    };
    cardModel.findOne = () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => null,
    });

    const resolved = await service.resolveCharacter("testcharacter", "stormreaver", "eu");

    assert.equal(profileLookupCount, 1);
    assert.equal(resolved.guildName, "Current Guild");
    assert.equal(resolved.guildRealm, "Twisting Nether");
    assert.deepEqual(guildQuery, { name: "Current Guild", realm: "Twisting Nether", region: "eu" });
  } finally {
    blizzard.getCharacterProfile = originals.getCharacterProfile;
    blizzard.getCharacterMedia = originals.getCharacterMedia;
    cardModel.findOne = originals.cardFindOne;
    characterModel.findOne = originals.characterFindOne;
    guildModel.findOne = originals.guildFindOne;
  }
});
