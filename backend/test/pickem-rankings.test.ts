import assert from "node:assert/strict";
import test from "node:test";
import { getPickemRankingProgress } from "../src/utils/pickemRankings";

test("uses Heroic progress for Pickem rankings before a guild has a Mythic kill", () => {
  const progress = [
    { raidId: 51, difficulty: "mythic" as const, bossesDefeated: 0, totalBosses: 8 },
    { raidId: 51, difficulty: "heroic" as const, bossesDefeated: 7, totalBosses: 8, guildRank: 3 },
  ];

  assert.equal(getPickemRankingProgress(progress, 51), progress[1]);
});

test("uses Mythic progress once the unified guild rank moves to Mythic", () => {
  const progress = [
    { raidId: 51, difficulty: "mythic" as const, bossesDefeated: 1, totalBosses: 8, guildRank: 2 },
    { raidId: 51, difficulty: "heroic" as const, bossesDefeated: 8, totalBosses: 8 },
  ];

  assert.equal(getPickemRankingProgress(progress, 51), progress[0]);
});

test("falls back to killed-boss progress while unified ranks are being refreshed", () => {
  const progress = [
    { raidId: 51, difficulty: "mythic" as const, bossesDefeated: 0, totalBosses: 8 },
    { raidId: 51, difficulty: "heroic" as const, bossesDefeated: 4, totalBosses: 8 },
  ];

  assert.equal(getPickemRankingProgress(progress, 51), progress[1]);
});
