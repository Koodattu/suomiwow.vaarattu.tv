import assert from "node:assert/strict";
import test from "node:test";
import { IRaidProgress } from "../src/models/Guild";
import twitchChatCommandService, { selectPredictionTarget } from "../src/services/twitch-chat-command.service";

const raidProgress = (raidId: number, bossId: number, bossName: string): IRaidProgress => ({
  raidId,
  raidName: `Raid ${raidId}`,
  difficulty: "mythic",
  bossesDefeated: 0,
  totalBosses: 2,
  totalTimeSpent: 0,
  bosses: [
    {
      bossId,
      bossName,
      kills: 0,
      bestPercent: 25,
      pullCount: 20,
      timeSpent: 0,
      lastUpdated: new Date(),
    },
  ],
  lastUpdated: new Date(),
});

test("parses both prediction command aliases into one canonical command", () => {
  assert.deepEqual(twitchChatCommandService.parse("!prediction"), { name: "prediction", args: "" });
  assert.deepEqual(twitchChatCommandService.parse("  !EnNuStUs Tuju  "), { name: "prediction", args: "Tuju" });
});

test("does not parse partial prediction command names", () => {
  assert.equal(twitchChatCommandService.parse("!predictions"), null);
  assert.equal(twitchChatCommandService.parse("!ennustusnyt"), null);
});

test("keeps the existing command aliases unchanged", () => {
  assert.deepEqual(twitchChatCommandService.parse("!paras"), { name: "best", args: "" });
  assert.deepEqual(twitchChatCommandService.parse("!search Tuju"), { name: "search", args: "Tuju" });
});

test("selects the most recently pulled boss across current raids", () => {
  const primaryRaid = raidProgress(46, 1001, "Primary raid boss");
  const secondaryRaid = raidProgress(50, 2001, "Secondary raid boss");
  secondaryRaid.bosses.push({ ...secondaryRaid.bosses[0], bossId: 2002, bossName: "Most recent boss" });

  const fallback = selectPredictionTarget([primaryRaid, secondaryRaid], null);
  const recent = selectPredictionTarget([primaryRaid, secondaryRaid], {
    raidId: secondaryRaid.raidId,
    difficulty: secondaryRaid.difficulty,
    bossId: 2002,
  });

  assert.equal(fallback?.boss?.bossName, "Primary raid boss");
  assert.equal(recent?.boss?.bossName, "Most recent boss");
});
