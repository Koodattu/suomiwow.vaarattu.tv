import assert from "node:assert/strict";
import test from "node:test";
import Ranking from "../src/models/Ranking";
import Report from "../src/models/Report";
import CharacterLeaderboard from "../src/models/CharacterLeaderboard";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";

process.env.RAIDER_IO_API_KEY ||= "test";
process.env.BLIZZARD_CLIENT_ID ||= "test";
process.env.BLIZZARD_CLIENT_SECRET ||= "test";

const scoringIds = [3470, 3445, 3455, 3497, 3420, 3421, 3429, 3492, 3379];

test("AllStars queries include Nymrissa and exclude Kith'ix for individual and combined partitions", async (t) => {
  const { default: service } = await import("../src/services/character.service");
  const matches: any[] = [];
  t.mock.method(Ranking, "distinct", async (field: string) => field === "encounter.id" ? [3379, 3513] : field === "partition" ? [1, 2] : []);
  t.mock.method(Ranking, "aggregate", async (pipeline: any[]) => { matches.push(pipeline[0].$match); return []; });
  t.mock.method(CharacterLeaderboard, "deleteMany", async () => ({}));
  t.mock.method(CharacterLeaderboard, "syncIndexes", async () => []);
  await service.buildCharacterLeaderboards();
  const aggregateMatches = matches.filter(match => typeof match["encounter.id"] !== "number");
  assert.equal(aggregateMatches.length, 3);
  assert.deepEqual(aggregateMatches.map(match => match.partition), [1, 2, undefined]);
  for (const match of aggregateMatches) assert.deepEqual(match["encounter.id"], { $in: scoringIds });
  for (const id of [3379, 3513]) {
    assert.equal(matches.filter(match => match["encounter.id"] === id).length, 3, "individual lair leaderboards must still be built");
  }
});

test("participation rebuild uses the same nine encounters before counting reports or checking appearances", async (t) => {
  const { default: service } = await import("../src/services/character.service");
  const connection = CharacterRaidParticipation.db;
  const originalDb = connection.db;
  const stop = new Error("Captured participation pipeline; no database needed");
  let pipeline: any[] = [];
  connection.db = { collection: () => ({ drop: async () => {} }) } as any;
  t.mock.method(Report.collection, "createIndex", async () => "test");
  t.mock.method(Report, "aggregate", (stages: any[]) => {
    pipeline = stages;
    return { allowDiskUse: () => ({ exec: async () => { throw stop; } }) } as any;
  });
  try {
    await assert.rejects(service.rebuildCharacterRaidParticipations({ reconcileIdentities: false }), error => error === stop);
    const filterIndex = pipeline.findIndex(stage => stage.$set?.fightSequence);
    const filter = pipeline[filterIndex].$set.fightSequence.$filter;
    const rule = filter.cond.$switch.branches.find((branch: any) => branch.case.$eq[1] === 53);
    assert.deepEqual(rule.then, { $in: ["$$fight.encounterID", scoringIds] });
    assert.equal(filter.cond.$switch.default, true, "other raids retain their participation rules");
    assert.deepEqual(pipeline[filterIndex + 1], { $match: { "fightSequence.difficulty": { $in: [4, 5] } } });
    const projection = pipeline[filterIndex + 2].$project;
    assert.equal(projection.scoringFightIds, "$fightSequence.fightId");
    assert.equal(projection.hasMythicReport.$anyElementTrue.$map.input, "$fightSequence");
    const appearanceMatch = pipeline.find(stage => stage.$match?.$expr).$match.$expr.$or;
    assert.deepEqual(appearanceMatch[1].$gt[0].$size.$setIntersection, ["$scoringFightIds", { $ifNull: ["$appearance.rankingFightIds", []] }]);
    assert.deepEqual(appearanceMatch[0], { $eq: [{ $size: { $ifNull: ["$appearance.rankingFightIds", []] } }, 0] }, "preserve the existing fallback for report-only appearances");
  } finally {
    connection.db = originalDb;
  }
});
