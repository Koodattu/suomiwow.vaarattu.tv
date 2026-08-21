import assert from "node:assert/strict";
import test from "node:test";
import Guild from "../src/models/Guild";
import Raid from "../src/models/Raid";
import CharacterMedia from "../src/models/CharacterMedia";
import { generateLockItInRound } from "../src/features/fun/generators/lock-it-in";
import { loadBossMechanicCharacters } from "../src/features/fun/fun-game.service";
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
  const rows = Array.from({ length: 20 }, (_, index) => ({
    characterId: { toString: () => `character-${index}` },
    characterName: `Raider ${index}`,
    realmSlug: "test-realm",
    region: "EU",
    renderAssetId: { toString: () => `asset-${index}` },
    renderFit: { top: 0.05, ground: 0.95, centerX: 0.5 },
  }));

  try {
    mediaModel.aggregate = () => ({ option: async () => rows });
    const response = await loadBossMechanicCharacters();
    assert.equal(response.characters.length, 20);
    assert.equal(new Set(response.characters.map((character) => character.id)).size, 20);
    assert.equal(response.characters[0].renderUrl, "/api/ccg/media/assets/asset-0");
    assert.deepEqual(response.characters[0].renderFit, rows[0].renderFit);
  } finally {
    mediaModel.aggregate = originalAggregate;
  }
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
