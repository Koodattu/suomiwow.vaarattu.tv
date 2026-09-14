import assert from "node:assert/strict";
import test from "node:test";

process.env.RAIDER_IO_API_KEY ||= "test";

test("the active M+ season appears with its static dungeons before score data arrives", async (t) => {
  const [
    { default: mythicPlusService },
    { default: CharacterMythicPlusSeasonScore },
    { default: CharacterMythicPlusDungeonRun },
    { default: MythicPlusSeason },
    { default: MythicPlusDungeon },
  ] = await Promise.all([
    import("../src/services/mythic-plus.service"),
    import("../src/models/CharacterMythicPlusSeasonScore"),
    import("../src/models/CharacterMythicPlusDungeonRun"),
    import("../src/models/MythicPlusSeason"),
    import("../src/models/MythicPlusDungeon"),
  ]);

  const service = mythicPlusService as any;
  const scoreModel = CharacterMythicPlusSeasonScore as any;
  const runModel = CharacterMythicPlusDungeonRun as any;
  const seasonModel = MythicPlusSeason as any;
  const dungeonModel = MythicPlusDungeon as any;
  const originalGetEligibleCharacterIds = service.getEligibleCharacterIds;
  const originalGetCurrentSeasonSlug = service.getCurrentSeasonSlug;
  const originalScoreDistinct = scoreModel.distinct;
  const originalRunAggregate = runModel.aggregate;
  const originalSeasonFind = seasonModel.find;
  const originalDungeonFind = dungeonModel.find;

  t.after(() => {
    service.getEligibleCharacterIds = originalGetEligibleCharacterIds;
    service.getCurrentSeasonSlug = originalGetCurrentSeasonSlug;
    scoreModel.distinct = originalScoreDistinct;
    runModel.aggregate = originalRunAggregate;
    seasonModel.find = originalSeasonFind;
    dungeonModel.find = originalDungeonFind;
  });

  service.getEligibleCharacterIds = async () => [];
  service.getCurrentSeasonSlug = async () => "season-mn-2";
  scoreModel.distinct = () => ({ maxTimeMS: async () => [] });
  runModel.aggregate = () => ({ option: async () => [] });
  seasonModel.find = () => ({
    select() { return this; },
    sort() { return this; },
    lean: async () => [{
      slug: "season-mn-2",
      name: "Midnight Season 2",
      shortName: "MN S2",
      expansionId: 11,
      order: 1,
      raw: { dungeons: Array.from({ length: 8 }, (_, index) => ({ id: index + 1 })) },
    }],
  });
  dungeonModel.find = () => ({
    select() { return this; },
    lean: async () => Array.from({ length: 8 }, (_, index) => ({
      raiderIoDungeonId: index + 1,
      challengeModeId: 580 + index,
      slug: `dungeon-${index + 1}`,
      name: `Dungeon ${index + 1}`,
      shortName: `D${index + 1}`,
      iconUrl: null,
      expansionId: 11,
    })),
  });

  const options = await service.buildOptions();

  assert.equal(options.defaultSelection.season, "season-mn-2");
  assert.equal(options.seasons.length, 1);
  assert.equal(options.seasons[0].dungeons.length, 8);
});

test("options preserve historical score-only seasons and run-only dungeons absent from static metadata", async (t) => {
  const [{ default: service }, { default: scores }, { default: runs }, { default: seasons }, { default: dungeons }] = await Promise.all([
    import("../src/services/mythic-plus.service"),
    import("../src/models/CharacterMythicPlusSeasonScore"),
    import("../src/models/CharacterMythicPlusDungeonRun"),
    import("../src/models/MythicPlusSeason"),
    import("../src/models/MythicPlusDungeon"),
  ]);
  t.mock.method(service as any, "getEligibleCharacterIds", async () => []);
  t.mock.method(service as any, "getCurrentSeasonSlug", async () => "season-mn-2");
  t.mock.method(scores as any, "distinct", () => ({ maxTimeMS: async () => ["season-tww-3"] }));
  t.mock.method(runs as any, "aggregate", () => ({ option: async () => [{ _id: { season: "legacy-run-only", dungeonId: 900 } }] }));
  t.mock.method(seasons as any, "find", () => ({
    select() { return this; }, sort() { return this; },
    lean: async () => [{ slug: "season-mn-2", name: "Current season", order: 1, raw: { dungeons: [{ id: 901 }] } }],
  }));
  t.mock.method(dungeons as any, "find", () => ({
    select() { return this; },
    lean: async () => [{ raiderIoDungeonId: 900, name: "Legacy dungeon" }, { raiderIoDungeonId: 901, name: "Current dungeon" }],
  }));
  const options = await (service as any).buildOptions();
  assert.equal(options.defaultSelection.season, "season-mn-2");
  assert.ok(options.seasons.some((season: any) => season.slug === "season-tww-3"));
  assert.equal(options.seasons.find((season: any) => season.slug === "legacy-run-only").dungeons[0].id, 900);
  assert.equal(options.seasons.find((season: any) => season.slug === "season-mn-2").dungeons[0].id, 901);
});
