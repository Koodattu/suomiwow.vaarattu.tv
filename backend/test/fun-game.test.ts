import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import Guild from "../src/models/Guild";
import Raid from "../src/models/Raid";
import CharacterMedia from "../src/models/CharacterMedia";
import CharacterRaidParticipation from "../src/models/CharacterRaidParticipation";
import { generateLockItInRound } from "../src/features/fun/generators/lock-it-in";
import { isBossMechanicScoreBetter, sanitizeBossMechanicScoreInput } from "../src/features/fun/boss-mechanic-leaderboard.service";
import { loadBossMechanicCharacters, loadBossMechanicGuilds } from "../src/features/fun/fun-game.service";
import {
  funMythicGuildFilter,
  funMythicParticipationFilter,
  funMythicProgressMatch,
  MIN_FUN_CHARACTER_MYTHIC_REPORTS,
} from "../src/features/fun/fun-game.eligibility";
import { FUN_GAME_SLUGS, isFunGameSlug } from "../src/features/fun/fun-game.types";
import {
  bossKey,
  canonicalCharacterKey,
  findDistinctAssignments,
  FunRoundUnavailableError,
  newRoundBase,
  sample,
  shuffle,
} from "../src/features/fun/fun-game.utils";

test("fun game identifiers and round metadata are stable API primitives", () => {
  assert.equal(isFunGameSlug("guild-guessr"), true);
  assert.equal(isFunGameSlug("not-a-game"), false);
  assert.equal(FUN_GAME_SLUGS.length, 9);
  assert.equal(canonicalCharacterKey(1234, 8), "wcl:1234:8");
  assert.equal(bossKey(42, 7), "42:7");

  const base = newRoundBase();
  assert.match(base.roundId, /^[0-9a-f-]{36}$/i);
  assert.equal(Number.isNaN(Date.parse(base.generatedAt)), false);
});

test("fun game eligibility requires sustained Mythic participation and Mythic progression", () => {
  assert.equal(MIN_FUN_CHARACTER_MYTHIC_REPORTS, 3);
  assert.equal(funMythicParticipationFilter().mythicReportCount.$gte, 3);
  assert.equal(funMythicProgressMatch()["progress.difficulty"], "mythic");
  assert.equal(funMythicGuildFilter().progress.$elemMatch.difficulty, "mythic");
  assert.equal(funMythicGuildFilter().progress.$elemMatch.bosses.$elemMatch.pullCount.$gt, 0);
});

test("fun game sampling preserves candidates and rejects undersized pools", () => {
  const candidates = [1, 2, 3, 4, 5];
  const shuffled = shuffle(candidates);
  assert.deepEqual([...shuffled].sort((left, right) => left - right), candidates);
  assert.deepEqual(candidates, [1, 2, 3, 4, 5]);

  const selected = sample(candidates, 3);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, 3);
  assert.throws(() => sample(candidates, 6), FunRoundUnavailableError);
});

test("boss mechanic raids use twenty distinct stored character renders", async () => {
  const mediaModel = CharacterMedia as any;
  const originalAggregate = mediaModel.aggregate;
  let pipeline: any[] = [];
  const rows = Array.from({ length: 20 }, (_, index) => ({
    characterId: { toString: () => `character-${index}` },
    characterName: `Raider ${index}`,
    realmSlug: "test-realm",
    region: "EU",
    classID: (index % 13) + 1,
    renderAssetId: { toString: () => `asset-${index}` },
    renderFit: { top: 0.05, ground: 0.95, centerX: 0.5 },
  }));

  try {
    mediaModel.aggregate = (nextPipeline: any[]) => {
      pipeline = nextPipeline;
      return { option: async () => rows };
    };
    const response = await loadBossMechanicCharacters();
    assert.equal(response.characters.length, 20);
    assert.equal(new Set(response.characters.map((character) => character.id)).size, 20);
    assert.equal(response.characters[0].renderUrl, "/api/ccg/media/assets/asset-0");
    assert.equal(response.characters[0].classID, 1);
    assert.deepEqual(response.characters[0].renderFit, rows[0].renderFit);
    const participationLookup = pipeline.find((stage) => stage.$lookup?.from === CharacterRaidParticipation.collection.name)?.$lookup;
    assert.ok(participationLookup);
    const candidateSampleIndex = pipeline.findIndex((stage) => stage.$sample);
    const participationLookupIndex = pipeline.findIndex((stage) => stage.$lookup?.from === CharacterRaidParticipation.collection.name);
    assert.equal(pipeline[candidateSampleIndex].$sample.size, 200);
    assert.ok(candidateSampleIndex < participationLookupIndex);
    assert.ok(pipeline.findIndex((stage) => stage.$limit === 20) > participationLookupIndex);
    assert.deepEqual(
      participationLookup.pipeline.find((stage: any) => stage.$group)?.$group,
      { _id: "$zoneId", mythicReportCount: { $sum: "$mythicReportCount" } },
    );
    assert.deepEqual(
      participationLookup.pipeline.find((stage: any) => stage.$match?.mythicReportCount)?.$match,
      { mythicReportCount: { $gte: MIN_FUN_CHARACTER_MYTHIC_REPORTS } },
    );
  } finally {
    mediaModel.aggregate = originalAggregate;
  }
});

test("boss mechanic guilds come only from The Venomous Abyss and are sorted alphabetically", async () => {
  const participationModel = CharacterRaidParticipation as any;
  const originalAggregate = participationModel.aggregate;
  let pipeline: any[] = [];
  const firstGuildId = new Types.ObjectId();
  const secondGuildId = new Types.ObjectId();

  try {
    participationModel.aggregate = (nextPipeline: any[]) => {
      pipeline = nextPipeline;
      return {
        option: async () => [
          { guildId: firstGuildId, name: "Alpha", realm: "first-realm" },
          { guildId: secondGuildId, name: "Zulu", realm: "second-realm" },
        ],
      };
    };

    const response = await loadBossMechanicGuilds();
    assert.deepEqual(response.guilds, [
      { id: firstGuildId.toString(), name: "Alpha", realm: "first-realm" },
      { id: secondGuildId.toString(), name: "Zulu", realm: "second-realm" },
    ]);
    assert.deepEqual(pipeline[0], { $match: { zoneId: 53 } });
    assert.deepEqual(
      pipeline.find((stage) => stage.$sort)?.$sort,
      { sortName: 1, sortRealm: 1, guildId: 1 },
    );
  } finally {
    participationModel.aggregate = originalAggregate;
  }
});

test("boss mechanic guild selection prioritizes eligible guild characters and fills remaining slots globally", async () => {
  const mediaModel = CharacterMedia as any;
  const participationModel = CharacterRaidParticipation as any;
  const originalAggregate = mediaModel.aggregate;
  const originalDistinct = participationModel.distinct;
  const guildId = new Types.ObjectId();
  const guildCharacterIds = Array.from({ length: 8 }, () => new Types.ObjectId());
  const makeRow = (characterId: Types.ObjectId, index: number) => ({
    characterId,
    characterName: `Raider ${index}`,
    realmSlug: "test-realm",
    region: "EU",
    classID: (index % 13) + 1,
    renderAssetId: new Types.ObjectId(),
    renderFit: { top: 0.05, ground: 0.95, centerX: 0.5 },
  });
  const guildRows = guildCharacterIds.map(makeRow);
  const fillRows = Array.from({ length: 12 }, (_, index) => makeRow(new Types.ObjectId(), index + guildRows.length));
  const pipelines: any[][] = [];

  try {
    participationModel.distinct = async (field: string, filter: Record<string, unknown>) => {
      assert.equal(field, "characterId");
      assert.equal(filter.zoneId, 53);
      assert.equal(String(filter.reportGuildId), guildId.toString());
      return guildCharacterIds;
    };
    mediaModel.aggregate = (pipeline: any[]) => {
      const callIndex = pipelines.length;
      pipelines.push(pipeline);
      return { option: async () => callIndex === 0 ? guildRows : fillRows };
    };

    const response = await loadBossMechanicCharacters(guildId.toString());
    assert.equal(response.characters.length, 20);
    assert.deepEqual(pipelines[0][0].$match.characterId, { $in: guildCharacterIds });
    assert.deepEqual(pipelines[1][0].$match.characterId, { $nin: guildRows.map((row) => row.characterId) });
    assert.ok(pipelines[0].some((stage) => stage.$limit === 20));
    assert.ok(pipelines[1].some((stage) => stage.$limit === 12));
  } finally {
    mediaModel.aggregate = originalAggregate;
    participationModel.distinct = originalDistinct;
  }
});

test("boss mechanic leaderboard validates scores and prioritizes difficulty, time, then pulls", () => {
  assert.deepEqual(
    sanitizeBossMechanicScoreInput({ difficulty: "normal", pulls: 4, timeLeftMs: 20_000, team: " Dream   team " }),
    { difficulty: "normal", pulls: 4, timeLeftMs: 20_000, team: "Dream team" },
  );
  assert.equal(sanitizeBossMechanicScoreInput({ difficulty: "heroic", pulls: 1, timeLeftMs: 10_001, team: "Dream team" }), null);
  assert.equal(sanitizeBossMechanicScoreInput({ difficulty: "mythic", pulls: 1.5, timeLeftMs: 5_000, team: "Dream team" }), null);
  assert.equal(sanitizeBossMechanicScoreInput({ difficulty: "lfr", pulls: 1, timeLeftMs: 5_000, team: "Dream team" }), null);
  assert.equal(sanitizeBossMechanicScoreInput({ difficulty: "mythic", pulls: 1, timeLeftMs: 5_000, team: "  " }), null);

  assert.equal(isBossMechanicScoreBetter(
    { difficulty: "mythic", difficultyRank: 3, pulls: 100, timeLeftMs: 0 },
    { difficulty: "heroic", difficultyRank: 2, pulls: 1, timeLeftMs: 10_000 },
  ), true);
  assert.equal(isBossMechanicScoreBetter(
    { difficulty: "heroic", difficultyRank: 2, pulls: 4, timeLeftMs: 8_001 },
    { difficulty: "heroic", difficultyRank: 2, pulls: 1, timeLeftMs: 8_000 },
  ), true);
  assert.equal(isBossMechanicScoreBetter(
    { difficulty: "heroic", difficultyRank: 2, pulls: 2, timeLeftMs: 8_000 },
    { difficulty: "heroic", difficultyRank: 2, pulls: 3, timeLeftMs: 8_000 },
  ), true);
  assert.equal(isBossMechanicScoreBetter(
    { difficulty: "heroic", difficultyRank: 2, pulls: 1, timeLeftMs: 7_999 },
    { difficulty: "heroic", difficultyRank: 2, pulls: 10, timeLeftMs: 8_000 },
  ), false);
});

test("distinct cell assignments reject impossible grids and solve overlapping candidates", () => {
  const a = { key: "a" };
  const b = { key: "b" };
  const c = { key: "c" };
  assert.equal(
    findDistinctAssignments([
      { id: "one", candidates: [a, b] },
      { id: "two", candidates: [a, b] },
      { id: "three", candidates: [a, b] },
    ]),
    null,
  );

  const solved = findDistinctAssignments([
    { id: "one", candidates: [a, b] },
    { id: "two", candidates: [a, b] },
    { id: "three", candidates: [b, c] },
  ]);
  assert.ok(solved);
  assert.equal(new Set(Object.values(solved).map((candidate) => candidate.key)).size, 3);
});

test("lock it in creates a five-guild ascending solution and shuffled reveal", async () => {
  const guildModel = Guild as any;
  const raidModel = Raid as any;
  const originalAggregate = guildModel.aggregate;
  const originalFind = raidModel.find;
  const kills = [8, 14, 21, 29, 43, 58].map((pullCount, index) => ({
    guildId: `guild-${index + 1}`,
    guildName: `Guild ${index + 1}`,
    guildRealm: "Test Realm",
    raidId: 42,
    bossId: 7,
    pullCount,
  }));

  try {
    guildModel.aggregate = () => ({ option: async () => kills });
    raidModel.find = () => ({
      select() {
        return this;
      },
      lean: async () => [{ id: 42, name: "Test Raid", expansion: "Test Expansion", bosses: [{ id: 7, name: "Test Boss" }] }],
    });

    const round = await generateLockItInRound();
    assert.equal(round.game, "lock-it-in");
    assert.equal(round.solution.ranking.length, 5);
    assert.equal(round.revealOrder.length, 5);
    assert.equal(new Set(round.solution.ranking.map((entry) => entry.guild.id)).size, 5);
    assert.deepEqual(
      round.solution.ranking.map((entry) => entry.pullCount),
      [...round.solution.ranking.map((entry) => entry.pullCount)].sort((left, right) => left - right),
    );
    assert.deepEqual(
      round.revealOrder.map((guild) => guild.id).sort(),
      round.solution.ranking.map((entry) => entry.guild.id).sort(),
    );
  } finally {
    guildModel.aggregate = originalAggregate;
    raidModel.find = originalFind;
  }
});
